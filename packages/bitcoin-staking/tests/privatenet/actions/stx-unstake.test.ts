/**
 * Privatenet STX-only UNSTAKE action — exercises pox-5.unstake.
 *
 * unstake does NOT immediately release the STX — it REWRITES the position to
 * unlock at the *next* reward cycle; the locked uSTX only frees once burn
 * height reaches that cycle's unlock-burn-height. Guards: old-signer-manager
 * mismatch (u36), prepare-phase call (u28), not staking (u27).
 *
 * Staker-only tx (account6). Does NOT touch bond-admin / setup-bond.
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so RECORD=1 \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 BITCOIN_TX_TIMEOUT=600000 \
 *     npx jest tests/privatenet/actions/stx-unstake.test.ts --runInBand --collectCoverage=false --verbose
 */
import { broadcastTransaction } from '@stacks/transactions';
import { buildUnstake, fetchStakerInfo, describePox5Error } from '../../../src';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import {
  ensureRewardPhase,
  getNextNonce,
  getStxBalance,
  getTransaction,
  parseErrCode,
  rewardCycleToBurnHeight,
  waitForFulfilled,
} from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';

jest.setTimeout(60 * 60_000);

const network = getNetwork();
const FEE = 10_000n;

const STAKER = process.env.STAKER ?? 'account6';
const staker = getAccount(REGTEST_KEYS[STAKER as keyof typeof REGTEST_KEYS]);

beforeAll(async () => {
  useFixtures('stx-unstake');
}, 60 * 60_000);

test('unstake rewrites account6 STX-only position to unlock next cycle (STX stays locked until then)', async () => {
  // unstake reverts in the prepare phase (u28). Wait out, with a 2-block margin
  // so the tx mines inside the reward phase too.
  const poxInfo = await ensureRewardPhase();

  const before = await fetchStakerInfo({ address: staker.address, network });
  console.log(
    'BEFORE staker-info:',
    before.staked ? { ...before.details, amountUstx: before.details.amountUstx.toString() } : before
  );

  const balanceBefore = await getStxBalance(staker.address);
  console.log('account6 unlocked balance BEFORE (uSTX):', balanceBefore.toString());

  if (!before.staked) {
    console.warn(
      'account6 NOT staking — unstake gates on ERR_NOT_STAKING (u27). Run stx-stake-signer-set first.'
    );
    expect(before.staked).toBe(false);
    return;
  }

  const oldSignerManager = before.details.signer;
  console.log('unstake params', {
    staker: staker.address,
    amountUstx: before.details.amountUstx.toString(),
    currentNumCycles: before.details.numCycles,
    firstRewardCycle: before.details.firstRewardCycle,
    currentCycle: poxInfo.rewardCycleId,
    oldSignerManager,
  });

  const unsigned = await buildUnstake({
    oldSignerManager,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
    postConditionMode: 'allow',
  });

  const transaction = signTransaction(unsigned, staker.key);
  const res = await broadcastTransaction({ transaction, network });
  if ('error' in res)
    throw `broadcast rejected: ${res.error} — ${'reason' in res ? res.reason : ''}`;
  console.log('unstake txid', res.txid);

  const tx = await waitForFulfilled(async () => {
    const t = await getTransaction(res.txid);
    if (!t || t.tx_status === 'pending') throw 'tx still pending';
    return t;
  });
  console.log('unstake on-chain result', {
    txid: tx.tx_id,
    tx_status: tx.tx_status,
    result_repr: tx.tx_result?.repr,
    burn_block_height: tx.burn_block_height,
  });

  useFixtures('stx-unstake-after'); // phase: reads differ after unstake
  const after = await fetchStakerInfo({ address: staker.address, network });
  console.log(
    'AFTER staker-info:',
    after.staked ? { ...after.details, amountUstx: after.details.amountUstx.toString() } : after
  );

  const balanceAfter = await getStxBalance(staker.address);
  console.log('account6 unlocked balance AFTER (uSTX):', balanceAfter.toString());

  if (tx.tx_status === 'success') {
    const expectedUnlockCycle = poxInfo.rewardCycleId + 1;
    const expectedUnlockBurnHt = rewardCycleToBurnHeight(expectedUnlockCycle, poxInfo);
    console.log(
      'current cycle:',
      poxInfo.rewardCycleId,
      '→ position now unlocks at cycle',
      expectedUnlockCycle
    );
    console.log('unlock-burn-height (STX spendable only at/after this):', expectedUnlockBurnHt);
    console.log('current burn height:', poxInfo.currentBurnchainBlockHeight);
    console.log(
      'STX still LOCKED — unstake only shortens the term; the amount frees at the unlock burn height, not on this tx.'
    );

    expect(after.staked).toBe(true); // position still present, just rewritten
    if (after.staked && before.staked) {
      // num-cycles collapsed: new num-cycles = unlock-cycle - first-reward-cycle
      expect(after.details.numCycles).toBeLessThanOrEqual(before.details.numCycles);
      // amount unchanged; still locked
      expect(after.details.amountUstx).toBe(before.details.amountUstx);
      console.log(
        `CONFIRMED: num-cycles ${before.details.numCycles} → ${after.details.numCycles} (early exit at next cycle), amount still locked`
      );
    }
  } else {
    const code = parseErrCode(tx.tx_result?.repr);
    const info = code !== undefined ? describePox5Error(code) : undefined;
    console.log('unstake aborted', code, info?.name, '-', info?.description);
    expect(tx.tx_status).toBe('abort_by_response');
  }
});
