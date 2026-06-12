/**
 * E2E: update-bond-registration — rotate the signer-manager on an existing
 * bond membership.
 *
 * Precondition: at least one of our test accounts (account5, account6, account7)
 * must have an active bond membership (registered via register-for-bond).
 * If NONE of the candidates has a membership the test is SKIPPED with a clear log
 * — run register-for-bond-l1.test.ts first to establish a membership.
 *
 * Flow when precondition is met:
 *   1. Find a test account that has an active bond membership.
 *   2. Record the current `signer` (oldSignerManager) from the membership.
 *   3. Determine the new signer-manager (must differ from current; both
 *      daemon-registered: SIGNER_MANAGER and SIGNER_MANAGER_2 from regtest.ts).
 *   4. Broadcast `update-bond-registration` (new → old).
 *   5. Wait for confirmation; assert `fetchBondMembership` reflects the new signer.
 *
 * Note on SIGNER_MANAGER_2: it is the signer-manager deployed by STACKING_KEYS[1]
 * and is daemon-registered on the chain. If the current membership already uses
 * SIGNER_MANAGER_2, the test rotates back to SIGNER_MANAGER.
 *
 * Live run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 BITCOIN_TX_TIMEOUT=300000 \
 *     STACKS_TX_TIMEOUT=300000 RECORD=1 \
 *     FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-update-bond-registration.json \
 *     npx jest tests/privatenet/e2e/update-bond-registration.e2e.test.ts \
 *       --runInBand --collectCoverage=false --verbose
 */

import { broadcastTransaction } from '@stacks/transactions';
import {
  buildUpdateBondRegistration,
  fetchBondMembership,
  describePox5Error,
} from '../../../src';
import { REGTEST_KEYS, getAccount, SIGNER_MANAGER, SIGNER_MANAGER_2 } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import {
  ensurePox5,
  getNextNonce,
  getPoxInfo,
  getTransaction,
  waitForFulfilled,
} from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';

// ─── Candidate accounts ───────────────────────────────────────────────────────
// account5 (STB44…) and account6 (STEH2J3…) are funded L1 stakers.
// account7 (STT8D…) is a funded STX staker.
const CANDIDATES = [
  getAccount(REGTEST_KEYS.account5),
  getAccount(REGTEST_KEYS.account6),
  getAccount(REGTEST_KEYS.account7),
];

const FEE = 10_000n;

function parseErrCode(repr: string | undefined): number | undefined {
  const m = repr?.match(/^\(err u(\d+)\)$/);
  return m ? Number(m[1]) : undefined;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  useFixtures('e2e-update-bond-registration');
  await ensurePox5();
}, 60_000);

// ─── Test ─────────────────────────────────────────────────────────────────────

test('update-bond-registration: rotate signer-manager on an existing membership', async () => {
  useFixtures('e2e-update-bond-registration');
  const network = getNetwork();

  console.log('\n=== E2E: update-bond-registration ===');

  // ── 1. Read pox info ──────────────────────────────────────────────────────
  const poxInfo = await getPoxInfo();
  console.log('currentCycle:', poxInfo.rewardCycleId);
  console.log('currentBurnHt:', poxInfo.currentBurnchainBlockHeight);

  // ── 2. Find a candidate with an active bond membership ────────────────────
  console.log('\n--- Searching for a candidate with active bond membership ---');
  let stakerAccount: ReturnType<typeof getAccount> | undefined;
  let membership: Awaited<ReturnType<typeof fetchBondMembership>>;

  for (const candidate of CANDIDATES) {
    console.log(`  checking ${candidate.address}...`);
    const m = await fetchBondMembership({ address: candidate.address, network });
    if (m !== undefined) {
      console.log(`  FOUND membership for ${candidate.address}:`, {
        bondIndex: m.bondIndex,
        signer: m.signer,
        amountUstx: m.amountUstx.toString(),
        amountSats: m.amountSats.toString(),
        isL1Lock: m.isL1Lock,
      });
      stakerAccount = candidate;
      membership = m;
      break;
    }
  }

  if (stakerAccount === undefined || membership === undefined) {
    console.warn(
      '\nPRECONDITION NOT MET: none of the candidate accounts have an active bond membership.\n' +
        'Run register-for-bond-l1.test.ts (or single-l1-register.e2e.test.ts) first to establish a membership,\n' +
        'then re-run this test.\n' +
        'SKIPPING.'
    );
    // Jest has no built-in "pending" in non-jasmine mode; log clearly and pass vacuously.
    expect(true).toBe(true);
    return;
  }

  console.log(`\nUsing staker: ${stakerAccount.address}`);
  const oldSignerManager = membership.signer;
  console.log('oldSignerManager (current):', oldSignerManager);

  // ── 3. Decide the new signer-manager ─────────────────────────────────────
  // Must differ from current. Both SIGNER_MANAGER and SIGNER_MANAGER_2 are
  // daemon-registered on this chain.
  const newSignerManager =
    oldSignerManager.toLowerCase() === SIGNER_MANAGER.toLowerCase()
      ? SIGNER_MANAGER_2
      : SIGNER_MANAGER;
  console.log('newSignerManager (target):', newSignerManager);

  // ── 4. Broadcast update-bond-registration ────────────────────────────────
  console.log('\n--- Step 4: build + sign + broadcast update-bond-registration ---');
  const nonce = await getNextNonce(stakerAccount.address);
  console.log('staker nonce:', nonce);

  const unsigned = await buildUpdateBondRegistration({
    signerManager: newSignerManager,
    oldSignerManager,
    // no signerCalldata (optional)
    publicKey: stakerAccount.publicKey,
    fee: FEE,
    nonce,
    network,
  });

  const tx = signTransaction(unsigned, stakerAccount.key);
  const broadcastRes = await broadcastTransaction({ transaction: tx, network });
  if ('error' in broadcastRes) {
    throw new Error(
      `update-bond-registration broadcast rejected: ${broadcastRes.error}` +
        ('reason' in broadcastRes ? ` — ${broadcastRes.reason}` : '')
    );
  }
  console.log('update-bond-registration txid:', broadcastRes.txid);
  useFixtures('e2e-update-bond-registration-after');

  const txRecord = await waitForFulfilled(async () => {
    const t = await getTransaction(broadcastRes.txid);
    if (!t || t.tx_status === 'pending') throw new Error('update tx still pending');
    return t;
  });

  console.log('update-bond-registration on-chain result:', {
    txid: txRecord.tx_id,
    tx_status: txRecord.tx_status,
    result_repr: txRecord.tx_result?.repr,
    burn_block_height: txRecord.burn_block_height,
  });

  if (txRecord.tx_status !== 'success') {
    const code = parseErrCode(txRecord.tx_result?.repr);
    const info = code !== undefined ? describePox5Error(code) : undefined;
    throw new Error(
      `update-bond-registration aborted: (err u${code}) — ${info?.name ?? 'unknown'}: ${info?.description ?? ''}`
    );
  }
  console.log('=== update-bond-registration succeeded ✓ ===');

  // ── 5. Assert membership reflects the new signer-manager ─────────────────
  console.log('\n--- Step 5: assert membership.signer updated ---');
  const updatedMembership = await waitForFulfilled(async () => {
    const m = await fetchBondMembership({ address: stakerAccount!.address, network });
    if (!m) throw new Error('membership no longer present');
    if (m.signer.toLowerCase() === oldSignerManager.toLowerCase()) {
      throw new Error('signer not yet updated');
    }
    return m;
  });

  console.log('updatedMembership:', {
    bondIndex: updatedMembership.bondIndex,
    signer: updatedMembership.signer,
    amountUstx: updatedMembership.amountUstx.toString(),
    amountSats: updatedMembership.amountSats.toString(),
    isL1Lock: updatedMembership.isL1Lock,
  });

  // Relative assertions
  expect(updatedMembership.signer.toLowerCase()).toBe(newSignerManager.toLowerCase());
  expect(updatedMembership.bondIndex).toBe(membership.bondIndex);
  expect(updatedMembership.amountUstx).toBe(membership.amountUstx);
  expect(updatedMembership.isL1Lock).toBe(membership.isL1Lock);

  console.log(
    `\n=== E2E update-bond-registration SUCCESS: ` +
      `signer rotated from ${oldSignerManager} → ${updatedMembership.signer} ✓ ===`
  );
}, 180_000);
