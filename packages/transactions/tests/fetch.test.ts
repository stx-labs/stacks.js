import fetchMock from 'jest-fetch-mock';
import {
  broadcastTransaction,
  fetchAbi,
  fetchCallReadOnlyFunction,
  fetchContractMapEntry,
  fetchFeeEstimate,
  fetchFeeEstimateTransaction,
  fetchFeeEstimateTransfer,
  fetchNonce,
  makeSTXTokenTransfer,
  Cl,
} from '../src';
import { createApiKeyMiddleware, createFetchFn } from '@stacks/common';
import { NoEstimateAvailableError } from '../src/errors';

// ============================================================================
// Real-world mock data captured from Hiro API (api.hiro.so)
// ============================================================================

/** GET /extended/v1/address/{addr}/nonces — real mainnet response */
const MOCK_NONCES_RESPONSE = `{"last_mempool_tx_nonce":null,"last_executed_tx_nonce":null,"possible_next_nonce":0,"detected_missing_nonces":[],"detected_mempool_nonces":[]}`;

/** GET /v2/accounts/{addr}?proof=0 — account with nonzero nonce */
const MOCK_ACCOUNT_WITH_NONCE = `{"balance":"0x0000000000000000001cdd78bdeadfe8","locked":"0x00000000000000000006a979b1d61c00","unlock_height":435,"nonce":42}`;

/** GET /v2/fees/transfer — real mainnet response (just an integer as text) */
const MOCK_TRANSFER_FEE_RATE = '1';

/** POST /v2/fees/transaction — real mainnet response for STX transfer */
const MOCK_FEE_ESTIMATE_RESPONSE = `{"estimated_cost":{"write_length":0,"write_count":0,"read_length":0,"read_count":0,"runtime":0},"estimated_cost_scalar":6,"estimations":[{"fee_rate":28.63102165530758,"fee":180},{"fee_rate":30.00198285012881,"fee":200},{"fee_rate":31.5,"fee":220}],"cost_scalar_change_by_byte":0.00476837158203125}`;

/** POST /v2/fees/transaction — NoEstimateAvailable error (stacks node hasn't seen this contract-call) */
const MOCK_NO_ESTIMATE_AVAILABLE = `{"error":"NoEstimateAvailable","reason":"NoEstimateAvailable","reason_data":{"message":"No estimate available for the given transaction."}}`;

/** POST /v2/transactions — successful broadcast (quoted txid) */
const MOCK_BROADCAST_OK = `"0288d0bde0b0f88fad0827e35b757efec3a0cf7886c1614bfc4f81c40030a14a"`;

/** POST /v2/transactions — rejection: BadNonce */
const MOCK_BROADCAST_REJECTED_BAD_NONCE: object = {
  error: 'transaction rejected',
  reason: 'BadNonce',
  reason_data: { expected: 5, actual: 0, is_origin: true, principal: true },
  txid: '0288d0bde0b0f88fad0827e35b757efec3a0cf7886c1614bfc4f81c40030a14a',
};

/** POST /v2/transactions — rejection: FeeTooLow */
const MOCK_BROADCAST_REJECTED_FEE_TOO_LOW: object = {
  error: 'transaction rejected',
  reason: 'FeeTooLow',
  reason_data: { expected: 180, actual: 0 },
  txid: '0288d0bde0b0f88fad0827e35b757efec3a0cf7886c1614bfc4f81c40030a14a',
};

/** POST /v2/transactions — rejection: NotEnoughFunds */
const MOCK_BROADCAST_REJECTED_NOT_ENOUGH_FUNDS: object = {
  error: 'transaction rejected',
  reason: 'NotEnoughFunds',
  reason_data: { expected: '1000000', actual: '0' },
  txid: '0288d0bde0b0f88fad0827e35b757efec3a0cf7886c1614bfc4f81c40030a14a',
};

/** POST /v2/contracts/call-read — successful response (get-stacking-minimum) */
const MOCK_READ_ONLY_OK = `{"okay":true,"result":"0x0100000000000000000000001548a3f6d9"}`;

/** POST /v2/contracts/call-read — error response */
const MOCK_READ_ONLY_ERROR = `{"okay":false,"cause":"Runtime error in contract"}`;

/** POST /v2/map_entry — found entry (none/empty stacking state) */
const MOCK_MAP_ENTRY_NONE = `{"data":"0x09","proof":""}`;

/** POST /v2/map_entry — missing data field */
const MOCK_MAP_ENTRY_NO_DATA = `{"proof":""}`;

/** GET /v2/contracts/interface — 404 not found */
const MOCK_ABI_NOT_FOUND = 'No contract interface data found';

// ============================================================================
// Helpers
// ============================================================================

const SENDER_KEY = 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01';
const RECIPIENT = 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159';

/** Build a minimal STX transfer for testing (offline, no API calls) */
async function makeTestTransaction() {
  return makeSTXTokenTransfer({
    recipient: RECIPIENT,
    amount: 12_345,
    fee: 200,
    nonce: 0,
    senderKey: SENDER_KEY,
    memo: 'test memo',
  });
}

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  fetchMock.resetMocks();
});

// --- broadcastTransaction ---------------------------------------------------

describe('broadcastTransaction', () => {
  test('returns txid on success', async () => {
    const tx = await makeTestTransaction();
    fetchMock.mockOnce(MOCK_BROADCAST_OK);

    const result = await broadcastTransaction({ transaction: tx });

    expect(result).toEqual({
      txid: '0288d0bde0b0f88fad0827e35b757efec3a0cf7886c1614bfc4f81c40030a14a',
    });
    expect(fetchMock.mock.calls[0][0]).toContain('/v2/transactions');
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.tx).toBeDefined();
  });

  test('returns rejection object on 400 with valid JSON body', async () => {
    const tx = await makeTestTransaction();
    fetchMock.mockOnce(JSON.stringify(MOCK_BROADCAST_REJECTED_BAD_NONCE), { status: 400 });

    const result = await broadcastTransaction({ transaction: tx });

    expect('error' in result).toBe(true);
    expect((result as any).reason).toBe('BadNonce');
    expect((result as any).reason_data.expected).toBe(5);
    expect((result as any).reason_data.actual).toBe(0);
  });

  test('returns FeeTooLow rejection', async () => {
    const tx = await makeTestTransaction();
    fetchMock.mockOnce(JSON.stringify(MOCK_BROADCAST_REJECTED_FEE_TOO_LOW), { status: 400 });

    const result = await broadcastTransaction({ transaction: tx });

    expect((result as any).reason).toBe('FeeTooLow');
    expect((result as any).reason_data.expected).toBe(180);
  });

  test('returns NotEnoughFunds rejection', async () => {
    const tx = await makeTestTransaction();
    fetchMock.mockOnce(JSON.stringify(MOCK_BROADCAST_REJECTED_NOT_ENOUGH_FUNDS), { status: 400 });

    const result = await broadcastTransaction({ transaction: tx });

    expect((result as any).reason).toBe('NotEnoughFunds');
  });

  test('throws when 400 response is not valid JSON', async () => {
    const tx = await makeTestTransaction();
    fetchMock.mockOnce('Internal Server Error', { status: 400 });

    await expect(broadcastTransaction({ transaction: tx })).rejects.toThrow(
      'Failed to broadcast transaction (unable to parse node response).'
    );
  });

  test('throws when 200 response is not a valid txid', async () => {
    const tx = await makeTestTransaction();
    fetchMock.mockOnce('"not-a-valid-hash"');

    await expect(broadcastTransaction({ transaction: tx })).rejects.toThrow();
  });

  test('sends attachment as hex string when provided', async () => {
    const tx = await makeTestTransaction();
    const txid = tx.txid();
    fetchMock.mockOnce(`"${txid}"`);

    await broadcastTransaction({
      transaction: tx,
      attachment: 'deadbeef',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.attachment).toBe('deadbeef');
  });

  test('sends attachment when provided as Uint8Array', async () => {
    const tx = await makeTestTransaction();
    const txid = tx.txid();
    fetchMock.mockOnce(`"${txid}"`);

    await broadcastTransaction({
      transaction: tx,
      attachment: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.attachment).toBe('deadbeef');
  });

  test('uses custom fetchFn with api key middleware', async () => {
    const apiKey = 'MY_KEY';
    const middleware = createApiKeyMiddleware({ apiKey });
    const fetchFn = createFetchFn(middleware);

    const tx = await makeTestTransaction();
    const txid = tx.txid();
    fetchMock.mockOnce(`"${txid}"`);

    await broadcastTransaction({ transaction: tx, client: { fetch: fetchFn } });

    expect((fetchMock.mock.calls[0][1]?.headers as Headers)?.get('x-api-key')).toContain(apiKey);
  });
});

// --- fetchNonce -------------------------------------------------------------

describe('fetchNonce', () => {
  test('returns nonce from extended API (happy path)', async () => {
    fetchMock.mockOnce(MOCK_NONCES_RESPONSE);

    const nonce = await fetchNonce({ address: RECIPIENT });

    expect(nonce).toBe(0n);
    expect(fetchMock.mock.calls[0][0]).toContain('/extended/v1/address/');
    expect(fetchMock.mock.calls[0][0]).toContain('/nonces');
  });

  test('falls back to v2/accounts when extended API fails', async () => {
    fetchMock.mockRejectOnce(); // extended API fails
    fetchMock.mockOnce(MOCK_ACCOUNT_WITH_NONCE);

    const nonce = await fetchNonce({ address: RECIPIENT });

    expect(nonce).toBe(42n);
    expect(fetchMock.mock.calls.length).toBe(2);
    expect(fetchMock.mock.calls[1][0]).toContain('/v2/accounts/');
  });

  test('throws with descriptive error when both APIs fail', async () => {
    fetchMock.mockRejectOnce(); // extended API fails
    fetchMock.mockOnce('Bad Request', { status: 400, statusText: 'Bad Request' });

    await expect(fetchNonce({ address: RECIPIENT })).rejects.toThrow('Error fetching nonce');
  });

  test('error message includes response body text', async () => {
    fetchMock.mockRejectOnce(); // extended API fails
    fetchMock.mockOnce('Invalid address format', { status: 400, statusText: 'Bad Request' });

    await expect(fetchNonce({ address: 'invalid' })).rejects.toThrow(
      'Invalid address format'
    );
  });

  test('uses testnet URL when network is testnet', async () => {
    fetchMock.mockOnce(MOCK_NONCES_RESPONSE);

    await fetchNonce({ address: RECIPIENT, network: 'testnet' });

    expect(fetchMock.mock.calls[0][0]).toContain('testnet');
  });
});

// --- fetchFeeEstimateTransfer -----------------------------------------------

describe('fetchFeeEstimateTransfer', () => {
  test('returns fee estimate for a transaction', async () => {
    const tx = await makeTestTransaction();
    fetchMock.mockOnce(MOCK_TRANSFER_FEE_RATE);

    const fee = await fetchFeeEstimateTransfer({ transaction: tx });

    expect(typeof fee).toBe('bigint');
    expect(fee).toBeGreaterThan(0n);
    expect(fetchMock.mock.calls[0][0]).toContain('/v2/fees/transfer');
  });

  test('accepts a number (estimated byte length) instead of transaction', async () => {
    fetchMock.mockOnce(MOCK_TRANSFER_FEE_RATE);

    const fee = await fetchFeeEstimateTransfer({ transaction: 180 });

    expect(fee).toBe(180n); // feeRate(1) * bytes(180)
  });

  test('throws with descriptive error on non-ok response', async () => {
    const tx = await makeTestTransaction();
    fetchMock.mockOnce('Service Unavailable', { status: 503, statusText: 'Service Unavailable' });

    await expect(fetchFeeEstimateTransfer({ transaction: tx })).rejects.toThrow(
      'Error estimating transfer fee'
    );
  });

  test('error includes response body when available', async () => {
    const tx = await makeTestTransaction();
    fetchMock.mockOnce('rate limited', { status: 429, statusText: 'Too Many Requests' });

    await expect(fetchFeeEstimateTransfer({ transaction: tx })).rejects.toThrow('rate limited');
  });
});

// --- fetchFeeEstimateTransaction --------------------------------------------

describe('fetchFeeEstimateTransaction', () => {
  test('returns three fee estimations from the node', async () => {
    fetchMock.mockOnce(MOCK_FEE_ESTIMATE_RESPONSE);

    const result = await fetchFeeEstimateTransaction({
      payload: '0x00051a164247d6f2b425ac5771423ae6c80c754f7172000000000000000000000000000030390000000000000000000000000000000000000000000000000000000000000000000000',
      estimatedLength: 180,
    });

    expect(result).toHaveLength(3);
    expect(result[0]).toHaveProperty('fee');
    expect(result[0]).toHaveProperty('fee_rate');
    expect(result[0].fee).toBe(180);
    expect(result[1].fee).toBe(200);
    expect(result[2].fee).toBe(220);
  });

  test('sends payload and estimated_len in POST body', async () => {
    fetchMock.mockOnce(MOCK_FEE_ESTIMATE_RESPONSE);

    const payload = '0x0500000000000000000000000000003039';
    await fetchFeeEstimateTransaction({ payload, estimatedLength: 180 });

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.transaction_payload).toBe(payload);
    expect(body.estimated_len).toBe(180);
  });

  test('throws NoEstimateAvailableError when node responds with NoEstimateAvailable', async () => {
    fetchMock.mockOnce(MOCK_NO_ESTIMATE_AVAILABLE, { status: 400 });

    await expect(
      fetchFeeEstimateTransaction({ payload: '0x00', estimatedLength: 100 })
    ).rejects.toThrow(NoEstimateAvailableError);
  });

  test('NoEstimateAvailableError includes message from reason_data', async () => {
    fetchMock.mockOnce(MOCK_NO_ESTIMATE_AVAILABLE, { status: 400 });

    await expect(
      fetchFeeEstimateTransaction({ payload: '0x00', estimatedLength: 100 })
    ).rejects.toThrow('No estimate available for the given transaction.');
  });

  test('throws NoEstimateAvailableError even when body is not valid JSON but contains keyword', async () => {
    fetchMock.mockOnce('NoEstimateAvailable: unknown payload type', { status: 400 });

    await expect(
      fetchFeeEstimateTransaction({ payload: '0x00', estimatedLength: 100 })
    ).rejects.toThrow(NoEstimateAvailableError);
  });

  test('throws generic error on non-ok response without NoEstimateAvailable', async () => {
    fetchMock.mockOnce('Internal error', { status: 500, statusText: 'Internal Server Error' });

    await expect(
      fetchFeeEstimateTransaction({ payload: '0x00', estimatedLength: 100 })
    ).rejects.toThrow('Error estimating transaction fee');
  });
});

// --- fetchFeeEstimate (combined with fallback) ------------------------------

describe('fetchFeeEstimate', () => {
  test('returns middle (index 1) fee from transaction estimate on success', async () => {
    const tx = await makeTestTransaction();
    fetchMock.mockOnce(MOCK_FEE_ESTIMATE_RESPONSE);

    const fee = await fetchFeeEstimate({ transaction: tx });

    expect(fee).toBe(200); // index [1].fee from MOCK_FEE_ESTIMATE_RESPONSE
  });

  test('falls back to transfer fee estimate on NoEstimateAvailable', async () => {
    const tx = await makeTestTransaction();
    // First call: /v2/fees/transaction returns NoEstimateAvailable
    fetchMock.mockOnce(MOCK_NO_ESTIMATE_AVAILABLE, { status: 400 });
    // Second call: /v2/fees/transfer returns rate
    fetchMock.mockOnce(MOCK_TRANSFER_FEE_RATE);

    const fee = await fetchFeeEstimate({ transaction: tx });

    expect(typeof fee).toBe('bigint');
    expect(fee).toBeGreaterThan(0n);
    expect(fetchMock.mock.calls.length).toBe(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/v2/fees/transaction');
    expect(fetchMock.mock.calls[1][0]).toContain('/v2/fees/transfer');
  });

  test('throws non-NoEstimateAvailable errors without fallback', async () => {
    const tx = await makeTestTransaction();
    fetchMock.mockOnce('Server Error', { status: 500, statusText: 'Internal Server Error' });

    await expect(fetchFeeEstimate({ transaction: tx })).rejects.toThrow(
      'Error estimating transaction fee'
    );
    // Should NOT attempt the transfer fee fallback
    expect(fetchMock.mock.calls.length).toBe(1);
  });
});

// --- fetchAbi ---------------------------------------------------------------

describe('fetchAbi', () => {
  test('returns parsed ABI on success', async () => {
    const mockAbi = {
      functions: [{ name: 'transfer', access: 'public', args: [], outputs: { type: 'bool' } }],
      variables: [],
      maps: [],
      fungible_tokens: [],
      non_fungible_tokens: [],
    };
    fetchMock.mockOnce(JSON.stringify(mockAbi));

    const abi = await fetchAbi({
      contractAddress: 'SP000000000000000000002Q6VF78',
      contractName: 'pox-4',
    });

    expect(abi.functions).toHaveLength(1);
    expect(abi.functions[0].name).toBe('transfer');
    expect(fetchMock.mock.calls[0][0]).toContain('/v2/contracts/interface/');
    expect(fetchMock.mock.calls[0][0]).toContain('SP000000000000000000002Q6VF78/pox-4');
  });

  test('throws with descriptive error on 404', async () => {
    fetchMock.mockOnce(MOCK_ABI_NOT_FOUND, { status: 404, statusText: 'Not Found' });

    await expect(
      fetchAbi({
        contractAddress: 'SP000000000000000000002Q6VF78',
        contractName: 'nonexistent',
      })
    ).rejects.toThrow('Error fetching contract ABI');
  });

  test('error message includes contract name and address', async () => {
    fetchMock.mockOnce(MOCK_ABI_NOT_FOUND, { status: 404, statusText: 'Not Found' });

    await expect(
      fetchAbi({
        contractAddress: 'SP000000000000000000002Q6VF78',
        contractName: 'nonexistent',
      })
    ).rejects.toThrow('nonexistent');
  });
});

// --- fetchCallReadOnlyFunction ----------------------------------------------

describe('fetchCallReadOnlyFunction', () => {
  test('returns deserialized Clarity value on success', async () => {
    // 0x0100000000000000000000001548a3f6d9 = uint 91,400,000,217
    fetchMock.mockOnce(MOCK_READ_ONLY_OK);

    const result = await fetchCallReadOnlyFunction({
      contractAddress: 'SP000000000000000000002Q6VF78',
      contractName: 'pox-4',
      functionName: 'get-stacking-minimum',
      functionArgs: [],
      senderAddress: 'SP000000000000000000002Q6VF78',
    });

    expect(result).toBeDefined();
  });

  test('sends sender and serialized arguments in POST body', async () => {
    fetchMock.mockOnce(MOCK_READ_ONLY_OK);

    await fetchCallReadOnlyFunction({
      contractAddress: 'SP000000000000000000002Q6VF78',
      contractName: 'pox-4',
      functionName: 'get-stacking-minimum',
      functionArgs: [],
      senderAddress: 'SP000000000000000000002Q6VF78',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.sender).toBe('SP000000000000000000002Q6VF78');
    expect(body.arguments).toEqual([]);
  });

  test('serializes function arguments as hex', async () => {
    fetchMock.mockOnce(MOCK_READ_ONLY_OK);

    await fetchCallReadOnlyFunction({
      contractAddress: 'SP000000000000000000002Q6VF78',
      contractName: 'pox-4',
      functionName: 'some-function',
      functionArgs: [Cl.uint(42), Cl.bool(true)],
      senderAddress: 'SP000000000000000000002Q6VF78',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.arguments).toHaveLength(2);
    // Each arg should be a hex string starting with 0x
    body.arguments.forEach((arg: string) => expect(arg).toMatch(/^0x/));
  });

  test('throws when read-only response is not okay', async () => {
    fetchMock.mockOnce(MOCK_READ_ONLY_ERROR);

    await expect(
      fetchCallReadOnlyFunction({
        contractAddress: 'SP000000000000000000002Q6VF78',
        contractName: 'pox-4',
        functionName: 'bad-function',
        functionArgs: [],
        senderAddress: 'SP000000000000000000002Q6VF78',
      })
    ).rejects.toThrow('Runtime error in contract');
  });

  test('throws with descriptive error on non-ok HTTP response', async () => {
    fetchMock.mockOnce('endpoint not found', { status: 404, statusText: 'Not Found' });

    await expect(
      fetchCallReadOnlyFunction({
        contractAddress: 'SP000000000000000000002Q6VF78',
        contractName: 'pox-4',
        functionName: 'get-stacking-minimum',
        functionArgs: [],
        senderAddress: 'SP000000000000000000002Q6VF78',
      })
    ).rejects.toThrow('Error calling read-only function');
  });

  test('encodes function name in URL', async () => {
    fetchMock.mockOnce(MOCK_READ_ONLY_OK);

    await fetchCallReadOnlyFunction({
      contractAddress: 'SP000000000000000000002Q6VF78',
      contractName: 'pox-4',
      functionName: 'get-stacking-minimum',
      functionArgs: [],
      senderAddress: 'SP000000000000000000002Q6VF78',
    });

    expect(fetchMock.mock.calls[0][0]).toContain(
      '/v2/contracts/call-read/SP000000000000000000002Q6VF78/pox-4/get-stacking-minimum'
    );
  });
});

// --- fetchContractMapEntry --------------------------------------------------

describe('fetchContractMapEntry', () => {
  test('returns deserialized Clarity value for existing entry', async () => {
    // 0x09 = none
    fetchMock.mockOnce(MOCK_MAP_ENTRY_NONE);

    const result = await fetchContractMapEntry({
      contractAddress: 'SP000000000000000000002Q6VF78',
      contractName: 'pox-4',
      mapName: 'stacking-state',
      mapKey: Cl.standardPrincipal('SP000000000000000000002Q6VF78'),
    });

    expect(result).toBeDefined();
    expect(result.type).toBe(Cl.none().type);
  });

  test('sends serialized map key as POST body', async () => {
    fetchMock.mockOnce(MOCK_MAP_ENTRY_NONE);

    await fetchContractMapEntry({
      contractAddress: 'SP000000000000000000002Q6VF78',
      contractName: 'pox-4',
      mapName: 'stacking-state',
      mapKey: Cl.standardPrincipal('SP000000000000000000002Q6VF78'),
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    // Body should be a hex string starting with 0x (the serialized principal)
    expect(body).toMatch(/^0x/);
  });

  test('builds correct URL with proof=0', async () => {
    fetchMock.mockOnce(MOCK_MAP_ENTRY_NONE);

    await fetchContractMapEntry({
      contractAddress: 'SP000000000000000000002Q6VF78',
      contractName: 'pox-4',
      mapName: 'stacking-state',
      mapKey: Cl.standardPrincipal('SP000000000000000000002Q6VF78'),
    });

    expect(fetchMock.mock.calls[0][0]).toContain(
      '/v2/map_entry/SP000000000000000000002Q6VF78/pox-4/stacking-state?proof=0'
    );
  });

  test('throws when response has no data field', async () => {
    fetchMock.mockOnce(MOCK_MAP_ENTRY_NO_DATA);

    await expect(
      fetchContractMapEntry({
        contractAddress: 'SP000000000000000000002Q6VF78',
        contractName: 'pox-4',
        mapName: 'stacking-state',
        mapKey: Cl.standardPrincipal('SP000000000000000000002Q6VF78'),
      })
    ).rejects.toThrow('Error fetching map entry');
  });

  test('throws when data field contains invalid Clarity hex', async () => {
    fetchMock.mockOnce(`{"data":"0xFFFFFFFFFFFFFF","proof":""}`);

    await expect(
      fetchContractMapEntry({
        contractAddress: 'SP000000000000000000002Q6VF78',
        contractName: 'pox-4',
        mapName: 'stacking-state',
        mapKey: Cl.standardPrincipal('SP000000000000000000002Q6VF78'),
      })
    ).rejects.toThrow('Error deserializing Clarity value');
  });

  test('throws with descriptive error on non-ok HTTP response', async () => {
    fetchMock.mockOnce('server error', { status: 500, statusText: 'Internal Server Error' });

    await expect(
      fetchContractMapEntry({
        contractAddress: 'SP000000000000000000002Q6VF78',
        contractName: 'pox-4',
        mapName: 'stacking-state',
        mapKey: Cl.standardPrincipal('SP000000000000000000002Q6VF78'),
      })
    ).rejects.toThrow('Error fetching map entry');
  });

  test('error includes map name and contract info', async () => {
    fetchMock.mockOnce('not found', { status: 404, statusText: 'Not Found' });

    await expect(
      fetchContractMapEntry({
        contractAddress: 'SP000000000000000000002Q6VF78',
        contractName: 'pox-4',
        mapName: 'stacking-state',
        mapKey: Cl.standardPrincipal('SP000000000000000000002Q6VF78'),
      })
    ).rejects.toThrow('stacking-state');
  });
});
