/**
 * Eligibility preflight coverage for `unstake-sbtc`.
 * Gates: NotBondParticipant, InvalidUnstakeSbtcAmount, StakeInPreparePhase,
 * InvalidOldSignerManager, CannotUnstakeSbtc.
 *
 * account16 gets a real sBTC membership (isL1Lock=false) so the membership-dependent
 * gates are unconditional — InvalidUnstakeSbtcAmount and InvalidOldSignerManager.
 */
import {
  buildRegisterForBond,
  buildSetupBond,
  fetchEligibleUnstakeSbtc,
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
// dedicated staker: gets sBTC membership in beforeAll
const staker = getAccount(REGTEST_KEYS.account16);

const MAX_SATS = 10_000n;
const FEE = 10_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);

let admin: Account;

beforeAll(async () => {
  admin = await getBondAdminAccount();
  useFixtures('eligibility-unstake-sbtc-setup');
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

  useFixtures('eligibility-unstake-sbtc-mint');

  await mintSbtc({
    deployer: sbtcDeployer.address,
    sender: admin,
    recipient: staker.address,
    sats: MAX_SATS,
    nonce: await getNextNonce(admin.address),
    fee: FEE,
    network,
  });

  useFixtures('eligibility-unstake-sbtc-register');

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

  useFixtures('eligibility-unstake-sbtc-checks');
}, 6 * 60_000);

test('NotBondParticipant — clean account has no membership', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleUnstakeSbtc({
    staker: clean.address,
    signerManager: SIGNER_MANAGER,
    amountToWithdrawSats: 1n,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.NotBondParticipant);
});

test('InvalidUnstakeSbtcAmount — withdraw amount exceeds staker enrolled sats', async () => {
  // staker enrolled MAX_SATS; requesting more triggers InvalidUnstakeSbtcAmount
  const pox = await getPoxInfo();
  const r = await fetchEligibleUnstakeSbtc({
    staker: staker.address,
    signerManager: SIGNER_MANAGER,
    amountToWithdrawSats: MAX_SATS + 1n,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.InvalidUnstakeSbtcAmount);
});

test('StakeInPreparePhase — poxInfo override puts burnHeight in prepare window', async () => {
  const pox = await getPoxInfo();
  const cycleEnd =
    (pox.rewardCycleId + 1) * pox.rewardCycleLength + pox.firstBurnchainBlockHeight;
  const prepPox: PoxInfo = { ...pox, currentBurnchainBlockHeight: cycleEnd - 1 };
  const r = await fetchEligibleUnstakeSbtc({
    staker: clean.address,
    signerManager: SIGNER_MANAGER,
    amountToWithdrawSats: 1n,
    poxInfo: prepPox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.StakeInPreparePhase);
});

test('InvalidOldSignerManager — wrong signerManager for enrolled staker', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleUnstakeSbtc({
    staker: staker.address,
    signerManager: `${clean.address}.wrong-signer`,
    amountToWithdrawSats: 1n,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.InvalidOldSignerManager);
});

// TODO(coverage): CannotUnstakeSbtc — requires a membership with isL1Lock=true.
// The staker above registered via sBTC (isL1Lock=false). An L1-lock membership
// requires a real BTC lockup + SPV proof (buildLockProofFromBlock + sendToAddress +
// getBtcTxProofInputs), which is out of scope for this read-focused eligibility suite.
// See register-for-bond-combined.test.ts for the full L1 pattern.
