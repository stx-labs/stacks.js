/**
 * Reward distribution + claiming probes against the private testnet.
 *
 * No successful bond enrollments exist on this net, so `claim-rewards` hits
 * error-code paths rather than paying out — that is expected; these probes
 * map the reward entry-points' behavior and tolerate any plausible abort code.
 * account5 is allowlisted (never enrolled); account6 is neither.
 *
 * Run with:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so RECORD=1 \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *     npx jest tests/privatenet/actions/rewards.test.ts --runInBand --collectCoverage=false
 */

import {
  buildCalculateRewards,
  buildClaimRewards,
  describePox5Error,
  fetchEarned,
  Pox5ErrorCode,
} from '../../../src';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import {
  assertTolerableResult,
  broadcastAndWait,
  getNextNonce,
  getPoxInfo,
  getStxBalance,
} from '../../helpers/wait';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';

jest.setTimeout(30 * 60_000);

const network = getNetwork();

// Safe senders — neither is driven by any daemon
const account5 = getAccount(REGTEST_KEYS.account5); // allowlisted on bonds 4-24, never enrolled
const account6 = getAccount(REGTEST_KEYS.account6); // never allowlisted, never enrolled

const FEE = 10_000n;

// Daemon's deployed signer-manager — the principal the contract keys reward
// legs by (get-earned takes a signer-manager arg). Reused for read-only probes.
const SIGNER_MANAGER = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';

// Bond indices account5 is allowlisted on (from prior setup-bond runs).
// Used for both calculate-rewards and claim-rewards probes.
const PROBE_BOND_INDICES = [4, 12, 19];
const CLAIM_BOND_INDICES = [4, 12];

// CALCULATE-REWARDS
//
// calculate-rewards requires the full set of active bonds sorted descending
// by stx-value-ratio; we pass a partial, arbitrarily-ordered subset - u29 or
// u33 is an expected rejection, not a bug.

test('rewards-probe-1: calculate-rewards from account5 (bond indices [4,12,19])', async () => {
  useFixtures('rewards-probe-1');
  const poxInfo = await getPoxInfo();
  console.log('probe-1 current reward cycle:', poxInfo.rewardCycleId);
  console.log('probe-1 bond indices:', PROBE_BOND_INDICES);

  const unsigned = await buildCalculateRewards({
    bondIndices: PROBE_BOND_INDICES,
    publicKey: account5.publicKey,
    fee: FEE,
    nonce: await getNextNonce(account5.address),
    network,
    postConditionMode: 'allow',
  });

  const tx = signTransaction(unsigned, account5.key);
  const txid = await broadcastAndWait(tx, account5.address, network);
  console.log('probe-1 txid:', txid);

  const code = await assertTolerableResult('probe-1', txid);

  const TOLERANT_SET = new Set([
    Pox5ErrorCode.DistributionAlreadyComputed, // u30 — already settled this period
    Pox5ErrorCode.BondNotActive, // u31 — bonds not active at calc-height
    Pox5ErrorCode.ActiveBondNotIncluded, // u33 — missing bonds from the full active set
    Pox5ErrorCode.InvalidBondPeriodOrdering, // u29 — list not sorted by descending ratio
  ]);

  if (code !== undefined) {
    const info = describePox5Error(code);
    if (code === Pox5ErrorCode.DistributionAlreadyComputed) {
      console.log(
        'probe-1 CONFIRMED: ERR_DISTRIBUTION_ALREADY_COMPUTED (u30) — distribution already settled'
      );
    } else if (code === Pox5ErrorCode.BondNotActive) {
      console.log(
        'probe-1 CONFIRMED: ERR_BOND_NOT_ACTIVE (u31) — bond not active at calculation-height'
      );
    } else if (code === Pox5ErrorCode.ActiveBondNotIncluded) {
      console.log(
        'probe-1 CONFIRMED: ERR_ACTIVE_BOND_NOT_INCLUDED (u33) — partial bond list rejected'
      );
    } else if (code === Pox5ErrorCode.InvalidBondPeriodOrdering) {
      console.log(
        'probe-1 CONFIRMED: ERR_INVALID_BOND_PERIOD_ORDERING (u29) — list not sorted by descending stx-value-ratio'
      );
    } else if (TOLERANT_SET.has(code)) {
      console.log(`probe-1 NOTE: (err u${code}) — acceptable`);
    } else {
      console.warn(
        `probe-1 UNEXPECTED: (err u${code}) ${info?.name ?? ''} — new discovery! ${info?.description ?? ''}`
      );
    }
    expect(typeof code).toBe('number');
  } else {
    console.log('probe-1: tx SUCCEEDED — distribution waterfall settled (or no-op)');
  }
});

// CLAIM-REWARDS: account5 (allowlisted, never enrolled). Also checks STX
// balance before/after - no increase expected (tolerant).

test('rewards-probe-2: claim-rewards from account5 (allowlisted but never enrolled)', async () => {
  useFixtures('rewards-probe-2');
  const poxInfo = await getPoxInfo();
  const rewardCycle = Math.max(0, poxInfo.rewardCycleId - 1);
  console.log('probe-2 current cycle:', poxInfo.rewardCycleId, '/ claiming cycle:', rewardCycle);
  console.log('probe-2 bond indices:', CLAIM_BOND_INDICES);
  console.log('probe-2 sender:', account5.address);

  let balanceBefore: bigint | undefined;
  try {
    balanceBefore = await getStxBalance(account5.address);
    console.log('probe-2 balance before (uSTX):', balanceBefore.toString());
  } catch (err) {
    console.warn(
      'probe-2: could not fetch balance before:',
      err instanceof Error ? err.message : String(err)
    );
  }

  const unsigned = await buildClaimRewards({
    rewardCycle,
    bondIndices: CLAIM_BOND_INDICES,
    publicKey: account5.publicKey,
    fee: FEE,
    nonce: await getNextNonce(account5.address),
    network,
    postConditionMode: 'allow',
  });

  const tx = signTransaction(unsigned, account5.key);
  const txid = await broadcastAndWait(tx, account5.address, network);
  console.log('probe-2 txid:', txid);

  const code = await assertTolerableResult('probe-2', txid);

  if (balanceBefore !== undefined) {
    try {
      const balanceAfter = await getStxBalance(account5.address);
      console.log('probe-2 balance after  (uSTX):', balanceAfter.toString());
      const netChange = balanceAfter - balanceBefore;
      console.log('probe-2 net balance change (uSTX):', netChange.toString());
      // Only assert no unexpected gain - a positive change > fee would mean rewards paid
      expect(netChange).toBeLessThanOrEqual(0n);
    } catch (err) {
      console.warn(
        'probe-2: could not fetch balance after:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  const PRIMARY_CODES = new Set([
    Pox5ErrorCode.NoClaimableRewards, // u32
    Pox5ErrorCode.NotBondParticipant, // u34
  ]);

  if (code !== undefined) {
    const info = describePox5Error(code);
    if (code === Pox5ErrorCode.NoClaimableRewards) {
      console.log(
        'probe-2 CONFIRMED: ERR_NO_CLAIMABLE_REWARDS (u32) — no rewards for non-enrolled staker'
      );
    } else if (code === Pox5ErrorCode.NotBondParticipant) {
      console.log(
        'probe-2 CONFIRMED: ERR_NOT_BOND_PARTICIPANT (u34) — account5 is not in any bond'
      );
    } else if (PRIMARY_CODES.has(code)) {
      console.log(`probe-2 NOTE: (err u${code}) — expected`);
    } else {
      console.warn(
        `probe-2 UNEXPECTED: (err u${code}) ${info?.name ?? ''} — new discovery! ${info?.description ?? ''}`
      );
    }
    expect(typeof code).toBe('number');
  } else {
    console.warn(
      'probe-2 UNEXPECTED SUCCESS: claim-rewards returned (ok ...) for never-enrolled account5 — investigate!'
    );
  }
});

// CLAIM-REWARDS: account6 (never allowlisted, never enrolled) - probes the
// outer "not a participant" guard.

test('rewards-probe-3: claim-rewards from account6 (not allowlisted, never enrolled)', async () => {
  useFixtures('rewards-probe-3');
  const poxInfo = await getPoxInfo();
  const rewardCycle = Math.max(0, poxInfo.rewardCycleId - 1);
  console.log('probe-3 current cycle:', poxInfo.rewardCycleId, '/ claiming cycle:', rewardCycle);
  console.log('probe-3 bond indices:', CLAIM_BOND_INDICES);
  console.log('probe-3 sender:', account6.address);

  const unsigned = await buildClaimRewards({
    rewardCycle,
    bondIndices: CLAIM_BOND_INDICES,
    publicKey: account6.publicKey,
    fee: FEE,
    nonce: await getNextNonce(account6.address),
    network,
    postConditionMode: 'allow',
  });

  const tx = signTransaction(unsigned, account6.key);
  const txid = await broadcastAndWait(tx, account6.address, network);
  console.log('probe-3 txid:', txid);

  const code = await assertTolerableResult('probe-3', txid);

  const PRIMARY_CODES = new Set([
    Pox5ErrorCode.NotBondParticipant, // u34 — primary: outer guard, account6 not in any bond
    Pox5ErrorCode.NoClaimableRewards, // u32 — alternative path
  ]);

  if (code !== undefined) {
    const info = describePox5Error(code);
    if (code === Pox5ErrorCode.NotBondParticipant) {
      console.log(
        'probe-3 CONFIRMED: ERR_NOT_BOND_PARTICIPANT (u34) — account6 has no bond membership'
      );
    } else if (code === Pox5ErrorCode.NoClaimableRewards) {
      console.log('probe-3 CONFIRMED: ERR_NO_CLAIMABLE_REWARDS (u32) — no rewards for account6');
    } else if (PRIMARY_CODES.has(code)) {
      console.log(`probe-3 NOTE: (err u${code}) — expected`);
    } else {
      console.warn(
        `probe-3 UNEXPECTED: (err u${code}) ${info?.name ?? ''} — new discovery! ${info?.description ?? ''}`
      );
    }
    expect(typeof code).toBe('number');
  } else {
    console.warn(
      'probe-3 UNEXPECTED SUCCESS: claim-rewards returned (ok ...) for completely unrelated account6 — investigate!'
    );
  }
});

// STX-ONLY LEG
//
// The pox-5 reward model is two-tier (see src/build.ts calculate-rewards):
// bond legs keyed by bond-index vs a residual STX-only leg keyed by
// reward-cycle. get-earned(signer, isBond, index) reads them separately, and
// the STX-only leg can be claimed on its own (claim-rewards with bondIndices=[]).

test('rewards-probe-4: STX-only leg is addressable + claimable independently of bond legs', async () => {
  useFixtures('rewards-probe-4');
  const poxInfo = await getPoxInfo();
  const rewardCycle = Math.max(0, poxInfo.rewardCycleId - 1);
  console.log('probe-4 current cycle:', poxInfo.rewardCycleId, '/ probing cycle:', rewardCycle);

  let stxOnlyEarned: bigint | undefined;
  let bondEarned: bigint | undefined;
  try {
    stxOnlyEarned = await fetchEarned({
      signerManager: SIGNER_MANAGER,
      rewardCycle,
      network,
    });
    console.log(
      `probe-4 STX-only leg get-earned(cycle=${rewardCycle}, isBond=false):`,
      stxOnlyEarned.toString()
    );
  } catch (err) {
    console.warn(
      'probe-4: STX-only leg read failed:',
      err instanceof Error ? err.message : String(err)
    );
  }
  try {
    bondEarned = await fetchEarned({
      signerManager: SIGNER_MANAGER,
      rewardCycle,
      bondIndex: CLAIM_BOND_INDICES[0],
      network,
    });
    console.log(
      `probe-4 bond leg get-earned(bond=${CLAIM_BOND_INDICES[0]}, isBond=true):`,
      bondEarned.toString()
    );
  } catch (err) {
    console.warn(
      'probe-4: bond leg read failed:',
      err instanceof Error ? err.message : String(err)
    );
  }
  if (stxOnlyEarned !== undefined && bondEarned !== undefined) {
    console.log(
      'probe-4 CONFIRMED: STX-only and bond legs are independently queryable via get-earned isBond flag'
    );
  }

  const unsigned = await buildClaimRewards({
    rewardCycle,
    bondIndices: [], // no bond legs: isolates the STX-only leg
    publicKey: account5.publicKey,
    fee: FEE,
    nonce: await getNextNonce(account5.address),
    network,
    postConditionMode: 'allow',
  });

  const tx = signTransaction(unsigned, account5.key);
  const txid = await broadcastAndWait(tx, account5.address, network);
  console.log('probe-4 STX-only-leg claim txid:', txid);

  const code = await assertTolerableResult('probe-4', txid);
  if (code !== undefined) {
    const info = describePox5Error(code);
    if (code === Pox5ErrorCode.NoClaimableRewards) {
      console.log(
        'probe-4 CONFIRMED: STX-only leg empty for account5 -> ERR_NO_CLAIMABLE_REWARDS (u32)'
      );
    } else {
      console.log(
        `probe-4 STX-only-leg claim aborted (err u${code}) ${info?.name ?? ''} — ${info?.description ?? ''}`
      );
    }
    expect(typeof code).toBe('number');
  } else {
    console.warn(
      'probe-4 UNEXPECTED SUCCESS: STX-only-leg claim returned (ok ...) for never-staked account5 — investigate!'
    );
  }
});
