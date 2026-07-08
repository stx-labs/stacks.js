/**
 * Eligibility preflight coverage for `register-for-bond`.
 * Every check is exercised via crafted inputs or poxInfo overrides — no broadcasts.
 */
import {
  BITCOIN_LOCKTIME_THRESHOLD,
  buildSetupBond,
  fetchEligibleRegisterForBond,
  Pox5ErrorCode,
  type PoxInfo,
} from '../../../src';
import { ACCOUNTS, REGTEST_KEYS, SIGNER_MANAGER, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { useFixtures } from '../../helpers/mock';
import {
  broadcastAndWait,
  ensurePox5,
  getNextNonce,
  getPoxInfo,
  waitForRewardPhase,
  waitForSignerManager,
} from '../../helpers/wait';
import { waitForBondWithRunway } from '../../helpers/bond';
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { signTransaction } from '../../helpers/sign';


jest.setTimeout(5 * 60_000);

const network = getNetwork();
// daemon-staked; allowlisted explicitly below (below the chain ages past
// whatever bond periods the env originally allowlisted it for) — use for
// TooMuchSats (where AlreadyStaked co-occurring is fine, `.toContain` only).
const staker = ACCOUNTS.sbtcDeployer.address;
// clean account — never staked, never in any allowlist
const clean = getAccount(REGTEST_KEYS.account4).address;
// allowlisted-but-never-staked account, dedicated to InsufficientStx: `staker`
// (daemon-staked) always trips AlreadyStaked, which co-occurs with (and can
// crowd out) the STX-balance gate under test.
const insufficientStxStaker = getAccount(REGTEST_KEYS.account19).address;
// non-existent signer-manager contract
const unknownSigner = `${clean}.signer-manager`;

// bondIndex freshly set up here (idempotent) with the stakers above
// allowlisted, so these checks don't depend on the env's original (long since
// aged-out) allowlisting for whichever bond period happens to be open when
// this suite runs. Picked with generous runway so it's still un-started by
// the time the later tests in this file run.
let openBondIndex: number;

beforeAll(async () => {
  useFixtures('eligibility-register-for-bond');
  await ensurePox5();
  await waitForSignerManager(SIGNER_MANAGER);
  const admin = await getBondAdminAccount();
  const { bondIndex } = await waitForBondWithRunway(35);
  openBondIndex = bondIndex;
  const setupUnsigned = await buildSetupBond({
    bondIndex: openBondIndex,
    targetRateBps: 1_000n,
    stxValueRatio: 1_000n,
    minUstxRatioBps: 500n,
    earlyUnlockBytes: '00'.repeat(683),
    allowlist: [
      { staker, maxSats: 999_999_999n },
      { staker: insufficientStxStaker, maxSats: 999_999_999n },
    ],
    publicKey: admin.publicKey,
    fee: 10_000n,
    nonce: await getNextNonce(admin.address),
    network,
  });
  // Idempotent: if this bond period is already set up (shared chain), this
  // aborts BondAlreadySetup and the stakers' allowlist state is whatever it
  // was — acceptable, since the tests below assert via `.toContain`, not
  // equality.
  await broadcastAndWait(signTransaction(setupUnsigned, admin.key), admin.address, network);
}, 5 * 60_000);

test('BondNotFound — bondIndex 200 has no setup bond', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleRegisterForBond({
    bondIndex: 200,
    staker: clean,
    amountUstx: 1_000_000n,
    satsTotal: 100n,
    signerManager: SIGNER_MANAGER,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.BondNotFound);
});

test('NotAllowlisted — clean account has no allowance on any bond', async () => {
  await waitForRewardPhase(await getPoxInfo()); // avoid a StakeInPreparePhase race
  const pox = await getPoxInfo();
  const bondIndex = openBondIndex;
  const r = await fetchEligibleRegisterForBond({
    bondIndex,
    staker: clean,
    amountUstx: 1_000_000n,
    satsTotal: 0n,
    signerManager: SIGNER_MANAGER,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.NotAllowlisted);
});

test('StakeInPreparePhase — poxInfo override puts burnHeight in prepare window', async () => {
  const pox = await getPoxInfo();
  const bondIndex = openBondIndex;
  // Craft a burnHeight that falls in the prepare phase
  const cycleEnd =
    (pox.rewardCycleId + 1) * pox.rewardCycleLength + pox.firstBurnchainBlockHeight;
  const prepareStart = cycleEnd - pox.prepareCycleLength;
  const prepPox: PoxInfo = { ...pox, currentBurnchainBlockHeight: prepareStart + 1 };
  const r = await fetchEligibleRegisterForBond({
    bondIndex,
    staker,
    amountUstx: 1_000_000n,
    satsTotal: 1n,
    signerManager: SIGNER_MANAGER,
    poxInfo: prepPox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.StakeInPreparePhase);
});

test('BondAlreadyStarted — poxInfo override pushes burnHeight past bond start', async () => {
  const pox = await getPoxInfo();
  const bondIndex = openBondIndex;
  // Place currentBurnchainBlockHeight well after the bond period start
  const farFuture: PoxInfo = {
    ...pox,
    currentBurnchainBlockHeight: pox.currentBurnchainBlockHeight + 10_000,
  };
  const r = await fetchEligibleRegisterForBond({
    bondIndex,
    staker,
    amountUstx: 1_000_000n,
    satsTotal: 1n,
    signerManager: SIGNER_MANAGER,
    poxInfo: farFuture,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.BondAlreadyStarted);
});

test('SignerNotFound — unknown signer-manager contract', async () => {
  const pox = await getPoxInfo();
  const bondIndex = openBondIndex;
  const r = await fetchEligibleRegisterForBond({
    bondIndex,
    staker,
    amountUstx: 1_000_000n,
    satsTotal: 1n,
    signerManager: unknownSigner,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.SignerNotFound);
});

test('InsufficientStx — amountUstx vastly exceeds any real balance', async () => {
  await waitForRewardPhase(await getPoxInfo()); // avoid a StakeInPreparePhase race
  const pox = await getPoxInfo();
  const bondIndex = openBondIndex;
  const r = await fetchEligibleRegisterForBond({
    bondIndex,
    staker: insufficientStxStaker,
    amountUstx: 10_000_000_000_000_000n,
    satsTotal: 1n,
    signerManager: SIGNER_MANAGER,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.InsufficientStx);
});

test('TooMuchSats — satsTotal exceeds the per-staker allowance', async () => {
  const pox = await getPoxInfo();
  const bondIndex = openBondIndex;
  // staker is allowlisted, fetch their allowance and exceed it
  const r = await fetchEligibleRegisterForBond({
    bondIndex,
    staker,
    amountUstx: 1_000_000n,
    satsTotal: 999_999_999_999n, // implausibly large; exceeds any real allowance
    signerManager: SIGNER_MANAGER,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.TooMuchSats);
});

test('DuplicateLockupOutpoint — same tx+outputIndex appears twice in outputs', async () => {
  const pox = await getPoxInfo();
  const bondIndex = openBondIndex;
  // Build a minimal tx bytes that serializeBitcoinTx / computeBitcoinTxid can parse.
  // A bare 4-byte version + varint(0 inputs) + varint(0 outputs) + 4-byte locktime = 10 bytes.
  // The txid is deterministic from these bytes; two outputs with identical tx and outputIndex
  // trigger the client-side dedup before any network call.
  const minimalTx = new Uint8Array([
    0x01, 0x00, 0x00, 0x00, // version = 1
    0x00,                   // input count = 0
    0x00,                   // output count = 0
    0x00, 0x00, 0x00, 0x00, // locktime = 0
  ]);
  const fakeOutput = {
    height: pox.currentBurnchainBlockHeight - 10,
    tx: minimalTx,
    outputIndex: 0,
    header: new Uint8Array(80), // zeroed header — triggers InvalidBtcHeader too
    leafHashes: [],
    txCount: 1,
    txIndex: 0,
    amount: 100n,
    unlockBurnHeight: pox.currentBurnchainBlockHeight + 1_000_000,
  };
  const r = await fetchEligibleRegisterForBond({
    bondIndex,
    staker,
    amountUstx: 1_000_000n,
    satsTotal: 200n,
    signerManager: SIGNER_MANAGER,
    outputs: [fakeOutput, fakeOutput], // duplicate outpoint
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.DuplicateLockupOutpoint);
});

test('InvalidBtcHeader — zeroed 80-byte header fails verify-block-header', async () => {
  const pox = await getPoxInfo();
  const bondIndex = openBondIndex;
  const minimalTx = new Uint8Array([
    0x01, 0x00, 0x00, 0x00,
    0x00,
    0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const fakeOutput = {
    height: pox.currentBurnchainBlockHeight - 10,
    tx: minimalTx,
    outputIndex: 0,
    header: new Uint8Array(80), // all-zeros — not a real block header
    leafHashes: [],
    txCount: 1,
    txIndex: 0,
    amount: 100n,
    unlockBurnHeight: pox.currentBurnchainBlockHeight + 1_000_000,
  };
  const r = await fetchEligibleRegisterForBond({
    bondIndex,
    staker,
    amountUstx: 1_000_000n,
    satsTotal: 100n,
    signerManager: SIGNER_MANAGER,
    outputs: [fakeOutput],
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.InvalidBtcHeader);
});

test('InvalidUnlockHeight — unlock-burn-height at/above BITCOIN_LOCKTIME_THRESHOLD is rejected but just below is not', async () => {
  const pox = await getPoxInfo();
  const bondIndex = openBondIndex;
  const minimalTx = new Uint8Array([
    0x01, 0x00, 0x00, 0x00,
    0x00,
    0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const baseOutput = {
    height: pox.currentBurnchainBlockHeight - 10,
    tx: minimalTx,
    outputIndex: 0,
    header: new Uint8Array(80),
    leafHashes: [],
    txCount: 1,
    txIndex: 0,
    amount: 100n,
  };
  const call = (unlockBurnHeight: number) =>
    fetchEligibleRegisterForBond({
      bondIndex,
      staker,
      amountUstx: 1_000_000n,
      satsTotal: 100n,
      signerManager: SIGNER_MANAGER,
      outputs: [{ ...baseOutput, unlockBurnHeight }],
      poxInfo: pox,
      network,
    });

  const threshold = Number(BITCOIN_LOCKTIME_THRESHOLD);
  // At and above the threshold → rejected.
  const at = await call(threshold);
  expect(at.ok).toBe(false);
  if (!at.ok) expect(at.reasons).toContain(Pox5ErrorCode.InvalidUnlockHeight);
  const above = await call(threshold + 1);
  expect(above.ok).toBe(false);
  if (!above.ok) expect(above.reasons).toContain(Pox5ErrorCode.InvalidUnlockHeight);
  // Just below the threshold → this gate does not flag (other gates may still fail).
  const below = await call(threshold - 1);
  if (!below.ok) expect(below.reasons).not.toContain(Pox5ErrorCode.InvalidUnlockHeight);
});

// TODO(coverage): AlreadyStaked needs daemon-staked sbtcDeployer to have an
// overlapping bond membership for the next bondIndex — read-only but the
// membership only exists after a successful register (state mutation). Achievable
// against live state if the daemon is registered for the target bond period;
// skip for now because it's timing-dependent.

// TODO(coverage): SignerKeyGrantNotFound needs a signer-manager that IS
// registered (fetchSignerInfo returns a signerKey) but whose grant was revoked or
// never issued — hard to engineer read-only without prior state setup.

// TODO(coverage): AlreadyRegistered — staker already has an active membership
// that overlaps the target bond period. Requires prior registration state.

// TODO(coverage): RolloverTooEarly — staker has a membership whose L1 unlock
// height is in the future. Requires an L1-lock membership.
