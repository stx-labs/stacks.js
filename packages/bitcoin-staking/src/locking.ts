import * as btc from '@scure/btc-signer';
import { hexToBytes } from '@stacks/common';
import type { StacksNetworkName } from '@stacks/network';
import { Address } from '@stacks/transactions';
import { toPoxTuple } from './btc-address';

// ---------------------------------------------------------------------------
// Default unlock script
// ---------------------------------------------------------------------------

/**
 * Build the default unlock script: `<compressedPubKey> OP_CHECKSIG`.
 *
 * This is the simplest spend condition — a single signature from the given
 * public key. Compatible with any wallet, including hardware wallets (Ledger).
 *
 * Users may provide their own custom `unlockBytes` instead, but our
 * validation helpers only support this default format.
 */
export function buildDefaultUnlockScript(compressedPubKey: Uint8Array | string): Uint8Array {
  const pubKeyBytes =
    typeof compressedPubKey === 'string' ? hexToBytes(compressedPubKey) : compressedPubKey;

  if (pubKeyBytes.length !== 33) {
    throw new Error('Expected a 33-byte compressed public key');
  }

  return btc.Script.encode([pubKeyBytes, 'CHECKSIG']);
}

/**
 * Validate that `unlockBytes` matches the default format (`<pubkey> OP_CHECKSIG`).
 *
 * Returns the extracted compressed public key if valid, or `undefined` if the
 * script doesn't match the default shape.
 */
export function parseDefaultUnlockScript(
  unlockBytes: Uint8Array | string
): Uint8Array | undefined {
  const bytes = typeof unlockBytes === 'string' ? hexToBytes(unlockBytes) : unlockBytes;

  try {
    const decoded = btc.Script.decode(bytes);

    // Expect exactly [Uint8Array(33), 'CHECKSIG']
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
// Full locking script
// ---------------------------------------------------------------------------

/**
 * Build the full P2WSH locking script for PoX-5 Bitcoin staking.
 *
 * The node constructs this same script from the `unlockBytes` submitted
 * on-chain. The prefix is fixed and parameterized by the Stacks address
 * and unlock height.
 *
 * Layout (per spec):
 * ```
 * <stxAddressPayload 22 bytes>  OP_DROP
 * <unlockHeight>                OP_CHECKLOCKTIMEVERIFY  OP_DROP
 * <unlockBytes>                 (arbitrary, up to 683 bytes)
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

  // Unlock height as a Bitcoin script number (variable-length)
  const heightScriptNum = btc.ScriptNum().encode(BigInt(opts.unlockHeight));

  // Decode the unlock bytes so we can inline them into the script array
  const unlockOps = btc.Script.decode(unlock);

  return btc.Script.encode([
    addrPayload,
    'DROP',
    heightScriptNum,
    'CHECKLOCKTIMEVERIFY',
    'DROP',
    ...unlockOps,
  ]);
}

/**
 * Derive a P2WSH address from a witness script.
 */
export function lockingScriptToP2wsh(
  script: Uint8Array,
  network: StacksNetworkName
): string {
  const p2wsh = btc.p2wsh(btc.p2wsh(script, undefined as unknown as typeof btc.NETWORK));
  // Use our own address encoding to respect Stacks network names
  // p2wsh internally is SHA256(script) → bech32 segwit v0
  const { sha256 } = require('@noble/hashes/sha256');
  const { bech32 } = require('@scure/base');
  const { SEGWIT_V0, SegwitPrefix } = require('./constants');

  const hash = sha256(script);
  const words = bech32.toWords(hash);
  return bech32.encode(SegwitPrefix[network], [SEGWIT_V0, ...words]);
}
