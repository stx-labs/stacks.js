/**
 * Simplest action for the `buildSetupBond` helper: the bond admin creates a bond
 * at the correct time, then we read it back. Node-only (`/v2`): nonce from
 * `/v2/accounts`, confirmation by polling `fetchBond` (a read-only call) — no
 * `/extended`, no tx-status helpers.
 *
 * Requires the running chain to have `bond-admin == ACCOUNTS.admin` (set via the
 * env's `pox_5_bond_admin` config). The btc-staker daemon never touches bonds,
 * so it doesn't interfere.
 */
import { broadcastTransaction } from "@stacks/transactions";
import {
  BOND_GAP_CYCLES,
  bondPeriodToBurnHeight,
  buildSetupBond,
  fetchBond,
  firstPox5RewardCycle,
} from "../../../src";
import { ACCOUNTS, REGTEST_KEYS, getAccount } from "../regtest";
import { getNetwork } from "../../helpers/utils";
import {
  ensurePox5,
  getNextNonce,
  getPoxInfo,
  waitForFulfilled,
} from "../../helpers/wait";
import { signTransaction } from "../../helpers/sign";
import { useFixtures } from "../../helpers/mock";

jest.setTimeout(20 * 60_000);

const network = getNetwork();
const admin = ACCOUNTS.admin; // = bond-admin
const staker = getAccount(REGTEST_KEYS.account5); // clean; just an allowlist entry

const FEE = 10_000n;
const MAX_SATS = 10_000n;
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_SIGNERS = "00".repeat(683); // opaque; zero-filled is fine for sBTC bonds

// Record→replay via one fixtures file. The recorded `/v2/pox` fixes bondIndex
// deterministically; admin nonce, the broadcast (recorded txid), and fetchBond's
// `protocol-bonds` map_entry all replay. Mutation action, but reproduces offline.
beforeAll(async () => {
  useFixtures("setup-bond");
  await ensurePox5();
}, 20 * 60_000);

test("setup-bond: admin creates a bond at the correct time", async () => {
  // Pick the nearest future bond period with slack so we're inside setup-bond's
  // window [start - BOND_GAP_CYCLES*cycleLen, start) and confirm before start.
  const poxInfo = await getPoxInfo();
  const burn = poxInfo.currentBurnchainBlockHeight;
  const slack = Math.floor(poxInfo.rewardCycleLength / 2);

  const firstBondCycle = firstPox5RewardCycle(poxInfo);
  if (firstBondCycle === undefined) {
    throw new Error(
      "pox-5 missing from /v2/pox contract_versions[] — bond math has no firstBondPeriodCycle",
    );
  }

  // Nearest FUTURE bond period (computed from the current cycle, so it works at
  // any burn height), within BOND_GAP_CYCLES so setup-bond's window is open.
  let bondIndex = Math.max(
    0,
    Math.ceil((poxInfo.rewardCycleId - firstBondCycle + 1) / BOND_GAP_CYCLES),
  );
  while (bondPeriodToBurnHeight({ bondIndex, poxInfo }) <= burn + slack)
    bondIndex++;
  console.log("setup-bond", {
    bondIndex,
    burn,
    start: bondPeriodToBurnHeight({ bondIndex, poxInfo }),
  });

  const unsigned = await buildSetupBond({
    bondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
    earlyUnlockSigners: EARLY_UNLOCK_SIGNERS,
    earlyUnlockAdmin: admin.address,
    allowlist: [{ staker: staker.address, maxSats: MAX_SATS }],
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
  });

  const transaction = signTransaction(unsigned, admin.key);
  const res = await broadcastTransaction({ transaction, network });
  if ("error" in res) {
    throw new Error(
      `broadcast rejected: ${res.error} — ${"reason" in res ? res.reason : ""}`,
    );
  }
  console.log("setup-bond txid", res.txid);

  // Confirm via node read-only: poll until the bond is on-chain.
  const bond = await waitForFulfilled(async () => {
    const b = await fetchBond({ bondIndex, network });
    if (!b) throw new Error("bond not on-chain yet");
    return b;
  });

  expect(bond).toBeDefined();
  expect(bond?.stxValueRatio).toBe(STX_VALUE_RATIO);
  expect(bond?.minUstxRatioBps).toBe(Number(MIN_USTX_RATIO_BPS));
});
