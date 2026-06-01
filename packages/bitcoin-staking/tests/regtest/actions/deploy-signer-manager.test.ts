import { ACCOUNTS } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { deployContract, loadContractSource } from '../../helpers/deploy';
import { ensurePox5 } from '../../helpers/wait';

const BOOT = 20 * 60_000;
jest.setTimeout(BOOT);

const network = getNetwork();
const deployer = ACCOUNTS.admin; // STACKING_KEYS[0]; idle while the daemon is disabled

// keep-alive staking now runs on dedicated accounts, so the admin deployer is
// free — no need to disable staking.
beforeAll(() => ensurePox5(), BOOT);

test('deploy pox-5 signer-manager contract', async () => {
  const source = loadContractSource('stacking/contracts/pox-5-signer.clar', {
    bootAddress: network.bootAddress,
    deployer: deployer.address,
  });

  // deployContract confirms node-only (waits until the contract is queryable on
  // the node via /v2/contracts/interface), then returns its `<addr>.<name>` id.
  const contractId = await deployContract({
    contractName: 'signer-manager',
    codeBody: source,
    senderKey: deployer.key,
    network,
  });

  expect(contractId).toBe(`${deployer.address}.signer-manager`);
});
