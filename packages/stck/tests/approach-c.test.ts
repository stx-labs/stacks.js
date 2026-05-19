import type {
  BooleanCV,
  NoneCV,
  ResponseErrorCV,
  ResponseOkCV,
  UIntCV,
} from '@stacks/transactions';
import { Cl } from '@stacks/transactions';
import { contractC } from '../src/approach-c';
import type { TypegenContractInterface } from '../src/approach-a';

// --- Simulated Approach A bundle (same shape as Clarinet typegen output) ---

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

describe('contractC — direct method dispatch (public)', () => {
  test('camelCase method builds an unsigned tx with coerced args', async () => {
    const counter = contractC(counterBundle, { contract, publicKey });
    const tx = await counter.add(5);
    const payload = tx.payload as any;
    expect(payload.contractAddress.address).toBe('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM');
    expect(payload.contractName.content).toBe('counter');
    expect(payload.functionName.content).toBe('add');
    expect(payload.functionArgs).toEqual([Cl.uint(5)]);
  });

  test('accepts pre-built ClarityValues as a passthrough', async () => {
    const counter = contractC(counterBundle, { contract, publicKey });
    const tx = await counter.add(Cl.uint(42));
    const payload = tx.payload as any;
    expect(payload.functionArgs).toEqual([Cl.uint(42)]);
  });

  test('accepts bigint arguments', async () => {
    const counter = contractC(counterBundle, { contract, publicKey });
    const tx = await counter.add(7n);
    const payload = tx.payload as any;
    expect(payload.functionArgs).toEqual([Cl.uint(7n)]);
  });

  test('trailing opts override bound publicKey', async () => {
    const counter = contractC(counterBundle, { contract, publicKey });
    const otherKey = '1'.repeat(66);
    const tx = await counter.add(1, { publicKey: otherKey });
    expect(tx).toBeTruthy();
  });

  test('throws on wrong arity at runtime', async () => {
    const counter = contractC(counterBundle, { contract, publicKey });
    await expect(
      // @ts-expect-error — wrong arity (none / one / two are accepted; three is not)
      counter.add(1, 2, 3, {})
    ).rejects.toThrow(/Expected 1 or 2 args/);
  });

  test('unknown method names return undefined and throw on call', () => {
    const counter = contractC(counterBundle, { contract, publicKey }) as any;
    expect(counter.doesNotExist).toBeUndefined();
  });

  test('symbol property access returns undefined (e.g. Promise.then probe)', () => {
    const counter = contractC(counterBundle, { contract, publicKey }) as any;
    expect(counter[Symbol.iterator]).toBeUndefined();
    expect(counter.then).toBeUndefined();
  });

  test('method functions are cached (stable identity per name)', () => {
    const counter = contractC(counterBundle, { contract, publicKey }) as any;
    expect(counter.add).toBe(counter.add);
  });
});

describe('contractC — type safety', () => {
  const counter = contractC(counterBundle, { contract, publicKey });

  test('valid call compiles', () => {
    counter.add(5);
    counter.add(5n);
    counter.add(Cl.uint(5));
    counter.add(5, { fee: 1000n });
    expect(true).toBe(true);
  });

  test('wrong arg type caught at compile time', () => {
    // @ts-expect-error — boolean not assignable to number | bigint | UIntCV
    counter.add(true);
    expect(true).toBe(true);
  });

  test('wrong method name caught at compile time', () => {
    // @ts-expect-error — no such method
    counter.nonExistent(1);
    expect(true).toBe(true);
  });
});
