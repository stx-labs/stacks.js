import * as btc from '@scure/btc-signer';
import { bytesToHex, hexToBytes } from '@stacks/common';
import {
  buildDefaultUnlockScript,
  buildLockingBitcoinAddress,
  buildLockingScript,
  computeUnlockHeight,
  lockingScriptToP2wsh,
  parseDefaultUnlockScript,
  serializeCScriptNum,
} from '../src/locking';

// A known compressed public key (33 bytes)
const TEST_PUBKEY_HEX = '0316e35d38b52d4886e40065e4952a49535ce914e02294be58e252d1998f129b19';
const TEST_PUBKEY = hexToBytes(TEST_PUBKEY_HEX);

// A known Stacks testnet address (standard principal)
const TEST_STX_ADDRESS = 'ST000000000000000000002AMW42H';

// Early-unlock subscript: a pre-pushed, self-contained `<pubkey> OP_CHECKSIGVERIFY`
// fragment (leaves nothing on the stack), as the contract concatenates it RAW.
const TEST_EARLY_UNLOCK = btc.Script.encode([new Uint8Array(33).fill(0x02), 'CHECKSIGVERIFY']);

// Opcodes we expect inside the script
const OP_IF = 0x63;
const OP_ELSE = 0x67;
const OP_ENDIF = 0x68;
const OP_DROP = 0x75;
const OP_CLTV = 0xb1;

/** Find the first index of `needle` in `hay` (or -1). */
function findSubarray(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

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

  it('contains OP_IF / OP_CLTV / OP_ELSE / OP_ENDIF opcodes in the right order', () => {
    const script = buildLockingScript({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 850_000,
      unlockBytes,
      earlyUnlockBytes: TEST_EARLY_UNLOCK,
    });

    // The opcodes are constants — find their positions and check ordering.
    const ifIdx = script.indexOf(OP_IF);
    const cltvIdx = script.indexOf(OP_CLTV);
    const elseIdx = script.indexOf(OP_ELSE);
    const endifIdx = script.indexOf(OP_ENDIF);

    expect(ifIdx).toBeGreaterThanOrEqual(0);
    expect(cltvIdx).toBeGreaterThan(ifIdx);
    expect(elseIdx).toBeGreaterThan(cltvIdx);
    expect(endifIdx).toBeGreaterThan(elseIdx);

    // OP_DROP must immediately precede OP_IF (the staker-buff drop) and
    // immediately follow OP_CLTV (the height drop).
    expect(script[ifIdx - 1]).toBe(OP_DROP);
    expect(script[cltvIdx + 1]).toBe(OP_DROP);
  });

  it('embeds the serialized ScriptNum for unlockHeight=850000 (3 bytes: 50 f8 0c)', () => {
    const script = buildLockingScript({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 850_000,
      unlockBytes,
      earlyUnlockBytes: TEST_EARLY_UNLOCK,
    });

    const expected = serializeCScriptNum(850_000n);
    expect(bytesToHex(expected)).toBe('50f80c');

    // The height push has a length prefix (0x03) followed by the bytes. Look
    // for `<len><bytes>` immediately after OP_IF.
    const ifIdx = script.indexOf(OP_IF);
    expect(script[ifIdx + 1]).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(script[ifIdx + 2 + i]).toBe(expected[i]);
    }
  });

  it('embeds the serialized ScriptNum for unlockHeight=100 (single byte: 64)', () => {
    const script = buildLockingScript({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 100,
      unlockBytes,
      earlyUnlockBytes: TEST_EARLY_UNLOCK,
    });

    const expected = serializeCScriptNum(100n);
    expect(bytesToHex(expected)).toBe('64');

    // For values 1..=16 the contract uses OP_<N> (single-opcode). 100 is
    // larger than 16, so it's pushed via <len=1><0x64>.
    const ifIdx = script.indexOf(OP_IF);
    expect(script[ifIdx + 1]).toBe(1);
    expect(script[ifIdx + 2]).toBe(0x64);
  });

  it('places earlyUnlockBytes followed by unlockBytes between OP_ELSE and OP_ENDIF', () => {
    const script = buildLockingScript({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 850_000,
      unlockBytes,
      earlyUnlockBytes: TEST_EARLY_UNLOCK,
    });

    const elseIdx = script.indexOf(OP_ELSE);
    // After OP_ELSE the earlyUnlockBytes follow RAW (no push-length prefix):
    // the byte immediately after OP_ELSE is the first byte of earlyUnlockBytes.
    for (let i = 0; i < TEST_EARLY_UNLOCK.length; i++) {
      expect(script[elseIdx + 1 + i]).toBe(TEST_EARLY_UNLOCK[i]);
    }

    // The unlockBytes must also appear in the script — twice (once in each branch).
    const unlockHits: number[] = [];
    let from = 0;
    while (from < script.length) {
      const idx = findSubarray(script.subarray(from), unlockBytes);
      if (idx < 0) break;
      unlockHits.push(from + idx);
      from = from + idx + 1;
    }
    expect(unlockHits.length).toBeGreaterThanOrEqual(2);
  });

  it('accepts unlockBytes and earlyUnlockBytes as hex strings', () => {
    const fromBytes = buildLockingScript({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 850_000,
      unlockBytes,
      earlyUnlockBytes: TEST_EARLY_UNLOCK,
    });
    const fromHex = buildLockingScript({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 850_000,
      unlockBytes: bytesToHex(unlockBytes),
      earlyUnlockBytes: bytesToHex(TEST_EARLY_UNLOCK),
    });
    expect(bytesToHex(fromBytes)).toBe(bytesToHex(fromHex));
  });

  it('rejects contract principals as stxAddress', () => {
    expect(() =>
      buildLockingScript({
        stxAddress: `${TEST_STX_ADDRESS}.some-contract`,
        unlockHeight: 100,
        unlockBytes,
        earlyUnlockBytes: TEST_EARLY_UNLOCK,
      })
    ).toThrow();
  });
});

describe('buildLockingBitcoinAddress', () => {
  const unlockBytes = buildDefaultUnlockScript(TEST_PUBKEY);
  const baseOpts = {
    stxAddress: TEST_STX_ADDRESS,
    unlockHeight: 850_000,
    unlockBytes,
    earlyUnlockBytes: TEST_EARLY_UNLOCK,
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

  it('matches the address derived from the raw locking script', () => {
    // Compute the expected address fresh from the new script — no hardcoding.
    const script = buildLockingScript(baseOpts);
    const expectedMainnet = lockingScriptToP2wsh(script, 'mainnet');
    expect(buildLockingBitcoinAddress({ ...baseOpts, network: 'mainnet' })).toBe(expectedMainnet);
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

  it('changes when earlyUnlockBytes changes', () => {
    const altEarlyUnlock = btc.Script.encode([new Uint8Array(33).fill(0x03), 'CHECKSIGVERIFY']);
    const altOpts = { ...baseOpts, earlyUnlockBytes: altEarlyUnlock };
    expect(buildLockingBitcoinAddress({ ...baseOpts, network: 'mainnet' })).not.toBe(
      buildLockingBitcoinAddress({ ...altOpts, network: 'mainnet' })
    );
  });

  it('accepts publicKey as an alternative to unlockBytes', () => {
    const fromPubkey = buildLockingBitcoinAddress({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 850_000,
      publicKey: TEST_PUBKEY,
      earlyUnlockBytes: TEST_EARLY_UNLOCK,
      network: 'mainnet',
    });
    const fromUnlock = buildLockingBitcoinAddress({ ...baseOpts, network: 'mainnet' });
    expect(fromPubkey).toBe(fromUnlock);
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

  it('returns the start of the unlock cycle for 1 cycle', () => {
    const height = computeUnlockHeight(baseOpts);
    // lastCycleStart = 666050 + (50 + 1 - 1) * 2100 = 666050 + 105000 = 771050
    expect(height).toBe(771_050);
  });

  it('returns the start of the unlock cycle for 24 cycles', () => {
    const height = computeUnlockHeight({ ...baseOpts, numCycles: 24 });
    // lastCycleStart = 666050 + (50 + 24 - 1) * 2100 = 666050 + 73 * 2100 = 666050 + 153300 = 819350
    expect(height).toBe(819_350);
  });

  it('increases with more cycles', () => {
    const h1 = computeUnlockHeight({ ...baseOpts, numCycles: 1 });
    const h12 = computeUnlockHeight({ ...baseOpts, numCycles: 12 });
    const h24 = computeUnlockHeight({ ...baseOpts, numCycles: 24 });
    expect(h1).toBeLessThan(h12);
    expect(h12).toBeLessThan(h24);
  });
});
