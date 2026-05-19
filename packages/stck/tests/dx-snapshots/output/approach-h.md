# DX snapshot — `approach-h`

_Generated from `tests/dx-snapshots/fixtures/approach-h.ts` by `tests/dx-snapshots/run.mjs`. Captures hover (`^?`), completions (`^|`), and signature help (`^!`) at the marked cursor positions — i.e. what the LSP would show a user at each point._

## Fixture

```ts
// Approach H — same-name overloads of @stacks/transactions, branded on
// contractAddress. Same call shape, same function name. No new helpers.
import { makeUnsignedContractCall, fetchCallReadOnlyFunction } from '../../../src/approach-h';
import { counterAddress } from '../../generated/branded-address/counter';
import { Cl } from '@stacks/transactions';

const PK = '02abcd';

// 1. Construction — branded address
const addr = counterAddress('ST1PQHQ');
//    ^? hover on addr

// 2. Public call — IDENTICAL field shape to raw @stacks/transactions
async function callAdd() {
  const tx = await makeUnsignedContractCall({
    //  ^? hover on tx
    contractAddress: addr,
    contractName: 'counter',
    functionName: 'add',
    functionArgs: [Cl.uint(5)],
    publicKey: PK,
  });
  return tx;
}

// 3. Autocomplete functionName
async function autocompleteFn() {
  await makeUnsignedContractCall({
    contractAddress: addr,
    contractName: 'counter',
    functionName: '',
    //             ^| completions inside functionName ''
    functionArgs: [],
    publicKey: PK,
  });
}

// 4. Autocomplete contractName
async function autocompleteContractName() {
  await makeUnsignedContractCall({
    contractAddress: addr,
    contractName: '',
    //             ^| completions inside contractName ''
    functionName: 'add',
    functionArgs: [Cl.uint(5)],
    publicKey: PK,
  });
}

// 5. No-arg public — increment
async function callIncrement() {
  await makeUnsignedContractCall({
    contractAddress: addr,
    contractName: 'counter',
    functionName: 'increment',
    functionArgs: [],
    publicKey: PK,
  });
}

// 6. Read-only — get-count, narrows return to UIntCV
async function callGetCount() {
  const count = await fetchCallReadOnlyFunction({
    //    ^? hover on count
    contractAddress: addr,
    contractName: 'counter',
    functionName: 'get-count',
    functionArgs: [],
    senderAddress: 'ST2...',
  });
  return count;
}

// 7. Raw fallback — plain string contractAddress still works (raw overload)
async function rawFallback() {
  await makeUnsignedContractCall({
    contractAddress: 'ST1PQHQ',
    contractName: 'anything',
    functionName: 'whatever',
    functionArgs: [],
    publicKey: PK,
  });
}

// 8. Error — wrong contractName for the branded address
async function wrongContractName() {
  await makeUnsignedContractCall({
    contractAddress: addr,
    contractName: 'vault',
    functionName: 'add',
    functionArgs: [Cl.uint(5)],
    publicKey: PK,
  });
}

// 9. Error — wrong function name
async function wrongFnName() {
  await makeUnsignedContractCall({
    contractAddress: addr,
    contractName: 'counter',
    functionName: 'mint',
    functionArgs: [Cl.uint(5)],
    publicKey: PK,
  });
}

// 10. Error — wrong arg type
async function wrongArgType() {
  await makeUnsignedContractCall({
    contractAddress: addr,
    contractName: 'counter',
    functionName: 'add',
    functionArgs: ['not a uint'],
    publicKey: PK,
  });
}

// 11. Error — too few args
async function tooFewArgs() {
  await makeUnsignedContractCall({
    contractAddress: addr,
    contractName: 'counter',
    functionName: 'add',
    functionArgs: [],
    publicKey: PK,
  });
}

// 12. Error — calling read-only via makeUnsignedContractCall (access enforced)
async function readOnlyViaCall() {
  await makeUnsignedContractCall({
    contractAddress: addr,
    contractName: 'counter',
    functionName: 'get-count',
    functionArgs: [],
    publicKey: PK,
  });
}

// 13. Error — calling public via fetchCallReadOnlyFunction
async function publicViaRead() {
  await fetchCallReadOnlyFunction({
    contractAddress: addr,
    contractName: 'counter',
    functionName: 'add',
    functionArgs: [Cl.uint(5)],
    senderAddress: 'ST2...',
  });
}
```

## hover on addr

Line 10, col 7 — `const addr = counterAddress('ST1PQHQ');`

**Hover:**

```ts
const addr: BrandedAddress<CounterContract>
```

## hover on tx

Line 15, col 9 — `const tx = await makeUnsignedContractCall({`

**Hover:**

```ts
const tx: StacksTransactionWire
```

## completions inside functionName ''

Line 31, col 20 — `functionName: '',`

**Completions:**

- `add` _(string)_
- `decrement` _(string)_
- `increment` _(string)_

## completions inside contractName ''

Line 42, col 20 — `contractName: '',`

**Completions:**

- `counter` _(string)_

## hover on count

Line 63, col 11 — `const count = await fetchCallReadOnlyFunction({`

**Hover:**

```ts
const count: UIntCV
```

## Diagnostics

- **L31:5-17 _(12 chars)_** TS2322: Type '""' is not assignable to type 'PublicNames<CounterContract>'.
  underline: `functionName`
- **L42:5-17 _(12 chars)_** TS2322: Type '""' is not assignable to type '"counter"'.
  underline: `contractName`
- **L89:5-17 _(12 chars)_** TS2322: Type '"vault"' is not assignable to type '"counter"'.
  underline: `contractName`
- **L101:5-17 _(12 chars)_** TS2322: Type '"mint"' is not assignable to type 'PublicNames<CounterContract>'.
  underline: `functionName`
- **L113:20-32 _(12 chars)_** TS2322: Type 'string' is not assignable to type 'UIntCV'.
  underline: `'not a uint'`
- **L124:5-17 _(12 chars)_** TS2322: Type '[]' is not assignable to type 'AddArgs'.
    Source has 0 element(s) but target requires 1.
  underline: `functionArgs`
- **L134:5-17 _(12 chars)_** TS2322: Type '"get-count"' is not assignable to type 'PublicNames<CounterContract>'.
  underline: `functionName`
- **L145:5-17 _(12 chars)_** TS2322: Type '"add"' is not assignable to type 'ReadOnlyNames<CounterContract>'.
  underline: `functionName`
