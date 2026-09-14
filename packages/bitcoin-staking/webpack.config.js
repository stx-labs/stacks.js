const config = require('../../configs/webpack.config.js');

config.output.library.name = 'StacksBitcoinStaking';

config.resolve.fallback = {};

module.exports = config;
