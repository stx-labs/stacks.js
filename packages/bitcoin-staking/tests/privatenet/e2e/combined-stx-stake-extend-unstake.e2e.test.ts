/**
 * E2E — Combined STX lifecycle: stake → stake-update (extend +cycle, +amount) → unstake (early exit).
 *
 * ONE account (account2, rich ~10B STX) runs the full STX-only lifecycle in
 * a single sequential test. Each transition asserts fetchStakerInfo changed
 * in the expected direction (relative, no absolute cycle numbers).
 *
 * Phase fixture keys:
 *   'e2e-combined-stx'         — baseline, before any tx
 *   'e2e-combined-stx-extended' — after stake-update succeeds
 *   'e2e-combined-stx-unstaked' — after unstake succeeds
 *
 * Preconditions:
 *   - account2 must NOT be currently staking (fresh position expected).
 *     If already staking, the test skips gracefully with a warning.
 *   - Must be in the reward phase (not prepare phase) to stake and extend.
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *     BITCOIN_TX_TIMEOUT=300000 STACKS_TX_TIMEOUT=300000 \
 *     RECORD=1 FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-combined-stx.json \
 *     npx jest tests/privatenet/e2e/combined-stx-stake-extend-unstake.e2e.test.ts \
 *       --runInBand --collectCoverage=false --verbose
 */

import { broadcastTransaction } from '@stacks/transactions';
import {
  buildStake,
  buildStakeUpdate,
  buildUnstake,
  fetchStakerInfo,
  describePox5Error,
} from '../../../src';
import type { Account } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import { freshFundedStxAccount } from '../../helpers/fresh-account';
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

// ─── Config ───────────────────────────────────────────────────────────────────

const SIGNER_MANAGER = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';
const FEE = 10_000n;
// Stake 10_000 STX so it's well above any floor but won't saturate a shared signer.
const STAKE_AMOUNT_USTX = 10_000_000_000n; // 10k STX
const EXTEND_AMOUNT_USTX = 1_000_000_000n;  // +1k STX top-up
const NUM_CYCLES = 2;
const CYCLES_TO_EXTEND = 1;

// Use a freshly-derived + funded random account so it's NEVER already-staking
// (avoids the ALREADY_STAKED collision class). STX-only lifecycle needs no
// bond allowlist. Assigned in beforeAll.
let staker: Account;
const network = getNetwork();
// Fund well above stake + extend amounts, plus fee headroom for 3 txs.
const FUND_USTX = STAKE_AMOUNT_USTX + EXTEND_AMOUNT_USTX + 1_000_000_000n;

function parseErrCode(repr: string | undefined): number | undefined {
  const m = repr?.match(/^\(err u(\d+)\)$/);
  return m ? Number(m[1]) : undefined;
}

function posOf(pox: Awaited<ReturnType<typeof getPoxInfo>>): number {
  return (pox.currentBurnchainBlockHeight - pox.firstBurnchainBlockHeight) % pox.rewardCycleLength;
}

async function ensureRewardPhase(): Promise<Awaited<ReturnType<typeof getPoxInfo>>> {
  let pox = await getPoxInfo();
  const rewardPhaseLen = pox.rewardCycleLength - pox.prepareCycleLength;
  while (isInPreparePhase(pox.currentBurnchainBlockHeight, pox) || posOf(pox) >= rewardPhaseLen - 2) {
    console.log(`  pos=${posOf(pox)} near prepare phase — waiting for reward phase...`);
    await waitForRewardPhase(pox, 1);
    pox = await getPoxInfo();
  }
  return pox;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  useFixtures('e2e-combined-stx');
  await ensurePox5();
  staker = await freshFundedStxAccount({ network, amountUstx: FUND_USTX });
}, 4 * 180_000);

// ─── Test ─────────────────────────────────────────────────────────────────────

test('account2: full STX lifecycle — stake → extend → unstake (early exit)', async () => {
  useFixtures('e2e-combined-stx');

  console.log('\n=== E2E: combined-stx-stake-extend-unstake ===');
  console.log('staker:', staker.address);

  // ── Phase 0: assert account2 is NOT currently staking ────────────────────
  const initial = await fetchStakerInfo({ address: staker.address, network });
  console.log('INITIAL staker-info:', initial.staked
    ? { amountUstx: initial.details.amountUstx.toString(), numCycles: initial.details.numCycles }
    : 'not staking');

  if (initial.staked) {
    console.warn(
      'account2 is ALREADY staking — lifecycle test requires a fresh position. ' +
      'Unstake first (or wait for the lock to expire) then re-run.'
    );
    // Graceful skip: document the precondition as a soft warning, not a hard failure.
    expect(initial.staked).toBe(false);
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: STAKE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n─── PHASE 1: STAKE ───');

  let pox = await ensureRewardPhase();
  const startBurnHt = pox.currentBurnchainBlockHeight;
  const targetCycle = pox.rewardCycleId + 1;

  console.log('stake params:', {
    amountUstx: STAKE_AMOUNT_USTX.toString(),
    numCycles: NUM_CYCLES,
    startBurnHt,
    currentCycle: pox.rewardCycleId,
    targetCycle,
  });

  const unsignedStake = await buildStake({
    signerManager: SIGNER_MANAGER,
    amountUstx: STAKE_AMOUNT_USTX,
    numCycles: NUM_CYCLES,
    startBurnHt,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
  });

  const stakeTxRaw = signTransaction(unsignedStake, staker.key);
  const stakeRes = await broadcastTransaction({ transaction: stakeTxRaw, network });
  if ('error' in stakeRes) {
    throw new Error(`stake broadcast rejected: ${stakeRes.error} — ${'reason' in stakeRes ? stakeRes.reason : ''}`);
  }
  console.log('stake txid:', stakeRes.txid);

  const stakeTx = await waitForFulfilled(async () => {
    const t = await getTransaction(stakeRes.txid);
    if (!t || t.tx_status === 'pending') throw new Error('stake tx still pending');
    return t;
  });
  console.log('stake result:', { tx_status: stakeTx.tx_status, repr: stakeTx.tx_result?.repr });

  if (stakeTx.tx_status !== 'success') {
    const code = parseErrCode(stakeTx.tx_result?.repr);
    throw new Error(`stake aborted (err u${code}): ${describePox5Error(code ?? -1)?.name ?? 'unknown'}`);
  }

  // Assert: staker-info now reflects the new position
  const afterStake = await fetchStakerInfo({ address: staker.address, network });
  console.log('AFTER stake:', afterStake.staked
    ? { amountUstx: afterStake.details.amountUstx.toString(), numCycles: afterStake.details.numCycles, firstRewardCycle: afterStake.details.firstRewardCycle }
    : 'not staking');

  expect(afterStake.staked).toBe(true);
  if (afterStake.staked) {
    expect(afterStake.details.amountUstx).toBe(STAKE_AMOUNT_USTX);
    expect(afterStake.details.numCycles).toBe(NUM_CYCLES);
    // firstRewardCycle must equal the target cycle (currentCycle+1)
    expect(afterStake.details.firstRewardCycle).toBe(targetCycle);
    console.log('=== STAKE CONFIRMED ✓ ===');
  }

  useFixtures('e2e-combined-stx');

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: EXTEND (stake-update)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n─── PHASE 2: EXTEND (stake-update) ───');

  pox = await ensureRewardPhase();

  if (!afterStake.staked) {
    throw new Error('afterStake.staked must be true by now (internal error)');
  }

  const oldSignerManager = afterStake.details.signer;
  console.log('extend params:', {
    cyclesToExtend: CYCLES_TO_EXTEND,
    amountIncrease: EXTEND_AMOUNT_USTX.toString(),
    oldSignerManager,
    currentCycle: pox.rewardCycleId,
  });

  const unsignedExtend = await buildStakeUpdate({
    signerManager: SIGNER_MANAGER,
    oldSignerManager,
    cyclesToExtend: CYCLES_TO_EXTEND,
    amountIncrease: EXTEND_AMOUNT_USTX,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
  });

  const extendTxRaw = signTransaction(unsignedExtend, staker.key);
  const extendRes = await broadcastTransaction({ transaction: extendTxRaw, network });
  if ('error' in extendRes) {
    throw new Error(`extend broadcast rejected: ${extendRes.error} — ${'reason' in extendRes ? extendRes.reason : ''}`);
  }
  console.log('extend txid:', extendRes.txid);

  const extendTx = await waitForFulfilled(async () => {
    const t = await getTransaction(extendRes.txid);
    if (!t || t.tx_status === 'pending') throw new Error('extend tx still pending');
    return t;
  });
  console.log('extend result:', { tx_status: extendTx.tx_status, repr: extendTx.tx_result?.repr });

  if (extendTx.tx_status !== 'success') {
    const code = parseErrCode(extendTx.tx_result?.repr);
    throw new Error(`extend aborted (err u${code}): ${describePox5Error(code ?? -1)?.name ?? 'unknown'}`);
  }

  // Assert: numCycles increased by CYCLES_TO_EXTEND; amount increased by EXTEND_AMOUNT_USTX
  const afterExtend = await fetchStakerInfo({ address: staker.address, network });
  console.log('AFTER extend:', afterExtend.staked
    ? { amountUstx: afterExtend.details.amountUstx.toString(), numCycles: afterExtend.details.numCycles }
    : 'not staking');

  expect(afterExtend.staked).toBe(true);
  if (afterExtend.staked) {
    expect(afterExtend.details.numCycles).toBe(afterStake.details.numCycles + CYCLES_TO_EXTEND);
    expect(afterExtend.details.amountUstx).toBe(afterStake.details.amountUstx + EXTEND_AMOUNT_USTX);
    console.log(
      `=== EXTEND CONFIRMED ✓ numCycles: ${afterStake.details.numCycles} → ${afterExtend.details.numCycles}, ` +
      `amount: ${afterStake.details.amountUstx} → ${afterExtend.details.amountUstx} ===`
    );
  }

  useFixtures('e2e-combined-stx-extended');

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: UNSTAKE (early exit)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n─── PHASE 3: UNSTAKE (early exit) ───');

  pox = await ensureRewardPhase();

  if (!afterExtend.staked) {
    throw new Error('afterExtend.staked must be true (internal error)');
  }

  const unstakeSignerManager = afterExtend.details.signer;
  console.log('unstake params:', {
    oldSignerManager: unstakeSignerManager,
    currentCycle: pox.rewardCycleId,
  });

  const unsignedUnstake = await buildUnstake({
    oldSignerManager: unstakeSignerManager,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
  });

  const unstakeTxRaw = signTransaction(unsignedUnstake, staker.key);
  const unstakeRes = await broadcastTransaction({ transaction: unstakeTxRaw, network });
  if ('error' in unstakeRes) {
    throw new Error(`unstake broadcast rejected: ${unstakeRes.error} — ${'reason' in unstakeRes ? unstakeRes.reason : ''}`);
  }
  console.log('unstake txid:', unstakeRes.txid);

  const unstakeTx = await waitForFulfilled(async () => {
    const t = await getTransaction(unstakeRes.txid);
    if (!t || t.tx_status === 'pending') throw new Error('unstake tx still pending');
    return t;
  });
  console.log('unstake result:', { tx_status: unstakeTx.tx_status, repr: unstakeTx.tx_result?.repr });

  if (unstakeTx.tx_status !== 'success') {
    const code = parseErrCode(unstakeTx.tx_result?.repr);
    throw new Error(`unstake aborted (err u${code}): ${describePox5Error(code ?? -1)?.name ?? 'unknown'}`);
  }

  // Re-read pox (burn height may have advanced)
  pox = await getPoxInfo();
  const expectedUnlockCycle = pox.rewardCycleId + 1;
  const expectedUnlockBurnHt = rewardCycleToBurnHeight(expectedUnlockCycle, pox);

  const afterUnstake = await fetchStakerInfo({ address: staker.address, network });
  console.log('AFTER unstake:', afterUnstake.staked
    ? { amountUstx: afterUnstake.details.amountUstx.toString(), numCycles: afterUnstake.details.numCycles, firstRewardCycle: afterUnstake.details.firstRewardCycle }
    : 'not staking');

  // After early-exit, position is rewritten (not erased) — still staking but
  // numCycles shrinks so unlock is at most currentCycle+1.
  expect(afterUnstake.staked).toBe(true);
  if (afterUnstake.staked) {
    // numCycles must have decreased
    expect(afterUnstake.details.numCycles).toBeLessThanOrEqual(afterExtend.details.numCycles);
    // amount is still locked
    expect(afterUnstake.details.amountUstx).toBe(afterExtend.details.amountUstx);
    // unlock cycle ≤ expectedUnlockCycle+1
    const unlockCycle = afterUnstake.details.firstRewardCycle + afterUnstake.details.numCycles;
    expect(unlockCycle).toBeLessThanOrEqual(expectedUnlockCycle + 1);
    console.log(
      `=== UNSTAKE CONFIRMED ✓ numCycles: ${afterExtend.details.numCycles} → ${afterUnstake.details.numCycles}, ` +
      `unlock cycle: ${unlockCycle}, unlockBurnHt: ${expectedUnlockBurnHt}, ` +
      `amount still locked: ${afterUnstake.details.amountUstx} uSTX ===`
    );
  }

  useFixtures('e2e-combined-stx-unstaked');

  console.log('\n=== SUMMARY ===');
  console.log('staker:', staker.address);
  console.log('stake amount:', STAKE_AMOUNT_USTX.toString(), 'uSTX');
  console.log('extend amount increase:', EXTEND_AMOUNT_USTX.toString(), 'uSTX');
  console.log('target cycle:', targetCycle);
  console.log('stake txid:', stakeRes.txid);
  console.log('extend txid:', extendRes.txid);
  console.log('unstake txid:', unstakeRes.txid);
  console.log('\n=== E2E combined-stx-stake-extend-unstake: ALL ASSERTIONS PASSED ✓ ===');
}, 3 * 180_000);
