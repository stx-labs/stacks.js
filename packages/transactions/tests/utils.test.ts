import { cloneDeep, validateStacksAddress } from '../src/utils';

describe(cloneDeep.name, () => {
  test('primitives and bigint pass through', () => {
    expect(cloneDeep(null)).toBeNull();
    expect(cloneDeep(42)).toBe(42);
    expect(cloneDeep('hello')).toBe('hello');
    expect(cloneDeep(true)).toBe(true);
    expect(cloneDeep(100n)).toBe(100n);
  });

  test('Uint8Array is copied, not aliased', () => {
    const original = new Uint8Array([1, 2, 3]);
    const copy = cloneDeep(original);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    copy[0] = 99;
    expect(original[0]).toBe(1);
  });

  test('arrays are deep copied', () => {
    const original = [{ n: 1n }, { n: 2n }];
    const copy = cloneDeep(original);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    copy[0].n = 99n;
    expect(original[0].n).toBe(1n);
  });

  test('plain objects with bigint fields are deep copied', () => {
    // mirrors SpendingCondition: { nonce, fee, signature }
    const condition = { nonce: 0n, fee: 500n, signature: { data: 'aabbcc' } };
    const copy = cloneDeep(condition);
    expect(copy).toEqual(condition);
    expect(copy).not.toBe(condition);
    copy.fee = 999n;
    copy.signature.data = 'ff';
    expect(condition.fee).toBe(500n);
    expect(condition.signature.data).toBe('aabbcc');
  });

  test('Uint8Array nested in object is copied, not aliased', () => {
    // mirrors PublicKeyWire: { type, data: Uint8Array }
    const key = { type: 4, data: new Uint8Array([0xde, 0xad]) };
    const copy = cloneDeep(key);
    expect(copy.data).toEqual(key.data);
    expect(copy.data).not.toBe(key.data);
    copy.data[0] = 0xff;
    expect(key.data[0]).toBe(0xde);
  });

  test('class instance prototype is preserved', () => {
    // mirrors StacksTransactionWire: class whose methods must work after clone
    class Tx {
      version = 1;
      auth = { nonce: 0n };
      txid() {
        return `v${this.version}`;
      }
    }
    const tx = new Tx();
    const copy = cloneDeep(tx);
    expect(copy).not.toBe(tx);
    expect(copy.txid()).toBe('v1');
    copy.auth.nonce = 99n;
    expect(tx.auth.nonce).toBe(0n);
  });
});

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
});
