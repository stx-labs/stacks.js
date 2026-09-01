/**
 * E2E — claim-staker-rewards-for-signer: happy-path (ok ...) coverage.
 *
 * contract.claim-staker-rewards-for-signer has no auth assertion — an EOA
 * call succeeds. No sBTC rewards accrue on this net (sbtc-deposit isn't
 * deployed), so `earned: 0` is expected, not a failure.
 *
 * Both legs (STX-only and bond-index) are exercised and each expects success.
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 BITCOIN_TX_TIMEOUT=300000 \
 *     STACKS_TX_TIMEOUT=300000 RECORD=1 \
 *     FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-claim-staker-rewards.json \
 *     npx jest tests/privatenet/e2e/claim-staker-rewards-for-signer.e2e.test.ts \
 *       --runInBand --collectCoverage=false
 */

import { buildClaimStakerRewardsForSigner } from '../../../src';
import { REGTEST_KEYS, getAccount, resolveAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import { broadcastAndWaitForTransaction, getNextNonce, getPoxInfo } from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';

const network = getNetwork();
const FEE = 10_000n;

// Broadcaster (override via CALLER env). Default account6 -> shares its lane with the
// other account6 signer tests, so it never collides with a parallel lane.
const caller = resolveAccount('CALLER', 'account6');

// The staker principal whose reward claim we're asserting (read-only subject).
// (Any funded address works — with no accrued rewards the call returns ok/earned 0.)
const staker = getAccount(REGTEST_KEYS.account6);

beforeAll(async () => {
  useFixtures('e2e-claim-staker-rewards');
}, 60_000);

test('claim-staker-rewards-for-signer succeeds with (ok ...) from an EOA (STX-only leg)', async () => {
  useFixtures('e2e-claim-staker-rewards');
  console.log('caller:', caller.address);
  console.log('staker (account6):', staker.address);

  // DISCOVER CYCLE
  const poxInfo = await getPoxInfo();
  const rewardCycle = Math.max(0, poxInfo.rewardCycleId - 1);
  console.log('claimRewardCycle:', rewardCycle);

  // BUILD
  const nonce = await getNextNonce(caller.address);

  const unsigned = await buildClaimStakerRewardsForSigner({
    staker: staker.address,
    rewardCycle,
    // bondIndex omitted -> targets the STX-only leg
    publicKey: caller.publicKey,
    fee: FEE,
    nonce,
    network,
    postConditionMode: 'allow',
  });

  // SIGN AND BROADCAST
  const tx = signTransaction(unsigned, caller.key);
  const txRecord = await broadcastAndWaitForTransaction(tx, network);

  console.log('on-chain result:', {
    txid: txRecord.tx_id,
    tx_status: txRecord.tx_status,
    result_repr: txRecord.tx_result?.repr,
    burn_block_height: txRecord.burn_block_height,
  });

  expect(txRecord.tx_status).toBe('success');
  expect(txRecord.tx_result?.repr).toMatch(/^\(ok /);
}, 180_000);

test('claim-staker-rewards-for-signer with bond index: also succeeds with (ok ...)', async () => {
  useFixtures('e2e-claim-staker-rewards-bond'); // own phase: 2nd broadcast must not collide with test 1
  console.log('caller:', caller.address);
  console.log('staker (account6):', staker.address);

  // DISCOVER CYCLE
  const poxInfo = await getPoxInfo();
  const rewardCycle = Math.max(0, poxInfo.rewardCycleId - 1);

  // Bond index 1: the first bond, always present on a running chain.
  const bondIndex = 1;
  console.log('rewardCycle:', rewardCycle, '  bondIndex:', bondIndex);

  // BUILD
  const nonce = await getNextNonce(caller.address);

  const unsigned = await buildClaimStakerRewardsForSigner({
    staker: staker.address,
    rewardCycle,
    bondIndex,
    publicKey: caller.publicKey,
    fee: FEE,
    nonce,
    network,
  });

  // SIGN AND BROADCAST
  const tx = signTransaction(unsigned, caller.key);
  const txRecord = await broadcastAndWaitForTransaction(tx, network);

  console.log('on-chain result:', {
    txid: txRecord.tx_id,
    tx_status: txRecord.tx_status,
    result_repr: txRecord.tx_result?.repr,
  });

  expect(txRecord.tx_status).toBe('success');
  expect(txRecord.tx_result?.repr).toMatch(/^\(ok /);
}, 180_000);
