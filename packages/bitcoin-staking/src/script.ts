import * as btc from '@scure/btc-signer';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, hexToBytes } from '@stacks/common';
import type { StacksNetwork, StacksNetworkName } from '@stacks/network';
import { Cl, serializeCVBytes } from '@stacks/transactions';
import {
  BOND_END_OFFSET_PERIODS,
  bondPeriodToRewardCycle,
  rewardCycleToBurnHeight,
} from './cycles';
import { networkNameFrom } from './network';
import type { PoxInfo } from './types';

// regtest == testnet except for the bech32 HRP (`bcrt` vs `tb`).
const REGTEST_NETWORK = { ...btc.TEST_NETWORK, bech32: 'bcrt' };

const BTC_NETWORKS: Record<StacksNetworkName, typeof btc.NETWORK> = {
  mainnet: btc.NETWORK,
  testnet: btc.TEST_NETWORK,
  devnet: REGTEST_NETWORK,
  mocknet: REGTEST_NETWORK,
};

/**
 * @internal Resolve a Stacks network to its `@scure/btc-signer` network params
 * (address HRP / version bytes). Shared so tx builders and address derivation
 * agree on the BTC network.
 */
export function btcNetworkFrom(network: StacksNetworkName | StacksNetwork): typeof btc.NETWORK {
  return BTC_NETWORKS[networkNameFrom(network)];
}

/**
 * Build the default unlock script: `<compressedPubKey> OP_CHECKSIG`.
 *
 * This is the simplest spend condition — a single signature from the given
 * public key. Compatible with any wallet including hardware wallets (Ledger).
 *
 * Users may provide custom `unlockBytes` instead, but validation helpers
 * in this package only support this default format.
 */
export function buildUnlockScript(publicKey: Uint8Array | string): Uint8Array {
  const pubBytes = typeof publicKey === 'string' ? hexToBytes(publicKey) : publicKey;

  if (pubBytes.length !== 33) {
    throw new Error('Expected a 33-byte compressed public key');
  }

  return btc.Script.encode([pubBytes, 'CHECKSIG']);
}

/**
 * Validate that `unlockBytes` matches the default format (`<pubkey> OP_CHECKSIG`).
 *
 * Returns the extracted compressed public key if valid, or `undefined` if the
 * script doesn't match the default shape.
 */
export function parseUnlockScript(unlockBytes: Uint8Array | string): Uint8Array | undefined {
  const bytes = typeof unlockBytes === 'string' ? hexToBytes(unlockBytes) : unlockBytes;

  try {
    const decoded = btc.Script.decode(bytes);

    if (
      decoded.length === 2 &&
      decoded[0] instanceof Uint8Array &&
      decoded[0].length === 33 &&
      decoded[1] === 'CHECKSIG'
    ) {
      return decoded[0];
    }
  } catch {
    // malformed script
  }
  return undefined;
}

/**
 * @internal
 * Mirrors `pox-5.push-script-bytes`: prefixes `bytes` with the right push
 * opcode(s) — empty -> `OP_0`, <=75 -> direct push, <=255 -> `OP_PUSHDATA1`, <=65535
 * -> `OP_PUSHDATA2`. Encoding delegated to `@scure/btc-signer`'s `Script`.
 *
 * @throws for inputs longer than 65535 bytes (no `OP_PUSHDATA4`, like the contract).
 */
export function pushScriptBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 0xffff) {
    throw new Error(`pushScriptBytes: payload too large (${bytes.length} bytes; max 65535)`);
  }
  return btc.Script.encode([bytes]);
}

/**
 * @internal
 * Mirrors `pox-5.serialize-c-script-num`: the minimal little-endian signed
 * ScriptNum encoding of a non-negative integer (`0` -> `[]`; a `0x00` sign byte
 * is appended when the top byte's high bit is set, to keep the value positive).
 * Encoding delegated to `@scure/btc-signer`'s `ScriptNum`.
 *
 * The contract rejects `n >= 2^39` with `ERR_INVALID_UNLOCK_HEIGHT` — the
 * ceiling of what a 5-byte minimally-encoded ScriptNum can represent (a higher
 * value needs a 6th sign byte). We mirror that bound.
 *
 * @throws if `n` is negative or `n >= 2^39` (`ERR_INVALID_UNLOCK_HEIGHT`).
 */
export const C_SCRIPT_NUM_MAX = 549755813888n; // 2^39

export function serializeCScriptNum(n: number | bigint): Uint8Array {
  const big = typeof n === 'bigint' ? n : BigInt(n);
  if (big < 0n) throw new Error('serializeCScriptNum: negative values not supported');
  if (big >= C_SCRIPT_NUM_MAX) {
    throw new Error(
      `serializeCScriptNum: n >= 2^39 is rejected by the contract (ERR_INVALID_UNLOCK_HEIGHT)`
    );
  }
  return btc.ScriptNum().encode(big);
}

/**
 * @internal
 * Mirrors `pox-5.push-c-script-num`: pushes a ScriptNum, using the
 * single-byte opcodes `OP_0` / `OP_1`..`OP_16` for `0`..`16` and a
 * `push-script-bytes(serialize-c-script-num(n))` push otherwise. Delegated to
 * `@scure/btc-signer`'s `Script`.
 *
 * @throws if `n` is negative or `n >= 2^39` (`ERR_INVALID_UNLOCK_HEIGHT`).
 */
export function pushCScriptNum(n: number | bigint): Uint8Array {
  serializeCScriptNum(n); // validate: throws on negative / out-of-range (>= 2^39)
  return btc.Script.encode([Number(n)]);
}

/**
 * @internal
 * Encode a Stacks principal as its Clarity consensus buffer, via the monorepo's
 * {@link serializeCVBytes} — i.e. `to-consensus-buff?` for a principal. Handles
 * both standard principals (`0x05 || version(1B) || hash160(20B)`, 22 bytes) and
 * contract principals (`0x06 || version(1B) || hash160(20B) || name-len(1B) ||
 * name`), matching pox-5, which accepts contract principals as stakers.
 */
export function toConsensusBuff(addr: string): Uint8Array {
  return serializeCVBytes(Cl.address(addr));
}

/**
 * The 32-byte preimage an early-exit (OP_ELSE) spend must reveal in its witness:
 * `sha256(to-consensus-buff?(staker))`.
 *
 * The lockup script commits to the staker by the *double* hash
 * `sha256(sha256(consensus-buff(staker)))` (see {@link buildLockScript}), so
 * the early-exit branch checks `OP_SIZE 32 OP_EQUALVERIFY OP_SHA256 <H>
 * OP_EQUALVERIFY` against this single-hash preimage. A normal (CLTV) unlock does
 * not need it.
 */
export function computeRegisterPreimage(stxAddress: string): Uint8Array {
  return sha256(toConsensusBuff(stxAddress));
}

/**
 * Build the canonical L1 lockup script that the pox-5 contract verifies.
 * Byte-for-byte mirror of `pox-5.construct-lockup-script`:
 *
 * ```text
 * OP_IF
 *   <unlock-burn-height push>    // serialized as c-script-num
 *   OP_CHECKLOCKTIMEVERIFY
 * OP_ELSE
 *   OP_SIZE <32> OP_EQUALVERIFY  // the revealed preimage must be 32 bytes
 *   OP_SHA256 <H> OP_EQUALVERIFY  // sha256(preimage) == committed staker hash
 *   <early-unlock-bytes>
 * OP_ENDIF
 * OP_VERIFY
 * <unlock-bytes>                 // staker subscript, runs in BOTH branches
 * ```
 *
 * The staker is bound to the script by a *hashed* commitment rather than a
 * cleartext push: `<H> = sha256(sha256(to-consensus-buff?(staker)))`. The
 * early-exit (`OP_ELSE`) branch must reveal the 32-byte preimage
 * `sha256(to-consensus-buff?(staker))` — see
 * {@link computeRegisterPreimage}. A normal `OP_IF` (CLTV) unlock does
 * not reveal it. In both branches the shared `OP_VERIFY` consumes the branch
 * result and the staker subscript (`unlockBytes`) runs last as the final
 * authorization.
 *
 * `unlockBytes` and `earlyUnlockBytes` are pre-pushed, self-contained Bitcoin
 * script fragments — the contract concatenates them RAW (it does not wrap them
 * in a push-data prefix), so the caller supplies complete subscripts. Both MUST
 * leave a valid (boolean) result on the stack:
 * - `unlockBytes`: the staker-signature subscript (e.g. `<pubkey> OP_CHECKSIG`
 *   from {@link buildUnlockScript}); it always runs and its result is the
 *   final result of the script.
 * - `earlyUnlockBytes`: the early-unlock-key subscript for the early-exit branch
 *   (e.g. `<pubkey> OP_CHECKSIG`, or an M-of-N CHECKMULTISIG template); its
 *   result is consumed by the shared `OP_VERIFY`.
 *
 * The `early-unlock-bytes` come from the per-bond `protocol-bonds.early-unlock-bytes`
 * configuration on-chain; the SDK does not synthesize them — callers fetch them
 * via `fetchBond(...)` and pass them through.
 *
 * `staker` may be a standard or a contract address — both are serialized by
 * their Clarity consensus buffer, matching pox-5.
 */
export function buildLockScript(opts: {
  /** Stacks address of the staker (standard or contract address). */
  stxAddress: string;
  /** Burn-block height at which the OP_CLTV branch becomes spendable. */
  unlockHeight: number | bigint;
  /** Staker-signature subscript, run last in BOTH branches (the final spend-condition). */
  unlockBytes: Uint8Array | string;
  /**
   * Per-bond early-unlock subscript, spliced into the `OP_ELSE` (early-exit)
   * branch before the shared `OP_VERIFY`. Sourced from
   * `protocol-bonds.early-unlock-bytes` — opaque to the SDK.
   */
  earlyUnlockBytes: Uint8Array | string;
}): Uint8Array {
  const unlockBytes =
    typeof opts.unlockBytes === 'string' ? hexToBytes(opts.unlockBytes) : opts.unlockBytes;
  const earlyUnlockBytes =
    typeof opts.earlyUnlockBytes === 'string'
      ? hexToBytes(opts.earlyUnlockBytes)
      : opts.earlyUnlockBytes;

  // Validate the height fits the contract's 5-byte ScriptNum cap before pushing.
  serializeCScriptNum(opts.unlockHeight);
  // The committed staker hash <H> = sha256(sha256(consensus-buff(staker))).
  const stakerHash = sha256(computeRegisterPreimage(opts.stxAddress));

  // The opcode scaffold, built via `Script.encode`. The two caller subscripts
  // (`earlyUnlockBytes`, `unlockBytes`) are concatenated RAW between/after the
  // scaffold segments — the contract splices them verbatim, so we must too.
  return concatBytes(
    // IF: spendable at/after the CLTV `unlockHeight`.
    // ELSE: early exit — the revealed 32-byte witness item must sha256 to <H>.
    btc.Script.encode([
      'IF',
      Number(opts.unlockHeight),
      'CHECKLOCKTIMEVERIFY',
      'ELSE',
      'SIZE',
      32,
      'EQUALVERIFY',
      'SHA256',
      stakerHash,
      'EQUALVERIFY',
    ]),
    earlyUnlockBytes, // per-bond early-unlock subscript (ELSE branch)
    btc.Script.encode(['ENDIF', 'VERIFY']),
    unlockBytes // staker subscript — runs last in BOTH branches
  );
}

/**
 * @internal
 * Compute the P2WSH `scriptPubKey` for a witness script: `0x00 0x20 || sha256(script)`
 * (34 bytes), via `@scure/btc-signer`'s `OutScript`. Mirrors
 * `pox-5.construct-lockup-output-script`.
 */
export function computeWshOutputScript(script: Uint8Array): Uint8Array {
  return btc.OutScript.encode({ type: 'wsh', hash: sha256(script) });
}

/**
 * Build the P2WSH `scriptPubKey` (34 bytes) for a full L1 lockup. This is the
 * `expected-script-hash` the contract derives in `register-for-bond` and
 * asserts equal to each declared output's `scriptPubKey`.
 *
 * Equivalent to {@link computeWshOutputScript}({@link buildLockScript}(...)).
 */
export function buildLockOutputScript(opts: {
  stxAddress: string;
  unlockHeight: number | bigint;
  unlockBytes: Uint8Array | string;
  earlyUnlockBytes: Uint8Array | string;
}): Uint8Array {
  return computeWshOutputScript(buildLockScript(opts));
}

/**
 * Build the P2WSH Bitcoin address for an L1 lockup.
 *
 * Combines {@link buildLockScript} and P2WSH derivation into a single call.
 * Accepts either a pre-encoded `unlockBytes` tail or a compressed `publicKey`
 * (in which case {@link buildUnlockScript} is used to derive the
 * `<pubkey> OP_CHECKSIG` tail).
 *
 * @example
 * ```ts
 * const address = buildLockAddress({
 *   stxAddress: 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7',
 *   unlockHeight: 850_000,
 *   publicKey: '02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc',
 *   earlyUnlockBytes: bond.earlyUnlockBytes, // from fetchBond(...)
 *   network: 'mainnet',
 * });
 * ```
 */
export function buildLockAddress(opts: {
  stxAddress: string;
  unlockHeight: number | bigint;
  unlockBytes: Uint8Array | string;
  earlyUnlockBytes: Uint8Array | string;
  network: StacksNetworkName | StacksNetwork;
}): string;
export function buildLockAddress(opts: {
  stxAddress: string;
  unlockHeight: number | bigint;
  publicKey: Uint8Array | string;
  earlyUnlockBytes: Uint8Array | string;
  network: StacksNetworkName | StacksNetwork;
}): string;
export function buildLockAddress(opts: {
  stxAddress: string;
  unlockHeight: number | bigint;
  unlockBytes?: Uint8Array | string;
  publicKey?: Uint8Array | string;
  earlyUnlockBytes: Uint8Array | string;
  network: StacksNetworkName | StacksNetwork;
}): string {
  const unlockBytes =
    opts.unlockBytes ?? (opts.publicKey ? buildUnlockScript(opts.publicKey) : undefined);
  if (!unlockBytes) {
    throw new Error('buildLockAddress: provide either `unlockBytes` or `publicKey`');
  }
  const script = buildLockScript({
    stxAddress: opts.stxAddress,
    unlockHeight: opts.unlockHeight,
    unlockBytes,
    earlyUnlockBytes: opts.earlyUnlockBytes,
  });
  return lockScriptToAddress(script, networkNameFrom(opts.network));
}

/**
 * @internal Derive the P2WSH Bitcoin address that commits to the given locking script.
 *
 * Pure: no I/O. Useful when the caller already holds the script bytes (e.g. from
 * {@link buildLockScript}) and wants to fund the address out-of-band.
 */
export function lockScriptToAddress(
  script: Uint8Array,
  network: StacksNetworkName | StacksNetwork
): string {
  const btcNetwork = BTC_NETWORKS[networkNameFrom(network)];
  const result = btc.p2wsh({ type: 'wsh', script }, btcNetwork);
  if (!result.address) throw new Error('Failed to derive P2WSH address');
  return result.address;
}

/**
 * Compute the deterministic L1 unlock height for a STAKER lock.
 *
 * Set to the start of the staker's unlock cycle (i.e.
 * {@link rewardCycleToBurnHeight} of `firstRewardCycle + numCycles - 1`),
 * giving time to roll over into a new lock without missing a cycle.
 */
export function computeUnlockHeight(opts: {
  firstRewardCycle: number;
  numCycles: number;
  poxInfo: PoxInfo;
}): number {
  return rewardCycleToBurnHeight({
    cycle: opts.firstRewardCycle + opts.numCycles - 1,
    poxInfo: opts.poxInfo,
  });
}

/**
 * Compute the L1 unlock height for a paired-BTC BOND lockup.
 *
 * Mirrors the contract's `get-bond-l1-unlock-height`:
 * ```
 * unlock = bondPeriodToBurnHeight(bondIndex + BOND_END_OFFSET_PERIODS)
 *        - floor(rewardCycleLength / 2)
 * ```
 *
 * `firstBondPeriodCycle` is derived internally from `poxInfo` via
 * `firstPox5RewardCycle`; throws if pox-5 has not yet activated on-chain.
 */
export function computeBondUnlockHeight(opts: { bondIndex: number; poxInfo: PoxInfo }): number {
  const endCycle = bondPeriodToRewardCycle({
    bondIndex: opts.bondIndex + BOND_END_OFFSET_PERIODS,
    poxInfo: opts.poxInfo,
  });
  const endBurnHeight = rewardCycleToBurnHeight({
    cycle: endCycle,
    poxInfo: opts.poxInfo,
  });
  return endBurnHeight - Math.floor(opts.poxInfo.rewardCycleLength / 2);
}

/**
 * Everything derivable for a paired-BTC `register-for-bond` *before* the
 * funding Bitcoin transaction exists. {@link buildRegisterMetadata} computes
 * the whole chain (unlock height -> unlock tail -> lock script -> address /
 * output script) in one call, so callers fund {@link RegisterMetadata.lockAddress}
 * and later pass {@link RegisterMetadata.lockScript} straight to `buildLockProof`
 * / `buildLockProofFromBlock` (both accept `lockScript` in place of
 * `outputScript`).
 */
export interface RegisterMetadata {
  /** P2WSH Bitcoin address to fund — send the locked sats here. */
  lockAddress: string;
  /**
   * The witness/locking script the address commits to. Pass this as the
   * `lockScript` of `buildLockProof` / `buildLockProofFromBlock` to locate the
   * funding output in the SPV proof.
   */
  lockScript: Uint8Array;
  /**
   * The P2WSH `scriptPubKey` (34 bytes) the funding output must carry — the
   * `outputScript` the contract asserts. Equals
   * `computeWshOutputScript(lockScript)`; exposed since it is derived along
   * the way.
   */
  outputScript: Uint8Array;
  /**
   * The staker-signature tail (`<pubkey> OP_CHECKSIG`). This *is* the encoded
   * unlock script — there is no separate "script vs bytes" representation; pass
   * it straight through as the `unlockBytes` of `register-for-bond`'s lockup.
   */
  unlockBytes: Uint8Array;
  /** L1 unlock burn height (the `OP_CLTV` branch). */
  unlockHeight: number;
}

/**
 * Derive every pre-funding artifact for a paired-BTC `register-for-bond`.
 *
 * Combines {@link computeBondUnlockHeight}, {@link buildUnlockScript},
 * {@link buildLockScript}, {@link computeWshOutputScript} and
 * {@link lockScriptToAddress} so the registration flow is a single call instead
 * of five hand-wired steps. Pure — no I/O.
 *
 * @example
 * ```ts
 * const meta = buildRegisterMetadata({
 *   bondIndex, poxInfo,
 *   bitcoinPublicKey: user.publicKey,
 *   stxAddress: user.address,
 *   earlyUnlockBytes: bond.earlyUnlockBytes, // from fetchBond(...)
 *   network: 'devnet',
 * });
 * const txid = await sendToAddress(meta.lockAddress, sats);
 * // ...wait for confirmation, fetch the proof inputs...
 * const output = buildLockProofFromBlock({
 *   ...proof,
 *   lockScript: meta.lockScript,
 *   unlockHeight: meta.unlockHeight,
 * });
 * await buildRegisterForBond({
 *   bondIndex, signerManager, amountUstx,
 *   lockup: { kind: 'btc', outputs: [output], unlockBytes: meta.unlockBytes },
 *   publicKey: user.publicKey, ...
 * });
 * ```
 */
export function buildRegisterMetadata(opts: {
  bondIndex: number;
  poxInfo: PoxInfo;
  /** Compressed (33-byte) public key the staker signs the unlock with. */
  bitcoinPublicKey: Uint8Array | string;
  /** Stacks address of the staker (standard or contract address). */
  stxAddress: string;
  /** Per-bond early-unlock subscript, from `fetchBond(...)`. */
  earlyUnlockBytes: Uint8Array | string;
  network: StacksNetworkName | StacksNetwork;
}): RegisterMetadata {
  const unlockHeight = computeBondUnlockHeight({
    bondIndex: opts.bondIndex,
    poxInfo: opts.poxInfo,
  });
  const unlockBytes = buildUnlockScript(opts.bitcoinPublicKey);
  const lockScript = buildLockScript({
    stxAddress: opts.stxAddress,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes: opts.earlyUnlockBytes,
  });

  return {
    lockAddress: lockScriptToAddress(lockScript, networkNameFrom(opts.network)),
    lockScript,
    outputScript: computeWshOutputScript(lockScript),
    unlockBytes,
    unlockHeight,
  };
}
