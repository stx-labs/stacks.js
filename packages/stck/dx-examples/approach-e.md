# Approach E — DX example

> **Branded `Principal<T>`, standalone.** The address itself is a typed value (`Principal<CounterContract>`) and the bundle's runtime ABI lives in a module-local registry keyed by address. Two call surfaces: function-style helpers (`call`, `read`) or a proxy via `bind(p, bindings)`.

See [`tests/dx-snapshots/output/approach-e.md`](../tests/dx-snapshots/output/approach-e.md) for actual hover / autocomplete / diagnostic capture.

> **Snapshot uncovered two real DX gaps** (also flagged in [REPORT.md](../src/approach-e/REPORT.md)):
> 1. `call(counter, "...")` autocomplete returns **all in-scope identifiers** instead of the contract's function names — the literal-type constraint isn't narrowing.
> 2. `read(counter, "getCount", {})` hovers as **a union of every function's return type** — not narrowed to `UIntCV`.
> The `bind()` proxy variant doesn't suffer from these — it's the recommended path until the function-style helpers' types are tightened.

## Import

```ts
import { principal, call, read, bind } from "@stacks/stck";
import type { Principal } from "@stacks/stck";
import { counterContract } from "./generated/typed/counter";
```

## Construction — branded principal

```ts
const counter = principal(counterContract, "ST1PQHQ.counter");
//    ^? const counter: Principal<CounterContract>
```

Brand-only — a primitive string at runtime, the bundle's ABI is registered for later lookup.

## Function-style — public

```ts
const tx = await call(counter, "add", { n: 5n }, { publicKey: PK });
//    ^? const tx: StacksTransactionWire
```

Args are a **named record** (`{ n: 5n }`), matching the codegen's emitted `AddArgs = { n: UIntCV }` shape.

## Function-style — no args

```ts
await call(counter, "increment", {}, { publicKey: PK });
```

## Function-style — read-only

```ts
const count = await read(counter, "getCount", {});
// ⚠ hover currently shows a polluted union — see snapshot. Bug to fix.
```

## Bound proxy — recommended

```ts
const c = bind(counter, { publicKey: PK });
//    ^? const c: BoundClient<Principal<CounterContract>>

await c.add({ n: 5n });
await c.increment();
const count = await c.getCount();
```

Autocomplete on `c.` shows:

- `add` _(property)_
- `decrement` _(property)_
- `getCount` _(property)_
- `getCountAtBlock` _(property)_
- `increment` _(property)_

## Passing the branded principal around

```ts
function fireIncrement(target: Principal<CounterContract>) {
  return call(target, "increment", {}, { publicKey: PK });
}
```

`Map<Principal<T>, ...>` works as expected.

## Type errors

```ts
await call(counter, "add", { n: "not a uint" }, { publicKey: PK });
// Type 'string' is not assignable to type 'never'   (or 'UIntCV' once narrowing is fixed)

await call(counter, "mint", {}, { publicKey: PK });
// Argument of type '"mint"' is not assignable to parameter of type
// '"add" | "decrement" | "increment" | "getCount" | "getCountAtBlock"'.
```

Note the last error includes **all** functions, not just public — E doesn't separate access at the type level today.

## What hover shows

| Symbol | Hover |
|---|---|
| `counter` | `Principal<CounterContract>` (clean!) |
| `tx` from `call(...)` | `StacksTransactionWire` |
| `count` from `read(...)` | ⚠ polluted union — see snapshot |
| `c` from `bind(...)` | `BoundClient<Principal<CounterContract>>` |
| `count` from `c.getCount()` | `UIntCV | StacksTransactionWire` ⚠ (also wide) |

## Notes / caveats

- **`Principal<T>` is the clean hover** — much shorter than A/B/C/D, because the brand type doesn't print the full ABI.
- **The bound proxy gives the best DX** among E's surfaces today — autocomplete works, the function-style `call()` autocomplete does not.
- **No compile-time access check.** `call(c, "getCount", ...)` and `read(c, "add", ...)` only fail at runtime. Curable if the codegen emits an `access` tag in the interface.
- Named-record args are clearer for many-arg functions, more verbose for single-arg vs. A/B's tuples.
