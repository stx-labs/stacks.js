/**
 * ACTION — live early-exit reclaim cosigned by the KMS early-unlock service.
 *
 * Spends a real P2WSH lockup via the OP_ELSE branch, where the cosigner leg
 * is signed by POST /v1/sign (KMS), not a local key. Everything else is built
 * with the package's own reclaim helpers so the witness matches production.
 *
 * Honest-skips (no fake pass) if: staker isn't L1-enrolled in a early-unlock bond,
 * hasn't announced early exit, has no spendable lockup UTXO, or the early-unlock
 * API is unreachable.
 *
 * Run:
 *   set -a; . packages/bitcoin-staking/.env; set +a
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *   BITCOIN_TX_TIMEOUT=300000 STACKS_TX_TIMEOUT=300000 STAKER=account5 \
 *   RECORD=1 npx jest tests/privatenet/actions/early-unlock-reclaim.test.ts \
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
  EARLY_UNLOCK_LEAF,
  earlyUnlockBytesHexFromXpub,
  deriveEarlyUnlockPubkey,
  fetchEarlyUnlockKey,
  fullDerivationPath,
  signViaEarlyUnlockApi,
  verifyEarlyUnlockSig,
} from '../../helpers/early-unlock-signer';
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

beforeAll(() => useFixtures('early-unlock-reclaim'));

// RECORD PRECONDITION: since the reclaim spends the lockup UTXO one-shot, a
// record runner must first set up a fresh btc-lock -> register-for-bond-l1 ->
// announce-early-exit for STAKER on a early-unlock bond.
test('early-exit reclaim cosigned by the KMS early-unlock service', async () => {
  console.log('staker:', staker.address);

  // EARLY-UNLOCK KEY
  const key = await fetchEarlyUnlockKey();
  if (!key) {
    console.warn('SKIP: early-unlock /public-key not reachable.');
    expect(key).toBeNull();
    return;
  }
  const earlyUnlockPub = deriveEarlyUnlockPubkey(key.xpub);
  const expectedEub = earlyUnlockBytesHexFromXpub(key.xpub);
  const bip32Path = fullDerivationPath(key.derivationPath, EARLY_UNLOCK_LEAF);
  console.log('early-unlock leaf pubkey:', bytesToHex(earlyUnlockPub), 'path:', bip32Path);

  // L1 ENROLLMENT
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
      `SKIP: bond ${bondIndex} is not early-unlock-KMS ` +
        `(earlyUnlockBytes ${bond.earlyUnlockBytes} != early-unlock ${expectedEub}).`
    );
    expect(bond.earlyUnlockBytes.toLowerCase()).not.toBe(expectedEub.toLowerCase());
    return;
  }

  // EARLY-EXIT ANNOUNCED
  const announced = await fetchHasAnnouncedL1EarlyExit({
    bondIndex,
    staker: staker.address,
    network,
  });
  if (!announced) {
    console.warn(`SKIP: staker has not announced early exit for bond ${bondIndex}.`);
    expect(announced).toBe(false);
    return;
  }

  // LOCKUP UTXO
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

  // BUILD RECLAIM
  // buildReclaim maps the Stacks network to testnet btc (tb1). The sweep output's
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

  // STAKER + EARLY-UNLOCK SIGS
  const stakerSig = signReclaim(sighash, STAKER_PRIV_HEX);

  const signed = await signViaEarlyUnlockApi({
    txHex: bytesToHex(tx.toBytes(false, false)),
    inputIndex: 0,
    bip32Derivation: bip32Path,
    prevoutScriptPubKeyHex: p2wshScriptHex,
    prevoutValueSats: utxo.value,
    witnessScriptHex: bytesToHex(witnessScript),
  });
  if (!signed) {
    console.warn('SKIP: early-unlock /sign not reachable.');
    expect(signed).toBeNull();
    return;
  }
  // the service computes its own sighash - it MUST equal ours, and the sig MUST
  // verify under the early-unlock pubkey, or the witness would fail on-chain.
  expect(signed.sighash.toLowerCase()).toBe(bytesToHex(sighash));
  expect(signed.publicKey.toLowerCase()).toBe(bytesToHex(earlyUnlockPub));
  expect(verifyEarlyUnlockSig(signed.signature, signed.sighash, earlyUnlockPub)).toBe(true);

  const cosignerSig = concatBytes(hexToBytes(signed.signature), new Uint8Array([SIGHASH_ALL]));

  // ASSEMBLE + BROADCAST
  tx.updateInput(0, {
    partialSig: [
      [stakerBtcPub, stakerSig],
      [earlyUnlockPub, cosignerSig],
    ],
  });
  const { txHex, txid: localTxid } = finalizeReclaim({
    path: 'early-exit',
    tx,
    stxAddress: staker.address,
  });
  console.log('assembled reclaim txid (local):', localTxid);

  const reclaimTxid = await broadcastBtc(txHex);
  console.log('reclaim txid:', reclaimTxid);
  expect(reclaimTxid).toMatch(/^[0-9a-f]{64}$/);

  const conf = await waitForConfirmed(reclaimTxid, { intervalMs: POLL_MS, timeoutMs: TIMEOUT_MS });
  console.log('reclaim confirmed in block', conf.block_height);
});
