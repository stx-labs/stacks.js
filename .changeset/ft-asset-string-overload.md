---
"@stacks/transactions": minor
---

Allow `Pc.principal(…).willSendEq(…).ft()` to take a single fully-qualified asset name (`<contract-address>.<contract-name>::<token-name>`) as an alternative to the contract id and token name pair. Malformed ft asset names now throw instead of serializing a truncated asset.
