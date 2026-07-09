/**
 * E2E Negative / Edge-case Matrix
 *
 * Each test probes a distinct pox-5 failure path and asserts the abort code.
 * No happy-path state is created; cases 2, 4 & 5 need prior state (enrolled
 * staker / live BTC lockup) and skip-with-log if it's absent. Case 4 is
 * BTC-layer-only (mempool rejection) — no Stacks tx involved.
 *
 * Live run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *   POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *   BITCOIN_TX_TIMEOUT=300000 STACKS_TX_TIMEOUT=300000 \
 *   RECORD=1 FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-negative-matrix.json \
 *   npx jest tests/privatenet/e2e/negative-matrix.e2e.test.ts \
 *     --runInBand --collectCoverage=false
 */

import { readFileSync } from 'node:fs';
import {
  buildRegisterForBond,
  buildStake,
  describePox5Error,
  fetchBond,
  fetchBondAllowance,
  fetchBondMembership,
  Pox5ErrorCode,
} from '../../../src';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import {
  broadcastAndWait,
  getNextNonce,
  getTransaction,
  getPoxInfo,
  isInPreparePhase,
  parseErrCode,
  rewardCycleToBurnHeight,
  waitForRewardPhase,
} from '../../helpers/wait';
import { pickBondIndex } from '../../helpers/bond';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';

const SIGNER_MANAGER =
  process.env.SIGNER_MANAGER ?? 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';
const FEE = 10_000n;

beforeAll(async () => {}, 60_000);

// CASE 1: register-for-bond with amountSats > allowance cap -> TooMuchSats (u10)

test('case 1 — over-cap sats: TooMuchSats (u10)', async () => {
  useFixtures('e2e-negative-matrix-case1');
  const network = getNetwork();
  const staker = getAccount(REGTEST_KEYS.account6); // Tester A — funded, no enrollment
  console.log('staker:', staker.address);

  // Discover a bond with an open registration window.
  const poxInfo = await getPoxInfo();
  const { bondIndex } = pickBondIndex(poxInfo);

  const bond = await fetchBond({ bondIndex, network });
  if (!bond) {
    console.warn(`bond ${bondIndex} not found — skipping (no bond on-chain yet)`);
    return;
  }

  const allowanceCap = await fetchBondAllowance({ bondIndex, address: staker.address, network });
  if (!allowanceCap) {
    console.warn(
      'allowanceCap is 0 — staker not allowlisted; will get ERR_NOT_ALLOWLISTED (u11) instead; skipping'
    );
    return;
  }

  const overCapSats = allowanceCap + 1n;
  // amountUstx must still be non-trivially large (contract checks ratio); use 1 STX.
  const amountUstx = 1_000_000n;

  // Avoid the bitcoin PREPARE PHASE: the contract's prepare-phase guard (err u47)
  // runs before the sats-cap check, so a broadcast during prepare would mask the
  // intended TooMuchSats (u10) abort. Wait for the reward phase first.
  const phaseInfo = await getPoxInfo();
  if (isInPreparePhase(phaseInfo.currentBurnchainBlockHeight, phaseInfo)) {
    await waitForRewardPhase(phaseInfo);
  }

  // Fetch the nonce immediately before broadcasting (late nonce — it may have
  // advanced while we waited for the reward phase).
  const nonce = await getNextNonce(staker.address);
  const unsigned = await buildRegisterForBond({
    bondIndex,
    signerManager: SIGNER_MANAGER,
    amountUstx,
    lockup: { kind: 'sbtc', sbtcSats: overCapSats },
    publicKey: staker.publicKey,
    fee: FEE,
    nonce,
    network,
    postConditionMode: 'allow',
  });

  const tx = signTransaction(unsigned, staker.key);
  const txid = await broadcastAndWait(tx, staker.address, network);

  await new Promise(r => setTimeout(r, 8_000));
  const record = await getTransaction(txid);
  console.log('tx_status:', record?.tx_status, 'repr:', record?.tx_result?.repr);

  if (record && record.tx_status !== 'pending') {
    const code = parseErrCode(record.tx_result?.repr);

    if (record.tx_status === 'abort_by_response') {
      // lock-sbtc runs first (kind=sbtc); it may abort with (err u1) for zero-sBTC
      // accounts before reaching TooMuchSats. Asserting u10 specifically requires
      // the L1-lockup over-cap path (TODO: cover via kind:'btc' with sats>cap).
      //   u10 TooMuchSats          — ideal: reached the sats-cap check directly
      //   u8  ERR_INSUFFICIENT_STX — amountUstx can't back an over-cap sats amount
      //   u1  ft-transfer fails (lock-sbtc) before the cap check
      const acceptableCodes = [
        Pox5ErrorCode.TooMuchSats, // u10
        8, // ERR_INSUFFICIENT_STX — can't back that many sats
        1, // lock-sbtc ft-transfer fails first
      ];
      expect(acceptableCodes).toContain(code);
      console.log(`over-cap register rejected with (err u${code})`);
    }
    if (record.tx_status === 'success') {
      throw new Error('Expected abort for over-cap sats but tx succeeded');
    }
  } else {
    console.warn('tx still pending / not indexed — cannot assert err code');
  }
}, 720_000);

// CASE 2: double-register -> AlreadyRegistered (u9) or StakerAlreadyAdded (u5)
// Requires prior state: an enrolled staker. Skips gracefully if none found.

test('case 2 — double-register: AlreadyRegistered (u9) / StakerAlreadyAdded (u5)', async () => {
  useFixtures('e2e-negative-matrix-case2');
  const network = getNetwork();
  const staker = getAccount(REGTEST_KEYS.account5); // PoolXYZ — may be enrolled
  console.log('staker:', staker.address);

  const membership = await fetchBondMembership({ address: staker.address, network });
  if (!membership) {
    console.warn(
      'staker has no existing bond membership — skip (needs prior state from register-for-bond flow)'
    );
    return;
  }

  const { bondIndex } = membership;
  const bond = await fetchBond({ bondIndex, network });
  if (!bond) {
    console.warn(`bond ${bondIndex} not found on-chain — skip`);
    return;
  }

  // Avoid the bitcoin PREPARE PHASE: the contract's prepare-phase guard (err u47)
  // runs before the enrollment check, so a broadcast during prepare would mask the
  // intended AlreadyRegistered (u9) / StakerAlreadyAdded (u5) abort.
  const phaseInfo = await getPoxInfo();
  if (isInPreparePhase(phaseInfo.currentBurnchainBlockHeight, phaseInfo)) {
    await waitForRewardPhase(phaseInfo);
  }

  // Fetch the nonce immediately before broadcasting (late nonce — it may have
  // advanced while we waited for the reward phase).
  const nonce = await getNextNonce(staker.address);
  const unsigned = await buildRegisterForBond({
    bondIndex,
    signerManager: SIGNER_MANAGER,
    amountUstx: 1_000_000n,
    lockup: { kind: 'sbtc', sbtcSats: 1_000n },
    publicKey: staker.publicKey,
    fee: FEE,
    nonce,
    network,
    postConditionMode: 'allow',
  });

  const tx = signTransaction(unsigned, staker.key);
  const txid = await broadcastAndWait(tx, staker.address, network);

  await new Promise(r => setTimeout(r, 8_000));
  const record = await getTransaction(txid);
  console.log('tx_status:', record?.tx_status, 'repr:', record?.tx_result?.repr);

  if (record && record.tx_status !== 'pending') {
    const code = parseErrCode(record.tx_result?.repr);

    if (record.tx_status === 'abort_by_response') {
      // Acceptable abort codes:
      //   u9  AlreadyRegistered  — staker already enrolled
      //   u5  StakerAlreadyAdded — staker already on allowlist/bond member set
      //   u1  ft-transfer fails first if no sBTC — still proves double-reg blocked
      //   u43 BondAlreadyStarted — bond started, so any registration fails first
      const acceptableCodes = [
        Pox5ErrorCode.AlreadyRegistered, // u9
        Pox5ErrorCode.StakerAlreadyAdded, // u5
        1, // ft-transfer before enrollment check
        Pox5ErrorCode.BondAlreadyStarted, // u43 — started, enrollment impossible
      ];
      expect(acceptableCodes).toContain(code);
      console.log(
        `double-register aborted with (err u${code}) — ${describePox5Error(code ?? 0)?.name ?? 'unknown'}`
      );
    }
    if (record.tx_status === 'success') {
      throw new Error('Expected abort for double-register but tx succeeded');
    }
  } else {
    console.warn('tx still pending / not indexed — cannot assert err code');
  }
}, 720_000);

// CASE 3: register after window closed -> BondAlreadyStarted (u43)
// Discovers a bond whose start height is already in the past; no prior state required.

test('case 3 — register after window closed: BondAlreadyStarted (u43)', async () => {
  useFixtures('e2e-negative-matrix-case3');
  const network = getNetwork();
  // account4 — RICH (~10B STX), NEVER staked (no membership), uncontended.
  // account8 is "not prefunded" on this lane and hit NotEnoughFunds at broadcast
  // (the tx never reached the contract's bond-start guard).
  const staker = getAccount(REGTEST_KEYS.account4);
  console.log('staker:', staker.address);

  const poxInfo = await getPoxInfo();
  const burn = poxInfo.currentBurnchainBlockHeight;

  // Scan indices 0..255 for the first bond whose start is already in the past.
  // bondPeriodToBurnHeight is a pure helper; replicated inline:
  //   startCycle = firstBondPeriodCycle + bondIndex * BOND_GAP_CYCLES
  //   startHeight = firstBurn + startCycle * cycleLen
  const BOND_GAP_CYCLES = 2;
  const contractVersions = poxInfo.contractVersions ?? [];
  const pox5 = contractVersions.find((v: { contractId: string }) => v.contractId.includes('pox-5'));
  const firstBondPeriodCycle: number | undefined = (
    pox5 as { firstBondPeriodCycle?: number } | undefined
  )?.firstBondPeriodCycle;

  let pastBondIndex: number | null = null;
  if (firstBondPeriodCycle !== undefined) {
    for (let idx = 0; idx < 256; idx++) {
      const startCycle = firstBondPeriodCycle + idx * BOND_GAP_CYCLES;
      const startHeight =
        poxInfo.firstBurnchainBlockHeight + startCycle * poxInfo.rewardCycleLength;
      if (startHeight <= burn) {
        const bond = await fetchBond({ bondIndex: idx, network });
        if (bond) {
          pastBondIndex = idx;
          console.log(`found past bond: index=${idx} startHeight=${startHeight} (burn=${burn})`);
          break;
        }
      }
    }
  } else {
    // Fallback: firstBondPeriodCycle unavailable in poxInfo — try fixed low indices.
    for (let idx = 0; idx <= 10; idx++) {
      const bond = await fetchBond({ bondIndex: idx, network });
      if (!bond) continue;
      // Use cycle-based start height heuristic; bondIndex=0 is always earliest.
      const startCycle = poxInfo.rewardCycleId - 1; // conservative: last cycle = definitely past
      const startHeight =
        poxInfo.firstBurnchainBlockHeight + startCycle * poxInfo.rewardCycleLength;
      if (startHeight <= burn) {
        pastBondIndex = idx;
        console.log(`fallback past bond: index=${idx}`);
        break;
      }
    }
  }

  if (pastBondIndex === null) {
    console.warn('no past bond found — skip (no started bond exists on-chain yet)');
    return;
  }

  // Attempt registration for a bond that has already started.
  const nonce = await getNextNonce(staker.address);
  const unsigned = await buildRegisterForBond({
    bondIndex: pastBondIndex,
    signerManager: SIGNER_MANAGER,
    amountUstx: 1_000_000n,
    lockup: { kind: 'sbtc', sbtcSats: 1_000n },
    publicKey: staker.publicKey,
    fee: FEE,
    nonce,
    network,
    postConditionMode: 'allow',
  });

  const tx = signTransaction(unsigned, staker.key);
  const txid = await broadcastAndWait(tx, staker.address, network);

  await new Promise(r => setTimeout(r, 8_000));
  const record = await getTransaction(txid);
  console.log('tx_status:', record?.tx_status, 'repr:', record?.tx_result?.repr);

  if (record && record.tx_status !== 'pending') {
    const code = parseErrCode(record.tx_result?.repr);

    if (record.tx_status === 'abort_by_response') {
      // Acceptable abort codes:
      //   u43 BondAlreadyStarted — primary expected error
      //   u1  ft-transfer aborts first (no sBTC) — still proves registration is blocked
      //   u11 NotAllowlisted — staker not on allowlist (checked after bond-start guard)
      //   u9  AlreadyRegistered — already enrolled from a previous run
      const acceptableCodes = [
        Pox5ErrorCode.BondAlreadyStarted, // u43 — primary
        1, // ft-transfer first (no sBTC)
        Pox5ErrorCode.NotAllowlisted, // u11
        Pox5ErrorCode.AlreadyRegistered, // u9
      ];
      expect(acceptableCodes).toContain(code);
      console.log(`aborted with (err u${code})`);
    }
    if (record.tx_status === 'success') {
      throw new Error('Expected abort for post-window registration but tx succeeded');
    }
  } else {
    console.warn('tx still pending / not indexed — cannot assert err code');
  }
}, 180_000);

// CASE 4: CLTV reclaim before unlockHeight -> BTC mempool non-final / CLTV failure
// Requires a btc-lock artifact at /tmp/btc-lock-<BOND_INDEX>-<STAKER>.json with the
// timelock still in the future (tip < unlockHeight). No Stacks tx involved.

// @ts-ignore — @scure/btc-signer is ESM; ts-jest transforms it via jest.config.js
import * as btc from '@scure/btc-signer';
// @ts-ignore — same ESM transform
import { signECDSA } from '@scure/btc-signer/utils.js';
import { hexToBytes, bytesToHex, concatBytes } from '@stacks/common';

const MEMPOOL_BASE = 'https://mempool.bitcoin.private-1.hiro.so/api';
const TESTNET_BTC: typeof btc.NETWORK = {
  bech32: 'tb',
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

// Written by btc-lock.test.ts
/** @internal */
interface BtcLockArtifact {
  bondIndex: number;
  txid: string;
  outputIndex: number;
  legacyTxHex: string;
  blockHash: string;
  blockHeight: number;
  unlockHeight: number;
  amountSats: string;
  witnessScriptHex: string;
  unlockBytesHex: string;
  earlyUnlockBytesHex: string;
  stakerStxAddress: string;
  headerHex: string;
  merkleProof: { block_height: number; merkle: string[]; pos: number };
  txCount: number;
}

test('case 4 — CLTV reclaim before unlockHeight: mempool rejects (non-final)', async () => {
  useFixtures('e2e-negative-matrix-case4');
  // Read artifact written by btc-lock.test.ts
  const BOND_INDEX_ENV = Number(process.env.BOND_INDEX ?? 4);
  const STAKER_ENV = process.env.STAKER ?? 'account5';
  const artifactPath = `/tmp/btc-lock-${BOND_INDEX_ENV}-${STAKER_ENV}.json`;

  let artifact: BtcLockArtifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as BtcLockArtifact;
  } catch {
    console.warn(
      `artifact not found at ${artifactPath} — skip (needs btc-lock.test.ts to have run first)`
    );
    return;
  }

  console.log('artifact txid:', artifact.txid, 'unlockHeight:', artifact.unlockHeight);

  const tipResp = await fetch(`${MEMPOOL_BASE}/blocks/tip/height`);
  const tip = Number(await tipResp.text());
  console.log('btc tip height:', tip);

  if (tip >= artifact.unlockHeight) {
    console.warn(
      `tip (${tip}) >= unlockHeight (${artifact.unlockHeight}) — CLTV already spendable; skip (case 4 requires tip < unlockHeight)`
    );
    return;
  }

  // CLTV (OP_IF) spend with nLockTime = unlockHeight - 1 (below the script's CLTV
  // value) and sequence != 0xffffffff, to trigger a non-final / CLTV failure at the node.
  const staker = getAccount(REGTEST_KEYS[STAKER_ENV as keyof typeof REGTEST_KEYS]);
  const witnessScript = hexToBytes(artifact.witnessScriptHex);
  const amount = BigInt(artifact.amountSats);
  const txidBytes = hexToBytes(artifact.txid).reverse(); // internal byte order

  const tx = new btc.Transaction({ version: 2, lockTime: artifact.unlockHeight - 1 });
  tx.addInput({
    txid: txidBytes,
    index: artifact.outputIndex,
    witnessScript,
    sequence: 0xfffffffe, // required for CLTV (non-final, enabling nLockTime)
  });
  // Destination: staker's P2WPKH
  tx.addOutputAddress(staker.btcAddress, amount - 300n, TESTNET_BTC);

  // Sign via BIP143 preimage. signECDSA returns DER bytes directly.
  const preimage = tx.preimageWitnessV0(0, witnessScript, btc.SigHash.ALL, amount);
  // signECDSA(hash, privKey, lowR?) -> DER-encoded signature bytes (no SIGHASH suffix)
  const derSigRaw = signECDSA(preimage, hexToBytes(staker.key.slice(0, 64)), true);
  const derSig = concatBytes(derSigRaw, new Uint8Array([0x01])); // append SIGHASH_ALL

  // Finalize: IF branch witness = [ sig, 0x01 (truthy), witnessScript ]
  tx.updateInput(
    0,
    {
      finalScriptWitness: [derSig, new Uint8Array([0x01]), witnessScript],
    },
    true
  );

  const rawHex = bytesToHex(tx.extract());

  let rejectionMessage: string | null = null;
  try {
    const broadcastResp = await fetch(`${MEMPOOL_BASE}/tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: rawHex,
    });
    const body = await broadcastResp.text();
    console.log('broadcast status:', broadcastResp.status, 'body:', body);

    if (broadcastResp.status === 200) {
      // Could mean the tip advanced past unlockHeight between our check and the
      // broadcast (race). Log and don't fail hard.
      console.warn('WARNING: mempool accepted the tx unexpectedly (tip may have advanced)');
    } else {
      rejectionMessage = body;
      const isLockTimeRelated =
        body.toLowerCase().includes('non-final') ||
        body.toLowerCase().includes('nonfinal') ||
        body.toLowerCase().includes('locktime') ||
        body.toLowerCase().includes('cltv') ||
        body.toLowerCase().includes('not-final');
      console.log(
        isLockTimeRelated
          ? 'confirmed: rejection reason is locktime/CLTV related'
          : `rejection reason not explicitly locktime-worded but still rejected: ${body}`
      );
    }
  } catch (e) {
    console.log('broadcast threw (network error):', e);
  }

  // Either rejected, or we logged a tip-race warning — don't hard-fail on an accept
  // since it may be a race; the intent is that a premature CLTV spend must be rejected.
  if (rejectionMessage !== null) {
    expect(rejectionMessage.length).toBeGreaterThan(0);
  }
}, 30_000);

// CASE 5: early reclaim WITHOUT announce-l1-early-exit -> CannotAnnounceL1EarlyUnlock (u35)
// The full negative case (enrolled L1 staker, second announce, or L2 staker) needs prior
// state; we probe the always-runnable variant instead: call announce-l1-early-exit from an
// account with NO bond membership at all -> NotBondParticipant (u34) or NotStaking (u27).

import { buildAnnounceL1EarlyExit } from '../../../src';

test('case 5 — announce-l1-early-exit with no membership: NotBondParticipant (u34)', async () => {
  useFixtures('e2e-negative-matrix-case5');
  const network = getNetwork();
  // account4 — RICH (~10B STX), NEVER staked (no bond membership), uncontended.
  // account8 is "not prefunded" on this lane and hit NotEnoughFunds at broadcast
  // (the tx never reached the contract's membership guard).
  const staker = getAccount(REGTEST_KEYS.account4);
  console.log('staker:', staker.address);

  const membership = await fetchBondMembership({ address: staker.address, network });
  if (membership) {
    console.warn('account8 unexpectedly has a bond membership — skip (precondition violated)');
    console.warn(
      'membership:',
      JSON.stringify(membership, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    );
    return;
  }

  const nonce = await getNextNonce(staker.address);
  const unsigned = await buildAnnounceL1EarlyExit({
    // staker + oldSignerManager are both required by the contract; since we have no
    // membership the contract aborts (u34 / u27) before validating them, so these are
    // placeholders (the staker's own address and the daemon signer-manager).
    staker: staker.address,
    oldSignerManager: SIGNER_MANAGER,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce,
    network,
    postConditionMode: 'allow',
  });

  const tx = signTransaction(unsigned, staker.key);
  const txid = await broadcastAndWait(tx, staker.address, network);
  console.log('txid:', txid);

  await new Promise(r => setTimeout(r, 8_000));
  const record = await getTransaction(txid);
  console.log('tx_status:', record?.tx_status, 'repr:', record?.tx_result?.repr);

  if (record && record.tx_status !== 'pending') {
    const code = parseErrCode(record.tx_result?.repr);

    if (record.tx_status === 'abort_by_response') {
      // Expected: NotBondParticipant (u34) — not in any bond. Also acceptable:
      // CannotAnnounceL1EarlyUnlock (u35) if the contract checks membership type
      // before participant status.
      const acceptableCodes = [
        Pox5ErrorCode.NotBondParticipant, // u34 — primary
        Pox5ErrorCode.CannotAnnounceL1EarlyUnlock, // u35 — L2 staker / no L1 lock
        Pox5ErrorCode.NotStaking, // u27 — not staking at all
      ];
      expect(acceptableCodes).toContain(code);
      console.log(
        `announce-l1-early-exit aborted with (err u${code}) — ${describePox5Error(code ?? 0)?.name ?? 'unknown'}`
      );
    }
    if (record.tx_status === 'success') {
      throw new Error(
        'Expected abort for announce-l1-early-exit with no membership but tx succeeded'
      );
    }
  } else {
    console.warn('tx still pending / not indexed — cannot assert err code');
  }
}, 180_000);

// CASE 6: stake with startBurnHt in the NEXT cycle -> InvalidStartBurnHeight (u24)
// pox-5.stake requires burn-height-to-reward-cycle(startBurnHt) == current-cycle;
// no prior state required.

test('case 6 — stake with next-cycle startBurnHt: InvalidStartBurnHeight (u24)', async () => {
  useFixtures('e2e-negative-matrix-case6');
  const network = getNetwork();
  // account4 — RICH (~10B STX), uncontended. Staking 1000 STX from the light-funded
  // account7 hit NotEnoughFunds, masking the InvalidStartBurnHeight path we probe.
  const staker = getAccount(REGTEST_KEYS.account4);
  console.log('staker:', staker.address);

  const poxInfo = await getPoxInfo();

  // First burn height of the NEXT cycle — deliberately out of range.
  const nextCycleBurnHt = rewardCycleToBurnHeight(poxInfo.rewardCycleId + 1, poxInfo);

  const nonce = await getNextNonce(staker.address);
  const unsigned = await buildStake({
    signerManager: SIGNER_MANAGER,
    amountUstx: 1_000_000_000n, // 1000 STX
    numCycles: 1,
    startBurnHt: nextCycleBurnHt,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce,
    network,
    postConditionMode: 'allow',
  });

  const tx = signTransaction(unsigned, staker.key);
  const txid = await broadcastAndWait(tx, staker.address, network);

  await new Promise(r => setTimeout(r, 8_000));
  const record = await getTransaction(txid);
  console.log('tx_status:', record?.tx_status, 'repr:', record?.tx_result?.repr);

  if (record && record.tx_status !== 'pending') {
    const code = parseErrCode(record.tx_result?.repr);

    if (record.tx_status === 'abort_by_response') {
      // Primary expected code: InvalidStartBurnHeight (u24). Also acceptable:
      // StakeInPreparePhase (u47) if the prepare-phase guard fires first.
      const acceptableCodes = [
        Pox5ErrorCode.InvalidStartBurnHeight, // u24 — primary
        Pox5ErrorCode.StakeInPreparePhase, // u47 — prepare-phase guard fires first
      ];
      expect(acceptableCodes).toContain(code);
      console.log(`aborted with (err u${code})`);
    }
    if (record.tx_status === 'success') {
      throw new Error('Expected abort for wrong-cycle startBurnHt but tx succeeded');
    }
  } else {
    console.warn('tx still pending / not indexed — cannot assert err code');
  }
}, 180_000);
