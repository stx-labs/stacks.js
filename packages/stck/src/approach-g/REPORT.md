# Approach G — Type-only branded `Principal<T>`

## Summary

Variation of Approach E. The brand carries the **type only**; there is no runtime bundle, no ABI value, no module-local registry. `principal<T>(addr)` is the identity at runtime — a phantom cast that attaches `T` for compile-time only. Calls are made via free functions `call` and `read` whose typing is driven entirely by the brand on `Principal<T>`. **Args must be pre-built `ClarityValue[]`** (no JS-primitive coercion is possible without runtime ABI).

This is the most minimal branded-principal possible: a phantom-property cast + two functions.

## Call-site examples

```ts
import { principal, call, read } from "@stacks/stck/approach-g";
import type { CounterContract } from "./generated/types-only/counter";
import { Cl } from "@stacks/transactions";

const counter = principal<CounterContract>("ST1PQHQ.counter");
//    ^? const counter: Principal<CounterContract>

// Public
const tx = await call(counter, "add", [Cl.uint(5)], { publicKey: PK });
//    ^? const tx: StacksTransactionWire

await call(counter, "increment", [], { publicKey: PK });

// Read-only
const n = await read(counter, "get-count", []);
//    ^? const n: UIntCV
```

## What the snapshot showed

Captured in `tests/dx-snapshots/output/approach-g.md`:

- **Construction hover** `Principal<CounterContract>` — the cleanest of all approaches (single line, no ABI dump).
- **Public return hover** `StacksTransactionWire` ✓
- **Read-only return hover** `UIntCV` ✓ (narrowed correctly, unlike E's polluted union)
- **Access enforcement at compile time** — `call(p, "get-count", ...)` errors `"get-count" is not assignable to FunctionNames<P, "public">`; `read(p, "add", ...)` errors symmetrically. **Cured the runtime-only access gap that E had.**
- **Tight diagnostic underlines** — every error underlines only the offending value (2-12 chars):
  - Empty name: underlines `''`
  - Wrong arg type: underlines `'not a uint'`
  - Wrong fn name: underlines `'mint'`
  - Read-only via `call()`: underlines `'get-count'`
  - Public via `read()`: underlines `'add'`

## Known DX gap

**Function-name autocomplete on `call(p, '', ...)` is broken** — same as Approach E. The completion list returns ~990 in-scope identifiers (`arguments`, `Cl`, `AbortController`, ...) instead of the candidate function names.

The cause appears to be that TypeScript's completion engine doesn't see through a computed-type constraint (`K extends FunctionNames<P, 'public'>`) at the literal-string position when the literal is a free function argument — even though the type checker rejects the empty string correctly with the right message.

Note that the **error** is precise; only the **autocomplete suggestion list** is wrong. Type checking, hover, and diagnostics all work.

Possible fixes worth prototyping:
- Switch to options-object call style: `call({ principal, functionName, functionArgs }, opts)` — this typically restores literal-string autocomplete (it does for A/B/F).
- Use overloads enumerating each function name explicitly (codegen).
- Use a tuple-spread parameter to widen the inference path.

The cleanest fix in spirit is the options-object call style; it costs verbosity at every call site. Worth trying as a sibling variant before committing.

## Decisions taken

- **Brand is required, not optional.** `Principal<T> = '${string}.${string}' & { readonly __contract: T }`. Required brand means `Principal<A>` is not assignable to `Principal<B>`. Also means `Principal<T>` is NOT assignable to plain `string` — so the brand cannot be passed into raw `@stacks/transactions` calls. That tradeoff is acceptable because G has its own runtime; D was the approach that needed assignability to `string`.
- **No runtime registry.** `principal<T>(addr)` is an identity cast — the function exists only to produce the branded type. No `Map`, no side effects. This is the genuine "minimal" pitch.
- **Pre-built ClarityValue[] inputs only.** Without a runtime ABI, automatic coercion (`5 → Cl.uint(5)`) is impossible. Users write `[Cl.uint(5)]`. Mirrors Approach F.
- **Reused F's generated types-only artifact** (`tests/generated/types-only/`). Positional CV tuples, `access` literal per function. The brand parameter `T` is structurally `{ functions: { [name]: { args; return; access } } }`.
- **Free-function call surface** (`call`, `read`) rather than a proxy. Matches E's function-style ergonomics. The bound-proxy variant (E's `bind`) is not implemented for G but would be straightforward to add and would likely cure the autocomplete bug.
- **Access split via type filter, not separate dispatch.** `FunctionNames<P, 'public'>` filters via the `access` tag in the interface; `call` only accepts public names, `read` only read-only. Compile-time enforcement.

## Uncertainties / open questions

- Whether to also ship a `bind(p, bindings)` proxy variant for G. The bound proxy in E fixed E's autocomplete issues; it would likely do the same for G. Tradeoff: more surface area, less "minimal".
- Whether `Principal<T>` should be optionally-branded so it remains assignable to plain `string` (D-style). Tradeoff against ergonomic invariance.
- Generated artifact ownership: reusing F's `tests/generated/types-only/` couples G to F's codegen shape. If F's shape evolves, G follows. Probably fine for the POC.
- `splitPrincipal` throws at runtime if the input isn't `addr.name`. Should it be a soft-validator instead?

## Comparison vs. E (the parent)

|                                   | E (bundle-carrying)               | G (type-only)                       |
|-----------------------------------|-----------------------------------|-------------------------------------|
| Codegen output                    | typed bundle (value + interface)  | types-only (no runtime values)      |
| Brand                             | carries interface; bundle in Map  | carries interface only; no Map      |
| Runtime size                      | `Map<string, ContractBundle>`     | zero                                |
| JS-primitive coercion (`5`)       | supported (via ABI lookup)        | not supported (must pass CVs)       |
| Access (read vs public) at compile-time | **runtime only ✗** (gap)    | **compile-time ✓**                  |
| Construction                      | `principal(bundle, addr)`         | `principal<T>(addr)`                |
| Read return type narrowing        | **polluted union ✗** (bug)        | `UIntCV` ✓                          |
| Function-name autocomplete on `call()` | broken (990 identifiers)     | broken (990 identifiers) — same bug |

G strictly wins on every axis except the missing JS-primitive coercion. If coercion isn't a priority, G is a cleaner E.

## Files

- `src/approach-g/principal.ts`
- `src/approach-g/call.ts`
- `src/approach-g/index.ts`
- `tests/dx-snapshots/fixtures/approach-g.ts`
- `tests/dx-snapshots/output/approach-g.md`
- `dx-examples/approach-g.md`

## How to verify

```bash
cd packages/stck
node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json --ignoreDeprecations 5.0 2>&1 | grep -E "src/approach-g|approach-g\.ts"
# Expect: only the deliberate errors from the fixture (8-11 in REPORT order)

node tests/dx-snapshots/run.mjs
# Regenerates output/approach-g.md
```
