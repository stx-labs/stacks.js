/**
 * Composed the way an integrator would write it — friction found here is an
 * SDK gap candidate (see ../SDK-GAPS.md). Bond expiry is NOT covered:
 * BOND_LENGTH_CYCLES=12 ≈ 8 min of regtest chain; unstake/early-exit have
 * their own action tests.
 */
import {
  buildCalculateRewards,
  buildClaimRewards,
  buildRegisterForBond,
  buildSetupBond,
  bondPeriodToRewardCycle,
  fetchBond,
  fetchBondAllowance,
  fetchBondMembership,
  fetchBondStatus,
  fetchEarnedStakerRewards,
  fetchProtocolBond,
  fetchSignerInfo,
  fetchStakerSharesStakedForCycle,
  fetchTotalSbtcStakedForBond,
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
  fundStx,
  getNextNonce,
  getStxBalance,
  waitForBurnBlockHeight,
  waitForSignerManager,
} from '../../helpers/wait';
import { waitForBondWithRunway } from '../../helpers/bond';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';
import { deploySbtcMinter, mintSbtc, fetchSbtcBalance } from '../../helpers/sbtc';

jest.setTimeout(6 * 60_000); // runway (≤70s) + D0 wait (≤40s) + 1 cycle (40s) + txs

const network = getNetwork();
let admin: Account;
const sbtcDeployer = ACCOUNTS.sbtcDeployer;
const staker = getAccount(REGTEST_KEYS.account11);
const signerManager = SIGNER_MANAGER;

const MAX_SATS = 10_000n;
const FEE = 10_000n;
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);
const MAX_BOND_INDEX = 64;

beforeAll(async () => {
  admin = await getBondAdminAccount();
  useFixtures('bond-lifecycle');
  await ensurePox5();
  await waitForSignerManager(signerManager);
  await fundStx({
    funder: admin,
    recipient: staker.address,
    amountUstx: 10_000_000n,
    nonce: await getNextNonce(admin.address),
    network,
  });
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
}, 6 * 60_000);

test('bond lifecycle: setup → register → bond starts → rewards settle → claim', async () => {
  expect(await fetchSignerInfo({ signerManager, network })).toBeDefined();
  expect(await fetchBondMembership({ address: staker.address, network })).toBeUndefined();

  // ── admin: setup-bond ──────────────────────────────────────────────────────
  const { bondIndex, bondStartHeight, poxInfo } = await waitForBondWithRunway(15);
  console.log('chosen bond', { bondIndex, bondStartHeight, burn: poxInfo.currentBurnchainBlockHeight });
  expect(await fetchBondStatus({ bondIndex, network })).toBe('eligible');

  const setupUnsigned = await buildSetupBond({
    bondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist: [{ staker: staker.address, maxSats: MAX_SATS }],
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
  });
  await broadcastAndWait(signTransaction(setupUnsigned, admin.key), admin.address, network);

  const bond = await fetchBond({ bondIndex, network });
  if (!bond) throw 'setup-bond aborted';
  expect(await fetchBondAllowance({ bondIndex, address: staker.address, network })).toBe(MAX_SATS);

  // ── staker: register (sBTC lockup) ─────────────────────────────────────────
  const amountUstx = minUstxForSatsAmount({
    sats: MAX_SATS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
  });

  const sbtcBeforeRegister = await fetchSbtcBalance({
    tokenContract: SBTC_TOKEN,
    address: staker.address,
    network,
  });

  useFixtures('bond-lifecycle-registered');
  const registerUnsigned = await buildRegisterForBond({
    bondIndex,
    signerManager,
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

  const membership = await fetchBondMembership({ address: staker.address, network });
  if (!membership) throw 'register-for-bond aborted';
  expect(membership.bondIndex).toBe(bondIndex);
  expect(membership.isL1Lock).toBe(false);
  expect(membership.amountSats).toBe(MAX_SATS);
  // Relative assert: prior runs may have minted to this account already.
  expect(await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: staker.address, network })).toBe(
    sbtcBeforeRegister - MAX_SATS
  );
  expect(await fetchBondStatus({ bondIndex, network })).toBe('open');

  // ── chain: bond starts (D0) ────────────────────────────────────────────────
  useFixtures('bond-lifecycle-started');
  await waitForBurnBlockHeight(bondStartHeight + 1);

  const firstRewardCycle = bondPeriodToRewardCycle({ bondIndex, poxInfo });
  expect(await fetchBondStatus({ bondIndex, network })).toBe('locked');
  expect(await fetchTotalSbtcStakedForBond({ bondIndex, network })).toBe(MAX_SATS);
  const shares = await fetchStakerSharesStakedForCycle({
    staker: staker.address,
    signer: signerManager,
    rewardCycle: firstRewardCycle,
    bondIndex,
    network,
  });
  console.log('staker shares in first bond cycle', { firstRewardCycle, shares });
  expect(shares).toBeGreaterThan(0n);
  expect(await getStxBalance(staker.address)).toBeLessThan(10_000_000n);

  // ── anyone: settle one elapsed cycle, then the staker reads + claims ───────
  useFixtures('bond-lifecycle-rewarded');
  await waitForBurnBlockHeight(bondStartHeight + poxInfo.rewardCycleLength + 1);

  // calculate-rewards demands the FULL active-bond set, sorted by descending
  // stx-value-ratio (aborts u33/u29 otherwise) — so discover bonds first. On a
  // shared chain other suites' bonds may be active alongside ours.
  const bonds: { index: number; ratio: bigint }[] = [];
  for (let i = 0; i < MAX_BOND_INDEX; i++) {
    const b = await fetchProtocolBond({ bondIndex: i, network }).catch(() => undefined);
    if (b) bonds.push({ index: i, ratio: b.stxValueRatio });
  }
  bonds.sort((a, b) => (b.ratio === a.ratio ? b.index - a.index : Number(b.ratio - a.ratio)));
  const bondIndices = bonds.slice(0, 6).map(b => b.index);
  console.log('calculate-rewards set', bondIndices.join(','));

  const calcUnsigned = await buildCalculateRewards({
    bondIndices,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
  });
  await broadcastAndWait(signTransaction(calcUnsigned, staker.key), staker.address, network);

  const earned = await fetchEarnedStakerRewards({
    signerManager,
    rewardCycle: firstRewardCycle,
    bondIndex,
    staker: staker.address,
    network,
  }).catch(() => -1n);
  console.log('earned staker rewards (first bond cycle)', earned);

  // Rewards on regtest depend on the waterfall's BTC inflow — usually 0 — so
  // earned is asserted readable (>= 0), not > 0. The claim still exercises the
  // full builder + entrypoint path.
  expect(earned).toBeGreaterThanOrEqual(0n);

  const claimUnsigned = await buildClaimRewards({
    rewardCycle: firstRewardCycle,
    bondIndices: [bondIndex],
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
  });
  await broadcastAndWait(signTransaction(claimUnsigned, staker.key), staker.address, network);

  // Whatever the claim's outcome (0-reward claims may no-op), the staker's
  // membership must be intact and the bond still active.
  const membershipAfter = await fetchBondMembership({ address: staker.address, network });
  expect(membershipAfter?.bondIndex).toBe(bondIndex);
  expect(await fetchBondStatus({ bondIndex, network })).toBe('locked');
});
