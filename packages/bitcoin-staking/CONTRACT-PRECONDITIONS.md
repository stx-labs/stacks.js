# PoX-5 preconditions per `build*` helper

On-chain revert conditions for each contract function our `build*` helpers wrap,
sourced from `pox-5.clar`. Use this to decide/scope read-only eligibility
(`fetchEligibleX`) preflights like the existing {@link fetchEligibleRegisterForBond}.

Checkable legend: **yes** = verifiable read-only off-chain · **partial** = depends
on `burn-block-height` at execution · **no** = trait call / SPV / on-chain oracle.

## Preflight proposal (by value)

- **Tier 1 (build a preflight):** `calculate-rewards` (ordering + all-active-bonds +
  already-computed), `claim-rewards` (rewardCycle resolution + non-empty legs),
  `stake-update` (resulting num-cycles bound).
- **Tier 2:** `unstake-sbtc` (sBTC-backed + amount ≤ shares), `update-bond-registration`
  (old==current, new≠old, new registered), `setup-bond` (admin + timing window +
  no dup stakers).
- **Tier 3 (skip — simple/already-gated/not read-only):** `set-bond-admin`,
  `allow`/`disallow-contract-caller`, `announce-l1-early-exit`, `unstake`, `stake`,
  `claim-staker-rewards-for-signer`, `grant-signer-key`, `revoke-signer-grant`.
- **Hard limits (no preflight fully covers):** `register-for-bond` SPV proof, and the
  `signer-manager validate-stake!` trait gate in register / update-registration /
  stake / stake-update — always best-effort, same caveat as `fetchEligibleRegisterForBond`.

A `signer-manager-call-active` reentrancy guard (`ERR_REENTRANT_CALL u49`) gates almost
every function but is never true off-chain — omitted below.

---

## buildSetBondAdmin → `set-bond-admin`
1. Caller == current `bond-admin` — `ERR_UNAUTHORIZED u1` — **yes**.

## buildSetupBond → `setup-bond`
1. Caller == `bond-admin` — `ERR_UNAUTHORIZED u1` — **yes**.
2. Not too soon: `burn-height ≥ bond-start - BOND_GAP_CYCLES*cycle-len` — `ERR_CANNOT_SETUP_BOND_TOO_SOON u2` — **partial**.
3. Not too late: `burn-height < bond-start` — `ERR_CANNOT_SETUP_BOND_TOO_LATE u3` — **partial**.
4. Bond index not already set up — `ERR_BOND_ALREADY_SETUP u4` — **yes**.
5. No duplicate stakers in allowlist — `ERR_STAKER_ALREADY_ADDED u5` — **yes**.

## buildRegisterForBond → `register-for-bond`
The `let`-bindings evaluate top-down, so SPV (the `sats-total` binding, line 641)
runs FIRST, then the `bond`/`allowance` unwraps, then the body asserts.
1. L1 only (`verify-l1-lockups`, per output): tx parse — `ERR_READ_TX_OUT_OF_BOUNDS u39` — **no**; block header valid — `ERR_INVALID_BTC_HEADER u40` — **yes** (`fetchVerifyBlockHeader`, within lookback window); merkle proof — `ERR_INVALID_MERKLE_PROOF u41` — **no** (needs branch verifier); output script — `ERR_INVALID_LOCKUP_SCRIPT u42` — **no** (needs tx-output parse); output amount — `ERR_INVALID_LOCKUP_AMOUNT u45` — **no** (needs tx-output parse); duplicate outpoint — `ERR_DUPLICATE_LOCKUP_OUTPOINT u46` — **yes** (`computeBitcoinTxid`).
2. Bond exists in `protocol-bonds` — `ERR_BOND_NOT_FOUND u7` — **yes**.
3. Staker on the bond allowlist (`protocol-bond-allowances`) — `ERR_NOT_ALLOWLISTED u11` — **yes**.
4. Not in prepare phase — `ERR_STAKE_IN_PREPARE_PHASE u47` — **partial**.
5. `amountUstx ≥ min-ustx-for-sats(satsTotal, ...)` — `ERR_INSUFFICIENT_STX u8` — **yes**.
6. Bond not started: `burn-height < bond-start` — `ERR_BOND_ALREADY_STARTED u43` — **partial**.
7. Prior STX-only stake expired by bond's first cycle — `ERR_ALREADY_STAKED u19` — **yes**.
8. `satsTotal ≤ allowance` — `ERR_TOO_MUCH_SATS u10` — **yes**.
9. Total balance (locked+unlocked) ≥ amountUstx — `ERR_INSUFFICIENT_STX u8` — **yes**.
10. signer-manager `validate-stake!` ok — trait error — **no**.
11. Signer registered + active key grant — `ERR_SIGNER_NOT_FOUND u23` / `ERR_SIGNER_KEY_GRANT_NOT_FOUND u17` — **yes**.
12. Direct caller or allowed (non-expired) contract-caller — `ERR_UNAUTHORIZED_CALLER u22` — **partial**.
13. No overlapping bond membership — `ERR_ALREADY_REGISTERED u9` — **yes**.
14. Rollover within L1 unlock window — `ERR_ROLLOVER_TOO_EARLY u48` — **partial**.
15. sBTC transfer succeeds (sBTC rollover only) — token error — **partial**.

## buildUpdateBondRegistration → `update-bond-registration`
1. Active bond participant (`get-bond-membership` let-binding unwrap) — `ERR_NOT_BOND_PARTICIPANT u34` — **yes**.
2. Not in prepare phase — `ERR_STAKE_IN_PREPARE_PHASE u47` — **partial**.
3. `oldSignerManager` == current signer — `ERR_INVALID_OLD_SIGNER_MANAGER u36` — **yes**.
4. New signer != old — `ERR_UPDATE_BOND_SAME_SIGNER u44` — **yes**.
5. signer-manager `validate-stake!` ok — trait error — **no**.
6. New signer registered + key grant — `u23` / `u17` — **yes**.
7. Caller allowed — `ERR_UNAUTHORIZED_CALLER u22` — **partial**.

## buildAnnounceL1EarlyExit → `announce-l1-early-exit`
1. Active bond participant (`get-bond-membership` let-binding unwrap) — `ERR_NOT_BOND_PARTICIPANT u34` — **yes**.
2. Not in prepare phase — `ERR_STAKE_IN_PREPARE_PHASE u47` — **partial**.
3. `contract-caller == tx-sender == staker` (no intermediary) — `ERR_UNAUTHORIZED u1` — **yes**.
4. Membership is L1 (`is-l1-lock`) — `ERR_CANNOT_ANNOUNCE_L1_EARLY_UNLOCK u35` — **yes**.
5. `oldSignerManager` matches — `ERR_INVALID_OLD_SIGNER_MANAGER u36` — **yes**.
6. Not already announced — `ERR_L1_EARLY_EXIT_ALREADY_ANNOUNCED u50` — **yes**.

## buildUnstakeSbtc → `unstake-sbtc`
1. Active bond participant (raw map let-binding; expired memberships pass too) — `ERR_NOT_BOND_PARTICIPANT u34` — **yes**.
2. `amountToWithdrawSats ≤ current shares` (let-binding) — `ERR_INVALID_UNSTAKE_SBTC_AMOUNT u37` — **yes**.
3. Not in prepare phase — `u47` — **partial**.
4. `signerManager` matches current signer — `ERR_INVALID_OLD_SIGNER_MANAGER u36` — **yes**.
5. Membership is sBTC (`is-l1-lock == false`) — `ERR_CANNOT_UNSTAKE_SBTC u38` — **yes**.
6. Caller allowed — `u22` — **partial**.
7. sBTC transfer succeeds — token error — **yes** (balance cross-check).

## buildStake → `stake`
1. Not in prepare phase — `u47` — **partial**.
2. signer-manager `validate-stake!` ok — trait error — **no**.
3. Signer registered + key grant — `u23` / `u17` — **yes**.
4. `startBurnHt` resolves to next reward cycle — `ERR_INVALID_START_BURN_HEIGHT u24` — **partial**.
5. `numCycles` in [1, 96] — `ERR_INVALID_NUM_CYCLES u20` — **yes**.
6. Caller allowed — `u22` — **partial**.
7. No active STX-only stake — `ERR_ALREADY_STAKED u19` — **yes**.
8. No overlapping bond membership — `ERR_ALREADY_STAKED u19` — **yes**.
9. Rollover within L1 unlock window — `ERR_ROLLOVER_TOO_EARLY u48` — **partial**.
10. Total balance ≥ amountUstx — `ERR_INSUFFICIENT_STX u8` — **yes**.

## buildStakeUpdate → `stake-update`
1. Has active STX-only stake (`get-staker-info` let-binding unwrap) — `ERR_NOT_STAKING u27` — **yes**.
2. Not in prepare phase — `u47` — **partial**.
3. signer-manager `validate-stake!` ok — trait error — **no**.
4. `oldSignerManager` matches — `ERR_INVALID_OLD_SIGNER_MANAGER u36` — **yes**.
5. New signer registered + key grant — `u23` / `u17` — **yes**.
6. Resulting num-cycles (current + extend) in [1, 96] — `ERR_INVALID_NUM_CYCLES u20` — **yes**.
7. Caller allowed — `u22` — **partial**.
8. Unlocked STX ≥ amountIncrease — `ERR_INSUFFICIENT_STX u8` — **yes**.

## buildUnstake → `unstake`
1. Has active STX-only stake (`get-staker-info` let-binding unwrap) — `ERR_NOT_STAKING u27` — **yes**.
2. `oldSignerManager` matches — `ERR_INVALID_OLD_SIGNER_MANAGER u36` — **yes**.
3. Caller allowed — `u22` — **partial**.
4. Not in prepare phase — `ERR_UNSTAKE_IN_PREPARE_PHASE u28` — **partial**.

## buildAllowContractCaller / buildDisallowContractCaller → `allow/disallow-contract-caller`
1. Direct call: `tx-sender == contract-caller` — `ERR_UNAUTHORIZED_CALLER u22` — **yes**.
   (disallow: delete is a no-op if absent, never reverts.)

## buildCalculateRewards → `calculate-rewards`
1. `calculation-height > last-reward-compute-height` (not already computed) — `ERR_DISTRIBUTION_ALREADY_COMPUTED u30` — **partial**.
2. All active bonds at calc-height included in `bondIndices` — `ERR_ACTIVE_BOND_NOT_INCLUDED u33` — **yes**.
3. Then, per bond in the fold (in this order): bond exists — `ERR_BOND_NOT_FOUND u7` — **yes**; ordered by `stx-value-ratio` desc (ties: bond-index asc) — `ERR_INVALID_BOND_PERIOD_ORDERING u29` — **yes**; bond active at calc-height — `ERR_BOND_NOT_ACTIVE u31` — **yes**.

## buildClaimRewards → `claim-rewards`
1. Total claimable for `contract-caller` at `rewardCycle` > 0 — `ERR_NO_CLAIMABLE_REWARDS u32` — **yes**.
2. sBTC transfer succeeds — token error — **yes**.

## buildClaimStakerRewardsForSigner → `claim-staker-rewards-for-signer`
- No hard revert beyond reentrancy guard; succeeds even when earned == 0. Called by the signer-manager contract.

## buildGrantSignerKey → `grant-signer-key`
1. `contract-caller == signerManager` (self-call) — `ERR_UNAUTHORIZED_SIGNER_REGISTRATION u26` — **yes**.
2. `(signerKey, signerManager, authId)` not already used — `ERR_SIGNER_KEY_GRANT_USED u12` — **yes**.
3. Signature recovers — `ERR_INVALID_SIGNATURE_RECOVER u13` — **yes**.
4. Recovered pubkey == `signerKey` — `ERR_INVALID_SIGNATURE_PUBKEY u14` — **yes**.
   (A second `map-insert` re-checks the used-grant triple — `ERR_SIGNER_KEY_GRANT_USED u12` — but it's dead in practice: gate 2 already caught the duplicate.)

## buildRevokeSignerGrant → `revoke-signer-grant`
1. `contract-caller` == principal derived from `hash160(signerKey)` — `ERR_UNAUTHORIZED u1` — **yes**.
   (delete is a no-op if grant absent, never reverts.)
