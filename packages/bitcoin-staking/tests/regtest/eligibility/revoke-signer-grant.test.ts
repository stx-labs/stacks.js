/**
 * Eligibility preflight coverage for `revoke-signer-grant`.
 * Only gate: caller must be the Stacks principal derived from signerKey.
 * Pure local check — no network calls.
 */
import {
  fetchEligibleRevokeSignerGrant,
  Pox5ErrorCode,
} from '../../../src';
import { ACCOUNTS, REGTEST_KEYS, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { useFixtures } from '../../helpers/mock';
import { ensurePox5 } from '../../helpers/wait';
import { getAddressFromPublicKey } from '@stacks/transactions';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
const clean = getAccount(REGTEST_KEYS.account4);

beforeAll(async () => {
  useFixtures('eligibility-revoke-signer-grant');
  await ensurePox5();
}, 5 * 60_000);

test('Unauthorized — caller does not match address derived from signerKey', async () => {
  const r = await fetchEligibleRevokeSignerGrant({
    signerKey: ACCOUNTS.sbtcDeployer.publicKey,
    caller: clean.address, // wrong — not the address derived from sbtcDeployer.publicKey
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.Unauthorized);
});

test('ok: true — caller matches address derived from signerKey', async () => {
  const expected = getAddressFromPublicKey(ACCOUNTS.sbtcDeployer.publicKey, 'testnet');
  const r = await fetchEligibleRevokeSignerGrant({
    signerKey: ACCOUNTS.sbtcDeployer.publicKey,
    caller: expected,
    network,
  });
  expect(r.ok).toBe(true);
});
