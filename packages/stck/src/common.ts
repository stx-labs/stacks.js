export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** Convert kebab-case to camelCase (must match Clarinet's clarity_to_camel in Rust) */
export function kebabToCamel(name: string): string {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Type-level counterpart of `kebabToCamel`: converts a kebab-case literal type to camelCase. */
export type KebabToCamel<S extends string> = S extends `${infer A}-${infer B}${infer Rest}`
  ? `${A}${Uppercase<B>}${KebabToCamel<Rest>}`
  : S;

/** Find the original Clarity function name from a camelCase key (for Approach A) */
export function findClarityFunctionName(
  abi: { functions: readonly { name: string }[] },
  camelKey: string
): string {
  const match = abi.functions.find(f => kebabToCamel(f.name) === camelKey);
  if (!match) throw new Error(`No function matching "${camelKey}" in ABI`);
  return match.name;
}
