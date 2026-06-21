/**
 * Eligibility preflight coverage for `grant-signer-key`.
 * Gates: SignerKeyGrantUsed (requires prior state — deferred), InvalidSignaturePubkey.
 * Both checks are pure local — no network calls beyond the grant-used lookup.
 */
import {
  fetchEligibleGrantSignerKey,
  Pox5ErrorCode,
} from '../../../src';
import { ACCOUNTS, SIGNER_MANAGER } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { useFixtures } from '../../helpers/mock';
import { ensurePox5 } from '../../helpers/wait';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
beforeAll(async () => {
  useFixtures('eligibility-grant-signer-key');
  await ensurePox5();
}, 5 * 60_000);

test('InvalidSignaturePubkey — all-zero signature does not recover to signerKey', async () => {
  // A zeroed 65-byte recoverable signature will either fail to recover or
  // recover to a different key — either way InvalidSignaturePubkey fires.
  const r = await fetchEligibleGrantSignerKey({
    signerKey: ACCOUNTS.sbtcDeployer.publicKey,
    signerManager: SIGNER_MANAGER,
    authId: 99999, // unlikely to have been used
    signerSignature: new Uint8Array(65), // invalid signature
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.InvalidSignaturePubkey);
});

// TODO(coverage): SignerKeyGrantUsed — requires the (signerKey, signerManager, authId)
// triple to have been previously consumed by a successful grant-signer-key call.
// Not achievable read-only without prior broadcast state.
