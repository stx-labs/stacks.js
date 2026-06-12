# Privatenet E2E path matrix

Goal: map **every** participation / collateral / exit / reward path through the pox-5 bond
contract as a composable action **and** an end-to-end suite case, run live against
`api.private-1.hiro.so` (+ mempool `https://mempool.bitcoin.private-1.hiro.so/api`), all in
`RECORD=1` so fixtures are captured for offline replay.

Run prefix (live):
`NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so POLL_INTERVAL=10000 RETRY_INTERVAL=10000 BITCOIN_TX_TIMEOUT=300000 STACKS_TX_TIMEOUT=300000 RECORD=1 <ENV> npx jest <file> --runInBand --collectCoverage=false`

## Dimensions
- **Participants:** single staker | multiple stakers pooled into one bond
- **Collateral leg:** BTC L1 (P2WSH timelock) | sBTC | STX-only (signer leg, non-bond)
- **Exit:** hold-to-term → BTC timelock reclaim | early exit (STX `unstake`; BTC `announce-l1-early-exit`+early reclaim; sBTC `unstake-sbtc`)
- **Rewards:** calculate-rewards (single / multi-bond waterfall) | claim-rewards (bond leg / STX-only leg / both)

## Composable actions (building blocks) — status
| Action | File | Status |
|--------|------|--------|
| setup-bond | actions/setup-bond.test.ts | ✅ live (daemon + test) |
| register sBTC | actions/register-for-bond.test.ts | ✅ serialize+abort (no sBTC minted) |
| register BTC L1 | actions/register-for-bond-l1.test.ts | 🔄 running |
| btc-lock (fund P2WSH) | actions/btc-lock.test.ts | 🔄 running |
| btc-reclaim timelock | actions/btc-reclaim.test.ts (MODE=timelock) | ⏳ needs unlock height |
| btc-reclaim early | actions/btc-reclaim.test.ts (MODE=early) | ⏳ after announce |
| announce-l1-early-exit | actions/announce-early-exit.test.ts | ✅ guard verified; happy path pending L1 enroll |
| stx-stake | actions/stx-stake.test.ts | ✅ live |
| stx-extend | actions/stx-extend.test.ts | ✅ live |
| stx-unstake (early exit) | actions/stx-unstake.test.ts | ✅ live |
| calculate/claim rewards | actions/rewards*.test.ts | ✅ abort-codes; real claim pending cycle |

## End-to-end suite cases (cross-product) — to author as e2e/*.test.ts
| # | Case | Live-runnable? | Status |
|---|------|----------------|--------|
| E1 | Single user, BTC L1, hold-to-term → timelock reclaim | yes (wait unlock) | ⏳ |
| E2 | Single user, BTC L1, early exit → announce + early reclaim | yes | ⏳ |
| E3 | Multiple users, BTC L1, pooled one bond → verify aggregate sats | yes (account5+account6 bond 7) | ⏳ |
| E4 | Single user, sBTC, register → unstake-sbtc | BLOCKED (no sBTC minted) | serialize+abort only |
| E5 | Multiple users, sBTC pooled | BLOCKED (no sBTC) | serialize+abort only |
| E6 | STX-only single: stake → extend → unstake | yes | ✅ done |
| E7 | STX-only multi (pooling) → aggregate shares | yes | ✅ done (103k STX cycle 23) |
| E8 | Rewards: register → cycle passes → calculate → claim (bond+STX legs) | partial (real claim needs cycle) | ⏳ |
| E9 | Mixed bond: L1 user + sBTC user in same bond | partial (sBTC blocked) | ⏳ |
| E10 | Edge/adversarial: over-cap, double-register, register-after-window, reclaim-before-unlock, early-reclaim-without-announce | yes | ✅ batches 1/3/4; 2 has 1 open item |

## Environmental blocks
- **sBTC leg:** no sBTC token minted to test accounts on this chain → register-sbtc / unstake-sbtc only reach serialize+abort. Unblock = mint sBTC to a test account.
- **Reward happy-path:** needs a full reward cycle to elapse after registration before calculate/claim pays out.

## Live findings (run log)
- BTC L1 single register (account5, bond 7): ✅ SPV proof accepted, isL1Lock=true, 100k sats.
- BTC L1 multi-user (account5+account6, bond 7): ✅ aggregate fetchTotalSbtcStakedForBond=500,200,000 sats.
- announce-l1-early-exit on bond 7: ❌ err u1 Unauthorized — bond 7 was created by an EXTERNAL party, so our BOND_ADMIN_KEY is not its early-unlock-admin. Auth guard verified. HAPPY PATH requires a bond WE set up (control early-unlock-admin). Plan: self-setup bond 8 (window opens ~burn 540's window = burn 500), allowlist our accts, register L1, announce+reclaim.
