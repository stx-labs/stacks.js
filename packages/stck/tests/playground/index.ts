import { Cl, UIntCV } from '@stacks/transactions';
import { counterContract } from '../generated/typed';

const contract = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.counter';

// approach A — function-style
import { makeUnsignedContractCallA } from '@stacks/stck';

await makeUnsignedContractCallA(counterContract, {
  contract,
  functionName: 'increment',
  functionArgs: [],
  publicKey: '',
});

await makeUnsignedContractCallA(counterContract, {
  contract,
  functionName: 'add',
  functionArgs: [],
  publicKey: '',
});

// approach B — function-style
import { makeUnsignedContractCallB } from '@stacks/stck';

await makeUnsignedContractCallB(counterContract, {
  contract,
  functionName: 'increment',
  functionArgs: [],
  publicKey: '...',
});

await makeUnsignedContractCallB(counterContract, {
  contract,
  functionName: 'add',
  functionArgs: [],
  publicKey: '...',
});

// contract wrapper — approach A
import { contractA } from '@stacks/stck';

const counterA = contractA(counterContract, {
  contract,
  publicKey: '',
  network: 'testnet',
  // senderAddress: 'ST2...',
});

{
  a: Cl.tuple({ a: 1n }),
  a: 1n,
  a: Cl.tuple(1),
  a: Cl.tuple(1),
  a: Cl.tuple(1),
});

await counterA.fetchCallReadOnlyFunction('getCountAtBlock', [2n]);

// await counterA.makeUnsignedContractCall('add');
await counterA.makeUnsignedContractCall('increment', [], {});
await counterA.makeUnsignedContractCall('add', [5]);
await counterA.makeUnsignedContractCall('add', [5n]);
await counterA.makeUnsignedContractCall('add', [Cl.uint(5)]);
await counterA.makeUnsignedContractCall('add', [5], { fee: 1000n, nonce: 7n });

// read-only
await counterA.fetchCallReadOnlyFunction('getCount', []);
await counterA.fetchCallReadOnlyFunction('getCount', [], { senderAddress: 'ST2...' });

// contract wrapper — approach B
import { contractB } from '@stacks/stck';

const counterB = contractB(counterContract, {
  contract,
  publicKey: '',
  network: 'testnet',
});

await counterB.makeUnsignedContractCall('increment', []);
await counterB.makeUnsignedContractCall('add', [5]);
await counterB.makeUnsignedContractCall('add', [5n]);
await counterB.makeUnsignedContractCall('add', [Cl.uint(5)]);
await counterB.makeUnsignedContractCall('add', [5], { fee: 1000n, nonce: 7n });

// read-only
await counterB.fetchCallReadOnlyFunction('get-count', []);
await counterB.fetchCallReadOnlyFunction('get-count', [], { senderAddress: 'ST2...' });

// approach C — Proxy-based direct method dispatch
import { contractC } from '../../src/approach-c';

const counterC = contractC(counterContract, {
  contract,
  publicKey: '',
  network: 'testnet',
});

// public — feels like calling a real object
await counterC.increment();
await counterC.add(5);
await counterC.add(5n);
await counterC.add(Cl.uint(5));
await counterC.add(5, { fee: 1000n, nonce: 7n });

// read-only — same dispatch, returns the decoded CV (not an unsigned tx)
await counterC.getCount();
await counterC.getCount({ senderAddress: 'ST2...' });
await counterC.getCountAtBlock(100n);

// approach F — createClient<Contracts> (openapi-fetch-style; types-only codegen)
import { createClient } from '@stacks/stck';
// NOTE: pure `import type` — the generated file has no runtime value.
import type { Contracts } from '../generated/types-only';

const stx = createClient<Contracts>({ publicKey: '', network: 'testnet' });

// top-level form — every call carries `contract` + `functionName`
await stx.makeUnsignedContractCall({
  contract,
  functionName: 'add',
  functionArgs: [Cl.uint(5)],
});

await stx.makeUnsignedContractCall({
  contract,
  functionName: 'increment',
  functionArgs: [],
});

await stx.fetchCallReadOnlyFunction({
  contract,
  functionName: 'get-count',
  functionArgs: [],
});

// curried-handle form — narrower call sites
const counterF = stx.contract<'counter'>(contract);
await counterF.makeUnsignedContractCall('add', [Cl.uint(5)]);
await counterF.fetchCallReadOnlyFunction('get-count', []);
await counterF.fetchCallReadOnlyFunction('get-count', [], { senderAddress: 'ST2...' });

// approach D — branded Principal<T> driving the EXISTING @stacks/transactions API
import { makeUnsignedContractCall as makeUnsignedContractCallRaw } from '@stacks/transactions';
import { principal, typedCall, typedReadOnlyCall } from '../../src/approach-d';
import { makeUnsignedContractCallD, fetchCallReadOnlyFunctionD } from '@stacks/stck';

const counterD = principal(counterContract, 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.counter');

// Path 1: splat typedCall into the REAL @stacks/transactions function — no wrapper.
// `counterD` itself is a string at runtime, so it flows wherever a string is expected.
await makeUnsignedContractCallRaw({
  ...typedCall(counterD, 'add', [5]),
  publicKey: '',
});
await makeUnsignedContractCallRaw({
  ...typedCall(counterD, 'increment', []),
  publicKey: '',
});

// Path 2: same-name re-export — adds a typed `{ principal, ... }` overload while
// keeping the raw shape compatible.
await makeUnsignedContractCallD({
  principal: counterD,
  functionName: 'add',
  functionArgs: [5],
  publicKey: '',
});

// Read-only — same two paths
typedReadOnlyCall(counterD, 'getCount', []);
await fetchCallReadOnlyFunctionD({
  principal: counterD,
  functionName: 'getCount',
  functionArgs: [],
  publicKey: '',
});

// approach E — branded principal, standalone (named-record args)
import {
  principal as principalE,
  call as callE,
  read as readE,
  bind as bindE,
  definePrincipal,
} from '../../src/approach-e';
import type { Principal as PrincipalE } from '../../src/approach-e';

// (i) primary direction — bundle + address → branded principal.
// The variable IS a `string` carrying CounterContract as a phantom type. Pass
// it through your app like any data; the typed interface rides along.
const counterE = principalE(counterContract, contract);
//    typeof counterE: Principal<CounterContract>

// Public call — function-style helper. Args are a named record (matches the
// generated `AddArgs = { n: UIntCV }` shape from clarinet typegen).
await callE(counterE, 'increment', {}, { publicKey: '' });
await callE(counterE, 'add', { n: 5 }, { publicKey: '' });
await callE(counterE, 'add', { n: 5n }, { publicKey: '' });
await callE(counterE, 'add', { n: Cl.uint(5) }, { publicKey: '' });
await callE(counterE, 'add', { n: 5 }, { publicKey: '', fee: 1000n, nonce: 7n });

// Read-only — narrowed CV return type per the interface.
await readE(counterE, 'getCount', {}, { publicKey: '' });
await readE(counterE, 'getCount', {}, { senderAddress: 'ST2...' });
await readE(counterE, 'getCountAtBlock', { block: 100n }, { publicKey: '' });

// (ii) per-contract constructor — codegen can ship this so callers skip the
// bundle import and the generic.
const counterPrincipal = definePrincipal(counterContract);
const counter2 = counterPrincipal(contract);
await callE(counter2, 'increment', {}, { publicKey: '' });

// Bound proxy variant — methods named after the contract's functions.
const counterEbound = bindE(counterE, { publicKey: '', network: 'testnet' });
await counterEbound.add({ n: 5 });
await counterEbound.increment({});

// Passing the branded principal through your codebase preserves the type.
// `addCounter` ONLY accepts a principal branded with CounterContract — any other
// principal (say a token contract) would be a type error at the call site.
async function addCounter(
  target: PrincipalE<typeof counterE extends PrincipalE<infer T> ? T : never>,
  n: number
) {
  return callE(target, 'add', { n }, { publicKey: '' });
}
await addCounter(counterE, 7);
