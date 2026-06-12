/**
 * One-off prep script for the bond-population wave on the private testnet.
 *
 * NON-ADMIN prep only — funds BTC + STX for account1/2/3/8. Touches NO admin
 * (ST1V2ASRWG) tx and NOT account5/6/7 (other agents own those).
 *
 * Tasks:
 *  1. BTC faucet -> account1/2/3/8; poll each bcrt1 p2wpkh until a confirmed
 *     UTXO >= 1,000,000 sats appears (up to 25 min).
 *  2. STX: send 100,000 STX (100000000000 uSTX) account1 -> account8 via a
 *     standard makeSTXTokenTransfer; wait for tx success.
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *   TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node","target":"ES2020","esModuleInterop":true}' \
 *   npx ts-node --transpile-only --skip-project tests/privatenet/prep-stakers.ts
 */
import * as btc from "@scure/btc-signer";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@stacks/common";
import { STACKS_TESTNET, type StacksNetwork } from "@stacks/network";
import {
  broadcastTransaction,
  makeSTXTokenTransfer,
} from "@stacks/transactions";

// ─── Config ────────────────────────────────────────────────────────────────
const STACKS_API = process.env.STACKS_API ?? "https://api.private-1.hiro.so";
const NETWORK_ID = Number(process.env.NETWORK_ID ?? 256);
const MEMPOOL_BASE = "https://mempool.bitcoin.private-1.hiro.so/api";
const FAUCET_URL = `${STACKS_API}/extended/v1/faucets/btc`;

const REGTEST = { bech32: "bcrt", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };

const MIN_SATS = 1_000_000n;
const POLL_MS = 15_000;
const TIMEOUT_MS = 25 * 60_000;

// 66-hex REGTEST keys (trailing "01" = compressed flag, stripped for btc derive).
const REGTEST_KEYS: Record<string, string> = {
  account1: "0d2f965b472a82efd5a96e6513c8b9f7edc725d5c96c7d35d6c722cedeb80d1b01",
  account2: "975b251dd7809469ef0c26ec3917971b75c51cd73a022024df4bf3b232cc2dc001",
  account3: "c71700b07d520a8c9731e4d0f095aa6efb91e16e25fb27ce2b72e7b698f8127a01",
  account8: "6fb38ff674aced1d8cb5a36cd8304011ea65e096188b99603aeb793df481147401",
};

const STX_ADDR: Record<string, string> = {
  account1: "ST29V10QEA7BRZBTWRFC4M70NJ4J6RJB5P1C6EE84",
  account8: "ST1WGNQQYDTFJ9NA8HR077WJD7QZ1EH3DZQZPTWS0",
};

const network: StacksNetwork = {
  ...STACKS_TESTNET,
  chainId: NETWORK_ID,
  client: { baseUrl: STACKS_API, fetch },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** bcrt1 p2wpkh from a 66-hex regtest key (strip trailing 01 -> 64-hex raw). */
function btcAddress(key66: string): { addr: string; scriptHex: string } {
  const raw = hexToBytes(key66.slice(0, 64));
  const pub = secp256k1.getPublicKey(raw, true);
  const spend = btc.p2wpkh(pub, REGTEST);
  return { addr: spend.address!, scriptHex: bytesToHex(spend.script) };
}

interface Utxo { value: bigint }

/** Confirmed UTXOs paying scriptHex, derived from /address/{addr}/txs. */
async function fetchUtxos(addr: string, scriptHex: string): Promise<Utxo[]> {
  const resp = await fetch(`${MEMPOOL_BASE}/address/${addr}/txs`);
  if (!resp.ok) throw new Error(`GET /address/${addr}/txs -> ${resp.status}`);
  const txs = (await resp.json()) as Array<{
    txid: string;
    vin: Array<{ txid: string; vout: number }>;
    vout: Array<{ value: number; scriptpubkey: string }>;
    status: { confirmed: boolean };
  }>;
  const spent = new Set<string>();
  for (const tx of txs) for (const i of tx.vin) spent.add(`${i.txid}:${i.vout}`);
  const utxos: Utxo[] = [];
  for (const tx of txs) {
    if (!tx.status.confirmed) continue;
    tx.vout.forEach((out, idx) => {
      if (out.scriptpubkey !== scriptHex) return;
      if (spent.has(`${tx.txid}:${idx}`)) return;
      utxos.push({ value: BigInt(out.value) });
    });
  }
  return utxos;
}

function confirmedBalance(utxos: Utxo[]): bigint {
  return utxos.reduce((s, u) => s + u.value, 0n);
}

async function faucetFund(addr: string): Promise<void> {
  const url = `${FAUCET_URL}?address=${encodeURIComponent(addr)}&xlarge=true`;
  const resp = await fetch(url, { method: "POST" });
  const body = await resp.text();
  if (!resp.ok) console.warn(`faucet ${addr} -> ${resp.status}: ${body}`);
  else console.log(`faucet ${addr} -> ${body}`);
}

/** Fund one account's BTC and poll until confirmed balance >= MIN_SATS. */
async function fundBtc(name: string): Promise<{ addr: string; sats: bigint }> {
  const { addr, scriptHex } = btcAddress(REGTEST_KEYS[name]);
  console.log(`\n[BTC ${name}] addr=${addr}`);

  let utxos = await fetchUtxos(addr, scriptHex);
  let bal = confirmedBalance(utxos);
  console.log(`[BTC ${name}] initial confirmed balance: ${bal} sats`);

  if (bal < MIN_SATS) {
    console.log(`[BTC ${name}] below ${MIN_SATS} — hitting faucet...`);
    await faucetFund(addr);
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      try {
        utxos = await fetchUtxos(addr, scriptHex);
        bal = confirmedBalance(utxos);
        console.log(`[BTC ${name}] polling... confirmed balance: ${bal} sats`);
        if (bal >= MIN_SATS) break;
      } catch (e) {
        console.warn(`[BTC ${name}] poll error: ${(e as Error).message}`);
      }
    }
    if (bal < MIN_SATS) {
      throw new Error(`[BTC ${name}] timed out: ${bal} < ${MIN_SATS} sats`);
    }
  }
  console.log(`[BTC ${name}] FUNDED: ${bal} sats @ ${addr}`);
  return { addr, sats: bal };
}

async function getNextNonce(address: string): Promise<number> {
  const resp = await fetch(`${STACKS_API}/v2/accounts/${address}?proof=0`);
  if (!resp.ok) throw new Error(`GET /v2/accounts/${address} -> ${resp.status}`);
  const data = (await resp.json()) as { nonce: number };
  return data.nonce;
}

async function stxBalance(address: string): Promise<string> {
  const resp = await fetch(`${STACKS_API}/v2/accounts/${address}?proof=0`);
  const data = (await resp.json()) as { balance: string };
  return BigInt(data.balance).toString();
}

/** Send 100,000 STX account1 -> account8 and wait for tx success. */
async function fundStx(): Promise<{ txid: string; balance: string }> {
  const amount = 100_000_000_000n; // 100,000 STX
  const fee = 10_000n;
  const senderKey = REGTEST_KEYS.account1;
  const recipient = STX_ADDR.account8;
  const nonce = await getNextNonce(STX_ADDR.account1);
  console.log(`\n[STX] account1 nonce=${nonce}, sending ${amount} uSTX -> account8`);

  const transaction = await makeSTXTokenTransfer({
    recipient,
    amount,
    senderKey,
    network,
    nonce,
    fee,
  });
  const res = await broadcastTransaction({ transaction, network });
  if ("error" in res) {
    throw new Error(`broadcast error: ${JSON.stringify(res)}`);
  }
  const txid = res.txid;
  console.log(`[STX] broadcast txid=${txid}`);

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const r = await fetch(`${STACKS_API}/extended/v1/tx/${txid}`);
    if (r.ok) {
      const tx = (await r.json()) as { tx_status: string };
      console.log(`[STX] tx ${txid} status=${tx.tx_status}`);
      if (tx.tx_status === "success") break;
      if (tx.tx_status.startsWith("abort")) {
        throw new Error(`[STX] tx ${txid} failed: ${tx.tx_status}`);
      }
    } else {
      console.log(`[STX] tx ${txid} not yet visible (${r.status})`);
    }
  }
  const balance = await stxBalance(recipient);
  console.log(`[STX] account8 balance: ${balance} uSTX`);
  return { txid, balance };
}

async function main() {
  console.log(`STACKS_API=${STACKS_API} NETWORK_ID=${NETWORK_ID}`);

  // Task 1: BTC for all four (sequential — mempool API is rate-limited).
  const btcResults: Record<string, { addr: string; sats: bigint }> = {};
  for (const name of ["account1", "account2", "account3", "account8"]) {
    btcResults[name] = await fundBtc(name);
  }

  // Task 2: STX fund account8 from account1.
  const stx = await fundStx();

  console.log("\n===== REPORT =====");
  for (const name of ["account1", "account2", "account3", "account8"]) {
    const r = btcResults[name];
    console.log(`${name}: BTC ${r.sats} sats @ ${r.addr}`);
  }
  console.log(`account8 STX: ${stx.balance} uSTX (txid=${stx.txid})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
