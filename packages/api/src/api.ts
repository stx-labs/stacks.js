import { FetchFn, Hex, createFetchFn } from '@stacks/common';
import {
  NetworkParam,
  STACKS_MAINNET,
  StacksNetwork,
  StacksNetworkName,
  TransactionVersion,
  defaultUrlFromNetwork,
  networkFrom,
} from '@stacks/network';
import {
  BurnchainRewardListResponse,
  BurnchainRewardSlotHolderListResponse,
  BurnchainRewardsTotal,
} from '@stacks/stacks-blockchain-api-types';
import {
  Cl,
  ClarityAbi,
  ContractIdString,
  FeeEstimation,
  StacksTransactionWire,
  TxBroadcastResult,
  broadcastTransaction,
  fetchAbi,
  fetchFeeEstimateTransaction,
  fetchNonce,
} from '@stacks/transactions';
import {
  BaseErrorResponse,
  ExtendedAccountBalances,
  PaginationOptions,
  V1InfoBlockTimesResponse,
  V2CoreInfoResponse as V2InfoResponse,
  V2PoxInfoResponse,
} from './types';

export class StacksNodeApi {
  public baseUrl: string;
  public fetch: FetchFn;

  public network: StacksNetwork;

  constructor({
    baseUrl,
    fetch,
    network = STACKS_MAINNET,
  }: {
    /** The base API/node URL for the network fetch calls */
    baseUrl?: string;
    /** An optional custom fetch function to override default behaviors */
    fetch?: FetchFn;
  } & NetworkParam = {}) {
    this.baseUrl = baseUrl ?? defaultUrlFromNetwork(network);
    this.fetch = fetch ?? createFetchFn();
    this.network = networkFrom(network);
  }

  /** Returns `true` if the network is configured to 'mainnet', based on the TransactionVersion */
  isMainnet = () => this.network.transactionVersion === TransactionVersion.Mainnet;

  /**
   * Broadcast a serialized transaction to a Stacks node (which will validate and forward to the network).
   * @param transaction - The transaction to broadcast
   * @param attachment - Optional attachment to include with the transaction
   * @returns a Promise that resolves to a {@link TxBroadcastResult} object
   */
  broadcastTransaction = async (
    transaction: StacksTransactionWire,
    attachment?: Uint8Array | string,
    network?: StacksNetworkName | StacksNetwork
  ): Promise<TxBroadcastResult> => {
    return broadcastTransaction({ transaction, attachment, network });
  };

  /**
   * Lookup the nonce for an address from a core node
   * @param address - The Stacks address to look up the next nonce for
   * @return A promise that resolves to a bigint of the next nonce
   */
  getNonce = async (address: string): Promise<bigint> => {
    return fetchNonce({ address, client: this });
  };

  /**
   * Estimate the total transaction fee in microstacks for a Stacks transaction
   * @param payload - The transaction to estimate fees for
   * @param estimatedLength - Optional argument that provides the endpoint with an
   * estimation of the final length (in bytes) of the transaction, including any post-conditions
   * and signatures
   * @return A promise that resolves to an array of {@link FeeEstimate}
   */
  estimateTransaction = async (
    payload: Hex,
    estimatedLength?: number
  ): Promise<[FeeEstimation, FeeEstimation, FeeEstimation]> => {
    return fetchFeeEstimateTransaction({ payload, estimatedLength, client: this });
  };

  /**
   * Fetch a contract's ABI
   * @returns A promise that resolves to a ClarityAbi if the operation succeeds
   */
  getAbi = async (contract: ContractIdString): Promise<ClarityAbi> => {
    const [contractAddress, contractName] = contract.split('.');
    return fetchAbi({ contractAddress, contractName, client: this });
  };

  /** Get stacks node info */
  getInfo(): Promise<V2InfoResponse> {
    return this.fetch(`${this.baseUrl}/v2/info`).then(res => res.json());
  }

  /** Get stacks node pox info */
  getPoxInfo(): Promise<V2PoxInfoResponse> {
    return this.fetch(`${this.baseUrl}/v2/pox`).then(res => res.json());
  }

  /** Get stacks node target block time */
  async getTargetBlockTime() {
    const res = await this.fetch(`${this.baseUrl}/extended/v1/info/network_block_times`).then(
      (res: any): V1InfoBlockTimesResponse => res.json()
    );

    if (this.isMainnet()) return res.mainnet.target_block_time;
    return res.testnet.target_block_time;
  }

  /** Get account status */
  async getAccountInfo(address: string) {
    // todo: add types for response
    return this.fetch(`${this.baseUrl}/v2/accounts/${address}?proof=0`)
      .then(res => res.json())
      .then(json => {
        json.balance = BigInt(json.balance);
        json.locked = BigInt(json.locked);
        return json;
      });
  }

  /** Get extended account balances */
  async getExtendedAccountBalances(address: string): Promise<ExtendedAccountBalances> {
    return this.fetch(`${this.baseUrl}/extended/v3/principals/${address}/balances/stx`)
      .then(res => res.json())
      .then(json => {
        json.balance = BigInt(json.balance);
        json.available = BigInt(json.available);
        if (json.locked) json.locked.amount = BigInt(json.locked.amount);
        if (json.mempool) {
          json.mempool.estimated_balance = BigInt(json.mempool.estimated_balance);
          json.mempool.inbound = BigInt(json.mempool.inbound);
          json.mempool.outbound = BigInt(json.mempool.outbound);
        }
        return json;
      });
  }

  /** Get the total BTC stacking rewards total for an address */
  async getExtendedBtcRewardsTotal(
    /** BTC or STX address */
    address: string
  ): Promise<BurnchainRewardsTotal | BaseErrorResponse> {
    return this.fetch(`${this.baseUrl}/extended/v1/burnchain/rewards/${address}/total`)
      .then(res => res.json())
      .then(json => {
        json.reward_amount = BigInt(json.reward_amount);
        return json;
      });
  }

  /** Get paginated BTC stacking rewards total for an address */
  async getExtendedBtcRewards(
    /** BTC or STX address */
    address: string,
    options?: PaginationOptions
  ): Promise<BurnchainRewardListResponse | BaseErrorResponse> {
    let url = `${this.baseUrl}/extended/v1/burnchain/rewards/${address}`;
    if (options) url += `?limit=${options.limit}&offset=${options.offset}`;

    return this.fetch(url).then(res => res.json());
  }

  /** Get BTC reward holders for the an address */
  async getExtendedBtcRewardHolders(
    /** BTC or STX address */
    address: string,
    options?: PaginationOptions
  ): Promise<BurnchainRewardSlotHolderListResponse | BaseErrorResponse> {
    let url = `${this.baseUrl}/extended/v1/burnchain/reward_slot_holders/${address}`;
    if (options) url += `?limit=${options.limit}&offset=${options.offset}`;

    return this.fetch(url).then(res => res.json());
  }

  /** Gets the value of a data-var if it exists in the given contract */
  async getDataVar(contract: ContractIdString, dataVarName: string) {
    // todo: (contractAddress: string, contractName: string, dataVarName: string) overload?
    // todo: cleanup address/contract identifies types
    const contractPath = contract.replace('.', '/');
    const url = `${this.baseUrl}/v2/data_var/${contractPath}/${dataVarName}?proof=0`;
    return this.fetch(url)
      .then(res => res.json())
      .then(json => ({
        value: Cl.deserialize(json.data),
        raw: json.data as string,
      }));
  }
}
