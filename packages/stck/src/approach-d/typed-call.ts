import type { ClarityValue, StacksTransactionWire } from '@stacks/transactions';
import {
  fetchCallReadOnlyFunction as fetchCallReadOnlyFunctionRaw,
  getAddressFromPublicKey,
  makeUnsignedContractCall as makeUnsignedContractCallRaw,
} from '@stacks/transactions';
import type { ClientOpts } from '@stacks/common';
import type { StacksNetwork, StacksNetworkName } from '@stacks/network';
import type { ContractBundle, ExtractContractInterface } from '../brand';
import type {
  ArgInputsFromBundleA,
  PublicFunctionNames,
  ReadOnlyFunctionNames,
} from '../approach-a';
import { findClarityFunctionName } from '../common';
import { coerceArgs } from '../coerce';
import { getBundle, splitPrincipal, type Principal } from './principal';

/**
 * The narrowly-typed call descriptor produced by {@link typedCall}.
 *
 * Shape matches the relevant subset of `@stacks/transactions`' contract-call
 * options: spread the result into `makeUnsignedContractCall` (or any other
 * builder that takes the same four fields) to perform the actual call.
 */
export interface TypedCallDescriptor {
  contractAddress: string;
  contractName: string;
  functionName: string;
  functionArgs: ClarityValue[];
}

/**
 * Build a narrowly-typed `{ contractAddress, contractName, functionName, functionArgs }`
 * payload from a branded principal, function name, and JS-primitive args.
 *
 * Designed to be spread into `@stacks/transactions`' `makeUnsignedContractCall`:
 *
 * ```ts
 * const counter = principal(counterContract, "ST1...counter");
 * await makeUnsignedContractCall({
 *   ...typedCall(counter, "add", [5]),
 *   publicKey: "...",
 * });
 * ```
 *
 * The function name is restricted at the type level to public function names
 * of the bound bundle; the args tuple is narrowly typed against the ABI.
 */
export function typedCall<B extends ContractBundle, F extends string & PublicFunctionNames<B>>(
  p: Principal<B>,
  functionName: F,
  args: ArgInputsFromBundleA<B, F>
): TypedCallDescriptor {
  const bundle = getBundle(p);
  const { contractAddress, contractName } = splitPrincipal(p);
  const clarityFnName = findClarityFunctionName(bundle, functionName as string);
  const abiFn = bundle.functions.find(f => f.name === clarityFnName);
  if (!abiFn) throw new Error(`Function "${clarityFnName}" not found in ABI`);
  const functionArgs = coerceArgs(abiFn.args as any, args as readonly unknown[]);
  return {
    contractAddress,
    contractName,
    functionName: clarityFnName,
    functionArgs,
  };
}

/**
 * The read-only counterpart of {@link typedCall}.
 *
 * Restricts `functionName` to read-only functions of the bound bundle so that
 * passing a public function is a compile-time error.
 */
export function typedReadOnlyCall<
  B extends ContractBundle,
  F extends string & ReadOnlyFunctionNames<B>,
>(p: Principal<B>, functionName: F, args: ArgInputsFromBundleA<B, F>): TypedCallDescriptor {
  const bundle = getBundle(p);
  const { contractAddress, contractName } = splitPrincipal(p);
  const clarityFnName = findClarityFunctionName(bundle, functionName as string);
  const abiFn = bundle.functions.find(f => f.name === clarityFnName);
  if (!abiFn) throw new Error(`Function "${clarityFnName}" not found in ABI`);
  const functionArgs = coerceArgs(abiFn.args as any, args as readonly unknown[]);
  return {
    contractAddress,
    contractName,
    functionName: clarityFnName,
    functionArgs,
  };
}

/* ------------------------------------------------------------------------- *
 * Same-name wrapper variant (option D from the prompt)
 *
 * Re-exports `makeUnsignedContractCall` and `fetchCallReadOnlyFunction` with
 * an additional, principal-flavoured overload. Existing callers who pass the
 * raw `{ contractAddress, contractName, ... }` shape continue to compile,
 * AND a new `{ principal, functionName, functionArgs }` shape is accepted
 * and narrowly typed.
 * ------------------------------------------------------------------------- */

/** Strongly-typed contract-call options when the user passes a branded principal. */
export type TypedCallOptionsD<
  B extends ContractBundle,
  F extends string & PublicFunctionNames<B>,
> = {
  principal: Principal<B>;
  functionName: F;
  functionArgs: ArgInputsFromBundleA<B, F>;
  publicKey: string;
  fee?: bigint | number;
  nonce?: bigint | number;
  network?: StacksNetworkName | StacksNetwork;
  client?: ClientOpts;
};

/**
 * Drop-in same-name re-export of `makeUnsignedContractCall` that accepts EITHER
 * the original `@stacks/transactions` options shape (unchanged), OR a typed
 * principal-driven shape.
 *
 * The original overload is preserved verbatim by typing it as `any` payload
 * with no narrowing — we delegate to the raw function in that branch.
 */
export async function makeUnsignedContractCall<
  B extends ContractBundle,
  F extends string & PublicFunctionNames<B>,
>(options: TypedCallOptionsD<B, F>): Promise<StacksTransactionWire>;
export async function makeUnsignedContractCall(
  options: Parameters<typeof makeUnsignedContractCallRaw>[0]
): Promise<StacksTransactionWire>;
export async function makeUnsignedContractCall(options: any): Promise<StacksTransactionWire> {
  if ('principal' in options) {
    const { principal: p, functionName, functionArgs, ...rest } = options;
    const desc = (typedCall as (
      p: Principal<ContractBundle>,
      fn: string,
      args: readonly unknown[]
    ) => TypedCallDescriptor)(p, functionName, functionArgs);
    return makeUnsignedContractCallRaw({ ...rest, ...desc });
  }
  return makeUnsignedContractCallRaw(options);
}

/** Per-call options for the read-only wrapper. */
export type TypedReadOnlyOptionsD<
  B extends ContractBundle,
  F extends string & ReadOnlyFunctionNames<B>,
> = {
  principal: Principal<B>;
  functionName: F;
  functionArgs: ArgInputsFromBundleA<B, F>;
  /** Sender address. If omitted, derived from `publicKey`. */
  senderAddress?: string;
  /** Public key used to derive `senderAddress` if not supplied directly. */
  publicKey?: string;
  network?: StacksNetworkName | StacksNetwork;
  client?: ClientOpts;
};

/**
 * Drop-in same-name re-export of `fetchCallReadOnlyFunction` with a typed
 * principal-driven overload.
 *
 * Return type narrows to the precise CV declared by the bundle for the named
 * function.
 */
export async function fetchCallReadOnlyFunction<
  B extends ContractBundle,
  F extends string & ReadOnlyFunctionNames<B>,
>(
  options: TypedReadOnlyOptionsD<B, F>
): Promise<ExtractContractInterface<B>['functions'][F]['return']>;
export async function fetchCallReadOnlyFunction(
  options: Parameters<typeof fetchCallReadOnlyFunctionRaw>[0]
): Promise<ClarityValue>;
export async function fetchCallReadOnlyFunction(options: any): Promise<ClarityValue> {
  if ('principal' in options) {
    const { principal: p, functionName, functionArgs, senderAddress, publicKey, network, client } =
      options as {
        principal: Principal<ContractBundle>;
        functionName: string;
        functionArgs: readonly unknown[];
        senderAddress?: string;
        publicKey?: string;
        network?: StacksNetworkName | StacksNetwork;
        client?: ClientOpts;
      };
    const desc = (typedReadOnlyCall as (
      p: Principal<ContractBundle>,
      fn: string,
      args: readonly unknown[]
    ) => TypedCallDescriptor)(p, functionName, functionArgs);
    const sender =
      senderAddress ??
      (publicKey
        ? getAddressFromPublicKey(publicKey, network ?? 'mainnet')
        : undefined);
    if (!sender) {
      throw new Error('fetchCallReadOnlyFunction: either senderAddress or publicKey is required');
    }
    return fetchCallReadOnlyFunctionRaw({
      ...desc,
      senderAddress: sender,
      network: network ?? 'mainnet',
      client,
    });
  }
  return fetchCallReadOnlyFunctionRaw(options);
}
