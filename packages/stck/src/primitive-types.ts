import type {
  BooleanCV,
  BufferCV,
  ClarityValue,
  IntCV,
  ListCV,
  NoneCV,
  PrincipalCV,
  ResponseErrorCV,
  ResponseOkCV,
  SomeCV,
  StringAsciiCV,
  StringUtf8CV,
  TupleCV,
  UIntCV,
} from '@stacks/transactions';
import type { AbiTypeToCv } from './abi-types';

/** Map a ClarityValue type back to its accepted JS primitive input (Approach A direction). */
export type CvToPrimitive<T> = T extends UIntCV
  ? number | bigint
  : T extends IntCV
    ? number | bigint
    : T extends BooleanCV
      ? boolean
      : T extends NoneCV
        ? null
        : T extends SomeCV<infer Inner>
          ? CvToPrimitive<Inner> | null
          : T extends PrincipalCV
            ? string
            : T extends BufferCV
              ? Uint8Array | string
              : T extends StringUtf8CV
                ? string
                : T extends StringAsciiCV
                  ? string
                  : T extends ListCV<infer El>
                    ? CvToPrimitive<El>[]
                    : T extends TupleCV<infer M>
                      ? { [K in keyof M]: CvToPrimitive<M[K]> }
                      : T extends ResponseOkCV<infer Ok>
                        ? { ok: CvToPrimitive<Ok> }
                        : T extends ResponseErrorCV<infer E>
                          ? { error: CvToPrimitive<E> }
                          : never;

/**
 * Approach A: each arg slot accepts either a JS primitive or the original ClarityValue.
 * Positional tuple keyed by ABI arg order.
 */
export type ArgInputs<A extends readonly ClarityValue[]> = {
  -readonly [K in keyof A]: A[K] extends ClarityValue ? CvToPrimitive<A[K]> | A[K] : never;
};

/** Map an ABI atom type to its accepted JS primitive input (Approach B direction). */
export type AbiTypeToPrimitive<T> = T extends 'uint128'
  ? number | bigint
  : T extends 'int128'
    ? number | bigint
    : T extends 'bool'
      ? boolean
      : T extends 'none'
        ? null
        : T extends 'principal'
          ? string
          : T extends 'trait_reference'
            ? string
            : T extends { buffer: { length: number } }
              ? Uint8Array | string
              : T extends { 'string-utf8': { length: number } }
                ? string
                : T extends { 'string-ascii': { length: number } }
                  ? string
                  : T extends { optional: infer Inner }
                    ? AbiTypeToPrimitive<Inner> | null
                    : T extends { list: { type: infer El; length: number } }
                      ? AbiTypeToPrimitive<El>[]
                      : T extends { tuple: infer Entries extends readonly any[] }
                        ? TuplePrim<Entries>
                        : T extends { response: { ok: infer Ok; error: infer E } }
                          ?
                              | { ok: AbiTypeToPrimitive<Ok> }
                              | { error: AbiTypeToPrimitive<E> }
                          : never;

type TuplePrim<T extends readonly any[]> = UnionToIntersection<TupleEntryPrim<T[number]>>;

type TupleEntryPrim<E> = E extends { name: infer N extends string; type: infer Ty }
  ? { [K in N]: AbiTypeToPrimitive<Ty> }
  : never;

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I
) => void
  ? I
  : never;

/**
 * Approach B: positional tuple of args derived from ABI, each slot accepts primitive or CV.
 */
export type ArgInputsFromAbi<
  ABI extends { readonly functions: readonly any[] },
  Name extends string,
> = ArgInputsFromAbiInner<Extract<ABI['functions'][number], { name: Name }>>;

type ArgInputsFromAbiInner<F> = F extends { args: infer A extends readonly { type: any }[] }
  ? {
      -readonly [K in keyof A]: A[K] extends { type: infer T }
        ? AbiTypeToPrimitive<T> | AbiTypeToCv<T>
        : never;
    }
  : never;
