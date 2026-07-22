/**
 * An admin-gated pox-5 staking vault — successor to the wrapper
 * (`wrapper-staker.ts`), per specs/staker-vault.md.
 *
 * Same core mechanic as the wrapper: a CONTRACT PRINCIPAL is the staker of record,
 * reaching pox-5 via `as-contract?` (Clarity-4; see contract-principal-staking.md §6).
 * The vault adds two layers on top:
 *
 *   1. Ownership — ADMIN is the deployer, baked as `(define-constant ADMIN tx-sender)`
 *      at publish. No setter, no transfer-control: unchangeable by construction.
 *   2. Delegation — an admin-managed set of allowed callers. An allowed caller may
 *      trigger any of the proxied pox-5 routes (never the admin-only treasury/mgmt
 *      fns), with no funds and no admin key: the funds live on the vault, so the
 *      delegate just fires an already-funded action. (Kept a flat principal set, not
 *      per-fn — the tests exercise the proxied pox-5 routes, not access granularity.)
 *
 * Proxies the full 7 staker-side pox-5 routes. Treasury: admin-only `withdraw-stx`
 * and `withdraw-sbtc` (scoped `with-stx`/`with-ft` allowances); funding-in is a plain
 * transfer to the vault principal (no fn needed). Inline source → records + replays
 * offline (no `test.skip`).
 */
import type { StacksNetwork } from '@stacks/network';
import { deployContract } from './deploy';

/** Contract name the vault deploys under (`<deployer>.staker-vault`). */
export const STAKER_VAULT_NAME = 'staker-vault';

/**
 * The vault `.clar` source, with the boot pox-5 principal and the sBTC token
 * principal substituted. `ADMIN` is the deployer (fixed at publish). Every proxied
 * route runs its pox-5 call under `as-contract?` so the vault is the staker of
 * record; treasury withdraws use scoped allowances. `signer-calldata` is `none`
 * throughout (the regtest signer-manager accepts it — mirrors `wrapper-staker.ts`).
 */
export function stakerVaultSource(opts: { bootAddress: string; sbtcToken: string }): string {
  const pox5 = `'${opts.bootAddress}.pox-5`;
  const sbtc = `'${opts.sbtcToken}`;
  return `(use-trait signer-manager-trait ${pox5}.signer-manager-trait)

(define-constant ADMIN tx-sender)
(define-constant ERR_UNAUTHORIZED (err u100))

;; Set of callers the ADMIN has allowed to trigger the proxied pox-5 routes.
(define-map allowed principal bool)

;; The one gate every proxied route calls first: the ADMIN, or an allowed caller.
(define-private (assert-can)
  (ok (asserts! (or (is-eq contract-caller ADMIN)
                    (default-to false (map-get? allowed contract-caller)))
                ERR_UNAUTHORIZED)))

(define-private (assert-admin)
  (ok (asserts! (is-eq contract-caller ADMIN) ERR_UNAUTHORIZED)))

;; read-only view of the allowlist, so tests can assert grants/revocations directly.
(define-read-only (is-allowed (caller principal))
  (default-to false (map-get? allowed caller)))

;; --- admin-only permission management ---
(define-public (allow-caller (caller principal))
  (begin (try! (assert-admin)) (ok (map-set allowed caller true))))

(define-public (disallow-caller (caller principal))
  (begin (try! (assert-admin)) (ok (map-delete allowed caller))))

;; --- proxied pox-5 routes (full staker-side set) ---
(define-public (stake (signer-manager <signer-manager-trait>)
                      (amount-ustx uint) (num-cycles uint) (start-burn-ht uint))
  (begin (try! (assert-can))
    (as-contract? ((with-all-assets-unsafe))
      (try! (contract-call? ${pox5} stake signer-manager amount-ustx num-cycles start-burn-ht none)))))

(define-public (stake-update (signer-manager <signer-manager-trait>)
                             (old-signer-manager <signer-manager-trait>)
                             (cycles-to-extend uint) (amount-increase uint))
  (begin (try! (assert-can))
    (as-contract? ((with-all-assets-unsafe))
      (try! (contract-call? ${pox5} stake-update signer-manager old-signer-manager
         cycles-to-extend amount-increase none)))))

(define-public (unstake (old-signer-manager <signer-manager-trait>))
  (begin (try! (assert-can))
    (as-contract? ((with-all-assets-unsafe))
      (try! (contract-call? ${pox5} unstake old-signer-manager)))))

(define-public (unstake-sbtc (signer-manager <signer-manager-trait>) (amount-sats uint))
  (begin (try! (assert-can))
    (as-contract? ((with-all-assets-unsafe))
      (try! (contract-call? ${pox5} unstake-sbtc signer-manager amount-sats)))))

(define-public (update-bond-registration (signer-manager <signer-manager-trait>)
                                         (old-signer-manager <signer-manager-trait>))
  (begin (try! (assert-can))
    (as-contract? ((with-all-assets-unsafe))
      (try! (contract-call? ${pox5} update-bond-registration signer-manager old-signer-manager none)))))

(define-public (register-sbtc (bond-index uint) (signer-manager <signer-manager-trait>)
                              (amount-ustx uint) (sats uint))
  (begin (try! (assert-can))
    (as-contract? ((with-all-assets-unsafe))
      (try! (contract-call? ${pox5} register-for-bond
         bond-index signer-manager amount-ustx (err sats) none)))))

(define-public (register-l1 (bond-index uint) (signer-manager <signer-manager-trait>)
                            (amount-ustx uint)
                            (btc-lockup { outputs: (list 10 { height: uint,
                              tx: (buff 100000), output-index: uint, header: (buff 80),
                              leaf-hashes: (list 14 (buff 32)), tx-count: uint,
                              tx-index: uint, amount: uint, unlock-burn-height: uint }),
                              staker-unlock-bytes: (buff 683) }))
  (begin (try! (assert-can))
    (as-contract? ((with-all-assets-unsafe))
      (try! (contract-call? ${pox5} register-for-bond
         bond-index signer-manager amount-ustx (ok btc-lockup) none)))))

(define-public (announce-early-exit (old-signer-manager <signer-manager-trait>))
  (begin (try! (assert-can))
    (as-contract? ((with-all-assets-unsafe))
      ;; under as-contract? tx-sender AND contract-caller are the vault, satisfying
      ;; pox-5's contract-caller == tx-sender == staker gate.
      (try! (contract-call? ${pox5} announce-l1-early-exit tx-sender old-signer-manager)))))

;; --- treasury (admin-only; scoped allowances) ---
(define-public (withdraw-stx (amount uint) (recipient principal))
  (begin (try! (assert-admin))
    (as-contract? ((with-stx amount)) (try! (stx-transfer? amount tx-sender recipient)))))

(define-public (withdraw-sbtc (amount uint) (recipient principal))
  (begin (try! (assert-admin))
    (as-contract? ((with-ft ${sbtc} "sbtc-token" amount))
      (try! (contract-call? ${sbtc} transfer amount tx-sender recipient none)))))
`;
}

/**
 * Deploy the vault from `deployerKey` (that account becomes ADMIN). Idempotent via
 * `deployContract`. Returns `<deployer>.staker-vault`.
 */
export function deployStakerVault(args: {
  deployerKey: string;
  bootAddress: string;
  sbtcToken: string;
  network: StacksNetwork;
}): Promise<string> {
  return deployContract({
    contractName: STAKER_VAULT_NAME,
    codeBody: stakerVaultSource({ bootAddress: args.bootAddress, sbtcToken: args.sbtcToken }),
    senderKey: args.deployerKey,
    network: args.network,
  });
}
