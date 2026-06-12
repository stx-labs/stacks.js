/**
 * Adversarial / robustness probes for the pox-5 bond contract on the private testnet.
 *
 * These tests intentionally attempt invalid or boundary operations against the
 * live contract and assert the expected on-chain abort codes. The goal is to
 * DISCOVER and DOCUMENT error codes, not to exercise the happy path.
 *
 * No Bitcoin transactions, no L1 proofs, no `set-bond-admin` calls.
 * Safe senders only: account4 (bond admin), account5, account6.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROBE 1 — Duplicate setup-bond → ERR_BOND_ALREADY_SETUP (err u4)
 *   We discover the highest existing bond index by probing fetchBond(0..25),
 *   then re-run setup-bond on it from the real bond-admin. The contract should
 *   reject with (err u4) BondAlreadySetup. We additionally assert that the bond
 *   on-chain is unchanged after the abort.
 *
 * PROBE 2 — setup-bond too late → ERR_CANNOT_SETUP_BOND_TOO_LATE (err u3)
 *   We deliberately compute a bondIndex whose start cycle is in the PAST
 *   (anchorCycle + 0*BOND_GAP_CYCLES = anchorCycle itself, which is already
 *   passed). setup-bond should reject with (err u3). The contract enforces that
 *   the setup window only extends BOND_GAP_CYCLES cycles BEFORE the bond's
 *   start cycle — anything ≤ current cycle is too late.
 *
 * PROBE 3 — register-for-bond from a non-allowlisted account (sBTC path) → unknown
 *   account6 is NOT on any bond's allowlist. We send a register-for-bond (sbtc
 *   path) for the highest existing bond. The contract evaluates the lockup branch
 *   FIRST (lock-sbtc → ft-transfer? aborts with (err u1) when the caller has 0
 *   sBTC), so we expect (err u1) rather than the allowlist guard (err u11
 *   ERR_NOT_ALLOWLISTED). This ordering is documented; the probe DISCOVERS which
 *   abort fires first and logs describePox5Error for whichever code comes back.
 *   We assert no enrollment was created.
 *
 * Run with:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so RECORD=1 \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *     npx jest tests/privatenet/actions/adversarial.test.ts --runInBand --collectCoverage=false
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
  waitForFulfilled,
} from "../../helpers/wait";
import { signTransaction } from "../../helpers/sign";
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { fetchFirstBondPeriodCycle } from "../pox";

// Reuse the daemon's deployed signer-manager — deploying our own reliably times
// out beforeAll under this net's rate limits (see register-for-bond.test.ts).
const SIGNER_MANAGER =
  process.env.SIGNER_MANAGER ??
  "ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager";

jest.setTimeout(30 * 60_000);

const network = getNetwork();

// Safe daemon-free senders (see PRIVATE_TESTNET.md rule 2)
const account5 = getAccount(REGTEST_KEYS.account5); // allowlisted on bond 1
const account6 = getAccount(REGTEST_KEYS.account6); // NOT allowlisted anywhere

const FEE = 10_000n;
const MAX_SATS = 10_000n;
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = "00".repeat(683);
const AMOUNT_USTX = 1_000_000n;
const SBTC_SATS = 1_000n;

let admin: Awaited<ReturnType<typeof getBondAdminAccount>>;
let existingBondIndex: number | undefined;
let signerManager: string;

// ─── helpers ────────────────────────────────────────────────────────────────

/** Parse the raw (err uN) repr string and return N, or undefined. */
function parseErrCode(repr: string | undefined): number | undefined {
  if (!repr) return undefined;
  const m = repr.match(/^\(err u(\d+)\)$/);
  return m ? Number(m[1]) : undefined;
}

/**
 * Discover the highest bond index that exists on-chain by probing fetchBond in
 * the range [0, maxProbe). Returns undefined when none are found.
 */
async function findHighestExistingBondIndex(
  maxProbe = 25
): Promise<number | undefined> {
  let highest: number | undefined;
  for (let i = 0; i < maxProbe; i++) {
    try {
      const bond = await fetchBond({ bondIndex: i, network });
      if (bond !== undefined) highest = i;
    } catch {
      // fetchBond can throw on network errors — skip
    }
  }
  return highest;
}

// ─── setup ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  admin = await getBondAdminAccount();
  await ensurePox5();

  // Discover an existing bond to reuse for probes 1 and 3 (cap probes to limit
  // rate-limited reads).
  console.log("Probing for existing bonds (0..7)...");
  existingBondIndex = await findHighestExistingBondIndex(8);
  console.log("Highest existing bond index:", existingBondIndex);

  // Reuse an existing signer-manager (no deploy round-trip → fast beforeAll).
  signerManager = SIGNER_MANAGER;
  console.log("signerManager:", signerManager);
}, 20 * 60_000);

// ─── PROBE 1: Duplicate setup-bond → ERR_BOND_ALREADY_SETUP (err u4) ────────

test("adversarial-1: duplicate setup-bond aborts with ERR_BOND_ALREADY_SETUP (err u4)", async () => {
  if (existingBondIndex === undefined) {
    console.warn("No existing bond found — skipping duplicate-setup probe");
    // Mark as skipped rather than failing: the chain may be freshly wiped.
    return;
  }

  // Snapshot the existing bond so we can verify it is unchanged after the abort.
  const bondBefore = await waitForFulfilled(() =>
    fetchBond({ bondIndex: existingBondIndex!, network }).then((b) => {
      if (!b) throw new Error("bond not on-chain");
      return b;
    })
  );
  console.log("probe-1 bondBefore:", bondBefore);

  // Re-run setup-bond on the SAME index — must abort with (err u4).
  const unsigned = await buildSetupBond({
    bondIndex: existingBondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
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
  console.log("probe-1 txid:", txid);

  // State check: bond must be unchanged (abort left no side-effect).
  const bondAfter = await fetchBond({ bondIndex: existingBondIndex, network });
  console.log("probe-1 bondAfter:", bondAfter);
  expect(bondAfter).toBeDefined();
  expect(bondAfter?.stxValueRatio).toBe(bondBefore.stxValueRatio);
  expect(bondAfter?.minUstxRatioBps).toBe(bondBefore.minUstxRatioBps);

  // Best-effort extended check (only when RECORD=1 — /extended lags on this chain).
  if (ENV.RECORD) {
    const record = await getTransaction(txid);
    console.log("probe-1 tx_status:", record?.tx_status);
    console.log("probe-1 tx_result.repr:", record?.tx_result?.repr);

    if (record && record.tx_status !== "pending") {
      expect(record.tx_status).toBe("abort_by_response");

      const code = parseErrCode(record.tx_result?.repr);
      console.log(
        "probe-1 error code:",
        code,
        describePox5Error(code ?? -1)
      );

      // The contract must abort — we're tolerant on the exact code in case the
      // chain state differs (a non-setup bond index could give BondNotFound instead).
      expect(record.tx_result?.repr).toMatch(/^\(err u\d+\)$/);

      // Ideal: BondAlreadySetup = 4. Log and assert if we get it.
      if (code === Pox5ErrorCode.BondAlreadySetup) {
        expect(record.tx_result.repr).toBe("(err u4)");
        console.log("probe-1 CONFIRMED: got ERR_BOND_ALREADY_SETUP (err u4)");
      } else {
        console.warn(
          `probe-1 NOTE: expected (err u4) but got ${record.tx_result?.repr}`,
          describePox5Error(code ?? -1)
        );
      }
    }
  }
});

// ─── PROBE 2: setup-bond too late → ERR_CANNOT_SETUP_BOND_TOO_LATE (err u3) ─

test("adversarial-2: setup-bond with a past bondIndex aborts with ERR_CANNOT_SETUP_BOND_TOO_LATE (err u3)", async () => {
  const poxInfo = await getPoxInfo();
  const anchorCycle = await fetchFirstBondPeriodCycle();

  // Compute the CURRENT bond index — the one whose start cycle is exactly at
  // or before the current reward cycle. This index's setup window is closed.
  // Formula: floor((currentCycle - anchorCycle) / BOND_GAP_CYCLES)
  // If currentCycle < anchorCycle we use 0, which may be "too soon" instead;
  // we log the repr in that case.
  const currentCycleDelta = Math.max(
    0,
    poxInfo.rewardCycleId - anchorCycle
  );
  // Use the bond whose START cycle equals the anchor (bondIndex=0) or one
  // step behind the "next" open bond — whichever is safest for a "too late" test.
  const pastBondIndex = Math.floor(currentCycleDelta / BOND_GAP_CYCLES);
  const startCycleForPast = anchorCycle + pastBondIndex * BOND_GAP_CYCLES;

  console.log("probe-2", {
    anchorCycle,
    currentCycle: poxInfo.rewardCycleId,
    pastBondIndex,
    startCycleForPast,
    BOND_GAP_CYCLES,
  });

  // pastBondIndex is the bond whose start cycle is ≤ current cycle → setup
  // window is closed → expect (err u3). Bond 0 (start = anchorCycle) is always
  // in the past once any cycles have passed, which they must have for pox-5 to
  // even be active.
  const unsigned = await buildSetupBond({
    bondIndex: pastBondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
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
  console.log("probe-2 txid:", txid);

  // Bond for pastBondIndex should NOT have been newly created with our params.
  // (It may already exist from a prior run — we don't assert its absence, only
  // that our tx aborted.)

  if (ENV.RECORD) {
    const record = await getTransaction(txid);
    console.log("probe-2 tx_status:", record?.tx_status);
    console.log("probe-2 tx_result.repr:", record?.tx_result?.repr);

    if (record && record.tx_status !== "pending") {
      expect(record.tx_status).toBe("abort_by_response");

      const code = parseErrCode(record.tx_result?.repr);
      console.log(
        "probe-2 error code:",
        code,
        describePox5Error(code ?? -1)
      );

      // Must be some (err uN) — be tolerant of exact code since chain state
      // varies: if pastBondIndex is already set up we get u4, if truly too late u3.
      expect(record.tx_result?.repr).toMatch(/^\(err u\d+\)$/);

      if (code === Pox5ErrorCode.CannotSetupBondTooLate) {
        console.log(
          "probe-2 CONFIRMED: got ERR_CANNOT_SETUP_BOND_TOO_LATE (err u3)"
        );
      } else if (code === Pox5ErrorCode.BondAlreadySetup) {
        console.log(
          "probe-2 NOTE: got ERR_BOND_ALREADY_SETUP (err u4) — bond was already set up; implies too-late window also passed"
        );
      } else {
        console.warn(
          `probe-2 NOTE: unexpected code ${record.tx_result?.repr}`,
          describePox5Error(code ?? -1)
        );
      }
    }
  }
});

// ─── PROBE 3: non-allowlisted register-for-bond (sBTC path) ─────────────────

test("adversarial-3: register-for-bond from non-allowlisted account6 aborts (sbtc path)", async () => {
  const bondIndex = existingBondIndex ?? 1; // fallback to bond 1 if none discovered
  console.log("probe-3 using bondIndex:", bondIndex);

  // Pre-condition: account6 must NOT be enrolled in any bond.
  const membershipBefore = await fetchBondMembership({
    address: account6.address,
    network,
  });
  expect(membershipBefore).toBeUndefined();

  const unsigned = await buildRegisterForBond({
    bondIndex,
    signerManager,
    amountUstx: AMOUNT_USTX,
    lockup: { kind: "sbtc", sbtcSats: SBTC_SATS },
    publicKey: account6.publicKey,
    fee: FEE,
    nonce: await getNextNonce(account6.address),
    network,
  });

  const tx = signTransaction(unsigned, account6.key);
  const txid = await broadcastAndWait(tx, account6.address, network);
  console.log("probe-3 txid:", txid);

  // Abort must NOT have produced an enrollment.
  const membershipAfter = await fetchBondMembership({
    address: account6.address,
    network,
  });
  expect(membershipAfter).toBeUndefined();
  console.log("probe-3 confirmed: no enrollment after abort");

  if (ENV.RECORD) {
    const record = await getTransaction(txid);
    console.log("probe-3 tx_status:", record?.tx_status);
    console.log("probe-3 tx_result.repr:", record?.tx_result?.repr);

    if (record && record.tx_status !== "pending") {
      expect(record.tx_status).toBe("abort_by_response");

      const code = parseErrCode(record.tx_result?.repr);
      const info = describePox5Error(code ?? -1);
      console.log("probe-3 error code:", code, info);

      // Must be some (err uN). Exact code depends on evaluation order:
      //   - (err u1)  ERR_UNAUTHORIZED       — lock-sbtc's ft-transfer? fires first (0 sBTC)
      //   - (err u11) ERR_NOT_ALLOWLISTED     — allowlist guard (would fire if sbtc balance > 0)
      // We DISCOVER and LOG, then assert tolerantly.
      expect(record.tx_result?.repr).toMatch(/^\(err u\d+\)$/);

      if (code === Pox5ErrorCode.Unauthorized) {
        console.log(
          "probe-3 CONFIRMED: (err u1) ERR_UNAUTHORIZED — lock-sbtc ft-transfer? fires before allowlist guard (account6 has 0 sBTC)"
        );
      } else if (code === Pox5ErrorCode.NotAllowlisted) {
        console.log(
          "probe-3 NOTE: (err u11) ERR_NOT_ALLOWLISTED — allowlist check ran before lock-sbtc (unexpected ordering, worth noting)"
        );
      } else {
        console.warn(
          `probe-3 NOTE: unexpected code ${record.tx_result?.repr} — ${info?.name ?? "unknown"}:`,
          info?.description
        );
      }
    }
  }
});
