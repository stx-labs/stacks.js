/**
 * Fresh, randomly-derived + funded test accounts for E2E tests.
 *
 * WHY: most E2E flakes are ACCOUNT-STATE COLLISIONS — the small REGTEST_KEYS
 * pool is reused across tests, so once a test stakes/registers an account,
 * later tests on the same account fail (err u19 ALREADY_STAKED, wrong
 * bondIndex, etc.). A freshly-derived account has NO prior on-chain state, so
 * STX-only stake tests can never collide.
 *
 * SCOPE / LIMITATION: a fresh account is NOT allowlisted in any bond. The
 * daemon only allowlists the sheet accounts (account5-8). So fresh accounts are
 * safe for STX-only `stake` (no allowlist needed) but CANNOT be used for
 * register-for-bond (which requires an allowlisted principal). L1/sBTC register
 * tests must keep using the allowlisted accounts and self-heal on existing
 * membership instead.
 *
 * Funding: STX via a makeSTXTokenTransfer from a rich funder (default account4,
 * ~10B STX, not used as a staker elsewhere); confirmation is awaited node-only
 * via the funder's nonce (see {@link fundStx}).
 */
// @ts-ignore — ESM; ts-jest transforms via jest.config.js
import { sha256 } from '@noble/hashes/sha2.js';
// @ts-ignore — ESM; ts-jest transforms via jest.config.js
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { bytesToHex } from '@stacks/common';
import type { StacksNetwork } from '@stacks/network';
import { getAccount, REGTEST_KEYS, type Account } from '../regtest/regtest';
import { fundStx, getNextNonce } from './wait';
import { isMocking } from './utils';

// Deterministic key material so RECORD and replay derive the SAME accounts —
// otherwise fixtures (keyed by address) never match on replay. Bump the seed to
// mint a disjoint set (e.g. re-recording on a non-wiped chain where the prior
// accounts are already staked).
const FRESH_SEED = process.env.FRESH_ACCOUNT_SEED ?? 'privatenet-fresh-v1';

/**
 * Derive an account deterministically from `label` (stable across runs). Same
 * shape as `getAccount`, so it drops into existing build/sign call-sites. Give
 * each account a distinct label (e.g. the loop index) to avoid collisions.
 */
export function deriveFreshAccount(label: string | number = 0): Account {
  const raw = sha256(utf8ToBytes(`${FRESH_SEED}:${label}`)); // 32 bytes → valid secp256k1 scalar
  // Stacks private keys carry a trailing `01` compression marker.
  const key = bytesToHex(raw) + '01';
  return getAccount(key);
}

/**
 * Derive a fresh account and fund it with `amountUstx` from `funderName`
 * (default account4, rich + uncontended). Awaits funding confirmation.
 *
 * Under replay (`isMocking`) the funding tx is skipped — the fixture is the
 * already-funded state — and the account is derived deterministically from
 * `label`, so record and replay produce identical addresses.
 */
export async function freshFundedStxAccount(opts: {
  network: StacksNetwork;
  amountUstx: bigint;
  /** Stable label (e.g. loop index) so record and replay derive the same account. */
  label?: string | number;
  funderName?: keyof typeof REGTEST_KEYS;
  fee?: bigint;
}): Promise<Account> {
  const account = deriveFreshAccount(opts.label ?? 0);
  // account4: rich, nonce-stable, daemon-free (account1 is contended).
  const funder = getAccount(REGTEST_KEYS[opts.funderName ?? 'account4']);

  if (!isMocking) {
    const nonce = await getNextNonce(funder.address);
    console.log(
      `[fresh-account] funding ${account.address} with ${opts.amountUstx} uSTX from ${funder.address} (nonce ${nonce})`
    );
    await fundStx({
      funder,
      recipient: account.address,
      amountUstx: opts.amountUstx,
      nonce,
      fee: opts.fee,
      network: opts.network,
    });
    console.log(`[fresh-account] funded ${account.address} ✓`);
  }

  return account;
}
