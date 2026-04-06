// @ts-ignore
export function isSubtleCryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
}

export function isNodeCryptoAvailable<T>(
  withFeature: (nodeCrypto: typeof import('crypto')) => boolean | T
): false | T;
export function isNodeCryptoAvailable<T>(
  withFeature?: (nodeCrypto: typeof import('crypto')) => boolean | T
): boolean | T {
  try {
    const resolvedResult = require.resolve('crypto');
    if (!resolvedResult) {
      return false;
    }
    const cryptoModule = require('crypto') as typeof import('crypto');
    if (!cryptoModule) {
      return false;
    }
    if (withFeature) {
      const features = withFeature(cryptoModule);
      return features;
    }
    return true;
  } catch (error) {
    return false;
  }
}

export const NO_CRYPTO_LIB =
  'Crypto lib not found. Either the WebCrypto "crypto.subtle" or Node.js "crypto" module must be available.';

export interface WebCryptoLib {
  lib: SubtleCrypto;
  name: 'subtleCrypto';
}

export interface NodeCryptoLib {
  lib: typeof import('crypto');
  name: 'nodeCrypto';
}

// Make async for future version which may lazy load.
export async function getCryptoLib(): Promise<WebCryptoLib | NodeCryptoLib> {
  if (isSubtleCryptoAvailable()) {
    return {
      lib: crypto.subtle,
      name: 'subtleCrypto',
    };
  } else {
    try {
      const nodeCrypto = require('crypto') as typeof import('crypto');
      return {
        lib: nodeCrypto,
        name: 'nodeCrypto',
      };
    } catch (error) {
      throw new Error(NO_CRYPTO_LIB);
    }
  }
}
