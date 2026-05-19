import type { StacksTransactionWire } from '@stacks/transactions';
import type { ContractBundle, ExtractContractInterface } from '../brand';
import type {
  ArgInputsFromBundleA,
  PublicFunctionNames,
  ReadOnlyFunctionNames,
} from '../approach-a';
import type { PerCallOptions, PerCallReadOnlyOptions } from '../contract-a';

/**
 * Approach C: a Proxy-based client whose methods *are* the contract's functions.
 *
 * - Public functions become async methods that build an unsigned tx.
 * - Read-only functions become async methods that fetch and return the decoded CV.
 * - All argument tuples come from the bundle's runtime ABI (positional, primitive-or-CV).
 * - Read-only return types come from the bundle's brand interface (named-alias hover).
 */
export type ProxyClient<B extends ContractBundle> = ProxyPublicMethods<B> & ProxyReadOnlyMethods<B>;

type ProxyPublicMethods<B extends ContractBundle> = {
  [F in PublicFunctionNames<B> & string]: (
    ...args: [...ArgInputsFromBundleA<B, F>, opts?: PerCallOptions]
  ) => Promise<StacksTransactionWire>;
};

type ProxyReadOnlyMethods<B extends ContractBundle> = {
  [F in ReadOnlyFunctionNames<B> & string]: (
    ...args: [...ArgInputsFromBundleA<B, F>, opts?: PerCallReadOnlyOptions]
  ) => Promise<ReadOnlyReturn<B, F>>;
};

/** Return type for a read-only function — pulled from the bundle's brand interface. */
type ReadOnlyReturn<B extends ContractBundle, F extends string> =
  ExtractContractInterface<B> extends { functions: infer Fns }
    ? F extends keyof Fns
      ? Fns[F] extends { return: infer R }
        ? R
        : never
      : never
    : never;
