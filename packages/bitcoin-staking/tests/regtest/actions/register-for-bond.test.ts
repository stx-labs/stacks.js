/**
 * Builder-validation action for `buildRegisterForBond` (sBTC lockup path).
 *
 * SCOPE — option (2) from the brief, not the full happy path. The full happy
 * path is blocked on this env: the node ships `pox-5` with `bond-admin` still
 * set to the burn placeholder (`/v2/data_var .../bond-admin` →
 * `ST000…002AMW42H`), i.e. it was NOT rewritten to a controllable admin at
 * deploy. With no account able to call `set-bond-admin` → `setup-bond`, no bond
 * (and no allowlist entry) can be created, so a successful `register-for-bond`
 * is unreachable here. See the message to team-lead for the SDK-gap note.
 *
 * What this proves instead: the builder serializes `register-for-bond` against
 * the real pox-5 ABI correctly — right contract/boot-address, function name,
 * and arg encoding, including the sBTC-lockup shape `(err uint)` and the
 * `signer-manager` trait principal. We broadcast it from an idle, funded
 * account that holds **0 sBTC** and let the contract run.
 *
 * GUARD HIT: `register-for-bond`'s `let` bindings evaluate the lockup match
 * first (pox-5.clar L563-566), so for the sBTC branch `lock-sbtc` runs *before*
 * any bond/allowlist guard. `lock-sbtc` calls `sbtc-token.transfer`, whose
 * `ft-transfer?` aborts with `(err u1)` when the sender has no sBTC. The error
 * propagates via `try!`, so the tx confirms with `tx_status =
 * abort_by_response` and `tx_result.repr = (err u1)`. This means we exercised
 * the contract entrypoint with our serialized args (a malformed arg would be
 * rejected at decode/`/v2/transactions` time, never reaching execution).
 *
 * TODO(happy-path): once the env exposes a controllable `bond-admin` (or a
 * fixture that pre-seeds a bond + allowlist + minted sBTC for the staker),
 * extend this to: setup-bond(allowlist: staker) → mint sBTC → register-for-bond
 * → assert `fetchBondMembership` reflects the enrollment.
 */
import { buildRegisterForBond, fetchBondMembership, fetchSignerInfo } from '../../../src';
import { REGTEST_KEYS, SIGNER_MANAGER, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { broadcastAndWaitForTransaction, ensurePox5, getNextNonce } from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';

jest.setTimeout(20 * 60_000);

const network = getNetwork();
// account4 = bond-admin: funded, holds 0 sBTC, never registers for a bond — so it
// stays a clean 0-sBTC, no-membership staker for this abort-path test.
const staker = getAccount(REGTEST_KEYS.account4);
// The env's btc-staker daemon deploys + registers the staked signer-manager
// (under STACKING_KEYS[0]) — a real, registered trait impl to reference.
const signerManager = SIGNER_MANAGER;

const BOND_INDEX = 0;
const AMOUNT_USTX = 1_000_000n; // 1 STX — irrelevant; aborts before the STX check
const SBTC_SATS = 1_000n;
const FEE = 10_000n;

beforeAll(() => ensurePox5(), 20 * 60_000);

test('buildRegisterForBond (sbtc): serializes against the real ABI, aborts in lock-sbtc', async () => {
  // Sanity: the signer-manager we reference must actually be registered, else
  // we'd be testing the wrong guard.
  const signerInfo = await fetchSignerInfo({ signerManager, network });
  expect(signerInfo).toBeDefined();

  // Precondition for the guard we want to hit: staker has no active membership.
  const before = await fetchBondMembership({ address: staker.address, network });
  expect(before).toBeUndefined();

  const nonce = await getNextNonce(staker.address);
  const unsigned = await buildRegisterForBond({
    bondIndex: BOND_INDEX,
    signerManager,
    amountUstx: AMOUNT_USTX,
    lockup: { kind: 'sbtc', sbtcSats: SBTC_SATS },
    publicKey: staker.publicKey,
    fee: FEE,
    nonce,
    network,
  });

  const tx = signTransaction(unsigned, staker.key);
  const confirmed = await broadcastAndWaitForTransaction(tx, network);
  console.log('register-for-bond result', confirmed.tx_status, confirmed.tx_result.repr);

  // Executed the contract and aborted at the sBTC pull (0 balance → (err u1)).
  expect(confirmed.tx_status).toBe('abort_by_response');
  expect(confirmed.tx_result.repr).toBe('(err u1)');

  // No membership was created.
  const after = await fetchBondMembership({ address: staker.address, network });
  expect(after).toBeUndefined();
});
