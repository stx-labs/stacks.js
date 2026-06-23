import * as btc from '@scure/btc-signer';
// `signECDSA` is only exported from the `utils` subpath, not the package root.
import { signECDSA } from '@scure/btc-signer/utils.js';
import { concatBytes, equals, hexToBytes, privateKeyToBytes } from '@stacks/common';
import type { PrivateKey } from '@stacks/common';
import type { StacksNetwork, StacksNetworkName } from '@stacks/network';
import {
  btcNetworkFrom,
  buildLockScript,
  buildUnlockScript,
  computeRegisterPreimage,
  computeWshOutputScript,
} from './script';
import type { Utxo } from './types';

/**
 * Spend a P2WSH bond lockup back out.
 *
 * Two paths through the lockup script (mirror of pox-5 `construct-lockup-script`):
 * - `'locktime'`   — the normal CLTV exit (`OP_IF` branch), single-sig (staker),
 *   spendable once burn height ≥ the lock's unlock height.
 * - `'early-exit'` — the cosigned early exit (`OP_ELSE` branch), a 2-of-2 between
 *   the staker and the bond's early-unlock cosigner.
 */
export type ReclaimPath = 'locktime' | 'early-exit';

const SIGHASH_ALL = 1;
/** Empty witness item — selects the `OP_ELSE` (early-exit) branch. */
const ELSE_SELECTOR = new Uint8Array(0);
/** Truthy witness item — selects the `OP_IF` (CLTV) branch. */
const IF_SELECTOR = new Uint8Array([0x01]);
/**
 * Placeholder fee for the single sweep output when the caller doesn't pass one.
 * It is only a starting value — adjust the output on the returned tx (the vsize
 * is deterministic: 1 P2WSH input, 1 P2WPKH output) before signing.
 */
const DEFAULT_FEE_SATS = 1_000n;

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

/** @internal Resolve the lockup `witnessScript` from `lockScript` or the pieces. */
function resolveLockScript(opts: BuildReclaimOpts): Uint8Array {
  if (opts.lockScript != null) return toBytes(opts.lockScript);

  const { stxAddress, unlockHeight, stakerBtcPublicKey, earlyUnlockBytes } = opts;
  if (
    stxAddress == null ||
    unlockHeight == null ||
    stakerBtcPublicKey == null ||
    earlyUnlockBytes == null
  ) {
    throw new Error(
      'buildReclaim: provide `lockScript`, or all of { stxAddress, unlockHeight, ' +
        'stakerBtcPublicKey, earlyUnlockBytes } to rebuild it'
    );
  }
  return buildLockScript({
    stxAddress,
    unlockHeight,
    unlockBytes: buildUnlockScript(stakerBtcPublicKey),
    earlyUnlockBytes,
  });
}

/** Inputs to {@link buildReclaim}. */
export interface BuildReclaimOpts {
  /** Which spend path / witness shape to build. */
  path: ReclaimPath;
  /** The lockup UTXO to spend (esplora / mempool-shaped). */
  utxo: Utxo;
  network: StacksNetworkName | StacksNetwork;
  /**
   * The initial sweep output. `toAddress` defaults to the staker's P2WPKH (derived
   * from the staker key in the lockup script); `feeSats` to a small placeholder.
   * Both are only a starting point — mutate the returned tx before signing.
   */
  output?: { toAddress?: string; feeSats?: bigint };

  /**
   * The lockup `witnessScript`. The staker reuses `RegisterMetadata.lockScript`
   * verbatim. Pass this OR the four pieces below.
   */
  lockScript?: Uint8Array | string;
  /** Staker's Stacks principal (committed in the script). */
  stxAddress?: string;
  /**
   * The **actual** L1 unlock height the lockup was funded at — not necessarily
   * the bond minimum from `fetchBondL1UnlockHeight`. Carried in `lockScript`.
   */
  unlockHeight?: number | bigint;
  /** Staker's compressed (33-byte) BTC public key. */
  stakerBtcPublicKey?: Uint8Array | string;
  /** Per-bond early-unlock subscript, from `fetchBond(...).earlyUnlockBytes`. */
  earlyUnlockBytes?: Uint8Array | string;
}

/**
 * Build the unsigned reclaim transaction (a `@scure/btc-signer` `Transaction`).
 *
 * Attaches one P2WSH input — with its `witnessUtxo` + `witnessScript` set, so the
 * tx is a complete PSBT that `toPSBT()` / `fromPSBT()` round-trip and that
 * {@link computeReclaimSighash} can read — and one default sweep output. The
 * caller may adjust outputs / fee on the returned tx **before signing** (the
 * `SIGHASH_ALL` signature commits to them).
 *
 * - `path: 'early-exit'` → `OP_ELSE` branch: `sequence = 0xffffffff`, `lockTime = 0`.
 * - `path: 'locktime'`   → `OP_IF`/CLTV branch: `sequence = 0xfffffffe`,
 *   `lockTime = unlockHeight` (taken from `opts.unlockHeight`, else parsed from the
 *   `lockScript`).
 *
 * Sign with btc-signer (`tx.signIdx(privateKey, 0)`), or attach a detached
 * signature ({@link signReclaim} / a hardware wallet) via
 * `tx.updateInput(0, { partialSig })`, then {@link finalizeReclaim}.
 */
export function buildReclaim(opts: BuildReclaimOpts): btc.Transaction {
  const network = btcNetworkFrom(opts.network);
  const lockScript = resolveLockScript(opts);
  const { stakerPub, unlockHeight: scriptHeight } = decodeLockScript(lockScript);

  const amount = opts.utxo.value;
  const feeSats = opts.output?.feeSats ?? DEFAULT_FEE_SATS;
  const sweepSats = amount - feeSats;
  if (sweepSats <= 0n) {
    throw new Error(`buildReclaim: fee (${feeSats}) >= utxo value (${amount})`);
  }
  const toAddress = opts.output?.toAddress ?? btc.p2wpkh(stakerPub, network).address;
  if (!toAddress) throw new Error('buildReclaim: could not derive a default toAddress');

  const earlyExit = opts.path === 'early-exit';
  let lockTime = 0;
  if (!earlyExit) {
    const height = opts.unlockHeight ?? scriptHeight;
    if (height == null) {
      throw new Error(
        'buildReclaim: the locktime path needs an unlockHeight (pass it, or a lockScript that encodes it)'
      );
    }
    lockTime = Number(height);
  }

  const tx = new btc.Transaction({ ...TX_OPTS, lockTime });
  tx.addInput({
    txid: opts.utxo.txid,
    index: opts.utxo.vout,
    sequence: earlyExit ? 0xffffffff : 0xfffffffe,
    witnessUtxo: { script: computeWshOutputScript(lockScript), amount },
    witnessScript: lockScript,
  });
  tx.addOutputAddress(toAddress, sweepSats, network);
  return tx;
}

/**
 * Compute the input-0 BIP-143 sighash for a reclaim tx — the digest any signer
 * (a hardware wallet, another library, {@link signReclaim}) signs.
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
 * Sign a reclaim sighash with a software key: DER signature + trailing
 * `SIGHASH_ALL` byte, ready to drop into a witness or a PSBT `partialSig`.
 *
 * Optional. This helper does NOT touch the transaction — it only turns a digest
 * into signature bytes. How a signature actually gets onto the reclaim tx (both
 * leave a `partialSig` that rides inside `tx.toPSBT()`, then {@link finalizeReclaim}
 * reads it back off input 0):
 *
 * - Software key, in process — sign with btc-signer directly (most callers):
 *     `tx.signIdx(privateKey, 0)`
 * - Hardware / detached signer — this helper is the software stand-in:
 *     `const sig = signReclaim(computeReclaimSighash(tx), privateKey);`
 *     `tx.updateInput(0, { partialSig: [[publicKey, sig]] })`
 *
 * `lowR` defaults to `false` to match btc-signer's `signIdx` (whose default
 * `tx.opts.lowR` is also off), so a default `signReclaim` and a default `signIdx`
 * produce byte-identical signatures. Mirrors `signSignerGrant`'s detached shape.
 */
export function signReclaim(
  sighash: Uint8Array,
  privateKey: PrivateKey,
  opts?: { lowR?: boolean }
): Uint8Array {
  // `privateKeyToBytes` accepts the Stacks `PrivateKey` shapes; `.slice(0, 32)` drops the
  // trailing compression-flag byte a 33-byte key carries, leaving the raw scalar signECDSA wants.
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
 * @internal Assemble the branch-specific witness stack (bottom→top) from the
 * `partialSig`(s) on input 0, matching pubkeys against the lockup script to tell
 * the staker from the cosigner.
 */
function reclaimWitness(opts: FinalizeReclaimOpts, witnessScript: Uint8Array): Uint8Array[] {
  const sigs = opts.tx.getInput(0).partialSig ?? [];
  const { stakerPub, cosignerPub } = decodeLockScript(witnessScript);
  const sigFor = (pub: Uint8Array) => sigs.find(([p]) => equals(p, pub))?.[1];

  const stakerSig = sigFor(stakerPub);
  if (!stakerSig) throw new Error('finalizeReclaim: missing staker signature (partialSig)');

  // CLTV branch: [ stakerSig, 0x01 (→ OP_IF), witnessScript ]
  if (opts.path === 'locktime') return [stakerSig, IF_SELECTOR, witnessScript];

  // Early-exit branch: [ stakerSig, cosignerSig, preimage, <empty> (→ OP_ELSE), witnessScript ]
  const cosignerSig = sigFor(cosignerPub);
  if (!cosignerSig) throw new Error('finalizeReclaim: missing cosigner signature (partialSig)');
  const preimage = computeRegisterPreimage(opts.stxAddress);
  return [stakerSig, cosignerSig, preimage, ELSE_SELECTOR, witnessScript];
}
