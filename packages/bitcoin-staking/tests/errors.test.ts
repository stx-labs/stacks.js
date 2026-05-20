import {
  POX5_ERROR_DESCRIPTIONS,
  POX5_ERROR_NAMES,
  Pox5ErrorCode,
  describePox5Error,
} from '../src/errors';

describe('describePox5Error', () => {
  it('describes ERR_BOND_ALREADY_STARTED (43)', () => {
    const info = describePox5Error(43);
    expect(info).toBeDefined();
    expect(info!.code).toBe(43);
    expect(info!.name).toBe('ERR_BOND_ALREADY_STARTED');
    expect(typeof info!.description).toBe('string');
    expect(info!.description.length).toBeGreaterThan(0);
  });

  it('describes ERR_NOT_BOND_PARTICIPANT (34)', () => {
    const info = describePox5Error(34);
    expect(info).toBeDefined();
    expect(info!.name).toBe('ERR_NOT_BOND_PARTICIPANT');
    expect(info!.description.length).toBeGreaterThan(0);
  });

  it('returns undefined for the removed code u6', () => {
    expect(describePox5Error(6)).toBeUndefined();
  });

  it('accepts bigint codes as well as numbers', () => {
    const info = describePox5Error(43n);
    expect(info?.name).toBe('ERR_BOND_ALREADY_STARTED');
  });

  it('returns undefined for unknown codes', () => {
    expect(describePox5Error(9999)).toBeUndefined();
  });
});

describe('Pox5ErrorCode enum', () => {
  it('has UpdateBondSameSigner = 44', () => {
    expect(Pox5ErrorCode.UpdateBondSameSigner).toBe(44);
  });

  it('every enum value has a corresponding name and description', () => {
    // Numeric enum values appear via `Object.values(enum)` as both keys (reverse-map
    // strings) and numeric values; filter to numbers only.
    const codes = Object.values(Pox5ErrorCode).filter(
      (v): v is number => typeof v === 'number'
    );
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(POX5_ERROR_NAMES[code as Pox5ErrorCode]).toBeDefined();
      expect(POX5_ERROR_DESCRIPTIONS[code as Pox5ErrorCode]).toBeDefined();
      expect(POX5_ERROR_NAMES[code as Pox5ErrorCode].length).toBeGreaterThan(0);
      expect(POX5_ERROR_DESCRIPTIONS[code as Pox5ErrorCode].length).toBeGreaterThan(0);
    }
  });
});
