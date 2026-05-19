// Approach E — Branded Principal<T>, standalone API.
// Standard scenario: add(5), increment(), getCount().
import { principal, call, read, bind } from '../../../src/approach-e';
import type { Principal } from '../../../src/approach-e';
import { counterContract } from '../../generated/typed/counter';

const PK = '02abcd';

// 1. Construction — branded principal value
const counter = principal(counterContract, 'ST1PQHQ.counter');
//    ^? hover on counter (the Principal<T>)

// 2. Function-style: call() — public
async function callAdd() {
  const tx = await call(counter, 'add', { n: 5n }, { publicKey: PK });
  //    ^? hover on tx (public return)
  return tx;
}

// 3. Autocomplete the function name on call()
async function autocompleteFn() {
  await call(counter, '', {}, { publicKey: PK });
  //           ^| completions on call(counter, ''
}

// 4. No-arg public — increment()
async function callIncrement() {
  await call(counter, 'increment', {}, { publicKey: PK });
}

// 5. Read-only — read() / getCount()
async function callGetCount() {
  const count = await read(counter, 'getCount', {});
  //    ^? hover on count (read-only return)
  return count;
}

// 6. Proxy variant — bind() once, then call as methods
async function boundFlow() {
  const c = bind(counter, { publicKey: PK });
  //    ^? hover on c (bound proxy)

  await c.add({ n: 5n });
  //      ^| completions on c.

  await c.increment();
  const count = await c.getCount();
  //    ^? hover on count from bound proxy
  return count;
}

// 7. Pass branded principal as typed app state
function fireIncrement(target: Principal<typeof counterContract>) {
  //                   ^? hover on Principal type
  return call(target, 'increment', {}, { publicKey: PK });
}

// 8. Error — wrong arg type
async function wrongArg() {
  await call(counter, 'add', { n: 'not a uint' }, { publicKey: PK });
}

// 9. Error — wrong function name
async function wrongFn() {
  await call(counter, 'mint', {}, { publicKey: PK });
}

void fireIncrement;
