/**
 * ACTION 2 — Register for a bond with a REAL L1 BTC lockup proof.
 *
 * Reads the artifact written by ACTION 1 (btc-lock.test.ts) from
 * /tmp/btc-lock-<BOND_INDEX>.json, builds a genuine SPV proof (80-byte block
 * header + Esplora-compatible merkle proof), and submits a real
 * `register-for-bond` call using the BTC lockup path.
 *
 * On success, asserts `fetchBondMembership(staker)` is defined and
 * `isL1Lock === true`. If the contract aborts, logs the exact error code +
 * description so the caller can diagnose which validation failed.
 *
 * Composable via ENV:
 *   BOND_INDEX      bond index (default: 4, must match the btc-lock artifact)
 *   STAKER          account5 | account6 | account7 (default: account5)
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so
 *
 * Run (after btc-lock.test.ts):
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     BOND_INDEX=4 STAKER=account5 \
 *     npx jest tests/privatenet/actions/register-for-bond-l1.test.ts \
 *       --runInBand --collectCoverage=false --verbose
 */

import { readFileSync } from 'node:fs';
import fetchMock from 'jest-fetch-mock';
import {
  buildLockProof,
  buildUnlockScript,
  buildLockOutputScript,
  buildRegisterForBond,
  describePox5Error,
  fetchBond,
  fetchBondMembership,
  minUstxForSatsAmount,
} from '../../../src';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import {
  broadcastAndWait,
  ensurePox5,
  getNextNonce,
  getTransaction,
} from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';

// Live test — disable global jest-fetch-mock.
fetchMock.disableMocks();

jest.setTimeout(30 * 60_000);

// ─── Config ──────────────────────────────────────────────────────────────────

const BOND_INDEX = Number(process.env.BOND_INDEX ?? 4);
const SIGNER_MANAGER =
  process.env.SIGNER_MANAGER ??
  'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';
const FEE = BigInt(process.env.FEE_USTX ?? 10_000);

// ─── Staker resolution ───────────────────────────────────────────────────────
//
// STAKER env selects which account registers as the staker (account5 | account6 | account7).
// Defaults to "account5" so existing usage is unchanged.
// The "already enrolled → skip" precondition checks the selected staker's own membership.

const STAKER_NAME = process.env.STAKER ?? 'account5';

// Either a named REGTEST_KEYS account, or an arbitrary staker via STAKER_RAW_KEY
// (64-hex) for freshly-generated accounts (f2/f3…). Derive the account from the
// raw key (+compression byte) so it isn't limited to the prefunded pool.
const STAKER_RAW_KEY = process.env.STAKER_RAW_KEY;
const staker = STAKER_RAW_KEY
  ? getAccount(STAKER_RAW_KEY + '01')
  : getAccount(REGTEST_KEYS[STAKER_NAME as keyof typeof REGTEST_KEYS]);
if (!staker?.address) {
  throw new Error(`Unknown STAKER="${STAKER_NAME}" and no STAKER_RAW_KEY provided.`);
}

// ─── Artifact type (written by btc-lock.test.ts) ─────────────────────────────

interface BtcLockArtifact {
  bondIndex: number;
  txid: string;
  outputIndex: number;
  legacyTxHex: string;
  blockHash: string;
  blockHeight: number;
  unlockHeight: number;
  amountSats: string;
  witnessScriptHex: string;
  unlockBytesHex: string;
  earlyUnlockBytesHex: string;
  stakerStxAddress: string;
  headerHex: string;
  merkleProof: {
    block_height: number;
    merkle: string[];
    pos: number;
  };
  txCount: number;
}

// ─── Test ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await ensurePox5();
}, 30 * 60_000);

test(`register-for-bond (real L1 BTC proof) for bond ${BOND_INDEX}`, async () => {
  const network = getNetwork();

  console.log(`\n=== REGISTER-FOR-BOND-L1 ACTION: bondIndex=${BOND_INDEX} staker=${STAKER_NAME} ===`);
  console.log('staker:', staker.address);
  console.log('signer-manager:', SIGNER_MANAGER);

  // ── 1. Read btc-lock artifact ─────────────────────────────────────────────
  const artifactPath = `/tmp/btc-lock-${BOND_INDEX}-${STAKER_NAME}.json`;
  let artifact: BtcLockArtifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as BtcLockArtifact;
  } catch (err) {
    throw new Error(
      `Cannot read artifact ${artifactPath} — run btc-lock.test.ts first.\n  ${String(err)}`
    );
  }

  console.log('artifact loaded:', JSON.stringify({
    txid: artifact.txid,
    outputIndex: artifact.outputIndex,
    blockHeight: artifact.blockHeight,
    unlockHeight: artifact.unlockHeight,
    amountSats: artifact.amountSats,
    txCount: artifact.txCount,
  }));

  // Sanity: bondIndex must match
  expect(artifact.bondIndex).toBe(BOND_INDEX);

  // ── 2. Fetch bond params (to compute minUstx) ────────────────────────────
  const bond = await fetchBond({ bondIndex: BOND_INDEX, network });
  if (!bond) throw new Error(`bond ${BOND_INDEX} not found on-chain`);
  console.log('bond:', JSON.stringify({
    stxValueRatio: bond.stxValueRatio.toString(),
    minUstxRatioBps: bond.minUstxRatioBps,
  }));

  const amountSats = BigInt(artifact.amountSats);

  // Minimum uSTX required to pair with this many sats
  const minUstx = minUstxForSatsAmount({
    sats: amountSats,
    stxValueRatio: bond.stxValueRatio,
    minUstxRatioBps: bond.minUstxRatioBps,
  });
  // Round up to the nearest 1000 uSTX and add a generous buffer
  const amountUstx = minUstx + 1_000_000n;
  console.log('minUstx (contract minimum):', minUstx.toString());
  console.log('amountUstx (with buffer):', amountUstx.toString());

  // ── 3. Reconstruct unlock-bytes ───────────────────────────────────────────
  // account5 BTC pubkey → default unlock script: <pubkey> OP_CHECKSIG
  const unlockBytes = buildUnlockScript(staker.publicKey);
  console.log('unlockBytes (hex):', artifact.unlockBytesHex);

  // ── 4. Derive expected P2WSH output script (the "expected script hash") ──
  const expectedScript = buildLockOutputScript({
    stxAddress: artifact.stakerStxAddress,
    unlockHeight: artifact.unlockHeight,
    unlockBytes,
    earlyUnlockBytes: artifact.earlyUnlockBytesHex,
  });
  console.log('expectedP2wshScript (hex):', Buffer.from(expectedScript).toString('hex'));

  // ── 5. Assemble the full SPV proof tuple using assembleLockupProof ────────
  //
  // assembleLockupProof does the two transformations that cause silent failures:
  //   a. Witness-stripping: legacyTxHex is already stripped by btc-lock.test.ts,
  //      but assembleLockupProof will strip again harmlessly via btc.Transaction.
  //   b. Endianness: merkle[] hashes from Esplora are big-endian display form;
  //      assembleLockupProof reverses each to internal little-endian form.
  //
  // It also locates the output by matching expectedScript, so outputIndex is
  // cross-checked rather than blindly trusted.

  console.log('assembling SPV proof...');
  console.log('  txHex length:', artifact.legacyTxHex.length / 2, 'bytes');
  console.log('  headerHex length:', artifact.headerHex.length / 2, 'bytes');
  console.log('  merkle.pos:', artifact.merkleProof.pos);
  console.log('  merkle.block_height:', artifact.merkleProof.block_height);
  console.log('  merkle.siblings:', artifact.merkleProof.merkle.length);
  console.log('  txCount:', artifact.txCount);

  const lockupOutput = buildLockProof({
    txHex: artifact.legacyTxHex,
    header: artifact.headerHex,
    merkleProof: artifact.merkleProof,
    txCount: artifact.txCount,
    expectedScript,
  });

  console.log('lockupOutput:', JSON.stringify({
    height: lockupOutput.height,
    outputIndex: lockupOutput.outputIndex,
    txCount: lockupOutput.txCount,
    txIndex: lockupOutput.txIndex,
    amount: lockupOutput.amount.toString(),
    leafHashesCount: lockupOutput.leafHashes.length,
    txLengthBytes: (lockupOutput.tx as Uint8Array).length,
    headerLengthBytes: (lockupOutput.header as Uint8Array).length,
  }));

  // ── 6. Precondition: staker must NOT already be enrolled ─────────────────
  const existingMembership = await fetchBondMembership({ address: staker.address, network });
  if (existingMembership) {
    console.warn(
      'staker already has bond membership:',
      JSON.stringify(existingMembership, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
      '— skipping registration (already enrolled)'
    );
    expect(existingMembership.isL1Lock).toBe(true);
    console.log('=== ALREADY ENROLLED — SUCCESS ===');
    return;
  }
  console.log('precondition: staker has no existing bond membership ✓');

  // ── 7. Build + sign + broadcast register-for-bond ────────────────────────
  const nonce = await getNextNonce(staker.address);
  console.log('staker nonce:', nonce);

  const unsigned = await buildRegisterForBond({
    bondIndex: BOND_INDEX,
    signerManager: SIGNER_MANAGER,
    amountUstx,
    lockup: {
      kind: 'btc',
      outputs: [lockupOutput],
      unlockBytes,
    },
    publicKey: staker.publicKey,
    fee: FEE,
    nonce,
    network,
  });

  console.log('transaction built — signing...');
  const tx = signTransaction(unsigned, staker.key);

  console.log('broadcasting register-for-bond...');
  const txid = await broadcastAndWait(tx, staker.address, network);
  console.log('\n=== BROADCAST TXID:', txid, '===');

  // ── 8. Best-effort result check via /extended ─────────────────────────────
  // Wait briefly for the extended API to index the tx, then check the result.
  await new Promise(r => setTimeout(r, 5_000));
  const record = await getTransaction(txid);
  if (record && record.tx_status !== 'pending') {
    console.log('\n=== TX RESULT ===');
    console.log('tx_status:', record.tx_status);
    console.log('tx_result:', record.tx_result?.repr);

    if (record.tx_status === 'success') {
      console.log('=== SUCCESS: register-for-bond landed on-chain ✓ ===');
    } else if (record.tx_status === 'abort_by_response') {
      const match = record.tx_result?.repr?.match(/^\(err u(\d+)\)$/);
      if (match) {
        const code = Number(match[1]);
        console.error(`=== ABORT: (err u${code}) — ${describePox5Error(code)} ===`);
        console.error('Diagnosis: check which validation failed in pox-5.clar validate-l1-lockup.');
        console.error('  u39 ReadTxOutOfBounds    — tx parse failed (wrong bytes?)');
        console.error('  u40 InvalidBtcHeader     — header does not match burnchain at height');
        console.error('  u41 InvalidMerkleProof   — leaf-hashes / txIndex / txCount wrong');
        console.error('  u42 InvalidLockupScript  — P2WSH output script mismatch');
        console.error('  u45 InvalidLockupAmount  — output amount != claimed amount');
        console.error('  u11 NotAllowlisted       — account5 not on bond allowlist');
        console.error('  u43 BondAlreadyStarted   — burn height already past bond open');
        console.error('  u47 StakeInPreparePhase  — must call outside prepare phase');
        // We still assert no membership was created
        expect(
          await fetchBondMembership({ address: staker.address, network }),
        ).toBeUndefined();
        // Fail the test so the orchestrator knows registration did not succeed
        throw new Error(`register-for-bond aborted: (err u${code}) — ${describePox5Error(code)}`);
      }
    }
  } else {
    console.log('tx still pending or not indexed — checking membership via node read-only...');
  }

  // ── 9. Assert enrollment ──────────────────────────────────────────────────
  // Poll until membership appears (node read-only, no /extended dependency)
  let membership = await fetchBondMembership({ address: staker.address, network });
  if (!membership) {
    // Give the chain up to 2 more minutes to reflect via read-only
    const deadline = Date.now() + 2 * 60_000;
    while (!membership && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 10_000));
      membership = await fetchBondMembership({ address: staker.address, network });
    }
  }

  console.log('\n=== BOND MEMBERSHIP ===');
  console.log(
    JSON.stringify(membership, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  );

  expect(membership).toBeDefined();
  expect(membership!.bondIndex).toBe(BOND_INDEX);
  expect(membership!.isL1Lock).toBe(true);
  console.log(`\n=== REGISTER-FOR-BOND-L1 SUCCESS: ${STAKER_NAME} is enrolled ✓ ===`);
});
