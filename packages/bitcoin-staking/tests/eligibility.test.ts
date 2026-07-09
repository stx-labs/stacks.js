import { fetchEligibleCalculateRewards } from '../src';
import type { PoxInfo } from '../src/types';

const REGTEST_POX_INFO = {
  firstBurnchainBlockHeight: 0,
  rewardCycleLength: 20,
  prepareCycleLength: 5,
  currentBurnchainBlockHeight: 305,
  rewardCycleId: 15,
  contractId: 'ST000000000000000000002AMW42H.pox-5',
  contractVersions: [{ contractId: 'ST000000000000000000002AMW42H.pox-5', firstRewardCycleId: 8 }],
} as unknown as PoxInfo;

describe('fetchEligibleCalculateRewards', () => {
  it('throws during distribution cycle 0 without issuing any fetches', async () => {
    const early = { ...REGTEST_POX_INFO, currentBurnchainBlockHeight: 5 } as PoxInfo;
    await expect(
      fetchEligibleCalculateRewards({ bondIndices: [0], poxInfo: early, network: 'devnet' })
    ).rejects.toThrow(/distribution cycle 0/);
  });
});
