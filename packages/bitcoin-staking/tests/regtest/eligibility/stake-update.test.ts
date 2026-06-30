/**
 * Eligibility preflight coverage for `stake-update`.
 * Gates: NotStaking, StakeInPreparePhase, InvalidOldSignerManager,
 * SignerNotFound, SignerKeyGrantNotFound, InvalidNumCycles, InsufficientStx.
 */
import {
  fetchEligibleStakeUpdate,
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
// daemon-staked — has an active STX-only stake; used for staked-state checks
const staker = ACCOUNTS.sbtcDeployer.address;
const unknownSigner = `${clean.address}.signer-manager`;

beforeAll(async () => {
  useFixtures('eligibility-stake-update');
  await ensurePox5();
  await waitForSignerManager(SIGNER_MANAGER);
}, 5 * 60_000);

test('NotStaking — clean account has no stake', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleStakeUpdate({
    staker: clean.address,
    signerManager: SIGNER_MANAGER,
    oldSignerManager: SIGNER_MANAGER,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.NotStaking);
});

test('StakeInPreparePhase — poxInfo override puts burnHeight in prepare window', async () => {
  const pox = await getPoxInfo();
  const cycleEnd =
    (pox.rewardCycleId + 1) * pox.rewardCycleLength + pox.firstBurnchainBlockHeight;
  const prepPox: PoxInfo = { ...pox, currentBurnchainBlockHeight: cycleEnd - 1 };
  const r = await fetchEligibleStakeUpdate({
    staker: clean.address,
    signerManager: SIGNER_MANAGER,
    oldSignerManager: SIGNER_MANAGER,
    poxInfo: prepPox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.StakeInPreparePhase);
});

test('SignerNotFound — unknown signer-manager contract', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleStakeUpdate({
    staker: clean.address,
    signerManager: unknownSigner,
    oldSignerManager: SIGNER_MANAGER,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.SignerNotFound);
});

test('InsufficientStx — amountIncrease far exceeds clean account balance', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleStakeUpdate({
    staker: clean.address,
    signerManager: SIGNER_MANAGER,
    oldSignerManager: SIGNER_MANAGER,
    amountIncrease: 10_000_000_000_000_000n,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.InsufficientStx);
});

test('InvalidOldSignerManager — wrong old signer for staker', async () => {
  // sbtcDeployer is staked; give a wrong oldSignerManager
  const pox = await getPoxInfo();
  const r = await fetchEligibleStakeUpdate({
    staker,
    signerManager: SIGNER_MANAGER,
    oldSignerManager: `${clean.address}.wrong-signer`,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.InvalidOldSignerManager);
});

test('InvalidNumCycles — cyclesToExtend produces tail period <= 0', async () => {
  // Force numCycles to exceed MAX_NUM_CYCLES by using a massive cyclesToExtend
  const pox = await getPoxInfo();
  const r = await fetchEligibleStakeUpdate({
    staker,
    signerManager: SIGNER_MANAGER,
    oldSignerManager: SIGNER_MANAGER,
    cyclesToExtend: 10_000, // far exceeds MAX_NUM_CYCLES (12)
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.InvalidNumCycles);
});

// TODO(coverage): SignerKeyGrantNotFound — requires a registered signer-manager
// with a revoked or missing grant. Not achievable read-only.
