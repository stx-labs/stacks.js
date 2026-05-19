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
