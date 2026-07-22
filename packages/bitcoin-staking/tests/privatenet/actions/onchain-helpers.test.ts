// Parity smoke tests: the pox-5 script/buffer/header read-only helpers must
// match the SDK's local pure implementations byte-for-byte. Covers the
// otherwise-unexercised `fetch.ts` cross-check wrappers. Read-only, live chain.
import { bytesToHex, hexToBytes } from '@stacks/common';
import { getAddressFromPublicKey } from '@stacks/transactions';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import {
  buildLockOutputScript,
  buildLockScript,
  buildUnlockScript,
  computeBitcoinTxid,
  fetchConstructLockupOutputScript,
  fetchConstructLockupScript,
  fetchParseBlockHeader,
  fetchPushCScriptNum,
  fetchPushScriptBytes,
  fetchReverseBuff32,
  fetchReversedTxid,
  fetchSerializeCScriptNum,
  fetchUintToBuffLe,
  pushCScriptNum,
  pushScriptBytes,
  serializeCScriptNum,
} from '../../../src';
import { getNetwork } from '../../helpers/utils';
import { useFixtures } from '../../helpers/mock';

jest.setTimeout(30 * 60_000);

const network = getNetwork();

// Deterministic keys -> a lockup param set (mirrors the reclaim/roundtrip tests).
const STAKER_PUB = secp256k1.getPublicKey(
  hexToBytes('cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df'),
  true
);
const COSIGNER_PUB = secp256k1.getPublicKey(
  hexToBytes('5b8303150239eceaba43892af7cdd1fa7fc26eda5182ebaaa568e3341d54a4d0'),
  true
);
const LOCKUP = {
  stxAddress: getAddressFromPublicKey(STAKER_PUB, 'testnet'),
  unlockHeight: 850_123,
  unlockBytes: buildUnlockScript(STAKER_PUB),
  earlyUnlockBytes: buildUnlockScript(COSIGNER_PUB),
};

// A representative spread: OP_1..16 small forms (1, 16) vs pushed CScriptNum (17, 1000).
const NUMS = [1, 16, 17, 1000];

beforeAll(async () => {
  useFixtures('onchain-helpers');
}, 30 * 60_000);

test('serialize-c-script-num ↔ serializeCScriptNum', async () => {
  for (const n of NUMS) {
    const onchain = await fetchSerializeCScriptNum({ n, network });
    console.log('serialize-c-script-num', n, bytesToHex(onchain));
    expect(bytesToHex(onchain)).toBe(bytesToHex(serializeCScriptNum(n)));
  }
});

test('push-c-script-num ↔ pushCScriptNum', async () => {
  for (const n of NUMS) {
    const onchain = await fetchPushCScriptNum({ n, network });
    console.log('push-c-script-num', n, bytesToHex(onchain));
    expect(bytesToHex(onchain)).toBe(bytesToHex(pushCScriptNum(n)));
  }
});

test('push-script-bytes ↔ pushScriptBytes', async () => {
  const bytes = hexToBytes('02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc');
  const onchain = await fetchPushScriptBytes({ bytes, network });
  console.log('push-script-bytes', bytesToHex(onchain));
  expect(bytesToHex(onchain)).toBe(bytesToHex(pushScriptBytes(bytes)));
});

test('uint-to-buff-le: known little-endian values', async () => {
  const one = await fetchUintToBuffLe({ n: 1, network });
  const twoFiftySix = await fetchUintToBuffLe({ n: 256, network });
  console.log('uint-to-buff-le', bytesToHex(one), bytesToHex(twoFiftySix));
  expect(bytesToHex(one)).toBe('01');
  expect(bytesToHex(twoFiftySix)).toBe('0001');
});

test('reverse-buff32: flips a 32-byte buffer', async () => {
  const input = hexToBytes('00112233445566778899aabbccddeeff0102030405060708090a0b0c0d0e0f10');
  const onchain = await fetchReverseBuff32({ input, network });
  console.log('reverse-buff32', bytesToHex(onchain));
  expect(bytesToHex(onchain)).toBe(bytesToHex(input.slice().reverse()));
});

test('get-reversed-txid ↔ computeBitcoinTxid', async () => {
  // Bitcoin genesis coinbase transaction.
  const tx = hexToBytes(
    '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000'
  );
  const onchain = await fetchReversedTxid({ tx, network });
  console.log('get-reversed-txid', bytesToHex(onchain));
  // contract.get-reversed-txid is the little-endian/internal form; the local
  // helper returns big-endian display order — they are exact byte-reverses.
  expect(bytesToHex(onchain)).toBe(bytesToHex(computeBitcoinTxid(tx).slice().reverse()));
});

test('parse-block-header: decodes an 80-byte header', async () => {
  // Bitcoin genesis block header (80 bytes).
  const header = hexToBytes(
    '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c'
  );
  const parsed = await fetchParseBlockHeader({ header, network });
  console.log('parse-block-header', parsed);
  expect(parsed.parent).toHaveLength(32);
  expect(parsed.merkleRoot).toHaveLength(32);
  expect(typeof parsed.version).toBe('number');
  expect(typeof parsed.timestamp).toBe('number');
  expect(typeof parsed.nbits).toBe('number');
  expect(typeof parsed.nonce).toBe('number');
});

test('construct-lockup-script ↔ buildLockScript', async () => {
  const onchain = await fetchConstructLockupScript({ ...LOCKUP, network });
  console.log('construct-lockup-script', bytesToHex(onchain));
  expect(bytesToHex(onchain)).toBe(bytesToHex(buildLockScript(LOCKUP)));
});

test('construct-lockup-output-script ↔ buildLockOutputScript', async () => {
  const onchain = await fetchConstructLockupOutputScript({ ...LOCKUP, network });
  console.log('construct-lockup-output-script', bytesToHex(onchain));
  expect(bytesToHex(onchain)).toBe(bytesToHex(buildLockOutputScript(LOCKUP)));
});
