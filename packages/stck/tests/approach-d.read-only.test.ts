import type {
  BooleanCV,
  NoneCV,
  ResponseErrorCV,
  ResponseOkCV,
  UIntCV,
} from '@stacks/transactions';
import {
  Cl,
  cvToHex,
  fetchCallReadOnlyFunction as fetchCallReadOnlyFunctionRaw,
} from '@stacks/transactions';
import {
  principal,
  typedReadOnlyCall,
  fetchCallReadOnlyFunction,
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
const publicKey = '03'.padEnd(66, 'a');

function mockFetchOkResponse(hexCv: string) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: () => Promise.resolve(JSON.stringify({ okay: true, result: hexCv })),
    json: () => Promise.resolve({ okay: true, result: hexCv }),
  }) as unknown as typeof fetch;
}

describe('typedReadOnlyCall — splat into raw fetchCallReadOnlyFunction', () => {
  test('round-trips through the real @stacks/transactions read-only function', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(42)));
    const p = principal(counterBundle, ADDRESS);
    const desc = typedReadOnlyCall(p, 'getCounter', []);

    const result = await fetchCallReadOnlyFunctionRaw({
      ...desc,
      senderAddress: 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG',
      network: 'mainnet',
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });

    expect(result).toEqual(Cl.uint(42));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = (fetchMock as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe(
      'https://example.test/v2/contracts/call-read/ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM/counter/get-counter'
    );
  });
});

describe('fetchCallReadOnlyFunction — same-name wrapper (option D)', () => {
  test('typed { principal, ... } overload performs the network call', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(7)));
    const p = principal(counterBundle, ADDRESS);

    const result = await fetchCallReadOnlyFunction({
      principal: p,
      functionName: 'getCounter',
      functionArgs: [],
      publicKey,
      network: 'mainnet',
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });

    expect(result).toEqual(Cl.uint(7));
    const [, options] = (fetchMock as unknown as jest.Mock).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.arguments).toEqual([]);
    expect(typeof body.sender).toBe('string');
    expect(body.sender).toMatch(/^S[A-Z0-9]+$/);
  });

  test('per-call senderAddress overrides the auto-derived one', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(0)));
    const p = principal(counterBundle, ADDRESS);

    const customSender = 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG';
    await fetchCallReadOnlyFunction({
      principal: p,
      functionName: 'getCounter',
      functionArgs: [],
      senderAddress: customSender,
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });

    const [, options] = (fetchMock as unknown as jest.Mock).mock.calls[0];
    expect(JSON.parse(options.body).sender).toBe(customSender);
  });

  test('raw options shape still flows through unchanged', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(99)));
    const result = await fetchCallReadOnlyFunction({
      contractAddress: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
      contractName: 'counter',
      functionName: 'get-counter',
      functionArgs: [],
      senderAddress: 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG',
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });
    expect(result).toEqual(Cl.uint(99));
  });
});

describe('Approach D — read-only type safety', () => {
  test('public function rejected by typedReadOnlyCall', () => {
    const p = principal(counterBundle, ADDRESS);
    // @ts-expect-error — "add" is public, not read_only
    typedReadOnlyCall(p, 'add', [5]);
    expect(true).toBe(true);
  });

  test('unknown function name caught at compile time', () => {
    const p = principal(counterBundle, ADDRESS);
    // @ts-expect-error — "nope" isn't a read-only function
    typedReadOnlyCall(p, 'nope', []);
    expect(true).toBe(true);
  });

  test('wrong arity caught at compile time', () => {
    const p = principal(counterBundle, ADDRESS);
    // @ts-expect-error — getCounter expects 0 args
    typedReadOnlyCall(p, 'getCounter', [5]);
    expect(true).toBe(true);
  });

  test('valid read-only call return type narrows (compile-only)', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(1)));
    const p = principal(counterBundle, ADDRESS);
    const result: UIntCV = await fetchCallReadOnlyFunction({
      principal: p,
      functionName: 'getCounter',
      functionArgs: [],
      publicKey,
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });
    expect(result).toEqual(Cl.uint(1));
  });
});
