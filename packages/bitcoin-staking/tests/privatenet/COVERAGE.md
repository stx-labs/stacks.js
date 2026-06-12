# pox-5 public-function coverage map

Target: ≥90% coverage; **a function is only "done" when its fixture is recorded** (live RECORD=1 run).
Ignore: `set-bond-admin` (don't rotate on shared net), `set-burnchain-parameters` (governance, risky).

| # | Public fn | Test(s) | Live-proven | Fixture recorded | Gap |
|---|-----------|---------|:-----------:|:----------------:|-----|
| 1 | setup-bond | setup-bond.test + daemon | ✅ | ⏳ fresh-chain | re-record |
| 2 | register-for-bond (L1) | register-for-bond-l1, single/multi-l1 e2e | ✅ | 🔄 multi-l1 recording | — |
| 3 | register-for-bond (sBTC) | register-for-bond, single-sbtc-abort | ✅ abort | ⏳ | happy blocked (no sBTC) |
| 4 | update-bond-registration | — | ❌ | ❌ | **MISSING** |
| 5 | register-signer | — | ❌ | ❌ | **MISSING** |
| 6 | grant-signer-key | verify-signer-grant (crypto only) | ❌ on-chain | ❌ | **MISSING live** |
| 7 | revoke-signer-grant | — | ❌ | ❌ | **MISSING** |
| 8 | stake | stx-stake, single/multi-stx e2e | ✅ | ⏳ | re-record |
| 9 | stake-update | stx-extend | ✅ | ⏳ | re-record |
| 10 | unstake | stx-unstake, exit-stx-unstake e2e | ✅ | ⏳ | re-record |
| 11 | unstake-sbtc | exit-sbtc-unstake-abort | ✅ abort | ⏳ | happy blocked (no sBTC) |
| 12 | announce-l1-early-exit | announce-early-exit, exit-l1-announce e2e | ✅ (staker-signed) | ⏳ | re-record |
| 13 | calculate-rewards | rewards.test | ✅ abort | ⏳ | **happy: multi-bond waterfall MISSING** (needs sBTC) |
| 14 | claim-rewards | rewards.test, rewards-claim-receive | ✅ abort | ⏳ | happy blocked (no sBTC) |
| 15 | claim-staker-rewards-for-signer | — | ❌ | ❌ | **MISSING** |
| 16 | allow-contract-caller | — | ❌ | ❌ | **MISSING** |
| 17 | disallow-contract-caller | — | ❌ | ❌ | **MISSING** |
| – | set-bond-admin | set-bond-admin.test | ⛔ ignore | – | intentionally skipped |
| – | set-burnchain-parameters | — | ⛔ ignore | – | governance |

## Missing tests to author (runnable now)
- A. **Signer lifecycle**: register-signer, grant-signer-key, revoke-signer-grant, claim-staker-rewards-for-signer.
- B. **Contract-caller**: allow-contract-caller → (act through caller) → disallow-contract-caller.
- C. **update-bond-registration** (modify an existing registration).
- D. **Signer-set gating (50k STX)**: fix stx-stake-signer-set to stake ≥50k from a 10B account (account1-6).
- E. **Combined/sequential E2E**: (1) stake→grant-signer→register; (2) register→announce-exit→re-register; (3) lock→register→re-lock-without-reclaim.

## Blocked (operator action: mint sBTC or deploy sbtc-deposit; controller = ST3NBRSFKX…)
- sBTC register/unstake happy-path, reward PAYOUT happy-path, multi-bond reward WATERFALL with real payout, mixed L1+sBTC bond.
  - Root: rewards pay sBTC from pool; sBTC mint gated to protocol contracts; sbtc-deposit & sbtc-bootstrap-signers NOT deployed on this chain.

## Funds (fresh chain, ~est)
account1-4: 10B STX · account5: ~10B · account6: ~10B · account7/8: 1000 STX. 50k-aggregate trivially met by any of account1-6.
