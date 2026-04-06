import { Logger } from './logger';

/**
 *  @ignore
 * @deprecated
 */
export const BLOCKSTACK_HANDLER = 'blockstack';
// todo: `next` get rid of all this blockstack stuff

/**
 * Time
 * @private
 * @ignore
 * @deprecated
 */
export function nextYear() {
  return new Date(new Date().setFullYear(new Date().getFullYear() + 1));
}

/**
 * Time
 * @private
 * @ignore
 * @deprecated
 */
export function nextMonth() {
  return new Date(new Date().setMonth(new Date().getMonth() + 1));
}

/**
 * Time
 * @private
 * @ignore
 * @deprecated
 */
export function nextHour() {
  return new Date(new Date().setHours(new Date().getHours() + 1));
}

/**
 * Converts megabytes to bytes. Returns 0 if the input is not a finite number.
 * @ignore
 * @deprecated
 */
export function megabytesToBytes(megabytes: number): number {
  if (!Number.isFinite(megabytes)) {
    return 0;
  }
  return Math.floor(megabytes * 1024 * 1024);
}

/**
 * Calculate the AES-CBC ciphertext output byte length a given input length.
 * AES has a fixed block size of 16-bytes regardless key size.
 * @ignore
 * @deprecated
 */
export function getAesCbcOutputLength(inputByteLength: number) {
  // AES-CBC block mode rounds up to the next block size.
  const cipherTextLength = (Math.floor(inputByteLength / 16) + 1) * 16;
  return cipherTextLength;
}

/**
 * Calculate the base64 encoded string length for a given input length.
 * This is equivalent to the byte length when the string is ASCII or UTF8-8
 * encoded.
 * @param number
 * @deprecated
 */
export function getBase64OutputLength(inputByteLength: number) {
  const encodedLength = Math.ceil(inputByteLength / 3) * 4;
  return encodedLength;
}

/**
 * Query Strings
 * @private
 * @ignore
 * @deprecated
 */
export function updateQueryStringParameter(uri: string, key: string, value: string) {
  const re = new RegExp(`([?&])${key}=.*?(&|$)`, 'i');
  const separator = uri.indexOf('?') !== -1 ? '&' : '?';
  if (uri.match(re)) {
    return uri.replace(re, `$1${key}=${value}$2`);
  } else {
    return `${uri}${separator}${key}=${value}`;
  }
}

/**
 * Versioning
 * @param {string} v1 - the left half of the version inequality
 * @param {string} v2 - right half of the version inequality
 * @returns {bool} iff v1 >= v2
 * @private
 * @ignore
 * @deprecated
 */
export function isLaterVersion(v1: string, v2: string) {
  if (v1 === undefined || v1 === '') {
    v1 = '0.0.0';
  }

  if (v2 === undefined || v1 === '') {
    v2 = '0.0.0';
  }

  const v1tuple = v1.split('.').map(x => parseInt(x, 10));
  const v2tuple = v2.split('.').map(x => parseInt(x, 10));

  for (let index = 0; index < v2.length; index++) {
    if (index >= v1.length) {
      v2tuple.push(0);
    }
    if (v1tuple[index] < v2tuple[index]) {
      return false;
    }
  }
  return true;
}

/**
 * UUIDs
 * @private
 * @ignore
 * @deprecated
 */
export function makeUUID4() {
  let d = new Date().getTime();
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    d += performance.now(); // use high-precision timer if available
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = ((d + Math.random() * 16) % 16) | 0;
    d = Math.floor(d / 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Checks if both urls pass the same origin check & are absolute
 * @param  {[type]}  uri1 first uri to check
 * @param  {[type]}  uri2 second uri to check
 * @return {Boolean} true if they pass the same origin check
 * @private
 * @ignore
 * @deprecated
 */
export function isSameOriginAbsoluteUrl(uri1: string, uri2: string) {
  try {
    const parsedUri1 = new URL(uri1);
    const parsedUri2 = new URL(uri2);

    const port1 =
      parseInt(parsedUri1.port || '0', 10) | 0 || (parsedUri1.protocol === 'https:' ? 443 : 80);
    const port2 =
      parseInt(parsedUri2.port || '0', 10) | 0 || (parsedUri2.protocol === 'https:' ? 443 : 80);

    const match = {
      scheme: parsedUri1.protocol === parsedUri2.protocol,
      hostname: parsedUri1.hostname === parsedUri2.hostname,
      port: port1 === port2,
      absolute:
        (uri1.includes('http://') || uri1.includes('https://')) &&
        (uri2.includes('http://') || uri2.includes('https://')),
    };

    return match.scheme && match.hostname && match.port && match.absolute;
  } catch (error) {
    console.log(error);
    console.log('Parsing error in same URL origin check');
    // Parse error
    return false;
  }
}

/**
 * Returns the global scope `Window`, `WorkerGlobalScope`, or `NodeJS.Global` if available in the
 * currently executing environment.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Window/self
 * @see https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/self
 * @see https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope
 *
 * This could be switched to `globalThis` once it is standardized and widely available.
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/globalThis
 * @ignore
 */
export function getGlobalScope(): Window {
  if (typeof self !== 'undefined') {
    return self;
  }
  if (typeof window !== 'undefined') {
    return window;
  }
  // This function is meant to be called when accessing APIs that are typically only available in
  // web-browser/DOM environments, but we also want to support situations where running in Node.js
  // environment, and a polyfill was added to the Node.js `global` object scope without adding the
  // `window` global object as well.
  if (typeof global !== 'undefined') {
    return global as unknown as Window;
  }
  throw new Error(
    'Unexpected runtime environment - no supported global scope (`window`, `self`, `global`) available'
  );
}

/** @deprecated */
function getAPIUsageErrorMessage(
  scopeObject: unknown,
  apiName: string,
  usageDesc?: string
): string {
  if (usageDesc) {
    return `Use of '${usageDesc}' requires \`${apiName}\` which is unavailable on the '${scopeObject}' object within the currently executing environment.`;
  } else {
    return `\`${apiName}\` is unavailable on the '${scopeObject}' object within the currently executing environment.`;
  }
}

interface GetGlobalObjectOptions {
  /**
   * Throw an error if the object is not found.
   * @default false
   */
  throwIfUnavailable?: boolean;
  /**
   * Additional information to include in an error if thrown.
   */
  usageDesc?: string;
  /**
   * If the object is not found, return an new empty object instead of undefined.
   * Requires [[throwIfUnavailable]] to be falsey.
   * @default false
   */
  returnEmptyObject?: boolean;
}

/**
 * Returns an object from the global scope (`Window` or `WorkerGlobalScope`) if it
 * is available within the currently executing environment.
 * When executing within the Node.js runtime these APIs are unavailable and will be
 * `undefined` unless the API is provided via polyfill.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Window/self
 * @ignore
 */
export function getGlobalObject<K extends Extract<keyof Window, string>>(
  name: K,
  { throwIfUnavailable, usageDesc, returnEmptyObject }: GetGlobalObjectOptions = {}
): Window[K] | undefined {
  let globalScope: Window | undefined = undefined;
  try {
    globalScope = getGlobalScope();
    if (globalScope) {
      const obj = globalScope[name];
      if (obj) {
        return obj;
      }
    }
  } catch (error) {
    Logger.error(`Error getting object '${name}' from global scope '${globalScope}': ${error}`);
  }
  if (throwIfUnavailable) {
    const errMsg = getAPIUsageErrorMessage(globalScope, name.toString(), usageDesc);
    Logger.error(errMsg);
    throw new Error(errMsg);
  }
  if (returnEmptyObject) {
    return {} as any;
  }
  return undefined;
}

/**
 * Returns a specified subset of objects from the global scope (`Window` or `WorkerGlobalScope`)
 * if they are available within the currently executing environment.
 * When executing within the Node.js runtime these APIs are unavailable will be `undefined`
 * unless the API is provided via polyfill.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Window/self
 * @ignore
 */
export function getGlobalObjects<K extends Extract<keyof Window, string>>(
  names: K[],
  { throwIfUnavailable, usageDesc, returnEmptyObject }: GetGlobalObjectOptions = {}
): Pick<Window, K> {
  let globalScope: Window | undefined;
  try {
    globalScope = getGlobalScope();
  } catch (error) {
    Logger.error(`Error getting global scope: ${error}`);
    if (throwIfUnavailable) {
      const errMsg = getAPIUsageErrorMessage(globalScope, names[0].toString(), usageDesc);
      Logger.error(errMsg);
      throw errMsg;
    } else if (returnEmptyObject) {
      globalScope = {} as any;
    }
  }

  const result: Pick<Window, K> = {} as any;
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    try {
      if (globalScope) {
        const obj = globalScope[name];
        if (obj) {
          result[name] = obj;
        } else if (throwIfUnavailable) {
          const errMsg = getAPIUsageErrorMessage(globalScope, name.toString(), usageDesc);
          Logger.error(errMsg);
          throw new Error(errMsg);
        } else if (returnEmptyObject) {
          result[name] = {} as any;
        }
      }
    } catch (error) {
      if (throwIfUnavailable) {
        const errMsg = getAPIUsageErrorMessage(globalScope, name.toString(), usageDesc);
        Logger.error(errMsg);
        throw new Error(errMsg);
      }
    }
  }
  return result;
}

/** Different Integer representations */
export type IntegerType = number | string | bigint | Uint8Array;

/**
 * Converts an integer-compatible value to a Uint8Array (given a byte length)
 * @example
 * ```ts
 * import { intToBytes } from "@stacks/common";
 * console.log(intToBytes(560, 4));
 * // Uint8Array(4) [ 0, 0, 2, 48 ]
 * ```
 */
export function intToBytes(value: IntegerType, byteLength: number): Uint8Array {
  return bigIntToBytes(intToBigInt(value), byteLength);
}

/**
 * Converts an integer-compatible value to a bigint
 * @param value - The value to convert to a bigint
 * @returns The bigint representation of the value
 *
 * @example
 * ```ts
 * intToBigInt(123); // 123n
 * intToBigInt('0xbeef'); // 48879n
 * ```
 */
export function intToBigInt(value: IntegerType): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string') return BigInt(value);
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new RangeError(`Invalid value. Values of type 'number' must be an integer.`);
    }
    if (value > Number.MAX_SAFE_INTEGER) {
      throw new RangeError(
        `Invalid value. Values of type 'number' must be less than or equal to ${Number.MAX_SAFE_INTEGER}. For larger values, try using a BigInt instead.`
      );
    }
    return BigInt(value);
  }

  if (isInstance(value, Uint8Array)) return BigInt(`0x${bytesToHex(value)}`);

  throw new TypeError(
    `intToBigInt: Invalid value type. Must be a number, bigint, BigInt-compatible string, or Uint8Array.`
  );
}

/**
 * Adds a `0x` prefix to a string if it does not already have one.
 */
export function with0x(value: string): string {
  return /^0x/i.test(value) // startsWith('0x') case insensitive
    ? value
    : `0x${value}`;
}

/**
 * Removes the `0x` prefix of a string if it has one.
 */
export function without0x(value: string): string {
  return /^0x/i.test(value) // startsWith('0x') case insensitive
    ? value.slice(2)
    : value;
}

/**
 * Converts hex input string to bigint
 * @param hex - hex input string without 0x prefix and in big endian format
 * @example "6c7cde4d702830c1db34ef7c19e2776f59107afef39084776fc88bc78dbb9656"
 * @ignore
 */
export function hexToBigInt(hex: string): bigint {
  if (typeof hex !== 'string')
    throw new TypeError(`hexToBigInt: expected string, got ${typeof hex}`);
  // Big Endian
  return BigInt(`0x${hex}`);
}

/**
 * Converts IntegerType to hex string
 */
export function intToHex(integer: IntegerType, byteLength = 8): string {
  const value = typeof integer === 'bigint' ? integer : intToBigInt(integer);
  return value.toString(16).padStart(byteLength * 2, '0');
}

/**
 * Converts hex string to integer
 */
export function hexToInt(hex: string): number {
  return parseInt(hex, 16);
}

/**
 * Converts bigint to byte array
 * @param value bigint value to be converted
 * @param length byte array optional length
 * @return {Uint8Array} byte array
 */
export function bigIntToBytes(value: bigint, length: number = 16): Uint8Array {
  const hex = intToHex(value, length);
  return hexToBytes(hex);
}

/**
 * Converts from signed number to two's complement
 * MIN_VALUE = -(1 << (width - 1))
 * MAX_VALUE =  (1 << (width - 1)) - 1
 * @ignore
 */
export function toTwos(value: bigint, width: bigint): bigint {
  if (
    value < -(BigInt(1) << (width - BigInt(1))) ||
    (BigInt(1) << (width - BigInt(1))) - BigInt(1) < value
  ) {
    throw `Unable to represent integer in width: ${width}`;
  }
  if (value >= BigInt(0)) {
    return BigInt(value);
  }
  return value + (BigInt(1) << width);
}

/**
 * Returns nth bit (right-to-left, zero-indexed)
 */
function nthBit(value: bigint, n: bigint) {
  return value & (BigInt(1) << n);
}

/** @ignore */
export function bytesToTwosBigInt(bytes: Uint8Array): bigint {
  return fromTwos(BigInt(`0x${bytesToHex(bytes)}`), BigInt(bytes.byteLength * 8));
}

/**
 * Converts from two's complement to signed number
 * @internal
 */
export function fromTwos(value: bigint, width: bigint) {
  if (nthBit(value, width - BigInt(1))) {
    return value - (BigInt(1) << width);
  }
  return value;
}

// The following methods are based on `@noble/hashes` implementation
// https://github.com/paulmillr/noble-hashes
// Copyright (c) 2022 Paul Miller (https://paulmillr.com)
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the “Software”), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
const hexes = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/**
 * Converts bytes to the equivalent hex string
 * @example
 * ```
 * bytesToHex(Uint8Array.from([0xde, 0xad, 0xbe, 0xef])) // 'deadbeef'
 * ```
 */
export function bytesToHex(uint8a: Uint8Array): string {
  // pre-caching improves the speed 6x
  if (!(uint8a instanceof Uint8Array)) throw new Error('Uint8Array expected');
  let hex = '';
  for (const u of uint8a) {
    hex += hexes[u];
  }
  return hex;
}

/**
 * Converts a hex string to the equivalent bytes
 * @example
 * ```
 * hexToBytes('deadbeef') // Uint8Array(4) [ 222, 173, 190, 239 ]
 * hexToBytes('0xdeadbeef') // Uint8Array(4) [ 222, 173, 190, 239 ]
 * ```
 */
export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string') {
    throw new TypeError(`hexToBytes: expected string, got ${typeof hex}`);
  }

  hex = without0x(hex);
  hex = hex.length % 2 ? `0${hex}` : hex; // left pad with a zero if odd length

  const array = new Uint8Array(hex.length / 2);
  for (let i = 0; i < array.length; i++) {
    const j = i * 2;
    const hexByte = hex.slice(j, j + 2);
    const byte = Number.parseInt(hexByte, 16);
    if (Number.isNaN(byte) || byte < 0) throw new Error('Invalid byte sequence');
    array[i] = byte;
  }
  return array;
}

declare const TextEncoder: any;
declare const TextDecoder: any;

/**
 * Converts a UTF-8 string to the equivalent bytes
 * @example
 * ```
 * utf8ToBytes('stacks Ӿ'); // Uint8Array(9) [ 115, 116, 97, 99, 107, 115, 32, 211, 190 ];
 * ```
 */
export function utf8ToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Converts bytes to the equivalent UTF-8 string
 * @example
 * ```
 * bytesToUtf8(Uint8Array.from([115, 116, 97, 99, 107, 115, 32, 211, 190])); // 'stacks Ӿ'
 * ```
 */
export function bytesToUtf8(arr: Uint8Array): string {
  return new TextDecoder().decode(arr);
}

/**
 * Converts an ASCII string to the equivalent bytes
 * @example
 * ```
 * asciiToBytes('stacks $'); // Uint8Array(8) [ 115, 116, 97, 99, 107, 115, 32, 36 ]
 * ```
 */
export function asciiToBytes(str: string) {
  const byteArray = [];
  for (let i = 0; i < str.length; i++) {
    byteArray.push(str.charCodeAt(i) & 0xff); // ignore second bytes of UTF-16 character
  }
  return new Uint8Array(byteArray);
}

/**
 * Converts bytes to the equivalent ASCII string
 * @example
 * ```
 * bytesToAscii(Uint8Array.from([115, 116, 97, 99, 107, 115, 32, 36])); // 'stacks $'
 * ```
 */
export function bytesToAscii(arr: Uint8Array) {
  return String.fromCharCode.apply(null, arr as any as number[]);
}

function isNotOctet(octet: number) {
  return !Number.isInteger(octet) || octet < 0 || octet > 255;
}

/** @ignore */
export function octetsToBytes(numbers: number[]) {
  if (numbers.some(isNotOctet)) throw new Error('Some values are invalid bytes.');
  return new Uint8Array(numbers);
}

/**
 * Concats Uint8Array-s into one; like `Buffer.concat([buf1, buf2])`
 * @example concatBytes(buf1, buf2)
 * @ignore
 */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  if (!arrays.every(a => a instanceof Uint8Array)) throw new Error('Uint8Array list expected');
  if (arrays.length === 1) return arrays[0];
  const length = arrays.reduce((a, arr) => a + arr.length, 0);
  const result = new Uint8Array(length);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const arr = arrays[i];
    result.set(arr, pad);
    pad += arr.length;
  }
  return result;
}

/** @ignore */
export function concatArray(elements: (Uint8Array | number[] | number)[]) {
  return concatBytes(
    ...elements.map(e => {
      if (typeof e === 'number') return octetsToBytes([e]);
      if (e instanceof Array) return octetsToBytes(e);
      return e;
    })
  );
}

/**
 * Better `instanceof` check for types in different environments
 * @ignore
 */
export function isInstance<T>(object: any, clazz: { new (...args: any[]): T }): object is T {
  return object instanceof clazz || object?.constructor?.name?.toLowerCase() === clazz.name;
}

/**
 * Checks whether a string is a valid hex string, and has a length of 64 characters.
 */
export function validateHash256(hex: string): boolean {
  hex = without0x(hex);
  if (hex.length !== 64) return false;
  return /^[0-9a-fA-F]+$/.test(hex);
}
