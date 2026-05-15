import { Cl } from '@stacks/transactions';
import { contractB } from '../src/contract-b';

const counterAbi = {
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
  variables: [{ name: 'counter', type: 'uint128', access: 'variable' }],
  maps: [],
  fungible_tokens: [],
  non_fungible_tokens: [],
  epoch: 'Epoch25',
  clarity_version: 'Clarity2',
} as const;

const contract = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.counter' as const;
const publicKey = '0'.repeat(66);

describe('contractB — runtime', () => {
  test('coerces named-record args using ABI', async () => {
    const counter = contractB(counterAbi, { contract, publicKey });
    const tx = await counter.makeUnsignedContractCall('add', [5]);
    const payload = tx.payload as any;
    expect(payload.contractAddress.address).toBe('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM');
    expect(payload.contractName.content).toBe('counter');
    expect(payload.functionName.content).toBe('add');
    expect(payload.functionArgs).toEqual([Cl.uint(5)]);
  });

  test('passthrough ClarityValue is accepted', async () => {
    const counter = contractB(counterAbi, { contract, publicKey });
    const tx = await counter.makeUnsignedContractCall('add', [Cl.uint(42)]);
    const payload = tx.payload as any;
    expect(payload.functionArgs).toEqual([Cl.uint(42)]);
  });
});

describe('contractB — type safety', () => {
  test('valid call compiles', () => {
    const counter = contractB(counterAbi, { contract, publicKey });
    counter.makeUnsignedContractCall('add', [5]);
    counter.makeUnsignedContractCall('add', [5n]);
    counter.makeUnsignedContractCall('add', [Cl.uint(5)]);
    expect(true).toBe(true);
  });

  test('read-only functions cannot be called as a transaction', () => {
    const counter = contractB(counterAbi, { contract, publicKey });
    // @ts-expect-error — get-counter is read_only, not public
    counter.makeUnsignedContractCall('get-counter', []);
    expect(true).toBe(true);
  });

  test('wrong function name caught at compile time', () => {
    const counter = contractB(counterAbi, { contract, publicKey });
    // @ts-expect-error — "nonExistent" is not a function name in the ABI
    counter.makeUnsignedContractCall('nonExistent', []);
    expect(true).toBe(true);
  });

  test('wrong arg type caught at compile time', () => {
    const counter = contractB(counterAbi, { contract, publicKey });
    // @ts-expect-error — boolean is not assignable to number|bigint|UIntCV
    counter.makeUnsignedContractCall('add', [true]);
    expect(true).toBe(true);
  });

  test('wrong arity caught at compile time', () => {
    const counter = contractB(counterAbi, { contract, publicKey });
    // @ts-expect-error — add expects 1 arg
    counter.makeUnsignedContractCall('add', []);
    expect(true).toBe(true);
  });
});
