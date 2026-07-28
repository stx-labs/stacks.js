/**
 * Combined single-bond action: ONE bond, two participants — user A locks via L1
 * (real BTC), user B via sBTC. Checks both wallets at each step, and that the
 * global sBTC-staked total rises by exactly user B's sats (an L1 leg adds none).
 *
 * Memberships flip over time, so each post-register snapshot records/replays from
 * its own phase file (`…-a`, `…-b`); call-reads are sender-keyed so the two
 * stakers don't collide.
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
  fetchBondAllowance,
  fetchBondMembership,
  fetchEligibleRegisterForBond,
  fetchTotalSbtcStaked,
  fetchVerifyBlockHeader,
  minUstxForSatsAmount,
} from '../../../src';
import { ACCOUNTS, REGTEST_KEYS, SIGNER_MANAGER, getAccount, type Account } from '../regtest';
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { getNetwork } from '../../helpers/utils';
import {
  broadcastAndWait,
  ensurePox5,
  fundStx,
  getNextNonce,
  getPoxInfo,
  waitForBurnBlockHeight,
  waitForFulfilled,
  waitForSignerManager,
} from '../../helpers/wait';
import { waitForBondWithRunway } from '../../helpers/bond';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';
import { getBtcTxProofInputs, sendToAddress } from '../../helpers/btc';
import { deploySbtcMinter, mintSbtc } from '../../helpers/sbtc';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
let admin: Account;
const sbtcDeployer = ACCOUNTS.sbtcDeployer; // owns sbtc-token + the staked signer-manager
const userA = getAccount(REGTEST_KEYS.account17); // L1 staker
const userB = getAccount(REGTEST_KEYS.account18); // sBTC staker
const signerManager = SIGNER_MANAGER;

const MAX_SATS = 10_000n;
const FEE = 10_000n;
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);

beforeAll(async () => {
  admin = await getBondAdminAccount();
  useFixtures('register-for-bond-combined');
  await ensurePox5();
  await waitForSignerManager(signerManager);
  await fundStx({
    funder: admin,
    recipient: userA.address,
    amountUstx: 10_000_000n,
    nonce: await getNextNonce(admin.address),
    network,
  });
  await fundStx({
    funder: admin,
    recipient: userB.address,
    amountUstx: 10_000_000n,
    nonce: await getNextNonce(admin.address),
    network,
  });
  await deploySbtcMinter({ deployerKey: sbtcDeployer.key, network });
  await mintSbtc({
    deployer: sbtcDeployer.address,
    sender: admin,
    recipient: userB.address,
    sats: MAX_SATS,
    nonce: await getNextNonce(admin.address),
    fee: FEE,
    network,
  });
}, 5 * 60_000);

test('one bond, two participants: user A (L1) + user B (sBTC)', async () => {
  expect(await fetchBondMembership({ address: userA.address, network })).toBeUndefined();
  expect(await fetchBondMembership({ address: userB.address, network })).toBeUndefined();

  const { bondIndex, bondStartHeight, poxInfo } = await waitForBondWithRunway(15);
  console.log('chosen bond', {
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
    allowlist: [
      { staker: userA.address, maxSats: MAX_SATS },
      { staker: userB.address, maxSats: MAX_SATS },
    ],
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: adminNonce++,
    network,
  });
  await broadcastAndWait(signTransaction(setupUnsigned, admin.key), admin.address, network);

  const bond = await fetchBond({ bondIndex, network });
  if (!bond) throw 'setup-bond aborted';
  expect(await fetchBondAllowance({ bondIndex, address: userA.address, network })).toBe(MAX_SATS);
  expect(await fetchBondAllowance({ bondIndex, address: userB.address, network })).toBe(MAX_SATS);

  const totalBefore = await fetchTotalSbtcStaked({ network });
  const amountUstx = minUstxForSatsAmount({
    sats: MAX_SATS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
  });

  // USER A (L1)
  const unlockHeight = computeBondUnlockHeight({ bondIndex, poxInfo });
  const unlockBytes = buildUnlockScript(userA.publicKey);
  const lockupArgs = {
    stxAddress: userA.address,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    validateEarlyUnlockBytes: false, // dummy all-OP_0 blob, not a CHECKSIG template
  };
  const lockupAddress = buildLockAddress({ ...lockupArgs, network: 'devnet' }); // bcrt (regtest)
  const btcTxid = await sendToAddress(lockupAddress, Number(MAX_SATS) / 1e8);
  const proof = await waitForFulfilled(() => getBtcTxProofInputs(btcTxid));
  await waitForBurnBlockHeight(proof.blockHeight);
  // The burn tip reaching the block is not enough: read-onlys evaluate at the
  // STACKS tip, whose burn view lags several burn blocks at regtest cadence, so
  // `get-burn-block-info?` still returns `none` and both the preflight and the
  // on-chain register would false-negative with InvalidBtcHeader (u40).
  await waitForFulfilled(async () => {
    const visible = await fetchVerifyBlockHeader({
      header: proof.header,
      burnHeight: proof.blockHeight,
      network,
    });
    if (!visible) throw new Error('lockup burn block not yet visible at stacks tip');
  });
  const output = buildLockProofFromBlock({
    txHex: proof.txHex,
    header: proof.header,
    blockHeight: proof.blockHeight,
    txids: proof.txids,
    unlockHeight,
    outputScript: buildLockOutputScript(lockupArgs),
  });
  // Omit `outputs`: the helper only partially verifies the SPV proof read-only;
  // the real proof is proven by the broadcast + membership assertion below.
  const poxBeforeA = await getPoxInfo();
  const eligibleA = await fetchEligibleRegisterForBond({
    bondIndex,
    staker: userA.address,
    amountUstx,
    lockup: { kind: 'btc', outputs: [output], unlockBytes },
    signerManager,
    poxInfo: poxBeforeA,
    network,
  });
  if (!eligibleA.ok) console.log('userA register preflight reasons', eligibleA.reasons);
  expect(eligibleA.ok).toBe(true);

  const regA = await buildRegisterForBond({
    bondIndex,
    signerManager,
    amountUstx,
    lockup: { kind: 'btc', outputs: [output], unlockBytes },
    publicKey: userA.publicKey,
    fee: FEE,
    nonce: await getNextNonce(userA.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(signTransaction(regA, userA.key), userA.address, network);

  useFixtures('register-for-bond-combined-a');

  const mA1 = await fetchBondMembership({ address: userA.address, network });
  expect(mA1?.isL1Lock).toBe(true);
  expect(await fetchBondMembership({ address: userB.address, network })).toBeUndefined();

  // USER B (sBTC)
  const poxBeforeB = await getPoxInfo();
  const eligibleB = await fetchEligibleRegisterForBond({
    bondIndex,
    staker: userB.address,
    amountUstx,
    lockup: { kind: 'sbtc', sbtcSats: MAX_SATS },
    signerManager,
    poxInfo: poxBeforeB,
    network,
  });
  expect(eligibleB.ok).toBe(true);

  const regB = await buildRegisterForBond({
    bondIndex,
    signerManager,
    amountUstx,
    lockup: { kind: 'sbtc', sbtcSats: MAX_SATS },
    publicKey: userB.publicKey,
    fee: FEE,
    nonce: await getNextNonce(userB.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(signTransaction(regB, userB.key), userB.address, network);

  useFixtures('register-for-bond-combined-b');

  const mA2 = await fetchBondMembership({ address: userA.address, network });
  const mB2 = await fetchBondMembership({ address: userB.address, network });
  expect(mA2?.isL1Lock).toBe(true);
  expect(mB2?.isL1Lock).toBe(false);
  expect(mB2?.bondIndex).toBe(bondIndex);

  const totalAfter = await fetchTotalSbtcStaked({ network });
  expect(totalAfter).toBe(totalBefore + MAX_SATS); // only B's sBTC; A is L1
});
