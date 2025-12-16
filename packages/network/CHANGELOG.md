# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [7.3.1](https://github.com/stx-labs/stacks.js/compare/v7.3.0...v7.3.1) (2025-12-16)

**Note:** Version bump only for package @stacks/network





## [7.2.0](https://github.com/hirosystems/stacks.js/compare/v7.1.2...v7.2.0) (2025-08-07)


### Features

* Add `createNetwork` function for easy API key usage ([#1800](https://github.com/hirosystems/stacks.js/issues/1800)) ([305d854](https://github.com/hirosystems/stacks.js/commit/305d854da4afb903a46ccb09926074c69025d896))



## [7.0.2](https://github.com/hirosystems/stacks.js/compare/v7.0.1...v7.0.2) (2024-11-14)

**Note:** Version bump only for package @stacks/network





## [7.0.0](https://github.com/hirosystems/stacks.js/compare/v6.17.0...v7.0.0) (2024-10-25)

### ⚠ BREAKING CHANGES

See full list of changes at [MIGRATION.md](https://github.com/hirosystems/stacks.js/blob/main/.github/MIGRATION.md)

## [6.17.0](https://github.com/hirosystems/stacks.js/compare/v6.16.1...v6.17.0) (2024-10-17)

### Bug Fixes

- allow read-only headers in fetch ([3c19b93](https://github.com/hirosystems/stacks.js/commit/3c19b9311b7af02a8832937c411b6f461cb3b624))

## [6.16.0](https://github.com/hirosystems/stacks.js/compare/v6.15.0...v6.16.0) (2024-06-30)

**Note:** Version bump only for package @stacks/network

## [6.13.0](https://github.com/hirosystems/stacks.js/compare/v6.12.1...v6.13.0) (2024-03-22)

**Note:** Version bump only for package @stacks/network

## [6.11.3](https://github.com/hirosystems/stacks.js/compare/v6.11.2...v6.11.3) (2024-01-24)

### Bug Fixes

- update legacy API endpoints ([#1618](https://github.com/hirosystems/stacks.js/issues/1618)) ([36d10a3](https://github.com/hirosystems/stacks.js/commit/36d10a39a0915950430f8eb149d1fe29002d003d))

## [6.10.0](https://github.com/hirosystems/stacks.js/compare/v6.9.0...v6.10.0) (2023-11-28)

**Note:** Version bump only for package @stacks/network

## [6.8.1](https://github.com/hirosystems/stacks.js/compare/v6.8.0...v6.8.1) (2023-09-18)

### Bug Fixes

- add hiro product header to default network fetch function ([58eb3af](https://github.com/hirosystems/stacks.js/commit/58eb3af347c05c32065358ea66bfb372d7658e59))

## [6.8.0](https://github.com/hirosystems/stacks.js/compare/v6.7.0...v6.8.0) (2023-09-04)

**Note:** Version bump only for package @stacks/network

## [6.5.5](https://github.com/hirosystems/stacks.js/compare/v6.5.4...v6.5.5) (2023-07-14)

**Note:** Version bump only for package @stacks/network

## [6.5.4](https://github.com/hirosystems/stacks.js/compare/v6.5.3...v6.5.4) (2023-05-17)

**Note:** Version bump only for package @stacks/network

## [6.5.2](https://github.com/hirosystems/stacks.js/compare/v6.5.1...v6.5.2) (2023-04-28)

**Note:** Version bump only for package @stacks/network

## [6.5.1](https://github.com/hirosystems/stacks.js/compare/v6.5.0...v6.5.1) (2023-04-19)

### Bug Fixes

- add StacksDevnet constructor, closes [#1470](https://github.com/hirosystems/stacks.js/issues/1470) ([5789937](https://github.com/hirosystems/stacks.js/commit/5789937655f351bc07c26086f851653e20ab9c8c))

## [6.3.0](https://github.com/hirosystems/stacks.js/compare/v6.2.1...v6.3.0) (2023-03-17)

### Features

- implement `getContractMapEntry` function ([#1461](https://github.com/hirosystems/stacks.js/issues/1461)) ([7031ead](https://github.com/hirosystems/stacks.js/commit/7031ead112f7333d165f5946eae0481f6aa9a20f))

## [6.1.1](https://github.com/hirosystems/stacks.js/compare/v6.1.0...v6.1.1) (2023-01-30)

**Note:** Version bump only for package @stacks/network

## [6.1.0](https://github.com/hirosystems/stacks.js/compare/v6.0.2...v6.1.0) (2023-01-06)

**Note:** Version bump only for package @stacks/network

## [6.0.0](https://github.com/hirosystems/stacks.js/compare/v5.0.3...v6.0.0) (2022-11-23)

**Note:** Version bump only for package @stacks/network

## [5.0.3](https://github.com/hirosystems/stacks.js/compare/v5.0.2...v5.0.3) (2022-11-18)

**Note:** Version bump only for package @stacks/network

## [5.0.0](https://github.com/hirosystems/stacks.js/compare/v4.3.8...v5.0.0) (2022-09-30)

### ⚠ BREAKING CHANGES

- Removes compatibility with `bip32` package from @stacks/wallet-sdk. Now all derivation methods only rely on HDKey from @scure/bip32.
- To reduce the bundle sizes of applications using Stacks.js we are moving away from Buffer (a polyfill to match Node.js APIs) to Uint8Arrays (which Buffers use in the background anyway). To make the switch easier we have introduced a variety of methods for converting between strings and Uint8Arrays: `hexToBytes`, `bytesToHex`, `utf8ToBytes`, `bytesToUtf8`, `asciiToBytes`, `bytesToAscii`, and `concatBytes`.

### Features

- switch from buffer to uint8array ([#1343](https://github.com/hirosystems/stacks.js/issues/1343)) ([5445b73](https://github.com/hirosystems/stacks.js/commit/5445b73e05ec0c09414395331bfd37788545f1e1))

## [4.3.5](https://github.com/hirosystems/stacks.js/compare/v4.3.4...v4.3.5) (2022-08-23)

**Note:** Version bump only for package @stacks/network

## [4.3.4](https://github.com/hirosystems/stacks.js/compare/v4.3.3...v4.3.4) (2022-08-02)

**Note:** Version bump only for package @stacks/network

## [4.3.2](https://github.com/hirosystems/stacks.js/compare/v4.3.1...v4.3.2) (2022-07-11)

**Note:** Version bump only for package @stacks/network

# [4.3.0](https://github.com/hirosystems/stacks.js/compare/v4.2.2...v4.3.0) (2022-06-16)

**Note:** Version bump only for package @stacks/network

# [4.2.0](https://github.com/hirosystems/stacks.js/compare/v4.1.2...v4.2.0) (2022-05-25)

**Note:** Version bump only for package @stacks/network

# [4.1.0](https://github.com/blockstack/blockstack.js/compare/v4.0.2...v4.1.0) (2022-05-19)

### Features

- add fetch middleware for api keys and request init ([ef45632](https://github.com/blockstack/blockstack.js/commit/ef456327a3e1dcdc2aa364cbe55e47225029c5d2))

## [4.0.2](https://github.com/blockstack/blockstack.js/compare/v4.0.2-beta.1...v4.0.2) (2022-05-19)

**Note:** Version bump only for package @stacks/network

## [4.0.1](https://github.com/blockstack/blockstack.js/compare/v4.0.1-beta.1...v4.0.1) (2022-05-09)

**Note:** Version bump only for package @stacks/network

# [4.0.0](https://github.com/blockstack/blockstack.js/compare/v4.0.0-beta.2...v4.0.0) (2022-04-20)

**Note:** Version bump only for package @stacks/network

# [3.5.0](https://github.com/blockstack/blockstack.js/compare/v3.5.0-beta.3...v3.5.0) (2022-03-30)

**Note:** Version bump only for package @stacks/network

# [3.3.0](https://github.com/blockstack/blockstack.js/compare/v3.2.1-beta.0...v3.3.0) (2022-02-23)

**Note:** Version bump only for package @stacks/network

## [3.2.1-beta.0](https://github.com/blockstack/blockstack.js/compare/v3.2.0...v3.2.1-beta.0) (2022-02-23)

**Note:** Version bump only for package @stacks/network

# [3.2.0](https://github.com/blockstack/blockstack.js/compare/v3.1.1...v3.2.0) (2022-02-02)

### Features

- reduce reliance on network package ([422fda3](https://github.com/blockstack/blockstack.js/commit/422fda3cd43e16ae24ea9d97297b423a90823672))

## [2.0.1](https://github.com/blockstack/blockstack.js/compare/v2.0.1-beta.2...v2.0.1) (2021-08-09)

**Note:** Version bump only for package @stacks/network

## [2.0.1-beta.2](https://github.com/blockstack/blockstack.js/compare/v2.0.1-beta.1...v2.0.1-beta.2) (2021-08-06)

**Note:** Version bump only for package @stacks/network

## [2.0.1-beta.1](https://github.com/blockstack/blockstack.js/compare/v2.0.0-beta.1...v2.0.1-beta.1) (2021-07-26)

### Bug Fixes

- BREAKING CHANGE: make coreApiUrl readonly for stacks network and initialize in constructor ([5d8cf6d](https://github.com/blockstack/blockstack.js/commit/5d8cf6d366665dace2df8102049d3f7ac1bf437e))
- broken types following diverged network config changes ([1cd9612](https://github.com/blockstack/blockstack.js/commit/1cd96128334465c461665cf079532f66b893b938))
- removeread only and add private field to prevent run time assignment ([62709aa](https://github.com/blockstack/blockstack.js/commit/62709aa5b6483299718063482bc26d6e94cc8c1c))

### Features

- add regtest to list of available networks ([f572477](https://github.com/blockstack/blockstack.js/commit/f572477ca0e5bc5e862c8a4e2fcc276655ee55a3)), closes [#1041](https://github.com/blockstack/blockstack.js/issues/1041)

# [2.0.0-beta.2](https://github.com/blockstack/blockstack.js/compare/v2.0.0-beta.1...v2.0.0-beta.2) (2021-07-26)

### Bug Fixes

- BREAKING CHANGE: make coreApiUrl readonly for stacks network and initialize in constructor ([5d8cf6d](https://github.com/blockstack/blockstack.js/commit/5d8cf6d366665dace2df8102049d3f7ac1bf437e))
- broken types following diverged network config changes ([1cd9612](https://github.com/blockstack/blockstack.js/commit/1cd96128334465c461665cf079532f66b893b938))
- removeread only and add private field to prevent run time assignment ([62709aa](https://github.com/blockstack/blockstack.js/commit/62709aa5b6483299718063482bc26d6e94cc8c1c))

### Features

- add regtest to list of available networks ([f572477](https://github.com/blockstack/blockstack.js/commit/f572477ca0e5bc5e862c8a4e2fcc276655ee55a3)), closes [#1041](https://github.com/blockstack/blockstack.js/issues/1041)
