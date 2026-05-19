import type {
  BooleanCV,
  NoneCV,
  ResponseErrorCV,
  ResponseOkCV,
  UIntCV,
} from '@stacks/transactions';
import { Cl, makeUnsignedContractCall as makeUnsignedContractCallRaw } from '@stacks/transactions';
import {
  principal,
  typedCall,
  makeUnsignedContractCall,
  getBundle,
  splitPrincipal,
} from '../src/approach-d';
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

// --- Simulated bundled value ---

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

const ADDRESS = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.counter' as const;
const publicKey = '0'.repeat(66);

describe('principal()', () => {
  test('returns a primitive string at runtime', () => {
    const p = principal(counterBundle, ADDRESS);
    expect(typeof p).toBe('string');
    expect(p).toBe(ADDRESS);
  });

  test('Principal<B> is assignable to plain string (compile-time check)', () => {
    const p = principal(counterBundle, ADDRESS);
    // Must compile without a cast — this is the whole point of the brand.
    const s: string = p;
    expect(s).toBe(ADDRESS);
  });

  test('getBundle recovers the registered bundle', () => {
    const p = principal(counterBundle, ADDRESS);
    expect(getBundle(p)).toBe(counterBundle);
  });

  test('splitPrincipal extracts address and name', () => {
    const p = principal(counterBundle, ADDRESS);
    const split = splitPrincipal(p);
    expect(split.contractAddress).toBe('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM');
    expect(split.contractName).toBe('counter');
  });
});

describe('typedCall() — builds a payload that flows into raw makeUnsignedContractCall', () => {
  test('produces { contractAddress, contractName, functionName, functionArgs }', () => {
    const p = principal(counterBundle, ADDRESS);
    const desc = typedCall(p, 'add', [5]);
    expect(desc.contractAddress).toBe('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM');
    expect(desc.contractName).toBe('counter');
    expect(desc.functionName).toBe('add');
    expect(desc.functionArgs).toEqual([Cl.uint(5)]);
  });

  test('spread into raw makeUnsignedContractCall — the real @stacks/transactions function', async () => {
    const p = principal(counterBundle, ADDRESS);
    const tx = await makeUnsignedContractCallRaw({
      ...typedCall(p, 'add', [5]),
      publicKey,
    });
    const payload = tx.payload as any;
    expect(payload.contractAddress.address).toBe('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM');
    expect(payload.contractName.content).toBe('counter');
    expect(payload.functionName.content).toBe('add');
    expect(payload.functionArgs).toEqual([Cl.uint(5)]);
  });

  test('accepts bigint and pre-built ClarityValue inputs', async () => {
    const p = principal(counterBundle, ADDRESS);
    await makeUnsignedContractCallRaw({ ...typedCall(p, 'add', [5n]), publicKey });
    await makeUnsignedContractCallRaw({ ...typedCall(p, 'add', [Cl.uint(7)]), publicKey });
  });

  test('translates kebab-case ABI names — typedCall accepts camelCase only', () => {
    // get-counter is read_only, so use a fresh bundle with a kebab public fn:
    const _bundleBase = {
      functions: [
        {
          name: 'do-thing',
          access: 'public',
          args: [],
          outputs: { type: { response: { ok: 'bool', error: 'uint128' } } },
        },
      ],
    } as const;
    interface KebabContract extends TypegenContractInterface {
      functions: { doThing: { args: Record<string, never>; return: ResponseOkCV<BooleanCV> } };
    }
    const bundle = _bundleBase as typeof _bundleBase & { readonly [__brand]: KebabContract };
    const p = principal(bundle, 'ST1.kebab');
    const desc = typedCall(p, 'doThing', []);
    expect(desc.functionName).toBe('do-thing');
  });
});

describe('makeUnsignedContractCall — same-name wrapper (option D)', () => {
  test('typed { principal, ... } overload calls raw and produces a real tx', async () => {
    const p = principal(counterBundle, ADDRESS);
    const tx = await makeUnsignedContractCall({
      principal: p,
      functionName: 'add',
      functionArgs: [5],
      publicKey,
    });
    const payload = tx.payload as any;
    expect(payload.contractAddress.address).toBe('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM');
    expect(payload.functionName.content).toBe('add');
    expect(payload.functionArgs).toEqual([Cl.uint(5)]);
  });

  test('raw { contractAddress, contractName, ... } overload still works unchanged', async () => {
    const tx = await makeUnsignedContractCall({
      contractAddress: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
      contractName: 'counter',
      functionName: 'add',
      functionArgs: [Cl.uint(42)],
      publicKey,
    });
    const payload = tx.payload as any;
    expect(payload.functionName.content).toBe('add');
    expect(payload.functionArgs).toEqual([Cl.uint(42)]);
  });
});

describe('Approach D — type safety', () => {
  test('valid typedCall compiles', () => {
    const p = principal(counterBundle, ADDRESS);
    typedCall(p, 'add', [5]);
    typedCall(p, 'add', [5n]);
    typedCall(p, 'add', [Cl.uint(5)]);
    expect(true).toBe(true);
  });

  test('read-only function rejected by typedCall (public-only)', () => {
    const p = principal(counterBundle, ADDRESS);
    // @ts-expect-error — getCounter is read_only, not public
    typedCall(p, 'getCounter', []);
    expect(true).toBe(true);
  });

  test('unknown function name caught at compile time', () => {
    const p = principal(counterBundle, ADDRESS);
    // @ts-expect-error — "nope" is not a public function
    typedCall(p, 'nope', []);
    expect(true).toBe(true);
  });

  test('wrong arg type caught at compile time', () => {
    const p = principal(counterBundle, ADDRESS);
    // @ts-expect-error — boolean is not assignable to number | bigint | UIntCV
    typedCall(p, 'add', [true]);
    expect(true).toBe(true);
  });

  test('wrong arity caught at compile time', () => {
    const p = principal(counterBundle, ADDRESS);
    // @ts-expect-error — add expects 1 arg
    typedCall(p, 'add', []);
    expect(true).toBe(true);
  });

  test('same-name wrapper narrows function name', () => {
    const p = principal(counterBundle, ADDRESS);
    // @ts-expect-error — "getCounter" is read_only; the typed overload rejects it and
    // the raw overload doesn't accept the `principal` key.
    makeUnsignedContractCall({
      principal: p,
      functionName: 'getCounter',
      functionArgs: [] as never,
      publicKey,
    });
    expect(true).toBe(true);
  });

  test('Principal<B> flows into raw @stacks/transactions string fields via splitPrincipal', () => {
    // Compile-time: the branded principal type erases cleanly to string for
    // the split halves passed into raw makeUnsignedContractCallRaw.
    const p = principal(counterBundle, ADDRESS);
    const { contractAddress, contractName } = splitPrincipal(p);
    const addr: string = contractAddress;
    const name: string = contractName;
    expect(addr).toBeTruthy();
    expect(name).toBeTruthy();
  });
});
