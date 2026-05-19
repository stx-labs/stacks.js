# DX snapshot — `approach-c`

_Generated from `tests/dx-snapshots/fixtures/approach-c.ts` by `tests/dx-snapshots/run.mjs`. Captures hover (`^?`), completions (`^|`), and signature help (`^!`) at the marked cursor positions — i.e. what the LSP would show a user at each point._

## Fixture

```ts
// Approach C — Proxy-based direct method dispatch.
// Standard scenario: add(5), increment(), getCount().
import { contractC } from '../../../src/approach-c';
import { counterContract } from '../../generated/typed/counter';

const PK = '02abcd';
const ADDR = 'ST1PQHQ.counter' as const;

// 1. Construction — handle is the contract
async function construct() {
  const counter = contractC(counterContract, { contract: ADDR, publicKey: PK });
  //    ^? hover on counter (the proxy)
  return counter;
}

// 2. Dot-completions on the handle
async function methodAutocomplete() {
  const counter = contractC(counterContract, { contract: ADDR, publicKey: PK });
  counter.add(5n);
  //      ^| completions on counter.
}

// 3. Public call — direct method
async function callAdd() {
  const counter = contractC(counterContract, { contract: ADDR, publicKey: PK });
  const tx = await counter.add(5n);
  //    ^? hover on tx (public method return)
  return tx;
}

// 4. No-arg public — increment()
async function callIncrement() {
  const counter = contractC(counterContract, { contract: ADDR, publicKey: PK });
  await counter.increment();
}

// 5. Read-only — getCount()
async function callGetCount() {
  const counter = contractC(counterContract, { contract: ADDR, publicKey: PK });
  const count = await counter.getCount();
  //    ^? hover on count (read-only return)
  return count;
}

// 6. Signature help inside the method
async function sigHelp() {
  const counter = contractC(counterContract, { contract: ADDR, publicKey: PK });
  counter.add(
  //         ^! signature help inside counter.add(...)
    5n
  );
}

// 7. Error — wrong arg type
async function wrongArg() {
  const counter = contractC(counterContract, { contract: ADDR, publicKey: PK });
  await counter.add('not a uint');
}

// 8. Error — wrong method name
async function wrongMethod() {
  const counter = contractC(counterContract, { contract: ADDR, publicKey: PK });
  await counter.mint(5n);
}
```

## hover on counter (the proxy)

Line 11, col 9 — `const counter = contractC(counterContract, { contract: ADDR, publicKey: PK });`

**Hover:**

```ts
const counter: ProxyClient<{
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

Line 19, col 11 — `counter.add(5n);`

**Completions:**

- `add` _(property)_
- `decrement` _(property)_
- `getCount` _(property)_
- `getCountAtBlock` _(property)_
- `increment` _(property)_

## hover on tx (public method return)

Line 26, col 9 — `const tx = await counter.add(5n);`

**Hover:**

```ts
const tx: StacksTransactionWire
```

## hover on count (read-only return)

Line 40, col 9 — `const count = await counter.getCount();`

**Hover:**

```ts
const count: UIntCV
```

## signature help inside counter.add(...)

Line 48, col 14 — `counter.add(`

**Signature help:**

_(no signature help)_

## Diagnostics

- **L57:21-33 _(12 chars)_** TS2345: Argument of type 'string' is not assignable to parameter of type 'number | bigint | UIntCV'.
  underline: `'not a uint'`
- **L63:17-21 _(4 chars)_** TS2339: Property 'mint' does not exist on type 'ProxyClient<{ readonly functions: readonly [{ readonly name: "add"; readonly access: "public"; readonly args: readonly [{ readonly name: "n"; readonly type: "uint128"; }]; readonly outputs: { readonly type: { readonly response: { readonly ok: "bool"; readonly error: "uint128"; }; }; }; }, { ...; }, { ...; }, { ...; ...'.
  underline: `mint`
