import * as btc from '@scure/btc-signer';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, hexToBytes } from '@stacks/common';
import type { StacksNetwork, StacksNetworkName } from '@stacks/network';
import { Address } from '@stacks/transactions';
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

// ---------------------------------------------------------------------------
// Default unlock-script (the simplest "tail" — single sig)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Low-level primitives that mirror the pox-5.clar helpers
// ---------------------------------------------------------------------------

/** Bitcoin opcodes used in lockup-script construction (from `@scure/btc-signer`). */
const { OP } = btc;

/**
 * The fixed preamble of the OP_ELSE (early-exit) branch:
 * `OP_SIZE OP_PUSHBYTES_1 0x20 OP_EQUALVERIFY OP_SHA256 OP_PUSHBYTES_32`.
 * Asserts the revealed witness item is 32 bytes, then sets up the `sha256`
 * comparison against the committed staker hash that follows. The `0x0120` and
 * trailing `0x20` are raw push-length bytes, which have no named opcodes.
 */
const STAKER_COMMITMENT_PREFIX = hexToBytes('82012088a820');

/**
 * @internal @ignore
 * Mirror of pox-5.clar `push-script-bytes`.
 *
 * Encodes the Bitcoin script-push prefix for an arbitrary byte buffer:
 * - `[]` → `OP_0` (`0x00`)
 * - 1..=75 bytes → `<len>` then bytes
 * - 76..=255 bytes → `OP_PUSHDATA1 (0x4c)` + 1-byte length + bytes
 * - 256..=65535 bytes → `OP_PUSHDATA2 (0x4d)` + 2-byte LE length + bytes
 *
 * Throws for inputs longer than 65535 bytes (no OP_PUSHDATA4 in the contract
 * either).
 */
export function pushScriptBytes(bytes: Uint8Array): Uint8Array {
  const len = bytes.length;
  if (len === 0) return new Uint8Array([OP.OP_0]);
  if (len <= 75) {
    const out = new Uint8Array(1 + len);
    out[0] = len;
    out.set(bytes, 1);
    return out;
  }
  if (len <= 255) {
    const out = new Uint8Array(2 + len);
    out[0] = OP.PUSHDATA1;
    out[1] = len;
    out.set(bytes, 2);
    return out;
  }
  if (len <= 0xffff) {
    const out = new Uint8Array(3 + len);
    out[0] = OP.PUSHDATA2;
    out[1] = len & 0xff;
    out[2] = (len >> 8) & 0xff;
    out.set(bytes, 3);
    return out;
  }
  throw new Error(`pushScriptBytes: payload too large (${len} bytes; max 65535)`);
}

/**
 * @internal @ignore
 * Mirror of pox-5.clar `serialize-c-script-num`.
 *
 * Minimal little-endian signed-magnitude encoding (standard Bitcoin ScriptNum)
 * for non-negative integers. If the top bit of the most-significant byte is
 * set, a `0x00` byte is appended to keep the number unsigned.
 *
 * - 0 → `[]`
 * - 1..=127 → 1 byte
 * - 128..=255 → 2 bytes (LE + `0x00` sign byte)
 * - 256..=32767 → 2 bytes (LE)
 * - 32768..=65535 → 3 bytes (LE + `0x00` sign byte)
 * - 65536..=2^31-1 → 3..=4 bytes (LE, with sign byte if needed)
 *
 * The contract restricts output to 5 bytes (`as-max-len? ... u5`), which is
 * enough for any conceivable burn height. We mirror that cap.
 *
 * @throws if `n` is negative, non-integer, or larger than the 5-byte cap.
 */
export function serializeCScriptNum(n: number | bigint): Uint8Array {
  const big = typeof n === 'bigint' ? n : BigInt(n);
  if (big < 0n) throw new Error('serializeCScriptNum: negative values not supported');
  if (big === 0n) return new Uint8Array(0);

  // Strip to minimal LE byte representation.
  const bytes: number[] = [];
  let v = big;
  while (v > 0n) {
    bytes.push(Number(v & 0xffn));
    v >>= 8n;
  }
  // If top bit of MSB is set, append a sign byte (0x00) to keep value positive.
  if ((bytes[bytes.length - 1] & 0x80) !== 0) bytes.push(0x00);

  if (bytes.length > 5) {
    throw new Error(
      `serializeCScriptNum: encoding exceeds 5-byte ScriptNum cap (got ${bytes.length})`
    );
  }
  return Uint8Array.from(bytes);
}

/**
 * @internal @ignore
 * Mirror of pox-5.clar `push-c-script-num`.
 *
 * Push a ScriptNum onto the stack. Uses single-byte opcodes (`OP_0`,
 * `OP_1`..`OP_16`) for small values and `push-script-bytes(serialize-c-script-num(n))`
 * otherwise.
 */
export function pushCScriptNum(n: number | bigint): Uint8Array {
  const big = typeof n === 'bigint' ? n : BigInt(n);
  if (big === 0n) return new Uint8Array([OP.OP_0]);
  if (big <= 16n) return new Uint8Array([0x50 + Number(big)]); // OP_1 = 0x51, ..., OP_16 = 0x60
  return pushScriptBytes(serializeCScriptNum(big));
}

/**
 * @internal @ignore
 * Encode a standard-principal Stacks address as a Clarity consensus-buff prefix:
 * `0x05 || version(1B) || hash160(20B)` (22 bytes total).
 *
 * Mirrors `to-consensus-buff?` for a standard principal — the type tag is `0x05`.
 *
 * @throws if `addr` is a contract principal (those use `0x06` and append
 *   `name-length(1B) || name`; contract principals can't act as L1 stakers).
 */
export function toConsensusBuffStandardPrincipal(addr: string): Uint8Array {
  const parsed = Address.parse(addr) as {
    version: number;
    hash160: string;
    contractName?: string;
  };
  if (parsed.contractName) {
    throw new Error(
      `toConsensusBuffStandardPrincipal: expected a standard principal, got contract principal "${addr}"`
    );
  }
  const out = new Uint8Array(22);
  out[0] = 0x05;
  out[1] = parsed.version;
  out.set(hexToBytes(parsed.hash160), 2);
  return out;
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
  return sha256(toConsensusBuffStandardPrincipal(stxAddress));
}

// ---------------------------------------------------------------------------
// Lockup script construction (canonical)
// ---------------------------------------------------------------------------

/**
 * Build the canonical L1 lockup script that the pox-5 contract verifies.
 *
 * This is a byte-for-byte mirror of `construct-lockup-script(staker,
 * unlock-burn-height, staker-unlock-bytes, early-unlock-bytes)` from `pox-5.clar`:
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
 * Only standard principals are accepted as `staker` (contract principals
 * cannot stake on L1).
 */
export function buildLockScript(opts: {
  /** Stacks standard principal of the staker. */
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

  const heightPush = pushCScriptNum(opts.unlockHeight);
  // The committed staker hash <H> = sha256(sha256(consensus-buff(staker))).
  const stakerHash = sha256(computeRegisterPreimage(opts.stxAddress));

  return concatBytes(
    Uint8Array.of(OP.IF),
    heightPush,
    Uint8Array.of(OP.CHECKLOCKTIMEVERIFY, OP.ELSE),
    STAKER_COMMITMENT_PREFIX, // OP_SIZE <32> OP_EQUALVERIFY OP_SHA256 OP_PUSHBYTES_32
    stakerHash,
    Uint8Array.of(OP.EQUALVERIFY),
    earlyUnlockBytes,
    Uint8Array.of(OP.ENDIF, OP.VERIFY),
    unlockBytes
  );
}

/**
 * @internal @ignore
 * Compute the P2WSH `scriptPubKey` for a witness script: `0x00 0x20 || sha256(script)`
 * (34 bytes). Mirrors `construct-lockup-output-script` from the contract.
 */
export function computeP2wshOutputScript(script: Uint8Array): Uint8Array {
  const hash = sha256(script);
  const out = new Uint8Array(34);
  out[0] = 0x00;
  out[1] = 0x20;
  out.set(hash, 2);
  return out;
}

/**
 * Build the P2WSH `scriptPubKey` (34 bytes) for a full L1 lockup. This is the
 * `expected-script-hash` the contract derives in `register-for-bond` and
 * asserts equal to each declared output's `scriptPubKey`.
 *
 * Equivalent to {@link computeP2wshOutputScript}({@link buildLockScript}(...)).
 */
export function buildLockOutputScript(opts: {
  stxAddress: string;
  unlockHeight: number | bigint;
  unlockBytes: Uint8Array | string;
  earlyUnlockBytes: Uint8Array | string;
}): Uint8Array {
  return computeP2wshOutputScript(buildLockScript(opts));
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
 * @internal @ignore Derive the P2WSH Bitcoin address that commits to the given locking script.
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

// ---------------------------------------------------------------------------
// Unlock-height helpers
// ---------------------------------------------------------------------------

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
