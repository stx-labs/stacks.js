/**
 * E2E: Multi-staker STX-only pooling into the same signer-manager.
 *
 * account5, account6, account7 each call `stake` targeting the SAME
 * signer-manager for the same target cycle (currentCycle+1).
 *
 * Assertions (relative / delta-based):
 *   - fetchSignerSharesStakedForCycle(signerManager, targetCycle) increases by
 *     exactly the sum of all staked amounts (before/after delta).
 *
 * Stakers run sequentially (await each) to avoid nonce races.
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *     BITCOIN_TX_TIMEOUT=300000 STACKS_TX_TIMEOUT=300000 \
 *     RECORD=1 FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-multi-stx-pool.json \
 *     npx jest tests/privatenet/e2e/multi-stx-pool.e2e.test.ts \
 *       --runInBand --collectCoverage=false
 */

import { broadcastTransaction } from '@stacks/transactions';
import { buildStake, fetchSignerSharesStakedForCycle } from '../../../src';
import type { Account } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import {
  ensurePox5,
  getNextNonce,
  getPoxInfo,
  getTransaction,
  waitForFulfilled,
} from '../../helpers/wait';
import { freshFundedStxAccount } from '../../helpers/fresh-account';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';

// ─── Constants ────────────────────────────────────────────────────────────────

const SIGNER_MANAGER = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';
const AMOUNT_USTX = BigInt(process.env.AMOUNT_USTX ?? 1_000_000_000); // 1000 STX per staker
const NUM_CYCLES = Number(process.env.NUM_CYCLES ?? 1);
const FEE_USTX = BigInt(process.env.FEE_USTX ?? 10_000);

// ─── Staker definitions ────────────────────────────────────────────────────────
//
// To avoid ACCOUNT-STATE COLLISIONS (a reused REGTEST_KEYS account that's
// already staked → err u19 ALREADY_STAKED), each of the 3 stakers is a
// freshly-derived random account funded in beforeAll. STX-only `stake` needs no
// bond allowlist, so fresh accounts work here.

const NUM_STAKERS = 3;
// Fund each fresh account with stake amount + generous fee headroom.
const FUND_USTX = AMOUNT_USTX + 1_000_000_000n;

interface Staker {
  name: string;
  account: Account;
}

const STAKERS: Staker[] = [];

// ─── Per-staker stake action ───────────────────────────────────────────────────

async function doStxStake(
  staker: Staker,
  startBurnHt: number,
): Promise<bigint> {
  const network = getNetwork();
  console.log(`\n--- [${staker.name}] staking ${AMOUNT_USTX} uSTX to ${SIGNER_MANAGER} ---`);

  const nonce = await getNextNonce(staker.account.address);

  const unsigned = await buildStake({
    signerManager: SIGNER_MANAGER,
    amountUstx: AMOUNT_USTX,
    numCycles: NUM_CYCLES,
    startBurnHt,
    publicKey: staker.account.publicKey,
    fee: FEE_USTX,
    nonce,
    network,
  });

  const transaction = signTransaction(unsigned, staker.account.key);
  const res = await broadcastTransaction({ transaction, network });
  if ('error' in res) {
    throw new Error(`[${staker.name}] broadcast rejected: ${res.error} — ${'reason' in res ? res.reason : ''}`);
  }
  console.log(`[${staker.name}] txid: ${res.txid}`);

  // Wait until tx leaves mempool
  const tx = await waitForFulfilled(async () => {
    const t = await getTransaction(res.txid);
    if (!t || t.tx_status === 'pending') throw new Error('tx still pending');
    return t;
  });

  console.log(`[${staker.name}] tx_status: ${tx.tx_status}, result: ${tx.tx_result?.repr}`);

  if (tx.tx_status !== 'success') {
    throw new Error(`[${staker.name}] stake tx failed: ${tx.tx_status} ${tx.tx_result?.repr}`);
  }
  console.log(`[${staker.name}] staked ${AMOUNT_USTX} uSTX ✓`);
  return AMOUNT_USTX;
}

// ─── Test ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  useFixtures('e2e-multi-stx-pool');
  await ensurePox5();
  // Derive + fund N fresh random stakers (no collisions, no allowlist needed).
  const network = getNetwork();
  for (let i = 0; i < NUM_STAKERS; i++) {
    const account = await freshFundedStxAccount({ network, amountUstx: FUND_USTX });
    STAKERS.push({ name: `fresh${i + 1}`, account });
  }
}, 6 * 180_000);

test('multi-staker STX pooling: account5+6+7 all stake to the same signer-manager', async () => {
  useFixtures('e2e-multi-stx-pool');
  const network = getNetwork();

  console.log('\n=== MULTI-STX-POOL E2E: beginning ===');

  // Dynamic current cycle discovery
  const poxInfo = await getPoxInfo();
  const targetCycle = poxInfo.rewardCycleId + 1;
  // startBurnHt must map to the current cycle (replay guard in the contract)
  const startBurnHt = poxInfo.currentBurnchainBlockHeight;

  console.log(`currentCycle: ${poxInfo.rewardCycleId}, targetCycle: ${targetCycle}`);
  console.log(`currentBurnHt: ${poxInfo.currentBurnchainBlockHeight}, startBurnHt: ${startBurnHt}`);
  console.log(`signerManager: ${SIGNER_MANAGER}`);
  console.log(`amountUstx per staker: ${AMOUNT_USTX.toString()}`);
  console.log(`numCycles: ${NUM_CYCLES}`);

  // Capture aggregate BEFORE (STX-only leg: no bondIndex)
  const sharesBefore = await fetchSignerSharesStakedForCycle({ signerManager: SIGNER_MANAGER, rewardCycle: targetCycle, network });
  console.log(`signerSharesStakedForCycle(${targetCycle}) BEFORE: ${sharesBefore.toString()} uSTX`);

  // Run all three stakers sequentially
  const stakedAmounts: bigint[] = [];
  for (const staker of STAKERS) {
    const amount = await doStxStake(staker, startBurnHt);
    stakedAmounts.push(amount);
  }

  useFixtures('e2e-multi-stx-pool-after');
  // Capture aggregate AFTER
  const sharesAfter = await fetchSignerSharesStakedForCycle({ signerManager: SIGNER_MANAGER, rewardCycle: targetCycle, network });
  console.log(`signerSharesStakedForCycle(${targetCycle}) AFTER: ${sharesAfter.toString()} uSTX`);

  const expectedDelta = stakedAmounts.reduce((sum, a) => sum + a, 0n);
  const actualDelta = sharesAfter - sharesBefore;

  console.log(`\n=== MULTI-STX-POOL SUMMARY ===`);
  console.log(`signerManager: ${SIGNER_MANAGER}`);
  console.log(`targetCycle: ${targetCycle}`);
  console.log(`stakers: ${STAKERS.map(s => s.name).join(', ')}`);
  console.log(`amountUstx each: ${AMOUNT_USTX.toString()}`);
  console.log(`expectedDelta: ${expectedDelta.toString()} uSTX`);
  console.log(`actualDelta:   ${actualDelta.toString()} uSTX`);
  console.log(`sharesBefore: ${sharesBefore.toString()}`);
  console.log(`sharesAfter:  ${sharesAfter.toString()}`);

  // Delta assertion: signer shares for this cycle must have increased by exactly the sum staked
  expect(actualDelta).toBe(expectedDelta);

  console.log('\n=== MULTI-STX-POOL: ALL ASSERTIONS PASSED ✓ ===');
}, 3 * 180_000);
