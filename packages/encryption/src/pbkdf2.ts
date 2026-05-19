import { utf8ToBytes, writeUInt32BE } from '@stacks/common';
import { getCryptoLib } from './cryptoUtils';

export type Pbkdf2Digests = 'sha512' | 'sha256';

export interface Pbkdf2 {
  derive(
    password: string,
    salt: Uint8Array,
    iterations: number,
    keyLength: number,
    digest: Pbkdf2Digests
  ): Promise<Uint8Array>;
}

type NodePbkdf2Fn = typeof import('crypto').pbkdf2;

export class NodeCryptoPbkdf2 implements Pbkdf2 {
  nodePbkdf2: NodePbkdf2Fn;

  constructor(nodePbkdf2: NodePbkdf2Fn) {
    this.nodePbkdf2 = nodePbkdf2;
  }

  async derive(
    password: string,
    salt: Uint8Array,
    iterations: number,
    keyLength: number,
    digest: Pbkdf2Digests
  ): Promise<Uint8Array> {
    if (digest !== 'sha512' && digest !== 'sha256') {
      throw new Error(`Unsupported digest "${digest}" for Pbkdf2`);
    }
    return new Promise((resolve, reject) => {
      this.nodePbkdf2(password, salt, iterations, keyLength, digest, (error, result) => {
        if (error) {
          reject(error);
        }
        resolve(result);
      });
    });
  }
}

export class WebCryptoPbkdf2 implements Pbkdf2 {
  subtleCrypto: SubtleCrypto;

  constructor(subtleCrypto: SubtleCrypto) {
    this.subtleCrypto = subtleCrypto;
  }

  async derive(
    password: string,
    salt: Uint8Array,
    iterations: number,
    keyLength: number,
    digest: Pbkdf2Digests
  ): Promise<Uint8Array> {
    let algo: string;
    if (digest === 'sha256') {
      algo = 'SHA-256';
    } else if (digest === 'sha512') {
      algo = 'SHA-512';
    } else {
      throw new Error(`Unsupported Pbkdf2 digest algorithm "${digest}"`);
    }

    const passwordBytes = utf8ToBytes(password);
    try {
      const key = await this.subtleCrypto.importKey(
        'raw',
        passwordBytes as BufferSource,
        'PBKDF2',
        false,
        ['deriveBits']
      );
      const result = await this.subtleCrypto.deriveBits(
        {
          name: 'PBKDF2',
          salt: salt as BufferSource,
          iterations,
          hash: { name: algo },
        },
        key,
        keyLength * 8
      );
      return new Uint8Array(result);
    } catch (error) {
      // Browser appears to support WebCrypto but missing pbkdf2 support.
      const partialWebCrypto = new WebCryptoPartialPbkdf2(this.subtleCrypto);
      return partialWebCrypto.derive(password, salt, iterations, keyLength, digest);
    }
  }
}

export class WebCryptoPartialPbkdf2 implements Pbkdf2 {
  // An async implementation for browsers that support WebCrypto hmac
  // but not pbkdf2. Extracted from crypto-browserify/pbkdf2 and modified to
  // use WebCrypto for hmac operations.
  // Original: https://github.com/crypto-browserify/pbkdf2/tree/v3.0.17/lib

  subtleCrypto: SubtleCrypto;

  constructor(subtleCrypto: SubtleCrypto) {
    this.subtleCrypto = subtleCrypto;
  }

  async derive(
    password: string,
    salt: Uint8Array,
    iterations: number,
    keyLength: number,
    digest: Pbkdf2Digests
  ): Promise<Uint8Array> {
    if (digest !== 'sha512' && digest !== 'sha256') {
      throw new Error(`Unsupported digest "${digest}" for Pbkdf2`);
    }
    const passwordBytes = utf8ToBytes(password);
    const algo = digest === 'sha512' ? 'SHA-512' : 'SHA-256';
    const algoOpts = { name: 'HMAC', hash: algo };
    const hmacDigest = (key: BufferSource, data: BufferSource) =>
      this.subtleCrypto
        .importKey('raw', key, algoOpts, true, ['sign'])
        .then(cryptoKey => this.subtleCrypto.sign(algoOpts, cryptoKey, data))
        .then(result => new Uint8Array(result));

    const DK = new Uint8Array(keyLength);
    const saltLength = salt.length;
    const block1 = new Uint8Array(saltLength + 4);
    block1.set(salt);
    let destPos = 0;
    const hLen = digest === 'sha512' ? 64 : 32;
    const l = Math.ceil(keyLength / hLen);

    for (let i = 1; i <= l; i++) {
      writeUInt32BE(block1, i, saltLength);
      const T = await hmacDigest(passwordBytes as BufferSource, block1 as BufferSource);
      let U = T;
      for (let j = 1; j < iterations; j++) {
        U = await hmacDigest(passwordBytes as BufferSource, U as BufferSource);
        for (let k = 0; k < hLen; k++) {
          T[k] ^= U[k];
        }
      }
      DK.set(T.subarray(0, DK.byteLength - destPos), destPos);
      destPos += hLen;
    }
    return DK;
  }
}

export async function createPbkdf2(): Promise<Pbkdf2> {
  const cryptoLib = await getCryptoLib();
  if (cryptoLib.name === 'subtleCrypto') {
    return new WebCryptoPbkdf2(cryptoLib.lib);
  }
  return new NodeCryptoPbkdf2(cryptoLib.lib.pbkdf2);
}
