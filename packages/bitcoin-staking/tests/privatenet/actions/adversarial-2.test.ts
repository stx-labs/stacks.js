/**
 * Adversarial / robustness probes — pox-5 bond contract, batch 2.
 *
 * Exploratory: broadcasts deliberately invalid/boundary txs against
 * register-for-bond and setup-bond, logs the on-chain abort code, and
 * asserts tolerantly (abort_by_response OR success) to discover error codes
 * on the live private testnet. No Bitcoin txs, no set-bond-admin, no deploys.
 *
 * Run with:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so RECORD=1 \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *     npx jest tests/privatenet/actions/adversarial-2.test.ts --runInBand --collectCoverage=false
 */
import {
  buildSetupBond,
  buildRegisterForBond,
  describePox5Error,
  fetchBondMembership,
  Pox5ErrorCode,
} from '../../../src';
import { SIGNER_MANAGER } from '../constants';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import {
  broadcastAndWait,
  getNextNonce,
  getPoxInfo,
  assertTolerableResult,
} from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { useFixtures } from '../../helpers/mock';
import { findExistingBondIndex, computeNextBondIndex } from '../../helpers/bond';

// Reuse the daemon's deployed signer-manager — same approach as adversarial.test.ts
// and register-for-bond.test.ts (deploying our own reliably times out beforeAll).

jest.setTimeout(30 * 60_000);

const network = getNetwork();

const account5 = getAccount(REGTEST_KEYS.account5); // allowlisted on most bonds
const account6 = getAccount(REGTEST_KEYS.account6);
void account6;

const FEE = 10_000n;
const AMOUNT_USTX = 1_000_000n;
const SBTC_SATS = 1_000n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;

let admin: Awaited<ReturnType<typeof getBondAdminAccount>>;
let lowestExistingBondIndex: number | undefined;
let signerManager: string;

beforeAll(async () => {
  admin = await getBondAdminAccount();

  lowestExistingBondIndex = await findExistingBondIndex({ direction: 'lowest', max: 12 });
  console.log('Lowest existing bond index:', lowestExistingBondIndex);

  signerManager = SIGNER_MANAGER;
}, 20 * 60_000);

// PROBE A
// Guard order in pox-5.register-for-bond: prepare-phase (u47) -> allowlist (u11)
// -> already-started (u43) -> lock-sbtc (u1). account5 IS allowlisted on most
// bonds, so #2 is passed; #1 and #3 depend on timing — all four are acceptable.

test('adversarial-2-A: register-for-bond against an open/active bond (account5, sBTC path)', async () => {
  useFixtures('adversarial-2-a');
  const bondIndex = lowestExistingBondIndex ?? 1;
  console.log('probe-A using bondIndex:', bondIndex);

  const membershipBefore = await fetchBondMembership({
    address: account5.address,
    network,
  });
  console.log('probe-A membershipBefore:', membershipBefore);

  const unsigned = await buildRegisterForBond({
    bondIndex,
    signerManager,
    amountUstx: AMOUNT_USTX,
    lockup: { kind: 'sbtc', sbtcSats: SBTC_SATS },
    publicKey: account5.publicKey,
    fee: FEE,
    nonce: await getNextNonce(account5.address),
    network,
    postConditionMode: 'allow',
  });

  const tx = signTransaction(unsigned, account5.key);
  const txid = await broadcastAndWait(tx, account5.address, network);
  console.log('probe-A txid:', txid);

  const membershipAfter = await fetchBondMembership({
    address: account5.address,
    network,
  });
  console.log('probe-A membershipAfter:', membershipAfter);

  const code = await assertTolerableResult('probe-A', txid);

  const TOLERANT_SET = new Set([
    Pox5ErrorCode.BondAlreadyStarted, // u43 — primary target
    Pox5ErrorCode.StakeInPreparePhase, // u47
    Pox5ErrorCode.NotAllowlisted, // u11
    Pox5ErrorCode.Unauthorized, // u1 — lock-sbtc, 0 sBTC balance
  ]);

  if (code !== undefined) {
    if (code === Pox5ErrorCode.BondAlreadyStarted) {
      console.log('probe-A CONFIRMED: ERR_BOND_ALREADY_STARTED (err u43)');
    } else if (TOLERANT_SET.has(code)) {
      console.log(`probe-A NOTE: got (err u${code}) — acceptable (timing/state dependent)`);
    } else {
      console.warn(`probe-A UNEXPECTED: (err u${code}) not in tolerant set — new discovery!`);
    }
    expect(TOLERANT_SET.has(code)).toBe(true);
  }
});

// PROBE B

test('adversarial-2-B: register-for-bond with amountUstx = 0 (sBTC path, account5)', async () => {
  useFixtures('adversarial-2-b');
  const bondIndex = lowestExistingBondIndex ?? 1;
  console.log('probe-B using bondIndex:', bondIndex, 'amountUstx: 0');

  const membershipBefore = await fetchBondMembership({
    address: account5.address,
    network,
  });
  console.log('probe-B membershipBefore:', membershipBefore);

  const unsigned = await buildRegisterForBond({
    bondIndex,
    signerManager,
    amountUstx: 0n, // deliberately zero
    lockup: { kind: 'sbtc', sbtcSats: SBTC_SATS },
    publicKey: account5.publicKey,
    fee: FEE,
    nonce: await getNextNonce(account5.address),
    network,
    postConditionMode: 'allow',
  });

  const tx = signTransaction(unsigned, account5.key);
  const txid = await broadcastAndWait(tx, account5.address, network);
  console.log('probe-B txid:', txid);

  const membershipAfter = await fetchBondMembership({
    address: account5.address,
    network,
  });
  console.log('probe-B membershipAfter:', membershipAfter);

  const code = await assertTolerableResult('probe-B', txid);
  console.log('probe-B discovery: amountUstx=0 produced code', code, describePox5Error(code ?? -1));
});

// PROBE C-1

test('adversarial-2-C1: setup-bond fuzz — minUstxRatioBps = 20000 (> 100%)', async () => {
  useFixtures('adversarial-2-c1');
  const { bondIndex, anchorCycle, currentCycle } = await computeNextBondIndex(await getPoxInfo(), 2); // offset 1 -> next+1 bond
  console.log('probe-C1 bondIndex:', bondIndex, { anchorCycle, currentCycle });

  const unsigned = await buildSetupBond({
    bondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: 20_000n, // > 10000 (> 100%) — should be rejected
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist: [{ staker: account5.address, maxSats: 10_000n }],
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
  });

  const tx = signTransaction(unsigned, admin.key);
  const txid = await broadcastAndWait(tx, admin.address, network);
  console.log('probe-C1 txid:', txid);

  const code = await assertTolerableResult('probe-C1', txid);
  console.log(
    'probe-C1 discovery: minUstxRatioBps=20000 produced code',
    code,
    describePox5Error(code ?? -1)
  );
});

// PROBE C-2

test('adversarial-2-C2: setup-bond fuzz — stxValueRatio = 0', async () => {
  useFixtures('adversarial-2-c2');
  const { bondIndex, anchorCycle, currentCycle } = await computeNextBondIndex(await getPoxInfo(), 3); // offset 2 -> distinct index
  console.log('probe-C2 bondIndex:', bondIndex, { anchorCycle, currentCycle });

  const unsigned = await buildSetupBond({
    bondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: 0n, // zero — likely rejected by contract
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist: [{ staker: account5.address, maxSats: 10_000n }],
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
  });

  const tx = signTransaction(unsigned, admin.key);
  const txid = await broadcastAndWait(tx, admin.address, network);
  console.log('probe-C2 txid:', txid);

  const code = await assertTolerableResult('probe-C2', txid);
  console.log(
    'probe-C2 discovery: stxValueRatio=0 produced code',
    code,
    describePox5Error(code ?? -1)
  );
});

// PROBE C-3

test('adversarial-2-C3: setup-bond fuzz — empty allowlist []', async () => {
  useFixtures('adversarial-2-c3');
  const { bondIndex, anchorCycle, currentCycle } = await computeNextBondIndex(await getPoxInfo(), 4); // offset 3 -> distinct index
  console.log('probe-C3 bondIndex:', bondIndex, { anchorCycle, currentCycle });

  const unsigned = await buildSetupBond({
    bondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist: [], // empty — no stakers can register
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
  });

  const tx = signTransaction(unsigned, admin.key);
  const txid = await broadcastAndWait(tx, admin.address, network);
  console.log('probe-C3 txid:', txid);

  const code = await assertTolerableResult('probe-C3', txid);
  console.log(
    'probe-C3 discovery: empty allowlist produced code',
    code ?? '(success)',
    code !== undefined ? describePox5Error(code) : 'tx succeeded'
  );
});

// PROBE C-4

test('adversarial-2-C4: setup-bond fuzz — allowlist entry with maxSats = 0', async () => {
  useFixtures('adversarial-2-c4');
  const { bondIndex, anchorCycle, currentCycle } = await computeNextBondIndex(await getPoxInfo(), 5); // offset 4 -> distinct index
  console.log('probe-C4 bondIndex:', bondIndex, { anchorCycle, currentCycle });

  const unsigned = await buildSetupBond({
    bondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist: [{ staker: account5.address, maxSats: 0n }], // zero-cap staker
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
  });

  const tx = signTransaction(unsigned, admin.key);
  const txid = await broadcastAndWait(tx, admin.address, network);
  console.log('probe-C4 txid:', txid);

  const code = await assertTolerableResult('probe-C4', txid);
  console.log(
    'probe-C4 discovery: allowlist maxSats=0 produced code',
    code ?? '(success)',
    code !== undefined ? describePox5Error(code) : 'tx succeeded'
  );
});

// PROBE C-5
// earlyUnlockBytes is (buff 683); Clarity enforces max-length at the ABI layer,
// so the node may reject the tx before it reaches the VM — broadcastAndWait
// throws in that case, and we catch + log it as the expected outcome.

test('adversarial-2-C5: setup-bond fuzz — earlyUnlockBytes oversized (700 bytes > 683)', async () => {
  useFixtures('adversarial-2-c5');
  const { bondIndex, anchorCycle, currentCycle } = await computeNextBondIndex(await getPoxInfo(), 6); // offset 5 -> distinct index
  console.log('probe-C5 bondIndex:', bondIndex, { anchorCycle, currentCycle });

  // 1400 hex chars = 700 bytes, exceeds the (buff 683) constraint
  const OVERSIZED_BYTES = '00'.repeat(700);

  let txid: string | undefined;
  try {
    const unsigned = await buildSetupBond({
      bondIndex,
      targetRateBps: TARGET_RATE_BPS,
      stxValueRatio: STX_VALUE_RATIO,
      minUstxRatioBps: MIN_USTX_RATIO_BPS,
      earlyUnlockBytes: OVERSIZED_BYTES,
      allowlist: [{ staker: account5.address, maxSats: 10_000n }],
      publicKey: admin.publicKey,
      fee: FEE,
      nonce: await getNextNonce(admin.address),
      network,
    });

    const tx = signTransaction(unsigned, admin.key);
    txid = await broadcastAndWait(tx, admin.address, network);
    console.log('probe-C5 txid:', txid);
  } catch (err) {
    // Node-level rejection (ABI enforcement) is the expected outcome here.
    console.log(
      'probe-C5: broadcast rejected at node level (expected for oversized buff):',
      err instanceof Error ? err.message : String(err)
    );
    return;
  }

  const code = await assertTolerableResult('probe-C5', txid!);
  console.log(
    'probe-C5 discovery: oversized earlyUnlockBytes produced code',
    code ?? '(success)',
    code !== undefined ? describePox5Error(code) : 'tx succeeded'
  );
});
