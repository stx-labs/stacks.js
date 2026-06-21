/**
 * Eligibility preflight coverage for `stake` (STX-only entry).
 * Gates: StakeInPreparePhase, SignerNotFound, SignerKeyGrantNotFound,
 * InvalidStartBurnHeight, InvalidNumCycles, AlreadyStaked, InsufficientStx.
 * RolloverTooEarly needs a prior L1 membership — deferred.
 */
import {
  fetchEligibleStake,
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
// daemon-staked — fetchStakerInfo.staked is true; used for AlreadyStaked check
const stakedAccount = ACCOUNTS.sbtcDeployer.address;
const unknownSigner = `${clean.address}.signer-manager`;

beforeAll(async () => {
  useFixtures('eligibility-stake');
  await ensurePox5();
  await waitForSignerManager(SIGNER_MANAGER);
}, 5 * 60_000);

test('StakeInPreparePhase — poxInfo override puts burnHeight in prepare window', async () => {
  const pox = await getPoxInfo();
  const cycleEnd =
    (pox.rewardCycleId + 1) * pox.rewardCycleLength + pox.firstBurnchainBlockHeight;
  const prepPox: PoxInfo = { ...pox, currentBurnchainBlockHeight: cycleEnd - 1 };
  const r = await fetchEligibleStake({
    staker: clean.address,
    signerManager: SIGNER_MANAGER,
    amountUstx: 1_000_000n,
    numCycles: 1,
    startBurnHt: prepPox.currentBurnchainBlockHeight,
    poxInfo: prepPox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.StakeInPreparePhase);
});

test('SignerNotFound — unknown signer-manager contract', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleStake({
    staker: clean.address,
    signerManager: unknownSigner,
    amountUstx: 1_000_000n,
    numCycles: 1,
    startBurnHt: pox.currentBurnchainBlockHeight,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.SignerNotFound);
});

test('InvalidStartBurnHeight — startBurnHt far in the past (wrong cycle)', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleStake({
    staker: clean.address,
    signerManager: SIGNER_MANAGER,
    amountUstx: 1_000_000n,
    numCycles: 1,
    startBurnHt: 1, // genesis — definitely not the current cycle
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.InvalidStartBurnHeight);
});

test('InvalidNumCycles — numCycles 0 is below minimum', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleStake({
    staker: clean.address,
    signerManager: SIGNER_MANAGER,
    amountUstx: 1_000_000n,
    numCycles: 0,
    startBurnHt: pox.currentBurnchainBlockHeight,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.InvalidNumCycles);
});

test('InvalidNumCycles — numCycles > MAX_NUM_CYCLES (12)', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleStake({
    staker: clean.address,
    signerManager: SIGNER_MANAGER,
    amountUstx: 1_000_000n,
    numCycles: 9999,
    startBurnHt: pox.currentBurnchainBlockHeight,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.InvalidNumCycles);
});

test('AlreadyStaked — sbtcDeployer is daemon-staked every cycle', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleStake({
    staker: stakedAccount,
    signerManager: SIGNER_MANAGER,
    amountUstx: 1_000_000n,
    numCycles: 1,
    startBurnHt: pox.currentBurnchainBlockHeight,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.AlreadyStaked);
});

test('InsufficientStx — amountUstx vastly exceeds any real balance', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleStake({
    staker: clean.address,
    signerManager: SIGNER_MANAGER,
    amountUstx: 10_000_000_000_000_000n,
    numCycles: 1,
    startBurnHt: pox.currentBurnchainBlockHeight,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.InsufficientStx);
});

// TODO(coverage): SignerKeyGrantNotFound — requires a registered signer-manager
// with a revoked or missing grant. Not achievable read-only.

// TODO(coverage): RolloverTooEarly — needs a bond membership whose L1 unlock
// height is in the future. Requires prior L1 register-for-bond state.
