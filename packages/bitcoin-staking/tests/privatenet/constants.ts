/**
 * Shared privatenet constants. Kept in one place so a redeploy of the shared net
 * only needs a single edit (or a `SIGNER_MANAGER` env override) instead of a
 * literal scattered across every suite.
 */

/**
 * The daemon-deployed signer-manager on the private testnet — the trait target
 * for stake/register/rewards calls. Override with `SIGNER_MANAGER` env when the
 * shared net redeploys under a different principal.
 */
export const SIGNER_MANAGER =
  process.env.SIGNER_MANAGER ?? 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';

/**
 * The private testnet's Clarity `chain-id` (0x100). Baked into SIP-018 hashes,
 * so replay must use the record-time value — not the generic testnet default.
 * Override with `NETWORK_ID` env when targeting a different net.
 */
export const CHAIN_ID = Number(process.env.NETWORK_ID ?? 256);
