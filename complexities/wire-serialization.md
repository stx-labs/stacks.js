# Wire Serialization Complexity Refactoring Guide

## Summary Table

| Function | File | Line | Cyclomatic Complexity | Primary Driver |
|---|---|---|---|---|
| `addressFromPublicKeys` | `wire/helpers.ts` | 23 | 16 | Validation guards + hash-mode switch |
| `serializeStacksWireBytes` | `wire/serialization.ts` | 82 | 12 | 11-branch `StacksWireType` switch |
| `deserializeStacksWire` | `wire/serialization.ts` | 109 | 12 | 11-branch `StacksWireType` switch + `listType` guard |
| `deserializePayload` | `wire/serialization.ts` | 505 | 12 | 9-branch `PayloadType` switch |
| `deserializeLPList` | `wire/serialization.ts` | 290 | 11 | 7-branch `StacksWireType` switch inside loop |
| `serializePayloadBytes` | `wire/serialization.ts` | 445 | 11 | 9-branch `PayloadType` switch |
| `serializePostConditionWireBytes` | `wire/serialization.ts` | 351 | 7 | 3 `PostConditionType` branches with overlapping conditions |
| `deserializeTransactionAuthField` | `wire/serialization.ts` | 601 | 6 | 4-branch `AuthFieldType` switch + default |
| `deserializePostConditionWire` | `wire/serialization.ts` | 382 | 5 | 3-branch `PostConditionType` switch |
| `serializeTransactionAuthFieldBytes` | `wire/serialization.ts` | 649 | 5 | 2 switch cases x ternary on `PubKeyEncoding` |

---

## Detailed Analysis

### 1. `addressFromPublicKeys` — `wire/helpers.ts:23` (Complexity 16)

**What it does:** Converts an array of public keys into an `AddressWire` by selecting the appropriate hash function based on `AddressHashMode`, after validating key count and compression constraints.

**Complexity drivers:**
- **Validation guards (lines 30-48):** Three separate `if` blocks check `publicKeys.length === 0`, then `P2PKH || P2WPKH` requiring exactly 1 key/sig, then `P2WPKH || P2WSH || P2WSHNonSequential` requiring compressed keys. Each `if` and each `||` adds a branch.
- **Hash-mode switch (lines 50-67):** 6 cases across 4 effective branches (`P2PKH`, `P2WPKH`, `P2SH`/`P2SHNonSequential`, `P2WSH`/`P2WSHNonSequential`).

**Refactoring strategies:**

1. **Extract validation into a guard function.** Move lines 30-48 into `validatePublicKeysForHashMode(hashMode, publicKeys, numSigs)`. This isolates ~8 complexity points into a dedicated validator.
   - Expected reduction: from 16 to ~8 in `addressFromPublicKeys`, new function at ~8.

2. **Use a lookup map for hash computation.** Replace the switch with a `Record<AddressHashMode, (keys: PublicKeyWire[], numSigs: number) => string>` map:
   ```ts
   const hashers: Record<AddressHashMode, ...> = {
     [AddressHashMode.P2PKH]: (keys) => hashP2PKH(keys[0].data),
     [AddressHashMode.P2WPKH]: (keys) => hashP2WPKH(keys[0].data),
     [AddressHashMode.P2SH]: (keys, n) => hashP2SH(n, keys.map(serializePublicKeyBytes)),
     [AddressHashMode.P2SHNonSequential]: (keys, n) => hashP2SH(n, keys.map(serializePublicKeyBytes)),
     [AddressHashMode.P2WSH]: (keys, n) => hashP2WSH(n, keys.map(serializePublicKeyBytes)),
     [AddressHashMode.P2WSHNonSequential]: (keys, n) => hashP2WSH(n, keys.map(serializePublicKeyBytes)),
   };
   ```
   - Expected reduction: switch contributes ~5; map reduces to ~1. Combined with extraction, target ~3.

---

### 2. `serializeStacksWireBytes` — `wire/serialization.ts:82` (Complexity 12)

**What it does:** Dispatches serialization of any `StacksWire` union member to the appropriate type-specific serializer based on `wire.type`.

**Complexity drivers:**
- A single `switch` with 11 cases over `StacksWireType` (`Address`, `Principal`, `LengthPrefixedString`, `MemoString`, `Asset`, `PostCondition`, `PublicKey`, `LengthPrefixedList`, `Payload`, `TransactionAuthField`, `MessageSignature`). Each case is a trivial delegation — zero logic per branch.

**Refactoring strategies:**

1. **Dispatch map.** Replace the switch with a `Record<StacksWireType, (wire: StacksWire) => Uint8Array>`:
   ```ts
   const serializers: Record<StacksWireType, (wire: any) => Uint8Array> = {
     [StacksWireType.Address]: serializeAddressBytes,
     [StacksWireType.Principal]: serializePrincipalBytes,
     // ... etc
   };
   export function serializeStacksWireBytes(wire: StacksWire): Uint8Array {
     return serializers[wire.type](wire);
   }
   ```
   - Expected reduction: 12 → 1. The map is static data, not branches.

---

### 3. `deserializeStacksWire` — `wire/serialization.ts:109` (Complexity 12)

**What it does:** Dispatches deserialization of a byte stream to the appropriate type-specific deserializer based on a `StacksWireType` discriminant passed as a parameter.

**Complexity drivers:**
- 10-case switch on `StacksWireType` (lines 114-140), plus an `if (!listType)` guard on line 132, plus a `default` throw.

**Refactoring strategies:**

1. **Dispatch map** (same pattern as `serializeStacksWireBytes`):
   ```ts
   const deserializers: Record<StacksWireType, (reader: BytesReader, listType?: StacksWireType) => StacksWire> = { ... };
   ```
   The `LengthPrefixedList` entry would need the `listType` guard internally, but the other 9 entries are trivial.
   - Expected reduction: 12 → ~2 (map lookup + listType guard).

---

### 4. `deserializePayload` — `wire/serialization.ts:505` (Complexity 12)

**What it does:** Reads the payload type discriminant byte, then deserializes the remainder of the byte stream according to the specific payload format (TokenTransfer, ContractCall, SmartContract, etc.).

**Complexity drivers:**
- 9-case switch on `PayloadType` (lines 513-585). Each case contains meaningful deserialization logic (field reads, loops), not just delegation.
- The `ContractCall` case (line 519) includes a `for` loop to read `numberOfArgs` clarity values, adding +1.
- `BytesReader` input coercion at line 506-508 adds +1.

**Refactoring strategies:**

1. **Extract each case into a named deserializer function.** For example:
   - `deserializeTokenTransferPayload(reader: BytesReader)` — lines 514-518
   - `deserializeContractCallPayload(reader: BytesReader)` — lines 519-534
   - `deserializeTenureChangePayload(reader: BytesReader)` — lines 566-584
   
   Then use a dispatch map:
   ```ts
   const payloadDeserializers: Record<PayloadType, (r: BytesReader) => PayloadWire> = { ... };
   ```
   - Expected reduction: 12 → 2 in `deserializePayload`. Individual functions each at 1-2.

2. **Extract BytesReader coercion.** The `isInstance(serialized, BytesReader) ? serialized : new BytesReader(serialized)` pattern appears in nearly every deserialize function. A shared `ensureBytesReader(input)` helper would remove this repeated branch.

---

### 5. `deserializeLPList` — `wire/serialization.ts:290` (Complexity 11)

**What it does:** Reads a length-prefixed list of homogeneous `StacksWire` items from a byte stream. The `type` parameter determines which deserializer is called per element.

**Complexity drivers:**
- 7-case switch inside a `for` loop (lines 320-342). The switch dispatches to the correct element deserializer on every iteration, but the type is invariant across the loop.
- Complex generic type mapping (lines 290-306) adds no runtime complexity but hurts readability.
- BytesReader coercion adds +1.

**Refactoring strategies:**

1. **Resolve the deserializer once before the loop.** The `type` parameter is constant — the switch should run once to select a function, then the loop calls that function:
   ```ts
   const deserializer = elementDeserializers[type]; // lookup map
   if (!deserializer) throw ...;
   for (let i = 0; i < length; i++) {
     l.push(deserializer(bytesReader));
   }
   ```
   This is both a performance improvement (avoids re-evaluating the switch on each iteration) and a complexity reduction.
   - Expected reduction: 11 → ~2 (map lookup + loop).

---

### 6. `serializePayloadBytes` — `wire/serialization.ts:445` (Complexity 11)

**What it does:** Serializes a `PayloadInput` union to bytes by switching on `payloadType` and encoding the appropriate fields.

**Complexity drivers:**
- 9-case switch on `PayloadType` (lines 449-499). Same as `deserializePayload`, each case has type-specific field encoding.

**Refactoring strategies:**

1. **Extract per-type serializer functions** and use a dispatch map, mirroring the approach for `deserializePayload`:
   ```ts
   const payloadSerializers: Record<PayloadType, (p: PayloadInput) => Uint8Array[]> = { ... };
   ```
   - Expected reduction: 11 → 1 in `serializePayloadBytes`. Individual functions each at 1-2.

---

### 7. `serializePostConditionWireBytes` — `wire/serialization.ts:351` (Complexity 7)

**What it does:** Serializes a `PostConditionWire` to bytes, with conditional fields depending on whether the post-condition is STX, Fungible, or NonFungible.

**Complexity drivers:**
- Three `if` checks using `||` operators to test overlapping `conditionType` values:
  - Line 357: `Fungible || NonFungible` → serialize asset
  - Line 363: `NonFungible` → serialize asset name CV
  - Line 370: `STX || Fungible` → serialize amount
- Amount overflow guard at line 374 adds +1.

**Refactoring strategies:**

1. **Switch on `conditionType` with three distinct branches.** Each branch serializes exactly the fields needed, eliminating overlapping `if`s:
   ```ts
   switch (postCondition.conditionType) {
     case PostConditionType.STX:
       bytesArray.push(postCondition.conditionCode);
       bytesArray.push(intToBytes(postCondition.amount, 8));
       break;
     case PostConditionType.Fungible:
       bytesArray.push(serializeAssetBytes(postCondition.asset));
       bytesArray.push(postCondition.conditionCode);
       bytesArray.push(intToBytes(postCondition.amount, 8));
       break;
     case PostConditionType.NonFungible:
       bytesArray.push(serializeAssetBytes(postCondition.asset));
       bytesArray.push(serializeCVBytes(postCondition.assetName));
       bytesArray.push(postCondition.conditionCode);
       break;
   }
   ```
   Trades a small amount of duplication for clarity and removes the overlapping conditionals.
   - Expected reduction: 7 → 4.

---

### 8. `deserializeTransactionAuthField` — `wire/serialization.ts:601` (Complexity 6)

**What it does:** Reads an auth field type byte and deserializes either a public key or message signature, tagging it with compressed/uncompressed encoding.

**Complexity drivers:**
- 4-case switch on `AuthFieldType` (lines 611-634) + `default` throw + BytesReader coercion.

**Refactoring strategies:**

1. **Collapse into two branches.** The four `AuthFieldType` values form a 2x2 matrix of `(PublicKey|Signature) x (Compressed|Uncompressed)`. Factor out the encoding and content type:
   ```ts
   const encoding = (authFieldType === AuthFieldType.PublicKeyCompressed || authFieldType === AuthFieldType.SignatureCompressed)
     ? PubKeyEncoding.Compressed : PubKeyEncoding.Uncompressed;
   const isKey = (authFieldType === AuthFieldType.PublicKeyCompressed || authFieldType === AuthFieldType.PublicKeyUncompressed);
   const contents = isKey ? /* deserialize key */ : /* deserialize sig */;
   return createTransactionAuthField(encoding, contents);
   ```
   - Expected reduction: 6 → 3.

---

### 9. `deserializePostConditionWire` — `wire/serialization.ts:382` (Complexity 5)

**What it does:** Reads a post-condition type byte and deserializes the appropriate fields (principal, optional asset, condition code, optional amount).

**Complexity drivers:**
- 3-case switch on `PostConditionType` (lines 397-438) + BytesReader coercion.

**Refactoring strategies:**

1. **Minimal — already fairly clean.** The complexity is inherent to the protocol's three post-condition types. Could extract BytesReader coercion to reduce by 1. Otherwise, this is near-minimal for the domain logic.
   - Expected reduction: 5 → 4 (BytesReader extraction only).

---

### 10. `serializeTransactionAuthFieldBytes` — `wire/serialization.ts:649` (Complexity 5)

**What it does:** Serializes a `TransactionAuthFieldWire` to bytes, choosing the auth field type byte based on the combination of `contents.type` (PublicKey vs MessageSignature) and `pubKeyEncoding` (Compressed vs Uncompressed).

**Complexity drivers:**
- 2-case switch on `contents.type` (lines 652-669), each containing a ternary on `pubKeyEncoding`. This is the same 2x2 matrix as `deserializeTransactionAuthField`.

**Refactoring strategies:**

1. **Lookup map for the type byte:**
   ```ts
   const authFieldTypeMap = {
     [`${StacksWireType.PublicKey}:${PubKeyEncoding.Compressed}`]: AuthFieldType.PublicKeyCompressed,
     // ... 3 more entries
   };
   const key = `${field.contents.type}:${field.pubKeyEncoding}`;
   bytesArray.push(authFieldTypeMap[key]);
   ```
   Then a single branch for serializing the content (key data vs signature).
   - Expected reduction: 5 → 2.

---

## Cross-Cutting Concerns

### BytesReader Coercion (affects 8+ functions)

The pattern at the top of nearly every `deserialize*` function:
```ts
const bytesReader = isInstance(serialized, BytesReader) ? serialized : new BytesReader(serialized);
```
This appears in `deserializeAddress` (line 154), `deserializePrincipal` (line 184), `deserializeLPString` (line 224), `deserializeMemoString` (line 247), `deserializeAsset` (line 267), `deserializeLPList` (line 313), `deserializePostConditionWire` (line 385), `deserializePayload` (line 506), `deserializeTransactionAuthField` (line 604), `deserializeMessageSignature` (line 592).

**Strategy:** Extract to `function ensureBytesReader(input: string | Uint8Array | BytesReader): BytesReader`. Removes 1 complexity point from each function — a net reduction of ~10 across the file.

### `deserializeLPList` Performance Issue

The type switch inside the loop (lines 320-342) re-evaluates the invariant `type` discriminant on every iteration. This is a minor performance concern for large lists and a major readability/complexity concern. Resolving the deserializer function once before the loop is the single highest-impact change in this file.

---

## Prioritization

| Priority | Function | Current | Target | Effort | Impact |
|---|---|---|---|---|---|
| **1** | `deserializeLPList` | 11 | 2 | Low | High — also fixes perf issue |
| **2** | `serializeStacksWireBytes` | 12 | 1 | Low | High — trivial dispatch map |
| **3** | `deserializeStacksWire` | 12 | 2 | Low | High — trivial dispatch map |
| **4** | `deserializePayload` | 12 | 2 | Medium | High — extract 9 small functions |
| **5** | `serializePayloadBytes` | 11 | 1 | Medium | High — mirrors #4 |
| **6** | `addressFromPublicKeys` | 16 | 3 | Medium | Medium — extract validation + map |
| **7** | `serializePostConditionWireBytes` | 7 | 4 | Low | Low |
| **8** | `deserializeTransactionAuthField` | 6 | 3 | Low | Low |
| **9** | `serializeTransactionAuthFieldBytes` | 5 | 2 | Low | Low |
| **10** | `deserializePostConditionWire` | 5 | 4 | Low | Low |
| **X** | BytesReader coercion (cross-cutting) | — | — | Low | Medium — -1 in ~10 functions |

Items 1-3 are low-effort, high-impact wins that can be done independently. Items 4-5 are larger but share the same pattern (extract per-type functions + dispatch map). The BytesReader extraction (X) should be done first as a preparatory step since it simplifies all deserializer signatures.
