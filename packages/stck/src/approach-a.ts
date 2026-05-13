import type { ClarityValue, StacksTransactionWire } from '@stacks/transactions';
import { makeUnsignedContractCall as makeUnsignedContractCallRaw } from '@stacks/transactions';
import type { ContractBundle } from './brand';
import type { AbiTypeToCv } from './abi-types';
import type { AbiTypeToPrimitive } from './primitive-types';
import { findClarityFunctionName, type KebabToCamel } from './common';
import { coerceArgs } from './coerce';

/**
 * Minimal shape of a generated contract interface (Approach A).
 *
 * Only `return` is consumed from the interface — args and access are derived from
 * the bundle's runtime ABI value, which is the single source of truth.
 */
export interface TypegenContractInterface {
  functions: Record<string, { return: ClarityValue }>;
}

/**
 * Names of public functions on a bundle — camelCase, derived from the runtime ABI's
 * `access: "public"` entries. The only ones callable as transactions.
 */
export type PublicFunctionNames<B extends ContractBundle> = KebabToCamel<
  Extract<B['functions'][number], { access: 'public' }>['name']
>;

/**
 * Names of read-only functions on a bundle — camelCase, derived from the runtime ABI's
 * `access: "read_only"` entries.
 */
export type ReadOnlyFunctionNames<B extends ContractBundle> = KebabToCamel<
  Extract<B['functions'][number], { access: 'read_only' }>['name']
>;

/** Pick the ABI function entry whose camelCased kebab name matches `Camel`. */
type AbiFnFromCamel<B extends ContractBundle, Camel extends string> = Extract<
  B['functions'][number],
  { name: any }
> extends infer Fn
  ? Fn extends { name: infer K extends string }
    ? KebabToCamel<K> extends Camel
      ? Fn
      : never
    : never
  : never;

/**
 * Approach A: positional tuple of args derived from the bundle's ABI value for a
 * given camelCase function name. Each slot accepts a JS primitive or the matching CV.
 */
export type ArgInputsFromBundleA<B extends ContractBundle, Camel extends string> =
  AbiFnFromCamel<B, Camel> extends { args: infer A extends readonly { type: any }[] }
    ? {
        -readonly [K in keyof A]: A[K] extends { type: infer T }
          ? AbiTypeToPrimitive<T> | AbiTypeToCv<T>
          : never;
      }
    : never;

/** Typed options for Approach A contract calls (function-style helper). */
export type TypedOptionsA<
  B extends ContractBundle,
  F extends string & PublicFunctionNames<B>,
> = {
  contract: `${string}.${string}`;
  functionName: F;
  functionArgs: ArgInputsFromBundleA<B, F>;
  publicKey: string;
};

/** Typed makeUnsignedContractCall using Approach A (Rust-generated bundle). */
export async function makeUnsignedContractCallA<
  B extends ContractBundle,
  F extends string & PublicFunctionNames<B>,
>(bundle: B, options: TypedOptionsA<B, F>): Promise<StacksTransactionWire> {
  const clarityFnName = findClarityFunctionName(bundle, options.functionName);
  const abiFn = bundle.functions.find(f => f.name === clarityFnName);
  if (!abiFn) throw new Error(`Function "${clarityFnName}" not found in ABI`);
  const [contractAddress, contractName] = options.contract.split('.') as [string, string];
  const functionArgs = coerceArgs(abiFn.args, options.functionArgs as readonly unknown[]);
  return makeUnsignedContractCallRaw({
    contractAddress,
    contractName,
    functionName: clarityFnName,
    functionArgs,
    publicKey: options.publicKey,
  });
}
