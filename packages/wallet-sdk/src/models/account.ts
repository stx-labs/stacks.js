// https://github.com/paulmillr/scure-bip32
// Secure, audited & minimal implementation of BIP32 hierarchical deterministic (HD) wallets.
import { HDKey } from '@scure/bip32';
import { makeAuthResponse as _makeAuthResponse } from '@stacks/auth';
import { bytesToHex, utf8ToBytes } from '@stacks/common';

import { FetchFn, createFetchFn } from '@stacks/common';
import {
  getPublicKeyFromPrivate,
  hashCode,
  hashSha256Sync,
  publicKeyToBtcAddress,
} from '@stacks/encryption';
import { NetworkParam, StacksNetwork, StacksNetworkName } from '@stacks/network';
import { getAddressFromPrivateKey } from '@stacks/transactions';
import {
  HubInfo,
  connectToGaiaHubWithConfig,
  getHubInfo,
  makeGaiaAssociationToken,
} from '../utils';
import { Account, HARDENED_OFFSET } from './common';
import {
  DEFAULT_PROFILE,
  fetchAccountProfileUrl,
  fetchProfileFromUrl,
  signAndUploadProfile,
} from './profile';
import { PublicProfileBase } from '@stacks/profile';

export function getStxAddress(
  account: Account,
  network?: StacksNetworkName | StacksNetwork
): string;
export function getStxAddress({
  account,
  network,
}: {
  account: Account;
} & NetworkParam): string;
export function getStxAddress(
  accountOrOptions: Account | ({ account: Account } & NetworkParam),
  network: StacksNetworkName | StacksNetwork = 'mainnet'
): string {
  if ('account' in accountOrOptions) {
    const { account, network = 'mainnet' } = accountOrOptions;
    return getAddressFromPrivateKey(account.stxPrivateKey, network);
  }

  return getAddressFromPrivateKey(accountOrOptions.stxPrivateKey, network);
}

/**
 * Get the display name of an account.
 *
 * If the account has a username, it will return the first part of the username, so `myname.id` => `myname`, and
 * `myname.blockstack.id` => `myname`.
 *
 * If the account has no username, it returns `Account ${acount.index}`
 *
 */
export const getAccountDisplayName = (account: Account) => {
  if (account.username) {
    return account.username.split('.')[0];
  }
  return `Account ${account.index + 1}`;
};

export const getAppPrivateKey = ({
  account,
  appDomain,
}: {
  account: Account;
  appDomain: string;
}) => {
  const hashBytes = hashSha256Sync(utf8ToBytes(`${appDomain}${account.salt}`));
  const hash = bytesToHex(hashBytes);
  const appIndex = hashCode(hash);
  const appsNode = HDKey.fromExtendedKey(account.appsKey);
  const appKeychain = appsNode.deriveChild(appIndex + HARDENED_OFFSET);
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  if (!appKeychain.privateKey) throw 'Needs private key';
  return bytesToHex(appKeychain.privateKey);
};

/** @internal helper */
async function optionalGaiaProfileData({
  gaiaHubUrl,
  fetchFn,
  account,
}: {
  gaiaHubUrl: string;
  fetchFn: FetchFn;
  account: Account;
}): Promise<{
  hubInfo?: HubInfo;
  profileUrl?: string;
  profile?: PublicProfileBase | null;
}> {
  const hubInfo = await getHubInfo(gaiaHubUrl, fetchFn).catch(() => undefined);
  if (!hubInfo) return {}; // keep data undefined if hub is not available

  const profileUrl = await fetchAccountProfileUrl({ account, gaiaHubUrl: hubInfo.read_url_prefix });
  const profile = (await fetchProfileFromUrl(profileUrl, fetchFn)) || DEFAULT_PROFILE;
  return { hubInfo, profileUrl, profile };
}

export const makeAuthResponse = async ({
  account,
  appDomain,
  transitPublicKey,
  scopes = [],
  gaiaHubUrl,
  appPrivateKeyFromWalletSalt = null,
  additionalData = {},
  fetchFn = createFetchFn(),
}: {
  account: Account;
  appDomain: string;
  transitPublicKey: string;
  scopes?: string[];
  gaiaHubUrl: string;
  appPrivateKeyFromWalletSalt?: string | null;
  additionalData?: Record<string, any>;
  fetchFn?: FetchFn;
}) => {
  const appPrivateKey = getAppPrivateKey({ account, appDomain });

  const { hubInfo, profileUrl, profile } = await optionalGaiaProfileData({
    gaiaHubUrl,
    fetchFn,
    account,
  });

  if (scopes.includes('publish_data') && hubInfo && profile) {
    if (!profile.apps) {
      profile.apps = {};
    }
    const publicKey = getPublicKeyFromPrivate(appPrivateKey);
    const address = publicKeyToBtcAddress(publicKey);
    const storageUrl = `${hubInfo.read_url_prefix}${address}/`;
    profile.apps[appDomain] = storageUrl;
    if (!profile.appsMeta) {
      profile.appsMeta = {};
    }
    profile.appsMeta[appDomain] = {
      storage: storageUrl,
      publicKey,
    };
    const gaiaHubConfig = connectToGaiaHubWithConfig({
      hubInfo,
      privateKey: account.dataPrivateKey,
      gaiaHubUrl,
    });
    await signAndUploadProfile({ profile, account, gaiaHubUrl, gaiaHubConfig });
  }

  const compressedAppPublicKey = getPublicKeyFromPrivate(appPrivateKey.slice(0, 64));
  const associationToken = makeGaiaAssociationToken({
    privateKey: account.dataPrivateKey,
    childPublicKeyHex: compressedAppPublicKey,
  });

  return _makeAuthResponse(
    account.dataPrivateKey,
    {
      ...(profile || {}),
      stxAddress: {
        testnet: getStxAddress({ account, network: 'testnet' }),
        mainnet: getStxAddress({ account, network: 'mainnet' }),
      },
      ...additionalData,
    },
    profileUrl ? { profileUrl } : null,
    undefined,
    appPrivateKey,
    undefined,
    transitPublicKey,
    gaiaHubUrl,
    undefined,
    associationToken,
    appPrivateKeyFromWalletSalt
  );
};
