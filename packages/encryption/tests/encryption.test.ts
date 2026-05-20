import * as elliptic from 'elliptic';
import * as webCryptoPolyfill from '@peculiar/webcrypto';
import {
  encryptECIES,
  decryptECIES,
  getHexFromBN,
  signECDSA,
  verifyECDSA,
  encryptMnemonic,
  decryptMnemonic,
} from '../src';
import {
  alloc,
  bytesToHex,
  ERROR_CODES,
  getGlobalScope,
  hexToBytes,
  utf8ToBytes,
} from '@stacks/common';
import * as pbkdf2 from '../src/pbkdf2';
import * as aesCipher from '../src/aesCipher';
import * as sha2Hash from '../src/sha2Hash';
import * as ripemd160 from '../src/hashRipemd160';
// https://github.com/paulmillr/scure-bip39
// Secure, audited & minimal implementation of BIP39 mnemonic phrases.
import { validateMnemonic, mnemonicToEntropy, entropyToMnemonic } from '@scure/bip39';
// Word lists not imported by default as that would increase bundle sizes too much as in case of bitcoinjs/bip39
// Use default english world list similar to bitcoinjs/bip39
// Backward compatible with bitcoinjs/bip39 dependency
// Very small in size as compared to bitcoinjs/bip39 wordlist
// Reference: https://github.com/paulmillr/scure-bip39
import { wordlist } from '@scure/bip39/wordlists/english';
import { getBytesFromBN, hmacSha256 } from '../src/ec';
import {
  getPublicKey as nobleGetPublicKey,
  getSharedSecret,
  signSync as nobleSecp256k1Sign,
  utils,
  verify as nobleSecp256k1Verify,
} from '@noble/secp256k1';

const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
const publicKey = '027d28f9951ce46538951e3697c62588a87f1f1f295de4a14fdd4c780fc52cfe69';

test('ripemd160 digest tests', () => {
  const vectors = [
    ['The quick brown fox jumps over the lazy dog', '37f332f68db77bd9d7edd4969571ad671cf9dd3b'],
    ['The quick brown fox jumps over the lazy cog', '132072df690933835eb8b6ad0b77e7b6f14acad7'],
    ['a', '0bdc9d2d256b3ee9daae347be6f4dc835a467ffe'],
    ['abc', '8eb208f7e05d987a9b044a8e98c6b087f15a0bfc'],
    ['message digest', '5d0689ef49d2fae572b881b123a85ffa21595f36'],
    ['', '9c1185a5c5e9fc54612808977ee8f548b2258d31'],
  ];

  for (const [input, expected] of vectors) {
    const result = ripemd160.hashRipemd160(utf8ToBytes(input));
    const resultHex = bytesToHex(result);
    expect(resultHex).toEqual(expected);
  }
});

test.skip('sha2 digest tests', async () => {
  const globalScope = getGlobalScope() as any;

  // Remove any existing global `crypto` variable for testing
  const globalCryptoOrig = { defined: 'crypto' in globalScope, value: globalScope.crypto };

  // Set global web `crypto` polyfill for testing
  const webCrypto = new webCryptoPolyfill.Crypto();
  globalScope.crypto = webCrypto;

  const vectors = [
    [
      'abc',
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    ],
    [
      '',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
    ],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
      '204a8fc6dda82f0a0ced7beb8e08a41657c16ef468b228a8279be331a703c33596fd15c13b1b07f9aa1d3bea57789ca031ad85c7a71dd70354ec631238ca3445',
    ],
  ];

  try {
    const webCryptoHasher = await sha2Hash.createSha2Hash();
    expect(webCryptoHasher instanceof sha2Hash.WebCryptoSha2Hash).toBe(true);
    for (const [input, expected256, expected512] of vectors) {
      const result256 = await webCryptoHasher.digest(utf8ToBytes(input), 'sha256');
      expect(bytesToHex(result256)).toEqual(expected256);
      const result512 = await webCryptoHasher.digest(utf8ToBytes(input), 'sha512');
      expect(bytesToHex(result512)).toEqual(expected512);
    }


    const nodeCryptoHasher = new sha2Hash.NodeCryptoSha2Hash(require('crypto').createHash);
    for (const [input, expected256, expected512] of vectors) {
      const result256 = await nodeCryptoHasher.digest(utf8ToBytes(input), 'sha256');
      expect(bytesToHex(result256)).toEqual(expected256);
      const result512 = await nodeCryptoHasher.digest(utf8ToBytes(input), 'sha512');
      expect(bytesToHex(result512)).toEqual(expected512);
    }
  } finally {
    // Restore previous `crypto` global var
    if (globalCryptoOrig.defined) {
      globalScope.crypto = globalCryptoOrig.value;
    } else {
      delete globalScope.crypto;
    }
  }
});

test('sha2 native digest fallback tests', async () => {
  const input = utf8ToBytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq');
  const expectedOutput256 = '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1';
  const expectedOutput512 =
    '204a8fc6dda82f0a0ced7beb8e08a41657c16ef468b228a8279be331a703c33596fd15c13b1b07f9aa1d3bea57789ca031ad85c7a71dd70354ec631238ca3445';

  // Test WebCrypto fallback
  const webCryptoSubtle = new webCryptoPolyfill.Crypto().subtle;
  webCryptoSubtle.digest = () => {
    throw new Error('Artificial broken hash');
  };
  const nodeCryptoHasher = new sha2Hash.WebCryptoSha2Hash(webCryptoSubtle);
  const result256 = await nodeCryptoHasher.digest(input, 'sha256');
  expect(bytesToHex(result256)).toEqual(expectedOutput256);
  const result512 = await nodeCryptoHasher.digest(input, 'sha512');
  expect(bytesToHex(result512)).toEqual(expectedOutput512);

  // Test Node.js `crypto.createHash` fallback

  const nodeCrypto = require('crypto');
  const createHashOrig = nodeCrypto.createHash;
  nodeCrypto.createHash = () => {
    throw new Error('Artificial broken hash');
  };
  try {

    const nodeCryptoHasher = new sha2Hash.NodeCryptoSha2Hash(require('crypto').createHash);
    const result256 = await nodeCryptoHasher.digest(input, 'sha256');
    expect(bytesToHex(result256)).toEqual(expectedOutput256);
    const result512 = await nodeCryptoHasher.digest(input, 'sha512');
    expect(bytesToHex(result512)).toEqual(expectedOutput512);
  } finally {
    nodeCrypto.createHash = createHashOrig;
  }
});

test('hmac-sha256', () => {
  const key = alloc(32, 0xf5);
  const data = alloc(100, 0x44);
  const expected = 'fe44c2197eb8a5678daba87ff2aba891d8b12224d8219acd4cfa5cee4f9acc77';

  expect(bytesToHex(hmacSha256(key, data))).toEqual(expected);
});

test.skip('pbkdf2 digest tests', async () => {
  const salt = alloc(16, 0xf0);
  const password = 'password123456';
  const digestAlgo = 'sha512';
  const iterations = 100_000;
  const keyLength = 48;

  const globalScope = getGlobalScope() as any;

  // Remove any existing global `crypto` variable for testing
  const globalCryptoOrig = { defined: 'crypto' in globalScope, value: globalScope.crypto };
  delete globalScope.crypto;

  try {
    const nodeCryptoPbkdf2 = await pbkdf2.createPbkdf2();
    expect(nodeCryptoPbkdf2 instanceof pbkdf2.NodeCryptoPbkdf2).toEqual(true);

    // Set global web `crypto` polyfill for testing
    const webCrypto = new webCryptoPolyfill.Crypto();
    globalScope.crypto = webCrypto;
    const webCryptoPbkdf2 = await pbkdf2.createPbkdf2();
    expect(webCryptoPbkdf2 instanceof pbkdf2.WebCryptoPbkdf2).toEqual(true);

    const polyFillPbkdf2 = new pbkdf2.WebCryptoPartialPbkdf2(webCrypto.subtle);

    const derivedNodeCrypto = bytesToHex(
      await nodeCryptoPbkdf2.derive(password, salt, iterations, keyLength, digestAlgo)
    );
    const derivedWebCrypto = bytesToHex(
      await webCryptoPbkdf2.derive(password, salt, iterations, keyLength, digestAlgo)
    );
    const derivedPolyFill = bytesToHex(
      await polyFillPbkdf2.derive(password, salt, iterations, keyLength, digestAlgo)
    );

    const expected =
      '92f603459cc45a33eeb6ee06bb75d12bb8e61d9f679668392362bb104eab6d95027398e02f500c849a3dd1ccd63fb310';
    expect(expected).toEqual(derivedNodeCrypto);
    expect(expected).toEqual(derivedWebCrypto);
    expect(expected).toEqual(derivedPolyFill);
  } finally {
    // Restore previous `crypto` global var
    if (globalCryptoOrig.defined) {
      globalScope.crypto = globalCryptoOrig.value;
    } else {
      delete globalScope.crypto;
    }
  }
});

test.skip('aes-cbc tests', async () => {
  const globalScope = getGlobalScope() as any;

  // Remove any existing global `crypto` variable for testing
  const globalCryptoOrig = { defined: 'crypto' in globalScope, value: globalScope.crypto };
  delete globalScope.crypto;

  try {
    const nodeCryptoAesCipher = await aesCipher.createCipher();
    expect(nodeCryptoAesCipher instanceof aesCipher.NodeCryptoAesCipher).toEqual(true);

    // Set global web `crypto` polyfill for testing
    const webCrypto = new webCryptoPolyfill.Crypto();
    globalScope.crypto = webCrypto;
    const webCryptoAesCipher = await aesCipher.createCipher();
    expect(webCryptoAesCipher instanceof aesCipher.WebCryptoAesCipher).toEqual(true);

    const key128 = hexToBytes('0f'.repeat(16));
    const key256 = hexToBytes('0f'.repeat(32));
    const iv = hexToBytes('f7'.repeat(16));

    const inputData = utf8ToBytes('TestData'.repeat(20));
    const inputDataHex = bytesToHex(inputData);

    const expected128Cbc =
      '5aa1100a0a3133c9184dc661bc95c675a0fe5f02a67880f50702f8c88e7a445248d6dedfca80e72d00c3d277ea025eebde5940265fa00c1bfe80aebf3968b6eaf0564eda6ddd9e97548be1fa6d487e71353b11136193782d76d3b8d1895047e08a121c1706c083ceefdb9605a75a2310cccee1b0aaca632230f45f1172001cad96ae6d15db38ab9eed27b27b6f80353a5f30e3532a526a834a0f8273ffb2e9caaa92843b40c893e298f3b472fb26b11f';
    const expected128CbcBytes = hexToBytes(expected128Cbc);

    const expected256Cbc =
      '66a21fa53680d8182a79c1b90cdc38d398fe34d85c7ca5d45b8381fea4a84536e38514b3bcdba06655314607534be7ea370952ed6f334af709efc6504e600ce0b7c20fe3b469c29b63a391983b74aa12f1d859b477092c61e7814bd6c8d143ec21d34f79468c74c97ae9763ec11695e1e9a3a3b33f12561ecef9fbae79ddf7f2701c97ba1531801862662a9ce87a880934318a9e46a3941367fa68da3340f83941211aba7ec741826ff35d4f880243db';
    const expected256CbcBytes = hexToBytes(expected256Cbc);

    // Test aes-256-cbc encrypt
    const encrypted256NodeCrypto = bytesToHex(
      await nodeCryptoAesCipher.encrypt('aes-256-cbc', key256, iv, inputData)
    );
    const tmp = await webCryptoAesCipher.encrypt('aes-256-cbc', key256, iv, inputData);
    const encrypted256WebCrypto = bytesToHex(tmp);

    expect(expected256Cbc).toEqual(encrypted256NodeCrypto);
    expect(expected256Cbc).toEqual(encrypted256WebCrypto);

    // Test aes-256-cbc decrypt
    const decrypted256NodeCrypto = bytesToHex(
      await nodeCryptoAesCipher.decrypt('aes-256-cbc', key256, iv, expected256CbcBytes)
    );
    const decrypted256WebCrypto = bytesToHex(
      await webCryptoAesCipher.decrypt('aes-256-cbc', key256, iv, expected256CbcBytes)
    );

    expect(inputDataHex).toEqual(decrypted256NodeCrypto);
    expect(inputDataHex).toEqual(decrypted256WebCrypto);

    // Test aes-128-cbc encrypt
    const encrypted128NodeCrypto = bytesToHex(
      await nodeCryptoAesCipher.encrypt('aes-128-cbc', key128, iv, inputData)
    );
    const encrypted128WebCrypto = bytesToHex(
      await webCryptoAesCipher.encrypt('aes-128-cbc', key128, iv, inputData)
    );

    expect(expected128Cbc).toEqual(encrypted128NodeCrypto);
    expect(expected128Cbc).toEqual(encrypted128WebCrypto);

    // Test aes-128-cbc decrypt
    const decrypted128NodeCrypto = bytesToHex(
      await nodeCryptoAesCipher.decrypt('aes-128-cbc', key128, iv, expected128CbcBytes)
    );
    const decrypted128WebCrypto = bytesToHex(
      await webCryptoAesCipher.decrypt('aes-128-cbc', key128, iv, expected128CbcBytes)
    );

    expect(inputDataHex).toEqual(decrypted128NodeCrypto);
    expect(inputDataHex).toEqual(decrypted128WebCrypto);
  } finally {
    // Restore previous `crypto` global var
    if (globalCryptoOrig.defined) {
      globalScope.crypto = globalCryptoOrig.value;
    } else {
      delete globalScope.crypto;
    }
  }
});

test('encrypt-to-decrypt works', async () => {
  const testString = 'all work and no play makes jack a dull boy';
  let cipherObj = await encryptECIES(publicKey, utf8ToBytes(testString), true);
  let deciphered = await decryptECIES(privateKey, cipherObj);
  expect(deciphered).toEqual(testString);

  const testBytes = utf8ToBytes(testString);
  cipherObj = await encryptECIES(publicKey, testBytes, false);
  deciphered = (await decryptECIES(privateKey, cipherObj)) as Uint8Array;
  expect(bytesToHex(deciphered)).toEqual(bytesToHex(testBytes));
});

test('encrypt-to-decrypt fails on bad mac', async () => {
  const testString = 'all work and no play makes jack a dull boy';
  const cipherObj = await encryptECIES(publicKey, utf8ToBytes(testString), true);
  const evilString = 'some work and some play makes jack a dull boy';
  const evilObj = await encryptECIES(publicKey, utf8ToBytes(evilString), true);

  cipherObj.cipherText = evilObj.cipherText;

  try {
    await decryptECIES(privateKey, cipherObj);
    expect(false).toEqual(true);
  } catch (e: any) {
    expect(e.code).toEqual(ERROR_CODES.FAILED_DECRYPTION_ERROR);
    expect(e.message.indexOf('failure in MAC check')).not.toEqual(-1);
  }
});

test('Should be able to prevent a public key twist attack for secp256k1', async () => {
  const curve = new elliptic.ec('secp256k1');
  // Pick a bad point to generate a public key.
  // If a bad point can be passed it's possible to perform a twist attack.
  const point = curve.keyFromPublic({
    x: '14',
    y: '16',
  });
  const badPublicKey = point.getPublic('hex');
  try {
    const testString = 'all work and no play makes jack a dull boy';
    await encryptECIES(badPublicKey, utf8ToBytes(testString), true);
    expect(false).toEqual(true);
  } catch (error: any) {
    expect(error.reason).toEqual('IsNotPoint');
  }
});

test('Should be able to accept public key with valid point on secp256k', async () => {
  const curve = new elliptic.ec('secp256k1');
  // Pick a valid point on secp256k to generate a public key.
  const point = curve.keyFromPublic({
    x: '0C6047F9441ED7D6D3045406E95C07CD85C778E4B8CEF3CA7ABAC09B95C709EE5',
    y: '1AE168FEA63DC339A3C58419466CEAEEF7F632653266D0E1236431A950CFE52A',
  });
  const goodPublicKey = point.getPublic('hex');
  try {
    const testString = 'all work and no play makes jack a dull boy';
    // encryptECIES should not throw invalid point exception
    await encryptECIES(goodPublicKey, utf8ToBytes(testString), true);
    expect(true).toEqual(true);
  } catch (error: any) {
    expect(error.reason).toEqual('IsNotPoint');
  }
});

test('Should reject public key having invalid length', async () => {
  const invalidPublicKey = '0273d28f9951ce46538951e3697c62588a87f1f1f295de4a14fdd4c780fc52cfe69';
  try {
    const testString = 'all work and no play makes jack a dull boy';
    await encryptECIES(invalidPublicKey, utf8ToBytes(testString), true);
    //Should throw invalid format exception
    expect(false).toEqual(true);
  } catch (error: any) {
    expect(error.reason).toEqual('InvalidFormat');
  }
});

test('Should accept public key having valid length', async () => {
  const publicKey = '027d28f9951ce46538951e3697c62588a87f1f1f295de4a14fdd4c780fc52cfe69';
  try {
    const testString = 'all work and no play makes jack a dull boy';
    await encryptECIES(publicKey, utf8ToBytes(testString), true);
    // Should not throw invalid format exception
    expect(true).toEqual(true);
  } catch (error: any) {
    expect(error.reason).toEqual('InvalidFormat');
  }
});

test('Should reject invalid uncompressed public key', async () => {
  const invalidPublicKey =
    '02ad90e5b6bc86b3ec7fac2c5fbda7423fc8ef0d58df594c773fa05e2c281b2bfe877677c668bd13603944e34f4818ee03cadd81a88542b8b4d5431264180e2c28';
  try {
    const testString = 'all work and no play makes jack a dull boy';
    await encryptECIES(invalidPublicKey, utf8ToBytes(testString), true);
    // Should throw invalid format exception
    expect(false).toEqual(true);
  } catch (error: any) {
    expect(error.reason).toEqual('InvalidFormat');
  }
});

test('Should accept valid uncompressed public key', async () => {
  const publicKey =
    '04ad90e5b6bc86b3ec7fac2c5fbda7423fc8ef0d58df594c773fa05e2c281b2bfe877677c668bd13603944e34f4818ee03cadd81a88542b8b4d5431264180e2c28';
  try {
    const testString = 'all work and no play makes jack a dull boy';
    await encryptECIES(publicKey, utf8ToBytes(testString), true);
    // Should not throw invalid format exception
    expect(true).toEqual(true);
  } catch (error: any) {
    expect(error.reason).toEqual('InvalidFormat');
  }
});

test('Should reject invalid compressed public key', async () => {
  const invalidPublicKey = '017d28f9951ce46538951e3697c62588a87f1f1f295de4a14fdd4c780fc52cfe69';
  try {
    const testString = 'all work and no play makes jack a dull boy';
    await encryptECIES(invalidPublicKey, utf8ToBytes(testString), true);
    // Should throw invalid format exception
    expect(false).toEqual(true);
  } catch (error: any) {
    expect(error.reason).toEqual('InvalidFormat');
  }
});

test('Should accept valid compressed public key', async () => {
  const publicKey = '027d28f9951ce46538951e3697c62588a87f1f1f295de4a14fdd4c780fc52cfe69';
  try {
    const testString = 'all work and no play makes jack a dull boy';
    await encryptECIES(publicKey, utf8ToBytes(testString), true);
    // Should not throw invalid format exception
    expect(true).toEqual(true);
  } catch (error: any) {
    expect(error.reason).toEqual('InvalidFormat');
  }
});

test('sign-to-verify-works', () => {
  const testString = 'all work and no play makes jack a dull boy';
  let sigObj = signECDSA(privateKey, testString);
  expect(verifyECDSA(testString, sigObj.publicKey, sigObj.signature)).toEqual(true);

  const testBytes = utf8ToBytes(testString);
  sigObj = signECDSA(privateKey, testBytes);
  expect(verifyECDSA(testBytes, sigObj.publicKey, sigObj.signature)).toEqual(true);
});

test('sign-to-verify-fails', () => {
  const testString = 'all work and no play makes jack a dull boy';
  const failString = 'I should fail';

  let sigObj = signECDSA(privateKey, testString);
  expect(verifyECDSA(failString, sigObj.publicKey, sigObj.signature)).toEqual(false);

  const testBytes = utf8ToBytes(testString);
  sigObj = signECDSA(privateKey, testBytes);
  expect(verifyECDSA(utf8ToBytes(failString), sigObj.publicKey, sigObj.signature)).toEqual(false);

  const badPK = '0288580b020800f421d746f738b221d384f098e911b81939d8c94df89e74cba776';
  sigObj = signECDSA(privateKey, testBytes);
  expect(verifyECDSA(utf8ToBytes(failString), badPK, sigObj.signature)).toEqual(false);
});

test('bn-padded-to-64-bytes', () => {
  const ecurve = new elliptic.ec('secp256k1');

  const evilHexes = [
    'ba40f85b152bea8c3812da187bcfcfb0dc6e15f9e27cb073633b1c787b19472f',
    'e346010f923f768138152d0bad063999ff1da5361a81e6e6f9106241692a0076',
  ];
  const results = evilHexes.map(hex => {
    const ephemeralSK = ecurve.keyFromPrivate(hex);
    const ephemeralPK = ephemeralSK.getPublic();
    const sharedSecret = ephemeralSK.derive(ephemeralPK);
    return getHexFromBN(BigInt(sharedSecret.toString())).length === 64;
  });

  expect(results.every(x => x)).toEqual(true);

  const bnBytes = getBytesFromBN(BigInt(123));

  expect(bnBytes.byteLength).toEqual(32);
  expect(bytesToHex(bnBytes)).toEqual(getHexFromBN(BigInt(123)));
});

test('encryptMnemonic & decryptMnemonic', async () => {
  const rawPhrase =
    'march eager husband pilot waste rely exclude taste ' + 'twist donkey actress scene';
  const rawPassword = 'testtest';
  const encryptedPhrase =
    'ffffffffffffffffffffffffffffffffca638cc39fc270e8be5c' +
    'bf98347e42a52ee955e287ab589c571af5f7c80269295b0039e32ae13adf11bc6506f5ec' +
    '32dda2f79df4c44276359c6bac178ae393de';

  const preEncryptedPhrase =
    '7573f4f51089ba7ce2b95542552b7504de7305398637733' +
    '0579649dfbc9e664073ba614fac180d3dc237b21eba57f9aee5702ba819fe17a0752c4dc7' +
    '94884c9e75eb60da875f778bbc1aaca1bd373ea3';

  // Test encryption -> decryption. Can't be done with hard-coded values
  // due to random salt.
  await encryptMnemonic(rawPhrase, rawPassword)
    .then(
      encoded => decryptMnemonic(bytesToHex(encoded), rawPassword),
      err => {
        fail(`Should encrypt mnemonic phrase, instead errored: ${err}`);
      }
    )
    .then(
      (decoded: string) => {
        expect(decoded.toString() === rawPhrase).toEqual(true);
      },
      err => {
        fail(`Should decrypt encrypted phrase, instead errored: ${err}`);
      }
    );

  // // Test encryption with mocked randomBytes generator to use same salt
  try {
    const mockSalt = hexToBytes('ff'.repeat(16));
    const encoded = await encryptMnemonic(rawPhrase, rawPassword, {
      getRandomBytes: () => mockSalt,
    });
    expect(bytesToHex(encoded) === encryptedPhrase).toEqual(true);
  } catch (err) {
    fail(`Should have encrypted phrase with deterministic salt, instead errored: ${err}`);
  }

  // // Test decryption with mocked randomBytes generator to use same salt
  try {
    const decoded = await decryptMnemonic(hexToBytes(encryptedPhrase), rawPassword);
    expect(decoded === rawPhrase).toEqual(true);
  } catch (err) {
    throw `Should have decrypted phrase with deterministic salt, instead errored: ${err}`;
  }

  const errorCallback = jest.fn();

  // // Invalid inputs
  await encryptMnemonic('not a mnemonic phrase', 'password').then(() => {
    fail('Should have thrown on invalid mnemonic input');
  }, errorCallback);

  expect(errorCallback).toHaveBeenCalledTimes(1);

  await decryptMnemonic(preEncryptedPhrase, 'incorrect password').then(() => {
    fail('Should have thrown on incorrect password for decryption');
  }, errorCallback);

  expect(errorCallback).toHaveBeenCalledTimes(2);
});

test('buffer interop', () => {
  const data =
    '1c94d7de0000000304d583f007c71e6e5fef354c046e8c64b1adebd6904dcb007a1222f07313643873455ab2a3ab3819e99d518cc7d33c18bde02494aa74efc35a8970b2007b2fc715f6067cee27f5c92d020b1806b0444994aab80050a6732131d2947a51bacb3952fb9286124b3c2b3196ff7edce66dee0dbd9eb59558e0044bddb3a78f48a66cf8d78bb46bb472bd2d5ec420c831fc384293252459524ee2d668869f33c586a94467d0ce8671260f4cc2e87140c873b6ca79fb86c6d77d134d7beb2018845a9e71e6c7ecdedacd8a676f1f873c5f9c708cc6070642d44d2505aa9cdba26c50ad6f8d3e547fb0cba710a7f7be54ff7ea7e98a809ddee5ef85f6f259b3a17a8d8dbaac618b80fe266a1e63ec19e476bee9177b51894ee';
  const dataShort = data.slice(0, data.length - 1);

  const dataBuffer = Buffer.from(data, 'hex');
  const dataBytes = hexToBytes(data);

  expect(dataBytes.byteLength).not.toBe(dataBuffer.byteLength); // Buffer handles odd length hex strings differently than Stacks.js `hexToBytes`


  expect(Buffer.from(dataBytes)).not.toEqual(dataBuffer);

  expect(dataShort.length).toBe(data.length - 1);

  expect(Buffer.from(dataShort, 'hex')).toEqual(dataBuffer); // On odd length hex strings Buffer.from 'hex' will essentially remove the last string character
});

test('Shared secret from a keypair should be same using elliptic or noble', () => {
  // Consider a privateKey, publicKey pair and get shared secret using noble and then elliptic
  // Both secret's should match noble <=> elliptic
  //Step 1:  Get shared secret using noble secp256k1 library
  const sharedSecretNoble = getSharedSecret(privateKey, publicKey, true);
  // Trim the compressed mode prefix byte
  const sharedSecretNobleBytes = sharedSecretNoble.slice(1);

  //Step 2:  Get shared secret using elliptic library
  const ecurve = new elliptic.ec('secp256k1');
  const ecPK = ecurve.keyFromPublic(publicKey, 'hex').getPublic();
  const keyPair = ecurve.keyFromPrivate(privateKey);

  // Get shared secret using elliptic library
  const sharedSecretEC = keyPair.derive(ecPK).toBuffer();

  // Both shared secret should match to verify the compatibility
  expect(sharedSecretNobleBytes).toEqual(new Uint8Array(sharedSecretEC));
});

test('Sign msg using elliptic/secp256k1 and verify signature using @noble/secp256k1', () => {
  // Maximum keypairs to try if a keypairs is not accepted by @noble/secp256k1
  const keyPairAttempts = 8; // Normally a keypairs is accepted in first or second attempt

  let nobleVerifyResult = false;
  const ec = new elliptic.ec('secp256k1');

  for (let i = 0; i < keyPairAttempts && !nobleVerifyResult; i++) {
    // Generate keys
    const options = { entropy: utils.randomBytes(32) };
    const keyPair = ec.genKeyPair(options);

    const msg = 'hello world';
    const msgHex = bytesToHex(utf8ToBytes(msg));

    // Sign msg using elliptic/secp256k1
    // input must be an array, or a hex-string
    const signature = keyPair.sign(msgHex);

    // Export DER encoded signature in hex format
    const signatureHex = signature.toDER('hex');

    // Verify signature using elliptic/secp256k1
    const ellipticVerifyResult = keyPair.verify(msgHex, signatureHex);

    expect(ellipticVerifyResult).toBeTruthy();

    // Get public key from key-pair
    const publicKey = keyPair.getPublic().encodeCompressed('hex');

    // Verify same signature using @noble/secp256k1
    nobleVerifyResult = nobleSecp256k1Verify(signatureHex, msgHex, publicKey);
  }
  // Verification result by @noble/secp256k1 should be true
  expect(nobleVerifyResult).toBeTruthy();
});

test('Sign msg using @noble/secp256k1 and verify signature using elliptic/secp256k1', () => {
  // Generate private key
  const privateKey = utils.randomPrivateKey();

  const msg = 'hello world';
  const msgHex = bytesToHex(utf8ToBytes(msg));

  // Sign msg using @noble/secp256k1
  // input must be a hex-string
  const signature = nobleSecp256k1Sign(msgHex, privateKey);

  const publicKey = nobleGetPublicKey(privateKey);

  // Verify signature using @noble/secp256k1
  const nobleVerifyResult = nobleSecp256k1Verify(signature, msgHex, publicKey);

  // Verification result by @noble/secp256k1
  expect(nobleVerifyResult).toBeTruthy();

  // Generate keypair using private key
  const ec = new elliptic.ec('secp256k1');
  const keyPair = ec.keyFromPrivate(privateKey);

  // Verify signature using elliptic/secp256k1
  const ellipticVerifyResult = keyPair.verify(msgHex, signature);

  // Verification result by elliptic/secp256k1 should be true
  expect(ellipticVerifyResult).toBeTruthy();
});

test('Verify compatibility @scure/bip39 <=> bitcoinjs/bip39', () => {
  // Consider an entropy
  const entropy = '00000000000000000000000000000000';
  // Consider same entropy in array format
  const entropyUint8Array = new Uint8Array(entropy.split('').map(Number));

  // Based on Aaron comment do not import bitcoinjs/bip39 for these tests
  const bitcoinjsBip39 = {
    // Consider it equivalent to bitcoinjs/bip39 (offloaded now)
    // Using this map of required functions from bitcoinjs/bip39 and mocking the output for considered entropy
    entropyToMnemonicBip39: (_: string) =>
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    validateMnemonicBip39: (_: string) => true,
    mnemonicToEntropyBip39: (_: string) => '00000000000000000000000000000000',
  };

  // entropyToMnemonicBip39 imported from bitcoinjs/bip39
  const bip39Mnemonic = bitcoinjsBip39.entropyToMnemonicBip39(entropy);
  // entropyToMnemonic imported from @scure/bip39
  const mnemonic = entropyToMnemonic(entropyUint8Array, wordlist);

  //Phase 1: Cross verify mnemonic validity: @scure/bip39 <=> bitcoinjs/bip39

  // validateMnemonic imported from @scure/bip39
  expect(validateMnemonic(bip39Mnemonic, wordlist)).toEqual(true);
  // validateMnemonicBip39 imported from bitcoinjs/bip39
  expect(bitcoinjsBip39.validateMnemonicBip39(mnemonic)).toEqual(true);

  // validateMnemonic imported from @scure/bip39
  expect(validateMnemonic(mnemonic, wordlist)).toEqual(true);
  // validateMnemonicBip39 imported from bitcoinjs/bip39
  expect(bitcoinjsBip39.validateMnemonicBip39(bip39Mnemonic)).toEqual(true);

  //Phase 2: Get back entropy from mnemonic and verify @scure/bip39 <=> bitcoinjs/bip39

  // mnemonicToEntropy imported from @scure/bip39
  expect(mnemonicToEntropy(mnemonic, wordlist)).toEqual(entropyUint8Array);
  // mnemonicToEntropyBip39 imported from bitcoinjs/bip39
  expect(bitcoinjsBip39.mnemonicToEntropyBip39(bip39Mnemonic)).toEqual(entropy);
  // mnemonicToEntropy imported from @scure/bip39
  expect(mnemonicToEntropy(bip39Mnemonic, wordlist)).toEqual(hexToBytes(entropy));
  // mnemonicToEntropyBip39 imported from bitcoinjs/bip39
  const entropyString = bitcoinjsBip39.mnemonicToEntropyBip39(mnemonic);
  // Convert entropy to bytes
  const entropyInBytes = new Uint8Array(entropyString.split('').map(Number));
  // entropy should match with entropyUint8Array
  expect(entropyInBytes).toEqual(entropyUint8Array);
});
