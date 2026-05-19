// This file is hand-authored to simulate what `clarinet typegen --branded-address`
// would emit for Approach H. The generated file emits:
//   1. The contract interface (types only).
//   2. A per-contract address constructor that brands a string.
//
// Consumers import the constructor as a value (single small runtime); types ride
// on it.

import type {
  BooleanCV,
  ResponseErrorCV,
  ResponseOkCV,
  UIntCV,
} from '@stacks/transactions';
import type { BrandedAddress } from '../../../src/approach-h';

// --- Per-function arg / return aliases (for readable hovers) ---

export type AddArgs = [UIntCV];
export type AddReturn = ResponseOkCV<BooleanCV> | ResponseErrorCV<UIntCV>;

export type DecrementArgs = [];
export type DecrementReturn = ResponseOkCV<BooleanCV> | ResponseErrorCV<UIntCV>;

export type IncrementArgs = [];
export type IncrementReturn = ResponseOkCV<BooleanCV> | ResponseErrorCV<UIntCV>;

export type GetCountArgs = [];
export type GetCountReturn = UIntCV;

export type GetCountAtBlockArgs = [UIntCV];
export type GetCountAtBlockReturn = ResponseOkCV<UIntCV> | ResponseErrorCV<UIntCV>;

// --- Contract interface — keyed by original Clarity (kebab-case) name ---

export interface CounterContract {
  contractName: 'counter';
  functions: {
    add: { args: AddArgs; return: AddReturn; access: 'public' };
    decrement: { args: DecrementArgs; return: DecrementReturn; access: 'public' };
    increment: { args: IncrementArgs; return: IncrementReturn; access: 'public' };
    'get-count': { args: GetCountArgs; return: GetCountReturn; access: 'read_only' };
    'get-count-at-block': {
      args: GetCountAtBlockArgs;
      return: GetCountAtBlockReturn;
      access: 'read_only';
    };
  };
}

/**
 * Brand a Stacks address string with the `CounterContract` interface. The
 * returned value is the original string at runtime; the cast attaches the
 * phantom contract type so subsequent `makeUnsignedContractCall` /
 * `fetchCallReadOnlyFunction` calls narrow every other field.
 */
export function counterAddress(addr: string): BrandedAddress<CounterContract> {
  return addr as BrandedAddress<CounterContract>;
}
