import { getPublicKeyFromPrivate } from '@stacks/encryption';
import { FetchFn, createFetchFn } from '@stacks/common';
import {
  PublicPersonProfile,
  PublicProfileBase,
  signProfileToken,
  wrapProfileToken,
} from '@stacks/profile';
import { GaiaHubConfig, connectToGaiaHub, uploadToGaiaHub } from '@stacks/storage';
import { getProfileURLFromZoneFile } from '../utils';
import { Account, getGaiaAddress } from './common';

export const DEFAULT_PROFILE: PublicPersonProfile = {
  '@type': 'Person',
  '@context': 'http://schema.org',
};

export const DEFAULT_PROFILE_FILE_NAME = 'profile.json';

export const fetchProfileFromUrl = async (
  profileUrl: string,
  fetchFn: FetchFn = createFetchFn()
) => {
  try {
    const res = await fetchFn(profileUrl);
    if (res.ok) {
      const json = await res.json();
      const { decodedToken } = json[0];
      return decodedToken.payload?.claim as PublicProfileBase;
    }
    if (res.status === 404) return null;
    throw new Error('Network error when fetching profile');
  } catch (error) {
    return null;
  }
};

export const fetchAccountProfileUrl = async ({
  account,
  gaiaHubUrl,
}: {
  account: Account;
  gaiaHubUrl: string;
}) => {
  if (account.username) {
    try {
      const url = await getProfileURLFromZoneFile(account.username);
      if (url) return url;
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('Error fetching profile URL from zone file:', error);
      }
    }
  }
  return `${gaiaHubUrl}${getGaiaAddress(account)}/profile.json`;
};

export function signProfileForUpload({
  profile,
  account,
}: {
  profile: PublicProfileBase;
  account: Account;
}) {
  // the profile is always signed with the stx private key
  // because a username (if any) is owned by the stx private key
  const privateKey = account.stxPrivateKey;
  const publicKey = getPublicKeyFromPrivate(privateKey.slice(0, 64));

  const token = signProfileToken(profile as Parameters<typeof signProfileToken>[0], privateKey, { publicKey });
  const tokenRecord = wrapProfileToken(token);
  const tokenRecords = [tokenRecord];
  return JSON.stringify(tokenRecords, null, 2);
}

export async function uploadProfile({
  gaiaHubUrl,
  account,
  signedProfileTokenData,
  gaiaHubConfig,
}: {
  gaiaHubUrl: string;
  account: Account;
  signedProfileTokenData: string;
  gaiaHubConfig?: GaiaHubConfig;
}) {
  const identityHubConfig =
    gaiaHubConfig || (await connectToGaiaHub(gaiaHubUrl, account.dataPrivateKey));

  await uploadToGaiaHub(
    DEFAULT_PROFILE_FILE_NAME,
    signedProfileTokenData,
    identityHubConfig,
    undefined,
    undefined,
    undefined,
    true
  );
}

export const signAndUploadProfile = async ({
  profile,
  gaiaHubUrl,
  account,
  gaiaHubConfig,
}: {
  profile: PublicProfileBase;
  gaiaHubUrl: string;
  account: Account;
  gaiaHubConfig?: GaiaHubConfig;
}) => {
  const signedProfileTokenData = signProfileForUpload({ profile, account });
  await uploadProfile({ gaiaHubUrl, account, signedProfileTokenData, gaiaHubConfig });
};
