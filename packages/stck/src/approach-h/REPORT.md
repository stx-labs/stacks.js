# Approach H — same-name typed re-exports of `@stacks/transactions`

## Summary

`makeUnsignedContractCall` and `fetchCallReadOnlyFunction` are re-exported from `@stacks/stck` with the **same name, same call shape, same field set** as `@stacks/transactions`. When `contractAddress` is a `BrandedAddress<T>`, the typing of `contractName`, `functionName`, and `functionArgs` narrows to match the contract interface carried by the brand. The read-only function's return type narrows to the precise `ClarityValue` subclass declared for that function. When `contractAddress` is a plain `string`, the original behaviour is preserved unchanged — useful for ad-hoc calls and incremental migration.

**No new helper functions.** No `typedCall(...)` splat. No `principal(...)` constructor at the call site (just the per-contract address constructor from codegen). No coercion — pre-built `ClarityValue[]` inputs, matching what the existing API expects.

## Call-site example

```ts
import { makeUnsignedContractCall, fetchCallReadOnlyFunction } from "@stacks/stck";   // ← swap @stacks/transactions for @stacks/stck
import { counterAddress } from "./gen/branded-address/counter";
import { Cl } from "@stacks/transactions";

const addr = counterAddress("ST1PQHQ");
//    ^? BrandedAddress<CounterContract>

await makeUnsignedContractCall({
  contractAddress: addr,
  contractName: "counter",        // narrows to literal "counter"
  functionName: "add",            // narrows to public function names
  functionArgs: [Cl.uint(5)],     // narrows to [UIntCV]
  publicKey: PK,
});

const count = await fetchCallReadOnlyFunction({
  contractAddress: addr,
  contractName: "counter",
  functionName: "get-count",      // narrows to read-only function names
  functionArgs: [],
  senderAddress: "ST2...",
});
//    ^? UIntCV
```

## What the snapshot showed (LSP captured)

Captured in `tests/dx-snapshots/output/approach-h.md`. Per-probe results:

| Probe | Result |
|---|---|
| Hover on `addr` | **`BrandedAddress<CounterContract>`** — single line |
| Hover on `tx` | `StacksTransactionWire` |
| Hover on `count` | **`UIntCV`** — narrowed to the specific read-only function's return type |
| Completions inside `functionName: ""` | `add | decrement | increment` (public only) |
| Completions inside `contractName: ""` | `counter` (constrained by the brand) |

Eight deliberate errors, each with a tight, precise underline (≤ 12 chars):

| Mistake | Underline | Message |
|---|---|---|
| `functionName: ""` (empty) | `functionName` | `Type '""' is not assignable to type 'PublicNames<CounterContract>'` |
| `contractName: ""` (empty) | `contractName` | `Type '""' is not assignable to type '"counter"'` |
| `contractName: "vault"` | `contractName` | `Type '"vault"' is not assignable to type '"counter"'` |
| `functionName: "mint"` | `functionName` | `Type '"mint"' is not assignable to type 'PublicNames<CounterContract>'` |
| `functionArgs: ["not a uint"]` | `'not a uint'` | `Type 'string' is not assignable to type 'UIntCV'` |
| `functionArgs: []` (too few) | `functionArgs` | `Type '[]' is not assignable to type 'AddArgs'. Source has 0 element(s) but target requires 1` |
| read-only via `makeUnsignedContractCall` (`'get-count'`) | `functionName` | `Type '"get-count"' is not assignable to type 'PublicNames<CounterContract>'` |
| public via `fetchCallReadOnlyFunction` (`'add'`) | `functionName` | `Type '"add"' is not assignable to type 'ReadOnlyNames<CounterContract>'` |

**No two-overload dumps. No whole-object underlines. No spurious extra errors.**

The raw fallback path (plain `string` contractAddress) compiles unchanged with the original loose typing.

## Design that made this work

Several design choices had to combine:

1. **Required (not optional) brand** — `BrandedAddress<T> = string & { readonly [__addressBrand]: T }`. The brand property is required, so `BrandedAddress<T>` is structurally distinguishable from plain `string` (only `BrandedAddress<T>` is assignable to itself; plain string isn't).
2. **Single signature, no overloads.** Overloads of D-style produced a `No overload matches this call. Overload 1 of 2 ... Overload 2 of 2 ...` dump on every error. Single signature with conditional types reports clean per-field diagnostics.
3. **Per-field conditionals, not per-whole-object.** An earlier draft used a whole-object discriminated union `{ functionName: F; functionArgs: ArgsOf<T, F> } | { functionName: G; functionArgs: ArgsOf<T, G> } | ...` and triggered the same "whole-object underline" bug that B's `TypedOptionsB` had. Switching to per-field conditionals (`ContractNameField<TAddr>`, `ArgsField<TAddr, F>`, etc.) means each field's mismatch lands precisely on that field.
4. **Generic constraint, not just inference.** The constraint `F extends PublicFnConstraint<TAddr>` makes wrong-name errors fire on the F generic — TS surfaces them as field-level errors with the expected union spelled out.
5. **Raw fallback preserved.** When `TAddr` doesn't extend `BrandedAddress<_>`, every conditional resolves to its loose branch (`string`, `ClarityValue[]`, etc.). The user's existing plain-string call sites compile unchanged.

## Decisions taken

- **Same field shape as `@stacks/transactions`** — `contractAddress`, `contractName`, `functionName`, `functionArgs`, `publicKey`. The user types `contractName: "counter"` redundantly (the brand already knows it), but in exchange they keep the exact existing API shape and migration is a one-line import swap.
- **Same function names** (`makeUnsignedContractCall`, `fetchCallReadOnlyFunction`). User changes `from "@stacks/transactions"` to `from "@stacks/stck"`. Nothing else.
- **No coercion.** `Cl.uint(5)` not `5`. Consistent with the existing function — it already requires `ClarityValue[]`.
- **Codegen emits a per-contract address constructor** (`counterAddress("...")`) so the user has a typed-value entry point per contract. The interface (`CounterContract`) is also exported as `import type`.
- **Brand is REQUIRED** (not optional). Tradeoff: `BrandedAddress<T>` is not assignable to plain `string`. To use a branded address in raw `@stacks/transactions` code, the user casts. Worth it because required brand gives clean type-level dispatch.
- **Read-only return type narrows by inferring the function-name generic** `F`. The pattern works even though F appears in a conditional type result, because it also appears directly as `functionName: F` in the parameter object.

## Uncertainties / open questions

- **Error message mentions `PublicNames<CounterContract>`** rather than spelling out the union `"add" | "decrement" | "increment"`. The user can hover to expand, but inlined would be friendlier. Likely fixable with a different type-level encoding; not blocking.
- **Hover on `makeUnsignedContractCall` itself** shows the conditional-heavy signature. Slightly noisy in the hover popup; users rarely see it because they're usually mid-argument.
- **Codegen artifact ownership.** The fixture lives in `tests/generated/branded-address/`. Real codegen would integrate with Clarinet typegen.
- **Multi-sig / signed variants** not wrapped yet — only the unsigned single-sig path. Same pattern would extend.

## Comparison to D

|                                            | D (overload via `typedCall`)                                  | H (single-signature conditional)                              |
|--------------------------------------------|---------------------------------------------------------------|---------------------------------------------------------------|
| Need a helper at the call site?            | yes — `...typedCall(p, "add", [5])` or alias                  | no                                                            |
| Function name                              | `makeUnsignedContractCallD` (aliased to avoid collision)      | `makeUnsignedContractCall` (same as `@stacks/transactions`)   |
| Error footprint                            | every error → 2-overload dump on the function name            | every error → precise field underline                         |
| `contractName` autocomplete                | n/a (the helper hides it)                                     | narrowed to `"counter"`                                       |
| `functionName` autocomplete                | narrowed                                                      | narrowed                                                      |
| Read-only return narrowing                 | narrowed                                                      | narrowed                                                      |
| Migration cost                             | swap import + use helper                                      | swap import + rebrand address                                 |

H is what D was trying to be.

## Files touched

- `src/approach-h/brand.ts` — `BrandedAddress<T>` + type-level helpers
- `src/approach-h/typed-calls.ts` — single-signature typed wrappers
- `src/approach-h/index.ts` — re-exports
- `tests/generated/branded-address/counter.ts` — types-only fixture + `counterAddress(...)` constructor
- `tests/dx-snapshots/fixtures/approach-h.ts`
- `tests/dx-snapshots/output/approach-h.md`
- `dx-examples/approach-h.md`

## How to verify

```bash
cd packages/stck
node ../../node_modules/typescript/bin/tsc --noEmit --ignoreDeprecations 5.0 2>&1 | grep "src/approach-h"
# Expect: no output (no spurious errors in approach-h itself)

node tests/dx-snapshots/run.mjs
# Regenerates tests/dx-snapshots/output/approach-h.md
```
