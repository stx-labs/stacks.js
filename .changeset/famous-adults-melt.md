---
"@stacks/bitcoin-staking": minor
---

Add @stacks/bitcoin-staking, a package for PoX-5 staking. Covers the full bond lifecycle against the pox-5 boot contract: BTC P2WSH lockup script construction, SPV proof assembly, reclaim transactions for both the timelock and cosigned early-exit paths, SIP-018 signer grants, read-only wrappers for bond and staker state, cycle math helpers, and read-only eligibility preflight checks.
