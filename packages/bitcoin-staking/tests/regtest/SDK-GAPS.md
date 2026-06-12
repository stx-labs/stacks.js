# SDK gaps & UX friction — found while composing e2e flows

Living document: anything that felt clunky, surprising, or error-prone while
writing tests that compose SDK calls the way an integrator would. Items are
candidates for SDK improvements — **do not auto-implement; review first** (per
PLAN.md's gap-finder principle). Dates are when the friction was hit.

## Friction found composing the bond lifecycle (2026-06-12)

1. **`calculate-rewards` requires the caller to know the full active-bond set,
   pre-sorted.** The entrypoint aborts with `u33` (active bond not included) or
   `u29` (wrong ordering) unless the caller passes EVERY active bond period,
   sorted by descending `stx-value-ratio`, capped at 6. The SDK exposes only the
   raw builder — every integrator has to hand-roll the discovery loop
   (`fetchProtocolBond` over an index range) + sort + cap. Candidate:
   `fetchActiveBondIndices()` (or `buildCalculateRewards({ discover: true })`)
   that does the scan/sort/cap server-roundtrip itself.

2. **No way to enumerate bonds.** There is `fetchBond(bondIndex)` /
   `fetchProtocolBond(bondIndex)` but nothing to list existing/active bonds, so
   discovery is a 0..N probe loop (N guessed). Same primitive would serve the
   `calculate-rewards` set, dashboards, and the rollover flow.

3. **Bond-period timing rules live off-SDK.** `setup-bond` is only valid inside
   `[bondStart - BOND_GAP_CYCLES·cycleLen, bondStart)` and `register` requires
   `burn < bondStart`; the test helpers (`pickBondIndex`, `waitForBondWithRunway`)
   re-derive this from constants. An integrator targeting "the next open bond
   window" has to reimplement it. Candidate: `nextOpenBondPeriod(poxInfo)` in
   `cycles.ts` (pure, no network).

4. **Prepare-phase rejection (`u47 ERR_STAKE_IN_PREPARE_PHASE`) is invisible
   until broadcast.** Roughly 25% of regtest wall-clock (5 of 20 blocks) rejects
   every stake/register/update/unstake. The SDK has cycle math but no
   `isInPreparePhase(poxInfo)` / `blocksUntilRewardPhase(poxInfo)` helper, so
   integrators discover it as an abort. (Tests now guard centrally in
   `broadcastAndWait` — see tests/helpers/wait.ts.)

5. **sBTC post-conditions are on the caller.** `buildRegisterForBond` with an
   sBTC lockup transfers `sbtcSats` to the pox-5 contract, but the builder does
   not add the matching fungible-token post-condition; tests pass it manually
   (`Pc.principal(...).willSendEq(sats).ft(SBTC_TOKEN, ...)`). Default-deny mode
   plus a missing PC means `abort_by_post_condition` at runtime. Candidate:
   builder adds the PC by default (overridable).

6. **`BondStatusName` vocabulary is non-obvious.** A not-yet-setup bond inside
   its window is `'eligible'`, a setup-but-not-started bond `'open'`, a running
   bond `'locked'` — first-guess names ("pending", "active") are wrong, and the
   type is flagged Unstable/UI-experimental. Worth either renaming toward the
   domain language used elsewhere (bond "starts", is "active") or documenting
   the state machine in the fetchBondStatus docstring (eligible → open →
   locked → unlocked → closed).

7. **Zero-reward claims are indistinguishable from successful claims** without
   reading the result repr: `claim-rewards` with nothing accrued still succeeds
   (`(ok ...)`) — fine on-chain, but the SDK offers no read that answers "is
   there anything to claim across my bonds/cycles" in one call
   (`fetchStakerUnclaimedRewards` is per-(signer, cycle, bond)).

8. **Guard evaluation order is part of the de-facto ABI but undocumented.**
   In `register-for-bond` the `let`-bindings resolve the bond (u7) and the
   allowance (u11) BEFORE the body's checks (prepare-phase u47, already-started
   u43, …), so which error a user sees depends on binding order in the Clarity
   source. Apps that branch on error codes need this order; today the only
   source of truth is reading pox-5.clar. Candidate: document per-entrypoint
   error precedence in `src/errors.ts` (the adversarial suite now pins some of
   it as executable documentation).

## Contract-behavior changes that broke previous test assumptions (2026-06-12)

These are not SDK bugs, but each invalidated a committed test/fixture silently —
they're the ABI-drift the action suite exists to catch:

- `register-for-bond` now resolves the bond (`u7 ERR_BOND_NOT_FOUND`) and the
  allowlist (`u11`) BEFORE evaluating the lockup; the old "aborts in lock-sbtc
  with `u1`" smoke test premise is gone (test updated to expect `u7`).
- `bond-index` became a time-based period index
  (`bond-period-to-reward-cycle`), not a creation sequence number.
- Prepare-phase guard (`u47`) now applies to register/update/unstake, not just
  stake.

## Env/test-harness rules worth knowing (2026-06-12)

- **Fixture phases**: switch (`useFixtures('<key>-<phase>')`) BEFORE each
  mutating broadcast — confirmation polling shares `/v2/accounts` URLs with the
  previous phase's reads and clobbers them (latest-wins) otherwise. Corollary:
  ONE broadcast per phase — `POST /v2/transactions` has a binary body and keys
  by path alone, so two broadcasts in one phase replay the same (last) txid.
- **Dedicated accounts per suite**: any test asserting "never enrolled / clean
  nonce" must own its account (fund in-test from the bond admin via `fundStx`);
  the shared prefunded pool gets state from sibling suites on a shared chain.
