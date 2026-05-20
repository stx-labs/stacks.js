import { concatBytes } from '@stacks/common';
import { getCryptoLib } from './cryptoUtils';

type NodeCryptoCreateCipher = typeof import('crypto').createCipheriv;
type NodeCryptoCreateDecipher = typeof import('crypto').createDecipheriv;

export type CipherAlgorithm = 'aes-256-cbc' | 'aes-128-cbc';

export interface AesCipher {
  encrypt(
    algorithm: CipherAlgorithm,
    key: Uint8Array,
    iv: Uint8Array,
    data: Uint8Array
  ): Promise<Uint8Array>;

  decrypt(
    algorithm: CipherAlgorithm,
    key: Uint8Array,
    iv: Uint8Array,
    data: Uint8Array
  ): Promise<Uint8Array>;
}

export class NodeCryptoAesCipher implements AesCipher {
  createCipher: NodeCryptoCreateCipher;

  createDecipher: NodeCryptoCreateDecipher;

  constructor(createCipher: NodeCryptoCreateCipher, createDecipher: NodeCryptoCreateDecipher) {
    this.createCipher = createCipher;
    this.createDecipher = createDecipher;
  }

  async encrypt(
    algorithm: CipherAlgorithm,
    key: Uint8Array,
    iv: Uint8Array,
    data: Uint8Array
  ): Promise<Uint8Array> {
    if (algorithm !== 'aes-128-cbc' && algorithm !== 'aes-256-cbc') {
      throw new Error(`Unsupported cipher algorithm "${algorithm}"`);
    }
    const cipher = this.createCipher(algorithm, key, iv);
    const result = new Uint8Array(concatBytes(cipher.update(data), cipher.final()));
    return Promise.resolve(result);
  }

  async decrypt(
    algorithm: CipherAlgorithm,
    key: Uint8Array,
    iv: Uint8Array,
    data: Uint8Array
  ): Promise<Uint8Array> {
    if (algorithm !== 'aes-128-cbc' && algorithm !== 'aes-256-cbc') {
      throw new Error(`Unsupported cipher algorithm "${algorithm}"`);
    }
    const cipher = this.createDecipher(algorithm, key, iv);
    const result = new Uint8Array(concatBytes(cipher.update(data), cipher.final()));
    return Promise.resolve(result);
  }
}

export class WebCryptoAesCipher implements AesCipher {
  subtleCrypto: SubtleCrypto;

  constructor(subtleCrypto: SubtleCrypto) {
    this.subtleCrypto = subtleCrypto;
  }

  async encrypt(
    algorithm: CipherAlgorithm,
    key: Uint8Array,
    iv: Uint8Array,
    data: Uint8Array
  ): Promise<Uint8Array> {
    let algo: string;
    let length: number;
    if (algorithm === 'aes-128-cbc') {
      algo = 'AES-CBC';
      length = 128;
    } else if (algorithm === 'aes-256-cbc') {
      algo = 'AES-CBC';
      length = 256;
    } else {
      throw new Error(`Unsupported cipher algorithm "${algorithm}"`);
    }
    const cryptoKey = await this.subtleCrypto.importKey(
      'raw',
      key as BufferSource,
      { name: algo, length },
      false,
      ['encrypt']
    );
    const result = await this.subtleCrypto.encrypt(
      { name: algo, iv: iv as BufferSource },
      cryptoKey,
      data as BufferSource
    );
    return new Uint8Array(result);
  }

  async decrypt(
    algorithm: CipherAlgorithm,
    key: Uint8Array,
    iv: Uint8Array,
    data: Uint8Array
  ): Promise<Uint8Array> {
    let algo: string;
    let length: number;
    if (algorithm === 'aes-128-cbc') {
      algo = 'AES-CBC';
      length = 128;
    } else if (algorithm === 'aes-256-cbc') {
      algo = 'AES-CBC';
      length = 256;
    } else {
      throw new Error(`Unsupported cipher algorithm "${algorithm}"`);
    }
    const cryptoKey = await this.subtleCrypto.importKey(
      'raw',
      key as BufferSource,
      { name: algo, length },
      false,
      ['decrypt']
    );
    const result = await this.subtleCrypto.decrypt(
      { name: algo, iv: iv as BufferSource },
      cryptoKey,
      data as BufferSource
    );
    return new Uint8Array(result);
  }
}

export async function createCipher(): Promise<AesCipher> {
  const cryptoLib = await getCryptoLib();
  if (cryptoLib.name === 'subtleCrypto') {
    return new WebCryptoAesCipher(cryptoLib.lib);
  }
  return new NodeCryptoAesCipher(cryptoLib.lib.createCipheriv, cryptoLib.lib.createDecipheriv);
}
