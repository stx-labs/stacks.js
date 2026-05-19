/**
 * Approach H — same-name re-exports of `makeUnsignedContractCall` and
 * `fetchCallReadOnlyFunction` from `@stacks/transactions` with type safety
 * added when `contractAddress` is a `BrandedAddress<T>`. Same call shape,
 * same field set, no helpers to thread args through. Plain `string`
 * addresses keep the original behaviour.
 */
import {
  makeUnsignedContractCall as makeUnsignedContractCallRaw,
  fetchCallReadOnlyFunction as fetchCallReadOnlyFunctionRaw,
} from '@stacks/transactions';
import type {
  ClarityValue,
  StacksTransactionWire,
  UnsignedContractCallOptions,
} from '@stacks/transactions';
import type {
  ArgsOf,
  BrandedAddress,
  ContractNameOf,
  PublicNames,
  ReadOnlyNames,
  ReturnOf,
} from './brand';

// Per-FIELD conditionals (rather than per-whole-object) so each diagnostic
// lands on the specific field that's wrong instead of the whole literal.
type ContractNameField<TAddr> = TAddr extends BrandedAddress<infer T>
  ? ContractNameOf<T>
  : string;

type ArgsField<TAddr, F extends string> = TAddr extends BrandedAddress<infer T>
  ? F extends PublicNames<T>
    ? ArgsOf<T, F>
    : ClarityValue[]
  : ClarityValue[];

type ReadOnlyArgsField<TAddr, F extends string> = TAddr extends BrandedAddress<infer T>
  ? F extends ReadOnlyNames<T>
    ? ArgsOf<T, F>
    : ClarityValue[]
  : ClarityValue[];

// Constraint on F: when branded, must be a public function name; otherwise
// any string. This makes wrong-name errors fire on the F generic position.
type PublicFnConstraint<TAddr> = TAddr extends BrandedAddress<infer T>
  ? PublicNames<T>
  : string;

type ReadOnlyFnConstraint<TAddr> = TAddr extends BrandedAddress<infer T>
  ? ReadOnlyNames<T>
  : string;

// Common pass-through fields from the underlying options type.
type CommonUnsignedFields = Omit<
  UnsignedContractCallOptions,
  'contractAddress' | 'contractName' | 'functionName' | 'functionArgs'
>;

// ─── makeUnsignedContractCall ─────────────────────────────────────────────

export function makeUnsignedContractCall<
  TAddr extends string,
  F extends PublicFnConstraint<TAddr> = PublicFnConstraint<TAddr>,
>(
  options: CommonUnsignedFields & {
    contractAddress: TAddr;
    contractName: ContractNameField<TAddr>;
    functionName: F;
    functionArgs: ArgsField<TAddr, F>;
  }
): Promise<StacksTransactionWire> {
  return makeUnsignedContractCallRaw(options as unknown as UnsignedContractCallOptions);
}

// ─── fetchCallReadOnlyFunction ────────────────────────────────────────────

type RawReadOnlyOptions = Parameters<typeof fetchCallReadOnlyFunctionRaw>[0];

type CommonReadOnlyFields = Omit<
  RawReadOnlyOptions,
  'contractAddress' | 'contractName' | 'functionName' | 'functionArgs'
>;

type ReadReturn<TAddr, F extends string> = TAddr extends BrandedAddress<infer T>
  ? F extends ReadOnlyNames<T>
    ? ReturnOf<T, F>
    : ClarityValue
  : ClarityValue;

export function fetchCallReadOnlyFunction<
  TAddr extends string,
  F extends ReadOnlyFnConstraint<TAddr> = ReadOnlyFnConstraint<TAddr>,
>(
  options: CommonReadOnlyFields & {
    contractAddress: TAddr;
    contractName: ContractNameField<TAddr>;
    functionName: F;
    functionArgs: ReadOnlyArgsField<TAddr, F>;
  }
): Promise<ReadReturn<TAddr, F>> {
  return fetchCallReadOnlyFunctionRaw(options as RawReadOnlyOptions) as Promise<
    ReadReturn<TAddr, F>
  >;
}
