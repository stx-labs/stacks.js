import { createFetchFn, FetchFn } from '@stacks/common';
import { parseZoneFile } from 'zone-file';

import { getTokenFileUrl, Person } from '../profile';
import { extractProfile } from '../profileTokens';
import { LegacyProfile } from './personLegacy';

/**
 *
 * @param zoneFile
 * @param publicKeyOrAddress
 * @param callback
 *
 * @ignore
 */
export function resolveZoneFileToPerson(
  zoneFile: string,
  publicKeyOrAddress: string,
  callback: (profile: Record<string, unknown> | null) => void,
  fetchFn: FetchFn = createFetchFn()
) {
  let zoneFileJson: Record<string, unknown> | null = null;
  try {
    zoneFileJson = parseZoneFile(zoneFile);
    if (!zoneFileJson.hasOwnProperty('$origin')) {
      zoneFileJson = null;
      throw new Error('zone file is missing an origin');
    }
  } catch (e) {
    console.error(e);
  }

  let tokenFileUrl: string | null = null;
  if (zoneFileJson && Object.keys(zoneFileJson).length > 0) {
    tokenFileUrl = getTokenFileUrl(zoneFileJson);
  } else {
    let profile: Record<string, unknown> | null = null;
    try {
      const legacyProfile = JSON.parse(zoneFile) as LegacyProfile;
      const person = Person.fromLegacyFormat(legacyProfile);
      profile = person.profile();
    } catch (error) {
      console.warn(error);
    }
    callback(profile);
    return;
  }

  if (tokenFileUrl) {
    fetchFn(tokenFileUrl)
      .then(response => response.text())
      .then(responseText => JSON.parse(responseText) as unknown)
      .then(responseJson => {
        const tokenRecords = responseJson as { token: string }[];
        const token = tokenRecords[0].token;
        const profile = extractProfile(token, publicKeyOrAddress);

        callback(profile);
      })
      .catch((error: unknown) => {
        console.warn(error);
      });
  } else {
    console.warn('Token file url not found');
    callback({});
  }
}
