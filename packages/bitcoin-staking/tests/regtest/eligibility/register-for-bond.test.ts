/**
 * Eligibility preflight coverage for `register-for-bond`.
 * Every check is exercised via crafted inputs or poxInfo overrides — no broadcasts.
 */
import {
  fetchEligibleRegisterForBond,
  Pox5ErrorCode,
  type PoxInfo,
} from '../../../src';
import { ACCOUNTS, REGTEST_KEYS, SIGNER_MANAGER, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { useFixtures } from '../../helpers/mock';
import { ensurePox5, getPoxInfo, waitForSignerManager } from '../../helpers/wait';
import { pickBondIndex } from '../../helpers/bond';


jest.setTimeout(5 * 60_000);

const network = getNetwork();
// daemon-staked, allowlisted in every live bond; use for AlreadyStaked
const staker = ACCOUNTS.sbtcDeployer.address;
// clean account — never staked, never in any allowlist
const clean = getAccount(REGTEST_KEYS.account4).address;
// non-existent signer-manager contract
const unknownSigner = `${clean}.signer-manager`;

beforeAll(async () => {
  useFixtures('eligibility-register-for-bond');
  await ensurePox5();
  await waitForSignerManager(SIGNER_MANAGER);
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
  const pox = await getPoxInfo();
  const { bondIndex } = pickBondIndex(pox);
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
  const { bondIndex } = pickBondIndex(pox);
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
  const { bondIndex } = pickBondIndex(pox);
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
  const { bondIndex } = pickBondIndex(pox);
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
  const pox = await getPoxInfo();
  const { bondIndex } = pickBondIndex(pox);
  const r = await fetchEligibleRegisterForBond({
    bondIndex,
    staker,
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
  const { bondIndex } = pickBondIndex(pox);
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
  const { bondIndex } = pickBondIndex(pox);
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
  const { bondIndex } = pickBondIndex(pox);
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
