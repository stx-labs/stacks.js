/**
 * Dev utility (NOT a test): rotate `bond-admin` back to the env admin
 * (`ST1V2ASRWG…`) from the multisig, in case a killed/failed multisig run left
 * the role on the 2-of-3. Run with the live node:
 *   STACKS_API=http://host.docker.internal:3999 npx tsx tests/regtest/restore-bond-admin.tsx
 */
import { generateWallet, generateNewAccount } from '@stacks/wallet-sdk';
import {
  broadcastTransaction,
  deserializeCV,
  cvToValue,
  TransactionSigner,
  getAddressFromPrivateKey,
} from '@stacks/transactions';
import { STACKS_TESTNET } from '@stacks/network';
import { getPublicKeyFromPrivate } from '@stacks/encryption';
import { buildSetBondAdmin } from '../../src';

const API = process.env.STACKS_API ?? 'http://host.docker.internal:3999';
const SEED =
  'proof pet high door join three name tissue pioneer hub notable valid enlist august balcony panda match loud undo primary gain ostrich fluid note';
const ADMIN = 'ST1V2ASRWGR81W7GBN1Z4W2JQKXJWCADPVZG30X45';
const MULTISIG = 'SN11V09J2NDPJ10KQFBFSFTTCDG83ZKYFZE8F92RB';
const network = { ...STACKS_TESTNET, client: { baseUrl: API } };

const acct = (k: string) => ({
  key: k,
  address: getAddressFromPrivateKey(k, 'testnet'),
  publicKey: getPublicKeyFromPrivate(k),
});
const nonce = async (a: string) =>
  (await (await fetch(`${API}/v2/accounts/${a}?proof=0`)).json()).nonce;
const admin = async () =>
  cvToValue(
    deserializeCV(
      (await (await fetch(`${API}/v2/data_var/ST000000000000000000002AMW42H/pox-5/bond-admin?proof=0`)).json()).data
    )
  );

(async () => {
  let w = await generateWallet({ secretKey: SEED, password: 'test' });
  w = generateNewAccount(w);
  w = generateNewAccount(w);
  const ms = w.accounts.slice(0, 3).map(a => acct(a.stxPrivateKey));
  if ((await admin()) === ADMIN) return console.log('already baseline');
  const tx = await buildSetBondAdmin({
    newAdmin: ADMIN,
    publicKeys: ms.map(a => a.publicKey),
    numSignatures: 2,
    fee: 10_000n,
    nonce: await nonce(MULTISIG),
    network,
  });
  const s = new TransactionSigner(tx);
  s.signOrigin(ms[0].key);
  s.signOrigin(ms[1].key);
  s.appendOrigin(ms[2].publicKey);
  console.log('restore broadcast', await broadcastTransaction({ transaction: tx, network }));
})().catch(e => {
  console.error(e);
  process.exit(1);
});
