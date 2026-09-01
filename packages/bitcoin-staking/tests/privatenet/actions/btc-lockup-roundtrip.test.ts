/**
 * ACTION — Prove the P2WSH lockup RECLAIM machinery end-to-end on the live
 * private-1 BTC network, independent of the bond contract (no Stacks txs).
 * Pure BTC via mempool/esplora HTTP API + faucet; no regtest RPC needed.
 *
 * Builds two self-contained P2WSH lockups from a freshly-derived P2WPKH
 * address (avoids colliding with other tests), then sweeps each back,
 * proving both spend branches of `buildLockScript` (mirrors pox-5
 * `construct-lockup-script`): TEST 1 takes the OP_ELSE early-unlock branch
 * (unlockHeight far in the future so CLTV isn't spendable), TEST 2 takes the
 * OP_IF/CLTV branch (unlockHeight already past).
 *
 * Run (live):
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *   POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *   BITCOIN_TX_TIMEOUT=300000 STACKS_TX_TIMEOUT=300000 \
 *   RECORD=1 \
 *   npx jest tests/privatenet/actions/btc-lockup-roundtrip.test.ts \
 *     --runInBand --collectCoverage=false --verbose
 *   records to tests/privatenet/fixtures/fixtures-btc-lockup-roundtrip.json
 */

// @ts-ignore — @scure/btc-signer is ESM; ts-jest transforms it via jest.config.js
import * as btc from '@scure/btc-signer';
// @ts-ignore — same ESM transform
import { signECDSA } from '@scure/btc-signer/utils.js';
// @ts-ignore — same ESM transform
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { concatBytes, hexToBytes } from '@stacks/common';
import {
  buildUnlockScript,
  buildLockScript,
  buildLockOutputScript,
  computeRegisterPreimage,
} from '../../../src';
import { getAccount } from '../../regtest/regtest';
import {
  REGTEST,
  derivePubKey,
  privKeyToP2wpkhAddress,
  privKeyToP2wpkhScriptHex,
  broadcastBtc,
  waitForConfirmed,
  getBtcTipHeight,
  ensureFunded,
} from '../../helpers/btc-wallet';
import { useFixtures } from '../../helpers/mock';
import { ENV } from '../../helpers/utils';

jest.setTimeout(30 * 60_000);

// Dedicated roundtrip staker key — derived to avoid colliding with btc-lock.test.ts
// which uses account5/6/7.
const ROUNDTRIP_PRIV = hexToBytes(
  'e9873d79c6d87dc0fb6a5778633389f4453213303da61f20bd67fc233aa33262'
);
const ROUNDTRIP_PUB = derivePubKey(ROUNDTRIP_PRIV);

// account7 — the early-unlock admin cosigner
const ACCOUNT7_PRIV = hexToBytes(
  '16226f674796712dfbd53bf402304579b8b6d04d4bed4d466bf84ce6db973d44'
);
const ACCOUNT7_PUB = derivePubKey(ACCOUNT7_PRIV);

// getAccount expects hex key with compression byte appended
const STAKER_STX_ADDRESS = getAccount(
  'e9873d79c6d87dc0fb6a5778633389f4453213303da61f20bd67fc233aa33262' + '01'
).address;

const ROUNDTRIP_ADDR = privKeyToP2wpkhAddress(ROUNDTRIP_PRIV);
const ROUNDTRIP_SCRIPT_HEX = privKeyToP2wpkhScriptHex(ROUNDTRIP_PRIV);

const LOCK_SATS = 20_000n;
const SWEEP_FEE = 500n;
const FUND_FEE = 500n;
const SIGHASH_ALL = 1;
const OP_CHECKSIG = 0xac;

const POLL_INTERVAL_MS = ENV.POLL_INTERVAL > 250 ? ENV.POLL_INTERVAL : 15_000;
const TIMEOUT_MS = ENV.BITCOIN_TX_TIMEOUT > 10_000 ? ENV.BITCOIN_TX_TIMEOUT : 25 * 60_000;

/**
 * Build the `<adminPub> OP_CHECKSIG` early-unlock subscript.
 * Uses OP_CHECKSIG (not CHECKSIGVERIFY) so it leaves a truthy `1` on the stack
 * for the shared `OP_VERIFY` at the end of the ELSE branch to consume.
 */
function buildEarlyUnlockCheckSig(adminPub: Uint8Array): Uint8Array {
  if (adminPub.length !== 33) throw new Error('expected 33-byte compressed pubkey');
  const out = new Uint8Array(1 + 33 + 1);
  out[0] = 33;
  out.set(adminPub, 1);
  out[34] = OP_CHECKSIG;
  return out;
}

/**
 * Fund a P2WSH address with LOCK_SATS from the roundtrip P2WPKH address.
 * Assumes ensureFunded() was already called. Returns { txid, vout }.
 */
async function fundP2wsh(p2wshScript: Uint8Array): Promise<{ txid: string; vout: number }> {
  const utxo = await ensureFunded(ROUNDTRIP_ADDR, ROUNDTRIP_SCRIPT_HEX, LOCK_SATS + FUND_FEE, {
    intervalMs: POLL_INTERVAL_MS,
    timeoutMs: TIMEOUT_MS,
  });

  const change = utxo.value - LOCK_SATS - FUND_FEE;
  const tx = new btc.Transaction();
  tx.addInput({
    txid: utxo.txid,
    index: utxo.vout,
    witnessUtxo: { script: utxo.scriptPubKey, amount: utxo.value },
  });
  tx.addOutput({ script: p2wshScript, amount: LOCK_SATS });
  tx.addOutputAddress(ROUNDTRIP_ADDR, change, REGTEST);
  tx.sign(ROUNDTRIP_PRIV);
  tx.finalize();

  const txid = await broadcastBtc(tx.hex);
  console.log('funding txid:', txid, `(spent ${utxo.txid}:${utxo.vout}, ${utxo.value} sats)`);
  await waitForConfirmed(txid, { intervalMs: POLL_INTERVAL_MS, timeoutMs: TIMEOUT_MS });
  return { txid, vout: 0 };
}

test('EARLY-branch (OP_ELSE) P2WSH lockup round trip', async () => {
  useFixtures('btc-lockup-roundtrip-early');

  const burn = await getBtcTipHeight();
  const unlockHeight = burn + 100; // far future -> CLTV NOT spendable -> forces early branch

  const unlockBytes = buildUnlockScript(ROUNDTRIP_PUB);
  const earlyUnlockBytes = buildEarlyUnlockCheckSig(ACCOUNT7_PUB);

  const witnessScript = buildLockScript({
    stxAddress: STAKER_STX_ADDRESS,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });
  const p2wshScript = buildLockOutputScript({
    stxAddress: STAKER_STX_ADDRESS,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });
  const p2wshAddr = btc.p2wsh({ type: 'wsh', script: witnessScript }, REGTEST).address!;

  const { txid: fundTxid, vout } = await fundP2wsh(p2wshScript);

  const sweepTx = new btc.Transaction({
    allowUnknownOutputs: true,
    disableScriptCheck: true,
    allowUnknownInputs: true,
  });
  sweepTx.addInput({
    txid: fundTxid,
    index: vout,
    sequence: 0xffffffff,
    witnessUtxo: { script: p2wshScript, amount: LOCK_SATS },
  });
  sweepTx.addOutputAddress(ROUNDTRIP_ADDR, LOCK_SATS - SWEEP_FEE, REGTEST);

  const sighash = sweepTx.preimageWitnessV0(0, witnessScript, SIGHASH_ALL, LOCK_SATS);
  const stakerSig = concatBytes(
    signECDSA(sighash, ROUNDTRIP_PRIV, true),
    new Uint8Array([SIGHASH_ALL])
  );
  const adminSig = concatBytes(
    signECDSA(sighash, ACCOUNT7_PRIV, true),
    new Uint8Array([SIGHASH_ALL])
  );

  // ELSE branch requires revealing the 32-byte preimage; the script only commits
  // to its hash (OP_SHA256 <stakerHash> OP_EQUALVERIFY), not the preimage itself.
  const stakerPreimage = computeRegisterPreimage(STAKER_STX_ADDRESS);

  // Witness: [ staker_sig, admin_sig, preimage, <empty->ELSE>, witnessScript ]
  const witnessItems = [stakerSig, adminSig, stakerPreimage, new Uint8Array(0), witnessScript];
  sweepTx.updateInput(0, { finalScriptWitness: witnessItems }, true);
  expect(sweepTx.isFinal).toBe(true);

  useFixtures('btc-lockup-roundtrip-early-sweep');
  const sweepTxid = await broadcastBtc(sweepTx.hex);
  expect(sweepTxid).toMatch(/^[0-9a-f]{64}$/);
  await waitForConfirmed(sweepTxid, { intervalMs: POLL_INTERVAL_MS, timeoutMs: TIMEOUT_MS });

  console.log('EARLY roundtrip:', { p2wshAddr, fundTxid, sweepTxid });
});

test('TIMELOCK-branch (OP_IF / CLTV) P2WSH lockup round trip', async () => {
  useFixtures('btc-lockup-roundtrip-timelock');

  const burn = await getBtcTipHeight();
  const unlockHeight = burn - 10; // already past -> CLTV satisfiable now

  const unlockBytes = buildUnlockScript(ROUNDTRIP_PUB);
  const earlyUnlockBytes = buildEarlyUnlockCheckSig(ACCOUNT7_PUB);

  const witnessScript = buildLockScript({
    stxAddress: STAKER_STX_ADDRESS,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });
  const p2wshScript = buildLockOutputScript({
    stxAddress: STAKER_STX_ADDRESS,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });
  const p2wshAddr = btc.p2wsh({ type: 'wsh', script: witnessScript }, REGTEST).address!;

  const { txid: fundTxid, vout } = await fundP2wsh(p2wshScript);

  const sweepTx = new btc.Transaction({
    allowUnknownOutputs: true,
    disableScriptCheck: true,
    allowUnknownInputs: true,
    lockTime: unlockHeight, // CLTV requires tx.lockTime >= unlockHeight
  });
  sweepTx.addInput({
    txid: fundTxid,
    index: vout,
    sequence: 0xfffffffe, // non-final -> enables nLockTime / CLTV
    witnessUtxo: { script: p2wshScript, amount: LOCK_SATS },
  });
  sweepTx.addOutputAddress(ROUNDTRIP_ADDR, LOCK_SATS - SWEEP_FEE, REGTEST);

  const sighash = sweepTx.preimageWitnessV0(0, witnessScript, SIGHASH_ALL, LOCK_SATS);
  const stakerSig = concatBytes(
    signECDSA(sighash, ROUNDTRIP_PRIV, true),
    new Uint8Array([SIGHASH_ALL])
  );

  // Witness: [ staker_sig, 0x01 (truthy->IF), witnessScript ]
  const witnessItems = [stakerSig, new Uint8Array([0x01]), witnessScript];
  sweepTx.updateInput(0, { finalScriptWitness: witnessItems }, true);
  expect(sweepTx.isFinal).toBe(true);

  useFixtures('btc-lockup-roundtrip-timelock-sweep');
  const sweepTxid = await broadcastBtc(sweepTx.hex);
  expect(sweepTxid).toMatch(/^[0-9a-f]{64}$/);
  await waitForConfirmed(sweepTxid, { intervalMs: POLL_INTERVAL_MS, timeoutMs: TIMEOUT_MS });

  console.log('TIMELOCK roundtrip:', { p2wshAddr, fundTxid, sweepTxid });
});
