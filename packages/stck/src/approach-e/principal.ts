import type { ContractBundle } from '../brand';
import type { TypegenContractInterface } from '../approach-a';

/**
 * Phantom brand symbol used to attach the typed contract interface to a string.
 *
 * Declared as `unique symbol` so two `Principal<A>` and `Principal<B>` are not
 * mutually assignable, but `Principal<T>` remains a subtype of `string`.
 */
export declare const __principalBrand: unique symbol;

/**
 * A branded principal address.
 *
 * At the type level this is a `string` carrying a phantom contract interface `T`.
 * At runtime it IS a primitive string — you can concatenate, split, log, pass it
 * to any function that wants a `string`. The contract interface only appears at
 * compile time.
 *
 * The companion `call` / `read` helpers look up the bundle for this address from
 * a module-level registry populated by `principal()`. That decouples the runtime
 * carrier (a string) from the runtime ABI lookup needed for argument coercion.
 */
export type Principal<T extends TypegenContractInterface> = string & {
  readonly [__principalBrand]: T;
};

/**
 * Registry of branded address -> ABI bundle.
 *
 * Populated when `principal(bundle, addr)` is called; consumed by `call` / `read`
 * helpers in `./call.ts`. Keyed by the full `addr.contract` string.
 *
 * Tradeoff: the same address can only be registered against one bundle for a
 * given process. In practice an address-contract pair maps to one contract, so
 * this is fine — but if two different bundle imports both claim the same address
 * the later one wins. Documented limitation of this POC.
 */
const bundleRegistry = new Map<string, ContractBundle>();

/** Look up the bundle previously registered for a branded principal. */
export function getBundleFor(p: string): ContractBundle {
  const bundle = bundleRegistry.get(p);
  if (!bundle) {
    throw new Error(
      `No contract bundle registered for principal "${p}". ` +
        `Did you create it via principal(bundle, "...")?`
    );
  }
  return bundle;
}

/**
 * Construct a branded principal address.
 *
 * The first argument is the bundle (carrying the runtime ABI); the second is the
 * `address.contract` string. The returned value is the same string, branded with
 * the bundle's typed contract interface `T`.
 *
 * The interface `T` is inferred from the bundle's symbol-keyed brand — no explicit
 * generic needed at the call site.
 *
 * ```ts
 * import { principal } from "@stacks/stck";
 * import { counterContract } from "./generated/typed/counter";
 *
 * const counter = principal(counterContract, "ST1...counter");
 * //    ^? Principal<CounterContract>
 * ```
 */
export function principal<B extends ContractBundle>(
  bundle: B,
  address: `${string}.${string}`
): Principal<InterfaceOf<B>> {
  bundleRegistry.set(address, bundle);
  return address as Principal<InterfaceOf<B>>;
}

/**
 * Alternative constructor (option ii in the report): pre-bind a bundle once and
 * get a per-contract `principal` factory.
 *
 * ```ts
 * // generated/typed/counter.ts (or user-land helper)
 * export const counterPrincipal = definePrincipal(counterContract);
 *
 * // call site — no bundle import, no generic
 * const counter = counterPrincipal("ST1...counter");
 * //    ^? Principal<CounterContract>
 * ```
 */
export function definePrincipal<B extends ContractBundle>(
  bundle: B
): (address: `${string}.${string}`) => Principal<InterfaceOf<B>> {
  return (address) => principal(bundle, address);
}

/** Pull the typed contract interface out of a bundle's symbol-keyed brand. */
type InterfaceOf<B> = {
  [K in keyof B]: K extends symbol
    ? B[K] extends TypegenContractInterface
      ? B[K]
      : never
    : never;
}[keyof B];
