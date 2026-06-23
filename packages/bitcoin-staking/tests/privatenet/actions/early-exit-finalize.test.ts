// TODO(fixtures): live-only — needs a cosigner-enabled bond with an L1-enrolled,
// already-announced staker. Honest-skips otherwise. Re-record with RECORD=1.
/**
 * ACTION — STAKER-INITIATED early-exit finalize.
 *
 * Scenario: "the staker hands US a PARTIAL reclaim tx already signed with THEIR
 * key; on our end we add the cosigner (account6) signature, assemble the
 * ELSE-branch witness, and broadcast."
 *
 * This is the staker-first ordering of the 2-of-2 ELSE-branch reclaim — the
 * mirror image of early-exit-cosign-prepare.test.ts:
 *   1. (simulated receive) staker builds reclaim + sighash, signs with account5,
 *      gives us a partial with stakerSig SET / cosignerSig UNSET.
 *   2. OUR side: load it, add the account6 cosignerSig, assembleAndFinalize,
 *      broadcast.
 *
 * The witness/sighash are modeled EXACTLY on
 * tests/privatenet/e2e/exit-l1-announce-and-reclaim.e2e.test.ts and
 * tests/privatenet/actions/btc-lockup-roundtrip.test.ts (TEST 1, EARLY branch):
 *   sighash = tx.preimageWitnessV0(0, witnessScript, SIGHASH_ALL, amount)
 *   witness = [ stakerSig, cosignerSig, preimage, <empty→ELSE>, witnessScript ]
 *
 * Precondition guard (honest skip — no fake pass): same as cosign-prepare —
 * staker (default account5, override via STAKER) L1-enrolled in a cosigner-
 * enabled bond AND has announced early exit. Otherwise SKIP.
 *
 * Live run:
 *   set -a; . packages/bitcoin-staking/.env; set +a
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *   POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *   BITCOIN_TX_TIMEOUT=300000 STACKS_TX_TIMEOUT=300000 \
 *   RECORD=1 \
 *   npx jest tests/privatenet/actions/early-exit-finalize.test.ts \
 *     --runInBand --collectCoverage=false --verbose
 */

// @ts-ignore — @scure/btc-signer is ESM; ts-jest transforms it via jest.config.js
import * as btc from '@scure/btc-signer';
// @ts-ignore — same ESM transform
import { signECDSA } from '@scure/btc-signer/utils.js';
// @ts-ignore — same ESM transform
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, concatBytes, hexToBytes } from '@stacks/common';
import {
  buildLockScript,
  buildUnlockScript,
  fetchBond,
  fetchBondL1UnlockHeight,
  fetchBondMembership,
  fetchHasAnnouncedL1EarlyExit,
} from '../../../src';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import {
  REGTEST,
  broadcastBtc,
  getUtxos,
  waitForConfirmed,
} from '../../helpers/btc-wallet';
import {
  EarlyExitPartial,
  assembleAndFinalize,
  buildReclaimPartial,
} from '../../helpers/early-exit-partial';
import { useFixtures } from '../../helpers/mock';
import { ENV } from '../../helpers/utils';

jest.setTimeout(900_000);

// STAKER env selects the staker by NAME (account5|account6|account7…); cosigner is always account6.
const STAKER_NAME = (process.env.STAKER ?? 'account5') as keyof typeof REGTEST_KEYS;
const STAKER_FULL_KEY = REGTEST_KEYS[STAKER_NAME];
if (!STAKER_FULL_KEY) throw new Error(`Unknown STAKER="${String(STAKER_NAME)}"`);
// raw 32-byte BTC priv = the full key minus its trailing '01' compressed-key suffix.
const STAKER_PRIV_HEX = STAKER_FULL_KEY.slice(0, 64);
// account6 — the bond's early-unlock COSIGNER (its pubkey is in earlyUnlockBytes).
const COSIGNER_PRIV_HEX = '5b8303150239eceaba43892af7cdd1fa7fc26eda5182ebaaa568e3341d54a4d0';

const SIGHASH_ALL = 1;
const SWEEP_FEE_SATS = BigInt(process.env.SWEEP_FEE_SATS ?? 500);

const staker = getAccount(STAKER_FULL_KEY);
const network = getNetwork();

const POLL_INTERVAL_MS = ENV.POLL_INTERVAL > 250 ? ENV.POLL_INTERVAL : 15_000;
const TIMEOUT_MS = ENV.BITCOIN_TX_TIMEOUT > 10_000 ? ENV.BITCOIN_TX_TIMEOUT : 25 * 60_000;

beforeAll(() => useFixtures('early-exit-finalize'));

test.skip('staker-initiated: cosign + broadcast a staker-signed partial', async () => {
  console.log('\n========== early-exit-finalize (STAKER-FIRST) ==========');
  console.log('staker:', staker.address);

  const stakerPrivBytes = hexToBytes(STAKER_PRIV_HEX);
  const stakerBtcPub = secp256k1.getPublicKey(stakerPrivBytes, true);
  const cosignerPrivBytes = hexToBytes(COSIGNER_PRIV_HEX);
  const cosignerBtcPub = secp256k1.getPublicKey(cosignerPrivBytes, true);

  const expectedEarlyUnlockHex = bytesToHex(buildUnlockScript(cosignerBtcPub));
  console.log('expected cosigner earlyUnlockBytes:', expectedEarlyUnlockHex);

  // ── PRECONDITION GUARD (honest skip) ────────────────────────────────────────
  const membership = await fetchBondMembership({ address: staker.address, network });
  if (!membership || !membership.isL1Lock) {
    console.warn(`SKIP: staker ${staker.address} is not L1-enrolled in any bond.`);
    expect(membership?.isL1Lock ?? false).toBe(false);
    console.log('(skipped — not L1-enrolled)');
    return;
  }
  const bondIndex = membership.bondIndex;
  console.log(`staker enrolled in bond ${bondIndex} (isL1Lock=true)`);

  const bond = await fetchBond({ bondIndex, network });
  if (!bond) throw new Error(`bond ${bondIndex} not found on-chain`);
  console.log('bond earlyUnlockBytes (on-chain):', bond.earlyUnlockBytes);
  if (bond.earlyUnlockBytes.toLowerCase() !== expectedEarlyUnlockHex.toLowerCase()) {
    console.warn(
      `SKIP: bond ${bondIndex} earlyUnlockBytes (${bond.earlyUnlockBytes}) is NOT the ` +
      `account6 cosigner script (${expectedEarlyUnlockHex}). Only cosigner-enabled bonds ` +
      `support the ELSE-branch early-exit reclaim.`,
    );
    expect(bond.earlyUnlockBytes.toLowerCase()).not.toBe(expectedEarlyUnlockHex.toLowerCase());
    console.log('(skipped — bond is not cosigner-enabled)');
    return;
  }

  const announced = await fetchHasAnnouncedL1EarlyExit({ bondIndex, staker: staker.address, network });
  if (!announced) {
    console.warn(
      `SKIP: staker has not announced L1 early exit for bond ${bondIndex}. ` +
      `The ELSE-branch reclaim is only valid after announce-l1-early-exit.`,
    );
    expect(announced).toBe(false);
    console.log('(skipped — early exit not announced)');
    return;
  }
  console.log('precondition: cosigner-enabled bond + L1-enrolled + announced ✓');

  // ── Locate the staker's funded P2WSH lockup UTXO ────────────────────────────
  const earlyUnlockBytes = hexToBytes(bond.earlyUnlockBytes);
  const unlockHeight = Number(await fetchBondL1UnlockHeight({ bondIndex, network }));
  const unlockBytes = buildUnlockScript(stakerBtcPub);
  const witnessScript = buildLockScript({
    stxAddress: staker.address,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });
  const p2wsh = btc.p2wsh({ type: 'wsh', script: witnessScript }, REGTEST);
  const p2wshScriptHex = bytesToHex(p2wsh.script);
  console.log('P2WSH lockup address:', p2wsh.address);

  const utxos = await getUtxos(p2wsh.address!, p2wshScriptHex);
  const utxo = utxos.slice().sort((a, b) => (b.value > a.value ? 1 : -1))[0];
  if (!utxo) {
    console.warn(`SKIP: no spendable P2WSH UTXO at ${p2wsh.address} (already reclaimed?).`);
    expect(utxos.length).toBe(0);
    console.log('(skipped — lockup UTXO already spent)');
    return;
  }
  console.log(`lockup UTXO ${utxo.txid}:${utxo.vout} (${utxo.value} sats)`);

  // ── SIMULATE RECEIVING a STAKER-signed partial ──────────────────────────────
  // In production the staker builds + signs this on their own machine and hands
  // us the JSON; here we reproduce it so the test is self-contained.
  console.log('\n--- simulating staker building + signing the partial (their machine) ---');
  const { partial } = buildReclaimPartial({
    witnessScript,
    lockupTxid: utxo.txid,
    lockupVout: utxo.vout,
    amountSats: utxo.value,
    feeSats: SWEEP_FEE_SATS,
    stakerStxAddress: staker.address,
    stakerBtcPub,
    cosignerBtcPub,
  });
  const sighash = hexToBytes(partial.sighashHex);
  const stakerSig = concatBytes(
    signECDSA(sighash, stakerPrivBytes, true),
    new Uint8Array([SIGHASH_ALL]),
  );
  partial.stakerSig = bytesToHex(stakerSig);
  // cosignerSig deliberately UNSET — this is what the staker hands us.

  // ── OUR (cosigner) STEP: load partial, add cosigner sig, finalize, broadcast ─
  const received: EarlyExitPartial = JSON.parse(JSON.stringify(partial));
  expect(received.stakerSig).toBeDefined();
  expect(received.cosignerSig).toBeUndefined();
  console.log('received staker-signed partial; staker sig present, cosigner sig pending.');

  const cosignerSig = concatBytes(
    signECDSA(sighash, cosignerPrivBytes, true),
    new Uint8Array([SIGHASH_ALL]),
  );
  received.cosignerSig = bytesToHex(cosignerSig);

  const finalHex = assembleAndFinalize(received);
  console.log('received staker partial → cosigned + broadcast on our end.');

  const reclaimTxid = await broadcastBtc(finalHex);
  console.log('=== RECLAIM TXID:', reclaimTxid, '===');
  expect(reclaimTxid).toMatch(/^[0-9a-f]{64}$/);

  const conf = await waitForConfirmed(reclaimTxid, {
    intervalMs: POLL_INTERVAL_MS,
    timeoutMs: TIMEOUT_MS,
  });
  console.log('reclaim confirmed in block', conf.block_height);
  console.log('\n=== early-exit-finalize: SUCCESS ✓ ===');
});
