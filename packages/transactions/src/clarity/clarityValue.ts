import {
  BooleanCV,
  BufferCV,
  IntCV,
  UIntCV,
  StandardPrincipalCV,
  ContractPrincipalCV,
  ResponseErrorCV,
  ResponseOkCV,
  ListCV,
  TupleCV,
  StringAsciiCV,
  StringUtf8CV,
  NoneCV,
  SomeCV,
  TrueCV,
  FalseCV,
} from '.';
import { ClarityType } from './constants';
import { asciiToBytes, bytesToAscii, hexToBytes, utf8ToBytes } from '@stacks/common';

export type ClarityValue =
  | BooleanCV
  | BufferCV
  | IntCV
  | UIntCV
  | StandardPrincipalCV
  | ContractPrincipalCV
  | ResponseErrorCV
  | ResponseOkCV
  | NoneCV
  | SomeCV
  | ListCV
  | TupleCV
  | StringAsciiCV
  | StringUtf8CV;

export function cvToString(val: ClarityValue, encoding: 'tryAscii' | 'hex' = 'hex'): string {
  switch (val.type) {
    case ClarityType.BoolTrue:
      return 'true';
    case ClarityType.BoolFalse:
      return 'false';
    case ClarityType.Int:
      return val.value.toString();
    case ClarityType.UInt:
      return `u${val.value.toString()}`;
    case ClarityType.Buffer:
      if (encoding === 'tryAscii') {
        const str = bytesToAscii(hexToBytes(val.value));
        if (/[ -~]/.test(str)) {
          return JSON.stringify(str);
        }
      }
      return `0x${val.value}`;
    case ClarityType.OptionalNone:
      return 'none';
    case ClarityType.OptionalSome:
      return `(some ${cvToString(val.value, encoding)})`;
    case ClarityType.ResponseErr:
      return `(err ${cvToString(val.value, encoding)})`;
    case ClarityType.ResponseOk:
      return `(ok ${cvToString(val.value, encoding)})`;
    case ClarityType.PrincipalStandard:
    case ClarityType.PrincipalContract:
      return val.value;
    case ClarityType.List:
      return `(list ${val.value.map(v => cvToString(v, encoding)).join(' ')})`;
    case ClarityType.Tuple:
      return `(tuple ${Object.keys(val.value)
        .map(key => `(${key} ${cvToString(val.value[key], encoding)})`)
        .join(' ')})`;
    case ClarityType.StringASCII:
      return `"${val.value}"`;
    case ClarityType.StringUTF8:
      return `u"${val.value}"`;
  }
}

/**
 * @param strictJsonCompat If true then ints and uints are returned as JSON serializable numbers when
 * less than or equal to 53 bit length, otherwise string wrapped integers when larger than 53 bits.
 * If false, they are returned as js native `bigint`s which are _not_ JSON serializable.
 */
export function cvToValue(val: ClarityValue, strictJsonCompat: boolean = false): any {
  switch (val.type) {
    case ClarityType.BoolTrue:
      return true;
    case ClarityType.BoolFalse:
      return false;
    case ClarityType.Int:
    case ClarityType.UInt:
      if (strictJsonCompat) {
        return val.value.toString();
      }
      return val.value;
    case ClarityType.Buffer:
      return `0x${val.value}`;
    case ClarityType.OptionalNone:
      return null;
    case ClarityType.OptionalSome:
      return cvToJSON(val.value);
    case ClarityType.ResponseErr:
      return cvToJSON(val.value);
    case ClarityType.ResponseOk:
      return cvToJSON(val.value);
    case ClarityType.PrincipalStandard:
    case ClarityType.PrincipalContract:
      return val.value;
    case ClarityType.List:
      return val.value.map(v => cvToJSON(v));
    case ClarityType.Tuple:
      const result: { [key: string]: any } = {};
      Object.keys(val.value).forEach(key => {
        result[key] = cvToJSON(val.value[key]);
      });
      return result;
    case ClarityType.StringASCII:
      return val.value;
    case ClarityType.StringUTF8:
      return val.value;
  }
}

export function cvToJSON(val: ClarityValue): any {
  switch (val.type) {
    case ClarityType.ResponseErr:
      return { type: getCVTypeString(val), value: cvToValue(val, true), success: false };
    case ClarityType.ResponseOk:
      return { type: getCVTypeString(val), value: cvToValue(val, true), success: true };
    default:
      return { type: getCVTypeString(val), value: cvToValue(val, true) };
  }
}

export function getCVTypeString(val: ClarityValue): string {
  switch (val.type) {
    case ClarityType.BoolTrue:
    case ClarityType.BoolFalse:
      return 'bool';
    case ClarityType.Int:
      return 'int';
    case ClarityType.UInt:
      return 'uint';
    case ClarityType.Buffer:
      return `(buff ${Math.ceil(val.value.length / 2)})`;
    case ClarityType.OptionalNone:
      return '(optional none)';
    case ClarityType.OptionalSome:
      return `(optional ${getCVTypeString(val.value)})`;
    case ClarityType.ResponseErr:
      return `(response UnknownType ${getCVTypeString(val.value)})`;
    case ClarityType.ResponseOk:
      return `(response ${getCVTypeString(val.value)} UnknownType)`;
    case ClarityType.PrincipalStandard:
    case ClarityType.PrincipalContract:
      return 'principal';
    case ClarityType.List:
      return `(list ${val.value.length} ${
        val.value.length ? getCVTypeString(val.value[0]) : 'UnknownType'
      })`;
    case ClarityType.Tuple:
      return `(tuple ${Object.keys(val.value)
        .map(key => `(${key} ${getCVTypeString(val.value[key])})`)
        .join(' ')})`;
    case ClarityType.StringASCII:
      return `(string-ascii ${asciiToBytes(val.value).length})`;
    case ClarityType.StringUTF8:
      return `(string-utf8 ${utf8ToBytes(val.value).length})`;
  }
}

type ClarityTypetoValue = {
  [ClarityType.OptionalNone]: NoneCV;
  [ClarityType.OptionalSome]: SomeCV;
  [ClarityType.ResponseOk]: ResponseOkCV;
  [ClarityType.ResponseErr]: ResponseErrorCV;
  [ClarityType.BoolTrue]: TrueCV;
  [ClarityType.BoolFalse]: FalseCV;
  [ClarityType.Int]: IntCV;
  [ClarityType.UInt]: UIntCV;
  [ClarityType.StringASCII]: StringAsciiCV;
  [ClarityType.StringUTF8]: StringUtf8CV;
  [ClarityType.PrincipalStandard]: StandardPrincipalCV;
  [ClarityType.PrincipalContract]: ContractPrincipalCV;
  [ClarityType.List]: ListCV;
  [ClarityType.Tuple]: TupleCV;
  [ClarityType.Buffer]: BufferCV;
};

/**
 * Narrow down the type of a generic ClarityValue
 * @example
 * ```ts
 * // some functions can return a generic `ClarityValue` type
 * let value = fetchCallReadOnlyFunction();
 * //  ^ ClarityValue
 * // use `isClarityType` to narrow down the type
 * assert(isClarityType(value, ClarityType.Int))
 * console.log(value)
 * //          ^ IntCV
 * ```
 */
export function isClarityType<T extends ClarityType>(
  input: ClarityValue,
  withType: T
): input is ClarityTypetoValue[T] {
  return input.type === withType;
}
