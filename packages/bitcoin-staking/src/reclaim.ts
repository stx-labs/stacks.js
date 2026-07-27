import * as btc from '@scure/btc-signer';
// `signECDSA` is only exported from the `utils` subpath, not the package root.
import { signECDSA } from '@scure/btc-signer/utils.js';
import { concatBytes, equals, hexToBytes, privateKeyToBytes } from '@stacks/common';
import type { PrivateKey } from '@stacks/common';
import type { StacksNetwork, StacksNetworkName } from '@stacks/network';
import { btcNetworkFrom, computeRegisterPreimage, scriptToWshOutput } from './script';
import type { Utxo } from './types';

/**
 * Spend a P2WSH bond lockup back out.
 *
 * Two paths through the lockup script (mirror of `pox-5.construct-lockup-script`):
 * - `'locktime'`   — the normal CLTV exit (`OP_IF` branch), single-sig (staker),
 *   spendable once burn height >= the lock's unlock height.
 * - `'early-exit'` — the cosigned early exit (`OP_ELSE` branch), a 2-of-2 between
 *   the staker and the bond's early-exit cosigner.
 */
export type ReclaimPath = 'locktime' | 'early-exit';

const SIGHASH_ALL = 1;
/** Conservative dust limit (the 546-sat P2PKH bound covers all output types). */
const DUST_LIMIT_SATS = 546n;
/** Empty witness item — selects the `OP_ELSE` (early-exit) branch. */
const ELSE_SELECTOR = new Uint8Array(0);
/** Truthy witness item — selects the `OP_IF` (CLTV) branch. */
const IF_SELECTOR = new Uint8Array([0x01]);
/** The reclaim tx is a custom-script spend; let btc-signer carry it unvalidated. */
const TX_OPTS = {
  allowUnknownOutputs: true,
  disableScriptCheck: true,
  allowUnknownInputs: true,
} as const;

/** @internal Accept a buffer as raw bytes or hex (the package's inline convention). */
function toBytes(value: Uint8Array | string): Uint8Array {
  return typeof value === 'string' ? hexToBytes(value) : value;
}

/**
 * @internal Decode a lockup `witnessScript` back into the values a reclaim needs:
 * the staker / cosigner public keys (the script's two 33-byte pushes, in
 * `[cosigner, staker]` order — cosigner from the `OP_ELSE` subscript, staker from
 * the trailing `OP_CHECKSIG` tail) and the CLTV `unlockHeight`.
 */
function decodeLockScript(script: Uint8Array): {
  stakerPub: Uint8Array;
  cosignerPub: Uint8Array;
  unlockHeight?: number;
} {
  const decoded = btc.Script.decode(script);
  const pushes33 = decoded.filter(
    (op): op is Uint8Array => op instanceof Uint8Array && op.length === 33
  );
  if (pushes33.length < 2) {
    throw new Error(
      'reclaim: lockScript does not contain the expected staker + cosigner public keys'
    );
  }
  const cltvIdx = decoded.indexOf('CHECKLOCKTIMEVERIFY');
  const heightOp = cltvIdx > 0 ? decoded[cltvIdx - 1] : undefined;
  const unlockHeight =
    typeof heightOp === 'number'
      ? heightOp
      : heightOp instanceof Uint8Array
        ? Number(btc.ScriptNum().decode(heightOp))
        : undefined;

  return {
    cosignerPub: pushes33[0],
    stakerPub: pushes33[pushes33.length - 1],
    unlockHeight,
  };
}

/** Inputs to {@link buildReclaim}. */
export interface BuildReclaimOpts {
  /** Which spend path / witness shape to build. */
  path: ReclaimPath;
  /** The lockup UTXO to spend (esplora / mempool-shaped). */
  utxo: Utxo;
  network: StacksNetworkName | StacksNetwork;
  /**
   * The sweep output: where the reclaimed funds go and the fee to leave for
   * miners (`value - feeSats` is swept to `address`). The caller may still
   * mutate the returned tx's outputs before signing.
   */
  output: { address: string; feeSats: bigint };
  /**
   * The lockup `witnessScript` — the staker reuses `RegisterMetadata.lockScript`
   * verbatim; the CLTV unlock height is decoded from it. Rebuild it from its
   * pieces when the bytes aren't at hand:
   * ```ts
   * const lockScript = buildLockScript({
   *   stxAddress,
   *   unlockHeight,
   *   unlockBytes: buildUnlockScript(stakerBtcPublicKey),
   *   earlyUnlockBytes, // from fetchBond(...)
   * });
   * ```
   */
  lockScript: Uint8Array | string;
}

/**
 * Build the unsigned reclaim transaction (a `@scure/btc-signer` `Transaction`).
 *
 * Attaches one P2WSH input — with its `witnessUtxo` + `witnessScript` set, so the
 * tx is a complete PSBT that `toPSBT()` / `fromPSBT()` round-trip and that
 * {@link computeReclaimSighash} can read — and the sweep output from
 * `opts.output`. The caller may still adjust outputs / fee on the returned tx
 * **before signing** (the `SIGHASH_ALL` signature commits to them).
 *
 * - `path: 'early-exit'` -> `OP_ELSE` branch: `sequence = 0xffffffff`, `lockTime = 0`.
 * - `path: 'locktime'`   -> `OP_IF`/CLTV branch: `sequence = 0xfffffffe`,
 *   `lockTime = unlockHeight` (decoded from the `lockScript`).
 *
 * Sign with btc-signer (`tx.signIdx(privateKey, 0)`), or attach a detached
 * signature ({@link signReclaim} / a hardware wallet) via
 * `tx.updateInput(0, { partialSig })`, then {@link finalizeReclaim}.
 */
export function buildReclaim(opts: BuildReclaimOpts): btc.Transaction {
  const network = btcNetworkFrom(opts.network);
  const lockScript = toBytes(opts.lockScript);
  const { unlockHeight: scriptHeight } = decodeLockScript(lockScript);

  const amount = opts.utxo.value;
  const { address, feeSats } = opts.output;

  if (feeSats < 0n) {
    throw new Error(`buildReclaim: feeSats (${feeSats}) must be non-negative`);
  }

  const sweepSats = amount - feeSats;
  if (sweepSats <= 0n) {
    throw new Error(`buildReclaim: fee (${feeSats}) >= utxo value (${amount})`);
  }
  if (sweepSats < DUST_LIMIT_SATS) {
    throw new Error(
      `buildReclaim: sweep of ${sweepSats} sats is below the ${DUST_LIMIT_SATS}-sat dust limit — nodes would not relay the tx`
    );
  }

  const earlyExit = opts.path === 'early-exit';
  if (!earlyExit && scriptHeight == null) {
    throw new Error(
      'buildReclaim: the locktime path needs a lockScript that encodes a CLTV unlock height'
    );
  }
  const lockTime = earlyExit ? 0 : scriptHeight;

  const tx = new btc.Transaction({ ...TX_OPTS, lockTime });
  tx.addInput({
    txid: opts.utxo.txid,
    index: opts.utxo.vout,
    sequence: earlyExit ? 0xffffffff : 0xfffffffe,
    witnessUtxo: { script: scriptToWshOutput(lockScript), amount },
    witnessScript: lockScript,
  });
  tx.addOutputAddress(address, sweepSats, network);
  return tx;
}

/**
 * Compute the input-0 BIP-143 sighash for a reclaim tx.
 *
 * For an in-process key, prefer `tx.signIdx(privateKey, 0)` — btc-signer derives
 * this digest itself. This helper is for signers that sign a bare digest (an HSM
 * or KMS cosigner, an MPC service) and for passing the early-exit sighash between
 * the two parties out-of-band. Hardware and browser wallets do NOT sign a bare
 * digest: give them `tx.toPSBT()`, which {@link buildReclaim} makes complete.
 *
 * Reads the `witnessScript` + input amount off the tx (set by {@link buildReclaim}
 * and preserved through PSBT round-trips); pass `opts` to re-supply them for a tx
 * parsed from raw hex, which carries neither. Recompute after any output/fee
 * change — the signature commits to the outputs.
 */
export function computeReclaimSighash(
  tx: btc.Transaction,
  opts?: { witnessScript?: Uint8Array | string; amountSats?: bigint }
): Uint8Array {
  const input = tx.getInput(0);
  const witnessScript =
    opts?.witnessScript != null ? toBytes(opts.witnessScript) : input.witnessScript;
  const amount = opts?.amountSats ?? input.witnessUtxo?.amount;
  if (!witnessScript || amount == null) {
    throw new Error(
      'computeReclaimSighash: need witnessScript + amount (pass `opts` for a raw-hex tx)'
    );
  }
  return tx.preimageWitnessV0(0, witnessScript, SIGHASH_ALL, amount);
}

/**
 * @internal
 * Sign a reclaim sighash with a software key: DER signature + trailing
 * `SIGHASH_ALL` byte, for a PSBT `partialSig`.
 *
 * Not needed in application code — `tx.signIdx(privateKey, 0)` does the same job
 * and produces byte-identical bytes (`lowR` defaults to `false` here to match
 * btc-signer's own default). Kept as the software stand-in for a detached signer
 * in tests.
 */
export function signReclaim(
  sighash: Uint8Array,
  privateKey: PrivateKey,
  opts?: { lowR?: boolean }
): Uint8Array {
  const priv = privateKeyToBytes(privateKey).slice(0, 32);
  return concatBytes(signECDSA(sighash, priv, opts?.lowR ?? false), new Uint8Array([SIGHASH_ALL]));
}

/** Arguments to {@link finalizeReclaim}, discriminated on the spend path. */
export type FinalizeReclaimOpts =
  | {
      path: 'early-exit';
      tx: btc.Transaction;
      /** Staker principal — rebuilds the 32-byte preimage the `OP_ELSE` branch reveals. */
      stxAddress: string;
    }
  | { path: 'locktime'; tx: btc.Transaction };

/**
 * Assemble the custom IF/ELSE witness from the signatures already on the tx and
 * return the broadcastable transaction.
 *
 * Reads the `partialSig`(s) off input 0 (left there by `tx.signIdx` or a manual
 * `updateInput({ partialSig })`), matching public keys against the lockup script
 * to tell the staker from the cosigner. btc-signer's own finalizer can't build
 * this script (it doesn't know the branch, preimage, or selector), so we splice
 * the witness directly. Broadcasting is left to the caller.
 *
 * - `early-exit`: `[ stakerSig, cosignerSig, preimage, <empty>, witnessScript ]`
 * - `locktime`:   `[ stakerSig, 0x01, witnessScript ]`
 */
export function finalizeReclaim(opts: FinalizeReclaimOpts): { txHex: string; txid: string } {
  const { tx } = opts;
  const witnessScript = tx.getInput(0).witnessScript;
  if (!witnessScript) throw new Error('finalizeReclaim: input 0 has no witnessScript');

  tx.updateInput(0, { finalScriptWitness: reclaimWitness(opts, witnessScript) }, true);
  if (!tx.isFinal) throw new Error('finalizeReclaim: witness injection failed (tx not final)');
  return { txHex: tx.hex, txid: tx.id };
}

/**
 * @internal Assemble the branch-specific witness stack (bottom->top) from the
 * `partialSig`(s) on input 0, matching pubkeys against the lockup script to tell
 * the staker from the cosigner.
 */
function reclaimWitness(opts: FinalizeReclaimOpts, witnessScript: Uint8Array): Uint8Array[] {
  const sigs = opts.tx.getInput(0).partialSig ?? [];
  const { stakerPub, cosignerPub } = decodeLockScript(witnessScript);
  const sigFor = (pub: Uint8Array) => sigs.find(([p]) => equals(p, pub))?.[1];

  const stakerSig = sigFor(stakerPub);
  if (!stakerSig) throw new Error('finalizeReclaim: missing staker signature (partialSig)');

  // CLTV branch: [ stakerSig, 0x01 (-> OP_IF), witnessScript ]
  if (opts.path === 'locktime') return [stakerSig, IF_SELECTOR, witnessScript];

  // Early-exit branch: [ stakerSig, cosignerSig, preimage, <empty> (-> OP_ELSE), witnessScript ]
  const cosignerSig = sigFor(cosignerPub);
  if (!cosignerSig) throw new Error('finalizeReclaim: missing cosigner signature (partialSig)');
  const preimage = computeRegisterPreimage(opts.stxAddress);
  return [stakerSig, cosignerSig, preimage, ELSE_SELECTOR, witnessScript];
}
