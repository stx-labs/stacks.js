/**
 * Eligibility preflight coverage for `update-bond-registration`.
 * Gates: NotBondParticipant, StakeInPreparePhase, InvalidOldSignerManager,
 * UpdateBondSameSigner, SignerNotFound, SignerKeyGrantNotFound.
 *
 * account14 gets a real sBTC membership in beforeAll so the membership-dependent
 * gates are unconditional — no conditional `if (!r.ok)` without the outer expect.
 */
import {
  buildRegisterForBond,
  buildSetupBond,
  fetchEligibleUpdateBondRegistration,
  minUstxForSatsAmount,
  Pox5ErrorCode,
  type PoxInfo,
} from '../../../src';
import { Pc } from '@stacks/transactions';
import { ACCOUNTS, REGTEST_KEYS, SIGNER_MANAGER, SIGNER_MANAGER_2, getAccount, type Account } from '../regtest';
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
// clean account — no membership, used to trigger NotBondParticipant
const clean = getAccount(REGTEST_KEYS.account4);
// dedicated staker: gets a real sBTC membership in beforeAll
const staker = getAccount(REGTEST_KEYS.account14);
// non-existent signer-manager — triggers SignerNotFound
const unknownSigner = `${clean.address}.signer-manager`;

const MAX_SATS = 10_000n;
const FEE = 10_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);

let admin: Account;

beforeAll(async () => {
  admin = await getBondAdminAccount();
  useFixtures('eligibility-update-bond-registration-setup');
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

  // setup-bond allowlisting staker
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

  useFixtures('eligibility-update-bond-registration-mint');

  // mint sBTC to staker
  await mintSbtc({
    deployer: sbtcDeployer.address,
    sender: admin,
    recipient: staker.address,
    sats: MAX_SATS,
    nonce: await getNextNonce(admin.address),
    fee: FEE,
    network,
  });

  useFixtures('eligibility-update-bond-registration-register');

  // register sBTC membership
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

  useFixtures('eligibility-update-bond-registration-checks');
}, 6 * 60_000);

test('NotBondParticipant — clean account has no membership', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleUpdateBondRegistration({
    staker: clean.address,
    signerManager: SIGNER_MANAGER,
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
  const r = await fetchEligibleUpdateBondRegistration({
    staker: clean.address,
    signerManager: SIGNER_MANAGER,
    oldSignerManager: SIGNER_MANAGER,
    poxInfo: prepPox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.StakeInPreparePhase);
});

test('UpdateBondSameSigner — signerManager === oldSignerManager', async () => {
  const pox = await getPoxInfo();
  // staker has a membership; same signer on both sides → UpdateBondSameSigner fires
  const r = await fetchEligibleUpdateBondRegistration({
    staker: staker.address,
    signerManager: SIGNER_MANAGER,
    oldSignerManager: SIGNER_MANAGER,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.UpdateBondSameSigner);
});

test('SignerNotFound — new signerManager does not exist on-chain', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleUpdateBondRegistration({
    staker: staker.address,
    signerManager: unknownSigner,
    oldSignerManager: SIGNER_MANAGER,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.SignerNotFound);
});

test('InvalidOldSignerManager — wrong oldSignerManager for enrolled staker', async () => {
  const pox = await getPoxInfo();
  // staker's real signer is SIGNER_MANAGER; pass SIGNER_MANAGER_2 as old → mismatch
  const r = await fetchEligibleUpdateBondRegistration({
    staker: staker.address,
    signerManager: SIGNER_MANAGER_2,
    oldSignerManager: SIGNER_MANAGER_2,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.InvalidOldSignerManager);
});

// TODO(coverage): SignerKeyGrantNotFound — needs a signer-manager that IS
// registered on-chain but whose grant has been revoked or never issued.
// Not achievable read-only without that prior state mutation.
