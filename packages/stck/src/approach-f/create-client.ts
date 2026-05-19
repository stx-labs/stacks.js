import type { StacksTransactionWire, UnsignedContractCallOptions } from '@stacks/transactions';
import {
  fetchCallReadOnlyFunction,
  getAddressFromPublicKey,
  makeUnsignedContractCall as makeUnsignedContractCallRaw,
} from '@stacks/transactions';
import type { ClientOpts } from '@stacks/common';
import type { StacksNetwork, StacksNetworkName } from '@stacks/network';
import type {
  ContractKeys,
  ContractsShape,
  DeployedContract,
  FunctionArgs,
  FunctionKeysByAccess,
  FunctionReturn,
} from './types';

/**
 * Options bound once at client construction. `network` defaults to `"mainnet"`;
 * `client` lets you pass a custom `fetch` and/or `baseUrl` (matches the rest of
 * the package).
 */
export interface CreateClientOptions {
  publicKey: string;
  network?: StacksNetworkName | StacksNetwork;
  client?: ClientOpts;
}

/** Per-call options when building an unsigned transaction. */
export type PerCallOptions = Partial<
  Omit<
    UnsignedContractCallOptions,
    'contractAddress' | 'contractName' | 'functionName' | 'functionArgs'
  >
>;

/** Per-call options for read-only invocations. */
export type PerCallReadOnlyOptions = {
  /** Override the sender (defaults to the address derived from the bound publicKey). */
  senderAddress?: string;
};

/** Arguments to the top-level `makeUnsignedContractCall` method. */
export type MakeUnsignedContractCallArgs<
  C extends ContractsShape,
  K extends ContractKeys<C>,
  F extends FunctionKeysByAccess<C, K, 'public'>,
> = {
  contract: DeployedContract<C, K>;
  functionName: F;
  functionArgs: FunctionArgs<C, K, F>;
  opts?: PerCallOptions;
};

/** Arguments to the top-level `fetchCallReadOnlyFunction` method. */
export type FetchCallReadOnlyArgs<
  C extends ContractsShape,
  K extends ContractKeys<C>,
  F extends FunctionKeysByAccess<C, K, 'read_only'>,
> = {
  contract: DeployedContract<C, K>;
  functionName: F;
  functionArgs: FunctionArgs<C, K, F>;
  opts?: PerCallReadOnlyOptions;
};

/**
 * The handle returned by `client.contract<"key">("address.key")`. Smaller call
 * sites: the contract address and key are baked in so each method only takes
 * `(functionName, functionArgs, opts?)`.
 */
export interface ContractHandle<C extends ContractsShape, K extends ContractKeys<C>> {
  makeUnsignedContractCall<F extends FunctionKeysByAccess<C, K, 'public'>>(
    functionName: F,
    functionArgs: FunctionArgs<C, K, F>,
    opts?: PerCallOptions
  ): Promise<StacksTransactionWire>;

  fetchCallReadOnlyFunction<F extends FunctionKeysByAccess<C, K, 'read_only'>>(
    functionName: F,
    functionArgs: FunctionArgs<C, K, F>,
    opts?: PerCallReadOnlyOptions
  ): Promise<FunctionReturn<C, K, F>>;
}

/**
 * The Approach-F client. Modeled on `openapi-fetch`'s `createClient<paths>()` —
 * the single generic carries every signature, the runtime is a thin wrapper
 * around `@stacks/transactions`.
 *
 * Because the generated artifact is types-only there is no runtime ABI, so:
 * **`functionArgs` must be pre-built `ClarityValue[]`**. JS-primitive coercion
 * (which lives in Approach A / B / C via `toClarityValue`) is intentionally
 * absent here — see REPORT.md for the rationale.
 */
export interface Client<C extends ContractsShape> {
  makeUnsignedContractCall<
    K extends ContractKeys<C>,
    F extends FunctionKeysByAccess<C, K, 'public'>,
  >(
    args: MakeUnsignedContractCallArgs<C, K, F>
  ): Promise<StacksTransactionWire>;

  fetchCallReadOnlyFunction<
    K extends ContractKeys<C>,
    F extends FunctionKeysByAccess<C, K, 'read_only'>,
  >(
    args: FetchCallReadOnlyArgs<C, K, F>
  ): Promise<FunctionReturn<C, K, F>>;

  /**
   * Get a handle for one deployed contract. Equivalent to a curried form of the
   * top-level methods — supplying the `contract` once narrows everything
   * downstream to that key's functions.
   *
   * The `K` generic is explicit on the call site (`client.contract<"counter">(...)`)
   * because TypeScript can't infer `K` from the address string alone — the
   * address is freeform and only the key tail is constrained.
   */
  contract<K extends ContractKeys<C>>(
    contract: DeployedContract<C, K>
  ): ContractHandle<C, K>;
}

/** Internal: split `"ST1...abc.foo"` into `["ST1...abc", "foo"]`. */
function splitContract(c: string): [string, string] {
  const dot = c.lastIndexOf('.');
  if (dot < 0) throw new Error(`Invalid contract "${c}" — expected "<address>.<name>"`);
  return [c.slice(0, dot), c.slice(dot + 1)];
}

/**
 * Build a typed Stacks client from a types-only contract registry.
 *
 * Usage:
 * ```ts
 * import type { Contracts } from "./gen/types-only";
 * import { createClient } from "@stacks/stck";
 * import { Cl } from "@stacks/transactions";
 *
 * const stx = createClient<Contracts>({ publicKey: "..." });
 * await stx.makeUnsignedContractCall({
 *   contract: "ST1....counter",
 *   functionName: "add",
 *   functionArgs: [Cl.uint(5)],
 * });
 * ```
 */
export function createClient<C extends ContractsShape>(
  opts: CreateClientOptions
): Client<C> {
  const network = opts.network ?? 'mainnet';

  async function makeUnsignedContractCallImpl(args: {
    contract: string;
    functionName: string;
    functionArgs: readonly any[];
    opts?: PerCallOptions;
  }): Promise<StacksTransactionWire> {
    const [contractAddress, contractName] = splitContract(args.contract);
    return makeUnsignedContractCallRaw({
      ...(args.opts ?? {}),
      contractAddress,
      contractName,
      functionName: args.functionName,
      functionArgs: args.functionArgs as any[],
      publicKey: args.opts?.publicKey ?? opts.publicKey,
    });
  }

  async function fetchCallReadOnlyImpl(args: {
    contract: string;
    functionName: string;
    functionArgs: readonly any[];
    opts?: PerCallReadOnlyOptions;
  }): Promise<any> {
    const [contractAddress, contractName] = splitContract(args.contract);
    const senderAddress =
      args.opts?.senderAddress ?? getAddressFromPublicKey(opts.publicKey, network);
    return fetchCallReadOnlyFunction({
      contractAddress,
      contractName,
      functionName: args.functionName,
      functionArgs: args.functionArgs as any[],
      senderAddress,
      network,
      client: opts.client,
    });
  }

  const client: Client<C> = {
    makeUnsignedContractCall: ((args: any) => makeUnsignedContractCallImpl(args)) as Client<C>['makeUnsignedContractCall'],
    fetchCallReadOnlyFunction: ((args: any) => fetchCallReadOnlyImpl(args)) as Client<C>['fetchCallReadOnlyFunction'],
    contract<K extends ContractKeys<C>>(contract: DeployedContract<C, K>): ContractHandle<C, K> {
      return {
        makeUnsignedContractCall: ((functionName: any, functionArgs: any, perCall: any) =>
          makeUnsignedContractCallImpl({
            contract,
            functionName,
            functionArgs,
            opts: perCall,
          })) as ContractHandle<C, K>['makeUnsignedContractCall'],
        fetchCallReadOnlyFunction: ((functionName: any, functionArgs: any, perCall: any) =>
          fetchCallReadOnlyImpl({
            contract,
            functionName,
            functionArgs,
            opts: perCall,
          })) as ContractHandle<C, K>['fetchCallReadOnlyFunction'],
      };
    },
  };

  return client;
}
