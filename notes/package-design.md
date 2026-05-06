# `@stacks/btc-staking` — Package Design

**Target:** PoX-5 (Bitcoin Staking, waterfall model)
**Status:** Spec — refresh of 2026-05-04

A new package in the stacks.js monorepo. Not a rename or migration of `@stacks/stacking` — clean-slate design targeting PoX-5 with a functional, modular architecture inspired by the patterns in `@stacks/transactions`.

`@stacks/stacking` (PoX-1 through PoX-4) continues to exist independently.

User-facing journeys (paired BTC bond, sBTC pool participants, STX-only stakers, signer managers) live in `user-flows.md`. This document specifies the SDK surface only.

---

## 1. Design Principles

> "Simple made easy" — Rich Hickey

1. **Functional, not class-based.** Plain exported functions. No `StakingClient`. No `this`. No hidden state.
2. **Each function does one thing.** No function fetches AND builds AND signs AND broadcasts.
3. **Composable pipeline.** Users compose explicitly:
   - `fetch*` — network requests, return data
   - `build*` — construct unsigned transactions from data (pure, no I/O)
   - Sign with existing `@stacks/transactions` tools
   - Broadcast with existing `broadcastTransaction()`
4. **No options helpers.** No `getStackOptions()` indirection — build the payload directly.
5. **Reuse, don't reinvent.** Lean on `@stacks/transactions` for signing, broadcasting, Clarity values, contract calls. Lean on `@stacks/network` for `NetworkClientParam`.
6. **Tree-shakeable.** Plain named exports, no default-export barrels of side-effecting modules.

### What we don't build

- No `StakingClient` class or method-chaining surface.
- No `getXyzOptions()` helpers.
- No combined sign-and-broadcast functions.
- No legacy PoX version detection — PoX-5 only.
- No `PoxOperationPeriod` logic — single contract target.
- No re-implementation of signing or broadcasting.

### Patterns borrowed

From `@stacks/transactions`:
- `fetchXyz()` standalone functions (`fetchNonce`, `fetchCallReadOnlyFunction`).
- `NetworkClientParam` on every fetch function.
- `makeUnsignedContractCall(opts)` returning `StacksTransactionWire`.
- `TransactionSigner` for signing, `broadcastTransaction` for broadcast.

From `@stacks/network`:
- `NetworkClientParam = NetworkParam & ClientParam`.
- `networkFrom()` resolves string or object.
- Default mainnet, overrideable per call.

---

## 2. Module Layout

```
packages/btc-staking/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── webpack.config.js
├── jest.config.js
├── src/
│   ├── index.ts              # Barrel re-exports
│   ├── types.ts              # All types/interfaces
│   ├── constants.ts          # PoX-5 constants, address versions, topics
│   ├── fetch.ts              # fetch* network functions
│   ├── build.ts              # build* tx construction functions
│   ├── signer.ts             # Signer-key grant signature generation
│   ├── addresses.ts          # BTC <-> PoX address conversion
│   └── locking.ts            # L1 BTC timelock script construction
└── tests/
    ├── fetch.test.ts
    ├── build.test.ts
    ├── signer.test.ts
    ├── addresses.test.ts
    └── locking.test.ts
```

### Module responsibilities

- **`fetch.ts`** — Network I/O. Every function takes `NetworkClientParam`. Returns plain data. Uses direct HTTP for node `/v2/` endpoints and `fetchCallReadOnlyFunction` from `@stacks/transactions` for read-only contract reads.
- **`build.ts`** — Pure transaction construction. No I/O. Returns unsigned `StacksTransactionWire` (or a `ContractCallArgs` shape spreadable into `makeUnsignedContractCall`).
- **`signer.ts`** — SIP-018 structured-data signing for the one place PoX-5 still needs an off-chain signature: the **signer-key grant**. Per-tx authorization signatures (the PoX-4 pattern) are gone — they're replaced by the `signer-manager-trait`'s `validate-stake!` callback, which authorizes stake/bond calls on-chain.
- **`addresses.ts`** — BTC address ↔ PoX tuple conversion. Pure.
- **`locking.ts`** — L1 P2WSH+CLTV timelock construction for the paired-BTC bond flow.
- **`constants.ts`** — Contract identifier, address versions, signature topics, protocol constants.
- **`types.ts`** — All TypeScript types.

### What signs where

| Action | Signed by | Authorized by |
| --- | --- | --- |
| `stake`, `stake-update`, `unstake` | Staker (origin tx signature) | `signer-manager.validate-stake!` (on-chain trait call) |
| `register-for-bond` | Staker (origin tx signature) | `signer-manager.validate-stake!` + on-chain allowlist |
| `register-signer` | Signer-manager contract (must be `tx-sender`) | Pre-existing `signer-key-grant` entry |
| `grant-signer-key` | Anyone (origin tx signature) | One-time SIP-018 signature from the signer key over `(signer-manager, auth-id)` — produced by `signSignerKeyGrant` |
| `revoke-signer-grant` | Principal derived from the signer key | tx-sender check |

---

## 3. Function Surface

### 3.1 Tx params

```typescript
interface TxParams {
  publicKey?: string                              // optional; can be added at sign time
  fee: IntegerType
  nonce: IntegerType
  network: StacksNetworkName | StacksNetwork
}
```

Each `build*` returns an unsigned `StacksTransactionWire`. Sign with `TransactionSigner`, broadcast with `broadcastTransaction` from `@stacks/transactions`. Fee and nonce are required — fetch them yourself beforehand if needed.

### 3.2 `build*` — Transaction builders (sync, pure, no I/O)

#### Paired BTC bond

```typescript
// Register for a protocol bond. Caller must be allowlisted, must hold a
// matching L1 BTC timelock (or supply sBTC), and must reference an
// already-registered signer manager. Locks STX for BOND_LENGTH_CYCLES (12).
function buildRegisterForBond(args: {
  bondIndex: number
  signerManager: ContractIdString          // signer-manager contract impl. of signer-manager-trait
  amountUstx: IntegerType                  // STX paired with the BTC lockup
  btcLockup:                                // ok branch -> L1 BTC outputs; err branch -> sBTC sats
    | { kind: 'l1'; outputs: Array<{ amountSats: IntegerType; txid: Uint8Array | string; outputIndex: number }>; unlockBytes: Uint8Array | string }
    | { kind: 'sbtc'; sbtcSats: IntegerType }
  signerCalldata?: Uint8Array | string     // opaque payload forwarded to validate-stake!
} & TxParams): StacksTransactionWire
```

Note: bond period is fixed at `BOND_LENGTH_CYCLES = 12` reward cycles ≈ 6 months. Not a caller-chosen parameter.

#### STX-only staking

```typescript
// Solo STX-only staking. No BTC, no pairing.
function buildStake(args: {
  signerManager: ContractIdString
  amountUstx: IntegerType
  numCycles: number                        // 1..MAX_NUM_CYCLES
  startBurnHt: number                      // must resolve to current cycle + 1
  signerCalldata?: Uint8Array | string
} & TxParams): StacksTransactionWire

// Unified update: extend lock period, increase locked amount, and/or rotate
// signer manager. Pass cyclesToExtend=0 / amountIncrease=0 to skip a dimension;
// changing signerManager alone simply re-binds without extending or increasing.
function buildStakeUpdate(args: {
  signerManager: ContractIdString          // new (or same) signer manager
  cyclesToExtend: number                   // u0 means no extension
  amountIncrease: IntegerType              // u0 means no increase
  signerCalldata?: Uint8Array | string
} & TxParams): StacksTransactionWire

// Set unlock to the next reward cycle. Reverts during the prepare phase.
function buildUnstake(args: {} & TxParams): StacksTransactionWire
```

#### Signer manager registration & key grants

```typescript
// Register a signer-manager contract under its current signer key. MUST be
// invoked from the signer-manager contract itself (tx-sender = the contract
// principal). A signer-key grant for (signerKey, signerManager) must already
// exist on-chain.
function buildRegisterSigner(args: {
  signerManager: ContractIdString
  signerKey: string                        // 33-byte compressed pubkey, hex
} & TxParams): StacksTransactionWire

// Submit a one-time signer-key grant. Keyed on (signerKey, signerManager,
// authId) — NOT on the staker. The grant authorizes the signer-manager
// contract to bind the signer key, after which any number of stakers may
// stake to that manager without per-tx signatures.
function buildGrantSignerKey(args: {
  signerKey: string                        // 33-byte compressed pubkey, hex
  signerManager: ContractIdString
  authId: IntegerType
  signerSignature: string                  // 65-byte recoverable sig over (signerManager, authId)
} & TxParams): StacksTransactionWire

// Revoke a signer-key grant. Must be sent by the Stacks principal derived
// from signerKey.
function buildRevokeSignerGrant(args: {
  signerManager: ContractIdString
  signerKey: string
} & TxParams): StacksTransactionWire
```

#### Rewards

```typescript
// Trigger waterfall reward distribution at the configured distribution height.
function buildCalculateRewards(args: {
  bondIndices: number[]                    // must include all currently active bonds
} & TxParams): StacksTransactionWire

// Claim accrued sBTC for a signer for a given reward cycle and a list of
// bond periods.
function buildClaimRewards(args: {
  rewardCycle: number
  bondIndices: number[]
} & TxParams): StacksTransactionWire
```

#### Caller authorization

```typescript
function buildAllowContractCaller(args: {
  contractCaller: ContractIdString
  untilBurnHeight?: number
} & TxParams): StacksTransactionWire

function buildDisallowContractCaller(args: {
  contractCaller: ContractIdString
} & TxParams): StacksTransactionWire
```

#### Usage

```typescript
import { buildStake } from '@stacks/btc-staking'
import { fetchNonce, TransactionSigner, broadcastTransaction } from '@stacks/transactions'

const nonce = await fetchNonce({ address, network: 'mainnet' })

const tx = buildStake({
  signerManager: 'SP000...mysigner.manager-v1',
  amountUstx: 50_000_000_000n,
  numCycles: 1,
  startBurnHt: 800_000,
  publicKey: myPublicKey,
  fee: 10_000n,
  nonce,
  network: 'mainnet',
})

const signer = new TransactionSigner(tx)
signer.signOrigin(myPrivateKey)

await broadcastTransaction({ transaction: tx, network: 'mainnet' })
```

### 3.3 `fetch*` — Network queries (async)

Every fetch function takes `NetworkClientParam`.

#### Direct HTTP (node `/v2/` endpoints)

```typescript
function fetchPoxInfo(opts: NetworkClientParam): Promise<PoxInfo>

function fetchAccountStatus(opts: { address: string } & NetworkClientParam): Promise<AccountStatus>
function fetchAccountBalance(opts: { address: string } & NetworkClientParam): Promise<bigint>
function fetchAccountBalanceLocked(opts: { address: string } & NetworkClientParam): Promise<bigint>

// Derived from fetchPoxInfo
function fetchCycleInfo(opts: NetworkClientParam): Promise<CycleInfo>
function fetchSecondsUntilNextCycle(opts: NetworkClientParam): Promise<number>
function fetchSecondsUntilPrepareDeadline(opts: NetworkClientParam): Promise<number>
```

#### Read-only contract calls

```typescript
// Staker / signer / bond state
function fetchStakerInfo(opts: { address: string } & NetworkClientParam): Promise<StakerInfo>
function fetchBondMembership(opts: { address: string } & NetworkClientParam): Promise<BondMembership | undefined>
function fetchBondAllowance(opts: { address: string; bondIndex: number } & NetworkClientParam): Promise<bigint>
function fetchSignerInfo(opts: { signerManager: ContractIdString } & NetworkClientParam): Promise<SignerInfo | undefined>
function fetchSignerKey(opts: { principal: string } & NetworkClientParam): Promise<Uint8Array | undefined>

// Cycle & bond accounting
function fetchSignerCycleMembership(opts: { signerManager: ContractIdString; cycle: number } & NetworkClientParam): Promise<bigint>
function fetchTotalSatsStakedForBond(opts: { bondIndex: number } & NetworkClientParam): Promise<bigint>
function fetchTotalSharesStakedForCycle(opts: { index: number; isBond: boolean } & NetworkClientParam): Promise<bigint>
function fetchSignerSharesStakedForCycle(opts: { signerManager: ContractIdString; index: number; isBond: boolean } & NetworkClientParam): Promise<bigint>
function fetchUstxDelegatedForCycle(opts: { cycle: number } & NetworkClientParam): Promise<bigint>

// Rewards
function fetchClaimableRewards(opts: { signerManager: ContractIdString; rewardCycle: number; bondIndices: number[] } & NetworkClientParam): Promise<bigint>
function fetchRewardsPerTokenForCycle(opts: { index: number; isBond: boolean } & NetworkClientParam): Promise<bigint>
function fetchReserveBalance(opts: NetworkClientParam): Promise<bigint>
function fetchTotalSatsStaked(opts: NetworkClientParam): Promise<bigint>
function fetchLastRewardComputeHeight(opts: NetworkClientParam): Promise<number>

// Signer-key grants
function fetchVerifySignerKeyGrant(opts: { signerKey: string; signerManager: ContractIdString } & NetworkClientParam): Promise<boolean>
function fetchSignerGrantMessageHash(opts: { signerManager: ContractIdString; authId: IntegerType } & NetworkClientParam): Promise<Uint8Array>

// Cycle / height conversions (all derivable from fetchPoxInfo + constants,
// but exposed for parity with the contract)
function fetchBondPeriodToRewardCycle(opts: { bondIndex: number } & NetworkClientParam): Promise<number>
function fetchBondPeriodToBurnHeight(opts: { bondIndex: number } & NetworkClientParam): Promise<number>
function fetchBurnHeightToRewardCycle(opts: { burnHeight: number } & NetworkClientParam): Promise<number>
function fetchRewardCycleToBurnHeight(opts: { cycle: number } & NetworkClientParam): Promise<number>
function fetchRewardCycleToUnlockHeight(opts: { cycle: number } & NetworkClientParam): Promise<number>
function fetchIsInPreparePhase(opts: { burnHeight: number } & NetworkClientParam): Promise<boolean>
function fetchIsBondActiveAtHeight(opts: { bondIndex: number; burnHeight: number } & NetworkClientParam): Promise<boolean>

// Caller allowance
function fetchCheckCallerAllowed(opts: { sender: string; contractCaller: ContractIdString } & NetworkClientParam): Promise<boolean>
```

### 3.4 `signer*` — Signature generation (sync, pure)

PoX-5 collapses the per-tx authorization scheme of PoX-4. The only off-chain signature the SDK produces is the **signer-key grant**: a one-time secp256k1 signature over `(signer-manager, auth-id)` under the SIP-018 domain `{ name: "pox-5-signer", version: "1.0.0", chain-id }`. After the grant is on-chain, stake/bond authorization happens via the signer-manager contract's `validate-stake!` callback.

```typescript
// Build the SIP-018 message + domain for a signer-key grant (pure).
function buildSignerKeyGrantMessage(opts: {
  signerManager: ContractIdString
  authId: IntegerType
  network: StacksNetworkName | StacksNetwork
}): { message: TupleCV; domain: TupleCV }

// Produce the 65-byte recoverable signature, hex-encoded (pure).
function signSignerKeyGrant(opts: {
  signerManager: ContractIdString
  authId: IntegerType
  network: StacksNetworkName | StacksNetwork
  privateKey: PrivateKey
}): string

// Verify a signer-key grant signature locally (pure).
function verifySignerKeyGrant(opts: {
  signerManager: ContractIdString
  authId: IntegerType
  network: StacksNetworkName | StacksNetwork
  publicKey: string
  signature: string
}): boolean
```

### 3.5 `addresses*` — BTC ↔ PoX address conversion (sync, pure)

```typescript
function decodeBtcAddress(btcAddress: string): { version: PoXAddressVersion; data: Uint8Array }
function encodeBtcAddress(version: PoXAddressVersion, hash: Uint8Array, network: StacksNetworkName): string
function poxAddressToTuple(btcAddress: string): TupleCV
function poxTupleToBtcAddress(poxAddr: TupleCV, network: StacksNetworkName): string
function extractPoxAddressFromClarityValue(val: ClarityValue): { version: number; hashbytes: Uint8Array }
```

External deps: `@noble/hashes/sha256`, `@scure/base` (bech32/bech32m), `@stacks/encryption` (`base58CheckDecode`/`base58CheckEncode`).

### 3.6 `locking*` — L1 BTC timelock construction (sync, pure)

P2WSH + CLTV with the Stacks principal embedded in the unlock script and a pre-authorized early-exit branch co-signable by the Early Exit signer set. Used by paired-BTC bond participants to construct the L1 commitment matched against `register-for-bond`.

```typescript
function buildLockingScript(opts: {
  stxAddress: string
  unlockHeight: number
  earlyExitPubkeys: string[]               // Early Exit signer set
  earlyExitThreshold: number               // 1-of-N
}): Uint8Array

function lockingScriptToP2wsh(script: Uint8Array, network: 'mainnet' | 'testnet'): string

function computeUnlockHeight(opts: {
  firstRewardCycle: number
  numCycles: number                        // pass BOND_LENGTH_CYCLES for paired-BTC bonds
  rewardCycleLength: number
  firstBurnchainBlockHeight: number
}): number
```

---

## 4. Constants & Types

### `constants.ts`

```typescript
const POX_5_CONTRACT: ContractIdString               // SP000... .pox-5

// From pox-5.clar
const BOND_LENGTH_CYCLES = 12                        // ~6 months
const BOND_GAP_CYCLES = 2                            // gap between bond starts
const MAX_NUM_CYCLES = 96                            // STX-only stake upper bound
const SIGNER_SET_MIN_USTX = 50_000_000_000n          // 50,000 STX
const RESERVE_RATIO = 1500                           // basis points (15%)
const PRECISION = 1_000_000_000_000_000_000n         // 1e18 (reward math)

// Bitcoin address versions (matches contract MAX_ADDRESS_VERSION = 6)
enum PoXAddressVersion {
  P2PKH = 0x00,
  P2SH = 0x01,
  P2SHP2WPKH = 0x02,
  P2SHP2WSH = 0x03,
  P2WPKH = 0x04,
  P2WSH = 0x05,
  P2TR = 0x06,
}

// SIP-018 domain
const POX_5_SIGNER_DOMAIN = { name: 'pox-5-signer', version: '1.0.0' }

// Single remaining off-chain signature topic
enum Pox5SignatureTopic {
  GrantAuthorization = 'grant-authorization',
}

// Stacks address version bytes
const STACKS_ADDR_VERSION_MAINNET = 0x16
const STACKS_ADDR_VERSION_TESTNET = 0x1a
```

### `types.ts`

```typescript
// Shape returned by fetchPoxInfo (from /v2/pox)
interface PoxInfo {
  contractId: string
  currentBurnchainBlockHeight: number
  firstBurnchainBlockHeight: number
  prepareCycleLength: number
  rewardCycleLength: number
  rewardCycleId: number
  rewardSlots: number
  currentCycle: CycleInfo
  nextCycle: CycleInfo
  // PoX-5 additions
  firstPox5RewardCycle: number
  firstBondPeriodCycle: number
  reserveBalance: bigint
  totalSatsStaked: bigint
}

interface CycleInfo {
  id: number
  stackedUstx: bigint
  isPoxActive: boolean
}

interface AccountStatus {
  balance: bigint
  locked: bigint
  nonce: bigint
  unlockHeight: number
}

// STX-only staker record
type StakerInfo =
  | { staked: false }
  | {
      staked: true
      details: {
        amountUstx: bigint
        firstRewardCycle: number
        numCycles: number
      }
    }

// Paired-BTC bond participant record
interface BondMembership {
  bondIndex: number
  amountSats: bigint
  amountUstx: bigint
  rewardPerSharePaid: bigint
}

// Signer-manager registration record
interface SignerInfo {
  signerManager: ContractIdString
  signerKey: Uint8Array
}

// Active bond configuration (from protocol-bonds map)
interface BondConfig {
  bondIndex: number
  targetRateBps: number
  stxValueRatio: bigint                   // ustx per 100 sats
  minUstxRatioBps: number
  earlyUnlockSigners: Uint8Array
}

// Pagination (for extended-API endpoints, when added)
interface PaginationOpts {
  limit?: number
  offset?: number
}
```

---

## 5. Dependencies

```json
{
  "@stacks/common": "^7.x",
  "@stacks/encryption": "^7.x",
  "@stacks/network": "^7.x",
  "@stacks/transactions": "^7.x",
  "@noble/hashes": "^1.x",
  "@scure/base": "^1.x",
  "bs58": "^5.x"
}
```

**Peer expectations.** Users import `TransactionSigner` and `broadcastTransaction` directly from `@stacks/transactions`. They are not re-exported from `@stacks/btc-staking`.

No dependency on `@stacks/stacking` — fully independent.
