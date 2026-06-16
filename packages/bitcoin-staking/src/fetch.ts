import { hexToBigInt, hexToBytes } from '@stacks/common';
import type { NetworkClientParam } from '@stacks/network';
import { clientFromNetwork, networkFrom } from '@stacks/network';
import {
  Cl,
  ClarityType,
  type BooleanCV,
  type BufferCV,
  type OptionalCV,
  type PrincipalCV,
  type TupleCV,
  type UIntCV,
  cvToValue,
  fetchCallReadOnlyFunction,
  fetchContractMapEntry,
} from '@stacks/transactions';
import { POX5_CONTRACT_NAME } from './constants';
import {
  type BondStatusName,
  bondPeriodToBurnHeight,
  bondPeriodToRewardCycle,
  bondStatus,
} from './cycles';
import type {
  AccountStatus,
  Bond,
  BondMembership,
  EarnedRewards,
  PoxInfo,
  StakerInfo,
} from './types';

// ---------------------------------------------------------------------------
// Public fetch functions
// ---------------------------------------------------------------------------

/**
 * @ignore
 * Encode the `bond-index (optional uint)` leg selector shared by every reward /
 * shares read-only: a present `bondIndex` selects the paired-BTC bond leg
 * (`some`), an omitted one selects the STX-only leg (`none`).
 */
function bondIndexCV(bondIndex: number | undefined) {
  return bondIndex === undefined ? Cl.none() : Cl.some(Cl.uint(bondIndex));
}

/** Wraps the `/v2/pox` node endpoint. */
export async function fetchPoxInfo(opts: NetworkClientParam = {}): Promise<PoxInfo> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const client = Object.assign({}, clientFromNetwork(network), opts.client);
  const url = `${client.baseUrl}/v2/pox`;
  const response = await client.fetch(url);
  const data = await response.json();

  return {
    contractId: data.contract_id,
    currentBurnchainBlockHeight: data.current_burnchain_block_height,
    firstBurnchainBlockHeight: data.first_burnchain_block_height,
    rewardCycleId: data.reward_cycle_id,
    rewardCycleLength: data.reward_cycle_length,
    prepareCycleLength: data.prepare_cycle_length,
    rewardSlots: data.reward_slots,
    currentCycle: {
      id: data.current_cycle.id,
      stakedUstx: BigInt(data.current_cycle.stacked_ustx),
      isPoxActive: data.current_cycle.is_pox_active,
    },
    nextCycle: {
      id: data.next_cycle.id,
      stakedUstx: BigInt(data.next_cycle.stacked_ustx),
      isPoxActive: data.next_cycle.is_pox_active,
    },
    contractVersions: (
      (data.contract_versions ?? []) as Array<{
        contract_id: string;
        activation_burnchain_block_height: number;
        first_reward_cycle_id: number;
      }>
    ).map(v => ({
      contractId: v.contract_id,
      activationBurnchainBlockHeight: v.activation_burnchain_block_height,
      firstRewardCycleId: v.first_reward_cycle_id,
    })),
  };
}

/**
 * Wraps the contract's `get-staker-info` read-only.
 *
 * Returns the lock dimensions (`amount-ustx`, `first-reward-cycle`,
 * `num-cycles`) plus the staker's `signer` principal. Pool/solo discrimination,
 * signer key, and BTC reward address are NOT exposed here — they live in
 * `staker-signer-cycle-memberships` / `get-signer-cycle-membership` and need
 * separate fetchers.
 */
export async function fetchStakerInfo(
  opts: { address: string } & NetworkClientParam
): Promise<StakerInfo> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-staker-info',
    functionArgs: [Cl.address(opts.address)],
    senderAddress: opts.address,
    network: opts.network,
    client: opts.client,
  });

  const optional = result as OptionalCV<TupleCV>;
  if (optional.type === ClarityType.OptionalNone) return { staked: false };

  const tuple = optional.value;
  return {
    staked: true,
    details: {
      amountUstx: BigInt((tuple.value['amount-ustx'] as UIntCV).value),
      firstRewardCycle: Number((tuple.value['first-reward-cycle'] as UIntCV).value),
      numCycles: Number((tuple.value['num-cycles'] as UIntCV).value),
      signer: cvToValue(tuple.value['signer'] as PrincipalCV) as string,
    },
  };
}

/**
 * Wraps the contract's `allowance-contract-callers` map.
 *
 * Returns whether `sender` has authorized `contractCaller` to call PoX-5
 * methods on its behalf, honoring the optional expiry burn-height stored in
 * the grant. An authorization is in effect when an entry exists in the map
 * and either has no expiry or the current burn-block height has not yet
 * reached the expiry.
 */
export async function fetchAllowanceContractCallers(
  opts: { sender: string; contractCaller: string; poxInfo?: PoxInfo } & NetworkClientParam
): Promise<{ callerAllowed: boolean; callerExpiryHeight?: number }> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const entry = await fetchContractMapEntry({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    mapName: 'allowance-contract-callers',
    mapKey: Cl.tuple({
      sender: Cl.address(opts.sender),
      'contract-caller': Cl.address(opts.contractCaller),
    }),
    network: opts.network,
    client: opts.client,
  });

  // Map values are wrapped in (some ...) by the API; missing entries are
  // returned as `none`.
  const optional = entry as OptionalCV;
  if (optional.type === ClarityType.OptionalNone) return { callerAllowed: false };

  // Map value type is `(optional uint)`: outer Some wraps the stored
  // expiry-burn-ht (or inner None for "no expiry").
  const expiry = optional.value as OptionalCV<UIntCV>;
  if (expiry.type === ClarityType.OptionalNone) return { callerAllowed: true };

  const expiryHeight = Number(expiry.value.value);

  // If the caller provided a PoxInfo, use it. Otherwise, fetch it from the network.
  const poxInfo =
    opts.poxInfo ?? (await fetchPoxInfo({ network: opts.network, client: opts.client }));

  return {
    callerAllowed: poxInfo.currentBurnchainBlockHeight < expiryHeight,
    callerExpiryHeight: expiryHeight,
  };
}

/**
 * Wraps the `/v2/accounts/<addr>` node endpoint.
 *
 * Returned values use `bigint` (STX values are too large to safely round-trip
 * through `number`). `unlockHeight` is `0` when no lock is active.
 */
export async function fetchAccountStatus(
  opts: { address: string } & NetworkClientParam
): Promise<AccountStatus> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const client = Object.assign({}, clientFromNetwork(network), opts.client);
  const url = `${client.baseUrl}/v2/accounts/${opts.address}?proof=0`;
  const response = await client.fetch(url);
  const data = await response.json();

  return {
    balance: hexToBigInt(data.balance),
    locked: hexToBigInt(data.locked),
    nonce: BigInt(data.nonce ?? 0),
    unlockHeight: Number(data.unlock_height ?? 0),
  };
}

/**
 * Wraps the contract's `get-bond-membership` read-only.
 *
 * Returns `undefined` when no active membership exists (either no entry, or
 * the bond's unlock cycle has been reached — the contract collapses both
 * cases to `none`).
 *
 * Tuple shape: `{ bond-index, amount-ustx, signer, is-l1-lock, amount-sats }`.
 */
export async function fetchBondMembership(
  opts: { address: string } & NetworkClientParam
): Promise<BondMembership | undefined> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-bond-membership',
    functionArgs: [Cl.address(opts.address)],
    senderAddress: opts.address,
    network: opts.network,
    client: opts.client,
  });

  const optional = result as OptionalCV<TupleCV>;
  if (optional.type === ClarityType.OptionalNone) return undefined;

  const tuple = optional.value;
  return {
    bondIndex: Number((tuple.value['bond-index'] as UIntCV).value),
    amountUstx: BigInt((tuple.value['amount-ustx'] as UIntCV).value),
    signer: cvToValue(tuple.value['signer'] as PrincipalCV) as string,
    isL1Lock: (tuple.value['is-l1-lock'] as BooleanCV).type === ClarityType.BoolTrue,
    amountSats: BigInt((tuple.value['amount-sats'] as UIntCV).value),
  };
}

/**
 * Wraps the contract's `get-staker-shares-staked-for-cycle` read-only.
 *
 * Per-staker share contributed to a given signer in a given reward cycle.
 * Useful for dashboards rendering a per-signer breakdown when a staker is
 * delegated across multiple signers.
 *
 * Pass `bondIndex` to read the paired-BTC bond leg (unit: sats); omit it for
 * the STX-only leg (unit: uSTX).
 */
export async function fetchStakerSharesStakedForCycle(
  opts: {
    staker: string;
    signer: string;
    rewardCycle: number;
    bondIndex?: number;
  } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-staker-shares-staked-for-cycle',
    functionArgs: [
      Cl.address(opts.staker),
      Cl.uint(opts.rewardCycle),
      bondIndexCV(opts.bondIndex),
      Cl.address(opts.signer),
    ],
    senderAddress: opts.staker,
    network: opts.network,
    client: opts.client,
  });

  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `protocol-bonds` map.
 *
 * Returns the static configuration of a protocol bond, or `undefined` if the
 * bond has not been set up.
 *
 * `openBurnHeight` / `firstRewardCycle` are NOT included — they are
 * deterministic functions of `bondIndex`, `firstBondPeriodCycle`, and the pox
 * params. Compose with {@link bondPeriodToBurnHeight} /
 * {@link bondPeriodToRewardCycle} when needed.
 */
export async function fetchBond(
  opts: { bondIndex: number } & NetworkClientParam
): Promise<Bond | undefined> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const bondEntry = await fetchContractMapEntry({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    mapName: 'protocol-bonds',
    mapKey: Cl.uint(opts.bondIndex),
    network: opts.network,
    client: opts.client,
  });

  const optional = bondEntry as OptionalCV<TupleCV>;
  if (optional.type === ClarityType.OptionalNone) return undefined;

  return decodeBondTuple(opts.bondIndex, optional.value);
}

/**
 * Wraps the contract's `get-protocol-bond` read-only.
 *
 * Equivalent to {@link fetchBond} but goes through the read-only accessor
 * instead of the raw map read. Returns `undefined` when the bond has not been
 * set up.
 */
export async function fetchProtocolBond(
  opts: { bondIndex: number } & NetworkClientParam
): Promise<Bond | undefined> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-protocol-bond',
    functionArgs: [Cl.uint(opts.bondIndex)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });

  const optional = result as OptionalCV<TupleCV>;
  if (optional.type === ClarityType.OptionalNone) return undefined;

  return decodeBondTuple(opts.bondIndex, optional.value);
}

/**
 * Read the current `bond-admin` principal.
 *
 * `bond-admin` is a private data-var with no read-only accessor, so this reads
 * the node's `/v2/data_var` endpoint directly.
 *
 * Mirrors the `bond-admin` data-var.
 */
export async function fetchBondAdmin(opts: NetworkClientParam = {}): Promise<string> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const client = Object.assign({}, clientFromNetwork(network), opts.client);
  const url = `${client.baseUrl}/v2/data_var/${network.bootAddress}/${POX5_CONTRACT_NAME}/bond-admin?proof=0`;
  const response = await client.fetch(url);
  const { data } = await response.json();
  return cvToValue(Cl.deserialize(data)) as string;
}

/**
 * **Unstable / UI-experimental.** Classify a bond's {@link BondStatusName}
 * at the current burn height, fetching whatever isn't injected.
 *
 * Wraps the pure {@link bondStatus} helper: `poxInfo` and `isBondSetup` are
 * fetched (via {@link fetchPoxInfo} / {@link fetchProtocolBond}) when not
 * provided, so callers that already hold them avoid the network round-trips
 * (e.g. after {@link fetchProtocolBond}, pass `isBondSetup: bond !== undefined`).
 */
export async function fetchBondStatus(
  opts: {
    bondIndex: number;
    poxInfo?: PoxInfo;
    /** Whether `setup-bond` has been called for this bond. Fetched when omitted. */
    isBondSetup?: boolean;
  } & NetworkClientParam
): Promise<BondStatusName> {
  const [poxInfo, isBondSetup] = await Promise.all([
    opts.poxInfo ?? fetchPoxInfo({ network: opts.network, client: opts.client }),
    opts.isBondSetup ??
      fetchProtocolBond({
        bondIndex: opts.bondIndex,
        network: opts.network,
        client: opts.client,
      }).then(bond => bond !== undefined),
  ]);

  return bondStatus({ bondIndex: opts.bondIndex, poxInfo, isBondSetup });
}

/** @ignore */
function decodeBondTuple(bondIndex: number, tuple: TupleCV): Bond {
  const targetRate = (tuple.value['target-rate'] as UIntCV).value;
  const stxValueRatio = (tuple.value['stx-value-ratio'] as UIntCV).value;
  const minUstxRatio = (tuple.value['min-ustx-ratio'] as UIntCV).value;
  const earlyUnlockBytes = (tuple.value['early-unlock-bytes'] as BufferCV).value as string;

  return {
    bondIndex,
    targetRateBps: Number(targetRate),
    stxValueRatio: BigInt(stxValueRatio),
    minUstxRatioBps: Number(minUstxRatio),
    earlyUnlockBytes,
  };
}

/**
 * Wraps the contract's `get-total-sbtc-staked-for-bond` read-only.
 *
 * Reads `protocol-bonds-total-staked`. The contract's only write site is
 * `register-for-bond`, which sets the entry to
 * `current(total-shares-staked-for-cycle for this bond) + new sats` — i.e.
 * a snapshot refreshed on every registration. The source `total-shares-staked-for-cycle`
 * IS decremented by `unstake-sbtc` and `announce-l1-early-exit`, so during
 * the D-7 → D0 window the snapshot can rebase off a lower value if exits
 * land between registrations. After D0, `ERR_BOND_ALREADY_STARTED` blocks
 * further `register-for-bond` calls and the value is frozen at the last
 * registration's snapshot.
 *
 * For **currently-effective** shares (post-exits, post-unstakes), use
 * {@link fetchTotalSharesStakedForCycle} with
 * `{ index: bondIndex, isBond: true }`.
 *
 * Returns `0n` when no entry exists.
 */
export async function fetchTotalSbtcStakedForBond(
  opts: { bondIndex: number } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-total-sbtc-staked-for-bond',
    functionArgs: [Cl.uint(opts.bondIndex)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-total-shares-staked-for-cycle` read-only.
 *
 * Keyed by `{ reward-cycle, bond-index:(optional uint) }`:
 * - Pass `bondIndex` for the paired-BTC bond leg (unit: sats).
 * - Omit it for the STX-only leg (unit: uSTX).
 *
 * **Live, mutable.** The contract `++`s this on `register-for-bond` / `stake` /
 * `stake-update`, and `--`s it on `unstake-sbtc`, `announce-l1-early-exit`, and
 * `unstake`. The returned value is therefore the **currently-effective** total
 * — contrast with {@link fetchTotalSbtcStakedForBond}, which is a snapshot
 * refreshed on each `register-for-bond` and frozen once the registration
 * window closes at D0.
 *
 * **Rewards denominator.** This is the denominator the contract uses in its
 * `rewards-per-token` math (`update-rewards` for STX cycles and paired-BTC
 * bond legs). A wrong reading here mis-computes earned amounts.
 *
 * Returns `0n` when no entry exists.
 */
export async function fetchTotalSharesStakedForCycle(
  opts: { rewardCycle: number; bondIndex?: number } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-total-shares-staked-for-cycle',
    functionArgs: [Cl.uint(opts.rewardCycle), bondIndexCV(opts.bondIndex)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-total-sbtc-staked` read-only.
 *
 * Returns the protocol-wide total sBTC staked.
 */
export async function fetchTotalSbtcStaked(opts: NetworkClientParam = {}): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-total-sbtc-staked',
    functionArgs: [],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-bond-l1-unlock-height` read-only.
 *
 * Returns the BTC L1 unlock height for a given bond index. The SDK needs this
 * to compute the BTC lockup script's CLTV height before submitting
 * `register-for-bond`.
 */
export async function fetchBondL1UnlockHeight(
  opts: { bondIndex: number } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-bond-l1-unlock-height',
    functionArgs: [Cl.uint(opts.bondIndex)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/** @ignore Shared params for the two `construct-lockup-*` read-onlys. */
interface ConstructLockupParams {
  stxAddress: string;
  unlockHeight: number | bigint;
  /** Staker-signature subscript (the `staker-unlock-bytes` contract arg). */
  unlockBytes: Uint8Array | string;
  /** Per-bond early-unlock subscript (from {@link fetchBond}). */
  earlyUnlockBytes: Uint8Array | string;
}

/** @ignore */
async function fetchConstructLockupRead(
  functionName: 'construct-lockup-script' | 'construct-lockup-output-script',
  opts: ConstructLockupParams & NetworkClientParam
): Promise<Uint8Array> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const buf = (v: Uint8Array | string) =>
    typeof v === 'string' ? Cl.bufferFromHex(v) : Cl.buffer(v);
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName,
    functionArgs: [
      Cl.address(opts.stxAddress),
      Cl.uint(opts.unlockHeight),
      buf(opts.unlockBytes),
      buf(opts.earlyUnlockBytes),
    ],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return hexToBytes((result as BufferCV).value as string);
}

/**
 * Wraps the contract's `construct-lockup-script` read-only.
 *
 * Returns the authoritative L1 lockup witness script the contract derives for
 * the given parameters. Mirrors the local, pure {@link buildLockScript}; fetch
 * this to cross-check the locally-built script before funding BTC — a mismatch
 * means the SDK and the deployed contract disagree, and `register-for-bond`
 * would fail (`ERR_INVALID_LOCKUP_SCRIPT`), stranding the funds in the timelock.
 */
export async function fetchConstructLockupScript(
  opts: ConstructLockupParams & NetworkClientParam
): Promise<Uint8Array> {
  return fetchConstructLockupRead('construct-lockup-script', opts);
}

/**
 * Wraps the contract's `construct-lockup-output-script` read-only.
 *
 * Returns the authoritative 34-byte P2WSH `scriptPubKey` (`0x0020 ||
 * sha256(script)`) the contract re-derives in `register-for-bond` and matches
 * against each declared output. Mirrors the local, pure
 * {@link buildLockOutputScript}; fetch this to cross-check before funding BTC.
 */
export async function fetchConstructLockupOutputScript(
  opts: ConstructLockupParams & NetworkClientParam
): Promise<Uint8Array> {
  return fetchConstructLockupRead('construct-lockup-output-script', opts);
}

// ---------------------------------------------------------------------------
// On-chain SPV / script cross-checks
//
// These mirror pure helpers in `script.ts` / `proof.ts`. They exist so a test
// or tool can assert the local implementation byte-for-byte matches the
// deployed contract — fetch the on-chain result and compare against the local
// one. They are NOT needed on a hot path; the local pure helpers are.
// ---------------------------------------------------------------------------

/** @ignore Accept a buffer arg as raw bytes or a hex string. */
function bufferArg(v: Uint8Array | string) {
  return typeof v === 'string' ? Cl.bufferFromHex(v) : Cl.buffer(v);
}

/** @ignore Run a read-only that returns a `(buff ...)` and decode to bytes. */
async function fetchBufferRead(
  functionName: string,
  functionArgs: Parameters<typeof fetchCallReadOnlyFunction>[0]['functionArgs'],
  opts: NetworkClientParam
): Promise<Uint8Array> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName,
    functionArgs,
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return hexToBytes((result as BufferCV).value as string);
}

/**
 * Wraps the contract's `push-script-bytes` read-only.
 *
 * Returns `bytes` prefixed with its Bitcoin-Script push opcode(s). Mirrors the
 * local, pure {@link pushScriptBytes} — fetch to cross-check.
 */
export async function fetchPushScriptBytes(
  opts: { bytes: Uint8Array | string } & NetworkClientParam
): Promise<Uint8Array> {
  return fetchBufferRead('push-script-bytes', [bufferArg(opts.bytes)], opts);
}

/**
 * Wraps the contract's `serialize-c-script-num` read-only.
 *
 * Returns the minimal little-endian CScriptNum encoding of `n`. Mirrors the
 * local, pure {@link serializeCScriptNum} — fetch to cross-check.
 */
export async function fetchSerializeCScriptNum(
  opts: { n: number | bigint } & NetworkClientParam
): Promise<Uint8Array> {
  return fetchBufferRead('serialize-c-script-num', [Cl.uint(opts.n)], opts);
}

/**
 * Wraps the contract's `push-c-script-num` read-only.
 *
 * Returns the script-push encoding of the number `n` (OP_0 / OP_1..OP_16 small
 * forms, else a pushed CScriptNum). Mirrors the local, pure
 * {@link pushCScriptNum} — fetch to cross-check.
 */
export async function fetchPushCScriptNum(
  opts: { n: number | bigint } & NetworkClientParam
): Promise<Uint8Array> {
  return fetchBufferRead('push-c-script-num', [Cl.uint(opts.n)], opts);
}

/**
 * Wraps the contract's `uint-to-buff-le` read-only.
 *
 * Returns the little-endian 1–2 byte encoding of `n` (`n <= 0xffff`; the
 * contract panics otherwise).
 */
export async function fetchUintToBuffLe(
  opts: { n: number | bigint } & NetworkClientParam
): Promise<Uint8Array> {
  return fetchBufferRead('uint-to-buff-le', [Cl.uint(opts.n)], opts);
}

/**
 * Wraps the contract's `reverse-buff32` read-only.
 *
 * Returns the 32-byte input with its byte order reversed (endianness flip).
 */
export async function fetchReverseBuff32(
  opts: { input: Uint8Array | string } & NetworkClientParam
): Promise<Uint8Array> {
  return fetchBufferRead('reverse-buff32', [bufferArg(opts.input)], opts);
}

/**
 * Wraps the contract's `get-reversed-txid` read-only.
 *
 * Returns the little-endian (internal byte order) txid `sha256(sha256(tx))` of
 * a raw transaction — the reverse of the explorer-displayed txid. Mirrors the
 * local, pure {@link computeBitcoinTxid} — fetch to cross-check.
 */
export async function fetchReversedTxid(
  opts: { tx: Uint8Array | string } & NetworkClientParam
): Promise<Uint8Array> {
  return fetchBufferRead('get-reversed-txid', [bufferArg(opts.tx)], opts);
}

/** Decoded fields of an 80-byte Bitcoin block header. */
export interface ParsedBlockHeader {
  version: number;
  /** Previous-block hash, big-endian (display order). */
  parent: Uint8Array;
  /** Merkle root, big-endian (display order). */
  merkleRoot: Uint8Array;
  timestamp: number;
  nbits: number;
  nonce: number;
}

/**
 * Wraps the contract's `parse-block-header` read-only.
 *
 * Decodes an 80-byte Bitcoin header into its fields. Throws if the contract
 * returns an error response (e.g. the buffer is shorter than 80 bytes).
 */
export async function fetchParseBlockHeader(
  opts: { header: Uint8Array | string } & NetworkClientParam
): Promise<ParsedBlockHeader> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'parse-block-header',
    functionArgs: [bufferArg(opts.header)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  if (result.type !== ClarityType.ResponseOk) {
    throw new Error('parse-block-header returned an error response');
  }
  const tuple = result.value as TupleCV;
  return {
    version: Number((tuple.value.version as UIntCV).value),
    parent: hexToBytes((tuple.value.parent as BufferCV).value as string),
    merkleRoot: hexToBytes((tuple.value['merkle-root'] as BufferCV).value as string),
    timestamp: Number((tuple.value.timestamp as UIntCV).value),
    nbits: Number((tuple.value.nbits as UIntCV).value),
    nonce: Number((tuple.value.nonce as UIntCV).value),
  };
}

/**
 * Wraps the contract's `verify-block-header` read-only.
 *
 * Returns `true` if the 80-byte header double-SHA256s to the burnchain header
 * hash the node records at `expectedBlockHeight`. `false` if it does not, or if
 * the node has no header at that height.
 */
export async function fetchVerifyBlockHeader(
  opts: { header: Uint8Array | string; expectedBlockHeight: number } & NetworkClientParam
): Promise<boolean> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'verify-block-header',
    functionArgs: [bufferArg(opts.header), Cl.uint(opts.expectedBlockHeight)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return (result as BooleanCV).type === ClarityType.BoolTrue;
}

/**
 * Wraps the contract's `get-bc-h-hash` read-only.
 *
 * Returns the burnchain header hash the node records at burn height `bh`, or
 * `undefined` if it has no header at that height.
 */
export async function fetchBurnBlockHeaderHash(
  opts: { burnHeight: number } & NetworkClientParam
): Promise<Uint8Array | undefined> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-bc-h-hash',
    functionArgs: [Cl.uint(opts.burnHeight)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  const optional = result as OptionalCV<BufferCV>;
  if (optional.type === ClarityType.OptionalNone) return undefined;
  return hexToBytes(optional.value.value as string);
}

/**
 * Wraps the contract's `get-total-ustx-stacked` read-only.
 *
 * Returns the total uSTX stacked in a given reward cycle.
 */
export async function fetchTotalUstxStacked(
  opts: { rewardCycle: number } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-total-ustx-stacked',
    functionArgs: [Cl.uint(opts.rewardCycle)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `protocol-bond-allowances` map.
 *
 * Returns the staker's allowlisted sats allocation for a bond, or `0n` when
 * the staker is not on the bond's allowlist (no entry => not allowed).
 */
export async function fetchBondAllowance(
  opts: { bondIndex: number; address: string } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const entry = await fetchContractMapEntry({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    mapName: 'protocol-bond-allowances',
    mapKey: Cl.tuple({
      'bond-index': Cl.uint(opts.bondIndex),
      staker: Cl.address(opts.address),
    }),
    network: opts.network,
    client: opts.client,
  });

  const optional = entry as OptionalCV<UIntCV>;
  if (optional.type === ClarityType.OptionalNone) return 0n;
  return BigInt(optional.value.value);
}

// ---------------------------------------------------------------------------
// Reward / distribution reads
// ---------------------------------------------------------------------------

/**
 * **Intentionally not exposed.** Wraps the contract's
 * `current-distribution-cycle` read-only.
 *
 * The same value is derivable from `/v2/pox`'s
 * `current_burnchain_block_height` / `first_burnchain_block_height` /
 * `reward_cycle_length` — use the pure helper `currentDistributionCycle`
 * (re-exported from `cycles.ts`) instead of paying an extra round trip.
 *
 * Kept here for completeness and as a regression guard. Throws at runtime if
 * called.
 *
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
// @ts-expect-error TS6133: intentionally unused — see JSDoc above
async function _fetchCurrentDistributionCycle(_opts: NetworkClientParam = {}): Promise<number> {
  // Reference implementation (intentionally unreachable):
  //
  //   const network = networkFrom(_opts.network ?? 'mainnet');
  //   const result = await fetchCallReadOnlyFunction({
  //     contractAddress: network.bootAddress,
  //     contractName: POX5_CONTRACT_NAME,
  //     functionName: 'current-distribution-cycle',
  //     functionArgs: [],
  //     senderAddress: network.bootAddress,
  //     network: _opts.network,
  //     client: _opts.client,
  //   });
  //   return Number((result as UIntCV).value);
  throw new Error('not implemented');
}

/**
 * Wraps the contract's `get-signer-shares-staked-for-cycle` read-only.
 *
 * Per-signer share total in a given reward cycle. Pass `bondIndex` for the
 * paired-BTC bond leg (unit: sats); omit it for the STX-only leg (unit: uSTX).
 */
export async function fetchSignerSharesStakedForCycle(
  opts: {
    signerManager: string;
    rewardCycle: number;
    bondIndex?: number;
  } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-signer-shares-staked-for-cycle',
    functionArgs: [
      Cl.address(opts.signerManager),
      Cl.uint(opts.rewardCycle),
      bondIndexCV(opts.bondIndex),
    ],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

// ---------------------------------------------------------------------------
// Earned-rewards reads
//
// Pending + accrued is exposed as `get-earned -> uint`, with the underlying
// state split across `get-signer-rewards-per-token-settled-for-cycle` and
// `get-signer-unclaimed-rewards-for-cycle`.
// ---------------------------------------------------------------------------

/**
 * Wraps the contract's `get-earned` read-only.
 *
 * Returns the total amount of rewards earned since the last rewards snapshot:
 * `earned = (shares * (rpt - rptPaid)) / PRECISION + pending`.
 */
export async function fetchEarned(
  opts: {
    signerManager: string;
    rewardCycle: number;
    bondIndex?: number;
  } & NetworkClientParam
): Promise<EarnedRewards> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-earned',
    functionArgs: [
      Cl.address(opts.signerManager),
      Cl.uint(opts.rewardCycle),
      bondIndexCV(opts.bondIndex),
    ],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-signer-unclaimed-rewards-for-cycle` read-only.
 *
 * The unclaimed-rewards counter rolled forward by the last
 * `update-claimable-rewards` snapshot. Combined with the rewards-per-token
 * settled value, this lets callers reconstruct the full earned amount without
 * re-running `get-earned`.
 */
export async function fetchSignerUnclaimedRewards(
  opts: {
    signerManager: string;
    rewardCycle: number;
    bondIndex?: number;
  } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-signer-unclaimed-rewards-for-cycle',
    functionArgs: [
      Cl.address(opts.signerManager),
      Cl.uint(opts.rewardCycle),
      bondIndexCV(opts.bondIndex),
    ],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-signer-rewards-per-token-settled-for-cycle`
 * read-only.
 *
 * Returns the rewards-per-token value at which this signer's leg was last
 * settled. Useful for off-chain accrual previews. Pass `bondIndex` for the
 * paired-BTC bond leg; omit it for the STX-only leg.
 */
export async function fetchSignerRewardsPerTokenSettled(
  opts: {
    signerManager: string;
    rewardCycle: number;
    bondIndex?: number;
  } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-signer-rewards-per-token-settled-for-cycle',
    functionArgs: [
      Cl.address(opts.signerManager),
      Cl.uint(opts.rewardCycle),
      bondIndexCV(opts.bondIndex),
    ],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-signer-rewards-per-token-for-cycle` read-only.
 *
 * Returns the live rewards-per-token value for this signer's leg (the running
 * accumulator before settlement). Pass `bondIndex` for the paired-BTC bond leg;
 * omit it for the STX-only leg.
 */
export async function fetchSignerRewardsPerTokenForCycle(
  opts: {
    signerManager: string;
    rewardCycle: number;
    bondIndex?: number;
  } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-signer-rewards-per-token-for-cycle',
    functionArgs: [
      Cl.address(opts.signerManager),
      Cl.uint(opts.rewardCycle),
      bondIndexCV(opts.bondIndex),
    ],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

// ---------------------------------------------------------------------------
// Staker-level earned-rewards reads
// ---------------------------------------------------------------------------

/**
 * Wraps the contract's `get-earned-staker-rewards` read-only.
 *
 * Returns the rewards earned by `staker` within this signer's leg. Pass
 * `bondIndex` for the paired-BTC bond leg; omit it for the STX-only leg.
 */
export async function fetchEarnedStakerRewards(
  opts: {
    signerManager: string;
    rewardCycle: number;
    bondIndex?: number;
    staker: string;
  } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-earned-staker-rewards',
    functionArgs: [
      Cl.address(opts.signerManager),
      Cl.uint(opts.rewardCycle),
      bondIndexCV(opts.bondIndex),
      Cl.address(opts.staker),
    ],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-staker-rewards-per-token-settled-for-cycle`
 * read-only.
 *
 * Returns the rewards-per-token value at which this staker's leg was last
 * settled. Pass `bondIndex` for the paired-BTC bond leg; omit it for the
 * STX-only leg.
 */
export async function fetchStakerRewardsPerTokenSettled(
  opts: {
    signerManager: string;
    rewardCycle: number;
    bondIndex?: number;
    staker: string;
  } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-staker-rewards-per-token-settled-for-cycle',
    functionArgs: [
      Cl.address(opts.signerManager),
      Cl.uint(opts.rewardCycle),
      bondIndexCV(opts.bondIndex),
      Cl.address(opts.staker),
    ],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-staker-unclaimed-rewards-for-cycle` read-only.
 *
 * The per-staker unclaimed-rewards counter rolled forward by the last
 * settlement. Pass `bondIndex` for the paired-BTC bond leg; omit it for the
 * STX-only leg.
 */
export async function fetchStakerUnclaimedRewards(
  opts: {
    signerManager: string;
    rewardCycle: number;
    bondIndex?: number;
    staker: string;
  } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-staker-unclaimed-rewards-for-cycle',
    functionArgs: [
      Cl.address(opts.signerManager),
      Cl.uint(opts.rewardCycle),
      bondIndexCV(opts.bondIndex),
      Cl.address(opts.staker),
    ],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

// ---------------------------------------------------------------------------
// Pool / accounting reads
//
// The undistributed-pool and per-cycle accounting state behind the rewards
// lifecycle. A cycle is still *pending* (rewards in the contract, not yet
// claimable) while `fetchLastRewardComputeHeight` lags
// `distributionCycleToBurnHeight(currentDistributionCycle) - 1`; once
// `calculate-rewards` advances it, `fetchEarned` turns the pending pool into a
// claimable per-leg figure.
// ---------------------------------------------------------------------------

/**
 * Wraps the contract's `get-last-reward-compute-height` read-only.
 *
 * The burn height of the last settled distribution cycle. Compare against
 * `distributionCycleToBurnHeight(currentDistributionCycle) - 1`: while this is
 * lower, the current cycle is still *pending* and `calculate-rewards` can run;
 * `buildCalculateRewards` reverts `ERR_DISTRIBUTION_ALREADY_COMPUTED` once they
 * are equal.
 */
export async function fetchLastRewardComputeHeight(opts: NetworkClientParam = {}): Promise<number> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-last-reward-compute-height',
    functionArgs: [],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return Number((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-rewards` read-only.
 *
 * Total undistributed sBTC sats the contract currently holds
 * (`balance - totalStaked - reserve`) — the whole pool awaiting the next
 * `calculate-rewards`, settled and unsettled portions combined.
 */
export async function fetchRewards(opts: NetworkClientParam = {}): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-rewards',
    functionArgs: [],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-new-rewards` read-only.
 *
 * The sBTC sats received since the last `calculate-rewards`
 * (`get-rewards - last-accounted-rewards-only`) — i.e. the pool the *next*
 * settlement will distribute. This is the "gathered pool" a pending-rewards
 * view projects each leg's cut from.
 */
export async function fetchNewRewards(opts: NetworkClientParam = {}): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-new-rewards',
    functionArgs: [],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-reserve-balance` read-only.
 *
 * sBTC sats set aside for the reserve (the `RESERVE_RATIO` cut taken off the
 * top of each distribution, plus the staker cut for cycles with no STX staked).
 */
export async function fetchReserveBalance(opts: NetworkClientParam = {}): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-reserve-balance',
    functionArgs: [],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-last-accounted-rewards-only` read-only.
 *
 * The running total of rewards already accounted into per-token accumulators
 * by past settlements. Subtract from {@link fetchRewards} to get
 * {@link fetchNewRewards}.
 */
export async function fetchLastAccountedRewards(opts: NetworkClientParam = {}): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-last-accounted-rewards-only',
    functionArgs: [],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-rewards-per-token-for-cycle` read-only.
 *
 * The cumulative rewards-per-token accumulator for a leg of a cycle (settled
 * value written by `calculate-rewards`). Pass `bondIndex` for the paired-BTC
 * bond leg; omit it for the STX-only leg. This is the contract-wide accumulator
 * — for a single signer's settled snapshot use
 * {@link fetchSignerRewardsPerTokenSettled}.
 */
export async function fetchRewardsPerTokenForCycle(
  opts: { rewardCycle: number; bondIndex?: number } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-rewards-per-token-for-cycle',
    functionArgs: [Cl.uint(opts.rewardCycle), bondIndexCV(opts.bondIndex)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-signer-pending-staked-ustx-per-cycle` read-only.
 *
 * uSTX queued for a signer in `cycle` that has not yet rolled into the active
 * stake (pending delegation). `0` when there is nothing pending.
 */
export async function fetchSignerPendingStakedUstx(
  opts: { signerManager: string; cycle: number } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-signer-pending-staked-ustx-per-cycle',
    functionArgs: [Cl.address(opts.signerManager), Cl.uint(opts.cycle)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-amount-delegated-for-signer` read-only.
 *
 * Total uSTX delegated to a signer in `cycle` (across both protocol bonds and
 * STX-only staking). `0` when none.
 */
export async function fetchAmountDelegatedForSigner(
  opts: { signerManager: string; cycle: number } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-amount-delegated-for-signer',
    functionArgs: [Cl.address(opts.signerManager), Cl.uint(opts.cycle)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `get-ustx-delegated-for-cycle` read-only.
 *
 * Total uSTX delegated across the whole protocol for `rewardCycle` (the
 * denominator behind `chainstate.get_total_ustx_stacked`). `0` when none.
 */
export async function fetchUstxDelegatedForCycle(
  opts: { rewardCycle: number } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-ustx-delegated-for-cycle',
    functionArgs: [Cl.uint(opts.rewardCycle)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

// ---------------------------------------------------------------------------
// Signer-set reads
//
// Per-cycle membership of the signer set, stored as a doubly-linked list keyed
// by cycle. Walk it with `fetchSignerSetFirstItem` →
// `fetchSignerSetNextItem` until `undefined`.
// ---------------------------------------------------------------------------

/**
 * Wraps the contract's `get-signer-cycle-membership` read-only.
 *
 * The staker's signer assignment for `cycle`, or `undefined` if they have none.
 */
export async function fetchSignerCycleMembership(
  opts: { staker: string; cycle: number } & NetworkClientParam
): Promise<{ amountUstx: bigint; signer: string } | undefined> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-signer-cycle-membership',
    functionArgs: [Cl.address(opts.staker), Cl.uint(opts.cycle)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  const optional = result as OptionalCV<TupleCV>;
  if (optional.type === ClarityType.OptionalNone) return undefined;
  return {
    amountUstx: BigInt((optional.value.value['amount-ustx'] as UIntCV).value),
    signer: cvToValue(optional.value.value.signer as PrincipalCV),
  };
}

/**
 * Wraps the contract's `signer-set-contains-for-cycle` read-only.
 *
 * `true` if the signer is in the signer set for `cycle`.
 */
export async function fetchSignerSetContainsForCycle(
  opts: { signer: string; cycle: number } & NetworkClientParam
): Promise<boolean> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'signer-set-contains-for-cycle',
    functionArgs: [Cl.address(opts.signer), Cl.uint(opts.cycle)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return (result as BooleanCV).type === ClarityType.BoolTrue;
}

/** @ignore Resolve an `(optional principal)`-returning signer-set read. */
async function fetchSignerSetPrincipal(
  functionName: string,
  functionArgs: Parameters<typeof fetchCallReadOnlyFunction>[0]['functionArgs'],
  opts: NetworkClientParam
): Promise<string | undefined> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName,
    functionArgs,
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  const optional = result as OptionalCV<PrincipalCV>;
  if (optional.type === ClarityType.OptionalNone) return undefined;
  return cvToValue(optional.value);
}

/**
 * Wraps the contract's `get-signer-set-first-item-for-cycle` read-only.
 *
 * The first signer in the cycle's linked list, or `undefined` if the set is
 * empty. Start a full walk here.
 */
export async function fetchSignerSetFirstItem(
  opts: { cycle: number } & NetworkClientParam
): Promise<string | undefined> {
  return fetchSignerSetPrincipal(
    'get-signer-set-first-item-for-cycle',
    [Cl.uint(opts.cycle)],
    opts
  );
}

/**
 * Wraps the contract's `get-signer-set-last-item-for-cycle` read-only.
 *
 * The last signer in the cycle's linked list, or `undefined` if the set is
 * empty.
 */
export async function fetchSignerSetLastItem(
  opts: { cycle: number } & NetworkClientParam
): Promise<string | undefined> {
  return fetchSignerSetPrincipal('get-signer-set-last-item-for-cycle', [Cl.uint(opts.cycle)], opts);
}

/**
 * Wraps the contract's `get-signer-set-next-item-for-cycle` read-only.
 *
 * The signer after `signer` in the cycle's linked list, or `undefined` at the
 * tail (or if `signer` is not a member).
 */
export async function fetchSignerSetNextItem(
  opts: { signer: string; cycle: number } & NetworkClientParam
): Promise<string | undefined> {
  return fetchSignerSetPrincipal(
    'get-signer-set-next-item-for-cycle',
    [Cl.address(opts.signer), Cl.uint(opts.cycle)],
    opts
  );
}

/**
 * Wraps the contract's `get-signer-set-prev-item-for-cycle` read-only.
 *
 * The signer before `signer` in the cycle's linked list, or `undefined` at the
 * head (or if `signer` is not a member).
 */
export async function fetchSignerSetPrevItem(
  opts: { signer: string; cycle: number } & NetworkClientParam
): Promise<string | undefined> {
  return fetchSignerSetPrincipal(
    'get-signer-set-prev-item-for-cycle',
    [Cl.address(opts.signer), Cl.uint(opts.cycle)],
    opts
  );
}

/**
 * Wraps the contract's `get-signer-set-item-for-cycle` read-only.
 *
 * The `{ prev, next }` linked-list node for `signer` in `cycle`, or `undefined`
 * if not a member. Either neighbour is `undefined` at the list ends.
 */
export async function fetchSignerSetItem(
  opts: { signer: string; cycle: number } & NetworkClientParam
): Promise<{ prev: string | undefined; next: string | undefined } | undefined> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-signer-set-item-for-cycle',
    functionArgs: [Cl.address(opts.signer), Cl.uint(opts.cycle)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  const optional = result as OptionalCV<TupleCV>;
  if (optional.type === ClarityType.OptionalNone) return undefined;
  const unwrapPrincipal = (cv: OptionalCV<PrincipalCV>) =>
    cv.type === ClarityType.OptionalNone ? undefined : cvToValue(cv.value);
  return {
    prev: unwrapPrincipal(optional.value.value.prev as OptionalCV<PrincipalCV>),
    next: unwrapPrincipal(optional.value.value.next as OptionalCV<PrincipalCV>),
  };
}

// ---------------------------------------------------------------------------
// Rollover preflight reads
// ---------------------------------------------------------------------------

/**
 * Wraps the contract's `get-staker-custodied-sbtc` read-only.
 *
 * Returns the sBTC sats pox-5 currently custodies for the staker (`0` for an
 * L1-lock bond or no bond).
 */
export async function fetchStakerCustodiedSbtc(
  opts: { staker: string } & NetworkClientParam
): Promise<bigint> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-staker-custodied-sbtc',
    functionArgs: [Cl.address(opts.staker)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return BigInt((result as UIntCV).value);
}

/**
 * Wraps the contract's `bond-overlaps-new-position?` read-only.
 *
 * Returns `true` if the existing bond membership overlaps a new staking term
 * starting at `newFirstRewardCycle`.
 */
export async function fetchBondOverlapsNewPosition(
  opts: {
    membership: BondMembership | undefined;
    newFirstRewardCycle: number;
  } & NetworkClientParam
): Promise<boolean> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const membershipArg = opts.membership
    ? Cl.some(
        Cl.tuple({
          'bond-index': Cl.uint(opts.membership.bondIndex),
          'amount-ustx': Cl.uint(opts.membership.amountUstx),
          signer: Cl.address(opts.membership.signer),
          'is-l1-lock': Cl.bool(opts.membership.isL1Lock),
          'amount-sats': Cl.uint(opts.membership.amountSats),
        })
      )
    : Cl.none();
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'bond-overlaps-new-position?',
    functionArgs: [membershipArg, Cl.uint(opts.newFirstRewardCycle)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return (result as BooleanCV).type === ClarityType.BoolTrue;
}

/**
 * Wraps the contract's `has-announced-l1-early-exit` read-only.
 *
 * Returns `true` once the staker has successfully called
 * `announce-l1-early-exit` for the given bond index. Gate the announce action
 * on this — a second announce reverts with `ERR_L1_EARLY_EXIT_ALREADY_ANNOUNCED`.
 */
export async function fetchHasAnnouncedL1EarlyExit(
  opts: { bondIndex: number; staker: string } & NetworkClientParam
): Promise<boolean> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'has-announced-l1-early-exit',
    functionArgs: [Cl.uint(opts.bondIndex), Cl.address(opts.staker)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });
  return (result as BooleanCV).type === ClarityType.BoolTrue;
}

// ---------------------------------------------------------------------------
// Signer-key grant reads
// ---------------------------------------------------------------------------

/**
 * Wraps the contract's `get-signer-info` read-only.
 *
 * Returns the signer-key currently registered for `signerManager` (i.e. the
 * 33-byte compressed secp256k1 pubkey stored in the `signers` map). Returns
 * `undefined` when no signer is registered for the principal.
 *
 * The hex string is the lowercase, un-prefixed compressed pubkey form.
 */
export async function fetchSignerInfo(
  opts: { signerManager: string } & NetworkClientParam
): Promise<{ signerKey: string } | undefined> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-signer-info',
    functionArgs: [Cl.address(opts.signerManager)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });

  const optional = result as OptionalCV<BufferCV>;
  if (optional.type === ClarityType.OptionalNone) return undefined;
  return { signerKey: optional.value.value as string };
}

/**
 * Wraps the contract's `verify-signer-key-grant` read-only.
 *
 * Returns `true` when an active grant exists in `signer-key-grants` for the
 * `(signer-key, signer-manager)` pair, `false` otherwise (the contract
 * returns `(err ERR_SIGNER_KEY_GRANT_NOT_FOUND)` in the absent case — both
 * branches are normalized to a boolean here).
 */
export async function fetchVerifySignerKeyGrant(
  opts: {
    signerKey: Uint8Array | string;
    signerManager: string;
  } & NetworkClientParam
): Promise<boolean> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const signerKeyArg =
    typeof opts.signerKey === 'string'
      ? Cl.bufferFromHex(opts.signerKey)
      : Cl.buffer(opts.signerKey);
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'verify-signer-key-grant',
    functionArgs: [Cl.address(opts.signerManager), signerKeyArg],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });

  // Response is `(ok bool)` on success, `(err uint)` on missing grant.
  return result.type === ClarityType.ResponseOk;
}

/**
 * Wraps the contract's `get-signer-grant-message-hash` read-only.
 *
 * Returns the 32-byte SIP-018 hash for `{ topic: "grant-authorization",
 * signer-manager, auth-id }` under the `POX_5_SIGNER_DOMAIN`. Useful as an
 * on-chain cross-check against {@link computeSignerGrantHash}.
 *
 * The hex string is lowercase and un-prefixed.
 */
export async function fetchSignerGrantMessageHash(
  opts: { signerManager: string; authId: bigint | number } & NetworkClientParam
): Promise<string> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const result = await fetchCallReadOnlyFunction({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'get-signer-grant-message-hash',
    functionArgs: [Cl.address(opts.signerManager), Cl.uint(opts.authId)],
    senderAddress: network.bootAddress,
    network: opts.network,
    client: opts.client,
  });

  return (result as BufferCV).value as string;
}

// Out of scope for `@stacks/bitcoin-staking`. The surfaces below live
// upstream of the pox-5 contract (ops multisig) — not planned for this SDK:
//   - flow 15 (andon cord) — `fetchPayoutWindow`
//     (`get-last-reward-compute-height` is now exposed — see
//     `fetchLastRewardComputeHeight` in the pool/accounting reads above.)

/**
 * **Intentionally not exposed.** Wraps the contract's
 * `get-first-pox-5-reward-cycle` read-only.
 *
 * The same value is already on `/v2/pox` at
 * `contractVersions[].firstRewardCycleId` for the `pox-5` row — derive it
 * locally with the pure helper {@link firstPox5RewardCycle} (re-exported from
 * `cycles.ts`) instead of paying an extra round trip.
 *
 * Kept here for completeness and as a regression guard. Throws at runtime if
 * called.
 *
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
// @ts-expect-error TS6133: intentionally unused — see JSDoc above
async function _fetchFirstPox5RewardCycle(_opts: NetworkClientParam = {}): Promise<number> {
  // Reference implementation (intentionally unreachable):
  //
  //   const network = networkFrom(_opts.network ?? 'mainnet');
  //   const result = await fetchCallReadOnlyFunction({
  //     contractAddress: network.bootAddress,
  //     contractName: POX5_CONTRACT_NAME,
  //     functionName: 'get-first-pox-5-reward-cycle',
  //     functionArgs: [],
  //     senderAddress: network.bootAddress,
  //     network: _opts.network,
  //     client: _opts.client,
  //   });
  //   return Number((result as UIntCV).value);
  throw new Error('not implemented');
}
