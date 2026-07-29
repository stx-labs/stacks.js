# Testing Inconsistencies

## Overall Status: Mostly consistent

All packages use Jest with ts-jest, `.test.ts` file naming, and a `tests/` directory. Configuration is centralized via `configs/jestConfig.js`.

---

## Issues Found

### 1. Dead `tests/setup.js` files in every package

All 12 test-enabled packages contain an identical `tests/setup.js` file:
```javascript
const fetchMock = require('jest-fetch-mock');
fetchMock.enableFetchMocks();
```

**None of these files are referenced by any jest config.** The shared config at `configs/jestConfig.js` references `configs/jestSetup.js` instead. These per-package setup files are unused dead code.

### 2. wallet-sdk test script differs

| Package | Test script |
|---------|------------|
| 11 packages | `"test": "jest"` |
| wallet-sdk | `"test": "jest --coverage"` |

The shared jest config already sets `collectCoverage: true`, so the `--coverage` flag is redundant but inconsistent.

### 3. `@stacks/internal` has no tests

- No `tests/` directory
- No `jest.config.js`
- No `test` script in package.json
- Still has `jest-fetch-mock` in devDependencies (unused)

### 4. Test counts by package

| Package | Test files |
|---------|-----------|
| transactions | 15 |
| wallet-sdk | 6 |
| common | 5 |
| encryption | 5 |
| stacking | 4 |
| profile | 4 |
| cli | 3 |
| api | 1 |
| auth | 1 |
| bns | 1 |
| network | 1 |
| storage | 1 |
| internal | 0 |
