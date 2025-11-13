import { bytesToAscii, bytesToTwosBigInt, bytesToUtf8, hexToBytes } from '@stacks/common';
import {
  ClarityValue,
  ClarityWireType,
  bufferCV,
  contractPrincipalCVFromAddress,
  falseCV,
  intCV,
  listCV,
  noneCV,
  responseErrorCV,
  responseOkCV,
  someCV,
  standardPrincipalCVFromAddress,
  stringAsciiCV,
  stringUtf8CV,
  trueCV,
  tupleCV,
  uintCV,
} from '.';
import { BytesReader } from '../BytesReader';
import { DeserializationError } from '../errors';
import { deserializeAddress, deserializeLPString } from '../wire';

/**
 * Deserializes clarity value to clarity type
 * @example
 * ```
 *  import { intCV, serializeCV, deserializeCV } from '@stacks/transactions';
 *
 *  const serialized = serializeCV(intCV(100)); // Similarly works for other clarity types as well like listCV, booleanCV ...
 *
 *  // <Uint8Array 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 64>
 *
 *  const deserialized = deserializeCV(serialized);
 *  // { type: 0, value: 100n }
 * ```
 *
 * @see
 * {@link https://github.com/stx-labs/stacks.js/blob/main/packages/transactions/tests/clarity.test.ts | clarity test cases for more examples}
 */
export function deserializeCV<T extends ClarityValue = ClarityValue>(
  serializedClarityValue: BytesReader | Uint8Array | string
): T {
  let bytesReader: BytesReader;
  if (typeof serializedClarityValue === 'string') {
    const hasHexPrefix = serializedClarityValue.slice(0, 2).toLowerCase() === '0x';
    bytesReader = new BytesReader(
      hexToBytes(hasHexPrefix ? serializedClarityValue.slice(2) : serializedClarityValue)
    );
  } else if (serializedClarityValue instanceof Uint8Array) {
    bytesReader = new BytesReader(serializedClarityValue);
  } else {
    bytesReader = serializedClarityValue;
  }
  const type = bytesReader.readUInt8Enum(ClarityWireType, n => {
    throw new DeserializationError(`Cannot recognize Clarity Type: ${n}`);
  });

  switch (type) {
    case ClarityWireType.int:
      return intCV(bytesToTwosBigInt(bytesReader.readBytes(16))) as T;

    case ClarityWireType.uint:
      return uintCV(bytesReader.readBytes(16)) as T;

    case ClarityWireType.buffer:
      const bufferLength = bytesReader.readUInt32BE();
      return bufferCV(bytesReader.readBytes(bufferLength)) as T;

    case ClarityWireType.true:
      return trueCV() as T;

    case ClarityWireType.false:
      return falseCV() as T;

    case ClarityWireType.address:
      const sAddress = deserializeAddress(bytesReader);
      return standardPrincipalCVFromAddress(sAddress) as T;

    case ClarityWireType.contract:
      const cAddress = deserializeAddress(bytesReader);
      const contractName = deserializeLPString(bytesReader);
      return contractPrincipalCVFromAddress(cAddress, contractName) as T;

    case ClarityWireType.ok:
      return responseOkCV(deserializeCV(bytesReader)) as T;

    case ClarityWireType.err:
      return responseErrorCV(deserializeCV(bytesReader)) as T;

    case ClarityWireType.none:
      return noneCV() as T;

    case ClarityWireType.some:
      return someCV(deserializeCV(bytesReader)) as T;

    case ClarityWireType.list:
      const listLength = bytesReader.readUInt32BE();
      const listContents: ClarityValue[] = [];
      for (let i = 0; i < listLength; i++) {
        listContents.push(deserializeCV(bytesReader));
      }
      return listCV(listContents) as T;

    case ClarityWireType.tuple:
      const tupleLength = bytesReader.readUInt32BE();
      const tupleContents: { [key: string]: ClarityValue } = {};
      for (let i = 0; i < tupleLength; i++) {
        const clarityName = deserializeLPString(bytesReader).content;
        if (clarityName === undefined) {
          throw new DeserializationError('"content" is undefined');
        }
        tupleContents[clarityName] = deserializeCV(bytesReader);
      }
      return tupleCV(tupleContents) as T;

    case ClarityWireType.ascii:
      const asciiStrLen = bytesReader.readUInt32BE();
      const asciiStr = bytesToAscii(bytesReader.readBytes(asciiStrLen));
      return stringAsciiCV(asciiStr) as T;

    case ClarityWireType.utf8:
      const utf8StrLen = bytesReader.readUInt32BE();
      const utf8Str = bytesToUtf8(bytesReader.readBytes(utf8StrLen));
      return stringUtf8CV(utf8Str) as T;

    default:
      throw new DeserializationError(
        'Unable to deserialize Clarity Value from Uint8Array. Could not find valid Clarity Type.'
      );
  }
}
