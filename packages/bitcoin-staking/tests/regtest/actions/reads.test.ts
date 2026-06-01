/**
 * Node read-only smoke tests (`fetchAccountStatus` / `fetchStakerInfo` /
 * `fetchBondMembership`) against a stable account. Record→replay via
 * `useFixtures('reads')`; call-reads are keyed by sender now, so the account is
 * unambiguous in the fixtures.
 */
import { fetchAccountStatus, fetchBondMembership, fetchStakerInfo } from '../../../src';
import { REGTEST_KEYS, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { useFixtures } from '../../helpers/mock';
import { ensurePox5 } from '../../helpers/wait';

jest.setTimeout(20 * 60_000);

const network = getNetwork();
// account4 = bond-admin: funded, unlocked, never staked or enrolled → a stable,
// unambiguous read target.
const account = getAccount(REGTEST_KEYS.account4);

beforeAll(async () => {
  useFixtures('reads');
  await ensurePox5();
}, 20 * 60_000);

test('fetchAccountStatus: funded and unlocked', async () => {
  const status = await fetchAccountStatus({ address: account.address, network });
  expect(status.balance).toBeGreaterThan(0n);
  expect(status.locked).toBe(0n);
  expect(status.unlockHeight).toBe(0);
});

test('fetchStakerInfo: unstaked', async () => {
  const info = await fetchStakerInfo({ address: account.address, network });
  expect(info.staked).toBe(false);
});

test('fetchBondMembership: none', async () => {
  const membership = await fetchBondMembership({ address: account.address, network });
  expect(membership).toBeUndefined();
});
