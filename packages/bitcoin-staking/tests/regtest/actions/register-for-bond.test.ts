/**
 * Validation/abort action for `buildRegisterForBond` (sBTC path). Broadcasts a
 * register from a 0-sBTC account: `register-for-bond` evaluates the lockup match
 * first, so `lock-sbtc`'s `ft-transfer?` aborts with `(err u1)` (no balance)
 * before any bond/allowlist guard — proving the builder hits the real entrypoint
 * with correctly-encoded args. Complements the happy paths.
 *
 * Live-only (`RECORD=1`): asserts `tx_status` / `tx_result.repr` via `/extended`,
 * which has no node-only equivalent for an aborted tx — not wired for replay.
 */
import { buildRegisterForBond, fetchBondMembership, fetchSignerInfo } from '../../../src';
import { REGTEST_KEYS, SIGNER_MANAGER, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { broadcastAndWaitForTransaction, ensurePox5, getNextNonce } from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';

jest.setTimeout(20 * 60_000);

const network = getNetwork();
const staker = getAccount(REGTEST_KEYS.account4); // bond-admin: funded, holds 0 sBTC, never enrolled
const signerManager = SIGNER_MANAGER;

const BOND_INDEX = 0;
const AMOUNT_USTX = 1_000_000n;
const SBTC_SATS = 1_000n;
const FEE = 10_000n;

beforeAll(() => ensurePox5(), 20 * 60_000);

test('buildRegisterForBond (sbtc): serializes against the real ABI, aborts in lock-sbtc', async () => {
  expect(await fetchSignerInfo({ signerManager, network })).toBeDefined();
  expect(await fetchBondMembership({ address: staker.address, network })).toBeUndefined();

  const unsigned = await buildRegisterForBond({
    bondIndex: BOND_INDEX,
    signerManager,
    amountUstx: AMOUNT_USTX,
    lockup: { kind: 'sbtc', sbtcSats: SBTC_SATS },
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
  });

  const tx = signTransaction(unsigned, staker.key);
  const confirmed = await broadcastAndWaitForTransaction(tx, network);
  console.log('register-for-bond result', confirmed.tx_status, confirmed.tx_result.repr);

  expect(confirmed.tx_status).toBe('abort_by_response');
  expect(confirmed.tx_result.repr).toBe('(err u1)');
  expect(await fetchBondMembership({ address: staker.address, network })).toBeUndefined();
});
