import { asciiToBytes, bytesToUtf8, concatBytes, hexToBytes, utf8ToBytes } from '@stacks/common';
import assert from 'assert';
import { Cl, deserializeAddress } from '../../src';
import { BytesReader } from '../../src/BytesReader';
import {
  BufferCV,
  ClarityType,
  ClarityValue,
  ClarityWireType,
  IntCV,
  ListCV,
  SomeCV,
  StandardPrincipalCV,
  StringAsciiCV,
  StringUtf8CV,
  TupleCV,
  UIntCV,
  bufferCV,
  clarityByteToType,
  clarityTypeToByte,
  contractPrincipalCV,
  contractPrincipalCVFromStandard,
  deserializeCV,
  falseCV,
  intCV,
  listCV,
  noneCV,
  responseErrorCV,
  responseOkCV,
  serializeCV,
  serializeCVBytes,
  someCV,
  standardPrincipalCV,
  standardPrincipalCVFromAddress,
  stringAsciiCV,
  stringUtf8CV,
  trueCV,
  tupleCV,
  uintCV,
} from '../../src/clarity';
import {
  cvToJSON,
  cvToString,
  cvToValue,
  getCVTypeString,
  isClarityType,
} from '../../src/clarity/clarityValue';
import { parse } from '../../src/clarity/parser';

const ADDRESS = 'SP2JXKMSH007NPYAQHKJPQMAQYAD90NQGTVJVQ02B';

function serializeDeserialize<T extends ClarityValue>(value: T): T {
  const serializedDeserialized: Uint8Array = serializeCVBytes(value);
  const bytesReader = new BytesReader(serializedDeserialized);
  return deserializeCV(bytesReader) as T;
}

describe('Clarity Types', () => {
  test('Deserialize with type generics', () => {
    const serializedClarityValue =
      '0x0c00000003096e616d6573706163650200000003666f6f0a70726f706572746965730c000000061963616e2d7570646174652d70726963652d66756e6374696f6e030b6c61756e636865642d61740a0100000000000000000000000000000006086c69666574696d65010000000000000000000000000000000c106e616d6573706163652d696d706f7274051a164247d6f2b425ac5771423ae6c80c754f7172b00e70726963652d66756e6374696f6e0c0000000504626173650100000000000000000000000000000001076275636b6574730b00000010010000000000000000000000000000000101000000000000000000000000000000010100000000000000000000000000000001010000000000000000000000000000000101000000000000000000000000000000010100000000000000000000000000000001010000000000000000000000000000000101000000000000000000000000000000010100000000000000000000000000000001010000000000000000000000000000000101000000000000000000000000000000010100000000000000000000000000000001010000000000000000000000000000000101000000000000000000000000000000010100000000000000000000000000000001010000000000000000000000000000000105636f6566660100000000000000000000000000000001116e6f2d766f77656c2d646973636f756e740100000000000000000000000000000001116e6f6e616c7068612d646973636f756e7401000000000000000000000000000000010b72657665616c65642d61740100000000000000000000000000000003067374617475730d000000057265616479';

    // The old way of deserializing without type generics - verbose, hard to read, frustrating to define 🤢
    function parseWithManualTypeAssertions() {
      const deserializedCv = deserializeCV(serializedClarityValue);
      const clVal = deserializedCv as TupleCV;
      const namespaceCV = clVal.value['namespace'] as BufferCV;
      const statusCV = clVal.value['status'] as StringAsciiCV;
      const properties = clVal.value['properties'] as TupleCV;
      const launchedAtCV = properties.value['launched-at'] as SomeCV;
      const launchAtIntCV = launchedAtCV.value as UIntCV;
      const lifetimeCV = properties.value['lifetime'] as IntCV;
      const revealedAtCV = properties.value['revealed-at'] as IntCV;
      const addressCV = properties.value['namespace-import'] as StandardPrincipalCV;
      const priceFunction = properties.value['price-function'] as TupleCV;
      const baseCV = priceFunction.value['base'] as IntCV;
      const coeffCV = priceFunction.value['coeff'] as IntCV;
      const noVowelDiscountCV = priceFunction.value['no-vowel-discount'] as IntCV;
      const nonalphaDiscountCV = priceFunction.value['nonalpha-discount'] as IntCV;
      const bucketsCV = priceFunction.value['buckets'] as ListCV;
      const buckets: string[] = [];
      const listCV = bucketsCV.value;
      for (let i = 0; i < listCV.length; i++) {
        const cv = listCV[i] as UIntCV;
        buckets.push(cv.value.toString());
      }
      return {
        namespace: bytesToUtf8(hexToBytes(namespaceCV.value)),
        status: statusCV.value,
        launchedAt: launchAtIntCV.value.toString(),
        lifetime: lifetimeCV.value.toString(),
        revealedAt: revealedAtCV.value.toString(),
        address: addressCV.value,
        base: baseCV.value.toString(),
        coeff: coeffCV.value.toString(),
        noVowelDiscount: noVowelDiscountCV.value.toString(),
        nonalphaDiscount: nonalphaDiscountCV.value.toString(),
        buckets,
      };
    }

    // The new way of deserializing with type generics 🙂
    function parseWithTypeDefinition() {
      // (tuple
      //   (namespace (buff 3))
      //   (status (string-ascii 5))
      //   (properties (tuple
      //     (launched-at (optional uint))
      //     (namespace-import principal)
      //     (lifetime uint)
      //     (revealed-at uint)
      //     (price-function (tuple
      //       (base uint)
      //       (coeff uint)
      //       (no-vowel-discount uint)
      //       (nonalpha-discount uint)
      //       (buckets (list 16 uint))
      //
      // Easily map the Clarity type string above to the Typescript definition:
      type BnsNamespaceCV = TupleCV<{
        ['namespace']: BufferCV;
        ['status']: StringAsciiCV;
        ['properties']: TupleCV<{
          ['launched-at']: SomeCV<UIntCV>;
          ['namespace-import']: StandardPrincipalCV;
          ['lifetime']: IntCV;
          ['revealed-at']: IntCV;
          ['price-function']: TupleCV<{
            ['base']: IntCV;
            ['coeff']: IntCV;
            ['no-vowel-discount']: IntCV;
            ['nonalpha-discount']: IntCV;
            ['buckets']: ListCV<UIntCV>;
          }>;
        }>;
      }>;
      const cv = deserializeCV<BnsNamespaceCV>(serializedClarityValue);
      // easy, fully-typed access into the Clarity value properties
      const namespaceProps = cv.value.properties.value;
      const priceProps = namespaceProps['price-function'].value;
      return {
        namespace: bytesToUtf8(hexToBytes(cv.value.namespace.value)),
        status: cv.value.status.value,
        launchedAt: namespaceProps['launched-at'].value.value.toString(),
        lifetime: namespaceProps.lifetime.value.toString(),
        revealedAt: namespaceProps['revealed-at'].value.toString(),
        address: namespaceProps['namespace-import'].value,
        base: priceProps.base.value.toString(),
        coeff: priceProps.coeff.value.toString(),
        noVowelDiscount: priceProps['no-vowel-discount'].value.toString(),
        nonalphaDiscount: priceProps['nonalpha-discount'].value.toString(),
        buckets: priceProps.buckets.value.map(b => b.value.toString()),
      };
    }

    const parsed1 = parseWithManualTypeAssertions();
    const parsed2 = parseWithTypeDefinition();
    const expected = {
      namespace: 'foo',
      status: 'ready',
      launchedAt: '6',
      lifetime: '12',
      revealedAt: '3',
      address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
      base: '1',
      coeff: '1',
      noVowelDiscount: '1',
      nonalphaDiscount: '1',
      buckets: ['1', '1', '1', '1', '1', '1', '1', '1', '1', '1', '1', '1', '1', '1', '1', '1'],
    };
    expect(parsed1).toEqual(expected);
    expect(parsed2).toEqual(expected);
  });

  describe('Serialize Then Deserialize', () => {
    test('TrueCV', () => {
      const t = trueCV();
      const serializedDeserialized = serializeDeserialize(t);
      expect(serializedDeserialized).toEqual(t);
    });

    test('FalseCV', () => {
      const f = falseCV();
      const serializedDeserialized = serializeDeserialize(f);
      expect(serializedDeserialized).toEqual(f);
    });

    test('NoneCV', () => {
      const n = noneCV();
      const serializedDeserialized = serializeDeserialize(n);
      expect(serializedDeserialized).toEqual(n);
    });

    test('SomeCV', () => {
      const maybeTrue = someCV(trueCV());
      const serializedDeserialized = serializeDeserialize(maybeTrue);
      expect(serializedDeserialized).toEqual(maybeTrue);
    });

    test('BufferCV', () => {
      const buffer = utf8ToBytes('this is a test');
      const buf = bufferCV(buffer);
      const serializedDeserialized = serializeDeserialize(buf);
      expect(serializedDeserialized).toEqual(buf);
    });

    test('IntCV - simple value serialization', () => {
      const intPositiveTen = intCV(10);
      expect(intPositiveTen.value.toString()).toEqual('10');
      expect(cvToString(intPositiveTen)).toEqual('10');
      const serializedDeserializedPositive = serializeDeserialize(intPositiveTen) as IntCV;
      expect(cvToString(serializedDeserializedPositive)).toEqual(cvToString(intPositiveTen));

      const intNegativeTen = intCV(-10);
      expect(intNegativeTen.value.toString()).toEqual('-10');
      const serializedDeserializedNegative = serializeDeserialize(intNegativeTen) as IntCV;
      expect(cvToString(serializedDeserializedNegative)).toEqual(cvToString(intNegativeTen));

      expect(() => {
        // @ts-expect-error ts(2322) Type 'string' is not assignable to type 'number'
        intCV(['example string array']);
      }).toThrowError(TypeError);

      expect(() => intCV(NaN)).toThrowError(RangeError);
      expect(() => intCV(Infinity)).toThrowError(RangeError);
      expect(() => intCV('3.1415')).toThrowError(SyntaxError);
      expect(() => intCV(3.1415)).toThrowError(RangeError);
      expect(() => intCV(10000000000000000000000000000000)).toThrowError(RangeError);
    });

    test.each([
      [1, '1', '0x00000000000000000000000000000001'],
      [-1, '-1', '0xffffffffffffffffffffffffffffffff'],
      [-10, '-10', '0xfffffffffffffffffffffffffffffff6'],
      [-10n, '-10', '0xfffffffffffffffffffffffffffffff6'],
      ['-10', '-10', '0xfffffffffffffffffffffffffffffff6'],
      ['0xfff6', '-10', '0xfffffffffffffffffffffffffffffff6'],
      ['0xf6', '-10', '0xfffffffffffffffffffffffffffffff6'],
      [BigInt(-10), '-10', '0xfffffffffffffffffffffffffffffff6'],
      [new Uint8Array([0xff, 0xf6]), '-10', '0xfffffffffffffffffffffffffffffff6'],
      [new Uint8Array([0xf6]), '-10', '0xfffffffffffffffffffffffffffffff6'],
      [new Uint8Array([0xff, 0xfe]), '-2', '0xfffffffffffffffffffffffffffffffe'],
      [new Uint8Array([0xfe]), '-2', '0xfffffffffffffffffffffffffffffffe'],
      [Uint8Array.of(0xff, 0xfe), '-2', '0xfffffffffffffffffffffffffffffffe'],
      [Uint8Array.of(0xfe), '-2', '0xfffffffffffffffffffffffffffffffe'],
      [-200, '-200', '0xffffffffffffffffffffffffffffff38'],
      [new Uint8Array([0xff, 0x38]), '-200', '0xffffffffffffffffffffffffffffff38'],
      [200, '200', '0x000000000000000000000000000000c8'],
      [2e2, '200', '0x000000000000000000000000000000c8'],
      [10, '10', '0x0000000000000000000000000000000a'],
      [10n, '10', '0x0000000000000000000000000000000a'],
      [1e1, '10', '0x0000000000000000000000000000000a'],
      ['10', '10', '0x0000000000000000000000000000000a'],
      ['0x0a', '10', '0x0000000000000000000000000000000a'],
      ['0x000a', '10', '0x0000000000000000000000000000000a'],
      ['0xa', '10', '0x0000000000000000000000000000000a'], // hex string with odd padding
      ['0x00a', '10', '0x0000000000000000000000000000000a'], // hex string with odd padding
      [BigInt(10), '10', '0x0000000000000000000000000000000a'],
      [new Uint8Array([0x0a]), '10', '0x0000000000000000000000000000000a'],
      [new Uint8Array([0x00, 0x0a]), '10', '0x0000000000000000000000000000000a'],
      [Uint8Array.of(0x0a), '10', '0x0000000000000000000000000000000a'],
      [Uint8Array.of(0x00, 0x0a), '10', '0x0000000000000000000000000000000a'],
    ])('IntCV - value %o is serialized to %o', (num, expectedInt, expectedHex) => {
      const numCV = intCV(num);
      expect(numCV.value.toString()).toBe(expectedInt);
      const serialized = serializeCV(numCV);
      expect('0x' + serialized.slice(2)).toBe(expectedHex);
      expect(cvToString(deserializeCV(serialized))).toBe(expectedInt);
    });

    test('IntCV - bounds', () => {
      // Max 128-bit signed integer
      const maxSigned128 = intCV(2n ** 127n - 1n);
      expect(maxSigned128.value.toString()).toBe('170141183460469231731687303715884105727');
      const serializedMax = serializeCV(maxSigned128);
      expect('0x' + serializedMax.slice(2)).toBe('0x7fffffffffffffffffffffffffffffff');
      const serializedDeserializedMax = serializeDeserialize(maxSigned128) as IntCV;
      expect(cvToString(serializedDeserializedMax)).toBe(cvToString(maxSigned128));

      // Min 128-bit signed integer
      const minSigned128 = intCV((-2n) ** 127n);
      expect(minSigned128.value.toString()).toBe('-170141183460469231731687303715884105728');
      const serializedMin = serializeCV(minSigned128);
      expect('0x' + serializedMin.slice(2)).toBe('0x80000000000000000000000000000000');
      const serializedDeserializedMin = serializeDeserialize(minSigned128) as IntCV;
      expect(cvToString(serializedDeserializedMin)).toBe(cvToString(minSigned128));

      // Out of bounds, too large
      expect(() => intCV(2n ** 127n)).toThrow(RangeError);
      expect(() => intCV(Number.MAX_SAFE_INTEGER + 1)).toThrowError(RangeError);

      // Out of bounds, too small
      expect(() => intCV((-2n) ** 127n - 1n)).toThrow(RangeError);
    });

    test('UIntCV - simple value serialization', () => {
      const uint = uintCV(10);
      expect(uint.value.toString()).toBe('10');
      const serialized1 = serializeCV(uint);
      expect('0x' + serialized1.slice(2)).toBe('0x0000000000000000000000000000000a');
      const serializedDeserialized = serializeDeserialize(uint) as UIntCV;
      expect(cvToString(serializedDeserialized)).toBe(cvToString(uint));

      const uint2 = uintCV('0x0a');
      const serialized2 = serializeCV(uint2);
      expect('0x' + serialized2.slice(2)).toBe('0x0000000000000000000000000000000a');
      expect(cvToString(serializeDeserialize(uint2))).toBe(cvToString(uint));

      expect(() => uintCV(10000000000000000000000000000000)).toThrowError(RangeError);
    });

    test('UIntCV - bounds', () => {
      // Max 128-bit integer
      const max128 = uintCV(2n ** 128n - 1n);
      expect(max128.value.toString()).toBe('340282366920938463463374607431768211455');
      const serializedMax = serializeCV(max128);
      expect('0x' + serializedMax.slice(2)).toBe('0xffffffffffffffffffffffffffffffff');
      const serializedDeserializedMax = serializeDeserialize(max128);
      expect(cvToString(serializedDeserializedMax)).toBe(cvToString(max128));

      // Min 128-bit integer
      const min128 = uintCV(0);
      expect(min128.value.toString()).toBe('0');
      const serializedMin = serializeCV(min128);
      expect('0x' + serializedMin.slice(2)).toBe('0x00000000000000000000000000000000');
      const serializedDeserializedMin = serializeDeserialize(min128);
      expect(cvToString(serializedDeserializedMin)).toBe(cvToString(min128));

      // Out of bounds, too large
      expect(() => uintCV(2n ** 128n)).toThrow(RangeError);
      expect(() => uintCV(Number.MAX_SAFE_INTEGER + 1)).toThrowError(RangeError);

      // Out of bounds, too small
      expect(() => uintCV(-1)).toThrow(RangeError);
    });

    test.each([
      [200, '200', '0x000000000000000000000000000000c8'],
      [10, '10', '0x0000000000000000000000000000000a'],
      [10n, '10', '0x0000000000000000000000000000000a'],
      ['10', '10', '0x0000000000000000000000000000000a'],
      ['0x0a', '10', '0x0000000000000000000000000000000a'],
      [BigInt(10), '10', '0x0000000000000000000000000000000a'],
      [new Uint8Array([0x0a]), '10', '0x0000000000000000000000000000000a'],
      [new Uint8Array([0x00, 0x0a]), '10', '0x0000000000000000000000000000000a'],
    ])('UIntCV - value %o is serialized to %o', (num, expectedInt, expectedHex) => {
      const numCV = uintCV(num);
      expect(numCV.value.toString()).toBe(expectedInt);
      const serialized = serializeCV(numCV);
      expect('0x' + serialized.slice(2)).toBe(expectedHex);
      expect(cvToString(deserializeCV(serialized))).toBe('u' + expectedInt);
    });

    test('Clarity integer to JSON value', () => {
      // 53 bits is max safe integer and max supported by bn.js `toNumber()`

      const maxSafeInt = 2n ** 53n - 1n;
      const unsafeLargeIntSize = maxSafeInt + 1n;
      expect(maxSafeInt.toString()).toBe(Number.MAX_SAFE_INTEGER.toString());

      const minSafeInt = -(2n ** 53n - 1n);
      const unsafeMinIntSize = minSafeInt - 1n;
      expect(minSafeInt.toString()).toBe(Number.MIN_SAFE_INTEGER.toString());

      const smallBitsUInt1 = cvToValue(uintCV(maxSafeInt), true);
      expect(smallBitsUInt1.toString()).toBe(maxSafeInt.toString());
      expect(typeof smallBitsUInt1).toBe('string');

      const smallBitsInt1 = cvToValue(intCV(maxSafeInt), true);
      expect(smallBitsInt1.toString()).toBe(maxSafeInt.toString());
      expect(typeof smallBitsInt1).toBe('string');

      const smallBitsInt2 = cvToValue(intCV(minSafeInt), true);
      expect(smallBitsInt2.toString()).toBe(minSafeInt.toString());
      expect(typeof smallBitsInt2).toBe('string');

      const largeBitsUInt1 = cvToValue(uintCV(unsafeLargeIntSize), true);
      expect(largeBitsUInt1.toString()).toBe(unsafeLargeIntSize.toString());
      expect(typeof largeBitsUInt1).toBe('string');

      const largeBitsInt1 = cvToValue(intCV(unsafeLargeIntSize), true);
      expect(largeBitsInt1.toString()).toBe(unsafeLargeIntSize.toString());
      expect(typeof largeBitsInt1).toBe('string');

      const largeBitsInt2 = cvToValue(intCV(unsafeMinIntSize), true);
      expect(largeBitsInt2.toString()).toBe(unsafeMinIntSize.toString());
      expect(typeof largeBitsInt2).toBe('string');
    });

    test('Standard Principal', () => {
      const standardPrincipal = standardPrincipalCV(ADDRESS);
      const serializedDeserialized = serializeDeserialize(standardPrincipal);
      expect(serializedDeserialized).toEqual(standardPrincipal);
    });

    test('Contract Principal', () => {
      const contractPrincipal = contractPrincipalCV(ADDRESS, 'test-contract');
      const serializedDeserialized = serializeDeserialize(contractPrincipal);
      expect(serializedDeserialized).toEqual(contractPrincipal);
    });

    test('Response Ok', () => {
      const responseOk = responseOkCV(trueCV());
      const serializedDeserialized = serializeDeserialize(responseOk);
      expect(serializedDeserialized).toEqual(responseOk);
    });

    test('Response Error', () => {
      const responseErr = responseErrorCV(trueCV());
      const serializedDeserialized = serializeDeserialize(responseErr);
      expect(serializedDeserialized).toEqual(responseErr);
    });

    test('ListCV', () => {
      const list = listCV([trueCV(), falseCV(), trueCV()]);
      const serializedDeserialized = serializeDeserialize(list);
      expect(serializedDeserialized).toEqual(list);
    });

    test('TupleCV', () => {
      const tuple = tupleCV({
        c: trueCV(),
        b: falseCV(),
        a: trueCV(),
      });
      const serializedDeserialized = serializeDeserialize(tuple) as TupleCV;
      expect(serializedDeserialized).toEqual(tuple);

      // Test lexicographic ordering of tuple keys (to match Node Buffer compare)
      const lexicographic = Object.keys(tuple.value).sort((a, b) => {
        const bufA = Buffer.from(a);
        const bufB = Buffer.from(b);
        return bufA.compare(bufB);
      });
      expect(Object.keys(serializedDeserialized.value)).toEqual(lexicographic);
    });

    test('StringAsciiCV', () => {
      const str = stringAsciiCV('hello world');
      const serializedDeserialized = serializeDeserialize(str) as StringAsciiCV;
      expect(serializedDeserialized).toEqual(str);
    });

    test('StringUtf8CV', () => {
      const str = stringUtf8CV('hello 🌾');
      const serializedDeserialized = serializeDeserialize(str) as StringUtf8CV;
      expect(serializedDeserialized).toEqual(str);
    });
  });

  describe('Serialization Test Vectors', () => {
    test('Int 1 Vector', () => {
      const int = intCV(1);
      const serialized = serializeCV(int);
      expect(serialized).toEqual('0000000000000000000000000000000001');
    });

    test('Int -1 Vector', () => {
      const int = intCV(-1);
      const serialized = serializeCV(int);
      expect(serialized).toEqual('00ffffffffffffffffffffffffffffffff');
    });

    test('UInt 1 Vector', () => {
      const uint = uintCV(1);
      const serialized = serializeCV(uint);
      expect(serialized).toEqual('0100000000000000000000000000000001');
    });

    test('Buffer Vector', () => {
      const buffer = bufferCV(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
      const serialized = serializeCV(buffer);
      expect(serialized).toEqual('0200000004deadbeef');
    });

    test('True Vector', () => {
      const t = trueCV();
      const serialized = serializeCV(t);
      expect(serialized).toEqual('03');
    });

    test('False Vector', () => {
      const f = falseCV();
      const serialized = serializeCV(f);
      expect(serialized).toEqual('04');
    });

    test('Standard Principal Vector', () => {
      const addressBuffer = new Uint8Array([
        0x11, 0xde, 0xad, 0xbe, 0xef, 0x11, 0xab, 0xab, 0xff, 0xff, 0x11, 0xde, 0xad, 0xbe, 0xef,
        0x11, 0xab, 0xab, 0xff, 0xff,
      ]);
      const bytesReader = new BytesReader(concatBytes(new Uint8Array([0x00]), addressBuffer));
      const standardPrincipal = standardPrincipalCVFromAddress(deserializeAddress(bytesReader));
      const serialized = serializeCV(standardPrincipal);
      expect(serialized).toEqual('050011deadbeef11ababffff11deadbeef11ababffff');
    });

    test('Contract Principal Vector', () => {
      const addressBuffer = new Uint8Array([
        0x11, 0xde, 0xad, 0xbe, 0xef, 0x11, 0xab, 0xab, 0xff, 0xff, 0x11, 0xde, 0xad, 0xbe, 0xef,
        0x11, 0xab, 0xab, 0xff, 0xff,
      ]);
      const contractName = 'abcd';
      const bytesReader = new BytesReader(concatBytes(new Uint8Array([0x00]), addressBuffer));
      const standardPrincipal = standardPrincipalCVFromAddress(deserializeAddress(bytesReader));
      const contractPrincipal = contractPrincipalCVFromStandard(standardPrincipal, contractName);
      const serialized = serializeCV(contractPrincipal);
      expect(serialized).toEqual('060011deadbeef11ababffff11deadbeef11ababffff0461626364');
    });

    test('Response Ok Vector', () => {
      const ok = responseOkCV(intCV(-1));
      const serialized = serializeCV(ok);
      expect(serialized).toEqual('0700ffffffffffffffffffffffffffffffff');
    });

    test('Response Err Vector', () => {
      const err = responseErrorCV(intCV(-1));
      const serialized = serializeCV(err);
      expect(serialized).toEqual('0800ffffffffffffffffffffffffffffffff');
    });

    test('None Vector', () => {
      const none = noneCV();
      const serialized = serializeCV(none);
      expect(serialized).toEqual('09');
    });

    test('Some Vector', () => {
      const some = someCV(intCV(-1));
      const serialized = serializeCV(some);
      expect(serialized).toEqual('0a00ffffffffffffffffffffffffffffffff');
    });

    test('List Vector', () => {
      const list = listCV([intCV(1), intCV(2), intCV(3), intCV(-4)]);
      const serialized = serializeCV(list);
      expect(serialized).toEqual(
        '0b0000000400000000000000000000000000000000010000000000000000000000000000000002000000000000000000000000000000000300fffffffffffffffffffffffffffffffc'
      );
    });

    test('Tuple Vector', () => {
      const tuple = tupleCV({
        baz: noneCV(),
        foobar: trueCV(),
      });
      const serialized = serializeCV(tuple);
      expect(serialized).toEqual('0c000000020362617a0906666f6f62617203');
    });

    test('Ascii String Vector', () => {
      const str = stringAsciiCV('hello world');
      const serialized = serializeCV(str);
      expect(serialized).toEqual('0d0000000b68656c6c6f20776f726c64');
    });

    test('Ascii String Escaped Length', () => {
      const strings = [
        stringAsciiCV('\\'),
        stringAsciiCV('"'),
        stringAsciiCV('\n'),
        stringAsciiCV('\t'),
        stringAsciiCV('\r'),
        stringAsciiCV('\0'),
      ];
      const serialized = strings.map(serializeCVBytes);
      serialized.forEach(ser => {
        const reader = new BytesReader(ser);
        const serializedStringLenByte = reader.readBytes(5)[4];
        expect(serializedStringLenByte).toEqual(1);
        expect(ser.length).toEqual(6);
      });
    });

    test('Utf8 String Vector', () => {
      const str = stringUtf8CV('hello world');
      const serialized = serializeCV(str);
      expect(serialized).toEqual('0e0000000b68656c6c6f20776f726c64');
    });
  });

  describe('Clarity Value To Clarity String Literal', () => {
    test('Complex Tuple', () => {
      const tuple = tupleCV({
        a: intCV(-1),
        b: uintCV(1),
        c: bufferCV(utf8ToBytes('test')),
        d: trueCV(),
        e: someCV(trueCV()),
        f: noneCV(),
        g: standardPrincipalCV(ADDRESS),
        h: contractPrincipalCV(ADDRESS, 'test'),
        i: responseOkCV(trueCV()),
        j: responseErrorCV(falseCV()),
        k: listCV([trueCV(), falseCV()]),
        l: tupleCV({
          a: trueCV(),
          b: falseCV(),
        }),
        m: stringAsciiCV('hello world'),
        n: stringUtf8CV('hello \u{1234}'),
      });

      const tupleString = cvToString(tuple);

      expect(tupleString).toEqual(
        `(tuple (a -1) (b u1) (c 0x74657374) (d true) (e (some true)) (f none) (g SP2JXKMSH007NPYAQHKJPQMAQYAD90NQGTVJVQ02B) (h SP2JXKMSH007NPYAQHKJPQMAQYAD90NQGTVJVQ02B.test) (i (ok true)) (j (err false)) (k (list true false)) (l (tuple (a true) (b false))) (m "hello world") (n u"hello \u{1234}"))`
      );
    });

    test('Hex Buffers', () => {
      expect(cvToString(bufferCV(asciiToBytes('\n')))).toEqual('0x0a');
      expect(cvToString(bufferCV(hexToBytes('00')))).toEqual('0x00');
      expect(cvToString(bufferCV(new Uint8Array([127])))).toEqual('0x7f');
    });
  });

  describe('Clarity value to JSON', () => {
    test('Complex Tuple', () => {
      const tuple = tupleCV({
        a: intCV(-1),
        b: uintCV(1),
        c: bufferCV(utf8ToBytes('test')),
        d: trueCV(),
        e: someCV(trueCV()),
        f: noneCV(),
        g: standardPrincipalCV(ADDRESS),
        h: contractPrincipalCV(ADDRESS, 'test'),
        i: responseOkCV(trueCV()),
        j: responseErrorCV(falseCV()),
        k: listCV([trueCV(), falseCV()]),
        l: tupleCV({
          a: trueCV(),
          b: falseCV(),
        }),
        m: stringAsciiCV('hello world'),
        n: stringUtf8CV('hello \u{1234}'),
      });

      const tupleString = JSON.stringify(cvToJSON(tuple));

      expect(tupleString).toEqual(
        `{"type":"(tuple (a int) (b uint) (c (buff 4)) (d bool) (e (optional bool)) (f (optional none)) (g principal) (h principal) (i (response bool UnknownType)) (j (response UnknownType bool)) (k (list 2 bool)) (l (tuple (a bool) (b bool))) (m (string-ascii 11)) (n (string-utf8 9)))","value":{"a":{"type":"int","value":"-1"},"b":{"type":"uint","value":"1"},"c":{"type":"(buff 4)","value":"0x74657374"},"d":{"type":"bool","value":true},"e":{"type":"(optional bool)","value":{"type":"bool","value":true}},"f":{"type":"(optional none)","value":null},"g":{"type":"principal","value":"SP2JXKMSH007NPYAQHKJPQMAQYAD90NQGTVJVQ02B"},"h":{"type":"principal","value":"SP2JXKMSH007NPYAQHKJPQMAQYAD90NQGTVJVQ02B.test"},"i":{"type":"(response bool UnknownType)","value":{"type":"bool","value":true},"success":true},"j":{"type":"(response UnknownType bool)","value":{"type":"bool","value":false},"success":false},"k":{"type":"(list 2 bool)","value":[{"type":"bool","value":true},{"type":"bool","value":false}]},"l":{"type":"(tuple (a bool) (b bool))","value":{"a":{"type":"bool","value":true},"b":{"type":"bool","value":false}}},"m":{"type":"(string-ascii 11)","value":"hello world"},"n":{"type":"(string-utf8 9)","value":"hello \u{1234}"}}}`
      );
    });

    test('Hex Buffer', () => {
      expect(JSON.stringify(cvToJSON(bufferCV(asciiToBytes('\n'))))).toEqual(
        `{"type":"(buff 1)","value":"0x0a"}`
      );
    });
  });

  describe('Clarity Types to String', () => {
    test('Complex Tuple', () => {
      const tuple = tupleCV({
        a: intCV(-1),
        b: uintCV(1),
        c: bufferCV(utf8ToBytes('test')),
        d: trueCV(),
        e: someCV(trueCV()),
        f: noneCV(),
        g: standardPrincipalCV(ADDRESS),
        h: contractPrincipalCV(ADDRESS, 'test'),
        i: responseOkCV(trueCV()),
        j: responseErrorCV(falseCV()),
        k: listCV([trueCV(), falseCV()]),
        l: tupleCV({
          a: trueCV(),
          b: falseCV(),
        }),
        m: stringAsciiCV('hello world'),
        n: stringUtf8CV('hello \u{1234}'),
        o: listCV([]),
      });
      const typeString = getCVTypeString(tuple);
      expect(typeString).toEqual(
        '(tuple (a int) (b uint) (c (buff 4)) (d bool) (e (optional bool)) (f (optional none)) (g principal) (h principal) (i (response bool UnknownType)) (j (response UnknownType bool)) (k (list 2 bool)) (l (tuple (a bool) (b bool))) (m (string-ascii 11)) (n (string-utf8 9)) (o (list 0 UnknownType)))'
      );
    });
  });

  describe('Clarity type narrowing', () => {
    it('can narrow strings', () => {
      const vUint = Cl.uint(1) as ClarityValue;
      expect(isClarityType(vUint, ClarityType.UInt)).toBeTruthy();
      expect(isClarityType(vUint, ClarityType.Int)).toBeFalsy();

      const vInt = Cl.int(1) as ClarityValue;
      expect(isClarityType(vInt, ClarityType.Int)).toBeTruthy();
      expect(isClarityType(vInt, ClarityType.UInt)).toBeFalsy();

      // test the type assertion

      assert(isClarityType(vUint, ClarityType.UInt));
      const uintTest: UIntCV = vUint;
      uintTest; // avoid the "value is never read warning"

      assert(isClarityType(vInt, ClarityType.Int));
      const intTest: IntCV = vInt;
      intTest; // avoid the "value is never read warning"
    });
  });

  describe('Clarity type wire format', () => {
    test(clarityTypeToByte.name, () => {
      expect(clarityTypeToByte(ClarityType.Int)).toEqual(0x00);
      expect(clarityTypeToByte(ClarityType.Int)).toEqual(ClarityWireType.int);

      expect(clarityTypeToByte(ClarityType.UInt)).toEqual(0x01);
      expect(clarityTypeToByte(ClarityType.UInt)).toEqual(ClarityWireType.uint);

      expect(clarityTypeToByte(ClarityType.Buffer)).toEqual(0x02);
      expect(clarityTypeToByte(ClarityType.Buffer)).toEqual(ClarityWireType.buffer);

      expect(clarityTypeToByte(ClarityType.BoolTrue)).toEqual(0x03);
      expect(clarityTypeToByte(ClarityType.BoolTrue)).toEqual(ClarityWireType.true);

      expect(clarityTypeToByte(ClarityType.BoolFalse)).toEqual(0x04);
      expect(clarityTypeToByte(ClarityType.BoolFalse)).toEqual(ClarityWireType.false);

      expect(clarityTypeToByte(ClarityType.PrincipalStandard)).toEqual(0x05);
      expect(clarityTypeToByte(ClarityType.PrincipalStandard)).toEqual(ClarityWireType.address);

      expect(clarityTypeToByte(ClarityType.PrincipalContract)).toEqual(0x06);
      expect(clarityTypeToByte(ClarityType.PrincipalContract)).toEqual(ClarityWireType.contract);

      expect(clarityTypeToByte(ClarityType.ResponseOk)).toEqual(0x07);
      expect(clarityTypeToByte(ClarityType.ResponseOk)).toEqual(ClarityWireType.ok);

      expect(clarityTypeToByte(ClarityType.ResponseErr)).toEqual(0x08);
      expect(clarityTypeToByte(ClarityType.ResponseErr)).toEqual(ClarityWireType.err);

      expect(clarityTypeToByte(ClarityType.OptionalNone)).toEqual(0x09);
      expect(clarityTypeToByte(ClarityType.OptionalNone)).toEqual(ClarityWireType.none);

      expect(clarityTypeToByte(ClarityType.OptionalSome)).toEqual(0x0a);
      expect(clarityTypeToByte(ClarityType.OptionalSome)).toEqual(ClarityWireType.some);

      expect(clarityTypeToByte(ClarityType.List)).toEqual(0x0b);
      expect(clarityTypeToByte(ClarityType.List)).toEqual(ClarityWireType.list);

      expect(clarityTypeToByte(ClarityType.Tuple)).toEqual(0x0c);
      expect(clarityTypeToByte(ClarityType.Tuple)).toEqual(ClarityWireType.tuple);

      expect(clarityTypeToByte(ClarityType.StringASCII)).toEqual(0x0d);
      expect(clarityTypeToByte(ClarityType.StringASCII)).toEqual(ClarityWireType.ascii);

      expect(clarityTypeToByte(ClarityType.StringUTF8)).toEqual(0x0e);
      expect(clarityTypeToByte(ClarityType.StringUTF8)).toEqual(ClarityWireType.utf8);
    });

    test(clarityByteToType.name, () => {
      expect(clarityByteToType(0x00)).toEqual(ClarityType.Int);
      expect(clarityByteToType(0x01)).toEqual(ClarityType.UInt);
      expect(clarityByteToType(0x02)).toEqual(ClarityType.Buffer);
      expect(clarityByteToType(0x03)).toEqual(ClarityType.BoolTrue);
      expect(clarityByteToType(0x04)).toEqual(ClarityType.BoolFalse);
      expect(clarityByteToType(0x05)).toEqual(ClarityType.PrincipalStandard);
      expect(clarityByteToType(0x06)).toEqual(ClarityType.PrincipalContract);
      expect(clarityByteToType(0x07)).toEqual(ClarityType.ResponseOk);
      expect(clarityByteToType(0x08)).toEqual(ClarityType.ResponseErr);
      expect(clarityByteToType(0x09)).toEqual(ClarityType.OptionalNone);
      expect(clarityByteToType(0x0a)).toEqual(ClarityType.OptionalSome);
      expect(clarityByteToType(0x0b)).toEqual(ClarityType.List);
      expect(clarityByteToType(0x0c)).toEqual(ClarityType.Tuple);
      expect(clarityByteToType(0x0d)).toEqual(ClarityType.StringASCII);
      expect(clarityByteToType(0x0e)).toEqual(ClarityType.StringUTF8);
    });
  });
});

const TEST_CASES_PARSER = [
  { input: '123', expected: Cl.int(123) },
  { input: '0', expected: Cl.int(0) },
  { input: '-15', expected: Cl.int(-15) },
  { input: 'u123', expected: Cl.uint(123) },
  { input: 'u0', expected: Cl.uint(0) },
  { input: 'true', expected: Cl.bool(true) },
  { input: 'false', expected: Cl.bool(false) },
  {
    input: "'SP2JXKMSH007NPYAQHKJPQMAQYAD90NQGTVJVQ02B",
    expected: Cl.address('SP2JXKMSH007NPYAQHKJPQMAQYAD90NQGTVJVQ02B'),
  },
  {
    input: "'SP2JXKMSH007NPYAQHKJPQMAQYAD90NQGTVJVQ02B.some-contract",
    expected: Cl.address('SP2JXKMSH007NPYAQHKJPQMAQYAD90NQGTVJVQ02B.some-contract'),
  },
  { input: '0x68656c6c6f21', expected: Cl.bufferFromHex('68656c6c6f21') },
  { input: '"hello world"', expected: Cl.stringAscii('hello world') },
  { input: 'u"hello world"', expected: Cl.stringUtf8('hello world') },
  { input: '"hello \\"world\\""', expected: Cl.stringAscii('hello "world"') },
  { input: '"hello \\\\"', expected: Cl.stringAscii('hello \\') },
  { input: '"hello \\\\\\", \\"world\\""', expected: Cl.stringAscii('hello \\", "world"') },
  { input: '(list 1 2 3)', expected: Cl.list([Cl.int(1), Cl.int(2), Cl.int(3)]) },
  { input: '( list  1   2    3 )', expected: Cl.list([Cl.int(1), Cl.int(2), Cl.int(3)]) },
  { input: '( list )', expected: Cl.list([]) },
  { input: '(list)', expected: Cl.list([]) },
  {
    input: '{ id: u5, name: "clarity" }',
    expected: Cl.tuple({ id: Cl.uint(5), name: Cl.stringAscii('clarity') }),
  },
  {
    input: '{something : (list 3 2 1),}',
    expected: Cl.tuple({ something: Cl.list([Cl.int(3), Cl.int(2), Cl.int(1)]) }),
  },
  {
    input: '{ a: 0x68656c6c6f21 }',
    expected: Cl.tuple({ a: Cl.bufferFromHex('68656c6c6f21') }),
  },
  {
    input: '( tuple ( something  (list 1 2 3)) (other "other" ) )',
    expected: Cl.tuple({
      something: Cl.list([Cl.int(1), Cl.int(2), Cl.int(3)]),
      other: Cl.stringAscii('other'),
    }),
  },
  { input: 'none', expected: Cl.none() },
  { input: '( some u1 )', expected: Cl.some(Cl.uint(1)) },
  { input: '(some none)', expected: Cl.some(Cl.none()) },
  { input: '( ok  true   )', expected: Cl.ok(Cl.bool(true)) },
  { input: '(err false)', expected: Cl.error(Cl.bool(false)) },
  {
    input: '( ok (list {id: 3} {id: 4} {id: 5} ))',
    expected: Cl.ok(
      Cl.list([
        Cl.tuple({ id: Cl.int(3) }),
        Cl.tuple({ id: Cl.int(4) }),
        Cl.tuple({ id: Cl.int(5) }),
      ])
    ),
  },
  { input: 'u""', expected: Cl.stringUtf8('') },
  { input: 'u"\\\\"', expected: Cl.stringUtf8('\\') },
  { input: `u"\\n"`, expected: Cl.stringUtf8('\n') },
] as const;

const TEST_CASES_PARSER_INVERTIBLE = [
  { input: '""', expected: Cl.stringAscii('') },
  { input: '"hello"', expected: Cl.stringAscii('hello') },
  { input: '"\\"hello\\""', expected: Cl.stringAscii('"hello"') },
  { input: '"a\\\\b"', expected: Cl.stringAscii('a\\b') },
  { input: 'u"a\\\\\\\\b"', expected: Cl.stringUtf8('a\\\\b') },
  { input: 'u"a\\"b"', expected: Cl.stringUtf8('a"b') },
  { input: 'u"こんにちは"', expected: Cl.stringUtf8('こんにちは') },

  { input: '"\\\\path\\\\to\\\\file"', expected: Cl.stringAscii('\\path\\to\\file') },
  { input: '"\\b\\f\\n\\r\\t\\"\\\\"', expected: Cl.stringAscii('\b\f\n\r\t"\\') },

  {
    input: '"Line1\\nLine2\\u0002 \\"Quote\\" \\\\ slash"',
    expected: Cl.stringAscii('Line1\nLine2\u0002 "Quote" \\ slash'),
  },

  { input: 'u"résumé – ångström"', expected: Cl.stringUtf8('résumé – ångström') },
] as const;

test.each([...TEST_CASES_PARSER, ...TEST_CASES_PARSER_INVERTIBLE])(
  'clarity parser %p',
  ({ input, expected }) => {
    const result = parse(input);
    expect(result).toEqual(expected);
  }
);

test.each(TEST_CASES_PARSER_INVERTIBLE)('clarity parser inverseable %p', ({ input, expected }) => {
  const parsed = parse(input);
  expect(parsed).toEqual(expected);

  const stringified = Cl.stringify(parsed);
  expect(stringified).toEqual(input);
});

test.each(TEST_CASES_PARSER_INVERTIBLE)(
  'clarity parser string handling matches JSON JS implementation %p',
  ({ input, expected }) => {
    if (expected.type !== 'utf8' && expected.type !== 'ascii') return; // Only strings
    if (expected.type === 'utf8') input = input.replace('u"', '"') as any; // Remove the u" prefix for UTF-8 strings

    // String handling in Cl.parse/Cl.stringify should match the JSON.parse/JSON.stringify implementation
    const parsed = JSON.parse(input);
    const stringified = JSON.stringify(parsed);
    expect(stringified).toEqual(input);
  }
);

// const TEST_CASES_PARSER_THROW = []; // todo: e.g. `{}`
