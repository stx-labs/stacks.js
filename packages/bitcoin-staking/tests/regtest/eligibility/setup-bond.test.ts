/**
 * Eligibility preflight coverage for `setup-bond`.
 * Gates: caller=admin, timing window, bond unused, no duplicate stakers.
 */
import { fetchEligibleSetupBond, Pox5ErrorCode, type PoxInfo } from '../../../src';
import { REGTEST_KEYS, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { useFixtures } from '../../helpers/mock';
import { ensurePox5, getPoxInfo } from '../../helpers/wait';
import { pickBondIndex } from '../../helpers/bond';
import { BOND_ADMIN_ADDRESS } from '../../helpers/bondAdmin';
jest.setTimeout(5 * 60_000);

const network = getNetwork();
const clean = getAccount(REGTEST_KEYS.account4);
const staker1 = clean.address;

beforeAll(async () => {
  useFixtures('eligibility-setup-bond');
  await ensurePox5();
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
  // bondIndex 0 is always set up in the regtest env (first bond period)
  const r = await fetchEligibleSetupBond({
    bondIndex: 0,
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
