import { fetchEligibleCalculateRewards } from '../src';
import type { PoxInfo } from '../src/types';
import { REGTEST_POX_INFO } from './fixtures/pox-info';

describe('fetchEligibleCalculateRewards', () => {
  it('throws during distribution cycle 0 without issuing any fetches', async () => {
    const early = { ...REGTEST_POX_INFO, currentBurnchainBlockHeight: 5 } as PoxInfo;
    await expect(
      fetchEligibleCalculateRewards({ bondIndices: [0], poxInfo: early, network: 'devnet' })
    ).rejects.toThrow(/distribution cycle 0/);
  });
});
