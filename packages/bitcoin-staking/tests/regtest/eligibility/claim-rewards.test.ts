/**
 * Eligibility preflight coverage for `claim-rewards`.
 * Only gate: NoClaimableRewards (total earned == 0).
 */
import { fetchEligibleClaimRewards, Pox5ErrorCode } from '../../../src';
import { REGTEST_KEYS, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { useFixtures } from '../../helpers/mock';
import { ensurePox5, getPoxInfo } from '../../helpers/wait';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
const clean = getAccount(REGTEST_KEYS.account4);
// Non-existent signer-manager — fetchEarned returns 0 for every cycle
const unknownSigner = `${clean.address}.signer-manager`;

beforeAll(async () => {
  useFixtures('eligibility-claim-rewards');
  await ensurePox5();
}, 5 * 60_000);

test('NoClaimableRewards — unknown signer-manager with no earned rewards', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleClaimRewards({
    signerManager: unknownSigner,
    rewardCycle: pox.rewardCycleId,
    bondIndices: [],
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.NoClaimableRewards);
});

// ok:true is not tested here — it requires a signer-manager that has accrued
// rewards in the given cycle, which depends on prior calculate-rewards state
// that may not exist in the current chain snapshot.
