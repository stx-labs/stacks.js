# Approach F — DX example

> **openapi-fetch-style `createClient<Contracts>()`.** Types are passed as a single generic at client construction. The generated artifact is **pure types** (`.d.ts`-style — no runtime ABI). Inputs are pre-built `ClarityValue[]` (no JS-primitive coercion).

See [`tests/dx-snapshots/output/approach-f.md`](../tests/dx-snapshots/output/approach-f.md) for actual hover / autocomplete / diagnostic capture.

## Import

```ts
import { createClient } from "@stacks/stck";
import type { Contracts } from "./generated/types-only";    // ← TYPE-ONLY IMPORT
import { Cl } from "@stacks/transactions";
```

The `types-only/` generated barrel exports only `export type` — no runtime values. The user `import type`s it; the generic does the rest.

## Construction

```ts
const stx = createClient<Contracts>({ publicKey: PK, network: "testnet" });
//    ^? const stx: Client<Contracts>
```

Single generic, single client — no per-contract import at the call site.

## Public call (`add(5)`)

```ts
const tx = await stx.makeUnsignedContractCall({
  contract: "ST1PQHQ.counter",            // literal-typed against keyof Contracts
  functionName: "add",                    // narrowed by contract: "add" | "decrement" | "increment"
  functionArgs: [Cl.uint(5)],             // narrowed by functionName: [UIntCV]
});
//    ^? const tx: StacksTransactionWire
```

## No-arg public (`increment()`)

```ts
await stx.makeUnsignedContractCall({
  contract: "ST1PQHQ.counter",
  functionName: "increment",
  functionArgs: [],
});
```

## Read-only (`get-count`)

```ts
const count = await stx.fetchCallReadOnlyFunction({
  contract: "ST1PQHQ.counter",
  functionName: "get-count",              // kebab-case keys preserved
  functionArgs: [],
});
//    ^? const count: UIntCV
```

## Curried handle — `stx.contract<"counter">(addr)`

```ts
const counter = stx.contract<"counter">("ST1PQHQ.counter");
//    ^? const counter: ContractHandle<Contracts, "counter">

await counter.makeUnsignedContractCall("add", [Cl.uint(5)]);
await counter.fetchCallReadOnlyFunction("get-count", []);
```

The `<"counter">` annotation is required — TS can't infer the contract key from a free-form address. Visible wart.

## Type errors

```ts
await stx.makeUnsignedContractCall({
  contract: "ST1PQHQ.counter",
  functionName: "mint",                   // ✗ '"mint"' is not assignable to type 'FunctionKeysByAccess<Contracts, "counter", "public">'
  functionArgs: [Cl.uint(5)],
});
```

## What hover shows

| Symbol | Hover |
|---|---|
| `stx` | `Client<Contracts>` (very clean) |
| `counter` (curried handle) | `ContractHandle<Contracts, "counter">` |
| `tx` | `StacksTransactionWire` |
| `count` (read-only return) | `UIntCV` |

## Notes / caveats

- **No JS-primitive coercion.** `5` must be written as `Cl.uint(5)`. This is a real cost for one-shot scripts; minimal for app code that does many calls.
- **Smallest hover labels** of all six approaches — `Client<Contracts>` is shorter than C's `ProxyClient<{ ...full ABI... }>`.
- **Smallest generated artifact** — types only, no `as const` ABI, no brand symbol.
- **One generic, one runtime.** Easy to mock, easy to instrument, easy to publish a registry of `Contracts` types.
- The curried-handle `<K>` annotation is the friction point; a `stx.byKey("counter")` alternative could help.
- **Codegen is the simplest of all approaches** to write or transform — pure `.d.ts` output.
