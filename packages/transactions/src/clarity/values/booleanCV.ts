import { ClarityType } from '../constants';
import { BooleanCV } from '../types';

/**
 * Converts true to BooleanCV clarity type
 *
 * @returns {BooleanCV} returns instance of type BooleanCV
 *
 * @example
 * ```
 *  import { trueCV } from '@stacks/transactions';
 *
 *  const trueCV = trueCV();
 *  // { type: 'true' }
 * ```
 *
 * @see
 * {@link https://github.com/stx-labs/stacks.js/blob/main/packages/transactions/tests/clarity.test.ts | clarity test cases for more examples}
 */
export const trueCV = (): BooleanCV => ({ type: ClarityType.BoolTrue });

/**
 * Converts false to BooleanCV clarity type
 *
 * @returns {BooleanCV} returns instance of type BooleanCV
 *
 * @example
 * ```
 *  import { falseCV } from '@stacks/transactions';
 *
 *  const falseCV = falseCV();
 *  // { type: 'false' }
 * ```
 *
 * @see
 * {@link https://github.com/stx-labs/stacks.js/blob/main/packages/transactions/tests/clarity.test.ts | clarity test cases for more examples}
 */
export const falseCV = (): BooleanCV => ({ type: ClarityType.BoolFalse });

/**
 * Converts a boolean to BooleanCV clarity type
 *
 * @returns {BooleanCV} returns instance of type BooleanCV
 *
 * @example
 * ```
 *  import { boolCV } from '@stacks/transactions';
 *
 *  const boolCV = boolCV(false);
 *  // { type: 'false' }
 * ```
 *
 * @see
 * {@link https://github.com/stx-labs/stacks.js/blob/main/packages/transactions/tests/clarity.test.ts | clarity test cases for more examples}
 */
export const boolCV = (bool: boolean) => (bool ? trueCV() : falseCV());
