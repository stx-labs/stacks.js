import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@stacks/common';
import {
  assembleLockupProof,
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

describe('assembleLockupProof', () => {
  // Real mainnet fixture: tx c2f59c…ea17, output 0, block 800000 (tx #2 of 3721).
  // Indexer responses captured from an Esplora-compatible API (mempool.space).
  const TXID = 'c2f59c6fc8e812f5f1f00c8a0a9ab1929c1e796788c57f49001b8006a824ea17';
  // GET /tx/:txid/hex — segwit serialization (has the 0001 marker/flag + witness).
  const TX_HEX =
    '02000000000101505abc36c27c35d89490b4a61d7d54db555980e62bd023b555e95049e817e4c30100000000ffffffff02880103000000000022512028b928693484dbc45f59e27948749316f6e738d34f20d22fb893f31cccd01f7a7377320000000000225120de29b8c4065d2964457ca60860c5e69c19dd6b0108ca0b5383155966b1585f3b01404654e1fa7622c41e4ca462a1d51f42dc34a987f2610dd6d163ffe98f85982e95e8c9468bad9f01f4b5544cc3504af747907ef687ab14cf12694fbcd14195040a00000000';
  // GET /block/:hash/header
  const HEADER_HEX =
    '00601d3455bb9fbd966b3ea2dc42d0c22722e4c0c1729fad17210100000000000000000055087fab0c8f3f89f8bcfd4df26c504d81b0a88e04907161838c0c53001af09135edbd64943805175e955e06';
  // GET /tx/:txid/merkle-proof
  const MERKLE_PROOF = {
    block_height: 800000,
    pos: 2,
    merkle: [
      '965f866bf8623bbf956c1b2aeec1efc1ad162fd428ab7fb89f128a0754ebbc32',
      '3db825264827bf7f39b06b1d6cc9f51dc11ec094ca46166235808c279c67aa9f',
      '9f43ef264af1c3a4678d2bf5e60cddbd87b97618b1c80bd2b8a7f9b7f3baca68',
      '4befb427613b7021015030bf67472af6c76f680fadc90bc4c267a9e5804d8948',
      'bf61e05d4675710220c0b8dd669dcac9a1cbc3edb7ac64fc50410da9228333d5',
      'c88892d93e8110f2ec82c41ac30e6a3c8dfe8cf062fefb4b5c09ee754d7ce42c',
      'd4e7722bda133364a17b82990b16c3eb62f4a47d6aaae1c16bb0553806fcd3df',
      '2cbc00355a2debbb8b90dd60ab0dd520699b40e4e4ad90d546864a6e4c5087f8',
      'f2a33c753e9894eea7728206d927e830e946c4e13706275df14362398538e3db',
      '8cc2c566df38c865e0aa6ddfd46d3440e99442a6d04d567323cbe53ffa470234',
      '885cd4d205c35e05f8f738328166b9c65304583704162bcac8944b20690f696f',
      'f6d90508da8aa581f7203f4899498c775ed4878544adcdef5e7b53a4ab691dd7',
    ],
  };
  // scriptPubKey of output 0 (here a P2TR output; the helper matches by script
  // equality the same way it would a P2WSH lockup scriptPubKey).
  const OUTPUT_0_SCRIPT = '512028b928693484dbc45f59e27948749316f6e738d34f20d22fb893f31cccd01f7a';
  const OUTPUT_0_SATS = 197000n;

  const proof = () =>
    assembleLockupProof({
      txHex: TX_HEX,
      header: HEADER_HEX,
      merkleProof: MERKLE_PROOF,
      txCount: 3721,
      expectedScript: OUTPUT_0_SCRIPT,
    });

  it('selects the output whose scriptPubKey matches and reads its amount', () => {
    const out = proof();
    expect(out.outputIndex).toBe(0);
    expect(out.amount).toBe(OUTPUT_0_SATS);
  });

  it('strips the witness so the stored tx bytes hash to the txid (not the wtxid)', () => {
    const out = proof();
    const stored = out.tx as Uint8Array;
    // segwit input is 205 bytes; legacy serialization is 137.
    expect(stored.length).toBe(137);
    expect(stored.length).toBeLessThan(hexToBytes(TX_HEX).length);
    expect(bytesToHex(computeBitcoinTxid(stored))).toBe(TXID);
  });

  it('reverses indexer sibling hashes to internal little-endian order', () => {
    const out = proof();
    const leaves = out.leafHashes as Uint8Array[];
    expect(leaves).toHaveLength(MERKLE_PROOF.merkle.length);
    // Each leaf is the byte-reverse of the indexer's display-order hash.
    leaves.forEach((leaf, i) => {
      expect(bytesToHex(leaf)).toBe(bytesToHex(hexToBytes(MERKLE_PROOF.merkle[i]).reverse()));
    });
  });

  it('produces a path that folds back to the header merkle root', () => {
    const out = proof();
    // Leaf = internal little-endian txid = sha256(sha256(legacy tx)), unreversed.
    let acc = sha256(sha256(out.tx as Uint8Array));
    let pos = out.txIndex;
    for (const sibling of out.leafHashes as Uint8Array[]) {
      acc =
        (pos & 1) === 0
          ? sha256(sha256(new Uint8Array([...acc, ...sibling])))
          : sha256(sha256(new Uint8Array([...sibling, ...acc])));
      pos >>= 1;
    }
    // Header bytes 36..68 hold the merkle root (internal little-endian).
    const rootInHeader = (out.header as Uint8Array).slice(36, 68);
    expect(bytesToHex(acc)).toBe(bytesToHex(rootInHeader));
  });

  it('carries height, txCount and txIndex straight through', () => {
    const out = proof();
    expect(out.height).toBe(800000);
    expect(out.txCount).toBe(3721);
    expect(out.txIndex).toBe(2);
    expect((out.header as Uint8Array).length).toBe(80);
  });

  it('throws when no output matches the expected script', () => {
    expect(() =>
      assembleLockupProof({
        txHex: TX_HEX,
        header: HEADER_HEX,
        merkleProof: MERKLE_PROOF,
        txCount: 3721,
        expectedScript: '0020' + '00'.repeat(32),
      })
    ).toThrow(/no output matches/);
  });
});
