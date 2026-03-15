import {
  IntegerType,
  bytesToTwosBigInt,
  hexToBytes,
  intToBigInt,
  isInstance,
} from '@stacks/common';
import { ClarityType } from '../constants';
import { IntCV, UIntCV } from '../types';

const MAX_U128 = BigInt('0xffffffffffffffffffffffffffffffff'); // (2 ** 128 - 1)
const MIN_U128 = BigInt(0);
const MAX_I128 = BigInt('0x7fffffffffffffffffffffffffffffff'); // (2 ** 127 - 1)
// no signed (negative) hex support in bigint constructor
const MIN_I128 = BigInt('-170141183460469231731687303715884105728'); // (-2 ** 127)

/**
 * Converts IntegerType in to IntCV clarity type
 *
 * @param {value} integer value to be converted to IntCV clarity type
 *
 * @returns {IntCV} returns instance of type IntCV
 *
 * @example
 * ```
 *  import { intCV } from '@stacks/transactions';
 *
 *  const value = intCV('100'); // parameter any of type: number | string | bigint | Uint8Array
 *  // { type: 'int', value: 100n }
 * ```
 *
 * @see
 * {@link https://github.com/hirosystems/stacks.js/blob/main/packages/transactions/tests/clarity.test.ts | clarity test cases for more examples}
 */
export const intCV = (value: IntegerType): IntCV => {
  // ensure compatibility with twos-complement encoded hex-strings
  if (typeof value === 'string' && value.toLowerCase().startsWith('0x')) {
    value = bytesToTwosBigInt(hexToBytes(value));
  }

  // ensure compatibility with twos-complement encoded byte arrays
  if (isInstance(value, Uint8Array)) value = bytesToTwosBigInt(value);

  const bigInt = intToBigInt(value);
  if (bigInt > MAX_I128) {
    throw new RangeError(`Cannot construct clarity integer from value greater than ${MAX_I128}`);
  } else if (bigInt < MIN_I128) {
    throw new RangeError(`Cannot construct clarity integer form value less than ${MIN_I128}`);
  }
  return { type: ClarityType.Int, value: bigInt };
};

/**
 * Converts IntegerType in to IntCV clarity type
 *
 * @param {value} integer value to be converted to UIntCV clarity type (Only unsigned integer is allowed otherwise throws exception)
 *
 * @returns {UIntCV} returns instance of type UIntCV
 *
 * @example
 * ```
 *  import { uintCV } from '@stacks/transactions';
 *
 *  const value = uintCV('100'); // parameter any of type: number | string | bigint | Uint8Array
 *  // { type: 'uint', value: 100n }
 * ```
 *
 * @see
 * {@link https://github.com/hirosystems/stacks.js/blob/main/packages/transactions/tests/clarity.test.ts | clarity test cases for more examples}
 */
export const uintCV = (value: IntegerType): UIntCV => {
  const bigInt = intToBigInt(value);
  if (bigInt < MIN_U128) {
    throw new RangeError('Cannot construct unsigned clarity integer from negative value');
  } else if (bigInt > MAX_U128) {
    throw new RangeError(`Cannot construct unsigned clarity integer greater than ${MAX_U128}`);
  }
  return { type: ClarityType.UInt, value: bigInt };
};
