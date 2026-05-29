import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, type PrivateKey } from '@stacks/common';
import { verifyMessageSignatureRsv } from '@stacks/encryption';
import {
  Cl,
  type ClarityValue,
  encodeStructuredDataBytes,
  signStructuredData,
} from '@stacks/transactions';
import type { SignerKeyGrantOptions } from './types';

// ---------------------------------------------------------------------------
// SIP-018 message + domain builder (pure — exposed for tests / advanced use)
// ---------------------------------------------------------------------------

/**
 * Build the SIP-018 structured-data tuple and domain that authorize a
 * signer-key grant.
 *
 * Mirrors pox-5's `get-signer-grant-message-hash`, which hashes:
 *
 *   message: { topic: "grant-authorization",
 *              signer-manager: <principal>,
 *              auth-id:        <uint> }
 *   domain:  { name: "pox-5-signer", version: "1.0.0", chain-id: <uint> }
 *
 * The returned `{ message, domain }` can be fed directly into
 * {@link signStructuredData} / {@link encodeStructuredDataBytes}.
 */
export function signerKeyGrantMessage(opts: SignerKeyGrantOptions): {
  message: ClarityValue;
  domain: ClarityValue;
} {
  const message = Cl.tuple({
    topic: Cl.stringAscii('grant-authorization'),
    'signer-manager': Cl.address(opts.signerManager),
    'auth-id': Cl.uint(opts.authId),
  });

  const domain = Cl.tuple({
    name: Cl.stringAscii('pox-5-signer'),
    version: Cl.stringAscii('1.0.0'),
    'chain-id': Cl.uint(opts.chainId),
  });

  return { message, domain };
}

// ---------------------------------------------------------------------------
// SIP-018 message hash
// ---------------------------------------------------------------------------

/**
 * 32-byte SHA-256 over the SIP-018 envelope `prefix || domain-hash ||
 * message-hash`. Equivalent to `pox-5.get-signer-grant-message-hash` —
 * useful as an off-chain check against the read-only.
 */
export function getSignerKeyGrantMessageHash(opts: SignerKeyGrantOptions): Uint8Array {
  return sha256(encodeStructuredDataBytes(signerKeyGrantMessage(opts)));
}

// ---------------------------------------------------------------------------
// Sign
// ---------------------------------------------------------------------------

/**
 * Sign a signer-key grant. Returns a 65-byte recoverable signature in RSV
 * order, hex-encoded.
 */
export function signSignerKeyGrant(
  opts: SignerKeyGrantOptions & { privateKey: PrivateKey }
): string {
  return signStructuredData({
    ...signerKeyGrantMessage(opts),
    privateKey: opts.privateKey,
  });
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

/**
 * Verify a signer-key grant signature locally. Recovers the public key from
 * the RSV signature against the SIP-018 message hash and compares it to the
 * supplied `publicKey`.
 */
export function verifySignerKeyGrant(
  opts: SignerKeyGrantOptions & {
    publicKey: string | Uint8Array;
    signature: string | Uint8Array;
  }
): boolean {
  return verifyMessageSignatureRsv({
    message: getSignerKeyGrantMessageHash(opts),
    publicKey: typeof opts.publicKey === 'string' ? opts.publicKey : bytesToHex(opts.publicKey),
    signature: typeof opts.signature === 'string' ? opts.signature : bytesToHex(opts.signature),
  });
}
