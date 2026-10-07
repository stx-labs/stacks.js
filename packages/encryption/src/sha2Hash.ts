import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { getCryptoLib } from './cryptoUtils';

type NodeCryptoCreateHash = typeof import('crypto').createHash;

export interface Sha2Hash {
  digest(data: Uint8Array, algorithm?: 'sha256' | 'sha512'): Promise<Uint8Array>;
}

export class NodeCryptoSha2Hash {
  createHash: NodeCryptoCreateHash;

  constructor(createHash: NodeCryptoCreateHash) {
    this.createHash = createHash;
  }

  async digest(data: Uint8Array, algorithm = 'sha256'): Promise<Uint8Array> {
    try {
      const result = this.createHash(algorithm).update(data).digest();
      return Promise.resolve(result);
    } catch (error) {
      console.log(error);
      console.log(
        `Error performing ${algorithm} digest with Node.js 'crypto.createHash', falling back to JS implementation.`
      );
      return Promise.resolve(algorithm === 'sha256' ? hashSha256Sync(data) : hashSha512Sync(data));
    }
  }
}

export class WebCryptoSha2Hash implements Sha2Hash {
  subtleCrypto: SubtleCrypto;

  constructor(subtleCrypto: SubtleCrypto) {
    this.subtleCrypto = subtleCrypto;
  }

  async digest(data: Uint8Array, algorithm = 'sha256'): Promise<Uint8Array> {
    let algo: string;
    if (algorithm === 'sha256') {
      algo = 'SHA-256';
    } else if (algorithm === 'sha512') {
      algo = 'SHA-512';
    } else {
      throw new Error(`Unsupported hash algorithm ${algorithm}`);
    }
    try {
      const hash = await this.subtleCrypto.digest(algo, data as BufferSource);
      return new Uint8Array(hash);
    } catch (error) {
      console.log(error);
      console.log(
        `Error performing ${algorithm} digest with WebCrypto, falling back to JS implementation.`
      );
      return Promise.resolve(algorithm === 'sha256' ? hashSha256Sync(data) : hashSha512Sync(data));
    }
  }
}

export async function createSha2Hash(): Promise<Sha2Hash> {
  const cryptoLib = await getCryptoLib();
  if (cryptoLib.name === 'subtleCrypto') {
    return new WebCryptoSha2Hash(cryptoLib.lib);
  } else {
    return new NodeCryptoSha2Hash(cryptoLib.lib.createHash);
  }
}

export function hashSha256Sync(data: Uint8Array) {
  return sha256(data);
}

export function hashSha512Sync(data: Uint8Array) {
  return sha512(data);
}
