import {
  BOND_END_OFFSET_PERIODS,
  bondPeriodToBurnHeight,
  bondPeriodToRewardCycle,
  bondPhaseRanges,
  bondRegisterRanges,
  bondStatus,
  burnHeightToDistributionIndex,
  burnHeightToRewardCycle,
  currentDistributionCycle,
  distributionCycleToBurnHeight,
  firstPox5RewardCycle,
  isBondActiveAtHeight,
  isInPreparePhase,
  minUstxForSatsAmount,
  rewardCycleToBurnHeight,
} from '../src/cycles';
import type { PoxInfo } from '../src/types';
import { POX_INFO, REGTEST_POX_INFO } from './fixtures/pox-info';

describe('BOND_END_OFFSET_PERIODS', () => {
  it('equals 6 (BOND_LENGTH_CYCLES / BOND_GAP_CYCLES)', () => {
    expect(BOND_END_OFFSET_PERIODS).toBe(6);
  });
});

describe('isInPreparePhase', () => {
  // For currentCycle=10:
  // - reward-cycle-to-burn-height(11) = 666050 + 11 * 2100 = 689_150
  // - boundary = 689_150 - 100 = 689_050 -> first burn-height in prepare phase.
  const BOUNDARY = 666_050 + 11 * 2100 - 100; // 689_050

  it('returns true at the boundary (next-cycle BURN-height minus prepareCycleLength)', () => {
    expect(isInPreparePhase({ burnHeight: BOUNDARY, poxInfo: POX_INFO })).toBe(true);
  });

  it('returns false one block before the boundary', () => {
    expect(isInPreparePhase({ burnHeight: BOUNDARY - 1, poxInfo: POX_INFO })).toBe(false);
  });

  it('returns false at the start of the cycle', () => {
    const cycleStart = 666_050 + 10 * 2100;
    expect(isInPreparePhase({ burnHeight: cycleStart, poxInfo: POX_INFO })).toBe(false);
  });

  it('returns false for burnHeight before firstBurnchainBlockHeight', () => {
    expect(isInPreparePhase({ burnHeight: 1, poxInfo: POX_INFO })).toBe(false);
  });
});

describe('isBondActiveAtHeight', () => {
  // firstBondPeriodCycle = 50 (derived from POX_INFO.contractVersions[0].firstRewardCycleId),
  // bondIndex = 0 -> bondStartCycle = 50.
  // bondStartBurn = 666050 + 50 * 2100 = 771_050
  // bondEndCycle = 50 + 6*BOND_GAP_CYCLES (=12) = 62
  // bondEndBurn = 666050 + 62 * 2100 = 796_250
  const bondIndex = 0;
  const BOND_START = 666_050 + 50 * 2100; // 771_050
  const BOND_END = 666_050 + 62 * 2100; // 796_250

  it('is active strictly after the bond start', () => {
    expect(
      isBondActiveAtHeight({
        bondIndex,
        burnHeight: BOND_START + 1,
        poxInfo: POX_INFO,
      })
    ).toBe(true);
  });

  it('is NOT active at the bond start (half-open interval)', () => {
    expect(
      isBondActiveAtHeight({
        bondIndex,
        burnHeight: BOND_START,
        poxInfo: POX_INFO,
      })
    ).toBe(false);
  });

  it('is active at the bond end (inclusive on the right)', () => {
    expect(
      isBondActiveAtHeight({
        bondIndex,
        burnHeight: BOND_END,
        poxInfo: POX_INFO,
      })
    ).toBe(true);
  });

  it('is NOT active one block past the bond end', () => {
    expect(
      isBondActiveAtHeight({
        bondIndex,
        burnHeight: BOND_END + 1,
        poxInfo: POX_INFO,
      })
    ).toBe(false);
  });

  it('throws when pox-5 is not yet activated (no pox-5 row in contractVersions)', () => {
    const preActivation: PoxInfo = { ...POX_INFO, contractVersions: [] };
    expect(() =>
      isBondActiveAtHeight({
        bondIndex,
        burnHeight: BOND_START + 1,
        poxInfo: preActivation,
      })
    ).toThrow(/pox-5 not activated/);
  });
});

describe('minUstxForSatsAmount', () => {
  it('computes ((stxValueRatio * sats) / 100) * minUstxRatioBps / 10000', () => {
    // sats=1_000_000, stxValueRatio=2_000 (uSTX per 100 sats), minUstxRatioBps=500 (5%)
    // step1 = (2000 * 1_000_000) / 100        = 20_000_000
    // step2 = (20_000_000 * 500) / 10000      = 1_000_000
    const out = minUstxForSatsAmount({
      sats: 1_000_000n,
      stxValueRatio: 2_000n,
      minUstxRatioBps: 500,
    });
    expect(out).toBe(1_000_000n);
  });
});

describe('burnHeightToRewardCycle', () => {
  it('round-trips with rewardCycleToBurnHeight', () => {
    expect(burnHeightToRewardCycle({ burnHeight: 305, poxInfo: REGTEST_POX_INFO })).toBe(15);
    expect(rewardCycleToBurnHeight({ rewardCycle: 15, poxInfo: REGTEST_POX_INFO })).toBe(300);
    expect(
      burnHeightToRewardCycle({
        burnHeight: rewardCycleToBurnHeight({ rewardCycle: 42, poxInfo: REGTEST_POX_INFO }),
        poxInfo: REGTEST_POX_INFO,
      })
    ).toBe(42);
  });

  it('mirrors the contract runtime-abort before first-burnchain-block-height', () => {
    expect(() =>
      burnHeightToRewardCycle({
        burnHeight: -1,
        poxInfo: { ...REGTEST_POX_INFO, firstBurnchainBlockHeight: 0 },
      })
    ).toThrow('before first-burnchain-block-height');
  });
});

describe('bondRegisterRanges', () => {
  it('yields the pre-start reward-phase windows, clamped at chain start', () => {
    const ranges = bondRegisterRanges({ bondIndex: 10, poxInfo: REGTEST_POX_INFO });
    expect(ranges.length).toBeGreaterThan(0);
    for (const r of ranges) {
      expect(r.endBurnHeight).toBeGreaterThan(r.startBurnHeight);
      expect(r.length).toBe(r.endBurnHeight - r.startBurnHeight);
    }
  });

  it('clamps the earliest window(s) at firstBurnchainBlockHeight instead of going negative', () => {
    const ranges = bondRegisterRanges({
      bondIndex: 0,
      poxInfo: { ...REGTEST_POX_INFO, firstBurnchainBlockHeight: 0 },
    });
    for (const r of ranges) {
      expect(r.startBurnHeight).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('isInPreparePhase (regtest-shaped snapshot)', () => {
  it('flags the trailing window of each reward cycle', () => {
    expect(isInPreparePhase({ burnHeight: 314, poxInfo: REGTEST_POX_INFO })).toBe(false);
    expect(isInPreparePhase({ burnHeight: 316, poxInfo: REGTEST_POX_INFO })).toBe(true);
    expect(isInPreparePhase({ burnHeight: 319, poxInfo: REGTEST_POX_INFO })).toBe(true);
    expect(isInPreparePhase({ burnHeight: 320, poxInfo: REGTEST_POX_INFO })).toBe(false);
  });
});

describe('burnHeightToDistributionIndex / distributionCycleToBurnHeight / currentDistributionCycle', () => {
  it('mirrors the contract runtime-abort before first-burnchain-block-height', () => {
    expect(() =>
      burnHeightToDistributionIndex({
        burnHeight: -1,
        poxInfo: { ...REGTEST_POX_INFO, firstBurnchainBlockHeight: 0 },
      })
    ).toThrow('before first-burnchain-block-height');
  });

  it('ticks distribution cycles twice per reward cycle', () => {
    const distributionCycle = burnHeightToDistributionIndex({
      burnHeight: 305,
      poxInfo: REGTEST_POX_INFO,
    });
    expect(currentDistributionCycle(REGTEST_POX_INFO)).toBe(distributionCycle);
    expect(
      distributionCycleToBurnHeight({ distributionCycle, poxInfo: REGTEST_POX_INFO })
    ).toBeLessThanOrEqual(305);
    expect(
      distributionCycleToBurnHeight({
        distributionCycle: distributionCycle + 1,
        poxInfo: REGTEST_POX_INFO,
      })
    ).toBeGreaterThan(305);
  });
});

describe('bondPeriodToRewardCycle / bondPeriodToBurnHeight', () => {
  it('map a bond index to the same burn height via cycle or direct conversion', () => {
    const bondIndex = 4;
    const cycle = bondPeriodToRewardCycle({ bondIndex, poxInfo: REGTEST_POX_INFO });
    expect(bondPeriodToBurnHeight({ bondIndex, poxInfo: REGTEST_POX_INFO })).toBe(
      rewardCycleToBurnHeight({ rewardCycle: cycle, poxInfo: REGTEST_POX_INFO })
    );
  });
});

describe('firstPox5RewardCycle', () => {
  it('reads the first reward cycle id from contractVersions', () => {
    expect(firstPox5RewardCycle(REGTEST_POX_INFO)).toBe(8);
  });
});

describe('bondPhaseRanges', () => {
  it('are contiguous and ordered: open, locked, unlocked, finished', () => {
    const ranges = bondPhaseRanges({ bondIndex: 4, poxInfo: REGTEST_POX_INFO });
    expect(ranges.map(r => r.name)).toEqual(['open', 'locked', 'unlocked', 'finished']);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]!.startBurnHeight).toBe(ranges[i - 1]!.endBurnHeight);
    }
  });
});

describe('bondStatus', () => {
  it('walks eligible -> open -> locked -> unlocked -> finished', () => {
    const at = (burnHeight: number, isBondSetup: boolean) =>
      bondStatus({
        bondIndex: 10,
        isBondSetup,
        poxInfo: { ...REGTEST_POX_INFO, currentBurnchainBlockHeight: burnHeight } as PoxInfo,
      });
    const start = bondPeriodToBurnHeight({ bondIndex: 10, poxInfo: REGTEST_POX_INFO });
    expect(at(start - 200, false)).toBe('too-early');
    expect(at(start - 10, false)).toBe('eligible');
    expect(at(start + 1, false)).toBe('missed');
    expect(at(start - 10, true)).toBe('open');
    expect(at(start + 1, true)).toBe('locked');
    expect(at(start + 12 * 20 - 5, true)).toBe('unlocked');
    expect(at(start + 12 * 20 + 1, true)).toBe('finished');
  });

  it('still reports unlocked at exactly closeBurnHeight (contract-inclusive end)', () => {
    const start = bondPeriodToBurnHeight({ bondIndex: 10, poxInfo: REGTEST_POX_INFO });
    const close = start + 12 * 20;
    const at = (burnHeight: number) =>
      bondStatus({
        bondIndex: 10,
        isBondSetup: true,
        poxInfo: { ...REGTEST_POX_INFO, currentBurnchainBlockHeight: burnHeight } as PoxInfo,
      });
    // The contract's is-bond-active-at-height is inclusive at the close height,
    // so bondStatus / bondPhaseRanges / isBondActiveAtHeight must all agree there.
    expect(at(close)).toBe('unlocked');
    expect(at(close + 1)).toBe('finished');
    expect(
      isBondActiveAtHeight({ bondIndex: 10, burnHeight: close, poxInfo: REGTEST_POX_INFO })
    ).toBe(true);
    const unlocked = bondPhaseRanges({ bondIndex: 10, poxInfo: REGTEST_POX_INFO })[2]!;
    expect(unlocked.name).toBe('unlocked');
    expect(unlocked.endBurnHeight).toBe(close + 1); // exclusive end
  });
});

describe('isBondActiveAtHeight (regtest-shaped snapshot)', () => {
  it('matches the locked range', () => {
    const start = bondPeriodToBurnHeight({ bondIndex: 10, poxInfo: REGTEST_POX_INFO });
    expect(
      isBondActiveAtHeight({ bondIndex: 10, burnHeight: start + 1, poxInfo: REGTEST_POX_INFO })
    ).toBe(true);
    expect(
      isBondActiveAtHeight({ bondIndex: 10, burnHeight: start - 1, poxInfo: REGTEST_POX_INFO })
    ).toBe(false);
  });
});
