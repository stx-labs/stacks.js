/**
 * STX-only staking lifecycle: stake -> stake-update (extend + top-up) -> unstake.
 * Exercises `buildStake` / `buildStakeUpdate` / `buildUnstake` — the direct pox-5
 * staking product, parallel to the paired-BTC bonds.
 *
 * The staker (`account8`) is NOT prefunded: it's funded in-test from the
 * bond-admin (`fundStx`), demonstrating the pattern that sidesteps the small
 * prefunded-key pool and guarantees a clean (never-staked) account each chain.
 *
 * The a2888b9 pox-5 moves STX during stake/stake-update/unstake
 * (feat/staking-post-condition), so these broadcast with PostConditionMode.Allow.
 * Each broadcast is preflighted with the matching `fetchEligible*` helper, which
 * both exercises it and surfaces the exact abort reason (u24/u47/…) before we
 * broadcast into a cryptic failure.
 */
import {
  buildStake,
  buildStakeUpdate,
  buildUnstake,
  fetchEligibleStake,
  fetchEligibleStakeUpdate,
  fetchEligibleUnstake,
  fetchStakerInfo,
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

jest.setTimeout(5 * 60_000);

const network = getNetwork();
const admin = ACCOUNTS.admin; // funder (clean nonce, no daemon drives it)
const staker = getAccount(REGTEST_KEYS.account8); // funded in-test -> always clean
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
}, 5 * 60_000);

test('stx staking lifecycle: stake → extend + top-up → unstake', async () => {
  expect((await fetchStakerInfo({ address: staker.address, network })).staked).toBe(false);

  // STAKE. start-burn-ht must map to the current cycle AT MINE TIME (the contract
  // derives first-reward-cycle = current + 1 from it). A cycle rollover between
  // read and mine yields ERR_INVALID_START_BURN_HEIGHT (u24), so preflight with
  // fetchEligibleStake (fresh pox each try) and retry across the boundary.
  let staked: Awaited<ReturnType<typeof fetchStakerInfo>> | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    // Re-switch every attempt: a retry (u24 boundary roll) must land its preflight
    // reads back in THIS phase, not the post-broadcast "-after" one from a
    // (hypothetical) prior attempt's tail.
    useFixtures('stx-staking-staked');
    const poxInfo = await getPoxInfo();
    const eligible = await fetchEligibleStake({
      staker: staker.address,
      signerManager,
      amountUstx: STAKE,
      numCycles: NUM_CYCLES,
      startBurnHt: poxInfo.currentBurnchainBlockHeight,
      poxInfo,
      network,
    });
    if (!eligible.ok) {
      console.log('stake not eligible yet, waiting for reward phase:', eligible.reasons);
      await waitForRewardPhase(poxInfo);
      continue;
    }
    const stakeUnsigned = await buildStake({
      signerManager,
      amountUstx: STAKE,
      numCycles: NUM_CYCLES,
      startBurnHt: poxInfo.currentBurnchainBlockHeight,
      publicKey: staker.publicKey,
      fee: FEE,
      nonce: await getNextNonce(staker.address),
      network,
      postConditionMode: 'allow',
    });
    await broadcastAndWait(signTransaction(stakeUnsigned, staker.key), staker.address, network);
    // New phase for the post-broadcast check: `get-staker-info` is also read by
    // the PRE-broadcast eligibility check above under the SAME staker/args key —
    // sharing one phase would let this "now staked" read overwrite that "not
    // staked yet" one (fixtures are keyed by request, latest write wins), so a
    // replay of the preflight would see itself as already-staked (u19) forever.
    useFixtures('stx-staking-staked-after');
    staked = await fetchStakerInfo({ address: staker.address, network });
    if (staked.staked) break; // else a boundary rolled mid-broadcast (u24) — retry
  }
  if (!staked?.staked) throw 'stake aborted';
  expect(staked.details.amountUstx).toBe(STAKE);
  expect(staked.details.numCycles).toBe(NUM_CYCLES);
  expect(staked.details.signer).toBe(signerManager);

  // UPDATE (extend + top-up). New phase: the stake broadcast above and the
  // update broadcast below must not share a phase (one broadcast per phase),
  // else the reused /v2/pox key overwrites the height the stake preflight saw.
  useFixtures('stx-staking-update');
  const updateElig = await fetchEligibleStakeUpdate({
    staker: staker.address,
    signerManager,
    oldSignerManager: signerManager,
    cyclesToExtend: EXTEND,
    amountIncrease: TOPUP,
    network,
  });
  expect(updateElig.ok).toBe(true);
  const updateUnsigned = await buildStakeUpdate({
    signerManager,
    oldSignerManager: signerManager,
    cyclesToExtend: EXTEND,
    amountIncrease: TOPUP,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    postConditionMode: 'allow',
    network,
  });
  await broadcastAndWait(signTransaction(updateUnsigned, staker.key), staker.address, network);

  useFixtures('stx-staking-updated');
  const updated = await fetchStakerInfo({ address: staker.address, network });
  if (!updated.staked) throw 'stake-update aborted';
  expect(updated.details.amountUstx).toBe(STAKE + TOPUP);
  expect(updated.details.numCycles).toBe(NUM_CYCLES + EXTEND);

  // UNSTAKE. Reverts in the prepare phase (ERR_UNSTAKE_IN_PREPARE_PHASE), so
  // preflight with fetchEligibleUnstake and wait for the reward phase if needed.
  let unstakeElig = await fetchEligibleUnstake({
    staker: staker.address,
    oldSignerManager: signerManager,
    network,
  });
  if (!unstakeElig.ok) {
    await waitForRewardPhase(await getPoxInfo());
    unstakeElig = await fetchEligibleUnstake({
      staker: staker.address,
      oldSignerManager: signerManager,
      network,
    });
  }
  expect(unstakeElig.ok).toBe(true);
  const unstakeUnsigned = await buildUnstake({
    oldSignerManager: signerManager,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(signTransaction(unstakeUnsigned, staker.key), staker.address, network);

  useFixtures('stx-staking-unstaked');
  const unstaked = await fetchStakerInfo({ address: staker.address, network });
  // unstake rewrites num-cycles so the lock ends next cycle -> either fully
  // unlocked or its numCycles drops below the extended value.
  expect(!unstaked.staked || unstaked.details.numCycles < NUM_CYCLES + EXTEND).toBe(true);
});
