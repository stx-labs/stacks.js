import type { ClarityValue } from '@stacks/transactions';

/**
 * Structural shape that every contract entry on a user-supplied `Contracts` map
 * must satisfy. This is purely a constraint — `createClient` is parametric over
 * any record that conforms.
 */
export interface ContractShape {
  functions: {
    [fn: string]: {
      args: readonly ClarityValue[];
      return: ClarityValue;
      access: 'public' | 'read_only';
    };
  };
}

/**
 * Top-level constraint on the `Contracts` generic.
 *
 * Intentionally loose (`object`) so that user-defined `interface Contracts { ... }`
 * (which has no string index signature) is assignable. The per-function lookups
 * still narrow correctly because the indexed-type accessors fall back to `never`
 * for keys/shapes that don't match.
 */
export type ContractsShape = object;

// --- Helpers used to narrow autocomplete and signatures from the generic ---

/** All contract keys on the registry. */
export type ContractKeys<C extends ContractsShape> = keyof C & string;

/** The function map for a given contract key, or `never` if shape is off. */
type FunctionsOf<C extends ContractsShape, K extends ContractKeys<C>> = C[K] extends {
  functions: infer Fns;
}
  ? Fns
  : never;

/** All function keys on a given contract. */
export type FunctionKeys<
  C extends ContractsShape,
  K extends ContractKeys<C>,
> = keyof FunctionsOf<C, K> & string;

/** Function keys filtered by access modifier. */
export type FunctionKeysByAccess<
  C extends ContractsShape,
  K extends ContractKeys<C>,
  A extends 'public' | 'read_only',
> = {
  [F in FunctionKeys<C, K>]: FunctionsOf<C, K>[F] extends { access: A } ? F : never;
}[FunctionKeys<C, K>];

/** Positional CV-tuple for a given function. */
export type FunctionArgs<
  C extends ContractsShape,
  K extends ContractKeys<C>,
  F extends FunctionKeys<C, K>,
> = FunctionsOf<C, K>[F] extends { args: infer A extends readonly ClarityValue[] }
  ? // strip readonly so callers can write plain `[Cl.uint(5)]`
    { -readonly [I in keyof A]: A[I] }
  : never;

/** Return type for a given function (always a `ClarityValue` subtype). */
export type FunctionReturn<
  C extends ContractsShape,
  K extends ContractKeys<C>,
  F extends FunctionKeys<C, K>,
> = FunctionsOf<C, K>[F] extends { return: infer R extends ClarityValue } ? R : never;

/**
 * A literal `${address}.${contractKey}` shape — keeps the deployed address open
 * while pinning the contract key to one of the registry entries.
 *
 * Used as the `contract` field on call options so autocomplete + narrowing still
 * works even though the address part is freeform.
 */
export type DeployedContract<C extends ContractsShape, K extends ContractKeys<C>> =
  `${string}.${K}`;
