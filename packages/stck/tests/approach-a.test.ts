import type {
  UIntCV,
  BooleanCV,
  NoneCV,
  ResponseOkCV,
  ResponseErrorCV,
} from '@stacks/transactions';
import { Cl } from '@stacks/transactions';
import { makeUnsignedContractCallA, type TypegenContractInterface } from '../src/approach-a';
import { kebabToCamel, findClarityFunctionName } from '../src/common';

// --- Simulated Approach A generated types ---

type IncrementArgs = { step: UIntCV };
type IncrementReturn = ResponseOkCV<BooleanCV> | ResponseErrorCV<NoneCV>;
type GetCounterArgs = Record<string, never>;
type GetCounterReturn = UIntCV;

interface CounterContract extends TypegenContractInterface {
  functions: {
    increment: { args: IncrementArgs; return: IncrementReturn };
    getCounter: { args: GetCounterArgs; return: GetCounterReturn };
  };
}

// --- Simulated bundled value ---

declare const __brand: unique symbol;

const _counterBundleBase = {
  functions: [
    {
      name: 'increment',
      access: 'public',
      args: [{ name: 'step', type: 'uint128' }],
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

// --- Runtime tests ---

describe('common helpers', () => {
  test('kebabToCamel converts kebab-case to camelCase', () => {
    expect(kebabToCamel('get-counter')).toBe('getCounter');
    expect(kebabToCamel('my-long-function-name')).toBe('myLongFunctionName');
    expect(kebabToCamel('simple')).toBe('simple');
  });

  test('findClarityFunctionName resolves camelCase to original name', () => {
    expect(findClarityFunctionName(counterBundle, 'increment')).toBe('increment');
    expect(findClarityFunctionName(counterBundle, 'getCounter')).toBe('get-counter');
  });

  test('findClarityFunctionName throws for unknown function', () => {
    expect(() => findClarityFunctionName(counterBundle, 'nonExistent')).toThrow(
      'No function matching "nonExistent" in ABI'
    );
  });
});

// --- Type-level tests ---

describe('Approach A type safety', () => {
  test('valid call compiles', () => {
    const _opts: Parameters<typeof makeUnsignedContractCallA<typeof counterBundle, 'increment'>>[1] =
      {
        contract: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.counter',
        functionName: 'increment',
        functionArgs: [Cl.uint(5)],
        publicKey: '0'.repeat(66),
      };
    expect(_opts.functionName).toBe('increment');
  });

  test('wrong function name is caught at compile time', () => {
    // @ts-expect-error — "nonExistent" is not a public function on the bundle
    const _bad: Parameters<typeof makeUnsignedContractCallA<typeof counterBundle, 'nonExistent'>>[1] =
      {
        contract: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.counter',
        // @ts-expect-error — functionName collapses to never when F is invalid
        functionName: 'nonExistent',
        functionArgs: [] as never,
        publicKey: '0'.repeat(66),
      };
    expect(_bad).toBeTruthy();
  });

  test('read-only function is rejected at compile time', () => {
    // @ts-expect-error — "getCounter" is read_only, not public
    const _bad: Parameters<typeof makeUnsignedContractCallA<typeof counterBundle, 'getCounter'>>[1] =
      {
        contract: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.counter',
        // @ts-expect-error — functionName collapses to never when F is invalid
        functionName: 'getCounter',
        functionArgs: [] as never,
        publicKey: '0'.repeat(66),
      };
    expect(_bad).toBeTruthy();
  });

  test('wrong arg type is caught at compile time', () => {
    const _opts: Parameters<typeof makeUnsignedContractCallA<typeof counterBundle, 'increment'>>[1] =
      {
        contract: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.counter',
        functionName: 'increment',
        // @ts-expect-error — first arg should be UIntCV-compatible, not BooleanCV
        functionArgs: [Cl.bool(true)],
        publicKey: '0'.repeat(66),
      };
    expect(_opts).toBeTruthy();
  });
});
