import type { ContractBundle } from '../brand';

/**
 * Phantom brand key for principals tagged with a contract bundle.
 *
 * The brand is optional in the type so `Principal<B>` is structurally assignable
 * to plain `string` — and any plain `${string}.${string}` is assignable to
 * `Principal<B>` only when explicitly cast. Authored values must go through
 * {@link principal}, which captures the bundle at runtime via the registry.
 */
declare const __principalBundle: unique symbol;

/**
 * A `${address}.${name}` string branded (at the type level) with the bundle it
 * refers to.
 *
 * `Principal<B>` is a *subtype* of `string` — it flows unchanged into any
 * existing `@stacks/transactions` function field typed as `string`. No casts,
 * no wrappers required at the call site for type compatibility.
 *
 * The brand exists only at the type level; the runtime value is the underlying
 * primitive string. The associated bundle is recovered from a module-local
 * `WeakMap` keyed by *the constructed wrapper objects*, NOT by the primitive —
 * see {@link principal} and {@link getBundle}.
 */
export type Principal<B extends ContractBundle> = `${string}.${string}` & {
  readonly [__principalBundle]?: B;
};

/**
 * Module-local registry mapping primitive principal strings to their bundle.
 *
 * Primitive strings can't be WeakMap keys, so we use a plain Map. This is
 * acceptable because the number of distinct deployed contract principals an
 * app references is finite and small.
 */
const bundleRegistry = new Map<string, ContractBundle>();

/**
 * Construct a branded principal value pointing at a deployed instance of `bundle`.
 *
 * The result is a primitive string at runtime — interchangeable with any
 * `string` parameter (in particular, `@stacks/transactions` accepts it without
 * a cast). The bundle is captured both at the type level (via the brand) and
 * at runtime (via the module registry) so downstream helpers can derive
 * function metadata without a second argument.
 */
export function principal<B extends ContractBundle>(
  bundle: B,
  address: `${string}.${string}`
): Principal<B> {
  bundleRegistry.set(address, bundle);
  return address as Principal<B>;
}

/**
 * Recover the bundle associated with a branded principal at runtime. Throws
 * if `p` was not constructed via {@link principal}.
 */
export function getBundle<B extends ContractBundle>(p: Principal<B>): B {
  const b = bundleRegistry.get(p as unknown as string);
  if (!b) {
    throw new Error(
      `No bundle registered for principal "${p as string}". Construct it via principal(bundle, address).`
    );
  }
  return b as B;
}

/**
 * Split a `${address}.${name}` principal into its two halves. `@stacks/transactions`'
 * contract-call options keep address and name as separate fields, so every
 * helper in this module ends up doing this split.
 */
export function splitPrincipal<B extends ContractBundle>(
  p: Principal<B>
): { contractAddress: string; contractName: string } {
  const s = p as unknown as string;
  const dot = s.indexOf('.');
  if (dot < 0) throw new Error(`Invalid principal "${s}" — expected "address.name"`);
  return { contractAddress: s.slice(0, dot), contractName: s.slice(dot + 1) };
}
