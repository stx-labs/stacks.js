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
 * Funding: STX via a makeSTXTokenTransfer from a rich funder (default account1,
 * ~10B STX, not used as a staker elsewhere); confirmation is awaited node-only
 * via the funder's nonce (see fundStx in wait.ts).
 */
// @ts-ignore — ESM; ts-jest transforms via jest.config.js
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@stacks/common';
import type { StacksNetwork } from '@stacks/network';
import { getAccount, REGTEST_KEYS, type Account } from '../regtest/regtest';
import { fundStx, getNextNonce } from './wait';
import { isMocking } from './utils';

/**
 * Derive a brand-new random account (never seen on-chain). Returns the same
 * shape as `getAccount` so it drops into existing build/sign call-sites.
 */
export function deriveFreshAccount(): Account {
  const raw = secp256k1.utils.randomSecretKey() as Uint8Array;
  // Stacks private keys carry a trailing `01` compression marker.
  const key = bytesToHex(raw) + '01';
  return getAccount(key);
}

/**
 * Derive a fresh account and fund it with `amountUstx` from `funderName`
 * (default account1, rich + uncontended). Awaits funding confirmation.
 *
 * Under replay (`isMocking`) the funding tx is skipped — the fixture is the
 * already-funded state — but a fresh random account is still derived so the
 * test logic is identical online and offline.
 */
export async function freshFundedStxAccount(opts: {
  network: StacksNetwork;
  amountUstx: bigint;
  funderName?: keyof typeof REGTEST_KEYS;
  fee?: bigint;
}): Promise<Account> {
  const account = deriveFreshAccount();
  const funder = getAccount(REGTEST_KEYS[opts.funderName ?? 'account1']);

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
