# Error Handling Inconsistencies

## 1. Custom Error Class Adoption

Only 2 packages define comprehensive custom error hierarchies:
- **common**: `BlockstackError` base class with 15+ subclasses (InvalidParameterError, RemoteServiceError, NotEnoughFundsError, etc.)
- **transactions**: `TransactionError` base class with 6 subclasses (SerializationError, DeserializationError, SigningError, etc.)

Other packages with isolated custom errors:
- **stacking**: `InvalidAddressError` only

All remaining packages (auth, storage, wallet-sdk, profile, cli, bns, network) throw only plain `Error` objects.

---

## 2. `throw Error()` vs `throw new Error()`

- **Most packages**: `throw new Error(message)`
- **transactions** (7 files): `throw Error(message)` (without `new`)
  - `utils.ts`, `fetch.ts`, `wire/create.ts`, `wire/helpers.ts`, `authorization.ts`, `signer.ts`

Functionally equivalent, but inconsistent style.

---

## 3. Throw vs Return null (Major Divergence)

**Throw pattern** (most packages): Errors are thrown immediately on failure.

**Silent return null** (wallet-sdk):
- `models/wallet-config.ts:77` — `if (!response.ok) return null;`
- `models/wallet-config.ts:86` — `catch (error) { return null; }`
- `models/profile.ts:31` — `if (res.status === 404) return null;`
- `models/legacy-wallet-config.ts:44,53` — `return null;`

wallet-sdk silently swallows errors and returns null, making failures invisible to consumers. No other package does this consistently.

---

## 4. Error Message Formatting

No consistent format across the monorepo:
- No package-name prefixes on messages
- Mix of template literals and string concatenation
- Some include operational context, others are terse (`"Invalid network."`)

---

## 5. Promise Rejection Patterns

Three different approaches:
1. **catch + throw** (transactions): `catch (e) { throw Error(...) }`
2. **catch + return null** (wallet-sdk): `catch (error) { console.error(error); return null; }`
3. **Let reject naturally** (cli, others): No catch at all

---

## 6. Logging vs Throwing

- **wallet-sdk**: Logs to `console.error()` AND returns null (loses error info)
- **Most packages**: Throw without logging (caller decides)
- **cli**: Mixed logging patterns

---

## Summary

| Aspect | Packages that diverge |
|--------|----------------------|
| Custom error classes | Only common + transactions use them |
| `throw Error()` (no `new`) | transactions only |
| Return null instead of throw | wallet-sdk only |
| Console.error + return null | wallet-sdk only |
| TypeError usage | wallet-sdk, encryption only |
