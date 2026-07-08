// TODO(live): requires a covenant-enabled bond (early-unlock-bytes = the KMS
// leaf key) with an L1-enrolled staker who has announced early exit. Honest-SKIPs
// otherwise. This is the FINAL proof: a real on-chain early-exit reclaim whose
// cosigner signature comes from the KMS /v1/sign service.
/**
 * ACTION — LIVE early-exit reclaim cosigned by the KMS covenant service.
 *
 * The end-to-end goal: prove the covenant early-unlock-bytes actually work by
 * spending a real P2WSH lockup via the OP_ELSE branch, where the cosigner leg is
 * signed by POST /v1/sign (KMS) — not a local key.
 *
 * Everything is built with btc-signer via the package's own reclaim helpers
 * (buildReclaim / computeReclaimSighash / finalizeReclaim), so the witness is
 * assembled exactly as production would. The covenant leg:
 *   1. buildReclaim(early-exit) over the staker's funded lockup UTXO
 *   2. computeReclaimSighash(tx)                    → BIP-143 digest
 *   3. staker signs locally (signReclaim)           → staker leg
 *   4. POST /v1/sign(tx, prevout, witnessScript)    → covenant leg (DER)
 *   5. finalizeReclaim(early-exit)                  → [stakerSig, cosignerSig,
 *                                                      preimage, <empty>, script]
 *   6. broadcast + confirm on-chain.
 *
 * Preconditions (honest skip — no fake pass):
 *   • staker (STAKER, default account5) L1-enrolled in a bond whose
 *     earlyUnlockBytes == the covenant leaf script, AND has announced early exit;
 *   • a spendable P2WSH lockup UTXO exists;
 *   • /v1/public-key and /v1/sign are reachable.
 *
 * Run:
 *   set -a; . packages/bitcoin-staking/.env; set +a
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *   BITCOIN_TX_TIMEOUT=300000 STACKS_TX_TIMEOUT=300000 STAKER=account5 \
 *   RECORD=1 npx jest tests/privatenet/actions/covenant-reclaim.test.ts \
 *     --runInBand --collectCoverage=false --verbose
 */

// @ts-ignore — @scure/btc-signer is ESM; ts-jest transforms it via jest.config.js
import * as btc from '@scure/btc-signer';
import { bytesToHex, concatBytes, hexToBytes } from '@stacks/common';
import {
  buildLockScript,
  buildUnlockScript,
  buildReclaim,
  computeReclaimSighash,
  finalizeReclaim,
  signReclaim,
  fetchBond,
  fetchBondL1UnlockHeight,
  fetchBondMembership,
  fetchHasAnnouncedL1EarlyExit,
} from '../../../src';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork, ENV } from '../../helpers/utils';
import { REGTEST, broadcastBtc, getUtxos, waitForConfirmed } from '../../helpers/btc-wallet';
import {
  COVENANT_LEAF,
  covenantEarlyUnlockBytesHex,
  deriveCovenantPubkey,
  fetchCovenantKey,
  fullDerivationPath,
  signViaCovenantApi,
  verifyCovenantSig,
} from '../../helpers/covenant';
import { useFixtures } from '../../helpers/mock';

jest.setTimeout(900_000);

const STAKER_NAME = (process.env.STAKER ?? 'account5') as keyof typeof REGTEST_KEYS;
const STAKER_FULL_KEY = REGTEST_KEYS[STAKER_NAME];
if (!STAKER_FULL_KEY) throw new Error(`Unknown STAKER="${String(STAKER_NAME)}"`);
const STAKER_PRIV_HEX = STAKER_FULL_KEY.slice(0, 64); // drop compression-flag byte

const SIGHASH_ALL = 1;
const SWEEP_FEE_SATS = BigInt(process.env.SWEEP_FEE_SATS ?? 500);

const staker = getAccount(STAKER_FULL_KEY);
const network = getNetwork();
const POLL_MS = ENV.POLL_INTERVAL > 250 ? ENV.POLL_INTERVAL : 15_000;
const TIMEOUT_MS = ENV.BITCOIN_TX_TIMEOUT > 10_000 ? ENV.BITCOIN_TX_TIMEOUT : 25 * 60_000;

beforeAll(() => useFixtures('covenant-reclaim'));

// Runs in mock (rerun) mode by replaying fixtures-covenant-reclaim.json; RECORD=1
// re-captures against live. RECORD PRECONDITION (a record runner must set this up
// first, since the reclaim spends the lockup UTXO one-shot): a fresh
// btc-lock → register-for-bond-l1 → announce-early-exit for STAKER on a covenant
// bond. First proven end-to-end 2026-07-07: reclaim txid
// ce3e8c61ced08b092082d1dc0c042a0f5773f29bf7acbe753653872e0dad7705, block 316
// (bond 3, account5). Honest-skips (not fails) if preconditions are unmet.
test('early-exit reclaim cosigned by the KMS covenant service', async () => {
  console.log('\n========== covenant-reclaim (LIVE) ==========');
  console.log('staker:', staker.address);

  // ── 0. covenant key + expected early-unlock-bytes ───────────────────────────
  const key = await fetchCovenantKey();
  if (!key) {
    console.warn('SKIP: covenant /public-key not reachable.');
    expect(key).toBeNull();
    return;
  }
  const covenantPub = deriveCovenantPubkey(key.xpub);
  const expectedEub = covenantEarlyUnlockBytesHex(key.xpub);
  const bip32Path = fullDerivationPath(key.derivationPath, COVENANT_LEAF);
  console.log('covenant leaf pubkey:', bytesToHex(covenantPub), 'path:', bip32Path);

  // ── 1. staker must be L1-enrolled in a covenant-enabled bond ────────────────
  const membership = await fetchBondMembership({ address: staker.address, network });
  if (!membership || !membership.isL1Lock) {
    console.warn(`SKIP: ${staker.address} is not L1-enrolled in any bond.`);
    expect(membership?.isL1Lock ?? false).toBe(false);
    return;
  }
  const bondIndex = membership.bondIndex;
  const bond = await fetchBond({ bondIndex, network });
  if (!bond) throw new Error(`bond ${bondIndex} not found on-chain`);
  console.log(`bond ${bondIndex} earlyUnlockBytes:`, bond.earlyUnlockBytes);
  if (bond.earlyUnlockBytes.toLowerCase() !== expectedEub.toLowerCase()) {
    console.warn(
      `SKIP: bond ${bondIndex} is not covenant-enabled ` +
      `(earlyUnlockBytes ${bond.earlyUnlockBytes} != covenant ${expectedEub}).`
    );
    expect(bond.earlyUnlockBytes.toLowerCase()).not.toBe(expectedEub.toLowerCase());
    return;
  }

  // ── 2. must have announced early exit ───────────────────────────────────────
  const announced = await fetchHasAnnouncedL1EarlyExit({ bondIndex, staker: staker.address, network });
  if (!announced) {
    console.warn(`SKIP: staker has not announced early exit for bond ${bondIndex}.`);
    expect(announced).toBe(false);
    return;
  }
  console.log('precondition: covenant bond + L1-enrolled + announced ✓');

  // ── 3. locate the funded P2WSH lockup UTXO ──────────────────────────────────
  const stakerBtcPub = hexToBytes(staker.publicKey);
  const unlockHeight = Number(await fetchBondL1UnlockHeight({ bondIndex, network }));
  const witnessScript = buildLockScript({
    stxAddress: staker.address,
    unlockHeight,
    unlockBytes: buildUnlockScript(stakerBtcPub),
    earlyUnlockBytes: hexToBytes(bond.earlyUnlockBytes),
  });
  const p2wsh = btc.p2wsh({ type: 'wsh', script: witnessScript }, REGTEST);
  const p2wshScriptHex = bytesToHex(p2wsh.script);
  console.log('P2WSH lockup address:', p2wsh.address);

  const utxos = await getUtxos(p2wsh.address!, p2wshScriptHex);
  const utxo = utxos.slice().sort((a, b) => (b.value > a.value ? 1 : -1))[0];
  if (!utxo) {
    console.warn(`SKIP: no spendable P2WSH UTXO at ${p2wsh.address}.`);
    expect(utxos.length).toBe(0);
    return;
  }
  console.log(`lockup UTXO ${utxo.txid}:${utxo.vout} (${utxo.value} sats)`);

  // ── 4. build the early-exit reclaim (btc-signer via src helper) ─────────────
  // buildReclaim maps the Stacks network → testnet btc (tb1). The sweep output's
  // scriptPubKey is the same witness program regardless of HRP, so we encode the
  // staker's own P2WPKH under TEST_NETWORK to match (bcrt1 would base58-fail here).
  const sweepTo = btc.p2wpkh(stakerBtcPub, btc.TEST_NETWORK).address!;
  const tx = buildReclaim({
    path: 'early-exit',
    network,
    lockScript: witnessScript,
    utxo: { txid: utxo.txid, vout: utxo.vout, value: utxo.value },
    output: { address: sweepTo, feeSats: SWEEP_FEE_SATS },
  });
  const sighash = computeReclaimSighash(tx);
  console.log('reclaim sighash:', bytesToHex(sighash));

  // ── 5. staker leg (local) + covenant leg (KMS /v1/sign) ─────────────────────
  const stakerSig = signReclaim(sighash, STAKER_PRIV_HEX);

  const signed = await signViaCovenantApi({
    txHex: bytesToHex(tx.toBytes(false, false)),
    inputIndex: 0,
    bip32Derivation: bip32Path,
    prevoutScriptPubKeyHex: p2wshScriptHex,
    prevoutValueSats: utxo.value,
    witnessScriptHex: bytesToHex(witnessScript),
  });
  if (!signed) {
    console.warn('SKIP: covenant /sign not reachable.');
    expect(signed).toBeNull();
    return;
  }
  // the service computes its own sighash — it MUST equal ours, and the sig MUST
  // verify under the covenant pubkey, or the witness would fail on-chain.
  expect(signed.sighash.toLowerCase()).toBe(bytesToHex(sighash));
  expect(signed.publicKey.toLowerCase()).toBe(bytesToHex(covenantPub));
  expect(verifyCovenantSig(signed.signature, signed.sighash, covenantPub)).toBe(true);
  console.log('covenant signature verified against derived pubkey ✓');

  const cosignerSig = concatBytes(hexToBytes(signed.signature), new Uint8Array([SIGHASH_ALL]));

  // ── 6. assemble ELSE-branch witness + broadcast ─────────────────────────────
  tx.updateInput(0, { partialSig: [[stakerBtcPub, stakerSig], [covenantPub, cosignerSig]] });
  const { txHex, txid: localTxid } = finalizeReclaim({ path: 'early-exit', tx, stxAddress: staker.address });
  console.log('assembled reclaim txid (local):', localTxid);

  const reclaimTxid = await broadcastBtc(txHex);
  console.log('=== RECLAIM TXID:', reclaimTxid, '===');
  expect(reclaimTxid).toMatch(/^[0-9a-f]{64}$/);

  const conf = await waitForConfirmed(reclaimTxid, { intervalMs: POLL_MS, timeoutMs: TIMEOUT_MS });
  console.log('reclaim confirmed in block', conf.block_height);
  console.log('\n=== covenant-reclaim: SUCCESS — on-chain early-exit via KMS cosigner ✓ ===');
});
