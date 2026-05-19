# Approach B — DX example

> Function-style helper + higher-level wrapper. Types derive purely from the `as const` ABI literal via conditional-type machinery — no brand involved. Function names preserve the original kebab-case.

See [`tests/dx-snapshots/output/approach-b.md`](../tests/dx-snapshots/output/approach-b.md) for actual hover / autocomplete / diagnostic capture.

## Import

```ts
import { makeUnsignedContractCallB, contractB } from "@stacks/stck";
import { counterContract } from "./generated/typed/counter";
import { Cl } from "@stacks/transactions";
```

## Public call (`add 5`)

Function-style:

```ts
const tx = await makeUnsignedContractCallB(counterContract, {
  contract: "ST1PQHQ.counter",
  functionName: "add",                    // autocomplete: "add" | "decrement" | "increment"
  functionArgs: [Cl.uint(5)],
  publicKey: PK,
});
//    ^? const tx: StacksTransactionWire
```

Wrapper-style:

```ts
const counter = contractB(counterContract, { contract: "ST1PQHQ.counter", publicKey: PK });

await counter.makeUnsignedContractCall("add", [5]);
await counter.makeUnsignedContractCall("add", [Cl.uint(5)]);
```

## No-arg public (`increment`)

```ts
await counter.makeUnsignedContractCall("increment", []);
```

## Read-only (`get-count`)

```ts
const count = await counter.fetchCallReadOnlyFunction("get-count", []);
//    ^? const count: UIntCV
```

Note the **kebab-case** name — B keeps the original Clarity function name everywhere.

## Type errors

```ts
await counter.makeUnsignedContractCall("add", ["not a uint"]);
// Type 'string' is not assignable to type 'number | bigint | UIntCV'.

await counter.makeUnsignedContractCall("mint", [Cl.uint(5)]);
// Argument of type '"mint"' is not assignable to parameter of type '"add" | "decrement" | "increment"'.
```

## What hover shows

| Symbol | Hover |
|---|---|
| `counterContract` | full `as const` ABI tree |
| `tx` | `StacksTransactionWire` |
| `count` | `UIntCV` |
| `counter` (wrapper) | `ContractClientB<...>` |

## Differences vs. Approach A

|                                 | A                                    | B                                    |
|---------------------------------|--------------------------------------|--------------------------------------|
| Function name format            | camelCase                            | original kebab-case                  |
| Type derivation source          | phantom brand on the bundle          | conditional types over `as const` ABI |
| Error message style             | named aliases (e.g. `AddArgs`)       | compact structural                   |
| Cmd-click to definition         | lands on named alias                 | expansion in hover, not navigable    |
| Type drift risk                 | theoretical (tests mitigate)         | impossible by construction           |
