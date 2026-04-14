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
  unlockBytes: Uint8Array | string;
}): Uint8Array {
  const unlock =
    typeof opts.unlockBytes === 'string' ? hexToBytes(opts.unlockBytes) : opts.unlockBytes;

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
 * Derive the P2WSH address for a locking script.
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
