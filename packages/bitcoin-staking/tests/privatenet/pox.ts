/**
 * Private-testnet pox-5 reads that work around node-side quirks.
 *
 * The hosted private net (`api.private-1.hiro.so`) does NOT list pox-5 in
 * `/v2/pox` `contract_versions[]` (only pox-1..pox-4 appear), even though
 * `contract_id` correctly reports pox-5 as active. The SDK's
 * `firstPox5RewardCycle` therefore can't find the pox-5 row and falls back to
 * the *current* `rewardCycleId` — which DRIFTS every cycle.
 *
 * That drift is fatal for bond math: the contract anchors bond periods to a
 * FIXED `first-bond-period-cycle` data-var (set at deployment), so
 * `bond-period-to-reward-cycle(i) = firstBondPeriodCycle + i * BOND_GAP_CYCLES`.
 * With the drifting fallback, our computed bondIndex→cycle mapping disagrees
 * with the contract's, and `setup-bond` aborts with `(err u3)`
 * (`CannotSetupBondTooLate`) — the index we pick already opened on-chain.
 *
 * Fix here (privatenet-only): read the real `first-bond-period-cycle` data-var
 * straight off the node and use it as the anchor. On devnet/regtest the SDK's
 * `firstPox5RewardCycle` works correctly (contract_versions IS populated), so
 * production code stays untouched — this is a test-side shim for one node quirk.
 *
 * Colleagues: the node fix is to include pox-5 in `/v2/pox` contract_versions[]
 * with its real `first_reward_cycle_id` (= this data-var). Until then the SDK
 * fallback is unreliable for any bond-period math on this net.
 */
import { Cl } from "@stacks/transactions";
import { POX5_CONTRACT_NAME } from "../../src/constants";
import { ENV } from "../helpers/utils";

const POX5_CONTRACT_ADDRESS = "ST000000000000000000002AMW42H";

/**
 * The real `first-bond-period-cycle` for the active pox-5 deployment, read
 * directly from the contract data-var (node-only, no `/extended`). This is the
 * fixed anchor the contract uses for ALL bond-period math — use it instead of
 * `firstPox5RewardCycle(poxInfo)` whenever the node may not expose pox-5 in
 * `contract_versions[]`.
 */
export async function fetchFirstBondPeriodCycle(): Promise<number> {
  const res = await fetch(
    `${ENV.STACKS_API}/v2/data_var/${POX5_CONTRACT_ADDRESS}/${POX5_CONTRACT_NAME}/first-bond-period-cycle?proof=0`
  );
  if (!res.ok) {
    throw new Error(`GET first-bond-period-cycle → ${res.status}`);
  }
  const { data } = (await res.json()) as { data: string };
  const cv = Cl.deserialize(data);
  if (cv.type !== "uint") {
    throw new Error(`first-bond-period-cycle is not a uint: ${cv.type}`);
  }
  return Number(cv.value);
}
