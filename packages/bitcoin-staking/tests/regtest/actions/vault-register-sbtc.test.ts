/**
 * Slice 3 of the staker-vault suite (specs/staker-vault.md): sBTC register through
 * the vault, driven by a DELEGATED KEEPER — the headline feature (user story 11).
 *
 * The admin funds the vault (STX + sBTC) and grants a keeper the single route
 * `register-sbtc` via allow-caller. The keeper — a separate EOA holding only fee
 * STX, no stake funds — then triggers register on the funded vault. Inside, the
 * vault's gate passes (keeper is allowlisted for that fn) and as-contract? makes the
 * vault the staker of record, so pox-5 pulls the sBTC/STX from the VAULT.
 *
 * Two distinct allowlists are in play (easy to conflate):
 *   - pox-5 BOND allowlist  → keyed on the VAULT principal (the staker)
 *   - vault CALLER allowlist → keyed on the KEEPER (who may trigger which fn)
 *
 * Mirrors register-for-bond-sbtc / wrapper-register-sbtc. Admin also drives
 * unstake-sbtc at the end to cover that route.
 */
import { Cl, makeContractCall } from '@stacks/transactions';
import {
  buildSetupBond,
  fetchBond,
  fetchBondAllowance,
  fetchBondMembership,
  fetchEligibleRegisterForBond,
  fetchEligibleUnstakeSbtc,
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
const keeper = getAccount(REGTEST_KEYS.account7); // delegated caller — only fee STX

const MAX_SATS = 10_000n;
const FEE = 10_000n;
const FUND = 1_000_000_000n;
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);

let admin: Account; // bond-admin (for setup-bond)
let vault: string;
let vaultAddress: string;

beforeAll(async () => {
  admin = await getBondAdminAccount();
  useFixtures('vault-register-sbtc');
  await ensurePox5();
  await waitForSignerManager(signerManager);
  await waitForSignerManager(SIGNER_MANAGER_2); // rotation target for update-bond-registration
  vault = await deployStakerVault({
    deployerKey: ACCOUNTS.admin.key, // ACCOUNTS.admin → the vault's ADMIN
    bootAddress: network.bootAddress,
    sbtcToken: SBTC_TOKEN,
    network,
  });
  [vaultAddress] = vault.split('.');

  let n = await getNextNonce(ACCOUNTS.admin.address);
  // vault needs STX (register moves STX even on the sBTC path) …
  await fundStx({ funder: ACCOUNTS.admin, recipient: vault, amountUstx: FUND, nonce: n++, fee: FEE, network });
  // … and the keeper needs only fee STX (no stake funds — that's the point).
  await fundStx({ funder: ACCOUNTS.admin, recipient: keeper.address, amountUstx: FUND, nonce: n++, fee: FEE, network });

  // Vault CALLER allowlist: allow the keeper to trigger the proxied pox-5 routes.
  useFixtures('vault-register-sbtc-granted');
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

test('a delegated keeper registers the funded vault for a bond (sBTC)', async () => {
  const signerInfo = await fetchSignerInfo({ signerManager, network });
  if (!signerInfo) throw `${signerManager} not registered`;

  await deploySbtcMinter({ deployerKey: sbtcDeployer.key, network });

  const { bondIndex, bondStartHeight, poxInfo } = await waitForBondWithRunway();
  console.log('chosen bond', { bondIndex, bondStartHeight, burn: poxInfo.currentBurnchainBlockHeight });

  let adminNonce = await getNextNonce(admin.address);

  // pox-5 BOND allowlist: keyed on the VAULT principal (the staker of record).
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
  expect(await fetchBondAllowance({ bondIndex, address: vault, network })).toBe(MAX_SATS);

  // sBTC minted to the VAULT (it holds the collateral).
  await mintSbtc({
    deployer: sbtcDeployer.address,
    sender: admin,
    recipient: vault,
    sats: MAX_SATS,
    nonce: adminNonce++,
    fee: FEE,
    network,
  });
  const sbtcBefore = await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: vault, network });
  expect(sbtcBefore).toBeGreaterThanOrEqual(MAX_SATS);

  const amountUstx = minUstxForSatsAmount({
    sats: MAX_SATS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
  });
  const poxBeforeRegister = await getPoxInfo();
  expect(poxBeforeRegister.currentBurnchainBlockHeight).toBeLessThan(bondStartHeight);
  const eligible = await fetchEligibleRegisterForBond({
    bondIndex,
    staker: vault,
    amountUstx,
    satsTotal: MAX_SATS,
    signerManager,
    poxInfo: poxBeforeRegister,
    network,
  });
  if (!eligible.ok) console.log('register preflight reasons', eligible.reasons);
  expect(eligible.ok).toBe(true);

  // THE KEEPER (not the admin) drives register — it holds only fee STX.
  useFixtures('vault-register-sbtc-after');
  const registerTx = await makeContractCall({
    contractAddress: vaultAddress,
    contractName: STAKER_VAULT_NAME,
    functionName: 'register-sbtc',
    functionArgs: [Cl.uint(bondIndex), Cl.address(signerManager), Cl.uint(amountUstx), Cl.uint(MAX_SATS)],
    senderKey: keeper.key,
    fee: FEE,
    nonce: await getNextNonce(keeper.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(registerTx, keeper.address, network);

  const membershipAfter = await fetchBondMembership({ address: vault, network });
  if (!membershipAfter) throw 'register-for-bond aborted';
  expect(membershipAfter.bondIndex).toBe(bondIndex);
  expect(membershipAfter.isL1Lock).toBe(false);
  expect(membershipAfter.amountUstx).toBe(amountUstx);

  const sbtcAfter = await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: vault, network });
  expect(sbtcAfter).toBe(sbtcBefore - MAX_SATS);

  // ADMIN unstake-sbtc — withdraw part of the vault's locked sBTC back to the vault.
  // Covers the unstake-sbtc route (admin-triggered). Not valid in the prepare phase.
  const UNSTAKE_SATS = 4_000n;
  useFixtures('vault-register-sbtc-unstaked');
  await waitForRewardPhase(await getPoxInfo());
  const unstakeElig = await fetchEligibleUnstakeSbtc({
    staker: vault,
    signerManager,
    amountToWithdrawSats: UNSTAKE_SATS,
    network,
  });
  if (!unstakeElig.ok) console.log('unstake-sbtc preflight reasons', unstakeElig.reasons);
  expect(unstakeElig.ok).toBe(true);

  const unstakeTx = await makeContractCall({
    contractAddress: vaultAddress,
    contractName: STAKER_VAULT_NAME,
    functionName: 'unstake-sbtc',
    functionArgs: [Cl.address(signerManager), Cl.uint(UNSTAKE_SATS)],
    senderKey: ACCOUNTS.admin.key, // admin-triggered
    fee: FEE,
    nonce: await getNextNonce(ACCOUNTS.admin.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(unstakeTx, ACCOUNTS.admin.address, network);

  useFixtures('vault-register-sbtc-unstaked-after');
  // the withdrawn sats return to the vault's available sBTC balance.
  expect(await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: vault, network })).toBe(
    sbtcAfter + UNSTAKE_SATS
  );

  // UPDATE-BOND-REGISTRATION — admin rotates the vault's signer-manager to SM2.
  // Proves the proxied route works in general (not exhaustive rotation coverage).
  useFixtures('vault-register-sbtc-rotated');
  const rotateTx = await makeContractCall({
    contractAddress: vaultAddress,
    contractName: STAKER_VAULT_NAME,
    functionName: 'update-bond-registration',
    functionArgs: [Cl.address(SIGNER_MANAGER_2), Cl.address(signerManager)],
    senderKey: ACCOUNTS.admin.key,
    fee: FEE,
    nonce: await getNextNonce(ACCOUNTS.admin.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(rotateTx, ACCOUNTS.admin.address, network);

  useFixtures('vault-register-sbtc-rotated-after');
  const rotated = await fetchBondMembership({ address: vault, network });
  expect(rotated?.signer).toBe(SIGNER_MANAGER_2);
});
