// @ts-ignore — @scure/bip32 is ESM; ts-jest transforms it via jest.config.js
import { HDKey } from '@scure/bip32';
// @ts-ignore — same ESM transform
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@stacks/common';
import { buildUnlockScript } from '../../src';

/**
 * KMS-backed early-exit ("early-unlock") signing service.
 *
 * The service holds the early-unlock PRIVATE key in KMS and exposes:
 *   GET  /v1/public-key  → { key_id, xpub, derivation_path, fingerprint, network }
 *   POST /v1/sign        → { signature (DER), sighash, public_key, sighash_type }
 *
 * NOTE: the routes live under the `/v1` *stage* AND a `/v1` path prefix, so the
 * real URLs are `…/v1/v1/public-key` and `…/v1/v1/sign`.
 *
 * `xpub` is the account-level extended public key (path `48'/1'/0'/2'` on
 * testnet). The bond's `early-unlock-bytes` must embed the EXACT leaf public key
 * `/sign` signs with. `/sign` takes the FULL BIP-32 path (`m/48'/1'/0'/2'/<leaf>`)
 * and we derive the same leaf locally from the xpub — so both sides land on the
 * identical key. Verified end-to-end in early-unlock-key-verify.test.ts.
 *
 * The early-unlock key is wipe-stable, so the derived leaf pubkey — and therefore
 * `early-unlock-bytes` — is stable across private-testnet resets.
 */

export const EARLY_UNLOCK_API =
  process.env.EARLY_UNLOCK_API ?? 'https://r25rniyw12.execute-api.eu-west-1.amazonaws.com/v1/v1';

/** Unhardened leaf below the account-level xpub. `/sign` derives the same leaf. */
export const EARLY_UNLOCK_LEAF = process.env.EARLY_UNLOCK_LEAF ?? '0/0';

// BIP-32 version bytes. testnet xpubs are `tpub…`; mainnet `xpub…`.
const TESTNET_VERSIONS = { private: 0x04358394, public: 0x043587cf };
const MAINNET_VERSIONS = { private: 0x0488ade4, public: 0x0488b21e };

export interface EarlyUnlockKey {
  keyId: number;
  xpub: string;
  /** Hardened account path WITHOUT the leading `m/`, e.g. `48'/1'/0'/2'`. */
  derivationPath: string;
  fingerprint: string;
  network: string;
}

/**
 * Fetch the early-unlock xpub + metadata. Returns null if the endpoint is absent OR
 * unreachable (firewall/offline) — so mock-mode / no-network suite runs honest-SKIP
 * instead of failing. Live (reachable) runs return the real key.
 */
export async function fetchEarlyUnlockKey(): Promise<EarlyUnlockKey | null> {
  let res: Response;
  try {
    res = await fetch(`${EARLY_UNLOCK_API}/public-key`);
  } catch {
    return null; // network unreachable (offline / firewall) → skip
  }
  if (!res.ok) return null;
  const j = (await res.json()) as {
    key_id: number;
    xpub: string;
    derivation_path: string;
    fingerprint: string;
    network: string;
  };
  return {
    keyId: j.key_id,
    xpub: j.xpub,
    derivationPath: j.derivation_path,
    fingerprint: j.fingerprint,
    network: j.network,
  };
}

/** The full BIP-32 path `/sign` expects: `m/<account>/<leaf>`. */
export function fullDerivationPath(accountPath: string, leaf: string = EARLY_UNLOCK_LEAF): string {
  return `m/${accountPath}/${leaf}`;
}

/**
 * Derive the 33-byte compressed leaf public key from the account-level xpub.
 * This is the pubkey that goes into `buildUnlockScript` → `early-unlock-bytes`.
 */
export function deriveEarlyUnlockPubkey(xpub: string, leaf: string = EARLY_UNLOCK_LEAF): Uint8Array {
  const versions = xpub.startsWith('t') ? TESTNET_VERSIONS : MAINNET_VERSIONS;
  const leafKey = HDKey.fromExtendedKey(xpub, versions).derive(`m/${leaf}`);
  if (!leafKey.publicKey || leafKey.publicKey.length !== 33) {
    throw new Error('deriveEarlyUnlockPubkey: expected a 33-byte compressed public key on the leaf');
  }
  return leafKey.publicKey;
}

/** Convenience: xpub → the bond's `early-unlock-bytes` (`<early-unlock-pubkey> OP_CHECKSIG`). */
export function earlyUnlockBytesHexFromXpub(xpub: string, leaf: string = EARLY_UNLOCK_LEAF): string {
  return bytesToHex(buildUnlockScript(deriveEarlyUnlockPubkey(xpub, leaf)));
}

export interface EarlyUnlockSignResult {
  /** DER-encoded ECDSA signature (low-S), NO trailing sighash byte. */
  signature: string;
  /** The 32-byte digest the service signed, hex. */
  sighash: string;
  /** The 33-byte compressed pubkey the service signed with, hex. */
  publicKey: string;
  sighashType: string;
}

/**
 * Ask the service to sign a P2WSH input of an unsigned reclaim tx (BIP-143).
 * Returns the DER signature + the sighash + pubkey it used, or null if the
 * endpoint is absent. Mirrors POST /v1/sign exactly.
 */
export async function signViaEarlyUnlockApi(opts: {
  txHex: string;
  inputIndex: number;
  bip32Derivation: string;
  prevoutScriptPubKeyHex: string;
  prevoutValueSats: number | bigint;
  witnessScriptHex: string;
  sighashTypeHex?: string;
}): Promise<EarlyUnlockSignResult | null> {
  let res: Response;
  try {
    res = await fetch(`${EARLY_UNLOCK_API}/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tx: opts.txHex,
        input_index: opts.inputIndex,
        sighash_type: opts.sighashTypeHex ?? '01',
        bip32_derivation: opts.bip32Derivation,
        prevout: {
          script_pub_key: opts.prevoutScriptPubKeyHex,
          value: Number(opts.prevoutValueSats),
        },
        witness_script: opts.witnessScriptHex,
      }),
    });
  } catch {
    return null; // network unreachable → skip
  }
  if (!res.ok) return null;
  const j = (await res.json()) as {
    signature: string;
    sighash: string;
    public_key: string;
    sighash_type: string;
  };
  return {
    signature: j.signature,
    sighash: j.sighash,
    publicKey: j.public_key,
    sighashType: j.sighash_type,
  };
}

/**
 * Verify a DER ECDSA signature over an already-final Bitcoin sighash.
 *
 * CRITICAL: `@noble/curves` v2 `verify` defaults to `prehash: true` (it sha256's
 * the message first). Bitcoin sighashes are the final digest, so we MUST pass
 * `{ prehash: false }` — otherwise a valid signature reads as invalid.
 */
export function verifyEarlyUnlockSig(
  sigDerHex: string,
  sighashHex: string,
  publicKey: Uint8Array | string
): boolean {
  let der = hexToBytes(sigDerHex);
  // tolerate a trailing SIGHASH byte on a DER sig
  if (der[0] === 0x30 && der[der.length - 1] === 0x01) der = der.slice(0, -1);
  const compact = secp256k1.Signature.fromBytes(der, 'der').toBytes('compact');
  const pub = typeof publicKey === 'string' ? hexToBytes(publicKey) : publicKey;
  return secp256k1.verify(compact, hexToBytes(sighashHex), pub, { prehash: false });
}
