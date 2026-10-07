import * as btc from '@scure/btc-signer';
import type { StacksNetwork, StacksNetworkName } from '@stacks/network';
import { STACKS_DEVNET, STACKS_MAINNET, STACKS_TESTNET, StacksNetworks } from '@stacks/network';

/**
 * @internal Bitcoin parameters of a Stacks network: the `@scure/btc-signer`
 * network (bech32 HRP, base58 version bytes) plus the Stacks network name.
 */
export type BtcNetwork = typeof btc.NETWORK & { name: StacksNetworkName };

// regtest == testnet except for the bech32 HRP (`bcrt` vs `tb`).
const REGTEST = { ...btc.TEST_NETWORK, bech32: 'bcrt' };

/** @internal Bitcoin parameters per Stacks network name. */
export const BTC_NETWORKS: Record<StacksNetworkName, BtcNetwork> = {
  mainnet: { name: 'mainnet', ...btc.NETWORK },
  testnet: { name: 'testnet', ...btc.TEST_NETWORK },
  devnet: { name: 'devnet', ...REGTEST },
  mocknet: { name: 'mocknet', ...REGTEST },
};

/**
 * @internal
 * Resolve a Stacks network (name or object) to its Bitcoin parameters. Throws
 * for anything outside {@link BTC_NETWORKS} instead of defaulting to mainnet.
 *
 * devnet and mocknet are indistinguishable at the network-object level (same
 * `magicBytes` and `chainId`), so object inputs collapse to devnet.
 */
export function btcNetworkFrom(network: StacksNetworkName | StacksNetwork): BtcNetwork {
  if (typeof network === 'string') {
    if (!StacksNetworks.includes(network)) {
      throw new Error(
        `Unrecognized network '${network}'; expected one of: ${StacksNetworks.join(', ')}`
      );
    }
    return BTC_NETWORKS[network];
  }
  if (network.chainId === STACKS_MAINNET.chainId) return BTC_NETWORKS.mainnet;
  if (network.magicBytes === STACKS_MAINNET.magicBytes) return BTC_NETWORKS.mainnet;
  if (network.magicBytes === STACKS_DEVNET.magicBytes) return BTC_NETWORKS.devnet;
  if (network.magicBytes === STACKS_TESTNET.magicBytes) return BTC_NETWORKS.testnet;
  throw new Error(
    `Unrecognized network object (magicBytes '${network.magicBytes}'); expected the mainnet, testnet, or devnet magic bytes`
  );
}
