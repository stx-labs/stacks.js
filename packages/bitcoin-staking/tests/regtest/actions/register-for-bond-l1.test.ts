/**
 * Happy-path action for the **L1 (real Bitcoin)** `register-for-bond` flow — the
 * path that actually touches bitcoin. Drives admin → BTC lockup → staker end to
 * end against the live regtest pox-5:
 *
 *   1. setup-bond (admin)        — create bond `bondIndex`, allowlist the staker.
 *   2. fund L1 lockup (bitcoind) — send `MAX_SATS` to the P2WSH locking address
 *                                  derived from the staker's stx identity +
 *                                  the bond's L1 unlock height + early-unlock
 *                                  bytes ({@link buildLockingBitcoinAddress}).
 *   3. SPV proof (RPC, no Esplora) — once the BTC tx is mined AND the Stacks node
 *                                  has indexed that burn block, assemble the
 *                                  lockup proof from bitcoind via
 *                                  {@link assembleLockupProofFromBlock}.
 *   4. register-for-bond (staker) — lockup `{ kind: 'btc', outputs, unlockBytes }`.
 *   5. assert enrollment          — fetchBondMembership reflects an L1 lock.
 *
 * WHY THE NODE-INDEX WAIT: the contract verifies each output's merkle proof
 * against the burn block's merkle root, which it reads from the node's burnchain
 * state (`get-burn-block-info?`). If the node hasn't scanned the BTC block yet
 * that lookup is `none` and register aborts — so we wait for the node's burn
 * height to reach the lockup block height before registering. (On regtest the
 * header-hash check itself is a no-op, but the merkle-root lookup is not.)
 *
 * ENV PRECONDITIONS (owned by regtest-keeper, not this test): bond-admin ==
 * ACCOUNTS.admin, signer-manager registered, keep-alive staker disabled
 * (`POX5_STACKING_ENABLED=false`) so it doesn't race the shared admin account,
 * and the `main` bitcoind wallet funded (it is — the miner wallet).
 */
import {
  assembleLockupProofFromBlock,
  buildDefaultUnlockScript,
  buildLockingBitcoinAddress,
  buildLockupP2wshOutputScript,
  buildRegisterForBond,
  buildSetupBond,
  computeBondUnlockHeight,
  fetchBond,
  fetchBondMembership,
  fetchSignerInfo,
  minUstxForSatsAmount,
} from '../../../src';
import { ACCOUNTS, REGTEST_KEYS, SIGNER_MANAGER, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import {
  broadcastAndWait,
  ensurePox5,
  getNextNonce,
  waitForBurnBlockHeight,
  waitForFulfilled,
  waitForSignerManager,
} from '../../helpers/wait';
import { chooseBondWithRunway } from '../../helpers/bond';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';
import { getBtcTxProofInputs, sendToAddress } from '../../helpers/btc';

jest.setTimeout(20 * 60_000);

const network = getNetwork();
const admin = ACCOUNTS.admin; // bond-admin
// account5 is prefunded and untouched by any daemon (account4 is the sBTC test's
// staker), so this L1 test gets its own clean staker that isn't already enrolled.
const staker = getAccount(REGTEST_KEYS.account5);
const signerManager = SIGNER_MANAGER; // daemon-registered, staked signer-manager

/** Funded bitcoind wallet we lock BTC from (the env's miner wallet). */
const BTC_WALLET = 'main';

const MAX_SATS = 10_000n;
const FEE = 10_000n;

const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_SIGNERS = '00'.repeat(683); // bond's early-unlock-signers (683-byte buffer)

// Reuse a running chain (fresh-start only if down), then wait until the env's
// daemon has registered the signer-manager — the readiness signal for bonds.
beforeAll(async () => {
  useFixtures('register-for-bond-l1'); // record→this file / replay→install mocks (incl. bitcoind RPC)
  await ensurePox5();
  await waitForSignerManager(signerManager);
}, 20 * 60_000);

test('l1 register-for-bond happy path: setup-bond → fund BTC → prove → register → enrolled', async () => {
  // --- Preconditions (node read-only) ---------------------------------------
  const signerInfo = await fetchSignerInfo({ signerManager, network });
  if (!signerInfo) {
    throw new Error(`signer-manager ${signerManager} has no registered signer key — env not ready`);
  }
  const membershipBefore = await fetchBondMembership({ address: staker.address, network });
  expect(membershipBefore).toBeUndefined();

  // Extra runway: the L1 sequence also waits on a Bitcoin confirmation + the
  // node indexing that burn block, so leave more headroom before D0.
  const { bondIndex, bondStartHeight, poxInfo } = await chooseBondWithRunway(15);
  console.log('chosen bond', { bondIndex, bondStartHeight, burn: poxInfo.currentBurnchainBlockHeight });

  let adminNonce = await getNextNonce(admin.address);

  // --- 1. setup-bond (admin) ------------------------------------------------
  const setupUnsigned = await buildSetupBond({
    bondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
    earlyUnlockSigners: EARLY_UNLOCK_SIGNERS,
    earlyUnlockAdmin: admin.address,
    allowlist: [{ staker: staker.address, maxSats: MAX_SATS }],
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: adminNonce++,
    network,
  });
  const setupTransaction = signTransaction(setupUnsigned, admin.key);
  await broadcastAndWait(setupTransaction, admin.address, network);

  const bond = await fetchBond({ bondIndex, network });
  if (!bond) throw new Error('setup-bond aborted: bond not on-chain after confirmation');

  // --- 2. fund the L1 lockup output (bitcoind) ------------------------------
  // The lockup script commits to the staker's stx identity + the bond's L1 unlock
  // height + the staker's default unlock (pubkey) + the bond's early-unlock bytes.
  const unlockHeight = computeBondUnlockHeight({ bondIndex, poxInfo });
  const unlockBytes = buildDefaultUnlockScript(staker.publicKey);
  const lockupArgs = {
    stxAddress: staker.address,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes: EARLY_UNLOCK_SIGNERS,
  };
  // bcrt (regtest) address — getNetwork() is stacks-testnet, but the env's
  // bitcoind is regtest, so derive the BTC address against 'devnet' (= bcrt).
  const lockupAddress = buildLockingBitcoinAddress({ ...lockupArgs, network: 'devnet' });
  const btcTxid = await sendToAddress(BTC_WALLET, lockupAddress, Number(MAX_SATS) / 1e8);
  console.log('funded L1 lockup', { lockupAddress, btcTxid, unlockHeight });

  // --- 3. assemble the SPV proof (RPC) --------------------------------------
  // Wait until the tx is mined, then until the Stacks node has indexed that burn
  // block (so the contract's merkle-root lookup resolves).
  const proofInputs = await waitForFulfilled(() => getBtcTxProofInputs(BTC_WALLET, btcTxid));
  await waitForBurnBlockHeight(proofInputs.blockHeight);

  const expectedScript = buildLockupP2wshOutputScript(lockupArgs);
  const output = assembleLockupProofFromBlock({
    txHex: proofInputs.txHex,
    header: proofInputs.header,
    blockHeight: proofInputs.blockHeight,
    txids: proofInputs.txids,
    expectedScript,
  });
  expect(output.amount).toBe(MAX_SATS); // sats read from the funded output

  // --- 4. register-for-bond (staker, L1 lockup) -----------------------------
  const amountUstx = minUstxForSatsAmount({
    sats: MAX_SATS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
  });
  const registerUnsigned = await buildRegisterForBond({
    bondIndex,
    signerManager,
    amountUstx,
    lockup: { kind: 'btc', outputs: [output], unlockBytes },
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
    // L1 locks STX (not a token transfer) and sends no stacks asset, so no
    // post-condition is needed under the default deny mode.
  });
  const registerTransaction = signTransaction(registerUnsigned, staker.key);
  await broadcastAndWait(registerTransaction, staker.address, network);

  // Phase switch: register flips membership (same path none → enrolled).
  useFixtures('register-for-bond-l1-after');

  // --- 5. assert enrollment (node read-only) --------------------------------
  const membershipAfter = await fetchBondMembership({ address: staker.address, network });
  if (!membershipAfter) {
    throw new Error('register-for-bond aborted: no membership after confirmation');
  }
  expect(membershipAfter.bondIndex).toBe(bondIndex);
  expect(membershipAfter.isL1Lock).toBe(true); // L1-backed
  expect(membershipAfter.amountUstx).toBe(amountUstx);
});
