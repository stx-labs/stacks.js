---
"@stacks/stacking": major
"@stacks/api": major
"@stacks/cli": major
---

Replace the deprecated `/extended/v1/address/{address}/balances` endpoint with `/extended/v3/principals/{principal}/balances/stx`. The `ExtendedAccountBalances` and `ExtendedAccountBalancesResponse` types (returned by `StackingClient.getAccountExtendedBalances` and `StacksNodeApi.getExtendedAccountBalances`) now follow the v3 response shape: a flat STX balance object with `balance`, `available`, and nullable `locked` and `mempool` fields, instead of the previous `{ stx, fungible_tokens, non_fungible_tokens }` shape.
