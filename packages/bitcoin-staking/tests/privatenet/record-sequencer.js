/**
 * Jest sequencer for RECORD runs: privatenet suites in dependency order
 * (artifact/UTXO/announce state flows between them), everything else after.
 * Replay runs don't need it — fixtures are order-independent.
 */
const Sequencer = require('@jest/test-sequencer').default;

// Earlier = recorded first. The L1 chain must stay in this order.
const ORDER = [
  'actions/reads.test.ts',
  'actions/bonds.test.ts',
  'actions/sdk-surface.test.ts',
  'actions/eligibility-preflight.test.ts',
  'actions/btc-send.test.ts',
  'actions/btc-lock.test.ts',
  'actions/register-for-bond-l1.test.ts',
  'actions/announce-early-exit.test.ts',
  'actions/early-unlock-reclaim.test.ts',
  'actions/early-unlock-key-verify.test.ts',
  'actions/btc-lockup-roundtrip.test.ts',
  'actions/stx-stake.test.ts',
  'actions/stx-extend.test.ts',
  'actions/stx-unstake.test.ts',
  'actions/stx-stake-signer-set.test.ts',
  'actions/register-for-bond.test.ts',
  'actions/setup-bond.test.ts',
  'actions/rewards-sweep.test.ts',
  'actions/rewards.test.ts',
  'actions/rewards-claim-receive.test.ts',
  'actions/verify-signer-grant.test.ts',
  'e2e/single-stx-stake.e2e.test.ts',
  'e2e/exit-stx-unstake.e2e.test.ts',
  'e2e/combined-stx-stake-extend-unstake.e2e.test.ts',
  'e2e/multi-stx-pool.e2e.test.ts',
  'e2e/single-l1-register.e2e.test.ts',
  'e2e/multi-l1-pool.e2e.test.ts',
  'e2e/combined-l1-register-reregister.e2e.test.ts',
  'e2e/exit-l1-announce-and-reclaim.e2e.test.ts',
  'e2e/exit-l1-timelock-reclaim.e2e.test.ts',
  'e2e/register-signer.e2e.test.ts',
  'e2e/signer-grant-lifecycle.e2e.test.ts',
  'e2e/signer-set-50k.e2e.test.ts',
  'e2e/update-bond-registration.e2e.test.ts',
];

function rank(path) {
  const i = ORDER.findIndex(suffix => path.endsWith(suffix));
  return i === -1 ? ORDER.length : i;
}

class RecordSequencer extends Sequencer {
  sort(tests) {
    return [...tests].sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
  }
}

module.exports = RecordSequencer;
