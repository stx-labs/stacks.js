import { BOND_GAP_CYCLES, BOND_LENGTH_CYCLES } from './constants';
import type { PoxInfo } from './types';

/**
 * Pure-math equivalents of pox-5.clar's cycle / burn-height read-only helpers.
 *
 * These contract reads are deterministic over a small set of pox parameters
 * (`first-burnchain-block-height`, `pox-reward-cycle-length`,
 * `pox-prepare-cycle-length`, `first-bond-period-cycle`) that change
 * essentially never after deployment. Snapshot them once via {@link fetchPoxInfo}
 * (and pass `firstBondPeriodCycle` for bond math) and call these locally
 * instead of paying a contract round-trip per query.
 *
 * `first-bond-period-cycle` is not exposed via the contract's `get-pox-info`
 * read-only; source it once via `fetchFirstPox5RewardCycle()` (see `fetch.ts`)
 * — per `pox-5.clar` it equals `first-pox-5-reward-cycle`. This module stays
 * pure-math: it never performs I/O.
 */

/**
 * Bond-end offset, measured in bond periods. A bond is active for
 * `BOND_LENGTH_CYCLES / BOND_GAP_CYCLES` bond gaps (= 6) after its open. This
 * lifts the hardcoded `+ u6` in the contract's bond math.
 */
export const BOND_END_OFFSET_PERIODS = BOND_LENGTH_CYCLES / BOND_GAP_CYCLES;

/** Mirrors the pox-5.clar `bond-period-to-reward-cycle` read-only function. */
export function bondPeriodToRewardCycle(opts: {
  bondIndex: number;
  firstBondPeriodCycle: number;
}): number {
  return opts.firstBondPeriodCycle + opts.bondIndex * BOND_GAP_CYCLES;
}

/** Mirrors the pox-5.clar `bond-period-to-burn-height` read-only function. */
export function bondPeriodToBurnHeight(opts: {
  bondIndex: number;
  firstBondPeriodCycle: number;
  poxInfo: PoxInfo;
}): number {
  return rewardCycleToBurnHeight({
    cycle: bondPeriodToRewardCycle(opts),
    poxInfo: opts.poxInfo,
  });
}

/**
 * Mirrors the pox-5.clar `burn-height-to-reward-cycle` read-only function.
 *
 * Contract runtime-aborts when `height < first-burnchain-block-height`; mirror that.
 */
export function burnHeightToRewardCycle(opts: { burnHeight: number; poxInfo: PoxInfo }): number {
  if (opts.burnHeight < opts.poxInfo.firstBurnchainBlockHeight) {
    throw new Error('burnHeight is before first-burnchain-block-height');
  }
  return Math.floor(
    (opts.burnHeight - opts.poxInfo.firstBurnchainBlockHeight) / opts.poxInfo.rewardCycleLength
  );
}

/** Mirrors the pox-5.clar `reward-cycle-to-burn-height` read-only function. */
export function rewardCycleToBurnHeight(opts: { cycle: number; poxInfo: PoxInfo }): number {
  return opts.poxInfo.firstBurnchainBlockHeight + opts.cycle * opts.poxInfo.rewardCycleLength;
}

/** Mirrors the pox-5.clar `reward-cycle-to-unlock-height` read-only function. */
export function rewardCycleToUnlockHeight(opts: { cycle: number; poxInfo: PoxInfo }): number {
  return rewardCycleToBurnHeight(opts) + Math.floor(opts.poxInfo.rewardCycleLength / 2);
}

/** Mirrors the pox-5.clar `burn-height-to-distribution-index` read-only function. */
export function burnHeightToDistributionIndex(opts: {
  burnHeight: number;
  poxInfo: PoxInfo;
}): number {
  return Math.floor(
    (opts.burnHeight - opts.poxInfo.firstBurnchainBlockHeight) /
      Math.floor(opts.poxInfo.rewardCycleLength / 2)
  );
}

/** Mirrors the pox-5.clar `distribution-cycle-to-burn-height` read-only function. */
export function distributionCycleToBurnHeight(opts: { cycle: number; poxInfo: PoxInfo }): number {
  return (
    opts.poxInfo.firstBurnchainBlockHeight +
    opts.cycle * Math.floor(opts.poxInfo.rewardCycleLength / 2)
  );
}

/**
 * Mirrors the pox-5.clar `is-in-prepare-phase` read-only function.
 *
 * The prepare phase is the trailing `prepareCycleLength` burn-blocks of the
 * current cycle, bounded by `reward-cycle-to-burn-height(next-cycle)`.
 */
export function isInPreparePhase(opts: { burnHeight: number; poxInfo: PoxInfo }): boolean {
  if (opts.burnHeight < opts.poxInfo.firstBurnchainBlockHeight) return false;
  const cycle = burnHeightToRewardCycle(opts);
  const nextCycleBurnHeight = rewardCycleToBurnHeight({
    cycle: cycle + 1,
    poxInfo: opts.poxInfo,
  });
  return opts.burnHeight >= nextCycleBurnHeight - opts.poxInfo.prepareCycleLength;
}

/**
 * Mirrors the pox-5.clar `min-ustx-for-sats-amount` read-only function.
 *
 * Minimum uSTX that must be paired with `sats` for a bond whose static
 * parameters are `stxValueRatio` (uSTX per 100 sats — snapshot taken at
 * `setup-bond`) and `minUstxRatioBps` (basis points; `500` = 5%).
 */
export function minUstxForSatsAmount(opts: {
  sats: bigint;
  stxValueRatio: bigint;
  minUstxRatioBps: number | bigint;
}): bigint {
  const ratio = BigInt(opts.minUstxRatioBps);
  return (((opts.stxValueRatio * opts.sats) / 100n) * ratio) / 10000n;
}

/**
 * Mirrors the pox-5.clar `is-bond-active-at-height` read-only function (math portion).
 *
 * Note: skips the existence check. The contract also asserts
 * `(is-some (map-get? protocol-bonds bond-index))`.
 *
 * The bond-end offset (`BOND_END_OFFSET_PERIODS = 6`) is six bond gaps —
 * `BOND_LENGTH_CYCLES / BOND_GAP_CYCLES` reward cycles.
 */
export function isBondActiveAtHeight(opts: {
  bondIndex: number;
  burnHeight: number;
  firstBondPeriodCycle: number;
  poxInfo: PoxInfo;
}): boolean {
  const bondStart = bondPeriodToBurnHeight(opts);
  const bondEnd = bondPeriodToBurnHeight({
    bondIndex: opts.bondIndex + BOND_END_OFFSET_PERIODS,
    firstBondPeriodCycle: opts.firstBondPeriodCycle,
    poxInfo: opts.poxInfo,
  });
  return opts.burnHeight > bondStart && opts.burnHeight <= bondEnd;
}
