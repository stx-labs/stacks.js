const path = require('path');
const makeJestConfig = require('../../configs/jestConfig');

const config = makeJestConfig(__dirname);

// RECORD-only auto-retry harness (inert under replay). Appended after the shared
// setup so it runs alongside jestSetup.js.
config.setupFilesAfterEnv = [
  ...(config.setupFilesAfterEnv || []),
  path.resolve(__dirname, 'tests/helpers/jest-record-retry.ts'),
];

// RECORD-only chain preflight (inert under replay / for hosted nets): resets a
// wedged or down regtest chain ONCE before the run so a re-record self-heals.
config.globalSetup = path.resolve(__dirname, 'tests/helpers/jest-record-preflight.ts');

// @scure/btc-signer and its deps are ESM-only — transform them with ts-jest
const esmPackages = ['@scure/btc-signer', '@scure/base', '@noble/hashes', '@noble/curves', 'micro-packed'].join('|');
config.transformIgnorePatterns = [`/node_modules/(?!(${esmPackages})/)`];
config.transform = {
  ...config.transform,
  '^.+\\.tsx?$': 'ts-jest',
  // Transform ESM .js files from node_modules
  [`node_modules/(${esmPackages})/.+\\.js$`]: 'ts-jest',
};

module.exports = config;
