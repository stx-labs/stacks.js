/**
 * Minimal bitcoind JSON-RPC client for the regtest env (mirrors
 * `stacks-regtest-env/stacking/btc-helpers.ts`). Talks straight to bitcoind on
 * the global `fetch`, so it needs mocks off (`RECORD=1`) and is NOT captured in
 * the stacks network.txt. Swap for `@btc-helpers/rpc` when deps are formalized.
 */
import { ENV } from './utils';

const rpc = new URL(ENV.BITCOIND_URL);
const auth = 'Basic ' + Buffer.from(`${rpc.username}:${rpc.password}`).toString('base64');

export async function bitcoinRpc<T = unknown>(
  method: string,
  params: unknown[] = [],
  wallet?: string
): Promise<T> {
  const url = wallet ? `${rpc.origin}/wallet/${wallet}` : rpc.origin;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'e2e', method, params }),
  });
  const json = (await res.json()) as { result: T; error: { message: string } | null };
  if (json.error) throw new Error(`bitcoinRpc ${method}: ${json.error.message}`);
  return json.result;
}

export const getBlockCount = () => bitcoinRpc<number>('getblockcount');

export const getBlockHash = (height: number) => bitcoinRpc<string>('getblockhash', [height]);

export const getBestBlockHash = () => bitcoinRpc<string>('getbestblockhash');

// Wallet RPCs default to the `main` (mining-funded) wallet — the only one tests use.
export const getNewAddress = (label = '', wallet = 'main') =>
  bitcoinRpc<string>('getnewaddress', [label], wallet);

export const getBalance = (wallet = 'main') => bitcoinRpc<number>('getbalance', [], wallet);

export const getReceivedByAddress = (address: string, minconf = 0, wallet = 'main') =>
  bitcoinRpc<number>('getreceivedbyaddress', [address, minconf], wallet);

export const sendToAddress = (address: string, amountBtc: number, wallet = 'main') =>
  bitcoinRpc<string>('sendtoaddress', [address, amountBtc], wallet);

// ---------------------------------------------------------------------------
// SPV proof inputs via RPC (no Esplora)
// ---------------------------------------------------------------------------
//
// The SDK's `assembleLockupProofFromBlock` does all the merkle math; it just
// needs the block's ordered txid list + the raw tx + header, which we pull from
// bitcoind: `gettransaction` (wallet, no -txindex needed) for the raw tx +
// blockhash, `getblockheader` for the 80-byte header, and `getblock` verbosity-1
// for the txid list (`tx`) and height.

interface WalletTx {
  hex: string;
  blockhash: string;
  confirmations: number;
}
interface BlockV1 {
  height: number;
  tx: string[];
  nTx: number;
  merkleroot: string;
}

/** Wallet view of a tx (raw hex + which block confirmed it). */
export const getWalletTransaction = (txid: string, wallet = 'main') =>
  bitcoinRpc<WalletTx>('gettransaction', [txid, null, true], wallet);

/** Raw 80-byte block header hex. */
export const getBlockHeaderHex = (blockHash: string) =>
  bitcoinRpc<string>('getblockheader', [blockHash, false]);

/** Block with its ordered txid list (verbosity 1). */
export const getBlockV1 = (blockHash: string) => bitcoinRpc<BlockV1>('getblock', [blockHash, 1]);

/**
 * Fetch the RPC pieces the SDK's `assembleLockupProofFromBlock` needs for a
 * confirmed wallet tx: the raw `txHex` (segwit serialization — the SDK strips
 * the witness), the 80-byte `header`, the block's ordered `txids`, and its
 * `blockHeight`. Throws if the tx isn't mined yet. Feed the result straight in:
 * `assembleLockupProofFromBlock({ ...inputs, expectedScript })`.
 */
export async function getBtcTxProofInputs(
  txid: string,
  wallet = 'main'
): Promise<{
  txHex: string;
  header: string;
  txids: string[];
  blockHeight: number;
  blockHash: string;
}> {
  const walletTx = await getWalletTransaction(txid, wallet);
  if (!walletTx.blockhash || walletTx.confirmations < 1) {
    throw `tx ${txid} not confirmed yet (confirmations=${walletTx.confirmations})`;
  }
  const blockHash = walletTx.blockhash;
  const [header, block] = await Promise.all([getBlockHeaderHex(blockHash), getBlockV1(blockHash)]);

  return {
    txHex: walletTx.hex,
    header,
    txids: block.tx,
    blockHeight: block.height,
    blockHash,
  };
}
