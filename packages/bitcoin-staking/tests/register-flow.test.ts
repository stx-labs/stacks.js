/**
 * Validates the combined register-for-bond flow helper `buildRegisterMetadata`
 * computes byte-for-byte the same artifacts as the hand-wired sequence it
 * replaces (computeBondUnlockHeight → buildUnlockScript → buildLockScript →
 * buildLockAddress / buildLockOutputScript), and that the `lockScript`
 * overload on `buildLockProof` / `buildLockProofFromBlock` is equivalent to
 * passing `outputScript` directly.
 *
 * Pure — no network. The proof path is exercised against a synthetic
 * single-output, single-tx block built in-memory.
 */
import * as btc from '@scure/btc-signer';
import { bytesToHex, hexToBytes } from '@stacks/common';
import {
  buildLockAddress,
  buildLockOutputScript,
  buildLockProof,
  buildLockProofFromBlock,
  buildLockScript,
  buildRegisterMetadata,
  buildUnlockScript,
  computeBitcoinTxid,
  computeBondUnlockHeight,
  type EsploraMerkleProof,
} from '../src';
import type { PoxInfo } from '../src/types';

const TEST_PUBKEY_HEX = '0316e35d38b52d4886e40065e4952a49535ce914e02294be58e252d1998f129b19';
const TEST_STX_ADDRESS = 'ST000000000000000000002AMW42H';
// A pre-pushed, self-contained `<pubkey> OP_CHECKSIG` early-unlock subscript.
const TEST_EARLY_UNLOCK = btc.Script.encode([new Uint8Array(33).fill(0x02), 'CHECKSIG']);

const POX_INFO: PoxInfo = {
  contractId: 'SP000000000000000000002Q6VF78.pox-5',
  currentBurnchainBlockHeight: 700_000,
  firstBurnchainBlockHeight: 666_050,
  rewardCycleId: 10,
  rewardCycleLength: 2100,
  prepareCycleLength: 100,
  rewardSlots: 4000,
  currentCycle: { id: 10, stakedUstx: 0n, isPoxActive: true },
  nextCycle: { id: 11, stakedUstx: 0n, isPoxActive: true },
  contractVersions: [
    {
      contractId: 'SP000000000000000000002Q6VF78.pox-5',
      activationBurnchainBlockHeight: 666_050,
      firstRewardCycleId: 50,
    },
  ],
};

const BOND_INDEX = 0;
const NETWORK = 'devnet' as const;

const INPUT = {
  bondIndex: BOND_INDEX,
  poxInfo: POX_INFO,
  bitcoinPublicKey: TEST_PUBKEY_HEX,
  stxAddress: TEST_STX_ADDRESS,
  earlyUnlockBytes: TEST_EARLY_UNLOCK,
  network: NETWORK,
};

describe('buildRegisterMetadata', () => {
  const meta = buildRegisterMetadata(INPUT);

  // The hand-wired "BEFORE" sequence this helper replaces.
  const unlockHeight = computeBondUnlockHeight({ bondIndex: BOND_INDEX, poxInfo: POX_INFO });
  const unlockBytes = buildUnlockScript(TEST_PUBKEY_HEX);
  const lockupArgs = {
    stxAddress: TEST_STX_ADDRESS,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes: TEST_EARLY_UNLOCK,
  };

  it('derives the same unlock height as computeBondUnlockHeight', () => {
    expect(meta.unlockHeight).toBe(unlockHeight);
  });

  it('derives the same unlock tail as buildUnlockScript', () => {
    expect(bytesToHex(meta.unlockBytes)).toBe(bytesToHex(unlockBytes));
  });

  it('derives the same lock script as buildLockScript', () => {
    expect(bytesToHex(meta.lockScript)).toBe(bytesToHex(buildLockScript(lockupArgs)));
  });

  it('derives the same output script as buildLockOutputScript', () => {
    expect(bytesToHex(meta.outputScript)).toBe(bytesToHex(buildLockOutputScript(lockupArgs)));
  });

  it('derives the same fund address as buildLockAddress', () => {
    expect(meta.lockAddress).toBe(buildLockAddress({ ...lockupArgs, network: NETWORK }));
  });

  it('accepts a public key as bytes or hex identically', () => {
    const fromBytes = buildRegisterMetadata({
      ...INPUT,
      bitcoinPublicKey: hexToBytes(TEST_PUBKEY_HEX),
    });
    expect(bytesToHex(fromBytes.lockScript)).toBe(bytesToHex(meta.lockScript));
    expect(fromBytes.lockAddress).toBe(meta.lockAddress);
  });
});

describe('lockScript / outputScript overload', () => {
  const meta = buildRegisterMetadata(INPUT);

  // Synthetic single-tx block whose one output funds the lockup address.
  const tx = new btc.Transaction({ allowUnknownOutputs: true, disableScriptCheck: true });
  tx.addInput({ txid: new Uint8Array(32), index: 0xffffffff });
  tx.addOutput({ script: meta.outputScript, amount: 100_000n });
  const txHex = tx.hex;
  const txid = bytesToHex(computeBitcoinTxid(tx.toBytes(true, false)));

  const block = {
    txHex,
    header: new Uint8Array(80), // length-checked only; hash is not verified here
    blockHeight: 800_000,
    txids: [txid],
    unlockHeight: meta.unlockHeight,
  };
  const merkleProof: EsploraMerkleProof = { block_height: 800_000, merkle: [], pos: 0 };
  const outputScript = buildLockOutputScript({
    stxAddress: TEST_STX_ADDRESS,
    unlockHeight: meta.unlockHeight,
    unlockBytes: meta.unlockBytes,
    earlyUnlockBytes: TEST_EARLY_UNLOCK,
  });

  it('buildLockProofFromBlock: lockScript and outputScript yield identical output', () => {
    const viaLockScript = buildLockProofFromBlock({ ...block, lockScript: meta.lockScript });
    const viaExpected = buildLockProofFromBlock({ ...block, outputScript });
    expect(viaLockScript).toEqual(viaExpected);
    expect(viaLockScript.outputIndex).toBe(0);
    expect(viaLockScript.amount).toBe(100_000n);
  });

  it('buildLockProof: lockScript and outputScript yield identical output', () => {
    const base = { txHex, header: block.header, merkleProof, txCount: 1, unlockHeight: meta.unlockHeight };
    const viaLockScript = buildLockProof({ ...base, lockScript: meta.lockScript });
    const viaExpected = buildLockProof({ ...base, outputScript });
    expect(viaLockScript).toEqual(viaExpected);
    expect(viaLockScript.outputIndex).toBe(0);
  });

  it('uses meta.lockScript (the documented call shape)', () => {
    const output = buildLockProofFromBlock({ ...block, lockScript: meta.lockScript });
    expect(output.outputIndex).toBe(0);
    expect(output.amount).toBe(100_000n);
  });

  it('accepts lockScript as a hex string', () => {
    const output = buildLockProofFromBlock({ ...block, lockScript: bytesToHex(meta.lockScript) });
    expect(output.outputIndex).toBe(0);
  });

  it('throws when neither outputScript nor lockScript is provided', () => {
    // @ts-expect-error — exactly one of outputScript / lockScript is required
    expect(() => buildLockProofFromBlock({ ...block })).toThrow(/outputScript.*lockScript/);
  });
});
