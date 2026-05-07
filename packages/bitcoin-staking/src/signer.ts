import { sha256 } from '@noble/hashes/sha2.js';
import type { PrivateKey } from '@stacks/common';
import { verifyMessageSignatureRsv } from '@stacks/encryption';
import { networkFrom } from '@stacks/network';
import { Cl, encodeStructuredDataBytes, signStructuredData } from '@stacks/transactions';
import { toPoxTuple } from './btc-address';
import type { Pox5SignatureOptions, SignerKeyGrantOptions } from './types';

// ---------------------------------------------------------------------------
// Message builders (pure — exposed for testing / advanced usage)
// ---------------------------------------------------------------------------

/** Build the SIP-018 structured data message + domain for a PoX-5 signer authorization. */
export function pox5SignatureMessage(opts: Pox5SignatureOptions) {
  const network = networkFrom(opts.network);
  const message = Cl.tuple({
    'pox-addr': toPoxTuple(opts.poxAddress),
    'reward-cycle': Cl.uint(opts.rewardCycle),
    topic: Cl.stringAscii(opts.topic),
    period: Cl.uint(opts.period),
    'max-amount': Cl.uint(opts.maxAmount),
    'auth-id': Cl.uint(opts.authId),
  });
  const domain = Cl.tuple({
    name: Cl.stringAscii('pox-5-signer'),
    version: Cl.stringAscii('1.0.0'),
    'chain-id': Cl.uint(network.chainId),
  });
  return { message, domain };
}

/**
 * Build the SIP-018 structured data message + domain for a signer-key grant.
 *
 * Mirrors `pox-5::get-signer-grant-message-hash`, which hashes the tuple
 * `{topic: "grant-authorization", signer-manager: <principal>, auth-id: <uint>}`
 * under the `POX_5_SIGNER_DOMAIN`.
 */
export function signerKeyGrantMessage(opts: SignerKeyGrantOptions) {
  const network = networkFrom(opts.network);

  const message = Cl.tuple({
    topic: Cl.stringAscii('grant-authorization'),
    'signer-manager': Cl.address(opts.signerManager),
    'auth-id': Cl.uint(opts.authId),
  });

  const domain = Cl.tuple({
    name: Cl.stringAscii('pox-5-signer'),
    version: Cl.stringAscii('1.0.0'),
    'chain-id': Cl.uint(network.chainId),
  });

  return { message, domain };
}

// ---------------------------------------------------------------------------
// Sign
// ---------------------------------------------------------------------------

/** Generate a PoX-5 signer authorization signature (SIP-018 structured data). */
export function signPox5Authorization(
  opts: Pox5SignatureOptions & { privateKey: PrivateKey }
): string {
  return signStructuredData({
    ...pox5SignatureMessage(opts),
    privateKey: opts.privateKey,
  });
}

/** Generate a signer key grant signature (SIP-018 structured data). */
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

/** Verify a PoX-5 signer authorization signature locally. */
export function verifyPox5Authorization(
  opts: Pox5SignatureOptions & { publicKey: string; signature: string }
): boolean {
  return verifyMessageSignatureRsv({
    message: sha256(encodeStructuredDataBytes(pox5SignatureMessage(opts))),
    publicKey: opts.publicKey,
    signature: opts.signature,
  });
}

/** Verify a signer key grant signature locally. */
export function verifySignerKeyGrant(
  opts: SignerKeyGrantOptions & { publicKey: string; signature: string }
): boolean {
  return verifyMessageSignatureRsv({
    message: sha256(encodeStructuredDataBytes(signerKeyGrantMessage(opts))),
    publicKey: opts.publicKey,
    signature: opts.signature,
  });
}
