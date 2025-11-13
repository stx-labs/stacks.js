import {
  asciiToBytes,
  bigIntToBytes,
  bytesToHex,
  concatArray,
  concatBytes,
  hexToBytes,
  toTwos,
  utf8ToBytes,
  writeUInt32BE,
} from '@stacks/common';
import {
  BooleanCV,
  BufferCV,
  ClarityValue,
  ContractPrincipalCV,
  IntCV,
  OptionalCV,
  ResponseCV,
  StandardPrincipalCV,
  UIntCV,
} from '.';
import { CLARITY_INT_BYTE_SIZE, CLARITY_INT_SIZE } from '../constants';
import { SerializationError } from '../errors';
import { parseContractId } from '../utils';
import {
  createAddress,
  createLPString,
  serializeAddressBytes,
  serializeLPStringBytes,
} from '../wire';
import { ClarityType, clarityTypeToByte } from './constants';
import { ListCV, StringAsciiCV, StringUtf8CV, TupleCV } from './types';

function bytesWithTypeID(typeId: ClarityType, bytes: Uint8Array): Uint8Array {
  return concatArray([clarityTypeToByte(typeId), bytes]);
}

function serializeBoolCV(value: BooleanCV): Uint8Array {
  return new Uint8Array([clarityTypeToByte(value.type)]);
}

function serializeOptionalCV(cv: OptionalCV): Uint8Array {
  if (cv.type === ClarityType.OptionalNone) {
    return new Uint8Array([clarityTypeToByte(cv.type)]);
  } else {
    return bytesWithTypeID(cv.type, serializeCVBytes(cv.value));
  }
}

function serializeBufferCV(cv: BufferCV): Uint8Array {
  const length = new Uint8Array(4);
  writeUInt32BE(length, Math.ceil(cv.value.length / 2), 0);
  return bytesWithTypeID(cv.type, concatBytes(length, hexToBytes(cv.value)));
}

function serializeIntCV(cv: IntCV): Uint8Array {
  const bytes = bigIntToBytes(
    toTwos(BigInt(cv.value), BigInt(CLARITY_INT_SIZE)),
    CLARITY_INT_BYTE_SIZE
  );
  return bytesWithTypeID(cv.type, bytes);
}

function serializeUIntCV(cv: UIntCV): Uint8Array {
  const bytes = bigIntToBytes(BigInt(cv.value), CLARITY_INT_BYTE_SIZE);
  return bytesWithTypeID(cv.type, bytes);
}

function serializeStandardPrincipalCV(cv: StandardPrincipalCV): Uint8Array {
  return bytesWithTypeID(cv.type, serializeAddressBytes(createAddress(cv.value)));
}

function serializeContractPrincipalCV(cv: ContractPrincipalCV): Uint8Array {
  const [address, name] = parseContractId(cv.value);
  return bytesWithTypeID(
    cv.type,
    concatBytes(
      serializeAddressBytes(createAddress(address)),
      serializeLPStringBytes(createLPString(name))
    )
  );
}

function serializeResponseCV(cv: ResponseCV) {
  return bytesWithTypeID(cv.type, serializeCVBytes(cv.value));
}

function serializeListCV(cv: ListCV) {
  const bytesArray = [];

  const length = new Uint8Array(4);
  writeUInt32BE(length, cv.value.length, 0);
  bytesArray.push(length);

  for (const value of cv.value) {
    const serializedValue = serializeCVBytes(value);
    bytesArray.push(serializedValue);
  }

  return bytesWithTypeID(cv.type, concatArray(bytesArray));
}

function serializeTupleCV(cv: TupleCV) {
  const bytesArray = [];

  const length = new Uint8Array(4);
  writeUInt32BE(length, Object.keys(cv.value).length, 0);
  bytesArray.push(length);

  const lexicographicOrder = Object.keys(cv.value).sort((a, b) => a.localeCompare(b));

  for (const key of lexicographicOrder) {
    const nameWithLength = createLPString(key);
    bytesArray.push(serializeLPStringBytes(nameWithLength));

    const serializedValue = serializeCVBytes(cv.value[key]);
    bytesArray.push(serializedValue);
  }

  return bytesWithTypeID(cv.type, concatArray(bytesArray));
}

function serializeStringCV(cv: StringAsciiCV | StringUtf8CV, encoding: 'ascii' | 'utf8') {
  const bytesArray = [];

  const str = encoding == 'ascii' ? asciiToBytes(cv.value) : utf8ToBytes(cv.value);
  const len = new Uint8Array(4);
  writeUInt32BE(len, str.length, 0);

  bytesArray.push(len);
  bytesArray.push(str);

  return bytesWithTypeID(cv.type, concatArray(bytesArray));
}

function serializeStringAsciiCV(cv: StringAsciiCV) {
  return serializeStringCV(cv, 'ascii');
}

function serializeStringUtf8CV(cv: StringUtf8CV) {
  return serializeStringCV(cv, 'utf8');
}

/**
 * Serializes clarity value to hex
 * @example
 * ```
 *  import { intCV, serializeCV } from '@stacks/transactions';
 *
 *  const serialized = serializeCV(intCV(100)); // Similarly works for other clarity types as well like listCV, booleanCV ...
 *  // '0000000000000000000000000000000064'
 * ```
 *
 * @see
 * {@link https://github.com/stx-labs/stacks.js/blob/main/packages/transactions/tests/clarity.test.ts | clarity test cases for more examples}
 */
export function serializeCV(value: ClarityValue): string {
  return bytesToHex(serializeCVBytes(value));
}

/** @ignore */
export function serializeCVBytes(value: ClarityValue): Uint8Array {
  switch (value.type) {
    case ClarityType.BoolTrue:
    case ClarityType.BoolFalse:
      return serializeBoolCV(value);
    case ClarityType.OptionalNone:
    case ClarityType.OptionalSome:
      return serializeOptionalCV(value);
    case ClarityType.Buffer:
      return serializeBufferCV(value);
    case ClarityType.UInt:
      return serializeUIntCV(value);
    case ClarityType.Int:
      return serializeIntCV(value);
    case ClarityType.PrincipalStandard:
      return serializeStandardPrincipalCV(value);
    case ClarityType.PrincipalContract:
      return serializeContractPrincipalCV(value);
    case ClarityType.ResponseOk:
    case ClarityType.ResponseErr:
      return serializeResponseCV(value);
    case ClarityType.List:
      return serializeListCV(value);
    case ClarityType.Tuple:
      return serializeTupleCV(value);
    case ClarityType.StringASCII:
      return serializeStringAsciiCV(value);
    case ClarityType.StringUTF8:
      return serializeStringUtf8CV(value);
    default:
      throw new SerializationError('Unable to serialize. Invalid Clarity Value.');
  }
}
