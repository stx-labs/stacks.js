import { HIRO_MAINNET_URL, HIRO_TESTNET_URL, createFetchFn } from '@stacks/common';
import {
  STACKS_DEVNET,
  STACKS_MAINNET,
  STACKS_MOCKNET,
  STACKS_TESTNET,
  createNetwork,
  networkFromName,
} from '../src';

// eslint-disable-next-line import/no-extraneous-dependencies
import fetchMock from 'jest-fetch-mock';

test(networkFromName.name, () => {
  expect(networkFromName('mainnet')).toEqual(STACKS_MAINNET);
  expect(networkFromName('testnet')).toEqual(STACKS_TESTNET);
  expect(networkFromName('devnet')).toEqual(STACKS_DEVNET);
  expect(networkFromName('mocknet')).toEqual(STACKS_MOCKNET);

  expect(STACKS_DEVNET).toEqual(STACKS_MOCKNET);
});

describe(createNetwork.name, () => {
  const TEST_API_KEY = 'test-api-key';

  beforeEach(() => {
    fetchMock.resetMocks();
    fetchMock.mockResponse(JSON.stringify({ result: 'ok' }));
  });

  test('creates network from network name string', () => {
    const network = createNetwork('mainnet');
    expect(network.chainId).toEqual(STACKS_MAINNET.chainId);
    expect(network.transactionVersion).toEqual(STACKS_MAINNET.transactionVersion);
    expect(network.client.baseUrl).toEqual(STACKS_MAINNET.client.baseUrl);
  });

  test('creates network from network object', () => {
    const network = createNetwork(STACKS_TESTNET);
    expect(network.chainId).toEqual(STACKS_TESTNET.chainId);
    expect(network.transactionVersion).toEqual(STACKS_TESTNET.transactionVersion);
    expect(network.client.baseUrl).toEqual(STACKS_TESTNET.client.baseUrl);
    expect(network.client.fetch).toBeUndefined();
  });

  test('creates network from network name string with API key', async () => {
    const network = createNetwork('testnet', TEST_API_KEY);
    expect(network.chainId).toEqual(STACKS_TESTNET.chainId);
    expect(network.transactionVersion).toEqual(STACKS_TESTNET.transactionVersion);
    expect(network.client.baseUrl).toEqual(STACKS_TESTNET.client.baseUrl);
    expect(network.client.fetch).toBeDefined();

    // Test that API key is included in requests
    expect(network.client.fetch).not.toBeUndefined();
    if (!network.client.fetch) throw 'Type error';

    await network.client.fetch(HIRO_TESTNET_URL);
    expect(fetchMock).toHaveBeenCalled();
    const callHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(callHeaders.has('x-api-key')).toBeTruthy();
    expect(callHeaders.get('x-api-key')).toBe(TEST_API_KEY);
  });

  test('creates network from network object with API key', async () => {
    const network = createNetwork(STACKS_MAINNET, TEST_API_KEY);
    expect(network.chainId).toEqual(STACKS_MAINNET.chainId);
    expect(network.transactionVersion).toEqual(STACKS_MAINNET.transactionVersion);
    expect(network.client.baseUrl).toEqual(STACKS_MAINNET.client.baseUrl);
    expect(network.client.fetch).toBeDefined();

    // Test that API key is included in requests
    expect(network.client.fetch).not.toBeUndefined();
    if (!network.client.fetch) throw 'Type error';

    await network.client.fetch(HIRO_TESTNET_URL);
    expect(fetchMock).toHaveBeenCalled();
    const callHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(callHeaders.has('x-api-key')).toBeTruthy();
    expect(callHeaders.get('x-api-key')).toBe(TEST_API_KEY);
  });

  test('creates network from options object with network name and API key', async () => {
    const network = createNetwork({
      network: 'mainnet',
      apiKey: TEST_API_KEY,
    });
    expect(network.chainId).toEqual(STACKS_MAINNET.chainId);
    expect(network.transactionVersion).toEqual(STACKS_MAINNET.transactionVersion);
    expect(network.client.baseUrl).toEqual(STACKS_MAINNET.client.baseUrl);
    expect(network.client.fetch).toBeDefined();

    // Test that API key is included in requests
    expect(network.client.fetch).not.toBeUndefined();
    if (!network.client.fetch) throw 'Type error';

    await network.client.fetch(HIRO_MAINNET_URL);
    expect(fetchMock).toHaveBeenCalled();
    const callHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(callHeaders.has('x-api-key')).toBeTruthy();
    expect(callHeaders.get('x-api-key')).toBe(TEST_API_KEY);
  });

  test('creates network from options object with network name, API key, and custom host', async () => {
    const network = createNetwork({
      network: 'devnet',
      apiKey: TEST_API_KEY,
      host: /^/, // any host
    });
    expect(network.chainId).toEqual(STACKS_DEVNET.chainId);
    expect(network.transactionVersion).toEqual(STACKS_DEVNET.transactionVersion);
    expect(network.client.baseUrl).toEqual(STACKS_DEVNET.client.baseUrl);
    expect(network.client.fetch).toBeDefined();

    // Test that API key is included in requests
    expect(network.client.fetch).not.toBeUndefined();
    if (!network.client.fetch) throw 'Type error';

    await network.client.fetch('https://example.com');
    expect(fetchMock).toHaveBeenCalled();
    const callHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(callHeaders.has('x-api-key')).toBeTruthy();
    expect(callHeaders.get('x-api-key')).toBe(TEST_API_KEY);
  });

  test('creates network from options object with network object and API key', async () => {
    const network = createNetwork({
      network: STACKS_MOCKNET,
      apiKey: TEST_API_KEY,
    });
    expect(network.chainId).toEqual(STACKS_MOCKNET.chainId);
    expect(network.transactionVersion).toEqual(STACKS_MOCKNET.transactionVersion);
    expect(network.client.baseUrl).toEqual(STACKS_MOCKNET.client.baseUrl);
    expect(network.client.fetch).toBeDefined();

    // Test that API key is included in requests
    expect(network.client.fetch).not.toBeUndefined();
    if (!network.client.fetch) throw 'Type error';

    await network.client.fetch(HIRO_TESTNET_URL);
    expect(fetchMock).toHaveBeenCalled();
    const callHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(callHeaders.has('x-api-key')).toBeTruthy();
    expect(callHeaders.get('x-api-key')).toBe(TEST_API_KEY);
  });

  test('creates network from options object with network name and custom client', () => {
    const customBaseUrl = 'https://custom-api.example.com';
    const customFetch = createFetchFn();

    const network = createNetwork({
      network: 'mainnet',
      client: {
        baseUrl: customBaseUrl,
        fetch: customFetch,
      },
    });

    expect(network.chainId).toEqual(STACKS_MAINNET.chainId);
    expect(network.transactionVersion).toEqual(STACKS_MAINNET.transactionVersion);
    expect(network.client.baseUrl).toEqual(customBaseUrl);
    expect(network.client.fetch).toBe(customFetch);
  });

  test('creates network from options object with network object and custom client', () => {
    const customBaseUrl = 'https://custom-api.example.com';
    const customFetch = createFetchFn();

    const network = createNetwork({
      network: STACKS_TESTNET,
      client: {
        baseUrl: customBaseUrl,
        fetch: customFetch,
      },
    });

    expect(network.chainId).toEqual(STACKS_TESTNET.chainId);
    expect(network.transactionVersion).toEqual(STACKS_TESTNET.transactionVersion);
    expect(network.client.baseUrl).toEqual(customBaseUrl);
    expect(network.client.fetch).toBe(customFetch);
  });

  test('throws error with invalid arguments', () => {
    // @ts-expect-error Testing invalid argument
    expect(() => createNetwork()).toThrow();
    // @ts-expect-error Testing invalid argument
    expect(() => createNetwork(null)).toThrow();
    // @ts-expect-error Testing invalid argument
    expect(() => createNetwork(undefined, undefined)).toThrow();
  });
});
