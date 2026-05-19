import type { BooleanCV, NoneCV, ResponseErrorCV, ResponseOkCV, UIntCV } from '@stacks/transactions';
import { Cl } from '@stacks/transactions';
import { principal, definePrincipal, call, bind } from '../src/approach-e';
import type { Principal } from '../src/approach-e';
import type { TypegenContractInterface } from '../src/approach-a';

// --- Simulated typed interface + bundle (matches the shape Clarinet emits) ---

type AddArgs = { n: UIntCV };
type AddReturn = ResponseOkCV<BooleanCV> | ResponseErrorCV<NoneCV>;
type IncrementArgs = Record<string, never>;
type IncrementReturn = ResponseOkCV<BooleanCV> | ResponseErrorCV<NoneCV>;
type GetCounterArgs = Record<string, never>;
type GetCounterReturn = UIntCV;

interface CounterContract extends TypegenContractInterface {
  functions: {
    add: { args: AddArgs; return: AddReturn };
    increment: { args: IncrementArgs; return: IncrementReturn };
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
      name: 'increment',
      access: 'public',
      args: [],
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

const contractId = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.counter' as const;
const publicKey = '0'.repeat(66);

// =============================================================================
// Runtime tests — public call via `call()`
// =============================================================================

describe('approach-e call() — runtime', () => {
  test('builds a tx with coerced named-record args', async () => {
    const counter = principal(counterBundle, contractId);
    const tx = await call(counter, 'add', { n: 5 }, { publicKey });
    const payload = tx.payload as any;
    // tx.payload shape varies a bit between releases; check the load-bearing
    // bits (contract-name, function-name, args) and the contract-address as
    // either an object with `.address` or a string.
    expect(payload.contractName?.content ?? payload.contractName).toBe('counter');
    expect(payload.functionName?.content ?? payload.functionName).toBe('add');
    expect(payload.functionArgs).toEqual([Cl.uint(5)]);
  });

  test('accepts pre-built ClarityValue inputs', async () => {
    const counter = principal(counterBundle, contractId);
    const tx = await call(counter, 'add', { n: Cl.uint(42) }, { publicKey });
    expect((tx.payload as any).functionArgs).toEqual([Cl.uint(42)]);
  });

  test('zero-arg public function is callable', async () => {
    const counter = principal(counterBundle, contractId);
    const tx = await call(counter, 'increment', {}, { publicKey });
    expect((tx.payload as any).functionName.content).toBe('increment');
    expect((tx.payload as any).functionArgs).toEqual([]);
  });

  test('runtime rejects calling a read-only function via call()', async () => {
    // The interface does NOT carry access info, so this isn't a compile-time
    // error — the access check happens at runtime in resolveFn. See REPORT.md.
    const counter = principal(counterBundle, contractId);
    await expect(call(counter, 'getCounter', {}, { publicKey })).rejects.toThrow(
      /expected "public"/
    );
  });

  test('passes through extra per-call options (fee, nonce)', async () => {
    const counter = principal(counterBundle, contractId);
    const tx = await call(counter, 'add', { n: 1 }, { publicKey, fee: 1000n, nonce: 7n });
    expect(tx).toBeTruthy();
  });
});

// =============================================================================
// Brand + identity tests
// =============================================================================

describe('approach-e principal() — brand semantics', () => {
  test('the branded value IS a primitive string', () => {
    const counter = principal(counterBundle, contractId);
    expect(typeof counter).toBe('string');
    expect(counter).toBe(contractId);
    expect((counter as string).split('.')).toEqual([
      'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
      'counter',
    ]);
  });

  test('definePrincipal(bundle) returns a per-contract constructor', () => {
    const counterPrincipal = definePrincipal(counterBundle);
    const counter = counterPrincipal(contractId);
    expect(typeof counter).toBe('string');
    expect(counter).toBe(contractId);
  });

  test('passing branded principal through a function preserves its type', async () => {
    const counter = principal(counterBundle, contractId);

    // Helper that ONLY accepts a Principal<CounterContract>. Type-level proof
    // that the contract interface flows through the value.
    async function incrementCounter(c: Principal<CounterContract>) {
      return call(c, 'increment', {}, { publicKey });
    }

    const tx = await incrementCounter(counter);
    expect((tx.payload as any).functionName.content).toBe('increment');
  });
});

// =============================================================================
// Type-safety tests — these compile or fail to compile
// =============================================================================

describe('approach-e call() — type safety', () => {
  test('valid call compiles', () => {
    const counter = principal(counterBundle, contractId);
    call(counter, 'add', { n: 5 }, { publicKey });
    call(counter, 'add', { n: 5n }, { publicKey });
    call(counter, 'add', { n: Cl.uint(5) }, { publicKey });
    expect(true).toBe(true);
  });

  test('wrong function name caught at compile time', () => {
    const counter = principal(counterBundle, contractId);
    // @ts-expect-error — "nonExistent" is not a function on the interface
    void call(counter, 'nonExistent', {}, { publicKey }).catch(() => {});
    expect(true).toBe(true);
  });

  test('wrong arg type caught at compile time', () => {
    const counter = principal(counterBundle, contractId);
    // @ts-expect-error — n expects number|bigint|UIntCV, not boolean
    void call(counter, 'add', { n: true }, { publicKey }).catch(() => {});
    expect(true).toBe(true);
  });

  test('missing required field is caught at runtime', async () => {
    // KNOWN LIMITATION: when the interface has multiple functions whose args
    // unions include `Record<string, never>` (no-arg functions), TS widens the
    // arg type so `{}` is accepted at the call site for any function. The
    // runtime check in `coerceArgsByName` still catches it. See REPORT.md.
    const counter = principal(counterBundle, contractId);
    // Cast to bypass — at the call site `{}` already type-checks (the bug).
    await expect(
      call(counter, 'add', {} as unknown as { n: number }, { publicKey })
    ).rejects.toThrow(/Missing argument "n"/);
  });

  test('Principal<A> is not assignable to Principal<B>', () => {
    interface OtherContract extends TypegenContractInterface {
      functions: { foo: { args: Record<string, never>; return: UIntCV } };
    }
    const other = '' as Principal<OtherContract>;
    const counter = principal(counterBundle, contractId);

    function takesCounter(_: Principal<CounterContract>) {}
    takesCounter(counter);
    // @ts-expect-error — different brand, not assignable
    takesCounter(other);
    expect(true).toBe(true);
  });

  test('Principal<T> is still assignable to string', () => {
    const counter = principal(counterBundle, contractId);
    const s: string = counter;
    expect(s).toBe(contractId);
  });
});

// =============================================================================
// Bound proxy variant
// =============================================================================

describe('approach-e bind() — proxy variant', () => {
  test('proxy dispatches public function calls', async () => {
    const counter = bind(principal(counterBundle, contractId), { publicKey });
    const tx = (await counter.add({ n: 9 })) as Awaited<ReturnType<typeof counter.add>>;
    const payload = (tx as any).payload;
    expect(payload.functionName.content).toBe('add');
    expect(payload.functionArgs).toEqual([Cl.uint(9)]);
  });

  test('proxy dispatches zero-arg public function', async () => {
    const counter = bind(principal(counterBundle, contractId), { publicKey });
    const tx = await counter.increment({});
    expect(((tx as any).payload).functionName.content).toBe('increment');
  });
});
