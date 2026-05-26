import { hexToBigInt } from '@stacks/common';
import type { NetworkClientParam } from '@stacks/network';
import { clientFromNetwork, networkFrom } from '@stacks/network';
import {
  Cl,
  ClarityType,
  type BooleanCV,
  type BufferCV,
  type OptionalCV,
  type PrincipalCV,
  type TupleCV,
  type UIntCV,
  cvToValue,
  fetchCallReadOnlyFunction,
  fetchContractMapEntry,
} from '@stacks/transactions';
import { POX5_CONTRACT_NAME } from './constants';
import type {
  AccountStatus,
  Bond,
  BondMembership,
  EarnedRewards,
  PoxInfo,
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
 * Returns the lock dimensions (`amount-ustx`, `first-reward-cycle`,
 * `num-cycles`) plus the staker's `signer` principal. Pool/solo discrimination,
 * signer key, and BTC reward address are NOT exposed here — they live in
 * `staker-signer-cycle-memberships` / `get-signer-cycle-membership` and need
 * separate fetchers.
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
      signer: cvToValue(tuple.value['signer'] as PrincipalCV) as string,
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
 *
 * Tuple shape: `{ bond-index, amount-ustx, signer, is-l1-lock }`.
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
    amountUstx: BigInt((tuple.value['amount-ustx'] as UIntCV).value),
    signer: cvToValue(tuple.value['signer'] as PrincipalCV) as string,
    isL1Lock: (tuple.value['is-l1-lock'] as BooleanCV).type === ClarityType.BoolTrue,
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
 *
 * Note: the on-chain arg order is `(staker, is-bond, index, signer)`. The TS
 * helper keeps the more natural `(index, isBond)` ordering for callers and
 * reorders internally.
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
      Cl.bool(opts.isBond),
      Cl.uint(opts.index),
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

  return decodeBondTuple(opts.bondIndex, optional.value);
}

/**
 * Wraps the contract's `get-protocol-bond` read-only.
 *
 * Equivalent to {@link fetchBond} but goes through the read-only accessor
 * instead of the raw map read. Returns `undefined` when the bond has not been
 * set up.
 */
export async function fetchProtocolBond(
  opts: { bondIndex: number } & NetworkClientParam
): Promise<Bond | undefined> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-protocol-bond',
    functionArgs: [Cl.uint(opts.bondIndex)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });

  const optional = result as OptionalCV<TupleCV>;
  if (optional.type === ClarityType.OptionalNone) return undefined;

  return decodeBondTuple(opts.bondIndex, optional.value);
}

/** @ignore */
function decodeBondTuple(bondIndex: number, tuple: TupleCV): Bond {
  const targetRate = (tuple.value['target-rate'] as UIntCV).value;
  const stxValueRatio = (tuple.value['stx-value-ratio'] as UIntCV).value;
  const minUstxRatio = (tuple.value['min-ustx-ratio'] as UIntCV).value;
  const earlyUnlockSigners = (tuple.value['early-unlock-signers'] as BufferCV).value as string;
  const earlyUnlockAdmin = cvToValue(tuple.value['early-unlock-admin'] as PrincipalCV) as string;

  return {
    bondIndex,
    targetRateBps: Number(targetRate),
    stxValueRatio: BigInt(stxValueRatio),
    minUstxRatioBps: Number(minUstxRatio),
    earlyUnlockSigners,
    earlyUnlockAdmin,
  };
}

/**
 * Wraps the contract's `get-total-sbtc-staked-for-bond` read-only.
 *
 * Returns `0n` when no entry exists.
 */
export async function fetchTotalSbtcStakedForBond(
  opts: { bondIndex: number } & NetworkClientParam
): Promise<bigint> {
  // todo: improvement for api, this could be added to a bond lookup endpoint, then becomes unneeded
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-total-sbtc-staked-for-bond',
    functionArgs: [Cl.uint(opts.bondIndex)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-total-sbtc-staked` read-only.
 *
 * Returns the protocol-wide total sBTC staked.
 */
export async function fetchTotalSbtcStaked(opts: NetworkClientParam = {}): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-total-sbtc-staked',
    functionArgs: [],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-bond-l1-unlock-height` read-only.
 *
 * Returns the BTC L1 unlock height for a given bond index. The SDK needs this
 * to compute the BTC lockup script's CLTV height before submitting
 * `register-for-bond`.
 */
export async function fetchBondL1UnlockHeight(
  opts: { bondIndex: number } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-bond-l1-unlock-height',
    functionArgs: [Cl.uint(opts.bondIndex)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-first-pox-5-reward-cycle` read-only.
 *
 * Returns the first reward cycle in which pox-5 is active. Callers should use
 * this to anchor bond-period math instead of supplying a constant.
 */
export async function fetchFirstPox5RewardCycle(
  opts: NetworkClientParam = {}
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-first-pox-5-reward-cycle',
    functionArgs: [],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-total-ustx-stacked` read-only.
 *
 * Returns the total uSTX stacked in a given reward cycle.
 */
export async function fetchTotalUstxStacked(
  opts: { rewardCycle: number } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-total-ustx-stacked',
    functionArgs: [Cl.uint(opts.rewardCycle)],
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
    functionArgs: [Cl.address(opts.signerManager), Cl.bool(opts.isBond), Cl.uint(opts.index)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

// ---------------------------------------------------------------------------
// Earned-rewards reads
//
// Pending + accrued is exposed as `get-earned -> uint`, with the underlying
// state split across `get-signer-rewards-per-token-settled-for-cycle` and
// `get-signer-unclaimed-rewards-for-cycle`.
// ---------------------------------------------------------------------------

/**
 * Wraps the contract's `get-earned` read-only.
 *
 * Returns the total amount of rewards earned since the last rewards snapshot:
 * `earned = (shares * (rpt - rptPaid)) / PRECISION + pending`.
 */
export async function fetchEarned(
  opts: {
    signerManager: string;
    index: number;
    isBond: boolean;
  } & NetworkClientParam
): Promise<EarnedRewards> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-earned',
    functionArgs: [Cl.address(opts.signerManager), Cl.bool(opts.isBond), Cl.uint(opts.index)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/** Wraps the contract's `get-earned` read-only for a paired-BTC bond leg. */
export async function fetchEarnedByBond(
  opts: {
    signerManager: string;
    bondIndex: number;
  } & NetworkClientParam
): Promise<EarnedRewards> {
  return fetchEarned({ ...opts, index: opts.bondIndex, isBond: true });
}

/** Wraps the contract's `get-earned` read-only for an STX-only cycle leg. */
export async function fetchEarnedByCycle(
  opts: {
    signerManager: string;
    rewardCycle: number;
  } & NetworkClientParam
): Promise<EarnedRewards> {
  return fetchEarned({ ...opts, index: opts.rewardCycle, isBond: false });
}

/**
 * Wraps the contract's `get-signer-unclaimed-rewards-for-cycle` read-only.
 *
 * The unclaimed-rewards counter rolled forward by the last
 * `update-claimable-rewards` snapshot. Combined with the rewards-per-token
 * settled value, this lets callers reconstruct the full earned amount without
 * re-running `get-earned`.
 */
export async function fetchSignerUnclaimedRewards(
  opts: {
    signerManager: string;
    index: number;
    isBond: boolean;
  } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-signer-unclaimed-rewards-for-cycle',
    functionArgs: [Cl.address(opts.signerManager), Cl.bool(opts.isBond), Cl.uint(opts.index)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-signer-rewards-per-token-settled-for-cycle`
 * read-only.
 *
 * Returns the rewards-per-token value at which this signer's leg was last
 * settled. Useful for off-chain accrual previews.
 */
export async function fetchSignerRewardsPerTokenSettled(
  opts: {
    signerManager: string;
    index: number;
    isBond: boolean;
  } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-signer-rewards-per-token-settled-for-cycle',
    functionArgs: [Cl.address(opts.signerManager), Cl.bool(opts.isBond), Cl.uint(opts.index)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

// ---------------------------------------------------------------------------
// Signer-key grant reads
// ---------------------------------------------------------------------------

/**
 * Wraps the contract's `get-signer-info` read-only.
 *
 * Returns the signer-key currently registered for `signerManager` (i.e. the
 * 33-byte compressed secp256k1 pubkey stored in the `signers` map). Returns
 * `undefined` when no signer is registered for the principal.
 *
 * The hex string is the lowercase, un-prefixed compressed pubkey form.
 */
export async function fetchSignerInfo(
  opts: { signerManager: string } & NetworkClientParam
): Promise<{ signerKey: string } | undefined> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-signer-info',
    functionArgs: [Cl.address(opts.signerManager)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });

  const optional = result as OptionalCV<BufferCV>;
  if (optional.type === ClarityType.OptionalNone) return undefined;
  return { signerKey: optional.value.value as string };
}

/**
 * Wraps the contract's `verify-signer-key-grant` read-only.
 *
 * Returns `true` when an active grant exists in `signer-key-grants` for the
 * `(signer-key, signer-manager)` pair, `false` otherwise (the contract
 * returns `(err ERR_SIGNER_KEY_GRANT_NOT_FOUND)` in the absent case — both
 * branches are normalized to a boolean here).
 */
export async function fetchVerifySignerKeyGrant(
  opts: {
    signerKey: Uint8Array | string;
    signerManager: string;
  } & NetworkClientParam
): Promise<boolean> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const signerKeyArg =
    typeof opts.signerKey === 'string' ? Cl.bufferFromHex(opts.signerKey) : Cl.buffer(opts.signerKey);
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'verify-signer-key-grant',
    functionArgs: [Cl.address(opts.signerManager), signerKeyArg],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });

  // Response is `(ok bool)` on success, `(err uint)` on missing grant.
  return result.type === ClarityType.ResponseOk;
}

/**
 * Wraps the contract's `get-signer-grant-message-hash` read-only.
 *
 * Returns the 32-byte SIP-018 hash for `{ topic: "grant-authorization",
 * signer-manager, auth-id }` under the `POX_5_SIGNER_DOMAIN`. Useful as an
 * on-chain cross-check against {@link getSignerKeyGrantMessageHash}.
 *
 * The hex string is lowercase and un-prefixed.
 */
export async function fetchSignerGrantMessageHash(
  opts: { signerManager: string; authId: bigint | number } & NetworkClientParam
): Promise<string> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-signer-grant-message-hash',
    functionArgs: [Cl.address(opts.signerManager), Cl.uint(opts.authId)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });

  return (result as BufferCV).value as string;
}

// todo: flow 13 (paired-BTC early exit) — `fetchEarlyExitStatus`.
// todo: flow 14 (watchdog) — `fetchLockStatus`, `collectSpendProof`.
// todo: flow 15 (andon cord) — `fetchLastRewardComputeHeight`, `fetchPayoutWindow`.
