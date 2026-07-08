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
  if (typeof network === 'string') return network;
  if (network.chainId === STACKS_MAINNET.chainId) return 'mainnet';
  if (network.magicBytes === STACKS_MAINNET.magicBytes) return 'mainnet';
  if (network.magicBytes === STACKS_DEVNET.magicBytes) return 'devnet';
  if (network.magicBytes === STACKS_TESTNET.magicBytes) return 'testnet';
  throw new Error(
    `networkNameFrom: unrecognized network object (magicBytes '${network.magicBytes}')`
  );
}
