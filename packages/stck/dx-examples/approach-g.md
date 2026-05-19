# Approach G — DX example

> **Minimal type-only branded `Principal<T>`.** A variation of E. The brand carries a **type only** — no runtime bundle, no ABI registry, no module-local state. `principal<T>(addr)` is the identity at runtime. Pre-built `ClarityValue[]` inputs required (no coercion). Compile-time access check (read vs. public).

See [`tests/dx-snapshots/output/approach-g.md`](../tests/dx-snapshots/output/approach-g.md) for actual hover / autocomplete / diagnostic capture, and [`src/approach-g/REPORT.md`](../src/approach-g/REPORT.md) for design decisions.

## Import

```ts
import { principal, call, read } from "@stacks/stck/approach-g";
import type { Principal } from "@stacks/stck/approach-g";
import type { CounterContract } from "./generated/types-only/counter";    // ← TYPE-ONLY IMPORT
import { Cl } from "@stacks/transactions";
```

## Construction — type-only branded principal

```ts
const counter = principal<CounterContract>("ST1PQHQ.counter");
//    ^? const counter: Principal<CounterContract>
```

No bundle import. The type generic carries the contract interface; the constructor is an identity cast at runtime.

## Public call (`add(5)`)

```ts
const tx = await call(counter, "add", [Cl.uint(5)], { publicKey: PK });
//    ^? const tx: StacksTransactionWire
```

## No-arg public (`increment`)

```ts
await call(counter, "increment", [], { publicKey: PK });
```

## Read-only (`get-count`)

```ts
const n = await read(counter, "get-count", []);
//    ^? const n: UIntCV
```

## Passing the branded principal around

```ts
function fireIncrement(target: Principal<CounterContract>) {
  return call(target, "increment", [], { publicKey: PK });
}
```

`Map<Principal<CounterContract>, ...>` and other typed-state patterns work naturally.

## Type errors (every diagnostic underlines just the offending value)

```ts
// Wrong arg type
await call(counter, "add", ["not a uint"], { publicKey: PK });
//                          ~~~~~~~~~~~~
// Type 'string' is not assignable to type 'UIntCV'.

// Wrong function name
await call(counter, "mint", [Cl.uint(5)], { publicKey: PK });
//                  ~~~~~~
// '"mint"' is not assignable to type 'FunctionNames<Principal<CounterContract>, "public">'.

// Calling read-only via call() — compile-time access enforcement
await call(counter, "get-count", [], { publicKey: PK });
//                  ~~~~~~~~~~~
// '"get-count"' is not assignable to type 'FunctionNames<Principal<CounterContract>, "public">'.

// Calling public via read() — symmetric
await read(counter, "add", [Cl.uint(5)]);
//                  ~~~~~
// '"add"' is not assignable to type 'FunctionNames<Principal<CounterContract>, "read_only">'.
```

## What hover shows

| Symbol | Hover |
|---|---|
| `counter` | `Principal<CounterContract>` — single line, **cleanest of all approaches** |
| `tx` from `call(...)` | `StacksTransactionWire` |
| `n` from `read(...)` | `UIntCV` |

## Notes / caveats

- **No JS-primitive coercion.** `5` must be written as `Cl.uint(5)`. Cost of zero runtime ABI.
- **Function-name autocomplete is broken.** Typing `call(counter, '...')` returns ~990 in-scope identifiers instead of the candidate function names. Same TS limitation that hit Approach E. Type checking, hover, and diagnostics all work — only the suggestion list is wrong. Likely fixable by switching to options-object call shape (`call({ principal, functionName, functionArgs }, opts)`), at the cost of verbosity.
- **Access enforced at compile time.** Unlike E, you can't accidentally call a read-only via `call()` or a public via `read()`.
- **Strictly minimal brand.** The whole approach is `Principal<T> = '${string}.${string}' & { readonly __contract: T }` plus two helpers. No symbols, no Maps, no decorators.

## Vs. E (the parent)

|                                       | E                                | G                                  |
|---------------------------------------|----------------------------------|------------------------------------|
| Codegen output                        | bundle (value + interface)       | types-only                         |
| Brand carries                         | interface; bundle stored in Map  | interface only                     |
| Runtime size                          | per-address ABI registry         | zero                               |
| JS-primitive coercion                 | supported                        | not supported                      |
| Access (read vs. public) at compile time | runtime only ✗                | ✓                                  |
| Read return narrowing                 | polluted union ✗                 | ✓                                  |
| Function-name autocomplete on `call()` | broken (same bug)               | broken (same bug)                  |
