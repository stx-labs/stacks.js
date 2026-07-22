/**
 * Shared `PoxInfo` fixtures for the pure/offline unit tests (cycle math,
 * eligibility, register-flow). Two shapes cover the range the helpers need:
 * a small regtest-shaped snapshot and a mainnet-shaped one.
 */
import type { PoxInfo } from '../../src/types';

/** Regtest-shaped snapshot: cycle length 20, prepare 5, pox-5 from cycle 8. */
export const REGTEST_POX_INFO = {
  firstBurnchainBlockHeight: 0,
  rewardCycleLength: 20,
  prepareCycleLength: 5,
  currentBurnchainBlockHeight: 305,
  rewardCycleId: 15,
  contractId: 'ST000000000000000000002AMW42H.pox-5',
  contractVersions: [{ contractId: 'ST000000000000000000002AMW42H.pox-5', firstRewardCycleId: 8 }],
} as unknown as PoxInfo;

/** Mainnet-shaped snapshot: cycle length 2100, prepare 100, pox-5 from cycle 50. */
export const POX_INFO: PoxInfo = {
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
      contractId: 'SP000000000000000000002Q6VF78.pox-5',
      activationBurnchainBlockHeight: 666_050,
      firstRewardCycleId: 50,
    },
  ],
};
