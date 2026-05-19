# Approach C — DX example

> **Proxy-based direct method dispatch.** The contract handle *is* the contract: `counter.add(5n)` works as a method call. Read vs. public is auto-detected from the ABI at runtime; there's no `.read` / `.write` namespace split. The same method name does the right thing.

See [`tests/dx-snapshots/output/approach-c.md`](../tests/dx-snapshots/output/approach-c.md) for actual hover / autocomplete / diagnostic capture.

## Import

```ts
import { contractC } from "@stacks/stck";
import { counterContract } from "./generated/typed/counter";
```

## Construction

```ts
const counter = contractC(counterContract, {
  contract: "ST1PQHQ.counter",
  publicKey: PK,
  network: "testnet",                   // optional, defaults to mainnet
});
```

## Public call (`add(5)`)

```ts
const tx = await counter.add(5n);
//    ^? const tx: StacksTransactionWire
```

## No-arg public (`increment()`)

```ts
await counter.increment();
```

## Read-only (`getCount()`)

```ts
const count = await counter.getCount();
//    ^? const count: UIntCV
```

Same dot-syntax for read and write — `counter.add(...)` produces an unsigned tx, `counter.getCount()` resolves to the decoded CV.

## Autocomplete after the dot

Typing `counter.` shows exactly:

- `add` _(property)_
- `decrement` _(property)_
- `getCount` _(property)_
- `getCountAtBlock` _(property)_
- `increment` _(property)_

Method names are **camelCase**. Both read-only and public functions appear in one list.

## Per-call options

```ts
await counter.add(5n, { fee: 1000n, nonce: 7n });
await counter.getCount({ senderAddress: "ST2..." });
```

## Type errors

```ts
await counter.add("not a uint");
//                ~~~~~~~~~~~~~
// Argument of type 'string' is not assignable to parameter of type 'number | bigint | UIntCV'.

await counter.mint(5n);
//      ~~~~
// Property 'mint' does not exist on type 'ProxyClient<...>'.
```

## What hover shows

| Symbol | Hover |
|---|---|
| `counter` | `ProxyClient<{ ...full ABI... }>` (verbose) |
| `counter.add` (method on handle) | variadic tuple signature |
| `tx` from `counter.add(5n)` | `StacksTransactionWire` |
| `count` from `counter.getCount()` | `UIntCV` |

## Notes / caveats

- **Signature help inside `counter.add(` is empty.** Proxy methods are typed as variadic tuple-spread, and TS doesn't generate sig help for those. Users see autocomplete, not parameter hints.
- **`counter` hover prints the full bundle ABI.** Workable but noisy — would be cleaner if we wrapped in a named alias.
- **`Object.keys(counter)` returns the camelCase function list** (the proxy's `ownKeys` handler).
- Proxies obscure stack traces; if `await counter.add(5n)` rejects, the trace points at the proxy handler.
