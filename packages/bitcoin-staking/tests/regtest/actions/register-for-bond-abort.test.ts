/**
 * Validation/abort action for `buildRegisterForBond` (sBTC path). Broadcasts a
 * register against bond-period 0: in the current pox-5 the bond lookup runs
 * before the lockup logic, and period 0 is always in the past on a live chain,
 * so the tx deterministically aborts with `ERR_BOND_NOT_FOUND (err u7)` —
 * proving the builder hits the real entrypoint with correctly-encoded args.
 * Complements the happy paths.
 *
 * Records/replays like the adversarial suite: the abort result is read via
 * `/extended/v1/tx/<txid>` (unique per txid), captured into its own fixture.
 */
import { buildRegisterForBond, fetchBondMembership, fetchSignerInfo } from '../../../src';
import { REGTEST_KEYS, SIGNER_MANAGER, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { broadcastAndWaitForTransaction, ensurePox5, getNextNonce } from '../../helpers/wait';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
const staker = getAccount(REGTEST_KEYS.account4); // bond-admin: funded, holds 0 sBTC, never enrolled
const signerManager = SIGNER_MANAGER;

const BOND_INDEX = 0;
const AMOUNT_USTX = 1_000_000n;
const SBTC_SATS = 1_000n;
const FEE = 10_000n;

beforeAll(async () => {
  useFixtures('register-for-bond-abort');
  await ensurePox5();
}, 5 * 60_000);

test('buildRegisterForBond (sbtc): serializes against the real ABI, aborts on bond lookup', async () => {
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
  expect(confirmed.tx_result.repr).toBe('(err u7)'); // ERR_BOND_NOT_FOUND
  expect(await fetchBondMembership({ address: staker.address, network })).toBeUndefined();
});
