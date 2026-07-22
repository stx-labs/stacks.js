import { fetchAccountStatus, fetchPoxInfo } from '../src';

/** Client whose fetch always returns the given response. */
const clientFor = (body: string, init?: ResponseInit) => ({
  baseUrl: 'http://mock',
  fetch: async () => new Response(body, init),
});

describe('node fetchers surface HTTP errors', () => {
  it('non-2xx responses throw with the status instead of a JSON parse error', async () => {
    const client = clientFor('<html>rate limited</html>', {
      status: 429,
      statusText: 'Too Many Requests',
    });
    await expect(
      fetchAccountStatus({ address: 'ST000000000000000000002AMW42H', client })
    ).rejects.toThrow(/429/);
    await expect(fetchPoxInfo({ client })).rejects.toThrow(/429/);
  });

  it('a complete account body parses', async () => {
    const client = clientFor(
      JSON.stringify({ balance: '0x0f', locked: '0x00', nonce: 2, unlock_height: 0 })
    );
    const status = await fetchAccountStatus({ address: 'ST000000000000000000002AMW42H', client });
    expect(status).toEqual({ balance: 15n, locked: 0n, nonce: 2n, unlockHeight: 0 });
  });
});
