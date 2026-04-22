// Throwaway generator — NOT to be committed.
// Generates JSONL vector fixtures from the current `make*` implementations.
// Delete this file after running once; the resulting .jsonl files are committed.

import * as fs from 'fs';
import * as path from 'path';
import {
  AddressHashMode,
  Cl,
  ClarityVersion,
  addressFromPublicKeys,
  addressToString,
  createStacksPublicKey,
  makeUnsignedContractCall,
  makeUnsignedContractDeploy,
  makeUnsignedSTXTokenTransfer,
} from '../src';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// Deterministic public keys (lifted from existing tests + generated once).
const PK1 = '021ae7f08f9eaecaaa93f7c6ceac29213bae09588c15e2aded32016b259cfd9a1f';
const PK2 = '03797dd653040d344fd048c1ad05d4cbcb2178b30c6a0c4276994795f3e833da41';
const PK3 = '027d28f9951ce46538951e3697c62588a87f1f1f295de4a14fdd4c780fc52cfe69';
const PK4 = '03b3e0a76b292b2c83fc0ac14ae6160d0438ebe94e14bbb5b7755153628f17e6fc';
const PK5 = '02b6a4fec63f1a46b8b94d3a1a1d8aa2ef90e77d9efb0f3d9a0c5cbf7b0c5e3c1e';

const RECIP_MAIN = 'SP3GWX3NE58KXHESRYE4DYQ1S31PQJTCRXB3PE9SB';
const RECIP_TEST = 'ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC';
const CONTRACT_ADDR = 'SP3X6QWWETNBZWGBK6DRGTR1KX50S74D3433WDGJY';

function replacer(_key: string, value: any): any {
  if (typeof value === 'bigint') return { __bigint: value.toString() };
  return value;
}

function addressForKeys(
  keys: string[],
  required: number,
  hashMode: AddressHashMode,
  versionByte: number
): string {
  return addressToString(
    addressFromPublicKeys(
      versionByte as any,
      hashMode,
      required,
      keys.map(createStacksPublicKey)
    )
  );
}

// Mainnet P2SH version byte is 20, testnet is 21. Non-sequential P2SH also 20/21.
const MAINNET_P2SH = 20;

async function writeJsonl<T extends { name: string; input: any }>(
  file: string,
  cases: T[],
  run: (input: any) => Promise<string>
): Promise<void> {
  const rows: string[] = [];
  for (const c of cases) {
    const output = await run(c.input);
    rows.push(JSON.stringify({ name: c.name, input: c.input, output }, replacer));
  }
  fs.writeFileSync(path.join(FIXTURES_DIR, file), rows.join('\n') + '\n');
}

describe('generate-vectors (throwaway)', () => {
  beforeAll(() => {
    if (!fs.existsSync(FIXTURES_DIR)) fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  });

  it('writes stx-transfer.jsonl', async () => {
    // Precompute multi-sig with-address case: address derived from the SORTED order,
    // but we pass the original unsorted order + the sorted-derived address to force a sort.
    const msKeysUnsorted = [PK2, PK1, PK3];
    const msKeysSorted = msKeysUnsorted.slice().sort();
    const msAddress = addressForKeys(msKeysSorted, 2, AddressHashMode.P2SHNonSequential, MAINNET_P2SH);

    const cases = [
      {
        name: 'stx-transfer-mainnet-basic',
        input: {
          recipient: RECIP_MAIN,
          amount: 1_000_000n,
          fee: 180n,
          nonce: 0n,
          network: 'mainnet',
          publicKey: PK1,
        },
      },
      {
        name: 'stx-transfer-mainnet-sponsored',
        input: {
          recipient: RECIP_MAIN,
          amount: 500n,
          fee: 180n,
          nonce: 3n,
          network: 'mainnet',
          publicKey: PK1,
          sponsored: true,
        },
      },
      {
        name: 'stx-transfer-mainnet-with-memo',
        input: {
          recipient: RECIP_MAIN,
          amount: 2_000n,
          fee: 200n,
          nonce: 1n,
          network: 'mainnet',
          publicKey: PK1,
          memo: 'thanks for lunch',
        },
      },
      {
        name: 'stx-transfer-mainnet-multisig-2of3-no-address',
        input: {
          recipient: RECIP_MAIN,
          amount: 12_345n,
          fee: 1_000n,
          nonce: 2n,
          network: 'mainnet',
          numSignatures: 2,
          publicKeys: [PK1, PK2, PK3],
          useNonSequentialMultiSig: true,
        },
      },
      {
        name: 'stx-transfer-mainnet-multisig-2of3-with-address',
        input: {
          recipient: RECIP_MAIN,
          amount: 12_345n,
          fee: 1_000n,
          nonce: 2n,
          network: 'mainnet',
          numSignatures: 2,
          publicKeys: msKeysUnsorted,
          address: msAddress,
          useNonSequentialMultiSig: true,
        },
      },
      {
        name: 'stx-transfer-mainnet-multisig-3of5',
        input: {
          recipient: RECIP_MAIN,
          amount: 999n,
          fee: 500n,
          nonce: 7n,
          network: 'mainnet',
          numSignatures: 3,
          publicKeys: [PK1, PK2, PK3, PK4, PK5],
          useNonSequentialMultiSig: true,
        },
      },
      {
        name: 'stx-transfer-testnet-basic',
        input: {
          recipient: RECIP_TEST,
          amount: 1_000n,
          fee: 180n,
          nonce: 0n,
          network: 'testnet',
          publicKey: PK1,
        },
      },
      {
        name: 'stx-transfer-testnet-multisig-2of3',
        input: {
          recipient: RECIP_TEST,
          amount: 42n,
          fee: 500n,
          nonce: 0n,
          network: 'testnet',
          numSignatures: 2,
          publicKeys: [PK1, PK2, PK3],
          useNonSequentialMultiSig: true,
        },
      },
    ];

    await writeJsonl('stx-transfer.jsonl', cases, async input => {
      const tx = await makeUnsignedSTXTokenTransfer(input);
      return tx.serialize();
    });
  });

  it('writes contract-deploy.jsonl', async () => {
    const shortCode = '(define-public (hi) (ok u1))';
    const cases = [
      {
        name: 'contract-deploy-mainnet-clarity1',
        input: {
          contractName: 'hello-1',
          codeBody: shortCode,
          clarityVersion: ClarityVersion.Clarity1,
          fee: 500n,
          nonce: 0n,
          network: 'mainnet',
          publicKey: PK1,
        },
      },
      {
        name: 'contract-deploy-mainnet-clarity2',
        input: {
          contractName: 'hello-2',
          codeBody: shortCode,
          clarityVersion: ClarityVersion.Clarity2,
          fee: 500n,
          nonce: 1n,
          network: 'mainnet',
          publicKey: PK1,
        },
      },
      {
        name: 'contract-deploy-mainnet-clarity3',
        input: {
          contractName: 'hello-3',
          codeBody: shortCode,
          clarityVersion: ClarityVersion.Clarity3,
          fee: 500n,
          nonce: 2n,
          network: 'mainnet',
          publicKey: PK1,
        },
      },
      {
        name: 'contract-deploy-mainnet-clarity4',
        input: {
          contractName: 'hello-4',
          codeBody: shortCode,
          clarityVersion: ClarityVersion.Clarity4,
          fee: 500n,
          nonce: 3n,
          network: 'mainnet',
          publicKey: PK1,
        },
      },
      {
        name: 'contract-deploy-mainnet-clarity5',
        input: {
          contractName: 'hello-5',
          codeBody: shortCode,
          clarityVersion: ClarityVersion.Clarity5,
          fee: 500n,
          nonce: 4n,
          network: 'mainnet',
          publicKey: PK1,
        },
      },
      {
        name: 'contract-deploy-mainnet-sponsored-allow-with-pc',
        input: {
          contractName: 'hello-pc',
          codeBody: shortCode,
          clarityVersion: ClarityVersion.Clarity4,
          fee: 500n,
          nonce: 5n,
          network: 'mainnet',
          publicKey: PK1,
          sponsored: true,
          postConditionMode: 'allow',
          postConditions: [
            {
              type: 'stx-postcondition',
              address: RECIP_MAIN,
              condition: 'lte',
              amount: 100n,
            },
          ],
        },
      },
      {
        name: 'contract-deploy-testnet-basic',
        input: {
          contractName: 'hello-test',
          codeBody: shortCode,
          fee: 500n,
          nonce: 0n,
          network: 'testnet',
          publicKey: PK1,
        },
      },
    ];

    await writeJsonl('contract-deploy.jsonl', cases, async input => {
      const tx = await makeUnsignedContractDeploy(input);
      return tx.serialize();
    });
  });

  it('writes contract-call.jsonl', async () => {
    const cases = [
      {
        name: 'contract-call-mainnet-basic',
        input: {
          contractAddress: CONTRACT_ADDR,
          contractName: 'hello',
          functionName: 'greet',
          functionArgs: [Cl.uint(1), Cl.stringAscii('hi')],
          fee: 300n,
          nonce: 0n,
          network: 'mainnet',
          publicKey: PK1,
        },
      },
      {
        name: 'contract-call-mainnet-sponsored',
        input: {
          contractAddress: CONTRACT_ADDR,
          contractName: 'hello',
          functionName: 'set',
          functionArgs: [Cl.int(-42)],
          fee: 300n,
          nonce: 1n,
          network: 'mainnet',
          publicKey: PK1,
          sponsored: true,
        },
      },
      {
        name: 'contract-call-mainnet-stx-ft-nft-postconditions',
        input: {
          contractAddress: CONTRACT_ADDR,
          contractName: 'hello',
          functionName: 'transfer',
          functionArgs: [Cl.uint(10)],
          fee: 400n,
          nonce: 2n,
          network: 'mainnet',
          publicKey: PK1,
          postConditions: [
            {
              type: 'stx-postcondition',
              address: RECIP_MAIN,
              condition: 'eq',
              amount: 1_000n,
            },
            {
              type: 'ft-postcondition',
              address: RECIP_MAIN,
              condition: 'lt',
              asset: `${CONTRACT_ADDR}.token::widget`,
              amount: 50n,
            },
            {
              type: 'nft-postcondition',
              address: RECIP_MAIN,
              condition: 'sent',
              asset: `${CONTRACT_ADDR}.nft::badge`,
              assetId: Cl.uint(7),
            },
          ],
        },
      },
      {
        name: 'contract-call-mainnet-mode-allow',
        input: {
          contractAddress: CONTRACT_ADDR,
          contractName: 'hello',
          functionName: 'noop',
          functionArgs: [],
          fee: 200n,
          nonce: 3n,
          network: 'mainnet',
          publicKey: PK1,
          postConditionMode: 'allow',
        },
      },
      {
        name: 'contract-call-mainnet-multisig-2of3',
        input: {
          contractAddress: CONTRACT_ADDR,
          contractName: 'hello',
          functionName: 'admin',
          functionArgs: [Cl.bool(true)],
          fee: 1_000n,
          nonce: 4n,
          network: 'mainnet',
          numSignatures: 2,
          publicKeys: [PK1, PK2, PK3],
          useNonSequentialMultiSig: true,
        },
      },
      {
        name: 'contract-call-testnet-basic',
        input: {
          contractAddress: CONTRACT_ADDR,
          contractName: 'hello',
          functionName: 'greet',
          functionArgs: [Cl.uint(999)],
          fee: 300n,
          nonce: 0n,
          network: 'testnet',
          publicKey: PK1,
        },
      },
    ];

    await writeJsonl('contract-call.jsonl', cases, async input => {
      const tx = await makeUnsignedContractCall(input);
      return tx.serialize();
    });
  });
});
