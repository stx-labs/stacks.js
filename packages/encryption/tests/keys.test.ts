import { utils } from '@noble/secp256k1';
import {
  PRIVATE_KEY_BYTES_UNCOMPRESSED,
  bytesToHex,
  hexToBytes,
  utf8ToBytes,
} from '@stacks/common';
import { ECPair, address, networks } from 'bitcoinjs-lib';
import { createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha256';
import { SECP256K1Client } from 'jsontokens';
import {
  base58Encode,
  ecSign,
  getPublicKeyFromPrivate,
  hashSha256Sync,
  makeECPrivateKey,
  publicKeyToBtcAddress,
} from '../src';
import { hashRipemd160 } from '../src/hashRipemd160';

test('makeECPrivateKey', () => {
  const privateKey = makeECPrivateKey();

  expect(privateKey).toBeTruthy();
  expect(typeof privateKey).toEqual('string');
  expect(privateKey.length).toEqual(PRIVATE_KEY_BYTES_UNCOMPRESSED * 2);
  expect(utils.isValidPrivateKey(privateKey)).toBeTruthy();
});

test('getPublicKeyFromPrivate matches jsontokens', () => {
  const privateKey = makeECPrivateKey();
  // getPublicKeyFromPrivate always returns compressed public key
  const publicKey = getPublicKeyFromPrivate(privateKey);
  const secpClientPublicKey = SECP256K1Client.derivePublicKey(privateKey, true);

  expect(publicKeyToBtcAddress(publicKey)).toEqual(publicKeyToBtcAddress(secpClientPublicKey));
});

test('getPublicKeyFromPrivate matches bitcoinjs', () => {
  const privateKey = makeECPrivateKey();
  const privateKeyCompressed = `${privateKey}01`;

  // eslint-disable-next-line node/prefer-global/buffer
  const keyPairCompressed = ECPair.fromPrivateKey(Buffer.from(privateKey, 'hex'), {
    compressed: true,
  });
  const bitcoinJsPublicKeyCompressed = keyPairCompressed.publicKey.toString('hex');
  expect(getPublicKeyFromPrivate(privateKeyCompressed)).toEqual(bitcoinJsPublicKeyCompressed);

  // getPublicKeyFromPrivate always returns compressed public key
  expect(getPublicKeyFromPrivate(privateKey)).toEqual(bitcoinJsPublicKeyCompressed);
});

test('getPublicKeyFromPrivate with bitcoinjs private key matches bitcoinjs', () => {
  const privateKey = ECPair.makeRandom().privateKey!.toString('hex');

  // eslint-disable-next-line node/prefer-global/buffer
  const bitcoinJsKeyPair = ECPair.fromPrivateKey(Buffer.from(privateKey, 'hex'), {
    compressed: true,
  });
  const bitcoinJsPublicKey = bitcoinJsKeyPair.publicKey.toString('hex');
  expect(getPublicKeyFromPrivate(privateKey)).toEqual(bitcoinJsPublicKey);
});

test('publicKeyToBtcAddress matches bitcoinjs', () => {
  const privateKey = makeECPrivateKey();
  const publicKey = getPublicKeyFromPrivate(privateKey);

  const publicKeyHash160 = hashRipemd160(hashSha256Sync(hexToBytes(publicKey)));
  const bitcoinJsAddress = address.toBase58Check(
    // eslint-disable-next-line node/prefer-global/buffer
    Buffer.from(publicKeyHash160),
    networks.bitcoin.pubKeyHash
  );

  expect(publicKeyToBtcAddress(publicKey)).toEqual(bitcoinJsAddress);
});

test('publicKeyToBtcAddress', () => {
  const privateKey = '00cdce6b5f87d38f2a830cae0da82162e1b487f07c5affa8130f01fe1a2a25fb01';
  const expectedAddress = '1WykMawQRnLh7SWmmoRL4qTDNCgAsVRF1';
  expect(publicKeyToBtcAddress(getPublicKeyFromPrivate(privateKey))).toEqual(expectedAddress);

  const privateKeyUncompressed = '00cdce6b5f87d38f2a830cae0da82162e1b487f07c5affa8130f01fe1a2a25fb';
  // getPublicKeyFromPrivate always returns compressed public key
  expect(publicKeyToBtcAddress(getPublicKeyFromPrivate(privateKeyUncompressed))).toEqual(
    expectedAddress
  );
});

test('hashToBase58Check', () => {
  // originalHash from 'bs58Check' reference
  const originalHash = '5Kd3NBUAdUnhyzenEwVLy9pBKxSwXvE9FMPyR4UKZvpe6E3AgLr';
  const decodedBase58Check = createBase58check(sha256).decode(originalHash);

  expect(base58Encode(decodedBase58Check)).toBe(originalHash);
});

test('ecSign', () => {
  const privateKey = '00cdce6b5f87d38f2a830cae0da82162e1b487f07c5affa8130f01fe1a2a25fb01';
  const challengeText = 'somestring';
  // signatureHex generated with previous dependency 'bitcoinjs-lib'
  const signatureHex =
    'ff7803e1a6cdd6a28c368fb324f24e1e7f9b024b21524edae6e6fe21e52a92cb156621f8dd66d12f1848a3151c7f04cebe8bcf617f0cc8e43a592f883b29aa02';

  const digest = hashSha256Sync(utf8ToBytes(challengeText));
  const signature = ecSign(digest, privateKey);

  expect(bytesToHex(signature)).toEqual(signatureHex);
});
