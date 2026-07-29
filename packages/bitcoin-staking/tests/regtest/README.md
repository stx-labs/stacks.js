# Regtest e2e tests

Hand-run Jest tests exercising the `@stacks/bitcoin-staking` SDK against the
local regtest env at `../stacks-regtest-env`. Live traffic is captured to
`fixtures/fixtures-*.json` and replayed offline by default (no Docker needed).

```bash
# ALWAYS run from the package dir (repo-root jest uses the wrong config):
cd packages/bitcoin-staking

# replay (offline, default) — partial or full:
npx jest tests/regtest/actions/<name> --collectCoverage=false
npx jest tests/regtest --collectCoverage=false   # full offline replay (~6s)

# record (live chain) — one suite or the whole suite, serial. The record harness
# is hands-off: a jest globalSetup resets a wedged/down chain first, and flaky
# attempts are retried with their fixtures cleared (see "Recording", below).
# Never run two record sessions at once (shared bond-admin nonce).
RECORD=1 npx jest tests/regtest/actions/<name> --runInBand --collectCoverage=false
RECORD=1 npx jest tests/regtest --runInBand --collectCoverage=false
```

## Network lifecycle

The suite never runs docker itself — it execs three opaque command strings, so it
can front any environment (local docker, a remote script, nothing). The commands
carry all the environment/path specifics; the abstraction has none. Set them in
`.env` (see `.env.example`); an unset command is a no-op (right for a remote net):

```bash
NETWORK_UP_CMD='cd ../../../stacks-regtest-env && docker compose up -d --build'
NETWORK_DOWN_CMD='cd ../../../stacks-regtest-env && docker compose down'
NETWORK_RESET_CMD='cd ../../../stacks-regtest-env && docker compose down --volumes --remove-orphans --timeout=1 && docker compose up -d --build'
```

Tests never call these — lifecycle is the record harness's job (below). Tests only
wait for readiness via `ensurePox5()` (node responsive + pox-5 active).

## Recording (hands-off)

Two RECORD-only jest hooks make a live re-record largely unattended:

- `tests/helpers/jest-record-preflight.ts` (globalSetup) — once, before the run: if the
  regtest chain is wedged (stacks node trailing bitcoind) or down, `networkReset`s
  it and waits for pox-5. Regtest only; the hosted privatenet can't be wiped.
- `tests/helpers/jest-record-retry.ts` — retries a flaky attempt (`RECORD_RETRIES`,
  default 3), discarding the fixtures that attempt wrote so the rerun records
  clean. Works for a single test or the whole suite. Inert under replay: a replay
  failure is a real regression, never retried.

## Layout

- `tests/helpers/utils.ts` — `ENV`, `getNetwork()`, retry/timeout, network lifecycle (`networkUp/Down/Reset`), `RECORD` flag.
- `tests/helpers/wait.ts` — reads (`getPoxInfo`, …), waiters (`broadcastAndWaitForTransaction`, `ensurePox5`, `waitForRewardPhase`, …), cycle math.
- `tests/helpers/btc.ts` — bitcoind JSON-RPC. `tests/helpers/mock.ts` — `useFixtures`.
- `tests/regtest/regtest.ts` — accounts: `REGTEST_KEYS`, `STACKING_KEYS`, `getAccount`, `ACCOUNTS`.
- `tests/regtest/{actions,eligibility,e2e}/*.test.ts` — the tests. `actions/` = one
  action demo per file; `eligibility/` = preflight gates + their abort codes (incl. the
  `*-aborts` negative-path suites); `e2e/` = the full bond-lifecycle story.
- `tests/regtest/fixtures/` — the record/replay store: `fixtures.json` (default) +
  `fixtures-<key>.json` (per-phase), nested to match privatenet's layout.

## Conventions

- Import SDK from `'../../../src'`, helpers from `'../../helpers/…'`, accounts from `'../regtest'`.
- Resolve as module-level consts: `const network = getNetwork();`.
- No `any`; use SDK types (e.g. `PoxInfo`). Assert exact deterministic values; `console.log` the rest.
- The miner auto-mines — wait via the `waitFor*` helpers, never generate blocks.
- Timeouts match what's being waited on: a **stall** (chain stops producing) fails
  in `BITCOIN_TX_TIMEOUT` (~15s, via `waitForChainProgress` — tx confirms, nonce/burn
  targets); a **boot/activation** (fresh chain → pox-5, ~4 min) is bounded by the
  longer `BOOT_TIMEOUT` (~8 min, via `waitForFulfilled`'s ceiling); post-effect reads
  on a live chain stay unbounded (jest timeout). Override any via env for slow nets.
- pox-5 asset-moving calls (register/stake/unstake/rewards) need `postConditionMode: 'allow'`
  (the string — the enum doesn't typecheck), else `abort_by_post_condition`.
- **Confirmation helper — pick by what you assert.** `broadcastAndWait` (node-nonce)
  for the happy path: it can't tell success from a runtime abort, so assert the on-chain
  *effect* afterwards (a read). `broadcastAndWaitForTransaction` (reads `/extended`) only
  when you must inspect `tx_status`/the abort code — abort-probe negative tests. Never
  hand-roll a `broadcastTransaction` + poll loop; both helpers no-op the wait under replay.

## Accounts (`regtest.ts`)

- `account4` — pristine (nonce 0), the one for exact balance/nonce assertions.
- `account1/2/3` — pre-funded but NOT idle (env flooder accounts); noisy, avoid.
- `account16..23` — dedicated fresh keys for suites that register-and-never-unstake
  (see gotchas). `STACKING_KEYS` / `ACCOUNTS.{admin,staker,signer}` are daemon-driven
  unless `POX5_STACKING_ENABLED=false`.

## Record → replay (`useFixtures`)

`useFixtures(key)` serves Stacks REST + bitcoind RPC + mempool from
`fixtures.json` + `fixtures-<key>.json`. Recording merges responses latest-wins,
which makes phase boundaries load-bearing:

1. Switch phase BEFORE a mutating broadcast (its confirmation polling shares URLs
   with the previous phase's reads).
2. ONE broadcast per phase (`POST /v2/transactions` is keyed by path only).
3. When a read flips over a step (`get-bond-membership` none→enrolled, a balance,
   a total), add a `*-after` phase at the transition. Each phase file holds only
   what changed; replay layers them additively.

`fixtureKey` is body-aware: REST → `path+search`; RPC → `host#method:params`;
`call-read` → `path#sender:args` (distinguishes stakers); broadcast → path only.
Waiters short-circuit under replay. Don't hand-edit fixtures — re-record.

## Re-recording gotchas

- **Fresh chain per recording session** — suites enroll dedicated accounts and
  trip their own state on reuse. The preflight (above) only resets a *wedged/down*
  chain; to force a fresh one on a healthy chain, run `NETWORK_RESET_CMD` yourself.
- **One-shot-membership accounts** — suites that register and never unstake
  (`e2e/bond-lifecycle`, `eligibility/register-aborts`, `register-for-bond-combined`)
  leave a PERMANENT membership, so each live re-record burns its account and needs a
  **fresh key** (kept in `regtest.ts`, dead ones noted inline). Verify clean first:
  `fetchBondMembership({address})` must return `undefined`.
- **One bond-creating test per chain+cycle** — `waitForBondWithRunway` is
  deterministic per cycle, so two setup/register tests in the same cycle pick the same
  `bondIndex` → the second aborts `ERR_BOND_ALREADY_SETUP`. Give each a fresh chain or
  a new window.
- **Preflight ⇄ post-broadcast read collision** — an eligibility preflight and a
  post-broadcast read can share a call-read key in one phase; latest-wins keeps the
  post value, so replay's preflight sees the wrong state and may branch into an
  uncaptured read. Fix with a `*-after` phase split (rule 3 above).
- **u47 prepare-phase race** — broadcasts landing in the prepare window abort
  `StakeInPreparePhase`. Keep `waitForRewardPhase`'s margin generous. Symptom:
  intermittent aborts only near cycle boundaries.
- **Nonce contention** — don't record bond suites back-to-back; they share the
  bond-admin account (`ConflictingNonceInMempool`). Drain the mempool between
  records, or record with `--runInBand` (the default above) so suites run
  serially in one process.

## Timing (~2s/block, epoch 4.0)

- Fresh chain boot to epoch 4.0: **~4 min**.
- Per-suite record: reads/actions ~10–45s; `bond-lifecycle` ~60–75s; `register-aborts` ~3–5 min (u47 wait).
- Full suite record (~30 files, fresh chain): **~40 min**. Full offline replay: **~6s**.

## Reward payout (what the reward-payout suites encode)

The `reward-payout-{sbtc,signer,l1-withdrawal}` + `vault-rewards-payout` suites verify
pox-5 reward mechanics end-to-end. The non-obvious findings, all SDK-relevant:

- **Rewards are ALL sBTC — there is no STX reward payout.** The bond-index=none "STX-only
  leg" is rewards for STX-only stakers, still paid in sBTC to the signer.
- **The pot is MEASURED, not pushed.** `get-rewards = pox-5's sBTC balance − total-staked −
  reserve`; there is no deposit fn. Rewards enter only by transferring sBTC into the pox-5
  principal. On regtest nothing funds it, so a test must send its own "fuel" sBTC to observe
  a payout — else `earned` is 0 / abort `u32`.
- **`earned` is bounded by STAKE (shares × rate × cycles), NOT the fuel.** Raise the stake to
  hit a target earned; excess fuel just goes to reserve.
- **The settle bridge.** `calculate-rewards` writes the GLOBAL rewards-per-token map, but
  `get-earned-staker-rewards` reads a per-signer map populated only by `settle-rewards` (run
  on a claim/stake mutation). So the order is: calculate-rewards → signer-manager
  `claim-rewards` (settles) → THEN staker `earned` reads > 0. `calculate-rewards` +
  `claim-rewards` need the FULL sorted active-bond set (top 6), else `u33`/`u29`.
- **Two-hop payout via the signer-manager (not pox-5's own `claim-rewards`, which needs
  contract-caller == signer).** pox-5 → signer-manager, then `claim-staker-rewards` → sBTC to
  the staker (no pox-addr) or an L1 withdrawal request (pox-addr staker). sBTC withdrawals
  have a **DUST_LIMIT of 546** (`earned − max-fee > 546` or abort `u502`).
- **Cycle-search probe (robustness).** `calculate-rewards` credits exactly ONE cycle (the
  reward cycle of `distributionStart − 1`), which drifts run-to-run → pinning a fixed cycle
  intermittently aborts `u32`. All four suites probe the SIGNER-level `fetchEarned` (the
  global map, populated without a settle) across `[firstRewardCycle, +3]` to find the credited
  cycle, then claim THAT cycle. Read-only → replay-safe.
- The L1 final BTC sweep needs the real signer set (privatenet) — regtest asserts only the
  withdrawal request + lock.
