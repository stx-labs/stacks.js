import { sha256 } from '@noble/hashes/sha256';
import { bech32, bech32m } from '@scure/base';
import { IntegerType, PrivateKey, bigIntToBytes, bytesToHex, hexToBytes } from '@stacks/common';
import {
  base58CheckDecode,
  base58CheckEncode,
  verifyMessageSignatureRsv,
} from '@stacks/encryption';
import { StacksNetwork, StacksNetworkName, StacksNetworks, networkFrom } from '@stacks/network';
import {
  BufferCV,
  ClarityType,
  ClarityValue,
  OptionalCV,
  TupleCV,
  bufferCV,
  encodeStructuredDataBytes,
  signStructuredData,
  stringAsciiCV,
  tupleCV,
  uintCV,
} from '@stacks/transactions';
import { PoxOperationInfo } from '.';
import {
  B58_ADDR_PREFIXES,
  BitcoinNetworkVersion,
  PoXAddressVersion,
  PoxOperationPeriod,
  SEGWIT_ADDR_PREFIXES,
  SEGWIT_V0,
  SEGWIT_V0_ADDR_PREFIX,
  SEGWIT_V1,
  SEGWIT_V1_ADDR_PREFIX,
  SegwitPrefix,
  StackingErrors,
} from './constants';

export class InvalidAddressError extends Error {
  innerError?: Error;
  constructor(address: string, innerError?: Error) {
    const msg = `'${address}' is not a valid P2PKH/P2SH/P2WPKH/P2WSH/P2TR address`;
    super(msg);
    this.message = msg;
    this.name = this.constructor.name;
    this.innerError = innerError;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/** @ignore */
export function btcAddressVersionToLegacyHashMode(btcAddressVersion: number): PoXAddressVersion {
  switch (btcAddressVersion) {
    case BitcoinNetworkVersion.mainnet.P2PKH:
      return PoXAddressVersion.P2PKH;
    case BitcoinNetworkVersion.testnet.P2PKH:
      return PoXAddressVersion.P2PKH;
    case BitcoinNetworkVersion.mainnet.P2SH:
      return PoXAddressVersion.P2SH;
    case BitcoinNetworkVersion.testnet.P2SH:
      return PoXAddressVersion.P2SH;
    default:
      throw new Error('Invalid pox address version');
  }
}

/** @ignore */
function nativeAddressToSegwitVersion(
  witnessVersion: number,
  dataLength: number
): PoXAddressVersion {
  if (witnessVersion === SEGWIT_V0 && dataLength === 20) return PoXAddressVersion.P2WPKH;
  if (witnessVersion === SEGWIT_V0 && dataLength === 32) return PoXAddressVersion.P2WSH;
  if (witnessVersion === SEGWIT_V1 && dataLength === 32) return PoXAddressVersion.P2TR;

  throw new Error(
    'Invalid native segwit witness version and byte length. Currently, only P2WPKH, P2WSH, and P2TR are supported.'
  );
}

/** @ignore */
function bech32Decode(btcAddress: string) {
  const { words: bech32Words } = bech32.decode(btcAddress);
  const witnessVersion = bech32Words[0];

  if (witnessVersion > 0)
    throw new Error('Addresses with a witness version >= 1 should be encoded in bech32m');

  return {
    witnessVersion,
    data: bech32.fromWords(bech32Words.slice(1)),
  };
}

/** @ignore */
function bech32MDecode(btcAddress: string) {
  const { words: bech32MWords } = bech32m.decode(btcAddress);
  const witnessVersion = bech32MWords[0];

  if (witnessVersion == 0)
    throw new Error('Addresses with witness version 1 should be encoded in bech32');

  return {
    witnessVersion,
    data: bech32m.fromWords(bech32MWords.slice(1)),
  };
}

/** @ignore */
function decodeNativeSegwitBtcAddress(btcAddress: string): {
  witnessVersion: number;
  data: Uint8Array;
} {
  if (SEGWIT_V0_ADDR_PREFIX.test(btcAddress)) return bech32Decode(btcAddress);
  if (SEGWIT_V1_ADDR_PREFIX.test(btcAddress)) return bech32MDecode(btcAddress);
  throw new Error(
    `Native segwit address ${btcAddress} does not match valid prefix ${SEGWIT_V0_ADDR_PREFIX} or ${SEGWIT_V1_ADDR_PREFIX}`
  );
}

export function decodeBtcAddress(btcAddress: string): {
  version: PoXAddressVersion;
  data: string;
} {
  const { version, data } = decodeBtcAddressBytes(btcAddress);
  return { version, data: bytesToHex(data) };
}

export function decodeBtcAddressBytes(btcAddress: string): {
  version: PoXAddressVersion;
  data: Uint8Array;
} {
  try {
    if (B58_ADDR_PREFIXES.test(btcAddress)) {
      const b58 = base58CheckDecode(btcAddress);
      const addressVersion = btcAddressVersionToLegacyHashMode(b58.version);
      return {
        version: addressVersion,
        data: b58.hash,
      };
    } else if (SEGWIT_ADDR_PREFIXES.test(btcAddress)) {
      const b32 = decodeNativeSegwitBtcAddress(btcAddress);
      const addressVersion = nativeAddressToSegwitVersion(b32.witnessVersion, b32.data.length);
      return {
        version: addressVersion,
        data: b32.data,
      };
    }
    throw new Error('Unknown BTC address prefix.');
  } catch (error) {
    throw new InvalidAddressError(btcAddress, error as Error);
  }
}

export function extractPoxAddressFromClarityValue(poxAddrClarityValue: ClarityValue): {
  version: number;
  hashBytes: Uint8Array;
} {
  const clarityValue = poxAddrClarityValue as TupleCV;
  if (clarityValue.type !== ClarityType.Tuple || !clarityValue.value) {
    throw new Error('Invalid argument, expected ClarityValue to be a TupleCV');
  }
  if (!('version' in clarityValue.value) || !('hashbytes' in clarityValue.value)) {
    throw new Error(
      'Invalid argument, expected Clarity tuple value to contain `version` and `hashbytes` keys'
    );
  }
  const versionCV = clarityValue.value['version'] as BufferCV;
  const hashBytesCV = clarityValue.value['hashbytes'] as BufferCV;
  if (versionCV.type !== ClarityType.Buffer || hashBytesCV.type !== ClarityType.Buffer) {
    throw new Error(
      'Invalid argument, expected Clarity tuple value to contain `version` and `hashbytes` buffers'
    );
  }
  return {
    version: hexToBytes(versionCV.value)[0],
    hashBytes: hexToBytes(hashBytesCV.value),
  };
}

export function getErrorString(error: StackingErrors): string {
  switch (error) {
    case StackingErrors.ERR_STACKING_UNREACHABLE:
      return 'Stacking unreachable';
    case StackingErrors.ERR_STACKING_CORRUPTED_STATE:
      return 'Stacking state is corrupted';
    case StackingErrors.ERR_STACKING_INSUFFICIENT_FUNDS:
      return 'Insufficient funds';
    case StackingErrors.ERR_STACKING_INVALID_LOCK_PERIOD:
      return 'Invalid lock period';
    case StackingErrors.ERR_STACKING_ALREADY_STACKED:
      return 'Account already stacked. Concurrent stacking not allowed.';
    case StackingErrors.ERR_STACKING_NO_SUCH_PRINCIPAL:
      return 'Principal does not exist';
    case StackingErrors.ERR_STACKING_EXPIRED:
      return 'Stacking expired';
    case StackingErrors.ERR_STACKING_STX_LOCKED:
      return 'STX balance is locked';
    case StackingErrors.ERR_STACKING_PERMISSION_DENIED:
      return 'Permission denied';
    case StackingErrors.ERR_STACKING_THRESHOLD_NOT_MET:
      return 'Stacking threshold not met';
    case StackingErrors.ERR_STACKING_POX_ADDRESS_IN_USE:
      return 'PoX address already in use';
    case StackingErrors.ERR_STACKING_INVALID_POX_ADDRESS:
      return 'Invalid PoX address';
    case StackingErrors.ERR_STACKING_ALREADY_REJECTED:
      return 'Stacking already rejected';
    case StackingErrors.ERR_STACKING_INVALID_AMOUNT:
      return 'Invalid amount';
    case StackingErrors.ERR_NOT_ALLOWED:
      return 'Stacking not allowed';
    case StackingErrors.ERR_STACKING_ALREADY_DELEGATED:
      return 'Already delegated';
    case StackingErrors.ERR_DELEGATION_EXPIRES_DURING_LOCK:
      return 'Delegation expires during lock period';
    case StackingErrors.ERR_DELEGATION_TOO_MUCH_LOCKED:
      return 'Delegation too much locked';
    case StackingErrors.ERR_DELEGATION_POX_ADDR_REQUIRED:
      return 'PoX address required for delegation';
    case StackingErrors.ERR_INVALID_START_BURN_HEIGHT:
      return 'Invalid start burn height';
    case StackingErrors.ERR_NOT_CURRENT_STACKER: // not used in pox contract
      return 'ERR_NOT_CURRENT_STACKER';
    case StackingErrors.ERR_STACK_EXTEND_NOT_LOCKED:
      return 'Stacker must be currently locked';
    case StackingErrors.ERR_STACK_INCREASE_NOT_LOCKED:
      return 'Stacker must be currently locked';
    case StackingErrors.ERR_DELEGATION_NO_REWARD_SLOT:
      return 'Invalid reward-cycle and reward-cycle-index';
    case StackingErrors.ERR_DELEGATION_WRONG_REWARD_SLOT:
      return 'PoX address must match the one on record';
    case StackingErrors.ERR_STACKING_IS_DELEGATED:
      return 'Stacker must be directly stacking and not delegating';
    case StackingErrors.ERR_STACKING_NOT_DELEGATED:
      return 'Stacker must be delegating and not be directly stacking';
  }
}
/**
 * Converts a PoX address to a tuple (e.g. to be used in a Clarity contract call).
 *
 * @param poxAddress - The PoX bitcoin address to be converted.
 * @returns The converted PoX address as a tuple of version and hashbytes.
 */
export function poxAddressToTuple(poxAddress: string) {
  const { version, data } = decodeBtcAddressBytes(poxAddress);
  const versionBuff = bufferCV(bigIntToBytes(BigInt(version), 1));
  const hashBuff = bufferCV(data);
  return tupleCV({
    version: versionBuff,
    hashbytes: hashBuff,
  });
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
      // P2SHP2WPKH and P2SHP2WSH are treated as P2SH for the sender
      return BitcoinNetworkVersion[network].P2SH;
    default:
      throw new Error('Invalid pox address version');
  }
}

function _poxAddressToBtcAddress_Values(
  version: number,
  hash: string | Uint8Array,
  network: StacksNetworkName
): string {
  if (!StacksNetworks.includes(network)) throw new Error('Invalid network.');

  if (typeof hash === 'string') hash = hexToBytes(hash);

  switch (version) {
    case PoXAddressVersion.P2PKH:
    case PoXAddressVersion.P2SH:
    case PoXAddressVersion.P2SHP2WPKH:
    case PoXAddressVersion.P2SHP2WSH: {
      const btcAddrVersion = legacyHashModeToBtcAddressVersion(version, network);
      return base58CheckEncode(btcAddrVersion, hash);
    }
    case PoXAddressVersion.P2WPKH:
    case PoXAddressVersion.P2WSH: {
      const words = bech32.toWords(hash);
      return bech32.encode(SegwitPrefix[network], [SEGWIT_V0, ...words]);
    }
    case PoXAddressVersion.P2TR: {
      const words = bech32m.toWords(hash);
      return bech32m.encode(SegwitPrefix[network], [SEGWIT_V1, ...words]);
    }
  }
  throw new Error(`Unexpected address version: ${version}`);
}

function _poxAddressToBtcAddress_ClarityValue(
  poxAddrClarityValue: ClarityValue,
  network: StacksNetworkName
): string {
  const poxAddr = extractPoxAddressFromClarityValue(poxAddrClarityValue);
  return _poxAddressToBtcAddress_Values(poxAddr.version, poxAddr.hashBytes, network);
}

/**
 * Converts a PoX address to a Bitcoin address.
 *
 * @param version - The version of the PoX address (as a single number, not a Uint8array).
 * @param hash - The hash bytes of the PoX address.
 * @param network - The network the PoX address is on.
 * @returns The corresponding Bitcoin address.
 */
export function poxAddressToBtcAddress(
  version: number,
  hash: string | Uint8Array,
  network: StacksNetworkName // todo: allow NetworkParam in the future (minor)
): string;
/**
 * Converts a PoX address to a Bitcoin address.
 *
 * @param poxAddrClarityValue - The clarity tuple of the PoX address (version and hashbytes).
 * @param network - The network the PoX address is on.
 * @returns The corresponding Bitcoin address.
 */
export function poxAddressToBtcAddress(
  poxAddrClarityValue: ClarityValue,
  network: StacksNetworkName
): string;
export function poxAddressToBtcAddress(
  versionOrClarityValue: number | ClarityValue,
  hashOrNetwork: string | Uint8Array,
  network?: StacksNetworkName
): string {
  // todo: allow these helpers to take a bitcoin network instead of a stacks network, once we have a concept of bitcoin networks in the codebase
  if (typeof versionOrClarityValue === 'number')
    return _poxAddressToBtcAddress_Values(
      versionOrClarityValue,
      hashOrNetwork as string | Uint8Array,
      network!
    );
  return _poxAddressToBtcAddress_ClarityValue(
    versionOrClarityValue,
    hashOrNetwork as StacksNetworkName
  );
}

// todo: move unwrap to tx package and document
export function unwrap<T extends ClarityValue>(optional: OptionalCV<T>) {
  if (optional.type === ClarityType.OptionalSome) return optional.value;
  if (optional.type === ClarityType.OptionalNone) return undefined;
  throw new Error("Object is not an 'Optional'");
}

export function unwrapMap<T extends ClarityValue, U>(optional: OptionalCV<T>, map: (t: T) => U) {
  if (optional.type === ClarityType.OptionalSome) return map(optional.value);
  if (optional.type === ClarityType.OptionalNone) return undefined;
  throw new Error("Object is not an 'Optional'");
}

/** @internal */
export function ensurePox2Activated(operationInfo: PoxOperationInfo) {
  if (operationInfo.period === PoxOperationPeriod.Period1)
    throw new Error(
      `PoX-2 has not activated yet (currently in period ${operationInfo.period} of PoX-2 operation)`
    );
}

/**
 * @internal
 * Throws if the given PoX address is not a legacy address for PoX-1.
 */
export function ensureLegacyBtcAddressForPox1({
  contract,
  poxAddress,
}: {
  contract: string;
  poxAddress?: string;
}) {
  if (!poxAddress) return;
  if (contract.endsWith('.pox') && !B58_ADDR_PREFIXES.test(poxAddress)) {
    throw new Error('PoX-1 requires P2PKH/P2SH/P2SH-P2WPKH/P2SH-P2WSH bitcoin addresses');
  }
}

/**
 * @internal
 * Throws if signer args are given for <= PoX-3 or the signer args are missing otherwise.
 */
export function ensureSignerArgsReadiness({
  contract,
  signerKey,
  signerSignature,
  maxAmount,
  authId,
}: {
  contract: string;
  signerKey?: string;
  signerSignature?: string;
  maxAmount?: IntegerType;
  authId?: IntegerType;
}) {
  const hasMaxAmount = typeof maxAmount !== 'undefined';
  const hasAuthId = typeof authId !== 'undefined';
  if (/\.pox(-[2-3])?$/.test(contract)) {
    // .pox, .pox-2 or .pox-3
    if (signerKey || signerSignature || hasMaxAmount || hasAuthId) {
      throw new Error(
        'PoX-1, PoX-2 and PoX-3 do not accept a `signerKey`, `signerSignature`, `maxAmount` or `authId`'
      );
    }
  } else {
    // .pox-4 or later
    if (!signerKey || !hasMaxAmount || typeof authId === 'undefined') {
      throw new Error(
        'PoX-4 requires a `signerKey` (buff 33), `maxAmount` (uint), and `authId` (uint)'
      );
    }
  }
}

export enum Pox4SignatureTopic {
  StackStx = 'stack-stx',
  AggregateCommit = 'agg-commit',
  AggregateIncrease = 'agg-increase',
  StackExtend = 'stack-extend',
  StackIncrease = 'stack-increase',
}

export interface Pox4SignatureOptions {
  /** topic of the signature (i.e. which stacking operation the signature is used for) */
  topic: `${Pox4SignatureTopic}` | Pox4SignatureTopic;
  poxAddress: string;
  /** current reward cycle */
  rewardCycle: number;
  /** lock period (in cycles) */
  period: number;
  network: StacksNetworkName | StacksNetwork;
  /** Maximum amount of uSTX that can be locked during this function call */
  maxAmount: IntegerType;
  /** Random integer to prevent signature re-use */
  authId: IntegerType;
}

/**
 * Generate a signature (`signer-sig` in PoX-4 stacking operations).
 */
export function signPox4SignatureHash({
  topic,
  poxAddress,
  rewardCycle,
  period,
  network,
  privateKey,
  maxAmount,
  authId,
}: Pox4SignatureOptions & { privateKey: PrivateKey }) {
  return signStructuredData({
    ...pox4SignatureMessage({ topic, poxAddress, rewardCycle, period, network, maxAmount, authId }),
    privateKey,
  });
}

/**
 * Verify a signature (`signer-sig` in PoX-4 stacking operations) matches the given
 * public key (`signer-key`) and the structured data of the operation.
 */
export function verifyPox4SignatureHash({
  topic,
  poxAddress,
  rewardCycle,
  period,
  network,
  publicKey,
  signature,
  maxAmount,
  authId,
}: Pox4SignatureOptions & { publicKey: string; signature: string }) {
  return verifyMessageSignatureRsv({
    message: sha256(
      encodeStructuredDataBytes(
        pox4SignatureMessage({ topic, poxAddress, rewardCycle, period, network, maxAmount, authId })
      )
    ),
    publicKey,
    signature,
  });
}

/**
 * Helper method used to generate SIP018 `message` and `domain` in
 * {@link signPox4SignatureHash} and {@link verifyPox4SignatureHash}.
 */
export function pox4SignatureMessage({
  topic,
  poxAddress,
  rewardCycle,
  period: lockPeriod,
  network: networkOrName,
  maxAmount,
  authId,
}: Pox4SignatureOptions) {
  const network = networkFrom(networkOrName);
  const message = tupleCV({
    'pox-addr': poxAddressToTuple(poxAddress),
    'reward-cycle': uintCV(rewardCycle),
    topic: stringAsciiCV(topic),
    period: uintCV(lockPeriod),
    'max-amount': uintCV(maxAmount),
    'auth-id': uintCV(authId),
  });
  const domain = tupleCV({
    name: stringAsciiCV('pox-4-signer'),
    version: stringAsciiCV('1.0.0'),
    'chain-id': uintCV(network.chainId),
  });
  return { message, domain };
}
