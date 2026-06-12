/**
 * Read-only smoke tests against the private testnet. Waits for pox-5 to be
 * active (no reset — it's a live chain). Only tests what this node CAN execute:
 *
 * - fetchAccountStatus  ✓  — plain /v2/accounts, no contract execution
 * - fetchStakerInfo     ✗  — pox-5 read-only: blocked until pox-5 activates
 * - fetchBondMembership ✗  — pox-5 read-only: blocked until pox-5 activates
 *   (error once pox-5 IS active: CostBalanceExceeded — node read_length cap 100 KB)
 *
 * Run with the private testnet combo:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so RECORD=1 \
 *     npx jest tests/privatenet/actions/reads.test.ts --runInBand --collectCoverage=false
 */
import {
  fetchAccountStatus,
  fetchBondMembership,
  fetchPoxInfo,
  fetchStakerInfo,
} from "../../../src";
import { REGTEST_KEYS, getAccount } from "../../regtest/regtest";
import { getNetwork } from "../../helpers/utils";
import { ensurePox5 } from "../../helpers/wait";

// Long timeout: on this net we don't know how far away pox-5 activation is.
jest.setTimeout(30 * 60_000);

const network = getNetwork();
// account4 = bond-admin: funded, daemon-free, nonce-stable — best read target.
const account = getAccount(REGTEST_KEYS.account4);

beforeAll(async () => {
  // Reuses the live chain if pox-5 is already active; otherwise polls.
  // On devnet this would reset; here NETWORK=testnet so it just waits.
  await ensurePox5();
}, 30 * 60_000);

test("fetchAccountStatus: funded and unlocked", async () => {
  const status = await fetchAccountStatus({ address: account.address, network });
  console.log("account status", status);
  expect(status.balance).toBeGreaterThan(0n);
  expect(status.locked).toBe(0n);
  expect(status.unlockHeight).toBe(0);
});

test("fetchPoxInfo: pox-5 active", async () => {
  const pox = await fetchPoxInfo({ network });
  console.log("pox info", { contractId: pox.contractId, cycle: pox.rewardCycleId, isPoxActive: pox.currentCycle.isPoxActive });
  expect(pox.contractId).toContain("pox-5");
  expect(pox.currentCycle.isPoxActive).toBe(true);
});

// pox-5 read-only calls may hit the node's 100 KB read_length cap once the
// contract accumulates stacker/bond state. On a fresh chain they succeed fine.
test("fetchStakerInfo: account4 not staked", async () => {
  const info = await fetchStakerInfo({ address: account.address, network });
  console.log("staker info", info);
  expect(info.staked).toBe(false);
});

test("fetchBondMembership: account4 has no bond", async () => {
  const membership = await fetchBondMembership({ address: account.address, network });
  console.log("bond membership", membership);
  expect(membership).toBeUndefined();
});
