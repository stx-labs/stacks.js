# Approach E — Branded `Principal<T>`, standalone

## Summary

The **address itself is a typed value**. `principal(counterContract, "ST1...counter")` produces a `Principal<CounterContract>` — a primitive string at runtime, branded at the type level. The bundle's runtime ABI lives in a module-local `Map<string, ContractBundle>` keyed by address, so the brand stays a `string` (assignable to any `string`-typed field) but call helpers can look up the ABI for coercion. Two call surfaces are offered: function-style helpers `call(p, fn, args, opts)` / `read(p, fn, args, opts?)` and a proxy variant `bind(p, bindings)`. Function names are camelCase; args use a **named record** (`{ n: 5n }`) matching the typegen-emitted `AddArgs = { n: UIntCV }` shape.

## Call-site examples

```ts
import { principal, call, read, bind } from "@stacks/stck";
import { counterContract } from "./generated/typed/counter";

// Construct once — the contract type rides on the value
const counter = principal(counterContract, "ST1...counter");
//    ^? Principal<CounterContract>

// Function-style — public
await call(counter, "add", { n: 5n }, { publicKey });

// Function-style — read-only
const n = await read(counter, "getCount", {});
//    ^? UIntCV

// Proxy variant — bind once, call as methods
const c = bind(counter, { publicKey });
await c.add({ n: 5n });
const v = await c.getCount();

// Pass the typed principal around — interface follows it
function fireIncrement(target: Principal<CounterContract>) {
  return call(target, "increment", {}, { publicKey });
}
fireIncrement(counter);          // OK
fireIncrement(otherPrincipal);   // type error if type parameter differs
```

## The brand source-of-truth question

- **(i) explicit generic** — `principal<CounterContract>(addr)`. Picked as the primary path because the user explicitly likes "branded principal".
- **(ii) codegen-emitted constructor** — provided as `definePrincipal(bundle)` so codegen can ship `counterPrincipal` and callers never see the bundle directly: `counterPrincipal("ST1...")`.
- **(iii) declaration-merging registry** — rejected (user wanted the brand idea, not a global registry).

The brand type carries only the interface `T`. The runtime ABI lives in a module-local `Map` indexed by address. Same-address collisions across different bundles are last-wins — fine for a POC; documented.

## Decisions taken

- Brand shape: `string & { readonly [brand]: T }` — primitive at runtime, assignable to `string`.
- Bundle lookup via `Map<address, bundle>` registered at `principal()` call time.
- Args as **named records** (matching typegen's emitted `AddArgs = { n: UIntCV }`) — different choice from A/B/C which use positional tuples. Named records mean refactoring an argument name in Clarity is a visible call-site change.
- Function names: **camelCase** for the proxy (`c.getCount()`), camelCase for `call`/`read` (`"getCount"`). Kebab is reserved for the original Clarity name in the ABI lookup.
- Two surfaces (function-style + proxy bind) shipped together — they share the same dispatch under the hood.
- Re-exports aliased in `src/index.ts` as `principalE`, `callE`, `readE`, `bindE`, `definePrincipal` to coexist with Approach D's `principal`.

## Uncertainties

- **No compile-time access check.** The interface lacks an `access` tag, so `call(c, "getCount", ...)` and `read(c, "add", ...)` only fail at **runtime**. Would be fixed if typegen emitted `access: "public" | "read_only"` per function. Worth a follow-up.
- **Missing-required-field check leaks** when the interface has ≥1 no-arg function. Runtime catches it; TS doesn't. Tried `NoInfer` and distribution; none fixed it cleanly. Documented as a limitation.

## DX evaluation (vs A/B)

- **Win — typed-state ergonomics.** `Principal<CounterContract>` is a piece of typed application state. A helper `function fireIncrement(target: Principal<CounterContract>)` rejects any other principal at the call site even though both are `string`. Neither A nor B express this — they expect the bundle to be present at every call site.
- **Win — no bundle import per call.** Once you have `counter`, you can call functions without importing `counterContract` again.
- **Loss — slightly more setup.** `principal(bundle, addr)` is one extra step versus A's "import bundle, pass to helper".
- **Loss — runtime-only access check.** A/B enforce read/public at compile time via separate functions; E only does at runtime.
- **Note — named-record args** is a deliberate departure from A/B's positional tuples; clearer for many-arg functions, more verbose for single-arg.

## Files touched

- `src/approach-e/principal.ts` (new)
- `src/approach-e/call.ts` (new)
- `src/approach-e/index.ts` (new)
- `tests/approach-e.test.ts` (new — 16 cases)
- `tests/approach-e.read-only.test.ts` (new — 7 cases)
- `src/index.ts` (modified — aliased re-exports)
- `tests/playground/index.ts` (appended approach-e block)

## How to verify

```bash
cd packages/stck
npx tsc --noEmit                                           # zero approach-e errors
# Standard `npx jest approach-e` fails due to repo-wide ts-jest issue
# (Cannot find name 'global' in packages/common/src/utils.ts:201).
# Workaround that confirms runtime correctness (23/23 pass):
npx jest --config '{"preset":"ts-jest","testEnvironment":"node","testMatch":["**/approach-e*.test.ts"],"globals":{"ts-jest":{"isolatedModules":true,"diagnostics":false}},"rootDir":"."}'
```
