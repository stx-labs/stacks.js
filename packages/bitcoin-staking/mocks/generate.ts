/**
 * Mock-fixture generator for `@stacks/bitcoin-staking/mocks`.
 *
 * Emits one JSON file per (function, day) under `./data/{fn}/{day}.json`.
 *
 * Conventions (mirror `notes/api-mock-scenarios.md`):
 *   - sats / uSTX / per-token / per-share values  → JSON strings (parse with BigInt(...))
 *   - cycle ids / heights / indices / bps         → JSON numbers
 *   - `null` in JSON encodes the SDK's `undefined`
 *
 * Day axis: d-30, d-7, d-1, d0, d1, d14, d90, d171, d172, d177, d182, d183, default.
 * Only days where the response materially differs from `default` are emitted;
 * the mock function falls back to `default` otherwise.
 *
 * Run with: `npm run generate-mocks` (configured in package.json).
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Reference constants for cross-fixture consistency.
//
// Cycle math (per notes/api-mock-scenarios.md): cycle_length = 2100 burn blocks.
// pox-5 first reward cycle = 84; bond B5 first_reward_cycle = 96 (D90 snapshot
// implies current_cycle = 102, since 96 + 90/14 ≈ 102).
// ---------------------------------------------------------------------------

const FIRST_BURNCHAIN_BLOCK_HEIGHT = 666_050;
const REWARD_CYCLE_LENGTH = 2100;
const PREPARE_CYCLE_LENGTH = 100;
const REWARD_SLOTS = 4000;

// pox-5 activates at first_reward_cycle 84.
const POX5_FIRST_REWARD_CYCLE = 84;
const POX5_ACTIVATION_BURN_HEIGHT =
  FIRST_BURNCHAIN_BLOCK_HEIGHT + POX5_FIRST_REWARD_CYCLE * REWARD_CYCLE_LENGTH;

// Anchor bond: bondIndex 7, first reward cycle 96 (mid-bond D90 → cycle 102).
const BOND_INDEX = 7;
const BOND_FIRST_REWARD_CYCLE = 96;
const BOND_D0_HEIGHT =
  FIRST_BURNCHAIN_BLOCK_HEIGHT + BOND_FIRST_REWARD_CYCLE * REWARD_CYCLE_LENGTH;

// burn-height helpers (D-day → burn-block-height)
const heightAt = (dDay: number) => BOND_D0_HEIGHT + Math.round((dDay * REWARD_CYCLE_LENGTH) / 14);

// Cycle id at each D-day (12-cycle bond period ⇒ closes at cycle 108).
// (Not used directly — derived inline where needed.)

// Canonical principals
const STAKER = 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKPVKG2CE';
const SIGNER = 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.signer-manager-1';
const POOL_CONTRACT = 'SP1HTBVD3JG9C05J7HBJTHGR0GGW7KXW28M5JS8QE.sbtc-pool';
const BOOT_ADDRESS = 'SP000000000000000000002Q6VF78';
const SIGNER_KEY_HEX = '03cd2cfdbd2ad9332828a7a13ef62cb999e063421c708e863a7ffed71fb61c88c9';
const EARLY_UNLOCK_BYTES_HEX = '00'.repeat(683); // OP_ELSE subscript placeholder "no early-exit" form
const EARLY_UNLOCK_ADMIN = 'SP000000000000000000002Q6VF78';

// ---------------------------------------------------------------------------
// PoxInfo helper
// ---------------------------------------------------------------------------

interface PoxInfoRaw {
  contract_id: string;
  current_burnchain_block_height: number;
  first_burnchain_block_height: number;
  reward_cycle_id: number;
  reward_cycle_length: number;
  prepare_cycle_length: number;
  reward_slots: number;
  current_cycle: { id: number; stacked_ustx: string; is_pox_active: boolean };
  next_cycle: { id: number; stacked_ustx: string; is_pox_active: boolean };
  contract_versions: Array<{
    contract_id: string;
    activation_burnchain_block_height: number;
    first_reward_cycle_id: number;
  }>;
}

function poxInfoAt(
  burnHeight: number,
  totalStakedUstx: string,
  withPox5: boolean,
  isPoxActive: boolean
): PoxInfoRaw {
  const cycleId = Math.floor((burnHeight - FIRST_BURNCHAIN_BLOCK_HEIGHT) / REWARD_CYCLE_LENGTH);
  const contractVersions = [
    {
      contract_id: `${BOOT_ADDRESS}.pox`,
      activation_burnchain_block_height: 666_050,
      first_reward_cycle_id: 0,
    },
    {
      contract_id: `${BOOT_ADDRESS}.pox-2`,
      activation_burnchain_block_height: 700_000,
      first_reward_cycle_id: 16,
    },
    {
      contract_id: `${BOOT_ADDRESS}.pox-3`,
      activation_burnchain_block_height: 750_000,
      first_reward_cycle_id: 40,
    },
    {
      contract_id: `${BOOT_ADDRESS}.pox-4`,
      activation_burnchain_block_height: 840_350,
      first_reward_cycle_id: 83,
    },
  ];
  if (withPox5) {
    contractVersions.push({
      contract_id: `${BOOT_ADDRESS}.pox-5`,
      activation_burnchain_block_height: POX5_ACTIVATION_BURN_HEIGHT,
      first_reward_cycle_id: POX5_FIRST_REWARD_CYCLE,
    });
  }
  return {
    contract_id: `${BOOT_ADDRESS}.${withPox5 ? 'pox-5' : 'pox-4'}`,
    current_burnchain_block_height: burnHeight,
    first_burnchain_block_height: FIRST_BURNCHAIN_BLOCK_HEIGHT,
    reward_cycle_id: cycleId,
    reward_cycle_length: REWARD_CYCLE_LENGTH,
    prepare_cycle_length: PREPARE_CYCLE_LENGTH,
    reward_slots: REWARD_SLOTS,
    current_cycle: { id: cycleId, stacked_ustx: totalStakedUstx, is_pox_active: isPoxActive },
    next_cycle: { id: cycleId + 1, stacked_ustx: totalStakedUstx, is_pox_active: isPoxActive },
    contract_versions: contractVersions,
  };
}

// ---------------------------------------------------------------------------
// Bond / membership snapshots per D-day
// ---------------------------------------------------------------------------

const BOND_TUPLE = {
  bondIndex: BOND_INDEX,
  targetRateBps: 800, // 8% APY target
  stxValueRatio: '4000000000', // 4000 uSTX per 100 sats (rough)
  minUstxRatioBps: 11_000,
  earlyUnlockBytes: EARLY_UNLOCK_BYTES_HEX,
  earlyUnlockAdmin: EARLY_UNLOCK_ADMIN,
  capacitySats: '50000000000', // 500 BTC capacity
};

// Membership tuple shape used by fetchBondMembership (and §3.1 user view).
type MembershipRaw = {
  bondIndex: number;
  amountUstx: string;
  signer: string;
  isL1Lock: boolean;
};

const MEMBERSHIP_ACTIVE: MembershipRaw = {
  bondIndex: BOND_INDEX,
  amountUstx: '50000000000',
  signer: SIGNER,
  isL1Lock: true,
};

// ---------------------------------------------------------------------------
// SCENARIOS — single source of truth.
// Keys: function name. Values: { day -> JSON-serializable fixture }
// Only days where the response materially differs from `default` need entries.
// ---------------------------------------------------------------------------

const SCENARIOS: Record<string, Record<string, unknown>> = {
  // ---- node /v2/pox ------------------------------------------------------
  fetchPoxInfo: {
    default: poxInfoAt(POX5_ACTIVATION_BURN_HEIGHT - 60_000, '350000000000000', false, true),
    'd-30': poxInfoAt(heightAt(-30), '380000000000000', true, true),
    'd-7': poxInfoAt(heightAt(-7), '395000000000000', true, true),
    d0: poxInfoAt(heightAt(0), '410000000000000', true, true),
    d90: poxInfoAt(heightAt(90), '425000000000000', true, true),
    d182: poxInfoAt(heightAt(182), '420000000000000', true, true),
    d183: poxInfoAt(heightAt(183), '415000000000000', true, true),
  },

  // ---- /v2/accounts/<addr> ----------------------------------------------
  fetchAccountStatus: {
    default: {
      balance: '125000000000', // 125k STX
      locked: '0',
      nonce: '12',
      unlockHeight: 0,
    },
    d0: {
      balance: '75000000000',
      locked: '50000000000',
      nonce: '15',
      unlockHeight: heightAt(182),
    },
    d90: {
      balance: '75000000000',
      locked: '50000000000',
      nonce: '20',
      unlockHeight: heightAt(182),
    },
    d182: {
      balance: '75000000000',
      locked: '50000000000',
      nonce: '22',
      unlockHeight: heightAt(182),
    },
    d183: {
      balance: '125000000000',
      locked: '0',
      nonce: '23',
      unlockHeight: 0,
    },
  },

  // ---- RO get-staker-info -----------------------------------------------
  fetchStakerInfo: {
    default: { staked: false },
    'd-7': { staked: false },
    d0: {
      staked: true,
      details: {
        amountUstx: '50000000000',
        firstRewardCycle: BOND_FIRST_REWARD_CYCLE,
        numCycles: 12,
        signer: SIGNER,
      },
    },
    d90: {
      staked: true,
      details: {
        amountUstx: '50000000000',
        firstRewardCycle: BOND_FIRST_REWARD_CYCLE,
        numCycles: 12,
        signer: SIGNER,
      },
    },
    d182: {
      staked: true,
      details: {
        amountUstx: '50000000000',
        firstRewardCycle: BOND_FIRST_REWARD_CYCLE,
        numCycles: 12,
        signer: SIGNER,
      },
    },
    d183: { staked: false },
  },

  // ---- map protocol-bond-memberships ------------------------------------
  fetchBondMembership: {
    default: null,
    'd-7': null,
    d0: MEMBERSHIP_ACTIVE,
    d14: MEMBERSHIP_ACTIVE,
    d90: MEMBERSHIP_ACTIVE,
    d172: MEMBERSHIP_ACTIVE,
    d177: MEMBERSHIP_ACTIVE,
    d182: MEMBERSHIP_ACTIVE,
    d183: null, // unlock cycle reached → contract collapses to none
  },

  // ---- map allowance-contract-callers -----------------------------------
  fetchAllowanceContractCallers: {
    default: { callerAllowed: false },
    d0: { callerAllowed: true, callerExpiryHeight: heightAt(200) },
    d90: { callerAllowed: true, callerExpiryHeight: heightAt(200) },
    d182: { callerAllowed: true, callerExpiryHeight: heightAt(200) },
    d183: { callerAllowed: false, callerExpiryHeight: heightAt(200) }, // grant expired
  },

  // ---- RO get-protocol-bond / map protocol-bonds ------------------------
  fetchBond: {
    default: null,
    'd-30': BOND_TUPLE,
    'd-7': BOND_TUPLE,
    d0: BOND_TUPLE,
    d90: BOND_TUPLE,
    d182: BOND_TUPLE,
    d183: BOND_TUPLE, // bond row remains readable post-close
  },
  fetchProtocolBond: {
    default: null,
    'd-30': BOND_TUPLE,
    'd-7': BOND_TUPLE,
    d0: BOND_TUPLE,
    d90: BOND_TUPLE,
    d182: BOND_TUPLE,
    d183: BOND_TUPLE,
  },

  // ---- map protocol-bond-allowances -------------------------------------
  fetchBondAllowance: {
    default: { value: '0' },
    'd-7': { value: '5000000000' }, // 50 BTC max-sats allowlisted
    d0: { value: '5000000000' },
    d90: { value: '5000000000' },
    d182: { value: '5000000000' },
  },

  // ---- RO get-total-sbtc-staked-for-bond (snapshot) ---------------------
  fetchTotalSbtcStakedForBond: {
    default: { value: '0' },
    'd-7': { value: '12000000000' }, // ~24% filled mid-registration
    d0: { value: '45000000000' }, // 90% filled at lock day
    d90: { value: '45000000000' }, // frozen post-D0
    d182: { value: '45000000000' },
    d183: { value: '45000000000' },
  },

  // ---- RO get-total-shares-staked-for-cycle (live) ----------------------
  // NOTE: caller passes {index, isBond} but per spec args are ignored —
  // the fixture is a single value. Use bond-shaped sats numbers.
  fetchTotalSharesStakedForCycle: {
    default: { value: '0' },
    'd-7': { value: '12000000000' },
    d0: { value: '45000000000' },
    d14: { value: '45000000000' },
    d90: { value: '44500000000' }, // a partial unstake-sbtc
    d172: { value: '44500000000' },
    d183: { value: '0' },
  },

  // ---- RO get-total-sbtc-staked (protocol-wide) -------------------------
  fetchTotalSbtcStaked: {
    default: { value: '0' },
    'd-30': { value: '0' },
    d0: { value: '45000000000' },
    d90: { value: '180000000000' }, // 6 concurrent bonds
    d183: { value: '135000000000' },
  },

  // ---- RO get-total-ustx-stacked ----------------------------------------
  fetchTotalUstxStacked: {
    default: { value: '350000000000000' },
    d0: { value: '410000000000000' },
    d90: { value: '425000000000000' },
    d182: { value: '420000000000000' },
  },

  // ---- RO get-bond-l1-unlock-height -------------------------------------
  fetchBondL1UnlockHeight: {
    // BTC unlocks at D172 (per scenarios doc).
    default: { value: '0' },
    'd-30': { value: String(heightAt(172)) },
    d0: { value: String(heightAt(172)) },
    d90: { value: String(heightAt(172)) },
    d182: { value: String(heightAt(172)) },
  },

  // ---- RO get-staker-shares-staked-for-cycle (3 shapes) -----------------
  fetchStakerSharesStakedByBond: {
    default: { value: '0' },
    d0: { value: '5000000000' },
    d90: { value: '5000000000' },
    d182: { value: '5000000000' },
    d183: { value: '0' },
  },
  fetchStakerSharesStakedByCycle: {
    default: { value: '0' },
    d0: { value: '50000000000' },
    d90: { value: '50000000000' },
    d182: { value: '50000000000' },
    d183: { value: '0' },
  },
  fetchStakerSharesStakedForCycle: {
    default: { value: '0' },
    d0: { value: '50000000000' },
    d90: { value: '50000000000' },
    d182: { value: '50000000000' },
  },

  // ---- RO get-signer-shares-staked-for-cycle ----------------------------
  fetchSignerSharesStakedByBond: {
    default: { value: '0' },
    d0: { value: '45000000000' },
    d90: { value: '44500000000' },
    d182: { value: '44500000000' },
    d183: { value: '0' },
  },
  fetchSignerSharesStakedByCycle: {
    default: { value: '0' },
    d0: { value: '120000000000000' }, // 120M uSTX from this signer in cycle
    d90: { value: '125000000000000' },
    d182: { value: '120000000000000' },
  },

  // ---- RO get-earned (sugar + base) -------------------------------------
  fetchEarned: {
    default: { value: '0' },
    d14: { value: '850000000' }, // 850 STX accrued
    d90: { value: '5800000000' }, // 5800 STX accrued
    d182: { value: '12000000000' },
    d183: { value: '0' }, // fully claimed
  },
  fetchEarnedByBond: {
    default: { value: '0' },
    d14: { value: '90000000' },
    d90: { value: '620000000' },
    d182: { value: '1280000000' },
    d183: { value: '0' },
  },
  fetchEarnedByCycle: {
    default: { value: '0' },
    d14: { value: '760000000' },
    d90: { value: '5180000000' },
    d182: { value: '10720000000' },
    d183: { value: '0' },
  },

  // ---- RO get-signer-unclaimed-rewards-for-cycle ------------------------
  fetchSignerUnclaimedRewards: {
    default: { value: '0' },
    d14: { value: '420000000' },
    d90: { value: '2900000000' },
    d182: { value: '6000000000' },
    d183: { value: '0' },
  },

  // ---- RO get-signer-rewards-per-token-settled-for-cycle ----------------
  fetchSignerRewardsPerTokenSettled: {
    default: { value: '0' },
    d14: { value: '120000000000000' },
    d90: { value: '850000000000000' },
    d182: { value: '1720000000000000' },
  },
  fetchSignerRewardsPerTokenSettledByBond: {
    default: { value: '0' },
    d14: { value: '1500000000000000' },
    d90: { value: '9800000000000000' },
    d182: { value: '20500000000000000' },
  },
  fetchSignerRewardsPerTokenSettledByCycle: {
    default: { value: '0' },
    d14: { value: '120000000000000' },
    d90: { value: '850000000000000' },
    d182: { value: '1720000000000000' },
  },

  // ---- RO get-signer-info -----------------------------------------------
  fetchSignerInfo: {
    default: null,
    'd-30': { signerKey: SIGNER_KEY_HEX },
    d0: { signerKey: SIGNER_KEY_HEX },
    d90: { signerKey: SIGNER_KEY_HEX },
    d182: { signerKey: SIGNER_KEY_HEX },
  },

  // ---- RO verify-signer-key-grant ---------------------------------------
  fetchVerifySignerKeyGrant: {
    default: { value: false },
    'd-30': { value: true },
    d0: { value: true },
    d90: { value: true },
    d182: { value: true },
  },

  // ---- RO get-signer-grant-message-hash ---------------------------------
  // Returns lowercase 32-byte hex (un-prefixed).
  fetchSignerGrantMessageHash: {
    default: { value: 'a1' + 'b2c3d4e5'.repeat(7) + 'f0a1b2c3' },
  },
};

// ---------------------------------------------------------------------------
// Coworker API endpoint scenarios (§2 of design review).
// Shapes follow the design-review's recommended fields. Returned as full
// JSON objects (no string-wrapping at the top level).
// ---------------------------------------------------------------------------

const bondRowSummary = (overrides: Record<string, unknown> = {}) => ({
  index: BOND_INDEX,
  tx_id: '0x' + 'ab'.repeat(32),
  block_height: heightAt(-30),
  target_rate_bps: 800,
  stx_value_ratio: '4000000000',
  min_ustx_ratio_bps: 11_000,
  registrations_count: 4,
  total_sbtc_locked: '45000000000',
  capacity_sats: '50000000000',
  open_burn_height: heightAt(-7),
  first_reward_cycle: BOND_FIRST_REWARD_CYCLE,
  unlock_burn_height: heightAt(182),
  l1_unlock_burn_height: heightAt(172),
  is_active_now: true,
  status: 'active',
  ...overrides,
});

const bondRowDetail = (overrides: Record<string, unknown> = {}) => ({
  ...bondRowSummary(),
  early_unlock_bytes: EARLY_UNLOCK_BYTES_HEX,
  early_unlock_admin: EARLY_UNLOCK_ADMIN,
  early_exit_pubkeys: [],
  early_exit_threshold: 0,
  ...overrides,
});

const allowlistEntry = (overrides: Record<string, unknown> = {}) => ({
  bond_index: BOND_INDEX,
  principal: STAKER,
  max_sats: '5000000000',
  current_amount: '5000000000',
  ...overrides,
});

const registrationRow = (overrides: Record<string, unknown> = {}) => ({
  bond_index: BOND_INDEX,
  principal: STAKER,
  tx_id: '0x' + 'cd'.repeat(32),
  block_height: heightAt(-3),
  amount_ustx: '50000000000',
  amount_sats: '5000000000',
  signer: SIGNER,
  is_l1_lock: true,
  lockup_address: 'bc1qexamplep2wshlockupaddressplaceholderxxxxxxxxx',
  pox_address: { version: 4, hashbytes: 'aa'.repeat(20) },
  signer_calldata: '0x' + 'ee'.repeat(20),
  unlock_burn_height: heightAt(182),
  unlock_cycle: BOND_FIRST_REWARD_CYCLE + 12,
  still_locked_l1: true,
  early_exit_announced: false,
  ...overrides,
});

const cycleRow = (cycleId: number, overrides: Record<string, unknown> = {}) => ({
  id: cycleId,
  is_pox_active: true,
  staked_ustx: '425000000000000',
  total_shares_ustx: '425000000000000',
  rewards_per_token_ustx: '850000000000000',
  ustx_delegated_total: '425000000000000',
  is_in_prepare_phase: false,
  prepare_phase_start_burn_height:
    FIRST_BURNCHAIN_BLOCK_HEIGHT + (cycleId + 1) * REWARD_CYCLE_LENGTH - PREPARE_CYCLE_LENGTH,
  prepare_phase_end_burn_height: FIRST_BURNCHAIN_BLOCK_HEIGHT + (cycleId + 1) * REWARD_CYCLE_LENGTH,
  cycle_start_burn_height: FIRST_BURNCHAIN_BLOCK_HEIGHT + cycleId * REWARD_CYCLE_LENGTH,
  cycle_end_burn_height: FIRST_BURNCHAIN_BLOCK_HEIGHT + (cycleId + 1) * REWARD_CYCLE_LENGTH,
  distribution_cycles: [cycleId * 2, cycleId * 2 + 1],
  signers_count: 24,
  ...overrides,
});

const cycleSignerRow = (overrides: Record<string, unknown> = {}) => ({
  signer: SIGNER,
  signer_key: SIGNER_KEY_HEX,
  shares_ustx: '120000000000000',
  rewards_per_token_settled: '850000000000000',
  unclaimed_rewards: '2900000000',
  stakers_count: 18,
  ...overrides,
});

const signerStakerRow = (overrides: Record<string, unknown> = {}) => ({
  principal: STAKER,
  shares_ustx: '50000000000',
  pox_address: { version: 4, hashbytes: 'aa'.repeat(20) },
  signer_calldata: '0x' + 'ee'.repeat(20),
  ...overrides,
});

const cycleStakerRow = (overrides: Record<string, unknown> = {}) => ({
  principal: STAKER,
  signer: SIGNER,
  shares_ustx: '50000000000',
  amount_ustx: '50000000000',
  first_reward_cycle: BOND_FIRST_REWARD_CYCLE,
  num_cycles: 12,
  ...overrides,
});

const COWORKER_SCENARIOS: Record<string, Record<string, unknown>> = {
  mockListBonds: {
    default: { results: [], next_cursor: null },
    'd-30': {
      results: [
        bondRowSummary({
          status: 'announced',
          is_active_now: false,
          registrations_count: 0,
          total_sbtc_locked: '0',
        }),
      ],
      next_cursor: null,
    },
    d0: {
      results: [
        bondRowSummary({ status: 'open', total_sbtc_locked: '45000000000', registrations_count: 4 }),
      ],
      next_cursor: null,
    },
    d90: {
      results: [
        bondRowSummary({ status: 'active' }),
        bondRowSummary({
          index: BOND_INDEX + 1,
          status: 'active',
          total_sbtc_locked: '30000000000',
          registrations_count: 3,
        }),
      ],
      next_cursor: null,
    },
    d177: {
      results: [bondRowSummary({ status: 're-lock-window' })],
      next_cursor: null,
    },
    d183: {
      results: [
        bondRowSummary({ status: 'closed', is_active_now: false, registrations_count: 4 }),
      ],
      next_cursor: null,
    },
  },

  mockGetBond: {
    default: null,
    'd-30': bondRowDetail({
      status: 'announced',
      is_active_now: false,
      registrations_count: 0,
      total_sbtc_locked: '0',
    }),
    d0: bondRowDetail({ status: 'open' }),
    d90: bondRowDetail({ status: 'active' }),
    d177: bondRowDetail({ status: 're-lock-window' }),
    d183: bondRowDetail({ status: 'closed', is_active_now: false }),
  },

  mockListBondAllowlist: {
    default: { results: [], next_cursor: null },
    'd-7': {
      results: [
        allowlistEntry({ current_amount: '0' }),
        allowlistEntry({ principal: POOL_CONTRACT, max_sats: '20000000000', current_amount: '0' }),
      ],
      next_cursor: null,
    },
    d90: {
      results: [
        allowlistEntry(),
        allowlistEntry({
          principal: POOL_CONTRACT,
          max_sats: '20000000000',
          current_amount: '20000000000',
        }),
      ],
      next_cursor: null,
    },
  },

  mockGetBondAllowlistEntry: {
    default: null,
    'd-7': allowlistEntry({ current_amount: '0' }),
    d0: allowlistEntry(),
    d90: allowlistEntry(),
  },

  mockListBondRegistrations: {
    default: { results: [], next_cursor: null },
    'd-7': {
      results: [
        registrationRow({
          amount_sats: '5000000000',
          amount_ustx: '50000000000',
          still_locked_l1: false,
        }),
      ],
      next_cursor: null,
    },
    d0: {
      results: [
        registrationRow(),
        registrationRow({
          principal: POOL_CONTRACT,
          is_l1_lock: false,
          lockup_address: null,
          amount_sats: '20000000000',
          amount_ustx: '200000000000',
        }),
      ],
      next_cursor: null,
    },
    d90: {
      results: [registrationRow(), registrationRow({ principal: POOL_CONTRACT, is_l1_lock: false, lockup_address: null })],
      next_cursor: null,
    },
    d172: {
      results: [registrationRow({ still_locked_l1: false })],
      next_cursor: null,
    },
    d183: {
      results: [registrationRow({ still_locked_l1: false })],
      next_cursor: null,
    },
  },

  mockGetBondRegistration: {
    default: null,
    'd-7': registrationRow({ still_locked_l1: false }),
    d0: registrationRow(),
    d90: registrationRow(),
    d172: registrationRow({ still_locked_l1: false }),
    d183: registrationRow({ still_locked_l1: false }),
  },

  mockListCycles: {
    default: {
      results: [cycleRow(101), cycleRow(102), cycleRow(103)],
      next_cursor: null,
    },
    d0: {
      results: [cycleRow(96, { staked_ustx: '410000000000000', rewards_per_token_ustx: '0' })],
      next_cursor: null,
    },
    d90: {
      results: [cycleRow(102)],
      next_cursor: null,
    },
  },

  mockGetCycle: {
    default: cycleRow(102),
    d0: cycleRow(96, { rewards_per_token_ustx: '0' }),
    d90: cycleRow(102),
    d182: cycleRow(108, { is_in_prepare_phase: true }),
  },

  mockListCycleSigners: {
    default: { results: [], next_cursor: null },
    d0: {
      results: [cycleSignerRow({ unclaimed_rewards: '0', rewards_per_token_settled: '0' })],
      next_cursor: null,
    },
    d90: {
      results: [cycleSignerRow()],
      next_cursor: null,
    },
  },

  mockListSignerStakers: {
    default: { results: [], next_cursor: null },
    d0: { results: [signerStakerRow()], next_cursor: null },
    d90: {
      results: [
        signerStakerRow(),
        signerStakerRow({
          principal: POOL_CONTRACT,
          shares_ustx: '200000000000',
        }),
      ],
      next_cursor: null,
    },
  },

  mockListCycleStakers: {
    default: { results: [], next_cursor: null },
    d0: { results: [cycleStakerRow()], next_cursor: null },
    d90: {
      results: [
        cycleStakerRow(),
        cycleStakerRow({ principal: POOL_CONTRACT, shares_ustx: '200000000000', amount_ustx: '200000000000' }),
      ],
      next_cursor: null,
    },
  },
};

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const ROOT = __dirname;
const DATA_DIR = join(ROOT, 'data');

// Wipe and recreate (idempotent regeneration).
if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
mkdirSync(DATA_DIR, { recursive: true });

const allScenarios: Record<string, Record<string, unknown>> = {
  ...SCENARIOS,
  ...COWORKER_SCENARIOS,
};

let fileCount = 0;
for (const [fn, days] of Object.entries(allScenarios)) {
  const fnDir = join(DATA_DIR, fn);
  mkdirSync(fnDir, { recursive: true });
  for (const [day, fixture] of Object.entries(days)) {
    const filePath = join(fnDir, `${day}.json`);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(fixture, null, 2) + '\n');
    fileCount++;
  }
}

// ---------------------------------------------------------------------------
// Emit fixtures.ts — static imports indexed by {fn -> {day -> raw}}.
// Re-running the generator regenerates this file.
// ---------------------------------------------------------------------------

const importLines: string[] = [];
const mapLines: string[] = [];
for (const [fn, days] of Object.entries(allScenarios)) {
  const dayEntries: string[] = [];
  for (const day of Object.keys(days)) {
    const ident = `${fn}__${day.replace(/[^a-zA-Z0-9]/g, '_')}`;
    importLines.push(`import ${ident} from './data/${fn}/${day}.json';`);
    dayEntries.push(`  ${JSON.stringify(day)}: ${ident},`);
  }
  mapLines.push(`export const ${fn}_FIXTURES: Record<string, unknown> = {\n${dayEntries.join('\n')}\n};`);
  mapLines.push(`export const ${fn}_DAYS: string[] = [${Object.keys(days).map(d => JSON.stringify(d)).join(', ')}];`);
}

const fixturesTs =
  '// AUTO-GENERATED by mocks/generate.ts. Do not edit by hand.\n' +
  '// Re-run `npm run generate-mocks` to refresh.\n\n' +
  '/* eslint-disable */\n' +
  importLines.join('\n') +
  '\n\n' +
  mapLines.join('\n\n') +
  '\n';

writeFileSync(join(ROOT, 'fixtures.ts'), fixturesTs);

console.log(`generated ${fileCount} fixture files across ${Object.keys(allScenarios).length} functions`);
for (const [fn, days] of Object.entries(allScenarios)) {
  console.log(`  ${fn}: ${Object.keys(days).join(', ')}`);
}
console.log(`wrote fixtures.ts with ${importLines.length} static imports`);
