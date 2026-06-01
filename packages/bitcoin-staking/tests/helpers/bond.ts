/**
 * Bond-period selection for the regtest bond flow. Shared by the action tests so
 * the timing logic lives in one place.
 */
import { BOND_GAP_CYCLES, bondPeriodToBurnHeight, type PoxInfo } from '../../src';
import { getPoxInfo, waitForBurnBlockHeight } from './wait';

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
 * Choose a bond with enough runway for a multi-tx sequence to confirm before D0.
 * The chain mines fast and a period's runway shrinks to 0 at the boundary, so if
 * we're too close we wait one boundary for the next period's full window. Returns
 * the chosen bond plus the (possibly re-read) poxInfo it was chosen against.
 *
 * `minRunway` defaults to half a cycle; pass more for longer sequences (e.g. the
 * L1 flow, which also waits on a Bitcoin confirmation).
 */
export async function chooseBondWithRunway(
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
