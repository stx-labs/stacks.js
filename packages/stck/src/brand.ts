import type { TypegenContractInterface } from './approach-a';

/**
 * A contract bundle is the single object emitted by Clarinet's `clarity-ts-typegen`,
 * fusing the runtime ABI (the `as const` literal) with a phantom symbol-keyed brand
 * pointing at the typed `TypegenContractInterface`.
 *
 * The wrapper consumes the bundle as one argument and infers both the runtime ABI
 * shape and the typed interface from it.
 */
export type ContractBundle = {
  readonly functions: readonly {
    name: string;
    access: string;
    args: readonly { name: string; type: unknown }[];
    outputs: { type: unknown };
  }[];
};

/**
 * Pull the brand value (the `TypegenContractInterface`) out of a bundle.
 *
 * The codegen emits the bundle with a single symbol-keyed property whose value is
 * the typed interface. We match structurally: scan keys, return the value at the
 * one symbol key. Avoids cross-package `unique symbol` identity issues.
 */
export type ExtractContractInterface<B> = {
  [K in keyof B]: K extends symbol
    ? B[K] extends TypegenContractInterface
      ? B[K]
      : never
    : never;
}[keyof B];
