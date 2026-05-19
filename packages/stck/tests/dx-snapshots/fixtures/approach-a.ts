// Approach A — function-style + bundle as first arg.
// Standard scenario: add(5), increment(), getCount().
import { makeUnsignedContractCallA } from '../../../src/approach-a';
import { contractA } from '../../../src/contract-a';
import { counterContract } from '../../generated/typed/counter';
import { Cl } from '@stacks/transactions';

const PK = '02abcd';
const ADDR = 'ST1PQHQ.counter' as const;

// 1. Hover on the imported bundle — what shape does the user see?
const bundle = counterContract;
//    ^? hover on bundle

// 2. Function-style: add(5)
async function callAdd() {
  const tx = await makeUnsignedContractCallA(counterContract, {
    //  ^? hover on tx
    contract: ADDR,
    functionName: 'add',
    functionArgs: [Cl.uint(5)],
    publicKey: PK,
  });
  return tx;
}

// 3. Autocomplete functionName (empty string inside the literal)
async function autocompleteFn() {
  await makeUnsignedContractCallA(counterContract, {
    contract: ADDR,
    functionName: '',
    //             ^| completions inside functionName ''
    functionArgs: [],
    publicKey: PK,
  });
}

// 4. Wrapper variant — contractA + dot-completions on the handle
async function wrapperFlow() {
  const counter = contractA(counterContract, { contract: ADDR, publicKey: PK });
  //    ^? hover on counter (the wrapper)

  await counter.makeUnsignedContractCall('add', [5]);
  //      ^| completions on counter.

  await counter.makeUnsignedContractCall('increment', []);

  const count = await counter.fetchCallReadOnlyFunction('getCount', []);
  //    ^? hover on count (read-only return)
  return count;
}

// 5. Error case — wrong arg type
async function wrongArg() {
  await makeUnsignedContractCallA(counterContract, {
    contract: ADDR,
    functionName: 'add',
    functionArgs: ['not a uint'],
    publicKey: PK,
  });
}

// 6. Error case — wrong function name
async function wrongFn() {
  await makeUnsignedContractCallA(counterContract, {
    contract: ADDR,
    functionName: 'mint',
    functionArgs: [Cl.uint(5)],
    publicKey: PK,
  });
}
