# Refactoring Guide: `packages/transactions/src/contract-abi.ts`

## Summary Table

| Function | Line | Cyclomatic Complexity | Primary Driver |
|---|---|---|---|
| `matchType` | 289 | 30 | 15-arm switch + nested conditionals & recursion in Tuple/List |
| `encodeAbiClarityValue` | 151 | 20 | 13-arm switch + nested conditionals in Bool/Principal cases |
| `getTypeUnion` | 107 | 15 | 6-way if/else-if for primitives + 6-way if/else-if for compound types |
| `parseToCV` | 431 | 15 | 4-way primitive if/else-if + 4 unsupported-type branches that all throw identically |
| `getTypeString` | 214 | 11 | 8-way if/else-if chain mirroring type guard checks |
| `validateContractCall` | 384 | 6 | 3-way branch on ABI lookup + loop with early return |

---

## Detailed Analysis

### 1. `matchType` (line 289, complexity 30)

**What it does:** Checks whether a runtime `ClarityValue` is type-compatible with a `ClarityAbiType` from a contract ABI. Used exclusively by `validateContractCall` (line 400).

**Complexity drivers:**
- A 15-case `switch` on `cv.type` (lines 292-373), where most arms also test `union.id`.
- The `ClarityType.Tuple` arm (lines 349-370) contains a nested `for` loop with two conditionals and a mutation (`delete tuple[key]`).
- The `ClarityType.List` arm (line 343) calls `.every()` with recursive `matchType`.
- `OptionalSome`, `ResponseErr`, `ResponseOk` arms each recurse into `matchType`.

**Refactoring strategies:**

**A. Lookup table for simple type-id matches (eliminates ~8 switch arms)**

Most arms simply compare `union.id` to a constant. Extract these into a `Map`:

```ts
const CLARITY_TYPE_TO_ABI_ID: ReadonlyMap<ClarityType, ClarityAbiTypeId[]> = new Map([
  [ClarityType.BoolTrue, [ClarityAbiTypeId.ClarityAbiTypeBool]],
  [ClarityType.BoolFalse, [ClarityAbiTypeId.ClarityAbiTypeBool]],
  [ClarityType.Int, [ClarityAbiTypeId.ClarityAbiTypeInt128]],
  [ClarityType.UInt, [ClarityAbiTypeId.ClarityAbiTypeUInt128]],
  [ClarityType.PrincipalStandard, [ClarityAbiTypeId.ClarityAbiTypePrincipal]],
  [ClarityType.PrincipalContract, [
    ClarityAbiTypeId.ClarityAbiTypePrincipal,
    ClarityAbiTypeId.ClarityAbiTypeTraitReference,
  ]],
  [ClarityType.OptionalNone, [
    ClarityAbiTypeId.ClarityAbiTypeNone,
    ClarityAbiTypeId.ClarityAbiTypeOptional,
  ]],
]);
```

Then `matchType` checks the map first. If it finds an entry, it returns `allowedIds.includes(union.id)`. The remaining switch handles only Buffer, StringASCII, StringUTF8, OptionalSome, ResponseOk, ResponseErr, List, and Tuple -- the arms that need actual logic.

**B. Extract `matchTuple` helper (eliminates nested loop + mutation)**

The Tuple arm (lines 349-370) does a destructive clone-and-delete loop. Pull it out:

```ts
function matchTuple(
  tupleData: Record<string, ClarityValue>,
  abiTupleFields: { name: string; type: ClarityAbiType }[]
): boolean {
  if (Object.keys(tupleData).length !== abiTupleFields.length) return false;
  return abiTupleFields.every(field => {
    const val = tupleData[field.name];
    return val !== undefined && matchType(val, field.type);
  });
}
```

This also eliminates the `cloneDeep` call (line 350), which is only needed because the current code mutates via `delete`. The extracted version avoids mutation entirely.

**Expected reduction:** ~30 down to ~12-14. The map absorbs 8 trivial arms; the tuple helper removes 4-5 branch points.

---

### 2. `encodeAbiClarityValue` (line 151, complexity 20)

**What it does:** Converts a raw `string` value into a typed `ClarityValue` based on an ABI type descriptor. Used by the deprecated `encodeClarityValue` (line 211) and recursively for optionals (line 186).

**Complexity drivers:**
- 13-arm `switch` on `union.id` (lines 158-193).
- The `Bool` case (lines 164-166) has an inner 3-way conditional.
- The `Principal` case (lines 168-173) has a `.includes('.')` branch.
- Three cases (`Response`, `Tuple`, `List`) just throw `NotImplementedError`.

**Refactoring strategies:**

**A. Lookup table for direct-mapping cases**

Eight arms are trivial one-liners (uint, int, none, buffer, string-ascii, string-utf8, trait-reference, optional). Map them:

```ts
const ABI_ENCODERS: Partial<Record<ClarityAbiTypeId, (value: string, union: ClarityAbiTypeUnion) => ClarityValue>> = {
  [ClarityAbiTypeId.ClarityAbiTypeUInt128]: v => uintCV(v),
  [ClarityAbiTypeId.ClarityAbiTypeInt128]: v => intCV(v),
  [ClarityAbiTypeId.ClarityAbiTypeNone]: () => noneCV(),
  [ClarityAbiTypeId.ClarityAbiTypeBuffer]: v => bufferCV(hexToBytes(v)),
  [ClarityAbiTypeId.ClarityAbiTypeStringAscii]: v => stringAsciiCV(v),
  [ClarityAbiTypeId.ClarityAbiTypeStringUtf8]: v => stringUtf8CV(v),
  [ClarityAbiTypeId.ClarityAbiTypeOptional]: (v, u) =>
    someCV(encodeAbiClarityValue(v, (u.type as ClarityAbiTypeOptional).optional)),
};
```

Then `encodeAbiClarityValue` does: look up encoder, call it if found, else handle `Bool`/`Principal`/unsupported in a small switch.

**B. Extract `parseBool` and `parsePrincipal` helpers**

These are reusable (they appear again in `parseToCV` lines 438-452):

```ts
function parseClarityBool(value: string): ClarityValue { ... }
function parseClarityPrincipal(value: string): ClarityValue { ... }
```

This also de-duplicates logic shared with `parseToCV`.

**Expected reduction:** ~20 down to ~6-8.

---

### 3. `getTypeUnion` (line 107, complexity 15)

**What it does:** Converts a `ClarityAbiType` (a discriminated union using structural shape) into a `ClarityAbiTypeUnion` (a discriminated union using an `id` enum). Called by `matchType`, `encodeAbiClarityValue`, and `encodeClarityValue`.

**Complexity drivers:**
- An outer if/else-if chain with 8 branches for compound types (lines 124-138), each using a type-guard function.
- An inner if/else-if chain with 6 branches for primitive string literals (lines 109-123).

**Refactoring strategies:**

**A. Primitive lookup table**

Replace the 6-way inner chain with a `Record`:

```ts
const PRIMITIVE_TO_UNION: Record<ClarityAbiTypePrimitive, ClarityAbiTypeId> = {
  uint128: ClarityAbiTypeId.ClarityAbiTypeUInt128,
  int128: ClarityAbiTypeId.ClarityAbiTypeInt128,
  bool: ClarityAbiTypeId.ClarityAbiTypeBool,
  principal: ClarityAbiTypeId.ClarityAbiTypePrincipal,
  trait_reference: ClarityAbiTypeId.ClarityAbiTypeTraitReference,
  none: ClarityAbiTypeId.ClarityAbiTypeNone,
};

if (isClarityAbiPrimitive(val)) {
  const id = PRIMITIVE_TO_UNION[val];
  if (!id) throw new Error(`Unexpected Clarity ABI type primitive: ${JSON.stringify(val)}`);
  return { id, type: val } as ClarityAbiTypeUnion;
}
```

**B. Compound type guard array**

Replace the 8-arm else-if chain with an array of `[guard, id]` pairs:

```ts
const COMPOUND_GUARDS: [guard: (v: ClarityAbiType) => boolean, id: ClarityAbiTypeId][] = [
  [isClarityAbiBuffer, ClarityAbiTypeId.ClarityAbiTypeBuffer],
  [isClarityAbiResponse, ClarityAbiTypeId.ClarityAbiTypeResponse],
  // ...etc
];

for (const [guard, id] of COMPOUND_GUARDS) {
  if (guard(val)) return { id, type: val } as ClarityAbiTypeUnion;
}
throw new Error(`Unexpected Clarity ABI type: ${JSON.stringify(val)}`);
```

**Expected reduction:** ~15 down to ~3-4.

---

### 4. `parseToCV` (line 431, complexity 15)

**What it does:** Converts a string input into a `ClarityValue` for contract function calls. Only supports primitives and buffers -- response, optional, tuple, and list all throw.

**Complexity drivers:**
- 4-way if/else-if for primitives (lines 434-455), with nested branches in `bool` and `principal`.
- 4 else-if arms (lines 462-471) that all throw the exact same error message template -- pure boilerplate complexity.

**Refactoring strategies:**

**A. Collapse identical throw branches**

Lines 462-471 are four separate `else if` branches that all throw `unsupported Clarity ABI type`. Replace with a single fallthrough:

```ts
if (isClarityAbiPrimitive(type)) {
  // ...handle primitives...
} else if (isClarityAbiBuffer(type)) {
  // ...handle buffer...
} else {
  throw new Error(`Contract function contains unsupported Clarity ABI type: ${typeString}`);
}
```

This cuts 4 branches to 1 with zero behavior change.

**B. Reuse shared helpers from `encodeAbiClarityValue`**

The `bool` logic (lines 438-445) and `principal` logic (lines 447-452) are near-duplicates of `encodeAbiClarityValue` lines 164-173. Extract `parseClarityBool` and `parseClarityPrincipal` as described above.

**Expected reduction:** ~15 down to ~6-7.

---

### 5. `getTypeString` (line 214, complexity 11)

**What it does:** Converts a `ClarityAbiType` into its Clarity syntax string representation (e.g., `int128` becomes `"int"`, a buffer becomes `"(buff 32)"`). Used in error messages and `abiFunctionToString`.

**Complexity drivers:**
- 8-way if/else-if chain (lines 215-238) mirroring type guards, with 2 inner branches for `int128`/`uint128` renaming.

**Refactoring strategies:**

**A. Primitive rename map + compound type formatter map**

```ts
const PRIMITIVE_NAMES: Partial<Record<string, string>> = {
  int128: 'int',
  uint128: 'uint',
};

if (isClarityAbiPrimitive(val)) return PRIMITIVE_NAMES[val] ?? val;
```

For compound types, use a similar pattern to `getTypeUnion` with guard/formatter pairs. However, the recursive calls for response, optional, tuple, and list mean a fully table-driven approach still needs functions as values. The benefit is modest here.

**Expected reduction:** ~11 down to ~7-8. The recursion in compound types limits how much can be flattened.

---

### 6. `validateContractCall` (line 384, complexity 6)

**What it does:** Looks up a function in the ABI by name, validates argument count and types against the payload's `functionArgs`. Called from `builders.ts:485`.

**Complexity drivers:**
- 3-way branch on `filtered.length` (0, 1, >1) at lines 386/413/415.
- Inner loop with `matchType` call at line 400.

**Refactoring strategies:**

This function is already well-structured at complexity 6. The only meaningful change would be an early-return guard clause pattern:

```ts
if (filtered.length === 0) throw new Error(`ABI doesn't contain...`);
if (filtered.length > 1) throw new Error(`Malformed ABI...`);
const abiFunc = filtered[0];
// ...rest of validation
```

This eliminates nesting but does not change complexity. **No significant refactoring needed.**

**Expected reduction:** 6 down to ~5 (negligible).

---

## Prioritization

| Priority | Function | Effort | Impact | Rationale |
|---|---|---|---|---|
| **1** | `matchType` | Medium | High | Highest complexity (30). Lookup table + `matchTuple` extraction are straightforward. Removing `cloneDeep` mutation is a correctness win. |
| **2** | `getTypeUnion` | Low | High | Simple mechanical replacement of if/else chains with lookup tables. Used by `matchType` and `encodeAbiClarityValue`, so cleaning it up benefits both callers. |
| **3** | `encodeAbiClarityValue` | Medium | Medium | Complexity 20, but much of it is the switch which is already cleaner than if/else. Extracting `parseClarityBool`/`parseClarityPrincipal` de-duplicates with `parseToCV`. |
| **4** | `parseToCV` | Low | Medium | Collapsing 4 identical throw branches is a trivial win. Reusing helpers from step 3 handles the rest. |
| **5** | `getTypeString` | Low | Low | Complexity 11 is moderate. Primitive rename map is easy; compound types have inherent recursion. |
| **6** | `validateContractCall` | Skip | None | Already clean at complexity 6. |

### Cross-cutting opportunity

All six functions share the same structural pattern: branching over the ~13 Clarity ABI type variants using either if/else-if chains with type guards or switch statements on `ClarityAbiTypeId`. A single "visitor" or "type-map" abstraction could serve all of them:

```ts
type ClarityAbiTypeVisitor<T> = {
  uint128: (type: ClarityAbiTypeUInt128) => T;
  int128: (type: ClarityAbiTypeInt128) => T;
  bool: (type: ClarityAbiTypeBool) => T;
  // ...all 13 variants
};

function visitClarityAbiType<T>(type: ClarityAbiType, visitor: ClarityAbiTypeVisitor<T>): T { ... }
```

This would let `getTypeString`, `getTypeUnion`, `encodeAbiClarityValue`, `matchType`, and `parseToCV` each declare a flat object of handlers instead of a branching control structure. This is the highest-leverage refactor if you plan to touch multiple functions.

### Notes

- **`matchType` line 303:** `cv.value.length / 2` suggests the buffer value is hex-encoded at this point (each byte = 2 hex chars). The `Math.ceil` handles odd-length hex strings, but an odd-length hex string is itself suspicious -- it may indicate a malformed input that should be rejected rather than silently rounded up.
- **`matchType` line 344:** Uses `==` (loose equality) instead of `===` for `union.id == ClarityAbiTypeId.ClarityAbiTypeList`. Same on line 349 for Tuple. Both compare numbers, so it works, but it is inconsistent with `===` used in every other arm.
- **`matchType` lines 350-363:** The `cloneDeep` + `delete` pattern is used to detect extra keys in the tuple, but the loop never actually checks for leftover keys after iteration. If the CV tuple has *more* keys than the ABI tuple, the function returns `true` anyway. This may be intentional (permissive matching) or a bug.
- **`parseToCV` vs `encodeAbiClarityValue`:** These two functions have heavily overlapping responsibilities. `parseToCV` uses `bufferCVFromString` (UTF-8 encoding, line 461) while `encodeAbiClarityValue` uses `bufferCV(hexToBytes(value))` (hex decoding, line 180). The deprecated `encodeClarityValue` (line 207) specifically patches the buffer case to use `utf8ToBytes`. This triple-encoding situation for buffers is a maintenance hazard.
