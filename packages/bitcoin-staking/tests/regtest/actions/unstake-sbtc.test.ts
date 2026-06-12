/**
 * sBTC bond exit: register an sBTC participant, then `unstake-sbtc` the full
 * amount; assert the sBTC is returned and the global sBTC-staked total falls back.
 * `unstake-sbtc` has no timing guard, so it can run right after register.
 */
import {
  buildRegisterForBond,
  buildSetupBond,
  buildUnstakeSbtc,
  fetchBond,
  fetchTotalSbtcStaked,
  minUstxForSatsAmount,
} from '../../../src';
import { Pc } from '@stacks/transactions';
import { ACCOUNTS, REGTEST_KEYS, SIGNER_MANAGER, getAccount, type Account } from '../regtest';
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
import { deploySbtcMinter, mintSbtc, fetchSbtcBalance } from '../../helpers/sbtc';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
let admin: Account;
const sbtcDeployer = ACCOUNTS.sbtcDeployer;
const staker = getAccount(REGTEST_KEYS.account7);
const signerManager = SIGNER_MANAGER;
const POX5_CONTRACT = 'ST000000000000000000002AMW42H.pox-5' as const; // sends sBTC back on unstake

const MAX_SATS = 10_000n;
const FEE = 10_000n;
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);

beforeAll(async () => {
  admin = await getBondAdminAccount();
  useFixtures('unstake-sbtc');
  await ensurePox5();
  await waitForSignerManager(signerManager);
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

test('sbtc unstake: register → unstake-sbtc → sBTC returned, total falls back', async () => {
  const balanceMinted = await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: staker.address, network });
  expect(balanceMinted).toBeGreaterThanOrEqual(MAX_SATS);
  const totalBefore = await fetchTotalSbtcStaked({ network });

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

  // REGISTER
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
  await broadcastAndWait(signTransaction(registerUnsigned, staker.key), staker.address, network);

  useFixtures('unstake-sbtc-registered');

  expect(await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: staker.address, network })).toBe(
    balanceMinted - MAX_SATS
  );
  expect(await fetchTotalSbtcStaked({ network })).toBe(totalBefore + MAX_SATS);

  // UNSTAKE
  // PC covers the contract → staker sBTC transfer (the sender is the staker).
  const unstakeUnsigned = await buildUnstakeSbtc({
    signerManager,
    amountToWithdrawSats: MAX_SATS,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
    postConditions: [Pc.principal(POX5_CONTRACT).willSendEq(MAX_SATS).ft(SBTC_TOKEN, SBTC_ASSET_NAME)],
  });
  await broadcastAndWait(signTransaction(unstakeUnsigned, staker.key), staker.address, network);

  useFixtures('unstake-sbtc-done');

  expect(await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: staker.address, network })).toBe(
    balanceMinted
  );
  expect(await fetchTotalSbtcStaked({ network })).toBe(totalBefore);
});
