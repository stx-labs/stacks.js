# DX snapshot — `approach-f`

_Generated from `tests/dx-snapshots/fixtures/approach-f.ts` by `tests/dx-snapshots/run.mjs`. Captures hover (`^?`), completions (`^|`), and signature help (`^!`) at the marked cursor positions — i.e. what the LSP would show a user at each point._

## Fixture

```ts
// Approach F — openapi-fetch-style createClient<Contracts>().
// Types-only generic. Pre-built ClarityValue[] inputs.
// Standard scenario: add(5), increment(), getCount().
import { createClient } from '../../../src/approach-f';
import type { Contracts } from '../../generated/types-only';
import { Cl } from '@stacks/transactions';

const PK = '02abcd';
const ADDR = 'ST1PQHQ.counter' as const;

// 1. Construction — generic-only client
const stx = createClient<Contracts>({ publicKey: PK, network: 'testnet' });
//    ^? hover on stx (the client)

// 2. Top-level call — public, add(5)
async function callAdd() {
  const tx = await stx.makeUnsignedContractCall({
    //  ^? hover on tx
    contract: `${ADDR}`,
    functionName: 'add',
    functionArgs: [Cl.uint(5)],
  });
  return tx;
}

// 3. Autocomplete the function name
async function autocompleteFn() {
  await stx.makeUnsignedContractCall({
    contract: `${ADDR}`,
    functionName: '',
    //             ^| completions inside functionName ''
    functionArgs: [],
  });
}

// 4. No-arg public — increment()
async function callIncrement() {
  await stx.makeUnsignedContractCall({
    contract: `${ADDR}`,
    functionName: 'increment',
    functionArgs: [],
  });
}

// 5. Read-only — getCount()
async function callGetCount() {
  const count = await stx.fetchCallReadOnlyFunction({
    //    ^? hover on count (read-only return)
    contract: `${ADDR}`,
    functionName: 'get-count',
    functionArgs: [],
  });
  return count;
}

// 6. Curried handle — stx.contract<"counter">(addr)
async function curriedHandle() {
  const counter = stx.contract<'counter'>(`${ADDR}`);
  //    ^? hover on counter (curried handle)
  counter.makeUnsignedContractCall('add', [Cl.uint(5)]);
  //      ^| completions on counter.
}

// 7. Error — wrong arg type
async function wrongArg() {
  await stx.makeUnsignedContractCall({
    contract: `${ADDR}`,
    functionName: 'add',
    functionArgs: ['not a uint' as unknown as never],
  });
}

// 8. Error — wrong function name (kebab-case key)
async function wrongFn() {
  await stx.makeUnsignedContractCall({
    contract: `${ADDR}`,
    functionName: 'mint',
    functionArgs: [Cl.uint(5)],
  });
}
```

## hover on stx (the client)

Line 12, col 7 — `const stx = createClient<Contracts>({ publicKey: PK, network: 'testnet' });`

**Hover:**

```ts
const stx: Client<Contracts>
```

## hover on tx

Line 17, col 9 — `const tx = await stx.makeUnsignedContractCall({`

**Hover:**

```ts
const tx: StacksTransactionWire
```

## completions inside functionName ''

Line 30, col 20 — `functionName: '',`

**Completions:**

- `add` _(string)_
- `decrement` _(string)_
- `increment` _(string)_

## hover on count (read-only return)

Line 47, col 11 — `const count = await stx.fetchCallReadOnlyFunction({`

**Hover:**

```ts
const count: UIntCV
```

## hover on counter (curried handle)

Line 58, col 9 — `const counter = stx.contract<'counter'>(`${ADDR}`);`

**Hover:**

```ts
const counter: ContractHandle<Contracts, "counter">
```

## completions on counter.

Line 60, col 11 — `counter.makeUnsignedContractCall('add', [Cl.uint(5)]);`

**Completions:**

- `fetchCallReadOnlyFunction` _(method)_
- `makeUnsignedContractCall` _(method)_

## Diagnostics

- **L30:5-17 _(12 chars)_** TS2322: Type '""' is not assignable to type 'FunctionKeysByAccess<Contracts, "counter", "public">'.
  underline: `functionName`
- **L77:5-17 _(12 chars)_** TS2322: Type '"mint"' is not assignable to type 'FunctionKeysByAccess<Contracts, "counter", "public">'.
  underline: `functionName`
