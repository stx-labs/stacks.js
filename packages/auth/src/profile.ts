import { NetworkClientParam, clientFromNetwork, networkFrom } from '@stacks/network';
import { resolveZoneFileToProfile } from '@stacks/profile';

export interface ProfileLookupOptions {
  username: string;
  zoneFileLookupURL?: string;
}

/**
 * Look up a user profile by blockstack ID
 *
 * @param {string} username - The Blockstack ID of the profile to look up
 * @param {string} [zoneFileLookupURL=null] - The URL
 * to use for zonefile lookup. If falsey, lookupProfile will use the
 * blockstack.js [[getNameInfo]] function.
 * @returns {Promise} that resolves to a profile object
 */
export function lookupProfile(
  options: ProfileLookupOptions & NetworkClientParam
): Promise<Record<string, unknown>> {
  if (!options.username) {
    return Promise.reject(new Error('No username provided'));
  }

  const network = networkFrom(options.network ?? 'mainnet');
  const client = Object.assign({}, clientFromNetwork(network), options.client);

  let lookupPromise;
  if (options.zoneFileLookupURL) {
    const url = `${options.zoneFileLookupURL.replace(/\/$/, '')}/${options.username}`;
    lookupPromise = client.fetch(url).then(response => response.json());
  } else {
    lookupPromise = getNameInfo({ name: options.username });
  }
  return lookupPromise.then((responseJSON: Record<string, unknown>) => {
    if (responseJSON.hasOwnProperty('zonefile') && responseJSON.hasOwnProperty('address')) {
      return resolveZoneFileToProfile({
        zoneFile: responseJSON.zonefile as string,
        publicKeyOrAddress: responseJSON.address as string,
        client,
      });
    } else {
      throw new Error(
        'Invalid zonefile lookup response: did not contain `address`' + ' or `zonefile` field'
      );
    }
  });
}

export function getNameInfo(
  opts: {
    /** Fully qualified name */
    name: string;
  } & NetworkClientParam
) {
  const network = networkFrom(opts.network ?? 'mainnet');
  const client = Object.assign({}, clientFromNetwork(network), opts.client);

  const nameLookupURL = `${client.baseUrl}/v1/names/${opts.name}`;
  return client
    .fetch(nameLookupURL)
    .then(resp => {
      if (resp.status === 404) {
        throw new Error('Name not found');
      } else if (resp.status !== 200) {
        throw new Error(`Bad response status: ${resp.status}`);
      } else {
        return resp.json();
      }
    })
    .then((nameInfo: Record<string, unknown>) => {
      // the returned address _should_ be in the correct network ---
      //  stacks node gets into trouble because it tries to coerce back to mainnet
      //  and the regtest transaction generation libraries want to use testnet addresses
      if (nameInfo.address) {
        return Object.assign({}, nameInfo, { address: nameInfo.address });
      } else {
        return nameInfo;
      }
    });
}
