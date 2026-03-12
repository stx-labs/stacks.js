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

export type PostCondition = StxPostCondition | FungiblePostCondition | NonFungiblePostCondition;

export type PostConditionModeName = 'allow' | 'deny' | 'originator';
