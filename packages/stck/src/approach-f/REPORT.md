# Approach F — `createClient<Contracts>()` (openapi-fetch style)

## Summary

A `createClient<Contracts>()` factory whose single generic carries every signature. The runtime is a thin wrapper around `@stacks/transactions`. The generated artifact at `tests/generated/types-only/` is **pure types** — no runtime values, imported with `import type`. This mirrors `openapi-typescript` + `openapi-fetch`: codegen produces types, the runtime is a tiny ambient wrapper (<100 lines).

## Call-site examples

```ts
import { createClient } from "@stacks/stck";
import { Cl } from "@stacks/transactions";
import type { Contracts } from "./gen/types-only";  // PURE TYPE IMPORT

const stx = createClient<Contracts>({ publicKey, network: "testnet" });

// Top-level — contract is a typed literal
await stx.makeUnsignedContractCall({
  contract: "ST1....counter",
  functionName: "add",
  functionArgs: [Cl.uint(5)],
});

// Read-only — return narrows
const count = await stx.fetchCallReadOnlyFunction({
  contract: "ST1....counter",
  functionName: "get-count",
  functionArgs: [],
});  // ^? UIntCV

// Curried handle (requires explicit <K> annotation to disambiguate)
const counter = stx.contract<"counter">("ST1....counter");
await counter.makeUnsignedContractCall("add", [Cl.uint(5)]);
```

## Runtime coercion choice — (a) require pre-built `ClarityValue[]`

Picked **(a)** Require pre-built `ClarityValue[]` inputs. Options (b) lazy-fetch ABI and (c) separate ABI map both contradict the "types only" headline. `openapi-fetch` makes the same tradeoff. Full type safety remains (arity, slot CV type, return type, access filtering); only `5` → `Cl.uint(5)` is lost.

## Codegen shape

- `tests/generated/types-only/counter.ts` — per-contract file: arg/return aliases + `CounterFunctions` map keyed by kebab-case names with `access` literal, plus a `CounterContract` type.
- `tests/generated/types-only/index.ts` — barrel composing `interface Contracts { counter: CounterContract; }`.

Rationale: one file per contract + barrel mirrors openapi-typescript / oazapfts. Kebab-case keys avoid a second naming convention. `access` per function enables type-level filtering. Positional tuples for args match A/B. Return is a single precomputed CV type (codegen's job is to expand types once).

## Decisions taken

- Single top-level generic on `createClient<Contracts>()` — openapi-fetch shape.
- Two call styles, one runtime (top-level options object + `.contract<K>()` curry).
- `access` literal on each function — no `.read`/`.write` namespace split, but type-level filtering preserved.
- `ContractsShape = object` constraint (looser than `Record<string, ...>`) so a user-defined `interface` is assignable; defensive indexed-type lookups.
- `DeployedContract<C, K>` = `` `${string}.${K}` `` — address freeform, key tail narrowed.
- **Pre-built `ClarityValue[]` inputs only** — non-negotiable consequence of types-only codegen.

## Uncertainties

- Real codegen would likely use module augmentation (`declare module "@stacks/stck" { interface Contracts {...} }`); fixture composes the barrel explicitly for clarity.
- One key per contract name — multiple deployments of the same contract share types.
- `stx.contract<"counter">("...")` requires explicit `<K>` annotation; a `stx.byKey("counter")` alternative might be friendlier. Visible wart.
- Args type strips `readonly` but doesn't accept primitives — by design.

## DX evaluation (vs A/B)

- **Win:** one `createClient<Contracts>(...)` carries everything; imports collapse to `import type` only; tiny runtime; small generated artifacts (no `as const` ABI, no brand symbol); cleaner PR diffs.
- **Loss:** no JS-primitive coercion. For seasoned API-client users this is fine and matches `openapi-fetch`'s model. For ad-hoc script writers, A's `[5]` is friendlier. **Not a deal-breaker** if the audience is library/app authors with many call sites; noticeable for one-shot scripts.
- **Error messages:** comparable to A (named aliases like `AddArgs` resolve in hover); better than B's `as const` dumps.
- **Curry wart:** `stx.contract<"counter">(addr)` needs the explicit `<K>` — TS can't infer it from a freeform address.

Verdict: F suits high-call-site, CI-driven codegen. A wins for ad-hoc scripts. They can coexist.

## Files touched

- `src/approach-f/types.ts` (new — type-level machinery)
- `src/approach-f/create-client.ts` (new — `createClient<C>()` factory + `contract<K>()` curry)
- `src/approach-f/index.ts` (new)
- `tests/generated/types-only/counter.ts` (new — types-only fixture)
- `tests/generated/types-only/index.ts` (new — barrel exposing `interface Contracts`)
- `tests/approach-f.test.ts` (new)
- `tests/approach-f.read-only.test.ts` (new)
- `src/index.ts` (modified — re-exports)
- `tests/playground/index.ts` (appended approach-f block)

## How to verify

```bash
cd packages/stck
# Type-check (Approach F clean; pre-existing errors elsewhere)
npx tsc --noEmit --ignoreDeprecations 5.0 2>&1 | grep "approach-f\|types-only"
# Expect: no output.

npx jest approach-f
# Currently fails due to the same pre-existing repo-wide ts-jest issue
# (Cannot find name 'global' in packages/common/src/utils.ts:201).
# Not specific to approach F.
```
