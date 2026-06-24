# Package.json Inconsistencies

## Critical Issues

### 1. storage package has conflicting `@stacks/network` dependency
- `dependencies`: `@stacks/network: ^7.3.1`
- `devDependencies`: `@stacks/network: ^4.1.0`
- Major version mismatch (v4 vs v7) will cause resolution conflicts

### 2. `@stacks/blockchain-api-client` version mismatch
- `cli`: `4.0.1` (pinned, major version 4)
- `stacking`: `^7.3.0` (major version 7)
- `internal`: `^7.12.0` (major version 7, higher patch)
- Completely incompatible versions across packages

---

## Repository & Bug URL Inconsistencies

### Repository URLs
- **Most packages**: `git+https://github.com/stx-labs/stacks.js.git` (correct)
- **bns, common**: `git+https://github.com/blockstack/stacks.js.git` (old org)

### Bug URLs
- **transactions, api**: `https://github.com/stx-labs/stacks.js/issues` (correct)
- **All other packages**: `https://github.com/blockstack/blockstack.js/issues` (wrong repo entirely)

---

## Missing Fields

| Field | Missing from |
|-------|-------------|
| `keywords` | encryption, wallet-sdk, network, stacking, cli, storage, transactions, common, api, internal |
| `repository` | wallet-sdk, internal |
| `bugs` | wallet-sdk, internal |
| `homepage` | wallet-sdk |
| `publishConfig.access` | encryption, auth, bns, stacking, storage, profile |
| `browser` | wallet-sdk, network, common, bns, stacking, transactions, api, internal |

---

## Script Inconsistencies

| Script | Present in | Missing from |
|--------|-----------|-------------|
| `lint`, `lint:eslint`, `lint:prettier` | wallet-sdk only | all others |
| `depcheck` | wallet-sdk only | all others |
| `dev` (tsdx watch) | wallet-sdk only | all others |
| `build:esm`, `build:umd` | all except cli | cli |

- **wallet-sdk** uses `jest --coverage` in test script; all others use plain `jest`

---

## Cross-Dependency Notes

- All packages that depend on `@stacks/common` use `^7.3.1` (consistent)
- `@stacks/blockchain-api-types` used consistently at `^0.61.0` in stacking and api
- License (`MIT`) and author (`Hiro Systems PBC`) are consistent across all packages
