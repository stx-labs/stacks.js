import * as btc from '@scure/btc-signer';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@stacks/common';
import { getAddressFromPublicKey } from '@stacks/transactions';
import {
  buildLockScript,
  buildReclaim,
  buildUnlockScript,
  computeReclaimSighash,
  finalizeReclaim,
  signReclaim,
  type Utxo,
} from '../src';

// ── Fixtures ──────────────────────────────────────────────────────────────────
// Deterministic raw BTC keys (32-byte) for the staker and the early-unlock cosigner.
const STAKER_PRIV = hexToBytes('cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df');
const COSIGNER_PRIV = hexToBytes('5b8303150239eceaba43892af7cdd1fa7fc26eda5182ebaaa568e3341d54a4d0');
const STAKER_PUB = secp256k1.getPublicKey(STAKER_PRIV, true);
const COSIGNER_PUB = secp256k1.getPublicKey(COSIGNER_PRIV, true);

const NETWORK = 'testnet';
const STX_ADDRESS = getAddressFromPublicKey(STAKER_PUB, NETWORK);
const UNLOCK_HEIGHT = 850_123;

const LOCK_SCRIPT = buildLockScript({
  stxAddress: STX_ADDRESS,
  unlockHeight: UNLOCK_HEIGHT,
  unlockBytes: buildUnlockScript(STAKER_PUB),
  earlyUnlockBytes: buildUnlockScript(COSIGNER_PUB),
});

const UTXO: Utxo = { txid: 'a'.repeat(64), vout: 0, value: 30_000n };

describe('buildReclaim', () => {
  test('locktime: sets lockTime + sequence + P2WSH input', () => {
    const tx = buildReclaim({ path: 'locktime', utxo: UTXO, lockScript: LOCK_SCRIPT, network: NETWORK });
    expect(tx.lockTime).toBe(UNLOCK_HEIGHT);
    expect(tx.inputsLength).toBe(1);
    expect(bytesToHex(tx.getInput(0).witnessScript!)).toBe(bytesToHex(LOCK_SCRIPT));
  });

  test('rebuilding from pieces yields the same witnessScript as lockScript', () => {
    const tx = buildReclaim({
      path: 'early-exit',
      utxo: UTXO,
      network: NETWORK,
      stxAddress: STX_ADDRESS,
      unlockHeight: UNLOCK_HEIGHT,
      stakerBtcPublicKey: STAKER_PUB,
      earlyUnlockBytes: buildUnlockScript(COSIGNER_PUB),
    });
    expect(bytesToHex(tx.getInput(0).witnessScript!)).toBe(bytesToHex(LOCK_SCRIPT));
  });

  test('default toAddress is the staker P2WPKH; fee defaults applied', () => {
    const tx = buildReclaim({ path: 'early-exit', utxo: UTXO, lockScript: LOCK_SCRIPT, network: NETWORK });
    // single sweep output = value - default fee, paying the staker's P2WPKH scriptPubKey
    expect(tx.getOutput(0).amount).toBe(UTXO.value - 1_000n);
    expect(bytesToHex(tx.getOutput(0).script!)).toBe(bytesToHex(btc.p2wpkh(STAKER_PUB, btc.TEST_NETWORK).script));
  });

  test('rejects a fee >= the utxo value', () => {
    expect(() =>
      buildReclaim({ path: 'early-exit', utxo: UTXO, lockScript: LOCK_SCRIPT, network: NETWORK, output: { feeSats: 30_000n } })
    ).toThrow(/fee/);
  });

  test('throws when neither lockScript nor the full pieces are given', () => {
    expect(() => buildReclaim({ path: 'early-exit', utxo: UTXO, network: NETWORK, stxAddress: STX_ADDRESS })).toThrow(/lockScript/);
  });
});

describe('computeReclaimSighash', () => {
  test('matches preimageWitnessV0 over the lockScript + amount', () => {
    const tx = buildReclaim({ path: 'early-exit', utxo: UTXO, lockScript: LOCK_SCRIPT, network: NETWORK });
    expect(bytesToHex(computeReclaimSighash(tx))).toBe(
      bytesToHex(tx.preimageWitnessV0(0, LOCK_SCRIPT, 1, UTXO.value))
    );
  });
});

describe('signing variants are interchangeable', () => {
  // Variant A: our helper (detached sig) attached as a partialSig.
  // Variant B: native btc-signer signIdx. Matched low-R (both default false).

  test('locktime: helper-signed and native-signed finalize byte-identically', () => {
    const a = buildReclaim({ path: 'locktime', utxo: UTXO, lockScript: LOCK_SCRIPT, network: NETWORK });
    a.updateInput(0, { partialSig: [[STAKER_PUB, signReclaim(computeReclaimSighash(a), STAKER_PRIV)]] }, true);

    const b = buildReclaim({ path: 'locktime', utxo: UTXO, lockScript: LOCK_SCRIPT, network: NETWORK });
    b.signIdx(STAKER_PRIV, 0);

    const ra = finalizeReclaim({ path: 'locktime', tx: a });
    const rb = finalizeReclaim({ path: 'locktime', tx: b });
    expect(ra.txHex).toBe(rb.txHex);
    expect(ra.txid).toBe(rb.txid);

    // witness: [ stakerSig, 0x01, witnessScript ]
    expect(a.getInput(0).finalScriptWitness).toHaveLength(3);
    expect(a.isFinal).toBe(true);
  });

  test('early-exit: helper-signed and native-signed finalize byte-identically', () => {
    const a = buildReclaim({ path: 'early-exit', utxo: UTXO, lockScript: LOCK_SCRIPT, network: NETWORK });
    a.updateInput(0, { partialSig: [[STAKER_PUB, signReclaim(computeReclaimSighash(a), STAKER_PRIV)]] }, true);
    a.updateInput(0, { partialSig: [[COSIGNER_PUB, signReclaim(computeReclaimSighash(a), COSIGNER_PRIV)]] }, true);

    const b = buildReclaim({ path: 'early-exit', utxo: UTXO, lockScript: LOCK_SCRIPT, network: NETWORK });
    b.signIdx(STAKER_PRIV, 0);
    b.signIdx(COSIGNER_PRIV, 0);

    const ra = finalizeReclaim({ path: 'early-exit', tx: a, stxAddress: STX_ADDRESS });
    const rb = finalizeReclaim({ path: 'early-exit', tx: b, stxAddress: STX_ADDRESS });
    expect(ra.txHex).toBe(rb.txHex);

    // witness: [ stakerSig, cosignerSig, preimage, <empty>, witnessScript ]
    expect(a.getInput(0).finalScriptWitness).toHaveLength(5);
    expect(a.isFinal).toBe(true);
  });

  test('early-exit interoperates: staker via helper, cosigner via signIdx (mixed)', () => {
    const tx = buildReclaim({ path: 'early-exit', utxo: UTXO, lockScript: LOCK_SCRIPT, network: NETWORK });
    tx.updateInput(0, { partialSig: [[STAKER_PUB, signReclaim(computeReclaimSighash(tx), STAKER_PRIV)]] }, true);
    tx.signIdx(COSIGNER_PRIV, 0);
    const { txHex } = finalizeReclaim({ path: 'early-exit', tx, stxAddress: STX_ADDRESS });
    expect(txHex).toMatch(/^[0-9a-f]+$/);
    expect(tx.isFinal).toBe(true);
  });
});

describe('finalizeReclaim guards', () => {
  test('early-exit fails without the cosigner signature', () => {
    const tx = buildReclaim({ path: 'early-exit', utxo: UTXO, lockScript: LOCK_SCRIPT, network: NETWORK });
    tx.signIdx(STAKER_PRIV, 0); // staker only
    expect(() => finalizeReclaim({ path: 'early-exit', tx, stxAddress: STX_ADDRESS })).toThrow(/cosigner/);
  });

  test('fails without any signature', () => {
    const tx = buildReclaim({ path: 'locktime', utxo: UTXO, lockScript: LOCK_SCRIPT, network: NETWORK });
    expect(() => finalizeReclaim({ path: 'locktime', tx })).toThrow(/staker/);
  });
});

describe('PSBT hand-off round-trip', () => {
  test('staker sig survives toPSBT/fromPSBT; cosigner completes it', () => {
    const staker = buildReclaim({ path: 'early-exit', utxo: UTXO, lockScript: LOCK_SCRIPT, network: NETWORK });
    staker.signIdx(STAKER_PRIV, 0);

    // Hand off as PSBT; cosigner imports (staker sig rides inside), adds theirs.
    const cosigner = btc.Transaction.fromPSBT(staker.toPSBT(), { allowUnknownOutputs: true, disableScriptCheck: true, allowUnknownInputs: true });
    expect(cosigner.getInput(0).partialSig).toHaveLength(1);
    cosigner.signIdx(COSIGNER_PRIV, 0);
    expect(cosigner.getInput(0).partialSig).toHaveLength(2);

    const { txHex } = finalizeReclaim({ path: 'early-exit', tx: cosigner, stxAddress: STX_ADDRESS });
    expect(txHex).toMatch(/^[0-9a-f]+$/);
  });
});
