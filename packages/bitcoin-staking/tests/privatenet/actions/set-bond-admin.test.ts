/**
 * Privatenet action: rotate the pox-5 `bond-admin` data-var to NEW_ADMIN.
 * Hard to reverse -- only the CURRENT admin can call it; verify NEW_ADMIN first.
 *
 * Single-sig (default) signs with helpers/bondAdmin (BOND_ADMIN_KEY in .env).
 * Set MULTISIG_SEED when the current admin is a 2-of-3 multisig instead:
 * derives account[0,1,2] from the seed, signs with the first MULTISIG_M keys
 * and appends the rest as pubkeys. Seed is ENV-only, never hard-coded.
 *
 * Skipped: rotating the admin on the shared net would break the bond daemon
 * (see privatenet/README.md "Current status"). Do not un-skip without a plan.
 *
 * RECORD (single-sig):
 *   NEW_ADMIN=SN... NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     RECORD=1 npx jest tests/privatenet/actions/set-bond-admin.test.ts --runInBand --collectCoverage=false --verbose
 */
import { broadcastTransaction } from '@stacks/transactions';
import { getPublicKeyFromPrivate } from '@stacks/encryption';
import { generateNewAccount, generateWallet } from '@stacks/wallet-sdk';
import { buildSetBondAdmin } from '../../../src';
import { getNetwork } from '../../helpers/utils';
import { getNextNonce, waitForTransaction } from '../../helpers/wait';
import { signTransaction, signMultiSigTransaction } from '../../helpers/sign';
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { useFixtures } from '../../helpers/mock';

jest.setTimeout(60 * 60_000);

const network = getNetwork();
const FEE = 10_000n;
const NEW_ADMIN = process.env.NEW_ADMIN ?? 'ST1V2ASRWGR81W7GBN1Z4W2JQKXJWCADPVZG30X45';
const MULTISIG_SEED = process.env.MULTISIG_SEED;
const MULTISIG_M = Number(process.env.MULTISIG_M ?? 2);
const MULTISIG_ADDRESS =
  process.env.MULTISIG_ADDRESS ?? 'SN26PZRYAJGJMV3TTY81ZRG0W97VAXEEQ148NFJ31';

/** Derive the first 3 Stacks accounts (priv + pub) from a mnemonic. */
async function deriveMultisig(seed: string) {
  let wallet = await generateWallet({ secretKey: seed, password: '' });
  while (wallet.accounts.length < 3) wallet = generateNewAccount(wallet);
  const keys = wallet.accounts.slice(0, 3).map(a => a.stxPrivateKey);
  const pubs = keys.map(k => getPublicKeyFromPrivate(k));
  return { keys, pubs };
}

test.skip('set-bond-admin: rotate bond-admin to NEW_ADMIN', async () => {
  useFixtures('set-bond-admin');

  if (MULTISIG_SEED) {
    // Multisig current admin (e.g. revert SN26 -> shared admin).
    const { keys, pubs } = await deriveMultisig(MULTISIG_SEED);
    console.log('set-bond-admin (multisig)', {
      from: MULTISIG_ADDRESS,
      m: MULTISIG_M,
      n: pubs.length,
      newAdmin: NEW_ADMIN,
    });

    const unsigned = await buildSetBondAdmin({
      newAdmin: NEW_ADMIN,
      publicKeys: pubs,
      numSignatures: MULTISIG_M,
      fee: FEE,
      nonce: await getNextNonce(MULTISIG_ADDRESS),
      network,
    });

    const signerKeys = keys.slice(0, MULTISIG_M);
    const appendPubs = pubs.slice(MULTISIG_M);
    const transaction = signMultiSigTransaction(unsigned, signerKeys, appendPubs);

    const res = await broadcastTransaction({ transaction, network });
    if ('error' in res) {
      throw `broadcast rejected: ${res.error} — ${'reason' in res ? res.reason : ''}`;
    }
    console.log('set-bond-admin txid', res.txid);
    const result = await waitForTransaction(res.txid);
    console.log('result', result.tx_status, JSON.stringify(result.tx_result ?? {}));
    expect(result.tx_status).toBe('success');
    return;
  }

  // Single-sig current admin (.env BOND_ADMIN_KEY).
  const admin = await getBondAdminAccount();
  console.log('set-bond-admin (single-sig)', {
    currentAdmin: admin.address,
    newAdmin: NEW_ADMIN,
  });

  const unsigned = await buildSetBondAdmin({
    newAdmin: NEW_ADMIN,
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
  });

  const transaction = signTransaction(unsigned, admin.key);
  const res = await broadcastTransaction({ transaction, network });
  if ('error' in res) {
    throw `broadcast rejected: ${res.error} — ${'reason' in res ? res.reason : ''}`;
  }
  console.log('set-bond-admin txid', res.txid);
  const result = await waitForTransaction(res.txid);
  console.log('result', result.tx_status, JSON.stringify(result.tx_result ?? {}));
  expect(result.tx_status).toBe('success');
});
