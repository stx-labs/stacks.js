---
"@stacks/stacking": minor
---

`StackingClient.getAccountExtendedBalances()` now uses the `/extended/v3/principals/{principal}/balances/stx` endpoint instead of the deprecated `/extended/v1/address/{address}/balances`. The returned `ExtendedAccountBalances` (and `ExtendedAccountBalancesResponse`) type changes to the flat STX-only v3 shape `{ balance, available, locked, mempool }`; `stx.total_sent`, `stx.total_received`, `fungible_tokens` and `non_fungible_tokens` are no longer returned.
