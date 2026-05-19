# Approach H — DX example

> **Same name, same call shape as `@stacks/transactions`. Branded `contractAddress` adds type safety; everything else stays put.** No `typedCall(...)` splat. No new function name. No coercion. Just `import from "@stacks/stck"` instead of `"@stacks/transactions"` and brand your address.

See [`tests/dx-snapshots/output/approach-h.md`](../tests/dx-snapshots/output/approach-h.md) for actual hover / autocomplete / diagnostic capture, and [`src/approach-h/REPORT.md`](../src/approach-h/REPORT.md) for design decisions.

## Import (one line swap)

```diff
- import { makeUnsignedContractCall, fetchCallReadOnlyFunction } from "@stacks/transactions";
+ import { makeUnsignedContractCall, fetchCallReadOnlyFunction } from "@stacks/stck";
  import { Cl } from "@stacks/transactions";
  import { counterAddress } from "./gen/branded-address/counter";
```

## Construction — brand the address

```ts
const addr = counterAddress("ST1PQHQ");
//    ^? const addr: BrandedAddress<CounterContract>
```

## Public call (`add(5)`) — exact same field shape

```ts
const tx = await makeUnsignedContractCall({
  contractAddress: addr,
  contractName: "counter",         // narrowed by the brand
  functionName: "add",             // narrowed by the brand
  functionArgs: [Cl.uint(5)],      // narrowed by the brand
  publicKey: PK,
});
//    ^? const tx: StacksTransactionWire
```

## No-arg public (`increment`)

```ts
await makeUnsignedContractCall({
  contractAddress: addr,
  contractName: "counter",
  functionName: "increment",
  functionArgs: [],
  publicKey: PK,
});
```

## Read-only (`get-count`)

```ts
const count = await fetchCallReadOnlyFunction({
  contractAddress: addr,
  contractName: "counter",
  functionName: "get-count",
  functionArgs: [],
  senderAddress: "ST2...",
});
//    ^? const count: UIntCV
```

The return type narrows to the precise `ClarityValue` declared for that read-only function.

## Plain `string` still works (raw fallback)

```ts
await makeUnsignedContractCall({
  contractAddress: "ST1PQHQ",      // plain string, no brand
  contractName: "anything",
  functionName: "whatever",
  functionArgs: [],
  publicKey: PK,
});
```

When `contractAddress` isn't branded, every field has the original loose typing from `@stacks/transactions`. Mix branded and unbranded calls freely in the same file.

## Type errors — every diagnostic lands on the offending field

```ts
// Wrong contract name
await makeUnsignedContractCall({
  contractAddress: addr,
  contractName: "vault",
//~~~~~~~~~~~~ Type '"vault"' is not assignable to type '"counter"'.
  functionName: "add",
  functionArgs: [Cl.uint(5)],
  publicKey: PK,
});

// Wrong function name
await makeUnsignedContractCall({
  contractAddress: addr,
  contractName: "counter",
  functionName: "mint",
//~~~~~~~~~~~~ Type '"mint"' is not assignable to type 'PublicNames<CounterContract>'.
  functionArgs: [Cl.uint(5)],
  publicKey: PK,
});

// Wrong arg type
await makeUnsignedContractCall({
  contractAddress: addr,
  contractName: "counter",
  functionName: "add",
  functionArgs: ["not a uint"],
//                ~~~~~~~~~~~~ Type 'string' is not assignable to type 'UIntCV'.
  publicKey: PK,
});

// Too few args
await makeUnsignedContractCall({
  contractAddress: addr,
  contractName: "counter",
  functionName: "add",
  functionArgs: [],
//~~~~~~~~~~~~ Type '[]' is not assignable to type 'AddArgs'. Source has 0 element(s) but target requires 1.
  publicKey: PK,
});

// Calling read-only via public function (access enforced)
await makeUnsignedContractCall({
  contractAddress: addr,
  contractName: "counter",
  functionName: "get-count",
//~~~~~~~~~~~~ Type '"get-count"' is not assignable to type 'PublicNames<CounterContract>'.
  functionArgs: [],
  publicKey: PK,
});

// Calling public via read-only function (symmetric)
await fetchCallReadOnlyFunction({
  contractAddress: addr,
  contractName: "counter",
  functionName: "add",
//~~~~~~~~~~~~ Type '"add"' is not assignable to type 'ReadOnlyNames<CounterContract>'.
  functionArgs: [Cl.uint(5)],
  senderAddress: "ST2...",
});
```

## What hover shows

| Symbol | Hover |
|---|---|
| `addr` | `BrandedAddress<CounterContract>` |
| `tx` | `StacksTransactionWire` |
| `count` (read-only return) | `UIntCV` |

## Autocomplete moments

- `functionName: "` → `add`, `decrement`, `increment` (public functions only)
- `contractName: "` → `counter`
- `fetchCallReadOnlyFunction({ ... functionName: "` → `get-count`, `get-count-at-block` (read-only functions only)

## Vs. D (the predecessor)

|                                      | D                                        | H                                  |
|--------------------------------------|------------------------------------------|------------------------------------|
| Helper at call site                  | `...typedCall(p, "add", [5])` splat      | none                               |
| Function name                        | `makeUnsignedContractCallD` (aliased)    | `makeUnsignedContractCall`         |
| Migration cost                       | swap import + wrap every call            | swap import + rebrand address      |
| Error footprint                      | two-overload dump on function name       | precise field-level                |
| Read-only return narrowing           | yes                                      | yes                                |

H is D done right — same goals (non-breaking, brand the address), better execution (single-signature conditional instead of overloads with `typedCall` splat).

## Notes / caveats

- **`contractName` is redundant info** for the user (the brand already knows it), but typing it keeps the call shape identical to the existing API. It does narrow to the literal, so autocomplete picks the only option.
- **Error messages mention `PublicNames<CounterContract>`** rather than the inlined union — hover to expand. Could be improved.
- **Brand is REQUIRED** (not optional). Tradeoff: `BrandedAddress<T>` not assignable to plain `string`; use a cast if you need to pass it to raw `@stacks/transactions` code.
- **No coercion.** Pre-built `ClarityValue[]` inputs. Consistent with the existing API.
