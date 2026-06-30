/**
 * sBTC test helpers for the regtest bond flow.
 *
 * The pox-5 `register-for-bond` sBTC path calls `lock-sbtc`, which pulls sats
 * from the staker via `<sbtc-token>.transfer`. The node's miner config
 * (`stacks-krypton-miner.toml`) overrides pox-5's sBTC target to
 * `<admin>.sbtc-token` (`pox_5_sbtc_contract`), so the staker must hold a
 * balance in the admin-deployed `sbtc-token` (deployed by the env's btc-staker
 * daemon, or by `deploy-sbtc` here).
 *
 * Minting sBTC is gated: `sbtc-token.protocol-mint` only accepts a
 * `contract-caller` registered as the registry's `deposit-role` protocol
 * contract. The registry (deployed verbatim under `<admin>`) authorizes the
 * deployer-relative principal `<admin>.sbtc-deposit` at deploy time
 * (`active-protocol-contracts deposit-role .sbtc-deposit`). We satisfy that by
 * deploying a tiny `sbtc-deposit` shim whose `mint` passthrough calls
 * `protocol-mint` with the deposit-role flag `0x01` — `contract-caller` inside
 * `protocol-mint` is then `<admin>.sbtc-deposit`, which the registry accepts.
 *
 * `sbtc-deposit` must be deployed by the same principal that deployed
 * `sbtc-token` / `sbtc-registry` (the env's admin), so the `.sbtc-token` /
 * `.sbtc-registry` sugar inside the shim resolves to the right contracts.
 */
import {
  Cl,
  ClarityType,
  type UIntCV,
  fetchCallReadOnlyFunction,
  makeContractCall,
} from '@stacks/transactions';
import type { StacksNetwork } from '@stacks/network';
import type { IntegerType } from '@stacks/common';
import { broadcastAndWait } from './wait';
import { deployContract } from './deploy';

/** Contract name of the mint shim deployed under the sBTC admin/deployer. */
export const SBTC_DEPOSIT_CONTRACT_NAME = 'sbtc-deposit';

/** The registry's `deposit-role` flag (see sbtc-registry.clar `deposit-role`). */
const DEPOSIT_ROLE_FLAG = '01';

/**
 * Source for the `sbtc-deposit` mint shim. Deployer-relative `.sbtc-token`
 * resolves to the admin's sBTC token; the registry authorizes
 * `<deployer>.sbtc-deposit` as the deposit-role caller, so `protocol-mint`
 * succeeds when this contract is the `contract-caller`.
 */
const SBTC_DEPOSIT_SOURCE = `(define-public (mint (amount uint) (recipient principal))
  (contract-call? .sbtc-token protocol-mint amount recipient 0x${DEPOSIT_ROLE_FLAG})
)
`;

/**
 * Deploy the `sbtc-deposit` mint shim from the sBTC admin/deployer. Idempotent
 * at the caller's discretion — re-deploying a name that already exists rejects;
 * gate on existence if reusing a long-lived chain.
 */
export function deploySbtcMinter(args: {
  deployerKey: string;
  network: StacksNetwork;
}): Promise<string> {
  return deployContract({
    contractName: SBTC_DEPOSIT_CONTRACT_NAME,
    codeBody: SBTC_DEPOSIT_SOURCE,
    senderKey: args.deployerKey,
    network: args.network,
  });
}

/**
 * Mint `sats` of sBTC to `recipient` via the `sbtc-deposit` shim. The mint can be
 * SENT by any account — `protocol-mint` only checks that the `contract-caller` is
 * the deposit-role contract (the shim), not the tx sender. This matters because
 * the shim's `deployer` (= the sBTC deployer = a `STACKING_KEY`) is staked every
 * cycle; sending from a separate clean `sender` avoids racing the keep-alive
 * daemon's nonce.
 */
export async function mintSbtc(args: {
  /** Address that deployed `sbtc-deposit` (the sBTC deployer) — owns the shim. */
  deployer: string;
  /** Account that signs/sends the mint tx (any principal). */
  sender: { address: string; key: string };
  recipient: string;
  sats: IntegerType;
  nonce: IntegerType;
  fee?: IntegerType;
  network: StacksNetwork;
}): Promise<string> {
  const tx = await makeContractCall({
    contractAddress: args.deployer,
    contractName: SBTC_DEPOSIT_CONTRACT_NAME,
    functionName: 'mint',
    functionArgs: [Cl.uint(args.sats), Cl.address(args.recipient)],
    senderKey: args.sender.key,
    fee: args.fee ?? 10_000n,
    nonce: args.nonce,
    network: args.network,
  });
  return broadcastAndWait(tx, args.sender.address, args.network);
}

/**
 * Read an address's *available* (transferable) sBTC balance from
 * `<tokenContract>.get-balance-available` (read-only — no /extended).
 * `lock-sbtc` moves sats with `ft-transfer?` on the unlocked `sbtc-token`, so
 * the available balance — not the locked-inclusive total — is what gates a
 * successful `register-for-bond`. `tokenContract` is the fully-qualified
 * `<admin>.sbtc-token` the node points pox-5 at.
 */
export async function fetchSbtcBalance(args: {
  tokenContract: string;
  address: string;
  network: StacksNetwork;
}): Promise<bigint> {
  const [contractAddress, contractName] = args.tokenContract.split('.');
  const result = await fetchCallReadOnlyFunction({
    contractAddress,
    contractName,
    functionName: 'get-balance-available',
    functionArgs: [Cl.address(args.address)],
    senderAddress: args.address,
    network: args.network,
  });

  // `get-balance-available` returns `(ok uint)`.
  if (result.type !== ClarityType.ResponseOk) {
    throw new Error(`get-balance-available for ${args.address} returned ${result.type}`);
  }
  return BigInt((result.value as UIntCV).value);
}
