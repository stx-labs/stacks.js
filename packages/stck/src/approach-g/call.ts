import type { ClarityValue, StacksTransactionWire } from '@stacks/transactions';
import {
  makeUnsignedContractCall as makeUnsignedContractCallRaw,
  fetchCallReadOnlyFunction as fetchCallReadOnlyFunctionRaw,
} from '@stacks/transactions';
import { splitPrincipal, type Principal } from './principal';

// ---------------------------------------------------------------------------
// Type-level machinery driven entirely by the brand on `Principal<T>`.
// ---------------------------------------------------------------------------

type Functions<P> = P extends Principal<infer T>
  ? T extends { functions: infer F }
    ? F
    : never
  : never;

/** Function names on a branded principal, optionally filtered by access. */
export type FunctionNames<P, Access extends string = string> = {
  [K in keyof Functions<P>]: Functions<P>[K] extends { access: Access } ? K : never;
}[keyof Functions<P>] &
  string;

export type ArgsOf<P, K extends string> = K extends keyof Functions<P>
  ? Functions<P>[K] extends { args: infer A } ? A : never
  : never;

export type ReturnOf<P, K extends string> = K extends keyof Functions<P>
  ? Functions<P>[K] extends { return: infer R } ? R : never
  : never;

// ---------------------------------------------------------------------------
// Runtime helpers.
// ---------------------------------------------------------------------------

export type CallOptions = {
  publicKey: string;
  fee?: bigint | number;
  nonce?: bigint | number;
};

export type ReadOptions = {
  /** Defaults to the contract's own address. */
  senderAddress?: string;
};

/**
 * Build an unsigned contract call for a `public` function. Args must be
 * pre-built `ClarityValue`s (positional, matching the tuple in the brand).
 */
export async function call<
  P extends Principal<unknown>,
  K extends FunctionNames<P, 'public'>,
>(p: P, fn: K, args: ArgsOf<P, K>, opts: CallOptions): Promise<StacksTransactionWire> {
  const [contractAddress, contractName] = splitPrincipal(p);
  return makeUnsignedContractCallRaw({
    contractAddress,
    contractName,
    functionName: fn,
    functionArgs: args as readonly ClarityValue[] as ClarityValue[],
    publicKey: opts.publicKey,
    fee: opts.fee,
    nonce: opts.nonce,
  });
}

/**
 * Invoke a `read_only` function. Return type narrows to the precise CV declared
 * by the brand.
 */
export async function read<
  P extends Principal<unknown>,
  K extends FunctionNames<P, 'read_only'>,
>(p: P, fn: K, args: ArgsOf<P, K>, opts?: ReadOptions): Promise<ReturnOf<P, K>> {
  const [contractAddress, contractName] = splitPrincipal(p);
  const result = await fetchCallReadOnlyFunctionRaw({
    contractAddress,
    contractName,
    functionName: fn,
    functionArgs: args as readonly ClarityValue[] as ClarityValue[],
    senderAddress: opts?.senderAddress ?? contractAddress,
  });
  return result as ReturnOf<P, K>;
}
