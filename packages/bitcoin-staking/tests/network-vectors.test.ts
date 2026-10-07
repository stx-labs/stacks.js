// Behavior freeze: vectors captured from the pre-rework code at 105da4a1.
import type { StacksNetworkName } from '@stacks/network';
import { STACKS_DEVNET, STACKS_MAINNET, STACKS_MOCKNET, STACKS_TESTNET } from '@stacks/network';
import { parse, stringify } from '../src/btc-address';
import { PoXAddressVersion } from '../src/constants';
import { btcNetworkFrom } from '../src/network';
import { buildLockAddress, scriptToAddress } from '../src/script';

const P2WSH_SCRIPT = new Uint8Array(32).fill(1);

// name | bech32 | pubKeyHash | scriptHash | scriptToAddress(P2WSH_SCRIPT)
const NETWORK_PARAMS: [StacksNetworkName, string, number, number, string][] = [
  ['mainnet', 'bc', 0x00, 0x05, 'bc1qwtxkappzcsrlkmgfs6g0zyct0hkhashh7hsaxz7e65slq9fkx7fsmwwrjt'],
  ['testnet', 'tb', 0x6f, 0xc4, 'tb1qwtxkappzcsrlkmgfs6g0zyct0hkhashh7hsaxz7e65slq9fkx7fsvxcvgy'],
  [
    'devnet',
    'bcrt',
    0x6f,
    0xc4,
    'bcrt1qwtxkappzcsrlkmgfs6g0zyct0hkhashh7hsaxz7e65slq9fkx7fsplj2a7',
  ],
  [
    'mocknet',
    'bcrt',
    0x6f,
    0xc4,
    'bcrt1qwtxkappzcsrlkmgfs6g0zyct0hkhashh7hsaxz7e65slq9fkx7fsplj2a7',
  ],
];

test.each(NETWORK_PARAMS)(
  '%s params and p2wsh derivation',
  (name, bech32, pubKeyHash, scriptHash, address) => {
    expect(btcNetworkFrom(name)).toMatchObject({ name, bech32, pubKeyHash, scriptHash });
    expect(scriptToAddress(P2WSH_SCRIPT, name)).toBe(address);
  }
);

const NETWORK_OBJECTS = [
  [STACKS_MAINNET, 'mainnet'],
  [STACKS_TESTNET, 'testnet'],
  [STACKS_DEVNET, 'devnet'],
  [STACKS_MOCKNET, 'devnet'], // indistinguishable from devnet as an object
  [{ ...STACKS_TESTNET, chainId: 0x12345678 }, 'testnet'], // custom chainId, testnet magic
] as const;

test.each(NETWORK_OBJECTS)('network object #%# resolves to the %s params', (network, name) => {
  expect(btcNetworkFrom(network)).toEqual(btcNetworkFrom(name as StacksNetworkName));
});

test('buildLockAddress derivation', () => {
  const address = buildLockAddress({
    stxAddress: 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7',
    unlockHeight: 850_000,
    publicKey: '02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc',
    earlyUnlockBytes: '51',
    validateEarlyUnlockBytes: false,
    network: 'mainnet',
  });
  expect(address).toBe('bc1qfg0xkv2mygp74c6u4ryhpwqf2csd4329rqfsy6rmd5pdza8400wsmmtwxz');
});

// pox version | data byte | network | address
const POX_ADDRESSES: [PoXAddressVersion, number, StacksNetworkName, string][] = [
  [PoXAddressVersion.P2PKH, 3, 'mainnet', '1GvdqXEAMbSARrubpNP44Vqz4kr6TDPgC'],
  [PoXAddressVersion.P2SH, 4, 'testnet', '2MscTW4nSNqHJqrorbemySzLzLdB1qrbgdn'],
  [PoXAddressVersion.P2WPKH, 5, 'devnet', 'bcrt1qq5zs2pg9q5zs2pg9q5zs2pg9q5zs2pg9ajutfp'],
  [
    PoXAddressVersion.P2WSH,
    6,
    'mainnet',
    'bc1qqcrqvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrqlfh5ez',
  ],
  [
    PoXAddressVersion.P2TR,
    7,
    'testnet',
    'tb1pqurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurs8ycgdn',
  ],
];

test.each(POX_ADDRESSES)('pox version %s on %s round-trips', (version, byte, network, address) => {
  const size = version === PoXAddressVersion.P2WSH || version === PoXAddressVersion.P2TR ? 32 : 20;
  const repr = { version, data: new Uint8Array(size).fill(byte) };
  expect(stringify(repr, network)).toBe(address);
  expect(parse(address, network)).toEqual(repr);
});

test('an unknown network name throws instead of falling through to mainnet', () => {
  expect(() => scriptToAddress(P2WSH_SCRIPT, 'regtest' as StacksNetworkName)).toThrow(
    "Unrecognized network 'regtest'; expected one of: mainnet, testnet, devnet, mocknet"
  );
});
