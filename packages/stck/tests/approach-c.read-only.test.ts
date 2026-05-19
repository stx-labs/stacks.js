import type {
  BooleanCV,
  NoneCV,
  ResponseErrorCV,
  ResponseOkCV,
  UIntCV,
} from '@stacks/transactions';
import { Cl, cvToHex } from '@stacks/transactions';
import { contractC } from '../src/approach-c';
import type { TypegenContractInterface } from '../src/approach-a';

// --- Simulated Approach A bundle ---

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

describe('contractC — read-only direct dispatch', () => {
  test('zero-arg read-only call hits the call-read endpoint and decodes the CV', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(42)));
    const counter = contractC(counterBundle, {
      contract,
      publicKey,
      network: 'mainnet',
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });

    const result = await counter.getCounter();

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

  test('one-arg read-only call serializes coerced args as hex', async () => {
    type EchoArgs = { n: UIntCV };
    type EchoReturn = UIntCV;
    interface EchoContract extends TypegenContractInterface {
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
      readonly [__brand]: EchoContract;
    };

    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(7)));
    const c = contractC(echoBundle, {
      contract,
      publicKey,
      network: 'mainnet',
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });

    const out = await c.echo(7);
    expect(out).toEqual(Cl.uint(7));

    const [, options] = (fetchMock as unknown as jest.Mock).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.arguments).toEqual([cvToHex(Cl.uint(7))]);
  });

  test('per-call senderAddress overrides the auto-derived one', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(0)));
    const counter = contractC(counterBundle, {
      contract,
      publicKey,
      network: 'mainnet',
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });

    const customSender = 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG';
    await counter.getCounter({ senderAddress: customSender });

    const [, options] = (fetchMock as unknown as jest.Mock).mock.calls[0];
    expect(JSON.parse(options.body).sender).toBe(customSender);
  });
});

describe('contractC — read-only type safety', () => {
  test('read-only return type narrows to the precise CV', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(1)));
    const c = contractC(counterBundle, {
      contract,
      publicKey,
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });
    const result: UIntCV = await c.getCounter();
    expect(result).toEqual(Cl.uint(1));
  });
});
