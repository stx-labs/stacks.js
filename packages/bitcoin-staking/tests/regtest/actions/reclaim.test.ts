/**
 * ACTION — Exercise `src/reclaim.ts` end-to-end against the LIVE regtest
 * bitcoind: build -> sign -> finalize -> broadcast a real P2WSH lockup-reclaim
 * tx, covering both spend paths.
 *
 * Self-contained (no bond, no Stacks txs) — pure BTC, funded + broadcast via
 * bitcoind JSON-RPC (`tests/helpers/btc.ts`), unlike the privatenet roundtrip
 * test's mempool/faucet flow.
 *
 * TEST 1 — `path: 'locktime'` (OP_IF / CLTV): `unlockHeight = tip - 10`
 *   (already past), single-sig staker.
 * TEST 2 — `path: 'early-exit'` (OP_ELSE, cosigned): `unlockHeight = tip + 100`
 *   (far future — CLTV branch unspendable), 2-of-2 staker + cosigner.
 * TEST 3 — `path: 'locktime'` attempted BEFORE `unlockHeight` (`tip + 250`): the
 *   tx is well-formed and correctly signed, but bitcoind must refuse to relay it.
 *   Its 20k sats stay locked — nothing sweeps them, by design.
 *
 * Run (live): RECORD=1 npx jest tests/regtest/actions/reclaim --runInBand --collectCoverage=false
 * Replay (offline, default): npx jest tests/regtest/actions/reclaim --collectCoverage=false
 */

// @ts-ignore — @scure/btc-signer is ESM; ts-jest transforms it via jest.config.js
import * as btc from '@scure/btc-signer';
import { bytesToHex, hexToBytes } from '@stacks/common';
import {
  buildUnlockScript,
  buildLockScript,
  buildLockOutputScript,
  buildReclaim,
  computeReclaimSighash,
  signReclaim,
  finalizeReclaim,
  btcNetworkFrom,
} from '../../../src';
import type { Utxo } from '../../../src';
import { getAccount } from '../regtest';
import {
  getBlockCount,
  sendToAddress,
  findVoutByScript,
  sendRawTransaction,
  getRawTransactionVerbose,
} from '../../helpers/btc';
import { waitForFulfilled } from '../../helpers/wait';
import { useFixtures } from '../../helpers/mock';
import { ENV } from '../../helpers/utils';
import { derivePubKey, privKeyToP2wpkhAddress } from '../../helpers/btc-wallet';

jest.setTimeout(120_000);

const btcNetworkName = ENV.NETWORK; // 'devnet' -> bcrt bech32 (bitcoind regtest)

// Dedicated derived keys — pure BTC, no membership/nonce concerns.
const STAKER_PRIV = hexToBytes('a1a2a3a4a5a6a7a8a9aaabacadaeaf0102030405060708090a0b0c0d0e0f1001');
const COSIGNER_PRIV = hexToBytes(
  'b1b2b3b4b5b6b7b8b9babbbcbdbebf1112131415161718191a1b1c1d1e1f2001'
);
const STAKER_PUB = derivePubKey(STAKER_PRIV);
const COSIGNER_PUB = derivePubKey(COSIGNER_PRIV);
const STAKER_STX_ADDRESS = getAccount(bytesToHex(STAKER_PRIV) + '01').address;
const OP_CHECKSIG = 0xac;

const SWEEP_ADDR = privKeyToP2wpkhAddress(STAKER_PRIV);

const LOCK_SATS = 20_000;
const FEE_SATS = 1000n;

/** `<cosignerPub> OP_CHECKSIG` — same subscript shape as the roundtrip test. */
function buildEarlyUnlockCheckSig(cosignerPub: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + 33 + 1);
  out[0] = 33;
  out.set(cosignerPub, 1);
  out[34] = OP_CHECKSIG;
  return out;
}

test('reclaim via the locktime (CLTV) path', async () => {
  useFixtures('reclaim-locktime-fund');

  const tip = await getBlockCount();
  const unlockHeight = tip - 10; // already past -> CLTV spendable now
  console.log('tip:', tip, 'unlockHeight (past):', unlockHeight);

  const unlockBytes = buildUnlockScript(STAKER_PUB);
  const earlyUnlockBytes = buildEarlyUnlockCheckSig(COSIGNER_PUB);
  const lockScript = buildLockScript({
    stxAddress: STAKER_STX_ADDRESS,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });
  const outputScript = buildLockOutputScript({
    stxAddress: STAKER_STX_ADDRESS,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });
  const p2wshAddr = btc.p2wsh(
    { type: 'wsh', script: lockScript },
    btcNetworkFrom(btcNetworkName)
  ).address!;
  console.log('P2WSH address:', p2wshAddr);

  const fundTxid = await sendToAddress(p2wshAddr, LOCK_SATS / 1e8);
  console.log('funding txid:', fundTxid);

  const found = await waitForFulfilled(() => findVoutByScript(fundTxid, bytesToHex(outputScript)));
  const utxo: Utxo = {
    txid: found.txid,
    vout: found.vout,
    value: found.value,
    scriptPubKey: hexToBytes(found.scriptPubKeyHex),
  };
  console.log('lockup utxo:', utxo);

  const tx = buildReclaim({
    path: 'locktime',
    utxo,
    network: btcNetworkName,
    output: { address: SWEEP_ADDR, feeSats: FEE_SATS },
    lockScript,
  });

  // Detached signing path: computeReclaimSighash + signReclaim + partialSig,
  // instead of tx.signIdx (both leave the same partialSig for finalizeReclaim).
  const sighash = computeReclaimSighash(tx);
  const stakerSig = signReclaim(sighash, STAKER_PRIV);
  tx.updateInput(0, { partialSig: [[STAKER_PUB, stakerSig]] });

  const { txHex, txid } = finalizeReclaim({ path: 'locktime', tx });
  console.log('reclaim tx hex:', txHex);

  useFixtures('reclaim-locktime-sweep');
  const broadcastTxid = await sendRawTransaction(txHex);
  expect(broadcastTxid).toBe(txid);
  console.log('reclaim txid:', broadcastTxid);

  const confirmed = await waitForFulfilled(async () => {
    const raw = await getRawTransactionVerbose(broadcastTxid);
    if (!raw.confirmations || raw.confirmations < 1) throw 'not confirmed yet';
    return raw;
  });
  expect(confirmed.txid).toBe(broadcastTxid);
});

test('reclaim via the early-exit (cosigned) path', async () => {
  useFixtures('reclaim-early-fund');

  const tip = await getBlockCount();
  const unlockHeight = tip + 100; // far future -> CLTV unspendable -> forces early branch
  console.log('tip:', tip, 'unlockHeight (far future):', unlockHeight);

  const unlockBytes = buildUnlockScript(STAKER_PUB);
  const earlyUnlockBytes = buildEarlyUnlockCheckSig(COSIGNER_PUB);
  const lockScript = buildLockScript({
    stxAddress: STAKER_STX_ADDRESS,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });
  const outputScript = buildLockOutputScript({
    stxAddress: STAKER_STX_ADDRESS,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });
  const p2wshAddr = btc.p2wsh(
    { type: 'wsh', script: lockScript },
    btcNetworkFrom(btcNetworkName)
  ).address!;
  console.log('P2WSH address:', p2wshAddr);

  const fundTxid = await sendToAddress(p2wshAddr, LOCK_SATS / 1e8);
  console.log('funding txid:', fundTxid);

  const found = await waitForFulfilled(() => findVoutByScript(fundTxid, bytesToHex(outputScript)));
  const utxo: Utxo = {
    txid: found.txid,
    vout: found.vout,
    value: found.value,
    scriptPubKey: hexToBytes(found.scriptPubKeyHex),
  };
  console.log('lockup utxo:', utxo);

  const tx = buildReclaim({
    path: 'early-exit',
    utxo,
    network: btcNetworkName,
    output: { address: SWEEP_ADDR, feeSats: FEE_SATS },
    lockScript,
  });

  // early-exit is a 2-of-2: both the staker and the cosigner sign input 0 in place
  // (btc-signer computes the BIP-143 sighash internally — no detached signReclaim needed).
  tx.signIdx(STAKER_PRIV, 0);
  tx.signIdx(COSIGNER_PRIV, 0);

  const { txHex, txid } = finalizeReclaim({
    path: 'early-exit',
    tx,
    stxAddress: STAKER_STX_ADDRESS,
  });
  console.log('reclaim tx hex:', txHex);

  useFixtures('reclaim-early-sweep');
  const broadcastTxid = await sendRawTransaction(txHex);
  expect(broadcastTxid).toBe(txid);
  console.log('reclaim txid:', broadcastTxid);

  const confirmed = await waitForFulfilled(async () => {
    const raw = await getRawTransactionVerbose(broadcastTxid);
    if (!raw.confirmations || raw.confirmations < 1) throw 'not confirmed yet';
    return raw;
  });
  expect(confirmed.txid).toBe(broadcastTxid);
});

test('rejects a locktime reclaim attempted before unlockHeight', async () => {
  useFixtures('reclaim-premature-fund');

  const tip = await getBlockCount();
  // A different offset from TEST 2's `tip + 100`: same keys and STX address, so an
  // equal height would build the same lockScript and reuse that test's P2WSH output.
  const unlockHeight = tip + 250; // not yet reached -> the CLTV branch must not relay
  console.log('tip:', tip, 'unlockHeight (future):', unlockHeight);

  const unlockBytes = buildUnlockScript(STAKER_PUB);
  const earlyUnlockBytes = buildEarlyUnlockCheckSig(COSIGNER_PUB);
  const lockScript = buildLockScript({
    stxAddress: STAKER_STX_ADDRESS,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });
  const outputScript = buildLockOutputScript({
    stxAddress: STAKER_STX_ADDRESS,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });
  const p2wshAddr = btc.p2wsh(
    { type: 'wsh', script: lockScript },
    btcNetworkFrom(btcNetworkName)
  ).address!;
  console.log('P2WSH address:', p2wshAddr);

  const fundTxid = await sendToAddress(p2wshAddr, LOCK_SATS / 1e8);
  console.log('funding txid:', fundTxid);

  const found = await waitForFulfilled(() => findVoutByScript(fundTxid, bytesToHex(outputScript)));
  const utxo: Utxo = {
    txid: found.txid,
    vout: found.vout,
    value: found.value,
    scriptPubKey: hexToBytes(found.scriptPubKeyHex),
  };

  const tx = buildReclaim({
    path: 'locktime',
    utxo,
    network: btcNetworkName,
    output: { address: SWEEP_ADDR, feeSats: FEE_SATS },
    lockScript,
  });

  // `buildReclaim` copies the script's CLTV height into nLockTime and sets
  // sequence to 0xfffffffe, so the tx is non-final until the chain reaches it.
  expect(tx.lockTime).toBe(unlockHeight);

  const sighash = computeReclaimSighash(tx);
  tx.updateInput(0, { partialSig: [[STAKER_PUB, signReclaim(sighash, STAKER_PRIV)]] });

  // Signing and assembly must both succeed — the tx is valid, just not yet final.
  const { txHex } = finalizeReclaim({ path: 'locktime', tx });
  expect(txHex.length).toBeGreaterThan(0);

  useFixtures('reclaim-premature-reject');
  const rejection = await sendRawTransaction(txHex).then(
    txid => {
      throw new Error(`expected a rejection, but bitcoind accepted ${txid}`);
    },
    (error: Error) => error.message
  );
  console.log('rejection:', rejection);

  // bitcoind wording varies by version; every variant names the locktime rule.
  expect(rejection).toMatch(/non-final|non-BIP68-final|locktime|Locktime/i);
});
