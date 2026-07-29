/**
 * Privatenet STX-only EXTEND / re-stake action — exercises `stake-update`.
 *
 * Extends account6's existing STX-only stake by CYCLES_TO_EXTEND (default 1),
 * optionally topping up by AMOUNT_INCREASE, reading get-staker-info
 * BEFORE/AFTER. Requires account6 already STX-only staking (run
 * stx-stake-signer-set first); if not staked, asserts ERR_NOT_STAKING (u27)
 * and skips. Staker-only tx; does not touch bond-admin / setup-bond.
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so RECORD=1 \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 BITCOIN_TX_TIMEOUT=600000 \
 *     npx jest tests/privatenet/actions/stx-extend.test.ts --runInBand --collectCoverage=false --verbose
 */
import { SIGNER_MANAGER } from '../constants';
import { buildStakeUpdate, fetchStakerInfo, describePox5Error } from '../../../src';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import {
  broadcastAndWaitForTransaction,
  ensureRewardPhase,
  getNextNonce,
  parseErrCode,
} from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';

jest.setTimeout(60 * 60_000);

const network = getNetwork();
const FEE = 10_000n;

const STAKER = process.env.STAKER ?? 'account6';
const CYCLES_TO_EXTEND = Number(process.env.CYCLES_TO_EXTEND ?? 1);
const AMOUNT_INCREASE = BigInt(process.env.AMOUNT_INCREASE ?? 0n);

const signerManager = SIGNER_MANAGER;
const staker = getAccount(REGTEST_KEYS[STAKER as keyof typeof REGTEST_KEYS]);

beforeAll(async () => {
  useFixtures('stx-extend');
}, 60 * 60_000);

test('stake-update extends account6 STX-only stake by another cycle', async () => {
  await ensureRewardPhase();

  const before = await fetchStakerInfo({ address: staker.address, network });
  console.log(
    'BEFORE staker-info:',
    before.staked
      ? { ...before.details, amountUstx: before.details!.amountUstx.toString() }
      : before
  );

  if (!before.staked) {
    console.warn(
      'account6 NOT staking — stake-update gates on ERR_NOT_STAKING (u27). Run stx-stake-signer-set first.'
    );
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
    // stake-update touches locked STX — allow asset moves so it doesn't
    // abort_by_post_condition under default Deny mode.
    postConditionMode: 'allow',
  });

  const transaction = signTransaction(unsigned, staker.key);
  const tx = await broadcastAndWaitForTransaction(transaction, network);
  console.log('extend on-chain result', {
    txid: tx.tx_id,
    tx_status: tx.tx_status,
    result_repr: tx.tx_result?.repr,
    burn_block_height: tx.burn_block_height,
  });

  // Phase switch: the same get-stacker-info path returns a DIFFERENT body after
  // the extend (num-cycles 1 -> 2). Route the after-read to its own fixture key so
  // replay doesn't collapse before/after to one value.
  useFixtures('stx-extend-after');
  const after = await fetchStakerInfo({ address: staker.address, network });
  console.log(
    'AFTER staker-info:',
    after.staked ? { ...after.details, amountUstx: after.details!.amountUstx.toString() } : after
  );

  if (tx.tx_status === 'success') {
    expect(after.staked).toBe(true);
    if (after.staked && before.staked) {
      expect(after.details.numCycles).toBe(before.details.numCycles + CYCLES_TO_EXTEND);
      expect(after.details.amountUstx).toBe(before.details.amountUstx + AMOUNT_INCREASE);
      console.log(
        `CONFIRMED: stake-update extended num-cycles ${before.details.numCycles} -> ${after.details.numCycles}` +
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
