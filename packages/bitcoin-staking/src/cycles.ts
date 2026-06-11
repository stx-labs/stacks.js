import { BOND_GAP_CYCLES, BOND_LENGTH_CYCLES, POX5_CONTRACT_NAME } from './constants';
import type { PoxInfo } from './types';

/**
 * Phase label for a bond's lifecycle.
 *
 * - `open` — registration window. Spans the contract's full setup window
 *   ({@link BOND_GAP_CYCLES} reward cycles before the bond starts). There is
 *   no on-chain "announce" — `setup-bond` publishes the bond and opens
 *   registration in one step, so registration actually succeeds only once
 *   the admin has called `setup-bond` (and outside the PoX prepare phase).
 * - `locked` — bond term running; collateral locked, no new registrations
 *   (`ERR_BOND_ALREADY_STARTED`).
 * - `unlocked` — tail of the bond term where BTC unlocks on L1 and stakers
 *   may roll into the next bond (`verify-bond-rollover-window`).
 * - `closed` — term over; claim rewards / unlock remaining positions.
 */
export type BondPhaseName = 'open' | 'locked' | 'unlocked' | 'closed';

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
 * Pure-math equivalents of pox-5.clar's cycle / burn-height read-only helpers.
 *
 * These contract reads are deterministic over a small set of pox parameters
 * (`first-burnchain-block-height`, `pox-reward-cycle-length`,
 * `pox-prepare-cycle-length`, `first-bond-period-cycle`) that change
 * essentially never after deployment. Snapshot them once via {@link fetchPoxInfo}
 * and call these locally instead of paying a contract round-trip per query.
 *
 * `first-bond-period-cycle` is not exposed via the contract's `get-pox-info`
 * read-only; bond-math helpers derive it internally from the same
 * {@link PoxInfo} snapshot via {@link firstPox5RewardCycle} — per `pox-5.clar`
 * it equals the pox-5 row's `first-reward-cycle-id`. This module stays
 * pure-math: it never performs I/O.
 */

/**
 * The first reward cycle in which pox-5 (and therefore paired-BTC bond
 * periods) is active.
 *
 * Sourced from `PoxInfo.contractVersions[]` — i.e. the `contract_versions[]`
 * array on `/v2/pox`, which carries one entry per deployed pox contract
 * version. Mirrors the contract's `first-pox-5-reward-cycle` read-only (the
 * `first-bond-period-cycle` data-var on `pox-5.clar` is identical) without
 * paying an extra read-only round-trip.
 *
 * Returns `undefined` when pox-5 has not yet activated on-chain — the pox-5
 * row only appears in `contract_versions[]` once its
 * `activation_burnchain_block_height` is set by the node.
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

/**
 * Internal: derive `firstBondPeriodCycle` from `poxInfo` or throw if pox-5 has
 * not yet activated on-chain. Shared by every bond-math helper that needs it.
 */
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
 * Mirrors the pox-5.clar `bond-period-to-reward-cycle` read-only function.
 *
 * `firstBondPeriodCycle` is derived internally from `poxInfo` via
 * {@link firstPox5RewardCycle}; throws if pox-5 has not yet activated on-chain.
 */
export function bondPeriodToRewardCycle(opts: { bondIndex: number; poxInfo: PoxInfo }): number {
  return requireFirstBondPeriodCycle(opts.poxInfo) + opts.bondIndex * BOND_GAP_CYCLES;
}

/**
 * Mirrors the pox-5.clar `bond-period-to-burn-height` read-only function.
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

/**
 * Mirrors the pox-5.clar `burn-height-to-distribution-index` read-only
 * function (see `references/pox-5.clar:2086`).
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
 * Mirrors the pox-5.clar `current-distribution-cycle` read-only function
 * (see `references/pox-5.clar:2092-2095`).
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
 * Mirrors the pox-5.clar `distribution-cycle-to-burn-height` read-only
 * function (see `references/pox-5.clar:2098`).
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
 * **Unstable / UI-experimental.** Returns the bond's lifecycle phases as a
 * list of named, burn-height-anchored ranges. Useful for UIs that want to
 * render a bond timeline (progress bar, phase chips, countdown badges)
 * without re-implementing the height math.
 *
 * `PoxInfo`-pure: no fetches, no network. `firstBondPeriodCycle` is derived
 * internally from `poxInfo` via {@link firstPox5RewardCycle}; throws if pox-5
 * has not yet activated on-chain.
 *
 * Phase boundaries:
 * - `open` — starts `BOND_GAP_CYCLES` reward cycles before the bond's start
 *   height (the contract's `setup-bond` window) and ends at the start height.
 *   Registration succeeds anywhere in this range once the admin has called
 *   `setup-bond` and the chain is not in the PoX prepare phase — the contract
 *   only enforces the end boundary (`ERR_BOND_ALREADY_STARTED`); whether the
 *   bond is configured yet requires an on-chain read (`get-protocol-bond`),
 *   which this pure helper deliberately doesn't do.
 * - `locked` — `bondPeriodToBurnHeight(bondIndex)` →
 *   `BOND_LENGTH_CYCLES * rewardCycleLength` blocks later.
 * - `unlocked` — last `rewardCycleLength / 2` blocks of the term. BTC unlocks
 *   on L1 (exact moment is the script CLTV expiry); STX still locked on L2.
 *   Stakers may roll into the next overlapping bond.
 * - `closed` — after the term; capped at `BOND_LENGTH_CYCLES *
 *   rewardCycleLength` worth of blocks so consumers can render a finite
 *   range. Bonds remain readable past this cap; the cap is a UI convention
 *   only.
 *
 * `endBurnHeight` is exclusive: `startBurnHeight + length === endBurnHeight`,
 * and the next phase, if any, begins at `endBurnHeight`.
 */
export function bondPhaseRanges(opts: { bondIndex: number; poxInfo: PoxInfo }): BondPhaseRange[] {
  const { rewardCycleLength } = opts.poxInfo;
  const openBurnHeight = bondPeriodToBurnHeight(opts);
  const closeBurnHeight = openBurnHeight + BOND_LENGTH_CYCLES * rewardCycleLength;
  const unlockedBlocks = Math.floor(rewardCycleLength / 2);
  const unlockedStart = closeBurnHeight - unlockedBlocks;
  const openStart = openBurnHeight - BOND_GAP_CYCLES * rewardCycleLength;
  const closedEnd = closeBurnHeight + BOND_LENGTH_CYCLES * rewardCycleLength;

  const range = (name: BondPhaseName, start: number, end: number): BondPhaseRange => ({
    name,
    startBurnHeight: start,
    length: end - start,
    endBurnHeight: end,
  });

  return [
    range('open', openStart, openBurnHeight),
    range('locked', openBurnHeight, unlockedStart),
    range('unlocked', unlockedStart, closeBurnHeight),
    range('closed', closeBurnHeight, closedEnd),
  ];
}

/**
 * Point-in-time status of a bond, without assuming it exists on-chain.
 *
 * For a set-up bond (`setup-bond` has been called) these are the
 * {@link BondPhaseName} phases. For a bond that hasn't been set up:
 * - `too-early` — before the bond's setup window; `setup-bond` would revert.
 * - `eligible` — within the setup window ({@link BOND_GAP_CYCLES} reward
 *   cycles before the bond's start height); the admin can `setup-bond` now.
 * - `missing` — the start height passed without `setup-bond`; this bond
 *   period can never run.
 */
export type BondStatusName = BondPhaseName | 'too-early' | 'eligible' | 'missing';

/**
 * **Unstable / UI-experimental.** Classify a bond's status at the
 * `poxInfo.currentBurnchainBlockHeight`.
 *
 * Unlike {@link bondPhaseRanges}, this doesn't assume the bond exists:
 * `isBondSetup` says whether `setup-bond` has been called for this
 * `bondIndex` (i.e. the contract's `get-protocol-bond` returned `some`) —
 * that's an on-chain read, which this pure helper leaves to the caller.
 * For the fetching variant, see `fetchBondStatus`.
 *
 * Set-up bonds map onto the {@link bondPhaseRanges} phases; bonds that
 * haven't been set up resolve to `too-early` / `eligible` / `missing` by
 * where the height falls relative to the setup window.
 *
 * Note `open` only means registration is allowed by bond timing — the PoX
 * prepare phase ({@link isInPreparePhase}) still periodically blocks it.
 */
export function bondStatus(opts: {
  bondIndex: number;
  poxInfo: PoxInfo;
  /** Whether `setup-bond` has been called for this bond (`get-protocol-bond` is `some`). */
  isBondSetup: boolean;
}): BondStatusName {
  const { currentBurnchainBlockHeight: burnHeight, rewardCycleLength } = opts.poxInfo;
  const startBurnHeight = bondPeriodToBurnHeight(opts);
  const closeBurnHeight = startBurnHeight + BOND_LENGTH_CYCLES * rewardCycleLength;
  const unlockedStart = closeBurnHeight - Math.floor(rewardCycleLength / 2);
  const setupStart = startBurnHeight - BOND_GAP_CYCLES * rewardCycleLength;

  if (!opts.isBondSetup) {
    if (burnHeight < setupStart) return 'too-early';
    if (burnHeight < startBurnHeight) return 'eligible';
    return 'missing';
  }
  if (burnHeight < startBurnHeight) return 'open';
  if (burnHeight < unlockedStart) return 'locked';
  if (burnHeight < closeBurnHeight) return 'unlocked';
  return 'closed';
}
