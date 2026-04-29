module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  reportUnusedDisableDirectives: true,
  extends: ['@stacks/eslint-config', 'plugin:import/typescript'],
  plugins: ['@typescript-eslint', 'node', 'import'],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: ['./packages/**/tsconfig.json', './tsconfig.json'],
  },
  settings: {
    node: {
      tryExtensions: ['.ts'],
    },
  },
  ignorePatterns: ['**/*.js'],
  rules: {
    '@typescript-eslint/explicit-module-boundary-types': ['off'],
    '@typescript-eslint/prefer-regexp-exec': ['off'],
    '@typescript-eslint/ban-ts-comment': ['off'],
    '@typescript-eslint/restrict-template-expressions': ['off'],
    '@typescript-eslint/no-inferrable-types': ['off'],
    '@typescript-eslint/no-unnecessary-type-assertion': ['off'],
    // Allow path triple-slash references for ambient .d.ts declarations (cross-package compilation)
    '@typescript-eslint/triple-slash-reference': ['error', { path: 'always', types: 'never', lib: 'never' }],

    '@typescript-eslint/no-unsafe-argument': ['warn'],
    '@typescript-eslint/no-unsafe-assignment': ['warn'],
    '@typescript-eslint/no-unsafe-call': ['warn'],
    '@typescript-eslint/no-unsafe-return': ['warn'],
    '@typescript-eslint/no-unsafe-member-access': ['warn'],
    '@typescript-eslint/no-unsafe-enum-comparison': ['warn'],
    '@typescript-eslint/no-non-null-assertion': ['off'],

    'import/no-extraneous-dependencies': ['error'],
    'no-new-wrappers': ['error'],
  },
  overrides: [
    {
      // Lock clean packages at error level to prevent regression
      files: [
        'packages/encryption/src/**/*.ts',
        'packages/bns/src/**/*.ts',
        'packages/network/src/**/*.ts',
      ],
      rules: {
        '@typescript-eslint/no-unsafe-argument': ['error'],
        '@typescript-eslint/no-unsafe-assignment': ['error'],
        '@typescript-eslint/no-unsafe-call': ['error'],
        '@typescript-eslint/no-unsafe-return': ['error'],
        '@typescript-eslint/no-unsafe-member-access': ['error'],
        '@typescript-eslint/no-unsafe-enum-comparison': ['error'],
      },
    },
  ],
};
