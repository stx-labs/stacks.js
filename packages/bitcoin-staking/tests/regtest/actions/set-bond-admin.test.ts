/**
 * Rotate `bond-admin` via `set-bond-admin`: move it from the current admin to a
 * temp account and back, asserting the on-chain `bond-admin` data-var each time.
 * Only the current admin may call it, so the rotate-back is sent by the temp one.
 */
import { buildSetBondAdmin } from '../../../src';
import { cvToValue, deserializeCV, type PrincipalCV } from '@stacks/transactions';
import { ACCOUNTS, REGTEST_KEYS, getAccount } from '../regtest';
import { ENV, getNetwork } from '../../helpers/utils';
import { broadcastAndWait, ensurePox5, getNextNonce } from '../../helpers/wait';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';

jest.setTimeout(20 * 60_000);

const network = getNetwork();
const admin = ACCOUNTS.admin; // current pox_5_bond_admin
const tempAdmin = getAccount(REGTEST_KEYS.account5); // prefunded; holds the role mid-test
const FEE = 10_000n;
const POX5 = 'ST000000000000000000002AMW42H';

/** Read the `bond-admin` data-var (node-only). */
async function fetchBondAdmin(): Promise<string> {
  const res = await fetch(`${ENV.STACKS_API}/v2/data_var/${POX5}/pox-5/bond-admin?proof=0`);
  const { data } = (await res.json()) as { data: string };
  return cvToValue(deserializeCV(data) as PrincipalCV) as string;
}

const setBondAdmin = async (newAdmin: string, from: typeof admin) =>
  broadcastAndWait(
    signTransaction(
      await buildSetBondAdmin({
        newAdmin,
        publicKey: from.publicKey,
        fee: FEE,
        nonce: await getNextNonce(from.address),
        network,
      }),
      from.key
    ),
    from.address,
    network
  );

beforeAll(async () => {
  useFixtures('set-bond-admin');
  await ensurePox5();
}, 20 * 60_000);

test('set-bond-admin: rotate to a temp admin and back', async () => {
  expect(await fetchBondAdmin()).toBe(admin.address);

  await setBondAdmin(tempAdmin.address, admin);
  useFixtures('set-bond-admin-rotated');
  expect(await fetchBondAdmin()).toBe(tempAdmin.address);

  await setBondAdmin(admin.address, tempAdmin);
  useFixtures('set-bond-admin-restored');
  expect(await fetchBondAdmin()).toBe(admin.address);
});
