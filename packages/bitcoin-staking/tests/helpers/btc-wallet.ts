/**
 * Reusable BTC wallet helpers for live privatenet tests.
 * Uses the mempool/esplora HTTP API + BTC faucet — no regtest RPC required.
 *
 * All helpers read MEMPOOL_BASE and FAUCET_URL from environment defaults or the
 * constants exported here. They work with @scure/btc-signer (P2WPKH) and
 * @noble/curves for key operations.
 *
 * NOTE: these helpers bypass jest-fetch-mock — they call the real globalThis.fetch
 * directly so they don't accidentally trigger the mock in replay mode. In RECORD
 * mode the global fetch wrapper in utils.ts already records every call.
 */

// @ts-ignore — ESM; ts-jest transforms via jest.config.js
import * as btc from '@scure/btc-signer';
// @ts-ignore — same
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@stacks/common';

// ─── Constants ──────────────────────────────────────────────────────────────

export const MEMPOOL_BASE = 'https://mempool.bitcoin.private-1.hiro.so/api';
export const FAUCET_URL = 'https://api.private-1.hiro.so/extended/v1/faucets/btc';

/**
 * The private-testnet "regtest" BTC network params. Uses bech32 prefix 'bcrt'
 * so addresses are regtest-style (bcrt1…), which is what the private-1 node expects.
 */
export const REGTEST: typeof btc.NETWORK = {
  bech32: 'bcrt',
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

// ─── Key helpers ────────────────────────────────────────────────────────────

/** Derive a compressed 33-byte secp256k1 pubkey from a 32-byte raw private key. */
export function derivePubKey(privKey: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(privKey, true);
}

/** Derive a P2WPKH address string from a 32-byte raw private key. */
export function privKeyToP2wpkhAddress(privKey: Uint8Array): string {
  const pub = derivePubKey(privKey);
  return btc.p2wpkh(pub, REGTEST).address!;
}

/** Derive the P2WPKH scriptPubKey hex from a 32-byte raw private key. */
export function privKeyToP2wpkhScriptHex(privKey: Uint8Array): string {
  const pub = derivePubKey(privKey);
  return bytesToHex(btc.p2wpkh(pub, REGTEST).script);
}

// ─── UTXO type ──────────────────────────────────────────────────────────────

export interface Utxo {
  txid: string;
  vout: number;
  value: bigint;
  scriptPubKey: Uint8Array;
}

// ─── Core helpers ────────────────────────────────────────────────────────────

/**
 * POST the BTC faucet for `address` (xlarge=true → ~1 BTC).
 * Returns the faucet txid, or throws if the faucet request fails.
 */
export async function faucetFund(address: string): Promise<string> {
  const url = `${FAUCET_URL}?address=${encodeURIComponent(address)}&xlarge=true`;
  const resp = await fetch(url, { method: 'POST' });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`faucet returned ${resp.status}: ${body}`);
  }
  const json = (await resp.json()) as { txid?: string };
  console.log(`[btc-wallet] faucet funded ${address}:`, JSON.stringify(json));
  return json.txid ?? '';
}

/**
 * Fetch confirmed spendable UTXOs for `address` via /address/{addr}/txs.
 * (The /utxo endpoint 404s on the hosted mempool instance.)
 * Only returns outputs matching `scriptHex` that haven't been spent by another
 * tx in the same page of transactions.
 */
export async function getUtxos(
  address: string,
  scriptHex: string,
): Promise<Utxo[]> {
  const resp = await fetch(`${MEMPOOL_BASE}/address/${address}/txs`);
  if (!resp.ok) throw new Error(`GET /address/${address}/txs → ${resp.status}`);
  const txs = (await resp.json()) as Array<{
    txid: string;
    vin: Array<{ txid: string; vout: number }>;
    vout: Array<{ value: number; scriptpubkey: string }>;
    status: { confirmed: boolean };
  }>;

  const spent = new Set<string>();
  for (const tx of txs) {
    for (const inp of tx.vin) {
      spent.add(`${inp.txid}:${inp.vout}`);
    }
  }

  const utxos: Utxo[] = [];
  for (const tx of txs) {
    if (!tx.status.confirmed) continue;
    tx.vout.forEach((out, idx) => {
      if (out.scriptpubkey !== scriptHex) return;
      if (spent.has(`${tx.txid}:${idx}`)) return;
      utxos.push({
        txid: tx.txid,
        vout: idx,
        value: BigInt(out.value),
        scriptPubKey: hexToBytes(out.scriptpubkey),
      });
    });
  }
  return utxos;
}

/**
 * Broadcast a raw transaction hex to the mempool API.
 * Tries /tx first, falls back to /v1/tx. Returns the txid.
 */
export async function broadcastBtc(rawHex: string): Promise<string> {
  for (const path of ['/tx', '/v1/tx']) {
    const resp = await fetch(`${MEMPOOL_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: rawHex,
    });
    const body = await resp.text();
    if (resp.ok) {
      console.log(`[btc-wallet] broadcast ok via POST ${path}`);
      return body.trim();
    }
    console.warn(`[btc-wallet] POST ${path} → ${resp.status}: ${body}`);
  }
  throw new Error('broadcastBtc: failed on both /tx and /v1/tx');
}

/**
 * Poll GET /api/tx/{txid} until status.confirmed, then return block_height + block_hash.
 */
export async function waitForConfirmed(
  txid: string,
  {
    intervalMs = 15_000,
    timeoutMs = 25 * 60_000,
  }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<{ block_height: number; block_hash: string }> {
  const deadline = Date.now() + timeoutMs;
  console.log(`[btc-wallet] waiting for ${txid} to confirm...`);
  while (Date.now() < deadline) {
    const resp = await fetch(`${MEMPOOL_BASE}/tx/${txid}`);
    if (resp.ok) {
      const tx = (await resp.json()) as {
        status: { confirmed: boolean; block_height?: number; block_hash?: string };
      };
      if (tx.status.confirmed && tx.status.block_height != null && tx.status.block_hash) {
        console.log(
          `[btc-wallet] ${txid} confirmed in block ${tx.status.block_height}`,
        );
        return {
          block_height: tx.status.block_height,
          block_hash: tx.status.block_hash,
        };
      }
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`waitForConfirmed: timed out after ${timeoutMs}ms for ${txid}`);
}

/**
 * Fetch the current BTC tip block height from /blocks/tip/height.
 */
export async function getBtcTipHeight(): Promise<number> {
  const resp = await fetch(`${MEMPOOL_BASE}/blocks/tip/height`);
  if (!resp.ok) throw new Error(`GET /blocks/tip/height → ${resp.status}`);
  return Number((await resp.text()).trim());
}

/**
 * Ensure `address` has at least one confirmed UTXO ≥ minSats.
 * If not, call the faucet then poll until a sufficient UTXO appears.
 * Returns the biggest confirmed UTXO found.
 *
 * @param privKey  32-byte raw private key — used to derive the scriptHex for UTXO matching
 * @param address  P2WPKH address (must correspond to privKey)
 * @param scriptHex  The P2WPKH scriptPubKey hex (must correspond to address)
 * @param minSats  Minimum sats required (default 50_000)
 */
export async function ensureFunded(
  address: string,
  scriptHex: string,
  minSats: bigint = 50_000n,
  {
    intervalMs = 15_000,
    timeoutMs = 25 * 60_000,
  }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<Utxo> {
  let utxos = await getUtxos(address, scriptHex);
  const hasSufficient = utxos.some(u => u.value >= minSats);
  if (!hasSufficient) {
    console.log(
      `[btc-wallet] no UTXO >= ${minSats} sats for ${address}, hitting faucet...`,
    );
    await faucetFund(address);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      utxos = await getUtxos(address, scriptHex);
      const ok = utxos.filter(u => u.value >= minSats);
      if (ok.length > 0) {
        console.log(
          `[btc-wallet] funded: ${ok.length} UTXO(s) >= ${minSats} sats`,
        );
        break;
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }

  // Return biggest UTXO
  const sorted = utxos.slice().sort((a, b) => (b.value > a.value ? 1 : -1));
  const best = sorted[0];
  if (!best || best.value < minSats) {
    throw new Error(
      `ensureFunded: still no UTXO >= ${minSats} sats for ${address} after faucet`,
    );
  }
  return best;
}
