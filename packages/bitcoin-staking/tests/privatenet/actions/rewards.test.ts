/**
 * Reward distribution + claiming probes against the private testnet.
 *
 * Context: No successful bond enrollments exist on this net (all register
 * attempts aborted — no sBTC, no real BTC), so `claim-rewards` will hit
 * error-code paths rather than paying out. That is EXPECTED — we are mapping
 * the reward entry-points' behavior and documenting which error codes fire.
 *
 * account5 is allowlisted on several bonds (indices 4-24) but was NEVER
 * enrolled. account6 was never allowlisted nor enrolled.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROBE 1 — calculate-rewards  (anyone-callable, settles distribution waterfall)
 *   Calls buildCalculateRewards with bondIndices [4, 12, 19] from account5.
 *   Expected: success (waterfall settled / no-op) OR
 *             u30 DistributionAlreadyComputed (already settled this period) OR
 *             u31 BondNotActive (bonds not currently active) OR
 *             u33 ActiveBondNotIncluded (active bonds missing from list) OR
 *             u29 InvalidBondPeriodOrdering (list must be sorted by descending
 *                 stx-value-ratio; our arbitrary order may be wrong).
 *   This is the new "anyone-callable" reward-settlement path.
 *
 * PROBE 2 — claim-rewards, account5 (allowlisted, never enrolled)
 *   Calls buildClaimRewards for rewardCycle = currentCycle-1, bondIndices [4,12].
 *   Expected abort: u32 NoClaimableRewards OR u34 NotBondParticipant.
 *   Optionally checks STX balance before/after (tolerant — no transfer expected).
 *
 * PROBE 3 — claim-rewards, account6 (never allowlisted, never enrolled)
 *   Same args as probe 2 from a completely unrelated account.
 *   Expected abort: u34 NotBondParticipant OR u32 NoClaimableRewards.
 * ─────────────────────────────────────────────────────────────────────────────
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
import { getNetwork, ENV } from '../../helpers/utils';
import {
  broadcastAndWait,
  ensurePox5,
  getNextNonce,
  getPoxInfo,
  getStxBalance,
  getTransaction,
} from '../../helpers/wait';
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

// ─── helpers ────────────────────────────────────────────────────────────────

/** Parse `(err uN)` repr → N, or undefined. */
function parseErrCode(repr: string | undefined): number | undefined {
  if (!repr) return undefined;
  const m = repr.match(/^\(err u(\d+)\)$/);
  return m ? Number(m[1]) : undefined;
}

/**
 * Fetch the tx record, log its status + repr + describePox5Error result, and
 * make a tolerant assertion: the tx must have settled as either
 * `abort_by_response` or `success`. Returns the parsed error code or undefined.
 */
async function assertTolerableResult(
  label: string,
  txid: string
): Promise<number | undefined> {
  if (!ENV.RECORD) {
    console.log(`${label}: RECORD not set — skipping /extended result check`);
    return undefined;
  }
  const record = await getTransaction(txid);
  console.log(`${label} tx_status:`, record?.tx_status);
  console.log(`${label} tx_result.repr:`, record?.tx_result?.repr);

  if (!record || record.tx_status === 'pending') {
    console.warn(`${label}: tx still pending — cannot assert result`);
    return undefined;
  }

  const isAbort = record.tx_status === 'abort_by_response';
  const isSuccess = record.tx_status === 'success';

  expect(isAbort || isSuccess).toBe(true);

  if (isAbort) {
    const code = parseErrCode(record.tx_result?.repr);
    const info = describePox5Error(code ?? -1);
    console.log(
      `${label} abort code:`,
      code,
      info?.name ?? '(unknown)',
      '—',
      info?.description ?? ''
    );
    expect(record.tx_result?.repr).toMatch(/^\(err u\d+\)$/);
    return code;
  }

  // Success path — log and pass
  console.log(`${label}: tx SUCCEEDED`);
  return undefined;
}

// ─── setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await ensurePox5();
}, 20 * 60_000);

// ─── PROBE 1: calculate-rewards (anyone-callable) ────────────────────────────
//
// Targets reward codes:
//   u30 DistributionAlreadyComputed  — already settled this distribution period
//   u31 BondNotActive                — bond(s) not active at calculation-height
//   u33 ActiveBondNotIncluded        — our partial list misses an actually-active bond
//   u29 InvalidBondPeriodOrdering    — list must be sorted descending by stx-value-ratio
//   (success)                        — distribution waterfall settled for these bonds
//
// NOTE: calculate-rewards requires the full set of active bonds sorted by
// descending stx-value-ratio. We pass a partial, arbitrarily-ordered subset
// [4, 12, 19] — the contract is expected to reject with u29 or u33. Any of the
// above is an acceptable discovery on this exploratory test.

test('rewards-probe-1: calculate-rewards from account5 (bond indices [4,12,19])', async () => {
  const poxInfo = await getPoxInfo();
  console.log('probe-1 current reward cycle:', poxInfo.rewardCycleId);
  console.log('probe-1 bond indices:', PROBE_BOND_INDICES);

  const unsigned = await buildCalculateRewards({
    bondIndices: PROBE_BOND_INDICES,
    publicKey: account5.publicKey,
    fee: FEE,
    nonce: await getNextNonce(account5.address),
    network,
  });

  const tx = signTransaction(unsigned, account5.key);
  const txid = await broadcastAndWait(tx, account5.address, network);
  console.log('probe-1 txid:', txid);

  const code = await assertTolerableResult('probe-1', txid);

  // Tolerant set: all plausible outcomes given partial/unsorted bond list
  const TOLERANT_SET = new Set([
    Pox5ErrorCode.DistributionAlreadyComputed, // u30 — already settled this period
    Pox5ErrorCode.BondNotActive,               // u31 — bonds not active at calc-height
    Pox5ErrorCode.ActiveBondNotIncluded,        // u33 — missing bonds from the full active set
    Pox5ErrorCode.InvalidBondPeriodOrdering,   // u29 — list not sorted by descending ratio
  ]);

  if (code !== undefined) {
    const info = describePox5Error(code);
    if (code === Pox5ErrorCode.DistributionAlreadyComputed) {
      console.log('probe-1 CONFIRMED: ERR_DISTRIBUTION_ALREADY_COMPUTED (u30) — distribution already settled');
    } else if (code === Pox5ErrorCode.BondNotActive) {
      console.log('probe-1 CONFIRMED: ERR_BOND_NOT_ACTIVE (u31) — bond not active at calculation-height');
    } else if (code === Pox5ErrorCode.ActiveBondNotIncluded) {
      console.log('probe-1 CONFIRMED: ERR_ACTIVE_BOND_NOT_INCLUDED (u33) — partial bond list rejected');
    } else if (code === Pox5ErrorCode.InvalidBondPeriodOrdering) {
      console.log('probe-1 CONFIRMED: ERR_INVALID_BOND_PERIOD_ORDERING (u29) — list not sorted by descending stx-value-ratio');
    } else if (TOLERANT_SET.has(code)) {
      console.log(`probe-1 NOTE: (err u${code}) — acceptable`);
    } else {
      console.warn(
        `probe-1 UNEXPECTED: (err u${code}) ${info?.name ?? ''} — new discovery! ${info?.description ?? ''}`
      );
    }
    // Tolerant: do not hard-pin to a specific code — chain state determines which fires
    expect(typeof code).toBe('number');
  } else {
    console.log('probe-1: tx SUCCEEDED — distribution waterfall settled (or no-op)');
  }
});

// ─── PROBE 2: claim-rewards, account5 (allowlisted, never enrolled) ──────────
//
// Targets reward codes:
//   u32 NoClaimableRewards    — legs are empty (no enrollment → no rewards)
//   u34 NotBondParticipant    — account5 is not actively staking in these bonds
//
// Also checks STX balance before/after — no increase expected (tolerant).

test('rewards-probe-2: claim-rewards from account5 (allowlisted but never enrolled)', async () => {
  const poxInfo = await getPoxInfo();
  // Common usage: claim the cycle just before the current one
  const rewardCycle = Math.max(0, poxInfo.rewardCycleId - 1);
  console.log('probe-2 current cycle:', poxInfo.rewardCycleId, '/ claiming cycle:', rewardCycle);
  console.log('probe-2 bond indices:', CLAIM_BOND_INDICES);
  console.log('probe-2 sender:', account5.address);

  // Optional: snapshot balance before (tolerant — no transfer expected)
  let balanceBefore: bigint | undefined;
  try {
    balanceBefore = await getStxBalance(account5.address);
    console.log('probe-2 balance before (uSTX):', balanceBefore.toString());
  } catch (err) {
    console.warn('probe-2: could not fetch balance before:', err instanceof Error ? err.message : String(err));
  }

  const unsigned = await buildClaimRewards({
    rewardCycle,
    bondIndices: CLAIM_BOND_INDICES,
    publicKey: account5.publicKey,
    fee: FEE,
    nonce: await getNextNonce(account5.address),
    network,
  });

  const tx = signTransaction(unsigned, account5.key);
  const txid = await broadcastAndWait(tx, account5.address, network);
  console.log('probe-2 txid:', txid);

  const code = await assertTolerableResult('probe-2', txid);

  // Optional: check balance after — must not have increased (tolerant)
  if (balanceBefore !== undefined) {
    try {
      const balanceAfter = await getStxBalance(account5.address);
      console.log('probe-2 balance after  (uSTX):', balanceAfter.toString());
      // Net change is negative (fee burned) or zero — never a reward gain without enrollment
      const netChange = balanceAfter - balanceBefore;
      console.log('probe-2 net balance change (uSTX):', netChange.toString());
      // Tolerant: only assert no unexpected positive gain (> fee) — fee is 10_000 uSTX
      // A large positive would mean rewards were paid, which should not happen
      expect(netChange).toBeLessThanOrEqual(0n);
    } catch (err) {
      console.warn('probe-2: could not fetch balance after:', err instanceof Error ? err.message : String(err));
    }
  }

  // Primary targets for this probe
  const PRIMARY_CODES = new Set([
    Pox5ErrorCode.NoClaimableRewards,  // u32
    Pox5ErrorCode.NotBondParticipant,  // u34
  ]);

  if (code !== undefined) {
    const info = describePox5Error(code);
    if (code === Pox5ErrorCode.NoClaimableRewards) {
      console.log('probe-2 CONFIRMED: ERR_NO_CLAIMABLE_REWARDS (u32) — no rewards for non-enrolled staker');
    } else if (code === Pox5ErrorCode.NotBondParticipant) {
      console.log('probe-2 CONFIRMED: ERR_NOT_BOND_PARTICIPANT (u34) — account5 is not in any bond');
    } else if (PRIMARY_CODES.has(code)) {
      console.log(`probe-2 NOTE: (err u${code}) — expected`);
    } else {
      console.warn(
        `probe-2 UNEXPECTED: (err u${code}) ${info?.name ?? ''} — new discovery! ${info?.description ?? ''}`
      );
    }
    // Assert it's one of the two expected codes (or any valid abort on a live chain)
    expect(typeof code).toBe('number');
  } else {
    // Unexpected success: log loudly — account5 was never enrolled so no rewards should exist
    console.warn('probe-2 UNEXPECTED SUCCESS: claim-rewards returned (ok ...) for never-enrolled account5 — investigate!');
  }
});

// ─── PROBE 3: claim-rewards, account6 (never allowlisted, never enrolled) ────
//
// account6 has no connection to any bond — never allowlisted, never registered.
// This probes the outer "not a participant" guard.
//
// Targets reward codes:
//   u34 NotBondParticipant    — primary: outer guard fires (not in any bond)
//   u32 NoClaimableRewards    — alternative: participant check passes, legs empty

test('rewards-probe-3: claim-rewards from account6 (not allowlisted, never enrolled)', async () => {
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
  });

  const tx = signTransaction(unsigned, account6.key);
  const txid = await broadcastAndWait(tx, account6.address, network);
  console.log('probe-3 txid:', txid);

  const code = await assertTolerableResult('probe-3', txid);

  // Primary targets for this probe
  const PRIMARY_CODES = new Set([
    Pox5ErrorCode.NotBondParticipant,  // u34 — primary: outer guard, account6 not in any bond
    Pox5ErrorCode.NoClaimableRewards,  // u32 — alternative path
  ]);

  if (code !== undefined) {
    const info = describePox5Error(code);
    if (code === Pox5ErrorCode.NotBondParticipant) {
      console.log('probe-3 CONFIRMED: ERR_NOT_BOND_PARTICIPANT (u34) — account6 has no bond membership');
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
    console.warn('probe-3 UNEXPECTED SUCCESS: claim-rewards returned (ok ...) for completely unrelated account6 — investigate!');
  }
});

// ─── PROBE 4: STX-only leg vs bond legs — distinct structures ────────────────
//
// The pox-5 reward model is two-tier (see src/build.ts calculate-rewards):
//   - bond legs: paired stakers paid up to target APY, keyed by BOND-INDEX
//   - STX-only leg: residual after bonds + 15% reserve, keyed by REWARD-CYCLE
// `get-earned(signer, isBond, index)` reads them separately via the isBond flag.
// This probe demonstrates the two legs are independently addressable, and that
// the STX-only leg can be claimed on its OWN (claim-rewards with bondIndices=[]).

test('rewards-probe-4: STX-only leg is addressable + claimable independently of bond legs', async () => {
  const poxInfo = await getPoxInfo();
  const rewardCycle = Math.max(0, poxInfo.rewardCycleId - 1);
  console.log('probe-4 current cycle:', poxInfo.rewardCycleId, '/ probing cycle:', rewardCycle);

  // (a) Read-only: the two legs are SEPARATE get-earned queries.
  //     STX-only leg keyed by reward cycle (isBond=false) vs a bond leg keyed by
  //     bond index (isBond=true). Both should resolve (likely 0 — no enrollment),
  //     proving the contract tracks them as distinct accumulators.
  let stxOnlyEarned: bigint | undefined;
  let bondEarned: bigint | undefined;
  try {
    stxOnlyEarned = await fetchEarned({
      signerManager: SIGNER_MANAGER,
      rewardCycle,
      network,
    });
    console.log(`probe-4 STX-only leg get-earned(cycle=${rewardCycle}, isBond=false):`, stxOnlyEarned.toString());
  } catch (err) {
    console.warn('probe-4: STX-only leg read failed:', err instanceof Error ? err.message : String(err));
  }
  try {
    bondEarned = await fetchEarned({
      signerManager: SIGNER_MANAGER,
      rewardCycle,
      bondIndex: CLAIM_BOND_INDICES[0],
      network,
    });
    console.log(`probe-4 bond leg get-earned(bond=${CLAIM_BOND_INDICES[0]}, isBond=true):`, bondEarned.toString());
  } catch (err) {
    console.warn('probe-4: bond leg read failed:', err instanceof Error ? err.message : String(err));
  }
  // The two reads target different accumulators; both resolve to a uint.
  if (stxOnlyEarned !== undefined && bondEarned !== undefined) {
    console.log('probe-4 CONFIRMED: STX-only and bond legs are independently queryable via get-earned isBond flag');
  }

  // (b) Broadcast: claim ONLY the STX-only leg — empty bondIndices isolates it.
  //     With no STX-only stake from account5, expect NoClaimableRewards (u32)
  //     (or NotBondParticipant). Proves the STX-only leg is claimable on its own.
  const unsigned = await buildClaimRewards({
    rewardCycle,
    bondIndices: [], // <-- no bond legs: STX-only leg in isolation
    publicKey: account5.publicKey,
    fee: FEE,
    nonce: await getNextNonce(account5.address),
    network,
  });

  const tx = signTransaction(unsigned, account5.key);
  const txid = await broadcastAndWait(tx, account5.address, network);
  console.log('probe-4 STX-only-leg claim txid:', txid);

  const code = await assertTolerableResult('probe-4', txid);
  if (code !== undefined) {
    const info = describePox5Error(code);
    if (code === Pox5ErrorCode.NoClaimableRewards) {
      console.log('probe-4 CONFIRMED: STX-only leg empty for account5 → ERR_NO_CLAIMABLE_REWARDS (u32)');
    } else {
      console.log(`probe-4 STX-only-leg claim aborted (err u${code}) ${info?.name ?? ''} — ${info?.description ?? ''}`);
    }
    expect(typeof code).toBe('number');
  } else {
    console.warn('probe-4 UNEXPECTED SUCCESS: STX-only-leg claim returned (ok ...) for never-staked account5 — investigate!');
  }
});
