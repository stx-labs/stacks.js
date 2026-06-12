# pox-5 contract coverage matrix (regtest suite)

Goal: every `define-public`, every `define-read-only`, and every error code
that is reachable from this test environment is exercised by at least one
recorded regtest test. Generated from `stacks-core …/boot/pox-5.clar` @
`29ecd3621f`. Update when tests or the contract change.

Legend: ✅ covered (test listed) · 🔜 planned · 🚫 not reachable from tests
(reason given) · ❔ needs investigation.

## Public functions (18)

| Function | Status | Where |
|---|---|---|
| `stake` | ✅ | actions/stx-staking (+ keep-alive daemon) |
| `stake-update` | ✅ | actions/stx-staking (updated phase; + daemon extends) |
| `unstake` | ✅ | actions/stx-staking (unstaked phase) |
| `setup-bond` | ✅ | actions/setup-bond, e2e/bond-lifecycle, adversarial (u4/u2) |
| `set-bond-admin` | ✅ | actions/set-bond-admin, set-bond-admin-multisig, adversarial (u1) |
| `register-for-bond` | ✅ | actions/register-for-bond{,-l1,-sbtc,-combined}, e2e, adversarial |
| `update-bond-registration` | ✅ | actions/update-bond-registration, adversarial (u44) |
| `unstake-sbtc` | ✅ | actions/unstake-sbtc, adversarial (u34) |
| `calculate-rewards` | ✅ | e2e/bond-lifecycle |
| `claim-rewards` | ✅ | e2e/bond-lifecycle |
| `claim-staker-rewards-for-signer` | 🔜 | SDK builder exists (`buildClaimStakerRewardsForSigner`), no test yet |
| `announce-l1-early-exit` | 🔜 | builder exists; needs an L1 bond membership first (extend register-for-bond-l1) |
| `register-signer` | ✅ | indirectly via signer-manager contract (daemon + deploy-signer-manager) |
| `grant-signer-key` | ✅ | adversarial/signer-grant (direct call pins u26; success path needs a signer-manager proxy — deferred) |
| `revoke-signer-grant` | ✅ | adversarial/signer-grant (idempotent-success pinned) |
| `allow-contract-caller` | ✅ | actions/contract-caller |
| `disallow-contract-caller` | ✅ | actions/contract-caller |
| `set-burnchain-parameters` | 🚫 | boot/system-privileged; node calls it at epoch transition |

## Read-only functions (74)

Most read-onlys are wrapped 1:1 by `src/fetch.ts` (`fetch*`). Coverage plan: the
flows above already hit the bond/staking reads; a dedicated **reads sweep**
action (🔜 `actions/reads-sweep.test.ts`) calls every remaining `fetch*` wrapper
once against live chain state so each wrapper records a fixture.

Already exercised by flows: `get-pox-info`, `get-bond-membership`,
`get-protocol-bond`, `get-bond-allowance`, `get-signer-info`,
`get-staker-info`, `get-staker-shares-staked-for-cycle`,
`get-total-sbtc-staked`, `get-total-sbtc-staked-for-bond`,
`get-earned-staker-rewards`, `min-ustx-for-sats-amount`,
`bond-period-to-burn-height`, `bond-period-to-reward-cycle`,
`construct-lockup-script`, `construct-lockup-output-script`,
`verify-block-header` (L1 path), `get-reversed-txid` (L1 path).

✅ Covered by `actions/reads-sweep` (every SDK `fetch*` wrapper, incl. none/false paths): `get-total-shares-staked-for-cycle`,
`get-total-ustx-stacked`, `get-ustx-delegated-for-cycle`, `get-earned`,
`get-rewards-per-token-for-cycle`, `get-signer-*` family (shares, unclaimed,
rewards-per-token, set-items, cycle-membership), `get-staker-custodied-sbtc`,
`get-staker-unclaimed-rewards-for-cycle`, `get-staker-rewards-per-token-settled-for-cycle`,
`get-bond-l1-unlock-height`, `has-announced-l1-early-exit`,
`is-bond-active-at-height`, `is-in-prepare-phase`, `current-pox-reward-cycle`,
`reward-cycle-to-burn-height`, `burn-height-to-reward-cycle`,
`get-first-pox-5-reward-cycle`, `get-reserve-balance`, `get-bc-h-hash`,
`parse-block-header`, `push-script-bytes`, `push-c-script-num`,
`serialize-c-script-num`, `uint-to-buff-le`, `reverse-buff32`,
`verify-signer-key-grant`, `get-signer-grant-message-hash`,
`check-pox-lock-period`, `check-caller-allowed`, `signer-set-contains-for-cycle`.

No SDK wrapper (internal helpers — covered transitively through the public fns
that call them, not individually): `assert-all-active-bonds-included`,
`bond-overlaps-new-position`, `burn-height-to-distribution-index`, `clamp`,
`compute-earned-rewards`, `current-distribution-cycle`,
`distribution-cycle-to-burn-height`, `get-amount-delegated-for-signer`,
`get-last-accounted-rewards-only`, `get-last-reward-compute-height`,
`get-new-rewards`, `get-rewards`, `get-signer-pending-staked-ustx-per-cycle`,
`read-hashslice`, `read-uint32`. (If a wrapper is added to the SDK later, move
the item up.)

## Error codes (45)

| Code | Name | Status | Where / why |
|---|---|---|---|
| u1 | UNAUTHORIZED | ✅ | adversarial (set-bond-admin from stranger) |
| u2 | CANNOT_SETUP_BOND_TOO_SOON | ✅ | adversarial |
| u3 | CANNOT_SETUP_BOND_TOO_LATE | 🔜 | setup-bond for an in-window-but-passed period |
| u4 | BOND_ALREADY_SETUP | ✅ | adversarial |
| u5 | STAKER_ALREADY_ADDED | 🔜 | duplicate staker in one setup-bond allowlist |
| u7 | BOND_NOT_FOUND | ✅ | actions/register-for-bond (abort path) |
| u8 | INSUFFICIENT_STX | ✅ | adversarial |
| u9 | ALREADY_REGISTERED | ✅ | adversarial |
| u10 | TOO_MUCH_SATS | ✅ | adversarial |
| u11 | NOT_ALLOWLISTED | ✅ | adversarial |
| u12 | SIGNER_KEY_GRANT_USED | 🚫* | behind `contract-caller == signer-manager`; needs a proxy contract — deferred with u13/u14/u22 |
| u13 | INVALID_SIGNATURE_RECOVER | 🚫* | see u12 |
| u14 | INVALID_SIGNATURE_PUBKEY | 🚫* | see u12 |
| u17 | SIGNER_KEY_GRANT_NOT_FOUND | ✅ | reads-sweep (verify-signer-key-grant err path → `false`); NOTE: revoke of a missing grant SUCCEEDS (idempotent), pinned in adversarial/signer-grant |
| u19 | ALREADY_STAKED | 🔜 | stake twice (stx path) |
| u20 | INVALID_NUM_CYCLES | 🔜 | stake with 0 / oversized cycles |
| u22 | UNAUTHORIZED_CALLER | 🚫* | needs a proxy contract calling pox-5 — deferred with u12 |
| u23 | SIGNER_NOT_FOUND | 🔜 | stake referencing an unregistered signer-manager |
| u24 | INVALID_START_BURN_HEIGHT | 🔜 | stake with stale startBurnHt |
| u26 | UNAUTHORIZED_SIGNER_REGISTRATION | ✅ | adversarial/signer-grant (direct grant-signer-key) |
| u27 | NOT_STAKING | 🔜 | unstake with no stake |
| u28 | UNSTAKE_IN_PREPARE_PHASE | 🔜 | unstake during prepare (raw broadcast) |
| u29 | INVALID_BOND_PERIOD_ORDERING | 🔜 | calculate-rewards unsorted set |
| u30 | DISTRIBUTION_ALREADY_COMPUTED | ❔ | second calculate-rewards same height window |
| u31 | BOND_NOT_ACTIVE | 🔜 | claim against a not-started bond |
| u32 | NO_CLAIMABLE_REWARDS | ❔ | claim with zero accrual — verify reachable vs ok-no-op |
| u33 | ACTIVE_BOND_NOT_INCLUDED | 🔜 | calculate-rewards with missing active bond |
| u34 | NOT_BOND_PARTICIPANT | ✅ | adversarial |
| u35 | CANNOT_ANNOUNCE_L1_EARLY_UNLOCK | 🔜 | announce from sBTC (non-L1) membership |
| u36 | INVALID_OLD_SIGNER_MANAGER | 🔜 | update-bond-registration wrong old signer |
| u37 | INVALID_UNSTAKE_SBTC_AMOUNT | 🔜 | unstake-sbtc amount 0 / > custodied |
| u38 | CANNOT_UNSTAKE_SBTC | ❔ | guard conditions need reading |
| u39 | READ_TX_OUT_OF_BOUNDS | 🚫* | needs corrupt SPV tx bytes; *possible with hand-built proof |
| u40 | INVALID_BTC_HEADER | 🔜 | L1 register with tampered header |
| u41 | INVALID_MERKLE_PROOF | 🔜 | L1 register with wrong leaf hashes |
| u42 | INVALID_LOCKUP_SCRIPT | 🔜 | L1 register with mismatched output script |
| u43 | BOND_ALREADY_STARTED | 🔜 | register after D0 |
| u44 | UPDATE_BOND_SAME_SIGNER | ✅ | adversarial |
| u45 | INVALID_LOCKUP_AMOUNT | 🔜 | L1 register with 0-amount output |
| u46 | DUPLICATE_LOCKUP_OUTPOINT | 🔜 | L1 register same output twice |
| u47 | STAKE_IN_PREPARE_PHASE | ✅ | adversarial (raw broadcast in prepare) |
| u48 | ROLLOVER_TOO_EARLY | 🔜 | register for next bond while current far from end |
| u49 | REENTRANT_CALL | 🚫 | requires a malicious signer-manager re-entering pox-5; doable with a custom contract — deferred |
| u50 | L1_EARLY_EXIT_ALREADY_ANNOUNCED | 🔜 | announce twice (after u35 path works) |
| u51 | INSUFFICIENT_RESERVE_BALANCE | 🚫 | reserve funding path not active on regtest |

## Conventions

- Recording sessions start from a FRESH chain (`networkReset`) — adversarial &
  e2e suites enroll their dedicated accounts, so re-recording on a used chain
  trips their own prior state.
- Every new abort test pins the exact `Pox5ErrorCode` (no "any abort" asserts).
- Status checkboxes here are updated in the same PR as the test.
