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
