import { Cl } from '@stacks/transactions';
import { coerceArgs, isClarityValue, toClarityValue } from '../src/coerce';

describe('isClarityValue', () => {
  test('detects built CVs', () => {
    expect(isClarityValue(Cl.uint(1))).toBe(true);
    expect(isClarityValue(Cl.bool(true))).toBe(true);
    expect(isClarityValue(Cl.none())).toBe(true);
  });

  test('rejects plain JS values', () => {
    expect(isClarityValue(1)).toBe(false);
    expect(isClarityValue('x')).toBe(false);
    expect(isClarityValue(null)).toBe(false);
    expect(isClarityValue({ type: 99 })).toBe(false);
    expect(isClarityValue({})).toBe(false);
  });
});

describe('toClarityValue — primitives', () => {
  test('uint128', () => {
    expect(toClarityValue('uint128', 5)).toEqual(Cl.uint(5));
    expect(toClarityValue('uint128', 5n)).toEqual(Cl.uint(5));
  });
  test('int128', () => {
    expect(toClarityValue('int128', -3)).toEqual(Cl.int(-3));
  });
  test('bool', () => {
    expect(toClarityValue('bool', true)).toEqual(Cl.bool(true));
  });
  test('principal', () => {
    const addr = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM';
    expect(toClarityValue('principal', addr)).toEqual(Cl.principal(addr));
  });
  test('none', () => {
    expect(toClarityValue('none', null)).toEqual(Cl.none());
  });
});

describe('toClarityValue — composites', () => {
  test('optional null → none', () => {
    expect(toClarityValue({ optional: 'uint128' }, null)).toEqual(Cl.none());
  });
  test('optional value → some(...)', () => {
    expect(toClarityValue({ optional: 'uint128' }, 7)).toEqual(Cl.some(Cl.uint(7)));
  });
  test('buffer from Uint8Array', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(toClarityValue({ buffer: { length: 32 } }, bytes)).toEqual(Cl.buffer(bytes));
  });
  test('buffer from hex string', () => {
    expect(toClarityValue({ buffer: { length: 32 } }, 'a1b2c3')).toEqual(Cl.bufferFromHex('a1b2c3'));
  });
  test('string-utf8 / string-ascii', () => {
    expect(toClarityValue({ 'string-utf8': { length: 8 } }, 'hi')).toEqual(Cl.stringUtf8('hi'));
    expect(toClarityValue({ 'string-ascii': { length: 8 } }, 'hi')).toEqual(Cl.stringAscii('hi'));
  });
  test('list', () => {
    expect(
      toClarityValue({ list: { type: 'uint128', length: 5 } }, [1, 2, 3])
    ).toEqual(Cl.list([Cl.uint(1), Cl.uint(2), Cl.uint(3)]));
  });
  test('tuple', () => {
    const result = toClarityValue(
      {
        tuple: [
          { name: 'a', type: 'uint128' },
          { name: 'b', type: 'bool' },
        ],
      },
      { a: 1, b: true }
    );
    expect(result).toEqual(Cl.tuple({ a: Cl.uint(1), b: Cl.bool(true) }));
  });
});

describe('toClarityValue — passthrough', () => {
  test('already-built CV is returned untouched', () => {
    const cv = Cl.uint(99);
    expect(toClarityValue('uint128', cv)).toBe(cv);
  });

  test('passthrough works through composite types', () => {
    expect(toClarityValue({ optional: 'uint128' }, Cl.uint(5))).toEqual(Cl.some(Cl.uint(5)));
  });
});

describe('toClarityValue — errors', () => {
  test('unknown atom throws', () => {
    expect(() => toClarityValue('whatever', 1)).toThrow('Unknown ABI atom type');
  });
  test('response as input throws', () => {
    expect(() =>
      toClarityValue({ response: { ok: 'bool', error: 'none' } }, { ok: true })
    ).toThrow('response type is not supported');
  });
  test('buffer with bad input throws', () => {
    expect(() => toClarityValue({ buffer: { length: 4 } }, 12 as unknown)).toThrow(
      'buffer arg expects'
    );
  });
});

describe('coerceArgs', () => {
  test('coerces positional args by ABI order', () => {
    const result = coerceArgs([{ type: 'uint128' }, { type: 'bool' }], [5, true]);
    expect(result).toEqual([Cl.uint(5), Cl.bool(true)]);
  });

  test('empty args allowed when ABI declares no args', () => {
    expect(coerceArgs([], [])).toEqual([]);
  });

  test('mismatched arity throws', () => {
    expect(() => coerceArgs([{ type: 'uint128' }], [])).toThrow('Expected 1 args, got 0');
  });
});
