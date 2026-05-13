const config = require('../../configs/webpack.config.js');

config.output.library.name = 'StacksStck';

config.resolve.fallback = {};

module.exports = config;
