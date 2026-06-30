import * as btc from '@scure/btc-signer';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes } from '@stacks/common';
import { Address } from '@stacks/transactions';
import {
  buildUnlockScript,
  buildLockAddress,
  buildLockScript,
  computeRegisterPreimage,
  computeUnlockHeight,
  lockScriptToAddress,
  parseUnlockScript,
  serializeCScriptNum,
  toConsensusBuff,
} from '../src/script';

// A known compressed public key (33 bytes)
const TEST_PUBKEY_HEX = '0316e35d38b52d4886e40065e4952a49535ce914e02294be58e252d1998f129b19';
const TEST_PUBKEY = hexToBytes(TEST_PUBKEY_HEX);

// A known Stacks testnet address (standard principal)
const TEST_STX_ADDRESS = 'ST000000000000000000002AMW42H';

// Early-unlock subscript: a pre-pushed, self-contained `<pubkey> OP_CHECKSIG`
// fragment (leaves a bool on the stack for the shared OP_VERIFY), as the
// contract concatenates it RAW.
const TEST_EARLY_UNLOCK = btc.Script.encode([new Uint8Array(33).fill(0x02), 'CHECKSIG']);

// Opcodes we assert inside the script — sourced from the library, not hardcoded.
const { OP } = btc;

// The fixed OP_ELSE-branch preamble: OP_SIZE <32> OP_EQUALVERIFY OP_SHA256 OP_PUSHBYTES_32.
const STAKER_COMMITMENT_PREFIX = hexToBytes('82012088a820');

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

describe('toConsensusBuff matches the reference (hand-rolled) implementation', () => {
  // script.ts now delegates to @stacks/transactions' serializeCVBytes. This is
  // the previous hand-rolled impl, kept as a reference oracle.
  function refToConsensusBuff(addr: string): Uint8Array {
    const parsed = Address.parse(addr) as {
      version: number;
      hash160: string;
      contractName?: string;
    };
    const head = new Uint8Array(22);
    head[1] = parsed.version;
    head.set(hexToBytes(parsed.hash160), 2);
    if (!parsed.contractName) {
      head[0] = 0x05; // standard principal
      return head;
    }
    // contract principal: 0x06 || version || hash160 || name-len(1B) || name
    head[0] = 0x06;
    const name = new TextEncoder().encode(parsed.contractName);
    const out = new Uint8Array(head.length + 1 + name.length);
    out.set(head, 0);
    out[head.length] = name.length;
    out.set(name, head.length + 1);
    return out;
  }

  it.each([
    'ST000000000000000000002AMW42H',
    'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7',
    'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE',
  ])('encodes %s identically (22 bytes, 0x05 tag)', addr => {
    const out = toConsensusBuff(addr);
    expect(out.length).toBe(22);
    expect(out[0]).toBe(0x05);
    expect(bytesToHex(out)).toBe(bytesToHex(refToConsensusBuff(addr)));
  });

  it.each([
    'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.my-contract',
    'ST000000000000000000002AMW42H.pox-5',
  ])('encodes contract principal %s (0x06 tag, matches reference)', addr => {
    const out = toConsensusBuff(addr);
    expect(out[0]).toBe(0x06);
    expect(bytesToHex(out)).toBe(bytesToHex(refToConsensusBuff(addr)));
  });
});

describe('buildUnlockScript', () => {
  it('builds a valid <pubkey> CHECKSIG script', () => {
    const script = buildUnlockScript(TEST_PUBKEY);
    const decoded = btc.Script.decode(script);

    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toBeInstanceOf(Uint8Array);
    expect((decoded[0] as Uint8Array).length).toBe(33);
    expect(decoded[1]).toBe('CHECKSIG');
  });

  it('accepts hex string input', () => {
    const fromBytes = buildUnlockScript(TEST_PUBKEY);
    const fromHex = buildUnlockScript(TEST_PUBKEY_HEX);
    expect(bytesToHex(fromBytes)).toBe(bytesToHex(fromHex));
  });

  it('rejects non-33-byte keys', () => {
    expect(() => buildUnlockScript(new Uint8Array(32))).toThrow('33-byte');
    expect(() => buildUnlockScript(new Uint8Array(65))).toThrow('33-byte');
  });
});

describe('parseUnlockScript', () => {
  it('round-trips with buildUnlockScript', () => {
    const script = buildUnlockScript(TEST_PUBKEY);
    const parsed = parseUnlockScript(script);

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
    expect(parseUnlockScript(customScript)).toBeUndefined();
  });

  it('returns undefined for empty/malformed input', () => {
    expect(parseUnlockScript(new Uint8Array(0))).toBeUndefined();
    expect(parseUnlockScript(new Uint8Array([0xff, 0xff]))).toBeUndefined();
  });
});

describe('buildLockScript', () => {
  const unlockBytes = buildUnlockScript(TEST_PUBKEY);

  it('lays out OP.IF <h> OP.CHECKLOCKTIMEVERIFY OP.ELSE <commitment> <early> OP.ENDIF OP.VERIFY <unlock>', () => {
    const script = buildLockScript({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 850_000,
      unlockBytes,
      earlyUnlockBytes: TEST_EARLY_UNLOCK,
    });

    // The script is a flat, deterministic concatenation — reconstruct it.
    const heightPush = concatBytes(
      Uint8Array.of(serializeCScriptNum(850_000n).length),
      serializeCScriptNum(850_000n)
    );
    const stakerHash = sha256(computeRegisterPreimage(TEST_STX_ADDRESS));
    const expected = concatBytes(
      Uint8Array.of(OP.IF),
      heightPush,
      Uint8Array.of(OP.CHECKLOCKTIMEVERIFY, OP.ELSE),
      STAKER_COMMITMENT_PREFIX,
      stakerHash,
      Uint8Array.of(OP.EQUALVERIFY),
      TEST_EARLY_UNLOCK,
      Uint8Array.of(OP.ENDIF, OP.VERIFY),
      unlockBytes
    );
    expect(bytesToHex(script)).toBe(bytesToHex(expected));

    // The staker is committed as a hash — its 22-byte consensus buff never
    // appears in the script in cleartext.
    expect(findSubarray(script, toConsensusBuff(TEST_STX_ADDRESS))).toBe(-1);
  });

  it('embeds the serialized ScriptNum for unlockHeight=850000 (3 bytes: 50 f8 0c)', () => {
    const script = buildLockScript({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 850_000,
      unlockBytes,
      earlyUnlockBytes: TEST_EARLY_UNLOCK,
    });

    const expected = serializeCScriptNum(850_000n);
    expect(bytesToHex(expected)).toBe('50f80c');

    // The height push has a length prefix (0x03) followed by the bytes. Look
    // for `<len><bytes>` immediately after OP.IF.
    const ifIdx = script.indexOf(OP.IF);
    expect(script[ifIdx + 1]).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(script[ifIdx + 2 + i]).toBe(expected[i]);
    }
  });

  it('embeds the serialized ScriptNum for unlockHeight=100 (single byte: 64)', () => {
    const script = buildLockScript({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 100,
      unlockBytes,
      earlyUnlockBytes: TEST_EARLY_UNLOCK,
    });

    const expected = serializeCScriptNum(100n);
    expect(bytesToHex(expected)).toBe('64');

    // For values 1..=16 the contract uses OP_<N> (single-opcode). 100 is
    // larger than 16, so it's pushed via <len=1><0x64>.
    const ifIdx = script.indexOf(OP.IF);
    expect(script[ifIdx + 1]).toBe(1);
    expect(script[ifIdx + 2]).toBe(0x64);
  });

  it('splices earlyUnlockBytes after the staker commitment, and unlockBytes once at the tail', () => {
    const script = buildLockScript({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 850_000,
      unlockBytes,
      earlyUnlockBytes: TEST_EARLY_UNLOCK,
    });

    // earlyUnlockBytes follow RAW after OP_ELSE, the 6-byte commitment preamble,
    // the 32-byte staker hash, and the OP_EQUALVERIFY that consumes it.
    const elseIdx = script.indexOf(OP.ELSE);
    const earlyIdx = elseIdx + 1 + STAKER_COMMITMENT_PREFIX.length + 32 + 1;
    for (let i = 0; i < TEST_EARLY_UNLOCK.length; i++) {
      expect(script[earlyIdx + i]).toBe(TEST_EARLY_UNLOCK[i]);
    }

    // unlockBytes appears exactly once — the script tail, after OP_ENDIF OP_VERIFY.
    const unlockHits: number[] = [];
    let from = 0;
    while (from < script.length) {
      const idx = findSubarray(script.subarray(from), unlockBytes);
      if (idx < 0) break;
      unlockHits.push(from + idx);
      from = from + idx + 1;
    }
    expect(unlockHits).toHaveLength(1);
    expect(unlockHits[0] + unlockBytes.length).toBe(script.length);
  });

  it('accepts unlockBytes and earlyUnlockBytes as hex strings', () => {
    const fromBytes = buildLockScript({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 850_000,
      unlockBytes,
      earlyUnlockBytes: TEST_EARLY_UNLOCK,
    });
    const fromHex = buildLockScript({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 850_000,
      unlockBytes: bytesToHex(unlockBytes),
      earlyUnlockBytes: bytesToHex(TEST_EARLY_UNLOCK),
    });
    expect(bytesToHex(fromBytes)).toBe(bytesToHex(fromHex));
  });

  it('accepts contract principals as stxAddress', () => {
    expect(() =>
      buildLockScript({
        stxAddress: `${TEST_STX_ADDRESS}.some-contract`,
        unlockHeight: 100,
        unlockBytes,
        earlyUnlockBytes: TEST_EARLY_UNLOCK,
      })
    ).not.toThrow();
  });
});

describe('buildLockAddress', () => {
  const unlockBytes = buildUnlockScript(TEST_PUBKEY);
  const baseOpts = {
    stxAddress: TEST_STX_ADDRESS,
    unlockHeight: 850_000,
    unlockBytes,
    earlyUnlockBytes: TEST_EARLY_UNLOCK,
  };

  it('produces a mainnet bc1q address', () => {
    const address = buildLockAddress({ ...baseOpts, network: 'mainnet' });
    expect(address).toMatch(/^bc1q/);
  });

  it('produces a testnet tb1q address', () => {
    const address = buildLockAddress({ ...baseOpts, network: 'testnet' });
    expect(address).toMatch(/^tb1q/);
  });

  it('produces a devnet bcrt1q address', () => {
    const address = buildLockAddress({ ...baseOpts, network: 'devnet' });
    expect(address).toMatch(/^bcrt1q/);
  });

  it('matches the address derived from the raw locking script', () => {
    // Compute the expected address fresh from the new script — no hardcoding.
    const script = buildLockScript(baseOpts);
    const expectedMainnet = lockScriptToAddress(script, 'mainnet');
    expect(buildLockAddress({ ...baseOpts, network: 'mainnet' })).toBe(expectedMainnet);
  });

  it('is deterministic', () => {
    const a = buildLockAddress({ ...baseOpts, network: 'mainnet' });
    const b = buildLockAddress({ ...baseOpts, network: 'mainnet' });
    expect(a).toBe(b);
  });

  it('changes with different scripts', () => {
    const otherUnlock = buildUnlockScript(new Uint8Array(33).fill(0x03));
    const otherOpts = { ...baseOpts, unlockBytes: otherUnlock };
    expect(buildLockAddress({ ...baseOpts, network: 'mainnet' })).not.toBe(
      buildLockAddress({ ...otherOpts, network: 'mainnet' })
    );
  });

  it('changes when earlyUnlockBytes changes', () => {
    const altEarlyUnlock = btc.Script.encode([new Uint8Array(33).fill(0x03), 'CHECKSIGVERIFY']);
    const altOpts = { ...baseOpts, earlyUnlockBytes: altEarlyUnlock };
    expect(buildLockAddress({ ...baseOpts, network: 'mainnet' })).not.toBe(
      buildLockAddress({ ...altOpts, network: 'mainnet' })
    );
  });

  it('accepts publicKey as an alternative to unlockBytes', () => {
    const fromPubkey = buildLockAddress({
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 850_000,
      publicKey: TEST_PUBKEY,
      earlyUnlockBytes: TEST_EARLY_UNLOCK,
      network: 'mainnet',
    });
    const fromUnlock = buildLockAddress({ ...baseOpts, network: 'mainnet' });
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
