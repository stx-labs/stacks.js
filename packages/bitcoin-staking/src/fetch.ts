import type { NetworkClientParam } from '@stacks/network';
import { clientFromNetwork, networkFrom } from '@stacks/network';
import {
  Cl,
  ClarityType,
  type ClarityValue,
  type OptionalCV,
  type TupleCV,
  type UIntCV,
  type BufferCV,
  type ResponseCV,
  fetchCallReadOnlyFunction,
} from '@stacks/transactions';
import { stringify as btcAddressStringify } from './btc-address';
import { CONTRACT_ADDRESS, CONTRACT_NAME } from './constants';
import type { PoxInfo, StakerInfo } from './types';

// ---------------------------------------------------------------------------
// Public fetch functions
// ---------------------------------------------------------------------------

/** Fetch PoX info from the `/v2/pox` node endpoint. */
export async function fetchPoxInfo(opts: NetworkClientParam = {}): Promise<PoxInfo> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const client = clientFromNetwork(network);
  const fetchFn = client.fetch;
  const url = `${client.baseUrl}/v2/pox`;
  const response = await fetchFn(url);
  const data = await response.json();

  return {
    contractId: data.contract_id,
    currentBurnchainBlockHeight: data.current_burnchain_block_height,
    firstBurnchainBlockHeight: data.first_burnchain_block_height,
    rewardCycleId: data.reward_cycle_id,
    rewardCycleLength: data.reward_cycle_length,
    prepareCycleLength: data.prepare_cycle_length,
    rewardSlots: data.reward_slots,
    currentCycle: {
      id: data.current_cycle.id,
      stakedUstx: BigInt(data.current_cycle.stacked_ustx),
      isPoxActive: data.current_cycle.is_pox_active,
    },
    nextCycle: {
      id: data.next_cycle.id,
      stakedUstx: BigInt(data.next_cycle.stacked_ustx),
      isPoxActive: data.next_cycle.is_pox_active,
    },
  };
}

/**
 * Fetch staker info for a given STX address via the `get-staker-info` read-only call.
 * Returns a discriminated union: `{ staked: false }` or `{ staked: true, details: ... }`.
 */
export async function fetchStakerInfo(
  opts: { address: string } & NetworkClientParam
): Promise<StakerInfo> {
  const result = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: 'get-staker-info',
    functionArgs: [Cl.address(opts.address)],
    senderAddress: opts.address,
    network: opts.network,
    client: opts.client,
  });

  const optional = result as OptionalCV<TupleCV>;
  if (optional.type === ClarityType.OptionalNone) return { staked: false };

  const tuple = optional.value;
  const numCycles = Number((tuple.value['num-cycles'] as UIntCV).value);
  const amountUstx = BigInt((tuple.value['amount-ustx'] as UIntCV).value);
  const firstRewardCycle = Number((tuple.value['first-reward-cycle'] as UIntCV).value);
  const unlockBytesHex = (tuple.value['unlock-bytes'] as BufferCV).value;

  // Discriminate solo vs pooled via the `pool-or-solo-info` response field
  const poolOrSolo = tuple.value['pool-or-solo-info'] as ResponseCV;

  if (poolOrSolo.type === ClarityType.ResponseOk) {
    // pooled — ok value is the pool owner principal
    const poolOwner = (poolOrSolo.value as ClarityValue & { value: string }).value;
    return {
      staked: true,
      details: {
        type: 'pooled',
        numCycles,
        amountUstx,
        firstRewardCycle,
        unlockBytesHex,
        poolOwner,
      },
    };
  }

  // solo — err value is the solo info tuple
  const soloTuple = poolOrSolo.value as TupleCV;
  const poxAddr = soloTuple.value['pox-addr'] as TupleCV;
  const signerKey = (soloTuple.value['signer-key'] as BufferCV).value;
  const poxAddress = btcAddressStringify(poxAddr, opts.network ?? 'mainnet');

  return {
    staked: true,
    details: {
      type: 'solo',
      numCycles,
      amountUstx,
      firstRewardCycle,
      unlockBytesHex,
      poxAddress,
      signerKey,
    },
  };
}

/** Check whether an address is staking in a specific cycle. */
export async function fetchStakerInCycle(
  opts: { address: string; cycle: number } & NetworkClientParam
): Promise<boolean> {
  const result = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: 'get-staker-in-cycle',
    functionArgs: [Cl.address(opts.address), Cl.uint(opts.cycle)],
    senderAddress: opts.address,
    network: opts.network,
    client: opts.client,
  });

  return (result as OptionalCV).type === ClarityType.OptionalSome;
}
