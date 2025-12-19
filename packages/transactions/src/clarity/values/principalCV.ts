import { utf8ToBytes } from '@stacks/common';
import {
  AddressWire,
  LengthPrefixedStringWire,
  addressToString,
  createAddress,
  createLPString,
} from '../../wire';
import { ClarityType } from '../constants';
import { ContractPrincipalCV, PrincipalCV, StandardPrincipalCV } from '../types';

export function principalCV(principal: string): PrincipalCV {
  if (principal.includes('.')) {
    const [address, contractName] = principal.split('.');
    return contractPrincipalCV(address, contractName);
  } else {
    return standardPrincipalCV(principal);
  }
}

/**
 * Converts stx address in to StandardPrincipalCV clarity type
 * @param {addressString} string value to be converted to StandardPrincipalCV clarity type
 * @returns {StandardPrincipalCV} returns instance of type StandardPrincipalCV
 *
 * @example
 * ```
 *  import { standardPrincipalCV } from '@stacks/transactions';
 *
 *  const addr = standardPrincipalCV('SP2JXKMSH007NPYAQHKJPQMAQYAD90NQGTVJVQ02B');
 *  // { type: 'address', address: { type: 0, version: 22, hash160: 'a5d9d331000f5b79578ce56bd157f29a9056f0d6' } }
 * ```
 *
 * @see
 * {@link https://github.com/hirosystems/stacks.js/blob/main/packages/transactions/tests/clarity.test.ts | clarity test cases for more examples}
 */
export function standardPrincipalCV(addressString: string): StandardPrincipalCV {
  const addr = createAddress(addressString);
  return { type: ClarityType.PrincipalStandard, value: addressToString(addr) };
}

/**
 * Converts stx address in to StandardPrincipalCV clarity type
 * @param {addressString} string value to be converted to StandardPrincipalCV clarity type
 * @returns {StandardPrincipalCV} returns instance of type StandardPrincipalCV
 *
 * @example
 * ```
 *  import { standardPrincipalCVFromAddress, Address  } from '@stacks/transactions';
 *
 *  const address: Address = {
 *    type: 0,
 *    version: 22,
 *    hash160: 'a5d9d331000f5b79578ce56bd157f29a9056f0d6'
 *  };
 *
 *  const principalCV = standardPrincipalCVFromAddress(address);
 *  // { type: 'address', address: { type: 0, version: 22, hash160: 'a5d9d331000f5b79578ce56bd157f29a9056f0d6' } }
 * ```
 *
 * @see
 * {@link https://github.com/hirosystems/stacks.js/blob/main/packages/transactions/tests/clarity.test.ts | clarity test cases for more examples}
 */
export function standardPrincipalCVFromAddress(address: AddressWire): StandardPrincipalCV {
  return { type: ClarityType.PrincipalStandard, value: addressToString(address) };
}

/**
 * Converts stx address in to ContractPrincipalCV clarity type
 * @param {addressString} string value to be converted to ContractPrincipalCV clarity type
 * @param {contractName} string containing contract name
 * @returns {ContractPrincipalCV} returns instance of type ContractPrincipalCV
 *
 * @example
 * ```
 *  import { contractPrincipalCV } from '@stacks/transactions';
 *
 *  const contractAddress = contractPrincipalCV('SP2JXKMSH007NPYAQHKJPQMAQYAD90NQGTVJVQ02B', 'test');
 *  // { type: 'contract', address: { type: 0, version: 22, hash160: 'a5d9d331000f5b79578ce56bd157f29a9056f0d6' }, contractName: { type: 2, content: 'test', lengthPrefixBytes: 1, maxLengthBytes: 128 } }
 * ```
 *
 * @see
 * {@link https://github.com/hirosystems/stacks.js/blob/main/packages/transactions/tests/clarity.test.ts | clarity test cases for more examples}
 */
export function contractPrincipalCV(
  addressString: string,
  contractName: string
): ContractPrincipalCV {
  const addr = createAddress(addressString);
  const lengthPrefixedContractName = createLPString(contractName);
  return contractPrincipalCVFromAddress(addr, lengthPrefixedContractName);
}

/**
 * Create ContractPrincipalCV from Address type
 * @param {address} address value to be converted to ContractPrincipalCV clarity type
 * @param {contractName} contract name of type LengthPrefixedString
 * @returns {ContractPrincipalCV} returns instance of type ContractPrincipalCV
 *
 * @example
 * ```
 *  import { contractPrincipalCVFromAddress, createLPString, createAddress } from '@stacks/transactions';
 *
 *  const contractAddressCV = contractPrincipalCVFromAddress(createAddress('SP2JXKMSH007NPYAQHKJPQMAQYAD90NQGTVJVQ02B'), createLPString('test'));
 *
 *  // { type: 'contract', address: { type: 0, version: 22, hash160: 'a5d9d331000f5b79578ce56bd157f29a9056f0d6' }, contractName: { type: 2, content: 'test', lengthPrefixBytes: 1, maxLengthBytes: 128 } }
 * ```
 *
 * @see
 * {@link https://github.com/hirosystems/stacks.js/blob/main/packages/transactions/tests/clarity.test.ts | clarity test cases for more examples}
 */
export function contractPrincipalCVFromAddress(
  address: AddressWire,
  contractName: LengthPrefixedStringWire
): ContractPrincipalCV {
  if (utf8ToBytes(contractName.content).byteLength >= 128) {
    throw new Error('Contract name must be less than 128 bytes');
  }
  return {
    type: ClarityType.PrincipalContract,
    value: `${addressToString(address)}.${contractName.content}`,
  };
}

export function contractPrincipalCVFromStandard(
  sp: StandardPrincipalCV,
  contractName: string
): ContractPrincipalCV {
  return {
    type: ClarityType.PrincipalContract,
    value: `${sp.value}.${contractName}`,
  };
}
