# Approach C — Proxy-based direct method dispatch

## Summary

`contractC(bundle, bindings)` returns a `Proxy` whose properties **are** the Clarity functions of the contract, camelCased. `counter.add(5n)` builds an unsigned tx; `counter.getCount()` performs a network read and resolves to the decoded `ClarityValue`. There is **no `read`/`write` namespace** — read-vs-public is resolved at runtime from the bundle's ABI `access` field, and the same method name does the right thing. Argument types come from the bundle's runtime ABI literal (same machinery `ArgInputsFromBundleA` that Approach A uses); read-only return types come from the bundle's brand interface via `ExtractContractInterface<B>`.

## Call-site examples

```ts
import { contractC } from "@stacks/stck";
import { counterContract } from "./generated/typed/counter";

const counter = contractC(counterContract, {
  contract: "ST1...counter",
  publicKey: "...",
  network: "testnet",
});

await counter.add(5n);                  // public — Promise<StacksTransactionWire>
const n = await counter.getCount();     // read-only — Promise<UIntCV>
await counter.add(5n, { fee: 1000n });  // trailing opts allowed
```

## Decisions taken

- **Reused the existing bundle** rather than inventing a third codegen shape — bundle already carries both runtime ABI and the typed brand.
- **Tuple-spread variadic** `[...ArgInputsFromBundleA<B, F>, opts?: PerCallOptions]` instead of object args, so `counter.add(5n)` is the shortest possible call.
- **Arity-based opts detection** at runtime. A tuple input is a plain record, so structural detection is unsafe; arity (`n` or `n+1`) is unambiguous.
- **Lazy method memoization** so `counter.add === counter.add` holds and ABI errors surface on first call (not wrapper construction).
- **`get` returns `undefined` for unknown / symbol props** — `then`, `Symbol.iterator`, `Symbol.toStringTag` short-circuit cleanly. (Important so Promise-unwrappers don't accidentally trigger a method.)
- **`ownKeys` exposes camelCase function names** so the proxy feels like a real object to `Object.keys` / `for…in`.

## Uncertainties

- Eager vs. lazy method construction — picked lazy; eager would catch ABI-shape problems at wrapper-create time.
- `JSON.stringify(counter)` will enumerate methods and yield `{}` — tradeoff for introspection feel.
- An ABI function whose last declared arg is a record could collide with the arity-based opts rule. Not currently emitted by Clarinet but flagged.

## DX evaluation

**Good:** call site reads like a hand-written client; one method name auto-dispatches read/write; return-type narrowing works end-to-end (`UIntCV` from `getCount`, `StacksTransactionWire` from `add`).

**Awkward:** hover signature reads as `add(...args: [number|bigint|UIntCV, opts?: PerCallOptions])` — slightly noisier than two clean overloads (overloads don't generate cleanly over a mapped type, so variadic is the practical option). Proxies are also opaque to runtime introspection of unknown bundles.

## Files touched

- `src/approach-c/proxy.ts` (new)
- `src/approach-c/types.ts` (new)
- `src/approach-c/index.ts` (new)
- `tests/approach-c.test.ts` (new)
- `tests/approach-c.read-only.test.ts` (new)
- `tests/playground/index.ts` (appended approach-c block)

## How to verify

```bash
cd packages/stck
# Type-check (approach-c has zero errors):
node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json --ignoreDeprecations 5.0 2>&1 | grep "src/approach-c"
npx jest approach-c
```

**Test status:** jest currently fails for every test in the package due to a pre-existing repo-wide ts-jest config issue (`Cannot find name 'global'` in `packages/common/src/utils.ts:201`, because root `tsconfig.json` declares `"types": ["jest"]` without `"node"`). Not specific to approach C.
