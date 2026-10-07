import * as fs from 'fs';

const TEST_DATA_DIR = './tests/testData';

export const sampleProfiles = {
  balloonDog: JSON.parse(fs.readFileSync(`${TEST_DATA_DIR}/profiles/balloonDog.json`, 'utf8')),
  naval: JSON.parse(fs.readFileSync(`${TEST_DATA_DIR}/profiles/naval.json`, 'utf8')),
  ryan: JSON.parse(fs.readFileSync(`${TEST_DATA_DIR}/profiles/ryan.json`, 'utf8')),
  larry: JSON.parse(fs.readFileSync(`${TEST_DATA_DIR}/profiles/larry.json`, 'utf8')),
  google: JSON.parse(fs.readFileSync(`${TEST_DATA_DIR}/profiles/google.json`, 'utf8')),
  navalLegacy: JSON.parse(fs.readFileSync(`${TEST_DATA_DIR}/profiles/naval-legacy.json`, 'utf8')),
  navalLegacyConvert: JSON.parse(
    fs.readFileSync(`${TEST_DATA_DIR}/profiles/naval-legacy-convert.json`, 'utf8')
  ),
};

export const sampleTokenFiles = {
  ryan_apr20: {
    url: 'https://_example_.s3.amazonaws.com/ryan_apr20.id',
    body: JSON.parse(fs.readFileSync(`${TEST_DATA_DIR}/token-files/ryan_apr20.json`, 'utf8')),
  },
  ryan: {
    url: 'https://_example_.s3.amazonaws.com/ryan.id',
    body: JSON.parse(fs.readFileSync(`${TEST_DATA_DIR}/token-files/ryan.json`, 'utf8')),
  },
};
