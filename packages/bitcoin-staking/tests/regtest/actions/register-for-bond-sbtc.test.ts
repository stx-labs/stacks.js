/**
 * sBTC `register-for-bond` happy path: admin creates a bond, the staker is minted
 * sBTC, registers a `{ kind: 'sbtc' }` lockup, and ends up enrolled. Verified
 * node-only (`/v2`, no `/extended`).
 *
 * The bond index is chosen at run time: pox-5 only allows setup-bond within
 * ~BOND_GAP_CYCLES of the start and register before it, and the chain mines fast,
 * so we take the furthest-out open window for runway before D0.
 *
 * Env preconditions: bond-admin == ACCOUNTS.admin, and the daemon has registered
 * SIGNER_MANAGER + deployed sbtc-token.
 */
import {
  buildRegisterForBond,
  buildSetupBond,
  fetchBond,
  fetchBondAllowance,
  fetchBondMembership,
  fetchSignerInfo,
  minUstxForSatsAmount,
} from '../../../src';
import { Pc } from '@stacks/transactions';
import { ACCOUNTS, REGTEST_KEYS, SIGNER_MANAGER, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { SBTC_ASSET_NAME, SBTC_TOKEN } from '../../helpers/constants';
import {
  broadcastAndWait,
  ensurePox5,
  getNextNonce,
  getPoxInfo,
  waitForSignerManager,
} from '../../helpers/wait';
import { waitForBondWithRunway } from '../../helpers/bond';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';
import { deploySbtcMinter, mintSbtc, fetchSbtcBalance } from '../../helpers/sbtc';

jest.setTimeout(20 * 60_000);

const network = getNetwork();
const admin = ACCOUNTS.admin;
const sbtcDeployer = ACCOUNTS.sbtcDeployer; // owns sbtc-token + the staked signer-manager
const staker = getAccount(REGTEST_KEYS.account6);
const signerManager = SIGNER_MANAGER;

const MAX_SATS = 10_000n;
const FEE = 10_000n;
const TARGET_RATE_BPS = 1_000n; // 10% APY
const STX_VALUE_RATIO = 1_000n; // uSTX per 100 sats
const MIN_USTX_RATIO_BPS = 500n; // 5%
const EARLY_UNLOCK_BYTES = '00'.repeat(683); // opaque to the sBTC path

beforeAll(async () => {
  useFixtures('register-for-bond-sbtc');
  await ensurePox5();
  await waitForSignerManager(signerManager);
}, 20 * 60_000);

test('sbtc register-for-bond happy path: setup-bond → mint → register → enrolled', async () => {
  const signerInfo = await fetchSignerInfo({ signerManager, network });
  if (!signerInfo) throw `${signerManager} not registered`;

  expect(await fetchBondMembership({ address: staker.address, network })).toBeUndefined();

  await deploySbtcMinter({ deployerKey: sbtcDeployer.key, network });

  const { bondIndex, bondStartHeight, poxInfo } = await waitForBondWithRunway();
  console.log('chosen bond', { bondIndex, bondStartHeight, burn: poxInfo.currentBurnchainBlockHeight });

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
  const setupTransaction = signTransaction(setupUnsigned, admin.key);
  await broadcastAndWait(setupTransaction, admin.address, network);

  const bond = await fetchBond({ bondIndex, network });
  if (!bond) throw 'setup-bond aborted';
  expect(bond.stxValueRatio).toBe(STX_VALUE_RATIO);
  expect(bond.minUstxRatioBps).toBe(Number(MIN_USTX_RATIO_BPS));
  expect(await fetchBondAllowance({ bondIndex, address: staker.address, network })).toBe(MAX_SATS);

  // MINT
  await mintSbtc({
    deployer: sbtcDeployer.address,
    sender: admin,
    recipient: staker.address,
    sats: MAX_SATS,
    nonce: adminNonce++,
    fee: FEE,
    network,
  });
  const sbtcBalance = await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: staker.address, network });
  expect(sbtcBalance).toBeGreaterThanOrEqual(MAX_SATS);

  // REGISTER
  const amountUstx = minUstxForSatsAmount({
    sats: MAX_SATS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
  });

  const poxBeforeRegister = await getPoxInfo();
  expect(poxBeforeRegister.currentBurnchainBlockHeight).toBeLessThan(bondStartHeight);

  const registerUnsigned = await buildRegisterForBond({
    bondIndex,
    signerManager,
    amountUstx,
    lockup: { kind: 'sbtc', sbtcSats: MAX_SATS },
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
    postConditions: [Pc.principal(staker.address).willSendEq(MAX_SATS).ft(SBTC_TOKEN, SBTC_ASSET_NAME)],
  });
  const registerTransaction = signTransaction(registerUnsigned, staker.key);
  await broadcastAndWait(registerTransaction, staker.address, network);

  useFixtures('register-for-bond-sbtc-after');

  const membershipAfter = await fetchBondMembership({ address: staker.address, network });
  if (!membershipAfter) throw 'register-for-bond aborted';
  expect(membershipAfter.bondIndex).toBe(bondIndex);
  expect(membershipAfter.isL1Lock).toBe(false);
  expect(membershipAfter.amountUstx).toBe(amountUstx);

  const sbtcAfter = await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: staker.address, network });
  expect(sbtcAfter).toBe(sbtcBalance - MAX_SATS);
});
