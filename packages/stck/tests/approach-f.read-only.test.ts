import type { UIntCV } from '@stacks/transactions';
import { Cl, cvToHex } from '@stacks/transactions';
import { createClient } from '../src/approach-f';
import type { Contracts } from './generated/types-only';

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

describe('approach-f — fetchCallReadOnlyFunction (top-level form)', () => {
  test('POSTs to the call-read endpoint and returns a parsed CV', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(42)));
    const stx = createClient<Contracts>({
      publicKey,
      network: 'mainnet',
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });

    const result = await stx.fetchCallReadOnlyFunction({
      contract,
      functionName: 'get-count',
      functionArgs: [],
    });

    expect(result).toEqual(Cl.uint(42));
    const [url, options] = (fetchMock as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe(
      'https://example.test/v2/contracts/call-read/ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM/counter/get-count'
    );
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.arguments).toEqual([]);
    expect(typeof body.sender).toBe('string');
    expect(body.sender).toMatch(/^S[A-Z0-9]+$/);
  });

  test('serializes positional CV args', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.ok(Cl.uint(99))));
    const stx = createClient<Contracts>({
      publicKey,
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });

    await stx.fetchCallReadOnlyFunction({
      contract,
      functionName: 'get-count-at-block',
      functionArgs: [Cl.uint(7)],
    });

    const [, options] = (fetchMock as unknown as jest.Mock).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.arguments).toEqual([cvToHex(Cl.uint(7))]);
  });

  test('per-call senderAddress overrides the auto-derived one', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(0)));
    const stx = createClient<Contracts>({
      publicKey,
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });

    const customSender = 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG';
    await stx.fetchCallReadOnlyFunction({
      contract,
      functionName: 'get-count',
      functionArgs: [],
      opts: { senderAddress: customSender },
    });
    const [, options] = (fetchMock as unknown as jest.Mock).mock.calls[0];
    expect(JSON.parse(options.body).sender).toBe(customSender);
  });
});

describe('approach-f — read-only via contract handle', () => {
  test('handle.fetchCallReadOnlyFunction works the same', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(123)));
    const stx = createClient<Contracts>({
      publicKey,
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });
    const counter = stx.contract<'counter'>(contract);
    const result = await counter.fetchCallReadOnlyFunction('get-count', []);
    expect(result).toEqual(Cl.uint(123));
  });
});

// --- Type-level safety for read-only path ---

describe('approach-f — read-only type safety', () => {
  const stx = createClient<Contracts>({ publicKey });

  test('return type narrows to the precise CV', async () => {
    const fetchMock = mockFetchOkResponse(cvToHex(Cl.uint(1)));
    const c = createClient<Contracts>({
      publicKey,
      client: { baseUrl: 'https://example.test', fetch: fetchMock },
    });
    const result: UIntCV = await c.fetchCallReadOnlyFunction({
      contract,
      functionName: 'get-count',
      functionArgs: [],
    });
    expect(result).toEqual(Cl.uint(1));
  });

  test('public function rejected on read-only call', () => {
    stx.fetchCallReadOnlyFunction({
      contract,
      // @ts-expect-error — "add" is public, not read_only
      functionName: 'add',
      functionArgs: [] as never,
    });
    expect(true).toBe(true);
  });

  test('wrong arity caught at compile time', () => {
    stx.fetchCallReadOnlyFunction({
      contract,
      functionName: 'get-count',
      // @ts-expect-error — get-count takes 0 args
      functionArgs: [Cl.uint(1)],
    });
    expect(true).toBe(true);
  });
});
