# Regtest e2e tests

Hand-run Jest tests exercising the `@stacks/bitcoin-staking` SDK against the
local regtest env at `../stacks-regtest-env`. Live traffic is captured to
`fixtures-*.json` and replayed offline by default (no Docker needed).

```bash
# ALWAYS run from the package dir (repo-root jest uses the wrong config):
cd packages/bitcoin-staking

# replay (offline, default):
npx jest tests/regtest/actions/<name> --collectCoverage=false
# record (live chain):
RECORD=1 npx jest tests/regtest/actions/<name> --runInBand --collectCoverage=false
```

## Layout
- `tests/helpers/utils.ts` — `ENV`, `getNetwork()`, retry/timeout, network lifecycle (`networkUp/Down/Reset`), `RECORD` flag.
- `tests/helpers/wait.ts` — reads (`getPoxInfo`, …), waiters (`broadcastAndWaitForTransaction`, `ensurePox5`, `waitForRewardPhase`, …), cycle math.
- `tests/helpers/btc.ts` — bitcoind JSON-RPC. `tests/helpers/mock.ts` — `useFixtures`.
- `tests/regtest/regtest.ts` — accounts: `REGTEST_KEYS`, `STACKING_KEYS`, `getAccount`, `ACCOUNTS`.
- `tests/regtest/{actions,adversarial,eligibility,e2e}/*.test.ts` — the tests.

## Conventions
- Import SDK from `'../../../src'`, helpers from `'../../helpers/…'`, accounts from `'../regtest'`.
- Resolve as module-level consts: `const network = getNetwork();`.
- No `any`; use SDK types (e.g. `PoxInfo`). Assert exact deterministic values; `console.log` the rest.
- The miner auto-mines — wait via the `waitFor*` helpers, never generate blocks.
- pox-5 asset-moving calls (register/stake/unstake/rewards) need `postConditionMode: 'allow'`
  (the string — the enum doesn't typecheck), else `abort_by_post_condition`.

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

`pox5-readonly` still uses the legacy path-keyed `setApiMocks` and stays live-oriented.

## Re-recording gotchas
- **Fresh chain per recording session** (`FRESH=1 scripts/record.sh …`): suites
  enroll dedicated accounts and trip their own state on reuse.
- **One-shot-membership accounts** — suites that register and never unstake
  (`e2e/bond-lifecycle`, `adversarial/register-aborts`, `register-for-bond-combined`)
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
  bond-admin account (`ConflictingNonceInMempool`). Drain the mempool between records,
  or use the `record.sh` driver which sequences them.

## Timing (~2s/block, epoch 4.0)
- Fresh chain boot to epoch 4.0: **~4 min**.
- Per-suite record: reads/actions ~10–45s; `bond-lifecycle` ~60–75s; `register-aborts` ~3–5 min (u47 wait).
- Full suite record (~30 files, fresh chain): **~40 min**. Full offline replay: **~6s**.
