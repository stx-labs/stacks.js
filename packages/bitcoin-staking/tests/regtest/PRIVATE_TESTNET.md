# Private testnet — guidance & rules

How we run the bitcoin-staking action tests against the **hosted private testnet**
(`api.private-1.hiro.so`) instead of the local docker devnet. Read this before
pointing any broadcasting test at it.

## The combo

```bash
NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so RECORD=1 \
  POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
  npx jest tests/regtest/actions/<name> --runInBand --collectCoverage=false
# or for privatenet-specific tests:
  npx jest tests/privatenet/actions/<name> --runInBand --collectCoverage=false
```

> **Rate limiting:** `api.private-1.hiro.so` returns HTTP 429 when polled faster
> than ~1 req/s. Always set `POLL_INTERVAL=10000 RETRY_INTERVAL=10000` when
> targeting this host. The `withRetry` wrapper also backs off 15 s (or the
> `Retry-After` header value) on 429 responses automatically.

- `NETWORK=testnet` — remote/running net; the harness skips all docker lifecycle.
- `NETWORK_ID=256` — this net's chain id (`0x100`), NOT the default testnet
  `0x80000000`. Signing with the wrong id fails `SignatureValidation`. **Required**
  for any test that broadcasts.
- `STACKS_API` — one base for everything; it proxies the node, so `/extended/*`
  and `/v2/*` both work off it.
- `RECORD=1` — hit live (disables the fetch mock). Use `FIXTURES_JSON=/tmp/x.json`
  if you don't want to touch the committed fixtures.

Always run from the package dir (`packages/bitcoin-staking`).

## Chain state

This net is wiped periodically (observed twice in a single session). When it is reset:
- All balances, nonces, deployed contracts, and transaction history are wiped.
- pox-5 / bond contracts will not exist until enough burn blocks pass to reach
  Epoch 4.0 (the local default is burn height 141, but the private net may use
  different heights).
- Any STX previously funded to temporary accounts (account7, account8, etc.) is wiped.
- Bond indices restart from 0 — do NOT hard-code prior `bondIndex` values.
- Nonces reset to 0 for all addresses.

**When a wipe is detected:** re-run `ensurePox5()` before any bond actions, and
recalculate `bondIndex` from scratch using the `bondPeriodToBurnHeight` while-loop
pattern. Never hard-code bond indices across sessions.

**Known wipe log:**
- Wipe 1: ~2026-06-05 session, mid-bond-1 setup
- Wipe 2: ~2026-06-05, after bond-1 confirmed (Cloudflare 5xx, chain fully down)

**Always check pox contract before running bond flows:**
```bash
curl -s https://api.private-1.hiro.so/v2/pox | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['contract_id'], 'burn:', d['current_burnchain_block_height'])"
```

## Current status (as of last check)

- **Wipe 3 / 2026-06-05 ~21:00**: chain reset again. At burn 177, cycle 8, pox-4 active. Waiting for pox-5 (~burn 210+, cycle 10).
- Previous: pox-5 active at burn 213, cycle 10 (pre-wipe).

> **`setup-bond` aborts `(err u3)` CannotSetupBondTooLate — SDK bond-index drift.**
> Consequence of the contract_versions quirk below. The contract anchors bond
> periods to a FIXED `first-bond-period-cycle` data-var (e.g. `11` on this net):
> `bond-period-cycle(i) = anchor + i*BOND_GAP_CYCLES`. The SDK's
> `firstPox5RewardCycle` can't find the (missing) pox-5 row and falls back to the
> *current* `rewardCycleId`, which drifts every cycle — so the SDK's computed
> bondIndex→cycle mapping disagrees with the contract's and `setup-bond` lands on
> an already-opened index → `(err u3)`. **Workaround:** read the real anchor from
> the data-var (`/v2/data_var/…/pox-5/first-bond-period-cycle`) — see
> `tests/privatenet/pox.ts::fetchFirstBondPeriodCycle`. Real node fix: populate
> `contract_versions[]` with the pox-5 row + its `first_reward_cycle_id`.
>
> **pox-5 missing from `contract_versions`** — The private testnet node's `/v2/pox`
> response does not include a pox-5 entry in `contract_versions[]` (only pox-1 through
> pox-4 appear), even though `contract_id` correctly reports pox-5 as the active
> contract. This is a node-side issue; colleagues have been notified. The SDK works
> around it in `firstPox5RewardCycle` (falls back to `rewardCycleId` when `contractId`
> ends with `.pox-5` but no matching `contractVersions` entry exists). The local devnet
> (`NETWORK=devnet`) does populate `contract_versions` correctly — this quirk is
> privatenet-only.

- `stx-staking` ✅ PASS — 4 txs, full lifecycle (stake → extend+topup → unstake). account8 funded in-test from admin.
- `setup-bond` ✅ PASS — bond index 1 created, txid `8ffde8f7b2eede4d3b4f73aa092872b3b5a4de6ec5194dac3498dddef5789118`, opens at burn 280.
- Bond / signer-manager: signer-manager IS deployed by daemon (`ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager` registered and working).
- `fetchAccountStatus`, `fetchPoxInfo`, `fetchStakerInfo`, `fetchBondMembership` all passing.
- `transfer-stx` works.

## Reward distribution / claiming (live probes — `rewards.test.ts`)

The pox-5 reward model is two-tier (see `src/build.ts` `calculate-rewards`): each
distribution cycle pays bond legs up to their target APY, routes 15% to the
reserve, then distributes the remainder pro-rata to STX-only stakers. Confirmed
live on api.private-1.hiro.so:

- **`calculate-rewards` is permissionless** — account5 (a non-admin) reached it;
  it aborted `u31` ERR_BOND_NOT_ACTIVE because the named bonds weren't active at
  the calculation height (anyone CAN call it to settle a cycle's waterfall).
- **STX-only leg and bond legs are independently tracked.** `get-earned(signer,
  isBond, index)` keys the STX-only leg by reward cycle (`isBond=false`) and each
  bond leg by bond index (`isBond=true`) — both queryable separately (both 0 here,
  no enrollment).
- **STX-only leg is claimable in isolation** — `claim-rewards` with empty
  `bondIndices` (STX-only leg only) is accepted as a shape; aborts `u32`
  ERR_NO_CLAIMABLE_REWARDS when that leg is empty.
- **`claim-rewards` is gated by claimable-balance, not membership** — both an
  allowlisted-but-unenrolled account (account5) and a totally unrelated account
  (account6) got `u32`, NOT `u34` ERR_NOT_BOND_PARTICIPANT. No STX moved (balance
  delta = −fee only), so an empty claim can't drain anything.

(We can't test a *successful* claim — no enrollment exists, since the sBTC/L1
register paths can't complete on this net. These probes map the entrypoints +
abort codes only.)

### Missed `calculate-rewards` — catch-up vs stranding (from pox-5.clar source)

Read directly from `stacks-regtest-env/stacking/contracts/pox-5.clar` `calculate-rewards`
(line 1550) + `get-new-rewards` (1541):

- **Always callable later (forward-only gate).** Gated by `calculation-height >
  last-reward-compute-height`; only reverts `u30` ERR_DISTRIBUTION_ALREADY_COMPUTED
  if recomputing an already-settled height. Permissionless.
- **Aggregate sBTC is never lost.** `accrued-rewards = get-rewards() -
  last-accounted-rewards-only` — the FULL delta since the last settlement, so a late
  call sweeps up the whole gap in one lump.
- **But timing misattributes recipients.** The lump is credited to the cycle AT
  settlement (`stx-cycle = burn-height-to-reward-cycle(calculation-height)`, written to
  `rewards-per-token-for-cycle[stx-cycle]`), NOT the cycles the rewards accrued in.
  Stakers who were active during a skipped interval but exit before settlement get
  nothing; whoever is staked at settlement captures the lump.
- **🔴 Stranding hazard.** If NO STX is staked in the cycle at settlement
  (`no-stx-stakers`), the entire STX-staker cut is folded into `reserve-balance`
  (`stranded-staker-cut`, lines 1591/1609) — permanently, unrecoverable by stakers.

**Operational takeaway:** `calculate-rewards` must be called every distribution cycle
(it's permissionless precisely so a keeper bot can guarantee this). Lazy/late settlement
doesn't burn aggregate sBTC but mis-pays the STX-only tranche and can sweep it to the
reserve. Worth a keeper SLA + monitoring at launch.

## Bond sequence + calculate-rewards shape (live probes — `adversarial-4.test.ts`)

- **Bond indices need NOT be sequential.** Our on-chain indices are non-contiguous
  (4-8, 12-24, 47-50 — gaps 9-11 and 25-46 were never created). Each bond period is
  independent; the contract never requires index N-1 to exist before N.
- **You cannot skip *ahead*.** `setup-bond` at a far-future index (soonest+3) aborts
  `u2` — the per-index window gates creation to ~`BOND_GAP_CYCLES` before its start.
- **`register-for-bond` against a never-created index aborts `u7`** ERR_BOND_NOT_FOUND.
- **`calculate-rewards` is capped at `(list 6 uint)`** — max 6 bond periods per call.
  Passing >6 is rejected at ABI analysis (`BadFunctionArgument`) before broadcast.
  ⚠️ Implication: if more than 6 bonds are ever simultaneously active, a single
  `calculate-rewards` call cannot satisfy `assert-all-active-bonds-included` (`u33`)
  → settlement could be blocked. Worth confirming the contract caps concurrent active
  bonds at ≤6, or provides a batched settlement path.
- **`calculate-rewards` enforces ordering + completeness:** list must be sorted by
  descending `stx-value-ratio` (else `u29`) and include every active bond (else `u33`).

## Discovered pox-5 error codes (live adversarial probes)

Confirmed on api.private-1.hiro.so via `tests/privatenet/actions/adversarial.test.ts`
and `register-for-bond.test.ts`:

| Code | Name | Provoked by |
|---|---|---|
| `u1` | `ERR_UNAUTHORIZED` | `register-for-bond` (L1/btc) where the bound signer-manager doesn't authorize the caller |
| `u2` | `ERR_CANNOT_SETUP_BOND_TOO_SOON` | `setup-bond` for a bond index more than `BOND_GAP_CYCLES` cycles before its start (incl. skip-ahead to a far-future index) |
| `u3` | `ERR_CANNOT_SETUP_BOND_TOO_LATE` | `setup-bond` for a bond index whose start cycle already passed (e.g. index 0) |
| `u4` | `ERR_BOND_ALREADY_SETUP` | `setup-bond` for an index that already exists |
| `u7` | `ERR_BOND_NOT_FOUND` | `register-for-bond` against a bond index that was never created |
| `u29` | `ERR_INVALID_BOND_PERIOD_ORDERING` | `calculate-rewards` with bond periods not sorted by descending `stx-value-ratio` |
| `u33` | `ERR_ACTIVE_BOND_NOT_INCLUDED` | `calculate-rewards` whose list omits a currently-active bond |
| `u11` | `ERR_NOT_ALLOWLISTED` | `register-for-bond` (sBTC) from an account not on the bond's allowlist |
| `u31` | `ERR_BOND_NOT_ACTIVE` | `calculate-rewards` naming bond indices that aren't active at the calculation height |
| `u32` | `ERR_NO_CLAIMABLE_REWARDS` | `claim-rewards` when every leg (STX-only + bond) is empty for the caller |
| `u43` | `ERR_BOND_ALREADY_STARTED` | `register-for-bond` against an already-open bond, by an allowlisted account, in the reward phase |
| `u47` | `ERR_STAKE_IN_PREPARE_PHASE` | `register-for-bond` during a cycle's prepare phase |

Plus a node-level (not contract) rejection: `setup-bond` with `earlyUnlockBytes`
longer than the 683-byte buff cap is rejected at ABI analysis with
`BadFunctionArgument` before it ever broadcasts.

> **Guard masking — param validation is gated behind timing/auth checks.** Two
> probe batteries showed pox-5 runs cheap guards FIRST, so adversarial inputs
> rarely reach the validation you're aiming at:
> - `setup-bond` checks the bond-period window (`u2` too-soon / `u3` too-late /
>   `u4` already-setup) BEFORE validating economic params. Fuzzing
>   `minUstxRatioBps`, `stxValueRatio`, allowlist shape, `maxSats` against a
>   future index just returns `u2` — the bad param is never evaluated. To test
>   param validation you must target the *soonest settable* index in its open
>   window (and a rejected param leaves the index free for the next attempt).
> - `register-for-bond` checks prepare-phase (`u47`) and allowlist (`u11`) before
>   the already-started check (`u43`) and lock-sbtc (`u1`). Probing
>   register-after-open only yields `u43` if done in the REWARD phase by an
>   allowlisted account. (Still unconfirmed here — kept hitting `u47`.)

## Adversarial security probes — confirmed safe

Aggressive attack battery (`adversarial-3.test.ts`) against pox-5:

- **Authorization holds.** A non-admin (`account5`) `setup-bond` at a valid (timing-passing)
  index aborts `(err u1)` ERR_UNAUTHORIZED — only the `bond-admin` can create bonds.
- **Trait conformance enforced.** `register-for-bond` with a non-conforming contract
  (passed `…pox-5` itself) as the `signer-manager` trait arg is rejected at the node
  ABI layer (`BadFunctionArgument`) before mining — a hostile/garbage trait contract
  can't reach contract logic.
- **No state corruption on abort.** Every rejected `setup-bond`/`register` left existing
  bonds byte-for-byte unchanged and produced no enrollment.

> **VALIDATION GAP — `setup-bond` does NOT sanity-check economic params.** Probing at a
> fresh soonest index (so neither `u2` nor `u4` masks it), the contract ACCEPTED:
> - `stxValueRatio = 0` → bond 19 created. `min-ustx-for-sats-amount` then returns 0, so
>   a staker pairs ZERO uSTX with their sats.
> - `minUstxRatioBps = 20000` (200%, i.e. >100%) → bond 20 created. An economically
>   absurd ratio is stored verbatim.
>
> - `maxSats = 100_000_000` (1 BTC per allowlisted staker) → bond 21 created. No upper
>   bound on the per-staker cap.
>
> - `targetRateBps = 65000` (650%) → bond 22 created. Rate not range-checked either.
>
> So `setup-bond` stores economic params with **no bounds checking** — confirmed across
> ALL FOUR params (`stxValueRatio`, `minUstxRatioBps`, `maxSats`, `targetRateBps`). All such calls are
> `bond-admin`-gated (a non-admin gets `u1` — confirmed), so this is an **admin footgun,
> not an external attack vector** — but the contract should defensively bound
> `stxValueRatio` (>0), `minUstxRatioBps` (≤10000), and `maxSats` (sane ceiling).

> **register-for-bond guard ordering — contract differs from our assumption.**
> register-for-bond.test.ts's header claimed `lock-sbtc` runs FIRST (so a 0-sBTC
> account aborts `(err u1)`). Live probes disprove this: an allowlisted-but-0-sBTC
> account in the prepare phase aborts `(err u47)`, and a non-allowlisted account
> aborts `(err u11)` — BOTH before `lock-sbtc` ever runs. Actual order is
> prepare-phase check → allowlist check → … → lock-sbtc. The `(err u1)` lock-sbtc
> path is only reachable for an allowlisted account, in the reward phase, with the
> right paired uSTX. Colleagues writing register flows should not rely on
> lock-sbtc being the first guard.

## Known quirks

### Use `broadcastAndWait` — not `broadcastAndWaitForTransaction`

The extended API indexer on this net is real-time (1 block behind). However, some transactions are silently dropped by the node's mempool — the broadcast call returns a txid but the tx never lands in a block. `broadcastAndWaitForTransaction` polls `/extended/v1/tx/{txid}` and times out when this happens, giving a misleading timeout error.

`broadcastAndWait` is more reliable: it confirms via nonce advance on `/v2/accounts/` (node-direct) and fails fast if the nonce doesn't advance. Prefer it over `broadcastAndWaitForTransaction` for all privatenet tests.

**Status:** `transfer-stx.test.ts` switched to `broadcastAndWait`. Root cause of silent drops under investigation.

## Rules

1. **No Bitcoin node access.** We do not have a bitcoind on this private net.
   All tests that require real L1 lockup proofs (`register-for-bond` L1-lock
   variant, `btc-transfer`, `btc-merkle-proof`) are blocked. sBTC-custodied
   registration (`is-l1-lock: false`) does NOT require a Bitcoin tx and IS
   testable here.
2. **Send only from daemon-free accounts.** It's a SHARED chain — the
   tx-broadcaster floods from `account1/2/3` and the keep-alive daemon stakes
   `STACKING_KEYS[0..2]` (= `ACCOUNTS.sbtcDeployer`). Sending from those
   races their nonce → `BadNonce`. Safe senders: **`account4` (admin), `account5`,
   `account6`**.
3. **`account7`/`account8` hold 0 STX here** — fund them first via
   `transfer-stx` (with `STACKS_ADDRESS`) or `fundStx(...)` before use.
4. **Never reset/wipe.** It's remote. Docker helpers no-op under `NETWORK=testnet`.
5. **One bond-creating action per cycle.** `setup-bond` / `register-for-bond*` /
   `unstake-sbtc` pick a deterministic `bondIndex` per cycle — two in the same
   cycle collide (`ERR_BOND_ALREADY_SETUP`). Space them across cycles.
6. **Don't redeploy daemon contracts.** `signer-manager` and `sbtc-token` are
   already deployed by the daemon under `ACCOUNTS.sbtcDeployer`. Use `SIGNER_MANAGER`
   as-is; don't run `deploy-signer-manager` here.
7. **Never run `set-bond-admin` here.** It mutates the SHARED pox-5 `bond-admin`
   and breaks the daemon and all bond flows for everyone on this chain.
8. **Don't commit live fixtures.** Use `FIXTURES_JSON=/tmp/x.json`.

> We WANT to find bugs here — breaking things is the point. The rules above are
> about not wrecking the SHARED chain for others, not about playing it safe.

## Action catalog

### `tests/regtest/actions/` (general — same test file, different env combo)

| Action | Sends from | Status |
|---|---|---|
| `transfer-stx` | account4 | ✅ works; default account4→account5, override recipient with `STACKS_ADDRESS` |
| `reads` | account4 | ✅ all reads work |
| `set-bond-admin` | admin | ❌ **forbidden on this net** (rule 6) |
| `setup-bond` | admin, account5 | ✅ works (bond index 1 set up) |
| `register-for-bond*` | admin, account4/5/6/7 | ⚠️ bond-creating; needs signer-manager deployed first |
| `update-bond-registration` | admin, account6 | ⚠️ needs an existing registration first |
| `unstake-sbtc` | admin, account7 | ⚠️ bond-creating; account7 needs funding |
| `stx-staking` | admin, account8 | ✅ works (account8 funded in-test from admin) |
| `btc-transfer` / `btc-merkle-proof` | — | ❌ need local bitcoind (devnet only) |
| `deploy-signer-manager` | sbtcDeployer | ❌ deploying here conflicts with daemon (rule 5) |
| `pox5-readonly` | — | ❌ resets to a fresh pre-pox-5 chain (devnet only) |

### `tests/privatenet/actions/` (private-net-specific)

| Action | Status |
|---|---|
| `reads` | ✅ all 4 passing: `fetchAccountStatus`, `fetchPoxInfo`, `fetchStakerInfo`, `fetchBondMembership` |
| `setup-bond` | ✅ bond index computed at runtime; wiped — needs re-run |
| `setup-bond-2` | 🔄 created, allowlist: account5+6+7; needs re-run after wipe |
| `bonds` | ✅ bond enumeration working |
| `register-for-bond` (sBTC abort path) | 🔄 ready (account5, bondIndex dynamic); needs live bond |
| `register-for-bond-l1` (L1 stub SPV rejection) | 🔄 ready; timing bug fixed; BOND_INDEX needs update after wipe |
| `stx-staking` | ✅ passed pre-wipe (account8, full lifecycle) |

✅ ready · ⚠️ runnable with noted precondition · ❌ blocked or devnet-only
