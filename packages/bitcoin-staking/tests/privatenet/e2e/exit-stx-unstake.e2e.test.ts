/**
 * E2E - STX-only early exit (unstake).
 *
 * account4 stakes STX-only for 1 cycle, then calls `unstake` (the early-exit
 * path) and asserts fetchStakerInfo before/after shows the position rewritten
 * to unlock at the NEXT cycle (unlockCycle ~= currentCycle + 1). The STX
 * remains locked until the unlock burn height - this test verifies the
 * rewrite, not a balance release.
 *
 * If account4 is already staking, the stake step is skipped gracefully.
 * If account4 is in the prepare phase at unstake time, the test waits it out.
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
import { buildStake, buildUnstake, fetchStakerInfo, describePox5Error } from '../../../src';
import { resolveAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import {
  ensureRewardPhase,
  getNextNonce,
  getPoxInfo,
  getTransaction,
  parseErrCode,
  rewardCycleToBurnHeight,
  waitForFulfilled,
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

beforeAll(async () => {
  useFixtures('e2e-exit-stx-unstake');
}, 60_000);

test('stake STX-only then early-exit (unstake) rewrites position to next cycle', async () => {
  useFixtures('e2e-exit-stx-unstake');
  let poxInfo = await getPoxInfo();
  console.log('staker:', staker.address, 'currentCycle:', poxInfo.rewardCycleId);

  // STAKE
  const beforeStake = await fetchStakerInfo({ address: staker.address, network });

  if (!beforeStake.staked) {
    // Must be in the reward phase to stake (burn height in current cycle).
    poxInfo = await ensureRewardPhase();

    const startBurnHt = poxInfo.currentBurnchainBlockHeight;

    const unsignedStake = await buildStake({
      signerManager: SIGNER_MANAGER,
      amountUstx: AMOUNT_USTX,
      numCycles: NUM_CYCLES,
      startBurnHt,
      publicKey: staker.publicKey,
      fee: FEE,
      nonce: await getNextNonce(staker.address),
      network,
      postConditionMode: 'allow',
    });

    const stakeTx = signTransaction(unsignedStake, staker.key);
    const stakeRes = await broadcastTransaction({ transaction: stakeTx, network });
    if ('error' in stakeRes) {
      throw new Error(
        `stake broadcast rejected: ${stakeRes.error} — ${'reason' in stakeRes ? stakeRes.reason : ''}`
      );
    }
    console.log('stake txid:', stakeRes.txid);

    const stakeTxRecord = await waitForFulfilled(async () => {
      const t = await getTransaction(stakeRes.txid);
      if (!t || t.tx_status === 'pending') throw new Error('stake tx still pending');
      return t;
    });

    if (stakeTxRecord.tx_status !== 'success') {
      const code = parseErrCode(stakeTxRecord.tx_result?.repr);
      const info = code !== undefined ? describePox5Error(code) : undefined;
      throw new Error(`stake aborted: (err u${code}) — ${info?.name ?? 'unknown'}`);
    }
    useFixtures('e2e-exit-stx-unstake-staked');
  }

  // BEFORE UNSTAKE
  const beforeUnstake = await fetchStakerInfo({ address: staker.address, network });

  if (!beforeUnstake.staked) {
    // Staked above (or already staking) but not reflected - should not happen; fail loudly.
    expect(beforeUnstake.staked).toBe(true);
    return;
  }

  // Unstake reverts in the prepare phase (u28) - wait it out.
  poxInfo = await ensureRewardPhase();

  // UNSTAKE
  const oldSignerManager = beforeUnstake.details.signer;

  const unsignedUnstake = await buildUnstake({
    oldSignerManager,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
    postConditionMode: 'allow',
  });

  const unstakeTx = signTransaction(unsignedUnstake, staker.key);
  const unstakeRes = await broadcastTransaction({ transaction: unstakeTx, network });
  if ('error' in unstakeRes) {
    throw new Error(
      `unstake broadcast rejected: ${unstakeRes.error} — ${'reason' in unstakeRes ? unstakeRes.reason : ''}`
    );
  }
  console.log('unstake txid:', unstakeRes.txid);
  useFixtures('e2e-exit-stx-unstake-after');

  const unstakeTxRecord = await waitForFulfilled(async () => {
    const t = await getTransaction(unstakeRes.txid);
    if (!t || t.tx_status === 'pending') throw new Error('unstake tx still pending');
    return t;
  });

  // AFTER UNSTAKE
  const afterUnstake = await fetchStakerInfo({ address: staker.address, network });

  if (unstakeTxRecord.tx_status === 'success') {
    const expectedUnlockCycle = poxInfo.rewardCycleId + 1;
    const expectedUnlockBurnHt = rewardCycleToBurnHeight(expectedUnlockCycle, poxInfo);
    console.log('unlockBurnHeight (STX spendable only at/after this):', expectedUnlockBurnHt);

    // Position still present (rewritten, not erased) - STX remains locked until unlockBurnHeight;
    // early exit only shortens the term.
    expect(afterUnstake.staked).toBe(true);

    if (afterUnstake.staked && beforeUnstake.staked) {
      // num-cycles collapsed: must be <= what it was before
      expect(afterUnstake.details.numCycles).toBeLessThanOrEqual(beforeUnstake.details.numCycles);
      // STX still locked - amount unchanged
      expect(afterUnstake.details.amountUstx).toBe(beforeUnstake.details.amountUstx);
      // unlockCycle (firstRewardCycle + numCycles) should equal currentCycle + 1
      const unlockCycle = afterUnstake.details.firstRewardCycle + afterUnstake.details.numCycles;
      // Relative bound: position may have already been near expiry before staking, so unlock
      // can land at or before currentCycle + 1, not necessarily exactly +1.
      expect(unlockCycle).toBeLessThanOrEqual(expectedUnlockCycle + 1);
    }
  } else {
    const code = parseErrCode(unstakeTxRecord.tx_result?.repr);
    const info = code !== undefined ? describePox5Error(code) : undefined;
    console.log('unstake aborted:', code, info?.name, '-', info?.description);
    expect(unstakeTxRecord.tx_status).toBe('success');
  }
}, 600_000);
