import { ClarityValue } from '../clarityValue';
import { ClarityType } from '../constants';
import { isClarityName } from '../../utils';
import { TupleCV, TupleData } from '../types';

/**
 * Create tuple of clarity values
 *
 * @param {tupleData} tuple value to be converted to tuple of clarity types
 *
 * @returns {TupleCV} returns instance of type clarity tuple
 *
 * @example
 * ```
 *  import { tupleCV, trueCV, falseCV } from '@stacks/transactions';
 *
 *  const tuple = tupleCV({
 *    c: trueCV(),
 *    b: falseCV(),
 *    a: trueCV(),
 *  });
 *  // { type: 'tuple', data: { c: { type: 'true' }, b: { type: 'false' }, a: { type: 'true' } } }
 * ```
 *
 * @see
 * {@link https://github.com/stx-labs/stacks.js/blob/main/packages/transactions/tests/clarity.test.ts | clarity test cases for more examples}
 */
export function tupleCV<T extends ClarityValue = ClarityValue>(
  data: TupleData<T>
): TupleCV<TupleData<T>> {
  for (const key in data) {
    if (!isClarityName(key)) {
      throw new Error(`"${key}" is not a valid Clarity name`);
    }
  }

  return { type: ClarityType.Tuple, value: data };
}
