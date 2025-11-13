import { bytesToHex, utf8ToBytes } from '@stacks/common';
import { ClarityType } from '../constants';
import { BufferCV } from '../types';

/**
 * Converts a Uint8Array to a BufferCV clarity type
 *
 * @param {Uint8Array} buffer value to be converted to clarity type
 *
 * @returns {BufferCV} returns instance of type BufferCV
 *
 * @example
 * ```
 *  import { bufferCV } from '@stacks/transactions';
 *
 *  const buffer = utf8ToBytes('this is a test');
 *  const buf = bufferCV(buffer);
 *  // { type: 'buffer', buffer: <Uint8Array 74 68 69 73 20 69 73 20 61 20 74 65 73 74> }
 *  const value = bytesToUtf8(buf.buffer);
 *  // this is a test
 * ```
 *
 * @see
 * {@link https://github.com/stx-labs/stacks.js/blob/main/packages/transactions/tests/clarity.test.ts | clarity test cases for more examples}
 */
export const bufferCV = (buffer: Uint8Array): BufferCV => {
  // max size 1024 * 1024 = 1MB; https://github.com/stacks-network/stacks-core/blob/c50a93088d7c0261f1dbe31ab24b95028a038447/clarity/src/vm/types/mod.rs#L47
  if (buffer.byteLength > 1_048_576) {
    throw new Error('Cannot construct clarity buffer that is greater than 1MB');
  }

  return { type: ClarityType.Buffer, value: bytesToHex(buffer) };
};

/**
 * Converts a string to BufferCV clarity type
 *
 * @param {str} string input to be converted to bufferCV clarity type
 *
 * @returns {BufferCV} returns instance of type BufferCV
 *
 * @example
 * ```
 *  import { bufferCVFromString } from '@stacks/transactions';
 *
 *  const str = 'this is a test';
 *  const buf = bufferCVFromString(str);
 *  // { type: 'buffer', buffer: <Buffer 74 68 69 73 20 69 73 20 61 20 74 65 73 74> }
 *  const value = bytesToUtf8(buf.buffer);
 *  // this is a test
 *```
 *
 * @see
 * {@link https://github.com/stx-labs/stacks.js/blob/main/packages/transactions/tests/clarity.test.ts | clarity test cases for more examples}
 */
export const bufferCVFromString = (str: string): BufferCV => bufferCV(utf8ToBytes(str));
