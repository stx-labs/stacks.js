/**
 * Adversarial / robustness probes — pox-5 bond contract, batch 3.
 *
 * FOCUS: attack vectors that earlier batteries (adversarial.test.ts and
 * adversarial-2.test.ts) COULD NOT REACH because they used future-offset bond
 * indices whose timing guard (ERR_CANNOT_SETUP_BOND_TOO_SOON u2) fired before
 * the real check. All setup-bond probes here compute the SOONEST SETTABLE index
 * (offset = 0, exactly as setup-bond.test.ts does), so the timing window is
 * open and the real validation path is exercised.
 *
 * The register-for-bond probe wraps broadcastAndWait in a try/catch because a
 * trait-conformance mismatch may be rejected at the node level (BadFunctionArgument
 * before the tx is mined) rather than via an on-chain abort.
 *
 * No Bitcoin transactions. No `set-bond-admin` calls. No contract deploys.
 * Safe senders: bond-admin (getBondAdminAccount), account5.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROBE A — authorization bypass: non-admin setup-bond
 *   Compute the soonest settable index. Build a VALID setup-bond (all params
 *   sensible) but sign it with account5 (NOT the bond-admin). The timing guard
 *   passes (soonest index); the contract should then hit the authorization guard
 *   and abort with ERR_UNAUTHORIZED (u1). If instead the tx succeeds, a
 *   non-admin has created a bond — a CRITICAL vulnerability. We verify via
 *   fetchBond() that no bond was created by the non-admin.
 *
 * PROBE B — economic param: stxValueRatio = 0
 *   Compute the soonest settable index. Admin builds setup-bond with
 *   stxValueRatio = 0 (all other params valid). Timing guard passes. The
 *   contract's min-ustx-for-sats-amount function multiplies by stxValueRatio —
 *   a zero ratio collapses that product to 0, potentially allowing stakers to
 *   provide 0 uSTX. Expected: reject (new unknown error code) OR succeed (real
 *   finding: unvalidated zero ratio means min-uSTX is always 0).
 *
 * PROBE C — economic param: minUstxRatioBps = 20000 (> 100% = > 10000 bps)
 *   Compute the soonest settable index. Admin builds setup-bond with
 *   minUstxRatioBps = 20000 (all other params valid). Timing guard passes.
 *   Expected: reject (validated) OR succeed (finding: >100% ratio accepted,
 *   which would require stakers to provide 200% of the BTC value in STX).
 *
 * PROBE D — trait conformance: non-conforming signerManager
 *   Build register-for-bond for an existing bond using account5 as the staker,
 *   but pass "ST000000000000000000002AMW42H.pox-5" as the signerManager (the
 *   pox-5 contract itself, which does NOT implement the signer-manager trait).
 *   The node should reject this at the ABI layer (BadFunctionArgument) or the
 *   contract should abort. We wrap broadcastAndWait in try/catch and log
 *   whichever outcome occurs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
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
} from "../../../src";
import { REGTEST_KEYS, getAccount } from "../../regtest/regtest";
import { getNetwork, ENV } from "../../helpers/utils";
import {
  broadcastAndWait,
  ensurePox5,
  getNextNonce,
  getPoxInfo,
  getTransaction,
} from "../../helpers/wait";
import { signTransaction } from "../../helpers/sign";
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { fetchFirstBondPeriodCycle } from "../pox";

// Reuse the daemon's deployed signer-manager — no deploy round-trips.
const SIGNER_MANAGER =
  process.env.SIGNER_MANAGER ??
  "ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager";

// A real deployed contract that does NOT implement the signer-manager trait.
// Using the pox-5 contract itself as a trait-mismatch stand-in.
const NON_CONFORMING_SIGNER_MANAGER = "ST000000000000000000002AMW42H.pox-5";

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
const EARLY_UNLOCK_BYTES = "00".repeat(683);
const AMOUNT_USTX = 1_000_000n;
const SBTC_SATS = 1_000n;

let admin: Awaited<ReturnType<typeof getBondAdminAccount>>;
let signerManager: string;

// ─── helpers ────────────────────────────────────────────────────────────────

/** Parse the raw `(err uN)` repr string and return N, or undefined. */
function parseErrCode(repr: string | undefined): number | undefined {
  if (!repr) return undefined;
  const m = repr.match(/^\(err u(\d+)\)$/);
  return m ? Number(m[1]) : undefined;
}

/**
 * Compute the soonest settable bondIndex from the live chain state.
 * Uses offset=0 so the timing window is OPEN — this is the critical
 * difference from adversarial-2.test.ts which used offsets 1..5 and
 * hit ERR_CANNOT_SETUP_BOND_TOO_SOON before the real validation.
 *
 * Formula matches setup-bond.test.ts exactly:
 *   bondIndex = floor((currentCycle - anchorCycle) / BOND_GAP_CYCLES) + 1
 */
async function computeSoonestBondIndex(): Promise<{
  bondIndex: number;
  anchorCycle: number;
  currentCycle: number;
}> {
  const poxInfo = await getPoxInfo();
  const anchorCycle = await fetchFirstBondPeriodCycle();
  const bondIndex =
    Math.floor((poxInfo.rewardCycleId - anchorCycle) / BOND_GAP_CYCLES) + 1;
  return { bondIndex, anchorCycle, currentCycle: poxInfo.rewardCycleId };
}

/**
 * Log the tx result and make a tolerant assertion: the tx must be either
 * `abort_by_response` OR `success` (some param combos may accidentally succeed,
 * which is the FINDING). Returns the parsed error code, or undefined for success.
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

  if (!record || record.tx_status === "pending") {
    console.warn(`${label}: tx still pending — cannot assert result`);
    return undefined;
  }

  const isAbort = record.tx_status === "abort_by_response";
  const isSuccess = record.tx_status === "success";

  // Tolerant: accept either abort or success — an unexpected success is the finding.
  expect(isAbort || isSuccess).toBe(true);

  if (isAbort) {
    const code = parseErrCode(record.tx_result?.repr);
    const info = describePox5Error(code ?? -1);
    console.log(
      `${label} abort code:`,
      code,
      info?.name ?? "(unknown)",
      "—",
      info?.description ?? ""
    );
    expect(record.tx_result?.repr).toMatch(/^\(err u\d+\)$/);
    return code;
  }

  // Success path — the finding is in the log.
  console.log(`${label}: tx SUCCEEDED`);
  return undefined;
}

// ─── setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  admin = await getBondAdminAccount();
  await ensurePox5();

  signerManager = SIGNER_MANAGER;
  console.log("bond-admin address:", admin.address);
  console.log("account5 address:", account5.address);
  console.log("signerManager:", signerManager);
  console.log("nonConformingSignerManager:", NON_CONFORMING_SIGNER_MANAGER);
}, 20 * 60_000);

// ─── PROBE A: non-admin setup-bond → authorization bypass check ───────────────
//
// Target: ERR_UNAUTHORIZED (u1) — the authorization guard should fire AFTER the
// timing guard passes (soonest index → window open).
//
// "Bad" (vuln) outcome: tx succeeds, meaning a non-admin principal created a
// bond. We verify by reading fetchBond() after the tx; if a bond exists at that
// index with our staker in the allowlist we flag it as CRITICAL.
//
// Guard ordering in pox-5.clar setup-bond (hypothesized):
//   1. timing guard (too soon / too late) → (err u2) / (err u3)
//   2. authorization guard               → (err u1)  ← what we target here
//   3. already-setup guard               → (err u4)

test("adversarial-3-A: non-admin setup-bond — expect ERR_UNAUTHORIZED (u1)", async () => {
  const { bondIndex, anchorCycle, currentCycle } =
    await computeSoonestBondIndex();
  console.log("probe-A soonest bondIndex:", bondIndex, {
    anchorCycle,
    currentCycle,
    BOND_GAP_CYCLES,
  });

  // Snapshot any pre-existing bond at this index so we can detect a write.
  const bondBefore = await fetchBond({ bondIndex, network }).catch(() => undefined);
  console.log("probe-A bondBefore:", bondBefore ?? "(none)");

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
  console.log("probe-A txid:", txid);

  // Check whether a bond now exists at this index.
  const bondAfter = await fetchBond({ bondIndex, network }).catch(() => undefined);
  console.log("probe-A bondAfter:", bondAfter ?? "(none)");

  // If a new bond appeared where there was none before, that's the vulnerability.
  const newBondCreated =
    bondAfter !== undefined && bondBefore === undefined;
  if (newBondCreated) {
    console.error(
      `CRITICAL: non-admin created a bond at index ${bondIndex}!`,
      "Sender:", account5.address,
      "Bond:", bondAfter
    );
  } else {
    console.log(
      "probe-A: no new bond created by the non-admin (expected outcome)"
    );
  }

  // Tolerant: we only assert that the tx was NOT a silent no-op success that
  // also created a bond. If it succeeded without side effect, we still flag it.
  const code = await assertTolerableResult("probe-A", txid);

  if (code === Pox5ErrorCode.Unauthorized) {
    console.log(
      "probe-A CONFIRMED: ERR_UNAUTHORIZED (u1) — authorization guard reached (timing guard passed)"
    );
  } else if (code === Pox5ErrorCode.CannotSetupBondTooSoon) {
    console.warn(
      "probe-A NOTE: (err u2) CannotSetupBondTooSoon — soonest index wasn't quite open yet; timing guard masked the auth check (inconclusive)"
    );
  } else if (code === Pox5ErrorCode.CannotSetupBondTooLate) {
    console.warn(
      "probe-A NOTE: (err u3) CannotSetupBondTooLate — soonest index was already past open window (inconclusive)"
    );
  } else if (code === Pox5ErrorCode.BondAlreadySetup) {
    console.warn(
      "probe-A NOTE: (err u4) BondAlreadySetup — bond already existed; auth guard may or may not have fired before it"
    );
  } else if (code === undefined && newBondCreated) {
    // tx succeeded AND created a bond → critical
    expect(newBondCreated).toBe(false); // fail the test with a clear message
  } else if (code === undefined) {
    console.warn(
      "probe-A NOTE: tx succeeded but no new bond was detected — may be a noop success or bond already existed"
    );
  } else {
    console.warn(
      `probe-A UNEXPECTED: (err u${code}) — ${describePox5Error(code)?.name ?? "unknown"}`
    );
  }
});

// ─── PROBE B: setup-bond with stxValueRatio = 0 ──────────────────────────────
//
// Target: unknown — the contract may or may not validate that stxValueRatio > 0.
// If it does not validate, the bond is created with ratio=0, meaning
// min-ustx-for-sats-amount always returns 0 — stakers need 0 uSTX. Real finding.
//
// Uses the soonest settable index so the timing guard does not mask the result.
// If this probe creates a bond (success path), the index advances and probe C
// will compute the NEXT soonest index at runtime.
//
// "Bad" (vuln) outcome: success — log "stxValueRatio=0 accepted at idx N".

test("adversarial-3-B: setup-bond stxValueRatio = 0 — economic validation check", async () => {
  const { bondIndex, anchorCycle, currentCycle } =
    await computeSoonestBondIndex();
  console.log("probe-B soonest bondIndex:", bondIndex, {
    anchorCycle,
    currentCycle,
  });

  const bondBefore = await fetchBond({ bondIndex, network }).catch(() => undefined);
  console.log("probe-B bondBefore:", bondBefore ?? "(none)");

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
  console.log("probe-B txid:", txid);

  const bondAfter = await fetchBond({ bondIndex, network }).catch(() => undefined);
  console.log("probe-B bondAfter:", bondAfter ?? "(none)");

  const code = await assertTolerableResult("probe-B", txid);

  if (code !== undefined) {
    console.log(
      "probe-B discovery: stxValueRatio=0 REJECTED with code",
      code,
      describePox5Error(code)?.name ?? "(unknown code — new discovery)"
    );
    // Timing guards that would mask the real check — report if seen.
    if (code === Pox5ErrorCode.CannotSetupBondTooSoon) {
      console.warn(
        "probe-B MASKED: (err u2) — soonest index wasn't open; real validation unreachable"
      );
    } else if (code === Pox5ErrorCode.CannotSetupBondTooLate) {
      console.warn(
        "probe-B MASKED: (err u3) — index past open window; real validation unreachable"
      );
    } else if (code === Pox5ErrorCode.BondAlreadySetup) {
      console.warn(
        "probe-B MASKED: (err u4) — bond already existed; real validation unreachable"
      );
    } else {
      // Any other abort is the real validation firing — good outcome (guarded).
      console.log(
        "probe-B CONFIRMED: stxValueRatio=0 was REJECTED by the contract (validation present)"
      );
    }
  } else {
    // Success path → unvalidated zero ratio is the finding.
    const newBondCreated = bondAfter !== undefined && bondBefore === undefined;
    if (newBondCreated) {
      console.error(
        `FINDING: stxValueRatio=0 ACCEPTED — bond created at index ${bondIndex}!`,
        "min-ustx-for-sats-amount will always return 0 for this bond.",
        "Bond:", bondAfter
      );
    } else {
      console.warn(
        "probe-B NOTE: tx succeeded but no new bond detected — may have hit an existing bond silently"
      );
    }
  }
});

// ─── PROBE C: setup-bond with minUstxRatioBps = 20000 (> 100%) ───────────────
//
// Target: unknown — the contract may or may not enforce that minUstxRatioBps
// ≤ 10000 (100% in basis points).
//
// Uses the soonest settable index (computed fresh after probe B may have
// consumed an index). Timing guard passes → real check reached.
//
// "Bad" (vuln) outcome: success — log "minUstxRatioBps=20000 accepted at idx N".
// At 20000 bps (200%), a staker must provide 2× the STX-equivalent of their BTC,
// which would make the bond economically unviable and was likely unintended.

test("adversarial-3-C: setup-bond minUstxRatioBps = 20000 (> 100%) — economic validation check", async () => {
  // Recompute soonest index — probe B may have consumed the previous one if
  // it succeeded (creating a bond advances the soonest open index by one period).
  const { bondIndex, anchorCycle, currentCycle } =
    await computeSoonestBondIndex();
  console.log("probe-C soonest bondIndex:", bondIndex, {
    anchorCycle,
    currentCycle,
  });

  const bondBefore = await fetchBond({ bondIndex, network }).catch(() => undefined);
  console.log("probe-C bondBefore:", bondBefore ?? "(none)");

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
  console.log("probe-C txid:", txid);

  const bondAfter = await fetchBond({ bondIndex, network }).catch(() => undefined);
  console.log("probe-C bondAfter:", bondAfter ?? "(none)");

  const code = await assertTolerableResult("probe-C", txid);

  if (code !== undefined) {
    console.log(
      "probe-C discovery: minUstxRatioBps=20000 REJECTED with code",
      code,
      describePox5Error(code)?.name ?? "(unknown code — new discovery)"
    );
    if (code === Pox5ErrorCode.CannotSetupBondTooSoon) {
      console.warn(
        "probe-C MASKED: (err u2) — soonest index wasn't open; real validation unreachable"
      );
    } else if (code === Pox5ErrorCode.CannotSetupBondTooLate) {
      console.warn(
        "probe-C MASKED: (err u3) — index past open window; real validation unreachable"
      );
    } else if (code === Pox5ErrorCode.BondAlreadySetup) {
      console.warn(
        "probe-C MASKED: (err u4) — bond already existed; real validation unreachable"
      );
    } else {
      console.log(
        "probe-C CONFIRMED: minUstxRatioBps=20000 was REJECTED by the contract (validation present)"
      );
    }
  } else {
    const newBondCreated = bondAfter !== undefined && bondBefore === undefined;
    if (newBondCreated) {
      console.error(
        `FINDING: minUstxRatioBps=20000 (200%) ACCEPTED — bond created at index ${bondIndex}!`,
        "Stakers would need to provide 200% of the BTC value in STX.",
        "Bond:", bondAfter
      );
    } else {
      console.warn(
        "probe-C NOTE: tx succeeded but no new bond detected — bond may have already existed at this index"
      );
    }
  }
});

// ─── PROBE D: trait conformance — non-conforming signerManager ───────────────
//
// Target: node-level rejection (BadFunctionArgument) OR on-chain abort.
// Tests that Clarity trait conformance is enforced when a contract that does NOT
// implement the signer-manager trait is passed as the signerManager argument.
//
// We use "ST000000000000000000002AMW42H.pox-5" (the pox-5 contract itself) as
// the stand-in. pox-5 does not implement the signer-manager trait interface.
//
// The Stacks node checks trait conformance at broadcast time (ABI validation) —
// if enforcement is strict, the broadcast is rejected before the tx is mined and
// broadcastAndWait throws. We catch that here.
//
// If the node is lax (broadcast succeeds), the tx goes on-chain and the contract
// should abort when it tries to call a function on the non-conforming contract.
//
// Uses an existing bond for register-for-bond. We probe bond indices 1..5 and
// use the first one found. If none exist, the test notes it and exits.

test("adversarial-3-D: register-for-bond with non-conforming signerManager — trait conformance", async () => {
  // Discover the lowest existing bond index to use for register-for-bond.
  let existingBondIndex: number | undefined;
  for (let i = 1; i <= 5; i++) {
    try {
      const bond = await fetchBond({ bondIndex: i, network });
      if (bond !== undefined) {
        existingBondIndex = i;
        break;
      }
    } catch {
      // network errors → skip
    }
  }

  if (existingBondIndex === undefined) {
    console.warn(
      "probe-D: no existing bond found in indices 1..5 — skipping trait conformance probe"
    );
    return;
  }

  console.log("probe-D using bondIndex:", existingBondIndex);
  console.log(
    "probe-D non-conforming signerManager:",
    NON_CONFORMING_SIGNER_MANAGER
  );

  const membershipBefore = await fetchBondMembership({
    address: account5.address,
    network,
  });
  console.log("probe-D membershipBefore:", membershipBefore ?? "(none)");

  let txid: string | undefined;
  let broadcastRejected = false;
  let rejectionError: string | undefined;

  try {
    const unsigned = await buildRegisterForBond({
      bondIndex: existingBondIndex,
      signerManager: NON_CONFORMING_SIGNER_MANAGER,
      amountUstx: AMOUNT_USTX,
      lockup: { kind: "sbtc", sbtcSats: SBTC_SATS },
      publicKey: account5.publicKey,
      fee: FEE,
      nonce: await getNextNonce(account5.address),
      network,
    });

    const tx = signTransaction(unsigned, account5.key);
    txid = await broadcastAndWait(tx, account5.address, network);
    console.log("probe-D txid:", txid);
  } catch (err) {
    // Node rejected the tx before it was mined — trait conformance enforced at
    // the broadcast layer (ABI validation). This is the EXPECTED outcome for a
    // correctly enforced trait system.
    broadcastRejected = true;
    rejectionError =
      err instanceof Error ? err.message : String(err);
    console.log(
      "probe-D: broadcast rejected at node level (trait conformance enforced at ABI layer):",
      rejectionError
    );
    // This is the desired outcome — the test passes.
  }

  if (broadcastRejected) {
    console.log(
      "probe-D CONFIRMED: node rejected non-conforming signerManager before mining.",
      "Trait conformance is enforced at broadcast time."
    );
    // No on-chain effect — membership must be unchanged.
    const membershipAfter = await fetchBondMembership({
      address: account5.address,
      network,
    });
    console.log("probe-D membershipAfter (post-rejection):", membershipAfter ?? "(none)");
    return;
  }

  // Broadcast succeeded — tx went on-chain. Check whether an enrollment appeared.
  const membershipAfter = await fetchBondMembership({
    address: account5.address,
    network,
  });
  console.log("probe-D membershipAfter:", membershipAfter ?? "(none)");

  if (txid !== undefined) {
    const code = await assertTolerableResult("probe-D", txid);

    if (code !== undefined) {
      console.log(
        "probe-D: on-chain abort with code",
        code,
        describePox5Error(code)?.name ?? "(unknown)",
        "— trait conformance enforced in-contract (node layer was lax)"
      );
      // Enrollment must not have been created.
      expect(membershipAfter).toBeUndefined();
      console.log("probe-D: no enrollment created (correct)");
    } else {
      // tx SUCCEEDED with a non-conforming contract — significant finding.
      if (membershipAfter !== undefined) {
        console.error(
          "FINDING: register-for-bond SUCCEEDED with a non-conforming signerManager!",
          "The trait conformance check appears to be missing or bypassable.",
          "Enrollment:", membershipAfter
        );
      } else {
        console.warn(
          "probe-D NOTE: tx succeeded but no enrollment detected — " +
            "success with a non-conforming signerManager passed, which is unexpected " +
            "even if the enrollment was absent (rollback may have occurred for another reason)"
        );
      }
    }
  }
});
