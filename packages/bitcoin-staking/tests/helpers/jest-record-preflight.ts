/**
 * RECORD-only chain preflight (jest `globalSetup`) — runs ONCE before the whole
 * run so a recording session self-heals a wedged or down regtest chain instead of
 * failing. Run-level (not per-test), so it never disturbs a test's own beforeAll.
 *
 * The gap it closes: `ensurePox5` only resets a chain that is fully DOWN; a WEDGED
 * chain (node up but the stacks miner stalled, so its burn height falls far behind
 * bitcoind) it happily reuses — and every tx then hangs unconfirmed. Here we treat
 * "stacks node trailing bitcoind by more than LAG blocks" (or unreachable, or not
 * pox-5) as unhealthy and wipe + reboot via `NETWORK_RESET_CMD`.
 *
 * Inert unless `RECORD=1` (replay never touches the chain). Under `RECORD=1`:
 *   - `NETWORK=devnet` (regtest): wipe + reboot a wedged/down chain, then wait
 *     for pox-5.
 *   - otherwise (hosted privatenet): the chain CAN'T be wiped, so instead do a
 *     read-only reachability check and fail FAST with a clear message if the
 *     node is unreachable, not serving pox-5, or trailing the BTC tip — rather
 *     than letting every test hang on its own long timeout.
 *
 * Standalone by design: jest `globalSetup` runs in a plain Node context WITHOUT
 * jest globals, so this file must not import `./utils` (which pulls in
 * jest-fetch-mock -> references `jest` -> crashes). It reads `.env` + `process.env`
 * itself and execs the reset command directly.
 */
import { exec } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const sh = promisify(exec);

/** Blocks the stacks node may trail bitcoind before we call the chain wedged. */
const LAG = 5;

// Mirror utils.ts's `.env` self-load (real env vars win) so globalSetup sees the
// same config without importing the jest-coupled module.
function loadEnv(): void {
  const dotenvPath = resolve(__dirname, '../../.env');
  if (!existsSync(dotenvPath)) return;
  for (const line of readFileSync(dotenvPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw!.replace(/^(['"])(.*)\1$/, '$2');
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bitcoindHeight(url: string): Promise<number | null> {
  try {
    const u = new URL(url);
    const auth = Buffer.from(`${u.username}:${u.password}`).toString('base64');
    const res = await fetch(u.origin, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
      body: JSON.stringify({ jsonrpc: '1.0', id: 'preflight', method: 'getblockcount', params: [] }),
    });
    const json = (await res.json()) as { result: number };
    return json.result;
  } catch {
    return null;
  }
}

/** The stacks node's pox view: pox-5 contract id + the burn height it has processed. */
async function nodePox(api: string): Promise<{ pox5: boolean; burn: number } | null> {
  try {
    const res = await fetch(`${api}/v2/pox`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const p = (await res.json()) as { contract_id: string; current_burnchain_block_height: number };
    return { pox5: p.contract_id.endsWith('.pox-5'), burn: p.current_burnchain_block_height };
  } catch {
    return null;
  }
}

/** The BTC indexer's (esplora) chain tip height, or null if unreachable. */
async function esploraTipHeight(indexerUrl: string): Promise<number | null> {
  try {
    const res = await fetch(`${indexerUrl}/blocks/tip/height`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return Number(await res.text());
  } catch {
    return null;
  }
}

async function chainHealthy(api: string, btcUrl: string): Promise<boolean> {
  const [btc, pox] = await Promise.all([bitcoindHeight(btcUrl), nodePox(api)]);
  return btc !== null && pox !== null && pox.pox5 && btc - pox.burn <= LAG;
}

export default async function recordPreflight(): Promise<void> {
  loadEnv();
  if (process.env.RECORD !== '1') return; // replay never touches the network
  if ((process.env.NETWORK ?? 'devnet') === 'devnet') {
    await devnetPreflight();
  } else {
    await privatenetPreflight();
  }
}

/**
 * Hosted privatenet: it can't be reset, so just confirm it's reachable and
 * current before a long record run, failing fast with a clear message instead
 * of letting each test hang on its own timeout. `PRIVATENET_MAX_LAG` (default 6)
 * bounds how far the node's burn height may trail the BTC indexer tip.
 */
async function privatenetPreflight(): Promise<void> {
  const api = process.env.STACKS_API ?? 'https://api.private-1.hiro.so';
  const indexerUrl = process.env.MEMPOOL_API ?? 'https://mempool.bitcoin.private-1.hiro.so/api';

  const pox = await nodePox(api);
  if (pox === null) {
    throw new Error(
      `[record-preflight] privatenet Stacks node unreachable at ${api} — cannot record ` +
        `(the hosted net can't be reset; check the endpoint / that the chain is up)`
    );
  }
  if (!pox.pox5) {
    throw new Error(
      `[record-preflight] privatenet node at ${api} is not serving pox-5 (contract mismatch ` +
        `or mid-boot) — refusing to record against it`
    );
  }

  const tip = await esploraTipHeight(indexerUrl);
  const maxLag = Number(process.env.PRIVATENET_MAX_LAG ?? 6);
  if (tip !== null && tip - pox.burn > maxLag) {
    throw new Error(
      `[record-preflight] privatenet node burn height ${pox.burn} trails the BTC indexer tip ` +
        `${tip} by >${maxLag} blocks — the chain looks wedged/stale; recording now would ` +
        `capture a stalled chain (override with PRIVATENET_MAX_LAG if intentional)`
    );
  }
  console.log(
    `[record-preflight] privatenet reachable, pox-5 active` +
      (tip !== null ? ` (burn ${pox.burn}, btc tip ${tip})` : ` (btc indexer unreachable — lag unchecked)`)
  );
}

/** Regtest/devnet: wipe + reboot a wedged/down chain, then wait for pox-5. */
async function devnetPreflight(): Promise<void> {
  const api = process.env.STACKS_API ?? 'http://localhost:3999';
  const btcUrl = process.env.BITCOIND_URL ?? 'http://btc:btc@localhost:18443';
  const resetCmd = process.env.NETWORK_RESET_CMD ?? '';

  if (await chainHealthy(api, btcUrl)) {
    console.log('[record-preflight] regtest chain healthy');
    return;
  }

  if (!resetCmd) {
    throw new Error('[record-preflight] chain unhealthy and NETWORK_RESET_CMD is unset — cannot heal');
  }

  console.log('[record-preflight] regtest chain wedged or down — wiping + rebooting');
  await sh(resetCmd, { maxBuffer: 64 * 1024 * 1024 });

  // Post-reset heal = a fresh boot to pox-5 (~4 min). Same knob the test-side boot
  // waiters use (ENV.BOOT_TIMEOUT); read here since globalSetup can't import utils.
  const healTimeoutMs = Number(process.env.BOOT_TIMEOUT ?? 8 * 60_000);
  const deadline = Date.now() + healTimeoutMs;
  while (!(await chainHealthy(api, btcUrl))) {
    if (Date.now() > deadline) {
      throw new Error('[record-preflight] chain did not reach a healthy pox-5 state after reset');
    }
    await sleep(5_000);
  }
  console.log('[record-preflight] regtest chain healthy after reset');
}
