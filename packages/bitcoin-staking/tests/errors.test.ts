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

  it('describes ERR_INVALID_LOCKUP_AMOUNT (45)', () => {
    const info = describePox5Error(45);
    expect(info).toBeDefined();
    expect(info!.code).toBe(45);
    expect(info!.name).toBe('ERR_INVALID_LOCKUP_AMOUNT');
    expect(info!.description.length).toBeGreaterThan(0);
  });

  it('describes ERR_UNAUTHORIZED (1) and ERR_CANNOT_SETUP_BOND_TOO_SOON (2)', () => {
    expect(describePox5Error(1)?.name).toBe('ERR_UNAUTHORIZED');
    expect(describePox5Error(2)?.name).toBe('ERR_CANNOT_SETUP_BOND_TOO_SOON');
  });

  it('describes ERR_DUPLICATE_LOCKUP_OUTPOINT (46)', () => {
    const info = describePox5Error(46);
    expect(info).toBeDefined();
    expect(info!.code).toBe(46);
    expect(info!.name).toBe('ERR_DUPLICATE_LOCKUP_OUTPOINT');
    expect(info!.description.length).toBeGreaterThan(0);
  });

  it('describes ERR_STAKE_IN_PREPARE_PHASE (47)', () => {
    const info = describePox5Error(47);
    expect(info).toBeDefined();
    expect(info!.code).toBe(47);
    expect(info!.name).toBe('ERR_STAKE_IN_PREPARE_PHASE');
    expect(info!.description.length).toBeGreaterThan(0);
  });

  it('describes ERR_ROLLOVER_TOO_EARLY (48)', () => {
    const info = describePox5Error(48);
    expect(info).toBeDefined();
    expect(info!.code).toBe(48);
    expect(info!.name).toBe('ERR_ROLLOVER_TOO_EARLY');
    expect(info!.description.length).toBeGreaterThan(0);
  });
});

describe('Pox5ErrorCode enum', () => {
  it('has InvalidLockupAmount = 45', () => {
    expect(Pox5ErrorCode.InvalidLockupAmount).toBe(45);
  });

  it('has RolloverTooEarly = 48', () => {
    expect(Pox5ErrorCode.RolloverTooEarly).toBe(48);
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
