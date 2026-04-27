import * as blockstack from 'blockstack';
import * as URL from 'url';
import * as crypto from 'crypto';
import * as jsontokens from 'jsontokens';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ZoneFile = require('zone-file');

import { canonicalPrivateKey, getPublicKeyFromPrivateKey } from './utils';
import { getPrivateKeyAddress } from './common';

import { CLINetworkAdapter, NameInfoType } from './network';

import { UserData } from '@stacks/auth';

import { GaiaHubConfig, connectToGaiaHub } from '@stacks/storage';

/*
 * Set up a session for Gaia.
 * Generate an authentication response like what the browser would do,
 * and store the relevant data to our emulated localStorage.
 */
function makeFakeAuthResponseToken(
  appPrivateKey: string | null,
  hubURL: string | null,
  associationToken?: string
) {
  const ownerPrivateKey = '24004db06ef6d26cdd2b0fa30b332a1b10fa0ba2b07e63505ffc2a9ed7df22b4';
  const transitPrivateKey = 'f33fb466154023aba2003c17158985aa6603db68db0f1afc0fcf1d641ea6c2cb';
  const transitPublicKey =
    '0496345da77fb5e06757b9c4fd656bf830a3b293f245a6cc2f11f8334ebb690f1' +
    '9582124f4b07172eb61187afba4514828f866a8a223e0d5c539b2e38a59ab8bb3';

  window.localStorage.setItem('blockstack-transit-private-key', transitPrivateKey);

  const authResponse = blockstack.makeAuthResponse(
    ownerPrivateKey,
    { type: '@Person', accounts: [] },
    // @ts-ignore
    null,
    {},
    null,
    appPrivateKey,
    undefined,
    transitPublicKey,
    hubURL,
    blockstack.config.network.blockstackAPIUrl,
    associationToken
  );

  return authResponse;
}

/*
 * Make an association token for the given address.
 * TODO belongs in a "gaia.js" library
 */
export function makeAssociationToken(appPrivateKey: string, identityKey: string): string {
  const appPublicKey = getPublicKeyFromPrivateKey(`${canonicalPrivateKey(appPrivateKey)}01`);
  const FOUR_MONTH_SECONDS = 60 * 60 * 24 * 31 * 4;
  const salt = crypto.randomBytes(16).toString('hex');
  const identityPublicKey = getPublicKeyFromPrivateKey(identityKey);
  const associationTokenClaim = {
    childToAssociate: appPublicKey,
    iss: identityPublicKey,
    exp: FOUR_MONTH_SECONDS + new Date().getTime() / 1000,
    salt,
  };
  const associationToken = new jsontokens.TokenSigner('ES256K', identityKey).sign(
    associationTokenClaim
  );
  return associationToken;
}

/*
 * Authenticate to Gaia.  Used for reading, writing, and listing files.
 * Process a (fake) session token and set up a Gaia hub connection.
 * Returns a Promise that resolves to the (fake) userData
 */
export function gaiaAuth(
  network: CLINetworkAdapter,
  appPrivateKey: string | null,
  hubUrl: string | null,
  ownerPrivateKey?: string
): Promise<UserData> {
  // Gaia speaks mainnet only!
  if (!network.isMainnet()) {
    throw new Error('Gaia only works with mainnet networks.');
  }

  let associationToken;
  if (ownerPrivateKey && appPrivateKey) {
    associationToken = makeAssociationToken(appPrivateKey, ownerPrivateKey);
  }

  const authSessionToken = makeFakeAuthResponseToken(appPrivateKey, hubUrl, associationToken);
  const nameLookupUrl = `${network.legacyNetwork.blockstackAPIUrl}/v1/names/`;
  const transitPrivateKey = 'f33fb466154023aba2003c17158985aa6603db68db0f1afc0fcf1d641ea6c2cb'; // same as above
  //@ts-ignore
  return blockstack.handlePendingSignIn(nameLookupUrl, authSessionToken, transitPrivateKey);
}

/*
 * Connect to Gaia hub and generate a hub config.
 * Used for reading and writing profiles.
 * Make sure we use a mainnet address always, even in test mode.
 * Returns a Promise that resolves to a GaiaHubConfig
 */
export function gaiaConnect(
  network: CLINetworkAdapter,
  gaiaHubUrl: string,
  privateKey: string,
  ownerPrivateKey?: string
) {
  const addressMainnet = network.coerceMainnetAddress(
    getPrivateKeyAddress(network, `${canonicalPrivateKey(privateKey)}01`)
  );
  const addressMainnetCanonical = network.coerceMainnetAddress(
    getPrivateKeyAddress(network, canonicalPrivateKey(privateKey))
  );

  let associationToken;
  if (ownerPrivateKey) {
    associationToken = makeAssociationToken(privateKey, ownerPrivateKey);
  }

  return connectToGaiaHub(gaiaHubUrl, canonicalPrivateKey(privateKey), associationToken).then(
    hubConfig => {
      // ensure that hubConfig always has a mainnet address, even if we're in testnet
      if (network.coerceMainnetAddress(hubConfig.address) === addressMainnet) {
        hubConfig.address = addressMainnet;
      } else if (network.coerceMainnetAddress(hubConfig.address) === addressMainnetCanonical) {
        hubConfig.address = addressMainnetCanonical;
      } else {
        throw new Error(
          'Invalid private key: ' +
            `${network.coerceMainnetAddress(hubConfig.address)} is neither ` +
            `${addressMainnet} or ${addressMainnetCanonical}`
        );
      }
      return hubConfig;
    }
  );
}

/*
 * Find the profile.json path for a name
 * @network (object) the network to use
 * @blockstackID (string) the blockstack ID to query
 *
 * Returns a Promise that resolves to the filename to use for the profile
 * Throws an exception if the profile URL could not be determined
 */
function gaiaFindProfileName(
  network: CLINetworkAdapter,
  hubConfig: GaiaHubConfig,
  blockstackID?: string
): Promise<string> {
  if (!blockstackID || blockstackID === null || blockstackID === undefined) {
    return Promise.resolve().then(() => 'profile.json');
  } else {
    return network.getNameInfo(blockstackID).then((nameInfo: NameInfoType) => {
      let profileUrl;
      try {
        const zonefileJSON = ZoneFile.parseZoneFile(nameInfo.zonefile);
        if (zonefileJSON.uri && zonefileJSON.hasOwnProperty('$origin')) {
          profileUrl = blockstack.getTokenFileUrl(zonefileJSON);
        }
      } catch (e) {
        throw new Error(
          `Could not determine profile URL for ${String(blockstackID)}: could not parse zone file`
        );
      }

      if (profileUrl === null || profileUrl === undefined) {
        throw new Error(
          `Could not determine profile URL for ${String(blockstackID)}: no URL in zone file`
        );
      }

      // profile URL path must match Gaia hub's URL prefix and address
      // (the host can be different)
      const gaiaReadPrefix = `${hubConfig.url_prefix}${hubConfig.address}`;
      const gaiaReadUrlPath = String(URL.parse(gaiaReadPrefix).path);
      const profileUrlPath = String(URL.parse(profileUrl).path);

      if (!profileUrlPath.startsWith(gaiaReadUrlPath)) {
        throw new Error(
          `Could not determine profile URL for ${String(blockstackID)}: wrong Gaia hub` +
            ` (${gaiaReadPrefix} does not correspond to ${profileUrl})`
        );
      }

      const profilePath = profileUrlPath.substring(gaiaReadUrlPath.length + 1);
      return profilePath;
    });
  }
}

/*
 * Upload profile data to a Gaia hub.
 *
 * Legacy compat:
 * If a blockstack ID is given, then the zone file will be queried and the profile URL
 * inspected to make sure that we handle the special (legacy) case where a profile.json
 * file got stored to $GAIA_URL/$ADDRESS/$INDEX/profile.json (where $INDEX is a number).
 * In such cases, the profile will be stored to $INDEX/profile.json, instead of just
 * profile.json.
 *
 * @network (object) the network to use
 * @gaiaHubUrl (string) the base scheme://host:port URL to the Gaia hub
 * @gaiaData (string) the data to upload
 * @privateKey (string) the private key to use to sign the challenge
 * @blockstackID (string) optional; the blockstack ID for which this profile will be stored.
 */
export function gaiaUploadProfile(
  network: CLINetworkAdapter,
  gaiaHubURL: string,
  gaiaData: string,
  privateKey: string,
  blockstackID?: string
) {
  let hubConfig: GaiaHubConfig;
  return gaiaConnect(network, gaiaHubURL, privateKey)
    .then((hubconf: GaiaHubConfig) => {
      // make sure we use the *right* gaia path.
      // if the blockstackID is given, then we should inspect the zone file to
      // determine if the Gaia profile URL contains an index.  If it does, then
      // we need to preserve it!
      hubConfig = hubconf;
      return gaiaFindProfileName(network, hubConfig, blockstackID);
    })
    .then((profilePath: string) => {
      return blockstack.uploadToGaiaHub(profilePath, gaiaData, hubConfig);
    });
}

/*
 * Upload profile data to all Gaia hubs, given a zone file.
 * @network (object) the network to use
 * @gaiaUrls (array) list of Gaia URLs
 * @gaiaData (string) the data to store
 * @privateKey (string) the hex-encoded private key
 * @return a promise with {'dataUrls': [urls to the data]}, or {'error': ...}
 */
export function gaiaUploadProfileAll(
  network: CLINetworkAdapter,
  gaiaUrls: string[],
  gaiaData: string,
  privateKey: string,
  blockstackID?: string
): Promise<{ dataUrls?: string[] | null; error?: string | null }> {
  const sanitizedGaiaUrls = gaiaUrls
    .map(gaiaUrl => {
      const urlInfo = URL.parse(gaiaUrl);
      if (!urlInfo.protocol) {
        return '';
      }
      if (!urlInfo.host) {
        return '';
      }
      // keep flow happy
      return `${String(urlInfo.protocol)}//${String(urlInfo.host)}`;
    })
    .filter(gaiaUrl => gaiaUrl.length > 0);

  const uploadPromises = sanitizedGaiaUrls.map(gaiaUrl =>
    gaiaUploadProfile(network, gaiaUrl, gaiaData, privateKey, blockstackID)
  );

  return Promise.all(uploadPromises)
    .then(publicUrls => {
      return { error: null, dataUrls: publicUrls };
    })
    .catch(e => {
      return { error: `Failed to upload: ${e.message}`, dataUrls: null };
    });
}

/*
 * Given a Gaia bucket URL, extract its address
 */
export function getGaiaAddressFromURL(appUrl: string): string {
  const matches = appUrl.match(/([13][a-km-zA-HJ-NP-Z0-9]{26,35})/);
  if (!matches) {
    throw new Error('Failed to parse gaia address');
  }
  return matches[matches.length - 1];
}

/*
 * Given a profile and an app origin, find its app address
 * Returns the address on success
 * Throws on error or not found
 */
export function getGaiaAddressFromProfile(
  network: CLINetworkAdapter,
  profile: any,
  appOrigin: string
): string {
  if (!profile) {
    throw new Error('No profile');
  }
  if (!profile.apps) {
    throw new Error('No profile apps');
  }
  if (!profile.apps[appOrigin]) {
    throw new Error(`No app entry for ${appOrigin}`);
  }

  // do we already have an address set for this app?
  const appUrl = profile.apps[appOrigin];
  let existingAppAddress;
  // what's the address?
  try {
    existingAppAddress = network.coerceMainnetAddress(getGaiaAddressFromURL(appUrl));
  } catch (e) {
    throw new Error(`Failed to parse app URL ${appUrl}`);
  }

  return existingAppAddress;
}
