/**
 * L1 (real Bitcoin) `register-for-bond` happy path — the path that touches
 * bitcoin: admin creates a bond, the staker funds a P2WSH lockup output on
 * bitcoind, an SPV proof is assembled from RPC (no Esplora), and register-for-bond
 * with `{ kind: 'btc' }` enrolls them.
 *
 * After the BTC tx is mined we wait for the Stacks node to index that burn block:
 * the contract reads the block's merkle root from burnchain state
 * (`get-burn-block-info?`), which is `none` until the node has scanned it.
 *
 * Env preconditions: bond-admin == ACCOUNTS.admin, SIGNER_MANAGER registered, and
 * the `main` bitcoind (miner) wallet funded.
 */
import {
  buildLockProofFromBlock,
  buildUnlockScript,
  buildLockAddress,
  buildLockOutputScript,
  buildRegisterForBond,
  buildSetupBond,
  computeBondUnlockHeight,
  fetchBond,
  fetchBondMembership,
  fetchSignerInfo,
  minUstxForSatsAmount,
} from "../../../src";
import { ACCOUNTS, REGTEST_KEYS, SIGNER_MANAGER, getAccount } from "../regtest";
import { getNetwork } from "../../helpers/utils";
import {
  broadcastAndWait,
  ensurePox5,
  getNextNonce,
  waitForBurnBlockHeight,
  waitForFulfilled,
  waitForSignerManager,
} from "../../helpers/wait";
import { waitForBondWithRunway } from "../../helpers/bond";
import { useFixtures } from "../../helpers/mock";
import { signTransaction } from "../../helpers/sign";
import { getBtcTxProofInputs, sendToAddress } from "../../helpers/btc";

jest.setTimeout(20 * 60_000);

const network = getNetwork();
const admin = ACCOUNTS.admin;
const staker = getAccount(REGTEST_KEYS.account5);
const signerManager = SIGNER_MANAGER;

const MAX_SATS = 10_000n;
const FEE = 10_000n;
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = "00".repeat(683);

beforeAll(async () => {
  useFixtures("register-for-bond-l1");
  await ensurePox5();
  await waitForSignerManager(signerManager);
}, 20 * 60_000);

test("l1 register-for-bond happy path: setup-bond → fund BTC → prove → register → enrolled", async () => {
  const signerInfo = await fetchSignerInfo({ signerManager, network });
  if (!signerInfo) throw `${signerManager} not registered`;

  expect(
    await fetchBondMembership({ address: staker.address, network }),
  ).toBeUndefined();

  // Extra runway: L1 also waits on a BTC confirmation + node indexing before D0.
  const { bondIndex, bondStartHeight, poxInfo } =
    await waitForBondWithRunway(15);
  console.log("chosen bond", {
    bondIndex,
    bondStartHeight,
    burn: poxInfo.currentBurnchainBlockHeight,
  });

  let adminNonce = await getNextNonce(admin.address);

  // SETUP BOND
  const setupUnsigned = await buildSetupBond({
    bondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist: [{ staker: staker.address, maxSats: MAX_SATS }],
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: adminNonce++,
    network,
  });
  const setupTransaction = signTransaction(setupUnsigned, admin.key);
  await broadcastAndWait(setupTransaction, admin.address, network);

  const bond = await fetchBond({ bondIndex, network });
  if (!bond) throw "setup-bond aborted";

  // FUND LOCKUP
  const unlockHeight = computeBondUnlockHeight({ bondIndex, poxInfo });
  const unlockBytes = buildUnlockScript(staker.publicKey);
  const lockupArgs = {
    stxAddress: staker.address,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
  };
  // regtest BTC addresses are bcrt (devnet), not the stacks-testnet network.
  const lockupAddress = buildLockAddress({
    ...lockupArgs,
    network: "devnet",
  });
  const btcTxid = await sendToAddress(lockupAddress, Number(MAX_SATS) / 1e8);
  console.log("funded L1 lockup", { lockupAddress, btcTxid, unlockHeight });

  // SPV PROOF
  const proofInputs = await waitForFulfilled(() =>
    getBtcTxProofInputs(btcTxid),
  );
  await waitForBurnBlockHeight(proofInputs.blockHeight);
  const output = buildLockProofFromBlock({
    txHex: proofInputs.txHex,
    header: proofInputs.header,
    blockHeight: proofInputs.blockHeight,
    txids: proofInputs.txids,
    expectedScript: buildLockOutputScript(lockupArgs),
  });
  expect(output.amount).toBe(MAX_SATS);

  // REGISTER
  const amountUstx = minUstxForSatsAmount({
    sats: MAX_SATS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
  });
  // No post-condition: L1 locks STX (a pox lock, not a token transfer).
  const registerUnsigned = await buildRegisterForBond({
    bondIndex,
    signerManager,
    amountUstx,
    lockup: { kind: "btc", outputs: [output], unlockBytes },
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
  });
  const registerTransaction = signTransaction(registerUnsigned, staker.key);
  await broadcastAndWait(registerTransaction, staker.address, network);

  useFixtures("register-for-bond-l1-after");

  const membershipAfter = await fetchBondMembership({
    address: staker.address,
    network,
  });
  if (!membershipAfter) throw "register-for-bond aborted";
  expect(membershipAfter.bondIndex).toBe(bondIndex);
  expect(membershipAfter.isL1Lock).toBe(true);
  expect(membershipAfter.amountUstx).toBe(amountUstx);
});
