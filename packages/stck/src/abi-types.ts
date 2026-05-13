import type {
  NoneCV,
  IntCV,
  UIntCV,
  BooleanCV,
  PrincipalCV,
  BufferCV,
  StringUtf8CV,
  StringAsciiCV,
  TupleCV,
  ListCV,
  SomeCV,
  ResponseOkCV,
  ResponseErrorCV,
  ClarityValue,
} from '@stacks/transactions';

/** Map an ABI atom type literal to its ClarityValue CV type */
export type AbiTypeToCv<T> = T extends 'none'
  ? NoneCV
  : T extends 'int128'
    ? IntCV
    : T extends 'uint128'
      ? UIntCV
      : T extends 'bool'
        ? BooleanCV
        : T extends 'principal'
          ? PrincipalCV
          : T extends 'trait_reference'
            ? ClarityValue
            : T extends { buffer: { length: number } }
              ? BufferCV
              : T extends { 'string-utf8': { length: number } }
                ? StringUtf8CV
                : T extends { 'string-ascii': { length: number } }
                  ? StringAsciiCV
                  : T extends { optional: infer Inner }
                    ? NoneCV | SomeCV<AbiTypeToCv<Inner>>
                    : T extends { response: { ok: infer Ok; error: infer Err } }
                      ? ResponseOkCV<AbiTypeToCv<Ok>> | ResponseErrorCV<AbiTypeToCv<Err>>
                      : T extends { list: { type: infer El; length: number } }
                        ? ListCV<AbiTypeToCv<El>>
                        : T extends { tuple: infer Entries extends readonly any[] }
                          ? TupleCV<
                              UnionToIntersection<TupleEntriesToCv<Entries>> &
                                Record<string, ClarityValue>
                            >
                          : never;

type TupleEntriesToCv<T extends readonly any[]> =
  T[number] extends { name: infer N extends string; type: infer Ty }
    ? { [K in N]: AbiTypeToCv<Ty> }
    : never;

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I
) => void
  ? I
  : never;

/** Extract args as a positional tuple for a given function */
export type Args<
  ABI extends { readonly functions: readonly any[] },
  Name extends string,
> = ArgsInner<Extract<ABI['functions'][number], { name: Name }>>;

type ArgsInner<F> = F extends { args: infer A extends readonly { type: any }[] }
  ? { -readonly [K in keyof A]: A[K] extends { type: infer T } ? AbiTypeToCv<T> : never }
  : never;

/** Extract return type for a given function */
export type Return<
  ABI extends { readonly functions: readonly any[] },
  Name extends string,
> = ReturnInner<Extract<ABI['functions'][number], { name: Name }>>;

type ReturnInner<F> = F extends { outputs: { type: infer T } } ? AbiTypeToCv<T> : never;

/** Get all function names, optionally filtered by access */
export type FunctionNames<
  ABI extends { readonly functions: readonly any[] },
  Access extends string = 'public' | 'read_only',
> = Extract<ABI['functions'][number], { access: Access }>['name'];

/**
 * Project an `as const` ABI literal into the compact contract-interface shape
 * Approach A uses (see `TypegenContractInterface`). Returns are derived per-function;
 * args are NOT projected (the wrapper reads them from the runtime ABI value directly).
 */
export type AbiToContractInterface<ABI extends { readonly functions: readonly any[] }> = {
  functions: {
    [F in ABI['functions'][number] as F['name'] & string]: {
      return: ReturnInner<F>;
    };
  };
};
