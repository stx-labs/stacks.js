/**
 * Registers for a bond with a real L1 BTC lockup proof, reading the artifact
 * written by btc-lock.test.ts and building a genuine SPV proof (80-byte block
 * header + Esplora-compatible merkle proof).
 *
 * Asserts `fetchBondMembership(staker)` is defined with `isL1Lock === true`.
 * If already enrolled, asserts that state and skips re-registering.
 *
 * Composable via ENV:
 *   BOND_INDEX      bond index (default: from btc-lock artifact)
 *   STAKER          account5 | account6 | account7 (default: account5)
 *
 * Run (after btc-lock.test.ts):
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     BOND_INDEX=4 STAKER=account5 \
 *     npx jest tests/privatenet/actions/register-for-bond-l1.test.ts \
 *       --runInBand --collectCoverage=false --verbose
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildLockProof,
  buildUnlockScript,
  buildLockOutputScript,
  buildRegisterForBond,
  describePox5Error,
  fetchBond,
  fetchBondMembership,
  minUstxForSatsAmount,
} from '../../../src';
import { SIGNER_MANAGER } from '../constants';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import { broadcastAndWait, getNextNonce, getTransaction } from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';
import { BtcLockArtifact } from '../../helpers/btc-wallet';

jest.setTimeout(30 * 60_000);

// BOND_INDEX unset -> taken from the btc-lock artifact (single source of truth).
const BOND_INDEX_ENV = process.env.BOND_INDEX ? Number(process.env.BOND_INDEX) : undefined;
const FEE = BigInt(process.env.FEE_USTX ?? 10_000);

const STAKER_NAME = process.env.STAKER ?? 'account5';

// Either a named REGTEST_KEYS account, or an arbitrary staker via STAKER_RAW_KEY
// (64-hex) for freshly-generated accounts (f2/f3…). Derive the account from the
// raw key (+compression byte) so it isn't limited to the prefunded pool.
const STAKER_RAW_KEY = process.env.STAKER_RAW_KEY;
const staker = STAKER_RAW_KEY
  ? getAccount(STAKER_RAW_KEY + '01')
  : getAccount(REGTEST_KEYS[STAKER_NAME as keyof typeof REGTEST_KEYS]);
if (!staker?.address) {
  throw new Error(`Unknown STAKER="${STAKER_NAME}" and no STAKER_RAW_KEY provided.`);
}

beforeAll(async () => {}, 30 * 60_000);

test('register-for-bond (real L1 BTC proof, artifact bond)', async () => {
  useFixtures('register-for-bond-l1');
  const network = getNetwork();

  console.log('staker:', STAKER_NAME, staker.address);
  console.log('signer-manager:', SIGNER_MANAGER);

  // READ ARTIFACT
  const artifactPath = join(
    __dirname,
    '..',
    'fixtures',
    'artifacts',
    `btc-lock-${STAKER_NAME}.json`
  );
  let artifact: BtcLockArtifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as BtcLockArtifact;
  } catch (err) {
    throw new Error(
      `Cannot read artifact ${artifactPath} — run btc-lock.test.ts first.\n  ${String(err)}`
    );
  }

  console.log(
    'artifact loaded:',
    JSON.stringify({
      txid: artifact.txid,
      outputIndex: artifact.outputIndex,
      blockHeight: artifact.blockHeight,
      unlockHeight: artifact.unlockHeight,
      amountSats: artifact.amountSats,
      txCount: artifact.txCount,
    })
  );

  const BOND_INDEX = BOND_INDEX_ENV ?? artifact.bondIndex;
  expect(artifact.bondIndex).toBe(BOND_INDEX); // env override must match the artifact

  // FETCH BOND
  const bond = await fetchBond({ bondIndex: BOND_INDEX, network });
  if (!bond) throw new Error(`bond ${BOND_INDEX} not found on-chain`);
  console.log(
    'bond:',
    JSON.stringify({
      stxValueRatio: bond.stxValueRatio.toString(),
      minUstxRatioBps: bond.minUstxRatioBps,
    })
  );

  const amountSats = BigInt(artifact.amountSats);

  // Minimum uSTX required to pair with this many sats
  const minUstx = minUstxForSatsAmount({
    sats: amountSats,
    stxValueRatio: bond.stxValueRatio,
    minUstxRatioBps: bond.minUstxRatioBps,
  });
  // Round up to the nearest 1000 uSTX and add a generous buffer
  const amountUstx = minUstx + 1_000_000n;
  console.log('minUstx (contract minimum):', minUstx.toString());
  console.log('amountUstx (with buffer):', amountUstx.toString());

  const unlockBytes = buildUnlockScript(staker.publicKey);
  console.log('unlockBytes (hex):', artifact.unlockBytesHex);

  const outputScript = buildLockOutputScript({
    stxAddress: artifact.stakerStxAddress,
    unlockHeight: artifact.unlockHeight,
    unlockBytes,
    earlyUnlockBytes: artifact.earlyUnlockBytesHex,
  });
  console.log('expectedP2wshScript (hex):', Buffer.from(outputScript).toString('hex'));

  // ASSEMBLE PROOF
  // buildLockProof re-strips the tx witness (harmless, already stripped) and
  // reverses Esplora's big-endian merkle hashes to internal little-endian form;
  // it also locates the output by matching outputScript, cross-checking outputIndex
  // rather than trusting it blindly.
  const lockupOutput = buildLockProof({
    txHex: artifact.legacyTxHex,
    header: artifact.headerHex,
    merkleProof: artifact.merkleProof,
    txCount: artifact.txCount,
    unlockHeight: artifact.unlockHeight,
    outputScript,
  });

  console.log(
    'lockupOutput:',
    JSON.stringify({
      height: lockupOutput.height,
      outputIndex: lockupOutput.outputIndex,
      txCount: lockupOutput.txCount,
      txIndex: lockupOutput.txIndex,
      amount: lockupOutput.amount.toString(),
      leafHashesCount: lockupOutput.leafHashes.length,
      txLengthBytes: (lockupOutput.tx as Uint8Array).length,
      headerLengthBytes: (lockupOutput.header as Uint8Array).length,
    })
  );

  // PRECONDITION: staker must not already be enrolled.
  const existingMembership = await fetchBondMembership({ address: staker.address, network });
  if (existingMembership) {
    console.warn(
      'already enrolled — skipping registration:',
      JSON.stringify(existingMembership, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    );
    expect(existingMembership.isL1Lock).toBe(true);
    return;
  }

  // BUILD + SIGN + BROADCAST
  const nonce = await getNextNonce(staker.address);
  console.log('staker nonce:', nonce);

  const unsigned = await buildRegisterForBond({
    bondIndex: BOND_INDEX,
    signerManager: SIGNER_MANAGER,
    amountUstx,
    lockup: {
      kind: 'btc',
      outputs: [lockupOutput],
      unlockBytes,
    },
    publicKey: staker.publicKey,
    fee: FEE,
    nonce,
    network,
    // register-for-bond locks the staker's amountUstx STX; default Deny mode
    // reverts that as abort_by_post_condition, so allow asset transfers here.
    postConditionMode: 'allow',
  });

  const tx = signTransaction(unsigned, staker.key);
  const txid = await broadcastAndWait(tx, staker.address, network);
  console.log('broadcast txid:', txid);

  // Wait briefly for the extended API to index the tx before checking the result.
  await new Promise(r => setTimeout(r, 5_000));
  const record = await getTransaction(txid);
  if (record && record.tx_status !== 'pending') {
    console.log('tx_status:', record.tx_status);
    console.log('tx_result:', record.tx_result?.repr);

    if (record.tx_status === 'abort_by_response') {
      const match = record.tx_result?.repr?.match(/^\(err u(\d+)\)$/);
      if (match) {
        const code = Number(match[1]);
        console.error(`abort: (err u${code}) — ${describePox5Error(code)}`);
        expect(await fetchBondMembership({ address: staker.address, network })).toBeUndefined();
        throw new Error(`register-for-bond aborted: (err u${code}) — ${describePox5Error(code)}`);
      }
    }
  } else {
    console.log('tx still pending or not indexed — checking membership via node read-only');
  }

  // Poll node read-only (no /extended dependency) until membership appears.
  let membership = await fetchBondMembership({ address: staker.address, network });
  if (!membership) {
    const deadline = Date.now() + 2 * 60_000;
    while (!membership && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 10_000));
      membership = await fetchBondMembership({ address: staker.address, network });
    }
  }

  console.log(
    'bond membership:',
    JSON.stringify(membership, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
  );

  expect(membership).toBeDefined();
  expect(membership!.bondIndex).toBe(BOND_INDEX);
  expect(membership!.isL1Lock).toBe(true);
});
