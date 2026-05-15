import { Cl, cvToHex } from '@stacks/transactions';
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
    {
      name: 'echo',
      access: 'read_only',
      args: [{ name: 'n', type: 'uint128' }],
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
const publicKey = '03'.padEnd(66, 'a');

function mockFetchOkResponse(hexCv: string) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: () => Promise.resolve(JSON.stringify({ okay: true, result: hexCv })),
    json: () => Promise.resolve({ okay: true, result: hexCv }),
  });
  return fetchMock as unknown as typeof fetch;
}

describe('contractB.fetchCallReadOnlyFunction — runtime', () => {
  test('issues a POST to the correct URL and returns parsed CV', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(42)));
    const counter = contractB(counterAbi, {
      contract,
      publicKey,
      network: 'mainnet',
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });

    const result = await counter.fetchCallReadOnlyFunction('get-counter', []);

    expect(result).toEqual(Cl.uint(42));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = (fetchMock as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe(
      'https://example.test/v2/contracts/call-read/ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM/counter/get-counter'
    );
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.arguments).toEqual([]);
    expect(typeof body.sender).toBe('string');
  });

  test('serializes coerced primitive args as hex', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(7)));
    const c = contractB(counterAbi, {
      contract,
      publicKey,
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });

    await c.fetchCallReadOnlyFunction('echo', [7]);

    const [, options] = (fetchMock as unknown as jest.Mock).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.arguments).toEqual([cvToHex(Cl.uint(7))]);
  });

  test('per-call senderAddress overrides the auto-derived one', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(0)));
    const counter = contractB(counterAbi, {
      contract,
      publicKey,
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });

    const customSender = 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG';
    await counter.fetchCallReadOnlyFunction('get-counter', [], { senderAddress: customSender });

    const [, options] = (fetchMock as unknown as jest.Mock).mock.calls[0];
    expect(JSON.parse(options.body).sender).toBe(customSender);
  });
});

describe('contractB.fetchCallReadOnlyFunction — type safety', () => {
  const counter = contractB(counterAbi, { contract, publicKey });

  test('public functions cannot be called as read-only', () => {
    // @ts-expect-error — "add" is public, not read_only
    counter.fetchCallReadOnlyFunction('add', [5]);
    expect(true).toBe(true);
  });

  test('wrong function name caught at compile time', () => {
    // @ts-expect-error — "nonExistent" is not a function name in the ABI
    counter.fetchCallReadOnlyFunction('nonExistent', []);
    expect(true).toBe(true);
  });

  test('wrong arity caught at compile time', () => {
    // @ts-expect-error — get-counter expects 0 args
    counter.fetchCallReadOnlyFunction('get-counter', [5]);
    expect(true).toBe(true);
  });

  test('wrong arg type caught at compile time', () => {
    // @ts-expect-error — echo expects uint, not boolean
    counter.fetchCallReadOnlyFunction('echo', [true]);
    expect(true).toBe(true);
  });
});
