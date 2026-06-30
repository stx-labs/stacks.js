/**
 * The pox-5 `bond-admin` account, shared by the regtest and privatenet suites.
 *
 * The env's `pox_5_bond_admin` (devnet `stacks-krypton-miner.toml` AND the hosted
 * private testnet) is a single wallet-derived account, `ST1V2ASRWG…`. Its private
 * key is a SHARED SECRET, so it is NOT hardcoded here — supply it via the
 * `BOND_ADMIN_KEY` env var from a gitignored `.env` (see `.env.example`), loaded
 * inline when running live/record:
 *   set -a; . ./.env; set +a
 * Derive the key once from the bond-admin seed phrase with `@stacks/wallet-sdk`
 * (`generateWallet → accounts[0].stxPrivateKey`); the result is `ST1V2ASRWG…`.
 *
 * Replay/offline runs don't set `BOND_ADMIN_KEY`: signing is mocked there, so we
 * return the public address with a placeholder signer (the address is all the
 * assertions read).
 */
import { REGTEST_KEYS, getAccount, type Account } from '../regtest/regtest';
import { isMocking } from './utils';

/** Public principal of the env's `pox_5_bond_admin` — safe to commit. */
export const BOND_ADMIN_ADDRESS = 'ST1V2ASRWGR81W7GBN1Z4W2JQKXJWCADPVZG30X45';

/** Resolve the bond-admin account (real key from env, or replay placeholder). */
export async function getBondAdminAccount(): Promise<Account> {
  const key = process.env.BOND_ADMIN_KEY;
  if (key) {
    const account = getAccount(key);
    if (account.address !== BOND_ADMIN_ADDRESS) {
      throw new Error(
        `BOND_ADMIN_KEY derives ${account.address}, expected ${BOND_ADMIN_ADDRESS}`
      );
    }
    return account;
  }
  if (!isMocking) {
    throw new Error(
      'BOND_ADMIN_KEY is required for live/record runs — set it in .env (see .env.example) and load it inline'
    );
  }
  // Replay: the key is unused (broadcast/signing is mocked); only the address is
  // asserted, so pin it on a placeholder signer.
  return { ...getAccount(REGTEST_KEYS.account4), address: BOND_ADMIN_ADDRESS };
}
