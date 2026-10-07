---
"@stacks/cli": minor
---

Use the `/extended/v3/principals/{principal}/balances/stx` endpoint for the stacking balance check instead of the deprecated `/extended/v1/address/{address}/balances`. The `stack` command now compares the stacking amount against the spendable (unlocked) balance rather than the total balance.
