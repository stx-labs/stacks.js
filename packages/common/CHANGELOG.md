# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [7.3.1](https://github.com/stx-labs/stacks.js/compare/v7.3.0...v7.3.1) (2025-12-16)

**Note:** Version bump only for package @stacks/common





## [7.0.2](https://github.com/hirosystems/stacks.js/compare/v7.0.1...v7.0.2) (2024-11-14)


### Bug Fixes

* update tsdoc comments to expose internal methods ([#1761](https://github.com/hirosystems/stacks.js/issues/1761)) ([2f2b12b](https://github.com/hirosystems/stacks.js/commit/2f2b12b23be95e10210af72fc3cea32fb27f024f))



## [7.0.0](https://github.com/hirosystems/stacks.js/compare/v6.17.0...v7.0.0) (2024-10-25)

### ⚠ BREAKING CHANGES

See full list of changes at [MIGRATION.md](https://github.com/hirosystems/stacks.js/blob/main/.github/MIGRATION.md)

## [6.16.0](https://github.com/hirosystems/stacks.js/compare/v6.15.0...v6.16.0) (2024-06-30)

### Features

- Add non-sequential multi-sig support (and fix legacy multi-sig bugs) ([#1710](https://github.com/hirosystems/stacks.js/issues/1710)) ([879263c](https://github.com/hirosystems/stacks.js/commit/879263cb5f3fb896b868ccaac00b4a8d635054ff))
- Allow `0x` prefix in hexToBytes helper ([#1690](https://github.com/hirosystems/stacks.js/issues/1690)) ([33ca645](https://github.com/hirosystems/stacks.js/commit/33ca64598b639fbe2a752e8f2055c8e0053f44a1))

## [6.13.0](https://github.com/hirosystems/stacks.js/compare/v6.12.1...v6.13.0) (2024-03-22)

**Note:** Version bump only for package @stacks/common

## [6.10.0](https://github.com/hirosystems/stacks.js/compare/v6.9.0...v6.10.0) (2023-11-28)

**Note:** Version bump only for package @stacks/common

## [6.8.1](https://github.com/hirosystems/stacks.js/compare/v6.8.0...v6.8.1) (2023-09-18)

### Bug Fixes

- add peer network id ([db5a596](https://github.com/hirosystems/stacks.js/commit/db5a5965a4b1941217b56c93dab92191e2b80913))

## [6.8.0](https://github.com/hirosystems/stacks.js/compare/v6.7.0...v6.8.0) (2023-09-04)

**Note:** Version bump only for package @stacks/common

## [6.5.5](https://github.com/hirosystems/stacks.js/compare/v6.5.4...v6.5.5) (2023-07-14)

### Bug Fixes

- throw error if the number type used in the bigint constructor is not a safe integer value ([d6a6fcc](https://github.com/hirosystems/stacks.js/commit/d6a6fcc30e4306d90da091e2538a281968dc9ac4))

## [6.5.2](https://github.com/hirosystems/stacks.js/compare/v6.5.1...v6.5.2) (2023-04-28)

### Bug Fixes

- add `Cl` helper ([#1479](https://github.com/hirosystems/stacks.js/issues/1479)) ([c116a85](https://github.com/hirosystems/stacks.js/commit/c116a851c499d26326f94c368d74d75d0bf76627))

## [6.0.0](https://github.com/hirosystems/stacks.js/compare/v5.0.3...v6.0.0) (2022-11-23)

**Note:** Version bump only for package @stacks/bns

## [5.0.3](https://github.com/hirosystems/stacks.js/compare/v5.0.2...v5.0.3) (2022-11-18)

**Note:** Version bump only for package @stacks/common

## [5.0.0](https://github.com/hirosystems/stacks.js/compare/v4.3.8...v5.0.0) (2022-09-30)

### ⚠ BREAKING CHANGES

- remove previously deprecated functions
- Removes compatibility with `bip32` package from @stacks/wallet-sdk. Now all derivation methods only rely on HDKey from @scure/bip32.
- To reduce the bundle sizes of applications using Stacks.js we are moving away from Buffer (a polyfill to match Node.js APIs) to Uint8Arrays (which Buffers use in the background anyway). To make the switch easier we have introduced a variety of methods for converting between strings and Uint8Arrays: `hexToBytes`, `bytesToHex`, `utf8ToBytes`, `bytesToUtf8`, `asciiToBytes`, `bytesToAscii`, and `concatBytes`.

### Features

- switch from buffer to uint8array ([#1343](https://github.com/hirosystems/stacks.js/issues/1343)) ([5445b73](https://github.com/hirosystems/stacks.js/commit/5445b73e05ec0c09414395331bfd37788545f1e1))

### Bug Fixes

- remove duplicate helper method ([f57bbef](https://github.com/hirosystems/stacks.js/commit/f57bbeffb898b9073cc8f15457ca4032dcc28d45))
- remove previously deprecated functions ([b2a5f96](https://github.com/hirosystems/stacks.js/commit/b2a5f96fd24e8da7cb9b4e1cf4d7b654f6e5b00c))

## [4.3.5](https://github.com/hirosystems/stacks.js/compare/v4.3.4...v4.3.5) (2022-08-23)

**Note:** Version bump only for package @stacks/common

## [4.3.4](https://github.com/hirosystems/stacks.js/compare/v4.3.3...v4.3.4) (2022-08-02)

**Note:** Version bump only for package @stacks/common

## [4.3.2](https://github.com/hirosystems/stacks.js/compare/v4.3.1...v4.3.2) (2022-07-11)

**Note:** Version bump only for package @stacks/common

# [4.3.0](https://github.com/hirosystems/stacks.js/compare/v4.2.2...v4.3.0) (2022-06-16)

**Note:** Version bump only for package @stacks/common

# [4.2.0](https://github.com/hirosystems/stacks.js/compare/v4.1.2...v4.2.0) (2022-05-25)

### Bug Fixes

- offload bitcoinjs from stacking, closes [#1259](https://github.com/hirosystems/stacks.js/issues/1259) ([8912bca](https://github.com/hirosystems/stacks.js/commit/8912bca06b1281e453ff09b3513f0e08906eeae6))

### Features

- add missing rsv functions ([4e7fcf5](https://github.com/hirosystems/stacks.js/commit/4e7fcf5b9ae2000a903d49ac31a424349f839637))

# [4.1.0](https://github.com/blockstack/blockstack.js/compare/v4.0.2...v4.1.0) (2022-05-19)

### Features

- add fetch middleware for api keys and request init ([ef45632](https://github.com/blockstack/blockstack.js/commit/ef456327a3e1dcdc2aa364cbe55e47225029c5d2))

## [4.0.2](https://github.com/blockstack/blockstack.js/compare/v4.0.2-beta.1...v4.0.2) (2022-05-19)

### Bug Fixes

- **message-signing:** add working utility fn ([20b721c](https://github.com/blockstack/blockstack.js/commit/20b721cdccc2fb73f98aad80eb6d5e8e9cb987d0))

## [4.0.1](https://github.com/blockstack/blockstack.js/compare/v4.0.1-beta.1...v4.0.1) (2022-05-09)

### Bug Fixes

- allow referrer header in request options ([70ea915](https://github.com/blockstack/blockstack.js/commit/70ea9156f6916f32e40adf7464322476a9acd8ab))

# [4.0.0](https://github.com/blockstack/blockstack.js/compare/v4.0.0-beta.2...v4.0.0) (2022-04-20)

**Note:** Version bump only for package @stacks/common

# [3.5.0](https://github.com/blockstack/blockstack.js/compare/v3.5.0-beta.3...v3.5.0) (2022-03-30)

**Note:** Version bump only for package @stacks/common

# [3.3.0](https://github.com/blockstack/blockstack.js/compare/v3.2.1-beta.0...v3.3.0) (2022-02-23)

**Note:** Version bump only for package @stacks/common

## [3.2.1-beta.0](https://github.com/blockstack/blockstack.js/compare/v3.2.0...v3.2.1-beta.0) (2022-02-23)

### Bug Fixes

- use noble-secp256k1 in transaction to replace elliptic dependency ([534f1b8](https://github.com/blockstack/blockstack.js/commit/534f1b8acf5ab1267860af0d2a9f1ba19bb35303))

## [2.0.1](https://github.com/blockstack/blockstack.js/compare/v2.0.1-beta.2...v2.0.1) (2021-08-09)

**Note:** Version bump only for package @stacks/common

## [2.0.1-beta.2](https://github.com/blockstack/blockstack.js/compare/v2.0.1-beta.1...v2.0.1-beta.2) (2021-08-06)

**Note:** Version bump only for package @stacks/common

## [2.0.1-beta.1](https://github.com/blockstack/blockstack.js/compare/v2.0.0-beta.1...v2.0.1-beta.1) (2021-07-26)

### Bug Fixes

- BREAKING CHANGE: make the broadcastTransaction response type consistent and always return an object ([3e4c197](https://github.com/blockstack/blockstack.js/commit/3e4c197f3a4763bc4ec6b7165cbd9db793bc2c2d))
- use stacks.js repo url ([cd2a684](https://github.com/blockstack/blockstack.js/commit/cd2a6849d6a2bf20109f85ac2c9afe467accf1a9))

### Features

- refactor all js `number` and `bn.js` usages in Clarity integer values to native bigint ([1f78339](https://github.com/blockstack/blockstack.js/commit/1f783397e7f5b38aabb6e0342af71b58022aed4c))

# [2.0.0-beta.2](https://github.com/blockstack/blockstack.js/compare/v2.0.0-beta.1...v2.0.0-beta.2) (2021-07-26)

### Bug Fixes

- BREAKING CHANGE: make the broadcastTransaction response type consistent and always return an object ([3e4c197](https://github.com/blockstack/blockstack.js/commit/3e4c197f3a4763bc4ec6b7165cbd9db793bc2c2d))
- use stacks.js repo url ([cd2a684](https://github.com/blockstack/blockstack.js/commit/cd2a6849d6a2bf20109f85ac2c9afe467accf1a9))

### Features

- refactor all js `number` and `bn.js` usages in Clarity integer values to native bigint ([1f78339](https://github.com/blockstack/blockstack.js/commit/1f783397e7f5b38aabb6e0342af71b58022aed4c))
