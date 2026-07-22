/**
 * E2E — Combined STX lifecycle: stake -> stake-update (extend +cycle, +amount) -> unstake (early exit).
 *
 * ONE fresh account runs the full STX-only lifecycle sequentially. Each
 * transition asserts fetchStakerInfo changed in the expected direction
 * (relative, no absolute cycle numbers). Must be in reward phase (not
 * prepare) to stake/extend, else the tx aborts.
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *     BITCOIN_TX_TIMEOUT=300000 STACKS_TX_TIMEOUT=300000 \
 *     RECORD=1 FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-combined-stx.json \
 *     npx jest tests/privatenet/e2e/combined-stx-stake-extend-unstake.e2e.test.ts \
 *       --runInBand --collectCoverage=false --verbose
 */

import {
  buildStake,
  buildStakeUpdate,
  buildUnstake,
  fetchStakerInfo,
  describePox5Error,
} from '../../../src';
import { SIGNER_MANAGER } from '../constants';
import type { Account } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import { freshFundedStxAccount } from '../../helpers/fresh-account';
import {
  broadcastAndWaitForTransaction,
  ensureRewardPhase,
  getNextNonce,
  getPoxInfo,
  parseErrCode,
  rewardCycleToBurnHeight,
} from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';

const FEE = 10_000n;
// Stake 10_000 STX so it's well above any floor but won't saturate a shared signer.
const STAKE_AMOUNT_USTX = 10_000_000_000n; // 10k STX
const EXTEND_AMOUNT_USTX = 1_000_000_000n; // +1k STX top-up
const NUM_CYCLES = 2;
const CYCLES_TO_EXTEND = 1;

// Use a freshly-derived + funded random account so it's NEVER already-staking
// (avoids the ALREADY_STAKED collision class). STX-only lifecycle needs no
// bond allowlist. Assigned in beforeAll.
let staker: Account;
const network = getNetwork();
// Fund well above stake + extend amounts, plus fee headroom for 3 txs.
const FUND_USTX = STAKE_AMOUNT_USTX + EXTEND_AMOUNT_USTX + 1_000_000_000n;

beforeAll(async () => {
  useFixtures('e2e-combined-stx-fund'); // isolate the funding broadcast from the stake broadcast
  staker = await freshFundedStxAccount({ network, amountUstx: FUND_USTX, label: 'combined' });
}, 4 * 180_000);

test(
  'fresh staker: full STX lifecycle — stake -> extend -> unstake (early exit)',
  async () => {
    useFixtures('e2e-combined-stx');

    console.log('staker:', staker.address);

    const initial = await fetchStakerInfo({ address: staker.address, network });

    if (initial.staked) {
      // Graceful skip: freshFundedStxAccount guarantees a new position, but
      // if state already shows staked, don't fail hard — document and bail.
      console.warn('staker is ALREADY staking — lifecycle test requires a fresh position.');
      expect(initial.staked).toBe(false);
      return;
    }

    // STAKE
    let pox = await ensureRewardPhase();
    const startBurnHt = pox.currentBurnchainBlockHeight;
    const targetCycle = pox.rewardCycleId + 1;

    const unsignedStake = await buildStake({
      signerManager: SIGNER_MANAGER,
      amountUstx: STAKE_AMOUNT_USTX,
      numCycles: NUM_CYCLES,
      startBurnHt,
      publicKey: staker.publicKey,
      fee: FEE,
      nonce: await getNextNonce(staker.address),
      network,
      postConditionMode: 'allow',
    });

    const stakeTxRaw = signTransaction(unsignedStake, staker.key);
    const stakeTx = await broadcastAndWaitForTransaction(stakeTxRaw, network);
    console.log('stake result:', { tx_status: stakeTx.tx_status, repr: stakeTx.tx_result?.repr });

    if (stakeTx.tx_status !== 'success') {
      const code = parseErrCode(stakeTx.tx_result?.repr);
      throw new Error(
        `stake aborted (err u${code}): ${describePox5Error(code ?? -1)?.name ?? 'unknown'}`
      );
    }

    // Phase switch: same get-staker-info path returns a different body after the
    // stake; route the after-read to its own fixture key.
    useFixtures('e2e-combined-stx-staked');

    const afterStake = await fetchStakerInfo({ address: staker.address, network });

    expect(afterStake.staked).toBe(true);
    if (afterStake.staked) {
      expect(afterStake.details.amountUstx).toBe(STAKE_AMOUNT_USTX);
      expect(afterStake.details.numCycles).toBe(NUM_CYCLES);
      // firstRewardCycle is pinned at broadcast time from start-burn-ht, but the
      // reward-phase wait + confirmation can straddle a cycle boundary either way
      // relative to the pre-broadcast pox read used to compute targetCycle — tolerate
      // a one-cycle window rather than pin an exact value that drifts with chain timing.
      expect(afterStake.details.firstRewardCycle).toBeGreaterThanOrEqual(targetCycle - 1);
      expect(afterStake.details.firstRewardCycle).toBeLessThanOrEqual(targetCycle + 1);
    }

    useFixtures('e2e-combined-stx-extend');

    // EXTEND (stake-update)
    pox = await ensureRewardPhase();

    if (!afterStake.staked) {
      throw new Error('afterStake.staked must be true by now (internal error)');
    }

    const oldSignerManager = afterStake.details.signer;

    const unsignedExtend = await buildStakeUpdate({
      signerManager: SIGNER_MANAGER,
      oldSignerManager,
      cyclesToExtend: CYCLES_TO_EXTEND,
      amountIncrease: EXTEND_AMOUNT_USTX,
      publicKey: staker.publicKey,
      fee: FEE,
      nonce: await getNextNonce(staker.address),
      network,
      postConditionMode: 'allow',
    });

    const extendTxRaw = signTransaction(unsignedExtend, staker.key);
    const extendTx = await broadcastAndWaitForTransaction(extendTxRaw, network);

    if (extendTx.tx_status !== 'success') {
      const code = parseErrCode(extendTx.tx_result?.repr);
      throw new Error(
        `extend aborted (err u${code}): ${describePox5Error(code ?? -1)?.name ?? 'unknown'}`
      );
    }

    // Phase switch: same get-staker-info path returns a different body after the
    // extend; route the after-read to its own fixture key.
    useFixtures('e2e-combined-stx-extended');

    const afterExtend = await fetchStakerInfo({ address: staker.address, network });

    expect(afterExtend.staked).toBe(true);
    if (afterExtend.staked) {
      expect(afterExtend.details.numCycles).toBe(afterStake.details.numCycles + CYCLES_TO_EXTEND);
      expect(afterExtend.details.amountUstx).toBe(
        afterStake.details.amountUstx + EXTEND_AMOUNT_USTX
      );
    }

    useFixtures('e2e-combined-stx-extended');

    // UNSTAKE (early exit)
    pox = await ensureRewardPhase();

    if (!afterExtend.staked) {
      throw new Error('afterExtend.staked must be true (internal error)');
    }

    const unstakeSignerManager = afterExtend.details.signer;

    const unsignedUnstake = await buildUnstake({
      oldSignerManager: unstakeSignerManager,
      publicKey: staker.publicKey,
      fee: FEE,
      nonce: await getNextNonce(staker.address),
      network,
      postConditionMode: 'allow',
    });

    const unstakeTxRaw = signTransaction(unsignedUnstake, staker.key);
    const unstakeTx = await broadcastAndWaitForTransaction(unstakeTxRaw, network);

    if (unstakeTx.tx_status !== 'success') {
      const code = parseErrCode(unstakeTx.tx_result?.repr);
      throw new Error(
        `unstake aborted (err u${code}): ${describePox5Error(code ?? -1)?.name ?? 'unknown'}`
      );
    }

    // Re-read pox (burn height may have advanced)
    pox = await getPoxInfo();
    const expectedUnlockCycle = pox.rewardCycleId + 1;
    const expectedUnlockBurnHt = rewardCycleToBurnHeight(expectedUnlockCycle, pox);

    // Phase switch: same get-staker-info path returns a different body after the
    // unstake; route the after-read to its own fixture key.
    useFixtures('e2e-combined-stx-unstaked');
    const afterUnstake = await fetchStakerInfo({ address: staker.address, network });

    // After early-exit, position is rewritten (not erased) — still staking but
    // numCycles shrinks so unlock is at most currentCycle+1.
    expect(afterUnstake.staked).toBe(true);
    if (afterUnstake.staked) {
      expect(afterUnstake.details.numCycles).toBeLessThanOrEqual(afterExtend.details.numCycles);
      expect(afterUnstake.details.amountUstx).toBe(afterExtend.details.amountUstx);
      const unlockCycle = afterUnstake.details.firstRewardCycle + afterUnstake.details.numCycles;
      expect(unlockCycle).toBeLessThanOrEqual(expectedUnlockCycle + 1);
      console.log('unlock cycle:', unlockCycle, 'unlockBurnHt:', expectedUnlockBurnHt);
    }

    useFixtures('e2e-combined-stx-unstaked');
  },
  3 * 180_000
);
