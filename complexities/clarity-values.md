# Clarity Values — Complexity Refactoring Guide

## Summary Table

| Function | Complexity | File | Line | Primary Driver |
|---|---|---|---|---|
| `deserializeCV` | 22 | `deserialize.ts` | 42 | 15-case switch on `ClarityWireType` + input coercion branches |
| `cvToString` | 18 | `clarityValue.ts` | 38 | 15-case switch on `ClarityType` |
| `cvToValue` | 17 | `clarityValue.ts` | 85 | 15-case switch on `ClarityType` |
| `getCVTypeString` | 17 | `clarityValue.ts` | 136 | 15-case switch on `ClarityType` |
| `prettyPrintWithDepth` | 16 | `prettyPrint.ts` | 82 | 15 if-chains on `ClarityType` |
| `serializeCVBytes` | 16 | `serialize.ts` | 163 | 15-case switch on `ClarityType` (pure dispatch) |
| `greedy` (parser) | 7 | `parser.ts` | 120 | Loop with nested conditionals (separator handling) |
| `intCV` | 6 | `values/intCV.ts` | 35 | Input coercion (hex string, Uint8Array) + range validation |

---

## 1. `deserializeCV` — complexity 22

**File:** `deserialize.ts:42`

**What it does:** Accepts a hex string, `Uint8Array`, or `BytesReader`, reads a one-byte `ClarityWireType` discriminator, then dispatches to the correct constructor for each of the 15 Clarity value types. Recursive for composite types (some, ok, err, list, tuple).

**Complexity drivers:**
1. **Input coercion (lines 46-55):** Three-way `if/else if/else` to normalize the input into a `BytesReader`. This adds 3 branches.
2. **15-case `switch` on `ClarityWireType` (lines 60-132):** One case per wire type. Each case is linear — no nesting — except `list` (loop at line 101) and `tuple` (loop at line 109 + null check at line 111).
3. **The hex prefix check** (`0x` detection at line 47) adds another branch inside the string coercion path.

**Refactoring strategy:**

### A. Extract input normalization

Pull the `BytesReader` coercion into a standalone function. This removes 3 branches from `deserializeCV`.

```ts
function toBytesReader(input: BytesReader | Uint8Array | string): BytesReader {
  if (typeof input === 'string') {
    const hex = input.toLowerCase().startsWith('0x') ? input.slice(2) : input;
    return new BytesReader(hexToBytes(hex));
  }
  if (input instanceof Uint8Array) return new BytesReader(input);
  return input;
}
```

### B. Use a handler map instead of a switch

Replace the switch with a `Record<ClarityWireType, (reader: BytesReader) => ClarityValue>`:

```ts
const deserializers: Record<ClarityWireType, (r: BytesReader) => ClarityValue> = {
  [ClarityWireType.int]: r => intCV(bytesToTwosBigInt(r.readBytes(16))),
  [ClarityWireType.uint]: r => uintCV(r.readBytes(16)),
  [ClarityWireType.true]: () => trueCV(),
  // ... one entry per type
};

export function deserializeCV<T extends ClarityValue = ClarityValue>(
  serializedClarityValue: BytesReader | Uint8Array | string
): T {
  const bytesReader = toBytesReader(serializedClarityValue);
  const type = bytesReader.readUInt8Enum(ClarityWireType, n => {
    throw new DeserializationError(`Cannot recognize Clarity Type: ${n}`);
  });
  const handler = deserializers[type];
  if (!handler) throw new DeserializationError('...');
  return handler(bytesReader) as T;
}
```

**Expected reduction:** 22 → ~4 (one branch for the `if (!handler)` guard, plus 1 for the function entry). The per-type complexity moves into individual handler functions at complexity 1-3 each.

---

## 2. `cvToString` — complexity 18

**File:** `clarityValue.ts:38`

**What it does:** Converts a `ClarityValue` into its Clarity-syntax string representation (e.g., `u42`, `(some true)`, `(list u1 u2)`). Recursive for wrapper and container types.

**Complexity drivers:**
- 15-case switch over `ClarityType` (lines 39-77). All cases are flat except:
  - `Buffer` (line 49-54): nested `if (encoding === 'tryAscii')` with a further regex test, adding 2 branches.
  - `OptionalSome`, `ResponseErr`, `ResponseOk`: recursive calls (but no branching).

**Refactoring strategy:**

### A. Handler map

Same pattern as `deserializeCV` — a `Record<ClarityType, (val, encoding) => string>`:

```ts
const toStringHandlers: Record<ClarityType, (val: any, encoding: string) => string> = {
  [ClarityType.BoolTrue]: () => 'true',
  [ClarityType.Int]: val => val.value.toString(),
  [ClarityType.Buffer]: (val, encoding) => {
    if (encoding === 'tryAscii') {
      const str = bytesToAscii(hexToBytes(val.value));
      if (/[ -~]/.test(str)) return JSON.stringify(str);
    }
    return `0x${val.value}`;
  },
  // ...
};
```

### B. Extract buffer formatting

The `Buffer` case has its own mini-decision tree. Extract it:

```ts
function formatBuffer(hex: string, encoding: 'tryAscii' | 'hex'): string {
  if (encoding === 'tryAscii') {
    const str = bytesToAscii(hexToBytes(hex));
    if (/[ -~]/.test(str)) return JSON.stringify(str);
  }
  return `0x${hex}`;
}
```

**Expected reduction:** 18 → ~3 (function entry + handler lookup + null guard).

---

## 3. `cvToValue` — complexity 17

**File:** `clarityValue.ts:85`

**What it does:** Converts a `ClarityValue` to a JS-native value. Optionally stringifies bigints for JSON compatibility (`strictJsonCompat`). Delegates to `cvToJSON` for nested types.

**Complexity drivers:**
- 15-case switch (lines 86-122). Flat cases, with one conditional at line 93 (`strictJsonCompat` for int/uint).

**Refactoring strategy:**

Same handler-map approach. The `strictJsonCompat` branch for `Int`/`UInt` is the only non-trivial logic.

**Expected reduction:** 17 → ~3.

---

## 4. `getCVTypeString` — complexity 17

**File:** `clarityValue.ts:136`

**What it does:** Returns a Clarity-style type string for a value (e.g., `"int"`, `"(buff 32)"`, `"(list 3 uint)"`). Recursive for composite types.

**Complexity drivers:**
- 15-case switch (lines 137-170). Several cases compute lengths (`Buffer` at line 146, `List` at line 159, `StringASCII` at line 167, `StringUTF8` at line 168), but these are linear expressions — no branching. The `List` case (line 160) has a ternary for empty lists.

**Refactoring strategy:**

Handler map. This function is a pure transform from `ClarityType` → string.

**Expected reduction:** 17 → ~3.

---

## 5. `prettyPrintWithDepth` — complexity 16

**File:** `prettyPrint.ts:82`

**What it does:** Formats a `ClarityValue` into a human-readable Clarity string with optional indentation. Uses `if`-chains instead of a `switch`, but the logic is identical to the other ClarityType dispatchers.

**Complexity drivers:**
- 15 sequential `if` checks on `cv.type` (lines 83-114). Each branch is a single return. List and Tuple delegate to helper functions (`formatList`, `formatTuple`).
- The `exhaustiveCheck(cv)` call at line 114 acts as the default case — a nice pattern for compile-time exhaustiveness.

**Refactoring strategy:**

### A. Convert to switch

Using `switch` with exhaustive-check `default` gives the same compile-time safety but makes the intent clearer and marginally reduces the cyclomatic complexity count (tool-dependent).

### B. Handler map (with depth threading)

Since `depth` is threaded through recursion, a handler map needs a slightly different shape:

```ts
type Formatter = (cv: ClarityValue, space: number, depth: number) => string;

const formatters: Record<ClarityType, Formatter> = {
  [ClarityType.BoolTrue]: () => 'true',
  [ClarityType.Int]: cv => (cv as IntCV).value.toString(),
  [ClarityType.List]: (cv, space, depth) => formatList(cv as ListCV, space, depth + 1),
  // ...
};
```

**Expected reduction:** 16 → ~3.

---

## 6. `serializeCVBytes` — complexity 16

**File:** `serialize.ts:163`

**What it does:** Dispatches to per-type serialization functions. This is already the cleanest of the switch-based functions — each case is a one-liner delegating to a named helper (e.g., `serializeBoolCV`, `serializeIntCV`). The helpers are already extracted (lines 39-141).

**Complexity drivers:**
- 15-case switch (lines 164-194). Pure dispatch. No nesting or conditionals within cases.

**Refactoring strategy:**

### Handler map

This is the simplest case for the map pattern because each handler is already a standalone function:

```ts
const serializers: Record<ClarityType, (cv: ClarityValue) => Uint8Array> = {
  [ClarityType.BoolTrue]: serializeBoolCV,
  [ClarityType.BoolFalse]: serializeBoolCV,
  [ClarityType.OptionalNone]: serializeOptionalCV,
  [ClarityType.OptionalSome]: serializeOptionalCV,
  // ...
};

export function serializeCVBytes(value: ClarityValue): Uint8Array {
  const handler = serializers[value.type];
  if (!handler) throw new SerializationError('...');
  return handler(value);
}
```

**Expected reduction:** 16 → ~2.

**Note:** The existing code already has excellent separation of concerns (helpers at lines 39-141). The switch is essentially boilerplate dispatch. This is the lowest-effort, highest-value refactor of the set.

---

## 7. `greedy` (parser anonymous function) — complexity 7

**File:** `parser.ts:120`

**What it does:** A parser combinator that greedily matches a `combinator` zero or more times (with a minimum), optionally separated by a `separator` combinator. Collects captures and reduces them.

**Complexity drivers:**
- Infinite `for` loop with `break` (line 126-141).
- Nested `if` for separator handling (lines 133-141): if a separator is defined, try to match it; if it fails, break.
- Min-count check (line 144).

**Refactoring strategy:**

The complexity here is inherent to the combinator logic, not a dispatch problem. The function is already small (32 lines). Minor improvements:

### A. Split separator matching into a helper

```ts
function matchSeparator(separator: Combinator | undefined, rest: string): 
  { matched: boolean; rest: string; value: string } {
  if (!separator) return { matched: true, rest, value: '' };
  const result = separator(rest);
  if (!result.success) return { matched: false, rest, value: '' };
  return { matched: true, rest: result.rest, value: result.value };
}
```

### B. Use a while(true) with early returns

This would be cosmetic. The complexity is fundamentally ~7 for this kind of loop-with-separator logic.

**Expected reduction:** 7 → ~5 (modest). Not a high priority.

---

## 8. `intCV` — complexity 6

**File:** `values/intCV.ts:35`

**What it does:** Converts various integer representations (number, string, bigint, Uint8Array) into an `IntCV`. Handles two's complement decoding for hex strings and byte arrays, then validates the 128-bit signed range.

**Complexity drivers:**
- Hex-string detection (line 37): `typeof value === 'string' && value.toLowerCase().startsWith('0x')` — 2 branches (short-circuit `&&`).
- `Uint8Array` check (line 42): 1 branch.
- Range validation (lines 45-49): 2 branches (`> MAX_I128`, `< MIN_I128`).

**Refactoring strategy:**

### A. Extract input normalization

This is the same pattern as `deserializeCV` — input coercion before business logic:

```ts
function coerceToSignedBigInt(value: IntegerType): bigint {
  if (typeof value === 'string' && value.toLowerCase().startsWith('0x')) {
    return bytesToTwosBigInt(hexToBytes(value));
  }
  if (isInstance(value, Uint8Array)) return bytesToTwosBigInt(value);
  return intToBigInt(value);
}
```

The main function becomes:

```ts
export const intCV = (value: IntegerType): IntCV => {
  const bigInt = coerceToSignedBigInt(value);
  if (bigInt > MAX_I128) throw new RangeError(...);
  if (bigInt < MIN_I128) throw new RangeError(...);
  return { type: ClarityType.Int, value: bigInt };
};
```

**Expected reduction:** 6 → ~3 (range checks remain). The coercion function would be ~3, but it's independently testable.

**Note:** The same coercion pattern could be shared with `uintCV` (line 71), which currently does not handle hex/Uint8Array inputs — a possible inconsistency worth investigating.

---

## Shared Patterns

### The `ClarityType` dispatch problem

Six of the eight functions (`deserializeCV`, `cvToString`, `cvToValue`, `getCVTypeString`, `prettyPrintWithDepth`, `serializeCVBytes`) share the exact same structural pattern:

1. Accept a `ClarityValue` (or read a discriminator byte).
2. Switch/if-chain over all 15 `ClarityType` variants.
3. Return a type-specific result.

This is the **visitor pattern** in disguise. There are two practical approaches:

#### Option A: Handler maps (recommended)

Replace each switch with a `Record<ClarityType, Handler>`. This:
- Eliminates the switch boilerplate.
- Makes each handler independently testable.
- Keeps the code in a style familiar to TypeScript developers.
- Retains type-safety via `Record` exhaustiveness (missing keys cause compile errors).

A single shared utility can be used:

```ts
function dispatchCV<R>(
  cv: ClarityValue,
  handlers: Record<ClarityType, (cv: any) => R>
): R {
  return handlers[cv.type](cv);
}
```

#### Option B: Method-on-type (not recommended for this codebase)

Clarity values are plain objects (`{ type, value }`), not class instances. Adding methods would require wrapping them in classes — a large breaking change with minimal benefit given that Option A achieves the same complexity reduction.

### Input coercion pattern

Both `deserializeCV` and `intCV` have multi-branch input normalization (string-with-hex-prefix, Uint8Array, native). Extracting these into standalone coercion functions is a small, safe refactor that both reduces complexity and improves reusability.

---

## Prioritization

| Priority | Function | Effort | Impact | Rationale |
|---|---|---|---|---|
| 1 | `serializeCVBytes` | Low | High | Already has extracted helpers; switch is pure boilerplate. 5-minute refactor. |
| 2 | `deserializeCV` | Medium | High | Input coercion + switch. Most benefit from extraction — widely used entry point. |
| 3 | `cvToString` | Low | Medium | Clean switch; `Buffer` case has nested logic worth extracting. |
| 4 | `getCVTypeString` | Low | Medium | Pure transform, straightforward map conversion. |
| 5 | `cvToValue` | Low | Medium | Nearly identical structure to `cvToString`. Refactor together. |
| 6 | `prettyPrintWithDepth` | Low | Medium | If-chain → map. Already uses `exhaustiveCheck` for safety. |
| 7 | `intCV` | Low | Low | Complexity 6 is reasonable; coercion extraction is nice-to-have. |
| 8 | `greedy` (parser) | Low | Low | Complexity is inherent; not dispatch-based. Leave as-is unless parser changes. |

### Recommended execution order

1. **Introduce the shared `dispatchCV` utility** (or just use `Record` maps inline — simpler).
2. **Refactor `serializeCVBytes`** first — it's the easiest win and proves the pattern.
3. **Refactor `deserializeCV`** — extract `toBytesReader` + handler map.
4. **Batch-refactor the three `clarityValue.ts` functions** (`cvToString`, `cvToValue`, `getCVTypeString`) — they live in the same file and share the same structure.
5. **Refactor `prettyPrintWithDepth`** — convert if-chain to map.
6. **Optionally** extract `intCV` coercion if touching that file for other reasons.
7. **Skip `greedy`** unless the parser is being reworked.
