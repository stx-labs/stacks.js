export * from './types';
export * from './constants';
export * from './network';
export * from './signer';
export * from './locking';
export * from './build';
export * from './fetch';

/**
 * ### `BtcAddress.` Bitcoin Address Namespace
 *
 * Parse, stringify, and convert between Bitcoin addresses and PoX Clarity tuples.
 *
 * @example
 * ```ts
 * import { BtcAddress } from '@stacks/bitcoin-staking';
 *
 * const parsed = BtcAddress.parse('bc1q...');
 * const btcAddr = BtcAddress.stringify({ ...parsed, network: 'mainnet' });
 *
 * const tuple = BtcAddress.toPoxTuple('bc1q...');
 * const addr = BtcAddress.stringify({ poxAddr: tuple, network: 'mainnet' });
 * ```
 */
export * as BtcAddress from './btc-address';
