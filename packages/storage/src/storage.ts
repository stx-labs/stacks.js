import { lookupProfile, NAME_LOOKUP_PATH, UserSession } from '@stacks/auth';
import {
  DoesNotExist,
  GAIA_URL,
  GaiaHubError,
  getGlobalObject,
  InvalidStateError,
  megabytesToBytes,
  PayloadTooLargeError,
  SignatureVerificationError,
  utf8ToBytes,
} from '@stacks/common';
import {
  eciesGetJsonStringLength,
  EncryptionOptions,
  getPublicKeyFromPrivate,
  publicKeyToBtcAddress,
  signECDSA,
  verifyECDSA,
} from '@stacks/encryption';
import { createFetchFn, FetchFn } from '@stacks/common';
import { FileContentLoader } from './fileContentLoader';
import {
  connectToGaiaHub,
  deleteFromGaiaHub,
  GaiaHubConfig,
  getBlockstackErrorFromResponse,
  getBucketUrl,
  getFullReadUrl,
  uploadToGaiaHub,
} from './hub';

/**
 * Specify a valid MIME type, encryption options, and whether to sign the [[UserSession.putFile]].
 */
export interface PutFileOptions extends EncryptionOptions {
  /**
   * Specifies the Content-Type header for unencrypted data.
   * If the `encrypt` is enabled, this option is ignored, and the
   * Content-Type header is set to `application/json` for the ciphertext
   * JSON envelope.
   */
  contentType?: string;
  /**
   * Encrypt the data with the app public key.
   * If a string is specified, it is used as the public key.
   * If the boolean `true` is specified then the current user's app public key is used.
   * @default true
   */
  encrypt?: boolean | string;
  /**
   * Ignore etag for concurrency control and force file to be written.
   */
  dangerouslyIgnoreEtag?: boolean;
}

const SIGNATURE_FILE_SUFFIX = '.sig';

/**
 * Used to pass options to [[UserSession.getFile]]
 */
export interface GetFileOptions extends GetFileUrlOptions {
  /**
   * Try to decrypt the data with the app private key.
   * If a string is specified, it is used as the private key.
   * @default true
   */
  decrypt?: boolean | string;
  /**
   * Whether the content should be verified, only to be used
   * when [[UserSession.putFile]] was set to `sign = true`.
   * @default false
   */
  verify?: boolean;
}

export interface GetFileUrlOptions {
  /**
   * The Blockstack ID to lookup for multi-player storage.
   * If not specified, the currently signed in username is used.
   */
  username?: string;
  /**
   * The app to lookup for multi-player storage - defaults to current origin.
   * @default `window.location.origin`
   * Only if available in the executing environment, otherwise `undefined`.
   */
  app?: string;
  /**
   * The URL to use for zonefile lookup. If falsey, this will use
   * the blockstack.js's [[getNameInfo]] function instead.
   */
  zoneFileLookupURL?: string;
}

/**
 * Options for constructing a Storage instance
 */
export interface StorageOptions {
  /**
   * The userSession object to construct the Storage instance with.
   * The session object contains the credentials and keys for
   * Gaia hub access and encryption.
   */
  userSession?: UserSession;
}

export class Storage {
  userSession: UserSession;

  constructor(options: StorageOptions) {
    this.userSession = options.userSession!;
  }

  /**
   * Retrieves the specified file from the app's data store.
   *
   * @param {String} path - the path to the file to read
   * @param {Object} options a [[GetFileOptions]] object
   *
   * @returns {Promise} that resolves to the raw data in the file
   * or rejects with an error
   */
  async getFile(path: string, options?: GetFileOptions) {
    const defaults: GetFileOptions = {
      decrypt: true,
      verify: false,
      app: getGlobalObject('location', { returnEmptyObject: true })!.origin,
    };
    const opt = Object.assign({}, defaults, options);

    // in the case of signature verification, but no
    //  encryption expected, need to fetch _two_ files.
    if (opt.verify && !opt.decrypt) {
      return this.getFileSignedUnencrypted(path, opt);
    }

    const storedContents = await this.getFileContents(
      path,
      opt.app!,
      opt.username,
      opt.zoneFileLookupURL,
      !!opt.decrypt
    );
    if (storedContents === null) {
      return storedContents;
    } else if (opt.decrypt && !opt.verify) {
      if (typeof storedContents !== 'string') {
        throw new Error('Expected to get back a string for the cipherText');
      }
      if (typeof opt.decrypt === 'string') {
        const decryptOpt = { privateKey: opt.decrypt };
        return this.userSession.decryptContent(storedContents, decryptOpt);
      } else {
        return this.userSession.decryptContent(storedContents);
      }
    } else if (opt.decrypt && opt.verify) {
      if (typeof storedContents !== 'string') {
        throw new Error('Expected to get back a string for the cipherText');
      }
      let decryptionKey;
      if (typeof opt.decrypt === 'string') {
        decryptionKey = opt.decrypt;
      }
      return this.handleSignedEncryptedContents(
        path,
        storedContents,
        opt.app!,
        decryptionKey,
        opt.username,
        opt.zoneFileLookupURL
      );
    } else if (!opt.verify && !opt.decrypt) {
      return storedContents;
    } else {
      throw new Error('Should be unreachable.');
    }
  }

  /**
   * Fetch the public read URL of a user file for the specified app.
   * @param {String} path - the path to the file to read
   * @param {String} username - The Blockstack ID of the user to look up
   * @param {String} appOrigin - The app origin
   * @param {String} [zoneFileLookupURL=null] - The URL
   * to use for zonefile lookup. If falsey, this will use the
   * blockstack.js's [[getNameInfo]] function instead.
   * @return {Promise<string>} that resolves to the public read URL of the file
   * or rejects with an error
   */
  async getUserAppFileUrl(
    path: string,
    username: string,
    appOrigin: string,
    zoneFileLookupURL?: string
  ): Promise<string | undefined> {
    const profile = await lookupProfile({ username, zoneFileLookupURL });
    let bucketUrl: string | undefined;
    if (profile.hasOwnProperty('apps')) {
      const apps = profile.apps as Record<string, string>;
      if (apps.hasOwnProperty(appOrigin)) {
        const url = apps[appOrigin];
        const bucket = url.replace(/\/?(\?|#|$)/, '/$1');
        bucketUrl = `${bucket}${path}`;
      }
    }
    return bucketUrl;
  }

  /* Get the gaia address used for servicing multiplayer reads for the given
   * (username, app) pair.
   * @private
   * @ignore
   */
  async getGaiaAddress(
    app: string,
    username?: string,
    zoneFileLookupURL?: string
  ): Promise<string> {
    const opts = normalizeOptions(this.userSession, { app, username, zoneFileLookupURL });
    let fileUrl: string | undefined;
    if (username) {
      fileUrl = await this.getUserAppFileUrl('/', opts.username!, opts.app, opts.zoneFileLookupURL);
    } else {
      const gaiaHubConfig = await this.getOrSetLocalGaiaHubConnection();
      fileUrl = await getFullReadUrl('/', gaiaHubConfig);
    }
    const matches = fileUrl!.match(/([13][a-km-zA-HJ-NP-Z0-9]{26,35})/);
    if (!matches) {
      throw new Error('Failed to parse gaia address');
    }
    return matches[matches.length - 1];
  }

  /**
   * Get the URL for reading a file from an app's data store.
   *
   * @param {String} path - the path to the file to read
   *
   * @returns {Promise<string>} that resolves to the URL or rejects with an error
   */
  async getFileUrl(path: string, options?: GetFileUrlOptions): Promise<string> {
    const opts = normalizeOptions(this.userSession, options);

    let readUrl: string | undefined;
    if (opts.username) {
      readUrl = await this.getUserAppFileUrl(
        path,
        opts.username,
        opts.app!,
        opts.zoneFileLookupURL
      );
    } else {
      const gaiaHubConfig = await this.getOrSetLocalGaiaHubConnection();
      readUrl = await getFullReadUrl(path, gaiaHubConfig);
    }

    if (!readUrl) {
      throw new Error('Missing readURL');
    } else {
      return readUrl;
    }
  }

  /* Handle fetching the contents from a given path. Handles both
   *  multi-player reads and reads from own storage.
   * @private
   * @ignore
   */
  async getFileContents(
    path: string,
    app: string,
    username: string | undefined,
    zoneFileLookupURL: string | undefined,
    forceText: boolean,
    fetchFn: FetchFn = createFetchFn()
  ): Promise<string | ArrayBuffer | null> {
    const opts = { app, username, zoneFileLookupURL };
    const readUrl = await this.getFileUrl(path, opts);
    const response = await fetchFn(readUrl);
    if (!response.ok) {
      throw await getBlockstackErrorFromResponse(response, `getFile ${path} failed.`, null);
    }
    let contentType = response.headers.get('Content-Type');
    if (typeof contentType === 'string') {
      contentType = contentType.toLowerCase();
    }

    const etag = response.headers.get('ETag');
    if (etag) {
      const sessionData = this.userSession.store.getSessionData();
      sessionData.etags![path] = etag;
      this.userSession.store.setSessionData(sessionData);
    }
    if (
      forceText ||
      contentType === null ||
      contentType.startsWith('text') ||
      contentType.startsWith('application/json')
    ) {
      return response.text();
    } else {
      return response.arrayBuffer();
    }
  }

  /* Handle fetching an unencrypted file, its associated signature
   *  and then validate it. Handles both multi-player reads and reads
   *  from own storage.
   * @private
   * @ignore
   */
  async getFileSignedUnencrypted(path: string, opt: GetFileOptions) {
    // future optimization note:
    //    in the case of _multi-player_ reads, this does a lot of excess
    //    profile lookups to figure out where to read files
    //    do browsers cache all these requests if Content-Cache is set?
    const sigPath = `${path}${SIGNATURE_FILE_SUFFIX}`;
    try {
      const [fileContents, signatureContents, gaiaAddress] = await Promise.all([
        this.getFileContents(path, opt.app!, opt.username, opt.zoneFileLookupURL, false),
        this.getFileContents(sigPath, opt.app!, opt.username, opt.zoneFileLookupURL, true),
        this.getGaiaAddress(opt.app!, opt.username, opt.zoneFileLookupURL),
      ]);

      if (!fileContents) return fileContents;

      if (!gaiaAddress)
        throw new SignatureVerificationError(
          `Failed to get gaia address for verification of: ${path}`
        );

      if (!signatureContents || typeof signatureContents !== 'string')
        throw new SignatureVerificationError(
          'Failed to obtain signature for file: ' +
            `${path} -- looked in ${path}${SIGNATURE_FILE_SUFFIX}`
        );

      let signature;
      let publicKey;
      try {
        const sigObject = JSON.parse(signatureContents);
        signature = sigObject.signature;
        publicKey = sigObject.publicKey;
      } catch (err) {
        if (err instanceof SyntaxError)
          throw new Error(
            `Failed to parse signature content JSON (path: ${path}${SIGNATURE_FILE_SUFFIX}) The content may be corrupted.`
          );
        throw err;
      }
      const signerAddress = publicKeyToBtcAddress(publicKey);
      if (gaiaAddress !== signerAddress)
        throw new SignatureVerificationError(
          `Signer pubkey address (${signerAddress}) doesn't match gaia address (${gaiaAddress})`
        );

      if (
        !verifyECDSA(
          typeof fileContents === 'string'
            ? utf8ToBytes(fileContents)
            : new Uint8Array(fileContents),
          publicKey,
          signature
        )
      ) {
        throw new SignatureVerificationError(
          `Contents do not match ECDSA signature: path: ${path}, signature: ${path}${SIGNATURE_FILE_SUFFIX}`
        );
      }
      return fileContents;
    } catch (err) {
      // For missing .sig files, throw `SignatureVerificationError` instead of `DoesNotExist` error.
      if (err instanceof DoesNotExist && err.message.indexOf(sigPath) >= 0)
        throw new SignatureVerificationError(
          `Failed to obtain signature for file: ${path} -- looked in ${path}${SIGNATURE_FILE_SUFFIX}`
        );
      throw err;
    }
  }

  /* Handle signature verification and decryption for contents which are
   *  expected to be signed and encrypted. This works for single and
   *  multiplayer reads. In the case of multiplayer reads, it uses the
   *  gaia address for verification of the claimed public key.
   * @private
   * @ignore
   */
  async handleSignedEncryptedContents(
    path: string,
    storedContents: string,
    app: string,
    privateKey?: string,
    username?: string,
    zoneFileLookupURL?: string
  ): Promise<string | Uint8Array> {
    const appPrivateKey = privateKey || this.userSession.loadUserData().appPrivateKey;

    const appPublicKey = getPublicKeyFromPrivate(appPrivateKey);

    const address: string = username
      ? await this.getGaiaAddress(app, username, zoneFileLookupURL)
      : publicKeyToBtcAddress(appPublicKey);
    if (!address) {
      throw new SignatureVerificationError(
        `Failed to get gaia address for verification of: ${path}`
      );
    }
    let sigObject;
    try {
      sigObject = JSON.parse(storedContents);
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(
          'Failed to parse encrypted, signed content JSON. The content may not be encrypted. If using getFile, try passing { verify: false, decrypt: false }.'
        );
      } else {
        throw err;
      }
    }
    const signature = sigObject.signature;
    const signerPublicKey = sigObject.publicKey;
    const cipherText = sigObject.cipherText;
    const signerAddress = publicKeyToBtcAddress(signerPublicKey);

    if (!signerPublicKey || !cipherText || !signature) {
      throw new SignatureVerificationError(
        `Failed to get signature verification data from file: ${path}`
      );
    } else if (signerAddress !== address) {
      throw new SignatureVerificationError(
        `Signer pubkey address (${signerAddress}) doesn't match gaia address (${address})`
      );
    } else if (!verifyECDSA(cipherText, signerPublicKey, signature)) {
      throw new SignatureVerificationError(
        `Contents do not match ECDSA signature in file: ${path}`
      );
    } else if (typeof privateKey === 'string') {
      const decryptOpt = { privateKey };
      return this.userSession.decryptContent(cipherText, decryptOpt);
    } else {
      return this.userSession.decryptContent(cipherText);
    }
  }

  /**
   * Stores the data provided in the app's data store to the file specified.
   * @param {String} path - the path to store the data in
   * @param {String|Uint8Array} content - the data to store in the file
   * @param options a [[PutFileOptions]] object
   *
   * @returns {Promise} that resolves if the operation succeed and rejects
   * if it failed
   */
  async putFile(
    path: string,
    content: string | Uint8Array | ArrayBufferView | Blob,
    options?: PutFileOptions
  ): Promise<string> {
    const defaults: PutFileOptions = {
      encrypt: true,
      sign: false,
      cipherTextEncoding: 'hex',
      dangerouslyIgnoreEtag: false,
    };
    const opt = Object.assign({}, defaults, options);

    const gaiaHubConfig = await this.getOrSetLocalGaiaHubConnection();
    const maxUploadBytes = megabytesToBytes(gaiaHubConfig.max_file_upload_size_megabytes!);
    const hasMaxUpload = maxUploadBytes > 0;

    const contentLoader = new FileContentLoader(content, opt.contentType!);
    let contentType = contentLoader.contentType;

    // When not encrypting the content length can be checked immediately.
    if (!opt.encrypt && hasMaxUpload && contentLoader.contentByteLength > maxUploadBytes) {
      const sizeErrMsg = `The max file upload size for this hub is ${maxUploadBytes} bytes, the given content is ${contentLoader.contentByteLength} bytes`;
      const sizeErr = new PayloadTooLargeError(sizeErrMsg, null, maxUploadBytes);
      console.error(sizeErr);
      throw sizeErr;
    }

    // When encrypting, the content length must be calculated. Certain types like `Blob`s must
    // be loaded into memory.
    if (opt.encrypt && hasMaxUpload) {
      const encryptedSize = eciesGetJsonStringLength({
        contentLength: contentLoader.contentByteLength,
        wasString: contentLoader.wasString,
        sign: !!opt.sign,
        cipherTextEncoding: opt.cipherTextEncoding!,
      });
      if (encryptedSize > maxUploadBytes) {
        const sizeErrMsg = `The max file upload size for this hub is ${maxUploadBytes} bytes, the given content is ${encryptedSize} bytes after encryption`;
        const sizeErr = new PayloadTooLargeError(sizeErrMsg, null, maxUploadBytes);
        console.error(sizeErr);
        throw sizeErr;
      }
    }

    let etag: string;
    let newFile = true;
    const sessionData = this.userSession.store.getSessionData();

    if (!opt.dangerouslyIgnoreEtag) {
      if (sessionData.etags?.[path]) {
        newFile = false;
        etag = sessionData.etags?.[path];
      }
    }

    let uploadFn: (hubConfig: GaiaHubConfig) => Promise<string>;

    // In the case of signing, but *not* encrypting, we perform two uploads.
    if (!opt.encrypt && opt.sign) {
      const contentData = await contentLoader.load();
      let privateKey: string;
      if (typeof opt.sign === 'string') {
        privateKey = opt.sign;
      } else {
        privateKey = this.userSession.loadUserData().appPrivateKey;
      }
      const signatureObject = signECDSA(privateKey, contentData);
      const signatureContent = JSON.stringify(signatureObject);

      uploadFn = async (hubConfig: GaiaHubConfig) => {
        const writeResponse = (
          await Promise.all([
            uploadToGaiaHub(
              path,
              contentData,
              hubConfig,
              contentType,
              newFile,
              etag,
              opt.dangerouslyIgnoreEtag
            ),
            uploadToGaiaHub(
              `${path}${SIGNATURE_FILE_SUFFIX}`,
              signatureContent,
              hubConfig,
              'application/json'
            ),
          ])
        )[0];
        if (!opt.dangerouslyIgnoreEtag && writeResponse.etag) {
          sessionData.etags![path] = writeResponse.etag;
          this.userSession.store.setSessionData(sessionData);
        }
        return writeResponse.publicURL;
      };
    } else {
      // In all other cases, we only need one upload.
      let contentForUpload: string | Uint8Array | Blob;
      if (!opt.encrypt && !opt.sign) {
        // If content does not need encrypted or signed, it can be passed directly
        // to the fetch request without loading into memory.
        contentForUpload = contentLoader.content;
      } else {
        // Use the `encrypt` key, otherwise the `sign` key, if neither are specified
        // then use the current user's app public key.
        let publicKey: string;
        if (typeof opt.encrypt === 'string') {
          publicKey = opt.encrypt;
        } else if (typeof opt.sign === 'string') {
          publicKey = getPublicKeyFromPrivate(opt.sign);
        } else {
          publicKey = getPublicKeyFromPrivate(this.userSession.loadUserData().appPrivateKey);
        }
        const contentData = await contentLoader.load();
        contentForUpload = await this.userSession.encryptContent(contentData, {
          publicKey,
          wasString: contentLoader.wasString,
          cipherTextEncoding: opt.cipherTextEncoding,
          sign: opt.sign,
        });
        contentType = 'application/json';
      }

      uploadFn = async (hubConfig: GaiaHubConfig) => {
        const writeResponse = await uploadToGaiaHub(
          path,
          contentForUpload,
          hubConfig,
          contentType,
          newFile,
          etag,
          opt.dangerouslyIgnoreEtag
        );
        if (writeResponse.etag) {
          sessionData.etags![path] = writeResponse.etag;
          this.userSession.store.setSessionData(sessionData);
        }
        return writeResponse.publicURL;
      };
    }

    try {
      return await uploadFn(gaiaHubConfig);
    } catch (error: unknown) {
      // If the upload fails on first attempt, it could be due to a recoverable
      // error which may succeed by refreshing the config and retrying.
      if (isRecoverableGaiaError(error as GaiaHubError)) {
        console.error(error);
        console.error('Possible recoverable error during Gaia upload, retrying...');
        const freshHubConfig = await this.setLocalGaiaHubConnection();
        return await uploadFn(freshHubConfig);
      } else {
        throw error;
      }
    }
  }

  /**
   * Deletes the specified file from the app's data store.
   * @param path - The path to the file to delete.
   * @param options - Optional options object.
   * @param options.wasSigned - Set to true if the file was originally signed
   * in order for the corresponding signature file to also be deleted.
   * @returns Resolves when the file has been removed or rejects with an error.
   */
  async deleteFile(
    path: string,
    options?: {
      wasSigned?: boolean;
    }
  ) {
    const gaiaHubConfig = await this.getOrSetLocalGaiaHubConnection();
    const opts = Object.assign({}, options);
    if (opts.wasSigned) {
      // If signed, delete both the content file and the .sig file
      try {
        await deleteFromGaiaHub(path, gaiaHubConfig);
        await deleteFromGaiaHub(`${path}${SIGNATURE_FILE_SUFFIX}`, gaiaHubConfig);
        const sessionData = this.userSession.store.getSessionData();
        delete sessionData.etags![path];
        this.userSession.store.setSessionData(sessionData);
      } catch (error) {
        const freshHubConfig = await this.setLocalGaiaHubConnection();
        await deleteFromGaiaHub(path, freshHubConfig);
        await deleteFromGaiaHub(`${path}${SIGNATURE_FILE_SUFFIX}`, gaiaHubConfig);
        const sessionData = this.userSession.store.getSessionData();
        delete sessionData.etags![path];
        this.userSession.store.setSessionData(sessionData);
      }
    } else {
      try {
        await deleteFromGaiaHub(path, gaiaHubConfig);
        const sessionData = this.userSession.store.getSessionData();
        delete sessionData.etags![path];
        this.userSession.store.setSessionData(sessionData);
      } catch (error) {
        const freshHubConfig = await this.setLocalGaiaHubConnection();
        await deleteFromGaiaHub(path, freshHubConfig);
        const sessionData = this.userSession.store.getSessionData();
        delete sessionData.etags![path];
        this.userSession.store.setSessionData(sessionData);
      }
    }
  }

  /**
   * Get the app storage bucket URL
   * @param {String} gaiaHubUrl - the gaia hub URL
   * @param {String} appPrivateKey - the app private key used to generate the app address
   * @returns {Promise} That resolves to the URL of the app index file
   * or rejects if it fails
   */
  getAppBucketUrl(gaiaHubUrl: string, appPrivateKey: string) {
    return getBucketUrl(gaiaHubUrl, appPrivateKey);
  }

  /**
   * Loop over the list of files in a Gaia hub, and run a callback on each entry.
   * Not meant to be called by external clients.
   * @param {GaiaHubConfig} hubConfig - the Gaia hub config
   * @param {String | null} page - the page ID
   * @param {number} callCount - the loop count
   * @param {number} fileCount - the number of files listed so far
   * @param {function} callback - the callback to invoke on each file.  If it returns a falsey
   *  value, then the loop stops.  If it returns a truthy value, the loop continues.
   * @returns {Promise} that resolves to the number of files listed.
   * @private
   * @ignore
   */
  async listFilesLoop(
    hubConfig: GaiaHubConfig | null,
    page: string | null,
    callCount: number,
    fileCount: number,
    callback: (name: string) => boolean,
    fetchFn: FetchFn = createFetchFn()
  ): Promise<number> {
    if (callCount > 65536) {
      // this is ridiculously huge, and probably indicates
      // a faulty Gaia hub anyway (e.g. on that serves endless data)
      throw new Error('Too many entries to list');
    }

    hubConfig = hubConfig || (await this.getOrSetLocalGaiaHubConnection());
    let response: Response;
    try {
      const pageRequest = JSON.stringify({ page });
      const fetchOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': `${pageRequest.length}`,
          Authorization: `bearer ${hubConfig.token}`,
        },
        body: pageRequest,
      };
      response = await fetchFn(`${hubConfig.server}/list-files/${hubConfig.address}`, fetchOptions);
      if (!response.ok) {
        throw await getBlockstackErrorFromResponse(response, 'ListFiles failed.', hubConfig);
      }
    } catch (error) {
      // If error occurs on the first call, perform a gaia re-connection and retry.
      // Same logic as other gaia requests (putFile, getFile, etc).
      if (callCount === 0) {
        const freshHubConfig = await this.setLocalGaiaHubConnection();
        return this.listFilesLoop(freshHubConfig, page, callCount + 1, 0, callback);
      }
      throw error;
    }

    const responseText = await response.text();
    const responseJSON = JSON.parse(responseText);
    const entries = responseJSON.entries;
    const nextPage = responseJSON.page;
    if (entries === null || entries === undefined) {
      // indicates a misbehaving Gaia hub or a misbehaving driver
      // (i.e. the data is malformed)
      throw new Error('Bad listFiles response: no entries');
    }
    let entriesLength = 0;
    for (let i = 0; i < entries.length; i++) {
      // An entry array can have null entries, signifying a filtered entry and that there may be
      // additional pages
      if (entries[i] !== null) {
        entriesLength++;
        const rc = callback(entries[i]);
        if (!rc) {
          // callback indicates that we're done
          return fileCount + i;
        }
      }
    }
    if (nextPage && entries.length > 0) {
      // keep going -- have more entries
      return this.listFilesLoop(
        hubConfig,
        nextPage,
        callCount + 1,
        fileCount + entriesLength,
        callback
      );
    } else {
      // no more entries -- end of data
      return fileCount + entriesLength;
    }
  }

  /**
   * List the set of files in this application's Gaia storage bucket.
   *
   * @param {function} callback - a callback to invoke on each named file that
   * returns `true` to continue the listing operation or `false` to end it.
   * If the call is ended early by the callback, the last file is excluded.
   * If an error occurs the entire call is rejected.
   *
   * @returns {Promise} that resolves to the number of files listed
   */
  listFiles(callback: (name: string) => boolean): Promise<number> {
    return this.listFilesLoop(null, null, 0, 0, callback);
  }

  /**
   *  @ignore
   */
  async getOrSetLocalGaiaHubConnection(): Promise<GaiaHubConfig> {
    const sessionData = this.userSession.store.getSessionData();
    const userData = sessionData.userData;
    if (!userData) {
      throw new InvalidStateError('Missing userData');
    }
    const hubConfig = userData.gaiaHubConfig;
    if (hubConfig) {
      return Promise.resolve(hubConfig);
    }
    return this.setLocalGaiaHubConnection();
  }

  /**
   * These two functions are app-specific connections to gaia hub,
   *   they read the user data object for information on setting up
   *   a hub connection, and store the hub config to localstorage
   * @private
   * @returns {Promise} that resolves to the new gaia hub connection
   */
  async setLocalGaiaHubConnection(): Promise<GaiaHubConfig> {
    const userData = this.userSession.loadUserData();

    if (!userData) {
      throw new InvalidStateError('Missing userData');
    }

    if (!userData.hubUrl) {
      userData.hubUrl = GAIA_URL;
    }

    const gaiaConfig = await connectToGaiaHub(
      userData.hubUrl,
      userData.appPrivateKey,
      userData.gaiaAssociationToken
    );

    userData.gaiaHubConfig = gaiaConfig;

    const sessionData = this.userSession.store.getSessionData();
    sessionData.userData!.gaiaHubConfig = gaiaConfig;
    this.userSession.store.setSessionData(sessionData);

    return gaiaConfig;
  }
}

type FileUrlOptions = {
  path: string;
  username: string;
  appOrigin: string;
  zoneFileLookupURL: string;
};
export function getUserAppFileUrl(options: FileUrlOptions): Promise<string | undefined> {
  return new Storage({}).getUserAppFileUrl(
    options.path,
    options.username,
    options.appOrigin,
    options.zoneFileLookupURL
  );
}

/**
 * @param {Object} [options=null] - options object
 * @param {String} options.username - the Blockstack ID to lookup for multi-player storage
 * @param {String} options.app - the app to lookup for multi-player storage -
 * defaults to current origin
 *
 * @ignore
 */
function normalizeOptions<T>(
  userSession: UserSession,
  options?: {
    app?: string;
    username?: string;
    zoneFileLookupURL?: string;
  } & T
) {
  const opts = Object.assign({}, options);
  if (opts.username) {
    if (!opts.app) {
      if (!userSession.appConfig) {
        throw new InvalidStateError('Missing AppConfig');
      }
      opts.app = userSession.appConfig.appDomain;
    }
    if (!opts.zoneFileLookupURL) {
      if (!userSession.appConfig) {
        throw new InvalidStateError('Missing AppConfig');
      }
      if (!userSession.store) {
        throw new InvalidStateError('Missing store UserSession');
      }
      const sessionData = userSession.store.getSessionData();
      // Use the user specified coreNode if available, otherwise use the app specified coreNode.
      const configuredCoreNode = sessionData.userData?.coreNode || userSession.appConfig.coreNode;
      if (configuredCoreNode) {
        opts.zoneFileLookupURL = `${configuredCoreNode}${NAME_LOOKUP_PATH}`;
      }
    }
  }
  return opts;
}

/**
 * Determines if a gaia error response is possible to recover from
 * by refreshing the gaiaHubConfig, and retrying the request.
 */
function isRecoverableGaiaError(error: GaiaHubError): boolean {
  if (!error || !error.hubError || !error.hubError.statusCode) {
    return false;
  }
  const statusCode = error.hubError.statusCode;
  // 401 Unauthorized: possible expired, but renewable auth token.
  if (statusCode === 401) {
    return true;
  }
  // 409 Conflict: possible concurrent writes to a file.
  if (statusCode === 409) {
    return true;
  }
  // 500s: possible server-side transient error
  if (statusCode >= 500 && statusCode <= 599) {
    return true;
  }
  return false;
}
