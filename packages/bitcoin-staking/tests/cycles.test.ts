import {
  BOND_END_OFFSET_PERIODS,
  isBondActiveAtHeight,
  isInPreparePhase,
  minUstxForSatsAmount,
} from '../src/cycles';
import type { PoxInfo } from '../src/types';

/** Minimal PoxInfo fixture sufficient for the cycle-math helpers under test. */
const POX_INFO: PoxInfo = {
  contractId: 'SP000000000000000000002Q6VF78.pox-5',
  currentBurnchainBlockHeight: 700_000,
  firstBurnchainBlockHeight: 666_050,
  rewardCycleId: 10,
  rewardCycleLength: 2100,
  prepareCycleLength: 100,
  rewardSlots: 4000,
  currentCycle: { id: 10, stakedUstx: 0n, isPoxActive: true },
  nextCycle: { id: 11, stakedUstx: 0n, isPoxActive: true },
  contractVersions: [
    {
      contractId: "SP000000000000000000002Q6VF78.pox-5",
      activationBurnchainBlockHeight: 666_050,
      firstRewardCycleId: 50,
    },
  ],
};

describe("BOND_END_OFFSET_PERIODS", () => {
  it("equals 6 (BOND_LENGTH_CYCLES / BOND_GAP_CYCLES)", () => {
    expect(BOND_END_OFFSET_PERIODS).toBe(6);
  });
});

describe("isInPreparePhase", () => {
  // For currentCycle=10:
  // - reward-cycle-to-burn-height(11) = 666050 + 11 * 2100 = 689_150
  // - boundary = 689_150 - 100 = 689_050 → first burn-height in prepare phase.
  const BOUNDARY = 666_050 + 11 * 2100 - 100; // 689_050

  it("returns true at the boundary (next-cycle BURN-height minus prepareCycleLength)", () => {
    expect(isInPreparePhase({ burnHeight: BOUNDARY, poxInfo: POX_INFO })).toBe(
      true,
    );
  });

  it("returns false one block before the boundary", () => {
    expect(
      isInPreparePhase({ burnHeight: BOUNDARY - 1, poxInfo: POX_INFO }),
    ).toBe(false);
  });

  it("returns false at the start of the cycle", () => {
    const cycleStart = 666_050 + 10 * 2100;
    expect(
      isInPreparePhase({ burnHeight: cycleStart, poxInfo: POX_INFO }),
    ).toBe(false);
  });

  it("returns false for burnHeight before firstBurnchainBlockHeight", () => {
    expect(isInPreparePhase({ burnHeight: 1, poxInfo: POX_INFO })).toBe(false);
  });
});

describe("isBondActiveAtHeight", () => {
  // firstBondPeriodCycle = 50 (derived from POX_INFO.contractVersions[0].firstRewardCycleId),
  // bondIndex = 0 ⇒ bondStartCycle = 50.
  // bondStartBurn = 666050 + 50 * 2100 = 771_050
  // bondEndCycle = 50 + 6*BOND_GAP_CYCLES (=12) = 62
  // bondEndBurn = 666050 + 62 * 2100 = 796_250
  const bondIndex = 0;
  const BOND_START = 666_050 + 50 * 2100; // 771_050
  const BOND_END = 666_050 + 62 * 2100; // 796_250

  it("is active strictly after the bond start", () => {
    expect(
      isBondActiveAtHeight({
        bondIndex,
        burnHeight: BOND_START + 1,
        poxInfo: POX_INFO,
      }),
    ).toBe(true);
  });

  it("is NOT active at the bond start (half-open interval)", () => {
    expect(
      isBondActiveAtHeight({
        bondIndex,
        burnHeight: BOND_START,
        poxInfo: POX_INFO,
      }),
    ).toBe(false);
  });

  it("is active at the bond end (inclusive on the right)", () => {
    expect(
      isBondActiveAtHeight({
        bondIndex,
        burnHeight: BOND_END,
        poxInfo: POX_INFO,
      }),
    ).toBe(true);
  });

  it("is NOT active one block past the bond end", () => {
    expect(
      isBondActiveAtHeight({
        bondIndex,
        burnHeight: BOND_END + 1,
        poxInfo: POX_INFO,
      }),
    ).toBe(false);
  });

  it("throws when pox-5 is not yet activated (no pox-5 row in contractVersions)", () => {
    const preActivation: PoxInfo = { ...POX_INFO, contractVersions: [] };
    expect(() =>
      isBondActiveAtHeight({
        bondIndex,
        burnHeight: BOND_START + 1,
        poxInfo: preActivation,
      }),
    ).toThrow(/pox-5 not activated/);
  });
});

describe("minUstxForSatsAmount", () => {
  it("computes ((stxValueRatio * sats) / 100) * minUstxRatioBps / 10000", () => {
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
