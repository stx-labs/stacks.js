const makeJestConfig = require('../../configs/jestConfig');

const config = makeJestConfig(__dirname);

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
