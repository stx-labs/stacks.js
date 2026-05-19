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
