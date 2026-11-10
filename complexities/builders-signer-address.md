# Refactoring Guide: High-Complexity Functions in `transactions/src/`

## Summary Table

| Function | File | Line | Cyclomatic Complexity |
|---|---|---|---|
| `makeUnsignedContractCall` | `builders.ts` | 450 | 13 |
| `addressHashModeToVersion` | `address.ts` | 14 | 12 |
| `signOrigin` | `signer.ts` | 82 | 11 |
| `makeUnsignedContractDeploy` | `builders.ts` | 314 | 10 |
| `makeUnsignedSTXTokenTransfer` | `builders.ts` | 119 | 7 |
| `sponsorTransaction` | `builders.ts` | 621 | 7 |
| `appendOrigin` | `signer.ts` | 122 | 7 |
| `mutatingSignAppendMultiSig` | `builders.ts` | 684 | 5 |

---

## 1. `makeUnsignedContractCall` (complexity 13) — `builders.ts:450`

### What it does
Builds an unsigned Stacks contract-call transaction: merges defaults, optionally validates against ABI (fetched or supplied), constructs either a single-sig or multi-sig spending condition, sets up auth (standard or sponsored), normalizes post-conditions, and auto-fetches fee/nonce when not provided.

### What drives the complexity
1. **ABI validation branching** (lines 473-486): Three-way branch — `validateWithAbi` is `true` (fetch ABI from network), is a `ClarityAbi` object (use directly), or is falsy (skip). The `true` path also checks for `network`, adding another branch.
2. **Single-sig vs. multi-sig spending condition** (lines 490-520): `'publicKey' in options` branch, with inner multi-sig branches for `useNonSequentialMultiSig` and `address` sorting.
3. **Sponsored vs. standard auth** (line 522-524).
4. **Post-condition normalization** (lines 526-531): Three-way type dispatch per post-condition.
5. **Null-check branches for fee/nonce auto-fetch** (lines 542-552).

### Refactoring strategies

#### A. Extract `resolveSpendingCondition(options)` helper
The single-sig vs. multi-sig spending-condition block (lines 488-520) is **identical** across `makeUnsignedContractCall`, `makeUnsignedContractDeploy` (lines 337-369), and `makeUnsignedSTXTokenTransfer` (lines 136-168). Extract it once:

```ts
function resolveSpendingCondition(
  options:
    | { publicKey: string; nonce: bigint; fee: bigint }
    | { publicKeys: string[]; numSignatures: number; useNonSequentialMultiSig?: boolean; address?: string; nonce: bigint; fee: bigint }
): SpendingCondition {
  if ('publicKey' in options) {
    return createSingleSigSpendingCondition(AddressHashMode.P2PKH, options.publicKey, options.nonce, options.fee);
  }
  const hashMode = options.useNonSequentialMultiSig ? AddressHashMode.P2SHNonSequential : AddressHashMode.P2SH;
  const publicKeys = options.address
    ? sortPublicKeysForAddress(options.publicKeys, options.numSignatures, hashMode, createAddress(options.address).hash160)
    : options.publicKeys;
  return createMultiSigSpendingCondition(hashMode, options.numSignatures, publicKeys, options.nonce, options.fee);
}
```

**Expected reduction:** -4 per call site (3 call sites), total -12 branches across the file.

#### B. Extract `resolveAbi(options)` helper
Lines 473-486 can become:

```ts
async function resolveAbi(options: ContractCallOptions): Promise<ClarityAbi | null> {
  if (!options.validateWithAbi) return null;
  if (typeof options.validateWithAbi !== 'boolean') return options.validateWithAbi;
  if (!options.network) throw new Error('Network option must be provided in order to validate with ABI');
  return fetchAbi({ ...options });
}
```

**Expected reduction:** -3 (the three branches move out).

#### C. Extract `normalizePostConditions(postConditions)` helper
The three-way map (lines 526-531) is duplicated in `makeUnsignedContractDeploy` (lines 375-380):

```ts
function normalizePostConditions(pcs: (PostCondition | PostConditionWire | string)[]): PostConditionWire[] {
  return pcs.map(pc => {
    if (typeof pc === 'string') return deserializePostConditionWire(pc);
    if (typeof pc.type === 'string') return postConditionToWire(pc);
    return pc;
  });
}
```

**Expected reduction:** -2 per call site.

#### D. Extract `autoFetchFeeAndNonce(transaction, txOptions, options)` helper
Lines 542-552 are duplicated in all three `makeUnsigned*` functions:

```ts
async function autoFetchFeeAndNonce(
  transaction: StacksTransactionWire,
  txOptions: { fee?: IntegerType; nonce?: IntegerType },
  options: { network: StacksNetwork; client?: any }
) {
  if (txOptions.fee == null) {
    transaction.setFee(await fetchFeeEstimate({ transaction, ...options }));
  }
  if (txOptions.nonce == null) {
    const address = c32address(options.network.addressVersion.singleSig, transaction.auth.spendingCondition!.signer);
    transaction.setNonce(await fetchNonce({ address, ...options }));
  }
}
```

**Expected reduction:** -2 per call site (3 call sites).

#### Net complexity after all extractions: ~4 (down from 13)

---

## 2. `addressHashModeToVersion` (complexity 12) — `address.ts:14`

### What it does
Maps an `AddressHashMode` + network to the correct `AddressVersion` (single-sig vs. multi-sig, mainnet vs. testnet).

### What drives the complexity
Nested `switch` statements: outer switch on `hashMode` (7 cases including default), inner switch on `transactionVersion` (3 cases including default) -- repeated twice (once for P2PKH, once for the multi-sig group).

### Refactoring strategies

#### A. Lookup table
The entire function is a pure mapping with no side effects. Replace with a lookup object:

```ts
const ADDRESS_VERSION_MAP: Record<AddressHashMode, Record<TransactionVersion, AddressVersion>> = {
  [AddressHashMode.P2PKH]: {
    [TransactionVersion.Mainnet]: AddressVersion.MainnetSingleSig,
    [TransactionVersion.Testnet]: AddressVersion.TestnetSingleSig,
  },
  [AddressHashMode.P2SH]: {
    [TransactionVersion.Mainnet]: AddressVersion.MainnetMultiSig,
    [TransactionVersion.Testnet]: AddressVersion.TestnetMultiSig,
  },
  [AddressHashMode.P2SHNonSequential]: {
    [TransactionVersion.Mainnet]: AddressVersion.MainnetMultiSig,
    [TransactionVersion.Testnet]: AddressVersion.TestnetMultiSig,
  },
  // ... remaining hash modes mapping to MultiSig
};

export function addressHashModeToVersion(
  hashMode: AddressHashMode,
  network?: StacksNetworkName | StacksNetwork
): AddressVersion {
  const net = networkFrom(network ?? STACKS_MAINNET);
  const version = ADDRESS_VERSION_MAP[hashMode]?.[net.transactionVersion];
  if (version === undefined) {
    throw new Error(`Unexpected hashMode ${hashMode} / transactionVersion ${net.transactionVersion}`);
  }
  return version;
}
```

#### B. Simplify with isSingleSig check
Since `P2PKH` is the only single-sig hash mode, the logic is really:

```ts
export function addressHashModeToVersion(hashMode: AddressHashMode, network?: StacksNetworkName | StacksNetwork): AddressVersion {
  const net = networkFrom(network ?? STACKS_MAINNET);
  const isSingle = hashMode === AddressHashMode.P2PKH;
  const isMainnet = net.transactionVersion === TransactionVersion.Mainnet;

  if (net.transactionVersion !== TransactionVersion.Mainnet && net.transactionVersion !== TransactionVersion.Testnet) {
    throw new Error(`Unexpected transactionVersion ${net.transactionVersion} for hashMode ${hashMode}`);
  }

  return isSingle
    ? (isMainnet ? AddressVersion.MainnetSingleSig : AddressVersion.TestnetSingleSig)
    : (isMainnet ? AddressVersion.MainnetMultiSig : AddressVersion.TestnetMultiSig);
}
```

**Expected complexity:** 3-4 (down from 12).

---

## 3. `signOrigin` (complexity 11) — `signer.ts:82`

### What it does
Signs the transaction origin: validates preconditions (overlap check, auth/spendingCondition existence), checks for oversigning on legacy multi-sig modes, calls `signNextOrigin`, and conditionally updates `sigHash` based on single-sig vs. sequential multi-sig.

### What drives the complexity
1. **Guard clauses** (lines 83-92): Three sequential `if`-throws for overlap, `auth` undefined, `spendingCondition` undefined.
2. **Legacy multi-sig oversign check** (lines 96-108): Nested condition — hash mode must be P2SH or P2WSH, AND `checkOversign` must be true, AND signature count must be at or above `signaturesRequired`.
3. **sigHash update condition** (lines 112-117): `isSingleSig(...)` OR `isSequentialMultiSig(...)`.

### Refactoring strategies

#### A. Extract `assertCanSignOrigin()` guard
Move the three guard clauses into a private method:

```ts
private assertCanSignOrigin(): SpendingCondition {
  if (this.checkOverlap && this.originDone) {
    throw new SigningError('Cannot sign origin after sponsor key');
  }
  if (!this.transaction.auth) {
    throw new SigningError('"transaction.auth" is undefined');
  }
  if (!this.transaction.auth.spendingCondition) {
    throw new SigningError('"transaction.auth.spendingCondition" is undefined');
  }
  return this.transaction.auth.spendingCondition;
}
```

This also eliminates the repeated undefined checks in `appendOrigin` (lines 132-137), which has the same guards.

#### B. Extract `checkOversigning(spendingCondition)` method
Move lines 95-108 into a dedicated method:

```ts
private assertNotOversigned(sc: SpendingCondition) {
  if (!this.checkOversign) return;
  if (sc.hashMode !== AddressHashMode.P2SH && sc.hashMode !== AddressHashMode.P2WSH) return;
  const sigCount = sc.fields.filter(f => f.contents.type === StacksWireType.MessageSignature).length;
  if (sigCount >= sc.signaturesRequired) {
    throw new Error('Origin would have too many signatures');
  }
}
```

#### Net complexity: ~3 (down from 11). The guard method drops to 3, the oversign method to 3, and `signOrigin` itself to ~3.

---

## 4. `makeUnsignedContractDeploy` (complexity 10) — `builders.ts:314`

### What it does
Builds an unsigned smart-contract deployment transaction. Nearly identical structure to `makeUnsignedContractCall` minus the ABI validation step.

### What drives the complexity
Same drivers as `makeUnsignedContractCall` minus the ABI branches:
- Single-sig vs. multi-sig spending condition (lines 339-369)
- `useNonSequentialMultiSig` toggle (line 349)
- `address` sort branch (line 353)
- Sponsored vs. standard auth (lines 371-373)
- Post-condition normalization (lines 375-380)
- Fee/nonce null checks (lines 391-401)

### Refactoring strategies
All four helper extractions from `makeUnsignedContractCall` (strategies A, C, D above) apply directly here since the code is copy-pasted. After extraction:

**Expected complexity:** ~3 (down from 10).

---

## 5. `makeUnsignedSTXTokenTransfer` (complexity 7) — `builders.ts:119`

### What it does
Builds an unsigned STX token-transfer transaction. Simplest of the three builders -- no post-conditions, no ABI validation.

### What drives the complexity
- Single-sig vs. multi-sig (lines 138-168)
- `useNonSequentialMultiSig` and `address` sub-branches
- Sponsored vs. standard auth (lines 170-172)
- Fee/nonce null checks (lines 182-193)

### Refactoring strategies
Same helpers `resolveSpendingCondition` and `autoFetchFeeAndNonce` apply.

**Expected complexity:** ~2 (down from 7).

---

## 6. `sponsorTransaction` (complexity 7) — `builders.ts:621`

### What it does
Takes an origin-signed transaction and attaches a sponsor: auto-fetches fee (with payload-type validation) and nonce when not provided, creates sponsor spending condition, and signs.

### What drives the complexity
- Fee null check + `switch` on payload type (lines 637-655): 4 `case` arms + `default` throw.
- Nonce null check (lines 657-662).

### Refactoring strategies

#### A. Replace switch with allowlist
The switch on `PayloadType` is really just "is this a sponsorable type?":

```ts
const SPONSORABLE_TYPES = new Set([
  PayloadType.TokenTransfer,
  PayloadType.SmartContract,
  PayloadType.VersionedSmartContract,
  PayloadType.ContractCall,
]);

if (!SPONSORABLE_TYPES.has(options.transaction.payload.payloadType)) {
  throw new Error(`Sponsored transactions not supported for transaction type ${PayloadType[options.transaction.payload.payloadType]}`);
}
const txFee = BigInt(await fetchFeeEstimate({ ...options }));
```

**Expected complexity:** ~3 (down from 7).

---

## 7. `appendOrigin` (complexity 7) — `signer.ts:122`

### What it does
Appends a public key (without signing) to a multi-sig spending condition. Has method overloads for `PublicKey` (string) and `PublicKeyWire` (object).

### What drives the complexity
- Overload resolution: `typeof publicKey === 'object' && 'type' in publicKey` (line 124).
- Same three guard clauses as `signOrigin` (lines 128-137).

### Refactoring strategies
Extracting `assertCanSignOrigin()` (as described above for `signOrigin`) removes 3 branches. The overload resolution is inherent to the signature but could use a separate `toPublicKeyWire()` utility.

**Expected complexity:** ~2 (down from 7).

---

## 8. `mutatingSignAppendMultiSig` (complexity 5) — `builders.ts:684`

### What it does
Signs a multi-sig transaction by iterating public keys in order, signing with matching private keys and appending non-signing public keys.

### What drives the complexity
- Single-sig guard (line 691)
- Optional `address` sorting (lines 697-704)
- For-loop with find + sign-or-append branch (lines 707-716)

### Refactoring strategies
This is already fairly low complexity. The `address` sorting is also used by `resolveSpendingCondition`; if that helper exists, consistency is already improved. The loop body is clear and does not need extraction.

**Expected complexity:** Would remain ~4-5; low priority.

---

## Prioritization

### Priority 1: Extract shared helpers (highest impact, lowest risk)
**Target:** `resolveSpendingCondition`, `normalizePostConditions`, `autoFetchFeeAndNonce`

These three helpers eliminate **duplicated branching across three builder functions**. The code is nearly character-for-character identical in `makeUnsignedSTXTokenTransfer`, `makeUnsignedContractDeploy`, and `makeUnsignedContractCall`. This is a mechanical extraction with zero behavioral change.

- **Affected functions:** `makeUnsignedContractCall` (13->~6), `makeUnsignedContractDeploy` (10->~3), `makeUnsignedSTXTokenTransfer` (7->~2)
- **Total branch reduction:** ~24 across the file
- **Risk:** Low -- pure extraction, no logic changes

### Priority 2: Refactor `addressHashModeToVersion` to a lookup table
- **Affected functions:** `addressHashModeToVersion` (12->~3)
- **Risk:** Very low -- pure mapping function with no side effects
- **Impact:** Eliminates the most complex nested switch in the codebase

### Priority 3: Extract `TransactionSigner` guard methods
**Target:** `assertCanSignOrigin()`, `assertNotOversigned()`

- **Affected functions:** `signOrigin` (11->~3), `appendOrigin` (7->~2)
- **Risk:** Low -- guards are already separable

### Priority 4: Simplify `sponsorTransaction` payload-type check
- **Affected functions:** `sponsorTransaction` (7->~3)
- **Risk:** Very low -- switch-to-set replacement

### Priority 5: `mutatingSignAppendMultiSig` (no action recommended)
Already at complexity 5. The logic is clear and the branching is inherent to the multi-sig workflow.

---

## Cross-Cutting Observations

1. **Null-check inconsistency:** `makeUnsignedSTXTokenTransfer` uses `== null` (line 182, 187) while `makeUnsignedContractDeploy` uses `=== undefined || === null` (lines 391, 396). These are semantically equivalent but the inconsistency suggests copy-paste drift. A shared helper fixes this automatically.

2. **Client merge inconsistency:** `makeUnsignedContractCall` merges `options.client` (line 463: `txOptions.client` is not used, unlike the other two builders which use `txOptions.client`). This could be a bug -- after `Object.assign(defaultOptions, txOptions)`, `options.client` already equals `txOptions.client`, so the merge with `clientFromNetwork` may not produce the intended override precedence.

3. **`signOrigin` constructor duplication:** The `TransactionSigner` constructor (lines 34-60) also counts existing signatures and throws on oversign, duplicating logic in `signOrigin` (lines 96-108). If `assertNotOversigned` is extracted, it could potentially be reused in the constructor.

4. **The `todo` comment** at `signer.ts:16` (`// todo: get rid of signer and combine with transaction class?`) suggests the team has already considered a deeper refactor. The guard extractions proposed here are compatible with either keeping or merging the class.
