import { ProfileImage, ProfileType, PublicPersonProfile } from '../types';

export interface LegacyServiceAccount {
  username: string;
  proof?: { url?: string };
}

export interface LegacyProfile {
  name?: { formatted?: string };
  bio?: string;
  location?: { formatted?: string };
  avatar?: { url?: string };
  cover?: { url?: string };
  website?: string;
  bitcoin?: { address?: string };
  twitter?: LegacyServiceAccount;
  facebook?: LegacyServiceAccount;
  github?: LegacyServiceAccount;
  auth?: { publicKeychain?: string }[];
  pgp?: { url?: string; fingerprint?: string };
}

/**
 *
 * @param serviceName
 * @param data
 *
 * @ignore
 */
function formatAccount(serviceName: string, data: LegacyServiceAccount) {
  let proofUrl;
  if (data.proof && data.proof.url) {
    proofUrl = data.proof.url;
  }
  return {
    '@type': 'Account',
    service: serviceName,
    identifier: data.username,
    proofType: 'http',
    proofUrl,
  };
}

/**
 *
 * @param profile
 *
 * @ignore
 */
export function getPersonFromLegacyFormat(profile: LegacyProfile | null | undefined) {
  const profileData: {
    ['@type']: ProfileType;
    account?: NonNullable<PublicPersonProfile['account']>;
    name?: string;
    description?: string;
    address?: {
      ['@type']: string;
      addressLocality: string;
    };
    image?: ProfileImage[];
    website?: NonNullable<PublicPersonProfile['website']>;
  } = {
    '@type': 'Person',
  };

  if (profile) {
    if (profile.name && profile.name.formatted) {
      profileData.name = profile.name.formatted;
    }

    if (profile.bio) {
      profileData.description = profile.bio;
    }

    if (profile.location && profile.location.formatted) {
      profileData.address = {
        '@type': 'PostalAddress',
        addressLocality: profile.location.formatted,
      };
    }

    const images: ProfileImage[] = [];
    if (profile.avatar && profile.avatar.url) {
      images.push({
        '@type': 'ImageObject',
        name: 'avatar',
        contentUrl: profile.avatar.url,
      });
    }
    if (profile.cover && profile.cover.url) {
      images.push({
        '@type': 'ImageObject',
        name: 'cover',
        contentUrl: profile.cover.url,
      });
    }
    if (images.length) {
      profileData.image = images;
    }

    if (profile.website) {
      profileData.website = [
        {
          '@type': 'WebSite',
          url: profile.website,
        },
      ];
    }

    const accounts: NonNullable<PublicPersonProfile['account']> = [];
    if (profile.bitcoin && profile.bitcoin.address) {
      accounts.push({
        '@type': 'Account',
        role: 'payment',
        service: 'bitcoin',
        identifier: profile.bitcoin.address,
      });
    }
    if (profile.twitter && profile.twitter.username) {
      accounts.push(formatAccount('twitter', profile.twitter));
    }
    if (profile.facebook && profile.facebook.username) {
      accounts.push(formatAccount('facebook', profile.facebook));
    }
    if (profile.github && profile.github.username) {
      accounts.push(formatAccount('github', profile.github));
    }

    if (profile.auth) {
      if (profile.auth.length > 0) {
        if (profile.auth[0] && profile.auth[0].publicKeychain) {
          accounts.push({
            '@type': 'Account',
            role: 'key',
            service: 'bip32',
            identifier: profile.auth[0].publicKeychain,
          });
        }
      }
    }
    if (profile.pgp && profile.pgp.url) {
      accounts.push({
        '@type': 'Account',
        role: 'key',
        service: 'pgp',
        identifier: profile.pgp.fingerprint,
        contentUrl: profile.pgp.url,
      });
    }

    profileData.account = accounts;
  }

  return profileData;
}
