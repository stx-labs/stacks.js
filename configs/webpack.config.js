const webpack = require('webpack');
const path = require('path');

// Run with ANALYZE ENV to show bundle size (only works with cjs)
// e.g.: ANALYZE=true npm run build -w @stacks/wallet-sdk
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const { DuplicatesPlugin } = require('inspectpack/plugin');

const NODE_ENV_PRODUCTION = 'production';
const NODE_ENV_DEVELOPMENT = 'development';

const isAnalyze = !!process.env.ANALYZE;
const isProduction = process.env.NODE_ENV === NODE_ENV_PRODUCTION;

module.exports = {
  mode: isProduction ? NODE_ENV_PRODUCTION : NODE_ENV_DEVELOPMENT,
  entry: ['./src/index.ts'],
  output: {
    library: {
      // name: is set in package config
      type: isAnalyze ? 'commonjs' : 'umd',
    },
    filename: 'index.js',
    path: path.resolve(process.cwd(), 'dist/umd'),
    globalObject: 'this', // recommended for umd bundles in webpack
  },
  plugins: [
    new webpack.ProvidePlugin({
      process: require.resolve('process/browser'),
    }),
    isAnalyze && new DuplicatesPlugin(),
    isAnalyze && new BundleAnalyzerPlugin({ analyzerMode: 'static' }),
  ].filter(Boolean),
  optimization: {
    minimize: isProduction,
  },
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: 'esbuild-loader',
            options: {
              target: 'es2017',
              tsconfig: 'tsconfig.build.json',
            },
          },
        ],
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@stacks/auth': '@stacks/auth/dist/esm',
      '@stacks/bns': '@stacks/bns/dist/esm',
      '@stacks/common': '@stacks/common/dist/esm',
      '@stacks/encryption': '@stacks/encryption/dist/esm',
      '@stacks/network': '@stacks/network/dist/esm',
      '@stacks/profile': '@stacks/profile/dist/esm',
      '@stacks/stacking': '@stacks/stacking/dist/esm',
      '@stacks/storage': '@stacks/storage/dist/esm',
      '@stacks/transactions': '@stacks/transactions/dist/esm',
      '@stacks/wallet-sdk': '@stacks/wallet-sdk/dist/esm',
    },
    // fallback: is set in package config
  },
};
