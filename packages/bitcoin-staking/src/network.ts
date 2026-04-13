import type { StacksNetwork, StacksNetworkName } from '@stacks/network';
import { STACKS_DEVNET, STACKS_MAINNET } from '@stacks/network';

/**
 * Resolve a `StacksNetworkName | StacksNetwork` to a network name string.
 *
 * Note: devnet and mocknet are indistinguishable at the network-object level
 * (same `magicBytes` and `chainId`), so object inputs collapse to `'devnet'`.
 */
export function resolveNetworkName(network: StacksNetworkName | StacksNetwork): StacksNetworkName {
  if (typeof network === 'string') return network;
  if (network.chainId === STACKS_MAINNET.chainId) return 'mainnet';
  if (network.magicBytes === STACKS_DEVNET.magicBytes) return 'devnet';
  return 'testnet';
}
