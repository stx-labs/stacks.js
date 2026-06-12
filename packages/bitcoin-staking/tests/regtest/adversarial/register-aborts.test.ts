/**
 * Pins the EXACT abort code per misuse (`Pox5ErrorCode`) so renumbering or
 * guard-reordering in pox-5 breaks loudly here instead of silently in apps.
 * Sequential (--runInBand): later cases build on the happy register's state.
 */
import {
  buildRegisterForBond,
  buildSetBondAdmin,
  buildSetupBond,
  buildUnstakeSbtc,
  buildUpdateBondRegistration,
  fetchBondMembership,
  minUstxForSatsAmount,
  Pox5ErrorCode,
} from '../../../src';
import { Pc, broadcastTransaction } from '@stacks/transactions';
import { SBTC_ASSET_NAME, SBTC_TOKEN } from '../../helpers/constants';
import { ACCOUNTS, REGTEST_KEYS, SIGNER_MANAGER, getAccount, type Account } from '../regtest';
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { getNetwork } from '../../helpers/utils';
import {
  broadcastAndWaitForTransaction,
  ensurePox5,
  fundStx,
  getNextNonce,
  getPoxInfo,
  getTransaction,
  parseErrCode,
  waitForFulfilled,
  waitForPreparePhase,
  waitForSignerManager,
  type TxRecord,
} from '../../helpers/wait';
import { waitForBondWithRunway } from '../../helpers/bond';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';
import { deploySbtcMinter, mintSbtc } from '../../helpers/sbtc';

jest.setTimeout(6 * 60_000);
// Record mode only: the prepare-phase case (u47) races real block timing — a
// retry simply aims at the next prepare phase. No effect on replay (fixtures
// are deterministic).
if (process.env.RECORD === '1') jest.retryTimes(2);

const network = getNetwork();
let admin: Account;
const sbtcDeployer = ACCOUNTS.sbtcDeployer;
const staker = getAccount(REGTEST_KEYS.account12); // allowlisted leg
const outsider = getAccount(REGTEST_KEYS.account13); // never allowlisted
const signerManager = SIGNER_MANAGER;

const MAX_SATS = 1_000n; // deliberately low cap (case 4 exceeds it)
const FEE = 10_000n;
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);

let bondIndex: number;
let bondStartHeight: number;

function expectAbort(tx: TxRecord, code: Pox5ErrorCode): void {
  expect(tx.tx_status).toBe('abort_by_response');
  expect(parseErrCode(tx.tx_result.repr)).toBe(code);
}

async function setupBondTx(index: number, nonce: number) {
  return buildSetupBond({
    bondIndex: index,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist: [{ staker: staker.address, maxSats: MAX_SATS }],
    publicKey: admin.publicKey,
    fee: FEE,
    nonce,
    network,
  });
}

/**
 * Make sure `bondIndex` points at a bond that is set up and still ≥6 blocks
 * before its start. The earlier cases' waits (reward-phase guards, API lag)
 * can consume a bond's whole runway, after which register aborts shift to
 * BondAlreadyStarted (u43) and poison the rest of the sequence — so each case
 * that needs an OPEN bond re-validates instead of trusting ordering.
 */
async function ensureOpenBond(): Promise<void> {
  const pox = await getPoxInfo();
  if (bondStartHeight - pox.currentBurnchainBlockHeight >= 6) return;
  const fresh = await waitForBondWithRunway(15);
  const setup = await setupBondTx(fresh.bondIndex, await getNextNonce(admin.address));
  const res = await broadcastAndWaitForTransaction(signTransaction(setup, admin.key), network);
  expect(res.tx_status).toBe('success');
  bondIndex = fresh.bondIndex;
  bondStartHeight = fresh.bondStartHeight;
  console.log('rolled to fresh bond', { bondIndex, bondStartHeight });
}

async function registerTx(args: {
  from: Account;
  sats: bigint;
  amountUstx?: bigint;
  atBond?: number;
  /** Attach the sBTC transfer post-condition — ONLY for registers expected to
   * SUCCEED. An aborted register transfers nothing, so a willSendEq(>0) PC
   * fails first and masks the response abort we want to assert. */
  expectSuccess?: boolean;
}) {
  return buildRegisterForBond({
    bondIndex: args.atBond ?? bondIndex,
    signerManager,
    amountUstx:
      args.amountUstx ??
      minUstxForSatsAmount({
        sats: args.sats,
        stxValueRatio: STX_VALUE_RATIO,
        minUstxRatioBps: MIN_USTX_RATIO_BPS,
      }),
    lockup: { kind: 'sbtc', sbtcSats: args.sats },
    publicKey: args.from.publicKey,
    fee: FEE,
    nonce: await getNextNonce(args.from.address),
    network,
    // The builder does NOT add the sBTC transfer post-condition itself (see
    // SDK-GAPS.md #5) — without it a SUCCESSFUL register aborts by PC.
    postConditions: args.expectSuccess
      ? [Pc.principal(args.from.address).willSendEq(args.sats).ft(SBTC_TOKEN, SBTC_ASSET_NAME)]
      : [],
  });
}

beforeAll(async () => {
  admin = await getBondAdminAccount();
  useFixtures('adversarial');
  await ensurePox5();
  await waitForSignerManager(signerManager);
  for (const account of [staker, outsider]) {
    await fundStx({
      funder: admin,
      recipient: account.address,
      amountUstx: 10_000_000n,
      nonce: await getNextNonce(admin.address),
      network,
    });
  }
  await deploySbtcMinter({ deployerKey: sbtcDeployer.key, network });
  await mintSbtc({
    deployer: sbtcDeployer.address,
    sender: admin,
    recipient: staker.address,
    sats: MAX_SATS * 3n, // covers the over-cap attempt + the happy register
    nonce: await getNextNonce(admin.address),
    fee: FEE,
    network,
  });

  // Shared bond for the abort cases (the happy register re-picks for runway).
  const chosen = await waitForBondWithRunway(25);
  bondIndex = chosen.bondIndex;
  bondStartHeight = chosen.bondStartHeight;
  const setup = await setupBondTx(bondIndex, await getNextNonce(admin.address));
  const res = await broadcastAndWaitForTransaction(signTransaction(setup, admin.key), network);
  expect(res.tx_status).toBe('success');
  console.log('adversarial bond', { bondIndex, bondStartHeight });
}, 6 * 60_000);

test('duplicate setup-bond aborts BondAlreadySetup (u4)', async () => {
  useFixtures('adversarial-u4');
  await ensureOpenBond();
  const tx = await setupBondTx(bondIndex, await getNextNonce(admin.address));
  expectAbort(
    await broadcastAndWaitForTransaction(signTransaction(tx, admin.key), network),
    Pox5ErrorCode.BondAlreadySetup
  );
});

test('setup-bond far in the future aborts CannotSetupBondTooSoon (u2)', async () => {
  useFixtures('adversarial-u2');
  const tx = await setupBondTx(bondIndex + 5, await getNextNonce(admin.address));
  expectAbort(
    await broadcastAndWaitForTransaction(signTransaction(tx, admin.key), network),
    Pox5ErrorCode.CannotSetupBondTooSoon
  );
});

test('register without allowlist entry aborts NotAllowlisted (u11)', async () => {
  useFixtures('adversarial-u11');
  await ensureOpenBond();
  const tx = await registerTx({ from: outsider, sats: MAX_SATS });
  expectAbort(
    await broadcastAndWaitForTransaction(signTransaction(tx, outsider.key), network),
    Pox5ErrorCode.NotAllowlisted
  );
});

test('register above the allowance cap aborts TooMuchSats (u10)', async () => {
  useFixtures('adversarial-u10');
  await ensureOpenBond();
  const tx = await registerTx({ from: staker, sats: MAX_SATS * 2n });
  expectAbort(
    await broadcastAndWaitForTransaction(signTransaction(tx, staker.key), network),
    Pox5ErrorCode.TooMuchSats
  );
});

test('register with dust uSTX aborts InsufficientStx (u8)', async () => {
  useFixtures('adversarial-u8');
  await ensureOpenBond();
  const tx = await registerTx({ from: staker, sats: MAX_SATS, amountUstx: 1n });
  expectAbort(
    await broadcastAndWaitForTransaction(signTransaction(tx, staker.key), network),
    Pox5ErrorCode.InsufficientStx
  );
});

test('set-bond-admin from a non-admin aborts Unauthorized (u1)', async () => {
  useFixtures('adversarial-u1');
  const tx = await buildSetBondAdmin({
    newAdmin: staker.address,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
  });
  expectAbort(
    await broadcastAndWaitForTransaction(signTransaction(tx, staker.key), network),
    Pox5ErrorCode.Unauthorized
  );
});

test('happy register, then re-register aborts AlreadyRegistered (u9)', async () => {
  useFixtures('adversarial-registered');
  await ensureOpenBond();

  const good = await registerTx({ from: staker, sats: MAX_SATS, expectSuccess: true });
  const reg = await broadcastAndWaitForTransaction(signTransaction(good, staker.key), network);
  expect(reg.tx_status).toBe('success');
  expect((await fetchBondMembership({ address: staker.address, network }))?.bondIndex).toBe(bondIndex);

  useFixtures('adversarial-u9');
  const dup = await registerTx({ from: staker, sats: MAX_SATS });
  expectAbort(
    await broadcastAndWaitForTransaction(signTransaction(dup, staker.key), network),
    Pox5ErrorCode.AlreadyRegistered
  );
});

test('update-bond-registration to the SAME signer aborts UpdateBondSameSigner (u44)', async () => {
  useFixtures('adversarial-u44');
  const tx = await buildUpdateBondRegistration({
    signerManager,
    oldSignerManager: signerManager,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
  });
  expectAbort(
    await broadcastAndWaitForTransaction(signTransaction(tx, staker.key), network),
    Pox5ErrorCode.UpdateBondSameSigner
  );
});

test('unstake-sbtc from a non-participant aborts NotBondParticipant (u34)', async () => {
  useFixtures('adversarial-u34');
  const tx = await buildUnstakeSbtc({
    signerManager,
    amountToWithdrawSats: 1n,
    publicKey: outsider.publicKey,
    fee: FEE,
    nonce: await getNextNonce(outsider.address),
    network,
  });
  expectAbort(
    await broadcastAndWaitForTransaction(signTransaction(tx, outsider.key), network),
    Pox5ErrorCode.NotBondParticipant
  );
});

test('register broadcast during the prepare phase aborts StakeInPreparePhase (u47)', async () => {
  useFixtures('adversarial-u47');
  // Bypass the broadcast helpers' reward-phase guard on purpose: wait for the
  // prepare phase to START, then raw-broadcast so the tx mines inside it.
  // Open bond first: if the tx slips past the prepare phase, the abort must
  // not degrade into BondAlreadyStarted (u43) on a bond that began meanwhile.
  await ensureOpenBond();
  await waitForPreparePhase(await getPoxInfo());
  // Must be the ALLOWLISTED staker: register-for-bond's let-bindings resolve the
  // allowance (u11) BEFORE the body's verify-not-prepare-phase (u47), so an
  // outsider can never reach u47. The staker is already registered, but the
  // prepare-phase guard runs before the rollover/already-registered checks.
  const tx = await registerTx({ from: staker, sats: MAX_SATS });
  const res = await broadcastTransaction({ transaction: signTransaction(tx, staker.key), network });
  if ('error' in res) throw new Error(`broadcast rejected: ${res.error}`);
  const confirmed = await waitForFulfilled(async () => {
    const t = await getTransaction(res.txid);
    if (!t || t.tx_status === 'pending') throw new Error('pending');
    return t;
  });
  expectAbort(confirmed, Pox5ErrorCode.StakeInPreparePhase);
});
