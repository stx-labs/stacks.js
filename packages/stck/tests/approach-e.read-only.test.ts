import type { UIntCV } from '@stacks/transactions';
import { Cl, cvToHex } from '@stacks/transactions';
import { principal, read, bind } from '../src/approach-e';
import type { TypegenContractInterface } from '../src/approach-a';

// --- Simulated typed interface + bundle ---

type AddArgs = { n: UIntCV };
type AddReturn = UIntCV;
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
      outputs: { type: 'uint128' },
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

describe('approach-e read() — runtime', () => {
  test('issues POST and returns decoded CV with narrowed return type', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(42)));
    const counter = principal(counterBundle, contractId);

    const result = await read(
      counter,
      'getCounter',
      {},
      { publicKey, network: 'mainnet', client: { baseUrl: 'https://example.test', fetch: fetchMock } }
    );

    // Type-level check — result is narrowed to UIntCV
    const _typed: UIntCV = result;
    expect(_typed).toEqual(Cl.uint(42));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = (fetchMock as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe(
      'https://example.test/v2/contracts/call-read/ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM/counter/get-counter'
    );
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.arguments).toEqual([]);
    expect(body.sender).toMatch(/^S[A-Z0-9]+$/);
  });

  test('per-call senderAddress overrides publicKey-derived sender', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(0)));
    const counter = principal(counterBundle, contractId);
    const customSender = 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG';

    await read(
      counter,
      'getCounter',
      {},
      { senderAddress: customSender, client: { baseUrl: 'https://example.test', fetch: fetchMock } }
    );

    const [, options] = (fetchMock as unknown as jest.Mock).mock.calls[0];
    expect(JSON.parse(options.body).sender).toBe(customSender);
  });

  test('read() rejects public functions at runtime', async () => {
    // The interface doesn't carry access info, so calling read() against a
    // public function isn't a compile-time error. The runtime check in
    // resolveFn enforces it. See REPORT.md.
    const counter = principal(counterBundle, contractId);
    await expect(read(counter, 'add', { n: 5 }, { publicKey })).rejects.toThrow(
      /expected "read_only"/
    );
  });

  test('throws when neither senderAddress nor publicKey is provided', async () => {
    const counter = principal(counterBundle, contractId);
    await expect(read(counter, 'getCounter', {})).rejects.toThrow(/senderAddress/);
  });
});

describe('approach-e read() — type safety', () => {
  test('return type narrows to the precise CV', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(1)));
    const counter = principal(counterBundle, contractId);
    const result: UIntCV = await read(
      counter,
      'getCounter',
      {},
      { publicKey, client: { baseUrl: 'https://example.test', fetch: fetchMock } }
    );
    expect(result).toEqual(Cl.uint(1));
  });

  test('wrong function name caught at compile time', () => {
    const counter = principal(counterBundle, contractId);
    // @ts-expect-error — "nonExistent" is not a function on the interface
    void read(counter, 'nonExistent', {}, { publicKey }).catch(() => {});
    expect(true).toBe(true);
  });
});

describe('approach-e bind() — read-only via proxy', () => {
  test('proxy dispatches read-only function and returns CV', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(7)));
    const counter = bind(principal(counterBundle, contractId), {
      publicKey,
      network: 'mainnet',
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });
    const result = await counter.getCounter({});
    // Bound proxy returns the union type; assert at runtime.
    expect(result).toEqual(Cl.uint(7));
  });
});
