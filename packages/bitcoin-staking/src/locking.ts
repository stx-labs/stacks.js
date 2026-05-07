import * as btc from '@scure/btc-signer';
import { hexToBytes } from '@stacks/common';
import type { StacksNetwork, StacksNetworkName } from '@stacks/network';
import { Address } from '@stacks/transactions';
import { networkNameFrom } from './network';

const REGTEST_NETWORK = { bech32: 'bcrt', pubKeyHash: 111, scriptHash: 196, wif: 239 };

const BTC_NETWORKS: Record<StacksNetworkName, typeof btc.NETWORK> = {
  mainnet: btc.NETWORK,
  testnet: btc.TEST_NETWORK,
  devnet: REGTEST_NETWORK,
  mocknet: REGTEST_NETWORK,
};

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

/**
 * Build the full P2WSH locking script for PoX-5 Bitcoin staking.
 *
 * The node constructs this same script from the `unlockBytes` submitted
 * on-chain. The prefix is deterministic, parameterized by the Stacks
 * address and unlock height.
 *
 * Layout (per spec):
 * ```
 * <stxAddressPayload 22B>  OP_DROP
 * <unlockHeight>           OP_CHECKLOCKTIMEVERIFY  OP_DROP
 * <unlockBytes>            (arbitrary, up to 683 bytes)
 * ```
 */
export function buildLockingScript(opts: {
  stxAddress: string;
  unlockHeight: number;
  /** Pre-encoded unlock-script tail. Mutually exclusive with `earlyExitPubkeys`. */
  unlockBytes?: Uint8Array | string;
  /**
   * Early-exit signer pubkeys (compressed, hex). When provided, the unlock-script
   * tail is constructed as a multisig spendable by `earlyExitThreshold`-of-N.
   * Mutually exclusive with `unlockBytes`.
   *
   * unsure: exact early-exit script encoding — see `unsure/flow-5.md`. The
   * contract stores a 683-byte opaque `early-unlock-signers` descriptor; how that
   * maps to a discrete pubkey list is not specified. This implementation emits a
   * standard Bitcoin `OP_<M> <pubkey...> OP_<N> OP_CHECKMULTISIG` tail as a
   * placeholder.
   */
  earlyExitPubkeys?: string[];
  /** Threshold M for the M-of-N early-exit multisig. Defaults to 1. */
  earlyExitThreshold?: number;
}): Uint8Array {
  let unlock: Uint8Array;
  if (opts.unlockBytes !== undefined) {
    unlock =
      typeof opts.unlockBytes === 'string' ? hexToBytes(opts.unlockBytes) : opts.unlockBytes;
  } else if (opts.earlyExitPubkeys !== undefined) {
    unlock = buildEarlyExitUnlockScript({
      pubkeys: opts.earlyExitPubkeys,
      threshold: opts.earlyExitThreshold ?? 1,
    });
  } else {
    throw new Error('buildLockingScript: provide either `unlockBytes` or `earlyExitPubkeys`');
  }

  // Stacks address payload: 0x05 || version (1 byte) || hash160 (20 bytes) = 22 bytes
  const parsed = Address.parse(opts.stxAddress) as { version: number; hash160: string };
  const addrPayload = new Uint8Array(22);
  addrPayload[0] = 0x05;
  addrPayload[1] = parsed.version;
  addrPayload.set(hexToBytes(parsed.hash160), 2);

  const heightNum = btc.ScriptNum().encode(BigInt(opts.unlockHeight));

  // Inline the unlock script ops so the full script is a single flat encoding
  const unlockOps = btc.Script.decode(unlock);

  return btc.Script.encode([
    addrPayload,
    'DROP',
    heightNum,
    'CHECKLOCKTIMEVERIFY',
    'DROP',
    ...unlockOps,
  ]);
}

/**
 * Build the P2WSH Bitcoin address for a PoX-5 locking script.
 *
 * Combines {@link buildLockingScript} and P2WSH derivation into a single call.
 */
export function buildLockingBitcoinAddress(opts: {
  stxAddress: string;
  unlockHeight: number;
  unlockBytes: Uint8Array | string;
  network: StacksNetworkName | StacksNetwork;
}): string {
  const script = buildLockingScript(opts);
  return lockingScriptToP2wsh(script, networkNameFrom(opts.network));
}

/**
 * Derive the P2WSH Bitcoin address that commits to the given locking script.
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

/**
 * Build a standard `M-of-N CHECKMULTISIG` unlock-script tail for the early-exit
 * branch of a paired-BTC lockup.
 *
 * unsure: real on-chain shape. The PoX-5 contract stores `early-unlock-signers`
 * as an opaque 683-byte buffer descriptor (see `setup-bond` in `pox-5.clar`).
 * The exact wire format that the L1 verifier matches is not yet specified; this
 * helper emits a vanilla Bitcoin multisig tail as a working placeholder so that
 * downstream P2WSH derivation produces stable addresses for testing.
 */
export function buildEarlyExitUnlockScript(opts: {
  pubkeys: string[];
  threshold: number;
}): Uint8Array {
  const { pubkeys, threshold } = opts;
  if (pubkeys.length === 0) throw new Error('earlyExitPubkeys must be non-empty');
  if (threshold < 1 || threshold > pubkeys.length) {
    throw new Error('earlyExitThreshold out of range');
  }
  const pubBytes = pubkeys.map(p => {
    const bytes = hexToBytes(p);
    if (bytes.length !== 33) throw new Error('Expected 33-byte compressed public key');
    return bytes;
  });
  // missing: contract-defined early-exit script shape — emits a generic
  // M-of-N multisig pending the spec.
  return btc.Script.encode([
    smallNumOp(threshold),
    ...pubBytes,
    smallNumOp(pubBytes.length),
    'CHECKMULTISIG',
  ]);
}

/** @ignore Map 1..16 to its OP_N token. */
function smallNumOp(n: number) {
  if (n < 1 || n > 16) throw new Error(`OP_N out of range: ${n}`);
  return ([
    'OP_1', 'OP_2', 'OP_3', 'OP_4', 'OP_5', 'OP_6', 'OP_7', 'OP_8',
    'OP_9', 'OP_10', 'OP_11', 'OP_12', 'OP_13', 'OP_14', 'OP_15', 'OP_16',
  ] as const)[n - 1];
}

/**
 * Compute the deterministic L1 unlock height for a staking commitment.
 * Set to halfway through the staker's last cycle, giving time to re-lock
 * without missing a cycle.
 */
export function computeUnlockHeight(opts: {
  firstRewardCycle: number;
  numCycles: number;
  rewardCycleLength: number;
  firstBurnchainBlockHeight: number;
}): number {
  const lastCycleStart =
    opts.firstBurnchainBlockHeight +
    (opts.firstRewardCycle + opts.numCycles - 1) * opts.rewardCycleLength;
  return lastCycleStart + Math.floor(opts.rewardCycleLength / 2);
}
