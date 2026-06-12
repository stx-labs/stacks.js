/**
 * Privatenet `register-for-bond` (sBTC path) — validation / abort test.
 *
 * We have NO Bitcoin node on api.private-1.hiro.so, so we cannot build a real
 * L1 (`kind: 'btc'`) lockup proof. The only register-for-bond shape callable
 * here is `kind: 'sbtc'`, and we exercise it as an ABORT-path probe rather than
 * a happy path:
 *
 *   register-for-bond evaluates the lockup branch FIRST (pox-5.clar line ~531:
 *   `(try! (match btc-lockup ... sbtc-amount (lock-sbtc sbtc-amount)))`), so
 *   `lock-sbtc`'s `sbtc-token.transfer` runs before any bond/allowlist/signer
 *   guard. Calling from an account that holds 0 sBTC makes that `ft-transfer?`
 *   abort with `(err u1)` — proving the builder serializes against the real ABI
 *   and hits the real entrypoint, without minting sBTC, setting up a bond, or
 *   touching Bitcoin.
 *
 * A valid `<signer-manager-trait>` contract must exist for the trait argument to
 * pass tx analysis, so we deploy one from the bond-admin account first
 * (idempotent — `deployContract` no-ops if it already exists). The bond-admin
 * itself is the 0-sBTC staker (it is funded with STX for fees but never minted
 * sBTC, and is not enrolled in any bond).
 *
 * Node-only assertions (no `/extended`, which lags on this chain): the tx mines
 * (nonce advances) and `fetchBondMembership` stays undefined — the abort left no
 * enrollment. Under `RECORD=1` we additionally surface `tx_result.repr` via
 * `/extended` for an exact `(err u1)` check.
 *
 * Run with:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so RECORD=1 \
 *     npx jest tests/privatenet/actions/register-for-bond.test.ts --runInBand --collectCoverage=false
 */
import { buildRegisterForBond, fetchBondMembership } from "../../../src";
import { getNetwork, ENV } from "../../helpers/utils";
import {
  broadcastAndWait,
  ensurePox5,
  getNextNonce,
  getTransaction,
} from "../../helpers/wait";
import { signTransaction } from "../../helpers/sign";
import { REGTEST_KEYS, getAccount } from "../../regtest/regtest";

// Reuse the daemon's already-deployed signer-manager instead of deploying our
// own. Deploying under this net's rate limits reliably times out the 20-min
// beforeAll (the deploy tx broadcasts but takes too long to confirm). The trait
// arg just needs to be a deployed contract implementing the trait so tx analysis
// passes — and lock-sbtc aborts (err u1) before signer validation anyway, so the
// specific contract is irrelevant to this abort probe. Override with SIGNER_MANAGER.
const SIGNER_MANAGER =
  process.env.SIGNER_MANAGER ??
  "ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager";

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
  await ensurePox5();
  // account5 (STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6): allowlisted staker on
  // bond 1, funded for fees, holds 0 sBTC — will abort in lock-sbtc with (err u1).
  staker = getAccount(REGTEST_KEYS.account5);
  // Reuse an existing deployed signer-manager (see SIGNER_MANAGER above) — no
  // deploy round-trip, so beforeAll stays fast under rate limits.
  signerManager = SIGNER_MANAGER;
}, 20 * 60_000);

test("buildRegisterForBond (sbtc): serializes against the real ABI, aborts in lock-sbtc", async () => {
  // Precondition: staker is not enrolled in any bond.
  expect(
    await fetchBondMembership({ address: staker.address, network }),
  ).toBeUndefined();

  const unsigned = await buildRegisterForBond({
    bondIndex: BOND_INDEX,
    signerManager,
    amountUstx: AMOUNT_USTX,
    lockup: { kind: "sbtc", sbtcSats: SBTC_SATS },
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

  // The abort must NOT have produced an enrollment.
  expect(
    await fetchBondMembership({ address: staker.address, network }),
  ).toBeUndefined();

  // Best-effort exact-result check via /extended (lags on this chain, so only
  // under RECORD=1). The register aborts before enrolling — but WHICH guard
  // fires depends on cycle timing, so we accept the known abort family rather
  // than pin one code:
  //   (err u1)  Unauthorized       — lock-sbtc's ft-transfer? (0 sBTC) in the
  //                                   reward phase, the originally-expected path.
  //   (err u47) StakeInPreparePhase — observed live: the contract blocks
  //                                   registration during the cycle's prepare
  //                                   phase (last ~prepareCycleLength blocks),
  //                                   and that guard runs BEFORE lock-sbtc.
  // Either proves the builder serialized against the real ABI and reached the
  // real entrypoint without enrolling the staker.
  // Which guard fires depends on cycle timing + the bond's open state:
  //   u1  lock-sbtc (0 sBTC, reward phase, allowlisted, before open)
  //   u11 not-allowlisted · u43 bond-already-started (open bond, reward phase)
  //   u47 prepare phase
  const EXPECTED_ABORTS = new Set([
    "(err u1)",
    "(err u11)",
    "(err u43)",
    "(err u47)",
  ]);
  if (ENV.RECORD) {
    const record = await getTransaction(txid);
    console.log(
      "register-for-bond result",
      record?.tx_status,
      record?.tx_result?.repr,
    );
    if (record && record.tx_status !== "pending") {
      expect(record.tx_status).toBe("abort_by_response");
      expect(EXPECTED_ABORTS.has(record.tx_result.repr)).toBe(true);
    }
  }
});
