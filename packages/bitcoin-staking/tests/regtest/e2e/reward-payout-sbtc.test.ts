/**
 * Reward PAYOUT arrival for a STANDARD EOA staker (core pox-5 coverage): prove that
 * protocol rewards actually LAND in a plain account's sBTC balance — not just accrue.
 *
 * pox-5 funds rewards purely from sBTC sent to the pox-5 contract; out of the box the
 * pot is empty (which is why bond-lifecycle only asserts earned >= 0). Here the test
 * PROVISIONS the fuel itself, then drives the full payout chain and asserts the staker's
 * sBTC balance rises:
 *   1. register the EOA (sBTC, no signer-calldata → no pox-addr → sBTC payout path)
 *   2. deposit reward sBTC into the pox-5 contract principal (the pot)
 *   3. calculate-rewards — settle the pot into per-share accruals
 *   4. signer-manager claim-rewards — pull the signer's share pox-5 → signer-manager
 *   5. signer-manager claim-staker-rewards(staker) — transfer the staker's share to it
 *   6. assert the staker's sBTC balance increased
 *
 * SDK-gap finding (see specs/staker-vault-QUIRKS.md): steps 4-5 are on the SIGNER-MANAGER
 * contract (pox-5-signer.clar), which the SDK has NO builders for — buildClaimRewards
 * targets pox-5's own claim-rewards (needs contract-caller == signer), unusable by an
 * EOA. So we raw makeContractCall the signer-manager. Both its routes are "callable by
 * anyone".
 *
 * The staker is a dedicated fresh key (below): it registers (sBTC) and never unstakes, so
 * it leaves a permanent bond membership — a manual re-record needs a new key here.
 */
import { Cl, makeContractCall } from '@stacks/transactions';
import {
  buildCalculateRewards,
  buildRegisterForBond,
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
import { ACCOUNTS, SIGNER_MANAGER, getAccount, type Account } from '../regtest';
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

jest.setTimeout(12 * 60_000);

const network = getNetwork();
const sbtcDeployer = ACCOUNTS.sbtcDeployer;
const signerManager = SIGNER_MANAGER;
// Dedicated fresh EOA staker: registers (sBTC) and never unstakes → permanent membership.
const staker = getAccount('2b105a27ad9b6ccb8e18a3852ace255d9f7845224bba4a4debdb9595ce47655b01');
// Holds + deposits the reward sBTC into the pox-5 pot.
const funder = getAccount('7f3c6b0a1d4e2c9b8a5f0e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b01');
const [signerAddr, signerName] = SIGNER_MANAGER.split('.') as [string, string];
const [sbtcAddr, sbtcName] = SBTC_TOKEN.split('.') as [string, string];

const MAX_SATS = 10_000n;
const FEE = 10_000n;
const FUND = 1_000_000_000n;
const FUEL_SATS = 100_000_000n; // large so the staker's share (vs the daemon's competing stakes) rounds > 0
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);

let admin: Account; // bond-admin
let pox5Principal: string;

beforeAll(async () => {
  admin = await getBondAdminAccount();
  useFixtures('reward-payout-sbtc');
  await ensurePox5();
  await waitForSignerManager(signerManager);
  pox5Principal = `${network.bootAddress}.pox-5`;

  let n = await getNextNonce(ACCOUNTS.admin.address);
  await fundStx({ funder: ACCOUNTS.admin, recipient: staker.address, amountUstx: FUND, nonce: n++, fee: FEE, network });
  await fundStx({ funder: ACCOUNTS.admin, recipient: funder.address, amountUstx: FUND, nonce: n++, fee: FEE, network });
}, 8 * 60_000);

test('protocol rewards arrive in a standard EOA staker’s sBTC balance', async () => {
  // sbtc minter deploy in the retryable body (races the daemon on sbtcDeployer).
  useFixtures('reward-payout-sbtc-minter');
  await deploySbtcMinter({ deployerKey: sbtcDeployer.key, network });

  const { bondIndex, bondStartHeight, poxInfo } = await waitForBondWithRunway(15);
  console.log('chosen bond', { bondIndex, bondStartHeight });

  let adminNonce = await getNextNonce(admin.address);
  useFixtures('reward-payout-sbtc-setup');
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
  if (!(await fetchBond({ bondIndex, network }))) throw 'setup-bond aborted';

  // mint sBTC to the staker + register it (sBTC path, NO signer-calldata → no pox-addr → sBTC payout).
  useFixtures('reward-payout-sbtc-mint-staker');
  await mintSbtc({ deployer: sbtcDeployer.address, sender: admin, recipient: staker.address, sats: MAX_SATS, nonce: adminNonce++, fee: FEE, network });

  const amountUstx = minUstxForSatsAmount({ sats: MAX_SATS, stxValueRatio: STX_VALUE_RATIO, minUstxRatioBps: MIN_USTX_RATIO_BPS });
  // Preflight (gate + surface the abort reason) — the register otherwise aborts silently
  // via broadcastAndWait (nonce advances on an abort_by_response) and the membership read
  // then throws a bare "register-for-bond aborted".
  const eligible = await fetchEligibleRegisterForBond({ bondIndex, staker: staker.address, amountUstx, lockup: { kind: 'sbtc', sbtcSats: MAX_SATS }, signerManager, poxInfo: await getPoxInfo(), network });
  if (!eligible.ok) console.log('register preflight reasons', eligible.reasons);
  expect(eligible.ok).toBe(true);

  useFixtures('reward-payout-sbtc-register');
  const registerUnsigned = await buildRegisterForBond({
    bondIndex,
    signerManager,
    amountUstx,
    lockup: { kind: 'sbtc', sbtcSats: MAX_SATS },
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(signTransaction(registerUnsigned, staker.key), staker.address, network);
  useFixtures('reward-payout-sbtc-registered');
  const membership = await fetchBondMembership({ address: staker.address, network });
  if (!membership) throw 'register-for-bond aborted';
  expect(membership.bondIndex).toBe(bondIndex);
  expect(membership.isL1Lock).toBe(false);

  // bond starts → locked; staker has shares.
  useFixtures('reward-payout-sbtc-started');
  await waitForBurnBlockHeight(bondStartHeight + 1);
  const firstRewardCycle = bondPeriodToRewardCycle({ bondIndex, poxInfo });
  expect(await fetchBondStatus({ bondIndex, network })).toBe('locked');
  expect(
    await fetchStakerSharesStakedForCycle({ staker: staker.address, signer: signerManager, rewardCycle: firstRewardCycle, bondIndex, network })
  ).toBeGreaterThan(0n);

  // DEPOSIT REWARD FUEL: mint sBTC to the funder, then transfer it into the pox-5 pot.
  useFixtures('reward-payout-sbtc-fuel-mint');
  await mintSbtc({ deployer: sbtcDeployer.address, sender: admin, recipient: funder.address, sats: FUEL_SATS, nonce: await getNextNonce(admin.address), fee: FEE, network });
  useFixtures('reward-payout-sbtc-fuel-deposit');
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
  useFixtures('reward-payout-sbtc-settle');
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
  // signer's gross share pox-5 → signer-manager, AND runs settle-rewards — which copies the
  // GLOBAL rewards-per-token (set by calculate-rewards) into the per-signer map that
  // get-earned-staker-rewards reads. Without this settle, staker earned reads 0 even after
  // calculate-rewards. Pass the FULL active-bond set (same as calculate-rewards), else it aborts.
  useFixtures('reward-payout-sbtc-signer-claim');
  const signerClaim = await makeContractCall({
    contractAddress: signerAddr,
    contractName: signerName,
    functionName: 'claim-rewards',
    functionArgs: [Cl.list(bondIndices.map(i => Cl.uint(i))), Cl.uint(claimCycle)],
    senderKey: admin.key,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
    postConditionMode: 'allow',
  });
  expect((await broadcastAndWaitForTransaction(signerClaim, network)).tx_status).toBe('success');

  // NOW the staker's earned is readable (> 0) — after the settle, not just calculate-rewards.
  useFixtures('reward-payout-sbtc-earned');
  const earned = await fetchEarnedStakerRewards({ signerManager, rewardCycle: claimCycle, bondIndex, staker: staker.address, network }).catch(() => 0n);
  console.log('staker earned rewards after settle', earned);
  expect(earned).toBeGreaterThan(0n);

  // SIGNER-MANAGER claim-staker-rewards(staker) → transfers the staker's share to it.
  useFixtures('reward-payout-sbtc-staker-claim');
  const stakerSbtcBefore = await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: staker.address, network });
  const stakerClaim = await makeContractCall({
    contractAddress: signerAddr,
    contractName: signerName,
    functionName: 'claim-staker-rewards',
    functionArgs: [Cl.address(staker.address), Cl.uint(claimCycle), Cl.some(Cl.uint(bondIndex))],
    senderKey: admin.key,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(stakerClaim, admin.address, network);

  useFixtures('reward-payout-sbtc-arrived');
  const stakerSbtcAfter = await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: staker.address, network });
  console.log('staker sBTC before/after staker-claim', { stakerSbtcBefore, stakerSbtcAfter });
  // THE POINT: rewards actually arrived in the standard EOA staker's sBTC balance.
  expect(stakerSbtcAfter).toBeGreaterThan(stakerSbtcBefore);
});
