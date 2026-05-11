import { hexToBigInt } from '@stacks/common';
import type { NetworkClientParam } from '@stacks/network';
import { clientFromNetwork, networkFrom } from '@stacks/network';
import {
  Cl,
  ClarityType,
  type OptionalCV,
  type TupleCV,
  type UIntCV,
  type BufferCV,
  fetchCallReadOnlyFunction,
  fetchContractMapEntry,
} from '@stacks/transactions';
import { POX5_CONTRACT_NAME } from './constants';
import type {
  AccountStatus,
  Bond,
  BondMembership,
  ClaimableRewards,
  PoxInfo,
  RewardsLeg,
  StakerInfo,
} from './types';

// ---------------------------------------------------------------------------
// Public fetch functions
// ---------------------------------------------------------------------------

/** Wraps the `/v2/pox` node endpoint. */
export async function fetchPoxInfo(opts: NetworkClientParam = {}): Promise<PoxInfo> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const client = Object.assign({}, clientFromNetwork(network), opts.client);
  const url = `${client.baseUrl}/v2/pox`;
  const response = await client.fetch(url);
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
 * Wraps the contract's `get-staker-info` read-only.
 *
 * Returns only the lock dimensions (`amount-ustx`, `first-reward-cycle`,
 * `num-cycles`). Pool/solo discrimination, signer key, and BTC reward address
 * are NOT exposed here — they live in `staker-signer-cycle-memberships` /
 * `get-signer-cycle-membership` and need separate fetchers.
 */
export async function fetchStakerInfo(
  opts: { address: string } & NetworkClientParam
): Promise<StakerInfo> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-staker-info',
    functionArgs: [Cl.address(opts.address)],
    senderAddress: opts.address,
    network: opts.network,
    client: opts.client,
  });

  const optional = result as OptionalCV<TupleCV>;
  if (optional.type === ClarityType.OptionalNone) return { staked: false };

  const tuple = optional.value;
  return {
    staked: true,
    details: {
      amountUstx: BigInt((tuple.value['amount-ustx'] as UIntCV).value),
      firstRewardCycle: Number((tuple.value['first-reward-cycle'] as UIntCV).value),
      numCycles: Number((tuple.value['num-cycles'] as UIntCV).value),
    },
  };
}

/**
 * Wraps the contract's `allowance-contract-callers` map.
 *
 * Returns whether `sender` has authorized `contractCaller` to call PoX-5
 * methods on its behalf, honoring the optional expiry burn-height stored in
 * the grant. An authorization is in effect when an entry exists in the map
 * and either has no expiry or the current burn-block height has not yet
 * reached the expiry.
 */
export async function fetchAllowanceContractCallers(
  opts: { sender: string; contractCaller: string; poxInfo?: PoxInfo } & NetworkClientParam
): Promise<{ callerAllowed: boolean; callerExpiryHeight?: number }> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const entry = await fetchContractMapEntry({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    mapName: 'allowance-contract-callers',
    mapKey: Cl.tuple({
      sender: Cl.address(opts.sender),
      'contract-caller': Cl.address(opts.contractCaller),
    }),
    network: opts.network,
    client: opts.client,
  });

  // Map values are wrapped in (some ...) by the API; missing entries are
  // returned as `none`.
  const optional = entry as OptionalCV;
  if (optional.type === ClarityType.OptionalNone) return { callerAllowed: false };

  // Map value type is `(optional uint)`: outer Some wraps the stored
  // expiry-burn-ht (or inner None for "no expiry").
  const expiry = optional.value as OptionalCV<UIntCV>;
  if (expiry.type === ClarityType.OptionalNone) return { callerAllowed: true };

  const expiryHeight = Number(expiry.value.value);

  // If the caller provided a PoxInfo, use it. Otherwise, fetch it from the network.
  const poxInfo =
    opts.poxInfo ?? (await fetchPoxInfo({ network: opts.network, client: opts.client }));

  return {
    callerAllowed: poxInfo.currentBurnchainBlockHeight < expiryHeight,
    callerExpiryHeight: expiryHeight,
  };
}

/**
 * Wraps the `/v2/accounts/<addr>` node endpoint.
 *
 * Returned values use `bigint` (STX values are too large to safely round-trip
 * through `number`). `unlockHeight` is `0` when no lock is active.
 */
export async function fetchAccountStatus(
  opts: { address: string } & NetworkClientParam
): Promise<AccountStatus> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const client = Object.assign({}, clientFromNetwork(network), opts.client);
  const url = `${client.baseUrl}/v2/accounts/${opts.address}?proof=0`;
  const response = await client.fetch(url);
  const data = await response.json();

  return {
    balance: hexToBigInt(data.balance),
    locked: hexToBigInt(data.locked),
    nonce: BigInt(data.nonce ?? 0),
    unlockHeight: Number(data.unlock_height ?? 0),
  };
}

/**
 * Wraps the contract's `get-bond-membership` read-only.
 *
 * Returns `undefined` when no active membership exists (either no entry, or
 * the bond's unlock cycle has been reached — the contract collapses both
 * cases to `none`).
 */
export async function fetchBondMembership(
  opts: { address: string } & NetworkClientParam
): Promise<BondMembership | undefined> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-bond-membership',
    functionArgs: [Cl.address(opts.address)],
    senderAddress: opts.address,
    network: opts.network,
    client: opts.client,
  });

  const optional = result as OptionalCV<TupleCV>;
  if (optional.type === ClarityType.OptionalNone) return undefined;

  const tuple = optional.value;
  return {
    bondIndex: Number((tuple.value['bond-index'] as UIntCV).value),
    amountSats: BigInt((tuple.value['amount-sats'] as UIntCV).value),
    amountUstx: BigInt((tuple.value['amount-ustx'] as UIntCV).value),
    rewardPerSharePaid: BigInt((tuple.value['reward-per-share-paid'] as UIntCV).value),
  };
}

/**
 * Wraps the contract's `get-staker-shares-staked-for-cycle` read-only.
 *
 * Per-staker share contributed to a given signer in a given cycle. Useful for
 * dashboards rendering a per-signer breakdown when a staker is delegated
 * across multiple signers.
 *
 * - `index` is a reward cycle when `isBond` is `false`, or a bond index when
 *   `isBond` is `true`.
 * - For STX-only cycles the share is denominated in uSTX; for bonds it is
 *   denominated in sats.
 */
export async function fetchStakerSharesStakedForCycle(
  opts: {
    staker: string;
    signer: string;
    index: number;
    isBond: boolean;
  } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-staker-shares-staked-for-cycle',
    functionArgs: [
      Cl.address(opts.staker),
      Cl.uint(opts.index),
      Cl.bool(opts.isBond),
      Cl.address(opts.signer),
    ],
    senderAddress: opts.staker,
    network: opts.network,
    client: opts.client,
  });

  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `protocol-bonds` map.
 *
 * Returns the static configuration of a protocol bond, or `undefined` if the
 * bond has not been set up.
 *
 * `openBurnHeight` / `firstRewardCycle` are NOT included — they are
 * deterministic functions of `bondIndex`, `firstBondPeriodCycle`, and the pox
 * params. Compose with {@link bondPeriodToBurnHeight} /
 * {@link bondPeriodToRewardCycle} from `cycles.ts` when needed.
 *
 * Does NOT populate `capacitySats` — the contract does not expose total
 * allowlist capacity as a single read; sum `protocol-bond-allowances`
 * separately if needed.
 */
export async function fetchBond(
  opts: { bondIndex: number } & NetworkClientParam
): Promise<Bond | undefined> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const bondEntry = await fetchContractMapEntry({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    mapName: 'protocol-bonds',
    mapKey: Cl.uint(opts.bondIndex),
    network: opts.network,
    client: opts.client,
  });

  const optional = bondEntry as OptionalCV<TupleCV>;
  if (optional.type === ClarityType.OptionalNone) return undefined;

  const tuple = optional.value;
  const targetRate = (tuple.value['target-rate'] as UIntCV).value;
  const stxValueRatio = (tuple.value['stx-value-ratio'] as UIntCV).value;
  const minUstxRatio = (tuple.value['min-ustx-ratio'] as UIntCV).value;
  const earlyUnlockSigners = (tuple.value['early-unlock-signers'] as BufferCV).value as string;

  return {
    bondIndex: opts.bondIndex,
    targetRateBps: Number(targetRate),
    stxValueRatio: BigInt(stxValueRatio),
    minUstxRatioBps: Number(minUstxRatio),
    earlyUnlockSigners,
  };
}

/**
 * Wraps the contract's `get-total-sats-staked-for-bond` read-only.
 *
 * Returns `0n` when no entry exists.
 */
export async function fetchTotalSatsStakedForBond(
  opts: { bondIndex: number } & NetworkClientParam
): Promise<bigint> {
  // todo: improvement for api, this could be added to a bond lookup endpoint, then becomes unneeded
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-total-sats-staked-for-bond',
    functionArgs: [Cl.uint(opts.bondIndex)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `protocol-bond-allowances` map.
 *
 * Returns the staker's allowlisted sats allocation for a bond, or `0n` when
 * the staker is not on the bond's allowlist (no entry => not allowed).
 */
export async function fetchBondAllowance(
  opts: { bondIndex: number; address: string } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const entry = await fetchContractMapEntry({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    mapName: 'protocol-bond-allowances',
    mapKey: Cl.tuple({
      'bond-index': Cl.uint(opts.bondIndex),
      staker: Cl.address(opts.address),
    }),
    network: opts.network,
    client: opts.client,
  });

  const optional = entry as OptionalCV<UIntCV>;
  if (optional.type === ClarityType.OptionalNone) return 0n;
  return BigInt(optional.value.value);
}

// ---------------------------------------------------------------------------
// Reward / distribution reads
// ---------------------------------------------------------------------------

/**
 * Wraps the contract's `current-distribution-cycle` read-only.
 *
 * Distribution cycles tick twice per signer reward cycle (every
 * `pox-reward-cycle-length / 2` burn blocks ≈ 1,050 blocks). Zero-indexed at
 * `first-burnchain-block-height`.
 */
export async function fetchCurrentDistributionCycle(
  opts: NetworkClientParam = {}
): Promise<number> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'current-distribution-cycle',
    functionArgs: [],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return Number((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-signer-shares-staked-for-cycle` read-only for a
 * paired-BTC bond.
 *
 * Per-signer share total contributed to a given bond, denominated in sats.
 */
export async function fetchSignerSharesStakedByBond(
  opts: {
    signerManager: string;
    bondIndex: number;
  } & NetworkClientParam
): Promise<bigint> {
  return fetchSignerSharesStakedRead({ ...opts, index: opts.bondIndex, isBond: true });
}

/**
 * Wraps the contract's `get-signer-shares-staked-for-cycle` read-only for an
 * STX-only cycle.
 *
 * Per-signer share total contributed in a given reward cycle, denominated
 * in uSTX.
 */
export async function fetchSignerSharesStakedByCycle(
  opts: {
    signerManager: string;
    rewardCycle: number;
  } & NetworkClientParam
): Promise<bigint> {
  return fetchSignerSharesStakedRead({ ...opts, index: opts.rewardCycle, isBond: false });
}

/** @ignore */
async function fetchSignerSharesStakedRead(
  opts: { signerManager: string; index: number; isBond: boolean } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-signer-shares-staked-for-cycle',
    functionArgs: [Cl.address(opts.signerManager), Cl.uint(opts.index), Cl.bool(opts.isBond)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-signer-rewards-paid-for-cycle` read-only for a
 * paired-BTC bond.
 *
 * Lifetime sBTC rewards already paid out to a signer for the bond. The
 * contract increments this counter inside `update-claimable-rewards` by the
 * most-recently-pulled `rewards-pending`, so the value reflects all prior
 * `claim-rewards` calls for that `(signer, bondIndex)` pair.
 */
export async function fetchSignerRewardsPaidByBond(
  opts: {
    signerManager: string;
    bondIndex: number;
  } & NetworkClientParam
): Promise<bigint> {
  return fetchSignerRewardsPaidRead({ ...opts, index: opts.bondIndex, isBond: true });
}

/**
 * Wraps the contract's `get-signer-rewards-paid-for-cycle` read-only for an
 * STX-only cycle.
 *
 * Lifetime sBTC rewards already paid out to a signer for the cycle. The
 * contract increments this counter inside `update-claimable-rewards` by the
 * most-recently-pulled `rewards-pending`, so the value reflects all prior
 * `claim-rewards` calls for that `(signer, rewardCycle)` pair.
 */
export async function fetchSignerRewardsPaidByCycle(
  opts: {
    signerManager: string;
    rewardCycle: number;
  } & NetworkClientParam
): Promise<bigint> {
  return fetchSignerRewardsPaidRead({ ...opts, index: opts.rewardCycle, isBond: false });
}

/** @ignore */
async function fetchSignerRewardsPaidRead(
  opts: { signerManager: string; index: number; isBond: boolean } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-signer-rewards-paid-for-cycle',
    functionArgs: [Cl.address(opts.signerManager), Cl.uint(opts.index), Cl.bool(opts.isBond)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/** Wraps the contract's `get-claimable-rewards` read-only for a paired-BTC bond leg. */
async function fetchClaimableRewardsByBond(
  opts: {
    signerManager: string;
    bondIndex: number;
  } & NetworkClientParam
): Promise<RewardsLeg> {
  return fetchClaimableRewardsRead({ ...opts, index: opts.bondIndex, isBond: true });
}

/** Wraps the contract's `get-claimable-rewards` read-only for an STX-only cycle leg. */
async function fetchClaimableRewardsByCycle(
  opts: {
    signerManager: string;
    rewardCycle: number;
  } & NetworkClientParam
): Promise<RewardsLeg> {
  return fetchClaimableRewardsRead({ ...opts, index: opts.rewardCycle, isBond: false });
}

/** @ignore */
async function fetchClaimableRewardsRead(
  opts: { signerManager: string; index: number; isBond: boolean } & NetworkClientParam
): Promise<RewardsLeg> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-claimable-rewards',
    functionArgs: [Cl.address(opts.signerManager), Cl.uint(opts.index), Cl.bool(opts.isBond)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  const tuple = result as TupleCV;
  return {
    rewardsPaid: BigInt((tuple.value['rewards-paid'] as UIntCV).value),
    rewardsPending: BigInt((tuple.value['rewards-pending'] as UIntCV).value),
    sharesStaked: BigInt((tuple.value['shares-staked'] as UIntCV).value),
    rewardsPerShare: BigInt((tuple.value['rewards-per-share'] as UIntCV).value),
  };
}

/**
 * Fetch the structured claimable-rewards breakdown for a signer-manager,
 * matching the inputs of the contract's `claim-rewards` public function:
 * one STX-only leg keyed by `rewardCycle` and 0..6 bond legs keyed by
 * `bondIndices`.
 *
 * Each on-chain `get-claimable-rewards` call returns a 4-field tuple
 * (`rewards-paid, rewards-pending, shares-staked, rewards-per-share`); this
 * helper aggregates those legs into a single structured payload. Bond legs
 * additionally carry the `bondIndex` (mirroring how `claim-rewards`'s
 * `print` event tags each leg).
 */
export async function fetchClaimableRewards(
  opts: {
    signerManager: string;
    rewardCycle: number;
    bondIndices?: number[];
  } & NetworkClientParam
): Promise<ClaimableRewards> {
  const bondIndices = opts.bondIndices ?? [];
  const [stxRewards, ...bondLegs] = await Promise.all([
    fetchClaimableRewardsByCycle({
      signerManager: opts.signerManager,
      rewardCycle: opts.rewardCycle,
      network: opts.network,
      client: opts.client,
    }),
    ...bondIndices.map(bondIndex =>
      fetchClaimableRewardsByBond({
        signerManager: opts.signerManager,
        bondIndex,
        network: opts.network,
        client: opts.client,
      })
    ),
  ]);

  return {
    stxRewards,
    bondRewards: bondLegs.map((leg, i) => ({
      ...leg,
      bondIndex: bondIndices[i],
    })),
  };
}

// todo: flow 13 (paired-BTC early exit) — `fetchEarlyExitStatus`.
// todo: flow 14 (watchdog) — `fetchLockStatus`, `collectSpendProof`.
// todo: flow 15 (andon cord) — `fetchLastRewardComputeHeight`, `fetchPayoutWindow`.
