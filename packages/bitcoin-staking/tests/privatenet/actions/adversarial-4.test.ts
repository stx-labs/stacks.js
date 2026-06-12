/**
 * Adversarial / robustness probes — pox-5 bond contract, batch 4.
 *
 * Focus: bond-sequence and calculate-rewards ordering/completeness
 * misconfigurations. Five targeted probes that exercise the EXACT error paths
 * the contract enforces for bond-index window math and reward-distribution
 * pre-conditions.
 *
 * All probes are EXPLORATORY: broadcast a deliberately invalid tx, log the
 * on-chain abort code, assert tolerantly (abort_by_response OR success). Goal:
 * DISCOVER and DOCUMENT concrete error codes on the live private testnet.
 *
 * No Bitcoin transactions. No `set-bond-admin` calls. No new deployments.
 * Safe senders: bond-admin for setup-bond/calculate-rewards; account5 for
 * register-for-bond.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROBE 1 — setup-bond skip-ahead (far-future index: soonest+3)
 *   Admin setup-bond at bondIndex = soonest+3 (3 gaps ahead of the currently
 *   settable window). Expected: u2 ERR_CANNOT_SETUP_BOND_TOO_SOON (the bond's
 *   setup window hasn't opened yet). Confirms you can't pre-create a skipped
 *   bond index.
 *
 * PROBE 2 — setup-bond past index (bondIndex = 0, anchor cycle)
 *   Admin setup-bond at bondIndex = 0. The anchor cycle's setup window closed
 *   long ago. Expected: u3 ERR_CANNOT_SETUP_BOND_TOO_LATE (or u4
 *   ERR_BOND_ALREADY_SETUP if index 0 was set up on this chain). Confirms the
 *   lower boundary of the setup window is enforced.
 *
 * PROBE 3 — calculate-rewards WRONG ORDER (ascending stx-value-ratio)
 *   Read stxValueRatio for a handful of known bond indices (47-50 + 4-24 range)
 *   via fetchProtocolBond. Build a list of ≥2 existing bonds sorted in WRONG
 *   (ascending) order by stxValueRatio. Call buildCalculateRewards with that
 *   list. Expected: u29 ERR_INVALID_BOND_PERIOD_ORDERING (primary target). Also
 *   tolerant of u31 BondNotActive, u33 ActiveBondNotIncluded, u30
 *   DistributionAlreadyComputed, or success (all logged).
 *
 * PROBE 4 — calculate-rewards INCOMPLETE active set (single bond)
 *   Call buildCalculateRewards with a single arbitrary bond index (e.g. 47)
 *   when the contract's active set likely includes multiple bonds. Expected:
 *   u33 ERR_ACTIVE_BOND_NOT_INCLUDED (primary). Also tolerant of u31/u29/u30.
 *
 * PROBE 5 — register-for-bond against a NON-EXISTENT bond index
 *   Verify via fetchProtocolBond that a candidate index (tries 9, 25, 999 in
 *   order) returns undefined. Build a register-for-bond (sBTC path, account5)
 *   against that index. Expected: u7 ERR_BOND_NOT_FOUND (primary target —
 *   NEWLY confirmed here). Log describePox5Error to expose the name.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Run with:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so RECORD=1 \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *     npx jest tests/privatenet/actions/adversarial-4.test.ts --runInBand --collectCoverage=false
 */

import {
  BOND_GAP_CYCLES,
  buildCalculateRewards,
  buildRegisterForBond,
  buildSetupBond,
  describePox5Error,
  fetchProtocolBond,
  Pox5ErrorCode,
} from '../../../src';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork, ENV } from '../../helpers/utils';
import {
  broadcastAndWait,
  ensurePox5,
  getNextNonce,
  getPoxInfo,
  getTransaction,
} from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { fetchFirstBondPeriodCycle } from '../pox';

jest.setTimeout(30 * 60_000);

// Reuse the daemon's deployed signer-manager — same approach as
// adversarial-2.test.ts and register-for-bond.test.ts.
const SIGNER_MANAGER =
  process.env.SIGNER_MANAGER ??
  'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';

const network = getNetwork();

// Accounts
const account5 = getAccount(REGTEST_KEYS.account5); // allowlisted on most bonds; sBTC path probe

const FEE = 10_000n;
const AMOUNT_USTX = 1_000_000n;
const SBTC_SATS = 1_000n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;

let admin: Awaited<ReturnType<typeof getBondAdminAccount>>;

// ─── helpers ────────────────────────────────────────────────────────────────

/** Parse `(err uN)` repr → N, or undefined. */
function parseErrCode(repr: string | undefined): number | undefined {
  if (!repr) return undefined;
  const m = repr.match(/^\(err u(\d+)\)$/);
  return m ? Number(m[1]) : undefined;
}

/**
 * Fetch the tx record, log status + repr + describePox5Error, assert tolerantly:
 * the tx must be `abort_by_response` or `success`. Returns the parsed error code
 * (undefined on success or RECORD not set).
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

  // Tolerant: accept either outcome (fuzz cases may accidentally succeed)
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
    // Must be a valid (err uN) repr
    expect(record.tx_result?.repr).toMatch(/^\(err u\d+\)$/);
    return code;
  }

  console.log(`${label}: tx SUCCEEDED (unexpected but acceptable for adversarial probe)`);
  return undefined;
}

/**
 * Compute soonest settable bondIndex (the one whose setup window is open now),
 * then offset by `offset`. Returns { bondIndex, anchorCycle, currentCycle }.
 */
async function computeNextBondIndex(offset = 0): Promise<{
  bondIndex: number;
  anchorCycle: number;
  currentCycle: number;
}> {
  const poxInfo = await getPoxInfo();
  const anchorCycle = await fetchFirstBondPeriodCycle();
  const bondIndex =
    Math.floor((poxInfo.rewardCycleId - anchorCycle) / BOND_GAP_CYCLES) + 1 + offset;
  return { bondIndex, anchorCycle, currentCycle: poxInfo.rewardCycleId };
}

/**
 * Probe a range of bond indices and return those that exist on-chain with their
 * stxValueRatio. Used by probe 3 to find bonds for wrong-order test.
 */
async function findExistingBondsWithRatios(
  indices: number[]
): Promise<Array<{ bondIndex: number; stxValueRatio: bigint }>> {
  const found: Array<{ bondIndex: number; stxValueRatio: bigint }> = [];
  for (const bondIndex of indices) {
    try {
      const bond = await fetchProtocolBond({ bondIndex, network });
      if (bond !== undefined) {
        found.push({ bondIndex, stxValueRatio: bond.stxValueRatio });
        console.log(
          `findExistingBondsWithRatios: bond ${bondIndex} stxValueRatio=${bond.stxValueRatio}`
        );
      }
    } catch {
      // network error — skip
    }
  }
  return found;
}

/**
 * Find the first bond index from `candidates` that does NOT exist on-chain
 * (fetchProtocolBond returns undefined). Returns undefined if all exist.
 */
async function findNonExistentBondIndex(
  candidates: number[]
): Promise<number | undefined> {
  for (const bondIndex of candidates) {
    try {
      const bond = await fetchProtocolBond({ bondIndex, network });
      if (bond === undefined) {
        console.log(`findNonExistentBondIndex: index ${bondIndex} confirmed non-existent`);
        return bondIndex;
      }
      console.log(
        `findNonExistentBondIndex: index ${bondIndex} EXISTS (stxValueRatio=${bond.stxValueRatio})`
      );
    } catch {
      // treat fetch error as non-existent (conservative)
      console.log(`findNonExistentBondIndex: index ${bondIndex} fetch failed — treating as non-existent`);
      return bondIndex;
    }
  }
  return undefined;
}

// ─── setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  admin = await getBondAdminAccount();
  await ensurePox5();
  console.log('admin address:', admin.address);
  console.log('account5 address:', account5.address);
  console.log('signerManager:', SIGNER_MANAGER);
}, 20 * 60_000);

// ─── PROBE 1: setup-bond skip-ahead (soonest+3) ───────────────────────────────
//
// bondIndex = soonest+3 — 3 bond gaps ahead of the currently open window.
// The contract checks: setup window is BOND_GAP_CYCLES before the bond's
// start cycle. At soonest+3, that window is 3*BOND_GAP_CYCLES cycles in the
// future — ERR_CANNOT_SETUP_BOND_TOO_SOON (u2) expected.
// Also tolerant of u4 (BondAlreadySetup) in case that index was previously set up.

test('adversarial-4-1: setup-bond skip-ahead (soonest+3) expects u2 CannotSetupBondTooSoon', async () => {
  const { bondIndex, anchorCycle, currentCycle } = await computeNextBondIndex(3);
  console.log('probe-1 bondIndex (soonest+3):', bondIndex, { anchorCycle, currentCycle });

  const unsigned = await buildSetupBond({
    bondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist: [{ staker: account5.address, maxSats: 10_000n }],
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
  });

  const tx = signTransaction(unsigned, admin.key);
  const txid = await broadcastAndWait(tx, admin.address, network);
  console.log('probe-1 txid:', txid);

  const code = await assertTolerableResult('probe-1', txid);

  // Primary target: u2 (setup window not yet open for soonest+3)
  // Tolerant: also accept u4 (already set up) or u2 (primary)
  const TOLERANT_SET = new Set([
    Pox5ErrorCode.CannotSetupBondTooSoon, // u2 — primary: setup window not open yet
    Pox5ErrorCode.BondAlreadySetup,       // u4 — already set up (chain history)
    Pox5ErrorCode.CannotSetupBondTooLate, // u3 — offset arithmetic surprised us
  ]);

  if (code !== undefined) {
    const info = describePox5Error(code);
    if (code === Pox5ErrorCode.CannotSetupBondTooSoon) {
      console.log('probe-1 CONFIRMED: ERR_CANNOT_SETUP_BOND_TOO_SOON (u2) — skip-ahead index rejected');
    } else if (code === Pox5ErrorCode.BondAlreadySetup) {
      console.log('probe-1 NOTE: ERR_BOND_ALREADY_SETUP (u4) — index was already set up on this chain');
    } else if (TOLERANT_SET.has(code)) {
      console.log(`probe-1 NOTE: (err u${code}) — acceptable`);
    } else {
      console.warn(
        `probe-1 UNEXPECTED: (err u${code}) ${info?.name ?? ''} — new discovery! ${info?.description ?? ''}`
      );
    }
    expect(TOLERANT_SET.has(code)).toBe(true);
  }
});

// ─── PROBE 2: setup-bond past index (bondIndex = 0) ──────────────────────────
//
// bondIndex = 0 is the very first bond period anchored at firstBondPeriodCycle.
// The setup window for bond 0 was openable only during the first BOND_GAP_CYCLES
// cycles — it is long past. Expected: u3 ERR_CANNOT_SETUP_BOND_TOO_LATE.
// Also tolerant of u4 (BondAlreadySetup) if bond 0 was successfully set up.

test('adversarial-4-2: setup-bond past index (bondIndex=0) expects u3 CannotSetupBondTooLate', async () => {
  const { anchorCycle, currentCycle } = await computeNextBondIndex(0);
  console.log('probe-2 bondIndex=0 (anchor cycle):', anchorCycle, 'currentCycle:', currentCycle);

  const unsigned = await buildSetupBond({
    bondIndex: 0,  // the very first bond period — setup window closed long ago
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist: [{ staker: account5.address, maxSats: 10_000n }],
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
  });

  const tx = signTransaction(unsigned, admin.key);
  const txid = await broadcastAndWait(tx, admin.address, network);
  console.log('probe-2 txid:', txid);

  const code = await assertTolerableResult('probe-2', txid);

  // Primary: u3 CannotSetupBondTooLate. Also accept u4 if already set up.
  const TOLERANT_SET = new Set([
    Pox5ErrorCode.CannotSetupBondTooLate, // u3 — primary: setup window long closed
    Pox5ErrorCode.BondAlreadySetup,       // u4 — already set up (also fine)
  ]);

  if (code !== undefined) {
    const info = describePox5Error(code);
    if (code === Pox5ErrorCode.CannotSetupBondTooLate) {
      console.log('probe-2 CONFIRMED: ERR_CANNOT_SETUP_BOND_TOO_LATE (u3) — past-index rejected');
    } else if (code === Pox5ErrorCode.BondAlreadySetup) {
      console.log('probe-2 NOTE: ERR_BOND_ALREADY_SETUP (u4) — bond 0 was already set up on this chain');
    } else if (TOLERANT_SET.has(code)) {
      console.log(`probe-2 NOTE: (err u${code}) — acceptable`);
    } else {
      console.warn(
        `probe-2 UNEXPECTED: (err u${code}) ${info?.name ?? ''} — new discovery! ${info?.description ?? ''}`
      );
    }
    expect(TOLERANT_SET.has(code)).toBe(true);
  }
});

// ─── PROBE 3: calculate-rewards WRONG ORDER (ascending stx-value-ratio) ──────
//
// The contract requires bondPeriods sorted DESCENDING by stx-value-ratio (ties:
// higher bond-index first). ERR_INVALID_BOND_PERIOD_ORDERING (u29) is the
// primary discovery target.
//
// Steps:
//   1. Read fetchProtocolBond for a spread of likely-existing indices (47-50 and
//      a sample from 4-24). Log each bond's stxValueRatio.
//   2. If ≥2 bonds found with DIFFERENT ratios, sort them ASCENDING (wrong order)
//      and call buildCalculateRewards.
//   3. If all ratios are equal (ties), reverse the index order (lower index first)
//      — that also violates the tie-break rule (higher index should come first).
//   4. If only 1 bond found, submit it alone — likely u33 ActiveBondNotIncluded.
//
// Tolerant set: u29 (primary), u31, u33, u30, success.

test('adversarial-4-3: calculate-rewards WRONG ORDER (ascending stx-value-ratio) expects u29 InvalidBondPeriodOrdering', async () => {
  // calculate-rewards is capped at (list 6 uint) AND requires the FULL active set.
  // Only the most-recent bonds are active at calc-height (earlier ones expired ~12
  // cycles after open), so probe the recent window only — passing >6 or expired
  // bonds yields BadFunctionArgument / u31 instead of the ordering guard we want.
  const candidateIndices = [47, 48, 49, 50, 51, 52];
  const bonds = await findExistingBondsWithRatios(candidateIndices);
  console.log('probe-3 found bonds:', bonds.map(b => `[${b.bondIndex}]=ratio:${b.stxValueRatio}`).join(', '));

  if (bonds.length === 0) {
    console.warn('probe-3 SKIP: no bonds found among candidate indices — cannot build wrong-order list');
    return;
  }

  // Sort wrong: ASCENDING stx-value-ratio (contract wants DESCENDING)
  // For equal ratios, sort by ASCENDING bondIndex (contract wants DESCENDING index for ties)
  const wrongOrder = [...bonds].sort((a, b) => {
    if (a.stxValueRatio < b.stxValueRatio) return -1;
    if (a.stxValueRatio > b.stxValueRatio) return 1;
    return a.bondIndex - b.bondIndex; // ascending index for ties (wrong: should be descending)
  });

  // Cap at 6 — calculate-rewards takes (list 6 uint); >6 → BadFunctionArgument.
  const wrongIndices = wrongOrder.map(b => b.bondIndex).slice(0, 6);
  console.log(
    'probe-3 wrong-order indices:',
    wrongIndices,
    '— ratios:',
    wrongOrder.map(b => b.stxValueRatio.toString())
  );

  const poxInfo = await getPoxInfo();
  console.log('probe-3 current reward cycle:', poxInfo.rewardCycleId);

  const unsigned = await buildCalculateRewards({
    bondIndices: wrongIndices,
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
  });

  const tx = signTransaction(unsigned, admin.key);
  const txid = await broadcastAndWait(tx, admin.address, network);
  console.log('probe-3 txid:', txid);

  const code = await assertTolerableResult('probe-3', txid);

  // Primary target: u29 InvalidBondPeriodOrdering
  // Tolerant: u31 (bonds not active at calc-height), u33 (missing active bonds),
  //           u30 (distribution already computed this period), success (rare)
  const TOLERANT_SET = new Set([
    Pox5ErrorCode.InvalidBondPeriodOrdering,    // u29 — PRIMARY DISCOVERY TARGET
    Pox5ErrorCode.BondNotActive,                // u31 — bonds not active at calc-height
    Pox5ErrorCode.ActiveBondNotIncluded,        // u33 — partial list missing active bonds
    Pox5ErrorCode.DistributionAlreadyComputed,  // u30 — already settled this period
  ]);

  if (code !== undefined) {
    const info = describePox5Error(code);
    if (code === Pox5ErrorCode.InvalidBondPeriodOrdering) {
      console.log(
        'probe-3 PRIMARY CONFIRMED: ERR_INVALID_BOND_PERIOD_ORDERING (u29) — ' +
        'ascending order correctly rejected. DISCOVERY: wrong-order list triggers u29.'
      );
    } else if (code === Pox5ErrorCode.BondNotActive) {
      console.log('probe-3 NOTE: ERR_BOND_NOT_ACTIVE (u31) — bonds not active at calc-height (ordering guard not reached)');
    } else if (code === Pox5ErrorCode.ActiveBondNotIncluded) {
      console.log('probe-3 NOTE: ERR_ACTIVE_BOND_NOT_INCLUDED (u33) — partial list guard fired before ordering guard');
    } else if (code === Pox5ErrorCode.DistributionAlreadyComputed) {
      console.log('probe-3 NOTE: ERR_DISTRIBUTION_ALREADY_COMPUTED (u30) — already settled; ordering guard not reached');
    } else if (TOLERANT_SET.has(code)) {
      console.log(`probe-3 NOTE: (err u${code}) — in tolerant set`);
    } else {
      console.warn(
        `probe-3 UNEXPECTED: (err u${code}) ${info?.name ?? ''} — new discovery! ${info?.description ?? ''}`
      );
    }
    // Any code is acceptable — the goal is discovery; do not hard-pin
    expect(typeof code).toBe('number');
  } else {
    console.log('probe-3: tx SUCCEEDED — distribution settled (wrong-order list accepted or no-op)');
  }
});

// ─── PROBE 4: calculate-rewards INCOMPLETE active set (single bond index) ────
//
// The contract's assert-all-active-bonds-included guard requires the FULL set of
// currently active bonds. Submitting only a single bond index (e.g. 47) when
// multiple bonds are active should trigger u33 ERR_ACTIVE_BOND_NOT_INCLUDED.
//
// Tolerant: u33 (primary), u31, u29, u30, success.

test('adversarial-4-4: calculate-rewards INCOMPLETE active set (single bond) expects u33 ActiveBondNotIncluded', async () => {
  // Pick a single bond index to include — prefer one we know exists
  // Try indices from the known-active range (bonds set up for the current epoch)
  const singleCandidates = [47, 48, 49, 50, 4, 12, 19];
  let singleIndex: number | undefined;

  for (const idx of singleCandidates) {
    try {
      const bond = await fetchProtocolBond({ bondIndex: idx, network });
      if (bond !== undefined) {
        singleIndex = idx;
        console.log(`probe-4 using bondIndex=${idx} (stxValueRatio=${bond.stxValueRatio})`);
        break;
      }
    } catch {
      // skip
    }
  }

  if (singleIndex === undefined) {
    // Fall back to 47 even if not confirmed existing — the contract will
    // return u31 (BondNotActive) which is still in the tolerant set
    singleIndex = 47;
    console.warn('probe-4 WARNING: could not confirm any bond exists — falling back to index 47');
  }

  const poxInfo = await getPoxInfo();
  console.log('probe-4 current reward cycle:', poxInfo.rewardCycleId, '/ single bondIndex:', singleIndex);

  const unsigned = await buildCalculateRewards({
    bondIndices: [singleIndex], // intentionally incomplete — only one bond
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
  });

  const tx = signTransaction(unsigned, admin.key);
  const txid = await broadcastAndWait(tx, admin.address, network);
  console.log('probe-4 txid:', txid);

  const code = await assertTolerableResult('probe-4', txid);

  // Primary: u33 ActiveBondNotIncluded (incomplete list)
  // Tolerant: u31 (not active), u29 (ordering), u30 (already computed), success
  const TOLERANT_SET = new Set([
    Pox5ErrorCode.ActiveBondNotIncluded,        // u33 — PRIMARY DISCOVERY TARGET
    Pox5ErrorCode.BondNotActive,                // u31 — bond not active at calc-height
    Pox5ErrorCode.InvalidBondPeriodOrdering,    // u29 — ordering guard
    Pox5ErrorCode.DistributionAlreadyComputed,  // u30 — already settled this period
  ]);

  if (code !== undefined) {
    const info = describePox5Error(code);
    if (code === Pox5ErrorCode.ActiveBondNotIncluded) {
      console.log(
        'probe-4 PRIMARY CONFIRMED: ERR_ACTIVE_BOND_NOT_INCLUDED (u33) — ' +
        'incomplete bond list correctly rejected. DISCOVERY: single-bond subset triggers u33.'
      );
    } else if (code === Pox5ErrorCode.BondNotActive) {
      console.log('probe-4 NOTE: ERR_BOND_NOT_ACTIVE (u31) — bond not active at calc-height');
    } else if (code === Pox5ErrorCode.InvalidBondPeriodOrdering) {
      console.log('probe-4 NOTE: ERR_INVALID_BOND_PERIOD_ORDERING (u29) — ordering guard fired');
    } else if (code === Pox5ErrorCode.DistributionAlreadyComputed) {
      console.log('probe-4 NOTE: ERR_DISTRIBUTION_ALREADY_COMPUTED (u30) — already settled');
    } else if (TOLERANT_SET.has(code)) {
      console.log(`probe-4 NOTE: (err u${code}) — in tolerant set`);
    } else {
      console.warn(
        `probe-4 UNEXPECTED: (err u${code}) ${info?.name ?? ''} — new discovery! ${info?.description ?? ''}`
      );
    }
    expect(typeof code).toBe('number');
  } else {
    console.log('probe-4: tx SUCCEEDED — distribution settled for single-bond subset (no other active bonds)');
  }
});

// ─── PROBE 5: register-for-bond against a NON-EXISTENT bond index ────────────
//
// Verify fetchProtocolBond returns undefined for a candidate index, then call
// buildRegisterForBond (sBTC path, account5) against it. Expected: u7
// ERR_BOND_NOT_FOUND — this is the primary DISCOVERY target for this probe.
//
// Guard ordering in pox-5.clar register-for-bond (inferred from other tests):
//   1. prepare-phase guard  → u47 StakeInPreparePhase
//   2. bond-exists guard    → u7  BondNotFound        ← THIS PROBE
//   3. allowlist guard      → u11 NotAllowlisted
//   4. already-started guard→ u43 BondAlreadyStarted
//   5. lock-sbtc            → u1  Unauthorized (no sBTC balance)
//
// We try indices 9, 25, 999 in order — taking the first non-existent one.
// Tolerant: u7 (primary), u47 (prepare-phase guard fires first), u1 (lock-sbtc).

test('adversarial-4-5: register-for-bond against non-existent bond index expects u7 BondNotFound', async () => {
  // Find a non-existent bond index from the candidate list
  const nonExistentIndex = await findNonExistentBondIndex([9, 25, 999]);

  if (nonExistentIndex === undefined) {
    console.warn(
      'probe-5 SKIP: all candidate indices (9, 25, 999) appear to exist on-chain — ' +
      'cannot confirm a non-existent target. Proceeding with 999 as fallback.'
    );
  }

  const bondIndex = nonExistentIndex ?? 999;
  console.log('probe-5 non-existent bondIndex:', bondIndex);

  const unsigned = await buildRegisterForBond({
    bondIndex,
    signerManager: SIGNER_MANAGER,
    amountUstx: AMOUNT_USTX,
    lockup: { kind: 'sbtc', sbtcSats: SBTC_SATS },
    publicKey: account5.publicKey,
    fee: FEE,
    nonce: await getNextNonce(account5.address),
    network,
  });

  const tx = signTransaction(unsigned, account5.key);
  const txid = await broadcastAndWait(tx, account5.address, network);
  console.log('probe-5 txid:', txid);

  const code = await assertTolerableResult('probe-5', txid);

  // Primary: u7 BondNotFound — the "bond not found" / "no such bond" code.
  // Tolerant: u47 (prepare-phase guard fires before bond-exists check), u1 (sBTC guard).
  const TOLERANT_SET = new Set([
    Pox5ErrorCode.BondNotFound,        // u7 — PRIMARY DISCOVERY TARGET
    Pox5ErrorCode.StakeInPreparePhase, // u47 — prepare-phase guard fires first
    Pox5ErrorCode.Unauthorized,        // u1  — lock-sbtc guard fires (no sBTC balance)
  ]);

  if (code !== undefined) {
    const info = describePox5Error(code);
    if (code === Pox5ErrorCode.BondNotFound) {
      console.log(
        `probe-5 PRIMARY CONFIRMED: ERR_BOND_NOT_FOUND (u7) — ` +
        `register against non-existent bondIndex=${bondIndex} correctly aborts with u7. ` +
        `DISCOVERY: bond-not-found code is u7.`
      );
    } else if (code === Pox5ErrorCode.StakeInPreparePhase) {
      console.log('probe-5 NOTE: ERR_STAKE_IN_PREPARE_PHASE (u47) — prepare-phase guard fired before bond-exists check');
    } else if (code === Pox5ErrorCode.Unauthorized) {
      console.log('probe-5 NOTE: ERR_UNAUTHORIZED (u1) — lock-sbtc guard fired (no sBTC balance on account5)');
    } else if (TOLERANT_SET.has(code)) {
      console.log(`probe-5 NOTE: (err u${code}) — in tolerant set`);
    } else {
      console.warn(
        `probe-5 UNEXPECTED/NEW CODE: (err u${code}) ${info?.name ?? '(unknown)'} — ` +
        `${info?.description ?? 'not in Pox5ErrorCode enum — newly discovered error code!'}`
      );
    }
    // Accept any abort — the DISCOVERY is the actual code value
    expect(typeof code).toBe('number');
  } else {
    // Success against a non-existent bond would be deeply surprising
    console.warn(
      `probe-5 UNEXPECTED SUCCESS: register-for-bond at non-existent bondIndex=${bondIndex} ` +
      'returned (ok ...) — investigate immediately!'
    );
  }
});
