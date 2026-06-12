/**
 * Privatenet version of the setup-bond action test.
 * Hits a live private testnet — no fixtures.
 *
 * Env overrides (all optional):
 *   TARGET_RATE_BPS       — bond target rate in bps            (default: 1000)
 *   STX_VALUE_RATIO       — STX/BTC value ratio                (default: 1000)
 *   MIN_USTX_RATIO_BPS    — minimum uSTX ratio in bps          (default: 500)
 *   ALLOWLIST_ACCOUNTS    — comma-separated subset of "account5,account6,account7"
 *                           (default: "account5")
 *   ALLOWLIST_MAX_SATS    — max sats per allowlisted staker     (default: 10000)
 *
 * Run with:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so RECORD=1 \
 *     npx jest tests/privatenet/actions/setup-bond.test.ts --runInBand --collectCoverage=false
 *
 * Varied-bond example:
 *   TARGET_RATE_BPS=500 ALLOWLIST_ACCOUNTS=account5,account6 ALLOWLIST_MAX_SATS=5000 \
 *     npx jest tests/privatenet/actions/setup-bond.test.ts --runInBand --collectCoverage=false
 */
import { broadcastTransaction } from "@stacks/transactions";
import {
  BOND_GAP_CYCLES,
  buildSetupBond,
  fetchBond,
  rewardCycleToBurnHeight,
} from "../../../src";
import { REGTEST_KEYS, getAccount } from "../../regtest/regtest";
import { getNetwork } from "../../helpers/utils";
import {
  ensurePox5,
  getNextNonce,
  getPoxInfo,
  waitForFulfilled,
} from "../../helpers/wait";
import { signTransaction } from "../../helpers/sign";
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { fetchFirstBondPeriodCycle } from "../pox";

jest.setTimeout(60 * 60_000); // bond open can be 20+ blocks away; 1h covers it

const network = getNetwork();
let admin: Awaited<ReturnType<typeof getBondAdminAccount>>;

// ─── env-parameterized bond configuration ───────────────────────────────────

const FEE = 10_000n;

/** bps charged to stakers — override with TARGET_RATE_BPS env var */
const TARGET_RATE_BPS = BigInt(process.env.TARGET_RATE_BPS ?? 1_000);
/** STX-per-BTC value ratio — override with STX_VALUE_RATIO env var */
const STX_VALUE_RATIO = BigInt(process.env.STX_VALUE_RATIO ?? 1_000);
/** minimum uSTX ratio in bps — override with MIN_USTX_RATIO_BPS env var */
const MIN_USTX_RATIO_BPS = BigInt(process.env.MIN_USTX_RATIO_BPS ?? 500);

/** Max sats per allowlisted staker — override with ALLOWLIST_MAX_SATS env var */
const ALLOWLIST_MAX_SATS = BigInt(process.env.ALLOWLIST_MAX_SATS ?? 10_000);

/**
 * Map of known allowlistable accounts (account5–account7 from REGTEST_KEYS).
 * Override which accounts are included via ALLOWLIST_ACCOUNTS env var
 * (comma-separated subset, e.g. "account5,account6").
 */
const ALLOWLISTABLE_ACCOUNTS = ["account5", "account6", "account7"] as const;
type AllowlistableKey = (typeof ALLOWLISTABLE_ACCOUNTS)[number];

/** Parse ALLOWLIST_ACCOUNTS env, defaulting to account5 only. */
function parseAllowlistAccounts(): AllowlistableKey[] {
  const raw = process.env.ALLOWLIST_ACCOUNTS;
  if (!raw) return ["account5"];
  const names = raw.split(",").map((s) => s.trim()) as AllowlistableKey[];
  const valid = names.filter((n) =>
    (ALLOWLISTABLE_ACCOUNTS as readonly string[]).includes(n)
  );
  if (valid.length === 0) {
    console.warn(
      `ALLOWLIST_ACCOUNTS="${raw}" has no recognized names — falling back to account5`
    );
    return ["account5"];
  }
  return valid;
}

const allowlistAccountNames = parseAllowlistAccounts();
const allowlistAccounts = allowlistAccountNames.map((name) =>
  getAccount(REGTEST_KEYS[name])
);

/**
 * Extra arbitrary principal(s) to append to the allowlist, beyond the known
 * account5/6/7 map — comma-separated STX principals via ALLOWLIST_EXTRA.
 * Each gets ALLOWLIST_EXTRA_MAX_SATS (default: ALLOWLIST_MAX_SATS).
 * Used to allowlist e.g. a friend principal that isn't one of account5/6/7.
 */
const ALLOWLIST_EXTRA_MAX_SATS = BigInt(
  process.env.ALLOWLIST_EXTRA_MAX_SATS ?? ALLOWLIST_MAX_SATS
);
const allowlistExtra = (process.env.ALLOWLIST_EXTRA ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  .map((staker) => ({ staker, maxSats: ALLOWLIST_EXTRA_MAX_SATS }));

// Early-unlock subscript (ELSE branch). Default: 683-byte placeholder. For a
// REAL early-unlock-reclaim test, override with a `<adminPubkey> CHECKSIGVERIFY`
// script via EARLY_UNLOCK_BYTES (hex).
const EARLY_UNLOCK_BYTES = process.env.EARLY_UNLOCK_BYTES ?? "00".repeat(683);

beforeAll(async () => {
  admin = await getBondAdminAccount();
  await ensurePox5();
}, 60 * 60_000);

test("setup-bond: admin creates a bond at the correct time", async () => {
  // Bond periods are anchored to the contract's FIXED `first-bond-period-cycle`
  // data-var (read live — the SDK's `firstPox5RewardCycle` can't see it on this
  // net because pox-5 is absent from `/v2/pox` contract_versions[], and its
  // fallback drifts with the current cycle → `(err u3)` CannotSetupBondTooLate).
  const poxInfo = await getPoxInfo();
  const burn = poxInfo.currentBurnchainBlockHeight;
  const anchorCycle = await fetchFirstBondPeriodCycle();

  // Soonest bond period whose start cycle is strictly after the current cycle:
  // its setup window (the BOND_GAP_CYCLES cycles before its start) is open now.
  const bondIndex =
    Math.floor((poxInfo.rewardCycleId - anchorCycle) / BOND_GAP_CYCLES) + 1;
  const startCycle = anchorCycle + bondIndex * BOND_GAP_CYCLES;
  const startBurn = rewardCycleToBurnHeight({ cycle: startCycle, poxInfo });

  // Build allowlist from env-selected accounts, plus any extra principals.
  const allowlist = [
    ...allowlistAccounts.map((acct) => ({
      staker: acct.address,
      maxSats: ALLOWLIST_MAX_SATS,
    })),
    ...allowlistExtra,
  ];

  console.log("setup-bond params", {
    anchorCycle,
    currentCycle: poxInfo.rewardCycleId,
    bondIndex,
    startCycle,
    burn,
    startBurn,
    targetRateBps: TARGET_RATE_BPS.toString(),
    stxValueRatio: STX_VALUE_RATIO.toString(),
    minUstxRatioBps: MIN_USTX_RATIO_BPS.toString(),
    allowlistMaxSats: ALLOWLIST_MAX_SATS.toString(),
    allowlistAccounts: allowlistAccountNames,
    allowlistAddresses: allowlistAccounts.map((a) => a.address),
    allowlistExtra: allowlistExtra.map((e) => e.staker),
  });

  const unsigned = await buildSetupBond({
    bondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist,
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
  });

  const transaction = signTransaction(unsigned, admin.key);
  const res = await broadcastTransaction({ transaction, network });
  if ("error" in res) {
    throw `broadcast rejected: ${res.error} — ${"reason" in res ? res.reason : ""}`;
  }
  console.log("setup-bond txid", res.txid);

  const bond = await waitForFulfilled(async () => {
    const b = await fetchBond({ bondIndex, network });
    if (!b) throw "bond not on-chain yet";
    return b;
  });

  expect(bond).toBeDefined();
  expect(bond?.stxValueRatio).toBe(STX_VALUE_RATIO);
  expect(bond?.minUstxRatioBps).toBe(Number(MIN_USTX_RATIO_BPS));
});
