/**
 * Simplest `buildSetupBond` action: the admin creates a bond at the correct time
 * and we read it back. Node-only; confirmed by polling `fetchBond`.
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
const admin = ACCOUNTS.admin;
const staker = getAccount(REGTEST_KEYS.account5); // just an allowlist entry

const FEE = 10_000n;
const MAX_SATS = 10_000n;
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = "00".repeat(683);

beforeAll(async () => {
  useFixtures("setup-bond");
  await ensurePox5();
}, 20 * 60_000);

test("setup-bond: admin creates a bond at the correct time", async () => {
  // Nearest future bond period whose setup-bond window is open (computed from the
  // current cycle, so it works at any burn height).
  const poxInfo = await getPoxInfo();
  const burn = poxInfo.currentBurnchainBlockHeight;
  const slack = Math.floor(poxInfo.rewardCycleLength / 2);

  const firstBondCycle = firstPox5RewardCycle(poxInfo);
  if (firstBondCycle === undefined) {
    throw 'pox-5 missing from /v2/pox contract_versions[] — no firstBondPeriodCycle';
  }

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
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist: [{ staker: staker.address, maxSats: MAX_SATS }],
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
