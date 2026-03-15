import { bytesToHex, utf8ToBytes } from '@stacks/common';
import {
  validateStacksAddress,
  leftPadHex,
  leftPadHexToLength,
  rightPadHexToLength,
  exceedsMaxLengthBytes,
  hash160,
  txidFromBytes,
  isClarityName,
  cvToHex,
  hexToCV,
  parseReadOnlyResponse,
  parseContractId,
} from '../src/utils';
import { intCV, uintCV, trueCV, falseCV, stringAsciiCV } from '../src/clarity';

describe(validateStacksAddress.name, () => {
  test('it returns true for a legit address', () => {
    const validAddresses = [
      'STVTVW5E80EET19EZ3J8W3NZKR6RHNFG58TKQGXH',
      'STMFBYXTWAZD0NYMHSRQBZX1190EMZ42VD326PNP',
      'ST22ENKAF6J5G43TZFQS1WTV0YEH8VNX2SX048RA5',
    ];
    validAddresses.forEach(address => expect(validateStacksAddress(address)).toBeTruthy());
  });

  test('it returns false for nonsense input', () => {
    const nonsenseNotRealSillyAddresses = [
      'update borrow transfer trumpet stem topic resemble youth trophy later slam air subway invite salt quantum fossil smoke hero lift sense boat green wave',
      '03680327df912362e7d2280fea0fb80af2ba70f8fdc853d36f3c621fb93a73b801',
      'one upon a time in a land far far away',
      'lkjsdfksfjd(*&(*7sedf;lkj',
      'In the beginning...',
      // missing one char
      'ST3S6T6BS4DJ7AW74KVMNYXWH5SZ1WXX8JBCYZVY',
    ];
    nonsenseNotRealSillyAddresses.forEach(nonAddress =>
      expect(validateStacksAddress(nonAddress)).toBeFalsy()
    );
  });

  test('returns false for empty string', () => {
    expect(validateStacksAddress('')).toBeFalsy();
  });
});

describe(leftPadHex.name, () => {
  test('pads odd-length hex strings with leading zero', () => {
    expect(leftPadHex('a')).toBe('0a');
    expect(leftPadHex('abc')).toBe('0abc');
    expect(leftPadHex('12345')).toBe('012345');
  });

  test('does not modify even-length hex strings', () => {
    expect(leftPadHex('ab')).toBe('ab');
    expect(leftPadHex('abcd')).toBe('abcd');
    expect(leftPadHex('123456')).toBe('123456');
  });

  test('handles empty string', () => {
    expect(leftPadHex('')).toBe('');
  });

  test('handles single character', () => {
    expect(leftPadHex('0')).toBe('00');
    expect(leftPadHex('f')).toBe('0f');
  });
});

describe(leftPadHexToLength.name, () => {
  test('pads hex string to specified length', () => {
    expect(leftPadHexToLength('ab', 4)).toBe('00ab');
    expect(leftPadHexToLength('1', 8)).toBe('00000001');
    expect(leftPadHexToLength('ff', 6)).toBe('0000ff');
  });

  test('does not truncate if string is already longer', () => {
    expect(leftPadHexToLength('abcdef', 4)).toBe('abcdef');
    expect(leftPadHexToLength('12345678', 2)).toBe('12345678');
  });

  test('handles exact length match', () => {
    expect(leftPadHexToLength('abcd', 4)).toBe('abcd');
  });

  test('handles empty string', () => {
    expect(leftPadHexToLength('', 4)).toBe('0000');
  });

  test('handles zero length', () => {
    expect(leftPadHexToLength('abc', 0)).toBe('abc');
  });
});

describe(rightPadHexToLength.name, () => {
  test('pads hex string on the right to specified length', () => {
    expect(rightPadHexToLength('ab', 4)).toBe('ab00');
    expect(rightPadHexToLength('1', 8)).toBe('10000000');
    expect(rightPadHexToLength('ff', 6)).toBe('ff0000');
  });

  test('does not truncate if string is already longer', () => {
    expect(rightPadHexToLength('abcdef', 4)).toBe('abcdef');
    expect(rightPadHexToLength('12345678', 2)).toBe('12345678');
  });

  test('handles exact length match', () => {
    expect(rightPadHexToLength('abcd', 4)).toBe('abcd');
  });

  test('handles empty string', () => {
    expect(rightPadHexToLength('', 4)).toBe('0000');
  });
});

describe(exceedsMaxLengthBytes.name, () => {
  test('returns false when string is within limit', () => {
    expect(exceedsMaxLengthBytes('hello', 10)).toBe(false);
    expect(exceedsMaxLengthBytes('test', 4)).toBe(false);
    expect(exceedsMaxLengthBytes('a', 1)).toBe(false);
  });

  test('returns true when string exceeds limit', () => {
    expect(exceedsMaxLengthBytes('hello', 4)).toBe(true);
    expect(exceedsMaxLengthBytes('testing', 5)).toBe(true);
  });

  test('handles UTF-8 multi-byte characters correctly', () => {
    // Emoji typically uses 4 bytes
    expect(exceedsMaxLengthBytes('😀', 3)).toBe(true);
    expect(exceedsMaxLengthBytes('😀', 4)).toBe(false);
    // Chinese character typically uses 3 bytes
    expect(exceedsMaxLengthBytes('中', 2)).toBe(true);
    expect(exceedsMaxLengthBytes('中', 3)).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(exceedsMaxLengthBytes('', 0)).toBe(false);
    expect(exceedsMaxLengthBytes('', 10)).toBe(false);
  });

  test('handles null/undefined gracefully', () => {
    // @ts-expect-error testing null input
    expect(exceedsMaxLengthBytes(null, 10)).toBe(false);
    // @ts-expect-error testing undefined input
    expect(exceedsMaxLengthBytes(undefined, 10)).toBe(false);
  });
});

describe(hash160.name, () => {
  test('produces correct RIPEMD160(SHA256(input)) hash', () => {
    const input = utf8ToBytes('hello');
    const result = hash160(input);
    
    // hash160 should return a 20-byte (160-bit) Uint8Array
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(20);
  });

  test('produces consistent results for same input', () => {
    const input = utf8ToBytes('test');
    const result1 = hash160(input);
    const result2 = hash160(input);
    
    expect(bytesToHex(result1)).toBe(bytesToHex(result2));
  });

  test('produces different results for different inputs', () => {
    const input1 = utf8ToBytes('hello');
    const input2 = utf8ToBytes('world');
    
    expect(bytesToHex(hash160(input1))).not.toBe(bytesToHex(hash160(input2)));
  });

  test('handles empty input', () => {
    const input = new Uint8Array(0);
    const result = hash160(input);
    
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(20);
  });
});

describe(txidFromBytes.name, () => {
  test('produces a SHA512/256 hash as hex string', () => {
    const input = utf8ToBytes('test transaction');
    const result = txidFromBytes(input);
    
    // SHA512/256 produces a 32-byte (256-bit) hash, which is 64 hex chars
    expect(typeof result).toBe('string');
    expect(result.length).toBe(64);
    expect(/^[0-9a-f]+$/.test(result)).toBe(true);
  });

  test('produces consistent results for same input', () => {
    const input = utf8ToBytes('consistent input');
    const result1 = txidFromBytes(input);
    const result2 = txidFromBytes(input);
    
    expect(result1).toBe(result2);
  });

  test('produces different results for different inputs', () => {
    const input1 = utf8ToBytes('transaction 1');
    const input2 = utf8ToBytes('transaction 2');
    
    expect(txidFromBytes(input1)).not.toBe(txidFromBytes(input2));
  });

  test('handles empty input', () => {
    const input = new Uint8Array(0);
    const result = txidFromBytes(input);
    
    expect(typeof result).toBe('string');
    expect(result.length).toBe(64);
  });
});

describe(isClarityName.name, () => {
  test('returns true for valid Clarity names', () => {
    const validNames = [
      'hello',
      'my-function',
      'get_value',
      'is-valid?',
      'add!',
      'less<',
      'greater>',
      'equals=',
      'multiply*',
      'divide/',
      'add+',
      'subtract-',
      'compare<=',
      'compare>=',
      'a1b2c3',
      'testFunction123',
    ];
    validNames.forEach(name => {
      expect(isClarityName(name)).toBe(true);
    });
  });

  test('returns false for invalid Clarity names', () => {
    const invalidNames = [
      '123start', // starts with number
      '-invalid', // starts with hyphen (unless it's just "-")
      '_underscore', // starts with underscore
      'has space',
      'has.dot',
      'has@symbol',
      'has#hash',
      'has$dollar',
      'has%percent',
    ];
    invalidNames.forEach(name => {
      expect(isClarityName(name)).toBe(false);
    });
  });

  test('returns false for names exceeding 127 characters', () => {
    const longName = 'a'.repeat(128);
    expect(isClarityName(longName)).toBe(false);
    
    const validLongName = 'a'.repeat(127);
    expect(isClarityName(validLongName)).toBe(true);
  });

  test('returns true for single special character operators', () => {
    expect(isClarityName('-')).toBe(true);
    expect(isClarityName('+')).toBe(true);
    expect(isClarityName('*')).toBe(true);
    expect(isClarityName('/')).toBe(true);
    expect(isClarityName('<')).toBe(true);
    expect(isClarityName('>')).toBe(true);
    expect(isClarityName('=')).toBe(true);
    expect(isClarityName('<=')).toBe(true);
    expect(isClarityName('>=')).toBe(true);
  });

  test('returns false for empty string', () => {
    expect(isClarityName('')).toBe(false);
  });
});

describe(cvToHex.name, () => {
  test('converts integer clarity values to hex', () => {
    const cv = intCV(10);
    const hex = cvToHex(cv);
    
    expect(hex.startsWith('0x')).toBe(true);
    expect(typeof hex).toBe('string');
  });

  test('converts unsigned integer clarity values to hex', () => {
    const cv = uintCV(100);
    const hex = cvToHex(cv);
    
    expect(hex.startsWith('0x')).toBe(true);
  });

  test('converts boolean clarity values to hex', () => {
    const trueHex = cvToHex(trueCV());
    const falseHex = cvToHex(falseCV());
    
    expect(trueHex.startsWith('0x')).toBe(true);
    expect(falseHex.startsWith('0x')).toBe(true);
    expect(trueHex).not.toBe(falseHex);
  });

  test('converts string clarity values to hex', () => {
    const cv = stringAsciiCV('hello');
    const hex = cvToHex(cv);
    
    expect(hex.startsWith('0x')).toBe(true);
  });
});

describe(hexToCV.name, () => {
  test('converts hex back to clarity value (round-trip)', () => {
    const original = intCV(42);
    const hex = cvToHex(original);
    const restored = hexToCV(hex);
    
    expect(cvToHex(restored)).toBe(hex);
  });

  test('handles hex with 0x prefix', () => {
    const original = uintCV(100);
    const hex = cvToHex(original);
    const restored = hexToCV(hex);
    
    expect(cvToHex(restored)).toBe(hex);
  });

  test('handles hex without 0x prefix', () => {
    const original = trueCV();
    const hex = cvToHex(original);
    const hexWithoutPrefix = hex.slice(2); // Remove '0x'
    const restored = hexToCV(hexWithoutPrefix);
    
    expect(cvToHex(restored)).toBe(hex);
  });
});

describe(parseReadOnlyResponse.name, () => {
  test('parses successful response correctly', () => {
    const cv = intCV(123);
    const hex = cvToHex(cv);
    const response = { okay: true as const, result: hex };
    
    const result = parseReadOnlyResponse(response);
    expect(cvToHex(result)).toBe(hex);
  });

  test('throws error for error response', () => {
    const response = { okay: false as const, cause: 'Something went wrong' };
    
    expect(() => parseReadOnlyResponse(response)).toThrow('Something went wrong');
  });

  test('handles different error messages', () => {
    const response = { okay: false as const, cause: 'Contract not found' };
    
    expect(() => parseReadOnlyResponse(response)).toThrow('Contract not found');
  });
});

describe(parseContractId.name, () => {
  test('parses valid contract identifiers', () => {
    const [address, name] = parseContractId('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.my-contract');
    
    expect(address).toBe('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM');
    expect(name).toBe('my-contract');
  });

  test('handles contract names with hyphens', () => {
    const [address, name] = parseContractId('SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.token-contract-v2');
    
    expect(address).toBe('SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7');
    expect(name).toBe('token-contract-v2');
  });

  test('throws for invalid contract identifier without dot', () => {
    expect(() => parseContractId('invalid-no-dot' as any)).toThrow('Invalid contract identifier');
  });

  test('throws for empty contract identifier', () => {
    expect(() => parseContractId('' as any)).toThrow('Invalid contract identifier');
  });

  test('throws for contract identifier with only address', () => {
    expect(() => parseContractId('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.' as any)).toThrow('Invalid contract identifier');
  });

  test('throws for contract identifier with only name', () => {
    expect(() => parseContractId('.my-contract' as any)).toThrow('Invalid contract identifier');
  });
});
