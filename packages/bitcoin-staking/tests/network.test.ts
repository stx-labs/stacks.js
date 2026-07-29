import { STACKS_MAINNET, STACKS_TESTNET } from '@stacks/network';
import { networkNameFrom } from '../src/network';

describe('networkNameFrom', () => {
  it('resolves names and network objects', () => {
    expect(networkNameFrom('testnet')).toBe('testnet');
    expect(networkNameFrom(STACKS_MAINNET)).toBe('mainnet');
    expect(networkNameFrom(STACKS_TESTNET)).toBe('testnet');
  });

  it('resolves custom nets carrying the standard testnet magic (e.g. private nets)', () => {
    const privateNet = { ...STACKS_TESTNET, chainId: 256 };
    expect(networkNameFrom(privateNet)).toBe('testnet');
  });

  it('throws for an unrecognized network object instead of defaulting', () => {
    const bogus = { chainId: 0xdeadbeef, magicBytes: 'ZZ' } as unknown as typeof STACKS_MAINNET;
    expect(() => networkNameFrom(bogus)).toThrow('unrecognized network object');
  });
});
