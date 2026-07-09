/**
 * ACTION — verify the KMS early-unlock signing service signs with the SAME key we
 * bake into a bond's `early-unlock-bytes` (no funds, no broadcast).
 *
 * Why this matters: `early-unlock-bytes` = `<early-unlock-pubkey> OP_CHECKSIG`. If
 * the pubkey we derive from the service's xpub differs by even one leaf index
 * from the key `/v1/sign` uses, every early-exit reclaim witness fails on-chain.
 *
 * A known-data CONTROL (fixed key + digest) proves the parse/verify harness is
 * sound and not vacuously passing.
 *
 * Run (endpoints live):
 *   EARLY_UNLOCK_LEAF=0/0 npx jest tests/privatenet/actions/early-unlock-key-verify.test.ts \
 *     --runInBand --collectCoverage=false --verbose
 */

// @ts-ignore — @scure/btc-signer is ESM; ts-jest transforms it via jest.config.js
import * as btc from '@scure/btc-signer';
// @ts-ignore — same ESM transform
import { secp256k1 } from '@noble/curves/secp256k1.js';
// @ts-ignore — same ESM transform
import { signECDSA } from '@scure/btc-signer/utils.js';
import { bytesToHex, hexToBytes } from '@stacks/common';
import {
  buildLockScript,
  buildUnlockScript,
  buildReclaim,
  computeReclaimSighash,
} from '../../../src';
import {
  EARLY_UNLOCK_API,
  EARLY_UNLOCK_LEAF,
  earlyUnlockBytesHexFromXpub,
  deriveEarlyUnlockPubkey,
  fetchEarlyUnlockKey,
  fullDerivationPath,
  signViaEarlyUnlockApi,
  verifyEarlyUnlockSig,
} from '../../helpers/early-unlock-signer';
import { REGTEST } from '../../helpers/btc-wallet';
import { useFixtures } from '../../helpers/mock';

jest.setTimeout(120_000);

// Record/replay: RECORD=1 hits the live API and captures to
// fixtures-early-unlock-key-verify.json; default (mock) mode replays it offline.
beforeAll(() => useFixtures('early-unlock-key-verify'));

const STAKER_STX = 'ST1MV5EGTM2NSPF3MSZ2SMYRXJJH1GG6CEMP9N117';
const STAKER_BTC_PUB = secp256k1.getPublicKey(hexToBytes('11'.repeat(32)), true);

test('CONTROL: verify harness accepts a known-good sig and rejects a wrong key', () => {
  // A fixed digest + key signed with btc-signer (same shape the service uses):
  // signs the RAW 32-byte digest, DER-encoded — verified with prehash:false.
  const digest = hexToBytes('4d6f16efcfb310c6841d5280f06cb9d8fa83ac94e29c0377a9516523667bad1c');
  const priv = hexToBytes('22'.repeat(32));
  const pub = secp256k1.getPublicKey(priv, true);
  const der = signECDSA(digest, priv, false); // DER, no sighash byte
  expect(verifyEarlyUnlockSig(bytesToHex(der), bytesToHex(digest), pub)).toBe(true);
  // negative control — a different key must NOT verify
  const wrong = secp256k1.getPublicKey(hexToBytes('33'.repeat(32)), true);
  expect(verifyEarlyUnlockSig(bytesToHex(der), bytesToHex(digest), wrong)).toBe(false);
});

test('early-unlock /sign uses the key baked into early-unlock-bytes', async () => {
  console.log('API:', EARLY_UNLOCK_API, 'leaf:', EARLY_UNLOCK_LEAF);

  const key = await fetchEarlyUnlockKey();
  if (!key) {
    console.warn(`SKIP: ${EARLY_UNLOCK_API}/public-key not reachable.`);
    expect(key).toBeNull();
    return;
  }
  console.log('key_id:', key.keyId, 'network:', key.network, 'account path:', key.derivationPath);

  const earlyUnlockPub = deriveEarlyUnlockPubkey(key.xpub);
  const earlyUnlockBytesHex = earlyUnlockBytesHexFromXpub(key.xpub);
  console.log('early-unlock leaf pubkey:', bytesToHex(earlyUnlockPub));
  console.log('early-unlock-bytes  :', earlyUnlockBytesHex);
  // format is exactly <0x21><33-byte pubkey><0xac>
  expect(earlyUnlockBytesHex).toBe(`21${bytesToHex(earlyUnlockPub)}ac`);

  // synthetic early-unlock lockup + reclaim
  const witnessScript = buildLockScript({
    stxAddress: STAKER_STX,
    unlockHeight: 1_000_000,
    unlockBytes: buildUnlockScript(STAKER_BTC_PUB),
    earlyUnlockBytes: hexToBytes(earlyUnlockBytesHex),
  });
  const utxo = { txid: 'ab'.repeat(32), vout: 0, value: 50_000n };
  const p2wsh = btc.p2wsh({ type: 'wsh', script: witnessScript }, REGTEST);
  const tx = buildReclaim({
    path: 'early-exit',
    network: 'testnet',
    lockScript: witnessScript,
    utxo,
    output: { address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', feeSats: 1_000n },
  });
  const sighash = computeReclaimSighash(tx);
  console.log('our reclaim sighash:', bytesToHex(sighash));

  const signed = await signViaEarlyUnlockApi({
    txHex: bytesToHex(tx.toBytes(false, false)),
    inputIndex: 0,
    bip32Derivation: fullDerivationPath(key.derivationPath, EARLY_UNLOCK_LEAF),
    prevoutScriptPubKeyHex: bytesToHex(p2wsh.script),
    prevoutValueSats: utxo.value,
    witnessScriptHex: bytesToHex(witnessScript),
  });
  if (!signed) {
    console.warn(`SKIP: ${EARLY_UNLOCK_API}/sign not reachable.`);
    expect(signed).toBeNull();
    return;
  }
  console.log('service pubkey:', signed.publicKey, '| service sighash:', signed.sighash);

  expect(signed.publicKey.toLowerCase()).toBe(bytesToHex(earlyUnlockPub)); // same key
  expect(signed.sighash.toLowerCase()).toBe(bytesToHex(sighash)); // same BIP-143 digest
  expect(verifyEarlyUnlockSig(signed.signature, signed.sighash, earlyUnlockPub)).toBe(true); // valid sig
});
