import type { StacksTransactionWire } from '@stacks/transactions';
import { makeUnsignedContractCall as makeUnsignedContractCallRaw } from '@stacks/transactions';
import type { FunctionNames } from './abi-types';
import type { ArgInputsFromAbi } from './primitive-types';
import { coerceArgs } from './coerce';

type AnyAbi = { readonly functions: readonly any[] };

/** Typed options for Approach B contract calls (ABI passed separately) */
export type TypedOptionsB<ABI extends AnyAbi, F extends FunctionNames<ABI, 'public'>> =
  F extends any
    ? {
        contract: `${string}.${string}`;
        functionName: F;
        functionArgs: ArgInputsFromAbi<ABI, F & string>;
        publicKey: string;
      }
    : never;

/** Typed makeUnsignedContractCall using Approach B (ABI as const) */
export async function makeUnsignedContractCallB<
  ABI extends AnyAbi,
  F extends FunctionNames<ABI, 'public'>,
>(abi: ABI, options: TypedOptionsB<ABI, F>): Promise<StacksTransactionWire> {
  const [contractAddress, contractName] = options.contract.split('.') as [string, string];
  const abiFn = abi.functions.find((f: { name: string }) => f.name === options.functionName);
  if (!abiFn) throw new Error(`Function "${options.functionName as string}" not found in ABI`);
  const functionArgs = coerceArgs(abiFn.args, options.functionArgs as readonly unknown[]);
  return makeUnsignedContractCallRaw({
    contractAddress,
    contractName,
    functionName: options.functionName as string,
    functionArgs,
    publicKey: options.publicKey,
  });
}
