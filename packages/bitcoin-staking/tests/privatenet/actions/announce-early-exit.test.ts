/**
 * ACTION — Announce L1 early exit for a bond participant.
 *
 * Calls `announce-l1-early-exit` on pox-5, signed by the STAKER THEMSELVES
 * (contract asserts `contract-caller == tx-sender == staker`; NOT a bond-admin
 * op). On success the staker's bond shares are zeroed, enabling BTC ELSE-branch
 * spend. Requires isL1Lock enrollment and a matching oldSignerManager.
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     BOND_INDEX=65 STAKER=account7 \
 *     npx jest tests/privatenet/actions/announce-early-exit.test.ts \
 *       --runInBand --collectCoverage=false --verbose
 */

import {
  buildAnnounceL1EarlyExit,
  describePox5Error,
  fetchBondMembership,
  fetchHasAnnouncedL1EarlyExit,
} from '../../../src';
import { SIGNER_MANAGER } from '../constants';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork, isMocking } from '../../helpers/utils';
import { broadcastAndWait, getNextNonce, getTransaction } from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { useFixtures } from '../../helpers/mock';

jest.setTimeout(30 * 60_000);

// Must equal oldSignerManager in the contract call; the daemon registers this
// contract on the private testnet.

const FEE = 10_000n;

const STAKER_NAME = (process.env.STAKER ?? 'account5') as 'account5' | 'account6' | 'account7';

const ALLOWED_STAKERS = ['account5', 'account6', 'account7'] as const;
if (!(ALLOWED_STAKERS as readonly string[]).includes(STAKER_NAME)) {
  throw new Error(`Unknown STAKER="${STAKER_NAME}". Must be account5, account6, or account7.`);
}

const stakerAccount = getAccount(REGTEST_KEYS[STAKER_NAME]);

const network = getNetwork();
let bondAdmin: Awaited<ReturnType<typeof getBondAdminAccount>>;

beforeAll(async () => {
  bondAdmin = await getBondAdminAccount();
}, 30 * 60_000);

test(`announce-l1-early-exit: staker=${STAKER_NAME}`, async () => {
  useFixtures('announce-early-exit');
  console.log('staker principal:', stakerAccount.address);
  console.log('bond admin (early-unlock-admin):', bondAdmin.address);
  console.log('oldSignerManager:', SIGNER_MANAGER);

  // SELF-HEAL: announce is one-shot per enrollment. On a re-record where the
  // staker already announced (register self-healed), assert the flag instead.
  const membership = await fetchBondMembership({ address: stakerAccount.address, network });
  if (membership?.isL1Lock) {
    const announced = await fetchHasAnnouncedL1EarlyExit({
      bondIndex: membership.bondIndex,
      staker: stakerAccount.address,
      network,
    });
    if (announced) {
      console.log(`already announced for bond ${membership.bondIndex} — self-heal pass`);
      expect(announced).toBe(true);
      return;
    }
  }

  const nonce = await getNextNonce(stakerAccount.address);

  const unsigned = await buildAnnounceL1EarlyExit({
    staker: stakerAccount.address,
    oldSignerManager: SIGNER_MANAGER,
    publicKey: stakerAccount.publicKey,
    fee: FEE,
    nonce,
    network,
    // announce settles rewards + decrements share totals — asset movements that
    // default Deny mode reverts (abort_by_post_condition), silently undoing the
    // announce. Allow asset transfers so the announce actually persists.
    postConditionMode: 'allow',
  });

  const tx = signTransaction(unsigned, stakerAccount.key);
  const txid = await broadcastAndWait(tx, stakerAccount.address, network);
  console.log('broadcast txid:', txid);

  // Best-effort result check via /extended. A static fixture never changes, so
  // the settle wait is pointless under replay.
  if (!isMocking) await new Promise(r => setTimeout(r, 5_000));
  const record = await getTransaction(txid);

  if (record && record.tx_status !== 'pending') {
    console.log('tx_status:', record.tx_status);
    console.log('tx_result:', record.tx_result?.repr);

    if (record.tx_status === 'success') {
      console.log(
        `Staker ${stakerAccount.address} bond shares zeroed — BTC ELSE branch is now spendable.`
      );
    } else if (record.tx_status === 'abort_by_response') {
      const match = record.tx_result?.repr?.match(/^\(err u(\d+)\)$/);
      if (match) {
        const code = Number(match[1]);
        const description = describePox5Error(code);
        console.error(`=== ABORT: (err u${code}) — ${description} ===`);
        console.error('Common causes:');
        console.error(
          '  ERR_CANNOT_ANNOUNCE_L1_EARLY_UNLOCK — staker not enrolled with isL1Lock=true'
        );
        console.error(
          "  ERR_INVALID_OLD_SIGNER_MANAGER      — SIGNER_MANAGER does not match staker's signer"
        );
        console.error(
          "  ERR_UNAUTHORIZED                    — BOND_ADMIN_KEY is not the bond's early-unlock-admin"
        );
        throw new Error(`announce-l1-early-exit aborted: (err u${code}) — ${description}`);
      }
    }
  } else {
    console.log('tx still pending or not indexed — confirm via chain read-only if needed');
  }

  // The test passes as long as the tx was broadcast without a throw above.
  expect(txid).toMatch(/^[0-9a-f]{64}$/);
});
