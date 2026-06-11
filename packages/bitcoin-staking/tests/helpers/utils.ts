/**
 * Env config, network resolution, retry/timeout wrappers and Docker lifecycle
 * for the e2e harness. Ported from `stacks-functional-tests/src/utils.ts`
 * (+ `stacksNetwork()` from its `helpers.ts`), kept dependency-light.
 */
import { exec } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { STACKS_TESTNET, type StacksNetwork } from "@stacks/network";
import fetchMock from "jest-fetch-mock";

const sh = promisify(exec);

/** Lightweight env (mirrors `stacks-functional-tests/src/env.ts`). */
export const ENV = {
  /**
   * The chain id used to sign transactions — the node's `/v2/info` `.network_id`
   * (for mainnet/testnet that field IS the chain id). Defaults to the standard
   * testnet id; set it to match a custom net, e.g. `256` for the hosted private
   * net (whose default-testnet id would otherwise fail signature validation).
   */
  NETWORK_ID: Number(process.env.NETWORK_ID ?? STACKS_TESTNET.chainId),

  /**
   * Base URL for ALL Stacks HTTP. A Hiro-style API proxies the node, so the SAME
   * base serves both the `/extended/*` REST and the raw node `/v2/*` RPC — point
   * it at a net (e.g. `https://api.private-1.hiro.so`) and everything (reads,
   * broadcast, pox, waiters) targets that net. No separate node URL needed.
   */
  STACKS_API: process.env.STACKS_API ?? "http://localhost:3999",
  BITCOIND_URL: process.env.BITCOIND_URL ?? "http://btc:btc@localhost:18443",

  /** regtest-env compose cwd, relative to this package dir. */
  REGTEST_WORKING_DIR:
    process.env.REGTEST_WORKING_DIR ?? "../../../stacks-regtest-env",
  NETWORK_UP_CMD: process.env.NETWORK_UP_CMD ?? "",
  NETWORK_DOWN_CMD: process.env.NETWORK_DOWN_CMD ?? "",

  // On the hosted private testnet the API rate-limits at ~1 req/s (HTTP 429).
  // Devnet is local and can be polled fast (250 ms is fine). Testnet callers
  // should set POLL_INTERVAL=10000 RETRY_INTERVAL=10000 or the tests will
  // hammer the endpoint and get throttled. These defaults keep devnet behaviour
  // unchanged while making the override easy.
  POLL_INTERVAL: Number(process.env.POLL_INTERVAL ?? 250),
  RETRY_INTERVAL: Number(process.env.RETRY_INTERVAL ?? 250),
  STACKS_TX_TIMEOUT: Number(process.env.STACKS_TX_TIMEOUT ?? 120_000),
  BITCOIN_TX_TIMEOUT: Number(process.env.BITCOIN_TX_TIMEOUT ?? 30_000),

  /**
   * The canonical fixtures store the recorder maintains (relative to cwd, the
   * package dir) — a JSON map of request `path + search` → response body. Source
   * of truth for offline replay; tests read it via `fixtures.ts` (`FIXTURES`).
   */
  FIXTURES_JSON: process.env.FIXTURES_JSON ?? "tests/regtest/fixtures.json",
  /**
   * Capture mode. When `RECORD=1`, hit the live node (jest-fetch-mock disabled)
   * and record every observed request/response into FIXTURES_JSON. Unset →
   * replay via mocks.
   */
  RECORD: process.env.RECORD === "1",
};

// In capture mode, go live once at module load (utils is imported by every test).
if (ENV.RECORD) fetchMock.disableMocks();

/**
 * Replay mode: the inverse of RECORD. When mocking, the `waitFor*` loops in
 * `wait.ts` skip their polling (a static fixture never changes, so looping is
 * pointless) and resolve immediately.
 */
export const isMocking = !ENV.RECORD;

export const timeout = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Recorder: programmatically maintain the canonical JSON fixtures store ========

/** Pull the request URL out of any `fetch` input shape. */
function inputToUrl(input: Parameters<typeof fetch>[0]): URL {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return new URL(raw);
}

/**
 * Active fixture-file key. `undefined` → the default store (`fixtures.json`). A
 * key routes BOTH recording and replay to `fixtures-<key>.json` (same dir), so a
 * test's captures and its mocks live in one named file. Test PHASES that need the
 * same path to return different bodies over time use different keys.
 */
let activeFixtureKey: string | undefined;
export function setFixtureFile(key?: string): void {
  activeFixtureKey = key;
}

/** Absolute path of the fixtures file for `key` (co-located with `fixtures.json`). */
export function fixturePath(key?: string): string {
  const rel = key ? ENV.FIXTURES_JSON.replace(/\.json$/, `-${key}.json`) : ENV.FIXTURES_JSON;
  return resolve(process.cwd(), rel);
}

/**
 * Per-file in-memory cache, seeded from disk so re-records merge + dedupe (latest
 * wins) instead of clobbering. A missing file → empty map (never breaks replay).
 */
const fixtureCache = new Map<string, Record<string, string>>();
export function loadFixtures(key?: string): Record<string, string> {
  const path = fixturePath(key);
  let map = fixtureCache.get(path);
  if (!map) {
    try {
      map = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
    } catch {
      map = {};
    }
    fixtureCache.set(path, map);
  }
  return map;
}

/** Write the store back as sorted JSON (stable key order → clean diffs). */
function writeFixtures(key: string | undefined, map: Record<string, string>): void {
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(map).sort()) sorted[k] = map[k];
  writeFileSync(fixturePath(key), `${JSON.stringify(sorted, null, 2)}\n`);
}

/**
 * Fixtures key for a request — the single source of truth used by BOTH record and
 * replay. Stacks REST is keyed by `path+search` (body-agnostic — e.g.
 * `/v2/transactions`, `call-read`). JSON-RPC (bitcoind) multiplexes every call
 * onto one path, so path alone collides; those are keyed by
 * `host + path # method : params`, distinct and namespaced from the Stacks paths.
 */
export function fixtureKey(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): string {
  const url = inputToUrl(input);
  const path = `${url.pathname}${url.search}`;
  const body = typeof init?.body === "string" ? init.body : undefined;
  if (!body) return path; // GETs, and binary POSTs like /v2/transactions

  // map_entry POSTs the (hex) clarity map key in the body — different keys (e.g.
  // a bond per index, an allowance per staker) hit the same path, so include it.
  if (url.pathname.includes("/map_entry/")) return `${path}#${body}`;

  try {
    const parsed = JSON.parse(body) as {
      method?: unknown;
      params?: unknown;
      sender?: unknown;
      arguments?: unknown;
    };
    // bitcoind JSON-RPC: every call POSTs one path → disambiguate by method+params.
    if (typeof parsed.method === "string") {
      return `${url.host}${url.pathname}#${parsed.method}:${JSON.stringify(parsed.params ?? [])}`;
    }
    // Stacks read-only calls: the same fn path serves every (sender, args) — a
    // multi-account test reads e.g. get-bond-membership for two stakers, so key
    // by sender + args, not just the path.
    if (url.pathname.includes("/contracts/call-read/")) {
      return `${path}#${String(parsed.sender ?? "")}:${JSON.stringify(parsed.arguments ?? [])}`;
    }
  } catch {
    // not JSON — fall through to path keying
  }
  return path; // e.g. /v2/transactions (broadcast body varies; response unused)
}

/**
 * Record one request/response into the active fixtures file (see
 * {@link setFixtureFile}), keyed by {@link fixtureKey}, merged + deduped (latest
 * wins). Best-effort — never fails a request over recording.
 */
function recordFixture(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  response: Response,
): void {
  try {
    const key = fixtureKey(input, init);
    const fileKey = activeFixtureKey;
    void response
      .clone()
      .text()
      .then((body) => {
        const map = loadFixtures(fileKey);
        if (map[key] === body) return; // unchanged — skip rewrite
        map[key] = body;
        writeFixtures(fileKey, map);
      });
  } catch {
    // best-effort capture; never fail a request because of recording
  }
}

// In capture mode, also record the raw `fetch` polling the wait helpers do
// (`/v2/pox`, `/v2/info`, tx status). Deduping means the boot polling collapses
// to a single latest-wins entry per path, so replay has the endpoints the
// waiters check without flooding the store. SDK calls also flow through
// `liveFetch` below and dedupe to the same map.
if (ENV.RECORD) {
  const realFetch = globalThis.fetch.bind(globalThis) as typeof fetch;
  globalThis.fetch = (async (input, init) => {
    const response = await realFetch(input, init);
    recordFixture(input, init, response);
    return response;
  }) as typeof fetch;
}

/**
 * Resolve `fetch` lazily at call-time. `getNetwork()` may run at module load
 * while jest-fetch-mock is still enabled; capturing `fetch` directly would
 * freeze the mock reference even after the global is swapped back. Recording is
 * handled by the global-fetch wrap above (in RECORD mode), so this just defers.
 */
const liveFetch: typeof fetch = async (input, init) => {
  return (globalThis.fetch as typeof fetch)(input, init);
};

/** Resolve the network from ENV — so it's never hardcoded inside a test. */
export function getNetwork(): StacksNetwork {
  return {
    ...STACKS_TESTNET,
    chainId: ENV.NETWORK_ID,
    client: { baseUrl: ENV.STACKS_API, fetch: withRetry(10, liveFetch) },
  };
}

// retry / timeout wrappers (port of functional-tests utils.ts)

export function withRetry<T, A extends unknown[]>(
  maxRetries: number,
  fn: (...args: A) => Promise<T>,
): (...args: A) => Promise<T> {
  return async function retryWrapper(...args: A): Promise<T> {
    let attempts = 0;
    while (true) {
      try {
        const response = await fn(...args);
        if (response instanceof Response && !response.ok) {
          if (attempts >= maxRetries) return response as T;
          // 429 Rate Limited: respect Retry-After header, else back off 15 s.
          // Without this, fast retries re-trigger 429s in a tight loop.
          const wait =
            response.status === 429
              ? (Number(response.headers.get('retry-after') ?? 0) * 1000 || 15_000)
              : ENV.RETRY_INTERVAL;
          await timeout(wait);
          attempts++;
          continue;
        }
        return response as T;
      } catch (err) {
        if (attempts >= maxRetries) throw err;
        await timeout(ENV.RETRY_INTERVAL);
        attempts++;
      }
    }
  };
}

export function withTimeout<T, A extends unknown[]>(
  timeoutMs: number,
  fn: (...args: A) => Promise<T>,
): (...args: A) => Promise<T> {
  return async function timeoutWrapper(...args: A): Promise<T> {
    let handle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      handle = setTimeout(() => reject(new Error("Timeout")), timeoutMs);
    });
    try {
      return await Promise.race([timeoutPromise, fn(...args)]);
    } finally {
      if (handle) clearTimeout(handle);
    }
  };
}

// Docker lifecycle (port of functional-tests utils.ts)

export async function networkEnvUp() {
  if (!ENV.NETWORK_UP_CMD) return;
  console.log("starting network...");
  return (await sh(ENV.NETWORK_UP_CMD)).stdout;
}

export async function networkEnvDown() {
  if (!ENV.NETWORK_DOWN_CMD) return;
  console.log("stopping network...");
  return (await sh(ENV.NETWORK_DOWN_CMD)).stdout;
}

export async function regtestComposeUp(services = "", opts = "") {
  if (!ENV.REGTEST_WORKING_DIR) return;
  console.log(`starting regtest services... ${services}`);
  return (
    await sh(
      `cd ${ENV.REGTEST_WORKING_DIR} && docker compose ${opts} up -d ${services}`,
    )
  ).stdout;
}

export async function regtestComposeDown(services = "") {
  if (!ENV.REGTEST_WORKING_DIR) return;
  console.log(`stopping regtest services... ${services}`);
  return (
    await sh(`cd ${ENV.REGTEST_WORKING_DIR} && docker compose down ${services}`)
  ).stdout;
}

export async function regtestComposeLogs(services = "") {
  if (!ENV.REGTEST_WORKING_DIR) return;
  return (
    await sh(`cd ${ENV.REGTEST_WORKING_DIR} && docker compose logs ${services}`)
  ).stdout;
}

// build output can be large; give exec room
const composeOpts = { maxBuffer: 64 * 1024 * 1024 };

const envPrefix = (env: Record<string, string>) => {
  const s = Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return s ? `${s} ` : "";
};

/**
 * Bring the env up (build if needed), detached. `env` is passed to compose,
 * e.g. `{ POX5_STACKING_ENABLED: 'false' }` to disable the keep-alive daemon so
 * a test can drive stake txs itself.
 *
 * `--scale tx-broadcaster=0` keeps the env's STX-flooder service OFF: it spams
 * transfers from `REGTEST_KEYS.account1/2/3` (its compose `ACCOUNT_KEYS`) and
 * can wedge the shared stacks-api. Unlike the btc-staker daemon there's no
 * env-var to disable it, so it must be scaled to zero at compose up.
 */
export async function regtestUp(env: Record<string, string> = {}) {
  console.log(`regtest up -d --build... ${envPrefix(env).trim()}`);
  return (
    await sh(
      `cd ${ENV.REGTEST_WORKING_DIR} && ${envPrefix(env)}docker compose up -d --build --scale tx-broadcaster=0`,
      composeOpts,
    )
  ).stdout;
}

/** Tear the env down and WIPE chain state (fresh chain on next up). */
export async function regtestDownWipe() {
  console.log("regtest down --volumes...");
  return (
    await sh(
      `cd ${ENV.REGTEST_WORKING_DIR} && docker compose down --volumes --remove-orphans --timeout=1`,
      composeOpts,
    )
  ).stdout;
}

/** Fresh chain: wipe then bring back up (passing `env` to compose). */
export async function regtestReset(env: Record<string, string> = {}) {
  await regtestDownWipe();
  return regtestUp(env);
}

/** Soft restart — restarts services but KEEPS chain state (nudges stuck nodes). */
export async function regtestRestart() {
  console.log("regtest restart (soft)...");
  return (
    await sh(
      `cd ${ENV.REGTEST_WORKING_DIR} && docker compose restart`,
      composeOpts,
    )
  ).stdout;
}
