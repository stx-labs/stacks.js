import { IntegerType, intToBigInt } from '@stacks/common';
import {
  FungibleConditionCode,
  NonFungibleConditionCode,
  PostConditionMode,
  PostConditionPrincipalId,
  PostConditionType,
} from './constants';
import {
  FungibleComparator,
  NonFungibleComparator,
  PostCondition,
  PostConditionModeName,
} from './postcondition-types';
import { AssetString } from './types';
import {
  AssetWire,
  PostConditionPrincipalWire,
  PostConditionWire,
  StacksWireType,
  addressToString,
  parseAssetString,
  parsePrincipalString,
  serializePostConditionWire,
} from './wire';

const MAX_U64 = BigInt('18446744073709551615'); // 2^64 - 1

/** @internal Parses a post-condition amount to bigint, throws if outside u64 range. */
export function parsePostConditionAmount(amount: IntegerType): bigint {
  const value = intToBigInt(amount);
  if (value < 0n || value > MAX_U64) {
    throw new RangeError(
      `Post-condition amount must be between 0 and ${MAX_U64} (u64 max), received: ${value}`
    );
  }
  return value;
}

/** @internal */
enum PostConditionCodeWireType {
  eq = FungibleConditionCode.Equal,
  gt = FungibleConditionCode.Greater,
  lt = FungibleConditionCode.Less,
  gte = FungibleConditionCode.GreaterEqual,
  lte = FungibleConditionCode.LessEqual,

  sent = NonFungibleConditionCode.Sends,
  'not-sent' = NonFungibleConditionCode.DoesNotSend,
}

export function postConditionToWire(postcondition: PostCondition): PostConditionWire {
  switch (postcondition.type) {
    case 'stx-postcondition':
      return {
        type: StacksWireType.PostCondition,
        conditionType: PostConditionType.STX,
        principal:
          postcondition.address === 'origin'
            ? { type: StacksWireType.Principal, prefix: PostConditionPrincipalId.Origin }
            : parsePrincipalString(postcondition.address),
        conditionCode: conditionTypeToByte(postcondition.condition) as FungibleConditionCode,
        amount: parsePostConditionAmount(postcondition.amount),
      };
    case 'ft-postcondition':
      return {
        type: StacksWireType.PostCondition,
        conditionType: PostConditionType.Fungible,
        principal:
          postcondition.address === 'origin'
            ? { type: StacksWireType.Principal, prefix: PostConditionPrincipalId.Origin }
            : parsePrincipalString(postcondition.address),
        conditionCode: conditionTypeToByte(postcondition.condition) as FungibleConditionCode,
        amount: parsePostConditionAmount(postcondition.amount),
        asset: parseAssetString(postcondition.asset),
      };
    case 'nft-postcondition':
      return {
        type: StacksWireType.PostCondition,
        conditionType: PostConditionType.NonFungible,
        principal:
          postcondition.address === 'origin'
            ? { type: StacksWireType.Principal, prefix: PostConditionPrincipalId.Origin }
            : parsePrincipalString(postcondition.address),
        conditionCode: conditionTypeToByte(postcondition.condition),
        asset: parseAssetString(postcondition.asset),
        assetName: postcondition.assetId,
      };
    default:
      throw new Error('Invalid post condition type');
  }
}

export function wireToPostCondition(wire: PostConditionWire): PostCondition {
  switch (wire.conditionType) {
    case PostConditionType.STX:
      return {
        type: 'stx-postcondition',
        address: principalWireToString(wire.principal),
        condition: conditionByteToType(wire.conditionCode),
        amount: wire.amount.toString(),
      };
    case PostConditionType.Fungible:
      return {
        type: 'ft-postcondition',
        address: principalWireToString(wire.principal),
        condition: conditionByteToType(wire.conditionCode),
        amount: wire.amount.toString(),
        asset: assetWireToString(wire.asset),
      };
    case PostConditionType.NonFungible:
      return {
        type: 'nft-postcondition',
        address: principalWireToString(wire.principal),
        condition: conditionByteToType(wire.conditionCode),
        asset: assetWireToString(wire.asset),
        assetId: wire.assetName,
      };
    default: {
      const _exhaustiveCheck: never = wire;
      throw new Error(`Invalid post condition type: ${_exhaustiveCheck}`);
    }
  }
}

/** @internal */
export function conditionTypeToByte<T extends FungibleComparator | NonFungibleComparator>(
  condition: T
): T extends FungibleComparator ? FungibleConditionCode : NonFungibleConditionCode {
  return (
    PostConditionCodeWireType as unknown as Record<
      T,
      T extends FungibleComparator ? FungibleConditionCode : NonFungibleConditionCode
    >
  )[condition];
}

/** @internal */
export function conditionByteToType<T extends FungibleConditionCode | NonFungibleConditionCode>(
  wireType: T
): T extends FungibleConditionCode ? FungibleComparator : NonFungibleComparator {
  return (
    PostConditionCodeWireType as unknown as Record<
      // numerical enums are bidirectional in TypeScript
      T,
      T extends FungibleConditionCode ? FungibleComparator : NonFungibleComparator
    >
  )[wireType];
}

/**
 * Convert a post condition to a hex string
 * @param postcondition - The post condition object to convert
 * @returns The hex string representation of the post condition
 *
 * @example
 * ```ts
 * import { postConditionToHex } from '@stacks/transactions';
 *
 * const hex = postConditionToHex({
 *   type: 'stx-postcondition',
 *   address: 'ST00000000000000000002Q6VF78',
 *   condition: 'eq',
 *   amount: '1000000000000000000',
 * });
 * ```
 * @see {@link StxPostCondition}, {@link FungiblePostCondition}, {@link NonFungiblePostCondition}
 */
export function postConditionToHex(postcondition: PostCondition): string {
  const wire = postConditionToWire(postcondition);
  return serializePostConditionWire(wire);
}

/** @internal */
export function postConditionModeFrom(
  mode: PostConditionModeName | PostConditionMode
): PostConditionMode {
  if (typeof mode === 'number') return mode;
  if (mode === 'allow') return PostConditionMode.Allow;
  if (mode === 'deny') return PostConditionMode.Deny;
  throw new Error(`Invalid post condition mode: ${mode}`);
}

/** @internal */
function assetWireToString(asset: AssetWire): AssetString {
  const address = addressToString(asset.address);
  const contractId = `${address}.${asset.contractName.content}` as const;
  return `${contractId}::${asset.assetName.content}`;
}

/** @internal */
function principalWireToString(principal: PostConditionPrincipalWire): string {
  switch (principal.prefix) {
    case PostConditionPrincipalId.Origin:
      return 'origin';
    case PostConditionPrincipalId.Standard:
      return addressToString(principal.address);
    case PostConditionPrincipalId.Contract:
      const address = addressToString(principal.address);
      return `${address}.${principal.contractName.content}`;
    default:
      const _exhaustiveCheck: never = principal;
      throw new Error(`Invalid principal type: ${_exhaustiveCheck}`);
  }
}
