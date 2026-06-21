/**
 * Eligibility preflight coverage for `unstake`.
 * Gates: NotStaking, InvalidOldSignerManager, UnstakeInPreparePhase.
 * All gates are fully covered here.
 */
import {
  fetchEligibleUnstake,
  Pox5ErrorCode,
  type PoxInfo,
} from '../../../src';
import { ACCOUNTS, REGTEST_KEYS, SIGNER_MANAGER, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { useFixtures } from '../../helpers/mock';
import { ensurePox5, getPoxInfo, waitForSignerManager } from '../../helpers/wait';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
const clean = getAccount(REGTEST_KEYS.account4);
// daemon-staked — has an active STX stake; used for staked-path checks
const staker = ACCOUNTS.sbtcDeployer.address;

beforeAll(async () => {
  useFixtures('eligibility-unstake');
  await ensurePox5();
  await waitForSignerManager(SIGNER_MANAGER);
}, 5 * 60_000);

test('NotStaking — clean account has no stake', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleUnstake({
    staker: clean.address,
    oldSignerManager: SIGNER_MANAGER,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.NotStaking);
});

test('InvalidOldSignerManager — wrong old signer for staker', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleUnstake({
    staker,
    oldSignerManager: `${clean.address}.wrong-signer`,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.InvalidOldSignerManager);
});

test('UnstakeInPreparePhase — poxInfo override puts burnHeight in prepare window', async () => {
  const pox = await getPoxInfo();
  const cycleEnd =
    (pox.rewardCycleId + 1) * pox.rewardCycleLength + pox.firstBurnchainBlockHeight;
  const prepPox: PoxInfo = { ...pox, currentBurnchainBlockHeight: cycleEnd - 1 };
  const r = await fetchEligibleUnstake({
    staker: clean.address,
    oldSignerManager: SIGNER_MANAGER,
    poxInfo: prepPox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.UnstakeInPreparePhase);
});
