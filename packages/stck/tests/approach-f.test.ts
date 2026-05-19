import { Cl } from '@stacks/transactions';
import { createClient } from '../src/approach-f';
// IMPORTANT: import type — the generated file has no runtime value.
import type { Contracts } from './generated/types-only';

const contract = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.counter' as const;
const publicKey = '0'.repeat(66);

describe('approach-f — createClient — makeUnsignedContractCall (top-level form)', () => {
  test('builds a tx for a public function with no args', async () => {
    const stx = createClient<Contracts>({ publicKey });
    const tx = await stx.makeUnsignedContractCall({
      contract,
      functionName: 'increment',
      functionArgs: [],
    });
    const payload = tx.payload as any;
    expect(payload.contractAddress.address).toBe('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM');
    expect(payload.contractName.content).toBe('counter');
    expect(payload.functionName.content).toBe('increment');
    expect(payload.functionArgs).toEqual([]);
  });

  test('builds a tx for a public function with positional CV args', async () => {
    const stx = createClient<Contracts>({ publicKey });
    const tx = await stx.makeUnsignedContractCall({
      contract,
      functionName: 'add',
      functionArgs: [Cl.uint(7)],
    });
    const payload = tx.payload as any;
    expect(payload.functionName.content).toBe('add');
    expect(payload.functionArgs).toEqual([Cl.uint(7)]);
  });

  test('per-call opts override defaults', async () => {
    const stx = createClient<Contracts>({ publicKey });
    const otherKey = '1'.repeat(66);
    const tx = await stx.makeUnsignedContractCall({
      contract,
      functionName: 'add',
      functionArgs: [Cl.uint(1)],
      opts: { publicKey: otherKey },
    });
    expect(tx).toBeTruthy();
  });
});

describe('approach-f — createClient.contract(...) handle', () => {
  test('curried handle drops the contract field from each call', async () => {
    const stx = createClient<Contracts>({ publicKey });
    const counter = stx.contract<'counter'>(contract);
    const tx = await counter.makeUnsignedContractCall('add', [Cl.uint(3)]);
    const payload = tx.payload as any;
    expect(payload.functionName.content).toBe('add');
    expect(payload.functionArgs).toEqual([Cl.uint(3)]);
  });
});

// --- Type-level safety ---

describe('approach-f — type safety', () => {
  const stx = createClient<Contracts>({ publicKey });

  test('valid call compiles', () => {
    stx.makeUnsignedContractCall({
      contract,
      functionName: 'add',
      functionArgs: [Cl.uint(5)],
    });
    stx.makeUnsignedContractCall({
      contract,
      functionName: 'increment',
      functionArgs: [],
    });
    expect(true).toBe(true);
  });

  test('wrong function name caught at compile time', () => {
    stx.makeUnsignedContractCall({
      contract,
      // @ts-expect-error — "nonExistent" is not a function on counter
      functionName: 'nonExistent',
      functionArgs: [] as never,
    });
    expect(true).toBe(true);
  });

  test('read-only function is rejected as public call', () => {
    stx.makeUnsignedContractCall({
      contract,
      // @ts-expect-error — "get-count" is read_only, not public
      functionName: 'get-count',
      functionArgs: [] as never,
    });
    expect(true).toBe(true);
  });

  test('wrong arg type caught at compile time', () => {
    stx.makeUnsignedContractCall({
      contract,
      functionName: 'add',
      // @ts-expect-error — first slot wants UIntCV, not BooleanCV
      functionArgs: [Cl.bool(true)],
    });
    expect(true).toBe(true);
  });

  test('wrong arity caught at compile time', () => {
    stx.makeUnsignedContractCall({
      contract,
      functionName: 'add',
      // @ts-expect-error — add expects exactly 1 arg
      functionArgs: [],
    });
    expect(true).toBe(true);
  });

  test('contract key must match the registry', () => {
    stx.makeUnsignedContractCall({
      // @ts-expect-error — "missing" is not a contract key in Contracts
      contract: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.missing',
      functionName: 'add' as never,
      functionArgs: [] as never,
    });
    expect(true).toBe(true);
  });

  test('contract handle narrows function names', () => {
    const counter = stx.contract<'counter'>(contract);
    counter.makeUnsignedContractCall('add', [Cl.uint(1)]);
    // @ts-expect-error — "nope" is not a function
    counter.makeUnsignedContractCall('nope', []);
    expect(true).toBe(true);
  });
});
