/**
 * Bond-period selection for the regtest bond flow. Shared by the action tests so
 * the timing logic lives in one place.
 */
import { BOND_GAP_CYCLES, bondPeriodToBurnHeight, fetchBond, type PoxInfo } from '../../src';
import { getNetwork } from './utils';
import { getPoxInfo, waitForBurnBlockHeight } from './wait';
import { fetchFirstBondPeriodCycle } from '../privatenet/pox';

/**
 * Pick the bond period with the MOST runway before its start. setup-bond is only
 * valid in `[bondStart - BOND_GAP_CYCLES*cycleLen, bondStart)` and register needs
 * `burn < bondStart`; periods are spaced exactly `BOND_GAP_CYCLES` cycles apart, so
 * one window is open at a time. Returns the furthest-out period whose window is
 * already open — i.e. `bondStart` in `(burn, burn + BOND_GAP_CYCLES*cycleLen]`.
 */
export function pickBondIndex(poxInfo: PoxInfo): { bondIndex: number; bondStartHeight: number } {
  const burn = poxInfo.currentBurnchainBlockHeight;
  const windowBlocks = BOND_GAP_CYCLES * poxInfo.rewardCycleLength;
  let chosen: { bondIndex: number; bondStartHeight: number } | undefined;
  for (let bondIndex = 0; bondIndex < 256; bondIndex++) {
    const bondStartHeight = bondPeriodToBurnHeight({ bondIndex, poxInfo });
    if (bondStartHeight > burn && bondStartHeight <= burn + windowBlocks) {
      chosen = { bondIndex, bondStartHeight }; // keep the furthest-out match
    }
  }
  if (!chosen) throw new Error('no bond period with an open setup-bond window');
  return chosen;
}

/**
 * Wait for (and return) a bond period with enough runway for a multi-tx sequence
 * to confirm before D0. The chain mines fast and a period's runway shrinks to 0
 * at the boundary, so if we're too close we wait one boundary for the next
 * period's full window. Returns the chosen bond plus the (possibly re-read)
 * poxInfo it was chosen against.
 *
 * `minRunway` defaults to half a cycle; pass more for longer sequences (e.g. the
 * L1 flow, which also waits on a Bitcoin confirmation).
 */
export async function waitForBondWithRunway(
  minRunway?: number
): Promise<{ bondIndex: number; bondStartHeight: number; poxInfo: PoxInfo }> {
  let poxInfo = await getPoxInfo();
  let chosen = pickBondIndex(poxInfo);
  const need = minRunway ?? Math.floor(poxInfo.rewardCycleLength / 2);
  if (chosen.bondStartHeight - poxInfo.currentBurnchainBlockHeight < need) {
    await waitForBurnBlockHeight(chosen.bondStartHeight); // roll past this boundary
    poxInfo = await getPoxInfo();
    chosen = pickBondIndex(poxInfo);
  }
  return { ...chosen, poxInfo };
}

/**
 * Probe `fetchBond` over `[0, max)` and return the lowest or highest index that
 * exists on-chain (undefined if none do). Consolidates the identical
 * `findHighestExistingBondIndex` (adversarial.test.ts) and
 * `findLowestExistingBondIndex` (adversarial-2.test.ts) probing loops —
 * `direction` picks which extreme, `max` the probe range (their `maxProbe`).
 */
export async function findExistingBondIndex({
  direction,
  max = 25,
}: {
  direction: 'lowest' | 'highest';
  max?: number;
}): Promise<number | undefined> {
  const network = getNetwork();
  let found: number | undefined;
  for (let i = 0; i < max; i++) {
    try {
      const bond = await fetchBond({ bondIndex: i, network });
      if (bond !== undefined) {
        found = i;
        if (direction === 'lowest') break;
      }
    } catch {
      // fetchBond can throw on network errors — skip
    }
  }
  return found;
}

/**
 * Compute the soonest settable bondIndex from live pox/anchor state, offset by
 * `offset`. Offsets >= 1 target future-future indices the contract may reject
 * with ERR_CANNOT_SETUP_BOND_TOO_SOON (u2) — callers use distinct offsets per
 * fuzz probe to avoid index collisions. Consolidates the identical
 * `computeNextBondIndex` copies in adversarial-2/-3/-4.test.ts.
 */
export async function computeNextBondIndex(
  poxInfo: PoxInfo,
  offset = 1
): Promise<{ bondIndex: number; anchorCycle: number; currentCycle: number }> {
  const anchorCycle = await fetchFirstBondPeriodCycle();
  const bondIndex = Math.floor((poxInfo.rewardCycleId - anchorCycle) / BOND_GAP_CYCLES) + offset;
  return { bondIndex, anchorCycle, currentCycle: poxInfo.rewardCycleId };
}
