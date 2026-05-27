/**
 * Mock fetchers for `@stacks/bitcoin-staking`.
 *
 * Drop-in replacements for the real `fetch*` functions, with type-identical
 * signatures and return shapes. The scenario in effect is picked by the
 * `?d=<day>` URL search param (see `./days.ts`). Function args are accepted
 * for type compatibility but their values are ignored when picking a fixture.
 *
 * Production bundle stays clean: consumers opt in via
 * `import { mockFetchPoxInfo } from '@stacks/bitcoin-staking/mocks'`.
 */

import type { NetworkClientParam } from '@stacks/network';
import type {
  AccountStatus,
  Bond,
  BondMembership,
  EarnedRewards,
  PoxInfo,
  StakerInfo,
} from '../src/types';
import { currentMockDay } from './days';
import * as F from './fixtures';

// ---------------------------------------------------------------------------
// Internal: scalar parsers
// ---------------------------------------------------------------------------

/** Pick the active fixture for a function. Returns the raw JSON payload. */
function pickFixture<T = unknown>(fn: string, fixtures: Record<string, unknown>, days: string[]): T {
  const day = currentMockDay(fn, days);
  return fixtures[day] as T;
}

/** Most numeric RO reads return `{ value: '<digits>' }` — convert to bigint. */
function bigintFromValueFixture(fn: string, fixtures: Record<string, unknown>, days: string[]): bigint {
  const raw = pickFixture<{ value: string }>(fn, fixtures, days);
  return BigInt(raw.value);
}

// ---------------------------------------------------------------------------
// SDK fetch mocks (28)
// ---------------------------------------------------------------------------

interface PoxInfoRaw {
  contract_id: string;
  current_burnchain_block_height: number;
  first_burnchain_block_height: number;
  reward_cycle_id: number;
  reward_cycle_length: number;
  prepare_cycle_length: number;
  reward_slots: number;
  current_cycle: { id: number; stacked_ustx: string; is_pox_active: boolean };
  next_cycle: { id: number; stacked_ustx: string; is_pox_active: boolean };
  contract_versions: Array<{
    contract_id: string;
    activation_burnchain_block_height: number;
    first_reward_cycle_id: number;
  }>;
}

function parsePoxInfoFromMock(raw: PoxInfoRaw): PoxInfo {
  return {
    contractId: raw.contract_id,
    currentBurnchainBlockHeight: raw.current_burnchain_block_height,
    firstBurnchainBlockHeight: raw.first_burnchain_block_height,
    rewardCycleId: raw.reward_cycle_id,
    rewardCycleLength: raw.reward_cycle_length,
    prepareCycleLength: raw.prepare_cycle_length,
    rewardSlots: raw.reward_slots,
    currentCycle: {
      id: raw.current_cycle.id,
      stakedUstx: BigInt(raw.current_cycle.stacked_ustx),
      isPoxActive: raw.current_cycle.is_pox_active,
    },
    nextCycle: {
      id: raw.next_cycle.id,
      stakedUstx: BigInt(raw.next_cycle.stacked_ustx),
      isPoxActive: raw.next_cycle.is_pox_active,
    },
    contractVersions: raw.contract_versions.map(v => ({
      contractId: v.contract_id,
      activationBurnchainBlockHeight: v.activation_burnchain_block_height,
      firstRewardCycleId: v.first_reward_cycle_id,
    })),
  };
}

export async function mockFetchPoxInfo(_opts: NetworkClientParam = {}): Promise<PoxInfo> {
  const raw = pickFixture<PoxInfoRaw>('fetchPoxInfo', F.fetchPoxInfo_FIXTURES, F.fetchPoxInfo_DAYS);
  return parsePoxInfoFromMock(raw);
}

interface AccountStatusRaw {
  balance: string;
  locked: string;
  nonce: string;
  unlockHeight: number;
}

export async function mockFetchAccountStatus(
  _opts: { address: string } & NetworkClientParam
): Promise<AccountStatus> {
  const raw = pickFixture<AccountStatusRaw>(
    'fetchAccountStatus',
    F.fetchAccountStatus_FIXTURES,
    F.fetchAccountStatus_DAYS
  );
  return {
    balance: BigInt(raw.balance),
    locked: BigInt(raw.locked),
    nonce: BigInt(raw.nonce),
    unlockHeight: raw.unlockHeight,
  };
}

interface StakerInfoRaw {
  staked: boolean;
  details?: {
    amountUstx: string;
    firstRewardCycle: number;
    numCycles: number;
    signer: string;
  };
}

export async function mockFetchStakerInfo(
  _opts: { address: string } & NetworkClientParam
): Promise<StakerInfo> {
  const raw = pickFixture<StakerInfoRaw>(
    'fetchStakerInfo',
    F.fetchStakerInfo_FIXTURES,
    F.fetchStakerInfo_DAYS
  );
  if (!raw.staked || !raw.details) return { staked: false };
  return {
    staked: true,
    details: {
      amountUstx: BigInt(raw.details.amountUstx),
      firstRewardCycle: raw.details.firstRewardCycle,
      numCycles: raw.details.numCycles,
      signer: raw.details.signer,
    },
  };
}

interface BondMembershipRaw {
  bondIndex: number;
  amountUstx: string;
  signer: string;
  isL1Lock: boolean;
}

export async function mockFetchBondMembership(
  _opts: { address: string } & NetworkClientParam
): Promise<BondMembership | undefined> {
  const raw = pickFixture<BondMembershipRaw | null>(
    'fetchBondMembership',
    F.fetchBondMembership_FIXTURES,
    F.fetchBondMembership_DAYS
  );
  if (raw === null) return undefined;
  return {
    bondIndex: raw.bondIndex,
    amountUstx: BigInt(raw.amountUstx),
    signer: raw.signer,
    isL1Lock: raw.isL1Lock,
  };
}

interface AllowanceContractCallersRaw {
  callerAllowed: boolean;
  callerExpiryHeight?: number;
}

export async function mockFetchAllowanceContractCallers(
  _opts: { sender: string; contractCaller: string; poxInfo?: PoxInfo } & NetworkClientParam
): Promise<{ callerAllowed: boolean; callerExpiryHeight?: number }> {
  return pickFixture<AllowanceContractCallersRaw>(
    'fetchAllowanceContractCallers',
    F.fetchAllowanceContractCallers_FIXTURES,
    F.fetchAllowanceContractCallers_DAYS
  );
}

interface BondRaw {
  bondIndex: number;
  targetRateBps: number;
  stxValueRatio: string;
  minUstxRatioBps: number;
  earlyUnlockSigners: string;
  earlyUnlockAdmin: string;
  capacitySats?: string;
}

function parseBondFromMock(raw: BondRaw): Bond {
  const bond: Bond = {
    bondIndex: raw.bondIndex,
    targetRateBps: raw.targetRateBps,
    stxValueRatio: BigInt(raw.stxValueRatio),
    minUstxRatioBps: raw.minUstxRatioBps,
    earlyUnlockSigners: raw.earlyUnlockSigners,
    earlyUnlockAdmin: raw.earlyUnlockAdmin,
  };
  if (raw.capacitySats !== undefined) bond.capacitySats = BigInt(raw.capacitySats);
  return bond;
}

export async function mockFetchBond(
  _opts: { bondIndex: number } & NetworkClientParam
): Promise<Bond | undefined> {
  const raw = pickFixture<BondRaw | null>('fetchBond', F.fetchBond_FIXTURES, F.fetchBond_DAYS);
  if (raw === null) return undefined;
  return parseBondFromMock(raw);
}

export async function mockFetchProtocolBond(
  _opts: { bondIndex: number } & NetworkClientParam
): Promise<Bond | undefined> {
  const raw = pickFixture<BondRaw | null>(
    'fetchProtocolBond',
    F.fetchProtocolBond_FIXTURES,
    F.fetchProtocolBond_DAYS
  );
  if (raw === null) return undefined;
  return parseBondFromMock(raw);
}

export async function mockFetchBondAllowance(
  _opts: { bondIndex: number; address: string } & NetworkClientParam
): Promise<bigint> {
  return bigintFromValueFixture(
    'fetchBondAllowance',
    F.fetchBondAllowance_FIXTURES,
    F.fetchBondAllowance_DAYS
  );
}

export async function mockFetchTotalSbtcStakedForBond(
  _opts: { bondIndex: number } & NetworkClientParam
): Promise<bigint> {
  return bigintFromValueFixture(
    'fetchTotalSbtcStakedForBond',
    F.fetchTotalSbtcStakedForBond_FIXTURES,
    F.fetchTotalSbtcStakedForBond_DAYS
  );
}

export async function mockFetchTotalSharesStakedForCycle(
  _opts: { index: number; isBond: boolean } & NetworkClientParam
): Promise<bigint> {
  return bigintFromValueFixture(
    'fetchTotalSharesStakedForCycle',
    F.fetchTotalSharesStakedForCycle_FIXTURES,
    F.fetchTotalSharesStakedForCycle_DAYS
  );
}

export async function mockFetchTotalSbtcStaked(_opts: NetworkClientParam = {}): Promise<bigint> {
  return bigintFromValueFixture(
    'fetchTotalSbtcStaked',
    F.fetchTotalSbtcStaked_FIXTURES,
    F.fetchTotalSbtcStaked_DAYS
  );
}

export async function mockFetchTotalUstxStacked(
  _opts: { rewardCycle: number } & NetworkClientParam
): Promise<bigint> {
  return bigintFromValueFixture(
    'fetchTotalUstxStacked',
    F.fetchTotalUstxStacked_FIXTURES,
    F.fetchTotalUstxStacked_DAYS
  );
}

export async function mockFetchBondL1UnlockHeight(
  _opts: { bondIndex: number } & NetworkClientParam
): Promise<bigint> {
  return bigintFromValueFixture(
    'fetchBondL1UnlockHeight',
    F.fetchBondL1UnlockHeight_FIXTURES,
    F.fetchBondL1UnlockHeight_DAYS
  );
}

export async function mockFetchStakerSharesStakedByBond(
  _opts: { staker: string; signer: string; bondIndex: number } & NetworkClientParam
): Promise<bigint> {
  return bigintFromValueFixture(
    'fetchStakerSharesStakedByBond',
    F.fetchStakerSharesStakedByBond_FIXTURES,
    F.fetchStakerSharesStakedByBond_DAYS
  );
}

export async function mockFetchStakerSharesStakedByCycle(
  _opts: { staker: string; signer: string; rewardCycle: number } & NetworkClientParam
): Promise<bigint> {
  return bigintFromValueFixture(
    'fetchStakerSharesStakedByCycle',
    F.fetchStakerSharesStakedByCycle_FIXTURES,
    F.fetchStakerSharesStakedByCycle_DAYS
  );
}

export async function mockFetchStakerSharesStakedForCycle(
  _opts: { staker: string; signer: string; index: number; isBond: boolean } & NetworkClientParam
): Promise<bigint> {
  return bigintFromValueFixture(
    'fetchStakerSharesStakedForCycle',
    F.fetchStakerSharesStakedForCycle_FIXTURES,
    F.fetchStakerSharesStakedForCycle_DAYS
  );
}

export async function mockFetchSignerSharesStakedByBond(
  _opts: { signerManager: string; bondIndex: number } & NetworkClientParam
): Promise<bigint> {
  return bigintFromValueFixture(
    'fetchSignerSharesStakedByBond',
    F.fetchSignerSharesStakedByBond_FIXTURES,
    F.fetchSignerSharesStakedByBond_DAYS
  );
}

export async function mockFetchSignerSharesStakedByCycle(
  _opts: { signerManager: string; rewardCycle: number } & NetworkClientParam
): Promise<bigint> {
  return bigintFromValueFixture(
    'fetchSignerSharesStakedByCycle',
    F.fetchSignerSharesStakedByCycle_FIXTURES,
    F.fetchSignerSharesStakedByCycle_DAYS
  );
}

export async function mockFetchEarned(
  _opts: { signerManager: string; index: number; isBond: boolean } & NetworkClientParam
): Promise<EarnedRewards> {
  return bigintFromValueFixture('fetchEarned', F.fetchEarned_FIXTURES, F.fetchEarned_DAYS);
}

export async function mockFetchEarnedByBond(
  _opts: { signerManager: string; bondIndex: number } & NetworkClientParam
): Promise<EarnedRewards> {
  return bigintFromValueFixture(
    'fetchEarnedByBond',
    F.fetchEarnedByBond_FIXTURES,
    F.fetchEarnedByBond_DAYS
  );
}

export async function mockFetchEarnedByCycle(
  _opts: { signerManager: string; rewardCycle: number } & NetworkClientParam
): Promise<EarnedRewards> {
  return bigintFromValueFixture(
    'fetchEarnedByCycle',
    F.fetchEarnedByCycle_FIXTURES,
    F.fetchEarnedByCycle_DAYS
  );
}

export async function mockFetchSignerUnclaimedRewards(
  _opts: { signerManager: string; index: number; isBond: boolean } & NetworkClientParam
): Promise<bigint> {
  return bigintFromValueFixture(
    'fetchSignerUnclaimedRewards',
    F.fetchSignerUnclaimedRewards_FIXTURES,
    F.fetchSignerUnclaimedRewards_DAYS
  );
}

export async function mockFetchSignerRewardsPerTokenSettled(
  _opts: { signerManager: string; index: number; isBond: boolean } & NetworkClientParam
): Promise<bigint> {
  return bigintFromValueFixture(
    'fetchSignerRewardsPerTokenSettled',
    F.fetchSignerRewardsPerTokenSettled_FIXTURES,
    F.fetchSignerRewardsPerTokenSettled_DAYS
  );
}

export async function mockFetchSignerRewardsPerTokenSettledByBond(
  _opts: { signerManager: string; bondIndex: number } & NetworkClientParam
): Promise<bigint> {
  return bigintFromValueFixture(
    'fetchSignerRewardsPerTokenSettledByBond',
    F.fetchSignerRewardsPerTokenSettledByBond_FIXTURES,
    F.fetchSignerRewardsPerTokenSettledByBond_DAYS
  );
}

export async function mockFetchSignerRewardsPerTokenSettledByCycle(
  _opts: { signerManager: string; rewardCycle: number } & NetworkClientParam
): Promise<bigint> {
  return bigintFromValueFixture(
    'fetchSignerRewardsPerTokenSettledByCycle',
    F.fetchSignerRewardsPerTokenSettledByCycle_FIXTURES,
    F.fetchSignerRewardsPerTokenSettledByCycle_DAYS
  );
}

interface SignerInfoRaw {
  signerKey: string;
}

export async function mockFetchSignerInfo(
  _opts: { signerManager: string } & NetworkClientParam
): Promise<{ signerKey: string } | undefined> {
  const raw = pickFixture<SignerInfoRaw | null>(
    'fetchSignerInfo',
    F.fetchSignerInfo_FIXTURES,
    F.fetchSignerInfo_DAYS
  );
  if (raw === null) return undefined;
  return { signerKey: raw.signerKey };
}

export async function mockFetchVerifySignerKeyGrant(
  _opts: { signerKey: Uint8Array | string; signerManager: string } & NetworkClientParam
): Promise<boolean> {
  const raw = pickFixture<{ value: boolean }>(
    'fetchVerifySignerKeyGrant',
    F.fetchVerifySignerKeyGrant_FIXTURES,
    F.fetchVerifySignerKeyGrant_DAYS
  );
  return raw.value;
}

export async function mockFetchSignerGrantMessageHash(
  _opts: { signerManager: string; authId: bigint | number } & NetworkClientParam
): Promise<string> {
  const raw = pickFixture<{ value: string }>(
    'fetchSignerGrantMessageHash',
    F.fetchSignerGrantMessageHash_FIXTURES,
    F.fetchSignerGrantMessageHash_DAYS
  );
  return raw.value;
}

// ---------------------------------------------------------------------------
// Coworker API mocks (11). Function shapes pass through the fixture verbatim;
// callers consume the JSON shape directly (no SDK type to align to yet).
// ---------------------------------------------------------------------------

interface Page<T> {
  results: T[];
  next_cursor: string | null;
}

export async function mockListBonds(
  _opts: { cursor?: string; limit?: number } = {}
): Promise<Page<unknown>> {
  return pickFixture<Page<unknown>>('mockListBonds', F.mockListBonds_FIXTURES, F.mockListBonds_DAYS);
}

export async function mockGetBond(_opts: { bondIndex: number }): Promise<unknown | null> {
  return pickFixture<unknown | null>('mockGetBond', F.mockGetBond_FIXTURES, F.mockGetBond_DAYS);
}

export async function mockListBondAllowlist(
  _opts: { bondIndex: number; cursor?: string; limit?: number }
): Promise<Page<unknown>> {
  return pickFixture<Page<unknown>>(
    'mockListBondAllowlist',
    F.mockListBondAllowlist_FIXTURES,
    F.mockListBondAllowlist_DAYS
  );
}

export async function mockGetBondAllowlistEntry(
  _opts: { bondIndex: number; principal: string }
): Promise<unknown | null> {
  return pickFixture<unknown | null>(
    'mockGetBondAllowlistEntry',
    F.mockGetBondAllowlistEntry_FIXTURES,
    F.mockGetBondAllowlistEntry_DAYS
  );
}

export async function mockListBondRegistrations(
  _opts: { bondIndex: number; cursor?: string; limit?: number }
): Promise<Page<unknown>> {
  return pickFixture<Page<unknown>>(
    'mockListBondRegistrations',
    F.mockListBondRegistrations_FIXTURES,
    F.mockListBondRegistrations_DAYS
  );
}

export async function mockGetBondRegistration(
  _opts: { bondIndex: number; principal: string }
): Promise<unknown | null> {
  return pickFixture<unknown | null>(
    'mockGetBondRegistration',
    F.mockGetBondRegistration_FIXTURES,
    F.mockGetBondRegistration_DAYS
  );
}

export async function mockListCycles(
  _opts: { cursor?: string; limit?: number } = {}
): Promise<Page<unknown>> {
  return pickFixture<Page<unknown>>(
    'mockListCycles',
    F.mockListCycles_FIXTURES,
    F.mockListCycles_DAYS
  );
}

export async function mockGetCycle(_opts: { cycleId: number }): Promise<unknown> {
  return pickFixture<unknown>('mockGetCycle', F.mockGetCycle_FIXTURES, F.mockGetCycle_DAYS);
}

export async function mockListCycleSigners(
  _opts: { cycleId: number; cursor?: string; limit?: number }
): Promise<Page<unknown>> {
  return pickFixture<Page<unknown>>(
    'mockListCycleSigners',
    F.mockListCycleSigners_FIXTURES,
    F.mockListCycleSigners_DAYS
  );
}

export async function mockListSignerStakers(
  _opts: { cycleId: number; signerPrincipal: string; cursor?: string; limit?: number }
): Promise<Page<unknown>> {
  return pickFixture<Page<unknown>>(
    'mockListSignerStakers',
    F.mockListSignerStakers_FIXTURES,
    F.mockListSignerStakers_DAYS
  );
}

export async function mockListCycleStakers(
  _opts: { cycleId: number; cursor?: string; limit?: number }
): Promise<Page<unknown>> {
  return pickFixture<Page<unknown>>(
    'mockListCycleStakers',
    F.mockListCycleStakers_FIXTURES,
    F.mockListCycleStakers_DAYS
  );
}

export { currentMockDay, DAYS, DEFAULT_DAY } from './days';
export type { Day } from './days';
