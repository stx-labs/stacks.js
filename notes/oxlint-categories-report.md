# Oxlint Categories Report

Audit of all oxlint categories against the stacks.js codebase (129 src files).

## Category summary

| Category | Warnings | Enable now? | Notes |
|---|---|---|---|
| **correctness** | **0** | Already on | Default, clean |
| **suspicious** | **43** | Yes — follow-up PR | 18 `no-shadow`, 15 `preserve-caught-error`, 6 `no-useless-constructor`, 3 `no-useless-concat`, 1 `no-extraneous-class` |
| **perf** | **23** | No | All `no-await-in-loop` — intentional sequential async in this codebase |
| **pedantic** | **587** | Cherry-pick only | `eqeqeq` (31), `no-throw-literal` (4), `no-case-declarations` (39) worth adding individually |
| **nursery** | **141** | No | All `no-undef` false positives (no type-aware mode) |
| **style** | **4496** | No | Noise: magic numbers, sort-keys, capitalized-comments |
| **restriction** | **1266** | No | Opinionated: no-any (149), no-console (74), explicit-return-type (227) |

## Suspicious breakdown (43 total)

| Rule | Count | Notes |
|---|---|---|
| `no-shadow` | 18 | Variable shadowing |
| `preserve-caught-error` | 15 | Catch params not used meaningfully |
| `no-useless-constructor` | 6 | Empty constructors |
| `no-useless-concat` | 3 | Unnecessary string concatenation |
| `no-extraneous-class` | 1 | Class with only static members |

## Pedantic breakdown (587 total)

| Rule | Count | Notes |
|---|---|---|
| `no-inline-comments` | 95 | Comments on code lines |
| `no-warning-comments` | 76 | TODO/FIXME comments |
| `no-else-return` | 74 | Unnecessary else after return |
| `require-await` | 47 | Async functions without await |
| `no-prototype-builtins` | 45 | Direct use of Object.prototype methods |
| `max-lines-per-function` | 41 | Long functions |
| `no-case-declarations` | 39 | Declarations in switch cases |
| `eqeqeq` | 31 | `==` instead of `===` |
| `max-lines` | 24 | Long files |
| `no-negated-condition` | 20 | Negated if conditions |
| `ban-ts-comment` | 19 | @ts-ignore usage |
| `prefer-ts-expect-error` | 17 | @ts-ignore → @ts-expect-error |
| `prefer-enum-initializers` | 15 | Enum members without explicit values |
| `radix` | 11 | Missing radix in parseInt |
| `no-promise-executor-return` | 9 | Return in Promise executor |
| `max-classes-per-file` | 9 | Multiple classes per file |
| `no-throw-literal` | 4 | Throwing non-Error objects |
| `no-lonely-if` | 3 | `else { if }` → `else if` |
| `max-depth` | 3 | Deeply nested code |
| `no-useless-return` | 2 | Dead return statements |
| `no-loop-func` | 2 | Functions inside loops |
| `no-inner-declarations` | 1 | Declarations inside blocks |

## Perf breakdown (23 total)

| Rule | Count | Notes |
|---|---|---|
| `no-await-in-loop` | 23 | Intentional sequential async patterns |

## Style breakdown (4496 total, top 10)

| Rule | Count |
|---|---|
| `no-magic-numbers` | 991 |
| `sort-keys` | 669 |
| `capitalized-comments` | 592 |
| `func-style` | 586 |
| `id-length` | 251 |
| `sort-imports` | 205 |
| `consistent-type-imports` | 192 |
| `no-ternary` | 165 |
| `curly` | 156 |
| `max-statements` | 137 |

## Restriction breakdown (1266 total, top 10)

| Rule | Count |
|---|---|
| `explicit-function-return-type` | 227 |
| `explicit-module-boundary-types` | 208 |
| `no-use-before-define` | 185 |
| `no-explicit-any` | 149 |
| `no-undefined` | 75 |
| `no-console` | 74 |
| `no-non-null-assertion` | 63 |
| `no-plusplus` | 62 |
| `no-bitwise` | 62 |
| `no-param-reassign` | 61 |

## Recommended follow-up

1. **Enable `suspicious` category** — 43 fixes, all straightforward
2. **Cherry-pick pedantic rules** — `eqeqeq`, `no-throw-literal`, `no-lonely-if`, `no-useless-return`
3. **Skip `perf`** — `no-await-in-loop` is intentional in this codebase
4. **Skip `style`/`restriction`/`nursery`** — too noisy or opinionated
