# Regtest e2e actions — conventions

Small, hand-run "actions" (Jest tests) that exercise the `@stacks/bitcoin-staking`
SDK against the local regtest env at `../stacks-regtest-env`. Run individually;
captured traffic lands in `fixtures.json` for later mock replay (see "Record →
replay" below).

## Layout
- `tests/helpers/utils.ts` — `ENV`, `getNetwork()`, retry/timeout, network lifecycle (`networkUp`/`networkDown`/`networkReset` — thin wrappers that exec the `NETWORK_*_CMD` env commands, see `.env.example`; unset → no-op), `RECORD` flag.
- `tests/helpers/wait.ts` — reads (`getPoxInfo`, `getStxBalance`, …) + waiters (`waitForNetwork`, `waitForPox5`, `waitForTransaction`, `broadcastAndWaitForTransaction`, `ensurePox5`) + cycle math.
- `tests/helpers/btc.ts` — bitcoind JSON-RPC (`getNewAddress`, `sendToAddress`, …).
- `tests/helpers/deploy.ts` — `loadContractSource`, `deployContract`.
- `tests/regtest/regtest.ts` — hardcoded accounts: `REGTEST_KEYS`, `STACKING_KEYS`, `getAccount(key)`, `ACCOUNTS` (admin/staker/signer).
- `tests/regtest/actions/*.test.ts` — the actions.

## Patterns
- Import the SDK under test from `'../../../src'`; helpers from `'../../helpers/…'`; accounts from `'../regtest'`.
- Resolve once as module-level consts: `const network = getNetwork();`, `const account = getAccount(REGTEST_KEYS.account1);`.
- pox-5 read tests: `beforeAll(() => ensurePox5(), 20 * 60_000);` (reuses the running chain; fresh-starts only if the node is down).
- Tests that drive their own staking: `ensurePox5({ env: { POX5_STACKING_ENABLED: 'false' } })` to disable the env's keep-alive daemon.
- `jest.setTimeout(20 * 60_000)` at the top (chain ops are slow).
- Keep assertions exact where the value is deterministic; `console.log` the interesting bits.
- Don't introduce `any`. Use our own types (e.g. `PoxInfo` from `'../../../src'`).
- The env's miner auto-mines; wait for confirmations via the `waitFor*` helpers, don't generate blocks.

## Funded accounts
- `REGTEST_KEYS.account1/2/3` — pre-funded BUT **NOT idle**: these are the env's
  `tx-broadcaster` flooder accounts (its compose `ACCOUNT_KEYS`). It spams STX
  transfers from them, so their balances/nonces drift and reads are noisy. We
  bring the env up with `--scale tx-broadcaster=0` (part of the suggested
  `NETWORK_UP_CMD`, see `.env.example`) to
  keep the flooder OFF — there's no env-var to disable it. Even so, prefer
  account4 below for clean assertions.
- `REGTEST_KEYS.account4` — pre-funded and **pristine** (nonce 0, untouched by
  any daemon) → the one to use for exact balance/nonce assertions, no races.
- `STACKING_KEYS[0..2]` / `ACCOUNTS.{admin,staker,signer}` — driven by the env daemons unless `POX5_STACKING_ENABLED=false`.

## Running (IMPORTANT: from the package dir)
```bash
cd /Users/jannik/Documents/Repositories/stacks.js/packages/bitcoin-staking
RECORD=1 npx jest tests/regtest/actions/<name> --runInBand --collectCoverage=false
```
- `RECORD=1` disables jest-fetch-mock (hit the live node) and records observed
  responses into `tests/regtest/fixtures.json`. Without it, tests run in mock/replay mode.
- Running `npx jest` from the repo root uses the wrong (root) config → "Cannot use import statement outside a module". Always `cd` into the package first.
- Typecheck: `npx tsc --noEmit` (covers `tests/**`).

## Record → replay (`useFixtures`)

One paradigm, both directions — `useFixtures(key?)` from `tests/helpers/mock.ts`:
- **Replay** (default, no Docker): installs a single `fetch` mock that serves the
  default `fixtures.json` + `fixtures-<key>.json`, matched by `fixtureKey` (the SAME
  key the recorder writes). It serves **Stacks REST, bitcoind JSON-RPC, and mempool**.
- **Record** (`RECORD=1`): routes captured responses to that file, merged + deduped
  (latest wins). Don't hand-edit fixtures — re-record.
- **Phase rules** (latest-wins makes these load-bearing):
  1. switch phases BEFORE a mutating broadcast (its confirmation polling shares
     `/v2/accounts` URLs with the previous phase's reads);
  2. ONE broadcast per phase (`POST /v2/transactions` keys by path only);
  3. any test block that re-reads a URL another block derived dynamic
     call-read keys from (`/v2/pox` + heights, typically) gets its own phase.
- Recording sessions start from a FRESH chain (`FRESH=1 scripts/record.sh …`) —
  suites enroll their dedicated accounts and trip their own state on reuse.

```bash
# replay (offline):  npx jest tests/regtest/actions/<name> --collectCoverage=false
# record (live):     RECORD=1 npx jest tests/regtest/actions/<name> --runInBand --collectCoverage=false
```

`fixtureKey` is body-aware: Stacks REST → `path+search`; bitcoind RPC → `host#method:params`;
`call-read` → `path#sender:args` (so a multi-account test distinguishes stakers);
`map_entry` → `path#mapkey`. `/v2/transactions` (broadcast) stays path-keyed.

The `waitFor*` loops short-circuit under replay (`isMocking` in `wait.ts`), and
`broadcastAndWait`'s nonce wait skips — so static fixtures don't need to satisfy a
polling condition.

### Phases (same path, different responses over time)
When a read flips over a step (e.g. `get-bond-membership` none → enrolled, an sBTC
balance, `get-total-sbtc-staked`), call `useFixtures('<test>')` then
`useFixtures('<test>-after')` at the transition. Each phase file holds only the
endpoints that changed; replay layers them additively. (This is the clean version of
the old `setApiMocks` "same path, different response" caveat — `pox5-readonly` still
uses the legacy path-keyed `setApiMocks` and stays live-oriented.)

### Recording caveat: one bond-creating test per chain+cycle
`waitForBondWithRunway` is deterministic per cycle, so two **bond-creating** tests
(setup-bond / register / combined / unstake) run in the same cycle on the same chain
pick the **same bondIndex** → the second aborts with `ERR_BOND_ALREADY_SETUP` and reads
the wrong allowlist. When (re-)recording several, give each a **fresh chain** (or let the
chain advance to a new window between them). Replay is unaffected (each test has its own
fixtures). Legacy `setApiMocks` / `BASE_POX5` remain only for `pox5-readonly`/`reads`-style
path-keyed actions.
