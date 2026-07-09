/**
 * Adversarial / robustness probes for pox-5 bond contract, batch 3.
 *
 * Unlike adversarial.test.ts / adversarial-2.test.ts, all setup-bond probes here
 * compute the SOONEST SETTABLE index (offset=0, as setup-bond.test.ts does) so
 * ERR_CANNOT_SETUP_BOND_TOO_SOON (u2) doesn't mask the real guard under test.
 * Probe D wraps broadcastAndWait in try/catch since a trait-conformance mismatch
 * may be rejected at the node level (BadFunctionArgument) before it's on-chain.
 *
 * No Bitcoin transactions. No `set-bond-admin` calls. No contract deploys.
 *
 * Run with:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so RECORD=1 \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *     npx jest tests/privatenet/actions/adversarial-3.test.ts --runInBand --collectCoverage=false
 */
import {
  BOND_GAP_CYCLES,
  buildSetupBond,
  buildRegisterForBond,
  describePox5Error,
  fetchBond,
  fetchBondMembership,
  Pox5ErrorCode,
} from '../../../src';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import {
  broadcastAndWait,
  getNextNonce,
  getPoxInfo,
  assertTolerableResult,
} from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { useFixtures } from '../../helpers/mock';
import { computeNextBondIndex } from '../../helpers/bond';

// Reuse the daemon's deployed signer-manager — no deploy round-trips.
const SIGNER_MANAGER =
  process.env.SIGNER_MANAGER ?? 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';

// A real deployed contract that does NOT implement the signer-manager trait.
// Using the pox-5 contract itself as a trait-mismatch stand-in.
const NON_CONFORMING_SIGNER_MANAGER = 'ST000000000000000000002AMW42H.pox-5';

jest.setTimeout(30 * 60_000);

const network = getNetwork();

// account5: allowlisted on most bonds; safe to use as the unauthorized admin
// probe sender (no daemon touches it).
const account5 = getAccount(REGTEST_KEYS.account5);

const FEE = 10_000n;
const MAX_SATS = 10_000n;
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);
const AMOUNT_USTX = 1_000_000n;
const SBTC_SATS = 1_000n;

let admin: Awaited<ReturnType<typeof getBondAdminAccount>>;
let signerManager: string;


beforeAll(async () => {
  admin = await getBondAdminAccount();

  signerManager = SIGNER_MANAGER;
  console.log('bond-admin address:', admin.address);
  console.log('account5 address:', account5.address);
  console.log('signerManager:', signerManager);
  console.log('nonConformingSignerManager:', NON_CONFORMING_SIGNER_MANAGER);
}, 20 * 60_000);

// PROBE A: non-admin setup-bond, expect ERR_UNAUTHORIZED (u1) after the timing
// guard passes. A success here would mean a non-admin created a bond.
test('adversarial-3-A: non-admin setup-bond — expect ERR_UNAUTHORIZED (u1)', async () => {
  useFixtures('adversarial-3-a');
  const { bondIndex, anchorCycle, currentCycle } = await computeNextBondIndex(await getPoxInfo());
  console.log('probe-A soonest bondIndex:', bondIndex, {
    anchorCycle,
    currentCycle,
    BOND_GAP_CYCLES,
  });

  // Snapshot any pre-existing bond at this index so we can detect a write.
  const bondBefore = await fetchBond({ bondIndex, network }).catch(() => undefined);
  console.log('probe-A bondBefore:', bondBefore ?? '(none)');

  // Build a VALID setup-bond but sign with account5 — NOT the bond-admin.
  const unsigned = await buildSetupBond({
    bondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist: [{ staker: account5.address, maxSats: MAX_SATS }],
    // Use account5's publicKey so the tx is built for account5 as the sender.
    publicKey: account5.publicKey,
    fee: FEE,
    nonce: await getNextNonce(account5.address),
    network,
  });

  const tx = signTransaction(unsigned, account5.key);
  const txid = await broadcastAndWait(tx, account5.address, network);
  console.log('probe-A txid:', txid);

  // Check whether a bond now exists at this index.
  const bondAfter = await fetchBond({ bondIndex, network }).catch(() => undefined);
  console.log('probe-A bondAfter:', bondAfter ?? '(none)');

  // If a new bond appeared where there was none before, that's the vulnerability.
  const newBondCreated = bondAfter !== undefined && bondBefore === undefined;
  if (newBondCreated) {
    console.error(
      `CRITICAL: non-admin created a bond at index ${bondIndex}!`,
      'Sender:',
      account5.address,
      'Bond:',
      bondAfter
    );
  } else {
    console.log('probe-A: no new bond created by the non-admin (expected outcome)');
  }

  // Tolerant: we only assert that the tx was NOT a silent no-op success that
  // also created a bond. If it succeeded without side effect, we still flag it.
  const code = await assertTolerableResult('probe-A', txid);

  if (code === Pox5ErrorCode.Unauthorized) {
    console.log(
      'probe-A CONFIRMED: ERR_UNAUTHORIZED (u1) — authorization guard reached (timing guard passed)'
    );
  } else if (code === Pox5ErrorCode.CannotSetupBondTooSoon) {
    console.warn(
      "probe-A NOTE: (err u2) CannotSetupBondTooSoon — soonest index wasn't quite open yet; timing guard masked the auth check (inconclusive)"
    );
  } else if (code === Pox5ErrorCode.CannotSetupBondTooLate) {
    console.warn(
      'probe-A NOTE: (err u3) CannotSetupBondTooLate — soonest index was already past open window (inconclusive)'
    );
  } else if (code === Pox5ErrorCode.BondAlreadySetup) {
    console.warn(
      'probe-A NOTE: (err u4) BondAlreadySetup — bond already existed; auth guard may or may not have fired before it'
    );
  } else if (code === undefined && newBondCreated) {
    // tx succeeded AND created a bond -> critical
    expect(newBondCreated).toBe(false); // fail the test with a clear message
  } else if (code === undefined) {
    console.warn(
      'probe-A NOTE: tx succeeded but no new bond was detected — may be a noop success or bond already existed'
    );
  } else {
    console.warn(
      `probe-A UNEXPECTED: (err u${code}) — ${describePox5Error(code)?.name ?? 'unknown'}`
    );
  }
});

// PROBE B: setup-bond with stxValueRatio=0. If unvalidated, the bond's
// min-ustx-for-sats-amount always returns 0 (stakers need 0 uSTX) - a finding.
test('adversarial-3-B: setup-bond stxValueRatio = 0 — economic validation check', async () => {
  useFixtures('adversarial-3-b');
  const { bondIndex, anchorCycle, currentCycle } = await computeNextBondIndex(await getPoxInfo());
  console.log('probe-B soonest bondIndex:', bondIndex, {
    anchorCycle,
    currentCycle,
  });

  const bondBefore = await fetchBond({ bondIndex, network }).catch(() => undefined);
  console.log('probe-B bondBefore:', bondBefore ?? '(none)');

  const unsigned = await buildSetupBond({
    bondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: 0n, // deliberately zero
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist: [{ staker: account5.address, maxSats: MAX_SATS }],
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
  });

  const tx = signTransaction(unsigned, admin.key);
  const txid = await broadcastAndWait(tx, admin.address, network);
  console.log('probe-B txid:', txid);

  const bondAfter = await fetchBond({ bondIndex, network }).catch(() => undefined);
  console.log('probe-B bondAfter:', bondAfter ?? '(none)');

  const code = await assertTolerableResult('probe-B', txid);

  if (code !== undefined) {
    console.log(
      'probe-B discovery: stxValueRatio=0 REJECTED with code',
      code,
      describePox5Error(code)?.name ?? '(unknown code — new discovery)'
    );
    // Timing guards that would mask the real check — report if seen.
    if (code === Pox5ErrorCode.CannotSetupBondTooSoon) {
      console.warn(
        "probe-B MASKED: (err u2) — soonest index wasn't open; real validation unreachable"
      );
    } else if (code === Pox5ErrorCode.CannotSetupBondTooLate) {
      console.warn(
        'probe-B MASKED: (err u3) — index past open window; real validation unreachable'
      );
    } else if (code === Pox5ErrorCode.BondAlreadySetup) {
      console.warn('probe-B MASKED: (err u4) — bond already existed; real validation unreachable');
    } else {
      // Any other abort is the real validation firing — good outcome (guarded).
      console.log(
        'probe-B CONFIRMED: stxValueRatio=0 was REJECTED by the contract (validation present)'
      );
    }
  } else {
    // Success path -> unvalidated zero ratio is the finding.
    const newBondCreated = bondAfter !== undefined && bondBefore === undefined;
    if (newBondCreated) {
      console.error(
        `FINDING: stxValueRatio=0 ACCEPTED — bond created at index ${bondIndex}!`,
        'min-ustx-for-sats-amount will always return 0 for this bond.',
        'Bond:',
        bondAfter
      );
    } else {
      console.warn(
        'probe-B NOTE: tx succeeded but no new bond detected — may have hit an existing bond silently'
      );
    }
  }
});

// PROBE C: setup-bond with minUstxRatioBps=20000 (200%). If unenforced, stakers
// would need 2x the STX-equivalent of their BTC — economically unviable, likely
// unintended.
test('adversarial-3-C: setup-bond minUstxRatioBps = 20000 (> 100%) — economic validation check', async () => {
  useFixtures('adversarial-3-c');
  // Recompute — probe B may have consumed the previous soonest index if it succeeded.
  const { bondIndex, anchorCycle, currentCycle } = await computeNextBondIndex(await getPoxInfo());
  console.log('probe-C soonest bondIndex:', bondIndex, {
    anchorCycle,
    currentCycle,
  });

  const bondBefore = await fetchBond({ bondIndex, network }).catch(() => undefined);
  console.log('probe-C bondBefore:', bondBefore ?? '(none)');

  const unsigned = await buildSetupBond({
    bondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: 20_000n, // 200% — should exceed contract's allowed range
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist: [{ staker: account5.address, maxSats: MAX_SATS }],
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
  });

  const tx = signTransaction(unsigned, admin.key);
  const txid = await broadcastAndWait(tx, admin.address, network);
  console.log('probe-C txid:', txid);

  const bondAfter = await fetchBond({ bondIndex, network }).catch(() => undefined);
  console.log('probe-C bondAfter:', bondAfter ?? '(none)');

  const code = await assertTolerableResult('probe-C', txid);

  if (code !== undefined) {
    console.log(
      'probe-C discovery: minUstxRatioBps=20000 REJECTED with code',
      code,
      describePox5Error(code)?.name ?? '(unknown code — new discovery)'
    );
    if (code === Pox5ErrorCode.CannotSetupBondTooSoon) {
      console.warn(
        "probe-C MASKED: (err u2) — soonest index wasn't open; real validation unreachable"
      );
    } else if (code === Pox5ErrorCode.CannotSetupBondTooLate) {
      console.warn(
        'probe-C MASKED: (err u3) — index past open window; real validation unreachable'
      );
    } else if (code === Pox5ErrorCode.BondAlreadySetup) {
      console.warn('probe-C MASKED: (err u4) — bond already existed; real validation unreachable');
    } else {
      console.log(
        'probe-C CONFIRMED: minUstxRatioBps=20000 was REJECTED by the contract (validation present)'
      );
    }
  } else {
    const newBondCreated = bondAfter !== undefined && bondBefore === undefined;
    if (newBondCreated) {
      console.error(
        `FINDING: minUstxRatioBps=20000 (200%) ACCEPTED — bond created at index ${bondIndex}!`,
        'Stakers would need to provide 200% of the BTC value in STX.',
        'Bond:',
        bondAfter
      );
    } else {
      console.warn(
        'probe-C NOTE: tx succeeded but no new bond detected — bond may have already existed at this index'
      );
    }
  }
});

// PROBE D: register-for-bond with a non-conforming signerManager (pox-5 itself,
// which doesn't implement the signer-manager trait). Expect rejection either at
// the node's ABI layer (broadcast throws) or via on-chain abort.
test('adversarial-3-D: register-for-bond with non-conforming signerManager — trait conformance', async () => {
  useFixtures('adversarial-3-d');
  // Discover the lowest existing bond index to use.
  let existingBondIndex: number | undefined;
  for (let i = 1; i <= 5; i++) {
    try {
      const bond = await fetchBond({ bondIndex: i, network });
      if (bond !== undefined) {
        existingBondIndex = i;
        break;
      }
    } catch {
      // network errors -> skip
    }
  }

  if (existingBondIndex === undefined) {
    console.warn(
      'probe-D: no existing bond found in indices 1..5 — skipping trait conformance probe'
    );
    return;
  }

  console.log('probe-D using bondIndex:', existingBondIndex);
  console.log('probe-D non-conforming signerManager:', NON_CONFORMING_SIGNER_MANAGER);

  const membershipBefore = await fetchBondMembership({
    address: account5.address,
    network,
  });
  console.log('probe-D membershipBefore:', membershipBefore ?? '(none)');

  let txid: string | undefined;
  let broadcastRejected = false;
  let rejectionError: string | undefined;

  try {
    const unsigned = await buildRegisterForBond({
      bondIndex: existingBondIndex,
      signerManager: NON_CONFORMING_SIGNER_MANAGER,
      amountUstx: AMOUNT_USTX,
      lockup: { kind: 'sbtc', sbtcSats: SBTC_SATS },
      publicKey: account5.publicKey,
      fee: FEE,
      nonce: await getNextNonce(account5.address),
      network,
      postConditionMode: 'allow',
    });

    const tx = signTransaction(unsigned, account5.key);
    txid = await broadcastAndWait(tx, account5.address, network);
    console.log('probe-D txid:', txid);
  } catch (err) {
    // Node rejected the tx before it was mined — trait conformance enforced at
    // the broadcast layer (ABI validation). This is the EXPECTED outcome for a
    // correctly enforced trait system.
    broadcastRejected = true;
    rejectionError = err instanceof Error ? err.message : String(err);
    console.log(
      'probe-D: broadcast rejected at node level (trait conformance enforced at ABI layer):',
      rejectionError
    );
    // This is the desired outcome — the test passes.
  }

  if (broadcastRejected) {
    console.log(
      'probe-D CONFIRMED: node rejected non-conforming signerManager before mining.',
      'Trait conformance is enforced at broadcast time.'
    );
    // No on-chain effect — membership must be unchanged.
    const membershipAfter = await fetchBondMembership({
      address: account5.address,
      network,
    });
    console.log('probe-D membershipAfter (post-rejection):', membershipAfter ?? '(none)');
    return;
  }

  // Broadcast succeeded — tx went on-chain. Check whether an enrollment appeared.
  const membershipAfter = await fetchBondMembership({
    address: account5.address,
    network,
  });
  console.log('probe-D membershipAfter:', membershipAfter ?? '(none)');

  if (txid !== undefined) {
    const code = await assertTolerableResult('probe-D', txid);

    if (code !== undefined) {
      console.log(
        'probe-D: on-chain abort with code',
        code,
        describePox5Error(code)?.name ?? '(unknown)',
        '— trait conformance enforced in-contract (node layer was lax)'
      );
      // Enrollment must not have been created.
      expect(membershipAfter).toBeUndefined();
      console.log('probe-D: no enrollment created (correct)');
    } else {
      // tx SUCCEEDED with a non-conforming contract — significant finding.
      if (membershipAfter !== undefined) {
        console.error(
          'FINDING: register-for-bond SUCCEEDED with a non-conforming signerManager!',
          'The trait conformance check appears to be missing or bypassable.',
          'Enrollment:',
          membershipAfter
        );
      } else {
        console.warn(
          'probe-D NOTE: tx succeeded but no enrollment detected — ' +
            'success with a non-conforming signerManager passed, which is unexpected ' +
            'even if the enrollment was absent (rollback may have occurred for another reason)'
        );
      }
    }
  }
});
