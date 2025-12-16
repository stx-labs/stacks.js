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


### Features

* Add `createNetwork` function for easy API key usage ([#1800](https://github.com/hirosystems/stacks.js/issues/1800)) ([305d854](https://github.com/hirosystems/stacks.js/commit/305d854da4afb903a46ccb09926074c69025d896))


### Bug Fixes

* Respect network changing flags for `contract_call` command ([04bb69c](https://github.com/hirosystems/stacks.js/commit/04bb69ce6c940d7a9588269e14e5067862f93649))
* Respect network changing flags for `deploy_contract` CLI command ([aefdf26](https://github.com/hirosystems/stacks.js/commit/aefdf260502cd43225cddadc65653e971572bfa7))
* Respect network changing flags for `faucet` command ([8142c1c](https://github.com/hirosystems/stacks.js/commit/8142c1caa0286c771d001b426dd699d0d99a0b57))
* Respect network changing flags for `migrate_subdomains` command ([8624397](https://github.com/hirosystems/stacks.js/commit/86243973b0e576ea238e67d837b08b0668ba4103))



## [7.1.2](https://github.com/hirosystems/stacks.js/compare/v7.1.1...v7.1.2) (2025-06-18)


### Bug Fixes

* Make Gaia hub profile fetching and uploading in `makeAuthResponse` optional ([5ca31e7](https://github.com/hirosystems/stacks.js/commit/5ca31e7ef971729962c3ba30b146d5d6069ad4d5))



## [7.1.1](https://github.com/hirosystems/stacks.js/compare/v7.1.0...v7.1.1) (2025-06-02)


### Bug Fixes

* Update CLI help menu entry ([2aaf20b](https://github.com/hirosystems/stacks.js/commit/2aaf20b97c59380f4da28a6a0a750803bb322705))



## [7.1.0](https://github.com/hirosystems/stacks.js/compare/v7.0.6...v7.1.0) (2025-06-02)


### Features

* Allow CLI `call_contract_func` command to take Clarity arguments as command line arguments ([5d1ae3f](https://github.com/hirosystems/stacks.js/commit/5d1ae3f94b0e6c4acbe51594f91515c4cd188b8a))


### Bug Fixes

* Fix `Cl.parse` and `Cl.stringify` to match `JSON.parse` and `JSON.stringify` in escaping characters and string handling ([c3267a5](https://github.com/hirosystems/stacks.js/commit/c3267a5c48853b8f6074ad7fff68982362947dc0))
* Fix a regression from the v7.x.x update where the localnet/mocknet flag stopped being respected in the CLI ([53c6aaa](https://github.com/hirosystems/stacks.js/commit/53c6aaa8a237fcbdee96c814b1e3a00a10b2a433))



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



## [7.0.1](https://github.com/hirosystems/stacks.js/compare/v7.0.0...v7.0.1) (2024-11-09)


### Bug Fixes

* update import in cli ([#1758](https://github.com/hirosystems/stacks.js/issues/1758)) ([fed8fcc](https://github.com/hirosystems/stacks.js/commit/fed8fcca5c0fdebec53e267049a14cc605855766))



## [7.0.0](https://github.com/hirosystems/stacks.js/compare/v6.17.0...v7.0.0) (2024-10-25)

### ⚠ BREAKING CHANGES

See full list of changes at [MIGRATION.md](https://github.com/hirosystems/stacks.js/blob/main/.github/MIGRATION.md)

- Update Cl.serialize to return string instead of bytes ([3d4052b](https://github.com/hirosystems/stacks.js/commit/3d4052b2))
- Rename StacksTransaction to StacksTransactionWire ([fe74e87](https://github.com/hirosystems/stacks.js/commit/fe74e872))
- Update StacksTransaction constructor to options object ([2b15209](https://github.com/hirosystems/stacks.js/commit/2b152090))
- Make StacksTransaction.serialize() return a hex-string instead of bytes ([b563a2d](https://github.com/hirosystems/stacks.js/commit/b563a2d9))
- Rename message types ([3d8b2dc](https://github.com/hirosystems/stacks.js/commit/3d8b2dcd))
- Remove BN.js compatibility ([ddd8dde](https://github.com/hirosystems/stacks.js/commit/ddd8ddee))
- Rename more types to use "Wire" suffix ([221633a](https://github.com/hirosystems/stacks.js/commit/221633a8))
- Remove wrapper type for message signatures ([bf08b46](https://github.com/hirosystems/stacks.js/commit/bf08b46f))
- Rename networking/fetch methods to include `fetch` prefix ([463176a](https://github.com/hirosystems/stacks.js/commit/463176af))
- Update post-condition representation to human readable types ([a7cff36](https://github.com/hirosystems/stacks.js/commit/a7cff367))
- Remove optional anchor mode from transaction options ([2bec7ae](https://github.com/hirosystems/stacks.js/commit/2bec7ae8))
- Remove wrapped private key type ([a4e86ce](https://github.com/hirosystems/stacks.js/commit/a4e86cee))
- Change clarity types to be human readable ([edad3b4](https://github.com/hirosystems/stacks.js/commit/edad3b4a))
- Update to new network object ([57369cc](https://github.com/hirosystems/stacks.js/commit/57369cc6))

### Features

- Add origin post-condition principals ([ccc79b3](https://github.com/hirosystems/stacks.js/commit/ccc79b30))
- Add `Address` namespace ([1291687](https://github.com/hirosystems/stacks.js/commit/12916876))
- Add STX unit helper methods ([94f6c6b](https://github.com/hirosystems/stacks.js/commit/94f6c6bb))
- Add postConditionToHex helper ([e224b0e](https://github.com/hirosystems/stacks.js/commit/e224b0e7))
- Add `Cl.parse` Clarity value parser ([b9f8775](https://github.com/hirosystems/stacks.js/commit/b9f8775e28f044894f6415df2d29bb3e1ed8e1c7))
- Add non-sequential multi-sig support (and fix legacy multi-sig bugs) ([879263c](https://github.com/hirosystems/stacks.js/commit/879263cb5f3fb896b868ccaac00b4a8d635054ff))
- Add serialization helpers for transaction ([2c57ea4](https://github.com/hirosystems/stacks.js/commit/2c57ea4e5abed76da903f5138c79c1d2eceb008b))
- Allow `0x` prefix in hexToBytes helper ([33ca645](https://github.com/hirosystems/stacks.js/commit/33ca64598b639fbe2a752e8f2055c8e0053f44a1))
- Use API for nonce detection if available ([855ca69](https://github.com/hirosystems/stacks.js/commit/855ca69cecc00ac836077fbeef1f89e952f110c3))
- Add new api package ([9cf8a75](https://github.com/hirosystems/stacks.js/commit/9cf8a755))
- Cleanup common files ([8316766](https://github.com/hirosystems/stacks.js/commit/83167669))

### Bug Fixes

- Update post conditions input in transactions ([d005d19](https://github.com/hirosystems/stacks.js/commit/d005d198))
- Switch to a network and client param solution ([e7370a0](https://github.com/hirosystems/stacks.js/commit/e7370a0d))
- Fix string parsing in structured signature decode ([9760497](https://github.com/hirosystems/stacks.js/commit/97604978))
- Remove legacy methods ([6cece09](https://github.com/hirosystems/stacks.js/commit/6cece099))
- Generate compressed private keys by default ([badc4bf](https://github.com/hirosystems/stacks.js/commit/badc4bfc))
- Compressing private key should ensure string format ([350e1fa](https://github.com/hirosystems/stacks.js/commit/350e1fa2))
- Move more helper functions to take network parameter ([b8cbde2](https://github.com/hirosystems/stacks.js/commit/b8cbde2d))
- Remove signed option for intToBigInt ([1a3cc2f](https://github.com/hirosystems/stacks.js/commit/1a3cc2fa))
- Allow .appendOrigin to be used with unwrapped public key ([9c4a951](https://github.com/hirosystems/stacks.js/commit/9c4a9512))
- Improve address helper functions ([e53528b](https://github.com/hirosystems/stacks.js/commit/e53528b7))
- Allow network name in more helper functions ([3d92cc7](https://github.com/hirosystems/stacks.js/commit/3d92cc71))
- Add `.bootAddress` to network objects ([9993519](https://github.com/hirosystems/stacks.js/commit/9993519f))
- Disable legacy triplesec support for mnemonic encryption ([9b98e44](https://github.com/hirosystems/stacks.js/commit/9b98e443))
- Remove legacy CLI methods ([3c373e1](https://github.com/hirosystems/stacks.js/commit/3c373e16))
- Update remaining packages for api ([2378096](https://github.com/hirosystems/stacks.js/commit/2378096e))
- Consolidate poxaddress return types ([0dbe0db](https://github.com/hirosystems/stacks.js/commit/0dbe0db6))

## [6.17.0](https://github.com/hirosystems/stacks.js/compare/v6.16.1...v6.17.0) (2024-10-17)

### Features

- add clarity3 in clarityversion enum ([525c3ff](https://github.com/hirosystems/stacks.js/commit/525c3ff95d9554b25781c20d755be47f76f69556))

### Bug Fixes

- allow read-only headers in fetch ([3c19b93](https://github.com/hirosystems/stacks.js/commit/3c19b9311b7af02a8832937c411b6f461cb3b624))

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

## [6.14.0](https://github.com/hirosystems/stacks.js/compare/v6.13.2...v6.14.0) (2024-04-19)

### Features

- add verifySignerKeySignature read-only to StackingClient ([9ddbf9b](https://github.com/hirosystems/stacks.js/commit/9ddbf9b9f29c4da016db03854ee57dbd842f87e8))

## [6.13.2](https://github.com/hirosystems/stacks.js/compare/v6.13.1...v6.13.2) (2024-04-11)

### Bug Fixes

- add missing signer topic ([#1671](https://github.com/hirosystems/stacks.js/issues/1671)) ([9db023e](https://github.com/hirosystems/stacks.js/commit/9db023e324f8de351c8e3f0078d52dea84f84610))
- add signer opts to agg increase ([#1669](https://github.com/hirosystems/stacks.js/issues/1669)) ([61d9d98](https://github.com/hirosystems/stacks.js/commit/61d9d980a752d8d76c48ad758c212fb024e1b4bc))

## [6.13.1](https://github.com/hirosystems/stacks.js/compare/v6.13.0...v6.13.1) (2024-04-04)

### Bug Fixes

- consolidate authId types ([7e0fdc6](https://github.com/hirosystems/stacks.js/commit/7e0fdc66161a434bd0abd03589af187e64ac399b))
- remove empty signer_key from stacker info response type ([f700a7f](https://github.com/hirosystems/stacks.js/commit/f700a7f832f66cd2021666ffbaa03b4a0f5ef803))
- update buffer max size to correct 1MB limit ([#1665](https://github.com/hirosystems/stacks.js/issues/1665)) ([91b5dab](https://github.com/hirosystems/stacks.js/commit/91b5dabf2d48616ece00a7075ad1aebc92508e6f))

## [6.13.0](https://github.com/hirosystems/stacks.js/compare/v6.12.1...v6.13.0) (2024-03-22)

### Features

- **nakamoto:** add nakamoto coinbase payload ([85daaff](https://github.com/hirosystems/stacks.js/commit/85daaffea3c8791fb6ca30a8958b4cbd74480759))
- **nakamoto:** add pox-4 signer-key to StackingClient methods ([#1614](https://github.com/hirosystems/stacks.js/issues/1614)) ([bf48df5](https://github.com/hirosystems/stacks.js/commit/bf48df5036a5f4146b31e438d7e85fab15b369d5))
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

## [6.11.1](https://github.com/hirosystems/stacks.js/compare/v6.11.0...v6.11.1) (2023-12-21)

### Bug Fixes

- update CLI docs code blocks ([#1609](https://github.com/hirosystems/stacks.js/issues/1609)) ([bbce7fa](https://github.com/hirosystems/stacks.js/commit/bbce7fa886f4b056e091bc1a3e90e9995c1d5432))

## [6.11.0](https://github.com/hirosystems/stacks.js/compare/v6.10.0...v6.11.0) (2023-12-18)

### Features

- add rate limit logic to gaia dump and restore via CLI ([#1607](https://github.com/hirosystems/stacks.js/issues/1607)) ([445a420](https://github.com/hirosystems/stacks.js/commit/445a420b1a6df4d692d54ba2b2b911a35a7ecbf3))
- implement isClarityType ([6eb1319](https://github.com/hirosystems/stacks.js/commit/6eb13197ad6b0cc11717ab6d819709e4e4c736d9))

### Bug Fixes

- handle `NoEstimateAvailable` text error body ([802487d](https://github.com/hirosystems/stacks.js/commit/802487d1a787f621692a28da5fabc02e53ffb2f9))
- type definition for map abi ([#1608](https://github.com/hirosystems/stacks.js/issues/1608)) ([39a30f2](https://github.com/hirosystems/stacks.js/commit/39a30f2e04e9e474216bbf81f27a7546d0f0792b))

## [6.10.0](https://github.com/hirosystems/stacks.js/compare/v6.9.0...v6.10.0) (2023-11-28)

### Features

- cli option to decode serialized Clarity values ([#1599](https://github.com/hirosystems/stacks.js/issues/1599)) ([25c821b](https://github.com/hirosystems/stacks.js/commit/25c821b58fa45896e10881b920df781a14a86c83))

### Bug Fixes

- add address alias for principal ([bd96bb5](https://github.com/hirosystems/stacks.js/commit/bd96bb502dc50dc86e6dbc94da43c5b2bbc35d61))
- add generic principal helper ([25176ce](https://github.com/hirosystems/stacks.js/commit/25176ce595d5eef0dab564c1a3a214403a9e280d))

## [6.9.0](https://github.com/hirosystems/stacks.js/compare/v6.8.1...v6.9.0) (2023-09-20)

### Features

- add Cl.prettyPrint ([#1551](https://github.com/hirosystems/stacks.js/issues/1551)) ([ae25ad9](https://github.com/hirosystems/stacks.js/commit/ae25ad9da9bf265d45a813db83935cc2b06f3f95))

## [6.8.1](https://github.com/hirosystems/stacks.js/compare/v6.8.0...v6.8.1) (2023-09-18)

### Bug Fixes

- add hiro product header to default network fetch function ([58eb3af](https://github.com/hirosystems/stacks.js/commit/58eb3af347c05c32065358ea66bfb372d7658e59))
- add peer network id ([db5a596](https://github.com/hirosystems/stacks.js/commit/db5a5965a4b1941217b56c93dab92191e2b80913))

## [6.8.0](https://github.com/hirosystems/stacks.js/compare/v6.7.0...v6.8.0) (2023-09-04)

### Features

- add multisig support to contract deploys ([#1539](https://github.com/hirosystems/stacks.js/issues/1539)) ([260f2d5](https://github.com/hirosystems/stacks.js/commit/260f2d58577c92ef37d0f1d276e1e0fc0fd267b3))

## [6.7.0](https://github.com/hirosystems/stacks.js/compare/v6.5.5...v6.7.0) (2023-07-24)

### Features

- **stacking:** add getSecondsUntilStackingDeadline helper method ([#1528](https://github.com/hirosystems/stacks.js/issues/1528)) ([3c819c2](https://github.com/hirosystems/stacks.js/commit/3c819c28ebda8b79aa7d0fcb3edf447f72324457))

## [6.6.0](https://github.com/hirosystems/stacks.js/compare/v6.5.5...v6.6.0) (2023-07-24)

### Features

- **stacking:** add getSecondsUntilStackingDeadline helper method ([#1528](https://github.com/hirosystems/stacks.js/issues/1528)) ([3c819c2](https://github.com/hirosystems/stacks.js/commit/3c819c28ebda8b79aa7d0fcb3edf447f72324457))

## [6.5.5](https://github.com/hirosystems/stacks.js/compare/v6.5.4...v6.5.5) (2023-07-14)

### Bug Fixes

- add missing none type for delegation without until_burn_ht ([b9cf9ef](https://github.com/hirosystems/stacks.js/commit/b9cf9efb1f89967bd2866e89f2d54e130b76a65e))
- remove post-conditions from stx transfer ([679a93a](https://github.com/hirosystems/stacks.js/commit/679a93afd75253d21bec070c85b843c34aeb516b))
- throw error if the number type used in the bigint constructor is not a safe integer value ([d6a6fcc](https://github.com/hirosystems/stacks.js/commit/d6a6fcc30e4306d90da091e2538a281968dc9ac4))
- update AccountExtendedBalances interface ([89dc787](https://github.com/hirosystems/stacks.js/commit/89dc78791b5d1db00799917e858a76addc49f963))
- update pc types to allow strict type checking ([#1494](https://github.com/hirosystems/stacks.js/issues/1494)) ([b916ef0](https://github.com/hirosystems/stacks.js/commit/b916ef06e8498f3b14403f850fc8a39881311ea7))

## [6.5.4](https://github.com/hirosystems/stacks.js/compare/v6.5.3...v6.5.4) (2023-05-17)

### Bug Fixes

- Use StacksNetworkName instead of union type ([#1500](https://github.com/hirosystems/stacks.js/pull/1500)) ([efd2255](https://github.com/hirosystems/stacks.js/commit/efd2255f979ed64b90ac33246d99cd4809620400))

## [6.5.3](https://github.com/hirosystems/stacks.js/compare/v6.5.2...v6.5.3) (2023-05-11)

### Bug Fixes

- add missing fields from `PoxInfo` ([acb7d78](https://github.com/hirosystems/stacks.js/commit/acb7d78881515949b48352b4c0a55b4de91178ee))
- **pox-3:** include pox-3 error codes ([c72d82a](https://github.com/hirosystems/stacks.js/commit/c72d82ab0b0de30bb54541064c97bcd44171f5de))
- **pox-3:** update stacking lib to always use the latest activated / current pox contract ([a2aac09](https://github.com/hirosystems/stacks.js/commit/a2aac09e5be07238b4af36af4fdd7deb09afdb11))

## [6.5.2](https://github.com/hirosystems/stacks.js/compare/v6.5.1...v6.5.2) (2023-04-28)

### Bug Fixes

- add `Cl` helper ([#1479](https://github.com/hirosystems/stacks.js/issues/1479)) ([c116a85](https://github.com/hirosystems/stacks.js/commit/c116a851c499d26326f94c368d74d75d0bf76627))
- **stacking:** return full principal instead of only address ([7e92f7f](https://github.com/hirosystems/stacks.js/commit/7e92f7fbdae14483b1ebcbaefd774202cb215d54))

## [6.5.1](https://github.com/hirosystems/stacks.js/compare/v6.5.0...v6.5.1) (2023-04-19)

### Bug Fixes

- add StacksDevnet constructor, closes [#1470](https://github.com/hirosystems/stacks.js/issues/1470) ([5789937](https://github.com/hirosystems/stacks.js/commit/5789937655f351bc07c26086f851653e20ab9c8c))
- migrate explorer domains from stacks.co to hiro.so ([0370bf6](https://github.com/hirosystems/stacks.js/commit/0370bf69950fd333a7e5e0251485668191b1bfa8))
- update cli url ([fcd6065](https://github.com/hirosystems/stacks.js/commit/fcd606539a426d2d7bd0581aa20f10ef3ce78e61))

## [6.5.0](https://github.com/hirosystems/stacks.js/compare/v6.4.0...v6.5.0) (2023-03-26)

### Features

- add pc post condition builder ([#1466](https://github.com/hirosystems/stacks.js/issues/1466)) ([ac254ba](https://github.com/hirosystems/stacks.js/commit/ac254badb73401a77f984f6fe62e8f198419786b))

### Bug Fixes

- allow contract principals in stackingclient ([ade6345](https://github.com/hirosystems/stacks.js/commit/ade63453fc5150bc2f849702ec4b814e1a51780c))

## [6.4.0](https://github.com/hirosystems/stacks.js/compare/v6.3.0...v6.4.0) (2023-03-19)

### Features

- switch makeContractDeploy and makeUnsignedContractDeploy to use clarity 2 by default ([244636f](https://github.com/hirosystems/stacks.js/commit/244636fbd07a8c5f0fefa4671a88036412932fa0))

## [6.3.0](https://github.com/hirosystems/stacks.js/compare/v6.2.1...v6.3.0) (2023-03-17)

### Features

- implement `getContractMapEntry` function ([#1461](https://github.com/hirosystems/stacks.js/issues/1461)) ([7031ead](https://github.com/hirosystems/stacks.js/commit/7031ead112f7333d165f5946eae0481f6aa9a20f))

## [6.2.1](https://github.com/hirosystems/stacks.js/compare/v6.2.0...v6.2.1) (2023-03-04)

### Bug Fixes

- revert ajv update to fix broken cli argparse ([d29754d](https://github.com/hirosystems/stacks.js/commit/d29754df72546bafce2968362dfd104e49ecd1fe))

## [6.2.0](https://github.com/hirosystems/stacks.js/compare/v6.1.1...v6.2.0) (2023-02-22)

### Features

- add additional data to auth resp ([3c9b72f](https://github.com/hirosystems/stacks.js/commit/3c9b72f61b0a0d1f618ffe47313a5ad99128627b))
- allow string name for AnchorMode ([a039c33](https://github.com/hirosystems/stacks.js/commit/a039c33292436057bd5e73d4f796441794141f96))

### Bug Fixes

- a few Clarity value construction functions were not being exported ([f0ba4a2](https://github.com/hirosystems/stacks.js/commit/f0ba4a2f0d597c27839ff1f15b2b73514ca25fd3))
- add missing fee and nonce to all stacking methods ([d81cfd1](https://github.com/hirosystems/stacks.js/commit/d81cfd1b8d1f21e737e6d98bfaa65924b3c871cc))

## [6.1.1](https://github.com/hirosystems/stacks.js/compare/v6.1.0...v6.1.1) (2023-01-30)

### Bug Fixes

- export unexported methods ([0406085](https://github.com/hirosystems/stacks.js/commit/04060859809371dfe363dc44565c494f956b34ce))

## [6.1.0](https://github.com/hirosystems/stacks.js/compare/v6.0.2...v6.1.0) (2023-01-06)

### Features

- add estimation fallback ([782a3c3](https://github.com/hirosystems/stacks.js/commit/782a3c392969e8736a4d6c7c27d491bf2e35bac6))

## [6.0.2](https://github.com/hirosystems/stacks.js/compare/v6.0.1...v6.0.2) (2022-11-30)

### Bug Fixes

- remove stacking into period3 check ([#1402](https://github.com/hirosystems/stacks.js/issues/1402)) ([d38fcc2](https://github.com/hirosystems/stacks.js/commit/d38fcc2a92e2079e34ab4a1fa94353f0ccdb2a6c))

## [6.0.1](https://github.com/hirosystems/stacks.js/compare/v6.0.0...v6.0.1) (2022-11-24)

### Bug Fixes

- remove hard-coded fee for `stackAggregationCommitIndexed` ([1edb181](https://github.com/hirosystems/stacks.js/commit/1edb181f521231b516d15b4f198600cd4c7bbeff))

## [6.0.0](https://github.com/hirosystems/stacks.js/compare/v5.0.3...v6.0.0) (2022-11-23)

### ⚠ BREAKING CHANGES

- Removes the getBTCAddress method, since it does not work with modern BTC addresses.

### Features

- A StackingClient will now automatically detect which PoX version to use for Stacking.
- Adds the following PoX Stacking methods to the StackingClient: `stackExtend`, `stackIncrease`, `delegateStackExtend`, `delegateStackIncrease`, `stackAggregationCommitIndexed`, `stackAggregationIncrease`.
- Adds the following helper methods to the StackingClient: `getAccountExtendedBalances`, `getAccountBalanceLocked`, `getDelegationStatus`, `getRewardSet`.
- add coinbase-to-alt-recipient payload type ([836b181](https://github.com/hirosystems/stacks.js/commit/836b181eca3fd2904baf2587c7875d6a6e8c95bd))
- add payload type assertions ([#1395](https://github.com/hirosystems/stacks.js/issues/1395)) ([cdd32e9](https://github.com/hirosystems/stacks.js/commit/cdd32e9323069452a4d0345174b049be1c8e1069))
- Add PoX-2 methods to @stacks/stacking client ([#1354](https://github.com/hirosystems/stacks.js/issues/1354)) ([25e326a](https://github.com/hirosystems/stacks.js/commit/25e326a8df74b92fd09b1e4dfa218eb77fd8a952))
- Add types for profiles ([#1383](https://github.com/hirosystems/stacks.js/issues/1383)) ([872478c](https://github.com/hirosystems/stacks.js/commit/872478cff87a6e7b78a3327516ed2b761b4b80a6))
- support `versioned-smart-contract` tx types introduced in Stacks 2.1 ([#1341](https://github.com/hirosystems/stacks.js/issues/1341)) ([0062a45](https://github.com/hirosystems/stacks.js/commit/0062a453fec80de93d36e0d8c5e3f37a7522c300))

## [5.0.3](https://github.com/hirosystems/stacks.js/compare/v5.0.2...v5.0.3) (2022-11-18)

### Bug Fixes

- add public key to make_keychain ([2b69958](https://github.com/hirosystems/stacks.js/commit/2b69958b4807105dffb01c61d7ce39cf569437b0))
- use correct wif encoding for testnet ([a89cc05](https://github.com/hirosystems/stacks.js/commit/a89cc054e7cc17988133364fd8a0ef776ee5ea4f))

## [5.0.2](https://github.com/hirosystems/stacks.js/compare/v5.0.1...v5.0.2) (2022-10-19)

### Bug Fixes

- rename incorrect nft post-condition codes ([9fed6a4](https://github.com/hirosystems/stacks.js/commit/9fed6a425a2803a27cf919c3038e6a5220ada465))

## [5.0.1](https://github.com/hirosystems/stacks.js/compare/v5.0.0...v5.0.1) (2022-10-04)

### Bug Fixes

- rename incorrect nft post-condition codes ([dddeb68](https://github.com/hirosystems/stacks.js/commit/dddeb6891b5ff2f6c2d2a7eb089c850a9a8c32b7))

## [5.0.0](https://github.com/hirosystems/stacks.js/compare/v4.3.8...v5.0.0) (2022-09-30)

### ⚠ BREAKING CHANGES

- Post-conditions for NFTs were renamed to be more clear: `Owns` to `DoesNotSend`, `DoesNotOwn` to `Sends`.
- **encryption:** The message signing prefix was changed from `Stacks Message Signing` to `Stacks Signed Message`.
- remove previously deprecated functions
- Removes compatibility with `bip32` package from @stacks/wallet-sdk. Now all derivation methods only rely on HDKey from @scure/bip32.
- To reduce the bundle sizes of applications using Stacks.js we are moving away from Buffer (a polyfill to match Node.js APIs) to Uint8Arrays (which Buffers use in the background anyway). To make the switch easier we have introduced a variety of methods for converting between strings and Uint8Arrays: `hexToBytes`, `bytesToHex`, `utf8ToBytes`, `bytesToUtf8`, `asciiToBytes`, `bytesToAscii`, and `concatBytes`.

### Features

- switch from buffer to uint8array ([#1343](https://github.com/hirosystems/stacks.js/issues/1343)) ([5445b73](https://github.com/hirosystems/stacks.js/commit/5445b73e05ec0c09414395331bfd37788545f1e1))

### Bug Fixes

- **encryption:** change message signing prefix, closes [#1328](https://github.com/hirosystems/stacks.js/issues/1328) ([65ce121](https://github.com/hirosystems/stacks.js/commit/65ce1218d62a8a1a0d82599611af4b11eaaed75c))
- remove duplicate helper method ([f57bbef](https://github.com/hirosystems/stacks.js/commit/f57bbeffb898b9073cc8f15457ca4032dcc28d45))
- remove previously deprecated functions ([b2a5f96](https://github.com/hirosystems/stacks.js/commit/b2a5f96fd24e8da7cb9b4e1cf4d7b654f6e5b00c))
- update post-condition names for non-fungible tokens ([9fbdcea](https://github.com/hirosystems/stacks.js/commit/9fbdcea262a4f8af24740e35b58c886e636ad292))

## [4.3.8](https://github.com/hirosystems/stacks.js/compare/v4.3.7...v4.3.8) (2022-09-29)

### Bug Fixes

- add missing customizable prefixes ([a1d385c](https://github.com/hirosystems/stacks.js/commit/a1d385c39b29ad712e61223f8473400668579035))

## [4.3.7](https://github.com/hirosystems/stacks.js/compare/v4.3.6...v4.3.7) (2022-09-28)

### Bug Fixes

- correctly verify future message signing prefix ([d27e054](https://github.com/hirosystems/stacks.js/commit/d27e054f2639fcea4c873ce942d966e2aa4ca926))

## [4.3.6](https://github.com/hirosystems/stacks.js/compare/v4.3.5...v4.3.6) (2022-09-23)

### Bug Fixes

- add deprecation notices for upcoming major release ([9341e20](https://github.com/hirosystems/stacks.js/commit/9341e20501618d0cd565f24395277aa5c876aa78))
- export profile functions for wallet-sdk ([7426add](https://github.com/hirosystems/stacks.js/commit/7426add76b3d3b5a8f65256caaa19edc78e616dc))

## [4.3.5](https://github.com/hirosystems/stacks.js/compare/v4.3.4...v4.3.5) (2022-08-24)

### Bug Fixes

- offload bip39 from keychain ([132e0c5](https://github.com/hirosystems/stacks.js/commit/132e0c5beae1fcc5623256ee89988d7ac99725ac))

## [4.3.4](https://github.com/hirosystems/stacks.js/compare/v4.3.3...v4.3.4) (2022-08-02)

### Bug Fixes

- migrate subdomains to wallet key address ([b32cb41](https://github.com/hirosystems/stacks.js/commit/b32cb417f593200b1de13a704eceda7c3ab7f5a8))
- update subdomainOpToZFPieces ([159157d](https://github.com/hirosystems/stacks.js/commit/159157d778476c8392a3c5bc274b57596b47f6f9))

## [4.3.3](https://github.com/hirosystems/stacks.js/compare/v4.3.2...v4.3.3) (2022-07-19)

### Bug Fixes

- update make_keychain command ([62355bc](https://github.com/hirosystems/stacks.js/commit/62355bc69dbeddd90773ed093e634c06460e86ce))
- update version buffer size for pox addresses ([b7acc7d](https://github.com/hirosystems/stacks.js/commit/b7acc7de73e90a1969048696c481182d7ada21eb))

## [4.3.2](https://github.com/hirosystems/stacks.js/compare/v4.3.1...v4.3.2) (2022-07-12)

### Bug Fixes

- convert checksum to buffer ([963b028](https://github.com/hirosystems/stacks.js/commit/963b028d0db7b1fb57fef0a68f540ec35c80743a))

## [4.3.1](https://github.com/hirosystems/stacks.js/compare/v4.3.0...v4.3.1) (2022-07-05)

### Bug Fixes

- support legacy signature verification ([8446724](https://github.com/hirosystems/stacks.js/commit/844672480c6540b65df8d793b4bac0ec7ddd9205))
- use correct buffer size for hashmode in stacking ([ca51914](https://github.com/hirosystems/stacks.js/commit/ca51914276da9434ac8df9cb9e7fb1e648ad2173))

## [4.3.0](https://github.com/hirosystems/stacks.js/compare/v4.2.2...v4.3.0) (2022-06-16)

### Features

- add SIP-018 support ([a4c0577](https://github.com/hirosystems/stacks.js/commit/a4c0577c7e6fb5010eb886c3b04c2636282e442a)), closes [#1283](https://github.com/hirosystems/stacks.js/issues/1283) [#1281](https://github.com/hirosystems/stacks.js/issues/1281)

### Bug Fixes

- add clarity typedoc annotations ([b95783d](https://github.com/hirosystems/stacks.js/commit/b95783db54d8a5294c7f10e67ccb0f2c529aef75))
- export structuredDataSignature ([5e8736b](https://github.com/hirosystems/stacks.js/commit/5e8736bcf572d7334947c040b218a82598bfb2e0))

## [4.2.2](https://github.com/hirosystems/stacks.js/compare/v4.2.1...v4.2.2) (2022-06-01)

### Bug Fixes

- update jsontokens lib ([462f5e2](https://github.com/hirosystems/stacks.js/commit/462f5e2fe5809e8c0f471054b9ed31d8b311076b))

## [4.2.1](https://github.com/hirosystems/stacks.js/compare/v4.2.0...v4.2.1) (2022-05-28)

### Bug Fixes

- revert polyfill removal ([695ceb9](https://github.com/hirosystems/stacks.js/commit/695ceb9a93f60af79419d92ece70cb7075abdad9))

## [4.2.0](https://github.com/hirosystems/stacks.js/compare/v4.1.2...v4.2.0) (2022-05-25)

### Features

- add missing rsv functions ([4e7fcf5](https://github.com/hirosystems/stacks.js/commit/4e7fcf5b9ae2000a903d49ac31a424349f839637))

### Bug Fixes

- offload bitcoinjs from stacking, closes [#1259](https://github.com/hirosystems/stacks.js/issues/1259) ([8912bca](https://github.com/hirosystems/stacks.js/commit/8912bca06b1281e453ff09b3513f0e08906eeae6))

## [4.1.2](https://github.com/hirosystems/stacks.js/compare/v4.1.1...v4.1.2) (2022-05-23)

### Bug Fixes

- update api client ([f8cd319](https://github.com/hirosystems/stacks.js/commit/f8cd319212360cb87f537436278415f4f8d4cacc))

## [4.1.1](https://github.com/hirosystems/stacks.js/compare/v4.1.0...v4.1.1) (2022-05-19)

### Bug Fixes

- add blockstack dependency ([79152d3](https://github.com/hirosystems/stacks.js/commit/79152d30918401fcc3b9799aaab38da6d7be056d))

## [4.1.0](https://github.com/hirosystems/stacks.js/compare/v4.0.2...v4.1.0) (2022-05-19)

### Features

- add fetch middleware for api keys and request init ([ef45632](https://github.com/hirosystems/stacks.js/commit/ef456327a3e1dcdc2aa364cbe55e47225029c5d2))

## [4.0.2](https://github.com/hirosystems/stacks.js/compare/v4.0.1...v4.0.2) (2022-05-19)

### Bug Fixes

- **message-signing:** add working utility fn ([20b721c](https://github.com/hirosystems/stacks.js/commit/20b721cdccc2fb73f98aad80eb6d5e8e9cb987d0))
- offload bitcoinjs dependency from storage ([78d2050](https://github.com/hirosystems/stacks.js/commit/78d2050d86574ec524a030a9ee9b15ec4d557240))
- offload bn.js dependency ([91b511b](https://github.com/hirosystems/stacks.js/commit/91b511b45a9a64953fe9418a50dcb122ca948996))
- update get btc address ([8ad4d83](https://github.com/hirosystems/stacks.js/commit/8ad4d8361ae72472764105c2c8e0cea96f9b5a2c))

## [4.0.1](https://github.com/hirosystems/stacks.js/compare/v4.0.0...v4.0.1) (2022-05-09)

### Bug Fixes

- allow referrer header in request options ([70ea915](https://github.com/hirosystems/stacks.js/commit/70ea9156f6916f32e40adf7464322476a9acd8ab))
- offload bip39 from wallet-sdk ([701416a](https://github.com/hirosystems/stacks.js/commit/701416a634ac730b8ca9f8b1e355aa5032fae0f4))
- support length estimation in fee estimate interface ([194442c](https://github.com/hirosystems/stacks.js/commit/194442c489a4eba3a90296bc3187abb84fe8053e))

## [4.0.0](https://github.com/hirosystems/stacks.js/compare/v3.5.0...v4.0.0) (2022-04-20)

### ⚠ BREAKING CHANGES

- This change REMOVES the `username` attribute from auth token payloads and therefore also from userData in @stacks/connect. Hence, there is NO MORE username verification done by @stacks/connect automatically.

### Features

- Add encode / decode messages to support ([ad300fb](https://github.com/hirosystems/stacks.js/commit/ad300fb1564331aebe70e710dfd8039312d4a17d)), closes [#1231](https://github.com/hirosystems/stacks.js/issues/1231)
- remove username from payload and userdata ([926c549](https://github.com/hirosystems/stacks.js/commit/926c549d15ea5488820f5a4a144ca74e6d30211d))

### Bug Fixes

- deserialize partially signed multisig transaction ([52d4045](https://github.com/hirosystems/stacks.js/commit/52d4045abb5b91fe48756f743cfda5eff135f7dc))
- offload bip32 dependency from wallet-sdk ([c729006](https://github.com/hirosystems/stacks.js/commit/c729006b8d37a18005adff146aea5f0f9aaf6d5d))
- offload bip39 dependency from encryption ([7973100](https://github.com/hirosystems/stacks.js/commit/797310003c981b8eb5e081f0f89e082986cd76d2))
- private key compression ([cf0a3ab](https://github.com/hirosystems/stacks.js/commit/cf0a3ab9b04876c942d241e554e96db17e512b5b))
- remove doPublicKeysMatchUsername ([e2f3cf9](https://github.com/hirosystems/stacks.js/commit/e2f3cf93f1ae5148f78620e37786104cd482d7e1))
- remove username checking ([e32781b](https://github.com/hirosystems/stacks.js/commit/e32781ba2a8af5afbe83b4a02419e0cc4a6f5bb0))

## [3.5.0](https://github.com/hirosystems/stacks.js/compare/v3.4.0...v3.5.0) (2022-03-30)

### Features

- add appPrivateKeyFromWalletSalt ([#1212](https://github.com/hirosystems/stacks.js/issues/1212)) ([ac3858c](https://github.com/hirosystems/stacks.js/commit/ac3858cc0c5bd6aba0ff2c71704161bb4926e387))

### Bug Fixes

- offload ramdombytes library from encryption ([fe3f30e](https://github.com/hirosystems/stacks.js/commit/fe3f30ee4ea110ef150a1b407bde0af2feba6783))
- offload ramdombytes library from transactions ([c06e5b8](https://github.com/hirosystems/stacks.js/commit/c06e5b838fe42c376b9347f486393ea31bc54ddb))
- remove unused dependency ramdombytes from wallet-sdk ([61eeb57](https://github.com/hirosystems/stacks.js/commit/61eeb57ab0b4e41838e154701165ac0fe98b760c))
- use noble-secp256k1 in encryption to replace elliptic dependency ([8cc1774](https://github.com/hirosystems/stacks.js/commit/8cc1774d06cbe63ba4188800b57cc8cc159712a6))
- use noble-secp256k1 in encryption to replace elliptic dependency ([ca778e4](https://github.com/hirosystems/stacks.js/commit/ca778e493e4b8651b0db896a469617be65139b30))

## [3.4.0](https://github.com/hirosystems/stacks.js/compare/v3.3.0...v3.4.0) (2022-03-02)

### Features

- on restoreWalletAccounts, only support stxPrivateKey ([#1204](https://github.com/hirosystems/stacks.js/issues/1204)) ([1fbd30e](https://github.com/hirosystems/stacks.js/commit/1fbd30e8d1bc459efae2967ed084151e57cc90a9))

## [3.3.0](https://github.com/hirosystems/stacks.js/compare/v3.2.0...v3.3.0) (2022-02-23)

### Bug Fixes

- add preorder name command in cli ([ca76f06](https://github.com/hirosystems/stacks.js/commit/ca76f06cda82623ca48b3d623da6f2c5cb2851c6))
- add register command in cli ([85c7dd9](https://github.com/hirosystems/stacks.js/commit/85c7dd9d770aba5c6a60b8702bb57239c7fd14bc))
- use noble-secp256k1 in transaction to replace elliptic dependency ([534f1b8](https://github.com/hirosystems/stacks.js/commit/534f1b8acf5ab1267860af0d2a9f1ba19bb35303))

## [3.2.0](https://github.com/hirosystems/stacks.js/compare/v3.1.1...v3.2.0) (2022-02-02)

### Features

- reduce reliance on network package ([422fda3](https://github.com/hirosystems/stacks.js/commit/422fda3cd43e16ae24ea9d97297b423a90823672))

### Bug Fixes

- remove lodash dependency ([96b3064](https://github.com/hirosystems/stacks.js/commit/96b306446510eba33fe99665e0e02a84bca901c5))

## [3.1.1](https://github.com/hirosystems/stacks.js/compare/v3.1.0...v3.1.1) (2021-12-20)

### Bug Fixes

- key exposed in api call, closes [#1152](https://github.com/hirosystems/stacks.js/issues/1152) ([08012b2](https://github.com/hirosystems/stacks.js/commit/08012b2728f8aad0b18f751456532dceaf1108de))

## [3.1.0](https://github.com/hirosystems/stacks.js/compare/v3.0.0...v3.1.0) (2021-12-16)

### Bug Fixes

- update default core node url ([1208996](https://github.com/hirosystems/stacks.js/commit/120899670b35cca31f49daa9cc5c05a6061dc9aa))

## [3.0.0](https://github.com/hirosystems/stacks.js/compare/v2.0.1...v3.0.0) (2021-11-30)

### ⚠ BREAKING CHANGES

- use new /v2/fees/transaction endpoint for fee estimation
- address Matt's comment and add type guard
- avoid mutating Auth
- change Authorization from a class to functional interface

### Features

- add address/signer verification to verifySingleSig() ([589b14d](https://github.com/hirosystems/stacks.js/commit/589b14df3ae6454c202e56e60ff90bd4294c07d8))
- add more spending condition tests ([930f34d](https://github.com/hirosystems/stacks.js/commit/930f34d3d23f24e7c849593d50a1bf469d068986))
- add unsigned equivalent of make contract deploy ([792c2ae](https://github.com/hirosystems/stacks.js/commit/792c2ae615a1cd2dca4104b1da22293e7b2381f2))
- add verifyMultiSig() ([0378747](https://github.com/hirosystems/stacks.js/commit/03787470ffbf87673cda7d2a9d13581992376491))
- bring back cli command get_app_keys ([f7d2c6c](https://github.com/hirosystems/stacks.js/commit/f7d2c6c474146d6a7129b91ffac7f3e62802ceba))
- ci job to list circular dependencies ([9816b3c](https://github.com/hirosystems/stacks.js/commit/9816b3c7ae4e9a8f7fcff219239f8b6952f70471))
- cli add custom derivation path option ([9ba53be](https://github.com/hirosystems/stacks.js/commit/9ba53be4dd0cc09286a525017553218f8e5870b2))
- construct TransactionSigner with partially signed multi-sig transaction ([0ada72a](https://github.com/hirosystems/stacks.js/commit/0ada72aaeaa66ade8c01243feb50ac2aab7a6e0e))
- construct TransactionSigner with partially signed multi-sig transaction ([c0ae13f](https://github.com/hirosystems/stacks.js/commit/c0ae13fdbd49dd2034475c59952b4c9f2a595152))
- export user app file url from storage ([28d5187](https://github.com/hirosystems/stacks.js/commit/28d5187c836318876a0115da8264ab8b66509f95))
- multisig spending condition tests use integers, not BigNums ([e34ba2e](https://github.com/hirosystems/stacks.js/commit/e34ba2e76fabccb77b39d329bcc75bdac2b93b3e))

### Bug Fixes

- add custom bigint pow to prevent transpilers incorrect conversion ([f0334cf](https://github.com/hirosystems/stacks.js/commit/f0334cf8581bc5aced724e8f151a826018e0f3f8))
- avoid use of getters to enable safer serialization ([6f626a1](https://github.com/hirosystems/stacks.js/commit/6f626a120229632ee215f28bc5d2ebaa40857c43))
- bigint -> number ([78c7960](https://github.com/hirosystems/stacks.js/commit/78c79600c1a0b7fde1af689f83a0c63f94d036aa))
- check if spending condition has too many sigs ([6ad03fd](https://github.com/hirosystems/stacks.js/commit/6ad03fd15e218647299e44a40616501f5b8f4f91))
- cli add missing clarity types in contract call ([a02665a](https://github.com/hirosystems/stacks.js/commit/a02665ad38cbf49e79dc315d97b23b766886eae0))
- endpoint response type ([647833a](https://github.com/hirosystems/stacks.js/commit/647833a0ca3f61d1ce549155c94c2d2127dff772))
- fix etags deletion from localstorage on parallel calls to delete file ([1af7a18](https://github.com/hirosystems/stacks.js/commit/1af7a18b1017981f5b44c1006d940eb4648d0491))
- github action for generating updated docs on release ([6d9ff4d](https://github.com/hirosystems/stacks.js/commit/6d9ff4df00469bb1015e031bb04cc3423357de5b))
- improve signOrigin oversign check; fields which are not a MessageSignature don't count in overlap check ([abe2909](https://github.com/hirosystems/stacks.js/commit/abe29096f682abb327a8134a5d4d0e7d6e20d5dc))
- jsdom failing with init bigint ([ba4d351](https://github.com/hirosystems/stacks.js/commit/ba4d3511ae023afc325faece1a4faf7a154806cb))
- **network:** upgrade and republish ([f061612](https://github.com/hirosystems/stacks.js/commit/f0616128699bf5634c4f0e93f913b41921e908ba))
- remove circular dependencies form keychain package ([140f62d](https://github.com/hirosystems/stacks.js/commit/140f62ddbf56b6aeca30198164a3b2dde26fa41b))
- remove circular dependencies from cli ([4a29e42](https://github.com/hirosystems/stacks.js/commit/4a29e42ceae7c0c4bde52d2827e234ebac2548ea))
- remove circular dependencies from transactions ([0d0b5fb](https://github.com/hirosystems/stacks.js/commit/0d0b5fbddea4cb5e64c62481cea6feb904b583a9))
- remove circular dependencies from wallet-sdk ([e9e626d](https://github.com/hirosystems/stacks.js/commit/e9e626d8b3b4dbfab6c39701e8b29fb6f3131ad3))
- return correct signature in sponsored spending conditions ([e83cdc6](https://github.com/hirosystems/stacks.js/commit/e83cdc64a215f393d75808934c8bb747f8770acb))
- review and update bns readme ([3d36f8e](https://github.com/hirosystems/stacks.js/commit/3d36f8ed2cf0387e6b39995178dcc7e9d2952755))
- review and update cli readme ([ae8c7f7](https://github.com/hirosystems/stacks.js/commit/ae8c7f7285291b48799e784b34d13e5220e0b4be))
- review and update encryption readme ([79735f4](https://github.com/hirosystems/stacks.js/commit/79735f44b8f5489a2840f146b4a168f46a34609f))
- review and update keychain readme ([a834742](https://github.com/hirosystems/stacks.js/commit/a834742f72fffe63bc89a1745be87788dd6d098d))
- review and update profile readme ([227b25a](https://github.com/hirosystems/stacks.js/commit/227b25a9f7821e986e6a8aa9afd958ec0a35c437))
- review and update stacking readme ([d4bc99e](https://github.com/hirosystems/stacks.js/commit/d4bc99e4cdb3ad59932d1627d971da9416e252c3))
- review and update storage readme ([d9df8f5](https://github.com/hirosystems/stacks.js/commit/d9df8f506c5fb5ead427d3717b320f8ee7ce673c))
- review and update transactions readme ([0421590](https://github.com/hirosystems/stacks.js/commit/0421590c84fda94ae22f78e12076b9dd7533201f))
- throw error if authType not set ([8ae3f34](https://github.com/hirosystems/stacks.js/commit/8ae3f34ce5c75236c4aeec56de2a991509cfcc13))
- trigger workflows on external pull requests [#1114](https://github.com/hirosystems/stacks.js/issues/1114) ([8b4fdb5](https://github.com/hirosystems/stacks.js/commit/8b4fdb5bdf5e14f80e8c8169d3d281a6940ba087))
- update getFee usage in stacking lib ([34dab52](https://github.com/hirosystems/stacks.js/commit/34dab525304426e0a0d594eb46968541900fad7c))
- update readme for broadcastTransaction ([c575ee9](https://github.com/hirosystems/stacks.js/commit/c575ee9ee8645fea646da0ea17dabe3f2aff85af))
- update test and fix oversign check ([a26898e](https://github.com/hirosystems/stacks.js/commit/a26898e3c6e10c779e9e4d96125241c7f412e223))
- use new /v2/fees/transaction endpoint for fee estimation ([888e8fa](https://github.com/hirosystems/stacks.js/commit/888e8fafc48b137c0fdfb16dfc3b66ce0ea9bd77))

### Code Refactoring

- address Matt's comment and add type guard ([642f281](https://github.com/hirosystems/stacks.js/commit/642f281397a114a6b09b7c3baf5f0aa89febeebc))
- avoid mutating Auth ([c91decb](https://github.com/hirosystems/stacks.js/commit/c91decbfb39d4ab794115c895fe9d4b84f908c35))
- change Authorization from a class to functional interface ([327a153](https://github.com/hirosystems/stacks.js/commit/327a153a721dc40b152057090f8cd0b0bfb3495b))

## [2.0.1](https://github.com/hirosystems/stacks.js/compare/v1.5.0-alpha.0...v2.0.1) (2021-08-09)

### Features

- add @stacks/wallet-sdk package ([49783f9](https://github.com/hirosystems/stacks.js/commit/49783f9713e7a016909f76ab816fdd486d22daae))
- add regtest to list of available networks ([f572477](https://github.com/hirosystems/stacks.js/commit/f572477ca0e5bc5e862c8a4e2fcc276655ee55a3)), closes [#1041](https://github.com/hirosystems/stacks.js/issues/1041)
- add reward methods for set address in stacking package ([2676d71](https://github.com/hirosystems/stacks.js/commit/2676d71fc579702d3f8bfb81261f8bcdc93814e1))
- allow nested concrete ClarityValue types to be specified ([da68307](https://github.com/hirosystems/stacks.js/commit/da68307499114de106f8fa5b4171580461997824))
- function to convert pox address details to a btc address ([b6ae9ef](https://github.com/hirosystems/stacks.js/commit/b6ae9efea30e14950ae65e290e229a1ea9ebfc3a))
- refactor all js `number` and `bn.js` usages in Clarity integer values to native bigint ([1f78339](https://github.com/hirosystems/stacks.js/commit/1f783397e7f5b38aabb6e0342af71b58022aed4c))
- remove default anchormode from tx builders ([768cc57](https://github.com/hirosystems/stacks.js/commit/768cc57ddfbabfabaa4138e6aba71a131f38f229))
- support parsing btc address from a Clarity tuple value ([cb06f12](https://github.com/hirosystems/stacks.js/commit/cb06f12ea2080f0ef024d994bff4559edfb2455b))
- use lerna hoisting for fast monorepo bootstrapping ([cfd76ab](https://github.com/hirosystems/stacks.js/commit/cfd76abe7819c23489721120be0c7f712b932d96))

### Bug Fixes

- add missing stx burn and NFT post conditions ([7e0fcba](https://github.com/hirosystems/stacks.js/commit/7e0fcba3f52062e9531923e82676e1121a9a3eb0))
- always return string quoted integer rather than `number | string` depending on bit size ([6af4abe](https://github.com/hirosystems/stacks.js/commit/6af4abe92e995140d4e8becab3aacabd17dbce92))
- bn.js lib accepts strings containing non-integer values and results in weird behavior ([da07f10](https://github.com/hirosystems/stacks.js/commit/da07f108061a29af1879eef6b6054e0a45b6b9d1))
- BREAKING CHANGE: make coreApiUrl readonly for stacks network and initialize in constructor ([5d8cf6d](https://github.com/hirosystems/stacks.js/commit/5d8cf6d366665dace2df8102049d3f7ac1bf437e))
- BREAKING CHANGE: make the broadcastTransaction response type consistent and always return an object ([3e4c197](https://github.com/hirosystems/stacks.js/commit/3e4c197f3a4763bc4ec6b7165cbd9db793bc2c2d))
- broken types following diverged network config changes ([1cd9612](https://github.com/hirosystems/stacks.js/commit/1cd96128334465c461665cf079532f66b893b938))
- debugging jest tests from any cwd ([626c5fc](https://github.com/hirosystems/stacks.js/commit/626c5fccb4dff213f000923ab69c7ed4f5eb48a0))
- fix coreNode error when fetching public data with no user session ([144754b](https://github.com/hirosystems/stacks.js/commit/144754b80f05bff1a4656be87d4ab09b4076d37c))
- fix optional argument encoding and update test cases in bns transferName, renewName calls ([6f4f8fa](https://github.com/hirosystems/stacks.js/commit/6f4f8fa67e208541adf9acbe780f74a8d002e5a2))
- fix stx balance command crash if address not valid ([8cc69df](https://github.com/hirosystems/stacks.js/commit/8cc69df21bc33eda6e9ec3cd6be6bfca2ec7b8ad))
- fixed lint issue ([1dab3a9](https://github.com/hirosystems/stacks.js/commit/1dab3a9d17fec2e4dd9f075f97cf28a1b93a6da7))
- generated explorer URL for faucet command ([38540a9](https://github.com/hirosystems/stacks.js/commit/38540a9e328a42e90a78861d9c62c8033a0679bc))
- handle empty list in getCVTypeString ([#1033](https://github.com/hirosystems/stacks.js/issues/1033)) ([1ff5b03](https://github.com/hirosystems/stacks.js/commit/1ff5b03c28c664953260105d333cebfa2fd64e5f))
- **keychain:** do not use default import ([3528b65](https://github.com/hirosystems/stacks.js/commit/3528b6509ef69b2cb70d734fb15e3d4ad2a1f8e3))
- make `lookupProfile` work with newest stacks API ([598ce15](https://github.com/hirosystems/stacks.js/commit/598ce158e51e133c25a8f5d1822567310c133739))
- prettify ([b471de9](https://github.com/hirosystems/stacks.js/commit/b471de968acba970b1c5337100220cc75a05e44e))
- remove console.log ([3e55c94](https://github.com/hirosystems/stacks.js/commit/3e55c94d1bef2417aa3f25710c3171632c1ac8f3))
- remove unused const ([e506cf3](https://github.com/hirosystems/stacks.js/commit/e506cf3b5faf2d030b4e6da82e330002783db1c0))
- removeread only and add private field to prevent run time assignment ([62709aa](https://github.com/hirosystems/stacks.js/commit/62709aa5b6483299718063482bc26d6e94cc8c1c))
- The transaction ABI validation should accept lists that are less than or equal to the max size specified in the arguments type ([53dd641](https://github.com/hirosystems/stacks.js/commit/53dd6410554dea195dc7e206d39a1995c6fc1fae))
- updated downstream dependencies ([c636819](https://github.com/hirosystems/stacks.js/commit/c636819ae20315b4f232beb15044641689288396))
- use stacks.js repo url ([cd2a684](https://github.com/hirosystems/stacks.js/commit/cd2a6849d6a2bf20109f85ac2c9afe467accf1a9))
- verify that the public key is a secp256k1 point ([1cfef11](https://github.com/hirosystems/stacks.js/commit/1cfef115515aaa6f97fe188f29c4f66f198aefcd))

## [1.4.1](https://github.com/blockstack/blockstack.js/compare/v1.4.1-alpha.0...v1.4.1) (2021-04-20)

**Note:** Version bump only for package stacks.js

## [1.4.1-alpha.0](https://github.com/blockstack/blockstack.js/compare/v1.4.0-alpha.0...v1.4.1-alpha.0) (2021-04-15)

### Bug Fixes

- git rid of unnecessary 0x prefix when hashing + salting ([afd9058](https://github.com/blockstack/blockstack.js/commit/afd9058db5050859956b9ad83a2c8af5815ba7a2))

## [1.4.0-alpha.0](https://github.com/blockstack/blockstack.js/compare/v1.3.5...v1.4.0-alpha.0) (2021-04-12)

### Bug Fixes

- **cli:** add typescript as dependency ([2bec5d4](https://github.com/blockstack/blockstack.js/commit/2bec5d43976ad11c622db1a9a314d9c4e9310ac2)), closes [#964](https://github.com/blockstack/blockstack.js/issues/964)
- **cli:** support testnet address in convert_address ([aa338c3](https://github.com/blockstack/blockstack.js/commit/aa338c31cfed6cba6d1b382d29db179a26ff88cf))
- price functions ([a79c5e8](https://github.com/blockstack/blockstack.js/commit/a79c5e86d20d7ba5b7928ef0472bb77fd43eb09e))
- promise resolve type ([403b14e](https://github.com/blockstack/blockstack.js/commit/403b14edf53e89cd6df8ede68a259dd22a6b0996))
- remove .toString() ([0fa14e2](https://github.com/blockstack/blockstack.js/commit/0fa14e2b7a8ef70652418d1a9b77c6fbb38e0fdc))
- throw error if unexpected chainID ([e164ae3](https://github.com/blockstack/blockstack.js/commit/e164ae3c63c85b04707e67b234b57075a811730d))
- typos ([011f379](https://github.com/blockstack/blockstack.js/commit/011f379dfa61138c94f493c800d97822bb750695))
- typos ([cea7aac](https://github.com/blockstack/blockstack.js/commit/cea7aac4de36c61021ad1ca4ee673ad8c76bffcd))
- update BNS contract address ([ca5e5bf](https://github.com/blockstack/blockstack.js/commit/ca5e5bf4699543e17f7c494f1e72e23e0c659c18))
- update BNS contract call functions ([bf855e7](https://github.com/blockstack/blockstack.js/commit/bf855e7870e5443c2f21dd62d645d7bb5e06303e))
- validate with abi, hash zonfiles ([bccd9b5](https://github.com/blockstack/blockstack.js/commit/bccd9b5dd1801a77ff15836a89bc477410e520f5))

### Features

- add BNS package ([6eb16cc](https://github.com/blockstack/blockstack.js/commit/6eb16ccaaf497b7a6705983078e4667aa8f04cf9))
- **cli:** add WIF format to make_keychain ([73fea0d](https://github.com/blockstack/blockstack.js/commit/73fea0dfb9c8b695249c59a88caae31a16c9f484)), closes [#938](https://github.com/blockstack/blockstack.js/issues/938)
- get name and namespace price in bns lib ([e5f53b0](https://github.com/blockstack/blockstack.js/commit/e5f53b0f2fa62f6ea63554786d250df80fc6a695))
- update rest of functions that expect attachment ([d6f64b3](https://github.com/blockstack/blockstack.js/commit/d6f64b3d8f59d54f3c9731701ebcf28c64c7bee0))
- util for zonefile hash ([eaa1fce](https://github.com/blockstack/blockstack.js/commit/eaa1fcec61b98950424a0eb0606645a0912aa3ae))

## [1.3.5](https://github.com/blockstack/blockstack.js/compare/v1.3.4...v1.3.5) (2021-03-26)

### Bug Fixes

- use spending conditions key encoding to properly recover public key ([a0dbba8](https://github.com/blockstack/blockstack.js/commit/a0dbba8710a2e9e2b5690b8f380c7b9d1db41875))

## [1.3.4](https://github.com/blockstack/blockstack.js/compare/v1.3.3...v1.3.4) (2021-03-18)

### Features

- export stacking/utils functions ([24c7314](https://github.com/blockstack/blockstack.js/commit/24c73148afafceb5be9e172a8bc325e1ad54a800))

### Reverts

- Revert "v1.4.0" ([4356ddb](https://github.com/blockstack/blockstack.js/commit/4356ddbc8d83a83c97efaf6d8d1a7abefbc4f6d9))

## [1.3.3](https://github.com/blockstack/blockstack.js/compare/v1.3.2...v1.3.3) (2021-03-18)

### Bug Fixes

- [#973](https://github.com/blockstack/blockstack.js/issues/973) stacking lib only allow p2pkh and p2sh btc addresses ([af00bd5](https://github.com/blockstack/blockstack.js/commit/af00bd5f315a4877f6af0fd71e6373d664afbe6a))
- export cvToValue function ([42c138b](https://github.com/blockstack/blockstack.js/commit/42c138b975ea08e75fea78db39b77166c08f193b))
- package.json to reduce vulnerabilities ([48a72fb](https://github.com/blockstack/blockstack.js/commit/48a72fba2eda7e5f0bc7dbd649f274f88d01bd1d))

## [1.3.2](https://github.com/blockstack/blockstack.js/compare/v1.3.1...v1.3.2) (2021-03-11)

**Note:** Version bump only for package stacks.js

## [1.3.1](https://github.com/blockstack/blockstack.js/compare/v1.3.0...v1.3.1) (2021-03-10)

**Note:** Version bump only for package stacks.js

## [1.3.0](https://github.com/blockstack/blockstack.js/compare/v1.2.4...v1.3.0) (2021-03-08)

### Features

- add hex string and Buffer support to `deserializedTransaction` ([be379b2](https://github.com/blockstack/blockstack.js/commit/be379b257a31329618e5e9db91e25bbe3bef1b61))
- properly serialize uncompressed auth fields ([e259fe1](https://github.com/blockstack/blockstack.js/commit/e259fe176478c3ae35f1d12d9f77be377c167f65))

## [1.2.4](https://github.com/blockstack/blockstack.js/compare/v1.2.3...v1.2.4) (2021-02-26)

**Note:** Version bump only for package stacks.js

## [1.2.3](https://github.com/blockstack/blockstack.js/compare/v1.2.2...v1.2.3) (2021-02-25)

### Bug Fixes

- don't multiply with cycleDuration ([a6fab4e](https://github.com/blockstack/blockstack.js/commit/a6fab4e5c3038cf4eaa7bd997b7d4c5104ca6858))
- export cvToValue function ([835e68e](https://github.com/blockstack/blockstack.js/commit/835e68e14e346c2417ac21c1c85bdc68d3de6e2e))
- getDelegateStxOptions ([42eea7e](https://github.com/blockstack/blockstack.js/commit/42eea7ec9da23fae67ea8499e0db51665acffe0e))
- ignore .html files ([e2d5810](https://github.com/blockstack/blockstack.js/commit/e2d58100359b705db4eed680e03116626db3b7cd))
- prettier ([f09f446](https://github.com/blockstack/blockstack.js/commit/f09f4462d887f3dc9684d0d861e8a56c44fb88fe))
- prettier in tx lib ([404d917](https://github.com/blockstack/blockstack.js/commit/404d9178e780b8a42e46767a3556dfff9700ff5f))
- run prettier ([857e342](https://github.com/blockstack/blockstack.js/commit/857e342fd8a69f2d3dfa3d93698790bb33123977))
- run prettier ([6a1caae](https://github.com/blockstack/blockstack.js/commit/6a1caaed6818f60a2d838c1b4dabc902d168be72))

## [1.2.2](https://github.com/blockstack/blockstack.js/compare/v1.2.2-alpha.0...v1.2.2) (2021-02-16)

**Note:** Version bump only for package stacks.js

## [1.2.2-alpha.0](https://github.com/blockstack/blockstack.js/compare/v1.2.1-alpha.0...v1.2.2-alpha.0) (2021-02-16)

**Note:** Version bump only for package stacks.js

## [1.2.1-alpha.0](https://github.com/blockstack/blockstack.js/compare/v1.2.0...v1.2.1-alpha.0) (2021-02-16)

**Note:** Version bump only for package stacks.js

## [1.2.0](https://github.com/blockstack/blockstack.js/compare/v1.1.0...v1.2.0) (2021-02-15)

### Bug Fixes

- export postcondition serialize ([39bc470](https://github.com/blockstack/blockstack.js/commit/39bc470cfa554bc73d96e564a1f373a8dd26e8d6))
- make_keychain help description ([edd0551](https://github.com/blockstack/blockstack.js/commit/edd055159786c8a7cae757b9dfcf85ab04f2a3de))
- versions out of sync with lerna ([56e6438](https://github.com/blockstack/blockstack.js/commit/56e643869555c4752713a50e54c67c3f1671f6f5))

### Features

- add attachment arg to broadcastTransaction() ([f75f250](https://github.com/blockstack/blockstack.js/commit/f75f250a86789a8d1a6f5a09842ff81bfa345b96))
- use lodash assign ([3d200e7](https://github.com/blockstack/blockstack.js/commit/3d200e7f67cf1e2abeca5adac787a22bbb0b2c49))

## [1.1.0](https://github.com/blockstack/blockstack.js/compare/v1.0.2...v1.1.0) (2021-01-29)

### Bug Fixes

- lint, docs, and updates after merging master ([1206ab5](https://github.com/blockstack/blockstack.js/commit/1206ab534e596d1860b1a7defbba3af632c1ca2b))
- set node version in master CI checks ([a7e2ec6](https://github.com/blockstack/blockstack.js/commit/a7e2ec68246c2b6c6cffd10df4a5be78c0bd0e75))
- updates based on feedback ([ba15c2f](https://github.com/blockstack/blockstack.js/commit/ba15c2f296a1b268b5aef9bfeb8f590492388a2d))

### Features

- add delegate methods ([5b9a3ed](https://github.com/blockstack/blockstack.js/commit/5b9a3edb406197c3b88917461f1ec3634f07c83e))

## [1.0.2](https://github.com/blockstack/blockstack.js/compare/v1.0.1...v1.0.2) (2021-01-28)

### Bug Fixes

- check okay before parsing result ([952a60d](https://github.com/blockstack/blockstack.js/commit/952a60d95fe640718410ae14f981e7da98f1201a))
- CLI reference syntax error ([868ae4d](https://github.com/blockstack/blockstack.js/commit/868ae4dcd6d8ba5b93954947e61dba4d1953345c))
- CLI tx response explorer URL and update reference doc ([535c683](https://github.com/blockstack/blockstack.js/commit/535c68313da520b6678d4ca93accfcd4447ac2d9))
- lint ([cd90d8c](https://github.com/blockstack/blockstack.js/commit/cd90d8c2098cb2a018156a8af60274a9e8fde73d))
- name lookup url not working on mainnet, fixes [#916](https://github.com/blockstack/blockstack.js/issues/916) ([fc554cd](https://github.com/blockstack/blockstack.js/commit/fc554cd816c58b6912ff225b1443457c13455013))
- remove unused imports ([aeb10b2](https://github.com/blockstack/blockstack.js/commit/aeb10b22a15c671ecddb6a81ff9e1781b1b331f9))
- **stacking:** fix "Assertion failed" error when calling `.stack` and `.canStack` ([9093ce5](https://github.com/blockstack/blockstack.js/commit/9093ce54e701d5b30378ca5e0b8e82dd30982cf3))
- throw error on error response ([0a9a1ee](https://github.com/blockstack/blockstack.js/commit/0a9a1eed312d68b4d0b31bc3bb5dfc7143e10057))
- update explorer URLs ([d691c09](https://github.com/blockstack/blockstack.js/commit/d691c098f9b37db15253869e59829c597b1cfd0b))

### Features

- add stale bot config ([2045dc7](https://github.com/blockstack/blockstack.js/commit/2045dc78427ced27d54b16418f97f8d4e36d332c))
- improve `StackerInfo` type ([98e43fe](https://github.com/blockstack/blockstack.js/commit/98e43fe9588e52c1180b68211b2907ad47d93ae7))
- move CI tests to github actions ([18a8674](https://github.com/blockstack/blockstack.js/commit/18a8674012081afdcd85eec091672c48b6f8a26a))

## [1.0.1](https://github.com/blockstack/blockstack.js/compare/v1.0.0...v1.0.1) (2021-01-15)

### Bug Fixes

- cli - update urls for stacks 2 ([57398c4](https://github.com/blockstack/blockstack.js/commit/57398c41bb0d8b4dc9c9cd8146e5d276cb5c0845)), closes [#908](https://github.com/blockstack/blockstack.js/issues/908)

## [1.0.0](https://github.com/blockstack/blockstack.js/compare/v1.0.0-beta.20...v1.0.0) (2021-01-14)

### Bug Fixes

- **keychain:** typing reference ([251383a](https://github.com/blockstack/blockstack.js/commit/251383aef1abd0ed8cdae76829776733e0df026f))
- package.json to reduce vulnerabilities ([26af134](https://github.com/blockstack/blockstack.js/commit/26af134b424a2e9eaef10f68473d4482bebf93c4))
- unit test urls ([2faebb7](https://github.com/blockstack/blockstack.js/commit/2faebb73769147feb7bc3effb3cbc09617309de1))
- update axios dependency version ([5c67546](https://github.com/blockstack/blockstack.js/commit/5c67546cb567b40c1efae7c0edb69ca3c97066a3))
- update cross-fetch to v3.0.6 ([50e4292](https://github.com/blockstack/blockstack.js/commit/50e42925d2aa549db9b1dc3a3af75ef7e7e13c15))

### Features

- better readme docs ([1fc9262](https://github.com/blockstack/blockstack.js/commit/1fc92620b2a53168e1a98c08b33ec0c6c7d8d217))
- update to mainnet urls ([52c453a](https://github.com/blockstack/blockstack.js/commit/52c453a7f6b01bdec9518cbde4d5b0787ef71f51))

## [1.0.0-beta.20](https://github.com/blockstack/blockstack.js/compare/v1.0.0-beta.18...v1.0.0-beta.20) (2020-12-10)

### Bug Fixes

- add handling of trait_reference ([b404135](https://github.com/blockstack/blockstack.js/commit/b404135c9f6035c1473bceb60afd869803ba35b2))
- export cvToJSON ([28c91f8](https://github.com/blockstack/blockstack.js/commit/28c91f8426722f6384501e7ceb60bff2fac8ae8a))
- include yarn.lock ([23e1dfa](https://github.com/blockstack/blockstack.js/commit/23e1dfa745d493ad511e6b434d2b2896c5ef7e33))
- re-add ignore etag bool ([c29e68d](https://github.com/blockstack/blockstack.js/commit/c29e68dff37e7691c45b0f624108712690596a3d))
- remove duplicate text, add helper function docs ([b9856f6](https://github.com/blockstack/blockstack.js/commit/b9856f67b42235cecbad82f32fb125d27a32b34a))
- remove extra comma ([84d09f6](https://github.com/blockstack/blockstack.js/commit/84d09f6dcad3e36ea53b14140a30aab6c2570017))
- return object instead of array ([1901505](https://github.com/blockstack/blockstack.js/commit/19015053f128463c5ae172a52e66d6850e022119))
- use correct response type ([b5bd3da](https://github.com/blockstack/blockstack.js/commit/b5bd3dae8b34e5f97677eb64d4fbb0d38d6e326b))

### Features

- add cvToJSON ([36e2138](https://github.com/blockstack/blockstack.js/commit/36e21388fc9e313a40c92257d2fb44755792e93a))
- undo export connect from auth ([233df70](https://github.com/blockstack/blockstack.js/commit/233df707f7e60106275233bbb8861fdd52e8104f))

## [1.0.0-beta.18](https://github.com/blockstack/blockstack.js/compare/v1.0.0-beta.13...v1.0.0-beta.18) (2020-12-03)

### Bug Fixes

- cli stacking status response ([b5175ac](https://github.com/blockstack/blockstack.js/commit/b5175acf6317bad37d2cd7e38d8e2c928c12d2af))
- correct tsconfig for dev ([737154f](https://github.com/blockstack/blockstack.js/commit/737154f4af35dd41c09e4e5fb6060b7aefe5ae86))
- lint ([a3a1abd](https://github.com/blockstack/blockstack.js/commit/a3a1abdfab2de1363658a26a0f38570e89407e62))
- lint ([427f3a7](https://github.com/blockstack/blockstack.js/commit/427f3a7e6c83a3c0a3472d9a170583a02e12f9c7))
- merge artifact ([a6b7da0](https://github.com/blockstack/blockstack.js/commit/a6b7da0586caa893c7cdf2ef4a3011de3248afe8))
- missing stacking lib dep ([0027f7e](https://github.com/blockstack/blockstack.js/commit/0027f7ed90a6dbfd71608076adb5a206582bdfb8))
- missing stacks-blockchain-api dependency for cli ([d4e01e0](https://github.com/blockstack/blockstack.js/commit/d4e01e018ecaa38d8babea748521db621fb04c47))
- remove ts-ignore ([48d2109](https://github.com/blockstack/blockstack.js/commit/48d2109f885a208957bfc2231201cb24f03cd0e5))
- remove typing path to non-existant directory ([55157cc](https://github.com/blockstack/blockstack.js/commit/55157cc7017cda62460594243301ae64393c49da))
- stacking lib minimum balance check ([7909d2f](https://github.com/blockstack/blockstack.js/commit/7909d2f699c33575d10fe1b7501b34a212197cf2))

### Features

- add unlock block to stacking status CLI command ([ae3bbc0](https://github.com/blockstack/blockstack.js/commit/ae3bbc0f12755e4ef2623d1d904481248a8d15e4))
- stacking support in CLI ([5398b8f](https://github.com/blockstack/blockstack.js/commit/5398b8f68fac4cfb799c6982740e930ae60fae50))
- stacking support in CLI ([120f3e3](https://github.com/blockstack/blockstack.js/commit/120f3e38355827a4d457c75e654c888f830eecb0))
- update for stacking lib ([9462d7e](https://github.com/blockstack/blockstack.js/commit/9462d7ea08138d187ada6347fe6ec94b64ec0ff0))

## [1.0.0-beta.13](https://github.com/blockstack/blockstack.js/compare/v1.0.0-beta.12...v1.0.0-beta.13) (2020-11-25)

### Bug Fixes

- update stacking status response ([3dc086b](https://github.com/blockstack/blockstack.js/commit/3dc086bf439eeb7a5f28a0270c5ed9bd9cbfe4c4))

## [1.0.0-beta.12](https://github.com/blockstack/blockstack.js/compare/v1.0.0-beta.11...v1.0.0-beta.12) (2020-11-20)

### Features

- export transactions/authorization ([8e55e7a](https://github.com/blockstack/blockstack.js/commit/8e55e7ad5e157f783e8aa1cfd42d8306e0bc3233))
- export transactions/utils ([c9fabc4](https://github.com/blockstack/blockstack.js/commit/c9fabc4b08a484ee015b549579a50d96f94348c4))
- expose readBigUInt64BE ([395bcd9](https://github.com/blockstack/blockstack.js/commit/395bcd9296ad0345ac956fe8712894bc5d4268eb))
- more BufferReader passthroughs ([ff4204f](https://github.com/blockstack/blockstack.js/commit/ff4204f3df48913026633819843da990f67dad68))

## [1.0.0-beta.11](https://github.com/blockstack/blockstack.js/compare/v1.0.0-beta.10...v1.0.0-beta.11) (2020-11-20)

### Bug Fixes

- address stacking lib feedback ([61f5bb8](https://github.com/blockstack/blockstack.js/commit/61f5bb864161603599d17216371e8e0caf46cf38))
- build docs ([ad5b344](https://github.com/blockstack/blockstack.js/commit/ad5b3444e8ac224164775eeef9b663e319ccc5a7))
- stacking status unlock height calculation ([ccf795a](https://github.com/blockstack/blockstack.js/commit/ccf795a3a92a0fe7342167e5c3656ab40f811348))
- update readme ([78ec72d](https://github.com/blockstack/blockstack.js/commit/78ec72d0f2631a1c6d2c6fe8a5df608e83c14775))
- use https for default testnet node ([43b2886](https://github.com/blockstack/blockstack.js/commit/43b2886b9df68ffd2fe8c93330360276cf9bb894))

### Features

- additional info API for stacking ([da50fa0](https://github.com/blockstack/blockstack.js/commit/da50fa094dcedd8cc83272c62bef84bbabe1e876))
- improve stacking getStatus response ([b2e0a37](https://github.com/blockstack/blockstack.js/commit/b2e0a37b4624f34427d08acf13c8bbcb8d473ddc))
- improved stacking lib API and unit tests ([7ec3f06](https://github.com/blockstack/blockstack.js/commit/7ec3f06d259a09f83df4bf2b824f0a33001d5f5b))
- stacking lib ([665a024](https://github.com/blockstack/blockstack.js/commit/665a0240a116e9fd388c66c81366a1cde6130254))
- stacking lib readme ([83c78f4](https://github.com/blockstack/blockstack.js/commit/83c78f4c99876bcf634c0c114fc0d2c5c5a462d7))
- unlock block in stacking status func ([c3b97a7](https://github.com/blockstack/blockstack.js/commit/c3b97a7fdfd3c39e8e4fe2942f2c094667a392ca))
- update testnet node URL ([ef54dff](https://github.com/blockstack/blockstack.js/commit/ef54dff652d10b0602de17e062fd161cdfc49a16))

## [1.0.0-beta.10](https://github.com/blockstack/blockstack.js/compare/v1.0.0-beta.9...v1.0.0-beta.10) (2020-11-17)

### Bug Fixes

- change readme links to absolute ([b149074](https://github.com/blockstack/blockstack.js/commit/b1490744e90cb076b971bbfd3f2a201ccff90b65))
- export NoneCV and SomeCV ([974b0c7](https://github.com/blockstack/blockstack.js/commit/974b0c7b4b782faf1e4f5a8b5a73a9f5c57396c3))
- remove class extension of smartbuffer to fix build issues ([9ccb417](https://github.com/blockstack/blockstack.js/commit/9ccb417395ed99df83d143d0fa5bcff1c611b0db))

## [1.0.0-beta.9](https://github.com/blockstack/blockstack.js/compare/v1.0.0-beta.8...v1.0.0-beta.9) (2020-11-06)

### Bug Fixes

- clean up package.json ([0559d3e](https://github.com/blockstack/blockstack.js/commit/0559d3e5edbfb39a80833e8b936ec310bd983375))
- missing keychain dep ([329fdac](https://github.com/blockstack/blockstack.js/commit/329fdacf7fe38925dc2d5a84d01816926b1544fd))
- remove blockstack.js and legacy transaction lib dependency from keychain ([c9c4f77](https://github.com/blockstack/blockstack.js/commit/c9c4f7742865e9dbb16425c241acdd0e3f3bde29))
- switch to @stacks/connect ([eca6f4c](https://github.com/blockstack/blockstack.js/commit/eca6f4c67569ac71198c8a09955a992feff2aa68))

### Features

- export connect from auth package ([3149768](https://github.com/blockstack/blockstack.js/commit/3149768d63d284eabaf917ba9a8f134f8254a835))
- **transactions:** more exports ([c335bb0](https://github.com/blockstack/blockstack.js/commit/c335bb0ba6a1b1cf26234234d1c04674a29bab02))

## [1.0.0-beta.8](https://github.com/blockstack/blockstack.js/compare/v1.0.0-beta.7...v1.0.0-beta.8) (2020-10-27)

### Bug Fixes

- change default buffer encoding to hex in cvToString() function ([92af5b5](https://github.com/blockstack/blockstack.js/commit/92af5b54e3f812fb9d6ad795bb33a5e291aa15ab))
- CLI unable to specify node URL ([f8403f0](https://github.com/blockstack/blockstack.js/commit/f8403f01486041a73157efe0d197caa3af4b4240))
- no clone on tx broadcast result ([c12e369](https://github.com/blockstack/blockstack.js/commit/c12e36923b187bd3889c9b713e2be28561ad04ed))

### Features

- add mocknet network config ([fca6bb5](https://github.com/blockstack/blockstack.js/commit/fca6bb5c538bd3511f0d8a5baaaec5f6099a8639))
- enable creation of unsigned contract calls ([ba2243e](https://github.com/blockstack/blockstack.js/commit/ba2243ee7944780b79b1e22c12778ffd0f0bc388))
- **transactions:** export cvToHex, hexToCV, parseReadOnlyResponse ([1c0f0e3](https://github.com/blockstack/blockstack.js/commit/1c0f0e3f31f0849f02762c7422d1f7c22aebe22b))

## [1.0.0-beta.7](https://github.com/blockstack/blockstack.js/compare/v1.0.0-beta.6...v1.0.0-beta.7) (2020-10-15)

## [1.0.0-beta.6](https://github.com/blockstack/blockstack.js/compare/v1.0.0-beta.5...v1.0.0-beta.6) (2020-10-15)

### Bug Fixes

- clean up dependencies ([442bc3d](https://github.com/blockstack/blockstack.js/commit/442bc3d6d302e5cb4fb15db7467d77d660a1947e))
- prepend txid with 0x in CLI ([6c85a52](https://github.com/blockstack/blockstack.js/commit/6c85a526919f6ee4b606d027461f950cfbba187d))
- remove unused bitcoinjs-lib dependency from common lib ([9899890](https://github.com/blockstack/blockstack.js/commit/989989096b318a27023c406882dc83592e4e8a62))

## [1.0.0-beta.5](https://github.com/blockstack/blockstack.js/compare/v1.0.0-beta.4...v1.0.0-beta.5) (2020-10-15)

### Bug Fixes

- add entries in package.json ([12eaf53](https://github.com/blockstack/blockstack.js/commit/12eaf53b9a344415d975020f23fc49d4fdd18023))
- cli build errors ([9cdf5e2](https://github.com/blockstack/blockstack.js/commit/9cdf5e234f601548d2cd1acbf09a6db7f8b18ac8))
- cli build fixes ([65f71ac](https://github.com/blockstack/blockstack.js/commit/65f71ac10176b792f55219db53f9e7af3aaa7776))
- cli error with extending BlockstackNetwork class ([ad13e46](https://github.com/blockstack/blockstack.js/commit/ad13e4617d703c5e543c4a068802ea69c80a7ef4))
- cli running ([b2bfe1c](https://github.com/blockstack/blockstack.js/commit/b2bfe1c6beb6e1954b01e7935ce417dad08437b8))
- keychain tests failing in ci ([1cfe263](https://github.com/blockstack/blockstack.js/commit/1cfe263b714498a8a9dd40b085b471c6001c00e6))
- keychain tests failing in ci ([0bc9d38](https://github.com/blockstack/blockstack.js/commit/0bc9d3875c3a09321e07a201188775f8125086e0))
- package-lock conflicts ([e1e1300](https://github.com/blockstack/blockstack.js/commit/e1e1300a24b80b50c0435e3b31f81ea3d4186826))
- syntax in migration guide ([d75429f](https://github.com/blockstack/blockstack.js/commit/d75429ffd73167badd7832aac378e454f8dfa533))
- tx broadcast error msgs ([df60924](https://github.com/blockstack/blockstack.js/commit/df60924f3f9f8ec8a2cc8d8e3aaec36841ef776b))

## [1.0.0-beta.2](https://github.com/blockstack/blockstack.js/compare/v1.0.0-beta.1...v1.0.0-beta.2) (2020-10-06)

## [1.0.0-beta.4](https://github.com/blockstack/blockstack.js/compare/v1.0.0-beta.3...v1.0.0-beta.4) (2020-10-09)

### Bug Fixes

- issue with jest version ([ccd5f00](https://github.com/blockstack/blockstack.js/commit/ccd5f00d7413eb1a4a9446b908372ecb3a13c64e))
- package.json files ([0f607c9](https://github.com/blockstack/blockstack.js/commit/0f607c944daa6b1d6701c601ff06fadb1dfa58cb))
- restore protocolEchoDetection ([c48d118](https://github.com/blockstack/blockstack.js/commit/c48d118d5764bba49558d5058f333c405cf5efec))

## [1.0.0-beta.3](https://github.com/blockstack/blockstack.js/compare/v1.0.0-beta.2...v1.0.0-beta.3) (2020-10-09)

### Bug Fixes

- auth package tests ([59f17de](https://github.com/blockstack/blockstack.js/commit/59f17de4430edad737222f86bdf8be21cd1c587c))
- eslint, yarn workspaces ([9a6ad14](https://github.com/blockstack/blockstack.js/commit/9a6ad14c6d59dfe715dc5f822b40ebfe7be7ee62))
- lint prettier all packages ([17fc891](https://github.com/blockstack/blockstack.js/commit/17fc89109597763f81cda7a29bd32ea08f8eae5a))
- transaction lib build ([86829fe](https://github.com/blockstack/blockstack.js/commit/86829fe5eadbbe3fe1345234567b1d10e88c1b5b))
- transactions package tests ([da29e8e](https://github.com/blockstack/blockstack.js/commit/da29e8e9ff46b5d2535cbe9a111b152444299a97))

### Features

- build update for common, encryption and storage packages ([fd71e71](https://github.com/blockstack/blockstack.js/commit/fd71e71de4c44cac159d305b651a164ef217ae8b))

## [1.0.0-beta.2](https://github.com/blockstack/blockstack.js/compare/v1.0.0-beta.1...v1.0.0-beta.2) (2020-10-06)

### Bug Fixes

- dep versions not bumped to beta ([c195003](https://github.com/blockstack/blockstack.js/commit/c19500379ac248a15c014ff9ecd63c71a167aed9))
- dep versions not bumped to beta ([cbb2835](https://github.com/blockstack/blockstack.js/commit/cbb28355ab6ea72adff95b4325582843291bf68e))

### Features

- addSignature method ([9fbc1df](https://github.com/blockstack/blockstack.js/commit/9fbc1dff80a79ce67b78eacd16222d4658ef19e3))
- codecov ([f1eb1a4](https://github.com/blockstack/blockstack.js/commit/f1eb1a4393f33331843d40be5122132829ceefe6))
- codecov ([a3d94c8](https://github.com/blockstack/blockstack.js/commit/a3d94c84a248ee49093302fe37dd7fd37dce50d9))
- codecov ([4e26fa4](https://github.com/blockstack/blockstack.js/commit/4e26fa4968357cb3081d3ebfa71c9cf71484f729))

## [1.0.0-beta.1](https://github.com/blockstack/blockstack.js/compare/v21.1.1...v1.0.0-beta.1) (2020-09-28)

### Bug Fixes

- add tsdx to packages ([fbb4281](https://github.com/blockstack/blockstack.js/commit/fbb4281755f3ca46df233a04505ad0d44df1b226))
- allow force option in putFile ([0797a5d](https://github.com/blockstack/blockstack.js/commit/0797a5d127f40611ebe3136db6625a180a6fe243))
- ci config ([3812c3f](https://github.com/blockstack/blockstack.js/commit/3812c3f1db00ca4a0ee5bff1a3df46dad2437425))
- ci config ([9d5d3f1](https://github.com/blockstack/blockstack.js/commit/9d5d3f131e0336d9e24c86c908486412ef278708))
- ci config ([77758cd](https://github.com/blockstack/blockstack.js/commit/77758cdf78312afa984ffa8568f39523235ca0ab))
- ci config ([1eb00ec](https://github.com/blockstack/blockstack.js/commit/1eb00ecb0529f260b968105792189e12f6df968e))
- cli build config ([2959c20](https://github.com/blockstack/blockstack.js/commit/2959c209931a0261ecf48f2d78bf9d8db1e43661))
- cli global install ([b088271](https://github.com/blockstack/blockstack.js/commit/b08827115b805b280811da702ceb1dd3b96c7c12))
- lint ([269bff4](https://github.com/blockstack/blockstack.js/commit/269bff49d5f10278d82ec5341d06f7b5b86268fd))
- lookup profile args in storage ([e60cf32](https://github.com/blockstack/blockstack.js/commit/e60cf32a192b912c002bc17ac6288f121adfa2be))
- merge conflict mistake ([3124e05](https://github.com/blockstack/blockstack.js/commit/3124e05ce169a5fcd531772c31f81e1c512cdec3))
- missing optional argument for input 'triplesecDecrypt' ([3aaf773](https://github.com/blockstack/blockstack.js/commit/3aaf773791fc0734d1b49c15b66b08e15e137928))
- more circular dependencies removed from auth package ([3a1dfba](https://github.com/blockstack/blockstack.js/commit/3a1dfbad852e67a8aeeafe3cad635c4a066fe4fa))
- prettier formatting ([0069bd7](https://github.com/blockstack/blockstack.js/commit/0069bd7fea7605472760159ea9af74cc8e1b1b24))
- profile package circular dependency ([c749612](https://github.com/blockstack/blockstack.js/commit/c749612c4b687410555ba46a519eaddea5c956f6))
- remove cache files from git ([9fc294e](https://github.com/blockstack/blockstack.js/commit/9fc294e046016c3b21cd3ae4bddb26c84f11831b))
- remove old tests and data from auth package ([30e446f](https://github.com/blockstack/blockstack.js/commit/30e446fa98033b33f5a316c0613eb691d6f35e14))
- remove transaction package prepare script ([f62f500](https://github.com/blockstack/blockstack.js/commit/f62f50014cf55ddcffa53c0086bd885fc2abf0f1))
- remove unused auth.ts ([9ce79f6](https://github.com/blockstack/blockstack.js/commit/9ce79f6092d56a513c878272446b2551bedde3e5))
- tests and ci ([c05e353](https://github.com/blockstack/blockstack.js/commit/c05e35368b094280cad1468fb1394a0672901cbd))
- update ci config ([a63528e](https://github.com/blockstack/blockstack.js/commit/a63528ef2205dd469c1dfa58b1e55b614e51faeb))
- update transactions package readme ([ac9b3a5](https://github.com/blockstack/blockstack.js/commit/ac9b3a558d722f83f38202a3ff346532a4bd3463))

### Features

- add cli bin.js ([6781230](https://github.com/blockstack/blockstack.js/commit/67812306cfa5c9920f058d18bde2c44d66bf831d))
- add cli src files ([e3fbb0a](https://github.com/blockstack/blockstack.js/commit/e3fbb0aae93fbe85ccc264638248274ac25d40fa))
- add keychain package ([5fbe772](https://github.com/blockstack/blockstack.js/commit/5fbe772684f980e3969b9a4d844fb792b179162f))
- add network package ([da8ec58](https://github.com/blockstack/blockstack.js/commit/da8ec583dad403208759cd25f0e923728357a98c))
- add profile package ([d27a657](https://github.com/blockstack/blockstack.js/commit/d27a6577a27b5e349695f59c87e732e40f212947))
- blockstack.js to stacks.js migration guide ([3760bf2](https://github.com/blockstack/blockstack.js/commit/3760bf277523d50ba985d9f4fa1d073e452bddd4))
- clean up legacy code ([faa3620](https://github.com/blockstack/blockstack.js/commit/faa3620f138b9225e4ff387935d43b69d6ee16d9))
- create random private key with optional entropy ([dc192d4](https://github.com/blockstack/blockstack.js/commit/dc192d46165f8df3b2a306520e1c080153e0aa8e))
- create storage package ([c99680b](https://github.com/blockstack/blockstack.js/commit/c99680b9b0e0b3265b4b47ae9c566daf8f320ab1))
- create storage package ([1867afe](https://github.com/blockstack/blockstack.js/commit/1867afe2a458d2f74cc7842ada446416cbad3072))
- move CLI package ([1608d7c](https://github.com/blockstack/blockstack.js/commit/1608d7c5b69a3a971266dbe650ab1c955a98137f))
- move encryption functions out of storage package ([cb7b293](https://github.com/blockstack/blockstack.js/commit/cb7b29355295165f7d54d788f22605b11268ae9f))
- move transactions package from @blockstack/stacks-transactions ([d31cf3c](https://github.com/blockstack/blockstack.js/commit/d31cf3cdb6c85a1e7a71c7c2ed04397617a469d8))
- persist etags in UserSession ([66ab8f1](https://github.com/blockstack/blockstack.js/commit/66ab8f1a804c2c5515cb16f5a474bac5872bd70c))
- refactor tests to use jest and move into respective packages ([e35e57e](https://github.com/blockstack/blockstack.js/commit/e35e57e972281531d11f6f7a5d9affeb780fa5dd))
- remove references to GaiaHubConfig in auth package ([f0f97de](https://github.com/blockstack/blockstack.js/commit/f0f97dee2a97b8f88dc16c879a2c1b8ec3835dd1))
- remove storage functions from user session ([c27d948](https://github.com/blockstack/blockstack.js/commit/c27d94892ccb76693b0fcda440a2358027684aa5))
- setup monorepo structure and refactor auth ([03c7c92](https://github.com/blockstack/blockstack.js/commit/03c7c928d94689475bd635fa55e0c7a8f0f0ad07))
- switch cli to @stacks/transactions ([833b748](https://github.com/blockstack/blockstack.js/commit/833b748c6470371c1717b59778b36932b7c17a28))
- update common package ([2132b08](https://github.com/blockstack/blockstack.js/commit/2132b082fcf67ecb9f2fa2644cf7b68defef322d))
- update tsconfig and use tsdx ([a82dd0c](https://github.com/blockstack/blockstack.js/commit/a82dd0c84b763e38a6128624ddf9d7ae6f134f78))
- update tsconfig and use tsdx ([01c8f82](https://github.com/blockstack/blockstack.js/commit/01c8f82f5412770de046f6c0b2b555251fd03273))
