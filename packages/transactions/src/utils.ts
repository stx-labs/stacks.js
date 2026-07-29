import { ripemd160 } from '@noble/hashes/ripemd160';
import { sha256 } from '@noble/hashes/sha256';
import { sha512_256 } from '@noble/hashes/sha512';
import { utils } from '@noble/secp256k1';
import { bytesToHex, concatArray, concatBytes, utf8ToBytes } from '@stacks/common';
import { c32addressDecode } from 'c32check';
import lodashCloneDeep from 'lodash.clonedeep';
import { ClarityValue, deserializeCV, serializeCV } from './clarity';
import { ContractIdString } from './types';

// Export verify as utility method for signature verification
export { verify as verifySignature } from '@noble/secp256k1';

/**
 * Use utils.randomBytes to replace randombytes dependency
 * Generates random bytes of given length
 * @param {number} bytesLength an optional bytes length, default is 32 bytes
 */
export const randomBytes = (bytesLength?: number): Uint8Array => utils.randomBytes(bytesLength);

/**
 * Pads a hex string with a leading zero if its length is odd.
 * Ensures the hex string has an even number of characters for proper byte representation.
 * @param hexString - The hex string to pad
 * @returns The padded hex string with even length
 * @example
 * ```ts
 * leftPadHex('abc') // '0abc'
 * leftPadHex('abcd') // 'abcd'
 * ```
 */
export const leftPadHex = (hexString: string): string =>
  hexString.length % 2 ? `0${hexString}` : hexString;

/**
 * Left pads a hex string with zeros to reach the specified length.
 * If the string is already longer than the target length, it is returned unchanged.
 * @param hexString - The hex string to pad
 * @param length - The target length of the resulting string
 * @returns The padded hex string
 * @example
 * ```ts
 * leftPadHexToLength('ab', 4) // '00ab'
 * leftPadHexToLength('abcdef', 4) // 'abcdef' (unchanged)
 * ```
 */
export const leftPadHexToLength = (hexString: string, length: number): string =>
  hexString.padStart(length, '0');

/**
 * Right pads a hex string with zeros to reach the specified length.
 * If the string is already longer than the target length, it is returned unchanged.
 * @param hexString - The hex string to pad
 * @param length - The target length of the resulting string
 * @returns The padded hex string
 * @example
 * ```ts
 * rightPadHexToLength('ab', 4) // 'ab00'
 * rightPadHexToLength('abcdef', 4) // 'abcdef' (unchanged)
 * ```
 */
export const rightPadHexToLength = (hexString: string, length: number): string =>
  hexString.padEnd(length, '0');

/**
 * Checks if a string exceeds a maximum byte length when encoded as UTF-8.
 * Useful for validating memo fields and other length-limited string inputs.
 * @param string - The string to check
 * @param maxLengthBytes - The maximum allowed byte length
 * @returns true if the string exceeds the limit, false otherwise
 * @example
 * ```ts
 * exceedsMaxLengthBytes('hello', 10) // false
 * exceedsMaxLengthBytes('hello', 4) // true
 * exceedsMaxLengthBytes('😀', 3) // true (emoji = 4 bytes)
 * ```
 */
export const exceedsMaxLengthBytes = (string: string, maxLengthBytes: number): boolean =>
  string ? utf8ToBytes(string).length > maxLengthBytes : false;

/** @internal @deprecated */
export function cloneDeep<T>(obj: T): T {
  return lodashCloneDeep(obj);
}

// todo: remove this function and instead delete param without clone (if possible)?
export function omit<T, K extends keyof any>(obj: T, prop: K): Omit<T, K> {
  const clone = cloneDeep(obj);
  // @ts-expect-error
  delete clone[prop];
  return clone;
}

/**
 * Computes the HASH160 of the input, which is RIPEMD160(SHA256(input)).
 * This is the standard hash function used for Bitcoin/Stacks addresses.
 * @param input - The bytes to hash
 * @returns A 20-byte (160-bit) Uint8Array hash
 * @example
 * ```ts
 * const publicKey = hexToBytes('...');
 * const addressHash = hash160(publicKey);
 * ```
 */
export const hash160 = (input: Uint8Array): Uint8Array => {
  return ripemd160(sha256(input));
};

/** @deprecated renamed to {@link txidFromBytes} */
export const txidFromData = (data: Uint8Array): string => {
  return bytesToHex(sha512_256(data));
};

/**
 * Computes the transaction ID of the bytes from a serialized transaction (or any other bytes using the same hash function).
 */
export const txidFromBytes = txidFromData;

// Internally, the Stacks blockchain encodes address the same as Bitcoin
// single-sig address (p2pkh)
/** @internal */
export const hashP2PKH = (input: Uint8Array): string => {
  return bytesToHex(hash160(input));
};

// Internally, the Stacks blockchain encodes address the same as Bitcoin
// single-sig address over p2sh (p2h-p2wpkh)
/** @internal */
export const hashP2WPKH = (input: Uint8Array): string => {
  const keyHash = hash160(input);
  const redeemScript = concatBytes(new Uint8Array([0]), new Uint8Array([keyHash.length]), keyHash);
  const redeemScriptHash = hash160(redeemScript);
  return bytesToHex(redeemScriptHash);
};

// Internally, the Stacks blockchain encodes address the same as Bitcoin
// multi-sig address (p2sh)
/** @internal */
export const hashP2SH = (numSigs: number, pubKeys: Uint8Array[]): string => {
  if (numSigs > 15 || pubKeys.length > 15) {
    throw Error('P2SH multisig address can only contain up to 15 public keys');
  }

  // construct P2SH script
  const bytesArray = [];
  // OP_n
  bytesArray.push(80 + numSigs);
  // public keys prepended by their length
  pubKeys.forEach(pubKey => {
    bytesArray.push(pubKey.length);
    bytesArray.push(pubKey);
  });
  // OP_m
  bytesArray.push(80 + pubKeys.length);
  // OP_CHECKMULTISIG
  bytesArray.push(174);

  const redeemScript = concatArray(bytesArray);
  const redeemScriptHash = hash160(redeemScript);
  return bytesToHex(redeemScriptHash);
};

// Internally, the Stacks blockchain encodes address the same as Bitcoin
// multisig address over p2sh (p2sh-p2wsh)
/** @internal */
export const hashP2WSH = (numSigs: number, pubKeys: Uint8Array[]): string => {
  if (numSigs > 15 || pubKeys.length > 15) {
    throw Error('P2WSH multisig address can only contain up to 15 public keys');
  }

  // construct P2SH script
  const scriptArray = [];
  // OP_n
  scriptArray.push(80 + numSigs);
  // public keys prepended by their length
  pubKeys.forEach(pubKey => {
    scriptArray.push(pubKey.length);
    scriptArray.push(pubKey);
  });
  // OP_m
  scriptArray.push(80 + pubKeys.length);
  // OP_CHECKMULTISIG
  scriptArray.push(174);

  const script = concatArray(scriptArray);
  const digest = sha256(script);

  const bytesArray = [];
  bytesArray.push(0);
  bytesArray.push(digest.length);
  bytesArray.push(digest);

  const redeemScript = concatArray(bytesArray);
  const redeemScriptHash = hash160(redeemScript);
  return bytesToHex(redeemScriptHash);
};

/**
 * Validates whether a string is a valid Clarity identifier name.
 * Clarity names must start with a letter or be a single operator character,
 * can contain letters, numbers, and certain special characters, and must be
 * less than 128 characters in length.
 * @param name - The name to validate
 * @returns true if the name is a valid Clarity identifier, false otherwise
 * @example
 * ```ts
 * isClarityName('my-function') // true
 * isClarityName('get_value') // true
 * isClarityName('123invalid') // false (starts with number)
 * ```
 */
export function isClarityName(name: string) {
  const regex = /^[a-zA-Z]([a-zA-Z0-9]|[-_!?+<>=/*])*$|^[-+=/*]$|^[<>]=?$/;
  return regex.test(name) && name.length < 128;
}

/**
 * Converts a clarity value to a hex encoded string with `0x` prefix
 * @param {ClarityValue} cv  - the clarity value to convert
 */
export function cvToHex(cv: ClarityValue) {
  const serialized = serializeCV(cv);
  return `0x${serialized}`;
}

/**
 * Converts a hex encoded string to a clarity value
 * @param {string} hex - the hex encoded string with or without `0x` prefix
 */
export function hexToCV(hex: string) {
  return deserializeCV(hex);
}

/**
 * Read only function response object
 *
 * @param {Boolean} okay - the status of the response
 * @param {string} result - serialized hex clarity value
 */
export interface ReadOnlyFunctionSuccessResponse {
  okay: true;
  result: string;
}

export interface ReadOnlyFunctionErrorResponse {
  okay: false;
  cause: string;
}

export type ReadOnlyFunctionResponse =
  | ReadOnlyFunctionSuccessResponse
  | ReadOnlyFunctionErrorResponse;

/**
 * Converts the response of a read-only function call into its Clarity Value
 * @param param
 */
export const parseReadOnlyResponse = (response: ReadOnlyFunctionResponse): ClarityValue => {
  if (response.okay) return hexToCV(response.result);
  throw new Error(response.cause);
};

/**
 * Validates whether a string is a valid Stacks address.
 * Uses c32check to verify the address format and checksum.
 * @param address - The address string to validate
 * @returns true if the address is valid, false otherwise
 * @example
 * ```ts
 * validateStacksAddress('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM') // true
 * validateStacksAddress('invalid-address') // false
 * ```
 */
export const validateStacksAddress = (address: string): boolean => {
  try {
    c32addressDecode(address);
    return true;
  } catch (e) {
    return false;
  }
};

/** @ignore */
export function parseContractId(contractId: ContractIdString) {
  const [address, name] = contractId.split('.');
  if (!address || !name) throw new Error(`Invalid contract identifier: ${contractId}`);
  return [address, name];
}
