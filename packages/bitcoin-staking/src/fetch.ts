import { hexToBytes } from '@stacks/common';
import type { NetworkClientParam } from '@stacks/network';
import { clientFromNetwork, networkFrom } from '@stacks/network';
import {
  type BooleanCV,
  Cl,
  ClarityType,
  type ClarityValue,
  type OptionalCV,
  type TupleCV,
  type UIntCV,
  type BufferCV,
  type ResponseCV,
  fetchCallReadOnlyFunction,
  fetchContractMapEntry,
} from '@stacks/transactions';
import { stringify as btcAddressStringify } from './btc-address';
import { CONTRACT_ADDRESS, CONTRACT_NAME } from './constants';
import type {
  AccountStatus,
  Bond,
  BondMembership,
  ClaimableRewards,
  EarlyExitStatus,
  LockStatus,
  PayoutWindow,
  PoxInfo,
  RewardsLeg,
  StakerInfo,
} from './types';

/**
 * Pause window length (in burn blocks) for the andon-cord halt path.
 *
 * Per `notes/pox-5-design.md` "Andon Cord" / White Paper §4.4 / Launch
 * Scope D19. NOT enforced by `pox-5.clar` (2026-05-04) — see
 * `unsure/flow-15.md`. Surfaced here so callers and tests share one
 * constant.
 */
const ANDON_CORD_PAUSE_BLOCKS = 250;

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
    // pooled — ok value is the pool owner address
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

/**
 * Check whether `sender` has authorized `contractCaller` to call PoX-5
 * methods on its behalf, honoring the optional expiry burn-height stored in
 * the grant.
 *
 * Mirrors the logic of the contract's `check-caller-allowed` read-only
 * function: an authorization is in effect when an entry exists in the
 * `allowance-contract-callers` map and either has no expiry or the current
 * burn-block height has not yet reached the expiry.
 */
export async function fetchAllowanceContractCallers(
  opts: { sender: string; contractCaller: string; poxInfo?: PoxInfo } & NetworkClientParam
): Promise<{ callerAllowed: boolean; callerExpiryHeight?: number }> {
  const entry = await fetchContractMapEntry({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
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
 * Fetch account-level balance/lock state for a STX address from the
 * `/v2/accounts/<addr>` node endpoint.
 *
 * Returned values use `bigint` (STX values are too large to safely round-trip
 * through `number`). `unlockHeight` is `0` when no lock is active.
 */
export async function fetchAccountStatus(
  opts: { address: string } & NetworkClientParam
): Promise<AccountStatus> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const client = clientFromNetwork(network);
  const baseUrl = opts.client?.baseUrl ?? client.baseUrl;
  const fetchFn = opts.client?.fetch ?? client.fetch;
  const url = `${baseUrl}/v2/accounts/${opts.address}?proof=0`;
  const response = await fetchFn(url);
  const data = await response.json();

  // The node returns hex-encoded big-endian uints for balance/locked. They
  // are wrapped in a leading "0x".
  const hexToBigInt = (hex: string): bigint => (hex && hex !== '0x' ? BigInt(hex) : 0n);

  return {
    balance: hexToBigInt(data.balance),
    locked: hexToBigInt(data.locked),
    nonce: BigInt(data.nonce ?? 0),
    unlockHeight: Number(data.unlock_height ?? 0),
  };
}

/**
 * Fetch a staker's current paired-BTC bond membership via `get-bond-membership`.
 *
 * Returns `undefined` when no active membership exists (either no entry, or
 * the bond's unlock cycle has been reached — the contract collapses both
 * cases to `none`).
 */
export async function fetchBondMembership(
  opts: { address: string } & NetworkClientParam
): Promise<BondMembership | undefined> {
  const result = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
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
  const result = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
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
 * Fetch the static configuration of a protocol bond.
 *
 * Reads the `protocol-bonds` map directly and derives `openBurnHeight` /
 * `firstRewardCycle` from the bond index using the contract's gap math. Does
 * NOT populate `capacitySats` — the contract does not expose total allowlist
 * capacity as a single read; sum `protocol-bond-allowances` separately if
 * needed.
 *
 * Returns `undefined` if the bond has not been set up.
 */
export async function fetchBond(
  opts: { bondIndex: number } & NetworkClientParam
): Promise<Bond | undefined> {
  const [bondEntry, openBurnHeight, firstRewardCycle] = await Promise.all([
    fetchContractMapEntry({
      contractAddress: CONTRACT_ADDRESS,
      contractName: CONTRACT_NAME,
      mapName: 'protocol-bonds',
      mapKey: Cl.uint(opts.bondIndex),
      network: opts.network,
      client: opts.client,
    }),
    fetchBondPeriodToBurnHeight({
      bondIndex: opts.bondIndex,
      network: opts.network,
      client: opts.client,
    }),
    fetchBondPeriodToRewardCycle({
      bondIndex: opts.bondIndex,
      network: opts.network,
      client: opts.client,
    }),
  ]);

  const optional = bondEntry as OptionalCV<TupleCV>;
  if (optional.type === ClarityType.OptionalNone) return undefined;

  const tuple = optional.value;
  const targetRate = (tuple.value['target-rate'] as UIntCV).value;
  const stxValueRatio = (tuple.value['stx-value-ratio'] as UIntCV).value;
  const minUstxRatio = (tuple.value['min-ustx-ratio'] as UIntCV).value;
  const earlyUnlockSigners = (tuple.value['early-unlock-signers'] as BufferCV).value;

  return {
    bondIndex: opts.bondIndex,
    openBurnHeight,
    firstRewardCycle,
    targetRateBps: Number(targetRate),
    stxValueRatio: BigInt(stxValueRatio),
    minUstxRatioBps: Number(minUstxRatio),
    earlyUnlockSigners:
      typeof earlyUnlockSigners === 'string'
        ? hexToBytes(earlyUnlockSigners)
        : (earlyUnlockSigners as Uint8Array),
  };
}

/**
 * Map a bond index to the burn-block height at which the bond opens.
 *
 * Wraps the contract's `bond-period-to-burn-height` read-only.
 */
export async function fetchBondPeriodToBurnHeight(
  opts: { bondIndex: number } & NetworkClientParam
): Promise<number> {
  const result = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: 'bond-period-to-burn-height',
    functionArgs: [Cl.uint(opts.bondIndex)],
    senderAddress: CONTRACT_ADDRESS,
    network: opts.network,
    client: opts.client,
  });
  return Number((result as UIntCV).value);
}

/**
 * Map a bond index to the reward cycle at which the bond starts.
 *
 * Wraps the contract's `bond-period-to-reward-cycle` read-only.
 */
export async function fetchBondPeriodToRewardCycle(
  opts: { bondIndex: number } & NetworkClientParam
): Promise<number> {
  const result = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: 'bond-period-to-reward-cycle',
    functionArgs: [Cl.uint(opts.bondIndex)],
    senderAddress: CONTRACT_ADDRESS,
    network: opts.network,
    client: opts.client,
  });
  return Number((result as UIntCV).value);
}

/**
 * Fetch the total sats already staked into a given bond.
 *
 * Wraps `get-total-sats-staked-for-bond`. Returns `0n` when no entry exists.
 */
export async function fetchTotalSatsStakedForBond(
  opts: { bondIndex: number } & NetworkClientParam
): Promise<bigint> {
  const result = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: 'get-total-sats-staked-for-bond',
    functionArgs: [Cl.uint(opts.bondIndex)],
    senderAddress: CONTRACT_ADDRESS,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Fetch a staker's allowlisted sats allocation for a bond.
 *
 * Reads the `protocol-bond-allowances` map directly. Returns `0n` when the
 * staker is not on the bond's allowlist (no entry => not allowed).
 */
export async function fetchBondAllowance(
  opts: { bondIndex: number; address: string } & NetworkClientParam
): Promise<bigint> {
  const entry = await fetchContractMapEntry({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
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

/**
 * Wraps the contract's `min-ustx-for-sats-amount` read-only.
 *
 * Computes the minimum uSTX that must be paired with `sats` for a bond whose
 * static parameters are `stxValueRatio` (uSTX per 100 sats — trailing average
 * snapshot taken at `setup-bond`) and `minUstxRatioBps` (basis points; e.g.
 * `500` = 5%). Mirrors the on-chain formula:
 *
 * `(stxValueRatio * sats / 100) * minUstxRatioBps / 10000`
 *
 * Use the on-chain helper rather than re-deriving locally so client and
 * contract math stay in lockstep across rounding edge cases.
 */
export async function fetchMinUstxForSats(
  opts: {
    sats: bigint;
    stxValueRatio: bigint;
    minUstxRatioBps: number;
  } & NetworkClientParam
): Promise<bigint> {
  const result = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: 'min-ustx-for-sats-amount',
    functionArgs: [Cl.uint(opts.sats), Cl.uint(opts.stxValueRatio), Cl.uint(opts.minUstxRatioBps)],
    senderAddress: CONTRACT_ADDRESS,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Map a reward cycle to the burn-block height at which the cycle starts.
 *
 * Wraps the contract's `reward-cycle-to-burn-height` read-only.
 *
 * Note: this is pure-math given pox params (`first-burnchain-block-height`,
 * `pox-reward-cycle-length`). Could be implemented as a synchronous converter
 * over `PoxInfo`; kept as a fetch wrapper for parity with the contract surface
 * and the existing `fetchBondPeriodTo*` pair.
 */
export async function fetchRewardCycleToBurnHeight(
  opts: { cycle: number } & NetworkClientParam
): Promise<number> {
  const result = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: 'reward-cycle-to-burn-height',
    functionArgs: [Cl.uint(opts.cycle)],
    senderAddress: CONTRACT_ADDRESS,
    network: opts.network,
    client: opts.client,
  });
  return Number((result as UIntCV).value);
}

/**
 * Whether the given burn-block height falls inside the prepare phase of its
 * containing reward cycle.
 *
 * The on-chain `is-in-prepare-phase` predicate takes a *cycle* and compares
 * `burn-block-height` (the chain-tip) against the prepare-phase window of
 * `cycle + 1`. To answer the same question for an arbitrary `burnHeight`
 * (not necessarily the chain-tip), we recompute the predicate client-side
 * from `PoxInfo`:
 *
 *   prepareStart = rewardCycleToBurnHeight(cycle + 1)
 *                  + rewardCycleLength / 2
 *                  - prepareCycleLength
 *   inPrepare    = burnHeight >= prepareStart
 *
 * (`reward-cycle-to-unlock-height(c) = rewardCycleToBurnHeight(c) + len/2`.)
 */
export async function fetchIsInPreparePhase(
  opts: { burnHeight: number; poxInfo?: PoxInfo } & NetworkClientParam
): Promise<boolean> {
  const pox = opts.poxInfo ?? (await fetchPoxInfo({ network: opts.network, client: opts.client }));
  const { firstBurnchainBlockHeight, rewardCycleLength, prepareCycleLength } = pox;
  if (opts.burnHeight < firstBurnchainBlockHeight) return false;
  const cycle = Math.floor((opts.burnHeight - firstBurnchainBlockHeight) / rewardCycleLength);
  const nextCycleBurnStart = firstBurnchainBlockHeight + (cycle + 1) * rewardCycleLength;
  const nextCycleUnlockHeight = nextCycleBurnStart + Math.floor(rewardCycleLength / 2);
  const prepareStart = nextCycleUnlockHeight - prepareCycleLength;
  return opts.burnHeight >= prepareStart;
}

/**
 * Whether a given bond is active at the supplied burn-block height.
 *
 * Wraps `is-bond-active-at-height`. The contract definition combines three
 * checks: (1) the bond is configured (`protocol-bonds` map has an entry),
 * (2) the height has passed the bond's open height, and (3) the height is at
 * or before the bond's end height (= start of bond `bondIndex + 6`). The map
 * lookup makes this contract-dependent; it cannot be implemented as a pure
 * converter without first fetching the bond config.
 */
export async function fetchIsBondActiveAtHeight(
  opts: { bondIndex: number; burnHeight: number } & NetworkClientParam
): Promise<boolean> {
  const result = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: 'is-bond-active-at-height',
    functionArgs: [Cl.uint(opts.bondIndex), Cl.uint(opts.burnHeight)],
    senderAddress: CONTRACT_ADDRESS,
    network: opts.network,
    client: opts.client,
  });
  return (result as BooleanCV).type === ClarityType.BoolTrue;
}

// ---------------------------------------------------------------------------
// Reward / distribution reads — flows 7, 15, 21
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
  const result = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: 'current-distribution-cycle',
    functionArgs: [],
    senderAddress: CONTRACT_ADDRESS,
    network: opts.network,
    client: opts.client,
  });
  return Number((result as UIntCV).value);
}

/**
 * Wraps the contract's `distribution-cycle-to-burn-height` read-only.
 *
 * Distribution-cycle index → burn-height at which the half-cycle starts.
 */
export async function fetchDistributionCycleToBurnHeight(
  opts: { cycle: number } & NetworkClientParam
): Promise<number> {
  const result = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: 'distribution-cycle-to-burn-height',
    functionArgs: [Cl.uint(opts.cycle)],
    senderAddress: CONTRACT_ADDRESS,
    network: opts.network,
    client: opts.client,
  });
  return Number((result as UIntCV).value);
}

/**
 * Per-signer share total contributed in a given cycle (STX-only) or bond
 * (paired-BTC). Wraps `get-signer-shares-staked-for-cycle`.
 *
 * - `index` is a reward cycle when `isBond` is `false`; a bond index when
 *   `isBond` is `true`.
 * - For STX-only: denominated in uSTX. For bonds: denominated in sats.
 */
export async function fetchSignerSharesStakedForCycle(
  opts: {
    signerManager: string;
    index: number;
    isBond: boolean;
  } & NetworkClientParam
): Promise<bigint> {
  const result = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: 'get-signer-shares-staked-for-cycle',
    functionArgs: [Cl.address(opts.signerManager), Cl.uint(opts.index), Cl.bool(opts.isBond)],
    senderAddress: CONTRACT_ADDRESS,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Lifetime sBTC rewards already paid out to a signer for a cycle (STX-only)
 * or bond (paired-BTC). Wraps `get-signer-rewards-paid-for-cycle`.
 *
 * The contract increments this counter inside `update-claimable-rewards` by
 * the most-recently-pulled `rewards-pending`, so the value reflects all prior
 * `claim-rewards` calls for that `(signer, index, isBond)` triple.
 */
export async function fetchSignerRewardsPaidForCycle(
  opts: {
    signerManager: string;
    index: number;
    isBond: boolean;
  } & NetworkClientParam
): Promise<bigint> {
  const result = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: 'get-signer-rewards-paid-for-cycle',
    functionArgs: [Cl.address(opts.signerManager), Cl.uint(opts.index), Cl.bool(opts.isBond)],
    senderAddress: CONTRACT_ADDRESS,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Decode the post-patch `get-claimable-rewards` tuple
 * `{ rewards-paid, rewards-pending, shares-staked, rewards-per-share }`.
 */
function decodeRewardsLeg(tuple: TupleCV): RewardsLeg {
  return {
    rewardsPaid: BigInt((tuple.value['rewards-paid'] as UIntCV).value),
    rewardsPending: BigInt((tuple.value['rewards-pending'] as UIntCV).value),
    sharesStaked: BigInt((tuple.value['shares-staked'] as UIntCV).value),
    rewardsPerShare: BigInt((tuple.value['rewards-per-share'] as UIntCV).value),
  };
}

/**
 * One read-only call into `get-claimable-rewards` for a single
 * `(signer, index, isBond)` triple. Per the 2026-05-04 patch this returns a
 * 4-field tuple per leg rather than a bare uint.
 */
async function fetchClaimableRewardsLeg(
  opts: {
    signerManager: string;
    index: number;
    isBond: boolean;
  } & NetworkClientParam
): Promise<RewardsLeg> {
  const result = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: 'get-claimable-rewards',
    functionArgs: [Cl.address(opts.signerManager), Cl.uint(opts.index), Cl.bool(opts.isBond)],
    senderAddress: CONTRACT_ADDRESS,
    network: opts.network,
    client: opts.client,
  });
  return decodeRewardsLeg(result as TupleCV);
}

/**
 * Fetch the structured claimable-rewards breakdown for a signer-manager,
 * matching the inputs of the contract's `claim-rewards` public function:
 * one STX-only leg keyed by `rewardCycle` and 0..6 bond legs keyed by
 * `bondIndices`.
 *
 * Per the 2026-05-04 contract patch, each on-chain `get-claimable-rewards`
 * call now returns a 4-field tuple
 * (`rewards-paid, rewards-pending, shares-staked, rewards-per-share`); this
 * helper aggregates those legs into the shape consumed by
 * `flows/5-pools/21.md` and the dashboard sketches in
 * `flows/6-rewards/{7,15}.md`. Bond legs additionally carry the `bondIndex`
 * (mirroring how `claim-rewards`'s `print` event tags each leg).
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
    fetchClaimableRewardsLeg({
      signerManager: opts.signerManager,
      index: opts.rewardCycle,
      isBond: false,
      network: opts.network,
      client: opts.client,
    }),
    ...bondIndices.map(bondIndex =>
      fetchClaimableRewardsLeg({
        signerManager: opts.signerManager,
        index: bondIndex,
        isBond: true,
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

// ---------------------------------------------------------------------------
// Andon cord / payout pause — flow 15
// ---------------------------------------------------------------------------

/**
 * Wraps `get-last-reward-compute-height`.
 *
 * Returns the burn-block height at which `calculate-rewards` was most
 * recently settled (`0` before any settlement). The value is set inside
 * `calculate-rewards` to the prior distribution cycle's
 * `calculation-height = distribution-cycle-to-burn-height(currentDistCycle) - 1`.
 */
export async function fetchLastRewardComputeHeight(opts: NetworkClientParam = {}): Promise<number> {
  const result = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: 'get-last-reward-compute-height',
    functionArgs: [],
    senderAddress: CONTRACT_ADDRESS,
    network: opts.network,
    client: opts.client,
  });
  return Number((result as UIntCV).value);
}

/**
 * Compute the andon-cord payout window for the next-pending distribution
 * cycle (flow 15).
 *
 * Two pieces feed the answer:
 * - `currentDistributionCycle` — index of the dist cycle the chain tip
 *   is in. Once it ticks over, `calculate-rewards` becomes callable for
 *   the *previous* cycle (`calculation-height = distributionCycleToBurnHeight
 *   (currentDistCycle) - 1`).
 * - `lastRewardComputeHeight` — burn-height of the last settlement. If
 *   it equals (or exceeds) the upcoming `calculation-height` the cycle
 *   has already fired and cannot be paused.
 *
 * The 250-block delay window is the design-spec gating
 * (`notes/pox-5-design.md` "Andon Cord", `flows/6-rewards/15.md`).
 *
 * missing: `pox-5.clar` (2026-05-04) does NOT enforce a 250-block delay
 * — `calculate-rewards` only checks `last-reward-compute-height <
 * calculation-height`. The delay belongs to a future revision (Launch
 * Scope D19). Likewise the contract has no `paused` flag, so this
 * helper can only return `paused: false` — see `unsure/flow-15.md`.
 *
 * unsure: which dist cycle to surface. The flow-15 markdown sketch
 * implies "the next-pending payout". We pick: if
 * `lastRewardComputeHeight < calculationHeightForCurrentDistCycle`,
 * the current dist cycle's payout is still pending; otherwise the
 * window has already closed (returned with `canPause: false` and
 * `blocksRemaining: 0`).
 */
export async function fetchPayoutWindow(
  opts: { poxInfo?: PoxInfo } & NetworkClientParam = {}
): Promise<PayoutWindow> {
  const [pox, distCycle, lastComputeHeight] = await Promise.all([
    opts.poxInfo ?? fetchPoxInfo({ network: opts.network, client: opts.client }),
    fetchCurrentDistributionCycle({ network: opts.network, client: opts.client }),
    fetchLastRewardComputeHeight({ network: opts.network, client: opts.client }),
  ]);

  // The dist cycle whose payout is "next to fire" is the one that has
  // started but not yet been settled. `calculate-rewards` settles for
  // `distributionCycleToBurnHeight(currentDistCycle) - 1`, anchoring at
  // the burn-height the dist cycle ticked over.
  const halfCycleLength = Math.floor(pox.rewardCycleLength / 2);
  const distCycleStartHeight = pox.firstBurnchainBlockHeight + distCycle * halfCycleLength;
  const calculationHeight = distCycleStartHeight - 1;

  // Once the contract has settled at-or-after `calculationHeight` the
  // payout has fired and the window is closed.
  const alreadyFired = lastComputeHeight >= calculationHeight;

  // Pause window: payout fires at `distCycleStartHeight + 1` per the
  // flow-15 sketch ("automation fires at X+1"); ops have until then —
  // i.e. up to `ANDON_CORD_PAUSE_BLOCKS` after the dist cycle starts —
  // to halt. blocksRemaining counts down from 250 to 0 inside the
  // window.
  const blocksSinceTick = pox.currentBurnchainBlockHeight - distCycleStartHeight;
  const blocksRemaining = alreadyFired
    ? 0
    : Math.max(0, ANDON_CORD_PAUSE_BLOCKS - Math.max(0, blocksSinceTick));

  return {
    distCycle,
    scheduledHeight: distCycleStartHeight,
    blocksRemaining,
    canPause: !alreadyFired && blocksRemaining > 0,
    // missing: contract has no `paused` flag; see unsure/flow-15.md.
    paused: false,
  };
}

// ---------------------------------------------------------------------------
// Early exit (paired-BTC) — flow 13
// ---------------------------------------------------------------------------

/**
 * Fetch the early-exit lifecycle status for a paired-BTC bond position.
 *
 * The state machine spans both layers:
 * - L2 (`pox-5`): a `request-early-exit` call flips the membership flag and
 *   stops T1 yield accrual.
 * - Off-chain coordinator: observes the L2 event, co-signs the L1 spend
 *   against the pre-authorized early-exit branch, optionally broadcasts.
 * - L1 (Bitcoin): once broadcast & confirmed, the BTC is back in the
 *   staker's wallet. The paired STX stays locked until natural unlock.
 *
 * missing: This is the SDK surface for a contract function that does not
 * exist yet. The 2026-05-04 `pox-5.clar` exposes no `get-early-exit-*`
 * read-only and no flag inside `protocol-bond-memberships`. Until the
 * contract lands, callers cannot read the L2 portion of the status; the
 * coordinator's `requested → co-signed → broadcast → confirmed` view is
 * an upstream service (notes/user-flows.md §1g labels it `[UPSTREAM]`).
 *
 * unsure: split. Plausible carve-ups:
 *   1. Single fn that reads L2 + queries the coordinator (this stub).
 *   2. Two fns: `fetchEarlyExitRequested` (L2 only) +
 *      `earlyExitCoordinatorClient.fetchStatus` (off-chain, separate
 *      package or thin client per `notes/status.md` tier-2 item 14).
 * The flow markdown (flows/3-paired-btc/13.md) sketches a single
 * `fetchEarlyExitStatus({address, network})` so we follow that for now.
 */
export async function fetchEarlyExitStatus(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _opts: { address: string } & NetworkClientParam
): Promise<EarlyExitStatus> {
  // missing: read-only contract function. Candidate names from the design
  // sketch: `get-early-exit-status`, `get-bond-membership` (with an added
  // `early-exit` field). Neither exists in `pox-5.clar` today.
  //
  // todo: once the contract lands, replace this stub with a
  // `fetchCallReadOnlyFunction` call and decode the tuple. The off-chain
  // co-signer state (`co-signed` / `broadcast` / `confirmed`) likely needs
  // a separate coordinator client — see unsure/flow-13.md.
  throw new Error(
    'fetchEarlyExitStatus: not implemented — pox-5.clar lacks the L2 ' +
      'early-exit read; coordinator service surface is upstream'
  );
}

// ---------------------------------------------------------------------------
// Watchdog / L1 lock status (paired-BTC) — flow 14
// ---------------------------------------------------------------------------

/**
 * Fetch the L1 lock status for a paired-BTC bond position.
 *
 * Returns one of `locked` | `spent-reported` | `expired` per the watchdog
 * design (`notes/pox-5-design.md` "Watchdog", `flows/3-paired-btc/14.md`,
 * Launch Scope D21).
 *
 * missing: NO read-only function for this exists in `pox-5.clar`
 * (2026-05-04). `notes/status.md` tier-2 item 15 and open design-question
 * 1 flag the entire watchdog surface as TBD; the only related primitive
 * is the private `validate-p2wsh-exists?` stub at line 1636 of the
 * contract. Replace this stub with a `fetchCallReadOnlyFunction` call
 * once the contract exposes (likely) `get-lock-status` or a
 * `spent-reported` flag inside `protocol-bond-memberships`.
 *
 * unsure: whether spent-reports are keyed per-position (staker) or
 * per-UTXO (txid+vout). Open per `flows/3-paired-btc/14.md`. The opts
 * shape here mirrors the flow-markdown sketch (`{ address, network }`),
 * which assumes per-position.
 */
export async function fetchLockStatus(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _opts: { address: string } & NetworkClientParam
): Promise<LockStatus> {
  // missing: read-only contract function. todo: wire to
  // `fetchCallReadOnlyFunction` once pox-5.clar exposes the watchdog
  // surface; decode the resulting tuple (or membership-flag) into a
  // `LockStatus`.
  throw new Error(
    'fetchLockStatus: not implemented — pox-5.clar lacks the watchdog ' +
      'surface (tracked in notes/status.md tier-2 #15, Launch Scope D21)'
  );
}

/**
 * Collect the Bitcoin SPV proof needed by {@link buildReportUtxoSpent}.
 *
 * unsure: SPV-proof building is non-trivial and the contract's required
 * proof shape is open per `notes/status.md` open-question 1. This helper
 * is sketched but **not implemented** — flagging clearly per the flow
 * markdown ("collectSpendProof won't be part of this SDK").
 *
 * missing: full SPV-proof construction needs:
 *   1. A Bitcoin RPC / Esplora client (mempool.space, electrs, btcd).
 *   2. UTXO history lookup for `(lockTxid, lockVout)` → spending tx.
 *   3. Block header retrieval + merkle-branch generation for the
 *      spending tx.
 *   4. Encoding into whatever shape `pox-5.clar` ends up expecting.
 * None of (1)–(4) belong in `@stacks/bitcoin-staking`'s zero-dependency
 * scope. A separate package or a thin wrapper around an existing SPV
 * lib (e.g. `@scure/btc-signer`, custom electrs-client) is the more
 * likely home; see `unsure/flow-14.md` for the API-endpoint
 * opportunity.
 */
export async function collectSpendProof(_opts: {
  /** Bitcoin node / Esplora-compatible base URL. */
  btcRpcUrl: string;
  /** Txid of the original L1 lockup transaction. */
  lockTxid: string;
  /** Output index of the tracked P2WSH output within `lockTxid`. */
  lockVout: number;
  // missing: probably also `network: 'mainnet' | 'testnet'`, optional
  // headers/auth for the BTC RPC.
}): Promise<{
  spendTxid: string;
  blockHeight: number;
  merkleBranch: string[];
}> {
  // todo: collectSpendProof won't be part of this SDK. SPV-proof
  // building is non-trivial and contract surface is unfinalized — see
  // `unsure/flow-14.md`. Stubbed for completeness so `flows/3-paired-btc/14.md`
  // still type-checks against the package surface.
  throw new Error(
    'collectSpendProof: not implemented — SPV-proof building is out of ' +
      'scope for @stacks/bitcoin-staking; see unsure/flow-14.md'
  );
}
