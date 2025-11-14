import { microStxToStx, stxToMicroStx } from '../src/units';

test(stxToMicroStx.name, () => {
  expect(stxToMicroStx(1)).toBe(1000000);
  expect(stxToMicroStx(1.23)).toBe(1230000);
  expect(stxToMicroStx(0.000001)).toBe(1);

  expect(stxToMicroStx('1')).toBe(1000000);
  expect(stxToMicroStx('1.23')).toBe(1230000);
  expect(stxToMicroStx('0.000001')).toBe(1);

  expect(stxToMicroStx(1n)).toBe(1000000);

  expect(stxToMicroStx(-1)).toBe(-1000000);
  expect(stxToMicroStx(-2.34)).toBe(-2340000);
  expect(stxToMicroStx(-0.000001)).toBe(-1);

  expect(stxToMicroStx('-1')).toBe(-1000000);
  expect(stxToMicroStx('-2.34')).toBe(-2340000);
  expect(stxToMicroStx('-0.000001')).toBe(-1);

  expect(stxToMicroStx(-1n)).toBe(-1000000);
});

test(microStxToStx.name, () => {
  expect(microStxToStx(1000000)).toBe(1);
  expect(microStxToStx(1230000)).toBe(1.23);
  expect(microStxToStx(1)).toBe(0.000001);

  expect(microStxToStx('1000000')).toBe(1);
  expect(microStxToStx('1230000')).toBe(1.23);
  expect(microStxToStx('1')).toBe(0.000001);

  expect(microStxToStx(1000000n)).toBe(1);
  expect(microStxToStx(1230000n)).toBe(1.23);
  expect(microStxToStx(1n)).toBe(0.000001);

  expect(microStxToStx(-1000000)).toBe(-1);
  expect(microStxToStx(-2340000)).toBe(-2.34);
  expect(microStxToStx(-1)).toBe(-0.000001);

  expect(microStxToStx('-1000000')).toBe(-1);
  expect(microStxToStx('-2340000')).toBe(-2.34);
  expect(microStxToStx('-1')).toBe(-0.000001);

  expect(microStxToStx(-1000000n)).toBe(-1);
  expect(microStxToStx(-2340000n)).toBe(-2.34);
  expect(microStxToStx(-1n)).toBe(-0.000001);
});
