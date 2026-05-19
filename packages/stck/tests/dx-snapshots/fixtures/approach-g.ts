// Approach G — minimal type-only branded principal.
// Variation of E: brand carries a TYPE only (no ABI value/registry).
// Reuses Approach F's types-only generated artifact (positional CV tuples).
import { principal, call, read } from '../../../src/approach-g';
import type { Principal } from '../../../src/approach-g';
import type { CounterContract } from '../../generated/types-only';
import { Cl } from '@stacks/transactions';

const PK = '02abcd';

// 1. Construction — type-only generic, identity at runtime
const counter = principal<CounterContract>('ST1PQHQ.counter');
//    ^? hover on counter

// 2. Public call — add(5)
async function callAdd() {
  const tx = await call(counter, 'add', [Cl.uint(5)], { publicKey: PK });
  //    ^? hover on tx
  return tx;
}

// 3. Function-name autocomplete on call()
async function autocompleteFn() {
  await call(counter, '', [], { publicKey: PK });
  //           ^| completions on call(counter, ''
}

// 4. No-arg public — increment()
async function callIncrement() {
  await call(counter, 'increment', [], { publicKey: PK });
}

// 5. Read-only — get-count
async function callGetCount() {
  const count = await read(counter, 'get-count', []);
  //    ^? hover on count
  return count;
}

// 6. Function-name autocomplete on read()
async function autocompleteRead() {
  await read(counter, '', []);
  //           ^| completions on read(counter, ''
}

// 7. Pass branded principal as typed state
function fireIncrement(target: Principal<CounterContract>) {
  //                   ^? hover on Principal<CounterContract>
  return call(target, 'increment', [], { publicKey: PK });
}

// 8. Error — wrong arg type
async function wrongArg() {
  await call(counter, 'add', ['not a uint'], { publicKey: PK });
}

// 9. Error — wrong function name (public-only filter)
async function wrongFn() {
  await call(counter, 'mint', [Cl.uint(5)], { publicKey: PK });
}

// 10. Error — calling read-only via call() (access filter)
async function readViaCall() {
  await call(counter, 'get-count', [], { publicKey: PK });
}

// 11. Error — calling public via read() (access filter)
async function publicViaRead() {
  await read(counter, 'add', [Cl.uint(5)]);
}

void fireIncrement;
