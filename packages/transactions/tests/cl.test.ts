import { hexToBytes } from '@stacks/common';
import {
  Cl,
  boolCV,
  bufferCV,
  contractPrincipalCV,
  falseCV,
  intCV,
  listCV,
  responseErrorCV,
  responseOkCV,
  standardPrincipalCV,
  stringAsciiCV,
  stringCV,
  stringUtf8CV,
  trueCV,
  tupleCV,
  uintCV,
} from '../src';

describe('Cl', () => {
  const CV_EQUIVALENCES = [
    { cv: uintCV, cl: Cl.uint, args: [3] },
    { cv: intCV, cl: Cl.int, args: [-5] },
    { cv: boolCV, cl: Cl.bool, args: [true] },
    { cv: boolCV, cl: Cl.bool, args: [false] },
    { cv: trueCV, cl: Cl.bool, args: [true] },
    { cv: falseCV, cl: Cl.bool, args: [false] },
    {
      cv: standardPrincipalCV,
      cl: Cl.standardPrincipal,
      args: ['ST1HTBVD3JG9C05J7HBJTHGR0GGW7KXW28M5JS8QE'],
    },
    {
      cv: contractPrincipalCV,
      cl: Cl.contractPrincipal,
      args: ['ST1HTBVD3JG9C05J7HBJTHGR0GGW7KXW28M5JS8QE', 'contract'],
    },
    { cv: listCV, cl: Cl.list, args: [[uintCV(1), Cl.uint(2)]] },
    { cv: stringCV, cl: Cl.stringAscii, args: ['hello', 'ascii'] },
    { cv: stringCV, cl: Cl.stringUtf8, args: ['hello', 'utf8'] },
    { cv: stringAsciiCV, cl: Cl.stringAscii, args: ['hello'] },
    { cv: stringUtf8CV, cl: Cl.stringUtf8, args: ['hello'] },
    { cv: bufferCV, cl: Cl.buffer, args: [hexToBytes('beef')] },
    { cv: responseOkCV, cl: Cl.ok, args: [Cl.uint(1)] },
    { cv: responseErrorCV, cl: Cl.error, args: [Cl.int(-1)] },
    { cv: tupleCV, cl: Cl.tuple, args: [{ a: Cl.uint(1), b: uintCV(2) }] },
  ] as {
    cv: Function;
    cl: Function;
    args: any[];
  }[];

  test.each(CV_EQUIVALENCES)('cv == cl', ({ cv, cl, args }) => {
    const cvValue = cv(...args);
    const clValue = cl(...args);
    expect(clValue).toEqual(cvValue);

    const wired = Cl.deserialize(Cl.serialize(clValue));
    expect(wired).toEqual(clValue);
  });
});
