/**
 * E2E — POSITIVE reward payout on privatenet (real sBTC pot, no fuel).
 *
 * Unlike regtest (empty pot, synthetic fuel) and the older tolerate-zero
 * privatenet reward tests, this drives the full distribution waterfall against
 * the hosted net's genuinely-funded pot and asserts coins actually MOVE:
 *
 *   1. settle       — calculate-rewards (pox-5, permissionless) then the
 *                     signer-manager `claim-rewards` (settle-rewards side
 *                     effect) populate a POSITIVE per-signer earned amount.
 *   2. sBTC payout  — `claim-staker-rewards` for a plain staker (account5)
 *                     raises the staker's sBTC balance (gaps: two-hop payout).
 *   3. L1 withdrawal— `claim-staker-rewards` for a pox-addr staker (account6)
 *                     opens an sBTC→BTC withdrawal request on the sbtc-registry
 *                     instead of crediting sBTC (the leg regtest can't observe).
 *
 * Preconditions (see fixtures / HANDOFF-privatenet-reward-validation.md):
 * account5 (plain sBTC) and account6 (pox-addr elected) are registered in an
 * active bond and past their first-reward-cycle. CLAIM_CYCLE selects the cycle
 * to settle/claim (default: the just-closed cycle).
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 BITCOIN_TX_TIMEOUT=600000 \
 *     STACKS_TX_TIMEOUT=600000 RECORD=1 CLAIM_CYCLE=353 \
 *     npx jest tests/privatenet/e2e/reward-payout.e2e.test.ts \
 *       --runInBand --collectCoverage=false --verbose
 */
import {
  Cl,
  cvToValue,
  deserializeCV,
  fetchCallReadOnlyFunction,
  makeContractCall,
} from '@stacks/transactions';
import {
  buildCalculateRewards,
  fetchPoxInfo,
  fetchProtocolBond,
  firstPox5RewardCycle,
  isBondActiveAtHeight,
} from '../../../src';
import { REGTEST_KEYS, getAccount, resolveAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import {
  broadcastAndWaitForTransaction,
  getNextNonce,
  getPoxInfo,
  parseErrCode,
} from '../../helpers/wait';
import { useFixtures } from '../../helpers/mock';

jest.setTimeout(60 * 60_000);
// Each leg mutates one-shot chain state (settle/claim consume the reward for a
// cycle); a retry would re-run against already-claimed state and abort, so it
// must not retry. Fix the cause and re-run on a fresh cycle instead.
jest.retryTimes(0);

const network = getNetwork();
const FEE = 10_000n;

// Correct privatenet ids (the pot's real sBTC token — NOT the regtest SM3VDXK3 id).
const SM = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';
const SBTC = 'SN3R84XZYA63QS28932XQF3G1J8R9PC3W76P9CSQS.sbtc-token';
const REGISTRY = 'SN3R84XZYA63QS28932XQF3G1J8R9PC3W76P9CSQS.sbtc-registry';

// Permissionless operator for calculate-rewards / claim-rewards (settle). Clean
// nonce lane, kept off the staker accounts so their nonces stay predictable.
const operator = resolveAccount('OPERATOR', 'account4');
const staker = getAccount(REGTEST_KEYS.account5); // plain sBTC lockup
const poxStaker = getAccount(REGTEST_KEYS.account6); // pox-addr elected -> L1 payout

async function sbtcBalance(address: string): Promise<bigint> {
  const [contractAddress, contractName] = SBTC.split('.');
  const r = await fetchCallReadOnlyFunction({
    contractAddress,
    contractName,
    functionName: 'get-balance',
    functionArgs: [Cl.address(address)],
    senderAddress: address,
    network,
  });
  const inner = (r as { value?: { value?: bigint } }).value; // (ok uint)
  return BigInt((inner as { value: bigint })?.value ?? (r as { value: bigint }).value);
}

/** signer-manager.get-earned-staker-rewards -> { earned, fees }. */
async function earnedStaker(address: string, rewardCycle: number, bondIndex: number): Promise<bigint> {
  const [contractAddress, contractName] = SM.split('.');
  const r = await fetchCallReadOnlyFunction({
    contractAddress,
    contractName,
    functionName: 'get-earned-staker-rewards',
    functionArgs: [Cl.address(address), Cl.uint(rewardCycle), Cl.some(Cl.uint(bondIndex))],
    senderAddress: address,
    network,
  });
  // cvToValue wraps each tuple field as { type, value }; earned.value is the uint string.
  return BigInt((cvToValue(r) as { earned: { value: bigint } }).earned.value);
}

/** sbtc-registry.last-withdrawal-request-id data-var (no read-only accessor exists). */
async function lastWithdrawalId(): Promise<bigint> {
  const [addr, name] = REGISTRY.split('.');
  const res = await fetch(
    `${network.client.baseUrl}/v2/data_var/${addr}/${name}/last-withdrawal-request-id?proof=0`
  ).then(r => r.json());
  return BigInt(cvToValue(deserializeCV(res.data)) as never);
}

/**
 * Full active-bond set for `poxInfo`, sorted desc by stx-value-ratio (tie: higher
 * index), top 6. The scan window is derived from the current cycle (bond index ≈
 * (cycle - firstBondPeriodCycle) / BOND_GAP_CYCLES) rather than a fixed ceiling,
 * so it tracks the daemon's ever-advancing bond index. MAX_BOND_INDEX overrides
 * the upper bound if set.
 */
async function activeBondSet(poxInfo: Awaited<ReturnType<typeof fetchPoxInfo>>): Promise<number[]> {
  const burnHeight = poxInfo.currentBurnchainBlockHeight;
  const currentBondIndex = Math.floor((poxInfo.rewardCycleId - (firstPox5RewardCycle(poxInfo) ?? 0)) / 2);
  const hi = Number(process.env.MAX_BOND_INDEX ?? currentBondIndex + 1);
  const lo = Math.max(0, hi - 12); // active window spans the last ~6 bond periods
  const active: { index: number; ratio: bigint }[] = [];
  for (let i = lo; i <= hi; i++) {
    const bond = await fetchProtocolBond({ bondIndex: i, network }).catch(() => undefined);
    if (!bond) continue;
    if (!isBondActiveAtHeight({ bondIndex: i, burnHeight, poxInfo })) continue;
    active.push({ index: i, ratio: BigInt(bond.stxValueRatio) });
  }
  active.sort((a, b) => (a.ratio === b.ratio ? b.index - a.index : a.ratio > b.ratio ? -1 : 1));
  return active.slice(0, 6).map(a => a.index);
}

/** The staker's own bond among the active set. */
const BOND_INDEX = Number(process.env.BOND_INDEX ?? 171);

async function claimCycle(): Promise<number> {
  if (process.env.CLAIM_CYCLE) return Number(process.env.CLAIM_CYCLE);
  const poxInfo = await getPoxInfo();
  return Math.max(0, poxInfo.rewardCycleId - 1);
}

// Shared across the ordered tests (settle must precede the claims).
let cycle: number;
let bondIndices: number[];

test('settle: calculate-rewards + claim-rewards populate positive staker rewards', async () => {
  useFixtures('e2e-reward-payout-settle');
  cycle = await claimCycle();
  const poxInfo = await fetchPoxInfo({ network });
  bondIndices = await activeBondSet(poxInfo);
  console.log('claim cycle:', cycle, ' active bond set (top-6 by ratio):', bondIndices);
  expect(bondIndices).toContain(BOND_INDEX);

  const signerBefore = await sbtcBalance(SM);
  console.log('signer-manager sBTC before settle:', signerBefore.toString());

  // 1) calculate-rewards (pox-5, permissionless) — splits newly-arrived sBTC on paper.
  const calc = await buildCalculateRewards({
    bondIndices,
    publicKey: operator.publicKey,
    fee: FEE,
    nonce: await getNextNonce(operator.address),
    network,
    postConditionMode: 'allow',
  });
  const { signTransaction } = await import('../../helpers/sign');
  const calcTx = signTransaction(calc, operator.key);
  const calcRec = await broadcastAndWaitForTransaction(calcTx, network);
  console.log('calculate-rewards:', calcRec.tx_status, calcRec.tx_result?.repr?.slice(0, 80));
  // calculate-rewards is permissionless and idempotent per distribution period:
  // the bond daemon (or any prior caller) may already have calculated this one,
  // which aborts ERR_ALREADY_CALCULATED (u30). Harmless — the settle below still
  // pulls the already-distributed rewards into the per-signer map.
  if (calcRec.tx_status !== 'success') {
    expect(parseErrCode(calcRec.tx_result?.repr)).toBe(30);
  }

  // 2) signer-manager claim-rewards — the settle bridge that populates the per-signer map.
  const [smAddr, smName] = SM.split('.');
  const settle = await makeContractCall({
    contractAddress: smAddr,
    contractName: smName,
    functionName: 'claim-rewards',
    functionArgs: [Cl.list(bondIndices.map(i => Cl.uint(i))), Cl.uint(cycle)],
    senderKey: operator.key,
    network,
    fee: FEE,
    nonce: await getNextNonce(operator.address),
    postConditionMode: 'allow',
    validateWithAbi: false,
  });
  const settleRec = await broadcastAndWaitForTransaction(settle, network);
  console.log('claim-rewards (settle):', settleRec.tx_status, settleRec.tx_result?.repr?.slice(0, 120));
  expect(settleRec.tx_status).toBe('success');

  const signerAfter = await sbtcBalance(SM);
  console.log('signer-manager sBTC after settle:', signerAfter.toString(), 'delta', (signerAfter - signerBefore).toString());

  // The per-signer map is now populated: the staker's earned amount is POSITIVE.
  const earned = await earnedStaker(staker.address, cycle, BOND_INDEX);
  console.log('account5 earned (cycle', cycle, '):', earned.toString());
  expect(earned).toBeGreaterThan(0n);

  // Settle pulls the signer's cut into the signer-manager (never decreases).
  expect(signerAfter).toBeGreaterThanOrEqual(signerBefore);
});

test('sBTC payout: claim-staker-rewards raises a plain staker sBTC balance', async () => {
  useFixtures('e2e-reward-payout-sbtc');
  const before = await sbtcBalance(staker.address);
  console.log('account5 sBTC before claim:', before.toString());

  const [smAddr, smName] = SM.split('.');
  const claim = await makeContractCall({
    contractAddress: smAddr,
    contractName: smName,
    functionName: 'claim-staker-rewards',
    functionArgs: [Cl.address(staker.address), Cl.uint(cycle), Cl.some(Cl.uint(BOND_INDEX))],
    senderKey: operator.key,
    network,
    fee: FEE,
    nonce: await getNextNonce(operator.address),
    postConditionMode: 'allow',
    validateWithAbi: false,
  });
  const rec = await broadcastAndWaitForTransaction(claim, network);
  console.log('claim-staker-rewards (account5):', rec.tx_status, rec.tx_result?.repr?.slice(0, 80));
  expect(rec.tx_status).toBe('success');

  const after = await sbtcBalance(staker.address);
  console.log('account5 sBTC after claim:', after.toString(), 'delta', (after - before).toString());
  expect(after).toBeGreaterThan(before);
});

test('L1 withdrawal: pox-addr staker claim opens an sBTC→BTC withdrawal request', async () => {
  useFixtures('e2e-reward-payout-l1');
  const idBefore = await lastWithdrawalId();
  const sbtcBefore = await sbtcBalance(poxStaker.address);
  console.log('last-withdrawal-request-id before:', idBefore.toString(), ' account6 sBTC before:', sbtcBefore.toString());

  const [smAddr, smName] = SM.split('.');
  const claim = await makeContractCall({
    contractAddress: smAddr,
    contractName: smName,
    functionName: 'claim-staker-rewards',
    functionArgs: [Cl.address(poxStaker.address), Cl.uint(cycle), Cl.some(Cl.uint(BOND_INDEX))],
    senderKey: operator.key,
    network,
    fee: FEE,
    nonce: await getNextNonce(operator.address),
    postConditionMode: 'allow',
    validateWithAbi: false,
  });
  const rec = await broadcastAndWaitForTransaction(claim, network);
  console.log('claim-staker-rewards (account6, pox-addr):', rec.tx_status, rec.tx_result?.repr?.slice(0, 80));
  expect(rec.tx_status).toBe('success');

  // The payout routes to an L1 BTC withdrawal request, NOT the staker's sBTC balance.
  const idAfter = await lastWithdrawalId();
  console.log('last-withdrawal-request-id after:', idAfter.toString());
  expect(idAfter).toBe(idBefore + 1n);

  const [regAddr, regName] = REGISTRY.split('.');
  const reqCv = await fetchCallReadOnlyFunction({
    contractAddress: regAddr,
    contractName: regName,
    functionName: 'get-withdrawal-request',
    functionArgs: [Cl.uint(idAfter)],
    senderAddress: poxStaker.address,
    network,
  });
  const req = cvToValue(reqCv) as { value: Record<string, unknown> };
  console.log('withdrawal request:', JSON.stringify(req, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  const request = (req.value ?? req) as Record<string, { value: unknown }>;
  const amount = BigInt((request.amount as { value: bigint }).value);
  expect(amount).toBeGreaterThan(0n);

  // Recipient descriptor is account6's elected pox-addr (version + hashbytes).
  const recipient = (request.recipient as { value: Record<string, { value: string }> }).value;
  expect(recipient.hashbytes.value).toMatch(/^0x[0-9a-f]{40}$/);
  expect(recipient.version.value).toMatch(/^0x[0-9a-f]{2}$/);

  const requestStaker = await fetchCallReadOnlyFunction({
    contractAddress: smAddr,
    contractName: smName,
    functionName: 'get-withdrawal-request-staker',
    functionArgs: [Cl.uint(idAfter)],
    senderAddress: poxStaker.address,
    network,
  });
  // cvToValue unwraps the (optional principal) to { type, value }.
  expect((cvToValue(requestStaker) as { value: string }).value).toBe(poxStaker.address);

  // sBTC balance is untouched — the reward left as a BTC withdrawal, not sBTC.
  const sbtcAfter = await sbtcBalance(poxStaker.address);
  console.log('account6 sBTC after:', sbtcAfter.toString());
  expect(sbtcAfter).toBe(sbtcBefore);
});
