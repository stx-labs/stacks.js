# DX snapshot — `approach-e`

_Generated from `tests/dx-snapshots/fixtures/approach-e.ts` by `tests/dx-snapshots/run.mjs`. Captures hover (`^?`), completions (`^|`), and signature help (`^!`) at the marked cursor positions — i.e. what the LSP would show a user at each point._

## Fixture

```ts
// Approach E — Branded Principal<T>, standalone API.
// Standard scenario: add(5), increment(), getCount().
import { principal, call, read, bind } from '../../../src/approach-e';
import type { Principal } from '../../../src/approach-e';
import { counterContract } from '../../generated/typed/counter';

const PK = '02abcd';

// 1. Construction — branded principal value
const counter = principal(counterContract, 'ST1PQHQ.counter');
//    ^? hover on counter (the Principal<T>)

// 2. Function-style: call() — public
async function callAdd() {
  const tx = await call(counter, 'add', { n: 5n }, { publicKey: PK });
  //    ^? hover on tx (public return)
  return tx;
}

// 3. Autocomplete the function name on call()
async function autocompleteFn() {
  await call(counter, '', {}, { publicKey: PK });
  //           ^| completions on call(counter, ''
}

// 4. No-arg public — increment()
async function callIncrement() {
  await call(counter, 'increment', {}, { publicKey: PK });
}

// 5. Read-only — read() / getCount()
async function callGetCount() {
  const count = await read(counter, 'getCount', {});
  //    ^? hover on count (read-only return)
  return count;
}

// 6. Proxy variant — bind() once, then call as methods
async function boundFlow() {
  const c = bind(counter, { publicKey: PK });
  //    ^? hover on c (bound proxy)

  await c.add({ n: 5n });
  //      ^| completions on c.

  await c.increment();
  const count = await c.getCount();
  //    ^? hover on count from bound proxy
  return count;
}

// 7. Pass branded principal as typed app state
function fireIncrement(target: Principal<typeof counterContract>) {
  //                   ^? hover on Principal type
  return call(target, 'increment', {}, { publicKey: PK });
}

// 8. Error — wrong arg type
async function wrongArg() {
  await call(counter, 'add', { n: 'not a uint' }, { publicKey: PK });
}

// 9. Error — wrong function name
async function wrongFn() {
  await call(counter, 'mint', {}, { publicKey: PK });
}

void fireIncrement;
```

## hover on counter (the Principal<T>)

Line 10, col 7 — `const counter = principal(counterContract, 'ST1PQHQ.counter');`

**Hover:**

```ts
const counter: Principal<CounterContract>
```

## hover on tx (public return)

Line 15, col 9 — `const tx = await call(counter, 'add', { n: 5n }, { publicKey: PK });`

**Hover:**

```ts
const tx: StacksTransactionWire
```

## completions on call(counter, ''

Line 22, col 16 — `await call(counter, '', {}, { publicKey: PK });`

**Completions:**

- `arguments` _(local var)_
- `autocompleteFn` _(function)_
- `bind` _(alias)_
- `boundFlow` _(function)_
- `call` _(alias)_
- `callAdd` _(function)_
- `callGetCount` _(function)_
- `callIncrement` _(function)_
- `counter` _(const)_
- `counterContract` _(alias)_
- `fireIncrement` _(function)_
- `PK` _(const)_
- `principal` _(alias)_
- `read` _(alias)_
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
- `alert` _(function)_
_…989 more_

## hover on count (read-only return)

Line 33, col 9 — `const count = await read(counter, 'getCount', {});`

**Hover:**

```ts
const count: UIntCV | ResponseOkCV<BooleanCV> | ResponseErrorCV<UIntCV> | ResponseOkCV<BooleanCV> | ResponseOkCV<BooleanCV> | ResponseOkCV<UIntCV>
```

## hover on c (bound proxy)

Line 40, col 9 — `const c = bind(counter, { publicKey: PK });`

**Hover:**

```ts
const c: BoundClient<Principal<CounterContract>>
```

## completions on c.

Line 43, col 11 — `await c.add({ n: 5n });`

**Completions:**

- `add` _(property)_
- `decrement` _(property)_
- `getCount` _(property)_
- `getCountAtBlock` _(property)_
- `increment` _(property)_

## hover on count from bound proxy

Line 47, col 9 — `const count = await c.getCount();`

**Hover:**

```ts
const count: UIntCV | StacksTransactionWire
```

## hover on Principal type

Line 53, col 24 — `function fireIncrement(target: Principal<typeof counterContract>) {`

**Hover:**

```ts
(parameter) target: Principal<{
    readonly functions: readonly [{
        readonly name: "add";
        readonly access: "public";
        readonly args: readonly [{
            readonly name: "n";
            readonly type: "uint128";
        }];
        readonly outputs: {
            readonly type: {
                readonly response: {
                    readonly ok: "bool";
                    readonly error: "uint128";
                };
            };
        };
    }, {
        readonly name: "decrement";
        readonly access: "public";
        readonly args: readonly [];
        readonly outputs: {
            readonly type: {
                readonly response: {
                    readonly ok: "bool";
                    readonly error: "uint128";
                };
            };
        };
    }, {
        readonly name: "increment";
        readonly access: "public";
        readonly args: readonly [];
        readonly outputs: {
            readonly type: {
                readonly response: {
                    readonly ok: "bool";
                    readonly error: "uint128";
                };
            };
        };
    }, {
        ...;
    }, {
        ...;
    }];
    ... 5 more ...;
    readonly clarity_version: "Clarity4";
} & {
    ...;
}>
```

## Diagnostics

- **L22:23-25 _(2 chars)_** TS2345: Argument of type '""' is not assignable to parameter of type '"add" | "decrement" | "increment" | "getCount" | "getCountAtBlock"'.
  underline: `''`
- **L46:11-20 _(9 chars)_** TS2554: Expected 1-2 arguments, but got 0.
  underline: `increment`
- **L47:25-33 _(8 chars)_** TS2554: Expected 1-2 arguments, but got 0.
  underline: `getCount`
- **L53:42-64 _(22 chars)_** TS2344: Type '{ readonly functions: readonly [{ readonly name: "add"; readonly access: "public"; readonly args: readonly [{ readonly name: "n"; readonly type: "uint128"; }]; readonly outputs: { readonly type: { readonly response: { readonly ok: "bool"; readonly error: "uint128"; }; }; }; }, { ...; }, { ...; }, { ...; }, { ...; }]...' does not satisfy the constraint 'TypegenContractInterface'.
    Types of property 'functions' are incompatible.
      Type 'readonly [{ readonly name: "add"; readonly access: "public"; readonly args: readonly [{ readonly name: "n"; readonly type: "uint128"; }]; readonly outputs: { readonly type: { readonly response: { readonly ok: "bool"; readonly error: "uint128"; }; }; }; }, { ...; }, { ...; }, { ...; }, { ...; }]' is not assignable to type 'Record<string, { return: ClarityValue; }>'.
        Index signature for type 'string' is missing in type 'readonly [{ readonly name: "add"; readonly access: "public"; readonly args: readonly [{ readonly name: "n"; readonly type: "uint128"; }]; readonly outputs: { readonly type: { readonly response: { readonly ok: "bool"; readonly error: "uint128"; }; }; }; }, { ...; }, { ...; }, { ...; }, { ...; }]'.
  underline: `typeof counterContract`
- **L55:15-21 _(6 chars)_** TS2345: Argument of type 'Principal<{ readonly functions: readonly [{ readonly name: "add"; readonly access: "public"; readonly args: readonly [{ readonly name: "n"; readonly type: "uint128"; }]; readonly outputs: { readonly type: { readonly response: { readonly ok: "bool"; readonly error: "uint128"; }; }; }; }, { ...; }, { ...; }, { ...; },...' is not assignable to parameter of type 'Principal<TypegenContractInterface>'.
    Type 'Principal<{ readonly functions: readonly [{ readonly name: "add"; readonly access: "public"; readonly args: readonly [{ readonly name: "n"; readonly type: "uint128"; }]; readonly outputs: { readonly type: { readonly response: { readonly ok: "bool"; readonly error: "uint128"; }; }; }; }, { ...; }, { ...; }, { ...; },...' is not assignable to type '{ readonly [__principalBrand]: TypegenContractInterface; }'.
      The types of '[__principalBrand].functions' are incompatible between these types.
        Type 'readonly [{ readonly name: "add"; readonly access: "public"; readonly args: readonly [{ readonly name: "n"; readonly type: "uint128"; }]; readonly outputs: { readonly type: { readonly response: { readonly ok: "bool"; readonly error: "uint128"; }; }; }; }, { ...; }, { ...; }, { ...; }, { ...; }]' is not assignable to type 'Record<string, { return: ClarityValue; }>'.
          Index signature for type 'string' is missing in type 'readonly [{ readonly name: "add"; readonly access: "public"; readonly args: readonly [{ readonly name: "n"; readonly type: "uint128"; }]; readonly outputs: { readonly type: { readonly response: { readonly ok: "bool"; readonly error: "uint128"; }; }; }; }, { ...; }, { ...; }, { ...; }, { ...; }]'.
  underline: `target`
- **L60:32-33 _(1 chars)_** TS2322: Type 'string' is not assignable to type 'never'.
  underline: `n`
- **L65:23-29 _(6 chars)_** TS2345: Argument of type '"mint"' is not assignable to parameter of type '"add" | "decrement" | "increment" | "getCount" | "getCountAtBlock"'.
  underline: `'mint'`
