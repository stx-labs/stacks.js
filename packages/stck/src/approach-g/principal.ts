/**
 * Approach G — minimal type-only branded principal.
 *
 * Variation of Approach E: the brand carries a TYPE only. No runtime bundle,
 * no module-local ABI registry. The `principal<T>(addr)` constructor is the
 * identity at runtime — it's a cast that attaches the phantom type parameter.
 *
 * Consequence: argument coercion (`5` -> `Cl.uint(5)`) is NOT supported.
 * Callers must pass pre-built `ClarityValue[]`. The minimal brand is the price
 * paid for skipping any per-contract runtime artifact.
 */

/**
 * A branded `${addr}.${name}` literal. `T` is the contract interface — typically
 * `{ functions: { [name]: { args; return; access } } }` matching the types-only
 * codegen shape (see `tests/generated/types-only/counter.ts`).
 *
 * The brand is REQUIRED (not optional), so `Principal<A>` and `Principal<B>`
 * are mutually unassignable when `A != B`. Side-effect: a `Principal<T>` is
 * not assignable to plain `string` — callers must use approach G's own
 * `call`/`read`, not the raw `@stacks/transactions` API.
 */
export type Principal<T> = `${string}.${string}` & { readonly __contract: T };

/**
 * Construct a branded principal. Identity at runtime; the cast attaches `T`.
 *
 *     import type { CounterContract } from "./gen/types-only/counter";
 *     const counter = principal<CounterContract>("ST1PQHQ.counter");
 *     //    ^? Principal<CounterContract>
 */
export function principal<T>(addr: `${string}.${string}`): Principal<T> {
  return addr as Principal<T>;
}

/** Split a branded principal into `[contractAddress, contractName]`. */
export function splitPrincipal(p: Principal<unknown>): [string, string] {
  const [addr, name] = (p as string).split('.');
  if (!addr || !name) throw new Error(`Invalid principal: ${p as string}`);
  return [addr, name];
}
