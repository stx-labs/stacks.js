// This file is hand-authored to simulate what `clarinet typegen --types-only`
// would emit for Approach F.
//
// IMPORTANT: This file contains NO runtime values. Every export is a `type`.
// Consumers MUST import it with `import type { ... } from "..."` — the entire
// file is erased at build time, matching the openapi-typescript model.

import type {
  BooleanCV,
  ResponseErrorCV,
  ResponseOkCV,
  UIntCV,
} from '@stacks/transactions';

// --- Per-function arg / return aliases (mirrors typed/counter.ts for readable hovers) ---

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

// --- Function map: keyed by original Clarity (kebab-case) name ---

export type CounterFunctions = {
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

// --- The contract entry. The barrel composes these into a `Contracts` type. ---

export type CounterContract = {
  functions: CounterFunctions;
};
