import type {
  BooleanCV,
  BufferCV,
  ClarityValue,
  IntCV,
  ListCV,
  NoneCV,
  PrincipalCV,
  SomeCV,
  StacksTransactionWire,
  StringAsciiCV,
  StringUtf8CV,
  TupleCV,
  UIntCV,
  UnsignedContractCallOptions,
} from '@stacks/transactions';
import {
  fetchCallReadOnlyFunction,
  getAddressFromPublicKey,
  makeUnsignedContractCall as makeUnsignedContractCallRaw,
} from '@stacks/transactions';
import type { ClientOpts } from '@stacks/common';
import type { StacksNetwork, StacksNetworkName } from '@stacks/network';
import type { TypegenContractInterface } from '../approach-a';
// Note: not using `CvToPrimitive` directly — ts-jest hits TS2589 recursion
// limits when the mapped type combines `infer` extraction from a deeply-nested
// branded Principal type. We inline a flatter mapper below.
import { toClarityValue, type AbiAtomType } from '../coerce';
import { findClarityFunctionName, kebabToCamel } from '../common';
import { getBundleFor, type Principal } from './principal';

// -----------------------------------------------------------------------------
// Type-level helpers
// -----------------------------------------------------------------------------

/** Extract the typed interface from a `Principal<T>`. */
type InterfaceOf<P> = P extends Principal<infer T> ? T : never;

/** All function names defined on the interface. */
type Functions<P> = InterfaceOf<P> extends { functions: infer F } ? keyof F & string : never;

/** Functions map on the interface. */
type FunctionsMap<P> = InterfaceOf<P> extends { functions: infer FM } ? FM : never;

/** Args record shape declared on the interface for `F` (e.g. `{ n: UIntCV }`). */
type ArgsOf<P, F extends string> = F extends keyof FunctionsMap<P>
  ? FunctionsMap<P>[F] extends { args: infer A }
    ? A
    : never
  : never;

/** Return ClarityValue declared on the interface for `F`. */
type ReturnOf<P, F extends string> = F extends keyof FunctionsMap<P>
  ? FunctionsMap<P>[F] extends { return: infer R }
    ? R
    : never
  : never;

/**
 * Map a single CV type to its accepted JS-primitive input. Flat (non-recursive
 * for compound types — list/tuple/optional/some are accepted as already-built
 * ClarityValues via the `| ClarityValue` fallback in `ArgInput`).
 *
 * We avoid the package's recursive `CvToPrimitive` here: ts-jest hits TS2589
 * type-instantiation depth when it tries to evaluate the recursive variant
 * through this approach's branded-principal phantom chain, even though tsc
 * accepts it. The flatter shape is good enough for the leaf types and falls
 * back to `ClarityValue` for compound types.
 */
type CvPrim<T> = T extends UIntCV
  ? number | bigint
  : T extends IntCV
    ? number | bigint
    : T extends BooleanCV
      ? boolean
      : T extends NoneCV
        ? null
        : T extends PrincipalCV
          ? string
          : T extends BufferCV
            ? Uint8Array | string
            : T extends StringUtf8CV | StringAsciiCV
              ? string
              : T extends SomeCV<any> | ListCV<any> | TupleCV<any>
                ? never // force callers to pass a pre-built CV for compound types
                : never;

/** Accepted input for a single declared CV arg — primitive form OR the CV itself. */
type ArgInput<T> = T extends ClarityValue ? CvPrim<T> | T : never;

/**
 * Convert the interface's args record (e.g. `{ n: UIntCV }`) to the value the
 * caller actually writes (e.g. `{ n: number | bigint | UIntCV }`).
 *
 * For functions that take no args, the interface uses `Record<string, never>`,
 * which collapses to `{}` — we still require the empty object to keep call shape
 * uniform: `call(p, "increment", {})`.
 */
type ArgInputs<A> = [A] extends [Record<string, never>]
  ? Record<string, never>
  : { [K in keyof A]: ArgInput<A[K]> };

// -----------------------------------------------------------------------------
// Per-call options
// -----------------------------------------------------------------------------

/** Per-call options for a public function call. `publicKey` is REQUIRED here
 * (there's no bound binding — the principal alone carries no key). */
export type CallOptions = { publicKey: string } & Partial<
  Omit<
    UnsignedContractCallOptions,
    'contractAddress' | 'contractName' | 'functionName' | 'functionArgs' | 'publicKey'
  >
>;

/** Per-call options for a read-only function call. */
export type ReadOptions = {
  /** Sender address for the simulated call. Defaults to the address derived from
   * `publicKey` if supplied. One of `senderAddress` / `publicKey` is required. */
  senderAddress?: string;
  publicKey?: string;
  network?: StacksNetworkName | StacksNetwork;
  client?: ClientOpts;
};

// -----------------------------------------------------------------------------
// Runtime helpers
// -----------------------------------------------------------------------------

/**
 * Coerce a named-record of arg values into the ABI's positional `ClarityValue[]`.
 *
 * Driven by the ABI's `args` ordering — the source of truth for positional layout.
 * Each arg is looked up by its declared name in the input record and run through
 * the standard `toClarityValue` coercion.
 */
function coerceArgsByName(
  abiArgs: ReadonlyArray<{ name: string; type: AbiAtomType }>,
  values: Record<string, unknown>
): ClarityValue[] {
  return abiArgs.map((a) => {
    if (!(a.name in values)) {
      throw new Error(`Missing argument "${a.name}"`);
    }
    return toClarityValue(a.type, values[a.name]);
  });
}

/** Locate the ABI fn by its camelCased name and confirm its access type. */
function resolveFn(
  address: string,
  camelName: string,
  required: 'public' | 'read_only'
) {
  const bundle = getBundleFor(address);
  const clarityName = findClarityFunctionName(bundle, camelName);
  const abiFn = bundle.functions.find((f) => f.name === clarityName);
  if (!abiFn) throw new Error(`Function "${clarityName}" not found in ABI`);
  if (abiFn.access !== required) {
    const hint =
      required === 'public'
        ? `Use \`read(...)\` for read-only functions.`
        : `Use \`call(...)\` for public functions.`;
    throw new Error(
      `Function "${clarityName}" is "${abiFn.access}", expected "${required}". ${hint}`
    );
  }
  return { bundle, abiFn, clarityName };
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Make an unsigned contract call to a public function on a branded principal.
 *
 * The function name is restricted at compile time to the principal's typed
 * interface; the args record is checked against the function's declared shape.
 *
 * ```ts
 * await call(counter, "add", { n: 5n }, { publicKey });
 * ```
 */
export async function call<
  P extends Principal<TypegenContractInterface>,
  F extends Functions<P>,
>(
  p: P,
  functionName: F,
  args: ArgInputs<ArgsOf<P, F>>,
  opts: CallOptions
): Promise<StacksTransactionWire> {
  const { abiFn, clarityName } = resolveFn(p, functionName, 'public');
  const [contractAddress, contractName] = (p as string).split('.') as [string, string];
  const functionArgs = coerceArgsByName(
    abiFn.args as ReadonlyArray<{ name: string; type: AbiAtomType }>,
    (args as Record<string, unknown>) ?? {}
  );

  const { publicKey, ...rest } = opts;
  return makeUnsignedContractCallRaw({
    ...rest,
    contractAddress,
    contractName,
    functionName: clarityName,
    functionArgs,
    publicKey,
  });
}

/**
 * Fetch the result of a read-only function on a branded principal.
 *
 * Returns the precise `ClarityValue` declared by the function's interface — no
 * widening to `ClarityValue`.
 *
 * ```ts
 * const count = await read(counter, "getCount", {});
 * //    ^? UIntCV
 * ```
 */
export async function read<
  P extends Principal<TypegenContractInterface>,
  F extends Functions<P>,
>(
  p: P,
  functionName: F,
  args: ArgInputs<ArgsOf<P, F>>,
  opts?: ReadOptions
): Promise<ReturnOf<P, F>> {
  const { abiFn, clarityName } = resolveFn(p, functionName, 'read_only');
  const [contractAddress, contractName] = (p as string).split('.') as [string, string];
  const functionArgs = coerceArgsByName(
    abiFn.args as ReadonlyArray<{ name: string; type: AbiAtomType }>,
    (args as Record<string, unknown>) ?? {}
  );

  const network = opts?.network ?? 'mainnet';
  const senderAddress =
    opts?.senderAddress ??
    (opts?.publicKey ? getAddressFromPublicKey(opts.publicKey, network) : undefined);
  if (!senderAddress) {
    throw new Error('read(): provide either `senderAddress` or `publicKey` in opts');
  }

  const result = await fetchCallReadOnlyFunction({
    contractAddress,
    contractName,
    functionName: clarityName,
    functionArgs,
    senderAddress,
    network,
    client: opts?.client,
  });
  return result as ReturnOf<P, F>;
}

// -----------------------------------------------------------------------------
// Proxy variant — bound bindings, methods named after the contract's functions
// -----------------------------------------------------------------------------

/** Bindings shared across every call made through a bound proxy. */
export interface BoundBindings {
  publicKey: string;
  network?: StacksNetworkName | StacksNetwork;
  client?: ClientOpts;
}

/** Per-call options on a bound proxy method (publicKey is already bound). */
export type BoundCallOptions = Partial<
  Omit<
    UnsignedContractCallOptions,
    'contractAddress' | 'contractName' | 'functionName' | 'functionArgs'
  >
>;

export type BoundReadOptions = { senderAddress?: string };

/**
 * A bound client built from a branded principal — one method per Clarity function.
 *
 * Caveat: the typed interface doesn't carry access info, so each method's signature
 * is a UNION of the public-call and read-only-call shapes. The return type is
 * `Promise<StacksTransactionWire | ReturnOf<P, F>>` — the caller will typically
 * know which one to expect and narrow accordingly (or cast the result).
 *
 * If you want precise return types for read-only calls, use the `read()` helper
 * directly — it has full type narrowing.
 */
export type BoundClient<P extends Principal<TypegenContractInterface>> = {
  [F in Functions<P>]: (
    args: ArgInputs<ArgsOf<P, F>>,
    opts?: BoundCallOptions | BoundReadOptions
  ) => Promise<StacksTransactionWire | ReturnOf<P, F>>;
};

/**
 * Bind a principal with a `publicKey` (and optionally network/client) and get a
 * proxy whose methods are the contract's functions.
 *
 * ```ts
 * const counter = bind(principal(counterContract, "ST1...counter"), { publicKey });
 * await counter.add({ n: 5n });
 * const count = await counter.getCount({});
 * ```
 */
export function bind<P extends Principal<TypegenContractInterface>>(
  p: P,
  bindings: BoundBindings
): BoundClient<P> {
  const address = p as string;
  const bundle = getBundleFor(address);
  const [contractAddress, contractName] = address.split('.') as [string, string];
  const network = bindings.network ?? 'mainnet';

  // Index ABI fns by camelCase for O(1) dispatch.
  const fnIndex = new Map<string, (typeof bundle.functions)[number]>();
  for (const fn of bundle.functions) fnIndex.set(kebabToCamel(fn.name), fn);

  const methodCache = new Map<string, (...args: unknown[]) => Promise<unknown>>();

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      const cached = methodCache.get(prop);
      if (cached) return cached;
      const abiFn = fnIndex.get(prop);
      if (!abiFn) return undefined;

      const fn =
        abiFn.access === 'read_only'
          ? async (args: Record<string, unknown>, opts?: BoundReadOptions) => {
              const functionArgs = coerceArgsByName(
                abiFn.args as ReadonlyArray<{ name: string; type: AbiAtomType }>,
                args ?? {}
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
            }
          : async (args: Record<string, unknown>, opts?: BoundCallOptions) => {
              const functionArgs = coerceArgsByName(
                abiFn.args as ReadonlyArray<{ name: string; type: AbiAtomType }>,
                args ?? {}
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
      methodCache.set(prop, fn as (...args: unknown[]) => Promise<unknown>);
      return fn;
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

  return new Proxy(Object.create(null) as Record<string, unknown>, handler) as BoundClient<P>;
}
