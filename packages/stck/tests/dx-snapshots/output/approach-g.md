# DX snapshot — `approach-g`

_Generated from `tests/dx-snapshots/fixtures/approach-g.ts` by `tests/dx-snapshots/run.mjs`. Captures hover (`^?`), completions (`^|`), and signature help (`^!`) at the marked cursor positions — i.e. what the LSP would show a user at each point._

## Fixture

```ts
// Approach G — minimal type-only branded principal.
// Variation of E: brand carries a TYPE only (no ABI value/registry).
// Reuses Approach F's types-only generated artifact (positional CV tuples).
import { principal, call, read } from '../../../src/approach-g';
import type { Principal } from '../../../src/approach-g';
import type { CounterContract } from '../../generated/types-only';
import { Cl } from '@stacks/transactions';

const PK = '02abcd';

// 1. Construction — type-only generic, identity at runtime
const counter = principal<CounterContract>('ST1PQHQ.counter');
//    ^? hover on counter

// 2. Public call — add(5)
async function callAdd() {
  const tx = await call(counter, 'add', [Cl.uint(5)], { publicKey: PK });
  //    ^? hover on tx
  return tx;
}

// 3. Function-name autocomplete on call()
async function autocompleteFn() {
  await call(counter, '', [], { publicKey: PK });
  //           ^| completions on call(counter, ''
}

// 4. No-arg public — increment()
async function callIncrement() {
  await call(counter, 'increment', [], { publicKey: PK });
}

// 5. Read-only — get-count
async function callGetCount() {
  const count = await read(counter, 'get-count', []);
  //    ^? hover on count
  return count;
}

// 6. Function-name autocomplete on read()
async function autocompleteRead() {
  await read(counter, '', []);
  //           ^| completions on read(counter, ''
}

// 7. Pass branded principal as typed state
function fireIncrement(target: Principal<CounterContract>) {
  //                   ^? hover on Principal<CounterContract>
  return call(target, 'increment', [], { publicKey: PK });
}

// 8. Error — wrong arg type
async function wrongArg() {
  await call(counter, 'add', ['not a uint'], { publicKey: PK });
}

// 9. Error — wrong function name (public-only filter)
async function wrongFn() {
  await call(counter, 'mint', [Cl.uint(5)], { publicKey: PK });
}

// 10. Error — calling read-only via call() (access filter)
async function readViaCall() {
  await call(counter, 'get-count', [], { publicKey: PK });
}

// 11. Error — calling public via read() (access filter)
async function publicViaRead() {
  await read(counter, 'add', [Cl.uint(5)]);
}

void fireIncrement;
```

## hover on counter

Line 12, col 7 — `const counter = principal<CounterContract>('ST1PQHQ.counter');`

**Hover:**

```ts
const counter: Principal<CounterContract>
```

## hover on tx

Line 17, col 9 — `const tx = await call(counter, 'add', [Cl.uint(5)], { publicKey: PK });`

**Hover:**

```ts
const tx: StacksTransactionWire
```

## completions on call(counter, ''

Line 24, col 16 — `await call(counter, '', [], { publicKey: PK });`

**Completions:**

- `arguments` _(local var)_
- `autocompleteFn` _(function)_
- `autocompleteRead` _(function)_
- `call` _(alias)_
- `callAdd` _(function)_
- `callGetCount` _(function)_
- `callIncrement` _(function)_
- `Cl` _(alias)_
- `counter` _(const)_
- `fireIncrement` _(function)_
- `PK` _(const)_
- `principal` _(alias)_
- `publicViaRead` _(function)_
- `read` _(alias)_
- `readViaCall` _(function)_
- `wrongArg` _(function)_
- `wrongFn` _(function)_
- `_` _(alias)_
- `AbortController` _(var)_
- `AbortSignal` _(var)_
- `AbstractRange` _(var)_
- `addEventListener` _(function)_
- `afterAll` _(var)_
- `afterEach` _(var)_
- `AggregateError` _(var)_
_…990 more_

## hover on count

Line 35, col 9 — `const count = await read(counter, 'get-count', []);`

**Hover:**

```ts
const count: UIntCV
```

## completions on read(counter, ''

Line 42, col 16 — `await read(counter, '', []);`

**Completions:**

- `arguments` _(local var)_
- `autocompleteFn` _(function)_
- `autocompleteRead` _(function)_
- `call` _(alias)_
- `callAdd` _(function)_
- `callGetCount` _(function)_
- `callIncrement` _(function)_
- `Cl` _(alias)_
- `counter` _(const)_
- `fireIncrement` _(function)_
- `PK` _(const)_
- `principal` _(alias)_
- `publicViaRead` _(function)_
- `read` _(alias)_
- `readViaCall` _(function)_
- `wrongArg` _(function)_
- `wrongFn` _(function)_
- `_` _(alias)_
- `AbortController` _(var)_
- `AbortSignal` _(var)_
- `AbstractRange` _(var)_
- `addEventListener` _(function)_
- `afterAll` _(var)_
- `afterEach` _(var)_
- `AggregateError` _(var)_
_…990 more_

## hover on Principal<CounterContract>

Line 47, col 24 — `function fireIncrement(target: Principal<CounterContract>) {`

**Hover:**

```ts
(parameter) target: Principal<CounterContract>
```

## Diagnostics

- **L24:23-25 _(2 chars)_** TS2345: Argument of type '""' is not assignable to parameter of type 'FunctionNames<Principal<CounterContract>, "public">'.
  underline: `''`
- **L42:23-25 _(2 chars)_** TS2345: Argument of type '""' is not assignable to parameter of type 'FunctionNames<Principal<CounterContract>, "read_only">'.
  underline: `''`
- **L54:31-43 _(12 chars)_** TS2322: Type 'string' is not assignable to type 'UIntCV'.
  underline: `'not a uint'`
- **L59:23-29 _(6 chars)_** TS2345: Argument of type '"mint"' is not assignable to parameter of type 'FunctionNames<Principal<CounterContract>, "public">'.
  underline: `'mint'`
- **L64:23-34 _(11 chars)_** TS2345: Argument of type '"get-count"' is not assignable to parameter of type 'FunctionNames<Principal<CounterContract>, "public">'.
  underline: `'get-count'`
- **L69:23-28 _(5 chars)_** TS2345: Argument of type '"add"' is not assignable to parameter of type 'FunctionNames<Principal<CounterContract>, "read_only">'.
  underline: `'add'`
