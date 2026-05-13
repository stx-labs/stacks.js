import type { ClarityValue } from '@stacks/transactions';
import { Cl } from '@stacks/transactions';

/** Loose shape of an ABI atom type — accepts the various forms Clarinet emits. */
export type AbiAtomType = string | Record<string, any>;

/** Duck-type check: is `v` already a built Clarity value? */
export function isClarityValue(v: unknown): v is ClarityValue {
  return (
    typeof v === 'object' &&
    v !== null &&
    'type' in v &&
    typeof (v as { type: unknown }).type === 'string'
  );
}

/**
 * Coerce a JS value (primitive or pre-built ClarityValue) to a ClarityValue
 * matching the given ABI atom type. Recurses through `optional`, `list`, and `tuple`.
 */
export function toClarityValue(abiType: AbiAtomType, value: unknown): ClarityValue {
  if (isClarityValue(value)) return value;

  if (typeof abiType === 'string') {
    switch (abiType) {
      case 'uint128':
        return Cl.uint(value as number | bigint);
      case 'int128':
        return Cl.int(value as number | bigint);
      case 'bool':
        return Cl.bool(value as boolean);
      case 'principal':
      case 'trait_reference':
        return Cl.principal(value as string);
      case 'none':
        return Cl.none();
    }
    throw new Error(`Unknown ABI atom type: ${abiType}`);
  }

  if ('buffer' in abiType) {
    if (value instanceof Uint8Array) return Cl.buffer(value);
    if (typeof value === 'string') return Cl.bufferFromHex(value);
    throw new Error('buffer arg expects Uint8Array or hex string');
  }
  if ('string-utf8' in abiType) return Cl.stringUtf8(value as string);
  if ('string-ascii' in abiType) return Cl.stringAscii(value as string);
  if ('optional' in abiType) {
    return value === null || value === undefined
      ? Cl.none()
      : Cl.some(toClarityValue(abiType.optional, value));
  }
  if ('list' in abiType) {
    const elType = abiType.list.type as AbiAtomType;
    return Cl.list((value as unknown[]).map(v => toClarityValue(elType, v)));
  }
  if ('tuple' in abiType) {
    const entries = abiType.tuple as Array<{ name: string; type: AbiAtomType }>;
    const obj: Record<string, ClarityValue> = {};
    for (const { name, type } of entries) {
      obj[name] = toClarityValue(type, (value as Record<string, unknown>)[name]);
    }
    return Cl.tuple(obj);
  }
  if ('response' in abiType) {
    throw new Error('response type is not supported as an input argument');
  }
  throw new Error(`Unknown ABI atom type: ${JSON.stringify(abiType)}`);
}

/** Coerce a positional array of JS values against the function's ABI arg types. */
export function coerceArgs(
  abiArgs: ReadonlyArray<{ type: AbiAtomType }>,
  values: readonly unknown[]
): ClarityValue[] {
  if (values.length !== abiArgs.length) {
    throw new Error(`Expected ${abiArgs.length} args, got ${values.length}`);
  }
  return abiArgs.map((a, i) => toClarityValue(a.type, values[i]));
}
