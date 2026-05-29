# Bitcoin Staking — Status

**Date:** 2026-05-06
**Branch:** `feat/bitcoin-staking`
**Authoritative refs:** `staking-design/latest/Waterfall White Paper.md`,
`staking-design/latest/2026-04-20 Bitcoin Staking Pox-5 Launch Scope (Waterfall Model).md`,
`staking-design/pox-5.clar` (2026-05-04 refresh).

This consolidates `notes/01-branch-inventory.md`, `notes/02-latest-design-deltas.md`,
and `notes/03-next-steps.md`. Source files retained for history.

---

## a) Branch summary

7 commits ahead of `main`, 0 behind. Single new package `@stacks/bitcoin-staking`
(~1,558 LOC across 16 files: `build.ts`, `fetch.ts`, `locking.ts`, `signer.ts`,
`btc-address.ts`, `network.ts`, `constants.ts`, `types.ts`, `index.ts` + tests).
Built against the 2026-04-15 `pox-5.clar` snapshot; the 2026-05-04 contract
refresh has invalidated most of `build.ts`. Non-builder modules (`locking.ts`,
`btc-address.ts`, `network.ts`, half of `signer.ts`) remain valid. Only
`locking.test.ts` has coverage. Run `git log main..HEAD` and
`git diff --stat main..HEAD` for current detail.

## b) Open design questions

Carried forward from Launch Scope §6/§7 and prior design-delta notes. Each
blocks at least one tier-2 deliverable.

1. **Watchdog proof format (D21).** Launch Scope §7 open. Contract has a stub
   `validate-p2wsh-exists?` placeholder. Drives the shape of any
   `buildSubmitSpentProof` builder and the proof-collection helper.
2. **Early-exit L1 script shape (D3/D4).** `setup-bond` stores
   `early-unlock-signers` as an opaque 683-byte buffer (the multisig
   descriptor). Open whether the SDK consumes it as opaque bytes baked into
   the alternate unlock branch or parses a structured shape. Co-signer set
   resolved as 1-of-N AWS multisig.
3. **Contract surface still TBD** for: early-exit request (D3), watchdog
   spent-report (D21), Andon Cord pause (D19), reserve-fund draw (white
   paper §4.6 — `transfer-from-reserve` is a TODO), reward-asset election
   (D5/D6).
4. **Reward-asset election surface.** Not in current contract; sBTC is the
   only payout path. L1 BTC opt-out routes off-chain through the sBTC
   signer set. Decide: wait for in-contract election fn, or ship a thin
   off-chain registry.
5. **Signer key rotation (D8).** `register-signer` is one-shot per
   signer-manager principal today. Rotation API not yet specified.
6. **`signer-manager-trait` consumers.** Who writes the contracts that
   implement `validate-stake!`? If Stacks Labs ships reference signer
   managers (solo, retail-pool, custodial-aggregator), the SDK should
   provide types + builders for each (D10).
7. **Hard-fork-to-D0 sequencing.** First bond D0 opens the cycle after
   fork; exact alignment open.
8. **Final pool count + allocation split** (Launch Scope §3 open). Affects
   pool directory UX and any `fetchPool*` shape.
9. **Dual-stacking product migration owner** (StackingDAO, stSTX) — TBD.
10. **Parameter calculator security review (D15)** — required before
    launch; may surface contract changes.

## c) Prioritized work

Tier framing preserved from `03-next-steps.md`. Deliverable IDs (D1–D21)
refer to the Launch Scope.

### Tier 0 — Blockers before adding feature code

1. **Rewrite `build.ts` against the 2026-05-04 `pox-5.clar`.** New surface:
   - `buildSetupBond` (admin) — D16.
   - `buildRegisterForBond` — paired enrollment (BTC or sBTC) via single
     fn, branched on `(response l1-outputs sbtc-amount)`. Replaces the
     old `buildStakePooled` and the paired branch of the old `buildStake`.
     Backs D5 / D9 / D10. Caller must already be on the bond's allowlist.
   - `buildRegisterSigner` — signer-manager self-registration; gated by a
     prior `grant-signer-key` of `signer-key`→`signer-manager`.
   - `buildStake` — STX-only path. No `poxAddress`, no per-tx signer sig,
     no `max-amount`, no `auth-id`. Auth delegated to the signer-manager
     contract via `validate-stake!`.
   - `buildStakeUpdate` — unified extend + increase + re-signer.
     Replaces `buildStakeExtend`, `buildStakeUpdate`,
     `buildStakeUpdatePooled`, `buildStakeExtendPooled`.
   - `buildUnstake` — sets STX to unlock at end of current cycle;
     disallowed during prepare phase.
   - `buildClaimRewards(bondPeriods, rewardCycle)` — signer-side claim — D6.
   - `buildCalculateRewards(bondPeriods)` — anyone can call; gates each
     distribution — D6.
   - `buildGrantSignerKey` — keyed on `(signerKey, signerManager, …)`,
     not `(signerKey, staker, …)`. Grant message is now
     `{topic: "grant-authorization", signer-manager, auth-id}` — no
     `pox-address` field. **`signer.ts` grant helpers need updating.**
   - `buildRevokeSignerGrant` — same arg-shape change.
   - `buildAllowContractCaller` / `buildDisallowContractCaller`.
2. **Drop the per-tx SIP-018 auth helpers from the public API.**
   `Pox5SignatureTopic`, `pox5SignatureMessage`, `signPox5Authorization`,
   `verifyPox5Authorization`. New contract uses the
   `signer-manager-trait`'s `validate-stake!` callback for per-tx auth.
   Keep only if a partner-SDK consumer needs off-chain attestations.
3. **Wire up new read-onlys (`fetch.ts`).** `fetchBondAllowance`,
   `fetchBondMembership`, `fetchBondPeriodToBurnHeight`,
   `fetchBondPeriodToRewardCycle`, `fetchIsBondActiveAtHeight`,
   `fetchCurrentDistributionCycle`, `fetchDistributionCycleToBurnHeight`,
   `fetchIsInPreparePhase`, `fetchClaimableRewards`, `fetchRewards` /
   `fetchNewRewards`, `fetchReserveBalance`, `fetchTotalSatsStaked` /
   `fetchTotalSatsStakedForBond`, `fetchRewardsPerTokenForCycle`,
   `fetchTotalSharesStakedForCycle`, `fetchSignerSharesStakedForCycle`,
   `fetchSignerRewardsPaidForCycle`, `fetchMinUstxForSatsAmount` (replaces
   the planned client-side `quoteStxForBtc`).
4. **Update constants.** `MAX_NUM_CYCLES = 96` (replaces `MAX_CYCLES = 24`).
   Add `BOND_LENGTH_CYCLES = 12`, `BOND_GAP_CYCLES = 2`,
   `SIGNER_SET_MIN_USTX = 50_000_000_000` (50,000 STX),
   `RESERVE_RATIO = 1500`, `PRECISION = 1e18`.
5. **Replace `POX_5_CONTRACT` placeholder** with real deployed
   mainnet/testnet contract identifiers once known.
6. **Package naming locked.** Product = "Bitcoin Staking", dual-asset
   construct = "protocol bond". `@stacks/bitcoin-staking` matches.
   Treat as resolved.

### Tier 1 — Small fixes / tightening within existing scope

7. **Bond-period constraint.** Bond period is **12 reward cycles ≈ 6 months**
   (`BOND_LENGTH_CYCLES = 12`, cycles ≈ 2,100 blocks ≈ 14d). For paired
   flows in `buildRegisterForBond`, num-cycles is hardcoded inside the
   contract — no builder-side cap needed. STX-only `buildStake` accepts
   up to `MAX_NUM_CYCLES = 96`.
8. **Back-fill tests** for the seven uncovered modules (see §d below).
9. **Round-trip parity check on `BtcAddress` vs `@stacks/stacking`**.
   Identical output for every PoX address version 0–6 so consumers can
   swap packages without reindexing historical data.
10. **Wrap `min-ustx-for-sats-amount` as a typed read helper**
    (`fetchMinUstxForSatsAmount`). Replaces the previously-planned
    client-side `quoteStxForBtc`. Args: `(sats, stx-value-ratio,
    min-ustx-ratio)`, both ratios sourced from the bond record.

### Tier 2 — New features driven by the latest design

11. **Reward claim / distribution integration (D6).**
    `buildClaimRewards(bondPeriods, rewardCycle)`,
    `buildCalculateRewards(bondPeriods)`, fetches for
    `getClaimableRewards`, `getNewRewards`, `currentDistributionCycle`.
    Distributions are **twice per cycle** (every
    `pox-reward-cycle-length / 2` blocks ≈ 1,050). Default delivery is
    sBTC; L1 BTC opt-out routes through the sBTC signer set off-chain.
12. **Reward-asset election (D5).** Not in contract today. Builder + fetch
    deferred until contract surface lands.
13. **Bond period & allocation reads (D5 / D16 / D17).** Fetches for
    current bond params (capacity, ratio, target APY, publish/open burn
    heights), partner allocation, active-bond-book summary (six
    concurrent periods), coverage ratio + response band. Backs Partner
    Dashboard (D2) and Cross-sectional Monitoring Dashboard (D17).
14. **Early-exit path (D3 / D4).**
    - New L1 locking-script variant with the pre-authorized early-exit
      branch, parameterized over the bond's `early-unlock-signers`
      buffer (683 bytes per `setup-bond`). Co-signed by 1-of-N AWS
      multisig. Sits alongside `buildDefaultUnlockScript`.
    - L2 exit-request builder — **not in contract yet**, blocking.
    - Helper to format the hashed spend request for the signer set.
    - Status read exposing "in early exit / forfeited yield / STX still
      locked" (paired STX stays locked, earns nothing). Today's
      `unstake` does not branch on bond membership — STX-only only.
    - Coordinator service (D20) is upstream — separate package or thin
      client.
15. **L1 spent watchdog (D21).** Not in contract yet. Builder for the
    "prove this UTXO was spent" L2 submission; helper to gather Bitcoin
    proof; fetch for a position's current lock status. First valid proof
    earns compensation — surface in helper return shape. Proof format
    open.
16. **Andon Cord pause (D19).** Not in contract yet. Public fetch for
    `paused?` / pending-payout-window (250-block pause window). Admin
    builder if SDK is the surface signer tools use.
17. **Reserve fund reads (D17 / white paper §4.6).** `fetchReserveBalance`
    available today (single sBTC accumulator). Two-sleeve (BTC + USD)
    tracking not in contract yet; accrual history would need additional
    surface. Accrual-only in PoX-5 — no write path.
18. **sBTC paired path is in `buildRegisterForBond`.** No separate sBTC
    pool contract — sBTC is the `(err sats-amount)` branch of
    `btc-lockup` that triggers `lock-sbtc`. Pool operator workflow (D10)
    layers on top via the signer-manager-trait pattern. Migration docs
    (D11) still owed.
19. **STX-only staking improvements (D12 / D13).** Already realized in
    the new contract: cooldown removed (signer change is one
    `buildStakeUpdate` call, reflected next cycle, blocked only during
    prepare phase), no per-cycle pool commit, indefinite staking via
    `buildStakeUpdate` re-extending. Just need builder coverage.

### Tier 3 — Product surface & partner enablement

20. **Reference SDK / integration guide for pool operators (D10 / D11).**
    L1 lock format, BTC tx verification, member enrollment, per-cycle
    distribution, reward-asset election; runnable end-to-end on testnet.
    `@stacks/bitcoin-staking` is the foundation, not the whole thing.
21. **Partner integration guide (D5 ecosystem).** Contract-call params,
    custody-infra change checklist, UI position-state requirements.
    Custodian code change is small; work is process and UI.
22. **Migration doc for PoX-4 pool operators / dual-stacking products
    (D11).** ~200–300M STX is in pools today; all positions release at
    activation and every member re-enrolls. Includes StackingDAO/stSTX
    migration once owner is assigned.

### Deferred (PoX-6 / post-V1, Launch Scope §6)

Permissionless sealed-bid clearing auction, algorithmic
capacity/yield/ratio, consensus-level reward distribution, active reserve
drawdown, direct protocol-level sBTC pairing without a pool, self-custodial
borrowing, liquid-staking token standards.

## d) Test coverage plan / remaining test work

Existing: `tests/locking.test.ts` only (script construction, BTC address
derivation across networks, unlock-height math).

Approach: record/replay fixtures against devnet; ABI-validate every builder
against the deployed `pox-5.clar`; refresh fixtures when contract is
re-deployed (current snapshot is 2026-05-04). Earlier test-plan fixtures
predating this contract refresh are stale and must be regenerated.

### Modules to cover

- **`build.test.ts`** — one ABI-shape test per builder against the new
  contract surface:
  - `buildSetupBond` (admin)
  - `buildRegisterForBond` — paired BTC (`ok` branch) and paired sBTC
    (`err` branch) cases; reject if caller not on allowlist
  - `buildRegisterSigner` — happy path; reject without prior
    `grant-signer-key`
  - `buildStake` — STX-only; assert no `pox-address`, no signer-sig,
    no `auth-id`, no `max-amount`; trait-based `validate-stake!` auth
  - `buildStakeUpdate` — extend, increase, and re-signer scenarios in
    one call
  - `buildUnstake` — happy path; reject during prepare phase
  - `buildClaimRewards` — `(bondPeriods, rewardCycle)` shape
  - `buildCalculateRewards` — anyone-can-call
  - `buildGrantSignerKey` — keyed on `(signerKey, signerManager, …)`;
    grant message topic `"grant-authorization"`, no `pox-address`
  - `buildRevokeSignerGrant` — same shape
  - `buildAllowContractCaller` / `buildDisallowContractCaller`
- **`fetch.test.ts`** — one read-only round-trip per helper:
  `fetchPoxInfo`, `fetchBondAllowance`, `fetchBondMembership`,
  `fetchStakerInfo` (STX-only path still exists), `fetchStakerInCycle`,
  `fetchBondPeriodToBurnHeight`, `fetchBondPeriodToRewardCycle`,
  `fetchIsBondActiveAtHeight`, `fetchCurrentDistributionCycle`,
  `fetchDistributionCycleToBurnHeight`, `fetchIsInPreparePhase`,
  `fetchClaimableRewards`, `fetchRewards`, `fetchNewRewards`,
  `fetchReserveBalance`, `fetchTotalSatsStaked`,
  `fetchTotalSatsStakedForBond`, `fetchRewardsPerTokenForCycle`,
  `fetchTotalSharesStakedForCycle`, `fetchSignerSharesStakedForCycle`,
  `fetchSignerRewardsPaidForCycle`, `fetchMinUstxForSatsAmount`.
- **`signer.test.ts`** — covers the updated grant-message shape only
  (`{topic: "grant-authorization", signer-manager, auth-id}`); per-tx
  auth helpers are gone unless retained for off-chain attestations.
  Round-trip sign/verify; cross-check against contract's domain.
- **`btc-address.test.ts`** — parse/stringify/toPoxTuple round-trips for
  versions 0–6, hashbytes-length validation (20 vs 32), parity vs
  `@stacks/stacking` outputs.
- **`constants.test.ts`** — assert `BOND_LENGTH_CYCLES = 12`,
  `BOND_GAP_CYCLES = 2`, `MAX_NUM_CYCLES = 96`,
  `SIGNER_SET_MIN_USTX = 50_000_000_000`, `RESERVE_RATIO = 1500`,
  `PRECISION = 1e18`; address-prefix regexes; network → version maps.
- **`network.test.ts`** — `networkNameFrom()` for mainnet/testnet/devnet.
- **`index.test.ts`** — barrel surface; `BtcAddress` namespace export
  intact.

### Cross-cutting

- Devnet record/replay fixtures regenerated against the 2026-05-04
  `pox-5.clar`; all prior fixtures are stale.
- ABI validation: every builder's Clarity arg list compared against the
  deployed contract's `define-public` signatures.
- Constants drift guard: a single test that pins each constant to the
  contract value to catch silent contract-side changes.
