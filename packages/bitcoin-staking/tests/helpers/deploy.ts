/**
 * Contract-deploy helpers for the regtest flow. Reads `.clar` sources from the
 * regtest env and rewrites the placeholders the way the env's btc-staker does:
 * boot-contract sugar (` .pox-5`) and the baked deployer address.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  broadcastTransaction,
  getAddressFromPrivateKey,
  makeContractDeploy,
} from '@stacks/transactions';
import type { StacksNetwork } from '@stacks/network';
import { ENV } from './utils';
import { waitForContract } from './wait';

const DEPLOYER_PLACEHOLDER = 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4';

/** Read a regtest `.clar` source and apply the standard placeholder rewrites. */
export function loadContractSource(
  relPath: string,
  opts: { bootAddress: string; deployer: string }
): string {
  return readFileSync(join(ENV.REGTEST_WORKING_DIR, relPath), 'utf8')
    .replaceAll(' .pox-5', ` '${opts.bootAddress}.pox-5`)
    .replaceAll(DEPLOYER_PLACEHOLDER, opts.deployer);
}

/**
 * Deploy a contract and wait (node-only) until it's queryable on-chain. Returns
 * the deployer-relative contract id `<address>.<name>`. Idempotent: a name that
 * already exists (`ContractAlreadyExists`, or already present before broadcast)
 * resolves successfully rather than throwing — safe to call on a reused chain.
 * Confirmation is via `/v2/contracts/interface` (no `/extended`).
 */
export async function deployContract(args: {
  contractName: string;
  codeBody: string;
  senderKey: string;
  network: StacksNetwork;
}): Promise<string> {
  const address = getAddressFromPrivateKey(args.senderKey, args.network);
  const contractId = `${address}.${args.contractName}`;

  const tx = await makeContractDeploy({
    contractName: args.contractName,
    codeBody: args.codeBody,
    senderKey: args.senderKey,
    network: args.network,
  });
  const res = await broadcastTransaction({ transaction: tx, network: args.network });
  if ('error' in res) {
    const reason = 'reason' in res ? res.reason : '';
    if (reason !== 'ContractAlreadyExists') {
      throw new Error(`deploy ${args.contractName} rejected: ${res.error} — ${reason}`);
    }
    console.log(`deploy ${args.contractName}: already exists`);
  } else {
    console.log(`deploy ${args.contractName} txid`, res.txid);
  }
  await waitForContract(address, args.contractName);
  return contractId;
}
