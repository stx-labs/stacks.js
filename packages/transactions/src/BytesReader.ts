import { bytesToHex, hexToBytes, readUInt16BE, readUInt32BE, readUInt8 } from '@stacks/common';

function createEnumChecker<T extends string, TEnumValue extends number>(enumVariable: {
  [key in T]: TEnumValue;
}): (value: number) => value is TEnumValue {
  // Create a set of valid enum number values.
  const enumValues = Object.values<number>(enumVariable).filter(v => typeof v === 'number');
  const enumValueSet = new Set<number>(enumValues);
  return (value: number): value is TEnumValue => enumValueSet.has(value);
}

const enumCheckFunctions = new Map<object, (value: number) => boolean>();

/**
 * @ignore
 * Type guard to check if a given value is a valid enum value.
 * @param enumVariable - Literal `enum` type.
 * @param value - A value to check against the enum's values.
 * @example
 * ```ts
 * enum Color {
 *   Purple = 3,
 *   Orange = 5
 * }
 * const val: number = 3;
 * if (isEnum(Color, val)) {
 *   // `val` is known as enum type `Color`, e.g.:
 *   const colorVal: Color = val;
 * }
 * ```
 */
function isEnum<T extends string, TEnumValue extends number>(
  enumVariable: { [key in T]: TEnumValue },
  value: number
): value is TEnumValue {
  const checker = enumCheckFunctions.get(enumVariable);
  if (checker !== undefined) {
    return checker(value);
  }
  const newChecker = createEnumChecker(enumVariable);
  enumCheckFunctions.set(enumVariable, newChecker);
  return isEnum(enumVariable, value);
}

/** @ignore */
export class BytesReader {
  source: Uint8Array;
  consumed: number = 0;

  constructor(bytes: string | Uint8Array) {
    this.source = typeof bytes === 'string' ? hexToBytes(bytes) : bytes;
  }

  readBytes(length: number): Uint8Array {
    const view = this.source.subarray(this.consumed, this.consumed + length);
    this.consumed += length;
    return view;
  }

  readUInt32BE(): number {
    return readUInt32BE(this.readBytes(4), 0);
  }

  readUInt8(): number {
    return readUInt8(this.readBytes(1), 0);
  }

  readUInt16BE(): number {
    return readUInt16BE(this.readBytes(2), 0);
  }

  readBigUIntLE(length: number): bigint {
    const bytes = this.readBytes(length).slice().reverse();
    const hex = bytesToHex(bytes);
    return BigInt(`0x${hex}`);
  }

  readBigUIntBE(length: number): bigint {
    const bytes = this.readBytes(length);
    const hex = bytesToHex(bytes);
    return BigInt(`0x${hex}`);
  }

  // todo: remove or implement with DataView?
  // readBigUInt64BE(): bigint {
  //   return this.source.readBigUInt64BE();
  // }

  get readOffset(): number {
    return this.consumed;
  }

  set readOffset(val: number) {
    this.consumed = val;
  }

  get internalBytes(): Uint8Array {
    return this.source;
  }

  readUInt8Enum<T extends string, TEnumValue extends number>(
    enumVariable: { [key in T]: TEnumValue },
    invalidEnumErrorFormatter: (val: number) => Error
  ): TEnumValue {
    const num = this.readUInt8();
    if (isEnum(enumVariable, num)) {
      return num;
    }
    throw invalidEnumErrorFormatter(num);
  }
}
