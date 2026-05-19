// Approach F — openapi-fetch-style createClient<Contracts>().
// Types-only generic. Pre-built ClarityValue[] inputs.
// Standard scenario: add(5), increment(), getCount().
import { createClient } from '../../../src/approach-f';
import type { Contracts } from '../../generated/types-only';
import { Cl } from '@stacks/transactions';

const PK = '02abcd';
const ADDR = 'ST1PQHQ.counter' as const;

// 1. Construction — generic-only client
const stx = createClient<Contracts>({ publicKey: PK, network: 'testnet' });
//    ^? hover on stx (the client)

// 2. Top-level call — public, add(5)
async function callAdd() {
  const tx = await stx.makeUnsignedContractCall({
    //  ^? hover on tx
    contract: `${ADDR}`,
    functionName: 'add',
    functionArgs: [Cl.uint(5)],
  });
  return tx;
}

// 3. Autocomplete the function name
async function autocompleteFn() {
  await stx.makeUnsignedContractCall({
    contract: `${ADDR}`,
    functionName: '',
    //             ^| completions inside functionName ''
    functionArgs: [],
  });
}

// 4. No-arg public — increment()
async function callIncrement() {
  await stx.makeUnsignedContractCall({
    contract: `${ADDR}`,
    functionName: 'increment',
    functionArgs: [],
  });
}

// 5. Read-only — getCount()
async function callGetCount() {
  const count = await stx.fetchCallReadOnlyFunction({
    //    ^? hover on count (read-only return)
    contract: `${ADDR}`,
    functionName: 'get-count',
    functionArgs: [],
  });
  return count;
}

// 6. Curried handle — stx.contract<"counter">(addr)
async function curriedHandle() {
  const counter = stx.contract<'counter'>(`${ADDR}`);
  //    ^? hover on counter (curried handle)
  counter.makeUnsignedContractCall('add', [Cl.uint(5)]);
  //      ^| completions on counter.
}

// 7. Error — wrong arg type
async function wrongArg() {
  await stx.makeUnsignedContractCall({
    contract: `${ADDR}`,
    functionName: 'add',
    functionArgs: ['not a uint' as unknown as never],
  });
}

// 8. Error — wrong function name (kebab-case key)
async function wrongFn() {
  await stx.makeUnsignedContractCall({
    contract: `${ADDR}`,
    functionName: 'mint',
    functionArgs: [Cl.uint(5)],
  });
}
