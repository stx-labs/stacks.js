import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@stacks/common';
import {
  computeBitcoinTxid,
  computeP2wshOutputScript,
  pushScriptBytes,
  serializeBitcoinHeader,
  serializeBitcoinTx,
  serializeCScriptNum,
} from '../src/locking';

describe('serializeCScriptNum', () => {
  it('encodes 100 as a single byte 0x64', () => {
    expect(Array.from(serializeCScriptNum(100n))).toEqual([0x64]);
  });

  it('encodes 850_000 as little-endian [0x50, 0xf8, 0x0c]', () => {
    expect(Array.from(serializeCScriptNum(850_000n))).toEqual([0x50, 0xf8, 0x0c]);
  });

  it('encodes 0 as an empty buffer', () => {
    expect(serializeCScriptNum(0n).length).toBe(0);
  });

  it('appends a 0x00 sign byte when the MSB of the top byte is set (128 → [0x80, 0x00])', () => {
    expect(Array.from(serializeCScriptNum(128n))).toEqual([0x80, 0x00]);
  });

  it('rejects negative values', () => {
    expect(() => serializeCScriptNum(-1n)).toThrow();
  });
});

describe('pushScriptBytes', () => {
  it('encodes an empty buffer as OP_0 (0x00)', () => {
    const out = pushScriptBytes(new Uint8Array(0));
    expect(out.length).toBe(1);
    expect(out[0]).toBe(0x00);
  });

  it('encodes a 75-byte buffer as <0x4b><bytes> (76 bytes total)', () => {
    const out = pushScriptBytes(new Uint8Array(75));
    expect(out[0]).toBe(0x4b);
    expect(out.length).toBe(76);
  });

  it('encodes a 76-byte buffer as <0x4c><0x4c><bytes> (PUSHDATA1)', () => {
    const out = pushScriptBytes(new Uint8Array(76));
    expect(out[0]).toBe(0x4c); // OP_PUSHDATA1
    expect(out[1]).toBe(0x4c); // length = 76
    expect(out.length).toBe(2 + 76);
  });

  it('encodes a 256-byte buffer as <0x4d><len-LE-2><bytes> (PUSHDATA2)', () => {
    const out = pushScriptBytes(new Uint8Array(256));
    expect(out[0]).toBe(0x4d); // OP_PUSHDATA2
    // 256 little-endian = 0x00 0x01
    expect(out[1]).toBe(0x00);
    expect(out[2]).toBe(0x01);
    expect(out.length).toBe(3 + 256);
  });
});

describe('computeP2wshOutputScript', () => {
  it('returns a 34-byte buffer starting with 0x00 0x20', () => {
    const out = computeP2wshOutputScript(new Uint8Array([0x01, 0x02, 0x03]));
    expect(out.length).toBe(34);
    expect(out[0]).toBe(0x00);
    expect(out[1]).toBe(0x20);
  });
});

describe('computeBitcoinTxid', () => {
  it('returns 32 bytes that are the byte-reverse of sha256(sha256(rawTx))', () => {
    const raw = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22, 0x33]);
    const txid = computeBitcoinTxid(raw);
    expect(txid.length).toBe(32);

    const internal = sha256(sha256(raw));
    const reversed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) reversed[i] = internal[31 - i];
    expect(bytesToHex(txid)).toBe(bytesToHex(reversed));
  });
});

describe('serializeBitcoinHeader', () => {
  it('rejects headers that are not exactly 80 bytes', () => {
    expect(() => serializeBitcoinHeader(new Uint8Array(79))).toThrow();
    expect(() => serializeBitcoinHeader(new Uint8Array(81))).toThrow();
  });

  it('accepts a buffer that is exactly 80 bytes', () => {
    const out = serializeBitcoinHeader(new Uint8Array(80));
    expect(out.length).toBe(80);
  });
});

describe('serializeBitcoinTx', () => {
  it('rejects transactions larger than 100000 bytes', () => {
    expect(() => serializeBitcoinTx(new Uint8Array(100_001))).toThrow();
  });

  it('accepts transactions at or below the 100000-byte cap', () => {
    expect(serializeBitcoinTx(new Uint8Array(100_000)).length).toBe(100_000);
  });
});
