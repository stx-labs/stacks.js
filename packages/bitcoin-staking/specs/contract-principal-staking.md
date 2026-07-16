# Spec: contract-principal staking (regtest)

Status: draft · Scope: `@stacks/bitcoin-staking` regtest test suite · No `src/` changes expected

## 1. Motivation

We want regtest coverage for the scenario a user described as "delegating to a
contract to do pox interactions." Investigation of the canonical `pox-5.clar`
(`../stacks-core/stackslib/src/chainstate/stacks/boot/pox-5.clar`) reframes what
that can mean:

**pox-5 has no delegation.** There is no `delegate-stx` / `delegate-stack-*`
analogue. Staker identity is always `tx-sender` (the transaction origin), and
`roll-sbtc` (pox-5.clar:1951) pulls sBTC from `tx-sender`. A nested call
(`user → wrapper → pox-5`) keeps the **user** as `tx-sender`, so the bond would
register under the user and sBTC would be pulled from the user — the wrapper is
transparent. So "delegate my stacking to a contract" is *not expressible*.

What **is** real and worth proving is the adjacent capability that commit
`b726a1e6` ("allow contract principals as L1 stakers") unlocked in the SDK:

> **A contract principal as the staker of record** — a vault/treasury contract
> that holds its own sBTC (or owns an L1 BTC lockup) and *is* the staker. It
> reaches pox-5 as `tx-sender` by originating the call inside its own body
> (`as-contract`), so `contract-caller == tx-sender == <deployer>.<wrapper>`.

This is a legitimate custody pattern (a DAO staking sBTC it holds). Today it has
**zero integration coverage** — only byte-encoding is tested (`tests/locking.test.ts`).
b726a1e6 changed only `src/script.ts`; nothing proves a contract-principal lock is
actually registerable, spendable, or reclaimable on-chain.

## 2. Goals / non-goals

**Goals**
- Prove b726a1e6's claim end-to-end: a contract-principal staker can lock BTC,
  register for a bond, and reclaim — on a live regtest chain, recorded for replay.
- Cover the sBTC-custody path: a wrapper holding sBTC stakes as itself.
- Pin down the two behaviors the static analysis could not settle (§6).
- Document the SDK footgun where `fetchEligible*` dry-runs skip the caller-auth gate.

**Non-goals**
- No delegation feature (pox-5 has none — nothing to test).
- No `src/` changes. The SDK's encoding, lock-script, reclaim, and read paths are
  already contract-principal-capable (§4); this spec only adds tests + a test-side
  wrapper contract. If a test surfaces a genuine SDK gap, that spins off separately.
- Not testing the signer-manager axis (already a contract principal, already covered).

## 3. Background: why the SDK can't build this call

Every `build*` helper emits a **directly-signed** pox-5 contract-call whose
`tx-sender` derives from a `publicKey` (`callPox5`, `build.ts:30`). A contract has
no key and cannot sign, and the SDK has no wrapper-call builder or deploy helper —
so the "contract is the caller/staker" path is **purely test-side**: we author and
deploy a small Clarity wrapper whose body `as-contract`s into pox-5, then call the
wrapper's own entry points with an ordinary EOA-signed tx.

Encoding is already done for us: all principal args serialize via `Cl.address(...)`,
which auto-detects `SP….name` / `ST….name` contract forms (`0x06` consensus tag)
with no truncation (`script.ts:150`, `fetch.ts` reads via `cvToValue`).

## 4. What already works (do not re-test beyond a smoke check)

| Layer | Status | Ref |
|---|---|---|
| Consensus-buffer `0x06` encoding | ✅ unit-tested | `script.ts:150`, `locking.test.ts` |
| L1 lock-script staker commitment (hash of consensus buff) | ✅ encoding-only | `script.ts:207` |
| `reclaim.ts` (BTC unlock key is orthogonal to staker principal) | ✅ contract-safe | `reclaim.ts:46` — `stakerPub` is the BTC key, misleading name |
| SDK reads (`fetchBondMembership`, `fetchStakerInfo`, `fetchEarned`) | ✅ contract-capable | `fetch.ts` |
| `buildSetupBond` allowlist accepts contract stakers | ✅ | `build.ts:175` |

## 5. The wrapper contract (core design artifact)

One minimal `.clar`, authored as an **inline `codeBody` template-literal** (precedent:
`deploySbtcMinter` / `SBTC_DEPOSIT_SOURCE`, `tests/helpers/sbtc.ts:48`). We do **not**
add a file to the `stacks-regtest-env` checkout — that couples tests to an out-of-repo,
CI-absent dir and forces `test.skip` under replay.

Requirements the wrapper must satisfy (derived from pox-5's staker mechanics):

- **Be the staker of record**: each pox-5 call in its body runs under `as-contract`
  so `tx-sender` is the wrapper's own principal (`<deployer>.<wrapper>`).
- **Hold sBTC**: for the sBTC-stake path, the wrapper must own the sBTC so
  `roll-sbtc`'s `transfer … tx-sender current-contract` (pox-5.clar:1951) pulls from
  the wrapper. Add a deposit entry point (or mint to it via the sBTC shim).
- **Expose thin entry points**: `register-l1`, `stake-sbtc`, `unstake`, and
  (for §6) `announce-early-exit`, each forwarding args to the matching pox-5 fn.
- **`.pox-5` reference**: inline sources don't get `loadContractSource`'s rewrite, so
  substitute the boot address ourselves — write `'<bootAddress>.pox-5` using
  `network.bootAddress` (see `deploy-signer-manager.test.ts:24`), or run the string
  through the same `.replaceAll(' .pox-5', ...)`.

Deploy via `deployContract({ contractName, codeBody, senderKey: ACCOUNTS.admin.key, network })`
— idempotent, waits on `/v2/contracts/interface`. `ACCOUNTS.admin` (account4) is the
conventional daemon-free deployer; **never** deploy from `sbtcDeployer` (daemon-staked,
BadNonce).

**Allowlist**: `setup-bond` must allowlist the **wrapper's** contract principal
(`<deployer>.<wrapper>`), not any EOA — otherwise `ERR_NOT_ALLOWLISTED`
(pox-5.clar:693). Per project convention also allowlist the standing friend address.

## 6. Open questions / Phase-0 findings

### Resolved by the Slice 1 spike (verified live)

- **Trait path** — `signer-manager-trait` is defined inside pox-5 (pox-5.clar:392), so the
  wrapper imports it boot-relative: `(use-trait signer-manager-trait '<boot>.pox-5.signer-manager-trait)`.
- **This chain runs Clarity 4**, whose sender-switch is `as-contract?` — the classic
  `as-contract` was REMOVED (deploy aborts `use of unresolved function 'as-contract'`).
  `as-contract?` takes a leading asset-allowance list: `(as-contract? (<allowances>) <body>)`,
  allowances `with-stx|with-ft|with-nft|with-stacking|…` or the escape hatch
  `with-all-assets-unsafe` (legal ONLY inside `as-contract?`, must be alone). A test wrapper
  uses `((with-all-assets-unsafe))`.
- **The body's inner `contract-call?` response MUST be consumed** (`try!`), else the deploy
  aborts `intermediary responses in consecutive statements must be checked`. `as-contract?`
  flattens the checked body into its own `(response …)`, so the entry point relays pox-5's result.
- **`signer-calldata` = `none` works** (regtest signer-manager accepts it; mirrors `stake.test.ts`).
- **Verified**: a contract principal staked STX it holds and unstaked — `fetchStakerInfo(<wrapper>)`
  reports the contract as staker with the right amount/cycles/signer, then unwinds. Reads accept
  the `SP…/ST….name` contract principal with no truncation.

### Resolved by Slice 4 (verified live)

- **`announce-l1-early-exit` IS reachable for a contract bond (POSITIVE).** A wrapper entry
  calls it under `as-contract?`, so `contract-caller == tx-sender == staker` all resolve to
  the wrapper principal and the gate (pox-5.clar:1220) passes. Confirmed: the announce tx
  lands `tx_status: success` for the contract staker.
- **`verify-l1-lockups` accepts the `0x06` staker commitment on-chain.** The Slice 4 live L1
  register enrolled the wrapper with `isL1Lock: true` — the contract-principal commitment
  verifies through pox-5, not just the SDK encoder. **b726a1e6 fully proven.**

## 7. Test matrix

Each row (except reads/eligibility) deploys the §5 wrapper, gates the **deploy**
`RECORD`-only (source read hits the filesystem), and records the **contract-calls** so
assertions replay offline — the `deploy-signer-manager.test.ts` shape.

| # | Test | Proves | Deploy | Priority | Slice |
|---|---|---|---|---|---|
| 1 | Contract-principal **L1 register-for-bond** | b726a1e6's claim: contract staker locks BTC + registers; membership readable | wrapper | High | A |
| 2 | Contract-principal **reclaim** (L1 unlock) | the contract-staker lock is *spendable* (closes the "encoding-only" gap) | reuse #1 | High | A |
| 3 | Contract-principal **sBTC stake** (wrapper holds sBTC) | `roll-sbtc` pulls from the wrapper; allowlist keyed on wrapper principal | wrapper (sBTC) | High | B |
| 4 | **`announce-l1-early-exit`** from the wrapper | the triple-equality gate — positive or expected-abort per §6.1 | wrapper | Medium | B |
| 5 | Eligibility **dry-run vs reality** for a contract staker | `fetchEligible*` skips caller-auth (`eligibility.ts:381`) → green dry-run ≠ passing tx | none | Medium | B |
| 6 | Contract-principal **unstake + reward claim** | refund returns to wrapper; claim needs signer-manager as contract-caller | wrapper + signer-mgr | Low | C |
| 7 | **Reads** against a contract-principal bond | `fetchBondMembership`/`fetchStakerInfo` return the `SP….name` staker | none | Low | C |

### Vertical slices
- **Slice A (first, highest value)** — #1 + #2: the wrapper + the L1 lock→register→reclaim
  round trip. Proves b726a1e6 actually holds on-chain. Ships the reusable wrapper.
- **Slice B** — #3 (sBTC custody), #4 (early-exit, informed by §6.1), #5 (eligibility footgun).
- **Slice C** — #6 (unstake/claim), #7 (reads). Cheap confidence, replay-friendly.

## 8. Execution plan

- **Phase 0 — spike (live, throwaway).** On regtest, deploy a stub wrapper and probe §6.1
  and §6.2 by hand. Record findings back into this spec (turn the two questions into
  stated facts). ~1 chain session.
- **Phase 1 — Slice A.** Author the wrapper helper (`tests/helpers/` or inline in the
  test), write #1 + #2, record live, verify replay. Follow the taste rules
  (inline SDK in the test body, `waitFor*` for determinism, no fixture magic).
- **Phase 2 — Slice B.** #3–#5.
- **Phase 3 — Slice C.** #6–#7.

Each phase: record live with the self-healing harness (`RECORD=1 … --runInBand`),
then confirm offline replay is green. New one-shot-membership accounts get fresh keys
in `regtest.ts` (see the README's re-recording gotchas).

## 9. Test-infra touchpoints

- `tests/helpers/deploy.ts` — `deployContract` (inline `codeBody`), idempotent, confirmation wait.
- `tests/helpers/sbtc.ts` — inline-source precedent; sBTC mint shim to fund the wrapper.
- `tests/regtest/regtest.ts` — deployer accounts; add fresh one-shot keys for register tests.
- `tests/helpers/mock.ts` + `wait.ts` — record/replay; waiters short-circuit under replay.
- New wrapper source: an inline `.clar` template-literal in a small helper (e.g.
  `tests/helpers/wrapper-staker.ts`) exporting the source + a `deployWrapperStaker()`.

## 10. Risks

- **Phase-0 outcome may kill #4** (if early-exit is genuinely unreachable for a contract
  bond, it becomes an expected-abort assertion, not a happy path). Acceptable — that's
  still coverage of a real boundary.
- **sBTC custody in the wrapper** (#3) needs the wrapper to receive sBTC before staking;
  the mint shim handles this on regtest but the exact ownership transfer must be modeled
  in the wrapper's `.clar`.
- **Deploy is live-only** — these suites won't fully re-record without a chain, same as
  `deploy-signer-manager`. The contract-call assertions still replay offline.

## Refinement

> Supersedes §7's slice ordering. Arg-shape analysis of pox-5 (`register-for-bond`
> :642, `stake` :976, `unstake` :1424, `unstake-sbtc` :1261) flips the tracer bullet:
> the L1 path the original matrix led with is the *hardest* to wrap (a wrapper must
> re-declare pox-5's deep SPV response tuple in its own Clarity signature), while
> pure-STX `stake`/`unstake` are trivial (all flat scalar args). We now prove the
> **wrapper-is-staker mechanism** with the cheapest call first, then climb toward L1.

### A note on "inline SDK" for these tests

Unlike the rest of the regtest suite, the **mutating call cannot be an SDK builder**:
every `build*` signs as an EOA, but a contract staker requires the call to originate
*inside* the wrapper (`as-contract`). So the mutating step is a raw
`makeContractCall` to the wrapper's own entry point. The SDK surface these tests still
dogf-food inline: `buildSignerCalldata`/`signSignerGrant` (authorize the **contract**
principal as staker), `fetchEligible*` (preflight), and `fetchStakerInfo` /
`fetchBondMembership` (assert the `SP….name` staker enrolled). That split is the point
of the eligibility test (#5): the dry-run is SDK-built, the reality is a wrapper call.

### Interfaces

**1. The wrapper contract — `tests/helpers/wrapper-staker.ts`**

One inline `.clar` source, grown across slices. Every pox-5 call is wrapped in
`as-contract` so `tx-sender == contract-caller == <deployer>.contract-principal-staker`
(the staker of record). `<BOOT>` is substituted from `network.bootAddress`; the
`signer-manager-trait` import path is confirmed in Phase 0 (§6).

Verified Clarity-4 form (Slice 1 live-green). Every entry point is
`(as-contract? ((with-all-assets-unsafe)) (try! (contract-call? …)))` — see §6 findings.

```clarity
;; contract-principal-staker — a minimal vault that IS the staker of record.
(use-trait signer-manager-trait '<BOOT>.pox-5.signer-manager-trait)

;; Slice 1 — pure-STX stake/unstake (SHIPPED, live+replay green). signer-calldata
;; hardcoded to `none` (regtest signer-manager accepts it).
(define-public (stake (signer-manager <signer-manager-trait>)
                      (amount-ustx uint) (num-cycles uint) (start-burn-ht uint))
  (as-contract? ((with-all-assets-unsafe))
    (try! (contract-call? '<BOOT>.pox-5 stake
       signer-manager amount-ustx num-cycles start-burn-ht none))))

(define-public (unstake (old-signer-manager <signer-manager-trait>))
  (as-contract? ((with-all-assets-unsafe))
    (try! (contract-call? '<BOOT>.pox-5 unstake old-signer-manager))))

;; Slice 2 — sBTC register. The wrapper HOLDS the sBTC (minted to it); lock-sbtc
;; pulls from tx-sender (= wrapper). sBTC path is the `(err sats)` discriminator —
;; NO deep SPV tuple needed here.
(define-public (register-sbtc (bond-index uint) (signer-manager <signer-manager-trait>)
                              (amount-ustx uint) (sats uint))
  (as-contract? ((with-all-assets-unsafe))
    (try! (contract-call? '<BOOT>.pox-5 register-for-bond
       bond-index signer-manager amount-ustx (err sats) none))))

;; Slice 4 — L1 register. Wrapper must re-declare the FULL SPV `ok`-tuple (the
;; painful, prototype-first part; the type must match pox-5:650-665 exactly).
(define-public (register-l1 (bond-index uint) (signer-manager <signer-manager-trait>)
                            (amount-ustx uint)
                            (btc-lockup { outputs: (list 10 { height: uint,
                              tx: (buff 100000), output-index: uint, header: (buff 80),
                              leaf-hashes: (list 14 (buff 32)), tx-count: uint,
                              tx-index: uint, amount: uint, unlock-burn-height: uint }),
                              staker-unlock-bytes: (buff 683) })
                            (signer-calldata (optional (buff 500))))
  (as-contract? ((with-all-assets-unsafe))
    (try! (contract-call? '<BOOT>.pox-5 register-for-bond
       bond-index signer-manager amount-ustx (ok btc-lockup) signer-calldata))))
```

TS helper exports (source builder + deploy; no call-wrappers — calls stay inline per taste):

```ts
export const WRAPPER_STAKER_NAME = 'contract-principal-staker';
/** Inline .clar with <BOOT> and the trait path substituted. */
export function wrapperStakerSource(bootAddress: string): string;
/** Deploy from ACCOUNTS.admin; idempotent; returns `<admin>.contract-principal-staker`. */
export function deployWrapperStaker(args: { deployerKey: string; network: StacksNetwork }): Promise<string>;
```

**2. Slice A test skeleton** (`tests/regtest/actions/wrapper-stake.test.ts`) — mirrors
`stake.test.ts`, staker = the wrapper principal:

```ts
const wrapper = await deployWrapperStaker({ deployerKey: ACCOUNTS.admin.key, network }); // RECORD-only
// fund the wrapper with STX (fundStx → wrapper principal), build signer-calldata for
// the WRAPPER as staker (buildSignerCalldata/signSignerGrant), then:
const tx = await makeContractCall({ contractAddress, contractName: WRAPPER_STAKER_NAME,
  functionName: 'stake', functionArgs: [Cl.contractPrincipal(...signerMgr), Cl.uint(amountUstx),
    Cl.uint(numCycles), Cl.uint(startBurnHt), Cl.some(Cl.bufferFromHex(calldata))],
  senderKey: caller.key, nonce, network, postConditionMode: 'allow' });
await broadcastAndWait(tx, caller.address, network);
// assert the CONTRACT is the staker of record:
const info = await fetchStakerInfo({ address: wrapper, network });
expect(info?.lockedUstx).toBe(amountUstx);
```

### Estimates

| Module | ~LOC | Complexity | Abstractions touched |
|--------|------|------------|----------------------|
| `wrapper-staker.ts` (source + deploy, Slice A entries) | ~70 (40 clar + 30 ts) | moderate — Clarity trait import + `as-contract`; confirm trait path (Phase 0) | new file; reuses `deployContract` |
| Slice A test (stake + unstake) | ~130 | mechanical-moderate — mirrors `stake.test.ts` | `fundStx`, signer-calldata, reads |
| Slice B: wrapper `register-sbtc` + test | ~170 (15 clar + 155 ts) | moderate — mint sBTC to wrapper, allowlist wrapper principal | `sbtc.ts` (`mintSbtc`), `bond.ts` |
| Slice C: wrapper `register-l1` + test + reclaim | ~250 (40 clar + 210 ts) | **tricky — the deep SPV tuple type must match pox-5 exactly; prototype the `.clar` in isolation first** | L1 proof helpers, `reclaim.ts`, `btc.ts` |
| Slice D: reads + eligibility footgun + early-exit boundary | ~110 | mechanical (mostly reads; early-exit is one expected-abort) | `eligibility.ts`, reads |

**Prototype flag:** Slice C's `register-l1` is the one "tricky, changes nothing shared but
easy to get wrong" module — hand-write and `clarinet check` (or deploy-probe) the tuple
type before writing the test around it. Slice A's wrapper carries the trait-import risk;
Phase 0 retires it.

### Slices

1. **Wrapper-is-staker via pure-STX stake** — SHIPPED (live + replay green). ✅
   `tests/helpers/wrapper-staker.ts` + `tests/regtest/actions/wrapper-stake.test.ts`.
   - [x] `deployWrapperStaker` lands a queryable contract (inline source → replays too)
   - [x] wrapper `stake` → `fetchStakerInfo` reports the contract principal locked
   - [x] wrapper `unstake` → lock unwinds; offline replay green
2. **Contract-principal sBTC register-for-bond** — SHIPPED (live + replay green). ✅
   `tests/regtest/actions/wrapper-register-sbtc.test.ts`.
   - [x] allowlist keyed on the **wrapper** principal; sBTC minted to the wrapper
   - [x] `register-sbtc` (`(err sats)` discriminator) enrolls the contract; `isL1Lock: false`
   - [x] wrapper funded with STX too (register-for-bond moves STX even on the sBTC path)
   - [x] `fetchBondMembership`/`fetchBondAllowance`/`fetchSbtcBalance` read the contract principal
   Findings: `(err sats)` type-checks against the big response param; a raw wrapper
   call must target the wrapper's DEPLOYER address (not the bond admin).
3. **Contract-principal reads + early-exit boundary** — folded into Slice 4. ✅
   Reads are exercised across Slices 1–2 & 4 (`fetchStakerInfo`/`fetchBondMembership`/
   `fetchBondAllowance`/`fetchSbtcBalance` all resolve the `ST….name` staker with no truncation).
   - [x] `announce-l1-early-exit` reachability asserted per §6.1 — POSITIVE (see wrapper-register-l1)
4. **Contract-principal L1 register** — SHIPPED (live + replay green). ✅
   `tests/regtest/actions/wrapper-register-l1.test.ts`.
   - [x] `register-l1` `.clar` deep SPV-tuple type matches pox-5 exactly (deployed + registered)
   - [x] P2WSH lockup commits the wrapper's `0x06` contract principal; SPV proof built inline
   - [x] wrapper enrolled with `isL1Lock: true`; membership readable — **b726a1e6 proven on-chain**
     (pox-5 `verify-l1-lockups`/`construct-lockup-script` accept the contract-principal commitment)
   - [x] `announce-l1-early-exit` from the wrapper lands `tx_status: success` (§6.1 POSITIVE)
   - [x] reclaim spendability of a contract-committed lock — `wrapper-reclaim.test.ts` (locktime
     path; BTC unlock key orthogonal to the staker principal). ALL SHIPPED, live + replay green.

### Scope decision (settled)

**All four slices are committed** — including Slice 4 (L1 register + reclaim), which proves
b726a1e6's on-chain claim fully. Slice 4 stays last (it's ~2× the others and holds the only
real Clarity risk) and gains one hard gate: **prototype the `register-l1` `.clar` in isolation
(`clarinet check` or a deploy-probe) and confirm the SPV tuple relays, before writing its test.**
Phase 0 (§6) still runs first to retire the trait-path and early-exit-reachability unknowns.
