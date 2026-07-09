/**
 * Privatenet `register-for-bond` (sBTC path) — abort probe, not a happy path.
 *
 * No Bitcoin node on this net, so only `kind: 'sbtc'` is buildable here.
 * register-for-bond evaluates the lockup branch first, so `lock-sbtc`'s
 * transfer runs before any bond/allowlist/signer guard — calling from a
 * 0-sBTC account aborts before enrollment, proving the builder serializes
 * against the real ABI without minting sBTC or touching Bitcoin.
 *
 * Run with:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so RECORD=1 \
 *     npx jest tests/privatenet/actions/register-for-bond.test.ts --runInBand --collectCoverage=false
 */
import { buildRegisterForBond, fetchBondMembership } from '../../../src';
import { getNetwork, ENV } from '../../helpers/utils';
import { broadcastAndWait, getNextNonce, getTransaction } from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { useFixtures } from '../../helpers/mock';

// Reuse the daemon's already-deployed signer-manager instead of deploying our
// own. Deploying under this net's rate limits reliably times out the 20-min
// beforeAll (the deploy tx broadcasts but takes too long to confirm). The trait
// arg just needs to be a deployed contract implementing the trait so tx analysis
// passes — and lock-sbtc aborts (err u1) before signer validation anyway, so the
// specific contract is irrelevant to this abort probe. Override with SIGNER_MANAGER.
const SIGNER_MANAGER =
  process.env.SIGNER_MANAGER ?? 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';

jest.setTimeout(20 * 60_000);

const network = getNetwork();
let staker: ReturnType<typeof getAccount>;
let signerManager: string;

// lock-sbtc aborts before the bond/allowlist guard, so this works against any
// index; default to a real on-chain bond (override with BOND_INDEX env).
const BOND_INDEX = Number(process.env.BOND_INDEX ?? 4);
const AMOUNT_USTX = 1_000_000n;
const SBTC_SATS = 1_000n;
const FEE = 10_000n;

beforeAll(async () => {
  useFixtures('register-for-bond');
  // account6: unenrolled, funded for fees, holds 0 sBTC -> aborts in lock-sbtc.
  staker = getAccount(REGTEST_KEYS.account6);
  // Reuse an existing deployed signer-manager (see SIGNER_MANAGER above) — no
  // deploy round-trip, so beforeAll stays fast under rate limits.
  signerManager = SIGNER_MANAGER;
}, 20 * 60_000);

test('buildRegisterForBond (sbtc): serializes against the real ABI, aborts in lock-sbtc', async () => {
  // Precondition: read live membership rather than assume unenrolled — the
  // staker may already be enrolled in some other bond on this chain. Either
  // way, this register-for-bond call must abort (0 sBTC, or already-enrolled
  // guards) and must not change the staker's membership.
  const membershipBefore = await fetchBondMembership({ address: staker.address, network });
  console.log(
    'membership before:',
    JSON.stringify(membershipBefore, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
  );

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
  // Node-only confirmation: wait for the sender nonce to advance (the tx mined).
  // Can't distinguish success from a runtime abort here, so we assert the effect
  // (no enrollment) below.
  const txid = await broadcastAndWait(tx, staker.address, network);

  // The abort must NOT have changed membership state (no new enrollment, and
  // if already enrolled elsewhere, still enrolled the same way).
  const membershipAfter = await fetchBondMembership({ address: staker.address, network });
  expect(membershipAfter).toEqual(membershipBefore);

  // Best-effort exact-result check via /extended (lags on this chain, so only
  // under RECORD=1). Which guard fires depends on cycle timing + the bond's
  // open state, so we accept the known abort family rather than pin one code:
  //   u1  lock-sbtc (0 sBTC, reward phase, allowlisted, before open)
  //   u9  already-registered · u5 staker-already-added (staker enrolled elsewhere)
  //   u11 not-allowlisted · u43 bond-already-started (open bond, reward phase)
  //   u47 prepare phase (guard runs before lock-sbtc)
  const EXPECTED_ABORTS = new Set([
    '(err u1)',
    '(err u5)',
    '(err u9)',
    '(err u11)',
    '(err u43)',
    '(err u47)',
  ]);
  if (ENV.RECORD) {
    const record = await getTransaction(txid);
    console.log('register-for-bond result', record?.tx_status, record?.tx_result?.repr);
    if (record && record.tx_status !== 'pending') {
      expect(record.tx_status).toBe('abort_by_response');
      expect(EXPECTED_ABORTS.has(record.tx_result.repr)).toBe(true);
    }
  }
});
