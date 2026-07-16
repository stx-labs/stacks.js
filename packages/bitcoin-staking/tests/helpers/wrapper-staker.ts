/**
 * A minimal Clarity "vault" that IS the staker of record for pox-5 — the test
 * fixture behind the contract-principal-staking suite (see
 * specs/contract-principal-staking.md).
 *
 * pox-5 has no delegation: staker identity is `tx-sender`, and a nested
 * `user → wrapper → pox-5` call keeps the USER as `tx-sender`. So for a CONTRACT
 * to be the staker, the pox-5 call must originate inside the contract's own body
 * under `as-contract?` — then `tx-sender == contract-caller == <deployer>.<name>`.
 * This wrapper does exactly that: each entry point forwards to pox-5 wrapped in
 * `as-contract?`, so the wrapper (a contract principal) becomes the staker, holds
 * the locked funds, and appears in the staker/bond maps under its own principal.
 *
 * This fork runs Clarity 4, whose sender-switch is the post-condition-scoped
 * `as-contract?` (the classic `as-contract` was removed). Its first argument is an
 * asset-allowance list bounding what the contract may move; a test wrapper uses the
 * `with-all-assets-unsafe` escape hatch (legal only inside `as-contract?`). The body
 * returns a response, which `as-contract?` flattens — so the entry point relays
 * pox-5's own `(response …)` result.
 *
 * Grown slice by slice: Slice 1 = pure-STX `stake`/`unstake`; Slice 2 =
 * `register-sbtc` (the `(err sats)` bond path); Slice 4 = `register-l1` (the
 * `(ok {SPV tuple})` bond path — the wrapper re-declares pox-5's deep response type).
 *
 * The source is an INLINE string (not read from the regtest-env checkout), so —
 * unlike deploy-signer-manager — the deploy tx records and replays offline; no
 * `test.skip` under replay.
 */
import type { StacksNetwork } from '@stacks/network';
import { deployContract } from './deploy';

/** Contract name the wrapper deploys under (`<deployer>.contract-principal-staker`). */
export const WRAPPER_STAKER_NAME = 'contract-principal-staker';

/**
 * The wrapper `.clar` source, with the boot-contract pox-5 principal substituted.
 * `signer-manager-trait` is defined inside pox-5 (pox-5.clar `define-trait`), so
 * the trait reference is boot-relative too. Every pox-5 call runs under
 * `as-contract?` with the `with-all-assets-unsafe` allowance — that is what makes
 * this contract the staker of record and lets pox-5 move its locked STX.
 *
 * Every forwarder passes `none` for pox-5's optional `signer-calldata`: the
 * regtest signer-manager accepts it (mirrors `stake.test.ts`, which omits it).
 */
export function wrapperStakerSource(bootAddress: string): string {
  const pox5 = `'${bootAddress}.pox-5`;
  return `(use-trait signer-manager-trait ${pox5}.signer-manager-trait)

(define-public (stake (signer-manager <signer-manager-trait>)
                      (amount-ustx uint)
                      (num-cycles uint)
                      (start-burn-ht uint))
  (as-contract? ((with-all-assets-unsafe))
    (try! (contract-call? ${pox5} stake signer-manager amount-ustx num-cycles start-burn-ht none))))

(define-public (unstake (old-signer-manager <signer-manager-trait>))
  (as-contract? ((with-all-assets-unsafe))
    (try! (contract-call? ${pox5} unstake old-signer-manager))))

(define-public (register-sbtc (bond-index uint)
                              (signer-manager <signer-manager-trait>)
                              (amount-ustx uint)
                              (sats uint))
  (as-contract? ((with-all-assets-unsafe))
    (try! (contract-call? ${pox5} register-for-bond
       bond-index signer-manager amount-ustx (err sats) none))))

(define-public (register-l1 (bond-index uint)
                            (signer-manager <signer-manager-trait>)
                            (amount-ustx uint)
                            (btc-lockup { outputs: (list 10 { height: uint,
                              tx: (buff 100000), output-index: uint, header: (buff 80),
                              leaf-hashes: (list 14 (buff 32)), tx-count: uint,
                              tx-index: uint, amount: uint, unlock-burn-height: uint }),
                              staker-unlock-bytes: (buff 683) }))
  (as-contract? ((with-all-assets-unsafe))
    (try! (contract-call? ${pox5} register-for-bond
       bond-index signer-manager amount-ustx (ok btc-lockup) none))))

(define-public (announce-early-exit (old-signer-manager <signer-manager-trait>))
  (as-contract? ((with-all-assets-unsafe))
    ;; tx-sender is THIS contract under as-contract?, satisfying pox-5's
    ;; contract-caller == tx-sender == staker gate (announce-l1-early-exit:1220).
    (try! (contract-call? ${pox5} announce-l1-early-exit tx-sender old-signer-manager))))
`;
}

/**
 * Deploy the wrapper from `deployerKey` (conventionally `ACCOUNTS.admin` — a
 * daemon-free, clean-nonce account). Idempotent via `deployContract` (a name that
 * already exists resolves rather than throwing). Returns `<deployer>.<name>`.
 */
export function deployWrapperStaker(args: {
  deployerKey: string;
  bootAddress: string;
  network: StacksNetwork;
}): Promise<string> {
  return deployContract({
    contractName: WRAPPER_STAKER_NAME,
    codeBody: wrapperStakerSource(args.bootAddress),
    senderKey: args.deployerKey,
    network: args.network,
  });
}
