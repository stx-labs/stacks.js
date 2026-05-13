import type { StacksTransactionWire } from '@stacks/transactions';
import {
  fetchCallReadOnlyFunction,
  getAddressFromPublicKey,
  makeUnsignedContractCall as makeUnsignedContractCallRaw,
} from '@stacks/transactions';
import type { ClientOpts } from '@stacks/common';
import type { StacksNetwork, StacksNetworkName } from '@stacks/network';
import { coerceArgs } from './coerce';
import type { FunctionNames, Return } from './abi-types';
import type { ArgInputsFromAbi } from './primitive-types';
import type { PerCallOptions, PerCallReadOnlyOptions } from './contract-a';

type AnyAbi = { readonly functions: readonly any[] };

/** Bindings shared across every call made through the wrapper. */
export interface ContractBindingsB {
  contract: `${string}.${string}`;
  publicKey: string;
  network?: StacksNetworkName | StacksNetwork;
  client?: ClientOpts;
}

/**
 * Wrapper exposing every call style (makeUnsignedContractCall, etc.) for a single bound contract.
 *
 * Parametrized on the `as const` ABI literal (the bundle's value side). Method
 * signatures use Clarity kebab function names. Both args and access filtering
 * are derived from the ABI literal — no separate interface needed.
 */
export interface ContractClientB<ABI extends AnyAbi> {
  makeUnsignedContractCall<F extends FunctionNames<ABI, 'public'>>(
    functionName: F,
    args: ArgInputsFromAbi<ABI, F & string>,
    opts?: PerCallOptions
  ): Promise<StacksTransactionWire>;

  fetchCallReadOnlyFunction<F extends FunctionNames<ABI, 'read_only'>>(
    functionName: F,
    args: ArgInputsFromAbi<ABI, F & string>,
    opts?: PerCallReadOnlyOptions
  ): Promise<Return<ABI, F & string>>;
}

/** Build a typed contract wrapper using Approach B (ABI as const). */
export function contractB<const ABI extends AnyAbi>(
  abi: ABI,
  bindings: ContractBindingsB
): ContractClientB<ABI> {
  const [contractAddress, contractName] = bindings.contract.split('.') as [string, string];
  const network = bindings.network ?? 'mainnet';

  return {
    async makeUnsignedContractCall(functionName, args, opts) {
      const abiFn = abi.functions.find((f: { name: string }) => f.name === functionName);
      if (!abiFn) throw new Error(`Function "${functionName as string}" not found in ABI`);
      const functionArgs = coerceArgs(abiFn.args, args as readonly unknown[]);

      return makeUnsignedContractCallRaw({
        ...(opts ?? {}),
        contractAddress,
        contractName,
        functionName: functionName as string,
        functionArgs,
        publicKey: opts?.publicKey ?? bindings.publicKey,
      });
    },

    async fetchCallReadOnlyFunction(functionName, args, opts) {
      const abiFn = abi.functions.find((f: { name: string }) => f.name === functionName);
      if (!abiFn) throw new Error(`Function "${functionName as string}" not found in ABI`);
      const functionArgs = coerceArgs(abiFn.args, args as readonly unknown[]);

      const senderAddress =
        opts?.senderAddress ?? getAddressFromPublicKey(bindings.publicKey, network);

      const result = await fetchCallReadOnlyFunction({
        contractAddress,
        contractName,
        functionName: functionName as string,
        functionArgs,
        senderAddress,
        network,
        client: bindings.client,
      });
      return result as never;
    },
  };
}
