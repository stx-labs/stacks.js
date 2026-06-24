import { microStxToStx, stxToMicroStx, MICROSTX_IN_STX } from '../src/units';

describe('MICROSTX_IN_STX constant', () => {
  test('equals 1,000,000', () => {
    expect(MICROSTX_IN_STX).toBe(1_000_000);
  });
});

describe(stxToMicroStx.name, () => {
  test('converts whole numbers correctly', () => {
    expect(stxToMicroStx(1)).toBe(1000000);
    expect(stxToMicroStx(10)).toBe(10000000);
    expect(stxToMicroStx(100)).toBe(100000000);
  });

  test('converts decimal values correctly', () => {
    expect(stxToMicroStx(1.23)).toBe(1230000);
    expect(stxToMicroStx(0.5)).toBe(500000);
    expect(stxToMicroStx(0.000001)).toBe(1);
  });

  test('handles negative values', () => {
    expect(stxToMicroStx(-1)).toBe(-1000000);
    expect(stxToMicroStx(-2.34)).toBe(-2340000);
    expect(stxToMicroStx(-0.000001)).toBe(-1);
  });

  test('handles zero', () => {
    expect(stxToMicroStx(0)).toBe(0);
  });

  test('handles very small fractions', () => {
    // Values smaller than 1 μSTX result in fractions
    expect(stxToMicroStx(0.0000001)).toBe(0.1);
    expect(stxToMicroStx(0.00000001)).toBe(0.01);
  });

  test('handles large values', () => {
    expect(stxToMicroStx(1000000)).toBe(1000000000000);
    expect(stxToMicroStx(21000000)).toBe(21000000000000); // 21M STX
  });
});

describe(microStxToStx.name, () => {
  test('converts whole numbers correctly', () => {
    expect(microStxToStx(1000000)).toBe(1);
    expect(microStxToStx(10000000)).toBe(10);
    expect(microStxToStx(100000000)).toBe(100);
  });

  test('converts partial STX values correctly', () => {
    expect(microStxToStx(1230000)).toBe(1.23);
    expect(microStxToStx(500000)).toBe(0.5);
    expect(microStxToStx(1)).toBe(0.000001);
  });

  test('handles negative values', () => {
    expect(microStxToStx(-1000000)).toBe(-1);
    expect(microStxToStx(-2340000)).toBe(-2.34);
    expect(microStxToStx(-1)).toBe(-0.000001);
  });

  test('handles zero', () => {
    expect(microStxToStx(0)).toBe(0);
  });

  test('handles large values', () => {
    expect(microStxToStx(1000000000000)).toBe(1000000);
    expect(microStxToStx(21000000000000)).toBe(21000000); // 21M STX in μSTX
  });

  test('round-trip conversion is consistent', () => {
    const originalStx = 123.456789;
    const microStx = stxToMicroStx(originalStx);
    const backToStx = microStxToStx(microStx);
    expect(backToStx).toBe(originalStx);
  });
});

