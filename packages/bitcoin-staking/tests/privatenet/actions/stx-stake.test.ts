/**
 * Privatenet STX-only stake action — empirical amount-floor probe.
 *
 * We proved from pox-5.clar SOURCE that `stake` has NO `min-amount-ustx` check;
 * the only amount guard is `ERR_INSUFFICIENT_STX (err u8)` (account balance).
 * This action CONFIRMS that on-chain by staking BELOW the API-advertised min
 * (10000.034 STX) and showing the tx is ACCEPTED.
 *
 * STAKER tx only (account6 by default). Does NOT touch bond-admin / setup-bond.
 *
 * Env overrides (all optional):
 *   STAKER      — REGTEST_KEYS account name        (default: "account6")
 *   AMOUNT_USTX — uSTX to lock                      (default: 1_000_000_000 = 1000 STX)
 *   NUM_CYCLES  — cycles to lock                    (default: 1)
 *
 * Run with:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     npx jest tests/privatenet/actions/stx-stake.test.ts --runInBand --collectCoverage=false --verbose
 */
import { broadcastTransaction } from "@stacks/transactions";
import fetchMock from "jest-fetch-mock";
import { buildStake } from "../../../src";
import { REGTEST_KEYS, getAccount } from "../../regtest/regtest";
import { getNetwork } from "../../helpers/utils";
import {
  ensurePox5,
  getNextNonce,
  getPoxInfo,
  getTransaction,
  waitForFulfilled,
} from "../../helpers/wait";
import { signTransaction } from "../../helpers/sign";

// Live private testnet — opt out of the globally-enabled jest-fetch-mock.
fetchMock.disableMocks();

jest.setTimeout(60 * 60_000);

const network = getNetwork();

const FEE = 10_000n;
const STAKER = process.env.STAKER ?? "account6";
const AMOUNT_USTX = BigInt(process.env.AMOUNT_USTX ?? 1_000_000_000); // 1000 STX
const NUM_CYCLES = Number(process.env.NUM_CYCLES ?? 1);

// The daemon-registered signer-manager on the private testnet.
const signerManager =
  "ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager";

const staker = getAccount(REGTEST_KEYS[STAKER as keyof typeof REGTEST_KEYS]);

beforeAll(async () => {
  await ensurePox5();
}, 60 * 60_000);

test("stake below API min is accepted on-chain (no contract amount floor)", async () => {
  const poxInfo = await getPoxInfo();

  // The contract's `stake` replay guard requires
  // `burn-height-to-reward-cycle(start-burn-ht) == current-cycle`, i.e.
  // start-burn-ht must fall in the CURRENT cycle (the contract then derives
  // first-reward-cycle = current + 1). A start height at the *next* cycle's
  // boundary is rejected with ERR_INVALID_START_BURN_HEIGHT (err u24).
  const startBurnHt = poxInfo.currentBurnchainBlockHeight;
  const targetCycle = poxInfo.rewardCycleId + 1;

  console.log("stx-stake params", {
    staker: staker.address,
    amountUstx: AMOUNT_USTX.toString(),
    amountStx: (Number(AMOUNT_USTX) / 1e6).toString(),
    apiMinStx: "10000.034",
    numCycles: NUM_CYCLES,
    currentCycle: poxInfo.rewardCycleId,
    targetCycle,
    currentBurnHt: poxInfo.currentBurnchainBlockHeight,
    startBurnHt,
    signerManager,
  });

  // No `signerCalldata`: the daemon signer-manager's `validate-stake!` accepts
  // an empty/none calldata (mirrors the regtest stx-staking action).
  const unsigned = await buildStake({
    signerManager,
    amountUstx: AMOUNT_USTX,
    numCycles: NUM_CYCLES,
    startBurnHt,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
  });

  const transaction = signTransaction(unsigned, staker.key);
  const res = await broadcastTransaction({ transaction, network });
  if ("error" in res) {
    throw `broadcast rejected: ${res.error} — ${"reason" in res ? res.reason : ""}`;
  }
  console.log("stx-stake txid", res.txid);

  // Wait until the tx leaves the mempool, then read the on-chain outcome.
  const tx = await waitForFulfilled(async () => {
    const t = await getTransaction(res.txid);
    if (!t || t.tx_status === "pending") throw "tx still pending";
    return t;
  });

  console.log("stx-stake on-chain result", {
    txid: tx.tx_id,
    tx_status: tx.tx_status,
    result_repr: tx.tx_result?.repr,
    burn_block_height: tx.burn_block_height,
  });

  expect(tx.tx_status).toBe("success");
});
