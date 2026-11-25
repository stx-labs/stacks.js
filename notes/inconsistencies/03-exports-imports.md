# Export & Import Pattern Inconsistencies

## Index File Structure

### Standard pattern (barrel file with `export *`)
Used by: common, encryption, network, api, wallet-sdk

### Monolithic index files (implementation in index.ts)
- **bns** (`src/index.ts`, 819 lines): Contains 30+ function implementations directly in index.ts, no `export *` statements
- **stacking** (`src/index.ts`, 1749 lines): Contains 29 inline exports plus implementation code; only 1 wildcard export

These two packages break the barrel file convention entirely.

### Mixed style (wildcard + named exports)
- **auth**: 4 wildcard + 5 named exports
- **encryption**: 7 wildcard + 1 named export
- **storage**: 1 wildcard + 1 named export

### Unique patterns
- **cli**: Only exports `CLIMain`; includes shebang and global window setup code

---

## Redundant Re-exports in Transactions

`packages/transactions/src/index.ts`:
- Line 2: `export * from './authorization'` (wildcard — includes everything)
- Lines 3-10: Explicit named exports from the same `./authorization` module

The named exports are already included in the wildcard, making them redundant.

---

## Incomplete Barrel in Transactions/Clarity

`packages/transactions/src/clarity/index.ts`:
- Contains TODO comment: `// todo: use 'export *' for more exports here`
- Uses selective named exports instead of wildcard

---

## Namespace Exports (Unique to Transactions)

Only the transactions package uses namespace aliases:
- `export * as Cl from './cl'`
- `export * as Pc from './pc'`
- `export * as Address from './address'` (nested in namespaces/)

No other package uses this pattern.

---

## Cross-Package Import Encapsulation

No encapsulation violations found — all cross-package imports use proper `@stacks/*` package names, not relative paths or `/src/` imports.
