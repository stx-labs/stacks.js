# Approach D — Branded `Principal<T>`, non-breaking with `@stacks/transactions`

## Direct answer: can we get real type safety without breaking changes?

**Partially, and only with caveats.** A branded `Principal<B>` value, by itself, dropped into the *unmodified* `makeUnsignedContractCall({ contractAddress, contractName, functionName, functionArgs, ... })` cannot give you function-name / arg / return-type safety. The reason: `contractAddress`, `functionName`, and `functionArgs` are independent fields on the options object. A brand on one field can't make the other fields co-vary, so even if `contractAddress` is `Principal<Counter>`, nothing constrains `functionName` to be `"add" | "increment" | ...` and nothing constrains `functionArgs` to `[UIntCV]`. **The user must change *something* at the call site, even if minimally.**

## What was built

Two paths on top of one primitive, all under `src/approach-d/`:

1. **`principal(bundle, "ST1...counter")`** — returns a `Principal<B>` (a `${string}.${string}` subtype with a phantom-symbol-keyed optional brand carrying the bundle type). At runtime it's a primitive string; flows unchanged into any `string`-typed field. A module-local `Map<string, ContractBundle>` records the runtime bundle so helpers can look it up.
2. **`typedCall(p, "add", [5])`** — returns `{ contractAddress, contractName, functionName, functionArgs }` narrowly typed against the bundle. Spread into the real `@stacks/transactions` `makeUnsignedContractCall`. Idea **(c)** from the prompt.
3. **`makeUnsignedContractCallD` / `fetchCallReadOnlyFunctionD`** as same-named re-exports of `@stacks/transactions` functions but with an overload that accepts `{ principal, functionName, functionArgs, ... }`. Original raw shape preserved verbatim via a second overload. Idea **(d)**.

Idea **(a)** (declaration-merging into `@stacks/transactions`) is not feasible: TypeScript allows adding members to a module but not re-shaping an existing exported `function`. Idea **(b)** (`satisfies TypedCallOptions<...>`) is strictly worse than today — the user still types out address/name/fn separately and `satisfies` doesn't transform anything.

## Call-site examples

```ts
import { principal, typedCall } from "@stacks/stck";
import { makeUnsignedContractCall, fetchCallReadOnlyFunction } from "@stacks/transactions";
import { counterContract } from "./generated/typed/counter";

const counter = principal(counterContract, "ST1PQHQ....counter");
//    ^? Principal<typeof counterContract>

// Path 1 — splat into the real @stacks/transactions function
await makeUnsignedContractCall({
  ...typedCall(counter, "add", [5]),  // function name + args narrowly typed
  publicKey: "...",
});

// Path 2 — same-name wrapper (one-line import change)
import { makeUnsignedContractCallD, fetchCallReadOnlyFunctionD } from "@stacks/stck";
await makeUnsignedContractCallD({
  principal: counter, functionName: "add", functionArgs: [5], publicKey: "...",
});

// Read-only — return type narrows to UIntCV
const count = await fetchCallReadOnlyFunctionD({
  principal: counter, functionName: "getCount", functionArgs: [], publicKey: "...",
});
```

## Is non-breaking workable? (honest)

- **Call-site cleanliness:** worse than Approach A's `makeUnsignedContractCallA(bundle, opts)` and worse than `contractA(...).makeUnsignedContractCall("add", [5])`. The splat `{ ...typedCall(p, "add", [5]), publicKey }` is fundamentally noisier than a single function with a typed options bag.
- **What works through the existing signature:** only the address-level brand. The principal flows in as `contractAddress` (after split) without a cast. Function name + args type safety requires the helper.
- **Ergonomic sacrifices:** users *cannot* keep their existing literal `contractAddress: "ST1..."`, `contractName: "counter"`, `functionName: "add"`, `functionArgs: [Cl.uint(5)]` call sites and gain function-level type safety just by changing one value to a branded principal. They have to use `typedCall` or the same-name wrapper.
- **Recommendation:** I would **not** recommend Approach D as the *primary* typed-call API. Approach A or B win on call-site cleanliness for the same migration cost. However, `Principal<B>` is a genuinely useful **primitive** that A/B/F should accept *in addition to* a plain `${string}.${string}` for their `contract` field — `Map<Principal<Counter>, ...>` is type-safe storage for deployed-contract identities, which neither A nor B can express today.

## Decisions taken

- Phantom symbol brand with **optional** key, so `Principal<B>` ⊂ `string` (zero-cost assignability into raw API).
- Module-local `Map` registry instead of `WeakMap` (primitive strings can't be `WeakMap` keys) and not an object-wrapped `String` (would break `typeof === "string"` consumers).
- `typedCall` (public-only) and `typedReadOnlyCall` (read-only-only) — same kind of access-level enforcement as Approach A.
- Same-name wrapper uses two overloads — typed `{principal, ...}` first, raw second — and delegates to the real `@stacks/transactions` function for both branches.
- Reused `findClarityFunctionName` and `coerceArgs`; same kebab/camel handling as Approach A.
- No edits to `packages/transactions/`. Re-exports in `src/index.ts` are aliased (`makeUnsignedContractCallD`, `fetchCallReadOnlyFunctionD`) to coexist with existing exports.

## Uncertainties

- The registry is process-global; collisions on identical addresses with different bundles are last-wins. Fine for a POC.
- `Principal<X>` is structurally assignable to `Principal<Y>` because the brand is optional — required for assignability to plain `string`. Tradeoff: can't have a function require `Principal<Counter>` specifically without nominally rejecting other brands.
- `principal()` doesn't validate the address format.

## DX evaluation (vs A and B)

- The branded value itself is **the best part** of D — it's a primitive A/B/F should adopt.
- Call sites that need types are **noisier** than A/B (splat vs. single function call).
- The same-name wrapper makes "import path change = type safety" possible, but the call shape still differs from raw `@stacks/transactions` (`principal` vs `contractAddress`+`contractName`).
- Error messages are similar quality to A — failed constraint on `PublicFunctionNames<B>` is concise.
- Net: D shouldn't replace A or B; it should augment them.

## Files touched

- `src/approach-d/principal.ts` (new)
- `src/approach-d/typed-call.ts` (new)
- `src/approach-d/index.ts` (new)
- `tests/approach-d.test.ts` (new)
- `tests/approach-d.read-only.test.ts` (new)
- `src/index.ts` (added approach-d re-exports under `*D` aliases)
- `tests/playground/index.ts` (appended approach-d demo)

## How to verify

```bash
cd packages/stck
../../node_modules/.bin/tsc --noEmit --ignoreDeprecations 5.0
../../node_modules/.bin/jest approach-d --no-coverage
```

`tsc` reports zero errors in approach-d files. `jest approach-d` currently fails along with every other suite in the package due to the same pre-existing `Cannot find name 'global'` issue in `@stacks/common`.
