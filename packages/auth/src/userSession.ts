/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
// todo: fix eslint rule, rename UserSession?
import { AppConfig } from './appConfig';
import { SessionOptions } from './sessionData';
import { InstanceDataStore, LocalStorageStore, SessionDataStore } from './sessionStore';
import { decodeToken } from 'jsontokens';
import { verifyAuthResponse } from './verification';
import * as authMessages from './messages';
import { utils } from '@noble/secp256k1';
import { decryptContent, encryptContent, EncryptContentOptions } from '@stacks/encryption';
import { getAddressFromDID } from './dids';
import {
  createFetchFn,
  FetchFn,
  GAIA_URL,
  getGlobalObject,
  HIRO_MAINNET_URL,
  InvalidStateError,
  isLaterVersion,
  Logger,
  LoginFailedError,
  MissingParameterError,
  nextHour,
} from '@stacks/common';
import { extractProfile } from '@stacks/profile';
import { AuthScope, DEFAULT_PROFILE } from './constants';

import { UserData } from './userData';
import { protocolEchoReplyDetection } from './protocolEchoDetection';

/**
 *
 * Represents an instance of a signed in user for a particular app.
 *
 * A signed in user has access to two major pieces of information
 * about the user, the user's private key for that app and the location
 * of the user's gaia storage bucket for the app.
 *
 * A user can be signed in either directly through the interactive
 * sign in process or by directly providing the app private key.
 *

 *
 */
export class UserSession {
  appConfig: AppConfig;

  store: SessionDataStore;

  /**
   * Creates a UserSession object
   *
   * @param options
   */
  constructor(options?: {
    appConfig?: AppConfig;
    sessionStore?: SessionDataStore;
    sessionOptions?: SessionOptions;
  }) {
    let runningInBrowser = true;

    if (typeof window === 'undefined' && typeof self === 'undefined') {
      // Logger.debug('UserSession: not running in browser')
      runningInBrowser = false;
    }

    if (options && options.appConfig) {
      this.appConfig = options.appConfig;
    } else if (runningInBrowser) {
      this.appConfig = new AppConfig();
    } else {
      throw new MissingParameterError('You need to specify options.appConfig');
    }

    if (options && options.sessionStore) {
      this.store = options.sessionStore;
    } else if (runningInBrowser) {
      if (options) {
        this.store = new LocalStorageStore(options.sessionOptions);
      } else {
        this.store = new LocalStorageStore();
      }
    } else if (options) {
      this.store = new InstanceDataStore(options.sessionOptions);
    } else {
      this.store = new InstanceDataStore();
    }
  }

  /**
   * Generates an authentication request that can be sent to the Blockstack
   * browser for the user to approve sign in. This authentication request can
   * then be used for sign in by passing it to the [[redirectToSignInWithAuthRequest]]
   * method.
   *
   * *Note*: This method should only be used if you want to use a customized authentication
   * flow. Typically, you'd use [[redirectToSignIn]] which is the default sign in method.
   *
   * @param transitKey A HEX encoded transit private key.
   * @param redirectURI Location to redirect the user to after sign in approval.
   * @param manifestURI Location of this app's manifest file.
   * @param scopes The permissions this app is requesting. The default is `store_write`.
   * @param appDomain The origin of the app.
   * @param expiresAt The time at which this request is no longer valid.
   * @param extraParams Any extra parameters to pass to the authenticator. Use this to
   * pass options that aren't part of the Blockstack authentication specification,
   * but might be supported by special authenticators.
   *
   * @returns {String} the authentication request token
   */
  makeAuthRequestToken(
    transitKey?: string,
    redirectURI?: string,
    manifestURI?: string,
    scopes?: (AuthScope | string)[],
    appDomain?: string,
    expiresAt: number = nextHour().getTime(),
    extraParams: any = {}
  ): string {
    const appConfig = this.appConfig;
    if (!appConfig) {
      throw new InvalidStateError('Missing AppConfig');
    }
    transitKey = transitKey || this.generateAndStoreTransitKey();
    redirectURI = redirectURI || appConfig.redirectURI();
    manifestURI = manifestURI || appConfig.manifestURI();
    scopes = scopes || appConfig.scopes;
    appDomain = appDomain || appConfig.appDomain;
    return authMessages.makeAuthRequestToken(
      transitKey,
      redirectURI,
      manifestURI,
      scopes,
      appDomain,
      expiresAt,
      extraParams
    );
  }

  /**
   * Generates a ECDSA keypair to
   * use as the ephemeral app transit private key
   * and store in the session.
   *
   * @returns {String} the hex encoded private key
   *
   */
  generateAndStoreTransitKey(): string {
    const sessionData = this.store.getSessionData();
    const transitKey = authMessages.generateTransitKey();
    sessionData.transitKey = transitKey;
    this.store.setSessionData(sessionData);
    return transitKey;
  }

  /**
   * Retrieve the authentication token from the URL query
   * @return {String} the authentication token if it exists otherwise `null`
   */
  getAuthResponseToken(): string {
    const search = getGlobalObject('location', {
      throwIfUnavailable: true,
      usageDesc: 'getAuthResponseToken',
    })?.search;

    const params = new URLSearchParams(search);
    return params.get('authResponse') ?? '';
  }

  /**
   * Check if there is a authentication request that hasn't been handled.
   *
   * Also checks for a protocol echo reply (which if detected then the page
   * will be automatically redirected after this call).
   *
   * @return {Boolean} `true` if there is a pending sign in, otherwise `false`
   */
  isSignInPending() {
    try {
      const isProtocolEcho = protocolEchoReplyDetection();
      if (isProtocolEcho) {
        Logger.info(
          'protocolEchoReply detected from isSignInPending call, the page is about to redirect.'
        );
        return true;
      }
    } catch (error) {
      Logger.error(`Error checking for protocol echo reply isSignInPending: ${error}`);
    }

    return !!this.getAuthResponseToken();
  }

  /**
   * Check if a user is currently signed in.
   *
   * @returns {Boolean} `true` if the user is signed in, `false` if not.
   */
  isUserSignedIn() {
    return !!this.store.getSessionData().userData;
  }

  /**
   * Try to process any pending sign in request by returning a `Promise` that resolves
   * to the user data object if the sign in succeeds.
   *
   * @param {String} authResponseToken - the signed authentication response token
   * @returns {Promise} that resolves to the user data object if successful and rejects
   * if handling the sign in request fails or there was no pending sign in request.
   */
  async handlePendingSignIn(
    authResponseToken: string = this.getAuthResponseToken(),
    fetchFn: FetchFn = createFetchFn()
  ): Promise<UserData> {
    const sessionData = this.store.getSessionData();

    if (sessionData.userData) {
      throw new LoginFailedError('Existing user session found.');
    }

    const transitKey = this.store.getSessionData().transitKey;

    // let nameLookupURL;
    let coreNode = this.appConfig && this.appConfig.coreNode;
    if (!coreNode) {
      coreNode = HIRO_MAINNET_URL;
    }

    const tokenPayload = decodeToken(authResponseToken).payload;

    if (typeof tokenPayload === 'string') {
      throw new Error('Unexpected token payload type of string');
    }

    const isValid = await verifyAuthResponse(authResponseToken);
    if (!isValid) {
      throw new LoginFailedError('Invalid authentication response.');
    }

    // TODO: real version handling
    let appPrivateKey: string = tokenPayload.private_key as string;
    let coreSessionToken: string = tokenPayload.core_token as string;
    if (isLaterVersion(tokenPayload.version as string, '1.1.0')) {
      if (transitKey !== undefined && transitKey != null) {
        if (tokenPayload.private_key !== undefined && tokenPayload.private_key !== null) {
          try {
            appPrivateKey = (await authMessages.decryptPrivateKey(
              transitKey,
              tokenPayload.private_key as string
            )) as string;
          } catch (e) {
            Logger.warn('Failed decryption of appPrivateKey, will try to use as given');
            if (!utils.isValidPrivateKey(tokenPayload.private_key as string)) {
              throw new LoginFailedError(
                'Failed decrypting appPrivateKey. Usually means' +
                  ' that the transit key has changed during login.'
              );
            }
          }
        }
        if (coreSessionToken !== undefined && coreSessionToken !== null) {
          try {
            coreSessionToken = (await authMessages.decryptPrivateKey(
              transitKey,
              coreSessionToken
            )) as string;
          } catch (e) {
            Logger.info('Failed decryption of coreSessionToken, will try to use as given');
          }
        }
      } else {
        throw new LoginFailedError(
          'Authenticating with protocol > 1.1.0 requires transit' + ' key, and none found.'
        );
      }
    }
    let hubUrl = GAIA_URL;
    let gaiaAssociationToken: string;
    if (
      isLaterVersion(tokenPayload.version as string, '1.2.0') &&
      tokenPayload.hubUrl !== null &&
      tokenPayload.hubUrl !== undefined
    ) {
      hubUrl = tokenPayload.hubUrl as string;
    }
    if (
      isLaterVersion(tokenPayload.version as string, '1.3.0') &&
      tokenPayload.associationToken !== null &&
      tokenPayload.associationToken !== undefined
    ) {
      gaiaAssociationToken = tokenPayload.associationToken as string;
    }

    const userData: UserData = {
      profile: tokenPayload.profile,
      email: tokenPayload.email as string,
      decentralizedID: tokenPayload.iss,
      identityAddress: getAddressFromDID(tokenPayload.iss),
      appPrivateKey,
      coreSessionToken,
      authResponseToken,
      hubUrl,
      appPrivateKeyFromWalletSalt: tokenPayload.appPrivateKeyFromWalletSalt as string,
      coreNode: tokenPayload.blockstackAPIUrl as string,
      // @ts-expect-error
      gaiaAssociationToken,
    };
    const profileURL = tokenPayload.profile_url as string;
    if (!userData.profile && profileURL) {
      const response = await fetchFn(profileURL);
      if (!response.ok) {
        // return blank profile if we fail to fetch
        userData.profile = Object.assign({}, DEFAULT_PROFILE);
      } else {
        const responseText = await response.text();
        const wrappedProfile = JSON.parse(responseText);
        userData.profile = extractProfile(wrappedProfile[0].token);
      }
    } else {
      userData.profile = tokenPayload.profile;
    }

    sessionData.userData = userData;
    this.store.setSessionData(sessionData);

    return userData;
  }

  /**
   * Retrieves the user data object. The user's profile is stored in the key [[Profile]].
   *
   * @returns {Object} User data object.
   */
  loadUserData() {
    const userData = this.store.getSessionData().userData;
    if (!userData) {
      throw new InvalidStateError('No user data found. Did the user sign in?');
    }
    return userData;
  }

  /**
   * Encrypts the data provided with the app public key.
   * @param {string | Uint8Array} content  the data to encrypt
   * @param options
   * @param {string} options.publicKey the hex string of the ECDSA public
   * key to use for encryption. If not provided, will use user's appPrivateKey.
   *
   * @returns {string} Stringified ciphertext object
   */
  encryptContent(content: string | Uint8Array, options?: EncryptContentOptions): Promise<string> {
    const opts = Object.assign({}, options);
    if (!opts.privateKey) {
      opts.privateKey = this.loadUserData().appPrivateKey;
    }
    return encryptContent(content, opts);
  }

  /**
   * Decrypts data encrypted with `encryptContent` with the
   * transit private key.
   * @param {string | Uint8Array} content - encrypted content.
   * @param options
   * @param {string} options.privateKey - The hex string of the ECDSA private
   * key to use for decryption. If not provided, will use user's appPrivateKey.
   * @returns {string | Uint8Array} decrypted content.
   */
  decryptContent(content: string, options?: { privateKey?: string }): Promise<Uint8Array | string> {
    const opts = Object.assign({}, options);
    if (!opts.privateKey) {
      opts.privateKey = this.loadUserData().appPrivateKey;
    }
    return decryptContent(content, opts);
  }

  /**
   * Sign the user out and optionally redirect to given location.
   * @param  redirectURL
   * Location to redirect user to after sign out.
   * Only used in environments with `window` available
   */

  signUserOut(
    redirectURL?: string
    // TODO: this is not used?
    // caller?: UserSession
  ) {
    this.store.deleteSessionData();
    if (redirectURL) {
      if (typeof location !== 'undefined' && location.href) {
        location.href = redirectURL;
      }
      // TODO: Invalid left-hand side in assignment expression
      // // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
      // // @ts-ignore
      // getGlobalObject('location', {
      //   throwIfUnavailable: true,
      //   usageDesc: 'signUserOut',
      // })?.href = redirectURL;
    }
  }
}

// Add method aliases for backwards compatibility
export interface UserSession {
  /** @deprecated {@link makeAuthRequest} was renamed to {@link makeAuthRequestToken} */
  makeAuthRequest(
    ...args: Parameters<typeof UserSession.prototype.makeAuthRequestToken>
  ): ReturnType<typeof UserSession.prototype.makeAuthRequestToken>;
}

UserSession.prototype.makeAuthRequest = UserSession.prototype.makeAuthRequestToken;
