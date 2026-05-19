# Approach D — DX example

> **Branded `Principal<T>`, non-breaking with `@stacks/transactions`.** The address is a branded string carrying the contract interface. Two call paths: splat-into-existing-function, or same-name wrapper that adds a `principal` field.

See [`tests/dx-snapshots/output/approach-d.md`](../tests/dx-snapshots/output/approach-d.md) for actual hover / autocomplete / diagnostic capture.

> **Honest verdict:** the brand alone cannot make function name + args + return co-vary through the existing 3-field call shape (`contractAddress`, `functionName`, `functionArgs` are independent). The user must change _something_ — either splat via `typedCall(...)` or import the same-name wrapper. "Non-breaking" works for the wire signature, not for the call ergonomics.

## Import

```ts
import { principal, typedCall, typedReadOnlyCall } from '@stacks/stck';
// Same-name wrappers — drop-in replace your @stacks/transactions imports:
import { makeUnsignedContractCall, fetchCallReadOnlyFunction } from '@stacks/stck';
import { Cl } from '@stacks/transactions';
import { counterContract } from './generated/typed/counter';
```

## Construction — branded principal

```ts
const counter = principal(counterContract, 'ST1PQHQ.counter');
//    ^? const counter: Principal<typeof counterContract>
```

`counter` is a **primitive string** at runtime, but typed as `Principal<CounterContract>` so it carries the contract interface anywhere it travels.

## Path 1 — splat into the real `@stacks/transactions` function

```ts
import { makeUnsignedContractCall } from '@stacks/transactions'; // ← unchanged

const tx = await makeUnsignedContractCall({
  ...typedCall(counter, 'add', [5]), // narrows name + args from the brand
  publicKey: PK,
});
```

## Path 2 — same-name wrapper (one-line import change)

```ts
import { makeUnsignedContractCall, fetchCallReadOnlyFunction } from '@stacks/stck'; // ← swap the import

const tx = await makeUnsignedContractCall({
  principal: counter, // ← branded value
  functionName: 'add', // narrowed: "add" | "decrement" | "increment"
  functionArgs: [5],
  publicKey: PK,
});
```

## No-arg public (`increment`)

```ts
await makeUnsignedContractCall({
  principal: counter,
  functionName: 'increment',
  functionArgs: [],
  publicKey: PK,
});
```

## Read-only (`getCount`)

```ts
const count = await fetchCallReadOnlyFunction({
  principal: counter,
  functionName: 'getCount',
  functionArgs: [],
  publicKey: PK,
});
//    ^? const count: UIntCV
```

## Passing the branded principal around

```ts
type Counter = Principal<typeof counterContract>;

function fireIncrement(target: Counter) {
  return makeUnsignedContractCall({
    principal: target,
    functionName: 'increment',
    functionArgs: [],
    publicKey: PK,
  });
}

fireIncrement(counter); // ✓
fireIncrement(otherPrincipal); // ✗ — type error if T differs
```

`Map<Principal<Counter>, ...>` and other typed-state patterns work naturally.

## Type errors

```ts
await makeUnsignedContractCall({
  principal: counter,
  functionName: 'add',
  functionArgs: ['not a uint'], // ✗ Type 'string' is not assignable to type 'number | bigint | UIntCV'
  publicKey: PK,
});

await makeUnsignedContractCall({
  principal: counter,
  functionName: 'mint', // ✗ '"mint"' is not assignable to type '"add" | "decrement" | "increment"'
  functionArgs: [Cl.uint(5)],
  publicKey: PK,
});
```

## What hover shows

| Symbol                     | Hover                                  |
| -------------------------- | -------------------------------------- |
| `counter`                  | `Principal<{ ...full bundle ABI... }>` |
| `tx` (either path)         | `StacksTransactionWire`                |
| `count` (read-only return) | `UIntCV`                               |

## Notes

- **Error messages on the same-name wrapper involve two overloads** (typed + raw) — the diagnostic dumps both, which makes the error noisier than A or B.
- The branded primitive itself is the genuinely useful idea — it's a primitive that A, B, F could _also_ accept for their `contract` field.
- "Non-breaking" only means "doesn't change the wire signature." Users still change their imports or wrap their call sites.
