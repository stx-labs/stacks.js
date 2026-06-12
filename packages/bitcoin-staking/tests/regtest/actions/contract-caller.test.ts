// u22 (UnauthorizedCaller) needs a proxy contract actually calling pox-5 and
// is deferred with u12/13/14 — see CONTRACT-COVERAGE.md.
import {
  buildAllowContractCaller,
  buildDisallowContractCaller,
  fetchAllowanceContractCallers,
} from '../../../src';
import { REGTEST_KEYS, SIGNER_MANAGER, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import {
  broadcastAndWaitForTransaction,
  ensurePox5,
  getNextNonce,
  getPoxInfo,
} from '../../helpers/wait';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
const account = getAccount(REGTEST_KEYS.account4);
const contractCaller = SIGNER_MANAGER; // any contract principal works for the allowance entry
const FEE = 10_000n;

beforeAll(async () => {
  useFixtures('contract-caller');
  await ensurePox5();
}, 5 * 60_000);

test('allow-contract-caller (with expiry) → visible → disallow → gone', async () => {
  const pox = await getPoxInfo();

  const allowTx = await buildAllowContractCaller({
    contractCaller,
    untilBurnHeight: pox.currentBurnchainBlockHeight + 500,
    publicKey: account.publicKey,
    fee: FEE,
    nonce: await getNextNonce(account.address),
    network,
  });
  const allowed = await broadcastAndWaitForTransaction(signTransaction(allowTx, account.key), network);
  expect(allowed.tx_status).toBe('success');

  useFixtures('contract-caller-allowed');
  const entry = await fetchAllowanceContractCallers({
    sender: account.address,
    contractCaller,
    network,
  });
  expect(entry.callerAllowed).toBe(true);
  expect(entry.callerExpiryHeight).toBeGreaterThan(pox.currentBurnchainBlockHeight);

  useFixtures('contract-caller-disallowed');
  const disallowTx = await buildDisallowContractCaller({
    contractCaller,
    publicKey: account.publicKey,
    fee: FEE,
    nonce: await getNextNonce(account.address),
    network,
  });
  const disallowed = await broadcastAndWaitForTransaction(
    signTransaction(disallowTx, account.key),
    network
  );
  expect(disallowed.tx_status).toBe('success');

  useFixtures('contract-caller-final');
  const after = await fetchAllowanceContractCallers({
    sender: account.address,
    contractCaller,
    network,
  });
  expect(after.callerAllowed).toBe(false);
});
