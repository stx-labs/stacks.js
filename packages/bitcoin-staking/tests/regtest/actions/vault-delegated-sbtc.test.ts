/**
 * Delegated-caller coverage for the sBTC bond routes (specs/staker-vault.md): a
 * KEEPER (allowed caller, only fee-STX) drives register-sbtc → unstake-sbtc →
 * update-bond-registration on the funded vault.
 *
 * Purpose (see specs/staker-vault.md): validate how pox-5 resolves
 * contract-caller/tx-sender/as-contract? when a THIRD PARTY (not the admin, not the
 * staker-of-record) triggers each route — the behavior the SDK must be built around.
 *
 * Lessons applied: the sbtc-minter deploy (from the daemon-staked sbtcDeployer) lives
 * in the retryable test body, not beforeAll; one broadcast per useFixtures phase.
 */
import { Cl, makeContractCall } from '@stacks/transactions';
import {
  buildSetupBond,
  fetchBond,
  fetchBondMembership,
  fetchEligibleRegisterForBond,
  fetchSignerInfo,
  minUstxForSatsAmount,
} from '../../../src';
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
import { SBTC_TOKEN } from '../../helpers/constants';
import {
  broadcastAndWait,
  ensurePox5,
  fundStx,
  getNextNonce,
  getPoxInfo,
  waitForRewardPhase,
  waitForSignerManager,
} from '../../helpers/wait';
import { waitForBondWithRunway } from '../../helpers/bond';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';
import { deploySbtcMinter, fetchSbtcBalance, mintSbtc } from '../../helpers/sbtc';
import { STAKER_VAULT_NAME, deployStakerVault } from '../../helpers/staker-vault';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
const sbtcDeployer = ACCOUNTS.sbtcDeployer;
const signerManager = SIGNER_MANAGER;
const keeper = getAccount(REGTEST_KEYS.account8); // delegated caller — only fee-STX

const MAX_SATS = 10_000n;
const UNSTAKE_SATS = 4_000n;
const FEE = 10_000n;
const FUND = 1_000_000_000n;
const KEEPER_FEES = 1_000_000n;
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);

let admin: Account; // bond-admin
let vault: string;
let vaultAddress: string;

async function keeperCall(
  fn: string,
  args: Parameters<typeof makeContractCall>[0]['functionArgs']
): Promise<void> {
  const tx = await makeContractCall({
    contractAddress: vaultAddress,
    contractName: STAKER_VAULT_NAME,
    functionName: fn,
    functionArgs: args,
    senderKey: keeper.key,
    fee: FEE,
    nonce: await getNextNonce(keeper.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(tx, keeper.address, network);
}

beforeAll(async () => {
  admin = await getBondAdminAccount();
  useFixtures('vault-delegated-sbtc');
  await ensurePox5();
  await waitForSignerManager(signerManager);
  await waitForSignerManager(SIGNER_MANAGER_2);
  vault = await deployStakerVault({
    deployerKey: ACCOUNTS.admin.key,
    bootAddress: network.bootAddress,
    sbtcToken: SBTC_TOKEN,
    network,
  });
  [vaultAddress] = vault.split('.');

  let n = await getNextNonce(ACCOUNTS.admin.address);
  await fundStx({ funder: ACCOUNTS.admin, recipient: vault, amountUstx: FUND, nonce: n++, fee: FEE, network });
  await fundStx({ funder: ACCOUNTS.admin, recipient: keeper.address, amountUstx: KEEPER_FEES, nonce: n++, fee: FEE, network });

  useFixtures('vault-delegated-sbtc-granted');
  const grant = await makeContractCall({
    contractAddress: vaultAddress,
    contractName: STAKER_VAULT_NAME,
    functionName: 'allow-caller',
    functionArgs: [Cl.address(keeper.address)],
    senderKey: ACCOUNTS.admin.key,
    fee: FEE,
    nonce: await getNextNonce(ACCOUNTS.admin.address),
    network,
  });
  await broadcastAndWait(grant, ACCOUNTS.admin.address, network);
}, 5 * 60_000);

test('a delegated keeper drives sBTC: register → unstake-sbtc → rotate signer', async () => {
  expect(await fetchSignerInfo({ signerManager, network })).toBeDefined();

  // sBTC minter deploy in the retryable body (races the daemon on sbtcDeployer).
  useFixtures('vault-delegated-sbtc-minter');
  await deploySbtcMinter({ deployerKey: sbtcDeployer.key, network });

  const { bondIndex, bondStartHeight, poxInfo } = await waitForBondWithRunway();
  console.log('chosen bond', { bondIndex, bondStartHeight, burn: poxInfo.currentBurnchainBlockHeight });

  let adminNonce = await getNextNonce(admin.address);
  useFixtures('vault-delegated-sbtc-setup');
  const setupUnsigned = await buildSetupBond({
    bondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist: [{ staker: vault, maxSats: MAX_SATS }],
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: adminNonce++,
    network,
  });
  await broadcastAndWait(signTransaction(setupUnsigned, admin.key), admin.address, network);
  const bond = await fetchBond({ bondIndex, network });
  if (!bond) throw 'setup-bond aborted';

  useFixtures('vault-delegated-sbtc-mint');
  await mintSbtc({
    deployer: sbtcDeployer.address,
    sender: admin,
    recipient: vault,
    sats: MAX_SATS,
    nonce: adminNonce++,
    fee: FEE,
    network,
  });
  const sbtcMinted = await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: vault, network });
  expect(sbtcMinted).toBeGreaterThanOrEqual(MAX_SATS);

  const amountUstx = minUstxForSatsAmount({
    sats: MAX_SATS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
  });
  const eligible = await fetchEligibleRegisterForBond({
    bondIndex,
    staker: vault,
    amountUstx,
    satsTotal: MAX_SATS,
    signerManager,
    poxInfo: await getPoxInfo(),
    network,
  });
  if (!eligible.ok) console.log('register preflight reasons', eligible.reasons);
  expect(eligible.ok).toBe(true);

  // KEEPER register-sbtc
  useFixtures('vault-delegated-sbtc-registered');
  await keeperCall('register-sbtc', [
    Cl.uint(bondIndex),
    Cl.address(signerManager),
    Cl.uint(amountUstx),
    Cl.uint(MAX_SATS),
  ]);
  useFixtures('vault-delegated-sbtc-registered-after');
  const m1 = await fetchBondMembership({ address: vault, network });
  if (!m1) throw 'register aborted';
  expect(m1.bondIndex).toBe(bondIndex);
  expect(m1.isL1Lock).toBe(false);

  // KEEPER unstake-sbtc
  useFixtures('vault-delegated-sbtc-unstaked');
  await waitForRewardPhase(await getPoxInfo());
  const sbtcBeforeUnstake = await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: vault, network });
  await keeperCall('unstake-sbtc', [Cl.address(signerManager), Cl.uint(UNSTAKE_SATS)]);
  useFixtures('vault-delegated-sbtc-unstaked-after');
  expect(await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: vault, network })).toBe(
    sbtcBeforeUnstake + UNSTAKE_SATS
  );

  // KEEPER update-bond-registration (rotate signer → SM2)
  useFixtures('vault-delegated-sbtc-rotated');
  await keeperCall('update-bond-registration', [Cl.address(SIGNER_MANAGER_2), Cl.address(signerManager)]);
  useFixtures('vault-delegated-sbtc-rotated-after');
  expect((await fetchBondMembership({ address: vault, network }))?.signer).toBe(SIGNER_MANAGER_2);
});
