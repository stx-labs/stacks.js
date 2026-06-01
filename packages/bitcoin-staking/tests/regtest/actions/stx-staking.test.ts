/**
 * STX-only staking lifecycle: stake → stake-update (extend + top-up) → unstake.
 * Exercises `buildStake` / `buildStakeUpdate` / `buildUnstake` — the direct pox-5
 * staking product, parallel to the paired-BTC bonds.
 *
 * The staker (`account8`) is NOT prefunded: it's funded in-test from the
 * bond-admin (`fundStx`), demonstrating the pattern that sidesteps the small
 * prefunded-key pool and guarantees a clean (never-staked) account each chain.
 *
 * STX locking is a pox lock, not a token transfer, so no post-conditions are
 * needed under the default deny mode. Record→replay via `useFixtures` with a
 * phase file at each staker-info transition.
 */
import {
  buildStake,
  buildStakeUpdate,
  buildUnstake,
  fetchStakerInfo,
  isInPreparePhase,
} from '../../../src';
import { ACCOUNTS, REGTEST_KEYS, SIGNER_MANAGER, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import {
  broadcastAndWait,
  ensurePox5,
  fundStx,
  getNextNonce,
  getPoxInfo,
  waitForRewardPhase,
  waitForSignerManager,
} from '../../helpers/wait';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';

jest.setTimeout(20 * 60_000);

const network = getNetwork();
const admin = ACCOUNTS.admin; // funder (clean nonce, no daemon drives it)
const staker = getAccount(REGTEST_KEYS.account8); // funded in-test → always clean
const signerManager = SIGNER_MANAGER; // daemon-registered, staked signer-manager

const FEE = 10_000n;
const FUND = 1_000_000_000n; // 1000 STX
const STAKE = 100_000_000n; // 100 STX
const TOPUP = 50_000_000n; // +50 STX
const NUM_CYCLES = 1;
const EXTEND = 2;

beforeAll(async () => {
  useFixtures('stx-staking');
  await ensurePox5();
  await waitForSignerManager(signerManager);
  await fundStx({
    funder: admin,
    recipient: staker.address,
    amountUstx: FUND,
    nonce: await getNextNonce(admin.address),
    fee: FEE,
    network,
  });
}, 20 * 60_000);

test('stx staking lifecycle: stake → extend + top-up → unstake', async () => {
  expect((await fetchStakerInfo({ address: staker.address, network })).staked).toBe(false);

  // --- stake ----------------------------------------------------------------
  // start-burn-ht must fall in the CURRENT cycle (the contract derives
  // first-reward-cycle = current + 1 from it).
  const poxInfo = await getPoxInfo();
  const stakeUnsigned = await buildStake({
    signerManager,
    amountUstx: STAKE,
    numCycles: NUM_CYCLES,
    startBurnHt: poxInfo.currentBurnchainBlockHeight,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
  });
  await broadcastAndWait(signTransaction(stakeUnsigned, staker.key), staker.address, network);

  useFixtures('stx-staking-staked');
  const staked = await fetchStakerInfo({ address: staker.address, network });
  if (!staked.staked) throw new Error('stake aborted: not staked after confirmation');
  expect(staked.details.amountUstx).toBe(STAKE);
  expect(staked.details.numCycles).toBe(NUM_CYCLES);
  expect(staked.details.signer).toBe(signerManager);

  // --- stake-update: extend the lock + top up the amount --------------------
  const updateUnsigned = await buildStakeUpdate({
    signerManager,
    oldSignerManager: signerManager,
    cyclesToExtend: EXTEND,
    amountIncrease: TOPUP,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
  });
  await broadcastAndWait(signTransaction(updateUnsigned, staker.key), staker.address, network);

  useFixtures('stx-staking-updated');
  const updated = await fetchStakerInfo({ address: staker.address, network });
  if (!updated.staked) throw new Error('stake-update aborted: not staked after confirmation');
  expect(updated.details.amountUstx).toBe(STAKE + TOPUP);
  expect(updated.details.numCycles).toBe(NUM_CYCLES + EXTEND);

  // --- unstake (schedule unlock next cycle) ---------------------------------
  // Reverts in the prepare phase (ERR_UNSTAKE_IN_PREPARE_PHASE), so gate first.
  const poxBefore = await getPoxInfo();
  if (isInPreparePhase({ burnHeight: poxBefore.currentBurnchainBlockHeight, poxInfo: poxBefore })) {
    await waitForRewardPhase(poxBefore);
  }
  const unstakeUnsigned = await buildUnstake({
    oldSignerManager: signerManager,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
  });
  await broadcastAndWait(signTransaction(unstakeUnsigned, staker.key), staker.address, network);

  useFixtures('stx-staking-unstaked');
  const unstaked = await fetchStakerInfo({ address: staker.address, network });
  // unstake rewrites num-cycles so the lock ends next cycle → either fully
  // unlocked or its numCycles drops below the extended value.
  expect(!unstaked.staked || unstaked.details.numCycles < NUM_CYCLES + EXTEND).toBe(true);
});
