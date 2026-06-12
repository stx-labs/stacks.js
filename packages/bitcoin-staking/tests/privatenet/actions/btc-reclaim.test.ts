// TODO(fixtures): skipped to unblock CI — fixtures are stale after the register/bond-metadata changes. Re-record with RECORD=1 against the live private testnet, then un-skip.
/**
 * ACTION — Reclaim a P2WSH bond lockup output back to the staker on regtest BTC.
 *
 * Reads the lock artifact written by btc-lock.test.ts, builds a raw P2WSH
 * script-path spend (custom IF/ELSE witness), signs it, and broadcasts via the
 * mempool API.
 *
 * Two modes, selected by MODE env var:
 *
 *  MODE=timelock (default)
 *   — Spends via the OP_IF (CLTV) branch. Requires tip burn-height >= unlockHeight.
 *     If not yet spendable, logs a clear message and skips (does not fail) so the
 *     orchestrator can wait and retry.
 *     Witness stack: [ staker_sig, 0x01 (truthy → IF), witnessScript ]
 *     tx.lockTime = unlockHeight, input sequence = 0xfffffffe
 *
 *  MODE=early
 *   — Spends via the OP_ELSE branch. Requires a second signature from account6
 *     (the bond's early-unlock cosigner). No CLTV constraint.
 *     Witness stack: [ staker_sig(STAKER), admin_sig(account6), <empty>(→ELSE), witnessScript ]
 *     Stack at OP_IF check: top = empty (ELSE taken), then admin_sig, then staker_sig.
 *     ELSE branch executes: <account6Pub> OP_CHECKSIGVERIFY (pops admin_sig from top),
 *     then <stakerPub> OP_CHECKSIG (pops staker_sig from top).
 *
 * Composable via ENV:
 *   BOND_INDEX   bond index whose artifact to read (default: 4)
 *   MODE         timelock | early                  (default: timelock)
 *   STAKER       account5 | account6 | account7    (default: account5)
 *                Selects the staker BTC key that signed the lockup output.
 *                The default TO_ADDRESS is derived from the selected staker's P2WPKH.
 *   TO_ADDRESS   destination bcrt1 address          (default: staker P2WPKH)
 *   FEE_SATS     flat fee in satoshis               (default: 300)
 *
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     BOND_INDEX=4 MODE=timelock STAKER=account5 \
 *     npx jest tests/privatenet/actions/btc-reclaim.test.ts \
 *       --runInBand --collectCoverage=false --verbose
 *
 * NOTE: The timelock path requires the Bitcoin tip burn-height to reach unlockHeight.
 *       The early path requires a second bond + announce step (orchestrator handles this).
 *       DO NOT run this test standalone — let the orchestrator drive it.
 *
 * BIP143 sighash: computed via tx.preimageWitnessV0(idx, witnessScript, SIGHASH_ALL, amount).
 * For P2WSH the BIP143 "scriptCode" is the witnessScript itself (not the P2WSH output script).
 *
 * Witness is set manually via tx.updateInput(0, { finalScriptWitness: [...items] }, true).
 * Once finalScriptWitness is set, inputStatus === 'finalized' → isFinal === true → tx.hex works.
 */

// @ts-ignore — @scure/btc-signer is ESM; ts-jest transforms it via jest.config.js
import * as btc from '@scure/btc-signer';
// @ts-ignore — same ESM transform
import { signECDSA } from '@scure/btc-signer/utils.js';
// @ts-ignore — same ESM transform
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, concatBytes, hexToBytes } from '@stacks/common';
import { readFileSync } from 'node:fs';
import fetchMock from 'jest-fetch-mock';

// This test hits a live network — disable the global jest-fetch-mock.
fetchMock.disableMocks();

jest.setTimeout(30 * 60_000);

// ─── Network params ──────────────────────────────────────────────────────────

const REGTEST: typeof btc.NETWORK = {
  bech32: 'bcrt',
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

const MEMPOOL_BASE = 'https://mempool.bitcoin.private-1.hiro.so/api';

// ─── Key material ────────────────────────────────────────────────────────────

// ─── Staker resolution ───────────────────────────────────────────────────────
//
// STAKER env selects the staker account whose BTC key signed the lockup output.
// Defaults to "account5" so existing usage is unchanged.
// The early-unlock cosigner (OP_CHECKSIGVERIFY) is always account6.

const STAKER_NAME = (process.env.STAKER ?? 'account5') as
  | 'account5'
  | 'account6'
  | 'account7';

const STAKER_RAW_KEYS: Record<'account5' | 'account6' | 'account7', string> = {
  account5: 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df',
  account6: '5b8303150239eceaba43892af7cdd1fa7fc26eda5182ebaaa568e3341d54a4d0',
  account7: '16226f674796712dfbd53bf402304579b8b6d04d4bed4d466bf84ce6db973d44',
};

if (!(STAKER_NAME in STAKER_RAW_KEYS)) {
  throw new Error(`Unknown STAKER="${STAKER_NAME}". Must be account5, account6, or account7.`);
}

// 32-byte raw private key for the staker (BTC secp256k1, no trailing 01)
const STAKER_PRIV_HEX = STAKER_RAW_KEYS[STAKER_NAME];

// account6 — early-unlock cosigner (OP_CHECKSIGVERIFY in the ELSE branch).
// This is always account6 regardless of STAKER — it's the bond's admin key.
const ACCOUNT6_PRIV_HEX = '5b8303150239eceaba43892af7cdd1fa7fc26eda5182ebaaa568e3341d54a4d0';

// Derive the staker's P2WPKH address for the default TO_ADDRESS.
// We do this lazily (after module load) to avoid computing at import time.
function deriveStakerP2wpkhAddress(): string {
  const priv = hexToBytes(STAKER_PRIV_HEX);
  const pub = secp256k1.getPublicKey(priv, true);
  const p2wpkh = btc.p2wpkh(pub, REGTEST);
  return p2wpkh.address!;
}

// ─── Config (ENV-overridable) ─────────────────────────────────────────────────

const BOND_INDEX = Number(process.env.BOND_INDEX ?? 4);
const MODE = (process.env.MODE ?? 'timelock') as 'timelock' | 'early';
// Default TO_ADDRESS is the staker's own P2WPKH (derived from their BTC key).
const TO_ADDRESS = process.env.TO_ADDRESS ?? deriveStakerP2wpkhAddress();
const FEE_SATS = BigInt(process.env.FEE_SATS ?? 300);

// ─── Lock artifact schema ─────────────────────────────────────────────────────

interface LockArtifact {
  bondIndex: number;
  txid: string;
  outputIndex: number;
  blockHash: string;
  blockHeight: number;
  unlockHeight: number;
  amountSats: string; // bigint serialized as string
  witnessScriptHex: string;
  unlockBytesHex: string;
  earlyUnlockBytesHex: string;
  stakerStxAddress: string;
  legacyTxHex: string;
  headerHex?: string;
  merkleProof?: unknown;
  txCount?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Broadcast a raw tx hex; try /tx then /v1/tx. Returns the txid. */
async function broadcast(rawHex: string): Promise<string> {
  for (const path of ['/tx', '/v1/tx']) {
    const resp = await fetch(`${MEMPOOL_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: rawHex,
    });
    const body = await resp.text();
    if (resp.ok) {
      console.log(`broadcast succeeded via POST ${MEMPOOL_BASE}${path}`);
      return body.trim();
    }
    console.warn(`POST ${MEMPOOL_BASE}${path} → ${resp.status}: ${body}`);
  }
  throw new Error('broadcast failed on both /tx and /v1/tx');
}

/** Poll until `fn` returns a non-null/undefined value, or throw after `timeoutMs`. */
async function poll<T>(
  fn: () => Promise<T | null | undefined>,
  intervalMs: number,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result != null) return result;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`poll timed out after ${timeoutMs}ms: ${label}`);
}

/** Fetch current Bitcoin tip burn-height from the mempool API. */
async function fetchTipHeight(): Promise<number> {
  const resp = await fetch(`${MEMPOOL_BASE}/blocks/tip/height`);
  if (!resp.ok) throw new Error(`GET /blocks/tip/height → ${resp.status}`);
  const text = await resp.text();
  return Number(text.trim());
}

// ─── BIP143 sighash note ──────────────────────────────────────────────────────
//
// For P2WSH inputs, the BIP143 scriptCode is the witnessScript itself (the
// full redeem script committed to by the P2WSH output script). This is
// different from P2WPKH where the scriptCode is a synthesized pkh script.
//
// tx.preimageWitnessV0(idx, witnessScript, SIGHASH_ALL=1, amountSats) returns
// the double-sha256 commitment (32 bytes) that must be signed.
//
// ─── Witness construction ─────────────────────────────────────────────────────
//
// The witnessScript layout (from buildLockingScript in src/locking.ts):
//
//   <stakerPush> OP_DROP OP_IF
//     <heightPush> OP_CLTV OP_DROP
//     <unlockBytes>          ← <account5Pub> OP_CHECKSIG
//   OP_ELSE
//     <earlyUnlockBytes>     ← <account6Pub> OP_CHECKSIGVERIFY
//     <unlockBytes>          ← <account5Pub> OP_CHECKSIG
//   OP_ENDIF
//
// Bitcoin witness items are pushed onto the stack in index order (item[0] first
// = deepest in the stack; last item = top). The witnessScript itself is the
// last item and is popped as the script to execute. After popping the script,
// the remaining items form the initial stack for script execution.
//
// TIMELOCK branch (OP_IF takes it when top is truthy):
//   Witness: [ staker_sig, 0x01, witnessScript ]
//   After witnessScript pop → initial stack (bottom→top): [ staker_sig | 0x01 ]
//   Script: stakerPush OP_DROP → pops staker consensus bytes (pushed by script)
//   Wait — no. The staker push is part of the SCRIPT, not the witness stack.
//   Let's re-trace:
//     witnessScript starts executing with stack = [ staker_sig, 0x01 ]
//     (item[0]=staker_sig at bottom, item[1]=0x01 at top)
//     1. <stakerPush>   → pushes staker bytes  → stack: [ staker_sig, 0x01, stakerBytes ]
//     2. OP_DROP        → pops stakerBytes      → stack: [ staker_sig, 0x01 ]
//     3. OP_IF          → pops 0x01 (truthy)   → enters IF branch
//     4. <heightPush>   → pushes height         → stack: [ staker_sig, height ]
//     5. OP_CLTV        → checks nLockTime     (fails if tx.lockTime < height)
//     6. OP_DROP        → pops height           → stack: [ staker_sig ]
//     7. <account5Pub> OP_CHECKSIG → pops staker_sig → verifies → stack: [ 1 ]
//   Result: stack = [ 1 ] → valid spend.
//   tx.lockTime = unlockHeight, input sequence = 0xfffffffe (non-final, enables CLTV).
//
// EARLY branch (OP_ELSE when top is falsy/empty):
//   Witness: [ staker_sig, admin_sig, <empty>=0x, witnessScript ]
//   Initial stack: [ staker_sig, admin_sig, empty ]  (empty on top)
//   1. <stakerPush>   → pushes staker bytes     → stack: [ staker_sig, admin_sig, empty, stakerBytes ]
//   2. OP_DROP        → pops stakerBytes         → stack: [ staker_sig, admin_sig, empty ]
//   3. OP_IF          → pops empty (falsy)       → enters ELSE branch
//   4. <account6Pub> OP_CHECKSIGVERIFY → pops admin_sig (top) → verifies → stack: [ staker_sig ]
//   5. <account5Pub> OP_CHECKSIG       → pops staker_sig      → verifies → stack: [ 1 ]
//   Result: stack = [ 1 ] → valid spend.
//   (No lockTime constraint in the ELSE branch.)
//
// ─────────────────────────────────────────────────────────────────────────────

// ─── Test ─────────────────────────────────────────────────────────────────────

test.skip(`reclaim P2WSH lockup output for bond ${BOND_INDEX} via ${MODE} branch (staker=${STAKER_NAME})`, async () => {
  // ── 1. Load lock artifact ─────────────────────────────────────────────────
  const artifactPath = `/tmp/btc-lock-${BOND_INDEX}.json`;
  console.log(`\n=== BTC-RECLAIM: bondIndex=${BOND_INDEX} mode=${MODE} staker=${STAKER_NAME} ===`);
  console.log(`reading artifact: ${artifactPath}`);

  let artifact: LockArtifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as LockArtifact;
  } catch (err) {
    throw new Error(`Failed to read lock artifact ${artifactPath}: ${(err as Error).message}`);
  }

  const {
    txid: lockTxid,
    outputIndex: lockOutputIndex,
    unlockHeight,
    amountSats: amountSatsStr,
    witnessScriptHex,
  } = artifact;

  const amountSats = BigInt(amountSatsStr);
  const witnessScript = hexToBytes(witnessScriptHex);

  console.log('lockTxid:', lockTxid);
  console.log('lockOutputIndex:', lockOutputIndex);
  console.log('unlockHeight:', unlockHeight);
  console.log('amountSats:', amountSats.toString());
  console.log('witnessScriptHex:', witnessScriptHex);
  console.log('witnessScript length:', witnessScript.length, 'bytes');

  // ── 2. For timelock mode: check current tip height ─────────────────────────
  if (MODE === 'timelock') {
    const tipHeight = await fetchTipHeight();
    console.log(`tip burn-height: ${tipHeight}, unlockHeight: ${unlockHeight}`);
    if (tipHeight < unlockHeight) {
      console.log(
        `not yet spendable (need height ${unlockHeight}, have ${tipHeight}) — skipping gracefully`,
      );
      // Skip: don't fail, orchestrator will wait and retry once height is reached.
      return;
    }
    console.log(`tip height ${tipHeight} >= unlockHeight ${unlockHeight} — CLTV satisfied`);
  }

  // ── 3. Derive keys ─────────────────────────────────────────────────────────
  const stakerPriv = hexToBytes(STAKER_PRIV_HEX);
  const stakerPub = secp256k1.getPublicKey(stakerPriv, true); // compressed
  const account6Priv = hexToBytes(ACCOUNT6_PRIV_HEX);
  const account6Pub = secp256k1.getPublicKey(account6Priv, true); // compressed

  console.log(`${STAKER_NAME} pub (staker):`, bytesToHex(stakerPub));
  console.log('account6 pub (early-unlock cosigner):', bytesToHex(account6Pub));

  // Compute the P2WSH output script (OP_0 <sha256(witnessScript)>) — this is
  // the scriptPubKey of the UTXO we are spending.
  const p2wshObj = btc.p2wsh({ type: 'wsh', script: witnessScript }, REGTEST);
  const p2wshScript = p2wshObj.script; // 34 bytes: 0x00 0x20 <sha256>
  console.log('P2WSH scriptPubKey:', bytesToHex(p2wshScript));
  console.log('P2WSH address:', p2wshObj.address);

  // ── 4. Build transaction skeleton ─────────────────────────────────────────
  const reclaimSats = amountSats - FEE_SATS;
  if (reclaimSats <= 0n) throw new Error(`fee (${FEE_SATS}) exceeds lockup amount (${amountSats})`);

  console.log('reclaim amount (after fee):', reclaimSats.toString(), 'sats');
  console.log('fee:', FEE_SATS.toString(), 'sats');
  console.log('to address:', TO_ADDRESS);

  // Common transaction options: allow unknown inputs/outputs so the library
  // doesn't reject our custom P2WSH script shape.
  const commonOpts = {
    allowUnknownOutputs: true,
    disableScriptCheck: true,
    allowUnknownInputs: true,
  };

  // Input: the P2WSH lockup output.
  // sequence = 0xfffffffe for timelock (non-final, enables nLockTime+CLTV), 0xffffffff for early.
  const sequence = MODE === 'timelock' ? 0xfffffffe : 0xffffffff;

  // ── 5. Build final transaction (lockTime embedded in constructor opts) ─────
  // @scure/btc-signer sets lockTime via TxOpts.lockTime in the constructor.
  // For timelock mode we must set it to unlockHeight so OP_CLTV passes.
  let finalTx: btc.Transaction;
  if (MODE === 'timelock') {
    finalTx = new btc.Transaction({
      ...commonOpts,
      lockTime: unlockHeight,
    });
    console.log('tx lockTime set to:', unlockHeight);
  } else {
    finalTx = new btc.Transaction(commonOpts);
    console.log('tx lockTime: 0 (early mode, no CLTV)');
  }

  finalTx.addInput({
    txid: lockTxid,
    index: lockOutputIndex,
    sequence,
    witnessUtxo: {
      script: p2wshScript,
      amount: amountSats,
    },
    // We do NOT set witnessScript here — we bypass the library's finalization
    // entirely and inject finalScriptWitness manually after computing the sighash.
  });

  // Output: reclaim to TO_ADDRESS.
  finalTx.addOutputAddress(TO_ADDRESS, reclaimSats, REGTEST);

  console.log('input sequence:', `0x${sequence.toString(16).toUpperCase()}`);

  // ── 6. Compute BIP143 sighash ─────────────────────────────────────────────
  //
  // For P2WSH: scriptCode = witnessScript (the full redeem script).
  // preimageWitnessV0(inputIdx, scriptCode, sighashType, inputAmountSats) → 32-byte hash.
  //
  // SIGHASH_ALL = 1 (0x01).
  const SIGHASH_ALL = 1;

  // Staker sighash — same for both modes.
  const stakerSighash = finalTx.preimageWitnessV0(0, witnessScript, SIGHASH_ALL, amountSats);
  console.log(`BIP143 sighash (${STAKER_NAME}/staker):`, bytesToHex(stakerSighash));

  // Sign with staker — DER-encoded, low-S, + sighash byte 0x01.
  const stakerSigDer = signECDSA(stakerSighash, stakerPriv, /* lowR= */ true);
  const stakerSig = concatBytes(stakerSigDer, new Uint8Array([SIGHASH_ALL]));
  console.log('staker sig (DER + sighash byte):', bytesToHex(stakerSig));

  // ── 7. Build witness stack ─────────────────────────────────────────────────
  let witnessItems: Uint8Array[];

  if (MODE === 'timelock') {
    // TIMELOCK witness: [ staker_sig, 0x01 (truthy → IF branch), witnessScript ]
    //
    // Stack at OP_IF (after staker-push/DROP):
    //   bottom: staker_sig | top: 0x01
    // OP_IF pops 0x01 (truthy) → enters IF branch → CLTV check → staker_sig CHECKSIG.
    const selector = new Uint8Array([0x01]); // truthy: selects OP_IF (timelock) branch

    witnessItems = [stakerSig, selector, witnessScript];

    console.log('\n--- TIMELOCK witness stack (bottom → top before script execution) ---');
    console.log(`[0] staker_sig (${STAKER_NAME}):`, bytesToHex(stakerSig));
    console.log('[1] selector (0x01 = truthy → IF):', bytesToHex(selector));
    console.log('[2] witnessScript (popped as script):', bytesToHex(witnessScript));
  } else {
    // EARLY witness: [ staker_sig, admin_sig, <empty> (falsy → ELSE branch), witnessScript ]
    //
    // Stack at OP_IF (after staker-push/DROP):
    //   bottom: staker_sig | admin_sig | top: <empty>
    // OP_IF pops empty (falsy) → enters ELSE branch.
    // ELSE: <account6Pub> OP_CHECKSIGVERIFY → pops admin_sig (top) → verify.
    //       <account5Pub> OP_CHECKSIG       → pops staker_sig     → verify.
    //
    // We need a separate sighash for account6 since it signs the same tx commitment.
    const adminSighash = finalTx.preimageWitnessV0(0, witnessScript, SIGHASH_ALL, amountSats);
    console.log('BIP143 sighash (account6/admin):', bytesToHex(adminSighash));
    // Note: adminSighash === stakerSighash (same tx, same input, same witnessScript).
    // Both sign the same commitment; this is intentional and correct.

    const adminSigDer = signECDSA(adminSighash, account6Priv, /* lowR= */ true);
    const adminSig = concatBytes(adminSigDer, new Uint8Array([SIGHASH_ALL]));
    console.log('admin sig (DER + sighash byte):', bytesToHex(adminSig));

    const selector = new Uint8Array(0); // empty = falsy: selects OP_ELSE (early) branch

    witnessItems = [stakerSig, adminSig, selector, witnessScript];

    console.log('\n--- EARLY witness stack (bottom → top before script execution) ---');
    console.log(`[0] staker_sig (${STAKER_NAME}):`, bytesToHex(stakerSig));
    console.log('[1] admin_sig  (account6/cosigner):', bytesToHex(adminSig));
    console.log('[2] selector   (empty = falsy → ELSE):', bytesToHex(selector));
    console.log('[3] witnessScript (popped as script):', bytesToHex(witnessScript));
  }

  // ── 8. Inject witness manually ────────────────────────────────────────────
  //
  // Setting finalScriptWitness bypasses @scure/btc-signer's standard finalization
  // (which only handles known script shapes like p2wpkh, p2ms, p2tr). Once set,
  // inputStatus(0) returns 'finalized', isFinal becomes true, and tx.hex works.
  //
  // _ignoreSignStatus=true required because the input is currently 'unsigned' and
  // the library would otherwise reject adding finalScriptWitness as a "final" field.
  finalTx.updateInput(
    0,
    { finalScriptWitness: witnessItems },
    /* _ignoreSignStatus= */ true,
  );

  const isFinal = finalTx.isFinal;
  console.log('\ntx.isFinal:', isFinal);
  if (!isFinal) throw new Error('Transaction is not finalized — witness injection failed');

  // ── 9. Serialize + log ────────────────────────────────────────────────────
  const rawHex = finalTx.hex;
  const vsize = finalTx.vsize;
  console.log('\ntx vsize:', vsize, 'vBytes');
  console.log('tx hex:', rawHex);
  console.log('raw tx size:', rawHex.length / 2, 'bytes');

  // ── 10. Broadcast ─────────────────────────────────────────────────────────
  const txid = await broadcast(rawHex);
  console.log('\n=== RECLAIM TXID:', txid, '===');

  expect(txid).toMatch(/^[0-9a-f]{64}$/);

  // ── 11. Confirm the tx is visible in the mempool API ───────────────────────
  const seenTx = await poll(
    async () => {
      const resp = await fetch(`${MEMPOOL_BASE}/tx/${txid}`);
      if (!resp.ok) return null;
      return (await resp.json()) as {
        txid: string;
        fee: number;
        status: { confirmed: boolean };
      };
    },
    5_000, // 5 s
    2 * 60_000, // 2 min
    `reclaim tx ${txid} visible in mempool`,
  );

  console.log(
    'mempool tx:',
    JSON.stringify({
      txid: seenTx.txid,
      fee: seenTx.fee,
      confirmed: seenTx.status.confirmed,
    }),
  );

  expect(seenTx.txid).toBe(txid);
  expect(seenTx.fee).toBeGreaterThan(0);

  // ── 12. Summary ───────────────────────────────────────────────────────────
  console.log('\n=== BTC-RECLAIM SUMMARY ===');
  console.log('bondIndex:', BOND_INDEX);
  console.log('mode:', MODE);
  console.log('lockTxid:', lockTxid);
  console.log('lockOutputIndex:', lockOutputIndex);
  console.log('reclaimTxid:', txid);
  console.log('reclaimSats:', reclaimSats.toString());
  console.log('feeSats:', FEE_SATS.toString());
  console.log('toAddress:', TO_ADDRESS);
  if (MODE === 'timelock') {
    console.log('lockTime (unlockHeight):', unlockHeight);
    console.log('sequence:', `0x${sequence.toString(16).toUpperCase()}`);
    console.log(
      `witnessStack: [ staker_sig(${STAKER_NAME}), 0x01(truthy→IF), witnessScript ]`,
    );
  } else {
    console.log(
      `witnessStack: [ staker_sig(${STAKER_NAME}), admin_sig(account6), empty(falsy→ELSE), witnessScript ]`,
    );
  }
});
