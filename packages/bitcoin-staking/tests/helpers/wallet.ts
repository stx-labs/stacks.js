/**
 * Generic wallet + faucet helpers for the composable `tests/actions/` ops.
 *
 * Net-agnostic: everything reads `ENV.STACKS_API`/`ENV.NETWORK_ID` (utils.ts), so
 * the same helper serves regtest, privatenet and testnet-pox5 — point the env at
 * the target net. These are the primitives we'd expose as CLI actions if we had a
 * CLI; for now they back the `tests/actions/*` action-tests.
 *
 * Like btc-wallet.ts, the faucet call uses the real `globalThis.fetch` so it works
 * on a live run (`RECORD=1` disables jest-fetch-mock); action-tests are live-only.
 */
// @ts-ignore — ESM; ts-jest transforms via jest.config.js
import { generateSecretKey, generateWallet } from '@stacks/wallet-sdk';
import { getAccount, type Account } from '../regtest/regtest';
import { ENV } from './utils';

export interface GeneratedAccount {
  /** 24-word BIP-39 seed phrase. */
  mnemonic: string;
  /** First account (m/44'/5757'/0'/0/0) — address + keys, same shape as getAccount. */
  account: Account;
}

/**
 * Generate a fresh 24-word seed phrase and derive its FIRST Stacks account —
 * exactly the `generateWallet -> accounts[0].stxPrivateKey` path used for the
 * bond-admin (see helpers/bondAdmin.ts). Address is derived for the testnet
 * version byte (ST…), valid on every testnet-family net we target.
 */
export async function generateAccount(): Promise<GeneratedAccount> {
  const mnemonic = generateSecretKey(256); // 256 bits -> 24 words
  const wallet = await generateWallet({ secretKey: mnemonic, password: '' });
  const account = getAccount(wallet.accounts[0].stxPrivateKey);
  return { mnemonic, account };
}

/**
 * POST the STX faucet for `address` on the configured net. Returns the faucet
 * txid (caller waits for confirmation). Throws on a non-ok / unsuccessful faucet.
 */
export async function stxFaucet(address: string): Promise<string> {
  const url = `${ENV.STACKS_API}/extended/v1/faucets/stx?address=${encodeURIComponent(address)}`;
  const resp = await globalThis.fetch(url, { method: 'POST' });
  const json = (await resp.json().catch(() => ({}))) as { success?: boolean; txId?: string };
  if (!resp.ok || !json.success || !json.txId) {
    throw new Error(`stx faucet ${resp.status} for ${address}: ${JSON.stringify(json)}`);
  }
  console.log(`[wallet] stx faucet funded ${address}: ${json.txId}`);
  return json.txId;
}
