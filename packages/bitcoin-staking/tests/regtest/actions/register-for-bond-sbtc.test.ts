/**
 * Happy-path action for the sBTC `register-for-bond` flow — drives the full
 * admin → staker sequence end to end against the live regtest pox-5:
 *
 *   1. setup-bond (admin)           — create bond `bondIndex` with the staker
 *                                     allowlisted for `MAX_SATS`.
 *   2. deploy sbtc-deposit + mint    — give the staker `MAX_SATS` of sBTC in the
 *                                     admin-deployed `sbtc-token` the node points
 *                                     pox-5 at (see tests/helpers/sbtc.ts).
 *   3. register-for-bond (staker)    — lockup `{ kind: 'sbtc' }`, paired with the
 *                                     min uSTX the bond's ratios require.
 *   4. assert enrollment             — fetchBondMembership(staker) reflects it.
 *
 * Verification is node read-only / `/v2` only (no `/extended`): fetchBond,
 * fetchBondAllowance, fetchSbtcBalance, fetchBondMembership, fetchSignerInfo.
 *
 * TIMING. The bond index is chosen at run time from live `/v2/pox`, not
 * hardcoded: pox-5 gates `setup-bond` to the window
 * `[bondStart - BOND_GAP_CYCLES*cycleLen, bondStart)` and `register-for-bond` to
 * `burn < bondStart`. The chain mines fast (~1 block/sec), so we pick the
 * FURTHEST-out bond period whose setup-bond window is already open — maximizing
 * the runway (~BOND_GAP_CYCLES cycles) for the admin + mint + staker txs to all
 * confirm before D0 (`ERR_BOND_ALREADY_STARTED` / TOO_LATE). Each step confirms
 * node-only by nonce-advance, then reads its effect once (fail-fast on abort).
 *
 * ENV PRECONDITIONS (owned by regtest-keeper, not this test):
 *  - bond-admin == ACCOUNTS.admin (so setup-bond is authorized);
 *  - the env's btc-staker daemon has deployed `<admin>.sbtc-token` +
 *    `<admin>.sbtc-registry` and registered `<admin>.signer-manager`'s signer
 *    key (or this test deploys sBTC itself — admin is the deployer either way);
 *  - tx-broadcaster disabled and account4 pristine.
 * The test asserts the signer/token preconditions up front and skips with a
 * clear message if the env isn't in the expected shape, rather than failing
 * opaquely deep in a guard.
 */
import {
  buildRegisterForBond,
  buildSetupBond,
  fetchBond,
  fetchBondAllowance,
  fetchBondMembership,
  fetchSignerInfo,
  minUstxForSatsAmount,
} from '../../../src';
import { Pc } from '@stacks/transactions';
import { ACCOUNTS, REGTEST_KEYS, SIGNER_MANAGER, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { SBTC_ASSET_NAME, SBTC_TOKEN_CONTRACT } from '../../helpers/constants';
import {
  broadcastAndWait,
  ensurePox5,
  getNextNonce,
  getPoxInfo,
  waitForSignerManager,
} from '../../helpers/wait';
import { chooseBondWithRunway } from '../../helpers/bond';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';
import { deploySbtcMinter, mintSbtc, fetchSbtcBalance } from '../../helpers/sbtc';

jest.setTimeout(20 * 60_000);

const network = getNetwork();
const admin = ACCOUNTS.admin; // pox_5_bond_admin (clean nonce)
const sbtcDeployer = ACCOUNTS.sbtcDeployer; // STACKING_KEYS[0]: owns sbtc-token + the staked signer-manager
const staker = getAccount(REGTEST_KEYS.account6); // clean sBTC staker
const signerManager = SIGNER_MANAGER; // daemon-registered, staked signer-manager
const sbtcToken = SBTC_TOKEN_CONTRACT;

const MAX_SATS = 10_000n;
const FEE = 10_000n;

// setup-bond params. early-unlock-signers is a 683-byte buffer; the value is
// opaque to the sBTC path (no L1 lockup), so a zero-filled buffer suffices.
const TARGET_RATE_BPS = 1_000n; // 10% APY
const STX_VALUE_RATIO = 1_000n; // uSTX per 100 sats
const MIN_USTX_RATIO_BPS = 500n; // 5%
const EARLY_UNLOCK_SIGNERS = '00'.repeat(683);

// Reuse a running chain (fresh-start only if down), then wait until the env's
// daemon has registered the signer-manager — the readiness signal for bonds.
beforeAll(async () => {
  useFixtures('register-for-bond-sbtc'); // record→this file / replay→install mocks
  await ensurePox5();
  await waitForSignerManager(signerManager);
}, 20 * 60_000);

test('sbtc register-for-bond happy path: setup-bond → mint → register → enrolled', async () => {
  // --- Preconditions (node read-only) ---------------------------------------
  const signerInfo = await fetchSignerInfo({ signerManager, network });
  if (!signerInfo) {
    throw new Error(
      `signer-manager ${signerManager} has no registered signer key — env not ready ` +
        '(btc-staker daemon must have deployed + registered it)'
    );
  }

  const membershipBefore = await fetchBondMembership({ address: staker.address, network });
  expect(membershipBefore).toBeUndefined();

  // Mint shim is infra — deploy it up front (idempotent) so the admin nonce we
  // snapshot below covers only the bond txs and stays exact.
  // The shim must be deployed by the sBTC deployer so its `.sbtc-token` resolves
  // and the registry authorizes `<deployer>.sbtc-deposit` as deposit-role.
  await deploySbtcMinter({ deployerKey: sbtcDeployer.key, network });

  // Choose a bond period with enough runway before D0 for the whole sequence to
  // confirm (waits one boundary if we're too close — see chooseBondWithRunway).
  const { bondIndex, bondStartHeight, poxInfo } = await chooseBondWithRunway();
  console.log('chosen bond', { bondIndex, bondStartHeight, burn: poxInfo.currentBurnchainBlockHeight });

  // Manual nonce tracking: fetch each sender's nonce once, then increment inline
  // (avoids a /v2/accounts round-trip — and a mock entry — per tx).
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

  // broadcastAndWait waits until the tx is mined (sender nonce advanced), so
  // the effect is readable immediately — read ONCE and fail fast if it aborted
  // (e.g. the bond window closed under the fast chain), rather than polling.
  const bond = await fetchBond({ bondIndex, network });
  if (!bond) throw new Error('setup-bond aborted: bond not on-chain after confirmation');
  expect(bond.stxValueRatio).toBe(STX_VALUE_RATIO);
  expect(bond.minUstxRatioBps).toBe(Number(MIN_USTX_RATIO_BPS));

  const allowance = await fetchBondAllowance({ bondIndex, address: staker.address, network });
  expect(allowance).toBe(MAX_SATS);

  // --- 2. mint sBTC to the staker (shim already deployed above) -------------
  // Sent from the clean bond-admin (not the staked sBTC deployer) to avoid a
  // nonce race; the shim is what protocol-mint authorizes, not the tx sender.
  await mintSbtc({
    deployer: sbtcDeployer.address,
    sender: admin,
    recipient: staker.address,
    sats: MAX_SATS,
    nonce: adminNonce++,
    fee: FEE,
    network,
  });

  // mintSbtc confirms via nonce-advance, so the balance is readable once it returns.
  const sbtcBalance = await fetchSbtcBalance({ tokenContract: sbtcToken, address: staker.address, network });
  expect(sbtcBalance).toBeGreaterThanOrEqual(MAX_SATS);

  // --- 3. register-for-bond (staker, sBTC lockup) ---------------------------
  // Pair the minimum uSTX the bond's ratios require for MAX_SATS.
  const amountUstx = minUstxForSatsAmount({
    sats: MAX_SATS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
  });
  expect(amountUstx).toBeGreaterThan(0n);

  // Sanity: the bond must not have started yet (register asserts burn < start).
  const poxBeforeRegister = await getPoxInfo();
  expect(poxBeforeRegister.currentBurnchainBlockHeight).toBeLessThan(bondStartHeight);

  const registerNonce = await getNextNonce(staker.address);
  const registerUnsigned = await buildRegisterForBond({
    bondIndex,
    signerManager,
    amountUstx,
    lockup: { kind: 'sbtc', sbtcSats: MAX_SATS },
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: registerNonce,
    network,
    // lock-sbtc pulls exactly MAX_SATS of sBTC from the staker; cover it or the
    // default deny mode aborts the tx (abort_by_post_condition). The sBTC contract
    // is deploy-configured, so the caller supplies the post-condition.
    postConditions: [
      Pc.principal(staker.address).willSendEq(MAX_SATS).ft(sbtcToken, SBTC_ASSET_NAME),
    ],
  });
  const registerTransaction = signTransaction(registerUnsigned, staker.key);
  await broadcastAndWait(registerTransaction, staker.address, network);

  // Phase switch: register changed the membership + balance reads (same paths),
  // so the post-register snapshots record/replay from a separate fixtures file.
  useFixtures('register-for-bond-sbtc-after');

  // --- 4. assert enrollment (node read-only) --------------------------------
  // register is mined once broadcastAndWait returns; read membership ONCE and
  // fail fast if it aborted (e.g. bond already started) instead of polling.
  const membershipAfter = await fetchBondMembership({ address: staker.address, network });
  if (!membershipAfter) {
    throw new Error('register-for-bond aborted: no membership after confirmation');
  }
  expect(membershipAfter.bondIndex).toBe(bondIndex);
  expect(membershipAfter.isL1Lock).toBe(false); // sBTC-backed, not L1
  expect(membershipAfter.amountUstx).toBe(amountUstx);

  // The staker's sBTC was pulled into the pox-5 contract.
  const sbtcAfter = await fetchSbtcBalance({ tokenContract: sbtcToken, address: staker.address, network });
  expect(sbtcAfter).toBe(sbtcBalance - MAX_SATS);
});
