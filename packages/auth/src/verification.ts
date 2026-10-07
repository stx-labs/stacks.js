import { isSameOriginAbsoluteUrl } from '@stacks/common';
import { publicKeyToBtcAddress } from '@stacks/encryption';
import { decodeToken, TokenVerifier } from 'jsontokens';
import { getAddressFromDID } from './dids';
import { fetchAppManifest } from './provider';

/**
 * Checks if the ES256k signature on passed `token` match the claimed public key
 * in the payload key `public_keys`.
 *
 * @param  {String} token encoded and signed authentication token
 * @return {Boolean} Returns `true` if the signature matches the claimed public key
 * @throws {Error} if `token` contains multiple public keys
 * @private
 * @ignore
 */
export function doSignaturesMatchPublicKeys(token: string): boolean {
  const payload = decodeToken(token).payload;
  if (typeof payload === 'string') {
    throw new Error('Unexpected token payload type of string');
  }
  const publicKeys = payload.public_keys as string[];
  if (publicKeys.length === 1) {
    const publicKey = publicKeys[0];
    try {
      const tokenVerifier = new TokenVerifier('ES256k', publicKey);
      return tokenVerifier.verify(token);
    } catch (e) {
      return false;
    }
  } else {
    throw new Error('Multiple public keys are not supported');
  }
}

/**
 * Makes sure that the identity address portion of
 * the decentralized identifier passed in the issuer `iss`
 * key of the token matches the public key
 *
 * @param  {String} token encoded and signed authentication token
 * @return {Boolean} if the identity address and public keys match
 * @throws {Error} if ` token` has multiple public keys
 * @private
 * @ignore
 */
export function doPublicKeysMatchIssuer(token: string): boolean {
  const payload = decodeToken(token).payload;
  if (typeof payload === 'string') {
    throw new Error('Unexpected token payload type of string');
  }
  const publicKeys = payload.public_keys as string[];
  const addressFromIssuer = getAddressFromDID(payload.iss);

  if (publicKeys.length === 1) {
    const addressFromPublicKeys = publicKeyToBtcAddress(publicKeys[0]);
    if (addressFromPublicKeys === addressFromIssuer) {
      return true;
    }
  } else {
    throw new Error('Multiple public keys are not supported');
  }

  return false;
}

/**
 * Checks if the if the token issuance time and date is after the
 * current time and date.
 *
 * @param  {String}  token encoded and signed authentication token
 * @return {Boolean} `true` if the token was issued after the current time,
 * otherwise returns `false`
 * @private
 * @ignore
 */
export function isIssuanceDateValid(token: string) {
  const payload = decodeToken(token).payload;
  if (typeof payload === 'string') {
    throw new Error('Unexpected token payload type of string');
  }
  if (payload.iat) {
    if (typeof payload.iat !== 'number') {
      return false;
    }
    const issuedAt = new Date(payload.iat * 1000); // JWT times are in seconds
    if (new Date().getTime() < issuedAt.getTime()) {
      return false;
    } else {
      return true;
    }
  } else {
    return true;
  }
}

/**
 * Checks if the expiration date of the `token` is before the current time
 * @param  {String}  token encoded and signed authentication token
 * @return {Boolean} `true` if the `token` has not yet expired, `false`
 * if the `token` has expired
 *
 * @private
 * @ignore
 */
export function isExpirationDateValid(token: string) {
  const payload = decodeToken(token).payload;
  if (typeof payload === 'string') {
    throw new Error('Unexpected token payload type of string');
  }
  if (payload.exp) {
    if (typeof payload.exp !== 'number') {
      return false;
    }
    const expiresAt = new Date(payload.exp * 1000); // JWT times are in seconds
    if (new Date().getTime() > expiresAt.getTime()) {
      return false;
    } else {
      return true;
    }
  } else {
    return true;
  }
}

/**
 * Makes sure the `manifest_uri` is a same origin absolute URL.
 * @param  {String}  token encoded and signed authentication token
 * @return {Boolean} `true` if valid, otherwise `false`
 * @private
 * @ignore
 */
export function isManifestUriValid(token: string) {
  const payload = decodeToken(token).payload;
  if (typeof payload === 'string') {
    throw new Error('Unexpected token payload type of string');
  }
  return isSameOriginAbsoluteUrl(payload.domain_name as string, payload.manifest_uri as string);
}

/**
 * Makes sure the `redirect_uri` is a same origin absolute URL.
 * @param  {String}  token encoded and signed authentication token
 * @return {Boolean} `true` if valid, otherwise `false`
 * @private
 * @ignore
 */
export function isRedirectUriValid(token: string) {
  const payload = decodeToken(token).payload;
  if (typeof payload === 'string') {
    throw new Error('Unexpected token payload type of string');
  }
  return isSameOriginAbsoluteUrl(payload.domain_name as string, payload.redirect_uri as string);
}

/**
 * Verify authentication request is valid. This function performs a number
 * of checks on the authentication request token:
 * * Checks that `token` has a valid issuance date & is not expired
 * * Checks that `token` has a valid signature that matches the public key it claims
 * * Checks that both the manifest and redirect URLs are absolute and conform to
 * the same origin policy
 *
 * @param  {String} token encoded and signed authentication request token
 * @return {Promise} that resolves to true if the auth request
 *  is valid and false if it does not. It rejects with a String if the
 *  token is not signed
 * @private
 * @ignore
 */
export function verifyAuthRequest(token: string): Promise<boolean> {
  if (decodeToken(token).header.alg === 'none') {
    throw new Error('Token must be signed in order to be verified');
  }
  const values = [
    isExpirationDateValid(token),
    isIssuanceDateValid(token),
    doSignaturesMatchPublicKeys(token),
    doPublicKeysMatchIssuer(token),
    isManifestUriValid(token),
    isRedirectUriValid(token),
  ];
  return Promise.resolve(values.every(val => val));
}

/**
 * Verify the authentication request is valid and
 * fetch the app manifest file if valid. Otherwise, reject the promise.
 * @param  {String} token encoded and signed authentication request token
 * @return {Promise} that resolves to the app manifest file in JSON format
 * or rejects if the auth request or app manifest file is invalid
 * @private
 * @ignore
 */
export async function verifyAuthRequestAndLoadManifest(token: string): Promise<any> {
  const valid = await verifyAuthRequest(token);
  if (!valid) {
    throw new Error('Token is an invalid auth request');
  }
  return fetchAppManifest(token);
}

/**
 * Verify the authentication response is valid.
 * @param {String} token the authentication response token
 * @return {Promise} that resolves to true if auth response
 * is valid and false if it does not
 * @private
 * @ignore
 */
export function verifyAuthResponse(token: string): Promise<boolean> {
  const conditions = [
    isExpirationDateValid(token),
    isIssuanceDateValid(token),
    doSignaturesMatchPublicKeys(token),
    doPublicKeysMatchIssuer(token),
  ];
  return Promise.resolve(conditions.every(val => val));
}
