import { BOND_GAP_CYCLES, BOND_LENGTH_CYCLES, POX5_CONTRACT_NAME } from './constants';
import type { PoxInfo } from './types';

/**
 * Phase label for a bond's lifecycle.
 *
 * - `open` — registration window: from {@link BOND_GAP_CYCLES} reward cycles
 *   before the bond starts up to `prepareCycleLength` blocks before its start
 *   height. It ends early because the PoX prepare phase (the trailing
 *   `prepareCycleLength` blocks of the cycle before the bond starts) blocks
 *   registration (`ERR_STAKE_IN_PREPARE_PHASE`). There is no on-chain
 *   "announce" — `setup-bond` publishes the bond and opens registration in one
 *   step, so registration only succeeds once the admin has called `setup-bond`.
 * - `locked` — no new registrations: the final pre-start prepare phase, then
 *   the bond term with collateral locked (`ERR_BOND_ALREADY_STARTED`).
 *   Starts `prepareCycleLength` blocks before the bond's start height.
 * - `unlocked` — tail of the bond term where BTC unlocks on L1 and stakers
 *   may roll into the next bond (`verify-bond-rollover-window`).
 * - `finished` — term over; claim rewards / unlock remaining positions.
 *
 * @experimental Phase names are not finalized and may change.
 */
export type BondPhaseName = 'open' | 'locked' | 'unlocked' | 'finished';

/**
 * A single named, burn-height-anchored phase of a bond's lifecycle.
 *
 * `endBurnHeight` is exclusive — i.e. the next phase begins at this height,
 * and `endBurnHeight === startBurnHeight + length`.
 */
export interface BondPhaseRange {
  /** Phase label — see {@link BondPhaseName}. */
  name: BondPhaseName;
  /** Inclusive start burn-block height. */
  startBurnHeight: number;
  /** Number of burn blocks the phase spans. */
  length: number;
  /**
   * Exclusive end burn-block height (`startBurnHeight + length`). The next
   * phase, if any, begins at this height.
   */
  endBurnHeight: number;
}

/**
 * The first reward cycle in which pox-5 (and therefore paired-BTC bond
 * periods) is active. Read from `poxInfo.contractVersions[]`; returns
 * `undefined` when pox-5 has not yet activated on-chain.
 *
 * Mirrors `pox-5.first-pox-5-reward-cycle` (equivalently the
 * `first-bond-period-cycle` data-var).
 */
export function firstPox5RewardCycle(poxInfo: PoxInfo): number | undefined {
  const entry = poxInfo.contractVersions.find(v => v.contractId.endsWith(`.${POX5_CONTRACT_NAME}`));
  return entry?.firstRewardCycleId;
}

/**
 * Bond-end offset, measured in bond periods. A bond is active for
 * `BOND_LENGTH_CYCLES / BOND_GAP_CYCLES` bond gaps (= 6) after its open. This
 * lifts the hardcoded `+ u6` in the contract's bond math.
 */
export const BOND_END_OFFSET_PERIODS = BOND_LENGTH_CYCLES / BOND_GAP_CYCLES;

/** @internal Derive `firstBondPeriodCycle` from `poxInfo`, or throw if pox-5 isn't active yet. */
function requireFirstBondPeriodCycle(poxInfo: PoxInfo): number {
  const cycle = firstPox5RewardCycle(poxInfo);
  if (cycle === undefined) {
    throw new Error(
      'pox-5 not activated yet — no firstBondPeriodCycle available in poxInfo.contractVersions[]'
    );
  }
  return cycle;
}

/**
 * Mirrors `pox-5.bond-period-to-reward-cycle`.
 *
 * `firstBondPeriodCycle` is derived internally from `poxInfo` via
 * {@link firstPox5RewardCycle}; throws if pox-5 has not yet activated on-chain.
 */
export function bondPeriodToRewardCycle(opts: { bondIndex: number; poxInfo: PoxInfo }): number {
  return requireFirstBondPeriodCycle(opts.poxInfo) + opts.bondIndex * BOND_GAP_CYCLES;
}

/**
 * Mirrors `pox-5.bond-period-to-burn-height`.
 *
 * `firstBondPeriodCycle` is derived internally from `poxInfo` via
 * {@link firstPox5RewardCycle}; throws if pox-5 has not yet activated on-chain.
 */
export function bondPeriodToBurnHeight(opts: { bondIndex: number; poxInfo: PoxInfo }): number {
  return rewardCycleToBurnHeight({
    cycle: bondPeriodToRewardCycle(opts),
    poxInfo: opts.poxInfo,
  });
}

/**
 * Mirrors `pox-5.burn-height-to-reward-cycle`.
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

/** Mirrors `pox-5.reward-cycle-to-burn-height`. */
export function rewardCycleToBurnHeight(opts: { cycle: number; poxInfo: PoxInfo }): number {
  return opts.poxInfo.firstBurnchainBlockHeight + opts.cycle * opts.poxInfo.rewardCycleLength;
}

/**
 * Mirrors `pox-5.burn-height-to-distribution-index`.
 *
 * Distribution cycles tick twice per reward cycle —
 * `distributionCycleLength = rewardCycleLength / 2` is the canonical mainnet
 * convention. `PoxInfo`-pure: no fetch, no network.
 */
export function burnHeightToDistributionIndex(opts: {
  burnHeight: number;
  poxInfo: PoxInfo;
}): number {
  const distCycleLength = Math.floor(opts.poxInfo.rewardCycleLength / 2);
  return Math.floor((opts.burnHeight - opts.poxInfo.firstBurnchainBlockHeight) / distCycleLength);
}

/**
 * Mirrors `pox-5.current-distribution-cycle`.
 *
 * Pure, no fetches — equivalent to
 * `burnHeightToDistributionIndex({ burnHeight: poxInfo.currentBurnchainBlockHeight, poxInfo })`.
 * Distribution cycles tick twice per reward cycle (every
 * `rewardCycleLength / 2` burn blocks). Every caller that needs this
 * value already has (or fetches) {@link PoxInfo}, so derive locally
 * instead of paying an extra read-only round-trip.
 */
export function currentDistributionCycle(poxInfo: PoxInfo): number {
  return burnHeightToDistributionIndex({
    burnHeight: poxInfo.currentBurnchainBlockHeight,
    poxInfo,
  });
}

/**
 * Mirrors `pox-5.distribution-cycle-to-burn-height`.
 *
 * Distribution cycles tick twice per reward cycle —
 * `distributionCycleLength = rewardCycleLength / 2` is the canonical mainnet
 * convention. `PoxInfo`-pure: no fetch, no network.
 */
export function distributionCycleToBurnHeight(opts: {
  distributionCycle: number;
  poxInfo: PoxInfo;
}): number {
  const distCycleLength = Math.floor(opts.poxInfo.rewardCycleLength / 2);
  return opts.poxInfo.firstBurnchainBlockHeight + opts.distributionCycle * distCycleLength;
}

/**
 * Mirrors `pox-5.is-in-prepare-phase`.
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
 * Mirrors `pox-5.min-ustx-for-sats-amount`.
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
 * Mirrors `pox-5.is-bond-active-at-height` (math portion).
 *
 * Note: skips the existence check. The contract also asserts
 * `(is-some (map-get? protocol-bonds bond-index))`.
 *
 * The bond-end offset (`BOND_END_OFFSET_PERIODS = 6`) is six bond gaps —
 * `BOND_LENGTH_CYCLES / BOND_GAP_CYCLES` reward cycles.
 *
 * `firstBondPeriodCycle` is derived internally from `poxInfo` via
 * {@link firstPox5RewardCycle}; throws if pox-5 has not yet activated on-chain.
 */
export function isBondActiveAtHeight(opts: {
  bondIndex: number;
  burnHeight: number;
  poxInfo: PoxInfo;
}): boolean {
  const bondStart = bondPeriodToBurnHeight(opts);
  const bondEnd = bondPeriodToBurnHeight({
    bondIndex: opts.bondIndex + BOND_END_OFFSET_PERIODS,
    poxInfo: opts.poxInfo,
  });
  return opts.burnHeight > bondStart && opts.burnHeight <= bondEnd;
}

/**
 * Returns the bond's lifecycle phases as a list of named, burn-height-anchored
 * ranges. Useful for UIs that want to
 * render a bond timeline (progress bar, phase chips, countdown badges)
 * without re-implementing the height math.
 *
 * `PoxInfo`-pure: no fetches, no network. `firstBondPeriodCycle` is derived
 * internally from `poxInfo` via {@link firstPox5RewardCycle}; throws if pox-5
 * has not yet activated on-chain.
 *
 * Phase boundaries:
 * - `open` — starts `BOND_GAP_CYCLES` reward cycles before the bond's start
 *   height and ends `prepareCycleLength` blocks before it. The final prepare
 *   phase before the start is folded into `locked`, since registration is
 *   blocked there (`ERR_STAKE_IN_PREPARE_PHASE`) — so this range's
 *   `endBurnHeight` is the practical registration cutoff, not the start height.
 *   (Earlier prepare phases inside the window also block registration; for the
 *   exact registrable sub-windows use {@link bondRegisterRanges}.) Whether the
 *   bond is configured yet requires an on-chain read (`get-protocol-bond`),
 *   which this pure helper deliberately doesn't do.
 * - `locked` — the final pre-start prepare phase plus the bond term:
 *   `bondPeriodToBurnHeight(bondIndex) - prepareCycleLength` ->
 *   `unlocked` start.
 * - `unlocked` — last `rewardCycleLength / 2` blocks of the term. BTC unlocks
 *   on L1 (exact moment is the script CLTV expiry); STX still locked on L2.
 *   Stakers may roll into the next overlapping bond.
 * - `finished` — after the term; capped at `BOND_LENGTH_CYCLES *
 *   rewardCycleLength` worth of blocks so consumers can render a finite
 *   range. Bonds remain readable past this cap; the cap is a UI convention
 *   only.
 *
 * `endBurnHeight` is exclusive: `startBurnHeight + length === endBurnHeight`,
 * and the next phase, if any, begins at `endBurnHeight`.
 */
export function bondPhaseRanges(opts: { bondIndex: number; poxInfo: PoxInfo }): BondPhaseRange[] {
  const { rewardCycleLength, prepareCycleLength } = opts.poxInfo;
  const startBurnHeight = bondPeriodToBurnHeight(opts);
  const registrationEnd = startBurnHeight - prepareCycleLength;
  const closeBurnHeight = startBurnHeight + BOND_LENGTH_CYCLES * rewardCycleLength;
  const unlockedBlocks = Math.floor(rewardCycleLength / 2);
  const unlockedStart = closeBurnHeight - unlockedBlocks;
  const openStart = startBurnHeight - BOND_GAP_CYCLES * rewardCycleLength;
  const closedEnd = closeBurnHeight + BOND_LENGTH_CYCLES * rewardCycleLength;

  const range = (name: BondPhaseName, start: number, end: number): BondPhaseRange => ({
    name,
    startBurnHeight: start,
    length: end - start,
    endBurnHeight: end,
  });

  return [
    range('open', openStart, registrationEnd),
    range('locked', registrationEnd, unlockedStart),
    range('unlocked', unlockedStart, closeBurnHeight),
    range('finished', closeBurnHeight, closedEnd),
  ];
}

/** A registrable burn-height window. `endBurnHeight` is exclusive. */
export interface BurnHeightRange {
  /** Inclusive start burn-block height. */
  startBurnHeight: number;
  /** Number of burn blocks the window spans. */
  length: number;
  /** Exclusive end burn-block height. */
  endBurnHeight: number;
}

/**
 * @internal Experimental — prefer {@link bondPhaseRanges}.
 *
 * The burn-height windows in which `register-for-bond` is actually possible for
 * a bond: the reward-phase portions of the open window, with each cycle's
 * trailing prepare phase ({@link isInPreparePhase}) removed. One window per
 * pre-start reward cycle (up to {@link BOND_GAP_CYCLES}, earliest first),
 * clamped at `firstBurnchainBlockHeight` — so one or two in practice. The last
 * window's `endBurnHeight` is the practical lock point.
 *
 * `PoxInfo`-pure: no fetches. Registration also requires `setup-bond` to have
 * been called, which this helper doesn't check.
 */
export function bondRegisterRanges(opts: {
  bondIndex: number;
  poxInfo: PoxInfo;
}): BurnHeightRange[] {
  const { rewardCycleLength, prepareCycleLength, firstBurnchainBlockHeight } = opts.poxInfo;
  const startBurnHeight = bondPeriodToBurnHeight(opts);
  const ranges: BurnHeightRange[] = [];
  for (let k = BOND_GAP_CYCLES; k >= 1; k--) {
    const cycleStart = startBurnHeight - k * rewardCycleLength;
    const start = Math.max(cycleStart, firstBurnchainBlockHeight);
    const end = cycleStart + (rewardCycleLength - prepareCycleLength);
    if (end > start)
      ranges.push({ startBurnHeight: start, length: end - start, endBurnHeight: end });
  }
  return ranges;
}

/**
 * Point-in-time status of a bond, without assuming it exists on-chain.
 *
 * For a set-up bond (`setup-bond` has been called) these are the
 * {@link BondPhaseName} phases. For a bond that hasn't been set up:
 * - `too-early` — before the bond's setup window; `setup-bond` would revert.
 * - `eligible` — within the setup window ({@link BOND_GAP_CYCLES} reward
 *   cycles before the bond's start height); the admin can `setup-bond` now.
 * - `missed` — the start height passed without `setup-bond`; this bond
 *   period can never run.
 *
 * @experimental Status names are not finalized and may change.
 */
export type BondStatusName = BondPhaseName | 'too-early' | 'eligible' | 'missed';

/**
 * Classify a bond's status at the `poxInfo.currentBurnchainBlockHeight`.
 *
 * Unlike {@link bondPhaseRanges}, this doesn't assume the bond exists:
 * `isBondSetup` says whether `setup-bond` has been called for this
 * `bondIndex` (i.e. the contract's `get-protocol-bond` returned `some`) —
 * that's an on-chain read, which this pure helper leaves to the caller.
 * For the fetching variant, see `fetchBondStatus`.
 *
 * Set-up bonds map onto the {@link bondPhaseRanges} phases; bonds that
 * haven't been set up resolve to `too-early` / `eligible` / `missed` by
 * where the height falls relative to the setup window.
 *
 * `open` ends `prepareCycleLength` blocks before the start height (the final
 * prepare phase is folded into `locked`). Earlier prepare phases inside the
 * window still block registration ({@link isInPreparePhase}); `open` here means
 * registration is allowed by bond timing, not that every block in it is
 * registrable.
 */
export function bondStatus(opts: {
  bondIndex: number;
  poxInfo: PoxInfo;
  /** Whether `setup-bond` has been called for this bond (`get-protocol-bond` is `some`). */
  isBondSetup: boolean;
}): BondStatusName {
  const {
    currentBurnchainBlockHeight: burnHeight,
    rewardCycleLength,
    prepareCycleLength,
  } = opts.poxInfo;
  const startBurnHeight = bondPeriodToBurnHeight(opts);
  const registrationEnd = startBurnHeight - prepareCycleLength;
  const closeBurnHeight = startBurnHeight + BOND_LENGTH_CYCLES * rewardCycleLength;
  const unlockedStart = closeBurnHeight - Math.floor(rewardCycleLength / 2);
  const setupStart = startBurnHeight - BOND_GAP_CYCLES * rewardCycleLength;

  if (!opts.isBondSetup) {
    if (burnHeight < setupStart) return 'too-early';
    if (burnHeight < startBurnHeight) return 'eligible';
    return 'missed';
  }
  if (burnHeight < registrationEnd) return 'open';
  if (burnHeight < unlockedStart) return 'locked';
  if (burnHeight < closeBurnHeight) return 'unlocked';
  return 'finished';
}
