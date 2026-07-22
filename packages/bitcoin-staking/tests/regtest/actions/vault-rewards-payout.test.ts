/**
 * Reward PAYOUT arrival for a contract-principal staker (specs/staker-vault.md): prove
 * that protocol rewards actually LAND in the vault's sBTC balance — not just accrue.
 *
 * pox-5 funds rewards purely from sBTC sent to the pox-5 contract; out of the box the
 * pot is empty (which is why bond-lifecycle / vault-rewards only assert earned >= 0).
 * Here the test PROVISIONS the fuel, then drives the full payout chain and asserts the
 * vault's sBTC balance rises:
 *   1. register the vault (sBTC, no pox-addr → payout is an on-chain sBTC transfer)
 *   2. deposit reward sBTC into the pox-5 contract principal (the pot)
 *   3. calculate-rewards — settle the pot into per-share accruals
 *   4. signer-manager claim-rewards — pull the signer's share pox-5 → signer-manager
 *   5. signer-manager claim-staker-rewards(vault) — transfer the vault's share to it
 *   6. assert the vault's sBTC balance increased
 *
 * SDK-gap finding (see specs/staker-vault-QUIRKS.md): steps 4-5 are on the SIGNER-MANAGER
 * contract (pox-5-signer.clar), which the SDK has NO builders for — buildClaimRewards
 * targets pox-5's own claim-rewards (needs contract-caller == signer), unusable by an
 * EOA. So we raw makeContractCall the signer-manager. Both its routes are "callable by
 * anyone".
 */
import { Cl, makeContractCall } from '@stacks/transactions';
import {
  buildCalculateRewards,
  buildSetupBond,
  bondPeriodToRewardCycle,
  fetchBond,
  fetchBondMembership,
  fetchBondStatus,
  fetchEarned,
  fetchEarnedStakerRewards,
  fetchEligibleRegisterForBond,
  fetchStakerSharesStakedForCycle,
  minUstxForSatsAmount,
} from '../../../src';
import { ACCOUNTS, REGTEST_KEYS, SIGNER_MANAGER, getAccount, type Account } from '../regtest';
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { getNetwork } from '../../helpers/utils';
import { SBTC_TOKEN } from '../../helpers/constants';
import {
  broadcastAndWait,
  broadcastAndWaitForTransaction,
  ensurePox5,
  fundStx,
  getNextNonce,
  getPoxInfo,
  waitForBurnBlockHeight,
  waitForSignerManager,
} from '../../helpers/wait';
import { discoverActiveBonds, waitForBondWithRunway } from '../../helpers/bond';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';
import { deploySbtcMinter, fetchSbtcBalance, mintSbtc } from '../../helpers/sbtc';
import { STAKER_VAULT_NAME, deployStakerVault } from '../../helpers/staker-vault';

jest.setTimeout(12 * 60_000);

const network = getNetwork();
const sbtcDeployer = ACCOUNTS.sbtcDeployer;
const signerManager = SIGNER_MANAGER;
const funder = getAccount(REGTEST_KEYS.account11); // holds + deposits the reward sBTC
const [signerAddr, signerName] = SIGNER_MANAGER.split('.') as [string, string];
const [sbtcAddr, sbtcName] = SBTC_TOKEN.split('.') as [string, string];

const MAX_SATS = 10_000n;
const FEE = 10_000n;
const FUND = 1_000_000_000n;
const FUEL_SATS = 100_000_000n; // reward sBTC into the pox-5 pot — large so the vault's share (vs the daemon's competing stakes) rounds > 0
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);

let admin: Account; // bond-admin
let vault: string;
let vaultAddress: string;
let pox5Principal: string;

beforeAll(async () => {
  admin = await getBondAdminAccount();
  useFixtures('vault-rewards-payout');
  await ensurePox5();
  await waitForSignerManager(signerManager);
  pox5Principal = `${network.bootAddress}.pox-5`;
  vault = await deployStakerVault({
    deployerKey: ACCOUNTS.admin.key,
    bootAddress: network.bootAddress,
    sbtcToken: SBTC_TOKEN,
    network,
  });
  [vaultAddress] = vault.split('.');

  let n = await getNextNonce(ACCOUNTS.admin.address);
  await fundStx({ funder: ACCOUNTS.admin, recipient: vault, amountUstx: FUND, nonce: n++, fee: FEE, network });
  await fundStx({ funder: ACCOUNTS.admin, recipient: funder.address, amountUstx: FUND, nonce: n++, fee: FEE, network });
}, 8 * 60_000);

test('protocol rewards arrive in a contract staker’s sBTC balance', async () => {
  // sbtc minter deploy in the retryable body (races the daemon on sbtcDeployer).
  useFixtures('vault-rewards-payout-minter');
  await deploySbtcMinter({ deployerKey: sbtcDeployer.key, network });

  const { bondIndex, bondStartHeight, poxInfo } = await waitForBondWithRunway(15);
  console.log('chosen bond', { bondIndex, bondStartHeight });

  let adminNonce = await getNextNonce(admin.address);
  useFixtures('vault-rewards-payout-setup');
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
  if (!(await fetchBond({ bondIndex, network }))) throw 'setup-bond aborted';

  // mint sBTC to the vault + register it (sBTC path, NO pox-addr → sBTC payout).
  useFixtures('vault-rewards-payout-mint-vault');
  await mintSbtc({ deployer: sbtcDeployer.address, sender: admin, recipient: vault, sats: MAX_SATS, nonce: adminNonce++, fee: FEE, network });

  const amountUstx = minUstxForSatsAmount({ sats: MAX_SATS, stxValueRatio: STX_VALUE_RATIO, minUstxRatioBps: MIN_USTX_RATIO_BPS });
  // Preflight the register (surfaces the exact abort reason + gates before the broadcast).
  const eligible = await fetchEligibleRegisterForBond({ bondIndex, staker: vault, amountUstx, satsTotal: MAX_SATS, signerManager, poxInfo: await getPoxInfo(), network });
  if (!eligible.ok) console.log('vault register preflight reasons', eligible.reasons);
  expect(eligible.ok).toBe(true);

  useFixtures('vault-rewards-payout-register');
  const registerTx = await makeContractCall({
    contractAddress: vaultAddress,
    contractName: STAKER_VAULT_NAME,
    functionName: 'register-sbtc',
    functionArgs: [Cl.uint(bondIndex), Cl.address(signerManager), Cl.uint(amountUstx), Cl.uint(MAX_SATS)],
    senderKey: ACCOUNTS.admin.key,
    fee: FEE,
    nonce: await getNextNonce(ACCOUNTS.admin.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(registerTx, ACCOUNTS.admin.address, network);
  useFixtures('vault-rewards-payout-registered');
  if (!(await fetchBondMembership({ address: vault, network }))) throw 'register aborted';

  // bond starts → locked; vault has shares.
  useFixtures('vault-rewards-payout-started');
  await waitForBurnBlockHeight(bondStartHeight + 1);
  const firstRewardCycle = bondPeriodToRewardCycle({ bondIndex, poxInfo });
  expect(await fetchBondStatus({ bondIndex, network })).toBe('locked');
  expect(
    await fetchStakerSharesStakedForCycle({ staker: vault, signer: signerManager, rewardCycle: firstRewardCycle, bondIndex, network })
  ).toBeGreaterThan(0n);

  // DEPOSIT REWARD FUEL: mint sBTC to the funder, then transfer it into the pox-5 pot.
  useFixtures('vault-rewards-payout-fuel-mint');
  await mintSbtc({ deployer: sbtcDeployer.address, sender: admin, recipient: funder.address, sats: FUEL_SATS, nonce: await getNextNonce(admin.address), fee: FEE, network });
  useFixtures('vault-rewards-payout-fuel-deposit');
  const depositTx = await makeContractCall({
    contractAddress: sbtcAddr,
    contractName: sbtcName,
    functionName: 'transfer',
    functionArgs: [Cl.uint(FUEL_SATS), Cl.address(funder.address), Cl.address(pox5Principal), Cl.none()],
    senderKey: funder.key,
    fee: FEE,
    nonce: await getNextNonce(funder.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(depositTx, funder.address, network);

  // settle one elapsed cycle.
  useFixtures('vault-rewards-payout-settle');
  await waitForBurnBlockHeight(bondStartHeight + poxInfo.rewardCycleLength + 1);
  const bondIndices = await discoverActiveBonds({ network });

  const calcUnsigned = await buildCalculateRewards({ bondIndices, publicKey: admin.publicKey, fee: FEE, nonce: await getNextNonce(admin.address), network, postConditionMode: 'allow' });
  await broadcastAndWait(signTransaction(calcUnsigned, admin.key), admin.address, network);

  // Regtest reward cycle-timing is fickle: calculate-rewards credits ONE cycle (the reward
  // cycle of distributionStart-1), which may be firstRewardCycle or an adjacent one. Probe
  // the SIGNER-level earned — the GLOBAL rewards-per-token map, populated by
  // calculate-rewards WITHOUT needing a settle — across a small window to find the credited
  // cycle. Read-only, no broadcasts → replay-safe.
  let claimCycle = -1;
  for (let c = firstRewardCycle; c <= firstRewardCycle + 3; c++) {
    const g = await fetchEarned({ signerManager, rewardCycle: c, bondIndex, network }).catch(() => 0n);
    console.log('signer global earned', { cycle: c, earned: g });
    if (g > 0n) {
      claimCycle = c;
      break;
    }
  }
  expect(claimCycle).toBeGreaterThanOrEqual(0); // calculate-rewards credited some cycle in the window

  // SIGNER-MANAGER claim-rewards (raw; the SDK has no builder for this route). Pulls the
  // signer's gross share pox-5 → signer-manager, AND — load-bearing — runs settle-rewards,
  // which copies the GLOBAL rewards-per-token (set by calculate-rewards) into the per-signer
  // map that get-earned-staker-rewards reads. Without this settle, staker earned reads 0
  // even though calculate-rewards ran. "callable by anyone".
  useFixtures('vault-rewards-payout-signer-claim');
  const signerClaim = await makeContractCall({
    contractAddress: signerAddr,
    contractName: signerName,
    functionName: 'claim-rewards',
    // full active-bond set (same as calculate-rewards) — claim-rewards validates the set too.
    functionArgs: [Cl.list(bondIndices.map(i => Cl.uint(i))), Cl.uint(claimCycle)],
    senderKey: admin.key,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
    postConditionMode: 'allow',
  });
  // Assert the signer claim succeeded — it MUST run settle-rewards for the staker's earned
  // to become readable below (calculate-rewards alone leaves the per-signer map at 0).
  expect((await broadcastAndWaitForTransaction(signerClaim, network)).tx_status).toBe('success');

  // NOW the staker's earned is readable (> 0) — after the signer settle, not just calculate.
  useFixtures('vault-rewards-payout-earned');
  const earned = await fetchEarnedStakerRewards({ signerManager, rewardCycle: claimCycle, bondIndex, staker: vault, network }).catch(() => 0n);
  console.log('vault earned staker rewards after settle', earned);
  expect(earned).toBeGreaterThan(0n);

  // SIGNER-MANAGER claim-staker-rewards(vault) → transfers the vault's share to it.
  useFixtures('vault-rewards-payout-staker-claim');
  const vaultSbtcBefore = await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: vault, network });
  const stakerClaim = await makeContractCall({
    contractAddress: signerAddr,
    contractName: signerName,
    functionName: 'claim-staker-rewards',
    functionArgs: [Cl.address(vault), Cl.uint(claimCycle), Cl.some(Cl.uint(bondIndex))],
    senderKey: admin.key,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(stakerClaim, admin.address, network);

  useFixtures('vault-rewards-payout-arrived');
  const vaultSbtcAfter = await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: vault, network });
  console.log('vault sBTC before/after staker-claim', { vaultSbtcBefore, vaultSbtcAfter });
  // THE POINT: rewards actually arrived in the contract staker's sBTC balance.
  expect(vaultSbtcAfter).toBeGreaterThan(vaultSbtcBefore);
});
