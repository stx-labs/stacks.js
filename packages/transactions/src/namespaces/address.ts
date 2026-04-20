import { c32address, c32addressDecode } from 'c32check';
import { AddressVersion } from '../constants';
import { privateKeyToAddress, publicKeyToAddressSingleSig } from '../keys';
import { AddressString, ContractIdString } from '../types';

const C32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export type AddressRepr = { hash160: string; contractName?: string } & (
  | {
      version: AddressVersion;
      versionChar: string;
    }
  | {
      version: AddressVersion;
    }
  | {
      versionChar: string;
    }
);

/**
 * Parse a C32 Stacks address string to an address object.
 * @param address - The address string to parse.
 * @example
 * ```ts
 * import { Address } from '@stacks/transactions';
 *
 * const address = Address.parse('SP000000000000000000002Q6VF78');
 * // { version: 22, versionChar: 'P', hash160: '0000000000000000000000000000000000000000' }
 *
 * const address = Address.parse('ST000000000000000000002AMW42H.pox');
 * // { version: 22, versionChar: 'P', hash160: '0000000000000000000000000000000000000000', contractName: 'pox' }
 * ```
 */
export function parse(
  address:
    | AddressString
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    | ContractIdString
): Required<AddressRepr> {
  const [addr, contractName] = address.split('.');
  const parsed = c32addressDecode(addr); // throws if c32 part is invalid
  // todo: throw if contract name is invalid
  return {
    version: parsed[0],
    versionChar: C32[parsed[0]],
    hash160: parsed[1],
    contractName,
  };
}

/**
 * Stringify an address to the C32 address format.
 * @param address - The address object to stringify.
 * @example
 * ```ts
 * import { Address } from '@stacks/transactions';
 *
 * const address = Address.stringify({ version: 22, hash160: '0000000000000000000000000000000000000000' });
 * console.log(address); // 'SP000000000000000000002Q6VF78'
 *
 * const address = Address.stringify({ versionChar: 'P', hash160: '0000000000000000000000000000000000000000' });
 * console.log(address); // 'SP000000000000000000002Q6VF78'
 * ```
 */
export function stringify(address: AddressRepr): string {
  const version =
    'version' in address ? address.version : C32.indexOf(address.versionChar.toUpperCase());
  const addr = c32address(version, address.hash160);

  if (address.contractName) return `${addr}.${address.contractName}`;
  return addr;
}

/**
 * Convert a private key to a single-sig C32 Stacks address.
 * @param privateKey - The private key to convert.
 * @returns The address string.
 *
 * @example
 * ```ts
 * import { Address } from '@stacks/transactions';
 *
 * const address = Address.fromPrivateKey('73a2f291df5a8ce3ceb668a25ac7af45639513af7596d710ddf59f64f484fd2801');
 * // 'SP10J81WVGVB3M4PHQN4Q4G0R8586TBJH948RESDR'
 *
 * const address = Address.fromPrivateKey('73a2f291df5a8ce3ceb668a25ac7af45639513af7596d710ddf59f64f484fd2801', 'testnet');
 * // 'ST10J81WVGVB3M4PHQN4Q4G0R8586TBJH94CGRESQ'
 * ```
 */
export const fromPrivateKey = privateKeyToAddress;

/**
 * Convert a public key to a single-sig C32 Stacks address.
 * @param publicKey - The public key to convert.
 * @returns The address string.
 *
 * @example
 * ```ts
 * import { Address } from '@stacks/transactions';
 *
 * const address = Address.fromPublicKey('0316e35d38b52d4886e40065e4952a49535ce914e02294be58e252d1998f129b19');
 * // 'SP10J81WVGVB3M4PHQN4Q4G0R8586TBJH948RESDR'
 *
 * const address = Address.fromPublicKey('0316e35d38b52d4886e40065e4952a49535ce914e02294be58e252d1998f129b19', 'testnet');
 * // 'ST10J81WVGVB3M4PHQN4Q4G0R8586TBJH94CGRESQ'
 * ```
 */
export const fromPublicKey = publicKeyToAddressSingleSig;

// todo: add `fromPublicKeys` for multi-sig
