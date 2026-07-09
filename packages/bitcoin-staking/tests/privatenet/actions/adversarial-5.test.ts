/**
 * Adversarial / robustness probes — pox-5 bond contract, batch 5.
 *
 * Permissionless STX-only lane (no admin): fuzzes `stake` / `stake-update` /
 * `unstake` from two fresh accounts (f0/f1) to surface every abort code and
 * flag unexpected successes. Each probe asserts TOLERANTLY (abort or success)
 * since the discovery is the recorded code, not a hard-pinned expectation.
 * Section E re-checks invariants (delegated-for-signer, unlock-cycle, bond
 * membership) after the mutating probes.
 *
 * Run with:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so RECORD=1 \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *     npx jest tests/privatenet/actions/adversarial-5.test.ts --runInBand --collectCoverage=false
 */

import { broadcastTransaction } from '@stacks/transactions';
import {
  buildStake,
  buildStakeUpdate,
  buildUnstake,
  describePox5Error,
  fetchAmountDelegatedForSigner,
  fetchStakerInfo,
  fetchBondMembership,
  isInPreparePhase,
  Pox5ErrorCode,
} from '../../../src';
import { getNetwork } from '../../helpers/utils';
import { getNextNonce, getPoxInfo, getTransaction, parseErrCode } from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';
import { deriveFreshAccount, freshFundedStxAccount } from '../../helpers/fresh-account';

jest.setTimeout(60 * 60_000);

const network = getNetwork();
const FEE = 10_000n;

// The daemon-registered signer-manager on the private testnet.
const SIGNER_MANAGER =
  process.env.SIGNER_MANAGER ?? 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';

// A syntactically-valid but UNREGISTERED signer-manager principal (bogus rotate target).
const BOGUS_SIGNER_MANAGER = 'ST000000000000000000002AMW42H.not-a-signer-manager';

// Deterministic, self-funded probe accounts (survive chain wipes: RECORD re-funds,
// replay derives the same addresses). See tests/helpers/fresh-account.ts.
const f0 = deriveFreshAccount('adv5-f0');
const f1 = deriveFreshAccount('adv5-f1');

/**
 * Per-account nonce manager. Seeded once from the chain. The local nonce
 * advances ONLY when a tx is actually accepted by the node (mined to success
 * or runtime-abort, both of which consume the nonce). A broadcast-REJECTED or
 * `dropped_*` tx never consumed its nonce, so we keep the same value and bump
 * the fee on the next send (fresh txid, avoids TemporarilyBlacklisted).
 */
class NonceManager {
  private next: number | undefined;
  private feeBumps = 0;
  constructor(readonly address: string) {}
  async value(): Promise<number> {
    if (this.next === undefined) this.next = await getNextNonce(this.address);
    return this.next;
  }
  /** Fee with a per-account monotonic bump so re-sends at the same nonce get a fresh txid. */
  fee(base: bigint): bigint {
    return base + BigInt(this.feeBumps) * 1_000n;
  }
  consumed() {
    if (this.next !== undefined) this.next += 1;
  }
  bump() {
    this.feeBumps += 1;
  }
  /** Re-sync from chain (used after races where another tx may have advanced it). */
  async resync() {
    this.next = await getNextNonce(this.address);
  }
}

const nonces = new Map<string, NonceManager>();
function nm(address: string): NonceManager {
  if (!nonces.has(address)) nonces.set(address, new NonceManager(address));
  return nonces.get(address)!;
}

type Outcome =
  | { kind: 'success'; txid: string }
  | { kind: 'abort'; txid: string; code: number }
  | { kind: 'dropped'; txid: string; status: string }
  | { kind: 'rejected'; reason: string }
  | { kind: 'pending'; txid: string };

/**
 * Build -> sign -> broadcast a probe, manage the sender's nonce, classify the
 * outcome. `build` receives the nonce+fee to embed; we retry on broadcast
 * rejection / drop by bumping the fee at the SAME nonce (so a deliberately
 * non-mineable param doesn't poison the rest of the section).
 */
async function probe(
  label: string,
  account: { address: string; key: string; publicKey: string },
  build: (
    nonce: number,
    fee: bigint
  ) => Promise<ReturnType<typeof signTransaction> | { wire: unknown }>,
  sign: (wire: any) => ReturnType<typeof signTransaction>
): Promise<Outcome> {
  useFixtures(`adversarial-5-${label.toLowerCase()}`); // one fixture file per probe broadcast
  const mgr = nm(account.address);
  const nonce = await mgr.value();
  const fee = mgr.fee(FEE);
  const wire = await build(nonce, fee);
  const tx = sign(wire);

  const res = await broadcastTransaction({ transaction: tx, network });
  if ('error' in res) {
    const reason = `${res.error}${'reason' in res ? ` — ${res.reason}` : ''}`;
    console.log(`${label} REJECTED@broadcast:`, reason);
    mgr.bump(); // keep same nonce, next send gets a fresh txid
    return { kind: 'rejected', reason };
  }
  console.log(`${label} txid:`, res.txid);

  const startNonce = nonce;
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const chainNonce = await getNextNonce(account.address);
    if (chainNonce > startNonce) {
      // tx (or a same-nonce competitor) was mined — read this txid's record.
      const rec = await getTransaction(res.txid);
      mgr.consumed();
      if (!rec) {
        console.warn(`${label}: nonce advanced but no record for txid (a same-nonce tx won).`);
        return { kind: 'pending', txid: res.txid };
      }
      if (rec.tx_status === 'success') {
        console.log(`${label} SUCCESS`);
        return { kind: 'success', txid: res.txid };
      }
      if (rec.tx_status === 'abort_by_response') {
        const code = parseErrCode(rec.tx_result?.repr) ?? -1;
        const info = describePox5Error(code);
        console.log(
          `${label} ABORT u${code}`,
          info?.name ?? '(unknown)',
          '—',
          info?.description ?? ''
        );
        return { kind: 'abort', txid: res.txid, code };
      }
      console.log(`${label} mined non-standard status:`, rec.tx_status, rec.tx_result?.repr);
      return { kind: 'pending', txid: res.txid };
    }
    const rec = await getTransaction(res.txid);
    if (rec && rec.tx_status.startsWith('dropped')) {
      console.log(
        `${label} DROPPED:`,
        rec.tx_status,
        '(nonce NOT consumed — node deemed it non-mineable)'
      );
      mgr.bump(); // keep same nonce
      return { kind: 'dropped', txid: res.txid, status: rec.tx_status };
    }
    await new Promise(r => setTimeout(r, 8_000));
  }
  console.warn(`${label}: timed out (still pending) — leaving nonce as-is, will resync.`);
  await mgr.resync();
  return { kind: 'pending', txid: res.txid };
}

/** Summarize an Outcome to a short string for logging. */
function outStr(o: Outcome): string {
  switch (o.kind) {
    case 'success':
      return 'SUCCESS';
    case 'abort':
      return `abort u${o.code}`;
    case 'dropped':
      return `dropped(${o.status})`;
    case 'rejected':
      return `rejected(${o.reason})`;
    case 'pending':
      return 'pending/timeout';
  }
}

async function logStakerInfo(label: string, address: string) {
  const info = await fetchStakerInfo({ address, network }).catch(e => {
    console.warn(`${label} fetchStakerInfo failed:`, e?.message ?? e);
    return undefined;
  });
  if (!info || !info.staked) {
    console.log(`${label} staker-info: NOT STAKING`);
    return undefined;
  }
  const d = info.details!;
  console.log(`${label} staker-info:`, {
    amountUstx: d.amountUstx.toString(),
    firstRewardCycle: d.firstRewardCycle,
    numCycles: d.numCycles,
    unlockCycle: d.firstRewardCycle + d.numCycles,
    signer: d.signer,
  });
  return d;
}

beforeAll(async () => {
  useFixtures('adversarial-5-fund0');
  await freshFundedStxAccount({ network, amountUstx: 50_000_000_000n, label: 'adv5-f0' });
  useFixtures('adversarial-5-fund1');
  await freshFundedStxAccount({ network, amountUstx: 50_000_000_000n, label: 'adv5-f1' });
  useFixtures('adversarial-5'); // base key: setup reads before per-test keys
  const poxInfo = await getPoxInfo();
  console.log('f0:', f0.address, '| f1:', f1.address);
  console.log('signerManager:', SIGNER_MANAGER);
  console.log(
    'current cycle:',
    poxInfo.rewardCycleId,
    '| burnHt:',
    poxInfo.currentBurnchainBlockHeight
  );
  console.log('cycleLen:', poxInfo.rewardCycleLength, '| prepareLen:', poxInfo.prepareCycleLength);
}, 60 * 60_000);

// SECTION A: STAKE PARAM FUZZ (f1, fresh; sequential, nonce-managed)
// A `dropped_*` / `rejected` outcome means the node refused the tx as
// non-mineable before it reached the contract runtime; it does not consume
// the nonce, so the next probe reuses it with a fee bump.

test('A1: stake amount-ustx=0 (no contract min floor — node may drop)', async () => {
  useFixtures('adversarial-5-a1');
  const poxInfo = await getPoxInfo();
  const o = await probe(
    'A1-amount0',
    f1,
    (nonce, fee) =>
      buildStake({
        signerManager: SIGNER_MANAGER,
        amountUstx: 0n,
        numCycles: 1,
        startBurnHt: poxInfo.currentBurnchainBlockHeight,
        publicKey: f1.publicKey,
        fee,
        nonce,
        network,
        postConditionMode: 'allow',
      }),
    wire => signTransaction(wire as any, f1.key)
  );
  console.log('A1 OUTCOME:', outStr(o));
  if (o.kind === 'success') {
    console.warn(
      'A1 NOTE: 0-uSTX stake SUCCEEDED on-chain — a zero-amount position exists (signer-set math griefing surface).'
    );
    await logStakerInfo('A1', f1.address);
    // clean up so later f1 probes can target a NON-staking f1
    const poxInfo2 = await getPoxInfo();
    if (!isInPreparePhase({ burnHeight: poxInfo2.currentBurnchainBlockHeight, poxInfo: poxInfo2 }))
      await probe(
        'A1-cleanup-unstake',
        f1,
        (nonce, fee) =>
          buildUnstake({
            oldSignerManager: SIGNER_MANAGER,
            publicKey: f1.publicKey,
            fee,
            nonce,
            network,
            postConditionMode: 'allow',
          }),
        wire => signTransaction(wire as any, f1.key)
      );
  }
  expect(['success', 'abort', 'dropped', 'rejected', 'pending']).toContain(o.kind);
});

test('A2: stake num-cycles=0 expects u20 InvalidNumCycles (or node-drop)', async () => {
  useFixtures('adversarial-5-a2');
  const poxInfo = await getPoxInfo();
  const o = await probe(
    'A2-cycles0',
    f1,
    (nonce, fee) =>
      buildStake({
        signerManager: SIGNER_MANAGER,
        amountUstx: 1_000_000n,
        numCycles: 0,
        startBurnHt: poxInfo.currentBurnchainBlockHeight,
        publicKey: f1.publicKey,
        fee,
        nonce,
        network,
        postConditionMode: 'allow',
      }),
    wire => signTransaction(wire as any, f1.key)
  );
  console.log('A2 OUTCOME:', outStr(o));
  if (o.kind === 'abort' && o.code !== Pox5ErrorCode.InvalidNumCycles) {
    console.warn(`A2 UNEXPECTED abort u${o.code} (expected u20)`);
  }
  if (o.kind === 'success') console.warn('A2 BUG?: num-cycles=0 SUCCEEDED — no num-cycles floor!');
  expect(true).toBe(true);
});

test('A3: stake num-cycles=100 expects u20 InvalidNumCycles', async () => {
  useFixtures('adversarial-5-a3');
  const poxInfo = await getPoxInfo();
  const o = await probe(
    'A3-cycles100',
    f1,
    (nonce, fee) =>
      buildStake({
        signerManager: SIGNER_MANAGER,
        amountUstx: 1_000_000n,
        numCycles: 100,
        startBurnHt: poxInfo.currentBurnchainBlockHeight,
        publicKey: f1.publicKey,
        fee,
        nonce,
        network,
        postConditionMode: 'allow',
      }),
    wire => signTransaction(wire as any, f1.key)
  );
  console.log('A3 OUTCOME:', outStr(o));
  if (o.kind === 'abort' && o.code !== Pox5ErrorCode.InvalidNumCycles) {
    console.warn(`A3 UNEXPECTED abort u${o.code} (expected u20)`);
  }
  if (o.kind === 'success') {
    console.warn('A3 BUG?: num-cycles=100 SUCCEEDED — missing upper bound on lock period!');
    await logStakerInfo('A3', f1.address);
  }
  expect(true).toBe(true);
});

test('A4: stake startBurnHt far in the PAST expects u24 InvalidStartBurnHeight', async () => {
  useFixtures('adversarial-5-a4');
  const poxInfo = await getPoxInfo();
  const past = Math.max(1, poxInfo.currentBurnchainBlockHeight - 3 * poxInfo.rewardCycleLength);
  const o = await probe(
    'A4-pastHt',
    f1,
    (nonce, fee) =>
      buildStake({
        signerManager: SIGNER_MANAGER,
        amountUstx: 1_000_000n,
        numCycles: 1,
        startBurnHt: past,
        publicKey: f1.publicKey,
        fee,
        nonce,
        network,
        postConditionMode: 'allow',
      }),
    wire => signTransaction(wire as any, f1.key)
  );
  console.log('A4 OUTCOME:', outStr(o));
  if (o.kind === 'abort' && o.code !== Pox5ErrorCode.InvalidStartBurnHeight) {
    console.warn(`A4 UNEXPECTED abort u${o.code} (expected u24)`);
  }
  if (o.kind === 'success')
    console.warn('A4 BUG?: past startBurnHt SUCCEEDED — replay guard bypassed!');
  expect(true).toBe(true);
});

test('A5: stake startBurnHt far in the FUTURE expects u24 InvalidStartBurnHeight', async () => {
  useFixtures('adversarial-5-a5');
  const poxInfo = await getPoxInfo();
  const future = poxInfo.currentBurnchainBlockHeight + 5 * poxInfo.rewardCycleLength;
  const o = await probe(
    'A5-futureHt',
    f1,
    (nonce, fee) =>
      buildStake({
        signerManager: SIGNER_MANAGER,
        amountUstx: 1_000_000n,
        numCycles: 1,
        startBurnHt: future,
        publicKey: f1.publicKey,
        fee,
        nonce,
        network,
        postConditionMode: 'allow',
      }),
    wire => signTransaction(wire as any, f1.key)
  );
  console.log('A5 OUTCOME:', outStr(o));
  if (o.kind === 'abort' && o.code !== Pox5ErrorCode.InvalidStartBurnHeight) {
    console.warn(`A5 UNEXPECTED abort u${o.code} (expected u24)`);
  }
  if (o.kind === 'success')
    console.warn('A5 BUG?: future startBurnHt SUCCEEDED — replay guard bypassed!');
  expect(true).toBe(true);
});

test('A6: stake with BOGUS (unregistered) signer-manager aborts / drops', async () => {
  useFixtures('adversarial-5-a6');
  const poxInfo = await getPoxInfo();
  const o = await probe(
    'A6-bogusSigner',
    f1,
    (nonce, fee) =>
      buildStake({
        signerManager: BOGUS_SIGNER_MANAGER,
        amountUstx: 1_000_000n,
        numCycles: 1,
        startBurnHt: poxInfo.currentBurnchainBlockHeight,
        publicKey: f1.publicKey,
        fee,
        nonce,
        network,
        postConditionMode: 'allow',
      }),
    wire => signTransaction(wire as any, f1.key)
  );
  console.log('A6 OUTCOME:', outStr(o));
  if (o.kind === 'success')
    console.warn(
      'A6 BUG?: stake with bogus/non-existent signer-manager SUCCEEDED — trait gate bypassed!'
    );
  expect(true).toBe(true);
});

test('A7: stake with garbage signerCalldata', async () => {
  useFixtures('adversarial-5-a7');
  const poxInfo = await getPoxInfo();
  const garbage = new Uint8Array(64).fill(0xab);
  const o = await probe(
    'A7-garbageCalldata',
    f1,
    (nonce, fee) =>
      buildStake({
        signerManager: SIGNER_MANAGER,
        amountUstx: 1_000_000n,
        numCycles: 1,
        startBurnHt: poxInfo.currentBurnchainBlockHeight,
        signerCalldata: garbage,
        publicKey: f1.publicKey,
        fee,
        nonce,
        network,
        postConditionMode: 'allow',
      }),
    wire => signTransaction(wire as any, f1.key)
  );
  console.log('A7 OUTCOME:', outStr(o));
  if (o.kind === 'success') {
    console.log('A7 NOTE: garbage calldata ACCEPTED (daemon signer-manager ignores calldata).');
    await logStakerInfo('A7', f1.address);
    const poxInfo2 = await getPoxInfo();
    if (!isInPreparePhase({ burnHeight: poxInfo2.currentBurnchainBlockHeight, poxInfo: poxInfo2 }))
      await probe(
        'A7-cleanup-unstake',
        f1,
        (nonce, fee) =>
          buildUnstake({
            oldSignerManager: SIGNER_MANAGER,
            publicKey: f1.publicKey,
            fee,
            nonce,
            network,
            postConditionMode: 'allow',
          }),
        wire => signTransaction(wire as any, f1.key)
      );
  }
  expect(true).toBe(true);
});

// SECTION B: BASELINE STAKE on f0 (legit) + STAKE-UPDATE abuse

test('B0: f0 baseline stake (40k STX, 2 cycles)', async () => {
  useFixtures('adversarial-5-b0');
  const existing = await logStakerInfo('B0-pre', f0.address);
  if (existing) {
    console.log('B0: f0 already staked — reusing position.');
    expect(true).toBe(true);
    return;
  }
  const poxInfo = await getPoxInfo();
  // NOTE: must leave headroom for fees — the contract's u8 guard checks
  // total-balance (locked+unlocked) >= amount-ustx, so staking the FULL 50k STX
  // balance fails once fees are deducted. 40k leaves comfortable headroom.
  const o = await probe(
    'B0-baseline',
    f0,
    (nonce, fee) =>
      buildStake({
        signerManager: SIGNER_MANAGER,
        amountUstx: 40_000_000_000n,
        numCycles: 2,
        startBurnHt: poxInfo.currentBurnchainBlockHeight,
        publicKey: f0.publicKey,
        fee,
        nonce,
        network,
        postConditionMode: 'allow',
      }),
    wire => signTransaction(wire as any, f0.key)
  );
  console.log('B0 OUTCOME:', outStr(o));
  await logStakerInfo('B0-post', f0.address);
  if (o.kind !== 'success')
    console.warn(`B0: baseline stake ${outStr(o)} — B-section update probes may be no-ops.`);
  expect(true).toBe(true);
});

test('B1: stake-update wrong oldSignerManager expects u36 InvalidOldSignerManager', async () => {
  useFixtures('adversarial-5-b1');
  const o = await probe(
    'B1-wrongOldSigner',
    f0,
    (nonce, fee) =>
      buildStakeUpdate({
        signerManager: SIGNER_MANAGER,
        oldSignerManager: BOGUS_SIGNER_MANAGER,
        cyclesToExtend: 1,
        amountIncrease: 0n,
        publicKey: f0.publicKey,
        fee,
        nonce,
        network,
        postConditionMode: 'allow',
      }),
    wire => signTransaction(wire as any, f0.key)
  );
  console.log('B1 OUTCOME:', outStr(o));
  if (o.kind === 'abort' && o.code !== Pox5ErrorCode.InvalidOldSignerManager) {
    console.warn(`B1 UNEXPECTED abort u${o.code} (expected u36)`);
  }
  if (o.kind === 'success') console.warn('B1 BUG?: update with WRONG oldSignerManager SUCCEEDED!');
  expect(true).toBe(true);
});

test('B2: stake-update extend 0 / topup 0 / same signer — invariant watch', async () => {
  useFixtures('adversarial-5-b2');
  const poxInfo = await getPoxInfo();
  const before = await logStakerInfo('B2-pre', f0.address);
  const delBefore = await fetchAmountDelegatedForSigner({
    signerManager: SIGNER_MANAGER,
    cycle: poxInfo.rewardCycleId + 1,
    network,
  }).catch(() => -1n);
  console.log('B2 delegated(next cycle) before:', delBefore.toString());

  const o = await probe(
    'B2-noopUpdate',
    f0,
    (nonce, fee) =>
      buildStakeUpdate({
        signerManager: SIGNER_MANAGER,
        oldSignerManager: SIGNER_MANAGER,
        cyclesToExtend: 0,
        amountIncrease: 0n,
        publicKey: f0.publicKey,
        fee,
        nonce,
        network,
        postConditionMode: 'allow',
      }),
    wire => signTransaction(wire as any, f0.key)
  );
  console.log('B2 OUTCOME:', outStr(o));

  useFixtures('adversarial-5-b2-after');
  const after = await logStakerInfo('B2-post', f0.address);
  const delAfter = await fetchAmountDelegatedForSigner({
    signerManager: SIGNER_MANAGER,
    cycle: poxInfo.rewardCycleId + 1,
    network,
  }).catch(() => -1n);
  console.log('B2 delegated(next cycle) after:', delAfter.toString());

  if (before && after) {
    const unlockBefore = before.firstRewardCycle + before.numCycles;
    const unlockAfter = after.firstRewardCycle + after.numCycles;
    if (unlockAfter < unlockBefore)
      console.warn(`B2 BUG?: unlock-cycle moved BACKWARDS ${unlockBefore} -> ${unlockAfter}`);
    if (
      o.kind === 'success' &&
      delBefore >= 0n &&
      delAfter > delBefore &&
      after.amountUstx === before.amountUstx
    ) {
      console.warn(
        `B2 BUG?: delegated-for-signer grew (${delBefore}->${delAfter}) on a 0-topup no-op (double-count?).`
      );
    }
  }
  expect(true).toBe(true);
});

test('B3: stake-update cyclesToExtend=100 expects u20 InvalidNumCycles', async () => {
  useFixtures('adversarial-5-b3');
  const o = await probe(
    'B3-extend100',
    f0,
    (nonce, fee) =>
      buildStakeUpdate({
        signerManager: SIGNER_MANAGER,
        oldSignerManager: SIGNER_MANAGER,
        cyclesToExtend: 100,
        amountIncrease: 0n,
        publicKey: f0.publicKey,
        fee,
        nonce,
        network,
        postConditionMode: 'allow',
      }),
    wire => signTransaction(wire as any, f0.key)
  );
  console.log('B3 OUTCOME:', outStr(o));
  await logStakerInfo('B3-post', f0.address);
  if (o.kind === 'abort' && o.code !== Pox5ErrorCode.InvalidNumCycles) {
    console.warn(`B3 UNEXPECTED abort u${o.code} (expected u20)`);
  }
  if (o.kind === 'success')
    console.warn('B3 BUG?: cyclesToExtend=100 SUCCEEDED — missing upper bound on extended lock!');
  expect(true).toBe(true);
});

test('B4: stake-update rotate to BOGUS signer-manager (correct oldSignerManager)', async () => {
  useFixtures('adversarial-5-b4');
  const before = await logStakerInfo('B4-pre', f0.address);
  const o = await probe(
    'B4-rotateBogus',
    f0,
    (nonce, fee) =>
      buildStakeUpdate({
        signerManager: BOGUS_SIGNER_MANAGER,
        oldSignerManager: SIGNER_MANAGER,
        cyclesToExtend: 0,
        amountIncrease: 0n,
        publicKey: f0.publicKey,
        fee,
        nonce,
        network,
        postConditionMode: 'allow',
      }),
    wire => signTransaction(wire as any, f0.key)
  );
  console.log('B4 OUTCOME:', outStr(o));
  useFixtures('adversarial-5-b4-after');
  const after = await logStakerInfo('B4-post', f0.address);
  if (o.kind === 'success' && before && after && after.signer !== before.signer) {
    console.warn(
      `B4 BUG?: signer rotated to bogus principal ${after.signer} — recorded signer now points at a non-existent contract!`
    );
  }
  expect(true).toBe(true);
});

test('B5: stake-update on a NON-staking account expects u27 NotStaking', async () => {
  useFixtures('adversarial-5-b5');
  const info = await fetchStakerInfo({ address: f1.address, network }).catch(() => undefined);
  if (info?.staked) console.log('B5 NOTE: f1 IS staking — update follows normal path.');
  const o = await probe(
    'B5-updateNonStaker',
    f1,
    (nonce, fee) =>
      buildStakeUpdate({
        signerManager: SIGNER_MANAGER,
        oldSignerManager: SIGNER_MANAGER,
        cyclesToExtend: 1,
        amountIncrease: 0n,
        publicKey: f1.publicKey,
        fee,
        nonce,
        network,
        postConditionMode: 'allow',
      }),
    wire => signTransaction(wire as any, f1.key)
  );
  console.log('B5 OUTCOME:', outStr(o));
  if (!info?.staked && o.kind === 'abort' && o.code !== Pox5ErrorCode.NotStaking) {
    console.warn(`B5 UNEXPECTED abort u${o.code} (expected u27 for non-staker)`);
  }
  expect(true).toBe(true);
});

// SECTION C: DOUBLE / RACE

test('C1: re-stake f0 while already staked expects u19 AlreadyStaked', async () => {
  useFixtures('adversarial-5-c1');
  const info = await fetchStakerInfo({ address: f0.address, network }).catch(() => undefined);
  if (!info?.staked) {
    console.warn('C1 SKIP: f0 not currently staked.');
    expect(true).toBe(true);
    return;
  }
  const poxInfo = await getPoxInfo();
  const o = await probe(
    'C1-reStake',
    f0,
    (nonce, fee) =>
      buildStake({
        signerManager: SIGNER_MANAGER,
        amountUstx: 1_000_000n,
        numCycles: 1,
        startBurnHt: poxInfo.currentBurnchainBlockHeight,
        publicKey: f0.publicKey,
        fee,
        nonce,
        network,
        postConditionMode: 'allow',
      }),
    wire => signTransaction(wire as any, f0.key)
  );
  console.log('C1 OUTCOME:', outStr(o));
  if (o.kind === 'abort' && o.code !== Pox5ErrorCode.AlreadyStaked) {
    console.warn(`C1 UNEXPECTED abort u${o.code} (expected u19)`);
  }
  if (o.kind === 'success')
    console.warn('C1 BUG?: re-stake while already staked SUCCEEDED — double position!');
  expect(true).toBe(true);
});

test('C2: two stakes from f1 at the SAME nonce — only one lands', async () => {
  useFixtures('adversarial-5-c2');
  const mgr = nm(f1.address);
  await mgr.resync();
  const nonce = await mgr.value();
  const poxInfo = await getPoxInfo();

  const mk = async (amount: bigint, fee: bigint) =>
    signTransaction(
      await buildStake({
        signerManager: SIGNER_MANAGER,
        amountUstx: amount,
        numCycles: 1,
        startBurnHt: poxInfo.currentBurnchainBlockHeight,
        publicKey: f1.publicKey,
        fee,
        nonce,
        network,
        postConditionMode: 'allow',
      }),
      f1.key
    );

  const txA = await mk(1_000_000n, FEE);
  const rA = await broadcastTransaction({ transaction: txA, network });
  useFixtures('adversarial-5-c2-txb'); // isolate the second same-nonce broadcast
  const txB = await mk(2_000_000n, FEE + 7_000n); // higher fee, distinct txid, same nonce
  const rB = await broadcastTransaction({ transaction: txB, network });
  console.log('C2 broadcast A:', 'error' in rA ? `err:${rA.error}` : rA.txid);
  console.log('C2 broadcast B:', 'error' in rB ? `err:${rB.error}` : rB.txid);

  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if ((await getNextNonce(f1.address)) > nonce) break;
    await new Promise(r => setTimeout(r, 8_000));
  }
  let successes = 0;
  for (const [lbl, r] of [
    ['A', rA],
    ['B', rB],
  ] as const) {
    if ('txid' in r) {
      const rec = await getTransaction(r.txid);
      console.log(`C2 ${lbl} final:`, rec?.tx_status, rec?.tx_result?.repr);
      if (rec?.tx_status === 'success') successes += 1;
    }
  }
  await mgr.resync();
  await logStakerInfo('C2-post', f1.address);
  console.log(
    `C2: ${successes} of 2 same-nonce txs reached success (must be <= 1 — no double position).`
  );
  if (successes > 1)
    console.warn('C2 BUG?: BOTH same-nonce stakes succeeded — double position / nonce reuse!');
  expect(successes).toBeLessThanOrEqual(1);
  // clean up any f1 position created here
  const poxInfo2 = await getPoxInfo();
  const f1info = await fetchStakerInfo({ address: f1.address, network }).catch(() => undefined);
  if (f1info?.staked && !isInPreparePhase({ burnHeight: poxInfo2.currentBurnchainBlockHeight, poxInfo: poxInfo2 }))
    await probe(
      'C2-cleanup-unstake',
      f1,
      (nonce, fee) =>
        buildUnstake({
          oldSignerManager: SIGNER_MANAGER,
          publicKey: f1.publicKey,
          fee,
          nonce,
          network,
          postConditionMode: 'allow',
        }),
      wire => signTransaction(wire as any, f1.key)
    );
});

// SECTION D: UNSTAKE

test('D1: unstake f0 wrong oldSignerManager expects u36 InvalidOldSignerManager', async () => {
  useFixtures('adversarial-5-d1');
  const info = await fetchStakerInfo({ address: f0.address, network }).catch(() => undefined);
  if (!info?.staked) {
    console.warn('D1 SKIP: f0 not staked.');
    expect(true).toBe(true);
    return;
  }
  const o = await probe(
    'D1-unstakeWrongSigner',
    f0,
    (nonce, fee) =>
      buildUnstake({
        oldSignerManager: BOGUS_SIGNER_MANAGER,
        publicKey: f0.publicKey,
        fee,
        nonce,
        network,
        postConditionMode: 'allow',
      }),
    wire => signTransaction(wire as any, f0.key)
  );
  console.log('D1 OUTCOME:', outStr(o));
  if (o.kind === 'abort' && o.code !== Pox5ErrorCode.InvalidOldSignerManager) {
    console.warn(`D1 UNEXPECTED abort u${o.code} (expected u36)`);
  }
  if (o.kind === 'success') console.warn('D1 BUG?: unstake with WRONG oldSignerManager SUCCEEDED!');
  expect(true).toBe(true);
});

test('D2: unstake a NON-staking account expects u27 NotStaking (or u28 in prepare phase)', async () => {
  useFixtures('adversarial-5-d2');
  const info = await fetchStakerInfo({ address: f1.address, network }).catch(() => undefined);
  if (info?.staked) console.log('D2 NOTE: f1 IS staking — unstake follows normal/prepare path.');
  const o = await probe(
    'D2-unstakeNonStaker',
    f1,
    (nonce, fee) =>
      buildUnstake({
        oldSignerManager: SIGNER_MANAGER,
        publicKey: f1.publicKey,
        fee,
        nonce,
        network,
        postConditionMode: 'allow',
      }),
    wire => signTransaction(wire as any, f1.key)
  );
  console.log('D2 OUTCOME:', outStr(o));
  if (o.kind === 'abort') {
    if (o.code === Pox5ErrorCode.UnstakeInPreparePhase)
      console.log('D2: hit u28 UnstakeInPreparePhase — prepare-phase guard observed.');
    else if (!info?.staked && o.code !== Pox5ErrorCode.NotStaking)
      console.warn(`D2 UNEXPECTED abort u${o.code} (expected u27/u28)`);
  }
  if (!info?.staked && o.kind === 'success')
    console.warn('D2 BUG?: unstake on a NON-staking account SUCCEEDED!');
  expect(true).toBe(true);
});

// SECTION E: READ-ONLY INVARIANTS (post-attack consistency)

test('E1: post-attack invariants — delegated >= 0, no f0 bond membership, unlock-cycle sane', async () => {
  useFixtures('adversarial-5-e1');
  const poxInfo = await getPoxInfo();
  for (const c of [poxInfo.rewardCycleId, poxInfo.rewardCycleId + 1]) {
    const d = await fetchAmountDelegatedForSigner({ signerManager: SIGNER_MANAGER, cycle: c, network }).catch(() => -1n);
    console.log(`E1 delegated-for-signer[cycle ${c}]:`, d.toString());
    if (d < 0n) console.warn(`E1 BUG?: delegated-for-signer NEGATIVE at cycle ${c}: ${d}`);
    expect(d >= 0n).toBe(true);
  }
  const membership = await fetchBondMembership({ address: f0.address, network }).catch(
    () => undefined
  );
  console.log('E1 f0 bond-membership:', membership ?? 'none (expected)');
  if (membership) console.warn('E1 BUG?: STX-only f0 has a bond membership — should be none.');

  const info = await logStakerInfo('E1-f0', f0.address);
  if (info) {
    const unlock = info.firstRewardCycle + info.numCycles;
    if (unlock <= poxInfo.rewardCycleId)
      console.warn(
        `E1 NOTE: f0 staked but unlock-cycle ${unlock} <= current ${poxInfo.rewardCycleId}.`
      );
  }
  await logStakerInfo('E1-f1', f1.address);
  expect(true).toBe(true);
});
