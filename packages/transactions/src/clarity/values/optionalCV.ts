import { ClarityValue } from '../clarityValue';
import { ClarityType } from '../constants';
import { NoneCV, OptionalCV } from '../types';

/**
 * Create a null clarity type
 **
 * @returns {NoneCV} returns instance of type NoneCV
 *
 * @example
 * ```
 *  import { noneCV } from '@stacks/transactions';
 *
 *  const value = noneCV();
 *  // { type: 'none' }
 * ```
 *
 * @see
 * {@link https://github.com/stx-labs/stacks.js/blob/main/packages/transactions/tests/clarity.test.ts | clarity test cases for more examples}
 */
export function noneCV(): NoneCV {
  return { type: ClarityType.OptionalNone };
}

/**
 * Converts any ClarityValue in to OptionalCV clarity type
 *
 * @param {ClarityValue} value to be converted to OptionalCV clarity type
 *
 * @returns {OptionalCV} returns instance of type OptionalCV
 *
 * @example
 * ```
 *  import { someCV, trueCV } from '@stacks/transactions';
 *
 *  const value = someCV(trueCV());
 *  // { type: 'some', value: { type: 'true' } }
 * ```
 *
 * @see
 * {@link https://github.com/stx-labs/stacks.js/blob/main/packages/transactions/tests/clarity.test.ts | clarity test cases for more examples}
 */
export function someCV<T extends ClarityValue = ClarityValue>(value: T): OptionalCV<T> {
  return { type: ClarityType.OptionalSome, value };
}

export function optionalCVOf<T extends ClarityValue = ClarityValue>(value?: T): OptionalCV<T> {
  return value ? someCV(value) : noneCV();
}
