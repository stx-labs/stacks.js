/**
 * Approach H — typed overloads of @stacks/transactions, branded on the
 * `contractAddress` field. Same call shape, same function names, no helpers
 * to thread args through. The brand on the address narrows every other field.
 */

// The phantom brand is REQUIRED (not optional). This is deliberate so that:
// - Overload resolution picks the typed overload when (and only when) a
//   branded value is passed. There is no silent fallback to the raw signature.
// - `string` is NOT assignable to `BrandedAddress<T>` — only the constructor
//   from a generated module can produce one.
// Tradeoff: `BrandedAddress<T>` IS assignable to `string` (it's a subtype),
// so a branded address can still be passed to any raw `string`-accepting API.
declare const __addressBrand: unique symbol;
export type BrandedAddress<T> = string & { readonly [__addressBrand]: T };

/**
 * A plain string whose `__addressBrand` is REQUIRED to be absent (`?: never`).
 * Used as the `contractAddress` field of the raw overload so that a
 * `BrandedAddress<T>` is NOT structurally assignable to it — that prevents
 * branded values from silently falling through the raw fallback overload
 * whenever the typed overload rejects them. Plain string literals satisfy
 * this because the brand property is optional and absent.
 */
export type UnbrandedAddress = string & { readonly [__addressBrand]?: never };

// ---------------------------------------------------------------------------
// Type-level views of the contract interface emitted by codegen. The interface
// shape:
//
//   { contractName: 'counter';
//     functions: {
//       add: { args: [UIntCV]; return: ...; access: 'public' };
//       'get-count': { args: []; return: UIntCV; access: 'read_only' };
//     } }
// ---------------------------------------------------------------------------

type Functions<T> = T extends { functions: infer F } ? F : never;

export type ContractNameOf<T> = T extends { contractName: infer N }
  ? N & string
  : never;

export type PublicNames<T> = {
  [K in keyof Functions<T>]: Functions<T>[K] extends { access: 'public' }
    ? K
    : never;
}[keyof Functions<T>] &
  string;

export type ReadOnlyNames<T> = {
  [K in keyof Functions<T>]: Functions<T>[K] extends { access: 'read_only' }
    ? K
    : never;
}[keyof Functions<T>] &
  string;

export type ArgsOf<T, K extends string> = K extends keyof Functions<T>
  ? Functions<T>[K] extends { args: infer A }
    ? A
    : never
  : never;

export type ReturnOf<T, K extends string> = K extends keyof Functions<T>
  ? Functions<T>[K] extends { return: infer R }
    ? R
    : never
  : never;
