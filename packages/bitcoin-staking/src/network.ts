import type { StacksNetwork, StacksNetworkName } from '@stacks/network';
import { STACKS_DEVNET, STACKS_MAINNET, STACKS_TESTNET } from '@stacks/network';

/**
 * @internal
 * Resolve a `StacksNetworkName | StacksNetwork` to a network name string.
 *
 * Note: devnet and mocknet are indistinguishable at the network-object level
 * (same `magicBytes` and `chainId`), so object inputs collapse to `'devnet'`.
 */
export function networkNameFrom(network: StacksNetworkName | StacksNetwork): StacksNetworkName {
  // TODO(refactor): every caller in this package wants BTC network params or a
  // per-network table entry, not a Stacks network name — the name is only an
  // intermediate key. Replace with a single resolver that returns the params
  // directly (see `BTC_NETWORKS` in `script.ts`, the address tables in
  // `constants.ts`, and `btc-address.ts`), so the closed lookups stop being
  // spread across modules.
  if (typeof network === 'string') {
    if (
      network === 'mainnet' ||
      network === 'testnet' ||
      network === 'devnet' ||
      network === 'mocknet'
    ) {
      return network;
    }
    // An unrecognized name would miss the closed per-network tables downstream
    // and silently fall through to mainnet params (e.g. a mainnet lock address
    // for `'regtest'`), so reject it here.
    throw new Error(`networkNameFrom: unrecognized network name '${network}'`);
  }
  if (network.chainId === STACKS_MAINNET.chainId) return 'mainnet';
  if (network.magicBytes === STACKS_MAINNET.magicBytes) return 'mainnet';
  if (network.magicBytes === STACKS_DEVNET.magicBytes) return 'devnet';
  if (network.magicBytes === STACKS_TESTNET.magicBytes) return 'testnet';
  throw new Error(
    `networkNameFrom: unrecognized network object (magicBytes '${network.magicBytes}')`
  );
}
