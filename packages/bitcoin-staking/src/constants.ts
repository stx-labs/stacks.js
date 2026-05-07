/** PoX-5 contract identifier (placeholder — update when deployed) */
export const POX_5_CONTRACT = 'SP000000000000000000002Q6VF78.pox-5';

/** @ignore */
export const CONTRACT_ADDRESS = POX_5_CONTRACT.split('.')[0];
/** @ignore */
export const CONTRACT_NAME = POX_5_CONTRACT.split('.')[1];

/** Length of a paired-BTC bond in reward cycles (≈ 6 months). */
export const BOND_LENGTH_CYCLES = 12;

/** Gap between consecutive bond starts, in reward cycles. */
export const BOND_GAP_CYCLES = 2;

/** Hard cap for STX-only stake duration. */
export const MAX_NUM_CYCLES = 96;

/** Signature topics for PoX-5 SIP-018 structured data signing */
export enum Pox5SignatureTopic {
  Stake = 'stake',
  StakeExtend = 'stake-extend',
  StakeUpdate = 'stake-update',
}

/** Address versions corresponding to the pox-5 contract `pox-addr` tuple */
export enum PoXAddressVersion {
  // Taken from https://github.com/stx-labs/stacks.js/blob/efd2255f979ed64b90ac33246d99cd4809620400/packages/stacking/src/constants.ts#L1-L17

  /** p2pkh — 20-byte hash160 of a single public key */
  P2PKH = 0x00,
  /** p2sh — 20-byte hash160 of a redeemScript */
  P2SH = 0x01,
  /** p2wpkh-p2sh (indistinguishable from P2SH on-chain) */
  P2SHP2WPKH = 0x02,
  /** p2wsh-p2sh (indistinguishable from P2SH on-chain) */
  P2SHP2WSH = 0x03,
  /** p2wpkh — 20-byte witness program */
  P2WPKH = 0x04,
  /** p2wsh — 32-byte witness program */
  P2WSH = 0x05,
  /** p2tr — 32-byte witness program */
  P2TR = 0x06,
}

/** Bitcoin base58 address version bytes per network */
export const BitcoinNetworkVersion = {
  mainnet: { P2PKH: 0x00, P2SH: 0x05 },
  testnet: { P2PKH: 0x6f, P2SH: 0xc4 },
  devnet: { P2PKH: 0x6f, P2SH: 0xc4 },
  mocknet: { P2PKH: 0x6f, P2SH: 0xc4 },
} as const;

/** Regex matching base58 (legacy) BTC address prefixes */
export const B58_ADDR_PREFIXES = /^(1|3|m|n|2)/;

/** Regex matching any segwit BTC address prefix (mainnet, testnet, regtest) */
export const SEGWIT_ADDR_PREFIXES = /^(bc|tb|bcrt)/i;

/** Segwit v0 address prefix regex */
export const SEGWIT_V0_ADDR_PREFIX = /^(bc1q|tb1q|bcrt1q)/i;

/** Segwit v1 (taproot) address prefix regex */
export const SEGWIT_V1_ADDR_PREFIX = /^(bc1p|tb1p|bcrt1p)/i;

/** Bech32 human-readable part per network */
export const SegwitPrefix = {
  mainnet: 'bc',
  testnet: 'tb',
  devnet: 'bcrt',
  mocknet: 'bcrt',
} as const;

export const SEGWIT_V0 = 0;
export const SEGWIT_V1 = 1;
