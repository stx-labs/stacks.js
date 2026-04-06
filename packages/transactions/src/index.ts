export { BytesReader } from './BytesReader';
export * from './authorization';
export {
  Authorization,
  SpendingCondition,
  SponsoredAuthorization,
  StandardAuthorization,
  emptyMessageSignature,
  isSingleSig,
} from './authorization';
export * from './builders';
export * from './clarity';
export * from './constants';
export * from './contract-abi';
export * from './fetch';
export * from './keys';
export * from './postcondition';
export * from './postcondition-types';
export * from './signer';
export * from './structuredDataSignature';
export * from './transaction';
export * from './types';
export * from './utils';

export * from './address';
export * from './wire';

export * from './namespaces';

/**
 * ### `Cl.` Clarity Value Namespace
 * The `Cl` namespace is provided as a convenience to build/parse Clarity Value objects.
 *
 * @example
 * ```
 * import { Cl } from '@stacks/transactions';
 *
 * Cl.bool(true);
 * Cl.uint(100);
 * Cl.int(-100);
 *
 * Cl.standardPrincipal('STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6');
 * Cl.contractPrincipal('ST000000000000000000002AMW42H', 'asset');
 *
 * Cl.list([Cl.int(100), Cl.int(200)]);
 *
 * Cl.stringAscii('hello world');
 * Cl.stringUtf8('hello world');
 *
 * Cl.buffer(Uint8Array.from([0x01, 0x02, 0x03]));
 * Cl.bufferFromAscii('hello world');
 * Cl.bufferFromHex('a1b2c3');
 * Cl.bufferFromUtf8('hello world');
 *
 * Cl.none();
 * Cl.some(Cl.uint(100));
 *
 * Cl.ok(Cl.uint(100));
 * Cl.error(Cl.uint(9900));
 *
 * Cl.tuple({
 *   a: Cl.uint(100),
 *   b: Cl.stringUtf8('hello world'),
 * })
 *
 * Cl.serialize(Cl.uint(100));
 * Cl.deserialize("0c00000001016103");
 *
 * Cl.prettyPrint(Cl.tuple({ id: Cl.some(Cl.uint(1)) }));
 * ```
 */
export * as Cl from './cl';

/**
 * ### `Pc.` Post Condition Builder
 * @beta Interface may be subject to change in future releases.
 *
 * The Pc namespace is provided as a convenience to build post conditions.
 * The pattern chains methods together to build a post condition.
 * `PRINCIPAL -> [AMOUNT] -> CODE -> ASSET`
 *
 * The builder starts with the {@link Pc.principal} method.
 *
 * @example
 * ```
 * import { Pc } from '@stacks/transactions';
 * Pc.principal('STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6').willSendEq(10000).ustx();
 * ```
 */
export * as Pc from './pc';
