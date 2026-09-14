/**
 * Privatenet sBTC read helper. The hosted net runs the real sBTC token, whose
 * balance read is `get-balance` (total) — distinct from the regtest minter's
 * `get-balance-available` in `tests/helpers/sbtc.ts`, so this stays net-local.
 */
import { Cl, fetchCallReadOnlyFunction } from '@stacks/transactions';
import type { StacksNetwork } from '@stacks/network';

/** The real sBTC token deployed on the private testnet. */
export const SBTC = 'SN3R84XZYA63QS28932XQF3G1J8R9PC3W76P9CSQS.sbtc-token';

/**
 * sBTC balance (sats) via the token's `get-balance` read-only. Tolerant: returns
 * `-1n` if the read fails, so a balance probe never aborts a reward test.
 */
export async function sbtcBalance(address: string, network: StacksNetwork): Promise<bigint> {
  const [contractAddress, contractName] = SBTC.split('.');
  try {
    const r = await fetchCallReadOnlyFunction({
      contractAddress,
      contractName,
      functionName: 'get-balance',
      functionArgs: [Cl.address(address)],
      senderAddress: address,
      network,
    });
    // (ok uint)
    const inner = (r as { value?: { value?: bigint } }).value;
    return BigInt((inner as { value: bigint })?.value ?? (r as { value: bigint }).value);
  } catch (e) {
    console.warn('sbtc get-balance failed:', (e as Error).message);
    return -1n;
  }
}
