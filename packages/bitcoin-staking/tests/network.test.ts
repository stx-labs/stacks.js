import { STACKS_DEVNET, STACKS_MAINNET, STACKS_TESTNET } from '@stacks/network';
import type { StacksNetworkName } from '@stacks/network';
import { btcNetworkFrom } from '../src/network';

describe('btcNetworkFrom', () => {
  it('resolves names and network objects to BTC params', () => {
    expect(btcNetworkFrom('testnet')).toMatchObject({ name: 'testnet', bech32: 'tb' });
    expect(btcNetworkFrom('devnet')).toMatchObject({ name: 'devnet', bech32: 'bcrt' });
    expect(btcNetworkFrom(STACKS_MAINNET)).toMatchObject({ name: 'mainnet', bech32: 'bc' });
    expect(btcNetworkFrom(STACKS_TESTNET)).toMatchObject({ name: 'testnet', bech32: 'tb' });
    expect(btcNetworkFrom(STACKS_DEVNET)).toMatchObject({ name: 'devnet', bech32: 'bcrt' });
  });

  it('resolves custom nets carrying the standard testnet magic (e.g. private nets)', () => {
    const privateNet = { ...STACKS_TESTNET, chainId: 256 };
    expect(btcNetworkFrom(privateNet).name).toBe('testnet');
  });

  it('throws for an unrecognized name instead of defaulting to mainnet', () => {
    expect(() => btcNetworkFrom('regtest' as StacksNetworkName)).toThrow(
      "Unrecognized network 'regtest'; expected one of: mainnet, testnet, devnet, mocknet"
    );
  });

  it('throws for an unrecognized network object instead of defaulting', () => {
    const bogus = { chainId: 0xdeadbeef, magicBytes: 'ZZ' } as unknown as typeof STACKS_MAINNET;
    expect(() => btcNetworkFrom(bogus)).toThrow('Unrecognized network object');
  });
});
