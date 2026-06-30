import { ACCOUNTS } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { deployContract, loadContractSource } from '../../helpers/deploy';
import { ensurePox5 } from '../../helpers/wait';

const BOOT = 5 * 60_000;
jest.setTimeout(BOOT);

const network = getNetwork();
const deployer = ACCOUNTS.admin;

// Live-only: loads the .clar source from the regtest-env checkout, which is
// not available offline/CI — skip under replay.
const liveTest = process.env.RECORD === '1' ? test : test.skip;

beforeAll(() => (process.env.RECORD === '1' ? ensurePox5() : undefined), BOOT);

liveTest('deploy pox-5 signer-manager contract', async () => {
  // The SM3VDX… `deployer` placeholder is the sbtc-token/-registry OWNER
  // (ACCOUNTS.sbtcDeployer), NOT the account deploying this contract. Passing
  // the test deployer makes the contract reference <test-addr>.sbtc-token,
  // which doesn't exist → analysis abort → the deploy never lands.
  const source = loadContractSource('stacking/contracts/pox-5-signer.clar', {
    bootAddress: network.bootAddress,
    deployer: ACCOUNTS.sbtcDeployer.address,
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
