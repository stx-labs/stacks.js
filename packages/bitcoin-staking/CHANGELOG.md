# @stacks/bitcoin-staking

## 7.8.0

### Patch Changes

- [#1878](https://github.com/stx-labs/stacks.js/pull/1878) [`149c150`](https://github.com/stx-labs/stacks.js/commit/149c150a7b3c3d8acb8b13b6d33962f2656223b3) - Resolve Stacks networks to Bitcoin parameters through a single per-network table; unrecognized network names now throw (listing the accepted names) instead of silently deriving mainnet addresses

- [#1878](https://github.com/stx-labs/stacks.js/pull/1878) [`149c150`](https://github.com/stx-labs/stacks.js/commit/149c150a7b3c3d8acb8b13b6d33962f2656223b3) - Normalize `IntegerType` unlock heights in `buildLockProof` and reject values above `Number.MAX_SAFE_INTEGER`; correct the `EarnedRewards` unit docs (sBTC sats, not micro-STX)

- Updated dependencies [[`dca286a`](https://github.com/stx-labs/stacks.js/commit/dca286a962f19220608edb6b00273bba7afe7b3e)]:
  - @stacks/transactions@7.8.0
  - @stacks/common@7.8.0
  - @stacks/encryption@7.8.0
  - @stacks/network@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [[`f8d95c5`](https://github.com/stx-labs/stacks.js/commit/f8d95c57345549921c07b52208d619b2e0627798), [`dd6a2ff`](https://github.com/stx-labs/stacks.js/commit/dd6a2ff9b7aad667c88d874804fdf3d3d3d4d331), [`f95f2bb`](https://github.com/stx-labs/stacks.js/commit/f95f2bb726d34fa1f8e11eaae1c5288f4f86e481), [`e6084a5`](https://github.com/stx-labs/stacks.js/commit/e6084a52140b2ad010a9d1a0f1b87d527c3a8870)]:
  - @stacks/transactions@7.7.0
  - @stacks/network@7.7.0
  - @stacks/common@7.7.0
  - @stacks/encryption@7.7.0

## 7.6.0

### Minor Changes

- [#1854](https://github.com/stx-labs/stacks.js/pull/1854) [`162cdef`](https://github.com/stx-labs/stacks.js/commit/162cdef305a5d1991d8711d3b05571a6896659ed) - Add @stacks/bitcoin-staking, a package for PoX-5 staking. Covers the full bond lifecycle against the pox-5 boot contract: BTC P2WSH lockup script construction, SPV proof assembly, reclaim transactions for both the timelock and cosigned early-exit paths, SIP-018 signer grants, read-only wrappers for bond and staker state, cycle math helpers, and read-only eligibility preflight checks.

### Patch Changes

- Updated dependencies [[`162cdef`](https://github.com/stx-labs/stacks.js/commit/162cdef305a5d1991d8711d3b05571a6896659ed), [`162cdef`](https://github.com/stx-labs/stacks.js/commit/162cdef305a5d1991d8711d3b05571a6896659ed)]:
  - @stacks/common@7.6.0
  - @stacks/transactions@7.6.0
  - @stacks/encryption@7.6.0
  - @stacks/network@7.6.0
