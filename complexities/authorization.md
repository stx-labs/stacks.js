# Refactoring Guide: `authorization.ts` High-Complexity Functions

## Summary

| Function | Line | Cyclomatic Complexity | Primary Drivers |
|---|---|---|---|
| `verifyMultiSig` | 502 | 16 | Loop with switch-case, multiple post-loop compound conditionals |
| `deserializeMultiSigSpendingCondition` | 286 | 10 | Loop with switch-case, post-loop compound conditional |

---

## 1. `verifyMultiSig` (complexity 16, line 502)

### What it does

Verifies a multi-signature spending condition by iterating over `condition.fields`, recovering public keys from signatures (via `nextVerification`), accumulating them, and then validating: (a) correct number of signatures for the hash mode, (b) no uncompressed keys in segwit hash modes, and (c) the derived address matches `condition.signer`.

### Complexity drivers

1. **`for` loop over `condition.fields`** (line 512) — +1 for the loop itself.
2. **`switch` on `field.contents.type`** (line 513) — two `case` branches (`PublicKey`, `MessageSignature`), each adding a path.
3. **Inside `PublicKey` case**: conditional on `publicKeyIsCompressed` (line 515) — +1.
4. **Inside `MessageSignature` case**: conditional on `pubKeyEncoding === Uncompressed` (line 519) — +1; conditional on `isSequentialMultiSig` (line 529) — +1; guard `numSigs === 65536` (line 536) — +1.
5. **Post-loop compound conditional** for signature count validation (lines 541-544): an `||` joining two `&&` sub-expressions — the `||` and each `&&` each contribute, totaling +3 decision points.
6. **Post-loop compound conditional** for uncompressed-key / hash-mode check (lines 547-551): `haveUncompressed && (P2WSH || P2WSHNonSequential)` — +2 decision points.
7. **Final address mismatch guard** (line 560) — +1.

The loop body does double duty: it both classifies fields and accumulates verification state (`curSigHash`, `publicKeys`, `haveUncompressed`, `numSigs`). This conflation is the core structural issue.

### Refactoring strategies

#### Strategy A — Extract field-processing into a dedicated reducer

Pull the loop body into a pure function that processes a single field and returns updated accumulator state. This isolates the switch/case complexity and makes each case independently testable.

```ts
interface FieldAccumulator {
  publicKeys: PublicKeyWire[];
  curSigHash: string;
  haveUncompressed: boolean;
  numSigs: number;
}

function processAuthField(
  acc: FieldAccumulator,
  field: TransactionAuthFieldWire,
  condition: MultiSigSpendingConditionOpts,
  authType: AuthType
): FieldAccumulator {
  switch (field.contents.type) {
    case StacksWireType.PublicKey:
      return {
        ...acc,
        haveUncompressed: acc.haveUncompressed || !publicKeyIsCompressed(field.contents.data),
        publicKeys: [...acc.publicKeys, field.contents],
      };
    case StacksWireType.MessageSignature: {
      const newNumSigs = acc.numSigs + 1;
      if (newNumSigs === 65536) throw new VerificationError('Too many signatures');
      const { pubKey, nextSigHash } = nextVerification(
        acc.curSigHash, authType, condition.fee, condition.nonce,
        field.pubKeyEncoding, field.contents.data
      );
      return {
        publicKeys: [...acc.publicKeys, pubKey],
        curSigHash: isSequentialMultiSig(condition.hashMode) ? nextSigHash : acc.curSigHash,
        haveUncompressed: acc.haveUncompressed || field.pubKeyEncoding === PubKeyEncoding.Uncompressed,
        numSigs: newNumSigs,
      };
    }
    default:
      return acc;
  }
}
```

This removes the loop, switch, and three inner conditionals from `verifyMultiSig`, reducing it by ~7.

#### Strategy B — Extract validation guards into named predicate helpers

The two compound post-loop conditionals (lines 541-551) can become descriptively-named helpers:

```ts
function assertSignatureCount(
  hashMode: AddressHashMode,
  numSigs: number,
  required: number
): void {
  if (isSequentialMultiSig(hashMode) && numSigs !== required)
    throw new VerificationError('Incorrect number of signatures');
  if (isNonSequentialMultiSig(hashMode) && numSigs < required)
    throw new VerificationError('Incorrect number of signatures');
}

function assertNoUncompressedInSegwit(
  haveUncompressed: boolean,
  hashMode: AddressHashMode
): void {
  if (haveUncompressed && isSegwitHashMode(hashMode))
    throw new VerificationError('Uncompressed keys are not allowed in this hash mode');
}
```

Where `isSegwitHashMode` replaces the inline `P2WSH || P2WSHNonSequential` check (which is duplicated at line 322 in `deserializeMultiSigSpendingCondition`).

This removes ~5 decision points from `verifyMultiSig`.

#### Expected complexity after both strategies

`verifyMultiSig` itself would call `reduce`, `assertSignatureCount`, `assertNoUncompressedInSegwit`, and the address check — roughly complexity **3-4**. The extracted `processAuthField` would hold complexity ~6 but is independently testable.

---

## 2. `deserializeMultiSigSpendingCondition` (complexity 10, line 286)

### What it does

Reads a multi-sig spending condition from a `BytesReader`: parses the signer, nonce, fee, and auth fields list, then validates that the deserialized fields are consistent with the hash mode (no uncompressed keys in segwit modes).

### Complexity drivers

1. **`for` loop over `fields`** (line 300) — +1.
2. **`switch` on `field.contents.type`** (line 301) — two `case` branches, +2.
3. **Inside `PublicKey` case**: conditional on `publicKeyIsCompressed` (line 303) — +1.
4. **Inside `MessageSignature` case**: conditional on `pubKeyEncoding` (line 306) — +1; guard `numSigs === 65536` (line 308) — +1.
5. **Post-loop compound conditional** (lines 320-324): `haveUncompressed && (P2WSH || P2WSHNonSequential)` — +2 decision points.

### Refactoring strategies

#### Strategy A — Reuse the field-scanning logic from `verifyMultiSig`

The loop at lines 300-314 does *almost exactly* the same thing as the loop in `verifyMultiSig` (lines 512-538), minus the signature verification / `curSigHash` tracking. Both scan fields to count signatures and detect uncompressed keys.

Extract a shared helper:

```ts
interface FieldScanResult {
  haveUncompressed: boolean;
  numSigs: number;
}

function scanAuthFields(fields: TransactionAuthFieldWire[]): FieldScanResult {
  let haveUncompressed = false;
  let numSigs = 0;
  for (const field of fields) {
    switch (field.contents.type) {
      case StacksWireType.PublicKey:
        if (!publicKeyIsCompressed(field.contents.data)) haveUncompressed = true;
        break;
      case StacksWireType.MessageSignature:
        if (field.pubKeyEncoding === PubKeyEncoding.Uncompressed) haveUncompressed = true;
        numSigs += 1;
        if (numSigs === 65536)
          throw new VerificationError('Failed to parse multisig spending condition: too many signatures');
        break;
    }
  }
  return { haveUncompressed, numSigs };
}
```

`deserializeMultiSigSpendingCondition` becomes:

```ts
const { haveUncompressed, numSigs } = scanAuthFields(fields);
const signaturesRequired = bytesReader.readUInt16BE();
assertNoUncompressedInSegwit(haveUncompressed, hashMode);
```

This reduces `deserializeMultiSigSpendingCondition` to complexity **~2** (the function itself plus the conditional now hidden in the helper).

#### Strategy B — Extract `isSegwitHashMode` to eliminate the duplicated compound check

The condition `hashMode === P2WSH || hashMode === P2WSHNonSequential` appears at both line 322 and line 549. A single `isSegwitHashMode(hashMode)` helper eliminates this duplication and reduces each call site by one decision point.

#### Expected complexity after refactoring

`deserializeMultiSigSpendingCondition` drops to **~2**. The shared `scanAuthFields` holds complexity ~6 but is reusable.

---

## 3. Prioritization

| Priority | Action | Impact | Effort |
|---|---|---|---|
| **1** | Extract `scanAuthFields` shared helper | Eliminates duplication between `verifyMultiSig` (line 512-538) and `deserializeMultiSigSpendingCondition` (line 300-314). Reduces complexity of both functions. | Low |
| **2** | Extract `isSegwitHashMode` predicate | Eliminates the duplicated compound `P2WSH \|\| P2WSHNonSequential` check at lines 322 and 549. Single decision point per call site. | Trivial |
| **3** | Extract `assertSignatureCount` and `assertNoUncompressedInSegwit` guard functions | Moves two validation blocks out of `verifyMultiSig`, each with 2-3 decision points. Both are self-documenting. | Low |
| **4** | Extract `processAuthField` reducer (Strategy A for `verifyMultiSig`) | Largest single complexity reduction (~7 points). The reducer is independently unit-testable. Worth doing only after priorities 1-3, since the shared `scanAuthFields` covers the read-only scanning path. | Medium |

### Notes

- The `65536` signature cap check appears identically at line 308 and line 536. After extracting `scanAuthFields`, it lives in one place. In `verifyMultiSig`, the check remains in the reducer since it also collects `pubKey` / `curSigHash`. Consider whether the cap should be a named constant (`MAX_MULTISIG_SIGNATURES = 65536`).
- The `0 as any` cast at line 555 (and similarly at line 488 in `verifySingleSig`) is a minor code smell — the address version is irrelevant for hash160 generation but the cast obscures this. A comment exists but a dedicated type or overload would be cleaner.
- The `TransactionAuthFieldWire` interface is declared twice in `wire/types.ts` (lines 275 and 284) with identical shapes. This is harmless due to TypeScript declaration merging but is confusing.
