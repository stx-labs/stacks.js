import type { StacksTransactionWire, UnsignedContractCallOptions } from '@stacks/transactions';
import {
  fetchCallReadOnlyFunction,
  getAddressFromPublicKey,
  makeUnsignedContractCall as makeUnsignedContractCallRaw,
} from '@stacks/transactions';
import type { ClientOpts } from '@stacks/common';
import type { StacksNetwork, StacksNetworkName } from '@stacks/network';
import { findClarityFunctionName } from './common';
import { coerceArgs } from './coerce';
import type { ContractBundle, ExtractContractInterface } from './brand';
import type {
  ArgInputsFromBundleA,
  PublicFunctionNames,
  ReadOnlyFunctionNames,
} from './approach-a';

/** Bindings shared across every call made through the wrapper. */
export interface ContractBindingsA {
  contract: `${string}.${string}`;
  publicKey: string;
  network?: StacksNetworkName | StacksNetwork;
  client?: ClientOpts;
}

/** Per-call options that override the bound bindings or supply extra tx fields. */
export type PerCallOptions = Partial<
  Omit<
    UnsignedContractCallOptions,
    'contractAddress' | 'contractName' | 'functionName' | 'functionArgs'
  >
>;

/** Per-call options for read-only function calls. */
export type PerCallReadOnlyOptions = {
  /** Override the auto-derived sender address (defaults to address of the bound publicKey). */
  senderAddress?: string;
};

/** Build a typed contract wrapper using Approach A (Rust-generated bundle). */
export function contractA<B extends ContractBundle>(
  bundle: B,
  bindings: ContractBindingsA
): ContractClientForBundleA<B> {
  const [contractAddress, contractName] = bindings.contract.split('.') as [string, string];
  const network = bindings.network ?? 'mainnet';

  return {
    async makeUnsignedContractCall(functionName, args, opts) {
      const clarityFnName = findClarityFunctionName(bundle, functionName as string);
      const abiFn = bundle.functions.find(f => f.name === clarityFnName);
      if (!abiFn) throw new Error(`Function "${clarityFnName}" not found in ABI`);
      const functionArgs = coerceArgs(abiFn.args, args as readonly unknown[]);

      return makeUnsignedContractCallRaw({
        ...(opts ?? {}),
        contractAddress,
        contractName,
        functionName: clarityFnName,
        functionArgs,
        publicKey: opts?.publicKey ?? bindings.publicKey,
      });
    },

    async fetchCallReadOnlyFunction(functionName, args, opts) {
      const clarityFnName = findClarityFunctionName(bundle, functionName as string);
      const abiFn = bundle.functions.find(f => f.name === clarityFnName);
      if (!abiFn) throw new Error(`Function "${clarityFnName}" not found in ABI`);
      const functionArgs = coerceArgs(abiFn.args, args as readonly unknown[]);

      const senderAddress =
        opts?.senderAddress ?? getAddressFromPublicKey(bindings.publicKey, network);

      const result = await fetchCallReadOnlyFunction({
        contractAddress,
        contractName,
        functionName: clarityFnName,
        functionArgs,
        senderAddress,
        network,
        client: bindings.client,
      });
      return result as never;
    },
  } as ContractClientForBundleA<B>;
}

/**
 * The client type produced by `contractA`: methods restricted to public / read-only
 * names of the bundle. Args are positional tuples derived from the bundle's runtime
 * ABI value; return types come from the bundle's brand interface for named-alias hover.
 */
export type ContractClientForBundleA<B extends ContractBundle> = {
  makeUnsignedContractCall<F extends string & PublicFunctionNames<B>>(
    functionName: F,
    args: ArgInputsFromBundleA<B, F>,
    opts?: PerCallOptions
  ): Promise<StacksTransactionWire>;

  fetchCallReadOnlyFunction<F extends string & ReadOnlyFunctionNames<B>>(
    functionName: F,
    args: ArgInputsFromBundleA<B, F>,
    opts?: PerCallReadOnlyOptions
  ): Promise<ExtractContractInterface<B>['functions'][F]['return']>;
};
