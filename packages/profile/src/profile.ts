/// <reference path="./vendor.d.ts" />
import { extractProfile, signProfileToken } from './profileTokens';
import type { Json } from 'jsontokens';

import { getPersonFromLegacyFormat } from './profileSchemas';
import {
  getAddress,
  getAvatarUrl,
  getBirthDate,
  getConnections,
  getDescription,
  getFamilyName,
  getGivenName,
  getName,
  getOrganizations,
  getVerifiedAccounts,
  VerificationEntry,
} from './profileSchemas/personUtils';
import { LegacyProfile } from './profileSchemas/personLegacy';

// TODO: bring into this monorepo/convert to ts
import { makeZoneFile, parseZoneFile } from 'zone-file';
import * as inspector from 'schema-inspector';

import { Logger } from '@stacks/common';
import { NetworkClientParam, clientFromNetwork, networkFrom } from '@stacks/network';
import { PublicPersonProfile, PublicProfileBase } from './types';

interface ZoneFileJson extends Record<string, unknown> {
  $origin?: string;
  uri?: {
    target?: string;
    name?: string;
    [k: string]: unknown;
  }[];
}

const schemaDefinition: { [key: string]: unknown } = {
  type: 'object',
  properties: {
    '@context': { type: 'string', optional: true },
    '@type': { type: 'string' },
  },
};

/**
 * Represents a user profile
 */
export class Profile {
  _profile: PublicProfileBase;

  constructor(profile: PublicProfileBase = {}) {
    this._profile = Object.assign(
      {},
      {
        '@context': 'http://schema.org/',
      },
      profile
    );
  }

  toJSON() {
    return Object.assign({}, this._profile);
  }

  toToken(privateKey: string): string {
    return signProfileToken(this.toJSON() as Record<string, Json>, privateKey);
  }

  static validateSchema(profile: unknown, strict = false) {
    (schemaDefinition as { strict?: boolean }).strict = strict;
    return inspector.validate(schemaDefinition, profile);
  }

  static fromToken(token: string, publicKeyOrAddress: string | null = null): Profile {
    const profile = extractProfile(token, publicKeyOrAddress);
    return new Profile(profile as PublicProfileBase);
  }

  static makeZoneFile(domainName: string, tokenFileURL: string): string {
    return makeProfileZoneFile(domainName, tokenFileURL);
  }
}

const personSchemaDefinition = {
  type: 'object',
  strict: false,
  properties: {
    '@context': { type: 'string', optional: true },
    '@type': { type: 'string' },
    '@id': { type: 'string', optional: true },
    name: { type: 'string', optional: true },
    givenName: { type: 'string', optional: true },
    familyName: { type: 'string', optional: true },
    description: { type: 'string', optional: true },
    image: {
      type: 'array',
      optional: true,
      items: {
        type: 'object',
        properties: {
          '@type': { type: 'string' },
          name: { type: 'string', optional: true },
          contentUrl: { type: 'string', optional: true },
        },
      },
    },
    website: {
      type: 'array',
      optional: true,
      items: {
        type: 'object',
        properties: {
          '@type': { type: 'string' },
          url: { type: 'string', optional: true },
        },
      },
    },
    account: {
      type: 'array',
      optional: true,
      items: {
        type: 'object',
        properties: {
          '@type': { type: 'string' },
          service: { type: 'string', optional: true },
          identifier: { type: 'string', optional: true },
          proofType: { type: 'string', optional: true },
          proofUrl: { type: 'string', optional: true },
          proofMessage: { type: 'string', optional: true },
          proofSignature: { type: 'string', optional: true },
        },
      },
    },
    worksFor: {
      type: 'array',
      optional: true,
      items: {
        type: 'object',
        properties: {
          '@type': { type: 'string' },
          '@id': { type: 'string', optional: true },
        },
      },
    },
    knows: {
      type: 'array',
      optional: true,
      items: {
        type: 'object',
        properties: {
          '@type': { type: 'string' },
          '@id': { type: 'string', optional: true },
        },
      },
    },
    address: {
      type: 'object',
      optional: true,
      properties: {
        '@type': { type: 'string' },
        streetAddress: { type: 'string', optional: true },
        addressLocality: { type: 'string', optional: true },
        postalCode: { type: 'string', optional: true },
        addressCountry: { type: 'string', optional: true },
      },
    },
    birthDate: { type: 'string', optional: true },
    taxID: { type: 'string', optional: true },
  },
};

/**
 * @ignore
 */
export class Person extends Profile {
  constructor(profile: PublicPersonProfile = { '@type': 'Person' }) {
    super(profile);
    this._profile = Object.assign(
      {},
      {
        '@type': 'Person',
      },
      this._profile
    );
  }

  static validateSchema(profile: unknown, strict = false) {
    personSchemaDefinition.strict = strict;
    return inspector.validate(schemaDefinition, profile);
  }

  static fromToken(token: string, publicKeyOrAddress: string | null = null): Person {
    const profile = extractProfile(token, publicKeyOrAddress) as PublicPersonProfile;
    return new Person(profile);
  }

  static fromLegacyFormat(legacyProfile: LegacyProfile | null | undefined) {
    const profile = getPersonFromLegacyFormat(legacyProfile);
    return new Person(profile);
  }

  toJSON() {
    return {
      profile: this.profile(),
      name: this.name(),
      givenName: this.givenName(),
      familyName: this.familyName(),
      description: this.description(),
      avatarUrl: this.avatarUrl(),
      verifiedAccounts: this.verifiedAccounts(),
      address: this.address(),
      birthDate: this.birthDate(),
      connections: this.connections(),
      organizations: this.organizations(),
    };
  }

  profile() {
    return Object.assign({}, this._profile) as PublicPersonProfile;
  }

  name() {
    return getName(this.profile());
  }

  givenName() {
    return getGivenName(this.profile());
  }

  familyName() {
    return getFamilyName(this.profile());
  }

  description() {
    return getDescription(this.profile());
  }

  avatarUrl() {
    return getAvatarUrl(this.profile());
  }

  verifiedAccounts(verifications?: VerificationEntry[]) {
    return getVerifiedAccounts(this.profile(), verifications);
  }

  address() {
    return getAddress(this.profile());
  }

  birthDate() {
    return getBirthDate(this.profile());
  }

  connections() {
    return getConnections(this.profile());
  }

  organizations() {
    return getOrganizations(this.profile());
  }
}

/**
 *
 * @param origin
 * @param tokenFileUrl
 *
 * @ignore
 */
export function makeProfileZoneFile(origin: string, tokenFileUrl: string): string {
  if (!tokenFileUrl.includes('://')) {
    throw new Error('Invalid token file url');
  }

  const urlScheme = tokenFileUrl.split('://')[0];
  const urlParts = tokenFileUrl.split('://')[1].split('/');
  const domain = urlParts[0];
  const pathname = `/${urlParts.slice(1).join('/')}`;

  const zoneFile = {
    $origin: origin,
    $ttl: 3600,
    uri: [
      {
        name: '_http._tcp',
        priority: 10,
        weight: 1,
        target: `${urlScheme}://${domain}${pathname}`,
      },
    ],
  };

  const zoneFileTemplate = '{$origin}\n{$ttl}\n{uri}\n';

  return makeZoneFile(zoneFile, zoneFileTemplate);
}

/**
 *
 * @param zoneFileJson
 *
 * @ignore
 */
export function getTokenFileUrl(zoneFileJson: ZoneFileJson): string | null {
  if (!zoneFileJson.hasOwnProperty('uri')) {
    return null;
  }
  if (!Array.isArray(zoneFileJson.uri)) {
    return null;
  }
  if (zoneFileJson.uri.length < 1) {
    return null;
  }

  const validRecords = zoneFileJson.uri.filter(
    record => record.hasOwnProperty('target') && record.name === '_http._tcp'
  );

  if (validRecords.length < 1) {
    return null;
  }

  const firstValidRecord = validRecords[0];

  if (!firstValidRecord.hasOwnProperty('target')) {
    return null;
  }
  let tokenFileUrl = firstValidRecord.target;

  if (tokenFileUrl?.startsWith('https')) {
    // pass
  } else if (tokenFileUrl?.startsWith('http')) {
    // pass
  } else {
    tokenFileUrl = `https://${tokenFileUrl}`;
  }

  return tokenFileUrl ?? null;
}

/**
 *
 * @param zoneFile
 * @param publicKeyOrAddress
 *
 * @ignore
 */
export function resolveZoneFileToProfile(
  opts: {
    zoneFile: string;
    publicKeyOrAddress: string;
  } & NetworkClientParam
): Promise<Record<string, unknown>> {
  const network = networkFrom(opts.network ?? 'mainnet');
  const client = Object.assign({}, clientFromNetwork(network), opts.client);

  return new Promise((resolve, reject) => {
    let zoneFileJson: ZoneFileJson | null = null;
    try {
      zoneFileJson = parseZoneFile(opts.zoneFile) as ZoneFileJson;
      if (!zoneFileJson.hasOwnProperty('$origin')) {
        zoneFileJson = null;
      }
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }

    let tokenFileUrl: string | null = null;
    if (zoneFileJson && Object.keys(zoneFileJson).length > 0) {
      tokenFileUrl = getTokenFileUrl(zoneFileJson);
    } else {
      try {
        const legacyProfile = JSON.parse(opts.zoneFile) as LegacyProfile;
        return resolve(Person.fromLegacyFormat(legacyProfile).profile());
      } catch (error) {
        return reject(error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (tokenFileUrl) {
      client
        .fetch(tokenFileUrl)
        .then(response => response.text())
        .then(responseText => JSON.parse(responseText) as unknown)
        .then(responseJson => {
          const tokenRecords = responseJson as { token: string }[];
          const profile = extractProfile(tokenRecords[0].token, opts.publicKeyOrAddress);
          resolve(profile);
        })
        .catch(error => {
          Logger.error(
            `resolveZoneFileToProfile: error fetching token file ${tokenFileUrl}: ${error}`
          );
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    } else {
      Logger.debug('Token file url not found. Resolving to blank profile.');
      resolve({});
    }
  });
}
