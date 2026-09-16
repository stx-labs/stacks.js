# Async Patterns & API Design Inconsistencies

## 1. async/await vs Promise Chains

Most code uses `async/await`, but several files use `.then()` chains instead:
- `packages/api/src/api.ts` — heavy Promise chaining (e.g., `getInfo()` returns `.then(res => res.json())`)
- `packages/stacking/src/index.ts` — mixed patterns throughout (353, 358, 365-386, etc.)
- `packages/bns/src/index.ts` — `.then()` chains (137, 182, 237)
- `packages/profile/src/profileSchemas/personZoneFiles.ts` — Promise chains (50-59)
- `packages/cli/src/network.ts` — `.then()` chains (129, 136, 150)

**Example**: In `StacksNodeApi`, `getInfo()` uses `.then()` while `broadcastTransaction()` uses `async/await` — different patterns in the same class.

---

## 2. Fetch Implementation (Dual Approach)

**Centralized**: `packages/common/src/fetch.ts` provides `createFetchFn()` with middleware support
**Direct**: `packages/cli/src/cli.ts` imports `node-fetch` directly, bypassing the middleware system

---

## 3. Callback API Still Exists

`packages/profile/src/profileSchemas/personZoneFiles.ts`:
```typescript
export function resolveZoneFileToPerson(
  zoneFile: any,
  publicKeyOrAddress: string,
  callback: (profile: any) => void,  // callback-based API
  fetchFn: FetchFn = createFetchFn()
)
```
Uses Promises internally but exposes a callback interface. This is the only callback-based public API in the entire monorepo.

---

## 4. Return Type Wrapping

No consistent convention:
- **Raw returns**: `fetchNonce()` returns `Promise<bigint>`, `fetchAbi()` returns `Promise<ClarityAbi>`
- **Wrapped returns**: `broadcastTransaction()` returns `Promise<TxBroadcastResult>` (union type with error/success)
- **Tuple returns**: `fetchFeeEstimateTransaction()` returns `Promise<[FeeEstimation, FeeEstimation, FeeEstimation]>`

---

## 5. Parameter Style

Three different patterns:
1. **Options objects** (most common): `fetchNonce(opts: { address: string } & NetworkClientParam)`
2. **Class constructors**: `constructor({ baseUrl, fetch, network }: { ... } & NetworkParam = {})`
3. **Mixed positional + optional**: `resolveZoneFileToPerson(zoneFile, publicKeyOrAddress, callback, fetchFn)`

---

## 6. Silent Error Suppression in Fetch

Some fetch operations silently swallow errors:
- `transactions/src/fetch.ts` uses `.catch(() => '')` inline to suppress errors
- Contrasts with other locations that let errors propagate

---

## 7. Network Handling

Mostly consistent via `NetworkParam` interface with `'mainnet'` default, but:
- `cli/src/data.ts:86` — Hardcoded mainnet assumption: `"Gaia speaks mainnet only!"`
- `stacking/src/constants.ts` — Bitcoin network version handling diverges from Stacks network patterns
- `api/src/api.ts` — Stores network as `TransactionVersion` internally, checks via `isMainnet()`
