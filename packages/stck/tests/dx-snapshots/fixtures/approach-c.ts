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
