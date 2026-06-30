/**
 * Eligibility preflight coverage for `set-bond-admin`.
 * Only gate: caller must be the current bond-admin.
 */
import { fetchEligibleSetBondAdmin, Pox5ErrorCode } from '../../../src';
import { REGTEST_KEYS, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { useFixtures } from '../../helpers/mock';
import { ensurePox5 } from '../../helpers/wait';
import { BOND_ADMIN_ADDRESS } from '../../helpers/bondAdmin';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
const clean = getAccount(REGTEST_KEYS.account4);

beforeAll(async () => {
  useFixtures('eligibility-set-bond-admin');
  await ensurePox5();
}, 5 * 60_000);

test('Unauthorized — non-admin caller', async () => {
  const r = await fetchEligibleSetBondAdmin({
    caller: clean.address,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.Unauthorized);
});

test('ok: true — bond-admin caller', async () => {
  const r = await fetchEligibleSetBondAdmin({
    caller: BOND_ADMIN_ADDRESS,
    network,
  });
  expect(r.ok).toBe(true);
});
