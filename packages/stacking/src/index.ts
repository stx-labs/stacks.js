import { ClientOpts, IntegerType, PrivateKey, hexToBytes, intToBigInt } from '@stacks/common';
import {
  ChainId,
  NetworkClientParam,
  StacksNetwork,
  clientFromNetwork,
  networkFrom,
} from '@stacks/network';
import {
  BurnchainRewardListResponse,
  BurnchainRewardSlotHolderListResponse,
  BurnchainRewardsTotal,
} from '@stacks/stacks-blockchain-api-types';
import type { ContractIdString } from '@stacks/transactions';
import {
  BufferCV,
  ClarityType,
  ClarityValue,
  ContractCallOptions,
  ContractCallPayload,
  OptionalCV,
  PrincipalCV,
  ResponseErrorCV,
  StacksTransactionWire,
  TupleCV,
  TxBroadcastResult,
  UIntCV,
  broadcastTransaction,
  bufferCV,
  cvToString,
  fetchCallReadOnlyFunction,
  getFee,
  makeContractCall,
  noneCV,
  principalCV,
  someCV,
  stringAsciiCV,
  uintCV,
  validateStacksAddress,
} from '@stacks/transactions';
import { PoxOperationPeriod, StackingErrors } from './constants';
import {
  Pox4SignatureTopic,
  ensureLegacyBtcAddressForPox1,
  ensurePox2Activated,
  ensureSignerArgsReadiness,
  poxAddressToTuple,
  signPox4SignatureHash,
  unwrap,
  unwrapMap,
} from './utils';

export * from './utils';

/** @internal */
interface BaseTxOptions {
  /** the fee for the transaction */
  fee?: IntegerType;
  /** the nonce for the transaction */
  nonce?: IntegerType;
  /** the private key (aka `senderkey`) for the transaction */
  privateKey: string;
}

export interface CycleInfo {
  id: number;
  min_threshold_ustx: number;
  stacked_ustx: number;
  is_pox_active: boolean;
}

export interface ContractVersion {
  contract_id: string;
  activation_burnchain_block_height: number;
  first_reward_cycle_id: number;
}

export interface PoxInfo {
  contract_id: string;
  contract_versions: ContractVersion[];
  current_burnchain_block_height?: number;
  first_burnchain_block_height: number;
  min_amount_ustx: string;
  next_reward_cycle_in: number;
  prepare_cycle_length: number;
  prepare_phase_block_length: number;
  reward_cycle_id: number;
  reward_cycle_length: number;
  reward_phase_block_length: number;
  reward_slots: number;
  current_cycle: CycleInfo;
  next_cycle: CycleInfo & {
    min_increment_ustx: number;
    prepare_phase_start_block_height: number;
    blocks_until_prepare_phase: number;
    reward_phase_start_block_height: number;
    blocks_until_reward_phase: number;
    ustx_until_pox_rejection: number;
  };
}

export type PoxOperationInfo = {
  /** @deprecated Period isn't needed anymore after 2.1 fork went live */
  period: PoxOperationPeriod;
  pox1: { contract_id: string };
  pox2: ContractVersion;
  pox3: ContractVersion;
  pox4: ContractVersion;
  current: ContractVersion;
};

export type StackerInfo =
  | {
      stacked: false;
    }
  | {
      stacked: true;
      details: {
        first_reward_cycle: number;
        lock_period: number;
        unlock_height: number;
        pox_address: {
          version: Uint8Array;
          hashbytes: Uint8Array;
        };
      };
    };

export type DelegationInfo =
  | {
      delegated: false;
    }
  | {
      delegated: true;
      details: {
        amount_micro_stx: bigint;
        delegated_to: string;
        pox_address?: {
          version: number;
          hashbytes: Uint8Array;
        };
        until_burn_ht?: number;
      };
    };

export interface RewardSetOptions {
  contractId: string;
  rewardCyleId: number;
  rewardSetIndex: number;
}

export interface RewardSetInfo {
  pox_address: {
    version: Uint8Array;
    hashbytes: Uint8Array;
  };
  total_ustx: bigint;
}

export interface StackingEligibility {
  eligible: boolean;
  reason?: string;
}

/**
 * Lock stx check options
 */
export interface CanLockStxOptions {
  /** the reward Bitcoin address */
  poxAddress: string;
  /** number of cycles to lock */
  cycles: number;
}

/**
 * Lock stx options
 */
export interface LockStxOptions {
  /** private key to sign transaction */
  privateKey: string;
  /** number of cycles to lock */
  cycles: number;
  /** the reward Bitcoin address */
  poxAddress: string;
  /** number of microstacks to lock */
  amountMicroStx: IntegerType;
  /** the burnchain block height to begin lock */
  burnBlockHeight: number;
  /** hex-encoded signer key `(buff 33)`, required for >= PoX-4 */
  signerKey?: string;
  /** hex-encoded signature `(buff 65)`, required for >= PoX-4 */
  signerSignature?: string;
  /** Maximum amount of STX that can be locked in this transaction, required for >= PoX-4 */
  maxAmount?: IntegerType;
  /** Random integer to prevent re-use of signer signature, required for >= PoX-4 */
  authId?: IntegerType;
}

/**
 * Stack extend stx options
 */
export interface StackExtendOptions {
  /** private key to sign transaction */
  privateKey: string;
  /** number of cycles to extend by */
  extendCycles: number;
  /** the reward Bitcoin address */
  poxAddress: string;
  /** hex-encoded signer key `(buff 33)`, required for >= PoX-4 */
  signerKey?: string;
  /** hex-encoded signature `(buff 65)`, required for >= PoX-4 */
  signerSignature?: string;
  /** Maximum amount of STX that can be locked in this transaction, required for >= PoX-4 */
  maxAmount?: IntegerType;
  /** Random integer to prevent re-use of signer signature, required for >= PoX-4 */
  authId?: IntegerType;
}

/**
 * Stack increase stx options
 */
export interface StackIncreaseOptions {
  /** private key to sign transaction */
  privateKey: string;
  /** number of ustx to increase by */
  increaseBy: IntegerType;
  /** hex-encoded signer key `(buff 33)`, required for >= PoX-4 */
  signerKey?: string;
  /** hex-encoded signature `(buff 65)`, required for >= PoX-4 */
  signerSignature?: string;
  /** Maximum amount of STX that can be locked in this transaction, required for >= PoX-4 */
  maxAmount?: IntegerType;
  /** Random integer to prevent re-use of signer signature, required for >= PoX-4 */
  authId?: IntegerType;
}

/**
 * Delegate stx options
 */
export interface DelegateStxOptions {
  /** number of microstacks to delegate */
  amountMicroStx: IntegerType;
  /** the STX address of the delegatee */
  delegateTo: string;
  /** the burnchain block height after which delegation is revoked */
  untilBurnBlockHeight?: number;
  /** the reward Bitcoin address of the delegator */
  poxAddress?: string;
  /** private key to sign transaction */
  privateKey: string;
}

/**
 * Delegate stack stx options
 */
export interface DelegateStackStxOptions {
  /** private key to sign transaction */
  privateKey: string;
  /** the STX address of the delegator */
  stacker: string;
  /** number of microstacks to lock */
  amountMicroStx: IntegerType;
  /** the reward Bitcoin address of the delegator */
  poxAddress: string;
  /** the burnchain block height to begin lock */
  burnBlockHeight: number;
  /** number of cycles to lock */
  cycles: number;
}

/**
 * Delegate stack extend options
 */
export interface DelegateStackExtendOptions {
  /** the STX address of the delegator */
  stacker: string;
  /** the reward Bitcoin address of the delegator */
  poxAddress: string;
  /** number of cycles to extend by */
  extendCount: number;
  /** private key to sign transaction */
  privateKey: string;
}

/**
 * Delegate stack increase options
 */
export interface DelegateStackIncreaseOptions {
  /** the STX address of the delegator */
  stacker: string;
  /** the reward Bitcoin address of the delegator */
  poxAddress: string;
  /** number of ustx to increase by */
  increaseBy: IntegerType;
  /** private key to sign transaction */
  privateKey: string;
  /** nonce for the transaction */
  nonce?: IntegerType;
}

export interface StackAggregationCommitOptions {
  poxAddress: string;
  rewardCycle: number;
  privateKey: string;
  /** hex-encoded signer key `(buff 33)`, required for >= PoX-4 */
  signerKey?: string;
  /** hex-encoded signature `(buff 65)`, required for >= PoX-4 */
  signerSignature?: string;
  /** Maximum amount of STX that can be locked in this transaction, required for >= PoX-4 */
  maxAmount?: IntegerType;
  /** Random integer to prevent re-use of signer signature, required for >= PoX-4 */
  authId?: IntegerType;
}

export interface StackAggregationIncreaseOptions {
  poxAddress: string;
  rewardCycle: number;
  rewardIndex: number;
  privateKey: string;
  /** hex-encoded signer key `(buff 33)`, required for >= PoX-4 */
  signerKey?: string;
  /** hex-encoded signature `(buff 65)`, required for >= PoX-4 */
  signerSignature?: string;
  /** Maximum amount of STX that can be locked in this transaction, required for >= PoX-4 */
  maxAmount?: IntegerType;
  /** Random integer to prevent re-use of signer signature, required for >= PoX-4 */
  authId?: IntegerType;
}

export class StackingClient {
  public address: string;
  public network: StacksNetwork;

  public client: Required<ClientOpts>;

  // todo: make more constructor opts optional
  constructor(opts: { address: string } & NetworkClientParam) {
    this.address = opts.address;
    this.network = networkFrom(opts.network ?? 'mainnet');
    this.client = Object.assign({}, clientFromNetwork(this.network), opts.client);
  }

  get baseUrl() {
    return this.client.baseUrl;
  }

  get fetch() {
    return this.client.fetch;
  }

  /** @deprecated Kept for backwards compatibility, may be removed in the future */
  getCoreInfo(): Promise<V2CoreInfoResponse> {
    return this.client.fetch(`${this.client.baseUrl}/v2/info`).then(res => res.json());
  }

  /** @deprecated Kept for backwards compatibility, may be removed in the future */
  getPoxInfo(): Promise<V2PoxInfoResponse> {
    return this.client.fetch(`${this.client.baseUrl}/v2/pox`).then(res => res.json());
  }

  /** @deprecated Kept for backwards compatibility, may be removed in the future */
  async getTargetBlockTime(): Promise<number> {
    const res = await this.client
      .fetch(`${this.client.baseUrl}/extended/v1/info/network_block_times`)
      .then((res: any): V1InfoBlockTimesResponse => res.json());

    if (this.network.chainId === ChainId.Mainnet) return res.mainnet.target_block_time;
    return res.testnet.target_block_time;
  }

  /** Get account status */
  async getAccountStatus(): Promise<any> {
    // todo: add types for response
    return this.client
      .fetch(`${this.client.baseUrl}/v2/accounts/${this.address}?proof=0`)
      .then(res => res.json())
      .then(json => {
        json.balance = BigInt(json.balance);
        json.locked = BigInt(json.locked);
        return json;
      });
  }

  /** Get account balance */
  async getAccountBalance(): Promise<bigint> {
    return this.getAccountStatus().then(a => a.balance);
  }

  /** Get extended account balances */
  async getAccountExtendedBalances(): Promise<ExtendedAccountBalances> {
    return this.client
      .fetch(`${this.client.baseUrl}/extended/v1/address/${this.address}/balances`)
      .then(res => res.json())
      .then(json => {
        json.stx.balance = BigInt(json.stx.balance);
        json.stx.total_sent = BigInt(json.stx.total_sent);
        json.stx.total_received = BigInt(json.stx.total_received);
        json.stx.locked = BigInt(json.stx.locked);
        return json;
      });
  }

  /** Get account balance of locked tokens */
  async getAccountBalanceLocked(): Promise<bigint> {
    return this.getAccountStatus().then(a => a.locked);
  }

  /** Get reward cycle duration in seconds */
  async getCycleDuration(): Promise<number> {
    const [poxInfo, targetBlockTime] = await Promise.all([
      this.getPoxInfo(),
      this.getTargetBlockTime(),
    ]);
    return poxInfo.reward_cycle_length * targetBlockTime;
  }

  /** Get the total burnchain rewards total for the set address */
  async getRewardsTotalForBtcAddress(): Promise<BurnchainRewardsTotal | BaseErrorResponse> {
    return this.client
      .fetch(`${this.client.baseUrl}/extended/v1/burnchain/rewards/${this.address}/total`)
      .then(res => res.json())
      .then(json => {
        json.reward_amount = BigInt(json.reward_amount);
        return json;
      });
  }

  /** Get burnchain rewards for the set address */
  async getRewardsForBtcAddress(
    options?: PaginationOptions
  ): Promise<BurnchainRewardListResponse | BaseErrorResponse> {
    let url = `${this.client.baseUrl}/extended/v1/burnchain/rewards/${this.address}`;
    if (options) url += `?limit=${options.limit}&offset=${options.offset}`;

    return this.client.fetch(url).then(res => res.json());
  }

  /** Get burnchain rewards holders for the set address */
  async getRewardHoldersForBtcAddress(
    options?: PaginationOptions
  ): Promise<BurnchainRewardSlotHolderListResponse | BaseErrorResponse> {
    let url = `${this.client.baseUrl}/extended/v1/burnchain/reward_slot_holders/${this.address}`;
    if (options) url += `?limit=${options.limit}&offset=${options.offset}`;

    return this.client.fetch(url).then(res => res.json());
  }

  /** Get PoX address from reward set by index (if it exists) */
  async getRewardSet(options: RewardSetOptions): Promise<RewardSetInfo | undefined> {
    const [contractAddress, contractName] = this.parseContractId(options?.contractId);
    const result = await fetchCallReadOnlyFunction({
      client: this.client,
      senderAddress: this.address,
      contractAddress,
      contractName,
      functionArgs: [uintCV(options.rewardCyleId), uintCV(options.rewardSetIndex)],
      functionName: 'get-reward-set-pox-address',
    });

    return unwrapMap(result as OptionalCV<TupleCV>, tuple => ({
      pox_address: {
        version: hexToBytes(
          ((tuple.value['pox-addr'] as TupleCV).value['version'] as BufferCV).value
        ),
        hashbytes: hexToBytes(
          ((tuple.value['pox-addr'] as TupleCV).value['hashbytes'] as BufferCV).value
        ),
      },
      total_ustx: BigInt((tuple.value['total-ustx'] as UIntCV).value),
    }));
  }

  /**
   * Get number of seconds until next reward cycle
   * @see {@link getSecondsUntilStackingDeadline}
   */
  async getSecondsUntilNextCycle(): Promise<number> {
    const poxInfoPromise = this.getPoxInfo();
    const targetBlockTimePromise = this.getTargetBlockTime();
    const coreInfoPromise = this.getCoreInfo();

    return Promise.all([poxInfoPromise, targetBlockTimePromise, coreInfoPromise]).then(
      ([poxInfo, targetBlockTime, coreInfo]) => {
        const blocksToNextCycle =
          poxInfo.reward_cycle_length -
          ((coreInfo.burn_block_height - poxInfo.first_burnchain_block_height) %
            poxInfo.reward_cycle_length);
        return blocksToNextCycle * targetBlockTime;
      }
    );
  }

  /**
   * Get number of seconds until the end of the stacking deadline.
   * This is the estimated time stackers have to submit their stacking
   * transactions to be included in the upcoming reward cycle.
   * @returns number of seconds
   * **⚠️ Attention**: The returned number of seconds can be negative if the deadline has passed and the prepare phase has started.
   * @see {@link getSecondsUntilNextCycle}
   */
  async getSecondsUntilStackingDeadline(): Promise<number> {
    const poxInfoPromise = this.getPoxInfo();
    const targetBlockTimePromise = this.getTargetBlockTime();

    return Promise.all([poxInfoPromise, targetBlockTimePromise]).then(
      ([poxInfo, targetBlockTime]) =>
        poxInfo.next_cycle.blocks_until_prepare_phase * targetBlockTime
    );
  }

  /**
   * Get information on current PoX operation
   *
   * Periods:
   * - Period 1: This is before the 2.1 fork.
   * - Period 2: This is after the 2.1 fork, but before cycle (N+1).
   * - Period 3: This is after cycle (N+1) has begun. Original PoX contract state will no longer have any impact on reward sets, account lock status, etc.
   */
  async getPoxOperationInfo(poxInfo?: V2PoxInfoResponse): Promise<PoxOperationInfo> {
    poxInfo = poxInfo ?? (await this.getPoxInfo());

    const poxContractVersions = [...poxInfo.contract_versions].sort(
      (a, b) => a.activation_burnchain_block_height - b.activation_burnchain_block_height
    ); // by activation height ASC (earliest first)
    const [pox1, pox2, pox3, pox4] = poxContractVersions;

    const activatedPoxs = poxContractVersions.filter(
      (c: ContractVersionResponse) =>
        (poxInfo?.current_burnchain_block_height as number) >= c.activation_burnchain_block_height
    );
    const current = activatedPoxs[activatedPoxs.length - 1];

    return { period: PoxOperationPeriod.Period3, pox1, pox2, pox3, pox4, current };
  }

  /**
   * Check if account has minimum require amount of Stacks for stacking
   * @returns {Promise<boolean>} that resolves to a bool if the operation succeeds
   */
  async hasMinimumStx(): Promise<boolean> {
    const balance = await this.getAccountBalance();
    const min = BigInt((await this.getPoxInfo()).min_amount_ustx);
    return balance >= min;
  }

  /**
   * readonly `can-stack-stx`
   *
   * Check if account can lock stx
   * @param {CanLockStxOptions} options - a required lock STX options object
   * @returns {Promise<StackingEligibility>} that resolves to a StackingEligibility object if the operation succeeds
   */
  async canStack({ poxAddress, cycles }: CanLockStxOptions): Promise<StackingEligibility> {
    const balancePromise: Promise<bigint> = this.getAccountBalance();
    const poxInfoPromise = this.getPoxInfo();

    return Promise.all([balancePromise, poxInfoPromise])
      .then(([balance, poxInfo]) => {
        const address = poxAddressToTuple(poxAddress);
        const [contractAddress, contractName] = this.parseContractId(poxInfo.contract_id);

        return fetchCallReadOnlyFunction({
          client: this.client,
          contractName,
          contractAddress,
          functionName: 'can-stack-stx',
          senderAddress: this.address,
          functionArgs: [
            address,
            uintCV(balance.toString()),
            uintCV(poxInfo.reward_cycle_id),
            uintCV(cycles.toString()),
          ],
        });
      })
      .then((responseCV: ClarityValue) => {
        if (responseCV.type === ClarityType.ResponseOk) {
          return {
            eligible: true,
          };
        } else {
          const errorCV = responseCV as ResponseErrorCV;
          return {
            eligible: false,
            reason: StackingErrors[+cvToString(errorCV.value)],
          };
        }
      });
  }

  /**
   * `stack-stx`
   *
   * Generate and broadcast a stacking transaction to lock STX
   * @param {LockStxOptions} options - a required lock STX options object
   * @returns {Promise<string>} that resolves to a broadcasted txid if the operation succeeds
   */
  async stack({
    amountMicroStx,
    poxAddress,
    cycles,
    burnBlockHeight,
    signerKey,
    signerSignature,
    maxAmount,
    authId,
    ...txOptions
  }: LockStxOptions & BaseTxOptions): Promise<TxBroadcastResult> {
    const poxInfo = await this.getPoxInfo();
    const poxOperationInfo = await this.getPoxOperationInfo(poxInfo);

    const contract = await this.getStackingContract(poxOperationInfo);

    ensureLegacyBtcAddressForPox1({ contract, poxAddress });
    ensureSignerArgsReadiness({ contract, signerKey, signerSignature, maxAmount, authId });

    const callOptions = this.getStackOptions({
      contract,
      amountMicroStx,
      cycles,
      poxAddress,
      burnBlockHeight,
      signerKey,
      signerSignature,
      maxAmount,
      authId,
    });
    const tx = await makeContractCall({
      ...callOptions,
      ...renamePrivateKey(txOptions),
    });

    return broadcastTransaction({ transaction: tx, client: this.client });
  }

  /**
   * `stack-extend`
   *
   * Generate and broadcast a stacking transaction to extend locked STX (`pox-2.stack-extend`)
   * @category PoX-2
   * @param {StackExtendOptions} - a required extend STX options object
   * @returns a broadcasted txid if the operation succeeds
   */
  async stackExtend({
    extendCycles,
    poxAddress,
    signerKey,
    signerSignature,
    maxAmount,
    authId,
    ...txOptions
  }: StackExtendOptions & BaseTxOptions): Promise<TxBroadcastResult> {
    const poxInfo = await this.getPoxInfo();
    const poxOperationInfo = await this.getPoxOperationInfo(poxInfo);

    ensurePox2Activated(poxOperationInfo);
    ensureSignerArgsReadiness({
      contract: poxInfo.contract_id,
      signerKey,
      signerSignature,
      maxAmount,
      authId,
    });

    const callOptions = this.getStackExtendOptions({
      contract: poxInfo.contract_id,
      extendCycles,
      poxAddress,
      signerKey,
      signerSignature,
      maxAmount,
      authId,
    });
    const tx = await makeContractCall({
      ...callOptions,
      ...renamePrivateKey(txOptions),
    });

    return broadcastTransaction({ transaction: tx, client: this.client });
  }

  /**
   * Generate and broadcast a stacking transaction to increase locked STX (`pox-2.stack-increase`)
   * @category PoX-2
   * @param {StackIncreaseOptions} - a required increase STX options object
   * @returns a broadcasted txid if the operation succeeds
   */
  async stackIncrease({
    increaseBy,
    signerKey,
    signerSignature,
    maxAmount,
    authId,
    ...txOptions
  }: StackIncreaseOptions & BaseTxOptions): Promise<TxBroadcastResult> {
    const poxInfo = await this.getPoxInfo();
    const poxOperationInfo = await this.getPoxOperationInfo(poxInfo);
    ensurePox2Activated(poxOperationInfo);
    ensureSignerArgsReadiness({
      contract: poxInfo.contract_id,
      signerKey,
      signerSignature,
      maxAmount,
      authId,
    });

    const callOptions = this.getStackIncreaseOptions({
      contract: poxInfo.contract_id,
      increaseBy,
      signerKey,
      signerSignature,
      maxAmount,
      authId,
    });
    const tx = await makeContractCall({
      ...callOptions,
      ...renamePrivateKey(txOptions),
    });

    return broadcastTransaction({ transaction: tx, client: this.client });
  }

  /**
   * `delegate-stx`
   *
   * As a delegatee, generate and broadcast a transaction to create a delegation relationship
   * @param {DelegateStxOptions} options - a required delegate STX options object
   * @returns {Promise<string>} that resolves to a broadcasted txid if the operation succeeds
   */
  async delegateStx({
    amountMicroStx,
    delegateTo,
    untilBurnBlockHeight,
    poxAddress,
    ...txOptions
  }: // todo: should we provide manual contract definitions? (for users to choose which contract to use)
  DelegateStxOptions & BaseTxOptions): Promise<TxBroadcastResult> {
    const poxInfo = await this.getPoxInfo();
    const poxOperationInfo = await this.getPoxOperationInfo(poxInfo);

    const contract = await this.getStackingContract(poxOperationInfo);
    ensureLegacyBtcAddressForPox1({ contract, poxAddress });

    const callOptions = this.getDelegateOptions({
      contract,
      amountMicroStx,
      delegateTo,
      untilBurnBlockHeight,
      poxAddress,
    });

    const tx = await makeContractCall({
      ...callOptions,
      ...renamePrivateKey(txOptions),
    });

    return broadcastTransaction({ transaction: tx, client: this.client });
  }

  /**
   * `delegate-stack-stx`
   *
   * As a delegator, generate and broadcast transactions to stack for multiple delegatees. This will lock up tokens owned by the delegatees.
   * @param {DelegateStackStxOptions} options - a required delegate stack STX options object
   * @returns {Promise<string>} that resolves to a broadcasted txid if the operation succeeds
   */
  async delegateStackStx({
    stacker,
    amountMicroStx,
    poxAddress,
    burnBlockHeight,
    cycles,
    ...txOptions
  }: DelegateStackStxOptions & BaseTxOptions): Promise<TxBroadcastResult> {
    const poxInfo = await this.getPoxInfo();
    const poxOperationInfo = await this.getPoxOperationInfo(poxInfo);

    const contract = await this.getStackingContract(poxOperationInfo);
    ensureLegacyBtcAddressForPox1({ contract, poxAddress });

    const callOptions = this.getDelegateStackOptions({
      contract,
      stacker,
      amountMicroStx,
      poxAddress,
      burnBlockHeight,
      cycles,
    });
    const tx = await makeContractCall({
      ...callOptions,
      ...renamePrivateKey(txOptions),
    });

    return broadcastTransaction({ transaction: tx, client: this.client });
  }

  /**
   * `delegate-stack-extend`
   *
   * As a delegator, generate and broadcast transactions to extend stack for multiple delegatees.
   * @category PoX-2
   * @param {DelegateStackExtendOptions} options - a required delegate stack extend STX options object
   * @returns {Promise<string>} that resolves to a broadcasted txid if the operation succeeds
   */
  async delegateStackExtend({
    stacker,
    poxAddress,
    extendCount,
    ...txOptions
  }: DelegateStackExtendOptions & BaseTxOptions): Promise<TxBroadcastResult> {
    const poxInfo = await this.getPoxInfo();
    const contract = poxInfo.contract_id;

    const callOptions = this.getDelegateStackExtendOptions({
      contract,
      stacker,
      poxAddress,
      extendCount,
    });
    const tx = await makeContractCall({
      ...callOptions,
      ...renamePrivateKey(txOptions),
    });

    return broadcastTransaction({ transaction: tx, client: this.client });
  }

  /**
   * As a delegator, generate and broadcast transactions to stack increase for multiple delegatees.
   * @category PoX-2
   * @param {DelegateStackIncreaseOptions} - a required delegate stack increase STX options object
   * @returns {Promise<string>} that resolves to a broadcasted txid if the operation succeeds
   */
  async delegateStackIncrease({
    stacker,
    poxAddress,
    increaseBy,
    ...txOptions
  }: DelegateStackIncreaseOptions & BaseTxOptions): Promise<TxBroadcastResult> {
    const poxInfo = await this.getPoxInfo();
    const poxOperationInfo = await this.getPoxOperationInfo(poxInfo);
    ensurePox2Activated(poxOperationInfo);

    const callOptions = this.getDelegateStackIncreaseOptions({
      contract: poxInfo.contract_id,
      stacker,
      poxAddress,
      increaseBy,
    });
    const tx = await makeContractCall({
      ...callOptions,
      ...renamePrivateKey(txOptions),
    });

    return broadcastTransaction({ transaction: tx, client: this.client });
  }

  /**
   * As a delegator, generate and broadcast a transaction to commit partially committed delegatee tokens
   * @param {StackAggregationCommitOptions} options - a required stack aggregation commit options object
   * @returns {Promise<string>} that resolves to a broadcasted txid if the operation succeeds
   */
  async stackAggregationCommit({
    poxAddress,
    rewardCycle,
    signerKey,
    signerSignature,
    maxAmount,
    authId,
    ...txOptions
  }: StackAggregationCommitOptions & BaseTxOptions): Promise<TxBroadcastResult> {
    const contract = await this.getStackingContract();
    ensureLegacyBtcAddressForPox1({ contract, poxAddress });
    ensureSignerArgsReadiness({ contract, signerKey, signerSignature, maxAmount, authId });

    const callOptions = this.getStackAggregationCommitOptions({
      contract,
      poxAddress,
      rewardCycle,
      signerKey,
      signerSignature,
      maxAmount,
      authId,
    });
    const tx = await makeContractCall({
      ...callOptions,
      ...renamePrivateKey(txOptions),
    });

    return broadcastTransaction({ transaction: tx, client: this.client });
  }

  /**
   * As a delegator, generate and broadcast a transaction to commit partially committed delegatee tokens
   *
   * Commit partially stacked STX and allocate a new PoX reward address slot.
   *   This allows a stacker/delegate to lock fewer STX than the minimal threshold in multiple transactions,
   *   so long as: 1. The pox-addr is the same.
   *               2. This "commit" transaction is called _before_ the PoX anchor block.
   *   This ensures that each entry in the reward set returned to the stacks-node is greater than the threshold,
   *   but does not require it be all locked up within a single transaction
   *
   * `stack-aggregation-commit-indexed` returns (ok uint) on success, where the given uint is the reward address's index in the list of reward
   * addresses allocated in this reward cycle. This index can then be passed to `stack-aggregation-increase`
   * to later increment the STX this PoX address represents, in amounts less than the stacking minimum.
   *
   * @category PoX-2
   * @param {StackAggregationCommitOptions} options - a required stack aggregation commit options object
   * @returns {Promise<string>} that resolves to a broadcasted txid if the operation succeeds
   */
  async stackAggregationCommitIndexed({
    poxAddress,
    rewardCycle,
    signerKey,
    signerSignature,
    maxAmount,
    authId,
    ...txOptions
  }: StackAggregationCommitOptions & BaseTxOptions): Promise<TxBroadcastResult> {
    const contract = await this.getStackingContract();
    ensureLegacyBtcAddressForPox1({ contract, poxAddress });
    ensureSignerArgsReadiness({ contract, signerKey, signerSignature, maxAmount, authId });

    const callOptions = this.getStackAggregationCommitOptionsIndexed({
      contract,
      poxAddress,
      rewardCycle,
      signerKey,
      signerSignature,
      maxAmount,
      authId,
    });
    const tx = await makeContractCall({
      ...callOptions,
      ...renamePrivateKey(txOptions),
    });

    return broadcastTransaction({ transaction: tx, client: this.client });
  }

  /**
   * As a delegator, generate and broadcast a transaction to increase partial commitment committed delegatee tokens
   * @param {StackAggregationIncreaseOptions} options - a required stack aggregation increase options object
   * @category PoX-2
   * @returns {Promise<string>} that resolves to a broadcasted txid if the operation succeeds
   */
  async stackAggregationIncrease({
    poxAddress,
    rewardCycle,
    rewardIndex,
    signerKey,
    signerSignature,
    maxAmount,
    authId,
    ...txOptions
  }: StackAggregationIncreaseOptions & BaseTxOptions): Promise<TxBroadcastResult> {
    // todo: deprecate this method in favor of Indexed as soon as PoX-2 is live
    const contract = await this.getStackingContract();
    ensureLegacyBtcAddressForPox1({ contract, poxAddress });
    ensureSignerArgsReadiness({ contract, signerKey, signerSignature, maxAmount, authId });

    const callOptions = this.getStackAggregationIncreaseOptions({
      contract,
      poxAddress,
      rewardCycle,
      rewardCycleIndex: rewardIndex,
      signerKey,
      signerSignature,
      maxAmount,
      authId,
    });
    const tx = await makeContractCall({
      ...callOptions,
      ...renamePrivateKey(txOptions),
    });

    return broadcastTransaction({ transaction: tx, client: this.client });
  }

  /**
   * As a delegatee, generate and broadcast a transaction to terminate the delegation relationship
   * @param {string} privateKey - the private key to be used for the revoke call
   * @returns {Promise<string>} that resolves to a broadcasted txid if the operation succeeds
   */
  async revokeDelegateStx(privateKey: string): Promise<TxBroadcastResult>;
  /**
   * As a delegatee, generate and broadcast a transaction to terminate the delegation relationship
   * @param {BaseTxOptions} txOptions - the private key, fee, and nonce to be used for the revoke call
   * @returns {Promise<string>} that resolves to a broadcasted txid if the operation succeeds
   */
  async revokeDelegateStx(txOptions: BaseTxOptions): Promise<TxBroadcastResult>;
  async revokeDelegateStx(arg: string | BaseTxOptions): Promise<TxBroadcastResult> {
    if (typeof arg === 'string') arg = { privateKey: arg };

    const poxInfo = await this.getPoxInfo();
    const contract = poxInfo.contract_id;

    const callOptions = this.getRevokeDelegateStxOptions(contract);

    const tx = await makeContractCall({
      ...callOptions,
      ...renamePrivateKey(arg),
    });

    return broadcastTransaction({ transaction: tx, client: this.client });
  }

  getStackOptions({
    amountMicroStx,
    poxAddress,
    cycles,
    contract,
    burnBlockHeight,
    signerKey,
    signerSignature,
    maxAmount,
    authId,
  }: {
    cycles: number;
    poxAddress: string;
    amountMicroStx: IntegerType;
    contract: string;
    burnBlockHeight: number;
    signerKey?: string;
    signerSignature?: string;
    maxAmount?: IntegerType;
    authId?: IntegerType;
  }) {
    const address = poxAddressToTuple(poxAddress);
    const [contractAddress, contractName] = this.parseContractId(contract);

    const functionArgs = [
      uintCV(amountMicroStx),
      address,
      uintCV(burnBlockHeight),
      uintCV(cycles),
    ] as ClarityValue[];

    if (signerKey && maxAmount && typeof authId !== 'undefined') {
      functionArgs.push(signerSignature ? someCV(bufferCV(hexToBytes(signerSignature))) : noneCV());
      functionArgs.push(bufferCV(hexToBytes(signerKey)));
      functionArgs.push(uintCV(maxAmount));
      functionArgs.push(uintCV(authId));
    }

    const callOptions: ContractCallOptions = {
      client: this.client,
      contractAddress,
      contractName,
      functionName: 'stack-stx',
      functionArgs,
      validateWithAbi: true,
      network: this.network,
    };
    return callOptions;
  }

  getStackExtendOptions({
    extendCycles,
    poxAddress,
    contract,
    signerKey,
    signerSignature,
    maxAmount,
    authId,
  }: {
    extendCycles: number;
    poxAddress: string;
    contract: string;
    signerKey?: string;
    signerSignature?: string;
    maxAmount?: IntegerType;
    authId?: IntegerType;
  }) {
    const address = poxAddressToTuple(poxAddress);
    const [contractAddress, contractName] = this.parseContractId(contract);

    const functionArgs = [uintCV(extendCycles), address] as ClarityValue[];

    if (signerKey && maxAmount && typeof authId !== 'undefined') {
      functionArgs.push(signerSignature ? someCV(bufferCV(hexToBytes(signerSignature))) : noneCV());
      functionArgs.push(bufferCV(hexToBytes(signerKey)));
      functionArgs.push(uintCV(maxAmount));
      functionArgs.push(uintCV(authId));
    }

    const callOptions: ContractCallOptions = {
      client: this.client,
      contractAddress,
      contractName,
      functionName: 'stack-extend',
      functionArgs,
      validateWithAbi: true,
      network: this.network,
    };
    return callOptions;
  }

  getStackIncreaseOptions({
    increaseBy,
    contract,
    signerKey,
    signerSignature,
    maxAmount,
    authId,
  }: {
    increaseBy: IntegerType;
    contract: string;
    signerKey?: string;
    signerSignature?: string;
    maxAmount?: IntegerType;
    authId?: IntegerType;
  }) {
    const [contractAddress, contractName] = this.parseContractId(contract);

    const functionArgs = [uintCV(increaseBy)] as ClarityValue[];

    if (signerKey && maxAmount && typeof authId !== 'undefined') {
      functionArgs.push(signerSignature ? someCV(bufferCV(hexToBytes(signerSignature))) : noneCV());
      functionArgs.push(bufferCV(hexToBytes(signerKey)));
      functionArgs.push(uintCV(maxAmount));
      functionArgs.push(uintCV(authId));
    }

    const callOptions: ContractCallOptions = {
      client: this.client,
      contractAddress,
      contractName,
      functionName: 'stack-increase',
      functionArgs,
      validateWithAbi: true,
      network: this.network,
    };
    return callOptions;
  }

  getDelegateOptions({
    contract,
    amountMicroStx,
    delegateTo,
    untilBurnBlockHeight,
    poxAddress,
  }: {
    contract: string;
    amountMicroStx: IntegerType;
    delegateTo: string;
    untilBurnBlockHeight?: number;
    poxAddress?: string;
  }) {
    const address = poxAddress ? someCV(poxAddressToTuple(poxAddress)) : noneCV();
    const [contractAddress, contractName] = this.parseContractId(contract);
    const callOptions: ContractCallOptions = {
      client: this.client,
      contractAddress,
      contractName,
      functionName: 'delegate-stx',
      functionArgs: [
        uintCV(amountMicroStx),
        principalCV(delegateTo),
        untilBurnBlockHeight ? someCV(uintCV(untilBurnBlockHeight)) : noneCV(),
        address,
      ],
      validateWithAbi: true,
      network: this.network,
    };
    return callOptions;
  }

  getDelegateStackOptions({
    contract,
    stacker,
    amountMicroStx,
    poxAddress,
    burnBlockHeight,
    cycles,
  }: {
    contract: string;
    stacker: string;
    amountMicroStx: IntegerType;
    poxAddress: string;
    burnBlockHeight: number;
    cycles: number;
  }) {
    const address = poxAddressToTuple(poxAddress);
    const [contractAddress, contractName] = this.parseContractId(contract);

    const callOptions: ContractCallOptions = {
      client: this.client,
      contractAddress,
      contractName,
      functionName: 'delegate-stack-stx',
      functionArgs: [
        principalCV(stacker),
        uintCV(amountMicroStx),
        address,
        uintCV(burnBlockHeight),
        uintCV(cycles),
      ],
      validateWithAbi: true,
      network: this.network,
    };

    return callOptions;
  }

  getDelegateStackExtendOptions({
    contract,
    stacker,
    poxAddress,
    extendCount,
  }: {
    contract: string;
    stacker: string;
    poxAddress: string;
    extendCount: number;
  }) {
    const address = poxAddressToTuple(poxAddress);
    const [contractAddress, contractName] = this.parseContractId(contract);

    const callOptions: ContractCallOptions = {
      client: this.client,
      contractAddress,
      contractName,
      functionName: 'delegate-stack-extend',
      functionArgs: [principalCV(stacker), address, uintCV(extendCount)],
      validateWithAbi: true,
      network: this.network,
    };

    return callOptions;
  }

  getDelegateStackIncreaseOptions({
    contract,
    stacker,
    poxAddress,
    increaseBy,
  }: {
    contract: string;
    stacker: string;
    poxAddress: string;
    increaseBy: IntegerType;
  }) {
    const address = poxAddressToTuple(poxAddress);
    const [contractAddress, contractName] = this.parseContractId(contract);
    const callOptions: ContractCallOptions = {
      client: this.client,
      contractAddress,
      contractName,
      functionName: 'delegate-stack-increase',
      functionArgs: [principalCV(stacker), address, uintCV(increaseBy)],
      validateWithAbi: true,
      network: this.network,
    };

    return callOptions;
  }

  getStackAggregationCommitOptions({
    contract,
    poxAddress,
    rewardCycle,
    signerKey,
    signerSignature,
    maxAmount,
    authId,
  }: {
    contract: string;
    poxAddress: string;
    rewardCycle: number;
    signerKey?: string;
    signerSignature?: string;
    maxAmount?: IntegerType;
    authId?: IntegerType;
  }) {
    const address = poxAddressToTuple(poxAddress);
    const [contractAddress, contractName] = this.parseContractId(contract);

    const functionArgs = [address, uintCV(rewardCycle)] as ClarityValue[];

    if (signerKey && maxAmount && typeof authId !== 'undefined') {
      functionArgs.push(signerSignature ? someCV(bufferCV(hexToBytes(signerSignature))) : noneCV());
      functionArgs.push(bufferCV(hexToBytes(signerKey)));
      functionArgs.push(uintCV(maxAmount));
      functionArgs.push(uintCV(authId));
    }

    const callOptions: ContractCallOptions = {
      client: this.client,
      contractAddress,
      contractName,
      functionName: 'stack-aggregation-commit',
      functionArgs,
      validateWithAbi: true,
      network: this.network,
    };
    return callOptions;
  }

  getStackAggregationIncreaseOptions({
    contract,
    poxAddress,
    rewardCycle,
    rewardCycleIndex,
    signerKey,
    signerSignature,
    maxAmount,
    authId,
  }: {
    contract: string;
    poxAddress: string;
    rewardCycle: number;
    rewardCycleIndex: number;
    signerKey?: string;
    signerSignature?: string;
    maxAmount?: IntegerType;
    authId?: IntegerType;
  }) {
    const address = poxAddressToTuple(poxAddress);
    const [contractAddress, contractName] = this.parseContractId(contract);

    const functionArgs = [address, uintCV(rewardCycle), uintCV(rewardCycleIndex)] as ClarityValue[];

    if (signerKey && maxAmount && typeof authId !== 'undefined') {
      functionArgs.push(signerSignature ? someCV(bufferCV(hexToBytes(signerSignature))) : noneCV());
      functionArgs.push(bufferCV(hexToBytes(signerKey)));
      functionArgs.push(uintCV(maxAmount));
      functionArgs.push(uintCV(authId));
    }

    const callOptions: ContractCallOptions = {
      client: this.client,
      contractAddress,
      contractName,
      functionName: 'stack-aggregation-increase',
      functionArgs,
      validateWithAbi: true,
      network: this.network,
    };
    return callOptions;
  }

  getStackAggregationCommitOptionsIndexed({
    contract,
    poxAddress,
    rewardCycle,
    signerKey,
    signerSignature,
    maxAmount,
    authId,
  }: {
    contract: string;
    poxAddress: string;
    rewardCycle: number;
    signerKey?: string;
    signerSignature?: string;
    maxAmount?: IntegerType;
    authId?: IntegerType;
  }) {
    const address = poxAddressToTuple(poxAddress);
    const [contractAddress, contractName] = this.parseContractId(contract);

    const functionArgs = [address, uintCV(rewardCycle)] as ClarityValue[];

    if (signerKey && maxAmount && typeof authId !== 'undefined') {
      functionArgs.push(signerSignature ? someCV(bufferCV(hexToBytes(signerSignature))) : noneCV());
      functionArgs.push(bufferCV(hexToBytes(signerKey)));
      functionArgs.push(uintCV(maxAmount));
      functionArgs.push(uintCV(authId));
    }

    const callOptions: ContractCallOptions = {
      client: this.client,
      contractAddress,
      contractName,
      functionName: 'stack-aggregation-commit-indexed',
      functionArgs,
      validateWithAbi: true,
      network: this.network,
    };
    return callOptions;
  }

  getRevokeDelegateStxOptions(contract: string) {
    const [contractAddress, contractName] = this.parseContractId(contract);
    const callOptions: ContractCallOptions = {
      client: this.client,
      contractAddress,
      contractName,
      functionName: 'revoke-delegate-stx',
      functionArgs: [],
      validateWithAbi: true,
      network: this.network,
    };
    return callOptions;
  }

  /**
   * Check stacking status
   *
   * @returns {Promise<StackerInfo>} that resolves to a StackerInfo object if the operation succeeds
   */
  async getStatus(): Promise<StackerInfo> {
    const poxInfo = await this.getPoxInfo();
    const [contractAddress, contractName] = this.parseContractId(poxInfo.contract_id);
    const account = await this.getAccountStatus();
    const functionName = 'get-stacker-info';

    return fetchCallReadOnlyFunction({
      contractAddress,
      contractName,
      functionName,
      senderAddress: this.address,
      functionArgs: [principalCV(this.address)],
      client: this.client,
    }).then((responseCV: ClarityValue) => {
      if (responseCV.type === ClarityType.OptionalSome) {
        const someCV = responseCV;
        const tupleCV: TupleCV = someCV.value as TupleCV;
        const poxAddress: TupleCV = tupleCV.value['pox-addr'] as TupleCV;
        const firstRewardCycle: UIntCV = tupleCV.value['first-reward-cycle'] as UIntCV;
        const lockPeriod: UIntCV = tupleCV.value['lock-period'] as UIntCV;
        const version: BufferCV = poxAddress.value['version'] as BufferCV;
        const hashbytes: BufferCV = poxAddress.value['hashbytes'] as BufferCV;

        return {
          stacked: true,
          details: {
            first_reward_cycle: Number(firstRewardCycle.value),
            lock_period: Number(lockPeriod.value),
            unlock_height: account.unlock_height,
            pox_address: {
              version: hexToBytes(version.value),
              hashbytes: hexToBytes(hashbytes.value),
            },
          },
        };
      } else if (responseCV.type === ClarityType.OptionalNone) {
        return {
          stacked: false,
        };
      } else {
        throw new Error(`Error fetching stacker info`);
      }
    });
  }

  /**
   * Check delegation status
   *
   * @returns {Promise<DelegationInfo>} that resolves to a DelegationInfo object if the operation succeeds
   */
  async getDelegationStatus(): Promise<DelegationInfo> {
    const poxInfo = await this.getPoxInfo();
    const [contractAddress, contractName] = this.parseContractId(poxInfo.contract_id);
    const functionName = 'get-delegation-info';

    return fetchCallReadOnlyFunction({
      contractAddress,
      contractName,
      functionName,
      functionArgs: [principalCV(this.address)],
      senderAddress: this.address,
      client: this.client,
    }).then((responseCV: ClarityValue) => {
      if (responseCV.type === ClarityType.OptionalSome) {
        const tupleCV = responseCV.value as TupleCV;
        const amountMicroStx = tupleCV.value['amount-ustx'] as UIntCV;
        const delegatedTo = tupleCV.value['delegated-to'] as PrincipalCV;

        const poxAddress = unwrapMap(tupleCV.value['pox-addr'] as OptionalCV<TupleCV>, tuple => ({
          version: hexToBytes((tuple.value['version'] as BufferCV).value)[0],
          hashbytes: hexToBytes((tuple.value['hashbytes'] as BufferCV).value),
        }));
        const untilBurnBlockHeight = unwrap(tupleCV.value['until-burn-ht'] as OptionalCV<UIntCV>);

        return {
          delegated: true,
          details: {
            amount_micro_stx: BigInt(amountMicroStx.value),
            delegated_to: delegatedTo.value,
            pox_address: poxAddress,
            until_burn_ht: untilBurnBlockHeight ? Number(untilBurnBlockHeight.value) : undefined,
          },
        };
      } else if (responseCV.type === ClarityType.OptionalNone) {
        return {
          delegated: false,
        };
      } else {
        throw new Error(`Error fetching delegation info`);
      }
    });
  }

  /**
   * Call the `verify-signer-key-sig` read-only function on the PoX contract.
   * @returns (async) a boolean indicating if the signature is valid
   */
  async verifySignerKeySignature({
    topic,
    poxAddress,
    rewardCycle,
    period,
    signerSignature,
    signerKey,
    amount,
    maxAmount,
    authId,
  }: {
    topic: string;
    poxAddress: string;
    rewardCycle: number;
    period: number;
    signerSignature?: string;
    signerKey: string;
    amount: IntegerType;
    maxAmount: IntegerType;
    authId: IntegerType;
  }): Promise<boolean> {
    const poxInfo = await this.getPoxInfo();

    const [contractAddress, contractName] = this.parseContractId(poxInfo.contract_id);
    const functionName = 'verify-signer-key-sig';

    const functionArgs = [
      poxAddressToTuple(poxAddress),
      uintCV(rewardCycle),
      stringAsciiCV(topic),
      uintCV(period),
      signerSignature ? someCV(bufferCV(hexToBytes(signerSignature))) : noneCV(),
      bufferCV(hexToBytes(signerKey)),
      uintCV(amount),
      uintCV(maxAmount),
      uintCV(authId),
    ];

    return fetchCallReadOnlyFunction({
      contractAddress,
      contractName,
      functionName,
      functionArgs,
      senderAddress: this.address,
      client: this.client,
    }).then(responseCV => responseCV.type === ClarityType.ResponseOk);
  }

  /**
   * @returns {Promise<string>} that resolves to the contract id (address and name) to use for stacking
   */
  async getStackingContract(poxOperationInfo?: PoxOperationInfo): Promise<string> {
    poxOperationInfo = poxOperationInfo ?? (await this.getPoxOperationInfo());
    switch (poxOperationInfo.period) {
      case PoxOperationPeriod.Period1:
        return poxOperationInfo.pox1.contract_id;
      case PoxOperationPeriod.Period2a:
      case PoxOperationPeriod.Period2b:
        // in the 2.1 fork we can always stack to PoX-2
        return poxOperationInfo.pox2.contract_id;
      case PoxOperationPeriod.Period3:
      default:
        return poxOperationInfo.current.contract_id;
    }
  }

  /**
   * Adjust microstacks amount for locking after taking into account transaction fees
   *
   * @returns {StacksTransactionWire} that resolves to a transaction object if the operation succeeds
   */
  modifyLockTxFee({
    tx,
    amountMicroStx,
  }: {
    tx: StacksTransactionWire;
    amountMicroStx: IntegerType;
  }) {
    const fee = getFee(tx.auth);
    (tx.payload as ContractCallPayload).functionArgs[0] = uintCV(intToBigInt(amountMicroStx) - fee);
    return tx;
  }

  /**
   * Parses a contract identifier and ensures it is formatted correctly
   *
   * @returns {Array<string>} a contract address and name
   */
  parseContractId(contract: string): string[] {
    // todo: move this function to a standalone utility, and @ignore deprecate it here
    const parts = contract.split('.');

    if (parts.length === 2 && validateStacksAddress(parts[0]) && parts[1].startsWith('pox')) {
      return parts;
    }

    throw new Error('Stacking contract ID is malformed');
  }

  /**
   * Generates a `signer-sig` string for the current PoX contract.
   */
  signPoxSignature({
    topic,
    poxAddress,
    rewardCycle,
    period,
    signerPrivateKey,
    authId,
    maxAmount,
  }: {
    topic: `${Pox4SignatureTopic}`;
    poxAddress: string;
    rewardCycle: number;
    period: number;
    signerPrivateKey: PrivateKey;
    maxAmount: IntegerType;
    authId: IntegerType;
  }) {
    // todo: in the future add logic to determine if a later version of pox
    // needs a different domain and thus use a different `signPox4SignatureHash`
    return signPox4SignatureHash({
      topic,
      poxAddress,
      rewardCycle,
      period,
      network: this.network,
      privateKey: signerPrivateKey,
      maxAmount,
      authId,
    });
  }
}

/** @ignore Rename `privateKey` to `senderKey`, for backwards compatibility */
function renamePrivateKey(txOptions: BaseTxOptions) {
  // @ts-ignore
  txOptions.senderKey = txOptions.privateKey;
  // @ts-ignore
  delete txOptions.privateKey;
  return txOptions as any as {
    fee?: IntegerType;
    nonce?: IntegerType;
    senderKey: string;
  };
}

/** @beta @ignore Type export subject to change*/
export interface V2CoreInfoResponse {
  burn_block_height: number;
  stable_pox_consensus: string;
}

/** @beta @ignore Type export subject to change*/
export interface CycleInfoResponse {
  id: number;
  min_threshold_ustx: number;
  stacked_ustx: number;
  is_pox_active: boolean;
}

/** @beta @ignore Type export subject to change*/
export interface ContractVersionResponse {
  contract_id: ContractIdString;
  activation_burnchain_block_height: number;
  first_reward_cycle_id: number;
}

/** @beta @ignore Type export subject to change*/
export interface V2PoxInfoResponse {
  contract_id: string;
  contract_versions: ContractVersionResponse[];
  current_burnchain_block_height?: number;
  first_burnchain_block_height: number;
  min_amount_ustx: string;
  next_reward_cycle_in: number;
  prepare_cycle_length: number;
  prepare_phase_block_length: number;
  rejection_fraction: number;
  rejection_votes_left_required: number;
  reward_cycle_id: number;
  reward_cycle_length: number;
  reward_phase_block_length: number;
  reward_slots: number;
  current_cycle: CycleInfoResponse;
  next_cycle: CycleInfoResponse & {
    min_increment_ustx: number;
    prepare_phase_start_block_height: number;
    blocks_until_prepare_phase: number;
    reward_phase_start_block_height: number;
    blocks_until_reward_phase: number;
    ustx_until_pox_rejection: number;
  };
}

/** @beta @ignore Type export subject to change*/
export interface V1InfoBlockTimesResponse {
  mainnet: {
    target_block_time: number;
  };
  testnet: {
    target_block_time: number;
  };
}

/** @beta @ignore Type export subject to change*/
export interface ExtendedAccountBalancesResponse {
  stx: {
    balance: string;
    total_sent: string;
    total_received: string;
    locked: string;
    lock_tx_id: string;
    lock_height: number;
    burnchain_lock_height: number;
    burnchain_unlock_height: number;
  };
  fungible_tokens: any;
  non_fungible_tokens: any;
}

/** @beta @ignore Type export subject to change*/
export interface ExtendedAccountBalances {
  stx: {
    balance: bigint;
    total_sent: bigint;
    total_received: bigint;
    locked: bigint;
    lock_tx_id: string;
    lock_height: number;
    burnchain_lock_height: number;
    burnchain_unlock_height: number;
  };
  fungible_tokens: any;
  non_fungible_tokens: any;
}

/** @beta @ignore Type export subject to change*/
export interface PaginationOptions {
  limit: number;
  offset: number;
}

/** @beta @ignore Type export subject to change*/
export interface BaseErrorResponse {
  error: string;
}
