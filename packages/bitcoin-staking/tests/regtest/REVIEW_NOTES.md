# Regtest test-suite review notes

Working doc for the test cleanup/review pass. Logic is unchanged throughout the
review (no fixture re-records needed). Delete once the review is closed.

## Comment-style convention (agreed)
- Short docblock (~10 lines); say WHAT + only the non-obvious bit per test.
- `// UPPERCASE` 2–3 word step labels, NOT `// --- N. section ----` rules.
- Comment only exceptions / unexpected things; let code self-document.
- Bare-string `throw` in tests (`throw 'setup-bond aborted'`); `throw new Error` only in `src/`.

## Applied (all green: tsc + offline replay)
- Comment pass on: `register-for-bond-{sbtc,l1,combined}`, `unstake-sbtc`, `stx-staking`,
  `setup-bond`, `register-for-bond` (abort), `btc-transfer`. (`reads` already concise.)
- `SBTC_TOKEN` / `SBTC_REGISTRY` rename (dropped `sbtcToken` local aliases).
- `chooseBondWithRunway` → `waitForBondWithRunway` (it waits underneath; `pickBondIndex` is the pure selector).
- Wallet RPC helpers: `wallet` arg moved last, defaults to `'main'`; callers dropped `BTC_WALLET`/`WALLET`.
- `btc-transfer` poll loop → `waitForFulfilled`.
- SDK `src/locking.ts`: `REGTEST_NETWORK = { ...btc.TEST_NETWORK, bech32: 'bcrt' }`;
  reuse `@stacks/common` `concatBytes`/`equals`; inlined `sha256d`; added internal `range(n)`
  + functional `findIndex` output-match in `assembleLockupProof`.

## Pending review (collect notes, then fix)
Checklist items the user hasn't commented on yet:
- Helpers/infra: `utils.ts` (fixtureKey, file-keyed recorder, isMocking), `mock.ts`
  (useFixtures additive phases), `wait.ts` (broad — reads + waiters + broadcastAndWait + fundStx),
  `bond.ts`, `sbtc.ts` (deployer/sender split), `btc.ts`, `regtest.ts` (keys/roles).
- SDK: `src/build.ts` (postConditions threading + buildRegisterForBond TODO), `src/types.ts`
  (TxParams.postConditions), `src/locking.ts`.
- Docs: `AGENTS.md`, `README.md`.
- Comment-pass not yet done on small/older tests: `pox5-readonly`, `deploy-signer-manager`,
  `transfer-stx` (`btc-merkle-proof` docblock is the only non-trivial one).

## Abstractions proposed in the dry run (status)
- #1 `proveL1Lockup(...)` (extract L1 fund→SPV→assemble; dup in l1+combined) — **revisit (user)**.
- #2 `setupBond(...)` precondition helper — **declined** (keep inline).
- #3 shared bond config constants (rates/MAX_SATS/FEE/EARLY_UNLOCK across 4 files) — **revisit (user)**.
- #4 `provisionSbtc({recipient,sats})` (deploy shim + mint) + `sbtcLockupPc(staker,sats)` — **revisit (user)**.
- #5 split `wait.ts` into `reads.ts` + `waiters.ts` — **approved, TODO** (not yet done).

## SDK gaps surfaced → addressed
- **Multisig `build*` helpers** — was single-sig only (`callPox5` → `makeUnsignedContractCall({ publicKey })`).
  **DONE:** `TxParams` is now `SingleSigTxParams | MultiSigTxParams` (`MultiSigTxParams = TxParamsBase &
  UnsignedMultiSigOptions`, mirroring `@stacks/transactions`), and `callPox5` discriminates on
  `'publicKey' in tx`. So every pox-5 admin builder targets a multisig origin by passing
  `{ publicKeys, numSignatures }`. This package **defaults `useNonSequentialMultiSig: true`**
  (order-independent sigs; pass `false` for legacy sequential). Covered by `build.test.ts`
  "multisig builders" (offline) + `set-bond-admin-multisig.test.ts` (regtest e2e).

## Standing constraints (don't regress)
- Suspected contract/env bug → DON'T fix; `test.skip` + top-level `bug-*.md` (mark *(potential)*).
- `fundStx` funder must be a daemon-free account (the bond-admin), never a flooder/STACKING key.
- Node-only confirmation; the `/extended` API indexer is wedged (only the abort test uses it, live-only).
- One bond-creating test per chain+cycle when recording (deterministic bondIndex → `ERR_BOND_ALREADY_SETUP`).
- Env: daemon stakes `STACKING_KEYS[0..2]` (= the live signer keys); bond-admin is a separate
  never-staked key (`account4` / `ST11NJ…`). See `../stacks-regtest-env/KEYS.md`.

## Next tests (ranked, remaining)
4. `update-bond-registration` — rotate a bond member's signer-manager (needs a 2nd registered signer-manager).
5. `set-bond-admin` — admin rotation.
6. signer-key grant/revoke + allow/disallow contract-caller.
7. guard/unhappy paths (too-soon/late, too-much-sats, already-registered).
8. L1 early unlock (`announce-l1-early-exit`).
9. claim rewards (hardest — needs cycle progression).
</content>
