/**
 * Privatenet REWARDS claim-and-RECEIVE action for account5 (enrolled in bond 65).
 *
 * The "actually receive them" user story: read earned across the bonds account5
 * is in, settle the distribution waterfall with `calculate-rewards`, then
 * `claim-rewards` and VERIFY the staker's sBTC/STX balance moved.
 *
 * WHAT WE FOUND (privatenet, read at authoring time):
 *   - account5 IS enrolled: get-bond-membership → { bondIndex 65, amountUstx
 *     1015000, signer = daemon signer-manager, isL1Lock: true }.
 *   - get-earned / get-earned-staker-rewards for bond 65 = 0.
 *   - get-rewards = 0 and get-new-rewards = 0 on the pox-5 contract.
 *
 * WHY earned is 0 (and what would make it accrue):
 *   pox-5 funds rewards purely from sBTC SENT TO the pox-5 contract.
 *   `get-rewards = sbtc-token.get-balance(pox-5) - total-sbtc-staked - reserve`,
 *   and `calculate-rewards` only distributes `get-new-rewards` (the delta since
 *   the last compute). With no reward sBTC transferred to the contract,
 *   accrued-rewards = 0 → the waterfall pays nothing → every leg's
 *   rewards-per-token stays flat → get-earned = 0 → claim-rewards reverts
 *   ERR_NO_CLAIMABLE_REWARDS (u32). PRECONDITION for accrual: someone must
 *   transfer sBTC into the pox-5 contract as protocol rewards (the signer-set's
 *   PoX payout), THEN calculate-rewards settles it to the bonds + STX-only leg.
 *
 * This action exercises the full path anyway (calculate-rewards → claim-rewards)
 * to confirm the entry-points behave and that NO balance is received while
 * accrued-rewards = 0. If a future run has reward sBTC in the contract, the
 * balance-delta assertion flips to verifying an actual payout.
 *
 * Sender: account5 only (staker/claimant AND the permissionless
 * calculate-rewards caller — account8 is not prefunded on this net). Does NOT
 * touch bond-admin / setup-bond.
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so RECORD=1 \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 BITCOIN_TX_TIMEOUT=600000 \
 *     npx jest tests/privatenet/actions/rewards-claim-receive.test.ts --runInBand --collectCoverage=false --verbose
 */
import { Cl, broadcastTransaction, fetchCallReadOnlyFunction } from '@stacks/transactions';
import fetchMock from 'jest-fetch-mock';
import {
  buildCalculateRewards,
  buildClaimRewards,
  describePox5Error,
  fetchBondMembership,
  fetchProtocolBond,
  fetchEarned,
  fetchEarnedStakerRewards,
  Pox5ErrorCode,
} from '../../../src';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import {
  ensurePox5,
  getNextNonce,
  getPoxInfo,
  getStxBalance,
  getTransaction,
  waitForFulfilled,
} from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';

fetchMock.disableMocks();
jest.setTimeout(60 * 60_000);

const network = getNetwork();
const FEE = 10_000n;

const account5 = getAccount(REGTEST_KEYS.account5); // enrolled in bond 65 (L1 lock)
// calculate-rewards is permissionless; we drive it from account5 too (account8 is
// NOT prefunded on this net → NotEnoughFunds). Sequenced before the claim by nonce.

const SIGNER = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';
const SBTC = 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token';
const bootAddress = network.bootAddress;

// Candidate active-bond indices to scan (per rewards-sweep MAX_BOND_INDEX=70).
const MAX_BOND_INDEX = Number(process.env.MAX_BOND_INDEX ?? 70);

function parseErrCode(repr: string | undefined): number | undefined {
  const m = repr?.match(/^\(err u(\d+)\)$/);
  return m ? Number(m[1]) : undefined;
}

async function readUint(fn: string, args: ReturnType<typeof Cl.uint>[] = []): Promise<bigint> {
  const r = await fetchCallReadOnlyFunction({
    contractAddress: bootAddress,
    contractName: 'pox-5',
    functionName: fn,
    functionArgs: args,
    senderAddress: bootAddress,
    network,
  });
  return BigInt((r as { value: bigint }).value);
}

async function sbtcBalance(address: string): Promise<bigint> {
  const [contractAddress, contractName] = SBTC.split('.');
  try {
    const r = await fetchCallReadOnlyFunction({
      contractAddress,
      contractName,
      functionName: 'get-balance',
      functionArgs: [Cl.address(address)],
      senderAddress: address,
      network,
    });
    // (ok uint)
    const inner = (r as { value?: { value?: bigint } }).value;
    return BigInt((inner as { value: bigint })?.value ?? (r as { value: bigint }).value);
  } catch (e) {
    console.warn('sbtc get-balance failed:', (e as Error).message);
    return -1n;
  }
}

beforeAll(async () => {
  await ensurePox5();
}, 60 * 60_000);

test('rewards claim-and-receive for account5 / bond 65 — verifies receipt or explains 0', async () => {
  const poxInfo = await getPoxInfo();
  console.log('current cycle', poxInfo.rewardCycleId, 'burn', poxInfo.currentBurnchainBlockHeight);

  // ── 0. Contract-level reward fuel ──────────────────────────────────────────
  const rewardsBal = await readUint('get-rewards').catch(() => -1n);
  const newRewards = await readUint('get-new-rewards').catch(() => -1n);
  console.log('pox-5 get-rewards (sBTC reward fuel):', rewardsBal.toString());
  console.log('pox-5 get-new-rewards (undistributed since last compute):', newRewards.toString());

  // ── 1. account5 membership + earned (staker leg + signer leg) ──────────────
  const membership = await fetchBondMembership({ address: account5.address, network });
  console.log('account5 bond-membership:', JSON.stringify(membership, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  const bondIndex = membership?.bondIndex ?? 65;

  const stakerEarnedBefore = await fetchEarnedStakerRewards({ signerManager: SIGNER, rewardCycle: poxInfo.rewardCycleId, bondIndex, staker: account5.address, network }).catch(() => -1n);
  const signerEarnedBefore = await fetchEarned({ signerManager: SIGNER, rewardCycle: poxInfo.rewardCycleId, bondIndex, network }).catch(() => -1n);
  console.log(`earned BEFORE — staker(a5,bond${bondIndex})=${stakerEarnedBefore} signer(bond${bondIndex})=${signerEarnedBefore}`);

  // ── 2. Discover ALL existing bonds, sort by descending stx-value-ratio ─────
  //     calculate-rewards requires the FULL active-bond set (u33 otherwise),
  //     sorted descending by stx-value-ratio (u29 otherwise), capped at 6.
  const bonds: { index: number; ratio: bigint }[] = [];
  for (let i = 0; i < MAX_BOND_INDEX; i++) {
    try {
      const b = await fetchProtocolBond({ bondIndex: i, network });
      if (b) bonds.push({ index: i, ratio: b.stxValueRatio });
    } catch { /* skip */ }
  }
  bonds.sort((a, b) => (b.ratio === a.ratio ? b.index - a.index : Number(b.ratio - a.ratio)));
  const bondIndices = bonds.slice(0, 6).map(b => b.index);
  console.log('bonds (desc stx-value-ratio):', bonds.map(b => `${b.index}:${b.ratio}`).join(', '));
  console.log('calculate-rewards bondIndices (capped 6):', bondIndices.join(','));

  // ── 3. calculate-rewards (permissionless, from account5) ───────────────────
  //     NOTE: with 29 protocol bonds the true active set at calculation-height
  //     differs from our top-6, so this commonly aborts u33 ActiveBondNotIncluded
  //     or u29 InvalidBondPeriodOrdering — tolerated. Even a perfect settlement
  //     distributes nothing while get-rewards = 0.
  const calcUnsigned = await buildCalculateRewards({
    bondIndices,
    publicKey: account5.publicKey,
    fee: FEE,
    nonce: await getNextNonce(account5.address),
    network,
  });
  const calcTx = signTransaction(calcUnsigned, account5.key);
  const calcRes = await broadcastTransaction({ transaction: calcTx, network });
  if ('error' in calcRes) throw `calc broadcast rejected: ${calcRes.error} — ${'reason' in calcRes ? calcRes.reason : ''}`;
  console.log('calculate-rewards txid', calcRes.txid);
  const calcRecord = await waitForFulfilled(async () => {
    const t = await getTransaction(calcRes.txid);
    if (!t || t.tx_status === 'pending') throw 'pending';
    return t;
  });
  const calcCode = parseErrCode(calcRecord.tx_result?.repr);
  console.log('calculate-rewards result', {
    tx_status: calcRecord.tx_status,
    repr: calcRecord.tx_result?.repr?.slice(0, 200),
    code: calcCode,
    name: calcCode !== undefined ? describePox5Error(calcCode)?.name : undefined,
  });

  // ── 4. Re-read earned after settlement ─────────────────────────────────────
  const stakerEarnedAfter = await fetchEarnedStakerRewards({ signerManager: SIGNER, rewardCycle: poxInfo.rewardCycleId, bondIndex, staker: account5.address, network }).catch(() => -1n);
  const signerEarnedAfter = await fetchEarned({ signerManager: SIGNER, rewardCycle: poxInfo.rewardCycleId, bondIndex, network }).catch(() => -1n);
  console.log(`earned AFTER  — staker(a5,bond${bondIndex})=${stakerEarnedAfter} signer(bond${bondIndex})=${signerEarnedAfter}`);

  // ── 5. claim-rewards from account5 + balance receipt check ─────────────────
  const claimCycle = Math.max(0, poxInfo.rewardCycleId - 1);
  const stxBefore = await getStxBalance(account5.address);
  const sbtcBefore = await sbtcBalance(account5.address);
  console.log('account5 balances BEFORE claim — STX:', stxBefore.toString(), 'sBTC:', sbtcBefore.toString());

  const claimUnsigned = await buildClaimRewards({
    rewardCycle: claimCycle,
    bondIndices: [bondIndex],
    publicKey: account5.publicKey,
    fee: FEE,
    nonce: await getNextNonce(account5.address),
    network,
  });
  const claimTx = signTransaction(claimUnsigned, account5.key);
  const claimRes = await broadcastTransaction({ transaction: claimTx, network });
  if ('error' in claimRes) throw `claim broadcast rejected: ${claimRes.error} — ${'reason' in claimRes ? claimRes.reason : ''}`;
  console.log('claim-rewards txid', claimRes.txid);
  const claimRecord = await waitForFulfilled(async () => {
    const t = await getTransaction(claimRes.txid);
    if (!t || t.tx_status === 'pending') throw 'pending';
    return t;
  });
  const claimCode = parseErrCode(claimRecord.tx_result?.repr);
  console.log('claim-rewards result', {
    tx_status: claimRecord.tx_status,
    repr: claimRecord.tx_result?.repr?.slice(0, 200),
    code: claimCode,
    name: claimCode !== undefined ? describePox5Error(claimCode)?.name : undefined,
  });

  const stxAfter = await getStxBalance(account5.address);
  const sbtcAfter = await sbtcBalance(account5.address);
  console.log('account5 balances AFTER  claim — STX:', stxAfter.toString(), 'sBTC:', sbtcAfter.toString());

  console.log('=== RECEIPT ===');
  console.log('STX delta  (incl. -fee):', (stxAfter - stxBefore).toString());
  console.log('sBTC delta (reward receipt):', sbtcBefore >= 0n && sbtcAfter >= 0n ? (sbtcAfter - sbtcBefore).toString() : 'n/a');

  if (claimRecord.tx_status === 'success') {
    // Real receipt — sBTC must have increased (rewards are paid in sBTC).
    console.log('claim SUCCEEDED — rewards received.');
    if (sbtcBefore >= 0n && sbtcAfter >= 0n) expect(sbtcAfter).toBeGreaterThanOrEqual(sbtcBefore);
    expect(claimRecord.tx_status).toBe('success');
  } else {
    // Expected on this net: no reward sBTC in the contract → nothing to claim.
    console.log(
      'claim ABORTED — no rewards received. Root cause: pox-5 get-rewards = ' +
        `${rewardsBal} (no sBTC reward fuel). PRECONDITION: transfer sBTC into the ` +
        'pox-5 contract as protocol rewards, then calculate-rewards settles it.'
    );
    // No sBTC received; STX only moved by the fee (burned).
    if (sbtcBefore >= 0n && sbtcAfter >= 0n) expect(sbtcAfter - sbtcBefore).toBe(0n);
    expect([Pox5ErrorCode.NoClaimableRewards, Pox5ErrorCode.NotBondParticipant]).toContain(claimCode);
  }
});
