import { validateStacksAddress, validateContractName, validateContractId } from '../src/utils';

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

describe(validateContractName.name, () => {
  test('it returns true for valid contract names', () => {
    const validNames = [
      'pox',
      'my-contract',
      'nft-trait',
      'sip-010-ft-standard',
      'contract123',
      'a', // single letter is valid
      'test_contract',
      'is-valid?',
    ];
    validNames.forEach(name => expect(validateContractName(name)).toBeTruthy());
  });

  test('it returns false for invalid contract names', () => {
    const invalidNames = [
      '', // empty string
      '123contract', // starts with number
      'a'.repeat(129), // too long (max 128)
    ];
    invalidNames.forEach(name => expect(validateContractName(name)).toBeFalsy());
  });
});

describe(validateContractId.name, () => {
  test('it returns true for valid contract identifiers', () => {
    const validContractIds = [
      'SP000000000000000000002Q6VF78.pox',
      'ST3J2GVMMM2R07ZFBJDWTYEYAR8FZH5WKDTFJ9AHA.my-contract',
      'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG.nft-trait',
      'STVTVW5E80EET19EZ3J8W3NZKR6RHNFG58TKQGXH.sip-010-ft-standard',
    ];
    validContractIds.forEach(id => expect(validateContractId(id)).toBeTruthy());
  });

  test('it returns false for invalid contract identifiers', () => {
    const invalidContractIds = [
      'SP000000000000000000002Q6VF78', // no contract name
      'not-an-address.contract', // invalid address
      '.contract', // no address
      'SP000000000000000000002Q6VF78.', // empty contract name
      'SP000000000000000000002Q6VF78.123start', // contract name starts with number
      'SP000000000000000000002Q6VF78.name.extra', // multiple dots
      '', // empty string
    ];
    invalidContractIds.forEach(id => expect(validateContractId(id)).toBeFalsy());
  });
});
