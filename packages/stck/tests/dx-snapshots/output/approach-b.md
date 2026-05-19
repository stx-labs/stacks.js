# DX snapshot — `approach-b`

_Generated from `tests/dx-snapshots/fixtures/approach-b.ts` by `tests/dx-snapshots/run.mjs`. Captures hover (`^?`), completions (`^|`), and signature help (`^!`) at the marked cursor positions — i.e. what the LSP would show a user at each point._

## Fixture

```ts
// Approach B — function-style + ABI-as-const, types via conditional machinery.
// Standard scenario: add(5), increment(), getCount().
import { makeUnsignedContractCallB } from '../../../src/approach-b';
import { contractB } from '../../../src/contract-b';
import { counterContract } from '../../generated/typed/counter';
import { Cl } from '@stacks/transactions';

const PK = '02abcd';
const ADDR = 'ST1PQHQ.counter' as const;

// 1. Hover on the imported bundle
const bundle = counterContract;
//    ^? hover on bundle

// 2. Function-style: add(5) — kebab-case names per B's convention
async function callAdd() {
  const tx = await makeUnsignedContractCallB(counterContract, {
    //  ^? hover on tx
    contract: ADDR,
    functionName: 'add',
    functionArgs: [Cl.uint(5)],
    publicKey: PK,
  });
  return tx;
}

// 3. Autocomplete functionName
async function autocompleteFn() {
  await makeUnsignedContractCallB(counterContract, {
    contract: ADDR,
    functionName: '',
    //             ^| completions inside functionName ''
    functionArgs: [],
    publicKey: PK,
  });
}

// 4. Wrapper variant — contractB
async function wrapperFlow() {
  const counter = contractB(counterContract, { contract: ADDR, publicKey: PK });
  //    ^? hover on counter (the wrapper)

  await counter.makeUnsignedContractCall('add', [5]);
  //      ^| completions on counter.

  await counter.makeUnsignedContractCall('increment', []);

  const count = await counter.fetchCallReadOnlyFunction('get-count', []);
  //    ^? hover on count (kebab-case read-only)
  return count;
}

// 5. Error case — wrong arg type
async function wrongArg() {
  await makeUnsignedContractCallB(counterContract, {
    contract: ADDR,
    functionName: 'add',
    functionArgs: ['not a uint'],
    publicKey: PK,
  });
}

// 6. Error case — wrong function name
async function wrongFn() {
  await makeUnsignedContractCallB(counterContract, {
    contract: ADDR,
    functionName: 'mint',
    functionArgs: [Cl.uint(5)],
    publicKey: PK,
  });
}
```

## hover on bundle

Line 12, col 7 — `const bundle = counterContract;`

**Hover:**

```ts
const bundle: {
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
}
```

## hover on tx

Line 17, col 9 — `const tx = await makeUnsignedContractCallB(counterContract, {`

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

## hover on counter (the wrapper)

Line 40, col 9 — `const counter = contractB(counterContract, { contract: ADDR, publicKey: PK });`

**Hover:**

```ts
const counter: ContractClientB<{
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

## completions on counter.

Line 43, col 11 — `await counter.makeUnsignedContractCall('add', [5]);`

**Completions:**

- `ADDR` _(const)_
- `arguments` _(local var)_
- `autocompleteFn` _(function)_
- `bundle` _(const)_
- `callAdd` _(function)_
- `Cl` _(alias)_
- `contractB` _(alias)_
- `count` _(const)_
- `counter` _(const)_
- `counterContract` _(alias)_
- `makeUnsignedContractCallB` _(alias)_
- `PK` _(const)_
- `wrapperFlow` _(function)_
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
- `AnalyserNode` _(var)_
_…988 more_

## hover on count (kebab-case read-only)

Line 48, col 9 — `const count = await counter.fetchCallReadOnlyFunction('get-count', []);`

**Hover:**

```ts
const count: UIntCV
```

## Diagnostics

- **L31:5-17 _(12 chars)_** TS2322: Type '""' is not assignable to type '"add" | "decrement" | "increment"'.
  underline: `functionName`
- **L58:20-32 _(12 chars)_** TS2322: Type 'string' is not assignable to type 'number | bigint | UIntCV | undefined'.
  underline: `'not a uint'`
- **L67:5-17 _(12 chars)_** TS2322: Type '"mint"' is not assignable to type '"add" | "decrement" | "increment"'.
  underline: `functionName`
