/**
 * Send real BTC on the private regtest Bitcoin network using @scure/btc-signer.
 *
 * This test:
 *  1. Derives keys + addresses for account5 (sender) and account6 (recipient).
 *  2. Looks up spendable UTXOs by parsing /address/{addr}/txs from the mempool API.
 *     If none are confirmed yet, hits the BTC faucet and polls until funded.
 *  3. Builds + signs a P2WPKH transaction (1 sat/vB, ~300 sat fee).
 *  4. Broadcasts via POST {base}/tx (text/plain body — mempool.space compatible).
 *  5. Polls until the txid appears in the mempool API.
 *
 * Composable action — configure via ENV (defaults send 0.1 BTC account5→account6):
 *   BTC_FROM_PRIV   sender private key, 64-hex (default: account5)
 *   TO_ADDRESS      recipient bcrt1 address (default: account6)
 *   AMOUNT_SATS     amount to send                       (default: 10000000)
 *   FEE_SATS        flat fee                             (default: 300)
 *
 * Run (defaults):
 *   NETWORK=testnet npx jest tests/privatenet/actions/btc-send.test.ts \
 *     --runInBand --collectCoverage=false --verbose
 * Run (custom):
 *   AMOUNT_SATS=5000000 TO_ADDRESS=bcrt1q... NETWORK=testnet npx jest ...btc-send.test.ts ...
 */

// @ts-ignore — @scure/btc-signer is ESM; ts-jest transforms it via jest.config.js
import * as btc from "@scure/btc-signer";
// @ts-ignore — same ESM transform
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@stacks/common";
import fetchMock from "jest-fetch-mock";

// This test hits a live network — disable the global jest-fetch-mock.
fetchMock.disableMocks();

jest.setTimeout(30 * 60_000);

// ─── Network params ──────────────────────────────────────────────────────────

const REGTEST = {
  bech32: "bcrt",
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

const MEMPOOL_BASE = "https://mempool.bitcoin.private-1.hiro.so/api";
const FAUCET_URL = "https://api.private-1.hiro.so/extended/v1/faucets/btc";

// ─── Key material ────────────────────────────────────────────────────────────

// Sender priv (64-hex). Default: account5. Override with BTC_FROM_PRIV.
const SENDER_PRIV_HEX =
  process.env.BTC_FROM_PRIV ??
  "cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df";
// Recipient. Default: account6. Override with TO_ADDRESS.
const RECIPIENT_ADDR =
  process.env.TO_ADDRESS ?? "bcrt1qr5g5smqp2650kgxz64664vs2hwpkwpq7nm4gm4";

// ─── Tx parameters (ENV-overridable) ──────────────────────────────────────────

const SEND_SATS = BigInt(process.env.AMOUNT_SATS ?? 10_000_000); // default 0.1 BTC
const FEE_SATS = BigInt(process.env.FEE_SATS ?? 300); // 1 sat/vB × ~141 vB rounded up

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve sender pubkey + p2wpkh spend object once. */
function senderSpend() {
  const priv = hexToBytes(SENDER_PRIV_HEX);
  const pub = secp256k1.getPublicKey(priv, true);
  const spend = btc.p2wpkh(pub, REGTEST);
  return { priv, pub, spend };
}

interface Utxo {
  txid: string;
  vout: number;
  value: bigint;
  scriptPubKey: Uint8Array;
}

/**
 * Derive UTXOs from /address/{addr}/txs — mempool.space-compatible alternative
 * to the /utxo endpoint (which 404s on this hosted instance).
 *
 * Strategy: collect all vouts paying `scriptHex` across confirmed txs, then
 * subtract any vin that spends them. Only returns confirmed UTXOs.
 */
async function fetchUtxos(addr: string, scriptHex: string): Promise<Utxo[]> {
  const resp = await fetch(`${MEMPOOL_BASE}/address/${addr}/txs`);
  if (!resp.ok) throw new Error(`GET /address/${addr}/txs → ${resp.status}`);
  const txs = (await resp.json()) as Array<{
    txid: string;
    vin: Array<{ txid: string; vout: number }>;
    vout: Array<{ value: number; scriptpubkey: string }>;
    status: { confirmed: boolean };
  }>;

  // Build a set of outpoints that have been spent.
  const spent = new Set<string>();
  for (const tx of txs) {
    for (const inp of tx.vin) {
      spent.add(`${inp.txid}:${inp.vout}`);
    }
  }

  const utxos: Utxo[] = [];
  for (const tx of txs) {
    if (!tx.status.confirmed) continue; // only spend confirmed outputs
    tx.vout.forEach((out, idx) => {
      if (out.scriptpubkey !== scriptHex) return;
      const key = `${tx.txid}:${idx}`;
      if (spent.has(key)) return;
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

/** Poll until `fn` returns a non-null/undefined value, or throw after `timeoutMs`. */
async function poll<T>(
  fn: () => Promise<T | null | undefined>,
  intervalMs: number,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result != null) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`poll timed out after ${timeoutMs}ms: ${label}`);
}

/** Hit the BTC faucet to fund an address with a large amount. */
async function faucetFund(addr: string): Promise<void> {
  const url = `${FAUCET_URL}?address=${encodeURIComponent(addr)}&xlarge=true`;
  const resp = await fetch(url, { method: "POST" });
  if (!resp.ok) {
    const body = await resp.text();
    console.warn(`faucet returned ${resp.status}: ${body}`);
  } else {
    const data = (await resp.json()) as unknown;
    console.log("faucet response:", JSON.stringify(data));
  }
}

/** Broadcast a raw tx hex; try /tx then /v1/tx. Returns the txid. */
async function broadcast(rawHex: string): Promise<string> {
  for (const path of ["/tx", "/v1/tx"]) {
    const resp = await fetch(`${MEMPOOL_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: rawHex,
    });
    const body = await resp.text();
    if (resp.ok) {
      console.log(`broadcast succeeded via POST ${MEMPOOL_BASE}${path}`);
      return body.trim();
    }
    console.warn(`POST ${MEMPOOL_BASE}${path} → ${resp.status}: ${body}`);
  }
  throw new Error("broadcast failed on both /tx and /v1/tx");
}

// ─── Test ─────────────────────────────────────────────────────────────────────

test("send 0.1 BTC from account5 to account6 on regtest", async () => {
  const { priv, spend } = senderSpend();
  const senderAddr = spend.address!;
  const senderScriptHex = bytesToHex(spend.script);

  console.log("sender addr:", senderAddr);
  console.log("recipient addr:", RECIPIENT_ADDR);
  console.log("sender scriptPubKey:", senderScriptHex);

  // ── 1. Find a confirmed UTXO large enough ──────────────────────────────────
  let utxos = await fetchUtxos(senderAddr, senderScriptHex);
  console.log("initial UTXOs:", utxos.map((u) => `${u.txid}:${u.vout} (${u.value} sats)`));

  if (utxos.length === 0 || !utxos.some((u) => u.value >= SEND_SATS + FEE_SATS)) {
    console.log("no spendable confirmed UTXO — hitting faucet...");
    await faucetFund(senderAddr);

    // Poll until a confirmed UTXO appears with sufficient funds.
    utxos = await poll(
      async () => {
        const fresh = await fetchUtxos(senderAddr, senderScriptHex);
        const ok = fresh.filter((u) => u.value >= SEND_SATS + FEE_SATS);
        return ok.length > 0 ? fresh : null;
      },
      15_000, // 15 s between polls (mempool API is rate-limited)
      25 * 60_000, // 25 min total (block times on this regtest can be slow)
      "waiting for confirmed UTXO after faucet",
    );
    console.log("UTXOs after funding:", utxos.map((u) => `${u.txid}:${u.vout} (${u.value} sats)`));
  }

  // Pick the largest UTXO.
  const utxo = utxos.sort((a, b) => (b.value > a.value ? 1 : -1))[0];
  if (!utxo) throw new Error("no UTXO after polling");

  const changeSats = utxo.value - SEND_SATS - FEE_SATS;
  expect(changeSats).toBeGreaterThan(0n);

  console.log("spending UTXO:", `${utxo.txid}:${utxo.vout}`, `(${utxo.value} sats)`);
  console.log("send:", SEND_SATS.toString(), "sats");
  console.log("fee:", FEE_SATS.toString(), "sats");
  console.log("change:", changeSats.toString(), "sats");

  // ── 2. Build + sign tx ────────────────────────────────────────────────────
  const tx = new btc.Transaction();
  tx.addInput({
    txid: utxo.txid,
    index: utxo.vout,
    witnessUtxo: {
      script: utxo.scriptPubKey,
      amount: utxo.value,
    },
  });
  tx.addOutputAddress(RECIPIENT_ADDR, SEND_SATS, REGTEST);
  tx.addOutputAddress(senderAddr, changeSats, REGTEST);

  tx.sign(priv);
  tx.finalize();

  const rawHex = tx.hex;
  console.log("tx size:", rawHex.length / 2, "bytes");
  console.log("tx hex:", rawHex);

  // ── 3. Broadcast ──────────────────────────────────────────────────────────
  const txid = await broadcast(rawHex);
  console.log("broadcast txid:", txid);

  // Basic sanity: 64 lowercase hex chars
  expect(txid).toMatch(/^[0-9a-f]{64}$/);

  // ── 4. Confirm the tx is visible in the mempool API ───────────────────────
  const seenTx = await poll(
    async () => {
      const resp = await fetch(`${MEMPOOL_BASE}/tx/${txid}`);
      if (!resp.ok) return null;
      return (await resp.json()) as { txid: string; fee: number; status: { confirmed: boolean } };
    },
    5_000, // 5 s
    2 * 60_000, // 2 min
    `tx ${txid} visible in mempool`,
  );

  console.log("mempool tx:", JSON.stringify({ txid: seenTx.txid, fee: seenTx.fee, confirmed: seenTx.status.confirmed }));

  expect(seenTx.txid).toBe(txid);
  expect(seenTx.fee).toBeGreaterThan(0);
});
