import * as fs from 'fs';
import * as path from 'path';
import { STACKS_MAINNET, STACKS_TESTNET } from '@stacks/network';
import fetchMock from 'jest-fetch-mock';
import {
  AddressHashMode,
  Cl,
  buildContractCall,
  buildContractDeploy,
  buildSTXTokenTransfer,
  deserializeTransaction,
  isSingleSig,
  makeUnsignedContractCall,
  makeUnsignedContractDeploy,
  makeUnsignedSTXTokenTransfer,
} from '../src';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function reviver(_key: string, value: any): any {
  if (value && typeof value === 'object' && !Array.isArray(value) && '__bigint' in value) {
    return BigInt(value.__bigint);
  }
  return value;
}

type Row = { name: string; input: any; output: string };

function readFixture(file: string): Row[] {
  return fs
    .readFileSync(path.join(FIXTURES_DIR, file), 'utf8')
    .split('\n')
    .filter(l => l.length > 0)
    .map(l => JSON.parse(l, reviver));
}

describe('build* produce the same hex as fixtures', () => {
  describe.each(readFixture('stx-transfer.jsonl'))('$name', ({ input, output }) => {
    it('buildSTXTokenTransfer', () => {
      const tx = buildSTXTokenTransfer(input);
      expect(tx.serialize()).toBe(output);
    });
  });

  describe.each(readFixture('contract-deploy.jsonl'))('$name', ({ input, output }) => {
    it('buildContractDeploy', () => {
      const tx = buildContractDeploy(input);
      expect(tx.serialize()).toBe(output);
    });
  });

  describe.each(readFixture('contract-call.jsonl'))('$name', ({ input, output }) => {
    it('buildContractCall', () => {
      const tx = buildContractCall(input);
      expect(tx.serialize()).toBe(output);
    });
  });
});

describe('make* still produce the same hex as fixtures (no drift)', () => {
  describe.each(readFixture('stx-transfer.jsonl'))('$name', ({ input, output }) => {
    it('makeUnsignedSTXTokenTransfer', async () => {
      const tx = await makeUnsignedSTXTokenTransfer(input);
      expect(tx.serialize()).toBe(output);
    });
  });

  describe.each(readFixture('contract-deploy.jsonl'))('$name', ({ input, output }) => {
    it('makeUnsignedContractDeploy', async () => {
      const tx = await makeUnsignedContractDeploy(input);
      expect(tx.serialize()).toBe(output);
    });
  });

  describe.each(readFixture('contract-call.jsonl'))('$name', ({ input, output }) => {
    it('makeUnsignedContractCall', async () => {
      const tx = await makeUnsignedContractCall(input);
      expect(tx.serialize()).toBe(output);
    });
  });
});

describe('build* guardrails', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
    fetchMock.mockReject(new Error('build* must not call fetch'));
  });

  it('buildSTXTokenTransfer is synchronous (not a Promise)', () => {
    const tx = buildSTXTokenTransfer({ recipient: 'SP3GWX3NE58KXHESRYE4DYQ1S31PQJTCRXB3PE9SB', amount: 1n });
    expect(tx).not.toBeInstanceOf(Promise);
    expect(typeof (tx as any).then).not.toBe('function');
  });

  it('buildContractDeploy is synchronous (not a Promise)', () => {
    const tx = buildContractDeploy({ contractName: 'x', codeBody: '(begin)' });
    expect(tx).not.toBeInstanceOf(Promise);
  });

  it('buildContractCall is synchronous (not a Promise)', () => {
    const tx = buildContractCall({
      contractAddress: 'SP3X6QWWETNBZWGBK6DRGTR1KX50S74D3433WDGJY',
      contractName: 'x',
      functionName: 'f',
      functionArgs: [],
    });
    expect(tx).not.toBeInstanceOf(Promise);
  });

  it('build* functions do not call fetch', () => {
    buildSTXTokenTransfer({ recipient: 'SP3GWX3NE58KXHESRYE4DYQ1S31PQJTCRXB3PE9SB', amount: 1n });
    buildContractDeploy({ contractName: 'x', codeBody: '(begin)' });
    buildContractCall({
      contractAddress: 'SP3X6QWWETNBZWGBK6DRGTR1KX50S74D3433WDGJY',
      contractName: 'x',
      functionName: 'f',
      functionArgs: [Cl.uint(1)],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds a structurally valid tx with a placeholder single-sig when no publicKey is provided', () => {
    const tx = buildSTXTokenTransfer({ recipient: 'SP3GWX3NE58KXHESRYE4DYQ1S31PQJTCRXB3PE9SB', amount: 1n });
    const parsed = deserializeTransaction(tx.serialize());
    expect(isSingleSig(parsed.auth.spendingCondition)).toBe(true);
    // placeholder signer hash is hash160 of a 33-byte all-zero public key,
    // reliably non-zero but deterministic.
    expect(parsed.auth.spendingCondition.signer).toMatch(/^[0-9a-f]{40}$/);
    expect(parsed.auth.spendingCondition.nonce).toBe(0n);
    expect(parsed.auth.spendingCondition.fee).toBe(0n);
  });

  it('defaults to mainnet when network is omitted', () => {
    const tx = buildSTXTokenTransfer({ recipient: 'SP3GWX3NE58KXHESRYE4DYQ1S31PQJTCRXB3PE9SB', amount: 1n });
    expect(tx.transactionVersion).toBe(STACKS_MAINNET.transactionVersion);
    expect(tx.chainId).toBe(STACKS_MAINNET.chainId);
  });

  it('accepts a testnet network string', () => {
    const tx = buildSTXTokenTransfer({
      recipient: 'ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC',
      amount: 1n,
      network: 'testnet',
    });
    expect(tx.transactionVersion).toBe(STACKS_TESTNET.transactionVersion);
    expect(tx.chainId).toBe(STACKS_TESTNET.chainId);
  });

  it('multi-sig: uses non-sequential hashmode by default', () => {
    const tx = buildSTXTokenTransfer({
      recipient: 'SP3GWX3NE58KXHESRYE4DYQ1S31PQJTCRXB3PE9SB',
      amount: 1n,
      numSignatures: 2,
      publicKeys: [
        '021ae7f08f9eaecaaa93f7c6ceac29213bae09588c15e2aded32016b259cfd9a1f',
        '03797dd653040d344fd048c1ad05d4cbcb2178b30c6a0c4276994795f3e833da41',
        '027d28f9951ce46538951e3697c62588a87f1f1f295de4a14fdd4c780fc52cfe69',
      ],
    });
    if (isSingleSig(tx.auth.spendingCondition)) throw new Error('expected multi-sig');
    expect(tx.auth.spendingCondition.hashMode).toBe(AddressHashMode.P2SHNonSequential);
  });
});
