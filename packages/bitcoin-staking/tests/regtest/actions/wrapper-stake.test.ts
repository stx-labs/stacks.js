/**
 * Slice 1 of the contract-principal-staking suite (specs/contract-principal-staking.md):
 * a CONTRACT PRINCIPAL as the staker of record.
 *
 * pox-5 has no delegation — staker identity is `tx-sender` — so to make a contract
 * the staker, the pox-5 call must originate inside the contract under `as-contract`.
 * We deploy a minimal wrapper (`contract-principal-staker`) that does exactly that,
 * fund IT with STX, then call its `stake` / `unstake` from an ordinary EOA. Inside
 * pox-5, `tx-sender` is the wrapper, so the wrapper locks its own STX and shows up
 * in the staker map under its own contract principal.
 *
 * The MUTATING call is a raw `makeContractCall` to the wrapper (an SDK `build*`
 * would sign as an EOA and can't produce the `as-contract` origination). The SDK
 * surface still dogfooded here is the READ side: `fetchStakerInfo` resolves and
 * reports a contract-principal staker (`SP…/ST….name`), and `fetchEligibleStake`
 * preflights it. Broadcasts use PostConditionMode.Allow (pox-5 moves STX on stake).
 */
import { Cl, makeContractCall } from '@stacks/transactions';
import { fetchEligibleStake, fetchStakerInfo } from '../../../src';
import { ACCOUNTS, SIGNER_MANAGER } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import {
  broadcastAndWait,
  ensurePox5,
  fundStx,
  getNextNonce,
  getPoxInfo,
  waitForRewardPhase,
  waitForSignerManager,
} from '../../helpers/wait';
import { useFixtures } from '../../helpers/mock';
import { WRAPPER_STAKER_NAME, deployWrapperStaker } from '../../helpers/wrapper-staker';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
const admin = ACCOUNTS.admin; // deployer + funder + tx caller (clean nonce, daemon-free)
const signerManager = SIGNER_MANAGER;

const FEE = 10_000n;
const FUND = 1_000_000_000n; // 1000 STX into the wrapper
const STAKE = 100_000_000n; // 100 STX
const NUM_CYCLES = 3; // >1 so the lock survives long enough for a clean post-unstake assert

let wrapper: string; // <admin>.contract-principal-staker — the contract-principal staker

beforeAll(async () => {
  useFixtures('wrapper-stake');
  await ensurePox5();
  await waitForSignerManager(signerManager);

  // Inline-source deploy → records + replays (no fs read, unlike deploy-signer-manager).
  wrapper = await deployWrapperStaker({
    deployerKey: admin.key,
    bootAddress: network.bootAddress,
    network,
  });

  // Fund the CONTRACT principal itself — it stakes STX it holds.
  await fundStx({
    funder: admin,
    recipient: wrapper,
    amountUstx: FUND,
    nonce: await getNextNonce(admin.address),
    fee: FEE,
    network,
  });
}, 5 * 60_000);

test('a contract principal stakes STX it holds, then unstakes', async () => {
  expect(wrapper).toBe(`${admin.address}.${WRAPPER_STAKER_NAME}`);
  // No hard "not staked yet" precondition: this test mutates permanent-ish chain
  // state, and a retry (fixtures cleared, chain NOT) would trip it on carryover.
  // The specific post-stake asserts below prove the stake actually took effect.
  console.log('wrapper staked before:', (await fetchStakerInfo({ address: wrapper, network })).staked);

  // STAKE. Same u24/u47 cycle-boundary hazard as stake.test.ts: start-burn-ht must
  // map to the current cycle at mine time, and stake reverts in the prepare phase.
  // Preflight the WRAPPER as staker (fetchEligibleStake accepts a contract principal),
  // wait for the reward phase on a miss, and retry across a boundary roll.
  let staked: Awaited<ReturnType<typeof fetchStakerInfo>> | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    useFixtures('wrapper-stake-staked');
    const poxInfo = await getPoxInfo();
    const eligible = await fetchEligibleStake({
      staker: wrapper,
      signerManager,
      amountUstx: STAKE,
      numCycles: NUM_CYCLES,
      startBurnHt: poxInfo.currentBurnchainBlockHeight,
      poxInfo,
      network,
    });
    if (!eligible.ok) {
      console.log('wrapper stake not eligible yet, waiting for reward phase:', eligible.reasons);
      await waitForRewardPhase(poxInfo);
      continue;
    }

    // Raw call to the wrapper's own entry point — NOT buildStake (that signs as an
    // EOA). Under as-contract inside the wrapper, tx-sender becomes the wrapper.
    const tx = await makeContractCall({
      contractAddress: admin.address,
      contractName: WRAPPER_STAKER_NAME,
      functionName: 'stake',
      functionArgs: [
        Cl.address(signerManager), // <signer-manager-trait> — a contract principal
        Cl.uint(STAKE),
        Cl.uint(NUM_CYCLES),
        Cl.uint(poxInfo.currentBurnchainBlockHeight),
      ],
      senderKey: admin.key,
      fee: FEE,
      nonce: await getNextNonce(admin.address),
      network,
      postConditionMode: 'allow',
    });
    await broadcastAndWait(tx, admin.address, network);

    useFixtures('wrapper-stake-staked-after');
    staked = await fetchStakerInfo({ address: wrapper, network });
    if (staked.staked) break; // else a boundary rolled mid-broadcast (u24) — retry
  }
  if (!staked?.staked) throw 'wrapper stake aborted';
  expect(staked.details.amountUstx).toBe(STAKE);
  expect(staked.details.numCycles).toBe(NUM_CYCLES);
  expect(staked.details.signer).toBe(signerManager);

  // UNSTAKE. Reverts in the prepare phase (ERR_UNSTAKE_IN_PREPARE_PHASE) just like
  // the EOA path — wait for the reward phase before broadcasting.
  useFixtures('wrapper-stake-unstaked');
  await waitForRewardPhase(await getPoxInfo());
  const unstakeTx = await makeContractCall({
    contractAddress: admin.address,
    contractName: WRAPPER_STAKER_NAME,
    functionName: 'unstake',
    functionArgs: [Cl.address(signerManager)],
    senderKey: admin.key,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(unstakeTx, admin.address, network);

  useFixtures('wrapper-stake-unstaked-after');
  const unstaked = await fetchStakerInfo({ address: wrapper, network });
  // unstake rewrites num-cycles so the lock ends next cycle → either fully
  // unlocked, or numCycles drops below what we staked for (mirrors stake.test.ts).
  expect(!unstaked.staked || unstaked.details.numCycles < NUM_CYCLES).toBe(true);
});
