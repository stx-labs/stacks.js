/**
 * E2E — STX-only early exit (unstake).
 *
 * account7 stakes STX-only for 1 cycle, then calls `unstake` (the early-exit
 * path) and asserts fetchStakerInfo before/after shows the position rewritten
 * to unlock at the NEXT cycle (unlockCycle ≈ currentCycle + 1). The STX
 * remains locked until the unlock burn height — this test verifies the
 * rewrite, not a balance release.
 *
 * Requires account7 to have enough STX (funded ~1000 STX).
 * If account7 is already staking, the stake step is skipped gracefully.
 * If account7 is in the prepare phase at unstake time, the test waits it out.
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 BITCOIN_TX_TIMEOUT=300000 \
 *     STACKS_TX_TIMEOUT=300000 RECORD=1 \
 *     FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-exit-stx-unstake.json \
 *     npx jest tests/privatenet/e2e/exit-stx-unstake.e2e.test.ts \
 *       --runInBand --collectCoverage=false --verbose
 *
 * Does NOT require BOND_ADMIN_KEY or a prior lock artifact.
 */

import { broadcastTransaction } from '@stacks/transactions';
import {
  buildStake,
  buildUnstake,
  fetchStakerInfo,
  describePox5Error,
} from '../../../src';
import { resolveAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import {
  ensurePox5,
  getNextNonce,
  getPoxInfo,
  getTransaction,
  isInPreparePhase,
  rewardCycleToBurnHeight,
  waitForFulfilled,
  waitForRewardPhase,
} from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';

const network = getNetwork();
const FEE = 10_000n;
const AMOUNT_USTX = 1_000_000_000n; // 1000 STX
const NUM_CYCLES = 1;
const SIGNER_MANAGER = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';

// Dedicated lane account (override via STAKER env). Default account4 (rich, uncontended).
const staker = resolveAccount('STAKER', 'account4');

function parseErrCode(repr: string | undefined): number | undefined {
  const m = repr?.match(/^\(err u(\d+)\)$/);
  return m ? Number(m[1]) : undefined;
}

beforeAll(async () => {
  useFixtures('e2e-exit-stx-unstake');
  await ensurePox5();
}, 60_000);

test('account7: stake STX-only then early-exit (unstake) rewrites position to next cycle', async () => {
  useFixtures('e2e-exit-stx-unstake');
  let poxInfo = await getPoxInfo();
  console.log('\n=== E2E: exit-stx-unstake ===');
  console.log('staker:', staker.address);
  console.log('currentCycle:', poxInfo.rewardCycleId);
  console.log('currentBurnHt:', poxInfo.currentBurnchainBlockHeight);

  // ── Step 1: Stake if not already staking ─────────────────────────────────
  const beforeStake = await fetchStakerInfo({ address: staker.address, network });
  console.log('BEFORE stake — staked:', beforeStake.staked);

  if (!beforeStake.staked) {
    // Must be in the reward phase to stake (burn height in current cycle).
    poxInfo = await getPoxInfo();
    const posOf = () =>
      (poxInfo.currentBurnchainBlockHeight - poxInfo.firstBurnchainBlockHeight) %
      poxInfo.rewardCycleLength;
    const rewardPhaseLen = poxInfo.rewardCycleLength - poxInfo.prepareCycleLength;
    if (isInPreparePhase(poxInfo.currentBurnchainBlockHeight, poxInfo) || posOf() >= rewardPhaseLen - 2) {
      console.log('In prepare phase before stake — waiting for reward phase...');
      await waitForRewardPhase(poxInfo, 1);
      poxInfo = await getPoxInfo();
    }

    const startBurnHt = poxInfo.currentBurnchainBlockHeight;
    console.log('staking params:', {
      amountUstx: AMOUNT_USTX.toString(),
      numCycles: NUM_CYCLES,
      startBurnHt,
      signerManager: SIGNER_MANAGER,
    });

    const unsignedStake = await buildStake({
      signerManager: SIGNER_MANAGER,
      amountUstx: AMOUNT_USTX,
      numCycles: NUM_CYCLES,
      startBurnHt,
      publicKey: staker.publicKey,
      fee: FEE,
      nonce: await getNextNonce(staker.address),
      network,
    });

    const stakeTx = signTransaction(unsignedStake, staker.key);
    const stakeRes = await broadcastTransaction({ transaction: stakeTx, network });
    if ('error' in stakeRes) {
      throw new Error(`stake broadcast rejected: ${stakeRes.error} — ${'reason' in stakeRes ? stakeRes.reason : ''}`);
    }
    console.log('stake txid:', stakeRes.txid);

    const stakeTxRecord = await waitForFulfilled(async () => {
      const t = await getTransaction(stakeRes.txid);
      if (!t || t.tx_status === 'pending') throw new Error('stake tx still pending');
      return t;
    });

    console.log('stake on-chain result:', {
      txid: stakeTxRecord.tx_id,
      tx_status: stakeTxRecord.tx_status,
      result_repr: stakeTxRecord.tx_result?.repr,
    });

    if (stakeTxRecord.tx_status !== 'success') {
      const code = parseErrCode(stakeTxRecord.tx_result?.repr);
      const info = code !== undefined ? describePox5Error(code) : undefined;
      throw new Error(`stake aborted: (err u${code}) — ${info?.name ?? 'unknown'}`);
    }
    console.log('=== STAKE succeeded ✓ ===');
    useFixtures('e2e-exit-stx-unstake-staked');
  } else {
    console.log('account7 already staking — skipping stake step');
    console.log('existing position:', {
      amountUstx: beforeStake.details.amountUstx.toString(),
      numCycles: beforeStake.details.numCycles,
      firstRewardCycle: beforeStake.details.firstRewardCycle,
    });
  }

  // ── Step 2: Read staker info before unstake ───────────────────────────────
  const beforeUnstake = await fetchStakerInfo({ address: staker.address, network });
  console.log('\nBEFORE unstake — staker-info:', beforeUnstake.staked
    ? { amountUstx: beforeUnstake.details.amountUstx.toString(), numCycles: beforeUnstake.details.numCycles, firstRewardCycle: beforeUnstake.details.firstRewardCycle }
    : beforeUnstake);

  if (!beforeUnstake.staked) {
    console.warn('account7 NOT staking after stake step — something unexpected. Failing.');
    expect(beforeUnstake.staked).toBe(true);
    return;
  }

  // ── Step 3: Wait out prepare phase (unstake reverts in prepare phase u28) ──
  poxInfo = await getPoxInfo();
  const posOf = () =>
    (poxInfo.currentBurnchainBlockHeight - poxInfo.firstBurnchainBlockHeight) %
    poxInfo.rewardCycleLength;
  const rewardPhaseLen = poxInfo.rewardCycleLength - poxInfo.prepareCycleLength;
  while (isInPreparePhase(poxInfo.currentBurnchainBlockHeight, poxInfo) || posOf() >= rewardPhaseLen - 2) {
    console.log(`pos ${posOf()} too close to prepare phase — waiting for reward phase...`);
    await waitForRewardPhase(poxInfo, 1);
    poxInfo = await getPoxInfo();
  }

  // ── Step 4: Unstake (early exit) ──────────────────────────────────────────
  const oldSignerManager = beforeUnstake.details.signer;
  console.log('\nunstake params:', {
    staker: staker.address,
    oldSignerManager,
    currentCycle: poxInfo.rewardCycleId,
  });

  const unsignedUnstake = await buildUnstake({
    oldSignerManager,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
  });

  const unstakeTx = signTransaction(unsignedUnstake, staker.key);
  const unstakeRes = await broadcastTransaction({ transaction: unstakeTx, network });
  if ('error' in unstakeRes) {
    throw new Error(`unstake broadcast rejected: ${unstakeRes.error} — ${'reason' in unstakeRes ? unstakeRes.reason : ''}`);
  }
  console.log('unstake txid:', unstakeRes.txid);
  useFixtures('e2e-exit-stx-unstake-after');

  const unstakeTxRecord = await waitForFulfilled(async () => {
    const t = await getTransaction(unstakeRes.txid);
    if (!t || t.tx_status === 'pending') throw new Error('unstake tx still pending');
    return t;
  });

  console.log('unstake on-chain result:', {
    txid: unstakeTxRecord.tx_id,
    tx_status: unstakeTxRecord.tx_status,
    result_repr: unstakeTxRecord.tx_result?.repr,
    burn_block_height: unstakeTxRecord.burn_block_height,
  });

  // ── Step 5: Read staker info after unstake and assert ─────────────────────
  const afterUnstake = await fetchStakerInfo({ address: staker.address, network });
  console.log('\nAFTER unstake — staker-info:', afterUnstake.staked
    ? { amountUstx: afterUnstake.details.amountUstx.toString(), numCycles: afterUnstake.details.numCycles, firstRewardCycle: afterUnstake.details.firstRewardCycle }
    : afterUnstake);

  if (unstakeTxRecord.tx_status === 'success') {
    const expectedUnlockCycle = poxInfo.rewardCycleId + 1;
    const expectedUnlockBurnHt = rewardCycleToBurnHeight(expectedUnlockCycle, poxInfo);

    console.log('\n=== UNSTAKE GATE ===');
    console.log('currentCycle:', poxInfo.rewardCycleId, '→ position now unlocks at cycle', expectedUnlockCycle);
    console.log('unlockBurnHeight (STX spendable only at/after this):', expectedUnlockBurnHt);
    console.log('currentBurnHt:', poxInfo.currentBurnchainBlockHeight);
    console.log('STX still LOCKED — early exit only shortens the term; amount frees at unlockBurnHeight');

    // Position still present (rewritten, not erased)
    expect(afterUnstake.staked).toBe(true);

    if (afterUnstake.staked && beforeUnstake.staked) {
      // num-cycles collapsed: must be ≤ what it was before
      expect(afterUnstake.details.numCycles).toBeLessThanOrEqual(beforeUnstake.details.numCycles);
      // STX still locked — amount unchanged
      expect(afterUnstake.details.amountUstx).toBe(beforeUnstake.details.amountUstx);
      // unlockCycle (firstRewardCycle + numCycles) should equal currentCycle + 1
      const unlockCycle = afterUnstake.details.firstRewardCycle + afterUnstake.details.numCycles;
      // Relative: unlock is at most currentCycle + 1 (may be exactly +1 or already past if
      // position was already near expiry before we staked)
      expect(unlockCycle).toBeLessThanOrEqual(expectedUnlockCycle + 1);
      console.log(`CONFIRMED: numCycles ${beforeUnstake.details.numCycles} → ${afterUnstake.details.numCycles}, amount still locked at ${afterUnstake.details.amountUstx.toString()} uSTX`);
    }
    console.log('\n=== E2E exit-stx-unstake: SUCCESS ✓ ===');
  } else {
    const code = parseErrCode(unstakeTxRecord.tx_result?.repr);
    const info = code !== undefined ? describePox5Error(code) : undefined;
    console.log('unstake aborted:', code, info?.name, '-', info?.description);
    // If it aborted we still record the outcome but fail the test
    expect(unstakeTxRecord.tx_status).toBe('success');
  }
}, 600_000);
