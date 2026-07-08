/**
 * Eligibility preflight coverage for `setup-bond`.
 * Gates: caller=admin, timing window, bond unused, no duplicate stakers.
 */
import { buildSetupBond, fetchEligibleSetupBond, Pox5ErrorCode, type PoxInfo } from '../../../src';
import { REGTEST_KEYS, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { useFixtures } from '../../helpers/mock';
import { broadcastAndWait, ensurePox5, getNextNonce, getPoxInfo } from '../../helpers/wait';
import { pickBondIndex } from '../../helpers/bond';
import { BOND_ADMIN_ADDRESS, getBondAdminAccount } from '../../helpers/bondAdmin';
import { signTransaction } from '../../helpers/sign';
jest.setTimeout(5 * 60_000);

const network = getNetwork();
const clean = getAccount(REGTEST_KEYS.account4);
const staker1 = clean.address;

// bondIndex 0 (the "always set up" first bond period) ages out of its own
// setup-bond window as the chain runs — past that window the preflight
// legitimately reports CannotSetupBondTooLate instead of/before
// BondAlreadySetup. Use the CURRENTLY open bond period instead, and make sure
// it's actually set up (idempotent: it may already be, from a contended
// shared chain) so "already setup" is exercised within its valid window.
let alreadySetupBondIndex: number;

beforeAll(async () => {
  useFixtures('eligibility-setup-bond');
  await ensurePox5();
  const admin = await getBondAdminAccount();
  const pox = await getPoxInfo();
  alreadySetupBondIndex = pickBondIndex(pox).bondIndex;
  const setupUnsigned = await buildSetupBond({
    bondIndex: alreadySetupBondIndex,
    targetRateBps: 1_000n,
    stxValueRatio: 1_000n,
    minUstxRatioBps: 500n,
    earlyUnlockBytes: '00'.repeat(683),
    allowlist: [{ staker: staker1, maxSats: 1000 }],
    publicKey: admin.publicKey,
    fee: 10_000n,
    nonce: await getNextNonce(admin.address),
    network,
  });
  // Idempotent: if another suite already set this bond up, this aborts
  // BondAlreadySetup, which is exactly the state we want for the test below.
  await broadcastAndWait(signTransaction(setupUnsigned, admin.key), admin.address, network);
}, 5 * 60_000);

test('Unauthorized — non-admin caller', async () => {
  const pox = await getPoxInfo();
  const { bondIndex } = pickBondIndex(pox);
  const r = await fetchEligibleSetupBond({
    bondIndex,
    allowlist: [{ staker: staker1, maxSats: 1000 }],
    caller: clean.address,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.Unauthorized);
});

test('BondAlreadySetup — bondIndex that already has a bond', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleSetupBond({
    bondIndex: alreadySetupBondIndex,
    allowlist: [{ staker: staker1, maxSats: 1000 }],
    caller: BOND_ADMIN_ADDRESS,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.BondAlreadySetup);
});

test('StakerAlreadyAdded — duplicate staker in allowlist', async () => {
  const pox = await getPoxInfo();
  const { bondIndex } = pickBondIndex(pox);
  const r = await fetchEligibleSetupBond({
    bondIndex,
    allowlist: [
      { staker: staker1, maxSats: 500 },
      { staker: staker1, maxSats: 500 }, // duplicate
    ],
    caller: BOND_ADMIN_ADDRESS,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.StakerAlreadyAdded);
});

test('CannotSetupBondTooSoon — far-future bondIndex outside registration window', async () => {
  const pox = await getPoxInfo();
  // bondIndex + 10 is far enough in the future to be outside the BOND_GAP_CYCLES window
  const { bondIndex } = pickBondIndex(pox);
  const r = await fetchEligibleSetupBond({
    bondIndex: bondIndex + 10,
    allowlist: [{ staker: staker1, maxSats: 1000 }],
    caller: BOND_ADMIN_ADDRESS,
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.CannotSetupBondTooSoon);
});

test('CannotSetupBondTooLate — poxInfo override puts burnHeight past bond start', async () => {
  const pox = await getPoxInfo();
  const { bondIndex } = pickBondIndex(pox);
  // Use a past bondIndex (0) with a burnHeight already past it
  const latePox: PoxInfo = {
    ...pox,
    currentBurnchainBlockHeight: pox.currentBurnchainBlockHeight + 10_000,
  };
  const r = await fetchEligibleSetupBond({
    bondIndex,
    allowlist: [{ staker: staker1, maxSats: 1000 }],
    caller: BOND_ADMIN_ADDRESS,
    poxInfo: latePox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.CannotSetupBondTooLate);
});
