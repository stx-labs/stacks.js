/**
 * Hardcoded regtest accounts + `getAccount()` (port of the `getAccount` helper
 * from `stacks-functional-tests/src/helpers.ts`). All keys are pre-funded in
 * `stacks-regtest-env/stacks-krypton-miner.toml`.
 */
import {
  getPublicKeyFromPrivate,
  publicKeyToBtcAddress,
} from "@stacks/encryption";
import { getAddressFromPrivateKey } from "@stacks/transactions";

/**
 * Pre-funded devnet accounts the staking daemons do NOT touch
 * (`btc-staker`/`stacker`/`monitor` only drive the STACKING_KEYS), so these
 * stay idle — safe for exact balance assertions and free of nonce races.
 */
export const REGTEST_KEYS = {
  account1:
    "0d2f965b472a82efd5a96e6513c8b9f7edc725d5c96c7d35d6c722cedeb80d1b01",
  account2:
    "975b251dd7809469ef0c26ec3917971b75c51cd73a022024df4bf3b232cc2dc001",
  account3:
    "c71700b07d520a8c9731e4d0f095aa6efb91e16e25fb27ce2b72e7b698f8127a01",
  // ST11NJTTKG… — the env's `pox_5_bond_admin`: dedicated, NEVER staked → clean
  // nonce for setup-bond / register-for-bond. Exposed as ACCOUNTS.admin.
  account4:
    "21d43d2ae0da1d9d04cfcaac7d397a33733881081f0b2cd038062cf0ccbb752601",
  // STB44… — clean (no daemon touches it). L1 register-for-bond staker.
  account5:
    "cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df01",
  // STEH2J3… — clean (was the old keep-alive default, now free). sBTC staker.
  account6:
    "5b8303150239eceaba43892af7cdd1fa7fc26eda5182ebaaa568e3341d54a4d001",
  // STT8DSJTWAW9TVJ1B17SD3S6F7SYH4TXG7TWS7Q9 — clean (was the old keep-alive default, now free). Extra staker
  // (e.g. unstake-sbtc) so register tests don't collide on one chain.
  account7:
    "16226f674796712dfbd53bf402304579b8b6d04d4bed4d466bf84ce6db973d4401",
  // ST1WGNQQ… — NOT prefunded; funded in-test from a funded account (see
  // `fundStx`). Shows the funding pattern that sidesteps the prefunded-key pool.
  account8:
    "6fb38ff674aced1d8cb5a36cd8304011ea65e096188b99603aeb793df481147401",
} as const;

/** The 3 keys the regtest staking daemons drive (also our bond roles). */
export const STACKING_KEYS = [
  "6a1a754ba863d7bab14adbbc3f8ebb090af9e871ace621d3e5ab634e1422885e01",
  "b463f0df6c05d2f156393eee73f8016c5372caa0e9e29a901bb7171d90dc4f1401",
  "7036b29cb5e235e5fd9b09ae3e8eec4404e44906814d5d01cbca968a60ed4bfb01",
] as const;

export type Account = ReturnType<typeof getAccount>;

/** Derive the full account view (addresses + keys) for a private key. */
export function getAccount(key: string) {
  const publicKey = getPublicKeyFromPrivate(key);
  return {
    key,
    address: getAddressFromPrivateKey(key, "testnet"),
    publicKey,
    btcAddress: publicKeyToBtcAddress(publicKey),
    signerPrivateKey: key, // don't do this in production
    signerPublicKey: publicKey,
  };
}

/**
 * Named roles for the bond flow — see ../stacks-regtest-env/KEYS.md.
 * - `admin`: `pox_5_bond_admin`, a dedicated key the daemon NEVER stakes → clean
 *   nonce for setup-bond / register-for-bond.
 * - `sbtcDeployer`: `STACKING_KEYS[0]` (ST3NBRSFK…). It deployed `sbtc-token`
 *   (= `pox_5_sbtc_contract`) and hosts the daemon-registered, STAKED
 *   `signer-manager`. It's staked every cycle, so NEVER send test txs from it
 *   (would race the keep-alive daemon → BadNonce) — use it only as the owner of
 *   the `sbtc-token` / `sbtc-deposit` / `signer-manager` contracts.
 */
export const ACCOUNTS = {
  admin: getAccount(REGTEST_KEYS.account4),
  sbtcDeployer: getAccount(STACKING_KEYS[0]),
};

/** The daemon-registered, staked signer-manager any register-for-bond can reference. */
export const SIGNER_MANAGER = `${ACCOUNTS.sbtcDeployer.address}.signer-manager`;

/** A second daemon-registered signer-manager (STACKING_KEYS[1]) — for rotation tests. */
export const SIGNER_MANAGER_2 = `${getAccount(STACKING_KEYS[1]).address}.signer-manager`;
