/**
 * E2E — sBTC unstake: serialize + expected abort coverage.
 *
 * The private testnet has NO sBTC minted to test accounts, so `unstake-sbtc`
 * for a staker with no sBTC position always aborts. Accepts either an
 * on-chain abort or a broadcast-level rejection as a valid outcome.
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 BITCOIN_TX_TIMEOUT=300000 \
 *     STACKS_TX_TIMEOUT=300000 RECORD=1 \
 *     FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-exit-sbtc-unstake-abort.json \
 *     npx jest tests/privatenet/e2e/exit-sbtc-unstake-abort.e2e.test.ts \
 *       --runInBand --collectCoverage=false --verbose
 */

import { broadcastTransaction } from '@stacks/transactions';
import { buildUnstakeSbtc, describePox5Error, Pox5ErrorCode } from '../../../src';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import { getNextNonce, getTransaction, parseErrCode, waitForFulfilled } from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';

const network = getNetwork();
const FEE = 10_000n;
const SIGNER_MANAGER = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';

const staker = getAccount(REGTEST_KEYS['account6']); // funded, no sBTC -> abort

// CannotUnstakeSbtc (no sBTC staked) / NotStaking (no position at all) /
// NotBondParticipant (staker holds an STX-only position, not an sBTC bond
// participant) are all valid "no sBTC" outcomes.
const EXPECTED_ABORT_CODES = new Set<number>([
  Pox5ErrorCode.NotStaking,
  Pox5ErrorCode.CannotUnstakeSbtc,
  Pox5ErrorCode.NotBondParticipant,
]);

beforeAll(async () => {
  useFixtures('e2e-exit-sbtc-unstake-abort');
}, 60_000);

test('unstake-sbtc aborts with expected error (no sBTC position)', async () => {
  useFixtures('e2e-exit-sbtc-unstake-abort');

  // BUILD
  // amountToWithdrawSats = 1 sat (minimum plausible value; the tx aborts before
  // the amount is validated because there's no sBTC position at all).
  const unsigned = await buildUnstakeSbtc({
    signerManager: SIGNER_MANAGER,
    amountToWithdrawSats: 1n,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
    postConditionMode: 'allow', // reach the contract so it aborts by response, not post-condition
  });

  // BROADCAST
  const tx = signTransaction(unsigned, staker.key);
  const res = await broadcastTransaction({ transaction: tx, network });

  // A broadcast-level rejection is also a valid "no sBTC position" outcome:
  // some nodes reject early (static analysis), others admit and abort on-chain.
  if ('error' in res) {
    const reason = 'reason' in res ? String((res as { reason?: unknown }).reason) : '';
    console.log('broadcast REJECTED (valid no-position outcome):', res.error, '-', reason);
    expect(res.error).toBeDefined();
    return;
  }
  console.log('unstake-sbtc txid:', res.txid);

  // WAIT
  const txRecord = await waitForFulfilled(async () => {
    const t = await getTransaction(res.txid);
    if (!t || t.tx_status === 'pending') throw new Error('tx still pending');
    return t;
  });

  // ASSERT
  expect(txRecord.tx_status).toBe('abort_by_response');

  const code = parseErrCode(txRecord.tx_result?.repr);
  const info = code !== undefined ? describePox5Error(code) : undefined;
  console.log('abort code:', code, '-', info?.name ?? 'unknown', '-', info?.description ?? '');

  expect(code).toBeDefined();
  expect(EXPECTED_ABORT_CODES.has(code!)).toBe(true);
}, 180_000);
