# DX snapshot — `approach-d`

_Generated from `tests/dx-snapshots/fixtures/approach-d.ts` by `tests/dx-snapshots/run.mjs`. Captures hover (`^?`), completions (`^|`), and signature help (`^!`) at the marked cursor positions — i.e. what the LSP would show a user at each point._

## Fixture

```ts
// Approach D — Branded Principal<T>, non-breaking with @stacks/transactions.
// Standard scenario: add(5), increment(), getCount().
import { principal, typedCall, typedReadOnlyCall } from '../../../src/approach-d';
import { makeUnsignedContractCall, fetchCallReadOnlyFunction } from '../../../src/approach-d';
import { counterContract } from '../../generated/typed/counter';
import { Cl } from '@stacks/transactions';

const PK = '02abcd';

// 1. Construction — branded principal value
const counter = principal(counterContract, 'ST1PQHQ.counter');
//    ^? hover on counter (the Principal<T>)

// 2. Splat path — typedCall into raw @stacks/transactions function
async function splat() {
  const tx = await makeUnsignedContractCall({
    ...typedCall(counter, 'add', [5]),
    publicKey: PK,
  });
  return tx;
  //     ^? hover on tx
}

// 3. Autocomplete the function name in typedCall
async function autocompleteFn() {
  typedCall(counter, '', []);
  //                  ^| completions inside typedCall second arg
}

// 4. Same-name wrapper path
async function wrapperPath() {
  const tx = await makeUnsignedContractCall({
    //  ^? hover on tx (wrapper return)
    principal: counter,
    functionName: 'add',
    functionArgs: [5],
    publicKey: PK,
  });
  return tx;
}

// 5. No-arg public — increment()
async function callIncrement() {
  await makeUnsignedContractCall({
    principal: counter,
    functionName: 'increment',
    functionArgs: [],
    publicKey: PK,
  });
}

// 6. Read-only — getCount()
async function callGetCount() {
  const count = await fetchCallReadOnlyFunction({
    //    ^? hover on count (read-only return)
    principal: counter,
    functionName: 'getCount',
    functionArgs: [],
    publicKey: PK,
  });
  return count;
}

// 7. Pass branded principal as typed app state
type Counter = typeof counter;
function fireIncrement(target: Counter) {
  //                   ^? hover on Counter param type
  return makeUnsignedContractCall({
    principal: target,
    functionName: 'increment',
    functionArgs: [],
    publicKey: PK,
  });
}

// 8. Error — wrong arg type
async function wrongArg() {
  await makeUnsignedContractCall({
    principal: counter,
    functionName: 'add',
    functionArgs: ['not a uint'],
    publicKey: PK,
  });
}

// 9. Error — wrong function name
async function wrongFn() {
  await makeUnsignedContractCall({
    principal: counter,
    functionName: 'mint',
    functionArgs: [Cl.uint(5)],
    publicKey: PK,
  });
}

// keep typedReadOnlyCall referenced so the import is reachable for hover probes
void typedReadOnlyCall;
void fireIncrement;
```

## hover on counter (the Principal<T>)

Line 11, col 7 — `const counter = principal(counterContract, 'ST1PQHQ.counter');`

**Hover:**

```ts
const counter: Principal<{
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

## hover on tx

Line 20, col 10 — `return tx;`

**Hover:**

```ts
const tx: StacksTransactionWire
```

## completions inside typedCall second arg

Line 26, col 23 — `typedCall(counter, '', []);`

**Completions:**

- `add` _(string)_
- `decrement` _(string)_
- `increment` _(string)_

## hover on tx (wrapper return)

Line 32, col 9 — `const tx = await makeUnsignedContractCall({`

**Hover:**

```ts
const tx: StacksTransactionWire
```

## hover on count (read-only return)

Line 54, col 11 — `const count = await fetchCallReadOnlyFunction({`

**Hover:**

```ts
const count: UIntCV
```

## hover on Counter param type

Line 66, col 24 — `function fireIncrement(target: Counter) {`

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

- **L26:22-24 _(2 chars)_** TS2345: Argument of type '""' is not assignable to parameter of type '"add" | "decrement" | "increment"'.
  underline: `''`
- **L81:20-32 _(12 chars)_** TS2769: No overload matches this call.
    Overload 1 of 2, '(options: TypedCallOptionsD<{ readonly functions: readonly [{ readonly name: "add"; readonly access: "public"; readonly args: readonly [{ readonly name: "n"; readonly type: "uint128"; }]; readonly outputs: { readonly type: { readonly response: { readonly ok: "bool"; readonly error: "uint128"; }; }; }; }, { ...; }, { ...; }, { ...; }, { ...; }]; ... 5 more ...; readonly clarity_version: "Clarity4"; } & { ...; }, "add">): Promise<...>', gave the following error.
      Type 'string' is not assignable to type 'number | bigint | UIntCV'.
    Overload 2 of 2, '(options: UnsignedContractCallOptions | UnsignedMultiSigContractCallOptions): Promise<StacksTransactionWire>', gave the following error.
      Type 'string' is not assignable to type 'ClarityValue'.
  underline: `'not a uint'`
- **L88:9-33 _(24 chars)_** TS2769: No overload matches this call.
    Overload 1 of 2, '(options: TypedCallOptionsD<{ readonly functions: readonly [{ readonly name: "add"; readonly access: "public"; readonly args: readonly [{ readonly name: "n"; readonly type: "uint128"; }]; readonly outputs: { readonly type: { readonly response: { readonly ok: "bool"; readonly error: "uint128"; }; }; }; }, { ...; }, { ...; }, { ...; }, { ...; }]; ... 5 more ...; readonly clarity_version: "Clarity4"; } & { ...; }, "add" | ... 1 more ... | "increment">): Promise<...>', gave the following error.
      Type '"mint"' is not assignable to type '"add" | "decrement" | "increment"'.
    Overload 2 of 2, '(options: UnsignedContractCallOptions | UnsignedMultiSigContractCallOptions): Promise<StacksTransactionWire>', gave the following error.
      Object literal may only specify known properties, and 'principal' does not exist in type 'UnsignedContractCallOptions | UnsignedMultiSigContractCallOptions'.
  underline: `makeUnsignedContractCall`
