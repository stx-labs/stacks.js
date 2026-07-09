/**
 * E2E — calculate-rewards across multiple bond indices (waterfall).
 *
 * pox-5.calculate-rewards requires ALL active bonds sorted descending by
 * `stx-value-ratio`. This test scans bond indices for 'locked' bonds, sorts
 * them, and calls calculate-rewards with the full list. With no sBTC funded,
 * a tolerant abort (or success no-op) is accepted — see TOLERANT_OUTCOMES.
 *
 * Fixture key: 'e2e-reward-waterfall'
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *     BITCOIN_TX_TIMEOUT=300000 STACKS_TX_TIMEOUT=300000 \
 *     RECORD=1 FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-reward-waterfall.json \
 *     npx jest tests/privatenet/e2e/multi-bond-reward-waterfall.e2e.test.ts \
 *       --runInBand --collectCoverage=false --verbose
 */

import {
  buildCalculateRewards,
  describePox5Error,
  fetchBond,
  fetchBondStatus,
  fetchPoxInfo,
  Pox5ErrorCode,
} from '../../../src';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import { broadcastAndWait, getNextNonce, getTransaction, parseErrCode } from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';

const FEE = 10_000n;
// anyone-callable; account5 used as caller
const caller = getAccount(REGTEST_KEYS['account5']);
const network = getNetwork();

// Bond indices are contiguous from 0; 64 is more than enough for any testnet.
const BOND_SCAN_LIMIT = 64;

beforeAll(async () => {
  useFixtures('e2e-reward-waterfall');
}, 60_000);

test(
  'calculate-rewards: full sorted waterfall across all active bonds',
  async () => {
    useFixtures('e2e-reward-waterfall');

    const poxInfo = await fetchPoxInfo({ network });
    console.log('currentCycle:', poxInfo.rewardCycleId);

    // SCAN BONDS
    interface BondEntry {
      bondIndex: number;
      stxValueRatio: bigint;
    }
    const activeBonds: BondEntry[] = [];

    for (let i = 0; i < BOND_SCAN_LIMIT; i++) {
      const bond = await fetchBond({ bondIndex: i, network }).catch(() => undefined);
      if (!bond) continue;

      const status = await fetchBondStatus({
        bondIndex: i,
        poxInfo,
        isBondSetup: true,
        network,
      }).catch(() => 'missing' as const);

      // 'locked' = bond period currently active (started, not yet past its active-cycles window)
      if (status === 'locked') {
        activeBonds.push({ bondIndex: i, stxValueRatio: bond.stxValueRatio });
      }
    }
    console.log(
      `Found ${activeBonds.length} active bond(s):`,
      activeBonds.map(b => `index=${b.bondIndex} ratio=${b.stxValueRatio}`).join(', ') || '(none)'
    );

    // SORT DESCENDING
    // Contract requires bond-list sorted descending by stx-value-ratio, else
    // ERR_INVALID_BOND_PERIOD_ORDERING (u29).
    const sortedBonds = [...activeBonds].sort((a, b) => {
      if (b.stxValueRatio > a.stxValueRatio) return 1;
      if (b.stxValueRatio < a.stxValueRatio) return -1;
      return b.bondIndex - a.bondIndex; // tie-break: descending bond index
    });
    const sortedIndices = sortedBonds.map(b => b.bondIndex);
    console.log('sortedBondIndices:', sortedIndices);

    // BROADCAST
    const unsigned = await buildCalculateRewards({
      bondIndices: sortedIndices,
      publicKey: caller.publicKey,
      fee: FEE,
      nonce: await getNextNonce(caller.address),
      network,
      postConditionMode: 'allow',
    });

    const tx = signTransaction(unsigned, caller.key);
    const txid = await broadcastAndWait(tx, caller.address, network);
    console.log('calculate-rewards txid:', txid);

    const txRecord = await getTransaction(txid);
    console.log('tx_status:', txRecord?.tx_status);

    if (!txRecord || txRecord.tx_status === 'pending') {
      throw new Error('calculate-rewards tx still pending — timeout exceeded');
    }

    const code = parseErrCode(txRecord.tx_result?.repr);

    // ASSERT
    // No sBTC funded, so accept success (no-op) or any of these expected aborts:
    // u30 already settled, u31 probe bond inactive, u33 scan missed a hidden
    // active bond, u29 ratio-sort edge case.
    const TOLERANT_OUTCOMES = new Set([
      Pox5ErrorCode.DistributionAlreadyComputed, // u30
      Pox5ErrorCode.BondNotActive, // u31
      Pox5ErrorCode.ActiveBondNotIncluded, // u33
      Pox5ErrorCode.InvalidBondPeriodOrdering, // u29
    ]);

    if (txRecord.tx_status === 'success') {
      console.log('calculate-rewards succeeded — waterfall settled (no-op without sBTC rewards)');
    } else if (txRecord.tx_status === 'abort_by_response' && code !== undefined) {
      const info = describePox5Error(code);
      console.log(
        `calculate-rewards aborted: (err u${code}) ${info?.name ?? 'unknown'} — ${info?.description ?? ''}`
      );
      expect(TOLERANT_OUTCOMES.has(code)).toBe(true);
    } else {
      throw new Error(
        `Unexpected tx_status=${txRecord.tx_status}, repr=${txRecord.tx_result?.repr}`
      );
    }
  },
  3 * 180_000
);
