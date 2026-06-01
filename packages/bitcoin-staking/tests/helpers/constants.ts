/**
 * Shared constants for the regtest test flow. Hardcoded here so the sBTC
 * contract ids / asset name live in one place and can be imported across
 * helpers and actions instead of being rebuilt inline.
 */

/**
 * sBTC token contract the env points pox-5 at (`pox_5_sbtc_contract` in
 * `stacks-krypton-miner.toml`) — deployed by the regtest admin
 * (`ACCOUNTS.admin.address` = `STACKING_KEYS[0]`). `lock-sbtc` / `unstake-sbtc`
 * move funds through this contract.
 */
export const SBTC_TOKEN_CONTRACT =
  'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.sbtc-token' as const;

/** sBTC registry contract (`pox_5_sbtc_registry_contract` in the env toml). */
export const SBTC_REGISTRY_CONTRACT =
  'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.sbtc-registry' as const;

/** Fungible-token asset name inside sbtc-token: `(define-fungible-token sbtc-token)`. */
export const SBTC_ASSET_NAME = 'sbtc-token' as const;
