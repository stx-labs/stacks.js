/**
 * Eligibility preflight coverage for `announce-l1-early-exit`.
 * Gates: NotBondParticipant, StakeInPreparePhase, CannotAnnounceL1EarlyUnlock,
 * InvalidOldSignerManager, L1EarlyExitAlreadyAnnounced.
 *
 * account15 gets a real sBTC membership (isL1Lock=false) so the membership-dependent
 * gates are unconditional — CannotAnnounceL1EarlyUnlock and InvalidOldSignerManager.
 */
import {
  buildRegisterForBond,
  buildSetupBond,
  fetchEligibleAnnounceL1EarlyExit,
  minUstxForSatsAmount,
  Pox5ErrorCode,
  type PoxInfo,
} from '../../../src';
import { Pc } from '@stacks/transactions';
import { ACCOUNTS, REGTEST_KEYS, SIGNER_MANAGER, getAccount, type Account } from '../regtest';
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { getNetwork } from '../../helpers/utils';
import { SBTC_ASSET_NAME, SBTC_TOKEN } from '../../helpers/constants';
import {
  broadcastAndWait,
  ensurePox5,
  fundStx,
  getNextNonce,
  getPoxInfo,
  waitForSignerManager,
} from '../../helpers/wait';
import { waitForBondWithRunway } from '../../helpers/bond';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';
import { deploySbtcMinter, mintSbtc } from '../../helpers/sbtc';

jest.setTimeout(6 * 60_000);

const network = getNetwork();
const sbtcDeployer = ACCOUNTS.sbtcDeployer;
// clean account — no membership
const clean = getAccount(REGTEST_KEYS.account4);
// dedicated staker: gets sBTC membership in beforeAll (isL1Lock=false)
const staker = getAccount(REGTEST_KEYS.account15);

const MAX_SATS = 10_000n;
const FEE = 10_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);

let admin: Account;

beforeAll(async () => {
  admin = await getBondAdminAccount();
  useFixtures('eligibility-announce-l1-early-exit-setup');
  await ensurePox5();
  await waitForSignerManager(SIGNER_MANAGER);

  await fundStx({
    funder: admin,
    recipient: staker.address,
    amountUstx: 10_000_000n,
    nonce: await getNextNonce(admin.address),
    network,
  });

  await deploySbtcMinter({ deployerKey: sbtcDeployer.key, network });

  const { bondIndex } = await waitForBondWithRunway(15);

  let adminNonce = await getNextNonce(admin.address);

  const setupTx = await buildSetupBond({
    bondIndex,
    targetRateBps: 1_000n,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist: [{ staker: staker.address, maxSats: MAX_SATS }],
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: adminNonce++,
    network,
  });
  await broadcastAndWait(signTransaction(setupTx, admin.key), admin.address, network);

  useFixtures('eligibility-announce-l1-early-exit-mint');

  await mintSbtc({
    deployer: sbtcDeployer.address,
    sender: admin,
    recipient: staker.address,
    sats: MAX_SATS,
    nonce: await getNextNonce(admin.address),
    fee: FEE,
    network,
  });

  useFixtures('eligibility-announce-l1-early-exit-register');

  const amountUstx = minUstxForSatsAmount({
    sats: MAX_SATS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
  });
  const regTx = await buildRegisterForBond({
    bondIndex,
    signerManager: SIGNER_MANAGER,
    amountUstx,
    lockup: { kind: 'sbtc', sbtcSats: MAX_SATS },
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
    postConditions: [
      Pc.principal(staker.address).willSendEq(MAX_SATS).ft(SBTC_TOKEN, SBTC_ASSET_NAME),
    ],
  });
  await broadcastAndWait(signTransaction(regTx, staker.key), staker.address, network);

  useFixtures('eligibility-announce-l1-early-exit-checks');
}, 6 * 60_000);

test('NotBondParticipant — clean account has no membership', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleAnnounceL1EarlyExit({
    staker: clean.address,
    oldSignerManager: SIGNER_MANAGER,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.NotBondParticipant);
});

test('StakeInPreparePhase — poxInfo override puts burnHeight in prepare window', async () => {
  const pox = await getPoxInfo();
  const cycleEnd =
    (pox.rewardCycleId + 1) * pox.rewardCycleLength + pox.firstBurnchainBlockHeight;
  const prepPox: PoxInfo = { ...pox, currentBurnchainBlockHeight: cycleEnd - 1 };
  const r = await fetchEligibleAnnounceL1EarlyExit({
    staker: clean.address,
    oldSignerManager: SIGNER_MANAGER,
    poxInfo: prepPox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.StakeInPreparePhase);
});

test('CannotAnnounceL1EarlyUnlock — staker membership is sBTC (isL1Lock=false)', async () => {
  // staker registered via sBTC; the contract only permits announce-l1-early-exit for L1 locks.
  const pox = await getPoxInfo();
  const r = await fetchEligibleAnnounceL1EarlyExit({
    staker: staker.address,
    oldSignerManager: SIGNER_MANAGER,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.CannotAnnounceL1EarlyUnlock);
});

test('InvalidOldSignerManager — wrong old signer for the enrolled staker', async () => {
  const pox = await getPoxInfo();
  // staker's real signer is SIGNER_MANAGER; a wrong one triggers InvalidOldSignerManager
  const r = await fetchEligibleAnnounceL1EarlyExit({
    staker: staker.address,
    oldSignerManager: `${clean.address}.wrong-signer`,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.InvalidOldSignerManager);
});

// TODO(coverage): L1EarlyExitAlreadyAnnounced — requires an L1-lock membership that
// has already had announce-l1-early-exit broadcast and confirmed. An sBTC-registered
// staker is the wrong kind; an L1 registration needs a real BTC lockup + SPV proof.
// Not achievable in a read-only pass without prior state mutation.
