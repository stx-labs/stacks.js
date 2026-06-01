import { makeSTXTokenTransfer } from "@stacks/transactions";
import { REGTEST_KEYS, getAccount } from "../regtest";
import { getNetwork } from "../../helpers/utils";
import {
  broadcastAndWaitForTransaction,
  getStxBalance,
} from "../../helpers/wait";

jest.setTimeout(180_000);

const AMOUNT = 1_000_000n; // 1 STX
const FEE = 1_000n;

const network = getNetwork();
const account1 = getAccount(REGTEST_KEYS.account1);
const account2 = getAccount(REGTEST_KEYS.account2);

test("transfer 1 STX from account1 to account2", async () => {
  const account1Before = await getStxBalance(account1.address);
  const account2Before = await getStxBalance(account2.address);
  console.log("before", { account1Before, account2Before });
  expect(account1Before).toBeGreaterThan(AMOUNT + FEE);

  const tx = await makeSTXTokenTransfer({
    recipient: account2.address,
    amount: AMOUNT,
    senderKey: account1.key,
    network,
    fee: FEE,
  });
  const confirmed = await broadcastAndWaitForTransaction(tx, network);
  expect(confirmed.tx_status).toBe("success");

  const account1After = await getStxBalance(account1.address);
  const account2After = await getStxBalance(account2.address);
  console.log("after", { account1After, account2After });

  expect(account2After).toBe(account2Before + AMOUNT);
  expect(account1After).toBe(account1Before - AMOUNT - FEE);
});
