import { IntegerType } from '@stacks/common';
import { ClarityValue } from './clarity';
import {
  FungibleComparator,
  FungiblePostCondition,
  NonFungibleComparator,
  NonFungiblePostCondition,
  PostCondition,
  StxPostCondition,
} from './postcondition-types';
import { AddressString, AssetString, ContractIdString } from './types';
import { parseContractId, validateStacksAddress } from './utils';
import { deserializePostConditionWire } from './wire';
import { parsePostConditionAmount, wireToPostCondition } from './postcondition';

/// `Pc.` Post Condition Builder
//
// This is a behavioral helper interface for constructing post conditions.
//
// The general pattern is:
//   PRINCIPAL -> [AMOUNT] -> CODE -> ASSET
//

/**
 * ### `Pc.` Post Condition Builder
 * @beta Interface may be subject to change in future releases.
 * @param {AddressString | ContractIdString} principal The principal to check, which should/should-not be sending assets. A string in the format `<address>` or `<contractAddress>.<contractName>`.
 * @returns A partial post condition builder, which can be chained into a final post condition.
 * @example
 * ```
 * import { Pc } from '@stacks/transactions';
 * Pc.principal('STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6').willSendEq(10000).ustx();
 * Pc.principal('STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6.mycontract').willSendGte(2000).ft();
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export function principal(principal: AddressString | ContractIdString) {
  const [address, name] = principal.split('.');

  // todo: improve validity check (and add helper methods like `isValidContractId`, `isValidAdress`,
  // token name, asset syntax, etc.) -- also deupe .split checks in codebase
  if (!address || !validateStacksAddress(address) || (typeof name === 'string' && !name)) {
    throw new Error(`Invalid contract id: ${principal}`);
  }

  return new PartialPcWithPrincipal(principal);
}

/**
 * ### `Pc.` Post Condition Builder
 * @beta Interface may be subject to change in future releases.
 * @returns A partial post condition builder, which can be chained into a final post condition.
 * @example
 * ```
 * import { Pc } from '@stacks/transactions';
 * Pc.origin().willSendEq(10000).ustx();
 * Pc.origin().willSendGte(2000).ft();
 * ```
 */
export function origin() {
  return new PartialPcWithPrincipal('origin');
}

/**
 * Not meant to be used directly. Start from `Pc.principal(…)` instead.
 */
class PartialPcWithPrincipal {
  constructor(private address: string) {}

  // todo: split FT and STX into separate methods? e.g. `willSendSTXEq` and `willSendFtEq`

  /**
   * ### Fungible Token Post Condition
   * A post-condition sending tokens `FungibleConditionCode.Equal` (equal to) the given amount of uSTX or fungible-tokens.
   * Finalize with the chained `.ustx()` or `.ft(…)` method.
   * @example
   * ```
   * import { Pc } from '@stacks/transactions';
   * Pc.principal('STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6').willSendEq(100).stx();
   * ```
   */
  willSendEq(amount: IntegerType) {
    return new PartialPcFtWithCode(this.address, amount, 'eq');
  }

  /**
   * ### Fungible Token Post Condition
   * A post-condition sending tokens `FungibleConditionCode.LessEqual` (less-than or equal to) the given amount of uSTX or fungible-tokens.
   * Finalize with the chained `.ustx()` or `.ft(…)` method.
   * @example
   * ```
   * import { Pc } from '@stacks/transactions';
   * Pc.principal('STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6').willSendLte(100).stx();
   * ```
   */
  willSendLte(amount: IntegerType) {
    return new PartialPcFtWithCode(this.address, amount, 'lte');
  }

  /**
   * ### Fungible Token Post Condition
   * A post-condition sending tokens `FungibleConditionCode.Less` (less-than) the given amount of uSTX or fungible-tokens.
   * Finalize with the chained `.ustx()` or `.ft(…)` method.
   * @example
   * ```
   * import { Pc } from '@stacks/transactions';
   * Pc.principal('STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6').willSendLt(100).stx();
   * ```
   */
  willSendLt(amount: IntegerType) {
    return new PartialPcFtWithCode(this.address, amount, 'lt');
  }

  /**
   * ### Fungible Token Post Condition
   * A post-condition sending tokens `FungibleConditionCode.GreaterEqual` (greater-than or equal to) the given amount of uSTX or fungible-tokens.
   * Finalize with the chained `.ustx()` or `.ft(…)` method.
   * @example
   * ```
   * import { Pc } from '@stacks/transactions';
   * Pc.principal('STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6').willSendGte(100).stx();
   * ```
   */
  willSendGte(amount: IntegerType) {
    return new PartialPcFtWithCode(this.address, amount, 'gte');
  }

  /**
   * ### Fungible Token Post Condition
   * A post-condition sending tokens `FungibleConditionCode.Greater` (greater-than) the given amount of uSTX or fungible-tokens.
   * Finalize with the chained `.ustx()` or `.ft(…)` method.
   * @example
   * ```
   * import { Pc } from '@stacks/transactions';
   * Pc.principal('STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6').willSendGt(100).stx();
   * ```
   */
  willSendGt(amount: IntegerType) {
    return new PartialPcFtWithCode(this.address, amount, 'gt');
  }

  /**
   * ### NFT Post Condition
   * A post-condition which `NonFungibleConditionCode.Sends` an NFT.
   * Finalize with the chained `.nft(…)` method.
   * @example
   * ```
   * import { Pc } from '@stacks/transactions';
   * Pc.principal('STB4…K6.nft-contract').willSendAsset().nft('STB4…K6.super-nft::super', uintCV(1));
   * ```
   */
  willSendAsset() {
    return new PartialPcNftWithCode(this.address, 'sent');
  }

  /**
   * ### NFT Post Condition
   * A post-condition which `NonFungibleConditionCode.DoesNotSend` an NFT.
   * Finalize with the chained `.nft(…)` method.
   * @example
   * ```
   * import { Pc } from '@stacks/transactions';
   * Pc.principal('STB4…K6.nft-contract').willNotSendAsset().nft('STB4…K6.super-nft::super', uintCV(1));
   * ```
   */
  willNotSendAsset() {
    return new PartialPcNftWithCode(this.address, 'not-sent');
  }
}

/**
 * Not meant to be used directly. Start from `Pc.principal(…)` instead.
 */
class PartialPcFtWithCode {
  constructor(
    private address: string,
    private amount: IntegerType,
    private code: FungibleComparator
  ) {}

  /**
   * ### STX Post Condition
   * ⚠ Amount of STX is denoted in uSTX (micro-STX)
   */
  ustx(): StxPostCondition {
    // todo: rename to `uSTX`?
    return {
      type: 'stx-postcondition',
      address: this.address,
      condition: this.code,
      amount: parsePostConditionAmount(this.amount).toString(),
    };
  }

  /**
   * ### Fungible Token Post Condition
   * ⚠ Amount of fungible tokens is denoted in the smallest unit of the token
   */
  ft(contractId: ContractIdString, tokenName: string): FungiblePostCondition {
    // todo: allow taking one arg (`Asset`) as well, overload

    const [address, name] = contractId.split('.');
    if (!address || !validateStacksAddress(address) || (typeof name === 'string' && !name)) {
      throw new Error(`Invalid contract id: ${contractId}`);
    }

    return {
      type: 'ft-postcondition',
      address: this.address,
      condition: this.code,
      amount: parsePostConditionAmount(this.amount).toString(),
      asset: `${contractId}::${tokenName}`,
    };
  }
}

/**
 * Not meant to be used directly. Start from `Pc.principal(…)` instead.
 */
class PartialPcNftWithCode {
  constructor(
    private address: string,
    private code: NonFungibleComparator
  ) {}

  /**
   * ### Non-Fungible Token Post Condition
   * @param assetName - The name of the NFT asset. Formatted as `<contract-address>.<contract-name>::<token-name>`.
   * @param assetId - The asset identifier of the NFT. A Clarity value defining the single NFT instance.
   */
  nft(assetName: AssetString, assetId: ClarityValue): NonFungiblePostCondition;
  /**
   * ### Non-Fungible Token Post Condition
   * @param contractId - The contract identifier of the NFT. Formatted as `<contract-address>.<contract-name>`.
   * @param tokenName - The name of the NFT asset.
   * @param assetId - The asset identifier of the NFT. A Clarity value defining the single NFT instance.
   */
  nft(
    contractId: ContractIdString,
    tokenName: string,
    assetId: ClarityValue
  ): NonFungiblePostCondition;
  nft(...args: [any, any] | [any, any, any]): NonFungiblePostCondition {
    const { contractAddress, contractName, tokenName, assetId } = getNftArgs(
      ...(args as [any, any, any])
    );

    if (!validateStacksAddress(contractAddress)) {
      throw new Error(`Invalid contract id: ${contractAddress}`);
    }

    return {
      type: 'nft-postcondition',
      address: this.address,
      condition: this.code,
      asset: `${contractAddress}.${contractName}::${tokenName}`,
      assetId,
    };
  }
}

/** @internal */
function parseNft(nftAssetName: AssetString) {
  const [principal, tokenName] = nftAssetName.split('::') as [ContractIdString, string];
  if (!principal || !tokenName)
    throw new Error(`Invalid fully-qualified nft asset name: ${nftAssetName}`);
  const [address, name] = parseContractId(principal);
  return { contractAddress: address, contractName: name, tokenName };
}

/**
 * Deserializes a serialized post condition hex string into a post condition object
 * @param hex - Post condition hex string
 * @returns Deserialized post condition
 * @example
 * ```ts
 * import { Pc } from '@stacks/transactions';
 *
 * const hex = '00021600000000000000000000000000000000000000000200000000000003e8'
 * const postCondition = Pc.fromHex(hex);
 * // {
 * //   type: 'stx-postcondition',
 * //   address: 'SP000000000000000000002Q6VF78',
 * //   condition: 'gt',
 * //   amount: '1000'
 * // }
 * ```
 */
export function fromHex(hex: string): PostCondition {
  const wire = deserializePostConditionWire(hex);
  return wireToPostCondition(wire);
}

/**
 * Helper method for `PartialPcNftWithCode.nft` to parse the arguments.
 * @internal
 */
function getNftArgs(
  asset: AssetString,
  assetId: ClarityValue
): { contractAddress: string; contractName: string; tokenName: string; assetId: ClarityValue };
function getNftArgs(
  contractId: ContractIdString,
  tokenName: string,
  assetId: ClarityValue
): { contractAddress: string; contractName: string; tokenName: string; assetId: ClarityValue };
function getNftArgs(...args: [any, any] | [any, any, any]): {
  contractAddress: string;
  contractName: string;
  tokenName: string;
  assetId: ClarityValue;
} {
  if (args.length === 2) {
    const [assetName, assetId] = args;
    return { ...parseNft(assetName), assetId };
  }

  // args.length === 3
  const [contractId, tokenName, assetId] = args;
  const [address, name] = parseContractId(contractId);
  return { contractAddress: address, contractName: name, tokenName, assetId };
}
