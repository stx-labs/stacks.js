import { ClarityValue } from '../clarityValue';
import { ClarityType } from '../constants';
import { ListCV } from '../types';

/**
 * Create list of clarity types
 *
 * @param {ClarityValue[]} list of ClarityValues to be converted to ListCV clarity type
 *
 * @returns {ListCV<T>} instance of type ListCV<T> of the provided values
 *
 * @example
 * ```
 *  import { listCV, intCV } from '@stacks/transactions';
 *
 *  const list = listCV([intCV(1), intCV(2), intCV(3), intCV(-4)]);
 *  // { type: 'list', list: [ { type: 0, value: 1n }, { type: 0, value: 2n }, { type: 0, value: 3n }, { type: 0, value: -4n } ] }
 * ```
 *
 * @see
 * {@link https://github.com/stx-labs/stacks.js/blob/main/packages/transactions/tests/clarity.test.ts | clarity test cases for more examples}
 */
export function listCV<T extends ClarityValue = ClarityValue>(values: T[]): ListCV<T> {
  return { type: ClarityType.List, value: values };
}
