# Approach A — DX example

> Function-style helper + higher-level wrapper. Types are derived from the **runtime ABI value plus a phantom symbol-keyed brand** that points at a typed `CounterContract` interface. One import (the bundle) carries both.

See [`tests/dx-snapshots/output/approach-a.md`](../tests/dx-snapshots/output/approach-a.md) for actual hover / autocomplete / diagnostic capture from the language service.

## Import

```ts
import { makeUnsignedContractCallA, contractA } from '@stacks/stck';
import { counterContract } from './generated/typed/counter';
import { Cl } from '@stacks/transactions';
```

## Public call (`add(5)`)

Function-style:

```ts
const tx = await makeUnsignedContractCallA(counterContract, {
  contract: 'ST1PQHQ.counter',
  functionName: 'add', // autocomplete: "add" | "decrement" | "increment"
  functionArgs: [Cl.uint(5)], // typed: [UIntCV]
  publicKey: PK,
});
//    ^? const tx: StacksTransactionWire
```

Wrapper-style:

```ts
const counter = contractA(counterContract, { contract: 'ST1PQHQ.counter', publicKey: PK });

await counter.makeUnsignedContractCall('add', [5]); // JS primitive accepted (coerced)
await counter.makeUnsignedContractCall('add', [Cl.uint(5)]); // CV accepted (passthrough)
```

## No-arg public (`increment()`)

```ts
await counter.makeUnsignedContractCall('increment', []);
```

## Read-only (`getCount()`)

```ts
const count = await counter.fetchCallReadOnlyFunction('getCount', []);
//    ^? const count: UIntCV
```

The return type narrows to the precise CV declared by the bundle's typed interface.

## Type errors at the wrong-arg site

```ts
await counter.makeUnsignedContractCall('add', ['not a uint']);
//                                            ~~~~~~~~~~~~~
// Type 'string' is not assignable to type 'number | bigint | UIntCV'.

await counter.makeUnsignedContractCall('mint', [Cl.uint(5)]);
//                                     ~~~~~~
// Argument of type '"mint"' is not assignable to parameter of type '"add" | "decrement" | "increment"'.
```

## What hover shows (LSP-accurate)

| Symbol                 | Hover                              |
| ---------------------- | ---------------------------------- |
| `counterContract`      | full `as const` ABI tree (verbose) |
| `tx` from public call  | `StacksTransactionWire`            |
| `count` from read-only | `UIntCV`                           |
| `counter` (wrapper)    | `ContractClientForBundleA<...>`    |

## Notes

- Method names are **camelCase** (`"getCount"`, `"addOne"`).
- Argument form is a **positional tuple** (`[5]`, `[]`).
- Read-only vs. public split is enforced by separate methods on the wrapper (`fetchCallReadOnlyFunction` vs. `makeUnsignedContractCall`).
- The bundle import is the single source of truth — one file per contract.
