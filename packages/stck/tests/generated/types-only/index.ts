// This file is hand-authored to simulate what `clarinet typegen --types-only`
// would emit for Approach F. It is a barrel that composes every per-contract
// type into a single top-level `Contracts` type. Pure types — no runtime.

import type { CounterContract } from './counter';

export type * from './counter';

/**
 * The top-level type passed as the generic to `createClient<Contracts>`.
 *
 * Keys are contract "names" (the part after the dot in `${address}.${name}`).
 * Each value is `{ functions: { ... } }` matching the per-contract export.
 *
 * In real codegen each contract file would augment this interface via module
 * augmentation; here we compose it explicitly for clarity.
 */
export interface Contracts {
  counter: CounterContract;
}
