import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, type PrivateKey } from '@stacks/common';
import { verifyMessageSignatureRsv } from '@stacks/encryption';
import {
  type BufferCV,
  Cl,
  ClarityType,
  type ClarityValue,
  deserializeCV,
  encodeStructuredDataBytes,
  serializeCVBytes,
  signStructuredData,
  type TupleCV,
} from '@stacks/transactions';
import { parse as parseBtcAddress, type BtcAddressRepr } from './btc-address';
import type { PoXAddressVersion } from './constants';
import type { SignerCalldataL1Payout, SignerKeyGrantOptions } from './types';

/**
 * Build the SIP-018 structured-data tuple and domain that authorize a
 * signer-key grant.
 *
 * Mirrors `pox-5.get-signer-grant-message-hash`, which hashes:
 *
 *   message: { topic: "grant-authorization",
 *              signer-manager: <principal>,
 *              auth-id:        <uint> }
 *   domain:  { name: "pox-5-signer", version: "1.0.0", chain-id: <uint> }
 *
 * The returned `{ message, domain }` can be fed directly into
 * {@link signStructuredData} / {@link encodeStructuredDataBytes}.
 */
export function buildSignerGrantMessage(opts: SignerKeyGrantOptions): {
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

/**
 * 32-byte SHA-256 over the SIP-018 envelope `prefix || domain-hash ||
 * message-hash`. Equivalent to `pox-5.get-signer-grant-message-hash` —
 * useful as an off-chain check against the read-only.
 */
export function computeSignerGrantHash(opts: SignerKeyGrantOptions): Uint8Array {
  return sha256(encodeStructuredDataBytes(buildSignerGrantMessage(opts)));
}

/**
 * Sign a signer-key grant. Returns a 65-byte recoverable signature in RSV
 * order, hex-encoded.
 */
export function signSignerGrant(opts: SignerKeyGrantOptions & { privateKey: PrivateKey }): string {
  return signStructuredData({
    ...buildSignerGrantMessage(opts),
    privateKey: opts.privateKey,
  });
}

/**
 * Verify a signer-key grant signature locally. Recovers the public key from
 * the RSV signature against the SIP-018 message hash and compares it to the
 * supplied `publicKey`.
 */
export function verifySignerGrant(
  opts: SignerKeyGrantOptions & {
    publicKey: string | Uint8Array;
    signature: string | Uint8Array;
  }
): boolean {
  return verifyMessageSignatureRsv({
    message: computeSignerGrantHash(opts),
    publicKey: typeof opts.publicKey === 'string' ? opts.publicKey : bytesToHex(opts.publicKey),
    signature: typeof opts.signature === 'string' ? opts.signature : bytesToHex(opts.signature),
  });
}

/**
 * Encode the `signerCalldata` blob that elects an L1 BTC payout. `(some …)`
 * pays rewards as native BTC to the given address; omitting `signerCalldata`
 * keeps the sBTC default. A custom signer-manager may define its own schema.
 *
 * @example
 * ```ts
 * import { buildSignerCalldata, buildStake } from '@stacks/bitcoin-staking';
 *
 * const signerCalldata = buildSignerCalldata({
 *   poxAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
 *   maxFeeSats: 1000n,
 * });
 * await buildStake({ ...args, signerCalldata });
 * ```
 *
 * Mirrors the `signer-manager.validate-stake!` calldata tuple.
 */
export function buildSignerCalldata(opts: SignerCalldataL1Payout): Uint8Array {
  const { version, data } =
    typeof opts.poxAddress === 'string' ? parseBtcAddress(opts.poxAddress) : opts.poxAddress;
  return serializeCVBytes(
    Cl.tuple({
      'pox-addr': Cl.tuple({
        version: Cl.buffer(Uint8Array.of(version)),
        hashbytes: Cl.buffer(data),
      }),
      'max-fee': Cl.uint(opts.maxFeeSats),
    })
  );
}

/**
 * Decode a `signerCalldata` blob into its destination address and max fee.
 * Inverse of {@link buildSignerCalldata}.
 *
 * @example
 * ```ts
 * import { BtcAddress, parseSignerCalldata } from '@stacks/bitcoin-staking';
 *
 * const { poxAddress, maxFeeSats } = parseSignerCalldata(signerCalldata);
 * BtcAddress.stringify(poxAddress, 'mainnet'); // 'bc1q...'
 * ```
 */
export function parseSignerCalldata(calldata: Uint8Array | string): {
  poxAddress: BtcAddressRepr;
  maxFeeSats: bigint;
} {
  const cv = deserializeCV(calldata);
  if (cv.type !== ClarityType.Tuple || !('pox-addr' in cv.value) || !('max-fee' in cv.value)) {
    throw new Error('Invalid signer calldata: expected a `{ pox-addr, max-fee }` tuple');
  }

  const poxAddrCV = cv.value['pox-addr'] as TupleCV;
  const maxFeeCV = cv.value['max-fee'];
  if (poxAddrCV.type !== ClarityType.Tuple || maxFeeCV.type !== ClarityType.UInt) {
    throw new Error('Invalid signer calldata: unexpected `pox-addr` or `max-fee` types');
  }

  const versionCV = poxAddrCV.value['version'] as BufferCV;
  const hashbytesCV = poxAddrCV.value['hashbytes'] as BufferCV;
  if (versionCV?.type !== ClarityType.Buffer || hashbytesCV?.type !== ClarityType.Buffer) {
    throw new Error('Invalid signer calldata: expected buffer `version` and `hashbytes`');
  }

  return {
    poxAddress: {
      version: hexToBytes(versionCV.value)[0] as PoXAddressVersion,
      data: hexToBytes(hashbytesCV.value),
    },
    maxFeeSats: BigInt(maxFeeCV.value),
  };
}
