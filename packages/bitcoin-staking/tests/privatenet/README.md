# Privatenet test suite

Tests against the **hosted private testnet** (`api.private-1.hiro.so`), NOT the
local regtest env. Never run docker or chain-lifecycle commands from here — the
chain is shared, live, and operator-managed (it wipes roughly daily; state
resets, the endpoints don't).

## Endpoints

| What                                       | Where                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Stacks API / node                          | `https://api.private-1.hiro.so` (chain id `256`, `NETWORK=testnet`)                                    |
| BTC indexer (esplora/mempool)              | `https://mempool.bitcoin.private-1.hiro.so/api`                                                        |
| BTC faucet                                 | `POST {STACKS_API}/extended/v1/faucets/btc?address=<bcrt1…>&xlarge=true` (no body)                     |
| Early-unlock (KMS) signing service             | `https://r25rniyw12.execute-api.eu-west-1.amazonaws.com/v1/v1` (note the doubled `/v1`: stage + route) |
| Signer-manager                             | `ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager`                                             |
| Bond daemon (creates bonds + calc-rewards) | VPS `root@178.104.61.86:/root/bond-daemon`, admin `ST1V2ASRWGR81W7GBN1Z4W2JQKXJWCADPVZG30X45`          |

## Record → replay

Replay (offline) is the default; recording is a raw `npx jest` with env vars —
no wrapper script. Always run from the package dir.

```sh
# ALWAYS run from the package dir:
cd packages/bitcoin-staking

# replay (offline, default) — partial or full (~1 min):
npx jest tests/privatenet/actions/<name> --collectCoverage=false
npx jest tests/privatenet --collectCoverage=false

# record ONE suite (live). RECORD=1 disables the fetch mock, hits the live net,
# and captures every request/response into that suite's fixture file:
NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
POLL_INTERVAL=10000 STACKS_TX_TIMEOUT=300000 BITCOIN_TX_TIMEOUT=600000 \
RECORD=1 npx jest tests/privatenet/actions/<name> --runInBand --collectCoverage=false

# record the FULL suite, hands-off. This is the one canonical full-record
# command; takes a few hours (~2 min BTC blocks):
NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
STACKS_TX_TIMEOUT=300000 BITCOIN_TX_TIMEOUT=600000 \
FRESH_ACCOUNT_SEED="privatenet-$(date +%F)" \
BOND_ADMIN_KEY=... RECORD=1 \
npx jest tests/privatenet --runInBand --collectCoverage=false
```

After recording, ALWAYS verify offline replay passes before moving on.

- Run order is lexicographical by path (`tests/helpers/alpha-sequencer.js`); a
  suite that must run in a fixed position gets a numeric filename prefix. None
  currently need one.
- `FRESH_ACCOUNT_SEED` defaults to today so seed-derived fresh accounts never
  collide with a previous record on a non-wiped chain.
- `BOND_ADMIN_KEY` is only needed to re-record `setup-bond`; env-only, never commit it.

## Recording hooks (hands-off)

Two RECORD-only jest hooks (wired in the shared `jest.config.js`, so they apply
to privatenet exactly as to regtest) make a live re-record largely unattended:

- `tests/helpers/jest-record-preflight.ts` (globalSetup) — once, before the run.
  Regtest wipes/reboots a wedged chain; **privatenet can't be reset**, so it
  instead does a read-only reachability check and fails FAST with a clear
  message if the node is unreachable, not serving pox-5, or trailing the BTC
  tip (bound by `PRIVATENET_MAX_LAG`, default 6) — rather than letting every
  test hang on its own timeout.
- `tests/helpers/jest-record-retry.ts` (setupFilesAfterEnv) — retries a flaky
  RECORD attempt (`RECORD_RETRIES`, default 3), discarding the partial fixtures
  that attempt wrote so the rerun records clean. Inert under replay: a replay
  failure is a real regression, never retried.

## Recording rules (each one earned the hard way)

1. **Serial only.** Never record two suites (or the same suite twice)
   concurrently — shared sender accounts race nonces and you record `BadNonce`
   rejections into the fixtures.
2. **Record with default env.** Replay runs with no env overrides; a fixture
   recorded under `BOND_INDEX=3 STAKER=x` won't match a default replay.
3. **One fixture phase per broadcast.** `POST /v2/transactions` and BTC `/tx`
   are keyed by path only, so two broadcasts in one phase overwrite each other.
   Switch phases with `useFixtures('<key>-<phase>')` before every broadcast
   after the first (see `helpers/mock.ts`).
4. **Phase-switch before changed re-reads.** If a test reads the same endpoint
   before and after a state change, route the after-read to `'<key>-after'` or
   replay collapses both to the latest body.
5. **Deterministic fresh accounts.** Use
   `freshFundedStxAccount({ label: '<file>-<n>' })` (`helpers/fresh-account.ts`)
   — labels are seed-derived so record and replay get the same addresses.
   Labels must be unique ACROSS files.
6. **`postConditionMode: 'allow'`** on every asset-moving pox-5 call
   (stake/update/unstake, register, announce, rewards) — default Deny mode turns
   them into `abort_by_post_condition`, even on intended-abort probes.
7. **Honest skips, no fake passes.** When a live precondition is unmet
   (not enrolled, no UTXO, wrong cosigner), log + assert the observed state and
   return. Never `expect(true).toBe(true)`.
8. **Chain hiccups are normal.** Blocks are ~2 min; the chain occasionally
   stalls and wipes ~daily. A failed record is usually environmental — check
   the tip age and retry.
9. **Fixture routing follows the file shape.** A single-flow suite routes its
   base phase in `beforeAll(() => useFixtures('<key>'))` and switches phases
   in-test only where a read/broadcast changes state. A multi-scenario suite
   (independent `test()`s, no shared setup) routes per-test instead — each test
   calls its own `useFixtures`, and there is no base phase to hoist. Don't force
   a `beforeAll` onto a multi-scenario file.
10. **Confirmation helper — pick by what you assert.** For a tx you expect to
   MINE (happy path or a runtime `abort_by_response` probe), use
   `broadcastAndWaitForTransaction(tx, network)` — it broadcasts, waits out of the
   prepare phase, polls `/extended`, and returns the `TxRecord` you branch on
   (`tx_status` / `parseErrCode`). Don't hand-roll `broadcastTransaction` + a
   `waitForFulfilled` poll. The exception is a probe asserting *broadcast-time*
   rejection (`'error' in res`): the helper throws on that, so keep the raw
   `broadcastTransaction` and assert on `res.error` / `res.reason` there.

## Accounts (state drifts per wipe — always verify live)

| Account                            | Role                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `account4`                         | rich, nonce-stable, daemon-free — default funder + clean STX staker     |
| `account5`                         | allowlisted ("PoolXYZ") — L1 register/lockup flows                      |
| `account6`                         | allowlisted ("Tester A") — abort probes, signer grants, sBTC-less paths |
| `account1/2/3`                     | CONTENDED (other agents/daemons) — avoid for broadcasts                 |
| `account7/8`                       | not prefunded — fund in-test if needed                                  |
| fresh (`helpers/fresh-account.ts`) | derived from labels; self-funded; never collide                         |

Bond allowlists come from the daemon's Google Sheet; every bond includes the
sheet's standard + contract principals (e.g. FastPool `…TJFM.vault-1/2`).

## Early-unlock (KMS) early-exit

All daemon bonds embed `earlyUnlockBytes = 0x21 <early-unlock-pubkey> 0xac`, where
the pubkey is the leaf `m/48'/1'/0'/2'/0/0` of the signing service's xpub
(`GET /public-key`; wipe-stable). The ELSE-branch reclaim cosignature comes
from `POST /sign` (tx + input + prevout + witness_script + full BIP-32 path;
DER, low-S — append `01` sighash byte for the witness). End-to-end proof:
`actions/early-unlock-key-verify.test.ts` (key/sighash/sig equivalence) and
`actions/early-unlock-reclaim.test.ts` (on-chain reclaim). Helper:
`helpers/early-unlock.ts` (verify with `{ prehash: false }` — noble v2 default
sha256s the message otherwise).

## Layout

- `actions/` — small composable single-op tests (ENV-configurable).
- `e2e/` — multi-step flows (register→announce→reclaim, pools, lifecycles).
- `fixtures/` — recorded HTTP (`fixtures-<key>.json`) + `artifacts/`
  (btc-lock output consumed by `register-for-bond-l1`).
- `pox.ts` — pox-5 reads working around node quirks (`/v2/pox` omits pox-5 from
  `contract_versions[]`).
- `prep-stakers.ts` — one-off BTC/STX funding for the standard accounts.

## Picking up next time (session context)

- The **bond daemon** on the VPS is ours: creates every bond (allowlist from the
  Google Sheet, cached to `participants.json`), runs `calculate-rewards` per
  distribution cycle, and derives early-unlock `earlyUnlockBytes` from the live KMS
  API at setup time (nothing hardcoded). Health: `sh /root/bond-daemon/check.sh`;
  wipe ledger: `wipes.log`. `BOND_ADMIN_KEY` lives ONLY in the VPS `.env`.
- The operator `ST3NBRSFKX…` (not us) also runs `calculate-rewards` each cycle
  (usually first → our daemon no-ops with `u30`) but never creates bonds.
- `announce-l1-early-exit` is signed by the STAKER, not the admin.
- Fixture recorder stores bodies only; `helpers/mock.ts` re-adds HTTP 400 for
  rejection-shaped broadcast bodies on replay — don't remove that shim.
- Replay never touches chain lifecycle (`ensurePox5`/`networkReset` are
  regtest-only; privatenet tests must not call them).
- `rm -f fixtures-btc-lock*` also globs `fixtures-btc-lockup-roundtrip*` —
  be precise when clearing fixtures.
- Full L1 record chain, in order and serial: `btc-lock` (dynamic bond discovery,
  writes `fixtures/artifacts/btc-lock-<staker>.json`) → `register-for-bond-l1`
  (reads artifact) → `announce-early-exit` → `early-unlock-reclaim`.

## Current status / known skips

44/45 suites, 96/97 tests replay green; the ONE remaining skip is
`set-bond-admin` (POLICY: rotating the admin on the shared net would break the
daemon — never record it). `setup-bond` self-heals against the daemon-created
bond (recording its create-branch would front-run the daemon with a stripped
allowlist; the create path is continuously proven by the daemon itself).
Deleted as superseded: `setup-bond-2` (pre-early-unlock zero-byte earlyUnlockBytes),
`btc-reclaim` (early branch → `early-unlock-reclaim`; timelock →
`e2e/exit-l1-timelock-reclaim`). sBTC happy paths untestable (sbtc-deposit not
deployed) — abort paths covered. `BOND_ADMIN_KEY` is required only for
setup-bond RE-recording; env-only, never commit it.

## Reward payout

Same pox-5 mechanics the regtest reward suites encode (see
`tests/regtest/README.md` § Reward payout): sBTC-only rewards, a measured (not
pushed) pot, the calculate-rewards → signer-manager `claim-rewards` (settle) →
staker-`earned` order over the FULL active-bond set, and the two-hop payout via
the signer-manager. What privatenet adds over regtest: a **real signer set**, so
the L1 sBTC-withdrawal path completes to an actual BTC sweep — the final leg
regtest can only assert as a request+lock. Reward-arrival validation on the
hosted net is tracked separately (see the reward-validation handoff); the
`reward-payout.e2e` / `rewards-claim-receive` suites here exercise the routes.
