// These tests assert witness STRUCTURE (item counts, isFinal, cross-variant
// byte equality) plus a frozen golden finalized-tx hex per branch (see
// GOLDEN_*_TXHEX) — RFC6979-deterministic, so any reorder/splice of the witness
// stack flips the bytes and fails offline.
//
// On-chain EXECUTION of both branches against Bitcoin consensus is covered live
// by the privatenet L1 e2e: exit-l1-timelock-reclaim (IF/CLTV branch) and
// exit-l1-announce-and-reclaim (ELSE/early-exit branch) broadcast real spends
// that bitcoind accepts. The embedded witnessScript equals the on-chain
// construct-lockup-script (privatenet/actions/golden-vectors.test.ts).
//
// TODO(coverage): a dedicated regtest suite could additionally record the
// NEGATIVE cases against bitcoind — CLTV-immature (non-final), wrong preimage,
// swapped staker/cosigner sigs — which the e2e happy-paths don't exercise.
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

// Deterministic raw BTC keys (32-byte) for the staker and the early-exit cosigner.
const STAKER_PRIV = hexToBytes('cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df');
const COSIGNER_PRIV = hexToBytes(
  '5b8303150239eceaba43892af7cdd1fa7fc26eda5182ebaaa568e3341d54a4d0'
);
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
const OUTPUT = { address: btc.p2wpkh(STAKER_PUB, btc.TEST_NETWORK).address!, feeSats: 1_000n };

// Frozen golden finalized-tx hex for each reclaim branch (ECDSA is RFC6979
// deterministic, so these are stable). Any reorder/splice of the witness stack
// — stakerSig / cosignerSig / preimage / branch selector / witnessScript — or a
// different sighash flips these bytes. On-chain EXECUTION of both branches is
// covered by the privatenet L1 e2e (exit-l1-timelock-reclaim = IF/CLTV branch,
// exit-l1-announce-and-reclaim = ELSE/early-exit branch), whose real spends
// bitcoind accepts; this pins the exact bytes those spends carry.
const GOLDEN_LOCKTIME_TXHEX =
  '02000000000101aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000000feffffff014871000000000000160014164247d6f2b425ac5771423ae6c80c754f7172b003483045022100fef6465ee021db8cd2a9686740601d0a057f951027b1faa6b701b53ccc47902e0220179a5c54b34e5b06f275a0035b24daf366f8e827f508542b3752ccc55c6c674a010101766303cbf80cb16782012088a82041dfc564373f06b57e724a29efeb4d19e7cf9a1f0a04a308908074b0deb8c8e98821022bb4b050afd84f0a7eedd02d4ea6ebe426bbb02744dfcca0b789a643eff6e78cac68692103797dd653040d344fd048c1ad05d4cbcb2178b30c6a0c4276994795f3e833da41accbf80c00';
const GOLDEN_EARLYEXIT_TXHEX =
  '02000000000101aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000000ffffffff014871000000000000160014164247d6f2b425ac5771423ae6c80c754f7172b005483045022100bb5a00c9674e1119b49ed6c2540d0aabbe7da52665fa048c19bac17f97fbf8ec02207ef6bb17677467692d17e343b876802f5dea45635b7f4d15b9a4d9b8b342fad20147304402205121bbe7f241193a26c0dcfb82b70a3bd75673e333697230a478dda9921d6b4b022043eaa31d4f100d2d3070dcbb03189c3ee65d8ddf4778e372f512a099356eec900120aefd42d50dea2c02669802e0a460592b6437c1ba832c0bfb76183effdb60949e00766303cbf80cb16782012088a82041dfc564373f06b57e724a29efeb4d19e7cf9a1f0a04a308908074b0deb8c8e98821022bb4b050afd84f0a7eedd02d4ea6ebe426bbb02744dfcca0b789a643eff6e78cac68692103797dd653040d344fd048c1ad05d4cbcb2178b30c6a0c4276994795f3e833da41ac00000000';

describe('buildReclaim', () => {
  it('locktime: sets lockTime + sequence + P2WSH input', () => {
    const tx = buildReclaim({
      path: 'locktime',
      utxo: UTXO,
      lockScript: LOCK_SCRIPT,
      network: NETWORK,
      output: OUTPUT,
    });
    expect(tx.lockTime).toBe(UNLOCK_HEIGHT);
    expect(tx.inputsLength).toBe(1);
    expect(bytesToHex(tx.getInput(0).witnessScript!)).toBe(bytesToHex(LOCK_SCRIPT));
  });

  it('documented rebuild snippet yields the same witnessScript as the stored lockScript', () => {
    const rebuilt = buildLockScript({
      stxAddress: STX_ADDRESS,
      unlockHeight: UNLOCK_HEIGHT,
      unlockBytes: buildUnlockScript(STAKER_PUB),
      earlyUnlockBytes: buildUnlockScript(COSIGNER_PUB),
    });
    const tx = buildReclaim({
      path: 'early-exit',
      utxo: UTXO,
      network: NETWORK,
      output: OUTPUT,
      lockScript: rebuilt,
    });
    expect(bytesToHex(tx.getInput(0).witnessScript!)).toBe(bytesToHex(LOCK_SCRIPT));
  });

  it('builds the sweep output from opts.output', () => {
    const tx = buildReclaim({
      path: 'early-exit',
      utxo: UTXO,
      lockScript: LOCK_SCRIPT,
      network: NETWORK,
      output: OUTPUT,
    });
    // single sweep output = value - fee, paying the requested scriptPubKey
    expect(tx.getOutput(0).amount).toBe(UTXO.value - OUTPUT.feeSats);
    expect(bytesToHex(tx.getOutput(0).script!)).toBe(
      bytesToHex(btc.p2wpkh(STAKER_PUB, btc.TEST_NETWORK).script)
    );
  });

  it('rejects a sweep below the dust limit', () => {
    expect(() =>
      buildReclaim({
        path: 'early-exit',
        utxo: UTXO,
        lockScript: LOCK_SCRIPT,
        network: NETWORK,
        output: { ...OUTPUT, feeSats: UTXO.value - 100n },
      })
    ).toThrow(/dust/);
  });

  it('rejects a fee >= the utxo value', () => {
    expect(() =>
      buildReclaim({
        path: 'early-exit',
        utxo: UTXO,
        lockScript: LOCK_SCRIPT,
        network: NETWORK,
        output: { ...OUTPUT, feeSats: 30_000n },
      })
    ).toThrow(/fee/);
  });

  it('locktime: throws when the lockScript encodes no CLTV height', () => {
    const noCltv = btc.Script.encode([COSIGNER_PUB, STAKER_PUB, 'CHECKMULTISIG']);
    expect(() =>
      buildReclaim({
        path: 'locktime',
        utxo: UTXO,
        lockScript: noCltv,
        network: NETWORK,
        output: OUTPUT,
      })
    ).toThrow(/CLTV/);
  });
});

describe('computeReclaimSighash', () => {
  it('matches preimageWitnessV0 over the lockScript + amount', () => {
    const tx = buildReclaim({
      path: 'early-exit',
      utxo: UTXO,
      lockScript: LOCK_SCRIPT,
      network: NETWORK,
      output: OUTPUT,
    });
    expect(bytesToHex(computeReclaimSighash(tx))).toBe(
      bytesToHex(tx.preimageWitnessV0(0, LOCK_SCRIPT, 1, UTXO.value))
    );
  });
});

describe('signing variants are interchangeable', () => {
  // Variant A: our helper (detached sig) attached as a partialSig.
  // Variant B: native btc-signer signIdx. Matched low-R (both default false).

  it('locktime: helper-signed and native-signed finalize byte-identically', () => {
    const a = buildReclaim({
      path: 'locktime',
      utxo: UTXO,
      lockScript: LOCK_SCRIPT,
      network: NETWORK,
      output: OUTPUT,
    });
    a.updateInput(
      0,
      { partialSig: [[STAKER_PUB, signReclaim(computeReclaimSighash(a), STAKER_PRIV)]] },
      true
    );

    const b = buildReclaim({
      path: 'locktime',
      utxo: UTXO,
      lockScript: LOCK_SCRIPT,
      network: NETWORK,
      output: OUTPUT,
    });
    b.signIdx(STAKER_PRIV, 0);

    const ra = finalizeReclaim({ path: 'locktime', tx: a });
    const rb = finalizeReclaim({ path: 'locktime', tx: b });
    expect(ra.txHex).toBe(rb.txHex);
    expect(ra.txid).toBe(rb.txid);
    expect(ra.txHex).toBe(GOLDEN_LOCKTIME_TXHEX); // golden: exact witness bytes

    // witness: [ stakerSig, 0x01, witnessScript ]
    expect(a.getInput(0).finalScriptWitness).toHaveLength(3);
    expect(a.isFinal).toBe(true);
  });

  it('early-exit: helper-signed and native-signed finalize byte-identically', () => {
    const a = buildReclaim({
      path: 'early-exit',
      utxo: UTXO,
      lockScript: LOCK_SCRIPT,
      network: NETWORK,
      output: OUTPUT,
    });
    a.updateInput(
      0,
      { partialSig: [[STAKER_PUB, signReclaim(computeReclaimSighash(a), STAKER_PRIV)]] },
      true
    );
    a.updateInput(
      0,
      { partialSig: [[COSIGNER_PUB, signReclaim(computeReclaimSighash(a), COSIGNER_PRIV)]] },
      true
    );

    const b = buildReclaim({
      path: 'early-exit',
      utxo: UTXO,
      lockScript: LOCK_SCRIPT,
      network: NETWORK,
      output: OUTPUT,
    });
    b.signIdx(STAKER_PRIV, 0);
    b.signIdx(COSIGNER_PRIV, 0);

    const ra = finalizeReclaim({ path: 'early-exit', tx: a, stxAddress: STX_ADDRESS });
    const rb = finalizeReclaim({ path: 'early-exit', tx: b, stxAddress: STX_ADDRESS });
    expect(ra.txHex).toBe(rb.txHex);
    expect(ra.txHex).toBe(GOLDEN_EARLYEXIT_TXHEX); // golden: exact witness bytes

    // witness: [ stakerSig, cosignerSig, preimage, <empty>, witnessScript ]
    expect(a.getInput(0).finalScriptWitness).toHaveLength(5);
    expect(a.isFinal).toBe(true);
  });

  it('early-exit interoperates: staker via helper, cosigner via signIdx (mixed)', () => {
    const tx = buildReclaim({
      path: 'early-exit',
      utxo: UTXO,
      lockScript: LOCK_SCRIPT,
      network: NETWORK,
      output: OUTPUT,
    });
    tx.updateInput(
      0,
      { partialSig: [[STAKER_PUB, signReclaim(computeReclaimSighash(tx), STAKER_PRIV)]] },
      true
    );
    tx.signIdx(COSIGNER_PRIV, 0);
    const { txHex } = finalizeReclaim({ path: 'early-exit', tx, stxAddress: STX_ADDRESS });
    expect(txHex).toMatch(/^[0-9a-f]+$/);
    expect(tx.isFinal).toBe(true);
  });
});

describe('finalizeReclaim guards', () => {
  it('early-exit fails without the cosigner signature', () => {
    const tx = buildReclaim({
      path: 'early-exit',
      utxo: UTXO,
      lockScript: LOCK_SCRIPT,
      network: NETWORK,
      output: OUTPUT,
    });
    tx.signIdx(STAKER_PRIV, 0); // staker only
    expect(() => finalizeReclaim({ path: 'early-exit', tx, stxAddress: STX_ADDRESS })).toThrow(
      /cosigner/
    );
  });

  it('fails without any signature', () => {
    const tx = buildReclaim({
      path: 'locktime',
      utxo: UTXO,
      lockScript: LOCK_SCRIPT,
      network: NETWORK,
      output: OUTPUT,
    });
    expect(() => finalizeReclaim({ path: 'locktime', tx })).toThrow(/staker/);
  });
});

describe('PSBT hand-off round-trip', () => {
  it('staker sig survives toPSBT/fromPSBT; cosigner completes it', () => {
    const staker = buildReclaim({
      path: 'early-exit',
      utxo: UTXO,
      lockScript: LOCK_SCRIPT,
      network: NETWORK,
      output: OUTPUT,
    });
    staker.signIdx(STAKER_PRIV, 0);

    // Hand off as PSBT; cosigner imports (staker sig rides inside), adds theirs.
    const cosigner = btc.Transaction.fromPSBT(staker.toPSBT(), {
      allowUnknownOutputs: true,
      disableScriptCheck: true,
      allowUnknownInputs: true,
    });
    expect(cosigner.getInput(0).partialSig).toHaveLength(1);
    cosigner.signIdx(COSIGNER_PRIV, 0);
    expect(cosigner.getInput(0).partialSig).toHaveLength(2);

    const { txHex } = finalizeReclaim({
      path: 'early-exit',
      tx: cosigner,
      stxAddress: STX_ADDRESS,
    });
    expect(txHex).toMatch(/^[0-9a-f]+$/);
  });
});
