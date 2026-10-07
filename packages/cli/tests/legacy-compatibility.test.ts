import fetchMock from 'jest-fetch-mock';
import { getApplicationKeyInfo, getOwnerKeyInfo, getPaymentKeyInfo } from '../src/keys';
import { encryptBackupPhrase, decryptBackupPhrase } from '../src/encrypt';
import { gaiaAuth, gaiaStorage } from '../src/data';
import { CLINetworkAdapter, CLI_NETWORK_OPTS, getNetwork } from '../src/network';
import { CLI_CONFIG_TYPE } from '../src/argparse';
import { getPublicKeyFromPrivateKey } from '../src/utils';

// Fixed vectors generated with blockstack 19.3.0 before removing the dependency.
const mnemonic = 'apart spin rich leader siren foil dish sausage fee pipe ethics bundle';
const network = new CLINetworkAdapter(getNetwork({} as CLI_CONFIG_TYPE, false), {
  nodeAPIUrl: 'https://example.com',
} as CLI_NETWORK_OPTS);

beforeEach(() => fetchMock.resetMocks());

test('preserves compressed and uncompressed public keys', () => {
  const key = '1'.repeat(64);
  expect(getPublicKeyFromPrivateKey(key)).toBe(
    '044f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa385b6b1b8ead809ca67454d9683fcf2ba03456d6fe2c4abe2b07f0fbdbb2f1c1'
  );
  expect(getPublicKeyFromPrivateKey(`${key}01`)).toBe(
    '034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa'
  );
});

test('preserves the legacy Bitcoin payment key', async () => {
  const result = await getPaymentKeyInfo(network, mnemonic);
  expect(result.privateKey).toBe(
    '56d30f2b605ed114c7dc45599ae521c525d07e1286fbab67452a6586ea49332a01'
  );
});

test('preserves the legacy Gaia app key', async () => {
  const owner = await getOwnerKeyInfo(network, mnemonic, 0);
  const result = await getApplicationKeyInfo(
    network,
    mnemonic,
    owner.idAddress,
    'https://example.com',
    0
  );
  expect(result.legacyKeyInfo.privateKey).toBe(
    '6c1dc19da89143c4f51b8dd01124e56e0c4a97daab024ec720a242c21a0e2990'
  );
});

test('decrypts current and legacy TripleSec backup phrases', async () => {
  const current =
    '883668876b6b62989ddfa7ee0e168e3dc39b4c795c5fa08939a67f0a8f91aaa36de8a4da6592f2890f57e5693ce727056464b1492d8c1104302be4f60a39bb1af2f5fb16ca3bbfb0b395d9b76ec5f969';
  const triplesec =
    '1c94d7de00000003e5d801d6cf0c8a7568d5f1fb098836581116314a38675036d0aea1464009db8f4284ae3ea25c44f92550d61c5dcfb2619f9628ca3f40896bab095891b83ea172e8fca7c6f20401a8fbeb8cdbaf840dde36494296456e8b82c0f5e545b2fdd82918e0a5c0eb04d0ccb7bfc5174d90d1c5966048c650a24176bc7d793d94da9a971716736350229f4d9f65f322c21afe7278ed57961c693041ab74fa65cbfe39227d9a04a150a48ae0f672d4e94f5de18cee165856acfebd35e643b27c74fd83ae6fab1927ff957451d8131fabfd12d65cd5cff6d381a604bbfcc0ebd4a262ea0f9c837844ac96beefebcdcdf95f11eb4993547dddaaba997b1643bb2715c70b11ea756ce4bc6c948018573e687d';
  await expect(decryptBackupPhrase(current, 'test-password')).resolves.toBe(mnemonic);
  await expect(decryptBackupPhrase(triplesec, 'test-password')).resolves.toBe(mnemonic);
  await expect(decryptBackupPhrase(triplesec, 'wrong-password')).rejects.toThrow();
  const encrypted = await encryptBackupPhrase(mnemonic, 'test-password');
  await expect(decryptBackupPhrase(encrypted, 'test-password')).resolves.toBe(mnemonic);
});

test('authenticates Gaia storage and replaces a previous session', async () => {
  for (const key of ['1'.repeat(64), '2'.repeat(64)]) {
    const user = await gaiaAuth(network, key, 'https://hub.example.com');
    expect(user.appPrivateKey).toBe(key);
    expect(gaiaStorage.userSession.loadUserData().appPrivateKey).toBe(key);
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

test('keeps legacy name lookup paths and not-found errors', async () => {
  fetchMock.mockResponseOnce(JSON.stringify({ address: '1Nwxfx7VoYAg2mEN35dTRw4H7gte8ajFki' }));
  await expect(network.getNameInfo('example.id')).resolves.toMatchObject({
    address: '1Nwxfx7VoYAg2mEN35dTRw4H7gte8ajFki',
  });
  expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/v1/names/example.id');
  fetchMock.mockResponseOnce('', { status: 404 });
  await expect(network.getNameInfo('missing.id')).rejects.toThrow('Name not found');
});
