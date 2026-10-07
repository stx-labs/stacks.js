---
'@stacks/bitcoin-staking': patch
---

Normalize `IntegerType` unlock heights in `buildLockProof` and reject values above `Number.MAX_SAFE_INTEGER`; correct the `EarnedRewards` unit docs (sBTC sats, not micro-STX)
