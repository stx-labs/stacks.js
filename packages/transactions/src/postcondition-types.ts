import { ClarityValue } from './clarity';
import { AssetString } from './types';

export type FungibleComparator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte';

export interface StxPostCondition {
  type: 'stx-postcondition';
  /** Address sending the STX (principal `address` or `contract-id`) */
  address: string;
  /** Comparator to check the amount to be sent (`eq`, `gt`, `gte`, `lt`, `lte`) */
  condition: `${FungibleComparator}`;
  /** `BigInt` compatible amount to be checked in post-condition */
  amount: string | bigint | number;
}

export type FungiblePostCondition = {
  type: 'ft-postcondition';
  /** Address sending the asset (principal `address` or `contract-id`) */
  address: string;
  /** Comparator to check the amount to be sent (`eq`, `gt`, `gte`, `lt`, `lte`) */
  condition: `${FungibleComparator}`;
  /** Asset to be sent (given as a string `<contract-id>::<token-name>`) */
  asset: AssetString;
  /** `BigInt` compatible amount to be checked in post-condition */
  amount: string | bigint | number;
};

/**
 * The type of non-fungible token post-condition comparison.
 *
 * - `sent`: The NFT MUST have been sent by the principal.
 * - `not-sent`: The NFT MUST NOT have been sent by the principal.
 * - `maybe-sent`: The NFT may or may not have been sent by the principal.
 *
 * **⚠︎ Attention**: `maybe-sent` is only enabled starting with [Epoch 3.4](https://forum.stacks.org/t/clarity-5-and-epoch-3-4/18659)
 *
 * @see [SIP-039](https://github.com/stacksgov/sips/pull/256/changes)
 * @see [SIP-040](https://github.com/stacksgov/sips/pull/257/changes)
 */
export type NonFungibleComparator = 'sent' | 'not-sent' | 'maybe-sent';

export type NonFungiblePostCondition = {
  type: 'nft-postcondition';
  /** Address sending the asset (principal `address` or `contract-id`) */
  address: string;
  /** Comparator to check the amount to be sent (`sent`, `not-sent`) */
  condition: `${NonFungibleComparator}`;
  /** Asset to be sent (given as a string `<contract-id>::<token-name>`) */
  asset: AssetString;
  /** Clarity value that identifies the token instance */
  assetId: ClarityValue;
};

/**
 * Staking post-condition (SIP-044).
 *
 * Guards staking STX (or modifying staked STX) for a principal — e.g. pox-5
 * `stake`, `register-for-bond`, `stake-update`. Uses the same fungible
 * comparators as {@link StxPostCondition}.
 */
export interface StakingPostCondition {
  type: 'staking-postcondition';
  /** Address staking the STX (principal `address`, `contract-id`, or `'origin'`) */
  address: string;
  /** Comparator to check the amount to be staked (`eq`, `gt`, `gte`, `lt`, `lte`) */
  condition: `${FungibleComparator}`;
  /** `BigInt` compatible amount to be checked in post-condition */
  amount: string | bigint | number;
}

/**
 * The type of PoX post-condition comparison (SIP-044).
 *
 * - `will-not-perform`: The principal must not perform a gated PoX action.
 * - `may-perform`: The principal may or may not perform a gated PoX action (always passes).
 * - `will-perform`: The principal must perform a gated PoX action.
 */
export type PoxComparator = 'will-not-perform' | 'may-perform' | 'will-perform';

/**
 * PoX post-condition (SIP-044).
 *
 * Guards PoX state changes that do not alter locking status — e.g. pox-5
 * `unstake`, `unstake-sbtc`, `update-bond-registration`,
 * `announce-l1-early-exit`.
 */
export interface PoxPostCondition {
  type: 'pox-postcondition';
  /** Address whose PoX actions are constrained (principal `address`, `contract-id`, or `'origin'`) */
  address: string;
  /** Comparator constraining PoX actions (`will-not-perform`, `may-perform`, `will-perform`) */
  condition: `${PoxComparator}`;
}

export type PostCondition =
  | StxPostCondition
  | FungiblePostCondition
  | NonFungiblePostCondition
  | StakingPostCondition
  | PoxPostCondition;

/**
 * Describes how unspecified asset transfers are handled in a transaction:
 * - `'allow'`: Allow unspecified asset transfers.
 * - `'deny'`: Do not allow unspecified asset transfers.
 * - `'originator'`: Deny unspecified asset transfers for the transaction origin, allow for others (e.g. smart contracts).
 *
 * **Note**: Specified post-conditions are always checked, regardless of _mode_.
 *
 * **⚠︎ Attention**: `originator` is only enabled starting with [Epoch 3.4](https://forum.stacks.org/t/clarity-5-and-epoch-3-4/18659)
 *
 * @see {@link https://github.com/stacksgov/sips/pull/256/changes SIP-039}
 * @see {@link https://github.com/stacksgov/sips/pull/257/changes SIP-040}
 */
export type PostConditionModeName = 'allow' | 'deny' | 'originator';
