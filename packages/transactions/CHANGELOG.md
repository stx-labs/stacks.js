# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [7.3.1](https://github.com/stx-labs/stacks.js/compare/v7.3.0...v7.3.1) (2025-12-16)


### Bug Fixes

* add tenure change causes ([#1818](https://github.com/stx-labs/stacks.js/issues/1818)) ([66964af](https://github.com/stx-labs/stacks.js/commit/66964af5e60ec8b088e847a24711f096366fbca0))



## [7.3.0](https://github.com/hirosystems/stacks.js/compare/v7.2.0...v7.3.0) (2025-11-12)


### Features

* Add ClarityVersion `.Clarity4` ([#1810](https://github.com/hirosystems/stacks.js/issues/1810)) ([74deecf](https://github.com/hirosystems/stacks.js/commit/74deecf6f4cd21fe2aa5e109666129182f18ae7b))



## [7.2.0](https://github.com/hirosystems/stacks.js/compare/v7.1.2...v7.2.0) (2025-08-07)

**Note:** Version bump only for package @stacks/transactions





## [7.1.0](https://github.com/hirosystems/stacks.js/compare/v7.0.6...v7.1.0) (2025-06-02)


### Bug Fixes

* Fix `Cl.parse` and `Cl.stringify` to match `JSON.parse` and `JSON.stringify` in escaping characters and string handling ([c3267a5](https://github.com/hirosystems/stacks.js/commit/c3267a5c48853b8f6074ad7fff68982362947dc0))



## [7.0.6](https://github.com/hirosystems/stacks.js/compare/v7.0.5...v7.0.6) (2025-04-18)


### Bug Fixes

* Increase maximum code body length for contract deploys ([#1793](https://github.com/hirosystems/stacks.js/issues/1793)) ([02e05ca](https://github.com/hirosystems/stacks.js/commit/02e05caeead9c8a3da5cf4c1cddbfbe0c692fc3c))



## [7.0.5](https://github.com/hirosystems/stacks.js/compare/v7.0.4...v7.0.5) (2025-03-10)


### Bug Fixes

* Add missing post-condition conversion functions: `Pc.fromHex()`, `wireToPostCondition` ([4e36e26](https://github.com/hirosystems/stacks.js/commit/4e36e26d69c220f66dff3ddac50e8919c4c75813))
* Allow `make` builder functions to take in serialized post-conditions ([a617f65](https://github.com/hirosystems/stacks.js/commit/a617f65042b3eaf845375f4b7e72b3a5344079b5))



## [7.0.4](https://github.com/hirosystems/stacks.js/compare/v7.0.2...v7.0.4) (2025-02-03)


### Bug Fixes

* Add byte length override for transfer fee estimates ([#1763](https://github.com/hirosystems/stacks.js/issues/1763)) ([a789994](https://github.com/hirosystems/stacks.js/commit/a7899940c0cf8698b1fc9a406b2923d3bf8231f4))
* regression in 'NoEstimateAvailable' check ([#1785](https://github.com/hirosystems/stacks.js/issues/1785)) ([a079a74](https://github.com/hirosystems/stacks.js/commit/a079a74e0c14189373c93c09229fd039c61c55ab))
* use correct types for postConditions ([#1784](https://github.com/hirosystems/stacks.js/issues/1784)) ([1d7d280](https://github.com/hirosystems/stacks.js/commit/1d7d2808d039d759fd9bcdc2b6e03e15cf65af43))



## [7.0.3](https://github.com/hirosystems/stacks.js/compare/v7.0.2...v7.0.3) (2024-11-15)


### Bug Fixes

* Add byte length override for transfer fee estimates ([#1763](https://github.com/hirosystems/stacks.js/issues/1763)) ([a789994](https://github.com/hirosystems/stacks.js/commit/a7899940c0cf8698b1fc9a406b2923d3bf8231f4))



## [7.0.2](https://github.com/hirosystems/stacks.js/compare/v7.0.1...v7.0.2) (2024-11-14)


### Bug Fixes

* Default contract deploys to Clarity version 3 ([#1756](https://github.com/hirosystems/stacks.js/issues/1756)) ([748e1e3](https://github.com/hirosystems/stacks.js/commit/748e1e311ef660981b5d8d7134908d94fe37701e))
* update tsdoc comments to expose internal methods ([#1761](https://github.com/hirosystems/stacks.js/issues/1761)) ([2f2b12b](https://github.com/hirosystems/stacks.js/commit/2f2b12b23be95e10210af72fc3cea32fb27f024f))



## [7.0.0](https://github.com/hirosystems/stacks.js/compare/v6.17.0...v7.0.0) (2024-10-25)

### ⚠ BREAKING CHANGES

See full list of changes at [MIGRATION.md](https://github.com/hirosystems/stacks.js/blob/main/.github/MIGRATION.md)

## [6.17.0](https://github.com/hirosystems/stacks.js/compare/v6.16.1...v6.17.0) (2024-10-17)

### Features

- add clarity3 in clarityversion enum ([525c3ff](https://github.com/hirosystems/stacks.js/commit/525c3ff95d9554b25781c20d755be47f76f69556))

## [6.16.1](https://github.com/hirosystems/stacks.js/compare/v6.16.0...v6.16.1) (2024-07-02)

### Bug Fixes

- update multi-sig signer state ([2b9f288](https://github.com/hirosystems/stacks.js/commit/2b9f288b9c105c34b11a350d9fe20722749b2a74))

## [6.16.0](https://github.com/hirosystems/stacks.js/compare/v6.15.0...v6.16.0) (2024-06-30)

### Features

- Add `Cl.parse` Clarity value parser ([#1681](https://github.com/hirosystems/stacks.js/issues/1681)) ([b9f8775](https://github.com/hirosystems/stacks.js/commit/b9f8775e28f044894f6415df2d29bb3e1ed8e1c7))
- Add non-sequential multi-sig support (and fix legacy multi-sig bugs) ([#1710](https://github.com/hirosystems/stacks.js/issues/1710)) ([879263c](https://github.com/hirosystems/stacks.js/commit/879263cb5f3fb896b868ccaac00b4a8d635054ff))
- add serialization helpers for transaction ([#1706](https://github.com/hirosystems/stacks.js/issues/1706)) ([2c57ea4](https://github.com/hirosystems/stacks.js/commit/2c57ea4e5abed76da903f5138c79c1d2eceb008b))
- Allow `0x` prefix in hexToBytes helper ([#1690](https://github.com/hirosystems/stacks.js/issues/1690)) ([33ca645](https://github.com/hirosystems/stacks.js/commit/33ca64598b639fbe2a752e8f2055c8e0053f44a1))
- Use API for nonce detection if available ([#1704](https://github.com/hirosystems/stacks.js/issues/1704)) ([855ca69](https://github.com/hirosystems/stacks.js/commit/855ca69cecc00ac836077fbeef1f89e952f110c3))

## [6.15.0](https://github.com/hirosystems/stacks.js/compare/v6.14.0...v6.15.0) (2024-05-03)

### Features

- add encodeAbiClarityValue method for better encoding ([2885813](https://github.com/hirosystems/stacks.js/commit/28858138c8f6366b37fa7210ba85c0c5a9cc0955))

## [6.13.1](https://github.com/hirosystems/stacks.js/compare/v6.13.0...v6.13.1) (2024-04-04)

### Bug Fixes

- update buffer max size to correct 1MB limit ([#1665](https://github.com/hirosystems/stacks.js/issues/1665)) ([91b5dab](https://github.com/hirosystems/stacks.js/commit/91b5dabf2d48616ece00a7075ad1aebc92508e6f))

## [6.13.0](https://github.com/hirosystems/stacks.js/compare/v6.12.1...v6.13.0) (2024-03-22)

### Features

- **nakamoto:** add nakamoto coinbase payload ([85daaff](https://github.com/hirosystems/stacks.js/commit/85daaffea3c8791fb6ca30a8958b4cbd74480759))
- **nakamoto:** add tenure change payload ([b341b5a](https://github.com/hirosystems/stacks.js/commit/b341b5a2d88159c38e0577568d04a13febdcc393))

## [6.12.1](https://github.com/hirosystems/stacks.js/compare/v6.12.0...v6.12.1) (2024-03-18)

### Bug Fixes

- add stacks transaction memo equality by auto-removing trailing null bytes ([#1630](https://github.com/hirosystems/stacks.js/issues/1630)) ([bb0b85d](https://github.com/hirosystems/stacks.js/commit/bb0b85d45db3daeed24f12324aa8cb87b03b74a5))
- add test to retrieve public key from StructuredDataSignature ([20c1aaf](https://github.com/hirosystems/stacks.js/commit/20c1aaf7c8b8e7808ed7cf4bff2b72b44fecf045))
- allow StructuredDataSignature type in publicKeyFromSignature\* ([92c9f6c](https://github.com/hirosystems/stacks.js/commit/92c9f6c838de8c3a824d0a15edb3d6c8f27bc69b))

## [6.12.0](https://github.com/hirosystems/stacks.js/compare/v6.11.3...v6.12.0) (2024-02-23)

### Features

- sort tuple properties in cl pretty print ([6ab94c4](https://github.com/hirosystems/stacks.js/commit/6ab94c4b72be91510f95bb8871a21d4ae86982d3))

## [6.11.3](https://github.com/hirosystems/stacks.js/compare/v6.11.2...v6.11.3) (2024-01-24)

### Bug Fixes

- update legacy API endpoints ([#1618](https://github.com/hirosystems/stacks.js/issues/1618)) ([36d10a3](https://github.com/hirosystems/stacks.js/commit/36d10a39a0915950430f8eb149d1fe29002d003d))

## [6.11.2](https://github.com/hirosystems/stacks.js/compare/v6.11.1...v6.11.2) (2024-01-03)

### Bug Fixes

- add error throwing on too large fungible post-condition ([d0a1a32](https://github.com/hirosystems/stacks.js/commit/d0a1a32bc64b9c9bc513abbe2ee67e7edb094b1d))

## [6.11.0](https://github.com/hirosystems/stacks.js/compare/v6.10.0...v6.11.0) (2023-12-18)

### Features

- implement isClarityType ([6eb1319](https://github.com/hirosystems/stacks.js/commit/6eb13197ad6b0cc11717ab6d819709e4e4c736d9))

### Bug Fixes

- handle `NoEstimateAvailable` text error body ([802487d](https://github.com/hirosystems/stacks.js/commit/802487d1a787f621692a28da5fabc02e53ffb2f9))
- type definition for map abi ([#1608](https://github.com/hirosystems/stacks.js/issues/1608)) ([39a30f2](https://github.com/hirosystems/stacks.js/commit/39a30f2e04e9e474216bbf81f27a7546d0f0792b))

## [6.10.0](https://github.com/hirosystems/stacks.js/compare/v6.9.0...v6.10.0) (2023-11-28)

### Bug Fixes

- add address alias for principal ([bd96bb5](https://github.com/hirosystems/stacks.js/commit/bd96bb502dc50dc86e6dbc94da43c5b2bbc35d61))
- add generic principal helper ([25176ce](https://github.com/hirosystems/stacks.js/commit/25176ce595d5eef0dab564c1a3a214403a9e280d))

## [6.9.0](https://github.com/hirosystems/stacks.js/compare/v6.8.1...v6.9.0) (2023-09-20)

### Features

- add Cl.prettyPrint ([#1551](https://github.com/hirosystems/stacks.js/issues/1551)) ([ae25ad9](https://github.com/hirosystems/stacks.js/commit/ae25ad9da9bf265d45a813db83935cc2b06f3f95))

## [6.8.1](https://github.com/hirosystems/stacks.js/compare/v6.8.0...v6.8.1) (2023-09-18)

**Note:** Version bump only for package @stacks/transactions

## [6.8.0](https://github.com/hirosystems/stacks.js/compare/v6.7.0...v6.8.0) (2023-09-04)

### Features

- add multisig support to contract deploys ([#1539](https://github.com/hirosystems/stacks.js/issues/1539)) ([260f2d5](https://github.com/hirosystems/stacks.js/commit/260f2d58577c92ef37d0f1d276e1e0fc0fd267b3))

## [6.7.0](https://github.com/hirosystems/stacks.js/compare/v6.5.5...v6.7.0) (2023-07-24)

**Note:** Version bump only for package @stacks/transactions

## [6.6.0](https://github.com/hirosystems/stacks.js/compare/v6.5.5...v6.6.0) (2023-07-24)

**Note:** Version bump only for package @stacks/transactions

## [6.5.5](https://github.com/hirosystems/stacks.js/compare/v6.5.4...v6.5.5) (2023-07-14)

### Bug Fixes

- remove post-conditions from stx transfer ([679a93a](https://github.com/hirosystems/stacks.js/commit/679a93afd75253d21bec070c85b843c34aeb516b))
- throw error if the number type used in the bigint constructor is not a safe integer value ([d6a6fcc](https://github.com/hirosystems/stacks.js/commit/d6a6fcc30e4306d90da091e2538a281968dc9ac4))
- update pc types to allow strict type checking ([#1494](https://github.com/hirosystems/stacks.js/issues/1494)) ([b916ef0](https://github.com/hirosystems/stacks.js/commit/b916ef06e8498f3b14403f850fc8a39881311ea7))

## [6.5.4](https://github.com/hirosystems/stacks.js/compare/v6.5.3...v6.5.4) (2023-05-17)

**Note:** Version bump only for package @stacks/transactions

## [6.5.2](https://github.com/hirosystems/stacks.js/compare/v6.5.1...v6.5.2) (2023-04-28)

### Bug Fixes

- add `Cl` helper ([#1479](https://github.com/hirosystems/stacks.js/issues/1479)) ([c116a85](https://github.com/hirosystems/stacks.js/commit/c116a851c499d26326f94c368d74d75d0bf76627))

## [6.5.1](https://github.com/hirosystems/stacks.js/compare/v6.5.0...v6.5.1) (2023-04-19)

**Note:** Version bump only for package @stacks/transactions

## [6.5.0](https://github.com/hirosystems/stacks.js/compare/v6.4.0...v6.5.0) (2023-03-26)

### Features

- add pc post condition builder ([#1466](https://github.com/hirosystems/stacks.js/issues/1466)) ([ac254ba](https://github.com/hirosystems/stacks.js/commit/ac254badb73401a77f984f6fe62e8f198419786b))

## [6.4.0](https://github.com/hirosystems/stacks.js/compare/v6.3.0...v6.4.0) (2023-03-19)

### Features

- switch makeContractDeploy and makeUnsignedContractDeploy to use clarity 2 by default ([244636f](https://github.com/hirosystems/stacks.js/commit/244636fbd07a8c5f0fefa4671a88036412932fa0))

## [6.3.0](https://github.com/hirosystems/stacks.js/compare/v6.2.1...v6.3.0) (2023-03-17)

### Features

- implement `getContractMapEntry` function ([#1461](https://github.com/hirosystems/stacks.js/issues/1461)) ([7031ead](https://github.com/hirosystems/stacks.js/commit/7031ead112f7333d165f5946eae0481f6aa9a20f))

## [6.2.0](https://github.com/hirosystems/stacks.js/compare/v6.1.1...v6.2.0) (2023-02-22)

### Features

- allow string name for AnchorMode ([a039c33](https://github.com/hirosystems/stacks.js/commit/a039c33292436057bd5e73d4f796441794141f96))

### Bug Fixes

- a few Clarity value construction functions were not being exported ([f0ba4a2](https://github.com/hirosystems/stacks.js/commit/f0ba4a2f0d597c27839ff1f15b2b73514ca25fd3))

## [6.1.1](https://github.com/hirosystems/stacks.js/compare/v6.1.0...v6.1.1) (2023-01-30)

**Note:** Version bump only for package @stacks/transactions

## [6.1.0](https://github.com/hirosystems/stacks.js/compare/v6.0.2...v6.1.0) (2023-01-06)

### Features

- add estimation fallback ([782a3c3](https://github.com/hirosystems/stacks.js/commit/782a3c392969e8736a4d6c7c27d491bf2e35bac6))

## [6.0.0](https://github.com/hirosystems/stacks.js/compare/v5.0.3...v6.0.0) (2022-11-23)

### Features

- add coinbase-to-alt-recipient payload type ([836b181](https://github.com/hirosystems/stacks.js/commit/836b181eca3fd2904baf2587c7875d6a6e8c95bd))
- add payload type assertions ([#1395](https://github.com/hirosystems/stacks.js/issues/1395)) ([cdd32e9](https://github.com/hirosystems/stacks.js/commit/cdd32e9323069452a4d0345174b049be1c8e1069))
- support `versioned-smart-contract` tx types introduced in Stacks 2.1 ([#1341](https://github.com/hirosystems/stacks.js/issues/1341)) ([0062a45](https://github.com/hirosystems/stacks.js/commit/0062a453fec80de93d36e0d8c5e3f37a7522c300))

## [5.0.3](https://github.com/hirosystems/stacks.js/compare/v5.0.2...v5.0.3) (2022-11-18)

**Note:** Version bump only for package @stacks/transactions

## [5.0.2](https://github.com/hirosystems/stacks.js/compare/v5.0.1...v5.0.2) (2022-10-19)

### Bug Fixes

- rename incorrect nft post-condition codes ([9fed6a4](https://github.com/hirosystems/stacks.js/commit/9fed6a425a2803a27cf919c3038e6a5220ada465))

## [5.0.1](https://github.com/hirosystems/stacks.js/compare/v5.0.0...v5.0.1) (2022-10-04)

### Bug Fixes

- rename incorrect nft post-condition codes ([dddeb68](https://github.com/hirosystems/stacks.js/commit/dddeb6891b5ff2f6c2d2a7eb089c850a9a8c32b7))

## [5.0.0](https://github.com/hirosystems/stacks.js/compare/v4.3.8...v5.0.0) (2022-09-30)

### ⚠ BREAKING CHANGES

- Post-conditions for NFTs were renamed to be more clear: `Owns` to `Sends`, `DoesNotOwn` to `DoesNotSend`.
- remove previously deprecated functions
- Removes compatibility with `bip32` package from @stacks/wallet-sdk. Now all derivation methods only rely on HDKey from @scure/bip32.
- To reduce the bundle sizes of applications using Stacks.js we are moving away from Buffer (a polyfill to match Node.js APIs) to Uint8Arrays (which Buffers use in the background anyway). To make the switch easier we have introduced a variety of methods for converting between strings and Uint8Arrays: `hexToBytes`, `bytesToHex`, `utf8ToBytes`, `bytesToUtf8`, `asciiToBytes`, `bytesToAscii`, and `concatBytes`.

### Features

- switch from buffer to uint8array ([#1343](https://github.com/hirosystems/stacks.js/issues/1343)) ([5445b73](https://github.com/hirosystems/stacks.js/commit/5445b73e05ec0c09414395331bfd37788545f1e1))

### Bug Fixes

- remove previously deprecated functions ([b2a5f96](https://github.com/hirosystems/stacks.js/commit/b2a5f96fd24e8da7cb9b4e1cf4d7b654f6e5b00c))
- update post-condition names for non-fungible tokens ([9fbdcea](https://github.com/hirosystems/stacks.js/commit/9fbdcea262a4f8af24740e35b58c886e636ad292))

## [4.3.8](https://github.com/hirosystems/stacks.js/compare/v4.3.7...v4.3.8) (2022-09-29)

**Note:** Version bump only for package @stacks/transactions

## [4.3.7](https://github.com/hirosystems/stacks.js/compare/v4.3.6...v4.3.7) (2022-09-28)

### Bug Fixes

- correctly verify future message signing prefix ([d27e054](https://github.com/hirosystems/stacks.js/commit/d27e054f2639fcea4c873ce942d966e2aa4ca926))

## [4.3.5](https://github.com/hirosystems/stacks.js/compare/v4.3.4...v4.3.5) (2022-08-23)

**Note:** Version bump only for package @stacks/transactions

## [4.3.4](https://github.com/hirosystems/stacks.js/compare/v4.3.3...v4.3.4) (2022-08-02)

### Bug Fixes

- migrate subdomains to wallet key address ([b32cb41](https://github.com/hirosystems/stacks.js/commit/b32cb417f593200b1de13a704eceda7c3ab7f5a8))

## [4.3.3](https://github.com/hirosystems/stacks.js/compare/v4.3.2...v4.3.3) (2022-07-19)

**Note:** Version bump only for package @stacks/transactions

## [4.3.2](https://github.com/hirosystems/stacks.js/compare/v4.3.1...v4.3.2) (2022-07-11)

**Note:** Version bump only for package @stacks/transactions

## [4.3.1](https://github.com/hirosystems/stacks.js/compare/v4.3.0...v4.3.1) (2022-07-01)

**Note:** Version bump only for package @stacks/transactions

# [4.3.0](https://github.com/hirosystems/stacks.js/compare/v4.2.2...v4.3.0) (2022-06-16)

### Bug Fixes

- add clarity typedoc annotations ([b95783d](https://github.com/hirosystems/stacks.js/commit/b95783db54d8a5294c7f10e67ccb0f2c529aef75))
- export structuredDataSignature ([5e8736b](https://github.com/hirosystems/stacks.js/commit/5e8736bcf572d7334947c040b218a82598bfb2e0))

### Features

- add SIP-018 support ([a4c0577](https://github.com/hirosystems/stacks.js/commit/a4c0577c7e6fb5010eb886c3b04c2636282e442a)), closes [#1283](https://github.com/hirosystems/stacks.js/issues/1283) [#1281](https://github.com/hirosystems/stacks.js/issues/1281)

# [4.2.0](https://github.com/hirosystems/stacks.js/compare/v4.1.2...v4.2.0) (2022-05-25)

### Bug Fixes

- offload bitcoinjs from stacking, closes [#1259](https://github.com/hirosystems/stacks.js/issues/1259) ([8912bca](https://github.com/hirosystems/stacks.js/commit/8912bca06b1281e453ff09b3513f0e08906eeae6))

### Features

- add missing rsv functions ([4e7fcf5](https://github.com/hirosystems/stacks.js/commit/4e7fcf5b9ae2000a903d49ac31a424349f839637))

# [4.1.0](https://github.com/hirosystems/stacks.js/compare/v4.0.2...v4.1.0) (2022-05-19)

### Features

- add fetch middleware for api keys and request init ([ef45632](https://github.com/hirosystems/stacks.js/commit/ef456327a3e1dcdc2aa364cbe55e47225029c5d2))

## [4.0.2](https://github.com/hirosystems/stacks.js/compare/v4.0.2-beta.1...v4.0.2) (2022-05-19)

### Bug Fixes

- **message-signing:** add working utility fn ([20b721c](https://github.com/hirosystems/stacks.js/commit/20b721cdccc2fb73f98aad80eb6d5e8e9cb987d0))

## [4.0.1](https://github.com/hirosystems/stacks.js/compare/v4.0.1-beta.1...v4.0.1) (2022-05-09)

### Bug Fixes

- allow referrer header in request options ([70ea915](https://github.com/hirosystems/stacks.js/commit/70ea9156f6916f32e40adf7464322476a9acd8ab))

# [4.0.0](https://github.com/hirosystems/stacks.js/compare/v4.0.0-beta.2...v4.0.0) (2022-04-20)

**Note:** Version bump only for package @stacks/transactions

# [3.5.0](https://github.com/hirosystems/stacks.js/compare/v3.5.0-beta.3...v3.5.0) (2022-03-30)

**Note:** Version bump only for package @stacks/transactions

# [3.3.0](https://github.com/hirosystems/stacks.js/compare/v3.2.1-beta.0...v3.3.0) (2022-02-23)

**Note:** Version bump only for package @stacks/transactions

## [3.2.1-beta.0](https://github.com/hirosystems/stacks.js/compare/v3.2.0...v3.2.1-beta.0) (2022-02-23)

### Bug Fixes

- use noble-secp256k1 in transaction to replace elliptic dependency ([534f1b8](https://github.com/hirosystems/stacks.js/commit/534f1b8acf5ab1267860af0d2a9f1ba19bb35303))

# [3.2.0](https://github.com/blockstack/blockstack.js/compare/v3.1.1...v3.2.0) (2022-02-02)

### Bug Fixes

- remove lodash dependency ([96b3064](https://github.com/blockstack/blockstack.js/commit/96b306446510eba33fe99665e0e02a84bca901c5))

### Features

- reduce reliance on network package ([422fda3](https://github.com/blockstack/blockstack.js/commit/422fda3cd43e16ae24ea9d97297b423a90823672))

# [3.1.0](https://github.com/blockstack/blockstack.js/compare/v3.0.0...v3.1.0) (2021-12-16)

**Note:** Version bump only for package @stacks/transactions

## [2.0.1](https://github.com/blockstack/blockstack.js/compare/v2.0.1-beta.2...v2.0.1) (2021-08-09)

**Note:** Version bump only for package @stacks/transactions

## [2.0.1-beta.2](https://github.com/blockstack/blockstack.js/compare/v2.0.1-beta.1...v2.0.1-beta.2) (2021-08-06)

**Note:** Version bump only for package @stacks/transactions

## [2.0.1-beta.1](https://github.com/blockstack/blockstack.js/compare/v2.0.0-beta.1...v2.0.1-beta.1) (2021-07-26)

### Bug Fixes

- always return string quoted integer rather than `number | string` depending on bit size ([6af4abe](https://github.com/blockstack/blockstack.js/commit/6af4abe92e995140d4e8becab3aacabd17dbce92))
- bn.js lib accepts strings containing non-integer values and results in weird behavior ([da07f10](https://github.com/blockstack/blockstack.js/commit/da07f108061a29af1879eef6b6054e0a45b6b9d1))
- BREAKING CHANGE: make the broadcastTransaction response type consistent and always return an object ([3e4c197](https://github.com/blockstack/blockstack.js/commit/3e4c197f3a4763bc4ec6b7165cbd9db793bc2c2d))
- handle empty list in getCVTypeString ([#1033](https://github.com/blockstack/blockstack.js/issues/1033)) ([1ff5b03](https://github.com/blockstack/blockstack.js/commit/1ff5b03c28c664953260105d333cebfa2fd64e5f))
- prettify ([b471de9](https://github.com/blockstack/blockstack.js/commit/b471de968acba970b1c5337100220cc75a05e44e))
- The transaction ABI validation should accept lists that are less than or equal to the max size specified in the arguments type ([53dd641](https://github.com/blockstack/blockstack.js/commit/53dd6410554dea195dc7e206d39a1995c6fc1fae))

### Features

- refactor all js `number` and `bn.js` usages in Clarity integer values to native bigint ([1f78339](https://github.com/blockstack/blockstack.js/commit/1f783397e7f5b38aabb6e0342af71b58022aed4c))

# [2.0.0-beta.2](https://github.com/blockstack/blockstack.js/compare/v2.0.0-beta.1...v2.0.0-beta.2) (2021-07-26)

### Bug Fixes

- always return string quoted integer rather than `number | string` depending on bit size ([6af4abe](https://github.com/blockstack/blockstack.js/commit/6af4abe92e995140d4e8becab3aacabd17dbce92))
- bn.js lib accepts strings containing non-integer values and results in weird behavior ([da07f10](https://github.com/blockstack/blockstack.js/commit/da07f108061a29af1879eef6b6054e0a45b6b9d1))
- BREAKING CHANGE: make the broadcastTransaction response type consistent and always return an object ([3e4c197](https://github.com/blockstack/blockstack.js/commit/3e4c197f3a4763bc4ec6b7165cbd9db793bc2c2d))
- handle empty list in getCVTypeString ([#1033](https://github.com/blockstack/blockstack.js/issues/1033)) ([1ff5b03](https://github.com/blockstack/blockstack.js/commit/1ff5b03c28c664953260105d333cebfa2fd64e5f))
- prettify ([b471de9](https://github.com/blockstack/blockstack.js/commit/b471de968acba970b1c5337100220cc75a05e44e))
- The transaction ABI validation should accept lists that are less than or equal to the max size specified in the arguments type ([53dd641](https://github.com/blockstack/blockstack.js/commit/53dd6410554dea195dc7e206d39a1995c6fc1fae))

### Features

- refactor all js `number` and `bn.js` usages in Clarity integer values to native bigint ([1f78339](https://github.com/blockstack/blockstack.js/commit/1f783397e7f5b38aabb6e0342af71b58022aed4c))

## [1.4.1](https://github.com/blockstack/blockstack.js.gi/compare/v1.4.1-alpha.0...v1.4.1) (2021-04-20)

**Note:** Version bump only for package @stacks/transactions

## [1.3.5](https://github.com/blockstack/blockstack.js.gi/compare/v1.3.4...v1.3.5) (2021-03-26)

### Bug Fixes

- use spending conditions key encoding to properly recover public key ([a0dbba8](https://github.com/blockstack/blockstack.js.gi/commit/a0dbba8710a2e9e2b5690b8f380c7b9d1db41875))

## [1.3.3](https://github.com/blockstack/blockstack.js.gi/compare/v1.3.2...v1.3.3) (2021-03-18)

### Bug Fixes

- export cvToValue function ([42c138b](https://github.com/blockstack/blockstack.js.gi/commit/42c138b975ea08e75fea78db39b77166c08f193b))

# [1.3.0](https://github.com/blockstack/blockstack.js.gi/compare/v1.2.4...v1.3.0) (2021-03-08)

### Features

- add hex string and Buffer support to `deserializedTransaction` ([be379b2](https://github.com/blockstack/blockstack.js.gi/commit/be379b257a31329618e5e9db91e25bbe3bef1b61))
- properly serialize uncompressed auth fields ([e259fe1](https://github.com/blockstack/blockstack.js.gi/commit/e259fe176478c3ae35f1d12d9f77be377c167f65))

## [1.2.4](https://github.com/blockstack/blockstack.js.gi/compare/v1.2.3...v1.2.4) (2021-02-26)

**Note:** Version bump only for package @stacks/transactions

## [1.2.3](https://github.com/blockstack/blockstack.js.gi/compare/v1.2.2...v1.2.3) (2021-02-25)

### Bug Fixes

- export cvToValue function ([835e68e](https://github.com/blockstack/blockstack.js.gi/commit/835e68e14e346c2417ac21c1c85bdc68d3de6e2e))
