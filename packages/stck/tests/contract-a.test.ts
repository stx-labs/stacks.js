import type {
  BooleanCV,
  NoneCV,
  ResponseErrorCV,
  ResponseOkCV,
  UIntCV,
} from '@stacks/transactions';
import { Cl } from '@stacks/transactions';
import { contractA } from '../src/contract-a';
import type { TypegenContractInterface } from '../src/approach-a';

// --- Simulated Approach A generated types ---

type AddArgs = { n: UIntCV };
type AddReturn = ResponseOkCV<BooleanCV> | ResponseErrorCV<NoneCV>;
type GetCounterArgs = Record<string, never>;
type GetCounterReturn = UIntCV;

interface CounterContract extends TypegenContractInterface {
  functions: {
    add: { args: AddArgs; return: AddReturn };
    getCounter: { args: GetCounterArgs; return: GetCounterReturn };
  };
}

// --- Simulated bundled value (what Clarinet's clarity-ts-typegen emits) ---

declare const __brand: unique symbol;

const _counterBundleBase = {
  functions: [
    {
      name: 'add',
      access: 'public',
      args: [{ name: 'n', type: 'uint128' }],
      outputs: { type: { response: { ok: 'bool', error: 'none' } } },
    },
    {
      name: 'get-counter',
      access: 'read_only',
      args: [],
      outputs: { type: 'uint128' },
    },
  ],
} as const;
const counterBundle = _counterBundleBase as typeof _counterBundleBase & {
  readonly [__brand]: CounterContract;
};

const contract = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.counter' as const;
const publicKey = '0'.repeat(66);

describe('contractA — runtime', () => {
  test('coerces named-record args and resolves kebab name', async () => {
    const counter = contractA(counterBundle, { contract, publicKey });
    const tx = await counter.makeUnsignedContractCall('add', [5]);
    const payload = tx.payload as any;
    expect(payload.contractAddress.address).toBe('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM');
    expect(payload.contractName.content).toBe('counter');
    expect(payload.functionName.content).toBe('add');
    expect(payload.functionArgs).toEqual([Cl.uint(5)]);
  });

  test('passthrough ClarityValue is accepted', async () => {
    const counter = contractA(counterBundle, { contract, publicKey });
    const tx = await counter.makeUnsignedContractCall('add', [Cl.uint(42)]);
    const payload = tx.payload as any;
    expect(payload.functionArgs).toEqual([Cl.uint(42)]);
  });

  test('per-call opts override bound publicKey', async () => {
    const counter = contractA(counterBundle, { contract, publicKey });
    const otherKey = '1'.repeat(66);
    const tx = await counter.makeUnsignedContractCall('add', [1], { publicKey: otherKey });
    expect(tx).toBeTruthy();
  });
});

describe('contractA — type safety', () => {
  test('valid call compiles', () => {
    const counter = contractA(counterBundle, { contract, publicKey });
    counter.makeUnsignedContractCall('add', [5]);
    counter.makeUnsignedContractCall('add', [5n]);
    counter.makeUnsignedContractCall('add', [Cl.uint(5)]);
    expect(true).toBe(true);
  });

  test('read-only functions cannot be called as a transaction', () => {
    const counter = contractA(counterBundle, { contract, publicKey });
    // @ts-expect-error — getCounter is read_only, not public
    counter.makeUnsignedContractCall('getCounter', []);
    expect(true).toBe(true);
  });

  test('wrong function name caught at compile time', () => {
    const counter = contractA(counterBundle, { contract, publicKey });
    // @ts-expect-error — "nonExistent" is not a function key
    counter.makeUnsignedContractCall('nonExistent', []);
    expect(true).toBe(true);
  });

  test('wrong arg type caught at compile time', () => {
    const counter = contractA(counterBundle, { contract, publicKey });
    // @ts-expect-error — boolean is not assignable to number|bigint|UIntCV
    counter.makeUnsignedContractCall('add', [true]);
    expect(true).toBe(true);
  });

  test('wrong arity caught at compile time', () => {
    const counter = contractA(counterBundle, { contract, publicKey });
    // @ts-expect-error — add expects 1 arg, got 0
    counter.makeUnsignedContractCall('add', []);
    expect(true).toBe(true);
  });
});
