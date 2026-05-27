# Naming Convention Inconsistencies

## 1. File Naming (camelCase vs kebab-case)

95%+ of files use **camelCase**. Four outliers use **kebab-case**:
- `packages/transactions/src/contract-abi.ts`
- `packages/transactions/src/postcondition-types.ts`
- `packages/wallet-sdk/src/models/legacy-wallet-config.ts`
- `packages/wallet-sdk/src/models/wallet-config.ts`

---

## 2. Function Naming

**Consistent**: All exported functions use camelCase.

One exception: `packages/transactions/src/clarity/parser.ts` exports `internal_parseCommaSeparated()` using snake_case (marked as internal).

---

## 3. Type/Interface Naming

**Consistent**: All use PascalCase.

One exception: `packages/cli/src/utils.ts` exports `IDAppKeys` with an `I` prefix. No other interfaces use this convention.

---

## 4. Constant Naming

**Consistent**: All use UPPER_SNAKE_CASE.

---

## 5. Enum Member Naming (Inconsistent)

| Enum | Package | Member style |
|------|---------|-------------|
| `PayloadType`, `AnchorMode`, `PoXAddressVersion` | transactions, stacking | PascalCase |
| `AuthScope` | auth | snake_case (`store_write`, `publish_data`, `email`) |
| `PoxOperationPeriod` | stacking | String literals (`'Period1'`, `'Period2a'`) |

---

## 6. Boolean Variable Naming (Inconsistent)

**Properly prefixed** (good): `isComplete`, `wasString`, `isTTY`

**Unprefixed** (inconsistent):
- `encryption/src/ec.ts`: `result: boolean`, `sign: boolean`
- `stacking/src/index.ts`: `eligible: boolean`
- `cli/src/argparse.ts`: `timestamp: boolean`, `stringify: boolean`, `json: boolean`, `usage: boolean`

Most boolean properties lack the standard `is*`/`has*`/`should*`/`can*` prefix.

---

## 7. Object Property Naming (Context-dependent)

- **Internal code**: camelCase (consistent)
- **API response types**: snake_case (e.g., `public_keys`, `domain_name`, `read_url_prefix`, `contract_id`)

The snake_case properties come from Clarity/Stacks blockchain API conventions and are intentional, but undocumented as a convention.
