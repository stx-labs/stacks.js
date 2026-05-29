import * as btc from '@scure/btc-signer';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes } from '@stacks/common';
import type { StacksNetwork, StacksNetworkName } from '@stacks/network';
import { Address } from '@stacks/transactions';
import {
  BOND_END_OFFSET_PERIODS,
  bondPeriodToRewardCycle,
  rewardCycleToBurnHeight,
  rewardCycleToUnlockHeight,
} from './cycles';
import { networkNameFrom } from './network';
import type { BondL1LockupOutput, PoxInfo } from './types';

const REGTEST_NETWORK = { bech32: 'bcrt', pubKeyHash: 111, scriptHash: 196, wif: 239 };

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
export function buildDefaultUnlockScript(publicKey: Uint8Array | string): Uint8Array {
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
export function parseDefaultUnlockScript(unlockBytes: Uint8Array | string): Uint8Array | undefined {
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

/** Bitcoin opcodes used in lockup-script construction. */
const OP_0 = 0x00;
const OP_PUSHDATA1 = 0x4c;
const OP_PUSHDATA2 = 0x4d;
const OP_IF = 0x63;
const OP_ELSE = 0x67;
const OP_ENDIF = 0x68;
const OP_DROP = 0x75;
const OP_CLTV = 0xb1;

/**
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
  if (len === 0) return new Uint8Array([OP_0]);
  if (len <= 75) {
    const out = new Uint8Array(1 + len);
    out[0] = len;
    out.set(bytes, 1);
    return out;
  }
  if (len <= 255) {
    const out = new Uint8Array(2 + len);
    out[0] = OP_PUSHDATA1;
    out[1] = len;
    out.set(bytes, 2);
    return out;
  }
  if (len <= 0xffff) {
    const out = new Uint8Array(3 + len);
    out[0] = OP_PUSHDATA2;
    out[1] = len & 0xff;
    out[2] = (len >> 8) & 0xff;
    out.set(bytes, 3);
    return out;
  }
  throw new Error(`pushScriptBytes: payload too large (${len} bytes; max 65535)`);
}

/**
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
 * Mirror of pox-5.clar `push-c-script-num`.
 *
 * Push a ScriptNum onto the stack. Uses single-byte opcodes (`OP_0`,
 * `OP_1`..`OP_16`) for small values and `push-script-bytes(serialize-c-script-num(n))`
 * otherwise.
 */
export function pushCScriptNum(n: number | bigint): Uint8Array {
  const big = typeof n === 'bigint' ? n : BigInt(n);
  if (big === 0n) return new Uint8Array([OP_0]);
  if (big <= 16n) return new Uint8Array([0x50 + Number(big)]); // OP_1 = 0x51, ..., OP_16 = 0x60
  return pushScriptBytes(serializeCScriptNum(big));
}

/**
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

// ---------------------------------------------------------------------------
// Lockup script construction (canonical)
// ---------------------------------------------------------------------------

/**
 * Build the canonical L1 lockup script that the pox-5 contract verifies.
 *
 * This is a byte-for-byte mirror of `construct-lockup-script(staker,
 * unlock-burn-height, unlock-bytes, early-unlock-bytes)` from `pox-5.clar`:
 *
 * ```text
 * <staker-consensus-buff push>   // 22B standard-principal payload
 * OP_DROP
 * OP_IF
 *   <unlock-burn-height push>    // serialized as c-script-num
 *   OP_CHECKLOCKTIMEVERIFY
 *   OP_DROP
 *   <unlock-bytes push>
 * OP_ELSE
 *   <early-unlock-bytes push>
 *   <unlock-bytes push>
 * OP_ENDIF
 * ```
 *
 * The `unlock-bytes` (and `early-unlock-bytes`) tail is opaque to the
 * contract — it can be any push-data buffer, e.g. `<pubkey> OP_CHECKSIG` from
 * {@link buildDefaultUnlockScript} or a multisig descriptor.
 *
 * The `early-unlock-bytes` come from the per-bond `protocol-bonds.early-unlock-signers`
 * configuration on-chain; the SDK does not synthesize them — callers fetch them
 * via `fetchBond(...)` and pass them through.
 *
 * Only standard principals are accepted as `staker` (contract principals
 * cannot stake on L1).
 */
export function buildLockingScript(opts: {
  /** Stacks standard principal of the staker. */
  stxAddress: string;
  /** Burn-block height at which the OP_CLTV branch becomes spendable. */
  unlockHeight: number | bigint;
  /** Tail pushed in BOTH branches (the actual spend-condition). */
  unlockBytes: Uint8Array | string;
  /**
   * Per-bond early-unlock descriptor, pushed before `unlockBytes` in the
   * `OP_ELSE` (early-exit) branch. Sourced from `protocol-bonds.early-unlock-signers`
   * — opaque to the SDK.
   */
  earlyUnlockBytes: Uint8Array | string;
}): Uint8Array {
  const staker = toConsensusBuffStandardPrincipal(opts.stxAddress);
  const unlockBytes =
    typeof opts.unlockBytes === 'string' ? hexToBytes(opts.unlockBytes) : opts.unlockBytes;
  const earlyUnlockBytes =
    typeof opts.earlyUnlockBytes === 'string'
      ? hexToBytes(opts.earlyUnlockBytes)
      : opts.earlyUnlockBytes;

  const stakerPush = pushScriptBytes(staker);
  const heightPush = pushCScriptNum(opts.unlockHeight);
  const unlockPush = pushScriptBytes(unlockBytes);
  const earlyPush = pushScriptBytes(earlyUnlockBytes);

  // Total length: stakerPush || OP_DROP OP_IF || heightPush || OP_CLTV OP_DROP
  //             || unlockPush || OP_ELSE || earlyPush || unlockPush || OP_ENDIF
  const totalLen =
    stakerPush.length +
    2 + // OP_DROP, OP_IF
    heightPush.length +
    2 + // OP_CLTV, OP_DROP
    unlockPush.length +
    1 + // OP_ELSE
    earlyPush.length +
    unlockPush.length +
    1; // OP_ENDIF

  const out = new Uint8Array(totalLen);
  let o = 0;
  out.set(stakerPush, o);
  o += stakerPush.length;
  out[o++] = OP_DROP;
  out[o++] = OP_IF;
  out.set(heightPush, o);
  o += heightPush.length;
  out[o++] = OP_CLTV;
  out[o++] = OP_DROP;
  out.set(unlockPush, o);
  o += unlockPush.length;
  out[o++] = OP_ELSE;
  out.set(earlyPush, o);
  o += earlyPush.length;
  out.set(unlockPush, o);
  o += unlockPush.length;
  out[o++] = OP_ENDIF;
  return out;
}

/**
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
 * Equivalent to {@link computeP2wshOutputScript}({@link buildLockingScript}(...)).
 */
export function buildLockupP2wshOutputScript(opts: {
  stxAddress: string;
  unlockHeight: number | bigint;
  unlockBytes: Uint8Array | string;
  earlyUnlockBytes: Uint8Array | string;
}): Uint8Array {
  return computeP2wshOutputScript(buildLockingScript(opts));
}

/**
 * Build the P2WSH Bitcoin address for an L1 lockup.
 *
 * Combines {@link buildLockingScript} and P2WSH derivation into a single call.
 * Accepts either a pre-encoded `unlockBytes` tail or a compressed `publicKey`
 * (in which case {@link buildDefaultUnlockScript} is used to derive the
 * `<pubkey> OP_CHECKSIG` tail).
 *
 * @example
 * ```ts
 * const address = buildLockingBitcoinAddress({
 *   stxAddress: 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7',
 *   unlockHeight: 850_000,
 *   publicKey: '02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc',
 *   earlyUnlockBytes: bond.earlyUnlockSigners, // from fetchBond(...)
 *   network: 'mainnet',
 * });
 * ```
 */
export function buildLockingBitcoinAddress(opts: {
  stxAddress: string;
  unlockHeight: number | bigint;
  unlockBytes: Uint8Array | string;
  earlyUnlockBytes: Uint8Array | string;
  network: StacksNetworkName | StacksNetwork;
}): string;
export function buildLockingBitcoinAddress(opts: {
  stxAddress: string;
  unlockHeight: number | bigint;
  publicKey: Uint8Array | string;
  earlyUnlockBytes: Uint8Array | string;
  network: StacksNetworkName | StacksNetwork;
}): string;
export function buildLockingBitcoinAddress(opts: {
  stxAddress: string;
  unlockHeight: number | bigint;
  unlockBytes?: Uint8Array | string;
  publicKey?: Uint8Array | string;
  earlyUnlockBytes: Uint8Array | string;
  network: StacksNetworkName | StacksNetwork;
}): string {
  const unlockBytes =
    opts.unlockBytes ?? (opts.publicKey ? buildDefaultUnlockScript(opts.publicKey) : undefined);
  if (!unlockBytes) {
    throw new Error('buildLockingBitcoinAddress: provide either `unlockBytes` or `publicKey`');
  }
  const script = buildLockingScript({
    stxAddress: opts.stxAddress,
    unlockHeight: opts.unlockHeight,
    unlockBytes,
    earlyUnlockBytes: opts.earlyUnlockBytes,
  });
  return lockingScriptToP2wsh(script, networkNameFrom(opts.network));
}

/**
 * @internal @ignore Derive the P2WSH Bitcoin address that commits to the given locking script.
 *
 * Pure: no I/O. Useful when the caller already holds the script bytes (e.g. from
 * {@link buildLockingScript}) and wants to fund the address out-of-band.
 */
export function lockingScriptToP2wsh(
  script: Uint8Array,
  network: StacksNetworkName | StacksNetwork
): string {
  const btcNetwork = BTC_NETWORKS[networkNameFrom(network)];
  const result = btc.p2wsh({ type: 'wsh', script }, btcNetwork);
  if (!result.address) throw new Error('Failed to derive P2WSH address');
  return result.address;
}

// ---------------------------------------------------------------------------
// BTC SPV proof normalization helpers
// ---------------------------------------------------------------------------

/** Hard cap from the contract: `(buff 100000)`. */
const MAX_TX_BYTES = 100_000;

/**
 * Normalize a raw Bitcoin transaction to bytes. Accepts either hex or
 * `Uint8Array`. Enforces the contract's 100,000-byte cap.
 */
export function serializeBitcoinTx(tx: Uint8Array | string): Uint8Array {
  const bytes = typeof tx === 'string' ? hexToBytes(tx) : tx;
  if (bytes.length > MAX_TX_BYTES) {
    throw new Error(
      `serializeBitcoinTx: tx is ${bytes.length} bytes; exceeds the ${MAX_TX_BYTES}-byte contract cap`
    );
  }
  return bytes;
}

/**
 * Normalize an 80-byte Bitcoin block header. Accepts either hex or
 * `Uint8Array`. Throws if the length is not exactly 80.
 */
export function serializeBitcoinHeader(header: Uint8Array | string): Uint8Array {
  const bytes = typeof header === 'string' ? hexToBytes(header) : header;
  if (bytes.length !== 80) {
    throw new Error(`serializeBitcoinHeader: expected 80 bytes, got ${bytes.length}`);
  }
  return bytes;
}

/**
 * Compute the Bitcoin txid in BIG-ENDIAN (display) order — i.e. the
 * double-sha256 of the raw tx, then byte-reversed.
 *
 * Mirrors `get-reversed-txid` in the contract (which returns the
 * little-endian / "internal" form `sha256(sha256(tx))`); this helper returns
 * the reversed form because that's what block explorers and most external
 * tools expect. Reverse the result if you need the contract's
 * `get-reversed-txid` value.
 */
export function computeBitcoinTxid(rawTx: Uint8Array): Uint8Array {
  const inner = sha256(rawTx);
  const outer = sha256(inner);
  // Reverse to big-endian display form.
  const out = new Uint8Array(outer.length);
  for (let i = 0; i < outer.length; i++) out[i] = outer[outer.length - 1 - i];
  return out;
}

/** @ignore Byte-reverse a 32-byte hash (display ⇄ internal little-endian). */
function reverse32(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[bytes.length - 1 - i];
  return out;
}

/** @ignore Constant-no-frills byte equality. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Indexer merkle-proof response, as returned by Esplora-compatible APIs
 * (`GET /tx/:txid/merkle-proof` on Blockstream / mempool.space). `merkle` holds
 * the sibling hashes in **display (big-endian)** order — {@link assembleLockupProof}
 * reverses them to the internal little-endian form the contract expects.
 */
export interface EsploraMerkleProof {
  /** BTC block height containing the tx. */
  block_height: number;
  /** Sibling hashes (display/big-endian hex) along the path leaf → root, bottom-up. */
  merkle: string[];
  /** 0-indexed position of the tx within the block. */
  pos: number;
}

/**
 * Normalize a set of already-fetched indexer responses into the
 * {@link BondL1LockupOutput} tuple `register-for-bond` expects for one L1
 * lockup output. Pure — performs no network I/O; the caller fetches.
 *
 * This deliberately stops short of *building* a proof (parsing a raw block,
 * rebuilding the merkle tree): an Esplora-compatible indexer already does that.
 * What it does absorb are the two transformations that silently produce
 * `ERR_INVALID_MERKLE_PROOF` / `ERR_READ_TX_OUT_OF_BOUNDS` when done by hand:
 *
 * 1. **Witness stripping.** `txHex` from `GET /tx/:txid/hex` is the segwit
 *    serialization (it hashes to the `wtxid`, which is *not* in the merkle
 *    tree). The witness is removed via `@scure/btc-signer` so the stored bytes
 *    are the legacy serialization that hashes to the txid.
 * 2. **Endianness.** Indexer sibling hashes are display/big-endian; the
 *    contract folds over internal little-endian hashes. Each is reversed.
 *
 * The lockup output is located by matching `expectedScript` (the P2WSH
 * `scriptPubKey` from {@link buildLockupP2wshOutputScript}) against the tx's
 * outputs — the same equality the contract asserts — and its sats `amount` is
 * read from the decoded output, so a stale caller-supplied amount can't drift.
 *
 * @example
 * ```ts
 * const expectedScript = buildLockupP2wshOutputScript({ stxAddress, unlockHeight, unlockBytes, earlyUnlockBytes });
 * const output = assembleLockupProof({
 *   txHex: await (await fetch(`${esplora}/tx/${txid}/hex`)).text(),
 *   header: await (await fetch(`${esplora}/block/${blockHash}/header`)).text(),
 *   merkleProof: await (await fetch(`${esplora}/tx/${txid}/merkle-proof`)).json(),
 *   txCount: (await (await fetch(`${esplora}/block/${blockHash}`)).json()).tx_count,
 *   expectedScript,
 * });
 * // → buildRegisterForBond({ lockup: { kind: 'btc', outputs: [output], unlockBytes }, ... })
 * ```
 */
export function assembleLockupProof(input: {
  /** Raw tx hex (`GET /tx/:txid/hex`). May be segwit-serialized; the witness is stripped. */
  txHex: string;
  /** 80-byte block header (`GET /block/:hash/header`), hex or bytes. */
  header: Uint8Array | string;
  /** Esplora-compatible merkle-proof response (`GET /tx/:txid/merkle-proof`). */
  merkleProof: EsploraMerkleProof;
  /** Total tx count in the block (`GET /block/:hash` → `tx_count`). */
  txCount: number;
  /** Expected P2WSH `scriptPubKey` (34 bytes) — see {@link buildLockupP2wshOutputScript}. */
  expectedScript: Uint8Array | string;
}): BondL1LockupOutput {
  const tx = btc.Transaction.fromRaw(hexToBytes(input.txHex), {
    allowUnknownOutputs: true,
    disableScriptCheck: true,
  });
  // (withScriptSig, withWitness=false) → legacy bytes that hash to the txid.
  const legacy = tx.toBytes(true, false);

  const expectedScript =
    typeof input.expectedScript === 'string'
      ? hexToBytes(input.expectedScript)
      : input.expectedScript;

  let outputIndex = -1;
  let amount = 0n;
  for (let i = 0; i < tx.outputsLength; i++) {
    const output = tx.getOutput(i);
    if (output.script && bytesEqual(output.script, expectedScript)) {
      outputIndex = i;
      amount = output.amount ?? 0n;
      break;
    }
  }
  if (outputIndex === -1) {
    throw new Error('assembleLockupProof: no output matches the expected lockup script');
  }

  return {
    height: input.merkleProof.block_height,
    tx: serializeBitcoinTx(legacy),
    outputIndex,
    header: serializeBitcoinHeader(input.header),
    leafHashes: input.merkleProof.merkle.map(h => reverse32(hexToBytes(h))),
    txCount: input.txCount,
    txIndex: input.merkleProof.pos,
    amount,
  };
}

// ---------------------------------------------------------------------------
// Unlock-height helpers
// ---------------------------------------------------------------------------

/**
 * Compute the deterministic L1 unlock height for a STAKER lock.
 *
 * Set to halfway through the staker's last cycle (i.e.
 * {@link rewardCycleToUnlockHeight} of `firstRewardCycle + numCycles - 1`),
 * giving time to re-lock without missing a cycle.
 */
export function computeUnlockHeight(opts: {
  firstRewardCycle: number;
  numCycles: number;
  poxInfo: PoxInfo;
}): number {
  return rewardCycleToUnlockHeight({
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
  const endBurnHeight = rewardCycleToBurnHeight({ cycle: endCycle, poxInfo: opts.poxInfo });
  return endBurnHeight - Math.floor(opts.poxInfo.rewardCycleLength / 2);
}
