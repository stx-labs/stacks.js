/**
 * Rotate a bond member's signer-manager via `update-bond-registration`: register
 * an sBTC participant under one signer-manager, then move them to a second (both
 * daemon-registered). Asserts the membership's bound `signer` flips.
 */
import {
  buildRegisterForBond,
  buildSetupBond,
  buildUpdateBondRegistration,
  fetchBond,
  fetchBondMembership,
  minUstxForSatsAmount,
} from '../../../src';
import { Pc } from '@stacks/transactions';
import {
  ACCOUNTS,
  REGTEST_KEYS,
  SIGNER_MANAGER,
  SIGNER_MANAGER_2,
  getAccount,
  type Account,
} from '../regtest';
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { getNetwork } from '../../helpers/utils';
import { SBTC_ASSET_NAME, SBTC_TOKEN } from '../../helpers/constants';
import {
  broadcastAndWait,
  ensurePox5,
  getNextNonce,
  waitForSignerManager,
} from '../../helpers/wait';
import { waitForBondWithRunway } from '../../helpers/bond';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';
import { deploySbtcMinter, mintSbtc } from '../../helpers/sbtc';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
let admin: Account;
const sbtcDeployer = ACCOUNTS.sbtcDeployer;
const staker = getAccount(REGTEST_KEYS.account6);

const MAX_SATS = 10_000n;
const FEE = 10_000n;
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);

beforeAll(async () => {
  admin = await getBondAdminAccount();
  useFixtures('update-bond-registration');
  await ensurePox5();
  await waitForSignerManager(SIGNER_MANAGER);
  await waitForSignerManager(SIGNER_MANAGER_2);
  await deploySbtcMinter({ deployerKey: sbtcDeployer.key, network });
  await mintSbtc({
    deployer: sbtcDeployer.address,
    sender: admin,
    recipient: staker.address,
    sats: MAX_SATS,
    nonce: await getNextNonce(admin.address),
    fee: FEE,
    network,
  });
}, 5 * 60_000);

test('update-bond-registration: rotate the membership signer-manager', async () => {
  const { bondIndex } = await waitForBondWithRunway();
  const amountUstx = minUstxForSatsAmount({
    sats: MAX_SATS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
  });

  let adminNonce = await getNextNonce(admin.address);

  // SETUP BOND
  const setupUnsigned = await buildSetupBond({
    bondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist: [{ staker: staker.address, maxSats: MAX_SATS }],
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: adminNonce++,
    network,
  });
  await broadcastAndWait(signTransaction(setupUnsigned, admin.key), admin.address, network);
  const bond = await fetchBond({ bondIndex, network });
  if (!bond) throw 'setup-bond aborted';

  // REGISTER (signer-manager A)
  const registerUnsigned = await buildRegisterForBond({
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
  await broadcastAndWait(signTransaction(registerUnsigned, staker.key), staker.address, network);

  useFixtures('update-bond-registration-registered');
  const m1 = await fetchBondMembership({ address: staker.address, network });
  if (!m1) throw 'register-for-bond aborted';
  expect(m1.signer).toBe(SIGNER_MANAGER);

  // UPDATE (rotate to signer-manager B)
  const updateUnsigned = await buildUpdateBondRegistration({
    signerManager: SIGNER_MANAGER_2,
    oldSignerManager: SIGNER_MANAGER,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
  });
  await broadcastAndWait(signTransaction(updateUnsigned, staker.key), staker.address, network);

  useFixtures('update-bond-registration-updated');
  const m2 = await fetchBondMembership({ address: staker.address, network });
  if (!m2) throw 'update-bond-registration aborted';
  expect(m2.signer).toBe(SIGNER_MANAGER_2);
});
