# Error-site precision across approaches

_What does the editor actually underline when the user makes a mistake? Generated from `fixtures/error-shapes.ts`._

For every approach, four canonical mistakes:

| ID | Mistake |
|---|---|
| **E1** | `functionArgs: []` (or no args) when one is required (too few) |
| **E2** | `functionArgs: [1, 2]` when one is required (too many) |
| **E3** | `functionArgs: ['s']` (or `{ n: 's' }`) — wrong type |
| **E4** | `functionName: 'mint'` — unknown function |

Each cell shows `underline → message gist`. "**whole-object**" means the editor underlines the entire `{ ... }` literal, which is the worst possible footprint — the user has to read the message to know which field is wrong.

---

## Function-style helpers (`makeUnsignedContractCallA/B`)

| Mistake | A | B |
|---|---|---|
| **E1** too few | `functionArgs` → `Type '[]' is not assignable to type '[number\|bigint\|UIntCV]'` | **whole-object** → `Argument of type {...} is not assignable to parameter of type {...A} \| {...B} \| {...C}` |
| **E2** too many | `functionArgs` → `'[number,number]' not assignable to '[number\|bigint\|UIntCV]'` | `functionArgs` → same |
| **E3** wrong type | `'s'` → `Type 'string' is not assignable to type 'number\|bigint\|UIntCV'` | `'s'` → same (with `\| undefined`) |
| **E4** wrong fn | `functionName` → `Type '"mint"' is not assignable to type '"add" \| "decrement" \| "increment"'` | `functionName` → same |

**The asymmetry you spotted is real and isolated to E1 in B.** The reason: B's `TypedOptionsB<ABI, F> = F extends any ? {...} : never` produces a **discriminated union of options shapes** (one per public function). When `functionArgs: []` is passed, the empty tuple is *structurally compatible* with both the `decrement` and `increment` variants (both have `args: []`); only the `functionName: "add"` discriminant rules them out. TS gives up trying to isolate "which member fits" and reports at the parameter level — i.e. the whole object literal.

In the E2/E3/E4 cases, only one union member is a plausible match, so TS narrows and points at the offending field. **B's union-distribution pattern is fine on the happy path and on most error cases, but it falls back to whole-object underlines specifically when an error case structurally matches multiple union members.**

A avoids this because its `TypedOptionsA<B, F>` is a single object shape parameterised by `F` — not a union — so TS reports field-level errors uniformly.

## Wrapper APIs (`contractA(...).makeUnsignedContractCall`, `contractB(...)...`)

| Mistake | A wrapper | B wrapper |
|---|---|---|
| **E1** too few | `[]` → arg-tuple mismatch | `[]` → same |
| **E3** wrong type | `'s'` → type mismatch | `'s'` → same |
| **E4** wrong fn | `'mint'` → name mismatch | `'mint'` → same |

**Both wrapper APIs give precise, identical diagnostics.** They use positional args, not an options object, so the discriminated-union problem can't arise. The wrappers are strictly better than the function-style helpers for error footprint.

## Approach C (Proxy)

| Mistake | Result |
|---|---|
| **E1** too few | `add` (method name) → `Expected 1-2 arguments, but got 0` |
| **E2** too many | `2` (second arg) → ⚠ **`Type '2' has no properties in common with type 'Partial<Omit<UnsignedContractCallOptions, ...>>'`** |
| **E3** wrong type | `'s'` → clean type mismatch |
| **E4** wrong fn | `mint` → `Property 'mint' does not exist on type 'ProxyClient<{...full ABI...}>'` |

**E2 surfaces a real DX bug.** The proxy method type is `(...args: [number\|bigint\|UIntCV, opts?: PerCallOptions]) => ...`. When the user passes `(1, 2)`, TS reads `1` as the `n` arg and `2` as the `opts` arg — and `2` doesn't have any of the option fields. The error message is technically correct but talks about `Partial<Omit<...>>` instead of "you passed too many args". Confusing for the user. The arity-based opts detection (clever at runtime) leaks into bad type-level errors at compile time.

E4's `mint` underline message also dumps the full bundle ABI (`ProxyClient<{ readonly functions: readonly [...] }>`) — accurate but ~200 chars of noise to scroll past.

## Approach D — same-name wrapper

| Mistake | Underline | Message |
|---|---|---|
| **E1** too few | `muccD` (function name) | `No overload matches this call. Overload 1 of 2 ... Overload 2 of 2 ...` ⚠ both overloads dumped |
| **E3** wrong type | `'s'` | `No overload matches this call.` + both overloads ⚠ |
| **E4** wrong fn | `muccD` (function name) | both overloads ⚠ |

**Every error in the same-name-wrapper path dumps both overloads.** The cost of D's "non-breaking" via overloads materialises in error messages. Splat path is much cleaner:

| Mistake (via `typedCall` splat) | Underline | Message |
|---|---|---|
| **E1** too few | `[]` | `Type '[]' is not assignable to type '[number\|bigint\|UIntCV]'` ✓ |
| **E3** wrong type | `'s'` | `Type 'string' is not assignable to type 'number\|bigint\|UIntCV'` ✓ |

So D has two surfaces with very different error quality. The splat path is the one you'd actually want to use.

## Approach E

Function-style `call(...)`:

| Mistake | Underline | Issue |
|---|---|---|
| **E1** missing field (`{}`) | _(no diagnostic at all)_ | ✗ **missing-required-field leaks** — runtime catches it, TS doesn't (agent flagged this in REPORT.md) |
| **E3** wrong type (`{ n: 's' }`) | `n` (the key) | message is `Type 'string' is not assignable to type 'never'` — because the return-type-pollution bug also pollutes the arg type to `never` |
| **E4** wrong fn | `'mint'` | clean, but the candidate list includes read-only fns (access not enforced at type level) |

Bound proxy `c.add({...})`:

| Mistake | Underline | Issue |
|---|---|---|
| **E1** missing field (`{}`) | `{}` | clean: `Property 'n' is missing in type '{}'` ✓ |
| **E3** wrong type | `n` | clean: `Type 'string' is not assignable to type 'number\|bigint\|UIntCV'` ✓ |
| **E4** wrong fn | `mint` | clean: `Property 'mint' does not exist on type 'BoundClient<Principal<CounterContract>>'` ✓ |

**The bound proxy `bind(p, ...)` gives clean diagnostics; the function-style `call(p, ...)` is broken.** Two completely different DX qualities from the same approach.

## Approach F

| Mistake | Underline | Issue |
|---|---|---|
| _all of them_ | also underlines `contract` | ⚠ **spurious "address shape" error** when `contract` is a non-literal `${string}.${string}` — F's `DeployedContract<C, K>` is templated as `${string}.counter` and rejects broader strings |
| **E1** too few | `functionArgs` + `contract` | message is precise on `functionArgs` |
| **E2** too many | `functionArgs` + `contract` | same |
| **E4** wrong fn | `functionName` + `contract` | `Type '"mint"' is not assignable to type 'FunctionKeysByAccess<Contracts, "counter", "public">'` ✓ |

**F has a real DX issue with the `contract` field:** any non-literal `${string}.${string}` value triggers a `Type ... is not assignable to type '${string}.counter'` error. With a literal address (`"ST1...counter"`) the type narrows fine, but the moment the address comes from a typed variable, helper, or environment, the user has to satisfy the literal template constraint. Workable but a friction point.

When the address is a literal, every other diagnostic is precise (specific field underlined).

---

## Summary scoreboard

| Approach | E1 | E2 | E3 | E4 | Notes |
|---|---|---|---|---|---|
| **A** function-style | ✓ field | ✓ field | ✓ value | ✓ field | Best uniform footprint |
| **A** wrapper | ✓ arg | ✓ arg | ✓ value | ✓ arg | Identical to B wrapper |
| **B** function-style | **✗ whole-object** | ✓ field | ✓ value | ✓ field | Union distribution leaks |
| **B** wrapper | ✓ arg | ✓ arg | ✓ value | ✓ arg | Same as A wrapper |
| **C** proxy | ✓ method | **✗ confused** | ✓ value | ✓ method (verbose) | Arity-based opts confuses E2 |
| **D** wrapper | **✗ fn name + 2 overloads** | n/a | **✗ fn name + 2 overloads** | **✗ fn name + 2 overloads** | Cost of overload-based non-breaking |
| **D** splat | ✓ arg | n/a | ✓ value | n/a | Use this path |
| **E** `call()` | **✗ no diagnostic** | n/a | **✗ wrong message** | ✓ value (verbose) | Function-style is broken |
| **E** `bind()` | ✓ arg | n/a | ✓ field | ✓ method | Use this path |
| **F** | ✓ field (+ spurious `contract`) | ✓ field (+ spurious) | _bypassed_ | ✓ field (+ spurious) | `contract` template-literal friction |

## What I missed before

Before you pointed it out, the COMPARISON.md said A and B were "boring but every probe is correct". That was wrong: **B's E1 underlines the whole options object** because of the discriminated-union distribution in `TypedOptionsB<ABI, F>`. Looking at it now, three other things the snapshots show that I hadn't called out:

1. **C's E2 (too many args) gives a misleading error** — the variadic tuple-spread design causes `add(1, 2)` to be type-checked as "is `2` a valid options object?" rather than "did you pass too many args?".
2. **D's same-name wrapper makes *every* error a two-overload dump** — across E1/E3/E4 — because every diagnostic goes through the overload-resolution machinery.
3. **F's `contract` field is template-literal-strict** — any non-literal address adds a spurious diagnostic on top of the real one.

The wrappers (`contractA(...)`, `contractB(...)`, and E's `bind(...)`) are the only call surfaces that give *uniformly* precise diagnostics across all four mistakes. Function-style helpers and proxy/curry/overload tricks each leak at a specific error case.
