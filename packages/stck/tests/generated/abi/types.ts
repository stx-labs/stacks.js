// Clarity ABI TypeScript utility types
// Derives Stacks.js ClarityValue types from contract interface ABIs at compile time.

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
} from "@stacks/transactions";

// ---------------------------------------------------------------------------
// Core: map a ContractInterfaceAtomType literal to a ClarityValue CV type
// ---------------------------------------------------------------------------

export type AbiTypeToCv<T> =
  T extends "none" ? NoneCV :
  T extends "int128" ? IntCV :
  T extends "uint128" ? UIntCV :
  T extends "bool" ? BooleanCV :
  T extends "principal" ? PrincipalCV :
  T extends "trait_reference" ? ClarityValue :
  T extends { buffer: { length: number } } ? BufferCV :
  T extends { "string-utf8": { length: number } } ? StringUtf8CV :
  T extends { "string-ascii": { length: number } } ? StringAsciiCV :
  T extends { optional: infer Inner } ? NoneCV | SomeCV<AbiTypeToCv<Inner>> :
  T extends { response: { ok: infer Ok; error: infer Err } }
    ? ResponseOkCV<AbiTypeToCv<Ok>> | ResponseErrorCV<AbiTypeToCv<Err>> :
  T extends { list: { type: infer El; length: number } } ? ListCV<AbiTypeToCv<El>> :
  T extends { tuple: infer Entries extends readonly any[] }
    ? TupleCV<UnionToIntersection<TupleEntriesToCv<Entries>> & Record<string, ClarityValue>>
    : never;

// Convert a tuple entries array to a union of single-key records, then intersect
type TupleEntriesToCv<T extends readonly any[]> =
  T[number] extends { name: infer N extends string; type: infer Ty }
    ? { [K in N]: AbiTypeToCv<Ty> }
    : never;

// Helper: convert a union to an intersection
// { a: X } | { b: Y } => { a: X } & { b: Y } => { a: X; b: Y }
type UnionToIntersection<U> =
  (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

// ---------------------------------------------------------------------------
// Function utilities
// ---------------------------------------------------------------------------

type AnyAbi = { readonly functions: readonly any[] };
type AnyAbiWithMaps = { readonly maps: readonly any[] };
type AnyAbiWithVars = { readonly variables: readonly any[] };

/** Get a specific function by name from an ABI */
type GetFunction<ABI extends AnyAbi, Name extends string> =
  Extract<ABI["functions"][number], { name: Name }>;

/** Derive the args record for a function */
type FunctionArgs<F> =
  F extends { args: readonly [] }
    ? Record<string, never>
    : F extends { args: readonly any[] }
      ? UnionToIntersection<
          F["args"][number] extends { name: infer N extends string; type: infer Ty }
            ? { [K in N]: AbiTypeToCv<Ty> }
            : never
        >
      : never;

/** Derive the return type for a function */
type FunctionReturn<F> =
  F extends { outputs: { type: infer T } } ? AbiTypeToCv<T> : never;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get the argument types for a named function */
export type Args<ABI extends AnyAbi, Name extends string> =
  FunctionArgs<GetFunction<ABI, Name>>;

/** Get the return type for a named function */
export type Return<ABI extends AnyAbi, Name extends string> =
  FunctionReturn<GetFunction<ABI, Name>>;

/** Get all function names, optionally filtered by access type */
export type FunctionNames<
  ABI extends AnyAbi,
  Access extends string = "public" | "read_only"
> = Extract<ABI["functions"][number], { access: Access }>["name"];

/** Get map key type by map name */
export type MapKey<ABI extends AnyAbiWithMaps, Name extends string> =
  AbiTypeToCv<Extract<ABI["maps"][number], { name: Name }>["key"]>;

/** Get map value type by map name */
export type MapValue<ABI extends AnyAbiWithMaps, Name extends string> =
  AbiTypeToCv<Extract<ABI["maps"][number], { name: Name }>["value"]>;

/** Get all map names */
export type MapNames<ABI extends AnyAbiWithMaps> = ABI["maps"][number]["name"];

/** Get variable type by name */
export type VariableType<ABI extends AnyAbiWithVars, Name extends string> =
  AbiTypeToCv<Extract<ABI["variables"][number], { name: Name }>["type"]>;

/** Get all variable names, optionally filtered by access */
export type VariableNames<
  ABI extends AnyAbiWithVars,
  Access extends string = "variable" | "constant"
> = Extract<ABI["variables"][number], { access: Access }>["name"];
