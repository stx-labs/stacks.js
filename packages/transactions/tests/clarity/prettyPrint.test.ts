import { Cl } from '../../src';

describe.only('test format of Stacks.js clarity values into clarity style strings', () => {
  it('formats basic types', () => {
    expect(Cl.prettyPrint(Cl.bool(true))).toStrictEqual('true');
    expect(Cl.prettyPrint(Cl.bool(false))).toStrictEqual('false');
    expect(Cl.prettyPrint(Cl.none())).toStrictEqual('none');

    expect(Cl.prettyPrint(Cl.int(1))).toStrictEqual('1');
    expect(Cl.prettyPrint(Cl.int(10n))).toStrictEqual('10');

    expect(Cl.prettyPrint(Cl.stringAscii('hello world!'))).toStrictEqual('"hello world!"');
    expect(Cl.prettyPrint(Cl.stringUtf8('hello world!'))).toStrictEqual('u"hello world!"');
  });

  it('formats principal', () => {
    const addr = 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG';

    expect(Cl.prettyPrint(Cl.standardPrincipal(addr))).toStrictEqual(
      "'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG"
    );
    expect(Cl.prettyPrint(Cl.contractPrincipal(addr, 'contract'))).toStrictEqual(
      "'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG.contract"
    );
  });

  it('formats optional some', () => {
    expect(Cl.prettyPrint(Cl.some(Cl.uint(1)))).toStrictEqual('(some u1)');
    expect(Cl.prettyPrint(Cl.some(Cl.stringAscii('btc')))).toStrictEqual('(some "btc")');
    expect(Cl.prettyPrint(Cl.some(Cl.stringUtf8('stx 🚀')))).toStrictEqual('(some u"stx 🚀")');
  });

  it('formats reponse', () => {
    expect(Cl.prettyPrint(Cl.ok(Cl.uint(1)))).toStrictEqual('(ok u1)');
    expect(Cl.prettyPrint(Cl.error(Cl.uint(1)))).toStrictEqual('(err u1)');
    expect(Cl.prettyPrint(Cl.ok(Cl.some(Cl.uint(1))))).toStrictEqual('(ok (some u1))');
    expect(Cl.prettyPrint(Cl.ok(Cl.none()))).toStrictEqual('(ok none)');
  });

  it('formats buffer', () => {
    expect(Cl.prettyPrint(Cl.buffer(Uint8Array.from([98, 116, 99])))).toStrictEqual('0x627463');
    expect(Cl.prettyPrint(Cl.bufferFromAscii('stx'))).toStrictEqual('0x737478');
  });

  it('formats lists', () => {
    expect(Cl.prettyPrint(Cl.list([1, 2, 3].map(Cl.int)))).toStrictEqual('(list 1 2 3)');
    expect(Cl.prettyPrint(Cl.list([1, 2, 3].map(Cl.uint)))).toStrictEqual('(list u1 u2 u3)');
    expect(Cl.prettyPrint(Cl.list(['a', 'b', 'c'].map(Cl.stringUtf8)))).toStrictEqual(
      '(list u"a" u"b" u"c")'
    );

    expect(Cl.prettyPrint(Cl.list([]))).toStrictEqual('(list)');
  });

  it('can prettify lists on multiple lines', () => {
    const list = Cl.list([1, 2, 3].map(Cl.int));
    expect(Cl.prettyPrint(list)).toStrictEqual('(list 1 2 3)');
    expect(Cl.prettyPrint(list, 2)).toStrictEqual('(list\n  1\n  2\n  3\n)');

    expect(Cl.prettyPrint(Cl.list([]), 2)).toStrictEqual('(list)');
  });

  it('formats tuples', () => {
    expect(Cl.prettyPrint(Cl.tuple({ counter: Cl.uint(10) }))).toStrictEqual('{ counter: u10 }');
    expect(
      Cl.prettyPrint(Cl.tuple({ counter: Cl.uint(10), state: Cl.ok(Cl.stringUtf8('valid')) }))
    ).toStrictEqual('{ counter: u10, state: (ok u"valid") }');

    expect(Cl.prettyPrint(Cl.tuple({}))).toStrictEqual('{}');
  });

  it('can prettify tuples on multiple lines', () => {
    const tuple = Cl.tuple({ counter: Cl.uint(10) });

    expect(Cl.prettyPrint(tuple)).toStrictEqual('{ counter: u10 }');
    expect(Cl.prettyPrint(tuple, 2)).toStrictEqual('{\n  counter: u10\n}');

    expect(Cl.prettyPrint(Cl.tuple({}), 2)).toStrictEqual('{}');
  });

  it('prettifies nested list and tuples', () => {
    // test that the right indentation level is applied for nested composite types
    const addr = 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG';
    const value = Cl.tuple({
      id: Cl.uint(1),
      messageAscii: Cl.stringAscii('hello world'),
      someMessageUtf8: Cl.some(Cl.stringUtf8('hello world')),
      items: Cl.some(
        Cl.list([
          Cl.ok(
            Cl.tuple({
              id: Cl.uint(1),
              owner: Cl.some(Cl.standardPrincipal(addr)),
              valid: Cl.ok(Cl.uint(2)),
              history: Cl.some(Cl.list([Cl.uint(1), Cl.uint(2)])),
            })
          ),
          Cl.ok(
            Cl.tuple({
              id: Cl.uint(2),
              owner: Cl.none(),
              valid: Cl.error(Cl.uint(1000)),
              history: Cl.none(),
            })
          ),
        ])
      ),
    });

    const expected = `{
  id: u1,
  items: (some (list
    (ok {
      history: (some (list
        u1
        u2
      )),
      id: u1,
      owner: (some 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG),
      valid: (ok u2)
    })
    (ok {
      history: none,
      id: u2,
      owner: none,
      valid: (err u1000)
    })
  )),
  messageAscii: "hello world",
  someMessageUtf8: (some u"hello world")
}`;

    const result = Cl.prettyPrint(value, 2);
    expect(result).toStrictEqual(expected);
  });
});
