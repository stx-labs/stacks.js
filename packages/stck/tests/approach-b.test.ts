import { Cl } from '@stacks/transactions';
import type { TypedOptionsB } from '../src/approach-b';
import type { AbiTypeToCv, Args, Return, FunctionNames } from '../src/abi-types';

// --- Simulated Approach B generated ABI (what Clarinet's clarity-abi-typegen produces) ---

const counterAbi = {
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
  variables: [{ name: 'counter', type: 'uint128', access: 'variable' }],
  maps: [],
  fungible_tokens: [],
  non_fungible_tokens: [],
  epoch: 'Epoch25',
  clarity_version: 'Clarity2',
} as const;

type CounterAbi = typeof counterAbi;

// --- Type-level tests for AbiTypeToCv ---

describe('AbiTypeToCv utility types', () => {
  test('primitive types map correctly', () => {
    const _uint: AbiTypeToCv<'uint128'> = Cl.uint(1);
    const _int: AbiTypeToCv<'int128'> = Cl.int(-1);
    const _bool: AbiTypeToCv<'bool'> = Cl.bool(true);
    const _none: AbiTypeToCv<'none'> = Cl.none();
    const _principal: AbiTypeToCv<'principal'> = Cl.principal(
      'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM'
    );
    expect(_uint).toBeTruthy();
    expect(_int).toBeTruthy();
    expect(_bool).toBeTruthy();
    expect(_none).toBeTruthy();
    expect(_principal).toBeTruthy();
  });

  test('response type maps correctly', () => {
    type R = AbiTypeToCv<{ response: { ok: 'bool'; error: 'none' } }>;
    const _ok: R = Cl.ok(Cl.bool(true));
    const _err: R = Cl.error(Cl.none());
    expect(_ok).toBeTruthy();
    expect(_err).toBeTruthy();
  });

  test('optional type maps correctly', () => {
    type O = AbiTypeToCv<{ optional: 'uint128' }>;
    const _some: O = Cl.some(Cl.uint(42));
    const _none: O = Cl.none();
    expect(_some).toBeTruthy();
    expect(_none).toBeTruthy();
  });

  test('wrong primitive is caught at compile time', () => {
    // @ts-expect-error — uint128 should produce UIntCV, not IntCV
    const _bad: AbiTypeToCv<'uint128'> = Cl.int(1);
    expect(_bad).toBeTruthy();
  });
});

// --- Type-level tests for Args and Return ---

describe('Args and Return utility types', () => {
  test('Args extracts correct argument types as a positional tuple', () => {
    type IncrementArgs = Args<CounterAbi, 'increment'>;
    const _args: IncrementArgs = [Cl.uint(5)];
    expect(_args[0]).toBeTruthy();
  });

  test('Args returns empty tuple for no-arg functions', () => {
    type GetCounterArgs = Args<CounterAbi, 'get-counter'>;
    const _args: GetCounterArgs = [];
    expect(_args).toBeTruthy();
  });

  test('Return extracts correct return type', () => {
    type IncrementReturn = Return<CounterAbi, 'increment'>;
    const _ok: IncrementReturn = Cl.ok(Cl.bool(true));
    expect(_ok).toBeTruthy();

    type GetCounterReturn = Return<CounterAbi, 'get-counter'>;
    const _val: GetCounterReturn = Cl.uint(42);
    expect(_val).toBeTruthy();
  });

  test('wrong arg type is caught at compile time', () => {
    type IncrementArgs = Args<CounterAbi, 'increment'>;
    // @ts-expect-error — first arg should be UIntCV, not BooleanCV
    const _bad: IncrementArgs = [Cl.bool(true)];
    expect(_bad).toBeTruthy();
  });
});

// --- Type-level tests for FunctionNames ---

describe('FunctionNames utility type', () => {
  test('extracts public and read_only function names', () => {
    type Names = FunctionNames<CounterAbi>;
    const _inc: Names = 'increment';
    const _get: Names = 'get-counter';
    expect(_inc).toBeTruthy();
    expect(_get).toBeTruthy();
  });

  test('wrong function name is caught at compile time', () => {
    type Names = FunctionNames<CounterAbi>;
    // @ts-expect-error — "nonExistent" is not a valid function name
    const _bad: Names = 'nonExistent';
    expect(_bad).toBeTruthy();
  });
});

// --- Type-level tests for TypedOptionsB ---

describe('Approach B type safety', () => {
  test('valid call compiles', () => {
    const _opts: TypedOptionsB<CounterAbi, 'increment'> = {
      contract: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.counter',
      functionName: 'increment',
      functionArgs: [Cl.uint(5)],
      publicKey: '0'.repeat(66),
    };
    expect(_opts.functionName).toBe('increment');
  });

  test('wrong function name is caught at compile time', () => {
    type Names = FunctionNames<CounterAbi>;
    // @ts-expect-error — "nonExistent" is not a valid function name
    const _bad: Names = 'nonExistent';
    expect(_bad).toBeTruthy();
  });

  test('wrong arg type is caught at compile time', () => {
    const _opts: TypedOptionsB<CounterAbi, 'increment'> = {
      contract: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.counter',
      functionName: 'increment',
      // @ts-expect-error — first arg should be UIntCV-compatible, not BooleanCV
      functionArgs: [Cl.bool(true)],
      publicKey: '0'.repeat(66),
    };
    expect(_opts).toBeTruthy();
  });

  test('read-only function is rejected at compile time', () => {
    // @ts-expect-error — "get-counter" is read_only, not public
    type _Bad = TypedOptionsB<CounterAbi, 'get-counter'>;
    expect(true).toBe(true);
  });
});
