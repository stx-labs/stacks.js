/**
 * Shared "partial early-exit transaction" artifact + assembly helpers for the
 * L1 BTC early-exit P2WSH ELSE-branch reclaim.
 *
 * The ELSE-branch reclaim is a 2-of-2 co-sign: the STAKER holds their own BTC
 * key, and the COSIGNER (account6, whose pubkey is committed in the bond's
 * earlyUnlockBytes) holds the other. Neither party shares a key — instead they
 * exchange this PARTIAL artifact plus their own signature over the SAME BIP143
 * sighash. Once BOTH signatures are present, either side can assemble the final
 * witness and broadcast.
 *
 * Witness (bottom→top), modeled EXACTLY on btc-lockup-roundtrip TEST 1 / the
 * exit-l1-announce-and-reclaim e2e test:
 *   [ stakerSig, cosignerSig, stakerPreimage, <empty→ELSE>, witnessScript ]
 *
 * Both sigs are ECDSA over `tx.preimageWitnessV0(0, witnessScript, SIGHASH_ALL,
 * amount)` with a trailing SIGHASH_ALL byte. For P2WSH the scriptCode IS the
 * witnessScript. `stakerPreimage = computeRegisterPreimage(stakerStxAddress)`.
 */

// @ts-ignore — @scure/btc-signer is ESM; ts-jest transforms it via jest.config.js
import * as btc from '@scure/btc-signer';
import { bytesToHex, hexToBytes } from '@stacks/common';
import { computeRegisterPreimage } from '../../src';
import { REGTEST } from './btc-wallet';

const SIGHASH_ALL = 1;

/**
 * A serializable partial early-exit reclaim transaction. All byte fields are
 * lowercase hex. `stakerSig` / `cosignerSig` are optional: whichever party
 * prepared the artifact fills in their own, leaving the other UNSET for the
 * counterparty to complete.
 */
export interface EarlyExitPartial {
  /** Optional convenience: the unsigned reclaim tx (segwit-less) hex. */
  reclaimTxUnsignedHex?: string;
  /** The P2WSH witnessScript (canonical buildLockScript output) hex. */
  witnessScriptHex: string;
  /** Amount locked in the P2WSH UTXO being spent, in sats (decimal string). */
  amountSats: string;
  /** The lockup UTXO being reclaimed. */
  lockupTxid: string;
  lockupVout: number;
  /** Staker STX address (consensus-buff committed in the witnessScript). */
  stakerStxAddress: string;
  /** Staker's compressed BTC pubkey hex (33 bytes). */
  stakerBtcPubHex: string;
  /** Cosigner (account6) compressed BTC pubkey hex (33 bytes). */
  cosignerBtcPubHex: string;
  /** 32-byte staker preimage = computeRegisterPreimage(stakerStxAddress), hex. */
  preimageHex: string;
  /** The BIP143 sighash both parties sign, hex. */
  sighashHex: string;
  /** Staker's signature over sighash (DER + SIGHASH_ALL byte), hex — optional. */
  stakerSig?: string;
  /** Cosigner's signature over sighash (DER + SIGHASH_ALL byte), hex — optional. */
  cosignerSig?: string;
}

/**
 * Rebuild the unsigned ELSE-branch reclaim tx from a partial and derive its
 * BIP143 sighash (lowercase hex). The tx layout is fixed: one P2WSH input
 * (sequence 0xffffffff → ELSE, no CLTV), one P2WPKH output already encoded in
 * `reclaimTxUnsignedHex`. The sighash MUST match `partial.sighashHex`.
 */
export function computeSighash(partial: EarlyExitPartial): string {
  const witnessScript = hexToBytes(partial.witnessScriptHex);
  const amount = BigInt(partial.amountSats);
  const p2wshScript = btc.p2wsh({ type: 'wsh', script: witnessScript }, REGTEST).script;

  const tx = rebuildTx(partial, p2wshScript, witnessScript, amount);
  const sighash = tx.preimageWitnessV0(0, witnessScript, SIGHASH_ALL, amount);
  return bytesToHex(sighash);
}

/**
 * Once BOTH signatures are present, assemble the ELSE-branch witness
 * `[stakerSig, cosignerSig, preimage, <empty>, witnessScript]`, inject it via
 * updateInput finalScriptWitness, and return the final (broadcastable) tx hex.
 * Throws if either signature is missing.
 */
export function assembleAndFinalize(partial: EarlyExitPartial): string {
  if (!partial.stakerSig) throw new Error('assembleAndFinalize: stakerSig missing');
  if (!partial.cosignerSig) throw new Error('assembleAndFinalize: cosignerSig missing');

  const witnessScript = hexToBytes(partial.witnessScriptHex);
  const amount = BigInt(partial.amountSats);
  const p2wshScript = btc.p2wsh({ type: 'wsh', script: witnessScript }, REGTEST).script;

  const tx = rebuildTx(partial, p2wshScript, witnessScript, amount);

  // Sanity: the rebuilt sighash must match the one both parties signed.
  const sighash = bytesToHex(tx.preimageWitnessV0(0, witnessScript, SIGHASH_ALL, amount));
  if (sighash !== partial.sighashHex.toLowerCase()) {
    throw new Error(
      `assembleAndFinalize: rebuilt sighash ${sighash} != partial.sighashHex ${partial.sighashHex}`,
    );
  }

  const witnessItems = [
    hexToBytes(partial.stakerSig),
    hexToBytes(partial.cosignerSig),
    hexToBytes(partial.preimageHex),
    new Uint8Array(0), // empty → OP_IF falsy → ELSE branch
    witnessScript,
  ];
  tx.updateInput(0, { finalScriptWitness: witnessItems }, true);
  if (!tx.isFinal) throw new Error('assembleAndFinalize: witness injection failed (tx not final)');
  return tx.hex;
}

/**
 * Reconstruct the unsigned reclaim tx from the partial. Prefers the recorded
 * `reclaimTxUnsignedHex` (so both parties operate on byte-identical txs); the
 * input's witnessUtxo is re-attached so preimageWitnessV0 / finalization works.
 */
function rebuildTx(
  partial: EarlyExitPartial,
  p2wshScript: Uint8Array,
  _witnessScript: Uint8Array,
  amount: bigint,
): btc.Transaction {
  if (partial.reclaimTxUnsignedHex) {
    const tx = btc.Transaction.fromRaw(hexToBytes(partial.reclaimTxUnsignedHex), {
      allowUnknownOutputs: true,
      disableScriptCheck: true,
      allowUnknownInputs: true,
    });
    // Re-attach the witnessUtxo dropped by serialization so signing/finalize work.
    tx.updateInput(0, { witnessUtxo: { script: p2wshScript, amount } }, true);
    return tx;
  }
  throw new Error('rebuildTx: reclaimTxUnsignedHex required to reconstruct the tx');
}

/**
 * Build the canonical, unsigned ELSE-branch reclaim tx (one P2WSH input,
 * sequence 0xffffffff, one P2WPKH output) and return both the tx object and a
 * fully-populated partial (sighash + preimage set; signatures left UNSET).
 *
 * Callers then sign with whichever key(s) they hold and set stakerSig/cosignerSig.
 */
export function buildReclaimPartial(opts: {
  witnessScript: Uint8Array;
  lockupTxid: string;
  lockupVout: number;
  amountSats: bigint;
  feeSats: bigint;
  stakerStxAddress: string;
  stakerBtcPub: Uint8Array;
  cosignerBtcPub: Uint8Array;
}): { tx: btc.Transaction; partial: EarlyExitPartial } {
  const p2wshScript = btc.p2wsh({ type: 'wsh', script: opts.witnessScript }, REGTEST).script;
  const reclaimSats = opts.amountSats - opts.feeSats;
  if (reclaimSats <= 0n) {
    throw new Error(`buildReclaimPartial: fee ${opts.feeSats} >= amount ${opts.amountSats}`);
  }
  const toAddress = btc.p2wpkh(opts.stakerBtcPub, REGTEST).address!;

  const tx = new btc.Transaction({
    allowUnknownOutputs: true,
    disableScriptCheck: true,
    allowUnknownInputs: true,
  });
  tx.addInput({
    txid: opts.lockupTxid,
    index: opts.lockupVout,
    sequence: 0xffffffff, // ELSE branch — no CLTV
    witnessUtxo: { script: p2wshScript, amount: opts.amountSats },
  });
  tx.addOutputAddress(toAddress, reclaimSats, REGTEST);

  const sighash = tx.preimageWitnessV0(0, opts.witnessScript, SIGHASH_ALL, opts.amountSats);
  const preimage = computeRegisterPreimage(opts.stakerStxAddress);

  const partial: EarlyExitPartial = {
    reclaimTxUnsignedHex: tx.hex, // unsigned: no witness yet
    witnessScriptHex: bytesToHex(opts.witnessScript),
    amountSats: opts.amountSats.toString(),
    lockupTxid: opts.lockupTxid,
    lockupVout: opts.lockupVout,
    stakerStxAddress: opts.stakerStxAddress,
    stakerBtcPubHex: bytesToHex(opts.stakerBtcPub),
    cosignerBtcPubHex: bytesToHex(opts.cosignerBtcPub),
    preimageHex: bytesToHex(preimage),
    sighashHex: bytesToHex(sighash),
  };
  return { tx, partial };
}
