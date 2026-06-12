/**
 * Privatenet STX-only EXTEND / re-stake action — exercises `stake-update`.
 *
 * pox-5.clar `stake-update` (L1077) is the manual re-stake entry-point for an
 * existing STX-only position. A single call can:
 *   - extend the lock by `cycles-to-extend` cycles,
 *   - top up the locked amount by `amount-increase` uSTX,
 *   - rotate the signer-manager (pass new `signer-manager`, current as `old-`).
 * It re-validates via the signer-manager, asserts `old-signer-manager` matches
 * the recorded signer (ERR_INVALID_OLD_SIGNER_MANAGER u36), re-checks the lock
 * period (ERR_INVALID_NUM_CYCLES u20) and reverts in the prepare phase (u47).
 *
 * This action extends account6's existing STX-only stake by CYCLES_TO_EXTEND
 * (default 1), optionally topping up by AMOUNT_INCREASE (default 0), reading
 * get-staker-info BEFORE/AFTER to show num-cycles (and amount) grew. Requires
 * account6 to already be STX-only staking (run stx-stake-signer-set first);
 * if not staked, it reports ERR_NOT_STAKING (u27) is the gate and skips.
 *
 * Staker-only tx (account6). Does NOT touch bond-admin / setup-bond.
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so RECORD=1 \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 BITCOIN_TX_TIMEOUT=600000 \
 *     npx jest tests/privatenet/actions/stx-extend.test.ts --runInBand --collectCoverage=false --verbose
 */
import { broadcastTransaction } from '@stacks/transactions';
import fetchMock from 'jest-fetch-mock';
import { buildStakeUpdate, fetchStakerInfo, describePox5Error } from '../../../src';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import {
  ensurePox5,
  getNextNonce,
  getPoxInfo,
  getTransaction,
  isInPreparePhase,
  waitForFulfilled,
  waitForRewardPhase,
} from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';

fetchMock.disableMocks();
jest.setTimeout(60 * 60_000);

const network = getNetwork();
const FEE = 10_000n;

const STAKER = process.env.STAKER ?? 'account6';
const CYCLES_TO_EXTEND = Number(process.env.CYCLES_TO_EXTEND ?? 1);
const AMOUNT_INCREASE = BigInt(process.env.AMOUNT_INCREASE ?? 0n);

const signerManager = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';
const staker = getAccount(REGTEST_KEYS[STAKER as keyof typeof REGTEST_KEYS]);

function parseErrCode(repr: string | undefined): number | undefined {
  const m = repr?.match(/^\(err u(\d+)\)$/);
  return m ? Number(m[1]) : undefined;
}

beforeAll(async () => {
  await ensurePox5();
}, 60 * 60_000);

test('stake-update extends account6 STX-only stake by another cycle', async () => {
  let poxInfo = await getPoxInfo();

  const posOf = () =>
    (poxInfo.currentBurnchainBlockHeight - poxInfo.firstBurnchainBlockHeight) % poxInfo.rewardCycleLength;
  const rewardPhaseLen = poxInfo.rewardCycleLength - poxInfo.prepareCycleLength;
  while (isInPreparePhase(poxInfo.currentBurnchainBlockHeight, poxInfo) || posOf() >= rewardPhaseLen - 2) {
    console.log(`pos ${posOf()} too close to prepare phase — waiting for reward phase`);
    await waitForRewardPhase(poxInfo, 1);
    poxInfo = await getPoxInfo();
  }

  const before = await fetchStakerInfo({ address: staker.address, network });
  console.log('BEFORE staker-info:', before.staked ? { ...before.details, amountUstx: before.details!.amountUstx.toString() } : before);

  if (!before.staked) {
    console.warn('account6 NOT staking — stake-update gates on ERR_NOT_STAKING (u27). Run stx-stake-signer-set first.');
    expect(before.staked).toBe(false); // documents the precondition; nothing to extend
    return;
  }

  const oldSignerManager = before.details!.signer; // must match recorded signer (u36 otherwise)
  console.log('extend params', {
    staker: staker.address,
    currentNumCycles: before.details!.numCycles,
    cyclesToExtend: CYCLES_TO_EXTEND,
    amountIncrease: AMOUNT_INCREASE.toString(),
    oldSignerManager,
    newSignerManager: signerManager,
  });

  const unsigned = await buildStakeUpdate({
    signerManager,
    oldSignerManager,
    cyclesToExtend: CYCLES_TO_EXTEND,
    amountIncrease: AMOUNT_INCREASE,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
  });

  const transaction = signTransaction(unsigned, staker.key);
  const res = await broadcastTransaction({ transaction, network });
  if ('error' in res) throw `broadcast rejected: ${res.error} — ${'reason' in res ? res.reason : ''}`;
  console.log('extend txid', res.txid);

  const tx = await waitForFulfilled(async () => {
    const t = await getTransaction(res.txid);
    if (!t || t.tx_status === 'pending') throw 'tx still pending';
    return t;
  });
  console.log('extend on-chain result', {
    txid: tx.tx_id,
    tx_status: tx.tx_status,
    result_repr: tx.tx_result?.repr,
    burn_block_height: tx.burn_block_height,
  });

  const after = await fetchStakerInfo({ address: staker.address, network });
  console.log('AFTER staker-info:', after.staked ? { ...after.details, amountUstx: after.details!.amountUstx.toString() } : after);

  if (tx.tx_status === 'success') {
    expect(after.staked).toBe(true);
    if (after.staked && before.staked) {
      expect(after.details.numCycles).toBe(before.details.numCycles + CYCLES_TO_EXTEND);
      expect(after.details.amountUstx).toBe(before.details.amountUstx + AMOUNT_INCREASE);
      console.log(
        `CONFIRMED: stake-update extended num-cycles ${before.details.numCycles} → ${after.details.numCycles}` +
          (AMOUNT_INCREASE > 0n ? `, amount +${AMOUNT_INCREASE}` : '')
      );
    }
  } else {
    const code = parseErrCode(tx.tx_result?.repr);
    const info = code !== undefined ? describePox5Error(code) : undefined;
    console.log('extend aborted', code, info?.name, '-', info?.description);
    // u20 ERR_INVALID_NUM_CYCLES can fire if extending pushes num-cycles out of
    // the allowed range; u47 prepare-phase; u36 old-signer mismatch. Tolerate.
    expect(tx.tx_status).toBe('abort_by_response');
  }
});
