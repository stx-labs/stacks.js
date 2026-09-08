# @stacks/bitcoin-staking

## 7.6.1

### Patch Changes

- Updated dependencies [[`dd6a2ff`](https://github.com/stx-labs/stacks.js/commit/dd6a2ff9b7aad667c88d874804fdf3d3d3d4d331)]:
  - @stacks/network@7.6.1
  - @stacks/common@7.6.1
  - @stacks/encryption@7.6.1
  - @stacks/transactions@7.6.1

## 7.6.0

### Minor Changes

- [#1854](https://github.com/stx-labs/stacks.js/pull/1854) [`162cdef`](https://github.com/stx-labs/stacks.js/commit/162cdef305a5d1991d8711d3b05571a6896659ed) - Add @stacks/bitcoin-staking, a package for PoX-5 staking. Covers the full bond lifecycle against the pox-5 boot contract: BTC P2WSH lockup script construction, SPV proof assembly, reclaim transactions for both the timelock and cosigned early-exit paths, SIP-018 signer grants, read-only wrappers for bond and staker state, cycle math helpers, and read-only eligibility preflight checks.

### Patch Changes

- Updated dependencies [[`162cdef`](https://github.com/stx-labs/stacks.js/commit/162cdef305a5d1991d8711d3b05571a6896659ed), [`162cdef`](https://github.com/stx-labs/stacks.js/commit/162cdef305a5d1991d8711d3b05571a6896659ed)]:
  - @stacks/common@7.6.0
  - @stacks/transactions@7.6.0
  - @stacks/encryption@7.6.0
  - @stacks/network@7.6.0
