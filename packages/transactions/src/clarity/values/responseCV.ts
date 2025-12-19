import { ClarityValue } from '../clarityValue';
import { ClarityType } from '../constants';
import { ResponseErrorCV, ResponseOkCV } from '../types';

/**
 * Converts ClarityValue to responseErrorCV
 *
 * @param {value} ClarityValue value to be converted to responseErrorCV clarity type
 *
 * @returns {responseErrorCV} returns instance of type responseErrorCV
 *
 * @example
 * ```
 *  import { responseErrorCV, intCV } from '@stacks/transactions';
 *
 *  const respErrorCV = responseErrorCV(intCV(1));
 *
 *  // { type: 'err', value: { type: 'int', value: 1n } }
 * ```
 *
 * @see
 * {@link https://github.com/hirosystems/stacks.js/blob/main/packages/transactions/tests/clarity.test.ts | clarity test cases for more examples}
 */
export function responseErrorCV<T extends ClarityValue = ClarityValue>(
  value: T
): ResponseErrorCV<T> {
  return { type: ClarityType.ResponseErr, value };
}

/**
 * Converts ClarityValue to ResponseOkCV
 *
 * @param {value} ClarityValue value to be converted to ResponseOkCV clarity type
 *
 * @returns {ResponseOkCV} returns instance of type ResponseOkCV
 *
 * @example
 * ```
 *  import { responseOkCV, intCV } from '@stacks/transactions';
 *
 *  const respOKCV = responseOkCV(intCV(1));
 *
 *  // { type: 'ok', value: { type: 'int', value: 1n } }
 * ```
 *
 * @see
 * {@link https://github.com/hirosystems/stacks.js/blob/main/packages/transactions/tests/clarity.test.ts | clarity test cases for more examples}
 */
export function responseOkCV<T extends ClarityValue = ClarityValue>(value: T): ResponseOkCV<T> {
  return { type: ClarityType.ResponseOk, value };
}
