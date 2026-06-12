# `@stacks/bitcoin-staking` — E2E Testing Plan

**Status:** spec / plan (no code yet)
**Date:** 2026-05-29
**Owner:** jannik

End-to-end tests for the `@stacks/bitcoin-staking` SDK that run the **real** SDK
functions against the local **regtest Docker env** at `../stacks-regtest-env`,
recording network traffic so the captures can be committed and **replayed as
mocks** — exactly the record/replay pattern already used by the `@stacks/stacking`
package (`setApiMocks` + `network.txt`).

This is a port of the now-deprecated stacking flow (the `tsx` daemons in
`stacks-regtest-env/stacking/`) reshaped into ordered, step-by-step Jest tests,
reusing the proven harness from `../stacks-functional-tests`.

---

## 1. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Location | `packages/bitcoin-staking/e2e/` (new subdir) |
| 2 | Runner | Plain **Jest** (the package's existing setup) — **no custom config, no new npm scripts**. Run files individually. |
| 3 | Mock relationship | Captures become **`setApiMocks` responseMaps** (jest-fetch-mock), like `@stacks/stacking`. Replayed by default → suite passes offline/CI without Docker. |
| 4 | Capture mechanism | The existing **`createFetchFn` wrapper** tees `'path': \`body\`,` lines to **`network.txt`** (see `@stacks/internal/apiMockingHelpers.ts` lines 6-12). Paste entries into the test's responseMap. |
| 5 | Docker control | Reuse `../stacks-functional-tests` helpers: `regtestComposeUp/Down`, `networkEnvUp/Down`, driven by env (`REGTEST_WORKING_DIR`, `NETWORK_UP_CMD`, `NETWORK_DOWN_CMD`). |
| 6 | Bootstrap source | **Bare env** (bitcoind, miner, stacks-node, stacks-api, signers, postgres — **NOT** `btc-staker`/`monitor`/`stacker`). The **SDK drives every call** so each captured request maps to an SDK function. |
| 7 | Wallets | **3 pre-funded `STACKING_KEYS`** from the env's `docker-compose.yml`, exposed via `getAccount(key)` with named roles: `ADMIN`/deployer, `STAKER`, `SIGNER`. Plus a bitcoind-funded BTC wallet for L1 lock funding. (Room to add more keys/roles later.) |
| 8 | BTC RPC | npm package **`@btc-helpers/rpc`** (`new RpcClient(BITCOIND_URL).Typed`) — same dev dep as functional-tests. No BTC RPC exists in stacks.js today. |

### Guiding principle — the suite is also an SDK gap-finder

The aim is to test the **SDK**. If a multi-step incantation keeps getting
copy-pasted across tests (e.g. signer-manager deploy + register, SPV-proof
assembly), that's a signal it may belong **in the SDK**. Flag such candidates
for review — **do not auto-add to the SDK without approval.**

---

## 2. How the record/replay loop works

```
        ┌─ default (CI, offline) ────────────────────────────────┐
        │  test calls setApiMocks(RESPONSE_MAP)                   │
        │  fetchMock replays committed responses by URL path      │
        │  wait* helpers no-op (isMocking() === true)             │
        │  → passes with no Docker                                │
        └─────────────────────────────────────────────────────────┘

        ┌─ capture mode (manual, local) ─────────────────────────┐
        │  1. bring up bare regtest env (docker helper)           │
        │  2. disable mocking (fetchMock.disableMocks() / env)    │
        │  3. createFetchFn tee appends 'path': `body`, → network.txt
        │  4. run the ONE test file individually                  │
        │  5. paste network.txt entries into that test's          │
        │     RESPONSE_MAP, commit                                │
        └─────────────────────────────────────────────────────────┘
```

- `fetchMock.enableFetchMocks()` is already global via
  `configs/jestSetup.js`, so `setApiMocks` works in this package with zero setup.
- Per-test long timeouts: call `jest.setTimeout(3_600_000)` at the top of each
  e2e file (functional-tests uses 1h). No jest.config change.
- Capture toggle: an env flag (e.g. `E2E_CAPTURE=1`) that (a) calls
  `fetchMock.disableMocks()` and (b) enables the `network.txt` tee.

> Note: this is a **separate** mock system from the package's existing
> `mocks/data/{fn}/{day}.json` + `fixtures.ts` (curated D-day fixtures). The e2e
> captures live in/next to the e2e test files as responseMaps. The two coexist;
> migrating the curated fixtures is out of scope for now.

---

## 3. Directory layout

```
packages/bitcoin-staking/e2e/
  PLAN.md                  ← this file
  .env.example             ← documents env vars (committed); real .env gitignored
  harness/
    env.ts                 ← typed env (env-schema + typebox), port of functional-tests
    accounts.ts            ← getAccount(key) + named ADMIN/STAKER/SIGNER roles
    network.ts             ← stacksNetwork(), apiClient, createFetchFn w/ network.txt tee
    btc.ts                 ← @btc-helpers/rpc client + wallet helpers (fund, sendToAddress, listUnspent)
    docker.ts              ← regtestComposeUp/Down/Logs, networkEnvUp/Down, dockerReset
    wait.ts                ← wait-for-* helpers (compose on each other; no-op when mocking)
    cycles.ts              ← thin re-export/glue over src/cycles.ts for D-day↔height math
    mocking.ts             ← re-export setApiMocks/isMocking from @stacks/internal + tee enable
  helpers.test.ts          ← one-shot sanity tests (pure helpers, no network)
  00-connectivity.test.ts  ← fetchPoxInfo, get account — smallest live round-trips
  01-transfer.test.ts      ← "transfer X STX to Y", fund BTC wallet → send to address
  10-bootstrap.test.ts     ← deploy sBTC + signer-manager, register signer, set-bond-admin
  20-setup-bond.test.ts    ← setup-bond at the correct time (within BOND_GAP of start, before open)
  30-register-stake.test.ts← register-for-bond (sbtc + btc lockup), stake, verify membership
  ...                      ← later: extend, unstake, claim-rewards, early-exit
```

`harness/` mirrors `stacks-functional-tests/src/{env,helpers,utils}.ts` almost
1:1, trimmed to what bitcoin-staking needs and re-pointed at the SDK under test
(`import { ... } from '../src'`).

---

## 4. Environment (port of `stacks-functional-tests/src/env.ts`)

Typed via `env-schema` + `@sinclair/typebox`, loaded from `.env`. Defaults target
the local bitcoin-staking regtest env.

| Var | Default | Purpose |
|-----|---------|---------|
| `NETWORK` | `devnet` | `devnet` = local docker env (harness owns its lifecycle); `testnet` = a remote/running net (skip docker, just set `STACKS_API`). Both use ST testnet addresses; no mainnet flavor. |
| `STACKS_API` | `http://localhost:3999` | Single base for ALL Stacks HTTP — the API proxies the node, so the same host serves `/extended/*` REST **and** raw `/v2/*` RPC (e.g. `https://api.private-1.hiro.so`). No separate node URL. |
| `NETWORK_ID` | `0x80000000` (testnet) | Chain id used to sign txs (the node's `/v2/info` `.network_id`). Set to match a custom net, e.g. `256` for the hosted private net — its default-testnet id fails signature validation. |
| `BITCOIND_URL` | `http://btc:btc@localhost:18443` | bitcoind RPC (`@btc-helpers/rpc`) |
| `STACKING_KEYS` | (3 keys from env compose) | pre-funded accounts → roles |
| `REGTEST_WORKING_DIR` | `../stacks-regtest-env` | docker compose cwd |
| `NETWORK_UP_CMD` / `NETWORK_DOWN_CMD` | compose up/down | env lifecycle |
| `STACKS_25_HEIGHT` / `STACKS_30_HEIGHT` / `STACKS_40_HEIGHT` | `108`/`131`/`141` | epoch boundaries (pox-5 activates at 4.0) |
| `POX_REWARD_LENGTH` / `POX_PREPARE_LENGTH` | `20` / `5` | cycle math |
| `POLL_INTERVAL` / `RETRY_INTERVAL` | `300` / `500` | wait-loop cadence (ms) |
| `STACKS_TX_TIMEOUT` / `BITCOIN_TX_TIMEOUT` | `10_000` / `20_000` | per-op timeouts |
| `E2E_CAPTURE` | `0` | when `1`: disable mocks + enable `network.txt` tee |
| `SKIP_UNLOCK` | `false` | skip slow unlock/reward waits |

All values are the **same as functional-tests / the env's `docker-compose.yml`**
so behaviour matches the existing setup.

---

## 5. Wait helpers (compose on each other; no-op under mocking)

Ported from `stacks-functional-tests/src/helpers.ts`, plus pox-5/bond-specific
ones built on top. Every helper short-circuits when `isMocking()` (like
`apiMockingHelpers.waitForBlock/Cycle`).

Base (port as-is):
- `waitForNetwork()` — poll node status, then `waitForBurnBlockHeight(WAIT_UNTIL)`
- `waitForBurnBlockHeight(h)` — the primitive everything builds on; throws if height stalls past `BITCOIN_TX_TIMEOUT`
- `waitForNextCycle(poxInfo)`, `waitForPreparePhase(poxInfo, diff?)`, `waitForRewardPhase(poxInfo, diff?)`
- `waitForNextNonce(addr, current)`, `waitForFulfilled(fn)`
- `waitForTransaction(txid)` / `broadcastAndWaitForTransaction(tx, network)` — via socket client

New, bitcoin-staking specific (layered on `waitForBurnBlockHeight` + `src/cycles.ts`):
- `waitForEpoch('2.5'|'3.0'|'4.0')` → `waitForBurnBlockHeight(STACKS_2x_HEIGHT)`
- `waitForPox5Activation()` → `waitForEpoch('4.0')` (pox-5 boot contract activates here)
- `waitForCycle(cycle)` → `waitForBurnBlockHeight(rewardCycleToBurnHeight({cycle, poxInfo}))`
- `waitForBondDay(bondIndex, day)` → "**wait until day X**" for a bond's lifecycle.
  Converts a D-day (the same axis as `mocks/generate.ts`: `D0 = bond first reward
  cycle start`, `±day` ≈ `day * rewardCycleLength / 14` burn blocks) to a burn
  height via `bondPeriodToBurnHeight`/`bondPhaseRanges` (`src/cycles.ts`), then
  `waitForBurnBlockHeight`. This is the helper for "create a bond at the correct
  time" and for asserting `fetch*` snapshots at D-7/D0/D90/D182 etc.

---

## 6. Docker helpers (port of `stacks-functional-tests/src/utils.ts`)

- `networkEnvUp()` / `networkEnvDown()` — `exec(NETWORK_UP_CMD/DOWN_CMD)`
- `regtestComposeUp(services?, opts?)` / `regtestComposeDown()` / `regtestComposeLogs()` —
  `cd REGTEST_WORKING_DIR && docker compose up -d <services>`. Pass an explicit
  **service list** to bring up the **bare env only** (omit `btc-staker`,
  `monitor`, `stacker`).
- `dockerReset()` — `docker compose down --volumes && up -d <bare services>` for a
  clean genesis chain (bootstrap/`setup-bond` are once-per-chain).

Typical capture run: `dockerReset()` → `waitForPox5Activation()` → run one test
file → `regtestComposeDown()`.

---

## 7. Build order (start simple, step by step)

Each step is its own file; ship + capture one before starting the next.

1. **`helpers.test.ts`** — pure functions, no network (e.g. D-day↔height,
   `burnHeightToRewardCycle`). Mirrors the trivial `stacking/tests/helpers.test.ts`.
2. **`00-connectivity.test.ts`** — smallest live round-trips: `fetchPoxInfo()`,
   account status. Proves env + capture + replay loop end-to-end on one call.
3. **`01-transfer.test.ts`** — one-shot "transfer X STX from ADMIN to STAKER"
   (STX transfer + `waitForTransaction`); fund the BTC wallet from the miner and
   `sendToAddress`. Establishes the hardcoded wallets used by all later scenarios.
4. **`10-bootstrap.test.ts`** — `waitForPox5Activation()`, deploy sBTC +
   signer-manager contracts, register the signer key, `buildSetBondAdmin` to
   rotate admin to ADMIN.
5. **`20-setup-bond.test.ts`** — `buildSetupBond` for `bondIndex` at the correct
   time (`waitForBondDay(idx, -GAP)` / before open height), with an allowlist
   entry for STAKER. Assert via `fetchBond`/`fetchProtocolBond`.
6. **`30-register-stake.test.ts`** — `buildRegisterForBond` (sbtc path first,
   then btc lockup w/ SPV proof), `buildStake`, verify `fetchBondMembership` /
   `fetchStakerInfo`.
7. **Later** — `buildStakeUpdate`/extend, `buildUnstake`, `buildClaimRewards`,
   early-exit, watchdog (gated on the open contract questions in `notes/status.md`).

---

## 8. Dependencies to add (devDependencies of the package)

From functional-tests, scoped to what we use:
- `@btc-helpers/rpc` — bitcoind RPC client
- `@hirosystems/api-toolkit` — `timeout`, `waiter`, `logger`
- `@sinclair/typebox` + `env-schema` — typed env
- `@stacks/blockchain-api-client` — API/socket clients used by wait helpers
- (already present) `@stacks/internal` — `setApiMocks`, `isMocking`, `network.txt` tee
- `jest-fetch-mock` is already wired globally via `configs/jestSetup.js`

---

## 9. Open questions / to confirm before coding

1. **`network.txt` tee location** — enable it inside `@stacks/common`'s
   `createFetchFn` (affects all packages) vs. a local wrapper fetch passed only to
   the e2e network client (isolated). *Lean: local wrapper, keep `createFetchFn`
   untouched.*
2. **sBTC + signer-manager contract sources** — copy the `.clar` files from
   `stacks-regtest-env/stacking/contracts/` into `e2e/contracts/`, or read them
   from `REGTEST_WORKING_DIR` at runtime? *Lean: read from `REGTEST_WORKING_DIR`
   to avoid drift.*
3. **Signer-manager** — the deprecated flow deployed a `pox-5-signer.clar`
   reference manager. Confirm the SDK is expected to target that reference
   manager for `register-for-bond`/`buildGrantSignerKey`, or a different one.
4. **Bare-env service list** — confirm the exact set of compose services that
   must run for a node+api+signers chain without the staking daemons.
5. **Capture granularity** — one responseMap per test file (simplest) vs. shared
   maps for common reads (`/v2/pox`, fees). *Lean: per-file, with a small shared
   base map for pox/fees like `apiMockingHelpers` already does.*
