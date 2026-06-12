/**
 * Read helpers + wait-for-* suite. Ported from
 * `stacks-functional-tests/src/helpers.ts` (cycle math + waiters), re-pointed at
 * the live node via plain `fetch` and our own SDK (`fetchPoxInfo` / `PoxInfo`).
 * Each waiter polls and composes on `waitForBurnBlockHeight`.
 */
import {
  broadcastTransaction,
  makeSTXTokenTransfer,
  type StacksTransactionWire,
} from '@stacks/transactions';
import type { StacksNetwork } from '@stacks/network';
import { fetchPoxInfo, fetchSignerInfo, type PoxInfo } from '../../src';
import { ENV, getNetwork, isMocking, networkReset, timeout, withRetry } from './utils';

/**
 * Retry-wrapped `fetch` for the raw node GETs below. These idempotent reads hit
 * the node directly (bypassing the SDK client's retrying fetch), so a transient
 * connection drop — common around Nakamoto tenure changes (`ECONNRESET` /
 * `socket hang up`) — would otherwise throw straight through and fail a test.
 * Under replay `fetch` is mocked, so this is a single pass-through call.
 */
export const nodeFetch = withRetry(
  10,
  (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(input, init)
);

/**
 * Core wait primitive: poll `condition` until true. Under replay (`isMocking`)
 * the loop is a no-op — a static fixture never changes, so looping is pointless;
 * everything built on this (broadcastAndWait, the waiters) resolves immediately
 * offline. Live mode polls as normal.
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  interval: number = ENV.POLL_INTERVAL,
  timeoutMs?: number
): Promise<void> {
  if (isMocking) return;
  const startedAt = Date.now();
  while (!(await condition())) {
    if (timeoutMs !== undefined && Date.now() - startedAt > timeoutMs) {
      throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    }
    await timeout(interval);
  }
}

/** Extract `N` from a `(err uN)` result repr (undefined for ok/other shapes). */
export function parseErrCode(repr: string | undefined): number | undefined {
  const m = repr?.match(/^\(err u(\d+)\)$/);
  return m ? Number(m[1]) : undefined;
}

/** Subset of the API transaction record we read/assert on. */
export interface TxRecord {
  tx_id: string;
  tx_status: string;
  nonce: number;
  burn_block_height?: number;
  tx_result: { hex: string; repr: string };
}

// reads

export function getPoxInfo(): Promise<PoxInfo> {
  return fetchPoxInfo({ network: getNetwork() });
}

export async function getBurnBlockHeight(): Promise<number> {
  const res = await nodeFetch(`${ENV.STACKS_API}/v2/info`);
  const data = (await res.json()) as { burn_block_height: number };
  return data.burn_block_height;
}

/** Next nonce via the node's `/v2/accounts` (node-only; avoids `/extended`). */
export async function getNextNonce(address: string): Promise<number> {
  const res = await nodeFetch(`${ENV.STACKS_API}/v2/accounts/${address}?proof=0`);
  const data = (await res.json()) as { nonce: number };
  return data.nonce;
}

export async function getTransaction(txid: string): Promise<TxRecord | null> {
  const id = txid.startsWith('0x') ? txid : `0x${txid}`;
  const res = await nodeFetch(`${ENV.STACKS_API}/extended/v1/tx/${id}`);
  if (!res.ok) return null;
  return (await res.json()) as TxRecord;
}

/** STX balance (microSTX) straight from the node via `/v2/accounts`. */
export async function getStxBalance(address: string): Promise<bigint> {
  const res = await nodeFetch(`${ENV.STACKS_API}/v2/accounts/${address}?proof=0`);
  if (!res.ok) throw new Error(`GET /v2/accounts/${address} → ${res.status}`);
  const data = (await res.json()) as { balance: string };
  return BigInt(data.balance); // hex "0x..."
}

// cycle math (port of functional-tests helpers.ts, on our camelCase PoxInfo)

export function burnHeightToRewardCycle(burnHeight: number, poxInfo: PoxInfo): number {
  return Math.floor((burnHeight - poxInfo.firstBurnchainBlockHeight) / poxInfo.rewardCycleLength);
}

export function rewardCycleToBurnHeight(cycle: number, poxInfo: PoxInfo): number {
  return poxInfo.firstBurnchainBlockHeight + cycle * poxInfo.rewardCycleLength;
}

export function isInPreparePhase(blockHeight: number, poxInfo: PoxInfo): boolean {
  if (blockHeight <= poxInfo.firstBurnchainBlockHeight) return false;
  const pos = (blockHeight - poxInfo.firstBurnchainBlockHeight) % poxInfo.rewardCycleLength;
  return pos > poxInfo.rewardCycleLength - poxInfo.prepareCycleLength;
}

// waiters (port of functional-tests helpers.ts)

export async function waitForBurnBlockHeight(
  burnBlockHeight: number,
  interval: number = ENV.POLL_INTERVAL
): Promise<void> {
  if (isMocking) return; // replay: burn height is whatever the fixture says
  let lastHeight = -1;
  let lastHeightTime = Date.now();
  while (true) {
    const currentHeight = await getBurnBlockHeight();
    if (currentHeight >= burnBlockHeight) {
      console.log(`block height ${currentHeight} (reached)`);
      return;
    }
    if (currentHeight === lastHeight) {
      if (Date.now() - lastHeightTime > ENV.BITCOIN_TX_TIMEOUT) {
        throw new Error(
          `Burn block height hasn't changed for ${ENV.BITCOIN_TX_TIMEOUT / 1000}s (stuck at ${currentHeight})`
        );
      }
    } else {
      lastHeight = currentHeight;
      lastHeightTime = Date.now();
      console.log(`block height ${currentHeight} (waiting for ${burnBlockHeight})`);
    }
    await timeout(interval);
  }
}

/** Minimal raw `/v2/pox` shape the readiness waits need. */
interface RawPoxInfo {
  contract_id: string;
  current_burnchain_block_height: number;
  reward_cycle_id: number;
  current_cycle?: { id: number };
}

/**
 * Raw `/v2/pox` via the global `fetch`, used by the readiness waits. Under
 * `RECORD=1` the global `fetch` is wrapped (see `utils.ts`) so these polls are
 * captured into `fixtures.json` too — deduped to a single latest-wins entry, so
 * the long boot-polling doesn't bloat the store. That recorded `/v2/pox`
 * snapshot is what `BASE_POX5` replays so this wait resolves offline.
 */
async function getPoxInfoRaw(): Promise<RawPoxInfo> {
  const res = await nodeFetch(`${ENV.STACKS_API}/v2/pox`);
  if (!res.ok) throw new Error(`/v2/pox → ${res.status}`);
  return (await res.json()) as RawPoxInfo;
}

/** Wait until the node + PoX endpoint are responsive (e.g. after env up). */
export async function waitForNetwork(): Promise<void> {
  console.log('waiting for network...');
  await waitForFulfilled(async () => {
    const pox = await getPoxInfoRaw();
    if (!pox.current_cycle) throw new Error('pox not ready');
  });
}

/** Current burn height via raw /v2/pox, or null if the node isn't responding. */
async function currentBurnHeight(): Promise<number | null> {
  try {
    return (await getPoxInfoRaw()).current_burnchain_block_height;
  } catch {
    return null;
  }
}

/**
 * Get the chain into a usable pox-5 state before a test:
 * - node down → fresh chain (with `env`, e.g. `{ POX5_STACKING_ENABLED: 'false' }`);
 * - otherwise reuse the running chain.
 * Then wait until pox-5 is active.
 */
export async function ensurePox5({
  env = {},
}: { env?: Record<string, string> } = {}): Promise<void> {
  const burn = await currentBurnHeight();
  if (burn === null) {
    console.log('node not ready — starting fresh chain');
    await networkReset(env);
  } else {
    console.log(`chain up (burn ${burn}) — reusing`);
  }
  await waitForNetwork();
  await waitForPox5();
}

/** Wait until pox-5 is the active PoX contract (epoch 4.0 activation). */
export async function waitForPox5(): Promise<void> {
  if (isMocking) return; // replay: the /v2/pox fixture is a pox-5-active snapshot
  while (true) {
    try {
      const pox = await getPoxInfoRaw();
      if (pox.contract_id.endsWith('.pox-5')) {
        console.log(`pox-5 active (burn ${pox.current_burnchain_block_height}, cycle ${pox.reward_cycle_id})`);
        return;
      }
      console.log(`waiting for pox-5 (active ${pox.contract_id}, burn ${pox.current_burnchain_block_height})`);
    } catch {
      console.log('waiting for pox-5 (node not ready)');
    }
    await timeout(ENV.POLL_INTERVAL);
  }
}

/**
 * Wait until `signerManager` has a registered signer key. The env's btc-staker
 * daemon registers it shortly *after* pox-5 activates, so register-for-bond tests
 * must wait for it (not just for pox-5) before asserting preconditions.
 */
export async function waitForSignerManager(signerManager: string): Promise<void> {
  console.log(`waiting for signer-manager ${signerManager}...`);
  await waitForFulfilled(async () => {
    const info = await fetchSignerInfo({ signerManager, network: getNetwork() });
    if (!info) throw new Error('signer-manager not registered yet');
  });
  console.log('signer-manager registered');
}

export async function waitForNextCycle(poxInfo: PoxInfo): Promise<void> {
  const pos =
    (poxInfo.currentBurnchainBlockHeight - poxInfo.firstBurnchainBlockHeight) %
    poxInfo.rewardCycleLength;
  const blocksUntilNext = poxInfo.rewardCycleLength - pos;
  return waitForBurnBlockHeight(poxInfo.currentBurnchainBlockHeight + blocksUntilNext);
}

/** Wait until we're in the prepare phase (optional `diff` block offset). */
export async function waitForPreparePhase(poxInfo: PoxInfo, diff = 0): Promise<void> {
  if (isInPreparePhase(poxInfo.currentBurnchainBlockHeight + diff, poxInfo)) return;
  const rewardPhaseLength = poxInfo.rewardCycleLength - poxInfo.prepareCycleLength;
  const pos =
    (poxInfo.currentBurnchainBlockHeight - poxInfo.firstBurnchainBlockHeight) %
    poxInfo.rewardCycleLength;
  const blocksUntilPreparePhase = rewardPhaseLength - pos + 1;
  return waitForBurnBlockHeight(poxInfo.currentBurnchainBlockHeight + blocksUntilPreparePhase + diff);
}

/**
 * Wait until we're in the reward phase with at least `margin` blocks left
 * before the next prepare phase. A tx broadcast now must also CONFIRM before
 * prepare starts — pox-5 rejects bond/stake ops during prepare
 * (`ERR_STAKE_IN_PREPARE_PHASE`, err u47) — so being merely "not in prepare"
 * is not enough near the phase edge. Call before broadcasting any
 * stake/register/unstake/update bond op.
 */
export async function waitForRewardPhase(poxInfo: PoxInfo, margin = 4): Promise<void> {
  if (isMocking) return;
  let pox = poxInfo;
  while (true) {
    const prepareStart = pox.rewardCycleLength - pox.prepareCycleLength;
    const pos =
      (pox.currentBurnchainBlockHeight - pox.firstBurnchainBlockHeight) % pox.rewardCycleLength;
    if (pos + margin <= prepareStart) return;
    await timeout(ENV.POLL_INTERVAL);
    pox = await getPoxInfo();
  }
}

export async function waitForNextNonce(
  address: string,
  currentNonce: number,
  interval: number = ENV.POLL_INTERVAL
): Promise<void> {
  await waitFor(async () => (await getNextNonce(address)) === currentNonce + 1, interval);
}

/**
 * Poll until `fn` resolves without throwing, returning its value. Ported from
 * functional-tests' `waitForFulfilled` (which discarded the result) — here the
 * resolved value is returned so callers can `const x = await waitForFulfilled(…)`
 * instead of hand-rolling a poll loop. Bound the wait by the caller's jest
 * timeout (no internal ceiling), matching the functional-tests idiom.
 */
export async function waitForFulfilled<T>(
  fn: () => Promise<T>,
  interval: number = ENV.POLL_INTERVAL
): Promise<T> {
  if (isMocking) return fn(); // replay: one shot — the fixture is the ready state
  while (true) {
    try {
      return await fn();
    } catch {
      await timeout(interval);
    }
  }
}

/**
 * Poll until a tx leaves the mempool; returns the final tx record. Reads
 * `/extended` (the API), NOT the node: the tx confirms on the node in seconds,
 * but the API indexes through the buffered event relay and can lag tens of
 * seconds under recording load — hence the 3x budget vs node-side waits.
 */
export async function waitForTransaction(
  txid: string,
  timeoutMs: number = 3 * ENV.STACKS_TX_TIMEOUT
): Promise<TxRecord> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tx = await getTransaction(txid);
    if (tx && tx.tx_status !== 'pending') return tx;
    await timeout(ENV.POLL_INTERVAL);
  }
  throw new Error(`Timeout waiting for tx ${txid}`);
}

/** Broadcast a built tx and wait for it to confirm. */
export async function broadcastAndWaitForTransaction(
  tx: StacksTransactionWire,
  network: StacksNetwork
): Promise<TxRecord> {
  // pox-5 rejects bond/stake ops during the prepare phase (err u47). All action
  // txs route through the broadcast helpers, so wait here for a reward-phase
  // window wide enough for the tx to also confirm before prepare starts.
  await waitForRewardPhase(await getPoxInfo());
  const res = await broadcastTransaction({ transaction: tx, network });
  if ('error' in res) {
    throw new Error(`broadcast rejected: ${res.error} — ${'reason' in res ? res.reason : ''}`);
  }
  console.log('broadcast txid', res.txid);
  return waitForTransaction(res.txid);
}

/**
 * Broadcast a signed tx and wait until it's mined, confirmed node-only by the
 * sender's account nonce advancing (`/v2/accounts`) — never touches `/extended`
 * (the regtest API indexer lags far behind the node). The nonce wait is built on
 * {@link waitFor}, so under replay it's skipped and this returns the recorded
 * txid immediately. It can't distinguish success from a runtime abort, so callers
 * MUST assert the on-chain *effect* afterwards (a read via {@link waitForFulfilled}).
 *
 * Stall detection: if the burn block height hasn't advanced for `BITCOIN_TX_TIMEOUT`
 * while the tx is pending, we throw — a stalled chain means the tx will never confirm.
 */
export async function broadcastAndWait(
  tx: StacksTransactionWire,
  senderAddress: string,
  network: StacksNetwork,
  interval: number = ENV.POLL_INTERVAL
): Promise<string> {
  // See broadcastAndWaitForTransaction: avoid prepare-phase aborts (err u47).
  await waitForRewardPhase(await getPoxInfo());
  const startNonce = await getNextNonce(senderAddress);
  const res = await broadcastTransaction({ transaction: tx, network });
  if ('error' in res) {
    throw new Error(`broadcast rejected: ${res.error} — ${'reason' in res ? res.reason : ''}`);
  }
  console.log('broadcast txid', res.txid);
  if (!isMocking) {
    let lastBurn = await getBurnBlockHeight();
    let lastBurnTime = Date.now();
    while (true) {
      const nonce = await getNextNonce(senderAddress);
      if (nonce > startNonce) break;
      const burn = await getBurnBlockHeight();
      if (burn > lastBurn) {
        lastBurn = burn;
        lastBurnTime = Date.now();
      } else if (Date.now() - lastBurnTime > ENV.BITCOIN_TX_TIMEOUT) {
        throw new Error(
          `Chain stall: burn block stuck at ${burn} for ${ENV.BITCOIN_TX_TIMEOUT / 1000}s while waiting for tx ${res.txid}`
        );
      }
      await timeout(interval);
    }
  }
  return res.txid;
}

/**
 * Fund `recipient` with `amountUstx` from a funded account — a clean way past the
 * small prefunded-key pool: derive/pick any staker and top it up in `beforeAll`.
 * Confirms node-only via the funder's nonce (skipped under replay). Funder must
 * be an account no daemon drives (e.g. the bond-admin), so its nonce is stable.
 */
export async function fundStx(args: {
  funder: { address: string; key: string };
  recipient: string;
  amountUstx: bigint;
  nonce: number;
  fee?: bigint;
  network: StacksNetwork;
}): Promise<string> {
  const tx = await makeSTXTokenTransfer({
    recipient: args.recipient,
    amount: args.amountUstx,
    senderKey: args.funder.key,
    fee: args.fee ?? 10_000n,
    nonce: args.nonce,
    network: args.network,
  });
  return broadcastAndWait(tx, args.funder.address, args.network);
}

/** Whether a contract is deployed, via the node's `/v2/contracts/interface`. */
export async function contractExists(address: string, name: string): Promise<boolean> {
  const res = await nodeFetch(`${ENV.STACKS_API}/v2/contracts/interface/${address}/${name}`);
  return res.ok;
}

/** Wait until `<address>.<name>` is queryable on the node (node-only). */
export async function waitForContract(
  address: string,
  name: string,
  interval: number = ENV.POLL_INTERVAL
): Promise<void> {
  // A healthy deploy confirms within 1-2 stacks blocks (seconds). 30s means the
  // tx aborted (e.g. failed Clarity analysis) — fail loudly, don't sit out the
  // jest timeout.
  await waitFor(() => contractExists(address, name), interval, 30_000).catch(() => {
    throw new Error(
      `waitForContract: ${address}.${name} not on-chain after 30s — deploy tx likely aborted`
    );
  });
}
