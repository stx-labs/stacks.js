import * as btc from '@scure/btc-signer';
import { bytesToHex, hexToBytes } from '@stacks/common';
import {
  buildDefaultUnlockScript,
  buildLockingBitcoinAddress,
  buildLockingScript,
  computeUnlockHeight,
  parseDefaultUnlockScript,
} from '../src/locking';

// A known compressed public key (33 bytes)
const TEST_PUBKEY_HEX = '0316e35d38b52d4886e40065e4952a49535ce914e02294be58e252d1998f129b19';
const TEST_PUBKEY = hexToBytes(TEST_PUBKEY_HEX);

// A known Stacks testnet address
const TEST_STX_ADDRESS = 'ST000000000000000000002AMW42H';

describe('buildDefaultUnlockScript', () => {
  it('builds a valid <pubkey> CHECKSIG script', () => {
    const script = buildDefaultUnlockScript(TEST_PUBKEY);
    const decoded = btc.Script.decode(script);

    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toBeInstanceOf(Uint8Array);
    expect((decoded[0] as Uint8Array).length).toBe(33);
    expect(decoded[1]).toBe('CHECKSIG');
  });

  it('accepts hex string input', () => {
    const fromBytes = buildDefaultUnlockScript(TEST_PUBKEY);
    const fromHex = buildDefaultUnlockScript(TEST_PUBKEY_HEX);
    expect(bytesToHex(fromBytes)).toBe(bytesToHex(fromHex));
  });

  it('rejects non-33-byte keys', () => {
    expect(() => buildDefaultUnlockScript(new Uint8Array(32))).toThrow('33-byte');
    expect(() => buildDefaultUnlockScript(new Uint8Array(65))).toThrow('33-byte');
  });
});

describe('parseDefaultUnlockScript', () => {
  it('round-trips with buildDefaultUnlockScript', () => {
    const script = buildDefaultUnlockScript(TEST_PUBKEY);
    const parsed = parseDefaultUnlockScript(script);

    expect(parsed).toBeDefined();
    expect(bytesToHex(parsed!)).toBe(bytesToHex(TEST_PUBKEY));
  });

  it('returns undefined for non-default scripts', () => {
    // Two pubkeys + CHECKMULTISIG is not the default format
    const customScript = btc.Script.encode([
      new Uint8Array(33).fill(0x02),
      new Uint8Array(33).fill(0x03),
      'CHECKMULTISIG',
    ]);
    expect(parseDefaultUnlockScript(customScript)).toBeUndefined();
  });

  it('returns undefined for empty/malformed input', () => {
    expect(parseDefaultUnlockScript(new Uint8Array(0))).toBeUndefined();
    expect(parseDefaultUnlockScript(new Uint8Array([0xff, 0xff]))).toBeUndefined();
  });
});

describe('buildLockingScript', () => {
  const unlockBytes = buildDefaultUnlockScript(TEST_PUBKEY);

  it('produces a script with the correct structure', () => {
    const script = buildLockingScript({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 850_000,
      unlockBytes,
    });

    const decoded = btc.Script.decode(script);

    // Expect: <22-byte addr payload> DROP <height> CHECKLOCKTIMEVERIFY DROP <pubkey> CHECKSIG
    expect(decoded[0]).toBeInstanceOf(Uint8Array);
    expect((decoded[0] as Uint8Array).length).toBe(22);
    expect(decoded[1]).toBe('DROP');
    // decoded[2] is the height ScriptNum
    expect(decoded[3]).toBe('CHECKLOCKTIMEVERIFY');
    expect(decoded[4]).toBe('DROP');
    // unlock script ops follow
    expect(decoded[5]).toBeInstanceOf(Uint8Array); // pubkey
    expect(decoded[6]).toBe('CHECKSIG');
  });

  it('encodes the stacks address payload correctly', () => {
    const script = buildLockingScript({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 100,
      unlockBytes,
    });

    const decoded = btc.Script.decode(script);
    const addrPayload = decoded[0] as Uint8Array;

    // First byte is 0x05
    expect(addrPayload[0]).toBe(0x05);
    // Remaining 21 bytes are version + hash160
    expect(addrPayload.length).toBe(22);
  });

  it('encodes unlock height as ScriptNum', () => {
    const script = buildLockingScript({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 850_000,
      unlockBytes,
    });

    const decoded = btc.Script.decode(script);
    const heightBytes = decoded[2] as Uint8Array;

    // 850000 = 0x0CF850 → little-endian ScriptNum = [0x50, 0xF8, 0x0C]
    expect(bytesToHex(heightBytes)).toBe('50f80c');
  });

  it('handles small heights correctly (variable-length ScriptNum)', () => {
    const script = buildLockingScript({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 100,
      unlockBytes,
    });

    const decoded = btc.Script.decode(script);
    const heightBytes = decoded[2] as Uint8Array;

    // 100 = 0x64 → single byte
    expect(bytesToHex(heightBytes)).toBe('64');
  });

  it('accepts unlockBytes as hex string', () => {
    const fromBytes = buildLockingScript({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 850_000,
      unlockBytes,
    });
    const fromHex = buildLockingScript({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 850_000,
      unlockBytes: bytesToHex(unlockBytes),
    });
    expect(bytesToHex(fromBytes)).toBe(bytesToHex(fromHex));
  });
});

describe('buildLockingBitcoinAddress', () => {
  const unlockBytes = buildDefaultUnlockScript(TEST_PUBKEY);
  const baseOpts = {
    stxAddress: TEST_STX_ADDRESS,
    unlockHeight: 850_000,
    unlockBytes,
  };

  it('produces a mainnet bc1q address', () => {
    const address = buildLockingBitcoinAddress({ ...baseOpts, network: 'mainnet' });
    expect(address).toMatch(/^bc1q/);
  });

  it('produces a testnet tb1q address', () => {
    const address = buildLockingBitcoinAddress({ ...baseOpts, network: 'testnet' });
    expect(address).toMatch(/^tb1q/);
  });

  it('produces a devnet bcrt1q address', () => {
    const address = buildLockingBitcoinAddress({ ...baseOpts, network: 'devnet' });
    expect(address).toMatch(/^bcrt1q/);
  });

  it('is deterministic', () => {
    const a = buildLockingBitcoinAddress({ ...baseOpts, network: 'mainnet' });
    const b = buildLockingBitcoinAddress({ ...baseOpts, network: 'mainnet' });
    expect(a).toBe(b);
  });

  it('changes with different scripts', () => {
    const otherUnlock = buildDefaultUnlockScript(new Uint8Array(33).fill(0x03));
    const otherOpts = { ...baseOpts, unlockBytes: otherUnlock };
    expect(buildLockingBitcoinAddress({ ...baseOpts, network: 'mainnet' })).not.toBe(
      buildLockingBitcoinAddress({ ...otherOpts, network: 'mainnet' })
    );
  });
});

describe('computeUnlockHeight', () => {
  const baseOpts = {
    poxInfo: {
      firstBurnchainBlockHeight: 666_050,
      rewardCycleLength: 2100,
    } as Parameters<typeof computeUnlockHeight>[0]['poxInfo'],
    firstRewardCycle: 50,
    numCycles: 1,
  };

  it('returns halfway through the last cycle for 1 cycle', () => {
    const height = computeUnlockHeight(baseOpts);
    // lastCycleStart = 666050 + (50 + 1 - 1) * 2100 = 666050 + 105000 = 771050
    // halfway = 771050 + 1050 = 772100
    expect(height).toBe(772_100);
  });

  it('returns halfway through the last cycle for 24 cycles', () => {
    const height = computeUnlockHeight({ ...baseOpts, numCycles: 24 });
    // lastCycleStart = 666050 + (50 + 24 - 1) * 2100 = 666050 + 73 * 2100 = 666050 + 153300 = 819350
    // halfway = 819350 + 1050 = 820400
    expect(height).toBe(820_400);
  });

  it('increases with more cycles', () => {
    const h1 = computeUnlockHeight({ ...baseOpts, numCycles: 1 });
    const h12 = computeUnlockHeight({ ...baseOpts, numCycles: 12 });
    const h24 = computeUnlockHeight({ ...baseOpts, numCycles: 24 });
    expect(h1).toBeLessThan(h12);
    expect(h12).toBeLessThan(h24);
  });
});
