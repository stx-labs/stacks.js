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
  // spread across modules. Also: an unrecognized *name string* is returned
  // as-is here and then misses those tables, which currently falls through to
  // mainnet params — the resolver must throw instead.
  if (typeof network === 'string') return network;
  if (network.chainId === STACKS_MAINNET.chainId) return 'mainnet';
  if (network.magicBytes === STACKS_MAINNET.magicBytes) return 'mainnet';
  if (network.magicBytes === STACKS_DEVNET.magicBytes) return 'devnet';
  if (network.magicBytes === STACKS_TESTNET.magicBytes) return 'testnet';
  throw new Error(
    `networkNameFrom: unrecognized network object (magicBytes '${network.magicBytes}')`
  );
}
