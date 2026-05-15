import type {
  BooleanCV,
  NoneCV,
  ResponseErrorCV,
  ResponseOkCV,
  UIntCV,
} from '@stacks/transactions';
import { Cl, cvToHex } from '@stacks/transactions';
import { contractA } from '../src/contract-a';
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

describe('contractA.fetchCallReadOnlyFunction — runtime', () => {
  test('issues a POST to the correct URL with hex-serialized args and returns parsed CV', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(42)));
    const counter = contractA(counterBundle, {
      contract,
      publicKey,
      network: 'mainnet',
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });

    const result = await counter.fetchCallReadOnlyFunction('getCounter', []);

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
    expect(body.sender).toMatch(/^S[A-Z0-9]+$/);
  });

  test('serializes coerced named-record args as hex in the request', async () => {
    type EchoArgs = { n: UIntCV };
    type EchoReturn = UIntCV;
    interface ArgContract extends TypegenContractInterface {
      functions: { echo: { args: EchoArgs; return: EchoReturn } };
    }
    const _echoBase = {
      functions: [
        {
          name: 'echo',
          access: 'read_only',
          args: [{ name: 'n', type: 'uint128' }],
          outputs: { type: 'uint128' },
        },
      ],
    } as const;
    const echoBundle = _echoBase as typeof _echoBase & {
      readonly [__brand]: ArgContract;
    };

    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(7)));
    const c = contractA(echoBundle, {
      contract,
      publicKey,
      network: 'mainnet',
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });

    await c.fetchCallReadOnlyFunction('echo', [7]);

    const [, options] = (fetchMock as unknown as jest.Mock).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.arguments).toEqual([cvToHex(Cl.uint(7))]);
  });

  test('per-call senderAddress overrides the auto-derived one', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(0)));
    const counter = contractA(counterBundle, {
      contract,
      publicKey,
      network: 'mainnet',
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });

    const customSender = 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG';
    await counter.fetchCallReadOnlyFunction('getCounter', [], { senderAddress: customSender });

    const [, options] = (fetchMock as unknown as jest.Mock).mock.calls[0];
    expect(JSON.parse(options.body).sender).toBe(customSender);
  });
});

describe('contractA.fetchCallReadOnlyFunction — type safety', () => {
  const counter = contractA(counterBundle, { contract, publicKey });

  test('valid read-only call compiles and narrows return type', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(1)));
    const c = contractA(counterBundle, {
      contract,
      publicKey,
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });
    const result: UIntCV = await c.fetchCallReadOnlyFunction('getCounter', []);
    expect(result).toEqual(Cl.uint(1));
  });

  test('public functions cannot be called as read-only', () => {
    // @ts-expect-error — "add" is public, not read_only
    counter.fetchCallReadOnlyFunction('add', [5]);
    expect(true).toBe(true);
  });

  test('wrong function name caught at compile time', () => {
    // @ts-expect-error — "nonExistent" is not a function key
    counter.fetchCallReadOnlyFunction('nonExistent', []);
    expect(true).toBe(true);
  });

  test('wrong arity caught at compile time', () => {
    // @ts-expect-error — getCounter expects 0 args
    counter.fetchCallReadOnlyFunction('getCounter', [5]);
    expect(true).toBe(true);
  });
});
