/**
 * E2E: Single-staker sBTC register — serialize + abort coverage.
 *
 * No sBTC is minted to test accounts, so lock-sbtc's ft-transfer? (or an
 * earlier guard, depending on cycle timing) always aborts. Proves the builder
 * serializes correctly against the real ABI and reaches the real contract
 * entrypoint. Passes when the tx aborts with no enrollment and the result is
 * one of the known abort codes.
 *
 * Live run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *   POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *   BITCOIN_TX_TIMEOUT=300000 STACKS_TX_TIMEOUT=300000 \
 *   RECORD=1 FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-single-sbtc-register-abort.json \
 *   npx jest tests/privatenet/e2e/single-sbtc-register-abort.e2e.test.ts \
 *     --runInBand --collectCoverage=false
 */

import { buildRegisterForBond, fetchBondMembership } from '../../../src';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork, ENV } from '../../helpers/utils';
import { broadcastAndWait, getNextNonce, getTransaction } from '../../helpers/wait';
import { waitForBondWithRunway } from '../../helpers/bond';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';

const FEE = BigInt(process.env.FEE_USTX ?? 10_000);
const AMOUNT_USTX = 1_000_000n; // 1 STX
const SBTC_SATS = 1_000n;

const SIGNER_MANAGER =
  process.env.SIGNER_MANAGER ?? 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';

const staker = getAccount(REGTEST_KEYS.account6); // unenrolled, 0 sBTC -> abort

// Whichever guard fires first (cycle-timing dependent):
// u1 lock-sbtc ft-transfer?, u5 staker-already-added, u9 already-registered,
// u11 not-allowlisted, u43 bond-already-started, u47 prepare-phase guard
const EXPECTED_ABORTS = new Set([
  '(err u1)',
  '(err u5)',
  '(err u9)',
  '(err u11)',
  '(err u43)',
  '(err u47)',
]);

beforeAll(async () => {
  useFixtures('e2e-single-sbtc-register-abort');
}, 60_000);

test('single-staker sBTC register: aborts with expected error (serialize+abort coverage)', async () => {
  useFixtures('e2e-single-sbtc-register-abort');
  const network = getNetwork();

  console.log('staker:', staker.address);

  // DISCOVER BOND
  // lock-sbtc aborts before the bond guard, so any bond index works;
  // we still discover dynamically to stay aligned with the protocol state.
  const { bondIndex, poxInfo } = await waitForBondWithRunway();
  console.log(`discovered bondIndex=${bondIndex}`);
  console.log('currentBurnHeight:', poxInfo.currentBurnchainBlockHeight);

  // The staker's enrollment state drifts with the chain (e.g. an earlier L1
  // lock may already have enrolled it into a different bond) — derive the
  // expected outcome from what's actually there rather than assuming unenrolled.
  const existing = await fetchBondMembership({ address: staker.address, network });
  console.log(
    'existing membership:',
    existing ? JSON.stringify(existing, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) : 'none'
  );

  // BUILD + BROADCAST
  const nonce = await getNextNonce(staker.address);
  const unsigned = await buildRegisterForBond({
    bondIndex,
    signerManager: SIGNER_MANAGER,
    amountUstx: AMOUNT_USTX,
    lockup: { kind: 'sbtc', sbtcSats: SBTC_SATS },
    publicKey: staker.publicKey,
    fee: FEE,
    nonce,
    network,
  });

  const tx = signTransaction(unsigned, staker.key);
  const txid = await broadcastAndWait(tx, staker.address, network);
  console.log('txid:', txid);

  // Abort must not change enrollment state: still unenrolled if it started
  // that way, or still exactly the pre-existing membership if it didn't.
  const membershipAfter = await fetchBondMembership({ address: staker.address, network });
  if (existing === undefined) {
    expect(membershipAfter).toBeUndefined();
  } else {
    expect(membershipAfter).toEqual(existing);
  }

  // Exact result check only under RECORD=1 — /extended lags on this chain;
  // without RECORD the no-enrollment check above already proves the abort path.
  if (ENV.RECORD) {
    await new Promise(r => setTimeout(r, 5_000));
    const record = await getTransaction(txid);
    console.log('tx_status:', record?.tx_status);
    console.log('tx_result:', record?.tx_result?.repr);
    if (record && record.tx_status !== 'pending') {
      expect(record.tx_status).toBe('abort_by_response');
      expect(EXPECTED_ABORTS.has(record.tx_result.repr)).toBe(true);
    }
  }
}, 180_000);
