import { base58CheckEncode } from '@stacks/encryption';
import { Cl } from '@stacks/transactions';
import { BtcAddress, PoXAddressVersion } from '../src';

describe('BtcAddress.parse', () => {
  const vectors: { address: string; network: 'mainnet' | 'testnet'; version: PoXAddressVersion }[] =
    [
      {
        address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
        network: 'mainnet',
        version: PoXAddressVersion.P2PKH,
      },
      {
        address: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
        network: 'mainnet',
        version: PoXAddressVersion.P2SH,
      },
      {
        address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        network: 'mainnet',
        version: PoXAddressVersion.P2WPKH,
      },
      {
        address: 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
        network: 'mainnet',
        version: PoXAddressVersion.P2WSH,
      },
      {
        address: 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0',
        network: 'mainnet',
        version: PoXAddressVersion.P2TR,
      },
      {
        address: 'mzxXgV6e4BZSsz8zVHm3TmqbECt7mbuErt',
        network: 'testnet',
        version: PoXAddressVersion.P2PKH,
      },
    ];

  it.each(vectors)('round-trips $address', ({ address, network, version }) => {
    const parsed = BtcAddress.parse(address);
    expect(parsed.version).toBe(version);
    expect(BtcAddress.stringify(parsed, network)).toBe(address);
  });

  it('rejects garbage', () => {
    expect(() => BtcAddress.parse('not-an-address')).toThrow();
  });

  it('asserts the address belongs to the given network', () => {
    const mainnetSegwit = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
    const mainnetB58 = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
    const testnetB58 = 'mzxXgV6e4BZSsz8zVHm3TmqbECt7mbuErt';
    expect(() => BtcAddress.parse(mainnetSegwit, 'mainnet')).not.toThrow();
    expect(() => BtcAddress.parse(mainnetB58, 'mainnet')).not.toThrow();
    expect(() => BtcAddress.parse(testnetB58, 'testnet')).not.toThrow();
    expect(() => BtcAddress.parse(mainnetSegwit, 'testnet')).toThrow(/testnet/);
    expect(() => BtcAddress.parse(mainnetB58, 'testnet')).toThrow(/testnet/);
    expect(() => BtcAddress.parse(testnetB58, 'mainnet')).toThrow(/mainnet/);
    expect(() => BtcAddress.parse(mainnetSegwit, 'devnet')).toThrow(/devnet/);
    expect(() => BtcAddress.parse(mainnetSegwit)).not.toThrow();
  });

  it('rejects a base58 address whose version byte is not a recognized mainnet/testnet one', () => {
    // Version byte 222 isn't any known mainnet/testnet/devnet P2PKH/P2SH
    // byte, so it hits the legacy-hash-mode default branch; parse() wraps
    // that in a generic outer error, so check the cause.
    const weird = base58CheckEncode(222, new Uint8Array(20).fill(1));
    try {
      BtcAddress.parse(weird);
      throw new Error('expected parse to throw');
    } catch (err) {
      expect((err as Error & { cause?: Error }).cause?.message).toBe('Invalid pox address version');
    }
  });

  it('rejects a native segwit address whose prefix matches neither v0 nor v1', () => {
    expect(() => BtcAddress.parse('bc1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toThrow();
  });
});

describe('BtcAddress.stringify', () => {
  it('covers every PoX version variant', () => {
    const h20 = new Uint8Array(20).fill(7);
    const h32 = new Uint8Array(32).fill(7);
    for (const network of ['mainnet', 'testnet'] as const) {
      for (const version of [
        PoXAddressVersion.P2PKH,
        PoXAddressVersion.P2SH,
        PoXAddressVersion.P2SHP2WPKH,
        PoXAddressVersion.P2SHP2WSH,
        PoXAddressVersion.P2WPKH,
      ]) {
        expect(BtcAddress.stringify({ version, data: h20 }, network)).toBeTruthy();
      }
      for (const version of [PoXAddressVersion.P2WSH, PoXAddressVersion.P2TR]) {
        expect(BtcAddress.stringify({ version, data: h32 }, network)).toBeTruthy();
      }
    }
  });

  it('rejects wrong data lengths per version', () => {
    const h20 = new Uint8Array(20).fill(7);
    const h32 = new Uint8Array(32).fill(7);
    for (const version of [
      PoXAddressVersion.P2PKH,
      PoXAddressVersion.P2SH,
      PoXAddressVersion.P2SHP2WPKH,
      PoXAddressVersion.P2SHP2WSH,
      PoXAddressVersion.P2WPKH,
    ]) {
      expect(() => BtcAddress.stringify({ version, data: h32 }, 'mainnet')).toThrow('20 bytes');
    }
    for (const version of [PoXAddressVersion.P2WSH, PoXAddressVersion.P2TR]) {
      expect(() => BtcAddress.stringify({ version, data: h20 }, 'mainnet')).toThrow('32 bytes');
    }
    expect(() =>
      BtcAddress.stringify(
        { version: PoXAddressVersion.P2WPKH, data: new Uint8Array(0) },
        'mainnet'
      )
    ).toThrow('20 bytes');
  });

  it('rejects unknown version bytes', () => {
    expect(() =>
      BtcAddress.stringify(
        { version: 0x07 as PoXAddressVersion, data: new Uint8Array(20) },
        'mainnet'
      )
    ).toThrow('Unexpected PoX address version');
  });

  it('validates pox tuples (hashbytes length must match version)', () => {
    const tuple = (version: number, len: number) =>
      Cl.tuple({
        version: Cl.buffer(Uint8Array.of(version)),
        hashbytes: Cl.buffer(new Uint8Array(len).fill(7)),
      });
    expect(BtcAddress.stringify(tuple(PoXAddressVersion.P2WSH, 32), 'mainnet')).toMatch(/^bc1q/);
    expect(() => BtcAddress.stringify(tuple(PoXAddressVersion.P2WSH, 20), 'mainnet')).toThrow(
      '32 bytes'
    );
    expect(() => BtcAddress.stringify(tuple(PoXAddressVersion.P2PKH, 32), 'mainnet')).toThrow(
      '20 bytes'
    );
    const emptyVersion = Cl.tuple({
      version: Cl.buffer(new Uint8Array(0)),
      hashbytes: Cl.buffer(new Uint8Array(20)),
    });
    expect(() => BtcAddress.stringify(emptyVersion, 'mainnet')).toThrow(
      'Unexpected PoX address version'
    );
  });

  it('rejects a pox tuple that is not a Clarity tuple', () => {
    expect(() => BtcAddress.stringify(Cl.uint(1) as unknown as never, 'mainnet')).toThrow(
      'expected ClarityValue to be a TupleCV'
    );
  });

  it('rejects a pox tuple missing version/hashbytes keys', () => {
    const missingKeys = Cl.tuple({ notVersion: Cl.buffer(new Uint8Array(1)) });
    expect(() => BtcAddress.stringify(missingKeys, 'mainnet')).toThrow(
      'expected Clarity tuple to contain'
    );
  });

  it('rejects a pox tuple whose version/hashbytes are not buffers', () => {
    const notBuffers = Cl.tuple({ version: Cl.uint(1), hashbytes: Cl.uint(2) });
    expect(() => BtcAddress.stringify(notBuffers, 'mainnet')).toThrow(
      'expected `version` and `hashbytes` to be buffer values'
    );
  });
});
