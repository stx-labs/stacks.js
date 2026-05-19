# DX snapshot — `error-shapes`

_Generated from `tests/dx-snapshots/fixtures/error-shapes.ts` by `tests/dx-snapshots/run.mjs`. Captures hover (`^?`), completions (`^|`), and signature help (`^!`) at the marked cursor positions — i.e. what the LSP would show a user at each point._

## Fixture

```ts
// Error-site footprint comparison across all approaches.
// Each block triggers the same kind of mistake and we observe WHERE the
// diagnostic lands (whole call vs. specific field vs. specific arg).
//
// Scenarios per approach:
//   E1. functionArgs: []      when [UIntCV] is required  (too few args)
//   E2. functionArgs: [1, 2]  when [UIntCV] is required  (too many args)
//   E3. functionArgs: ['s']   when [UIntCV] is required  (wrong type)
//   E4. functionName: 'mint'                              (unknown name)

import { makeUnsignedContractCallA } from '../../../src/approach-a';
import { makeUnsignedContractCallB } from '../../../src/approach-b';
import { contractA } from '../../../src/contract-a';
import { contractB } from '../../../src/contract-b';
import { contractC } from '../../../src/approach-c';
import { principal as principalD, typedCall, makeUnsignedContractCall as muccD } from '../../../src/approach-d';
import { principal as principalE, call as callE, bind as bindE } from '../../../src/approach-e';
import { createClient } from '../../../src/approach-f';
import type { Contracts } from '../../generated/types-only';
import { counterContract } from '../../generated/typed/counter';
import { Cl } from '@stacks/transactions';

declare const contract: `${string}.${string}`;
const PK = '...';

// ─────────────────────────────────────────────── Approach A
async function aE1() { // too few args
  await makeUnsignedContractCallA(counterContract, {
    contract, functionName: 'add', functionArgs: [],
    publicKey: PK,
  });
}
async function aE2() { // too many args
  await makeUnsignedContractCallA(counterContract, {
    contract, functionName: 'add', functionArgs: [1, 2],
    publicKey: PK,
  });
}
async function aE3() { // wrong type
  await makeUnsignedContractCallA(counterContract, {
    contract, functionName: 'add', functionArgs: ['s'],
    publicKey: PK,
  });
}
async function aE4() { // unknown function
  await makeUnsignedContractCallA(counterContract, {
    contract, functionName: 'mint', functionArgs: [Cl.uint(1)],
    publicKey: PK,
  });
}

// ─────────────────────────────────────────────── Approach B
async function bE1() {
  await makeUnsignedContractCallB(counterContract, {
    contract, functionName: 'add', functionArgs: [],
    publicKey: PK,
  });
}
async function bE2() {
  await makeUnsignedContractCallB(counterContract, {
    contract, functionName: 'add', functionArgs: [1, 2],
    publicKey: PK,
  });
}
async function bE3() {
  await makeUnsignedContractCallB(counterContract, {
    contract, functionName: 'add', functionArgs: ['s'],
    publicKey: PK,
  });
}
async function bE4() {
  await makeUnsignedContractCallB(counterContract, {
    contract, functionName: 'mint', functionArgs: [Cl.uint(1)],
    publicKey: PK,
  });
}

// ─────────────────────────────────────────────── Approach A wrapper
async function aWE1() {
  const c = contractA(counterContract, { contract, publicKey: PK });
  await c.makeUnsignedContractCall('add', []);
}
async function aWE3() {
  const c = contractA(counterContract, { contract, publicKey: PK });
  await c.makeUnsignedContractCall('add', ['s']);
}
async function aWE4() {
  const c = contractA(counterContract, { contract, publicKey: PK });
  await c.makeUnsignedContractCall('mint', [1]);
}

// ─────────────────────────────────────────────── Approach B wrapper
async function bWE1() {
  const c = contractB(counterContract, { contract, publicKey: PK });
  await c.makeUnsignedContractCall('add', []);
}
async function bWE3() {
  const c = contractB(counterContract, { contract, publicKey: PK });
  await c.makeUnsignedContractCall('add', ['s']);
}
async function bWE4() {
  const c = contractB(counterContract, { contract, publicKey: PK });
  await c.makeUnsignedContractCall('mint', [1]);
}

// ─────────────────────────────────────────────── Approach C (proxy)
async function cE1() {
  const c = contractC(counterContract, { contract, publicKey: PK });
  await c.add();
}
async function cE2() {
  const c = contractC(counterContract, { contract, publicKey: PK });
  await c.add(1, 2);
}
async function cE3() {
  const c = contractC(counterContract, { contract, publicKey: PK });
  await c.add('s');
}
async function cE4() {
  const c = contractC(counterContract, { contract, publicKey: PK });
  await c.mint(1);
}

// ─────────────────────────────────────────────── Approach D
async function dE1() {
  await muccD({ principal: principalD(counterContract, contract), functionName: 'add', functionArgs: [], publicKey: PK });
}
async function dE3() {
  await muccD({ principal: principalD(counterContract, contract), functionName: 'add', functionArgs: ['s'], publicKey: PK });
}
async function dE4() {
  await muccD({ principal: principalD(counterContract, contract), functionName: 'mint', functionArgs: [Cl.uint(1)], publicKey: PK });
}
async function dE1Splat() {
  await muccD({ ...typedCall(principalD(counterContract, contract), 'add', []), publicKey: PK });
}
async function dE3Splat() {
  await muccD({ ...typedCall(principalD(counterContract, contract), 'add', ['s']), publicKey: PK });
}

// ─────────────────────────────────────────────── Approach E
async function eE1() {
  await callE(principalE(counterContract, contract), 'add', {}, { publicKey: PK });
}
async function eE3() {
  await callE(principalE(counterContract, contract), 'add', { n: 's' }, { publicKey: PK });
}
async function eE4() {
  await callE(principalE(counterContract, contract), 'mint', {}, { publicKey: PK });
}
async function eBE1() {
  const c = bindE(principalE(counterContract, contract), { publicKey: PK });
  await c.add({});
}
async function eBE3() {
  const c = bindE(principalE(counterContract, contract), { publicKey: PK });
  await c.add({ n: 's' });
}
async function eBE4() {
  const c = bindE(principalE(counterContract, contract), { publicKey: PK });
  await c.mint({});
}

// ─────────────────────────────────────────────── Approach F
const stx = createClient<Contracts>({ publicKey: PK, network: 'testnet' });
async function fE1() {
  await stx.makeUnsignedContractCall({ contract, functionName: 'add', functionArgs: [] });
}
async function fE2() {
  await stx.makeUnsignedContractCall({ contract, functionName: 'add', functionArgs: [Cl.uint(1), Cl.uint(2)] });
}
async function fE3() {
  await stx.makeUnsignedContractCall({ contract, functionName: 'add', functionArgs: ['s' as unknown as never] });
}
async function fE4() {
  await stx.makeUnsignedContractCall({ contract, functionName: 'mint', functionArgs: [Cl.uint(1)] });
}
```

## Diagnostics

- **L29:36-48 _(12 chars)_** TS2322: Type '[]' is not assignable to type '[number | bigint | UIntCV]'.
    Source has 0 element(s) but target requires 1.
  underline: `functionArgs`
- **L35:36-48 _(12 chars)_** TS2322: Type '[number, number]' is not assignable to type '[number | bigint | UIntCV]'.
    Source has 2 element(s) but target allows only 1.
  underline: `functionArgs`
- **L41:51-54 _(3 chars)_** TS2322: Type 'string' is not assignable to type 'number | bigint | UIntCV'.
  underline: `'s'`
- **L47:15-27 _(12 chars)_** TS2322: Type '"mint"' is not assignable to type '"add" | "decrement" | "increment"'.
  underline: `functionName`
- **L54:52–L57:4** TS2345: Argument of type '{ contract: `${string}.${string}`; functionName: "add"; functionArgs: []; publicKey: string; }' is not assignable to parameter of type '{ contract: `${string}.${string}`; functionName: "add"; functionArgs: [number | bigint | UIntCV]; publicKey: string; } | { contract: `${string}.${string}`; functionName: "decrement"; functionArgs: []; publicKey: string; } | { ...; }'.
    Types of property 'functionArgs' are incompatible.
      Type '[]' is not assignable to type '[number | bigint | UIntCV]'.
        Source has 0 element(s) but target requires 1.
  underline: `{ ⏎     contract, functionName: 'add', functionArgs: [], ⏎     publicKey: PK, ⏎   }`
- **L61:36-48 _(12 chars)_** TS2322: Type '[number, number]' is not assignable to type '[number | bigint | UIntCV] | []'.
    Type '[number, number]' is not assignable to type '[number | bigint | UIntCV]'.
      Source has 2 element(s) but target allows only 1.
  underline: `functionArgs`
- **L67:51-54 _(3 chars)_** TS2322: Type 'string' is not assignable to type 'number | bigint | UIntCV | undefined'.
  underline: `'s'`
- **L73:15-27 _(12 chars)_** TS2322: Type '"mint"' is not assignable to type '"add" | "decrement" | "increment"'.
  underline: `functionName`
- **L81:43-45 _(2 chars)_** TS2345: Argument of type '[]' is not assignable to parameter of type '[number | bigint | UIntCV]'.
    Source has 0 element(s) but target requires 1.
  underline: `[]`
- **L85:44-47 _(3 chars)_** TS2322: Type 'string' is not assignable to type 'number | bigint | UIntCV'.
  underline: `'s'`
- **L89:36-42 _(6 chars)_** TS2345: Argument of type '"mint"' is not assignable to parameter of type '"add" | "decrement" | "increment"'.
  underline: `'mint'`
- **L95:43-45 _(2 chars)_** TS2345: Argument of type '[]' is not assignable to parameter of type '[number | bigint | UIntCV]'.
    Source has 0 element(s) but target requires 1.
  underline: `[]`
- **L99:44-47 _(3 chars)_** TS2322: Type 'string' is not assignable to type 'number | bigint | UIntCV'.
  underline: `'s'`
- **L103:36-42 _(6 chars)_** TS2345: Argument of type '"mint"' is not assignable to parameter of type '"add" | "decrement" | "increment"'.
  underline: `'mint'`
- **L109:11-14 _(3 chars)_** TS2554: Expected 1-2 arguments, but got 0.
  underline: `add`
- **L113:18-19 _(1 chars)_** TS2559: Type '2' has no properties in common with type 'Partial<Omit<UnsignedContractCallOptions, "functionName" | "functionArgs" | "contractAddress" | "contractName">>'.
  underline: `2`
- **L117:15-18 _(3 chars)_** TS2345: Argument of type 'string' is not assignable to parameter of type 'number | bigint | UIntCV'.
  underline: `'s'`
- **L121:11-15 _(4 chars)_** TS2339: Property 'mint' does not exist on type 'ProxyClient<{ readonly functions: readonly [{ readonly name: "add"; readonly access: "public"; readonly args: readonly [{ readonly name: "n"; readonly type: "uint128"; }]; readonly outputs: { readonly type: { readonly response: { readonly ok: "bool"; readonly error: "uint128"; }; }; }; }, { ...; }, { ...; }, { ...; ...'.
  underline: `mint`
- **L126:9-14 _(5 chars)_** TS2769: No overload matches this call.
    Overload 1 of 2, '(options: TypedCallOptionsD<{ readonly functions: readonly [{ readonly name: "add"; readonly access: "public"; readonly args: readonly [{ readonly name: "n"; readonly type: "uint128"; }]; readonly outputs: { readonly type: { readonly response: { readonly ok: "bool"; readonly error: "uint128"; }; }; }; }, { ...; }, { ...; }, { ...; }, { ...; }]; ... 5 more ...; readonly clarity_version: "Clarity4"; } & { ...; }, "add">): Promise<...>', gave the following error.
      Type '[]' is not assignable to type '[number | bigint | UIntCV]'.
        Source has 0 element(s) but target requires 1.
    Overload 2 of 2, '(options: UnsignedContractCallOptions | UnsignedMultiSigContractCallOptions): Promise<StacksTransactionWire>', gave the following error.
      Object literal may only specify known properties, and 'principal' does not exist in type 'UnsignedContractCallOptions | UnsignedMultiSigContractCallOptions'.
  underline: `muccD`
- **L129:103-106 _(3 chars)_** TS2769: No overload matches this call.
    Overload 1 of 2, '(options: TypedCallOptionsD<{ readonly functions: readonly [{ readonly name: "add"; readonly access: "public"; readonly args: readonly [{ readonly name: "n"; readonly type: "uint128"; }]; readonly outputs: { readonly type: { readonly response: { readonly ok: "bool"; readonly error: "uint128"; }; }; }; }, { ...; }, { ...; }, { ...; }, { ...; }]; ... 5 more ...; readonly clarity_version: "Clarity4"; } & { ...; }, "add">): Promise<...>', gave the following error.
      Type 'string' is not assignable to type 'number | bigint | UIntCV'.
    Overload 2 of 2, '(options: UnsignedContractCallOptions | UnsignedMultiSigContractCallOptions): Promise<StacksTransactionWire>', gave the following error.
      Type 'string' is not assignable to type 'ClarityValue'.
  underline: `'s'`
- **L132:9-14 _(5 chars)_** TS2769: No overload matches this call.
    Overload 1 of 2, '(options: TypedCallOptionsD<{ readonly functions: readonly [{ readonly name: "add"; readonly access: "public"; readonly args: readonly [{ readonly name: "n"; readonly type: "uint128"; }]; readonly outputs: { readonly type: { readonly response: { readonly ok: "bool"; readonly error: "uint128"; }; }; }; }, { ...; }, { ...; }, { ...; }, { ...; }]; ... 5 more ...; readonly clarity_version: "Clarity4"; } & { ...; }, "add" | ... 1 more ... | "increment">): Promise<...>', gave the following error.
      Type '"mint"' is not assignable to type '"add" | "decrement" | "increment"'.
    Overload 2 of 2, '(options: UnsignedContractCallOptions | UnsignedMultiSigContractCallOptions): Promise<StacksTransactionWire>', gave the following error.
      Object literal may only specify known properties, and 'principal' does not exist in type 'UnsignedContractCallOptions | UnsignedMultiSigContractCallOptions'.
  underline: `muccD`
- **L135:76-78 _(2 chars)_** TS2345: Argument of type '[]' is not assignable to parameter of type '[number | bigint | UIntCV]'.
    Source has 0 element(s) but target requires 1.
  underline: `[]`
- **L138:77-80 _(3 chars)_** TS2322: Type 'string' is not assignable to type 'number | bigint | UIntCV'.
  underline: `'s'`
- **L146:63-64 _(1 chars)_** TS2322: Type 'string' is not assignable to type 'never'.
  underline: `n`
- **L149:54-60 _(6 chars)_** TS2345: Argument of type '"mint"' is not assignable to parameter of type '"add" | "decrement" | "increment" | "getCount" | "getCountAtBlock"'.
  underline: `'mint'`
- **L153:15-17 _(2 chars)_** TS2345: Argument of type '{}' is not assignable to parameter of type '{ n: number | bigint | UIntCV; }'.
    Property 'n' is missing in type '{}' but required in type '{ n: number | bigint | UIntCV; }'.
  underline: `{}`
- **L157:17-18 _(1 chars)_** TS2322: Type 'string' is not assignable to type 'number | bigint | UIntCV'.
  underline: `n`
- **L161:11-15 _(4 chars)_** TS2339: Property 'mint' does not exist on type 'BoundClient<Principal<CounterContract>>'.
  underline: `mint`
- **L167:40-48 _(8 chars)_** TS2322: Type '`${string}.${string}`' is not assignable to type '`${string}.counter`'.
  underline: `contract`
- **L167:71-83 _(12 chars)_** TS2322: Type '[]' is not assignable to type '[UIntCV]'.
    Source has 0 element(s) but target requires 1.
  underline: `functionArgs`
- **L170:40-48 _(8 chars)_** TS2322: Type '`${string}.${string}`' is not assignable to type '`${string}.counter`'.
  underline: `contract`
- **L170:71-83 _(12 chars)_** TS2322: Type '[UIntCV, UIntCV]' is not assignable to type '[UIntCV]'.
    Source has 2 element(s) but target allows only 1.
  underline: `functionArgs`
- **L173:40-48 _(8 chars)_** TS2322: Type '`${string}.${string}`' is not assignable to type '`${string}.counter`'.
  underline: `contract`
- **L176:40-48 _(8 chars)_** TS2322: Type '`${string}.${string}`' is not assignable to type '`${string}.counter`'.
  underline: `contract`
- **L176:50-62 _(12 chars)_** TS2322: Type '"mint"' is not assignable to type 'FunctionKeysByAccess<Contracts, "counter", "public">'.
  underline: `functionName`
