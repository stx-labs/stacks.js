// Approach H — same-name overloads of @stacks/transactions, branded on
// contractAddress. Same call shape, same function name. No new helpers.
import { makeUnsignedContractCall, fetchCallReadOnlyFunction } from '../../../src/approach-h';
import { counterAddress } from '../../generated/branded-address/counter';
import { Cl } from '@stacks/transactions';

const PK = '02abcd';

// 1. Construction — branded address
const addr = counterAddress('ST1PQHQ');
//    ^? hover on addr

// 2. Public call — IDENTICAL field shape to raw @stacks/transactions
async function callAdd() {
  const tx = await makeUnsignedContractCall({
    //  ^? hover on tx
    contractAddress: addr,
    contractName: 'counter',
    functionName: 'add',
    functionArgs: [Cl.uint(5)],
    publicKey: PK,
  });
  return tx;
}

// 3. Autocomplete functionName
async function autocompleteFn() {
  await makeUnsignedContractCall({
    contractAddress: addr,
    contractName: 'counter',
    functionName: '',
    //             ^| completions inside functionName ''
    functionArgs: [],
    publicKey: PK,
  });
}

// 4. Autocomplete contractName
async function autocompleteContractName() {
  await makeUnsignedContractCall({
    contractAddress: addr,
    contractName: '',
    //             ^| completions inside contractName ''
    functionName: 'add',
    functionArgs: [Cl.uint(5)],
    publicKey: PK,
  });
}

// 5. No-arg public — increment
async function callIncrement() {
  await makeUnsignedContractCall({
    contractAddress: addr,
    contractName: 'counter',
    functionName: 'increment',
    functionArgs: [],
    publicKey: PK,
  });
}

// 6. Read-only — get-count, narrows return to UIntCV
async function callGetCount() {
  const count = await fetchCallReadOnlyFunction({
    //    ^? hover on count
    contractAddress: addr,
    contractName: 'counter',
    functionName: 'get-count',
    functionArgs: [],
    senderAddress: 'ST2...',
  });
  return count;
}

// 7. Raw fallback — plain string contractAddress still works (raw overload)
async function rawFallback() {
  await makeUnsignedContractCall({
    contractAddress: 'ST1PQHQ',
    contractName: 'anything',
    functionName: 'whatever',
    functionArgs: [],
    publicKey: PK,
  });
}

// 8. Error — wrong contractName for the branded address
async function wrongContractName() {
  await makeUnsignedContractCall({
    contractAddress: addr,
    contractName: 'vault',
    functionName: 'add',
    functionArgs: [Cl.uint(5)],
    publicKey: PK,
  });
}

// 9. Error — wrong function name
async function wrongFnName() {
  await makeUnsignedContractCall({
    contractAddress: addr,
    contractName: 'counter',
    functionName: 'mint',
    functionArgs: [Cl.uint(5)],
    publicKey: PK,
  });
}

// 10. Error — wrong arg type
async function wrongArgType() {
  await makeUnsignedContractCall({
    contractAddress: addr,
    contractName: 'counter',
    functionName: 'add',
    functionArgs: ['not a uint'],
    publicKey: PK,
  });
}

// 11. Error — too few args
async function tooFewArgs() {
  await makeUnsignedContractCall({
    contractAddress: addr,
    contractName: 'counter',
    functionName: 'add',
    functionArgs: [],
    publicKey: PK,
  });
}

// 12. Error — calling read-only via makeUnsignedContractCall (access enforced)
async function readOnlyViaCall() {
  await makeUnsignedContractCall({
    contractAddress: addr,
    contractName: 'counter',
    functionName: 'get-count',
    functionArgs: [],
    publicKey: PK,
  });
}

// 13. Error — calling public via fetchCallReadOnlyFunction
async function publicViaRead() {
  await fetchCallReadOnlyFunction({
    contractAddress: addr,
    contractName: 'counter',
    functionName: 'add',
    functionArgs: [Cl.uint(5)],
    senderAddress: 'ST2...',
  });
}
