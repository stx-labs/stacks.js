import { asciiToBytes, hexToBytes, utf8ToBytes } from '@stacks/common';
import {
  boolCV,
  bufferCV,
  contractPrincipalCV,
  deserializeCV,
  intCV,
  listCV,
  noneCV,
  responseErrorCV,
  responseOkCV,
  serializeCV,
  someCV,
  standardPrincipalCV,
  stringAsciiCV,
  stringUtf8CV,
  tupleCV,
  uintCV,
} from './clarity';

export { prettyPrint, stringify } from './clarity/prettyPrint';

export { parse } from './clarity/parser';

// todo: https://github.com/stx-labs/clarinet/issues/786

// Primitives //////////////////////////////////////////////////////////////////
/**
 * `Cl.bool` — Creates a Clarity boolean type, represented as a JS object
 *
 * Alias for {@link boolCV}
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.bool(true);
 * ```
 * @see {@link serialize}, {@link deserialize}
 */
export const bool = boolCV;
/**
 * `Cl.int` — Creates a Clarity `int` type, represented as a JS object
 *
 * Alias for {@link intCV}
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.int(-100);
 * ```
 * @see {@link serialize}, {@link deserialize}
 */
export const int = intCV;
/**
 * `Cl.uInt` — Creates a Clarity `uint` type, represented as a JS object
 *
 * Alias for {@link uintCV}
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.uint(100);
 * ```
 * @see {@link serialize}, {@link deserialize}
 */
export const uint = uintCV;

/**
 * `Cl.principal` — Creates a Clarity principal type, represented as a JS object
 * @param address - A Stacks address (optionally with a contract name in the string)
 *
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.principal('ST000000000000000000002AMW42H');
 * Cl.principal('ST000000000000000000002AMW42H.asset');
 * ```
 * @see {@link serialize}, {@link deserialize}
 */
export function principal(address: string) {
  const [addr, name] = address.split('.');
  return name ? contractPrincipalCV(addr, name) : standardPrincipalCV(addr);
}
/**
 * `Cl.address` — Creates a Clarity principal type, represented as a JS object
 * @param address - A Stacks address (optionally with a contract name in the string)
 *
 * Alias for {@link principal | `Cl.principal`}
 *
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.address('ST000000000000000000002AMW42H');
 * Cl.address('ST000000000000000000002AMW42H.asset');
 * ```
 * @see {@link serialize}, {@link deserialize}
 */
export const address = principal;
/**
 * `Cl.contractPrincipal` — Creates a Clarity contract `principal` type, represented as a JS object
 *
 * Alias for {@link contractPrincipalCV}
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.contractPrincipal('ST000000000000000000002AMW42H', 'asset');
 * ```
 * @see {@link serialize}, {@link deserialize}
 */
export const contractPrincipal = contractPrincipalCV;
/**
 * `Cl.standardPrincipal` — Creates a Clarity standard `principal` type, represented as a JS object
 *
 * Alias for {@link standardPrincipalCV}
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.standardPrincipal('STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6');
 * ```
 * @see {@link serialize}, {@link deserialize}
 */
export const standardPrincipal = standardPrincipalCV;

// Sequences ///////////////////////////////////////////////////////////////////
/**
 * `Cl.list` — Creates a Clarity `list` type, represented as a JS object
 *
 * Alias for {@link listCV}
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.list([Cl.int(100), Cl.int(200)]);
 * ```
 * @see {@link serialize}, {@link deserialize}
 */
export const list = listCV;
/**
 * `Cl.stringAscii` — Creates a Clarity `string-ascii` type, represented as a JS object
 *
 * Alias for {@link stringAsciiCV}
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.stringAscii('hello world');
 * ```
 * @see {@link serialize}, {@link deserialize}
 */
export const stringAscii = stringAsciiCV;
/**
 * `Cl.stringUtf8` — Creates a Clarity `string-utf8` type, represented as a JS object
 *
 * Alias for {@link stringUtf8CV}
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.stringUtf8('hello world');
 * ```
 * @see {@link serialize}, {@link deserialize}
 */
export const stringUtf8 = stringUtf8CV;
/**
 * `Cl.buffer` — Creates a Clarity `buffer` type, represented as a JS object
 *
 * Alias for {@link bufferCV}
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.buffer(Uint8Array.from([0x01, 0x02, 0x03]));
 * ```
 * @see {@link serialize}, {@link deserialize}
 */
export const buffer = bufferCV;
/**
 * `Cl.bufferFromHex` — Converts bytes (from a hex string) to a Clarity `buffer` type, represented as a JS object
 * @param hex bytes encoded as a hex string
 * @returns input encoded as a {@link BufferCV}
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.bufferFromHex('a1b2c3');
 * ```
 */
export const bufferFromHex = (hex: string) => bufferCV(hexToBytes(hex));
/**
 * `Cl.bufferFromAscii` — Converts bytes (from an ASCII string) to a Clarity `buffer` type, represented as a JS object
 * @param hex bytes encoded as an ASCII string
 * @returns input encoded as a {@link BufferCV}
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.bufferFromAscii('hello world');
 * ```
 */
export const bufferFromAscii = (ascii: string) => bufferCV(asciiToBytes(ascii));
/**
 * `Cl.bufferFromUtf8` — Converts bytes (from an UTF-8 string) to a Clarity `buffer` type, represented as a JS object
 * @param hex bytes encoded as a UTF-8 string
 * @returns input encoded as a {@link BufferCV}
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.bufferFromUtf8('hello world');
 * ```
 */
export const bufferFromUtf8 = (utf8: string) => bufferCV(utf8ToBytes(utf8));

// Composites //////////////////////////////////////////////////////////////////
/**
 * `Cl.none` — Creates a Clarity optional `none` type, represented as a JS object
 *
 * Alias for {@link noneCV}
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.none();
 * ```
 * @see {@link serialize}, {@link deserialize}
 */
export const none = noneCV;
/**
 * `Cl.some` — Creates a Clarity optional `some` type, represented as a JS object
 *
 * Alias for {@link someCV}
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.some(Cl.uint(100));
 * ```
 * @see {@link serialize}, {@link deserialize}
 */
export const some = someCV;
/**
 * `Cl.ok` — Creates a Clarity response `ok` type, represented as a JS object
 *
 * Alias for {@link responseOkCV}
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.ok(Cl.uint(100));
 * ```
 * @see {@link serialize}, {@link deserialize}
 */
export const ok = responseOkCV;
/**
 * `Cl.error` — Creates a Clarity response `error` type, represented as a JS object
 *
 * Alias for {@link responseErrorCV}
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.error(Cl.uint(9900));
 * ```
 * @see {@link serialize}, {@link deserialize}
 */
export const error = responseErrorCV;
/**
 * `Cl.tuple` — Creates a Clarity `tuple` type, represented as a JS object
 *
 * Alias for {@link tupleCV}
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.tuple({
 *   a: Cl.uint(100),
 *   b: Cl.stringUtf8('hello world'),
 * })
 * ```
 * @see {@link serialize}, {@link deserialize}
 */
export const tuple = tupleCV;

// Methods /////////////////////////////////////////////////////////////////////
/**
 * `Cl.serialize` — Serializes a Clarity JS object to the equivalent hex-encoded representation
 *
 * Alias for {@link serializeCV}
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.serialize(Cl.uint(100));
 * ```
 * @see {@link deserialize}
 */
export const serialize = serializeCV;
/**
 * `Cl.deserialize` — Deserializes a hex string to the equivalent Clarity JS object
 *
 * Alias for {@link deserializeCV}
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 * Cl.deserialize("0c00000001016103");
 * ```
 * @see {@link serialize}
 */
export const deserialize = deserializeCV;

// todo: add `deserializeReadable` methods that translates enums into name strings
