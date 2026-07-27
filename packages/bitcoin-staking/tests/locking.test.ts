import * as btc from '@scure/btc-signer';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes } from '@stacks/common';
import { Address } from '@stacks/transactions';
import {
  buildUnlockScript,
  buildLockAddress,
  buildLockScript,
  computeRegisterPreimage,
  scriptToAddress,
  serializeCScriptNum,
  toConsensusBuff,
  validateEarlyUnlockBytes,
} from '../src/script';
import { parseUnlockScript } from './helpers/script';

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
    const parsed = Address.parse(addr);
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

  it('rejects 33-byte keys without a compressed 0x02/0x03 prefix', () => {
    expect(() => buildUnlockScript(new Uint8Array(33).fill(0x04))).toThrow('0x02/0x03');
    expect(() => buildUnlockScript(new Uint8Array(33))).toThrow('0x02/0x03');
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

  it('rejects an unlockHeight at/above the BIP-65 timestamp threshold', () => {
    const base = {
      stxAddress: TEST_STX_ADDRESS,
      unlockBytes,
      earlyUnlockBytes: TEST_EARLY_UNLOCK,
    };
    expect(() => buildLockScript({ ...base, unlockHeight: 500_000_000 })).toThrow(
      'ERR_INVALID_UNLOCK_HEIGHT'
    );
    expect(() => buildLockScript({ ...base, unlockHeight: 499_999_999 })).not.toThrow();
  });

  it('rejects malformed earlyUnlockBytes (truncated push would corrupt the script)', () => {
    const base = {
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 850_000,
      unlockBytes,
    };
    // 0x21 announces a 33-byte push but only 2 bytes follow.
    const truncated = new Uint8Array([0x21, 0x02, 0x03]);
    expect(() => buildLockScript({ ...base, earlyUnlockBytes: truncated })).toThrow(
      'not decodable'
    );
    expect(() => buildLockScript({ ...base, earlyUnlockBytes: new Uint8Array(0) })).toThrow(
      'empty'
    );
  });

  it('rejects non-CHECKSIG-shaped earlyUnlockBytes unless the shape check is disabled', () => {
    const base = {
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 850_000,
      unlockBytes,
    };
    const verifyTail = btc.Script.encode([new Uint8Array(33).fill(0x02), 'CHECKSIGVERIFY']);
    expect(() => buildLockScript({ ...base, earlyUnlockBytes: verifyTail })).toThrow(
      'must end in OP_CHECKSIG'
    );
    expect(() =>
      buildLockScript({ ...base, earlyUnlockBytes: verifyTail, validateEarlyUnlockBytes: false })
    ).not.toThrow();
  });

  it('rejects unlockHeight 0 (OP_0 leaves an empty value the shared OP_VERIFY reads as false)', () => {
    expect(() =>
      buildLockScript({
        stxAddress: TEST_STX_ADDRESS,
        unlockHeight: 0,
        unlockBytes,
        earlyUnlockBytes: TEST_EARLY_UNLOCK,
      })
    ).toThrow('unlockHeight 0');
  });

  it('rejects an empty or undecodable unlockBytes tail', () => {
    const base = {
      stxAddress: TEST_STX_ADDRESS,
      unlockHeight: 850_000,
      earlyUnlockBytes: TEST_EARLY_UNLOCK,
    };
    expect(() => buildLockScript({ ...base, unlockBytes: new Uint8Array(0) })).toThrow(
      'unlockBytes: empty subscript'
    );
    expect(() => buildLockScript({ ...base, unlockBytes: '02ff' })).toThrow(
      'unlockBytes: not decodable'
    );
  });
});

describe('validateEarlyUnlockBytes', () => {
  const key = (fill: number) => new Uint8Array(33).fill(fill);

  it('accepts the documented single-key template: <pubkey> CHECKSIG', () => {
    expect(() => validateEarlyUnlockBytes(TEST_EARLY_UNLOCK)).not.toThrow();
  });

  it('rejects multi-key templates (the early-unlock part carries a single key)', () => {
    const multisig = btc.Script.encode([2, key(0x02), key(0x03), key(0x04), 3, 'CHECKMULTISIG']);
    expect(() => validateEarlyUnlockBytes(multisig)).toThrow('exactly one 33-byte public-key');
    expect(() => validateEarlyUnlockBytes(multisig, { shape: false })).not.toThrow();
  });

  it('always rejects empty and undecodable bytes, even with shape disabled', () => {
    expect(() => validateEarlyUnlockBytes(new Uint8Array(0), { shape: false })).toThrow('empty');
    expect(() => validateEarlyUnlockBytes('', { shape: false })).toThrow('empty');
    const truncated = new Uint8Array([0x21, 0x02, 0x03]);
    expect(() => validateEarlyUnlockBytes(truncated, { shape: false })).toThrow('not decodable');
  });

  it('shape: rejects missing 33-byte push, wrong tail, and conditional opcodes', () => {
    expect(() => validateEarlyUnlockBytes(btc.Script.encode(['CHECKSIG']))).toThrow(
      'exactly one 33-byte public-key push, found 0'
    );
    expect(() => validateEarlyUnlockBytes(btc.Script.encode([key(0x02), 'EQUAL']))).toThrow(
      'must end in OP_CHECKSIG'
    );
    expect(() => validateEarlyUnlockBytes(btc.Script.encode([key(0x02)]))).toThrow(
      'must end in OP_CHECKSIG'
    );
    const conditional = btc.Script.encode(['IF', 'ENDIF', key(0x03), 'CHECKSIG']);
    expect(() => validateEarlyUnlockBytes(conditional)).toThrow('conditional opcodes');
    // ...but all of these pass with the shape heuristic disabled.
    expect(() => validateEarlyUnlockBytes(conditional, { shape: false })).not.toThrow();
    expect(() =>
      validateEarlyUnlockBytes(btc.Script.encode(['CHECKSIG']), { shape: false })
    ).not.toThrow();
  });

  it('always decodes, even with the shape heuristic disabled', () => {
    // 0x21 announces a 33-byte push but only 2 bytes follow.
    expect(() =>
      validateEarlyUnlockBytes(new Uint8Array([0x21, 0x02, 0x03]), { shape: false })
    ).toThrow('not decodable');
    expect(() => validateEarlyUnlockBytes(new Uint8Array(0), { shape: false })).toThrow('empty');
  });

  it('returns the decoded bytes (hex input included)', () => {
    expect(bytesToHex(validateEarlyUnlockBytes(TEST_EARLY_UNLOCK))).toBe(
      bytesToHex(TEST_EARLY_UNLOCK)
    );
    expect(bytesToHex(validateEarlyUnlockBytes(bytesToHex(TEST_EARLY_UNLOCK)))).toBe(
      bytesToHex(TEST_EARLY_UNLOCK)
    );
  });
});

// Golden literals below pin the exact P2WSH script + address so any drift in
// script assembly or address derivation fails on the string (not just a prefix).
// The script layout is cross-checked byte-for-byte against the live pox-5
// construct-lockup-script in privatenet/actions/golden-vectors.test.ts.
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
    const expectedMainnet = scriptToAddress(script, 'mainnet');
    expect(buildLockAddress({ ...baseOpts, network: 'mainnet' })).toBe(expectedMainnet);
  });

  it('freezes the golden P2WSH script + per-network address literals', () => {
    expect(bytesToHex(buildLockScript(baseOpts))).toBe(
      '630350f80cb16782012088a820ef6ec08b34e94a690ae76e59d1e2a7d3e686cc6764179951a74e949346d7d9698821020202020202020202020202020202020202020202020202020202020202020202ac6869210316e35d38b52d4886e40065e4952a49535ce914e02294be58e252d1998f129b19ac'
    );
    expect(buildLockAddress({ ...baseOpts, network: 'mainnet' })).toBe(
      'bc1qfkead9658jluffuf9jjle5yezkh4ma64aqm2gf9x3u2jgy2u9d4scae4pt'
    );
    expect(buildLockAddress({ ...baseOpts, network: 'testnet' })).toBe(
      'tb1qfkead9658jluffuf9jjle5yezkh4ma64aqm2gf9x3u2jgy2u9d4s0406my'
    );
    expect(buildLockAddress({ ...baseOpts, network: 'devnet' })).toBe(
      'bcrt1qfkead9658jluffuf9jjle5yezkh4ma64aqm2gf9x3u2jgy2u9d4szv9uw7'
    );
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
    const altEarlyUnlock = btc.Script.encode([new Uint8Array(33).fill(0x03), 'CHECKSIG']);
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

