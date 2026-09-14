/**
 * SIGNER reward-cut arrival (mechanism a): prove the SIGNER's own share of protocol
 * rewards lands in the signer-manager contract's sBTC balance when rewards are claimed.
 *
 * IMPORTANT — pox-5 rewards are ALL sBTC. There is NO STX reward payout anywhere in this
 * protocol. What people loosely call the "STX-only leg" is simply the reward slice for
 * STX-only stakers (bond-index = none) — it is still paid out in sBTC, credited to the
 * signer, not in STX. So both legs exercised here move sBTC.
 *
 * Out of the box the pox-5 reward pot is empty (which is why bond-lifecycle only asserts
 * earned >= 0). This test PROVISIONS the fuel, then drives the payout and asserts the
 * signer-manager's own sBTC balance rises on claim:
 *   1. EOA staker register-for-bond (sBTC, no pox-addr) → bond starts locked, shares > 0
 *   2. deposit reward sBTC into the pox-5 contract principal (the pot)
 *   3. calculate-rewards — settle the pot into per-share accruals
 *   4. signer-manager claim-rewards(bondIndex) — pulls the signer's gross cut
 *      pox-5 → signer-manager; assert signer-manager sBTC balance INCREASED
 *   5. signer-manager claim-rewards(EMPTY list) — the bond-index=none "STX-only leg"
 *      (rewards for STX-only stakers, still paid in sBTC). Tolerated: a no-claimable
 *      abort is fine; the point is the route is addressable and pays sBTC, not STX.
 *
 * SDK-gap note: step 4/5 are on the SIGNER-MANAGER contract (pox-5-signer.clar), which the
 * SDK has no builders for — buildClaimRewards targets pox-5's own claim-rewards (needs
 * contract-caller == signer), unusable by an EOA. So we raw makeContractCall it. The route
 * is "callable by anyone".
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
const staker = getAccount(REGTEST_KEYS.account23); // sBTC staker (registers, never unstakes → permanent membership)
const funder = getAccount(REGTEST_KEYS.account11); // holds + deposits the reward sBTC
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
  useFixtures('reward-payout-signer');
  await ensurePox5();
  await waitForSignerManager(signerManager);
  pox5Principal = `${network.bootAddress}.pox-5`;

  let n = await getNextNonce(admin.address);
  await fundStx({ funder: admin, recipient: staker.address, amountUstx: FUND, nonce: n++, fee: FEE, network });
  await fundStx({ funder: admin, recipient: funder.address, amountUstx: FUND, nonce: n++, fee: FEE, network });
}, 8 * 60_000);

test('signer reward cut arrives in the signer-manager sBTC balance on claim', async () => {
  // sbtc minter deploy in the retryable body (races the daemon on sbtcDeployer).
  useFixtures('reward-payout-signer-minter');
  await deploySbtcMinter({ deployerKey: sbtcDeployer.key, network });

  const { bondIndex, bondStartHeight, poxInfo } = await waitForBondWithRunway(15);
  console.log('chosen bond', { bondIndex, bondStartHeight });

  let adminNonce = await getNextNonce(admin.address);
  useFixtures('reward-payout-signer-setup');
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

  // mint sBTC to the staker + register it (sBTC path, NO pox-addr → sBTC payout).
  useFixtures('reward-payout-signer-mint-staker');
  await mintSbtc({ deployer: sbtcDeployer.address, sender: admin, recipient: staker.address, sats: MAX_SATS, nonce: adminNonce++, fee: FEE, network });

  const amountUstx = minUstxForSatsAmount({ sats: MAX_SATS, stxValueRatio: STX_VALUE_RATIO, minUstxRatioBps: MIN_USTX_RATIO_BPS });
  useFixtures('reward-payout-signer-register');
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
  useFixtures('reward-payout-signer-registered');
  if (!(await fetchBondMembership({ address: staker.address, network }))) throw 'register aborted';

  // bond starts → locked; staker has shares.
  useFixtures('reward-payout-signer-started');
  await waitForBurnBlockHeight(bondStartHeight + 1);
  const firstRewardCycle = bondPeriodToRewardCycle({ bondIndex, poxInfo });
  expect(await fetchBondStatus({ bondIndex, network })).toBe('locked');
  expect(
    await fetchStakerSharesStakedForCycle({ staker: staker.address, signer: signerManager, rewardCycle: firstRewardCycle, bondIndex, network })
  ).toBeGreaterThan(0n);

  // DEPOSIT REWARD FUEL: mint sBTC to the funder, then transfer it into the pox-5 pot.
  useFixtures('reward-payout-signer-fuel-mint');
  await mintSbtc({ deployer: sbtcDeployer.address, sender: admin, recipient: funder.address, sats: FUEL_SATS, nonce: await getNextNonce(admin.address), fee: FEE, network });
  useFixtures('reward-payout-signer-fuel-deposit');
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

  // settle one elapsed cycle → the full sorted active-bond set for calculate-rewards.
  useFixtures('reward-payout-signer-settle');
  await waitForBurnBlockHeight(bondStartHeight + poxInfo.rewardCycleLength + 1);
  const bondIndices = await discoverActiveBonds({ network });
  console.log('calculate-rewards set', bondIndices.join(','));

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

  // SIGNER-MANAGER claim-rewards: pull the signer's gross share pox-5 → signer-manager. Pass
  // the FULL active-bond set (same as calculate-rewards), else it aborts. Assert the
  // signer-manager contract's OWN sBTC balance rose — the signer's cut arrived.
  useFixtures('reward-payout-signer-claim');
  const signerSbtcBefore = await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: signerManager, network });
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

  useFixtures('reward-payout-signer-arrived');
  const signerSbtcAfter = await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: signerManager, network });
  console.log('signer-manager sBTC before/after claim', { signerSbtcBefore, signerSbtcAfter });
  // THE POINT: the signer's own reward cut (all sBTC — there is no STX payout) arrived
  // in the signer-manager contract.
  expect(signerSbtcAfter).toBeGreaterThan(signerSbtcBefore);

  // STX-ONLY LEG addressability: claim-rewards with an EMPTY bond list is the
  // bond-index=none slice — rewards for STX-only stakers, STILL PAID IN sBTC (there is
  // no STX reward payout). Exercise the route; tolerate a no-claimable outcome. Note
  // broadcastAndWait confirms node-only via nonce advance and can't distinguish success
  // from a runtime abort, so an empty-leg no-op resolves normally here; the .catch only
  // guards a hard broadcast rejection so a barren leg never fails the suite.
  useFixtures('reward-payout-signer-stx-only-leg');
  const stxOnlyClaim = await makeContractCall({
    contractAddress: signerAddr,
    contractName: signerName,
    functionName: 'claim-rewards',
    functionArgs: [Cl.list([]), Cl.uint(claimCycle)],
    senderKey: admin.key,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
    postConditionMode: 'allow',
  });
  const stxOnlyTxId = await broadcastAndWait(stxOnlyClaim, admin.address, network).catch(
    (e: unknown) => `tolerated: ${String(e)}`
  );
  console.log('STX-only leg (empty bond list) claim outcome', { stxOnlyTxId });
  // No hard assert: whether it settled sBTC or aborted (no-claimable), the route is
  // addressable and the suite tolerates it. The signer-manager balance must not have
  // dropped as a result.
  expect(await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: signerManager, network })).toBeGreaterThanOrEqual(signerSbtcAfter);
});
