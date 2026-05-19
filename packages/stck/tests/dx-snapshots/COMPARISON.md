# DX snapshot comparison — A vs B vs C vs D vs E vs F

_Side-by-side of the same probe across every approach. Source-of-truth is the per-approach `output/approach-X.md` files; this is a digest._

Same scenario in every fixture: counter contract, `add(5)` (public, takes a `uint`), `increment()` (public, no args), `getCount` (read-only, returns `UIntCV`), one wrong-arg-type, one wrong-function-name.

## TL;DR — at a glance

| Probe | A | B | C (proxy) | D (brand, non-breaking) | E (brand, standalone) | F (createClient) |
|---|---|---|---|---|---|---|
| **Construction hover label** | full ABI tree | full ABI tree | `ProxyClient<{...full ABI...}>` | `Principal<{...full ABI...}>` | **`Principal<CounterContract>`** ✓ | **`Client<Contracts>`** ✓ |
| **Function-name autocomplete** | inside `''`: `add \| decrement \| increment` ✓ | inside `''`: `add \| decrement \| increment` ✓ | `counter.` → all 5 fns ✓ | `typedCall(p, '')`: `add \| decrement \| increment` ✓ | `call(p, '')`: **989 in-scope identifiers ✗** | inside `''`: `add \| decrement \| increment` ✓ |
| **Read-only return narrowing** | `UIntCV` ✓ | `UIntCV` ✓ | `UIntCV` ✓ | `UIntCV` ✓ | **polluted union ✗** | `UIntCV` ✓ |
| **Public return** | `StacksTransactionWire` ✓ | `StacksTransactionWire` ✓ | `StacksTransactionWire` ✓ | `StacksTransactionWire` ✓ | `StacksTransactionWire` ✓ | `StacksTransactionWire` ✓ |
| **Wrong arg type diagnostic** | clean | clean | clean | **two-overload dump** ⚠ | clean | clean |
| **Wrong function name diagnostic** | clean (3 names) | clean (3 names) | clean (`Property 'mint' does not exist`) | **two-overload dump** ⚠ | clean (5 names — includes read-only ⚠) | clean (filtered to public) |
| **Signature help inside `(...)`** | ✓ | ✓ | **empty** ⚠ (variadic spread) | n/a | n/a | ✓ |
| **Access (read vs public) compile-time check** | yes (separate methods) | yes (separate methods) | yes (return type differs) | yes (separate functions) | **no — runtime only ✗** | yes (`FunctionKeysByAccess<...>`) |

Legend: ✓ = good, ⚠ = caveat, ✗ = broken.

## Probe 1 — Construction hover

What does the user see when they hover the contract handle right after creating it?

| Approach | Hover |
|---|---|
| A | `counterContract` — full `as const` ABI tree (verbose) |
| B | `counterContract` — full `as const` ABI tree (verbose) |
| C | `const counter: ProxyClient<{ ...full ABI... }>` — verbose |
| D | `const counter: Principal<{ ...full ABI... }>` — verbose |
| **E** | `const counter: Principal<CounterContract>` — **single-line, clean** |
| **F** | `const stx: Client<Contracts>` — **single-line, clean** |

The bundle / brand approaches that wrap the ABI in a named alias (E with `CounterContract`, F with `Contracts`) get dramatically cleaner hovers than the ones that expose the full `as const` literal (A, B, C, D).

## Probe 2 — Function-name autocomplete

What appears in the autocomplete popup at the moment the user types the function name?

| Approach | Position probed | Result |
|---|---|---|
| A | `functionName: '` cursor | `add`, `decrement`, `increment` (public only) |
| B | `functionName: '` cursor | `add`, `decrement`, `increment` (public only) |
| C | `counter.` cursor | `add`, `decrement`, `getCount`, `getCountAtBlock`, `increment` (all 5) |
| D | `typedCall(p, '` cursor | `add`, `decrement`, `increment` (public only) |
| **E** | `call(p, '` cursor | **989 in-scope identifiers — bug** |
| F | `functionName: '` cursor | `add`, `decrement`, `increment` (public only) |

C is the most readable: a single list on `counter.`. E's function-style `call()` autocomplete is broken (the literal-type constraint isn't propagating); E's bound proxy `c.` works fine.

## Probe 3 — Read-only return narrowing

`const count = await ...getCount(...);` — what type does `count` have?

| Approach | Hover |
|---|---|
| A | `UIntCV` |
| B | `UIntCV` |
| C | `UIntCV` |
| D | `UIntCV` |
| **E** | `UIntCV \| ResponseOkCV<BooleanCV> \| ResponseErrorCV<UIntCV> \| ResponseOkCV<BooleanCV> \| ResponseOkCV<BooleanCV> \| ResponseOkCV<UIntCV>` — **polluted; type-level filter isn't narrowing** |
| F | `UIntCV` |

## Probe 4 — Wrong arg type diagnostic

The user passes `'not a uint'` where a `UIntCV` is expected. Error message quality:

| Approach | Diagnostic |
|---|---|
| A | `Type 'string' is not assignable to type 'number \| bigint \| UIntCV'.` |
| B | `Type 'string' is not assignable to type 'number \| bigint \| UIntCV \| undefined'.` |
| C | `Argument of type 'string' is not assignable to parameter of type 'number \| bigint \| UIntCV'.` |
| **D** | `No overload matches this call. Overload 1 of 2 ... gave: Type 'string' is not assignable to type 'number \| bigint \| UIntCV'. Overload 2 of 2 ... gave: Type 'string' is not assignable to type 'ClarityValue'.` — **two-overload dump** |
| E | `Type 'string' is not assignable to type 'never'.` (because of the read return narrowing bug; once fixed should be `UIntCV`) |
| F | (caller passes pre-built CV; error on `'not a uint'` is at the `Cl.uint(...)` call site or as `never`) |

## Probe 5 — Wrong function name diagnostic

The user types `"mint"` (not in the ABI):

| Approach | Diagnostic |
|---|---|
| A | `Type '"mint"' is not assignable to type '"add" \| "decrement" \| "increment"'.` |
| B | `Type '"mint"' is not assignable to type '"add" \| "decrement" \| "increment"'.` |
| C | `Property 'mint' does not exist on type 'ProxyClient<...>'.` |
| **D** | Two-overload dump (typed wrapper + raw passthrough) |
| **E** | `'"mint"' is not assignable to type '"add" \| "decrement" \| "increment" \| "getCount" \| "getCountAtBlock"'.` — includes read-only fns (access not enforced) |
| F | `'"mint"' is not assignable to type 'FunctionKeysByAccess<Contracts, "counter", "public">'.` (good — type-level filter is named) |

## Take-away

- **F has the cleanest hovers and narrowest error messages** of the no-runtime-codegen options. The cost is no JS-primitive coercion.
- **C has the most ergonomic call site** (`counter.add(5n)`) but the worst hover label (full ABI as `ProxyClient<...>`).
- **E's branded `Principal<T>` hover is the cleanest of all** when typed via a named alias, but the function-style helpers have real DX bugs the snapshots caught (function-name autocomplete, return-type narrowing).
- **D's "non-breaking" overload pattern leaks into error messages** — every diagnostic is a two-overload dump. Not visible until something goes wrong.
- **A and B remain the safe defaults** — boring but every probe is correct.
- **Signature help disappears with variadic tuple-spread types** (C). For a proxy, this is a meaningful loss; you only get autocomplete, not parameter hints inside `()`.

Regenerate with `node tests/dx-snapshots/run.mjs`.
