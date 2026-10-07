const webpack = require('webpack');
const config = require('../../configs/webpack.config.js');

config.output.library.name = 'StacksWalletSdk';

config.plugins = [
  new webpack.ProvidePlugin({
    Buffer: ['buffer', 'Buffer'],
    process: require.resolve('process/browser'),
  }),
  ...config.plugins,
];

config.resolve.fallback = {};

module.exports = config;
