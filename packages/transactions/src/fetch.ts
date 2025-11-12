import { bytesToHex, validateHash256, with0x } from '@stacks/common';
import { NetworkClientParam, clientFromNetwork, networkFrom } from '@stacks/network';
import { ClarityValue, NoneCV, deserializeCV, serializeCV } from './clarity';
import { ClarityAbi } from './contract-abi';
import { NoEstimateAvailableError } from './errors';
import {
  StacksTransactionWire,
  deriveNetworkFromTx,
  estimateTransactionByteLength,
} from './transaction';
import {
  FeeEstimateResponse,
  FeeEstimation,
  TxBroadcastResult,
  TxBroadcastResultOk,
  TxBroadcastResultRejected,
} from './types';
import { cvToHex, parseReadOnlyResponse } from './utils';
import { serializePayloadBytes } from './wire';

export const BROADCAST_PATH = '/v2/transactions';
export const TRANSFER_FEE_ESTIMATE_PATH = '/v2/fees/transfer';
export const TRANSACTION_FEE_ESTIMATE_PATH = '/v2/fees/transaction';
export const ACCOUNT_PATH = '/v2/accounts';
export const CONTRACT_ABI_PATH = '/v2/contracts/interface';
export const READONLY_FUNCTION_CALL_PATH = '/v2/contracts/call-read';
export const MAP_ENTRY_PATH = '/v2/map_entry';

/**
 * Broadcast a serialized transaction to a Stacks node (which will validate and forward to the network).
 * @param opts.transaction - The transaction to broadcast
 * @param opts.attachment - Optional attachment encoded as a hex string
 * @param opts.api - Optional API info (`.url` & `.fetch`) used for fetch call
 * @returns A Promise that resolves to a {@link TxBroadcastResult} object
 */
export async function broadcastTransaction({
  transaction: txOpt,
  attachment: attachOpt,
  network: _network,
  client: _client,
}: {
  /** The transaction to broadcast */
  transaction: StacksTransactionWire;
  /** Optional attachment in bytes or encoded as a hex string */
  attachment?: Uint8Array | string;
} & NetworkClientParam): Promise<TxBroadcastResult> {
  const tx = txOpt.serialize();
  const attachment = attachOpt
    ? typeof attachOpt === 'string'
      ? attachOpt
      : bytesToHex(attachOpt)
    : undefined;
  const json = attachOpt ? { tx, attachment } : { tx };
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(json),
  };

  const network = _network ?? deriveNetworkFromTx(txOpt);
  const client = Object.assign({}, clientFromNetwork(networkFrom(network)), _client);
  const url = `${client.baseUrl}${BROADCAST_PATH}`;
  const response = await client.fetch(url, options);

  if (!response.ok) {
    try {
      return (await response.json()) as TxBroadcastResultRejected;
    } catch (e) {
      throw Error('Failed to broadcast transaction (unable to parse node response).', { cause: e });
    }
  }

  const text = await response.text();
  const txid = text.replace(/["]+/g, ''); // Replace extra quotes around txid string
  if (!validateHash256(txid)) throw new Error(text);

  return { txid } as TxBroadcastResultOk;
}

/** @internal */
async function _getNonceApi({
  address,
  network = 'mainnet',
  client: _client,
}: { address: string } & NetworkClientParam): Promise<bigint> {
  const client = Object.assign({}, clientFromNetwork(networkFrom(network)), _client);
  const url = `${client.baseUrl}/extended/v1/address/${address}/nonces`;
  const response = await client.fetch(url);
  const result = await response.json();
  return BigInt(result.possible_next_nonce);
}

/**
 * Lookup the nonce for an address from a core node
 * @param opts.address - The Stacks address to look up the next nonce for
 * @param opts.api - Optional API info (`.url` & `.fetch`) used for fetch call
 * @return A promise that resolves to an integer
 */
export async function fetchNonce(
  opts: {
    /** The Stacks address to look up the next nonce for */
    address: string;
  } & NetworkClientParam
): Promise<bigint> {
  // Try API first
  try {
    return await _getNonceApi(opts);
  } catch (e) {}

  const network = networkFrom(opts.network ?? 'mainnet');
  const client = Object.assign({}, clientFromNetwork(network), opts.client);
  const url = `${client.baseUrl}${ACCOUNT_PATH}/${opts.address}?proof=0`;
  const response = await client.fetch(url);

  if (!response.ok) {
    const msg = await response.text().catch(() => '');
    throw new Error(
      `Error fetching nonce. Response ${response.status}: ${response.statusText}. Attempted to fetch ${url} and failed with the message: "${msg}"`
    );
  }

  const json = (await response.json()) as { nonce: string };
  return BigInt(json.nonce);
}

/**
 * @deprecated Use the new {@link fetchFeeEstimateTransaction} function instead.
 *
 * Estimate the total transaction fee in microstacks for a token transfer
 *
 * ⚠ Only sensible for token transfer transactions!
 * @param opts.transaction - The token transfer transaction to estimate fees for (or its estimated length in bytes)
 * @param opts.api - Optional API info (`.url` & `.fetch`) used for fetch call
 * @return A promise that resolves to number of microstacks per byte
 */
export async function fetchFeeEstimateTransfer({
  transaction: txOpt,
  network: _network,
  client: _client,
}: {
  /** The token transfer transaction to estimate fees for (or its estimated length in bytes) */
  transaction: StacksTransactionWire | number;
} & NetworkClientParam): Promise<bigint> {
  const network = typeof txOpt === 'number' ? 'mainnet' : (_network ?? deriveNetworkFromTx(txOpt));
  const client = Object.assign({}, clientFromNetwork(networkFrom(network)), _client);

  const url = `${client.baseUrl}${TRANSFER_FEE_ESTIMATE_PATH}`;
  const response = await client.fetch(url, {
    headers: { Accept: 'application/text' },
  });

  if (!response.ok) {
    const msg = await response.text().catch(() => '');
    throw new Error(
      `Error estimating transfer fee. Response ${response.status}: ${response.statusText}. Attempted to fetch ${url} and failed with the message: "${msg}"`
    );
  }

  const feeRateResult = await response.text();
  const txBytes =
    typeof txOpt === 'number'
      ? BigInt(txOpt)
      : BigInt(Math.ceil(txOpt.serializeBytes().byteLength));
  const feeRate = BigInt(feeRateResult);
  return feeRate * txBytes;
}

/**
 * Estimate the total transaction fee in microstacks for a Stacks transaction
 * @param opts.payload - The transaction to estimate fees for
 * @param opts.estimatedLength - Optional estimation of the final length (in
 * bytes) of the transaction, including any post-conditions and signatures
 * @param opts.api - Optional API info (`.url` & `.fetch`) used for fetch call
 * @return A promise that resolves to FeeEstimate
 */
export async function fetchFeeEstimateTransaction({
  payload,
  estimatedLength,
  network = 'mainnet',
  client: _client,
}: {
  payload: string;
  estimatedLength?: number;
} & NetworkClientParam): Promise<[FeeEstimation, FeeEstimation, FeeEstimation]> {
  const json = {
    transaction_payload: payload,
    estimated_len: estimatedLength,
  };
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(json),
  };

  const client = Object.assign({}, clientFromNetwork(networkFrom(network)), _client);
  const url = `${client.baseUrl}${TRANSACTION_FEE_ESTIMATE_PATH}`;
  const response = await client.fetch(url, options);

  if (!response.ok) {
    const body = await response.text().catch(() => '');

    if (body.includes('NoEstimateAvailable')) {
      let json: { reason_data?: { message?: string } } = {};
      try {
        json = JSON.parse(body);
      } catch (err) {
        // ignore
      }
      throw new NoEstimateAvailableError(json?.reason_data?.message ?? '');
    }

    throw new Error(
      `Error estimating transaction fee. Response ${response.status}: ${response.statusText}. Attempted to fetch ${url} and failed with the message: "${body}"`
    );
  }

  const data: FeeEstimateResponse = await response.json();
  return data.estimations;
}

/**
 * Estimates the fee using {@link fetchFeeEstimateTransaction}, but retries to estimate
 * with {@link fetchFeeEstimateTransfer} as a fallback if does not get an estimation due
 * to the {@link NoEstimateAvailableError} error.
 * @param opts.transaction - The transaction to estimate fees for
 * @param opts.api - Optional API info (`.url` & `.fetch`) used for fetch call
 */
export async function fetchFeeEstimate({
  transaction: txOpt,
  network: _network,
  client: _client,
}: {
  transaction: StacksTransactionWire;
} & NetworkClientParam): Promise<bigint | number> {
  const network = _network ?? deriveNetworkFromTx(txOpt);
  const client = Object.assign({}, clientFromNetwork(networkFrom(network)), _client);

  try {
    const estimatedLength = estimateTransactionByteLength(txOpt);
    return (
      await fetchFeeEstimateTransaction({
        payload: bytesToHex(serializePayloadBytes(txOpt.payload)),
        estimatedLength,
        network,
        client,
      })
    )[1].fee;
  } catch (error) {
    if (!(error instanceof NoEstimateAvailableError)) throw error;
    return await fetchFeeEstimateTransfer({ transaction: txOpt, network });
  }
}

/**
 * Fetch a contract's ABI
 * @param opts.address - The contracts address
 * @param opts.contractName - The contracts name
 * @param opts.api - Optional API info (`.url` & `.fetch`) used for fetch call
 * @returns A promise that resolves to a ClarityAbi if the operation succeeds
 */
export async function fetchAbi({
  contractAddress: address,
  contractName: name,
  network = 'mainnet',
  client: _client,
}: {
  contractAddress: string;
  contractName: string;
} & NetworkClientParam): Promise<ClarityAbi> {
  const client = Object.assign({}, clientFromNetwork(networkFrom(network)), _client);
  const url = `${client.baseUrl}${CONTRACT_ABI_PATH}/${address}/${name}`;
  const response = await client.fetch(url);

  if (!response.ok) {
    const msg = await response.text().catch(() => '');
    throw new Error(
      `Error fetching contract ABI for contract "${name}" at address ${address}. Response ${response.status}: ${response.statusText}. Attempted to fetch ${url} and failed with the message: "${msg}"`
    );
  }

  return JSON.parse(await response.text()) as ClarityAbi;
}

/**
 * Calls a function as read-only from a contract interface.
 * It is not necessary that the function is defined as read-only in the contract
 * @param opts.contractName - The contract name
 * @param opts.contractAddress - The contract address
 * @param opts.functionName - The contract function name
 * @param opts.functionArgs - The contract function arguments
 * @param opts.senderAddress - The address of the (simulated) sender
 * @param opts.api - Optional API info (`.url` & `.fetch`) used for fetch call
 * @return Returns an object with a status bool (okay) and a result string that
 * is a serialized clarity value in hex format.
 */
export async function fetchCallReadOnlyFunction({
  contractName,
  contractAddress,
  functionName,
  functionArgs,
  senderAddress,
  network = 'mainnet',
  client: _client,
}: {
  contractName: string;
  contractAddress: string;
  functionName: string;
  functionArgs: ClarityValue[];
  /** address of the sender */
  senderAddress: string;
} & NetworkClientParam): Promise<ClarityValue> {
  const json = {
    sender: senderAddress,
    arguments: functionArgs.map(arg => cvToHex(arg)),
  };
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(json),
  };

  const name = encodeURIComponent(functionName);

  const client = Object.assign({}, clientFromNetwork(networkFrom(network)), _client);
  const url = `${client.baseUrl}${READONLY_FUNCTION_CALL_PATH}/${contractAddress}/${contractName}/${name}`;
  const response = await client.fetch(url, options);

  if (!response.ok) {
    const msg = await response.text().catch(() => '');
    throw new Error(
      `Error calling read-only function. Response ${response.status}: ${response.statusText}. Attempted to fetch ${url} and failed with the message: "${msg}"`
    );
  }

  return await response.json().then(parseReadOnlyResponse);
}

/**
 * Fetch data from a contract data map.
 * @param opts.contractAddress - The contract address
 * @param opts.contractName - The contract name
 * @param opts.mapName - The map variable name
 * @param opts.mapKey - The key of the map entry to look up
 * @param opts.api - Optional API info (`.url` & `.fetch`) used for fetch call
 * @returns Promise that resolves to a ClarityValue if the operation succeeds.
 * Resolves to NoneCV if the map does not contain the given key, if the map does not exist, or if the contract prinicipal does not exist
 */
export async function fetchContractMapEntry<T extends ClarityValue = ClarityValue>({
  contractAddress,
  contractName,
  mapName,
  mapKey,
  network = 'mainnet',
  client: _client,
}: {
  contractAddress: string;
  contractName: string;
  mapName: string;
  mapKey: ClarityValue;
} & NetworkClientParam): Promise<T | NoneCV> {
  const keyHex = with0x(serializeCV(mapKey));

  const options = {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(keyHex), // endpoint expects a JSON string atom (quote wrapped string)
  };

  const client = Object.assign({}, clientFromNetwork(networkFrom(network)), _client);
  const url = `${client.baseUrl}${MAP_ENTRY_PATH}/${contractAddress}/${contractName}/${mapName}?proof=0`;
  const response = await client.fetch(url, options);

  if (!response.ok) {
    const msg = await response.text().catch(() => '');
    throw new Error(
      `Error fetching map entry for map "${mapName}" in contract "${contractName}" at address ${contractAddress}, using map key "${keyHex}". Response ${response.status}: ${response.statusText}. Attempted to fetch ${url} and failed with the message: "${msg}"`
    );
  }

  const json: { data?: string } = await response.json();
  if (!json.data) {
    throw new Error(
      `Error fetching map entry for map "${mapName}" in contract "${contractName}" at address ${contractAddress}, using map key "${keyHex}". Response ${
        response.status
      }: ${response.statusText}. Attempted to fetch ${
        client.baseUrl
      } and failed with the response: "${JSON.stringify(json)}"`
    );
  }

  try {
    return deserializeCV<T>(json.data);
  } catch (error) {
    throw new Error(`Error deserializing Clarity value "${json.data}": ${error}`);
  }
}
