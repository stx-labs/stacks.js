/**
 * Hand the `bond-admin` role to a **2-of-3 multisig** and prove the multisig can
 * act as admin, exactly as a single key would.
 *
 * Flow (all on regtest, node-only confirmation via nonce/effect):
 *  1. assert `bond-admin` is the env's single-key admin (`ACCOUNTS.admin`).
 *  2. derive a fresh wallet (`@stacks/wallet-sdk`) from a pinned random seed,
 *     take its first 3 accounts, form a 2-of-3 P2SH multisig, fund it for fees.
 *  3. the single-key admin rotates `bond-admin` → the multisig.
 *  4. NEGATIVE: the old admin is now powerless — its `set-bond-admin` and
 *     `setup-bond` are mined but revert (admin unchanged, no bond created).
 *  5. the MULTISIG acts as admin (2 sigs + 1 appended key): it creates a bond
 *     (`setup-bond`) and then rotates `bond-admin` back to the original admin.
 *
 * The multisig calls go through the SAME SDK `build*` helpers as single-sig —
 * passing `{ publicKeys, numSignatures }` instead of `publicKey` (the builders
 * discriminate, mirroring `makeUnsignedContractCall`); only the signing differs
 * (see `signMultiSigTransaction`).
 */
import {
  AddressHashMode,
  AddressVersion,
  type PrincipalCV,
  type StacksTransactionWire,
  addressFromPublicKeys,
  addressToString,
  createStacksPublicKey,
  cvToValue,
  deserializeCV,
} from '@stacks/transactions';
import { generateNewAccount, generateWallet } from '@stacks/wallet-sdk';
import { buildSetBondAdmin, buildSetupBond, fetchBond, type PoxInfo } from '../../../src';
import { getAccount, type Account } from '../regtest';
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { pickBondIndex } from '../../helpers/bond';
import { ENV, getNetwork } from '../../helpers/utils';
import {
  broadcastAndWait,
  ensurePox5,
  fundStx,
  getNextNonce,
  getPoxInfo,
  nodeFetch,
  waitForBurnBlockHeight,
  waitForFulfilled,
} from '../../helpers/wait';
import { useFixtures } from '../../helpers/mock';
import { signMultiSigTransaction, signTransaction } from '../../helpers/sign';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
const FEE = 10_000n;
const POX5 = 'ST000000000000000000002AMW42H';

// The env's `pox_5_bond_admin` (`ST1V2ASRWG…`); resolved from BOND_ADMIN_KEY in
// beforeAll (see `helpers/bondAdmin.ts`). NOT `ACCOUNTS.admin`/account4.
let admin: Account;

/**
 * A random 24-word seed, generated once with `@stacks/wallet-sdk`'s
 * `randomSeedPhrase()` and pinned so the derived multisig address is stable for
 * record/replay. Re-generate + repin (and re-record) to rotate it.
 */
const MULTISIG_SEED =
  'proof pet high door join three name tissue pioneer hub notable valid ' +
  'enlist august balcony panda match loud undo primary gain ostrich fluid note';
/** Expected 2-of-3 address for {@link MULTISIG_SEED} (sanity-checks derivation). */
const EXPECTED_MULTISIG = 'SN11V09J2NDPJ10KQFBFSFTTCDG83ZKYFZE8F92RB';

// setup-bond params (mirrors setup-bond.test.ts).
const MAX_SATS = 10_000n;
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);

let ms: Account[]; // the 3 signer accounts
let msPublicKeys: string[]; // their public keys, in multisig order
let multisig: string; // the 2-of-3 P2SH principal

/** Read the `bond-admin` data-var (node-only). */
async function fetchBondAdmin(): Promise<string> {
  const res = await nodeFetch(`${ENV.STACKS_API}/v2/data_var/${POX5}/pox-5/bond-admin?proof=0`);
  const { data } = (await res.json()) as { data: string };
  return cvToValue(deserializeCV(data) as PrincipalCV) as string;
}

/** Single-key `set-bond-admin`, signed + confirmed (node-only). */
const setBondAdmin = async (newAdmin: string, from: Account, nonce: number) =>
  broadcastAndWait(
    signTransaction(
      await buildSetBondAdmin({ newAdmin, publicKey: from.publicKey, fee: FEE, nonce, network }),
      from.key
    ),
    from.address,
    network
  );

/** Sign a multisig tx with the first two accounts + append the third's key. */
const signMs = (tx: StacksTransactionWire) =>
  signMultiSigTransaction(tx, [ms[0].key, ms[1].key], [ms[2].publicKey]);

/** `setup-bond` args (shared by the single-key negative path and the multisig). */
const setupBondParams = (bondIndex: number, staker: string) => ({
  bondIndex,
  targetRateBps: TARGET_RATE_BPS,
  stxValueRatio: STX_VALUE_RATIO,
  minUstxRatioBps: MIN_USTX_RATIO_BPS,
  earlyUnlockBytes: EARLY_UNLOCK_BYTES,
  earlyUnlockAdmin: staker,
  allowlist: [{ staker, maxSats: MAX_SATS }],
  fee: FEE,
  network,
});

/**
 * `poxInfo` with the real bond schedule patched in. This env's `/v2/pox` omits
 * the pox-5 `contract_versions[]` row, so `firstPox5RewardCycle` can't read the
 * first bond cycle (its fallback guesses the *current* cycle, which is wrong for
 * bond-period math → setup-bond always "too late"). Read the contract's
 * `first-bond-period-cycle` data-var and inject a synthetic pox-5 entry so the
 * `cycles.ts` bond-math helpers compute correct heights.
 */
async function bondSchedulePoxInfo(): Promise<PoxInfo> {
  const poxInfo = await getPoxInfo();
  const res = await nodeFetch(`${ENV.STACKS_API}/v2/data_var/${POX5}/pox-5/first-bond-period-cycle?proof=0`);
  const { data } = (await res.json()) as { data: string };
  const firstRewardCycleId = Number(cvToValue(deserializeCV(data)));
  return {
    ...poxInfo,
    contractVersions: [
      ...poxInfo.contractVersions.filter(v => !v.contractId.endsWith('.pox-5')),
      { contractId: `${POX5}.pox-5`, firstRewardCycleId, activationBurnchainBlockHeight: 0 },
    ],
  };
}

/**
 * Pick a bond period (furthest-out open setup-bond window) with a FULL window of
 * runway for the negative + multisig setup-bond pair to confirm. If the nearest
 * open window is tighter than a cycle, roll past its boundary into the next one.
 */
async function selectBondIndex(): Promise<number> {
  let poxInfo = await bondSchedulePoxInfo();
  let chosen = pickBondIndex(poxInfo);
  if (chosen.bondStartHeight - poxInfo.currentBurnchainBlockHeight < poxInfo.rewardCycleLength) {
    await waitForBurnBlockHeight(chosen.bondStartHeight);
    poxInfo = await bondSchedulePoxInfo();
    chosen = pickBondIndex(poxInfo);
  }
  return chosen.bondIndex;
}

beforeAll(async () => {
  useFixtures('set-bond-admin-multisig');
  await ensurePox5();

  admin = await getBondAdminAccount();

  // Derive the fresh wallet's first 3 accounts and form the 2-of-3 multisig.
  let wallet = await generateWallet({ secretKey: MULTISIG_SEED, password: 'test' });
  wallet = generateNewAccount(wallet); // account 1
  wallet = generateNewAccount(wallet); // account 2
  ms = wallet.accounts.slice(0, 3).map(a => getAccount(a.stxPrivateKey));
  msPublicKeys = ms.map(a => a.publicKey);
  // The SDK builders default to the non-sequential hashmode; its c32 address is
  // the same hash160 as legacy P2SH, so the principal we set as bond-admin
  // matches the one the node derives from the built tx either way.
  multisig = addressToString(
    addressFromPublicKeys(
      AddressVersion.TestnetMultiSig,
      AddressHashMode.P2SHNonSequential,
      2,
      msPublicKeys.map(createStacksPublicKey)
    )
  );
  expect(multisig).toBe(EXPECTED_MULTISIG); // derivation sanity-check
}, 5 * 60_000);

test('bond-admin can be a 2-of-3 multisig that acts as admin', async () => {
  // 1. start: the env's single-key admin holds the role.
  expect(await fetchBondAdmin()).toBe(admin.address);

  // 2. fund the multisig so it can pay fees for its own txs.
  await fundStx({
    funder: admin,
    recipient: multisig,
    amountUstx: 10_000_000n,
    nonce: await getNextNonce(admin.address),
    fee: FEE,
    network,
  });

  // 3. single-key admin hands the role to the multisig.
  await setBondAdmin(multisig, admin, await getNextNonce(admin.address));
  useFixtures('set-bond-admin-multisig-rotated');
  expect(await fetchBondAdmin()).toBe(multisig);

  // 4. NEGATIVE — the old admin is powerless now.
  //   a) its set-bond-admin reverts → role stays with the multisig.
  await broadcastAndWait(
    signTransaction(
      await buildSetBondAdmin({
        newAdmin: admin.address,
        publicKey: admin.publicKey,
        fee: FEE,
        nonce: await getNextNonce(admin.address),
        network,
      }),
      admin.key
    ),
    admin.address,
    network
  );
  expect(await fetchBondAdmin()).toBe(multisig);

  // Pick a bond period with runway for the negative + multisig setup-bond pair
  // (the open window is only a couple cycles wide and the chain mines fast).
  const bondIndex = await selectBondIndex();
  console.log('multisig bond test', { bondIndex, multisig });

  //   b) the old admin's setup-bond reverts (unauthorized, before any timing
  //      check) → no bond is created.
  await broadcastAndWait(
    signTransaction(
      await buildSetupBond({
        ...setupBondParams(bondIndex, ms[0].address),
        publicKey: admin.publicKey,
        nonce: await getNextNonce(admin.address),
      }),
      admin.key
    ),
    admin.address,
    network
  );
  expect(await fetchBond({ bondIndex, network })).toBeUndefined();

  // 5a. the MULTISIG creates the bond — SAME SDK builder, `{ publicKeys,
  //     numSignatures }` instead of `publicKey`, signed by 2 of 3 + 1 appended.
  await broadcastAndWait(
    signMs(
      await buildSetupBond({
        ...setupBondParams(bondIndex, ms[0].address),
        publicKeys: msPublicKeys,
        numSignatures: 2,
        nonce: await getNextNonce(multisig),
      })
    ),
    multisig,
    network
  );
  useFixtures('set-bond-admin-multisig-bonded');
  const bond = await waitForFulfilled(async () => {
    const b = await fetchBond({ bondIndex, network });
    if (!b) throw 'bond not on-chain yet';
    return b;
  });
  expect(bond?.stxValueRatio).toBe(STX_VALUE_RATIO);

  // 5b. the MULTISIG rotates the role back to the original admin.
  await broadcastAndWait(
    signMs(
      await buildSetBondAdmin({
        newAdmin: admin.address,
        publicKeys: msPublicKeys,
        numSignatures: 2,
        fee: FEE,
        nonce: await getNextNonce(multisig),
        network,
      })
    ),
    multisig,
    network
  );
  useFixtures('set-bond-admin-multisig-restored');
  expect(await fetchBondAdmin()).toBe(admin.address);
});
