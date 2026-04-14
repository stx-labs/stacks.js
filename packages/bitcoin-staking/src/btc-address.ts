import { bech32, bech32m } from '@scure/base';
import { bigIntToBytes, hexToBytes } from '@stacks/common';
import { base58CheckDecode, base58CheckEncode } from '@stacks/encryption';
import type { StacksNetwork, StacksNetworkName } from '@stacks/network';
import {
  type BufferCV,
  Cl,
  ClarityType,
  type ClarityValue,
  type TupleCV,
} from '@stacks/transactions';
import {
  B58_ADDR_PREFIXES,
  BitcoinNetworkVersion,
  PoXAddressVersion,
  SEGWIT_ADDR_PREFIXES,
  SEGWIT_V0,
  SEGWIT_V0_ADDR_PREFIX,
  SEGWIT_V1,
  SEGWIT_V1_ADDR_PREFIX,
  SegwitPrefix,
} from './constants';
import { networkFrom } from './network';

export interface BtcAddressRepr {
  version: PoXAddressVersion;
  data: Uint8Array;
}

function btcAddressVersionToLegacyHashMode(btcAddressVersion: number): PoXAddressVersion {
  switch (btcAddressVersion) {
    case BitcoinNetworkVersion.mainnet.P2PKH:
    case BitcoinNetworkVersion.testnet.P2PKH:
      return PoXAddressVersion.P2PKH;
    case BitcoinNetworkVersion.mainnet.P2SH:
    case BitcoinNetworkVersion.testnet.P2SH:
      return PoXAddressVersion.P2SH;
    default:
      throw new Error('Invalid pox address version');
  }
}

function nativeAddressToSegwitVersion(
  witnessVersion: number,
  dataLength: number
): PoXAddressVersion {
  if (witnessVersion === SEGWIT_V0 && dataLength === 20) return PoXAddressVersion.P2WPKH;
  if (witnessVersion === SEGWIT_V0 && dataLength === 32) return PoXAddressVersion.P2WSH;
  if (witnessVersion === SEGWIT_V1 && dataLength === 32) return PoXAddressVersion.P2TR;
  throw new Error(
    'Invalid native segwit witness version and byte length. Only P2WPKH, P2WSH, and P2TR are supported.'
  );
}

function bech32Decode(btcAddress: string) {
  const { words } = bech32.decode(btcAddress as `${string}1${string}`);
  const witnessVersion = words[0];
  if (witnessVersion > 0)
    throw new Error('Addresses with a witness version >= 1 should be encoded in bech32m');
  return { witnessVersion, data: bech32.fromWords(words.slice(1)) };
}

function bech32MDecode(btcAddress: string) {
  const { words } = bech32m.decode(btcAddress as `${string}1${string}`);
  const witnessVersion = words[0];
  if (witnessVersion === 0)
    throw new Error('Addresses with witness version 0 should be encoded in bech32');
  return { witnessVersion, data: bech32m.fromWords(words.slice(1)) };
}

function decodeNativeSegwitBtcAddress(btcAddress: string) {
  if (SEGWIT_V0_ADDR_PREFIX.test(btcAddress)) return bech32Decode(btcAddress);
  if (SEGWIT_V1_ADDR_PREFIX.test(btcAddress)) return bech32MDecode(btcAddress);
  throw new Error(`Native segwit address ${btcAddress} does not match a valid prefix`);
}

function legacyHashModeToBtcAddressVersion(
  hashMode: PoXAddressVersion,
  network: StacksNetworkName
): number {
  switch (hashMode) {
    case PoXAddressVersion.P2PKH:
      return BitcoinNetworkVersion[network].P2PKH;
    case PoXAddressVersion.P2SH:
    case PoXAddressVersion.P2SHP2WPKH:
    case PoXAddressVersion.P2SHP2WSH:
      return BitcoinNetworkVersion[network].P2SH;
    default:
      throw new Error('Invalid pox address version');
  }
}

function extractPoxTupleFields(poxAddrClarityValue: ClarityValue): {
  version: number;
  hashBytes: Uint8Array;
} {
  const cv = poxAddrClarityValue as TupleCV;
  if (cv.type !== ClarityType.Tuple || !cv.value) {
    throw new Error('Invalid argument, expected ClarityValue to be a TupleCV');
  }
  if (!('version' in cv.value) || !('hashbytes' in cv.value)) {
    throw new Error(
      'Invalid argument, expected Clarity tuple to contain `version` and `hashbytes` keys'
    );
  }
  const versionCV = cv.value['version'] as BufferCV;
  const hashBytesCV = cv.value['hashbytes'] as BufferCV;
  if (versionCV.type !== ClarityType.Buffer || hashBytesCV.type !== ClarityType.Buffer) {
    throw new Error('Invalid argument, expected `version` and `hashbytes` to be buffer values');
  }
  return {
    version: hexToBytes(versionCV.value)[0],
    hashBytes: hexToBytes(hashBytesCV.value),
  };
}

/**
 * Parse a Bitcoin address string into its PoX version and hash bytes.
 *
 * @example
 * ```ts
 * import { BtcAddress } from '@stacks/bitcoin-staking';
 *
 * const addr = BtcAddress.parse('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
 * // { version: PoXAddressVersion.P2WPKH, data: Uint8Array(20) }
 * ```
 */
export function parse(btcAddress: string): BtcAddressRepr {
  try {
    if (B58_ADDR_PREFIXES.test(btcAddress)) {
      const b58 = base58CheckDecode(btcAddress);
      return {
        version: btcAddressVersionToLegacyHashMode(b58.version),
        data: b58.hash,
      };
    }
    if (SEGWIT_ADDR_PREFIXES.test(btcAddress)) {
      const b32 = decodeNativeSegwitBtcAddress(btcAddress);
      return {
        version: nativeAddressToSegwitVersion(b32.witnessVersion, b32.data.length),
        data: b32.data,
      };
    }
  } catch (cause) {
    throw new Error(`'${btcAddress}' is not a valid P2PKH/P2SH/P2WPKH/P2WSH/P2TR address`, {
      cause,
    });
  }
  throw new Error(`'${btcAddress}' is not a valid P2PKH/P2SH/P2WPKH/P2WSH/P2TR address`);
}

/**
 * Stringify a Bitcoin address from parsed components or a PoX Clarity tuple.
 *
 * @example
 * ```ts
 * import { BtcAddress, PoXAddressVersion } from '@stacks/bitcoin-staking';
 *
 * // From parsed components:
 * BtcAddress.stringify({ version: PoXAddressVersion.P2WPKH, data, network: 'mainnet' });
 *
 * // Round-trip:
 * BtcAddress.stringify({ ...BtcAddress.parse('bc1q...'), network: 'mainnet' });
 *
 * // From a PoX Clarity tuple:
 * BtcAddress.stringify({ poxAddr: tuple, network: 'mainnet' });
 *
 * // Works with a StacksNetwork object too:
 * BtcAddress.stringify({ ...parsed, network: STACKS_MAINNET });
 * ```
 */
export function stringify(
  address:
    | (BtcAddressRepr & { network: StacksNetworkName | StacksNetwork })
    | { poxAddr: TupleCV; network: StacksNetworkName | StacksNetwork }
): string {
  const network = networkFrom(address.network);

  let version: PoXAddressVersion;
  let data: Uint8Array;

  if ('poxAddr' in address) {
    const fields = extractPoxTupleFields(address.poxAddr);
    version = fields.version as PoXAddressVersion;
    data = fields.hashBytes;
  } else {
    version = address.version;
    data = address.data;
  }

  switch (version) {
    case PoXAddressVersion.P2PKH:
    case PoXAddressVersion.P2SH:
    case PoXAddressVersion.P2SHP2WPKH:
    case PoXAddressVersion.P2SHP2WSH: {
      const btcAddrVersion = legacyHashModeToBtcAddressVersion(version, network);
      return base58CheckEncode(btcAddrVersion, data);
    }
    case PoXAddressVersion.P2WPKH:
    case PoXAddressVersion.P2WSH: {
      const words = bech32.toWords(data);
      return bech32.encode(SegwitPrefix[network], [SEGWIT_V0, ...words]);
    }
    case PoXAddressVersion.P2TR: {
      const words = bech32m.toWords(data);
      return bech32m.encode(SegwitPrefix[network], [SEGWIT_V1, ...words]);
    }
    default:
      throw new Error(`Unexpected address version: ${version}`);
  }
}

/**
 * Convert a Bitcoin address string to a Clarity `pox-addr` tuple.
 *
 * @example
 * ```ts
 * import { BtcAddress } from '@stacks/bitcoin-staking';
 *
 * const tuple = BtcAddress.toPoxTuple('bc1q...');
 * // Cl.tuple({ version: Cl.buffer(...), hashbytes: Cl.buffer(...) })
 * ```
 */
export function toPoxTuple(btcAddress: string) {
  const { version, data } = parse(btcAddress);
  return Cl.tuple({
    version: Cl.buffer(bigIntToBytes(BigInt(version), 1)),
    hashbytes: Cl.buffer(data),
  });
}
