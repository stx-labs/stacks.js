import {
  fetchCallReadOnlyFunction,
  getAddressFromPublicKey,
  makeUnsignedContractCall as makeUnsignedContractCallRaw,
} from '@stacks/transactions';
import { coerceArgs } from '../coerce';
import { kebabToCamel } from '../common';
import type { ContractBundle } from '../brand';
import type { ContractBindingsA, PerCallOptions, PerCallReadOnlyOptions } from '../contract-a';
import type { ProxyClient } from './types';

/** Internal ABI function entry shape (loosened — the proxy validates at runtime). */
type AbiFn = {
  name: string;
  access: string;
  args: ReadonlyArray<{ name: string; type: unknown }>;
  outputs: { type: unknown };
};

/**
 * Build a Proxy-based typed client over a contract bundle.
 *
 * The returned object has one method per Clarity function (camelCase, derived from the
 * runtime ABI). Public functions return `Promise<StacksTransactionWire>`; read-only
 * functions perform the network read and return the decoded `ClarityValue`.
 *
 * The same method name dispatches based on the function's ABI access — there is no
 * `read`/`write` namespace split. The trailing options object is optional and is
 * detected purely by arity (one more arg than the ABI declares).
 */
export function contractC<B extends ContractBundle>(
  bundle: B,
  bindings: ContractBindingsA
): ProxyClient<B> {
  const [contractAddress, contractName] = bindings.contract.split('.') as [string, string];
  const network = bindings.network ?? 'mainnet';

  // Index ABI functions by camelCase name for O(1) dispatch.
  const fnIndex = new Map<string, AbiFn>();
  for (const fn of bundle.functions as ReadonlyArray<AbiFn>) {
    fnIndex.set(kebabToCamel(fn.name), fn);
  }

  // Memoize generated method functions so reference identity is stable per property name.
  const methodCache = new Map<string, (...args: unknown[]) => Promise<unknown>>();

  function buildMethod(abiFn: AbiFn) {
    const arity = abiFn.args.length;
    const isReadOnly = abiFn.access === 'read_only';

    if (isReadOnly) {
      return async (...rawArgs: unknown[]) => {
        const { argValues, opts } = splitArgsAndOpts<PerCallReadOnlyOptions>(rawArgs, arity);
        const functionArgs = coerceArgs(
          abiFn.args as ReadonlyArray<{ type: any }>,
          argValues
        );
        const senderAddress =
          opts?.senderAddress ?? getAddressFromPublicKey(bindings.publicKey, network);

        return fetchCallReadOnlyFunction({
          contractAddress,
          contractName,
          functionName: abiFn.name,
          functionArgs,
          senderAddress,
          network,
          client: bindings.client,
        });
      };
    }

    // public function
    return async (...rawArgs: unknown[]) => {
      const { argValues, opts } = splitArgsAndOpts<PerCallOptions>(rawArgs, arity);
      const functionArgs = coerceArgs(
        abiFn.args as ReadonlyArray<{ type: any }>,
        argValues
      );

      return makeUnsignedContractCallRaw({
        ...(opts ?? {}),
        contractAddress,
        contractName,
        functionName: abiFn.name,
        functionArgs,
        publicKey: opts?.publicKey ?? bindings.publicKey,
      });
    };
  }

  const target = Object.create(null) as Record<string, unknown>;

  const handler: ProxyHandler<typeof target> = {
    get(_t, prop) {
      // Strings only — short-circuit symbols (e.g. then-checks, Node inspect, etc.).
      if (typeof prop !== 'string') return undefined;

      const cached = methodCache.get(prop);
      if (cached) return cached;

      const abiFn = fnIndex.get(prop);
      if (!abiFn) return undefined;

      const method = buildMethod(abiFn);
      methodCache.set(prop, method);
      return method;
    },
    has(_t, prop) {
      return typeof prop === 'string' && fnIndex.has(prop);
    },
    ownKeys() {
      return Array.from(fnIndex.keys());
    },
    getOwnPropertyDescriptor(_t, prop) {
      if (typeof prop !== 'string' || !fnIndex.has(prop)) return undefined;
      return { configurable: true, enumerable: true, writable: false, value: undefined };
    },
  };

  return new Proxy(target, handler) as ProxyClient<B>;
}

/**
 * Split a raw argument array into ABI values and an optional trailing opts object.
 *
 * The rule is purely by arity: if there's exactly one extra argument it is the opts
 * object. Pre-built ClarityValues all carry a string `type` field, so they cannot be
 * misidentified as opts — but tuple inputs are plain records, hence arity-only.
 */
function splitArgsAndOpts<O>(
  raw: readonly unknown[],
  arity: number
): { argValues: readonly unknown[]; opts: O | undefined } {
  if (raw.length === arity) {
    return { argValues: raw, opts: undefined };
  }
  if (raw.length === arity + 1) {
    return { argValues: raw.slice(0, arity), opts: raw[arity] as O };
  }
  throw new Error(
    `Expected ${arity} or ${arity + 1} args (with opts), got ${raw.length}`
  );
}
