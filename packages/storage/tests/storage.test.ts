import { AppConfig, LOCALSTORAGE_SESSION_KEY, UserData, UserSession } from '@stacks/auth';
import {
  bytesToUtf8,
  DoesNotExist,
  getAesCbcOutputLength,
  getBase64OutputLength,
  hexToBytes,
  HIRO_MAINNET_URL,
  utf8ToBytes,
} from '@stacks/common';
import {
  aes256CbcEncrypt,
  eciesGetJsonStringLength,
  getPublicKeyFromPrivate,
  hashSha256Sync,
  verifySignature,
} from '@stacks/encryption';
import { createFetchFn } from '@stacks/common';
import { base64 } from '@scure/base';
import * as crypto from 'crypto';
import fetchMock from 'jest-fetch-mock';
import * as jsdom from 'jsdom';
import { decodeToken, TokenSigner, TokenVerifier } from 'jsontokens';
import * as util from 'util';
import {
  connectToGaiaHub,
  deleteFromGaiaHub,
  GaiaHubConfig,
  getBucketUrl,
  getFullReadUrl,
  getUserAppFileUrl,
  Storage,
  uploadToGaiaHub,
} from '../src';

beforeEach(() => {
  fetchMock.resetMocks();
  jest.resetModules();
});

test('deleteFile', async () => {
  const path = 'file.json';
  const gaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'gaia.testblockstack.org/hub/',
  };

  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = {
    gaiaHubConfig,
  } as any;

  const deleteFromGaiaHub = jest.fn();
  jest.mock('../src/hub', () => ({
    deleteFromGaiaHub,
  }));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Storage } = require('../src');
  const storage = new Storage({ userSession });

  const success = jest.fn();
  const options = { wasSigned: false };
  await storage.deleteFile(path, options).then(success);

  expect(success).toHaveBeenCalled();
  expect(deleteFromGaiaHub).toHaveBeenCalledTimes(1);
});

test('deleteFile gets a new gaia config and tries again', async () => {
  const path = 'file.txt';
  const fullDeleteUrl =
    'https://hub.testblockstack.org/delete/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yabc/file.txt';
  const invalidHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yabc',
    server: 'https://hub.testblockstack.org',
    token: '',
    url_prefix: 'https://gaia.testblockstack.org/hub/',
  };
  const validHubConfig = Object.assign({}, invalidHubConfig, {
    token: 'valid',
  });

  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    gaiaHubConfig: invalidHubConfig,
    hubUrl: 'https://hub.testblockstack.org',
  };

  const connectToGaiaHub = jest.fn(() => validHubConfig);
  jest.mock('../src/hub', () => ({
    connectToGaiaHub,
    deleteFromGaiaHub: jest.requireActual('../src/hub').deleteFromGaiaHub,
  }));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Storage } = require('../src');
  const storage = new Storage({ userSession });

  fetchMock
    .mockResponseOnce('fail', {
      status: 401,
    })
    .mockResponseOnce('{}', {
      status: 202,
    });

  const success = jest.fn();

  await storage.deleteFile(path, {}).then(success);

  expect(success).toHaveBeenCalled();
  expect(connectToGaiaHub).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1]!.method).toEqual('DELETE');
  expect(fetchMock.mock.calls[0][1]!.headers).toEqual({ Authorization: 'bearer ' });
  expect(fetchMock.mock.calls[1][1]!.method).toEqual('DELETE');
  expect(fetchMock.mock.calls[1][1]!.headers).toEqual({ Authorization: 'bearer valid' });
  expect(fetchMock.mock.calls[1][0]).toEqual(fullDeleteUrl);
});

test('deleteFile wasSigned deletes signature file', async () => {
  const path = 'file.json';
  const fullDeleteUrl =
    'https://hub.testblockstack.org/delete/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yabc/file.json';
  const fullDeleteSigUrl =
    'https://hub.testblockstack.org/delete/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yabc/file.json.sig';
  const hubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yabc',
    server: 'https://hub.testblockstack.org',
    url_prefix: 'https://gaia.testblockstack.org/hub/',
  };
  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    gaiaHubConfig: hubConfig,
  };

  fetchMock.mockResponse('', {
    status: 202,
  });

  const storage = new Storage({ userSession });
  await storage.deleteFile(path, { wasSigned: true });

  expect(fetchMock.mock.calls.length).toEqual(2);
  expect(fetchMock.mock.calls[0][1]!.method).toEqual('DELETE');
  expect(fetchMock.mock.calls[0][0]).toEqual(fullDeleteUrl);
  expect(fetchMock.mock.calls[1][1]!.method).toEqual('DELETE');
  expect(fetchMock.mock.calls[1][0]).toEqual(fullDeleteSigUrl);
});

test('deleteFile throw on 404', async () => {
  const path = 'missingfile.txt';
  const fullDeleteUrl =
    'https://hub.testblockstack.org/delete/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yabc/missingfile.txt';
  const hubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yabc',
    server: 'https://hub.testblockstack.org',
    url_prefix: 'https://gaia.testblockstack.org/hub/',
  };
  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    gaiaHubConfig: hubConfig,
  };

  fetchMock.once('', {
    status: 404,
  });

  const error = jest.fn();
  const storage = new Storage({ userSession });

  await storage
    .deleteFile(path, { wasSigned: false })
    .then(() => fail('deleteFile with 404 should fail'))
    .catch(error);

  expect(error).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1]!.method).toEqual('DELETE');
  expect(fetchMock.mock.calls[0][0]).toEqual(fullDeleteUrl);
});

test('deleteFile removes etag from map', async () => {
  const path = 'file.json';
  const gaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'gaia.testblockstack.org/hub/',
  };

  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    gaiaHubConfig,
  };

  const fileContent = 'test-content';
  const testEtag = 'test-etag';

  const putOptions = { encrypt: false };

  const deleteOptions = { wasSigned: false };

  const uploadToGaiaHub = jest
    .fn()
    .mockResolvedValue(JSON.stringify({ publicURL: 'url', etag: testEtag }));
  const deleteFromGaiaHub = jest.fn();
  jest.mock('../src/hub', () => ({
    uploadToGaiaHub,
    deleteFromGaiaHub,
  }));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Storage } = require('../src');
  const storage = new Storage({ userSession });

  fetchMock.mockResponse('', {
    status: 202,
  });

  // create file and save etag
  await storage.putFile(path, fileContent, putOptions);

  // delete file
  await storage.deleteFile(path, deleteOptions);

  // create same file
  await storage.putFile(path, fileContent, putOptions);

  expect(uploadToGaiaHub).toHaveBeenCalledTimes(2);
  expect(uploadToGaiaHub.mock.calls[0][4]).toEqual(true);
  expect(uploadToGaiaHub.mock.calls[0][5]).toEqual(undefined);
  expect(uploadToGaiaHub.mock.calls[1][4]).toEqual(true);
  expect(uploadToGaiaHub.mock.calls[1][5]).toEqual(undefined);
});

test('Concurrent calls to deleteFile should delete etags in localStorage', async () => {
  const dom = new jsdom.JSDOM('', { url: 'https://example.org/' }).window;
  const globalAPIs: { [key: string]: any } = {
    localStorage: dom.localStorage,
    location: dom.location,
    self: dom,
  };

  for (const globalAPI of Object.keys(globalAPIs)) {
    (global as any)[globalAPI] = globalAPIs[globalAPI];
  }

  const privateKey = '896adae13a1bf88db0b2ec94339b62382ec6f34cd7e2ff8abae7ec271e05f9d8';
  const gaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'gaia.testblockstack.org/hub/',
  };
  const appConfig = new AppConfig();
  const userSession = new UserSession({ appConfig });
  const session = userSession.store.getSessionData();
  session.userData = <any>{
    gaiaHubConfig,
    appPrivateKey: privateKey,
  };
  userSession.store.setSessionData(session);

  const files = ['a.json', 'b.json', 'c.json', 'd.json'];
  const fullReadUrl =
    'https://gaia.testblockstack.org/hub/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U/file.json';
  const uploadToGaiaHub = jest.fn().mockResolvedValue({
    publicURL: fullReadUrl,
    etag: 'test-tag',
  });
  const deleteFromGaiaHub = jest.fn();

  jest.mock('../src/hub', () => ({
    uploadToGaiaHub,
    deleteFromGaiaHub,
  }));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Storage } = require('../src');
  const storage = new Storage({ userSession });

  for (let i = 0; i < files.length; i++) {
    const myData = JSON.stringify({
      hello: `hello-${i}`,
      num: i,
    });
    await storage.putFile(files[i], myData, { encrypt: false });
  }

  fetchMock.mockResponse('', {
    status: 202,
  });

  const promises = [];
  for (let i = 0; i < files.length; i++) {
    // Concurrent calls to deleteFile without await should delete etags
    // Assuming deleting multiple files at once using parallel network calls
    promises.push(storage.deleteFile(files[i]));
  }
  await Promise.all(promises);
  const sessionData = userSession.store.getSessionData();
  const sessionFromLocalStore = JSON.parse(localStorage.getItem(LOCALSTORAGE_SESSION_KEY) || '{}');
  const expectedEtags = {};

  expect(sessionData.etags).toEqual(expectedEtags);
  expect(sessionFromLocalStore.etags).toEqual(expectedEtags);

  for (const globalAPI of Object.keys(globalAPIs)) {
    delete (global as any)[globalAPI];
  }
});

test('getFile unencrypted, unsigned', async () => {
  const path = 'file.json';
  const gaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'https://gaia.testblockstack.org/hub/',
  };

  // const fullReadUrl = 'https://gaia.testblockstack.org/hub/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U/file.json'
  const fileContent = { test: 'test' };

  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    gaiaHubConfig,
  }; // manually set private key for testing

  fetchMock.mockResponse(JSON.stringify(fileContent));
  const storage = new Storage({ userSession });
  const options = { decrypt: false };
  const file = await storage.getFile(path, options);
  expect(file).toBeTruthy();
  expect(JSON.parse(<string>file)).toEqual(fileContent);
});

test('getFile without user session', async () => {
  const path = 'file.json';
  const appConfig = new AppConfig(['store_write'], 'http://localhost:8080');
  const appSpecifiedCoreNode = 'https://app-specified-core-node.local';
  const userSession = new UserSession({ appConfig });
  userSession.appConfig.coreNode = appSpecifiedCoreNode;
  // userData is undefined in userSession so that userSession.appConfig.coreNode is used
  const nameRecord = {
    status: 'registered',
    zonefile:
      '$ORIGIN yukan.id\n$TTL 3600\n_http._tcp URI 10 1 "https://gaia.blockstack.org/hub/16zVUoP7f15nfTiHw2UNiX8NT5SWYqwNv3/0/profile.json"\n',
    expire_block: 581432,
    blockchain: 'bitcoin',
    last_txid: 'f7fa811518566b1914a098c3bd61a810aee56390815bd608490b0860ac1b5b4d',
    address: 'SP10VG75GE4PE0VBA3KD3NVKSYEMM3YV9V17HJ32N',
    zonefile_hash: '98f42e11026d42d394b3424d4d7f0cccd6f376e2',
  };
  const nameRecordContent = JSON.stringify(nameRecord);

  // const profileUrl = 'https://gaia.blockstack.org/hub/16zVUoP7f15nfTiHw2UNiX8NT5SWYqwNv3/0/profile.json'

  /* eslint-disable */
  const profileContent = [
    {
      token:
        'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NksifQ.eyJqdGkiOiJjNDhmOTQ0OC1hMGZlLTRiOWUtOWQ2YS1mYzA5MzhjOGUyNzAiLCJpYXQiOiIyMDE4LTAxLTA4VDE4OjIyOjI0Ljc5NloiLCJleHAiOiIyMDE5LTAxLTA4VDE4OjIyOjI0Ljc5NloiLCJzdWJqZWN0Ijp7InB1YmxpY0tleSI6IjAyNDg3YTkxY2Q5NjZmYWVjZWUyYWVmM2ZkZTM3MjgwOWI0NmEzNmVlMTkyNDhjMDFmNzJiNjQ1ZjQ0Y2VmMmUyYyJ9LCJpc3N1ZXIiOnsicHVibGljS2V5IjoiMDI0ODdhOTFjZDk2NmZhZWNlZTJhZWYzZmRlMzcyODA5YjQ2YTM2ZWUxOTI0OGMwMWY3MmI2NDVmNDRjZWYyZTJjIn0sImNsYWltIjp7IkB0eXBlIjoiUGVyc29uIiwiQGNvbnRleHQiOiJodHRwOi8vc2NoZW1hLm9yZyIsImltYWdlIjpbeyJAdHlwZSI6IkltYWdlT2JqZWN0IiwibmFtZSI6ImF2YXRhciIsImNvbnRlbnRVcmwiOiJodHRwczovL3d3dy5kcm9wYm94LmNvbS9zL2oxaDBrdHMwbTdhYWRpcC9hdmF0YXItMD9kbD0xIn1dLCJnaXZlbk5hbWUiOiIiLCJmYW1pbHlOYW1lIjoiIiwiZGVzY3JpcHRpb24iOiIiLCJhY2NvdW50IjpbeyJAdHlwZSI6IkFjY291bnQiLCJwbGFjZWhvbGRlciI6ZmFsc2UsInNlcnZpY2UiOiJoYWNrZXJOZXdzIiwiaWRlbnRpZmllciI6Inl1a2FubCIsInByb29mVHlwZSI6Imh0dHAiLCJwcm9vZlVybCI6Imh0dHBzOi8vbmV3cy55Y29tYmluYXRvci5jb20vdXNlcj9pZD15dWthbmwifSx7IkB0eXBlIjoiQWNjb3VudCIsInBsYWNlaG9sZGVyIjpmYWxzZSwic2VydmljZSI6ImdpdGh1YiIsImlkZW50aWZpZXIiOiJ5a25sIiwicHJvb2ZUeXBlIjoiaHR0cCIsInByb29mVXJsIjoiaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20veWtubC8xZjcwMThiOThmNzE2ZjAxNWE2Y2Y0NGZkYTA4MDZkNyJ9LHsiQHR5cGUiOiJBY2NvdW50IiwicGxhY2Vob2xkZXIiOmZhbHNlLCJzZXJ2aWNlIjoidHdpdHRlciIsImlkZW50aWZpZXIiOiJ5dWthbmwiLCJwcm9vZlR5cGUiOiJodHRwIiwicHJvb2ZVcmwiOiJodHRwczovL3R3aXR0ZXIuY29tL3l1a2FuTC9zdGF0dXMvOTE2NzQwNzQ5MjM2MTAxMTIwIn1dLCJuYW1lIjoiS2VuIExpYW8iLCJhcHBzIjp7Imh0dHA6Ly9sb2NhbGhvc3Q6ODA4MCI6Imh0dHBzOi8vZ2FpYS5ibG9ja3N0YWNrLm9yZy9odWIvMUREVXFmS3RRZ1lOdDcyMnd1QjRaMmZQQzdhaU5HUWE1Ui8ifX19.UyQNZ02kBFHEovbwiGaS-VQd57w9kcwn1Nt3QbW3afEMArg1OndmeplB7lzjMuRCLAi-88lkpQLkFw7LwKZ31Q',
      decodedToken: {
        header: {
          typ: 'JWT',
          alg: 'ES256K',
        },
        payload: {
          jti: 'c48f9448-a0fe-4b9e-9d6a-fc0938c8e270',
          iat: '2018-01-08T18:22:24.796Z',
          exp: '2019-01-08T18:22:24.796Z',
          subject: {
            publicKey: '02487a91cd966faecee2aef3fde372809b46a36ee19248c01f72b645f44cef2e2c',
          },
          issuer: {
            publicKey: '02487a91cd966faecee2aef3fde372809b46a36ee19248c01f72b645f44cef2e2c',
          },
          claim: {
            '@type': 'Person',
            '@context': 'http://schema.org',
            image: [
              {
                '@type': 'ImageObject',
                name: 'avatar',
                contentUrl: 'https://www.dropbox.com/s/j1h0kts0m7aadip/avatar-0?dl=1',
              },
            ],
            givenName: '',
            familyName: '',
            description: '',
            account: [
              {
                '@type': 'Account',
                placeholder: false,
                service: 'hackerNews',
                identifier: 'yukanl',
                proofType: 'http',
                proofUrl: 'https://news.ycombinator.com/user?id=yukanl',
              },
              {
                '@type': 'Account',
                placeholder: false,
                service: 'github',
                identifier: 'yknl',
                proofType: 'http',
                proofUrl: 'https://gist.github.com/yknl/1f7018b98f716f015a6cf44fda0806d7',
              },
              {
                '@type': 'Account',
                placeholder: false,
                service: 'twitter',
                identifier: 'yukanl',
                proofType: 'http',
                proofUrl: 'https://twitter.com/yukanL/status/916740749236101120',
              },
            ],
            name: 'Ken Liao',
            apps: {
              'http://localhost:8080':
                'https://gaia.blockstack.org/hub/1DDUqfKtQgYNt722wuB4Z2fPC7aiNGQa5R/',
            },
          },
        },
        signature:
          'UyQNZ02kBFHEovbwiGaS-VQd57w9kcwn1Nt3QbW3afEMArg1OndmeplB7lzjMuRCLAi-88lkpQLkFw7LwKZ31Q',
      },
    },
  ];
  /* eslint-enable */

  // const fileUrl = 'https://gaia.blockstack.org/hub/1DDUqfKtQgYNt722wuB4Z2fPC7aiNGQa5R/file.json'
  const fileContents = JSON.stringify({ key: 'value' });

  const options = {
    username: 'yukan.id',
    app: 'http://localhost:8080',
    decrypt: false,
  };
  fetchMock.once(nameRecordContent).once(JSON.stringify(profileContent)).once(fileContents);

  const storage = new Storage({ userSession });

  await storage.getFile(path, options).then(file => {
    expect(file).toBeTruthy();
    expect(JSON.parse(<string>file)).toEqual(JSON.parse(fileContents));
  });
});

test('core node preferences respected for name lookups', async () => {
  const path = 'file.json';
  const gaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'https://gaia.testblockstack.org/hub/',
  };

  const appConfig = new AppConfig(['store_write'], 'http://localhost:8080');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    gaiaHubConfig,
  };

  const appSpecifiedCoreNode = 'https://app-specified-core-node.local';
  const userSpecifiedCoreNode = 'https://user-specified-core-node.local';

  const nameLookupPath = '/v1/names/yukan.id';

  const options = {
    username: 'yukan.id',
    app: 'http://localhost:8080',
    decrypt: false,
  };

  let storage = new Storage({ userSession });

  fetchMock.once('_');
  try {
    await storage.getFile(path, options);
  } catch {}
  expect(fetchMock.mock.calls[0][0]).toEqual(HIRO_MAINNET_URL + nameLookupPath);
  fetchMock.resetMocks();

  userSession.appConfig.coreNode = appSpecifiedCoreNode;
  storage = new Storage({ userSession });

  fetchMock.once('_');
  try {
    await storage.getFile(path, options);
  } catch {}
  expect(fetchMock.mock.calls[0][0]).toEqual(appSpecifiedCoreNode + nameLookupPath);
  fetchMock.resetMocks();

  userSession.store.getSessionData().userData!.coreNode = userSpecifiedCoreNode;
  storage = new Storage({ userSession });
  fetchMock.once('_');
  try {
    await storage.getFile(path, options);
  } catch {}
  expect(fetchMock.mock.calls[0][0]).toEqual(userSpecifiedCoreNode + nameLookupPath);
});

test('getFile unencrypted, unsigned - multi-reader', async () => {
  const path = 'file.json';
  const gaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'https://gaia.testblockstack.org/hub/',
  };

  const appConfig = new AppConfig(['store_write'], 'http://localhost:8080');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    gaiaHubConfig,
  };

  // const fullReadUrl = 'https://gaia.testblockstack.org/hub/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U/file.json'
  // const fileContent = { test: 'test' }

  // const nameLookupUrl = 'https://core.blockstack.org/v1/names/yukan.id'

  const nameRecord = {
    status: 'registered',
    zonefile:
      '$ORIGIN yukan.id\n$TTL 3600\n_http._tcp URI 10 1 "https://gaia.blockstack.org/hub/16zVUoP7f15nfTiHw2UNiX8NT5SWYqwNv3/0/profile.json"\n',
    expire_block: 581432,
    blockchain: 'bitcoin',
    last_txid: 'f7fa811518566b1914a098c3bd61a810aee56390815bd608490b0860ac1b5b4d',
    address: 'SP10VG75GE4PE0VBA3KD3NVKSYEMM3YV9V17HJ32N',
    zonefile_hash: '98f42e11026d42d394b3424d4d7f0cccd6f376e2',
  };
  const nameRecordContent = JSON.stringify(nameRecord);

  // const profileUrl = 'https://gaia.blockstack.org/hub/16zVUoP7f15nfTiHw2UNiX8NT5SWYqwNv3/0/profile.json'

  /* eslint-disable */
  const profileContent = [
    {
      token:
        'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NksifQ.eyJqdGkiOiJjNDhmOTQ0OC1hMGZlLTRiOWUtOWQ2YS1mYzA5MzhjOGUyNzAiLCJpYXQiOiIyMDE4LTAxLTA4VDE4OjIyOjI0Ljc5NloiLCJleHAiOiIyMDE5LTAxLTA4VDE4OjIyOjI0Ljc5NloiLCJzdWJqZWN0Ijp7InB1YmxpY0tleSI6IjAyNDg3YTkxY2Q5NjZmYWVjZWUyYWVmM2ZkZTM3MjgwOWI0NmEzNmVlMTkyNDhjMDFmNzJiNjQ1ZjQ0Y2VmMmUyYyJ9LCJpc3N1ZXIiOnsicHVibGljS2V5IjoiMDI0ODdhOTFjZDk2NmZhZWNlZTJhZWYzZmRlMzcyODA5YjQ2YTM2ZWUxOTI0OGMwMWY3MmI2NDVmNDRjZWYyZTJjIn0sImNsYWltIjp7IkB0eXBlIjoiUGVyc29uIiwiQGNvbnRleHQiOiJodHRwOi8vc2NoZW1hLm9yZyIsImltYWdlIjpbeyJAdHlwZSI6IkltYWdlT2JqZWN0IiwibmFtZSI6ImF2YXRhciIsImNvbnRlbnRVcmwiOiJodHRwczovL3d3dy5kcm9wYm94LmNvbS9zL2oxaDBrdHMwbTdhYWRpcC9hdmF0YXItMD9kbD0xIn1dLCJnaXZlbk5hbWUiOiIiLCJmYW1pbHlOYW1lIjoiIiwiZGVzY3JpcHRpb24iOiIiLCJhY2NvdW50IjpbeyJAdHlwZSI6IkFjY291bnQiLCJwbGFjZWhvbGRlciI6ZmFsc2UsInNlcnZpY2UiOiJoYWNrZXJOZXdzIiwiaWRlbnRpZmllciI6Inl1a2FubCIsInByb29mVHlwZSI6Imh0dHAiLCJwcm9vZlVybCI6Imh0dHBzOi8vbmV3cy55Y29tYmluYXRvci5jb20vdXNlcj9pZD15dWthbmwifSx7IkB0eXBlIjoiQWNjb3VudCIsInBsYWNlaG9sZGVyIjpmYWxzZSwic2VydmljZSI6ImdpdGh1YiIsImlkZW50aWZpZXIiOiJ5a25sIiwicHJvb2ZUeXBlIjoiaHR0cCIsInByb29mVXJsIjoiaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20veWtubC8xZjcwMThiOThmNzE2ZjAxNWE2Y2Y0NGZkYTA4MDZkNyJ9LHsiQHR5cGUiOiJBY2NvdW50IiwicGxhY2Vob2xkZXIiOmZhbHNlLCJzZXJ2aWNlIjoidHdpdHRlciIsImlkZW50aWZpZXIiOiJ5dWthbmwiLCJwcm9vZlR5cGUiOiJodHRwIiwicHJvb2ZVcmwiOiJodHRwczovL3R3aXR0ZXIuY29tL3l1a2FuTC9zdGF0dXMvOTE2NzQwNzQ5MjM2MTAxMTIwIn1dLCJuYW1lIjoiS2VuIExpYW8iLCJhcHBzIjp7Imh0dHA6Ly9sb2NhbGhvc3Q6ODA4MCI6Imh0dHBzOi8vZ2FpYS5ibG9ja3N0YWNrLm9yZy9odWIvMUREVXFmS3RRZ1lOdDcyMnd1QjRaMmZQQzdhaU5HUWE1Ui8ifX19.UyQNZ02kBFHEovbwiGaS-VQd57w9kcwn1Nt3QbW3afEMArg1OndmeplB7lzjMuRCLAi-88lkpQLkFw7LwKZ31Q',
      decodedToken: {
        header: {
          typ: 'JWT',
          alg: 'ES256K',
        },
        payload: {
          jti: 'c48f9448-a0fe-4b9e-9d6a-fc0938c8e270',
          iat: '2018-01-08T18:22:24.796Z',
          exp: '2019-01-08T18:22:24.796Z',
          subject: {
            publicKey: '02487a91cd966faecee2aef3fde372809b46a36ee19248c01f72b645f44cef2e2c',
          },
          issuer: {
            publicKey: '02487a91cd966faecee2aef3fde372809b46a36ee19248c01f72b645f44cef2e2c',
          },
          claim: {
            '@type': 'Person',
            '@context': 'http://schema.org',
            image: [
              {
                '@type': 'ImageObject',
                name: 'avatar',
                contentUrl: 'https://www.dropbox.com/s/j1h0kts0m7aadip/avatar-0?dl=1',
              },
            ],
            givenName: '',
            familyName: '',
            description: '',
            account: [
              {
                '@type': 'Account',
                placeholder: false,
                service: 'hackerNews',
                identifier: 'yukanl',
                proofType: 'http',
                proofUrl: 'https://news.ycombinator.com/user?id=yukanl',
              },
              {
                '@type': 'Account',
                placeholder: false,
                service: 'github',
                identifier: 'yknl',
                proofType: 'http',
                proofUrl: 'https://gist.github.com/yknl/1f7018b98f716f015a6cf44fda0806d7',
              },
              {
                '@type': 'Account',
                placeholder: false,
                service: 'twitter',
                identifier: 'yukanl',
                proofType: 'http',
                proofUrl: 'https://twitter.com/yukanL/status/916740749236101120',
              },
            ],
            name: 'Ken Liao',
            apps: {
              'http://localhost:8080':
                'https://gaia.blockstack.org/hub/1DDUqfKtQgYNt722wuB4Z2fPC7aiNGQa5R/',
            },
          },
        },
        signature:
          'UyQNZ02kBFHEovbwiGaS-VQd57w9kcwn1Nt3QbW3afEMArg1OndmeplB7lzjMuRCLAi-88lkpQLkFw7LwKZ31Q',
      },
    },
  ];
  /* eslint-enable */

  // const fileUrl = 'https://gaia.blockstack.org/hub/1DDUqfKtQgYNt722wuB4Z2fPC7aiNGQa5R/file.json'
  const fileContents = JSON.stringify({ key: 'value' });

  const options = {
    username: 'yukan.id',
    app: 'http://localhost:8080',
    decrypt: false,
  };

  fetchMock.once(nameRecordContent).once(JSON.stringify(profileContent)).once(fileContents);

  const storage = new Storage({ userSession });

  await storage.getFile(path, options).then(file => {
    expect(file).toBeTruthy();
    expect(JSON.parse(<string>file)).toEqual(JSON.parse(fileContents));
  });

  const optionsNameLookupUrl = {
    username: 'yukan.id',
    app: 'http://localhost:8080',
    zoneFileLookupURL: 'https://potato/v1/names',
    decrypt: false,
  };

  fetchMock.resetMocks();
  fetchMock.once(nameRecordContent).once(JSON.stringify(profileContent)).once(fileContents);

  await storage.getFile(path, optionsNameLookupUrl).then(file => {
    expect(file).toBeTruthy();
    expect(JSON.parse(<string>file)).toEqual(JSON.parse(fileContents));
  });

  const optionsNoApp = {
    username: 'yukan.id',
    decrypt: false,
  };

  fetchMock.resetMocks();
  fetchMock.once(nameRecordContent).once(JSON.stringify(profileContent)).once(fileContents);

  await storage.getFile(path, optionsNoApp).then(file => {
    expect(file).toBeTruthy();
    expect(JSON.parse(<string>file)).toEqual(JSON.parse(fileContents));
  });
});

test('encrypt & decrypt content', async () => {
  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    appPrivateKey: privateKey,
  }; // manually set private key for testing

  const content = 'yellowsubmarine';
  const ciphertext = await userSession.encryptContent(content);
  expect(ciphertext).toBeTruthy();
  const deciphered = await userSession.decryptContent(ciphertext);
  expect(deciphered).toEqual(content);
});

test('encrypt & decrypt content -- specify key', async () => {
  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{};
  const privateKey = '896adae13a1bf88db0b2ec94339b62382ec6f34cd7e2ff8abae7ec271e05f9d8';
  const publicKey = getPublicKeyFromPrivate(privateKey);
  const content = 'we-all-live-in-a-yellow-submarine';
  const ciphertext = await userSession.encryptContent(content, { publicKey });
  expect(ciphertext).toBeTruthy();
  const deciphered = await userSession.decryptContent(ciphertext, { privateKey });
  expect(deciphered).toEqual(content);
});

test('putFile unencrypted, using Blob content', async () => {
  const path = 'file.json';
  const gaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'gaia.testblockstack.org/hub/',
  };

  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    gaiaHubConfig,
  };

  const dom = new jsdom.JSDOM('', {}).window;
  const globalAPIs: { [key: string]: any } = {
    File: dom.File,
    Blob: dom.Blob,
    FileReader: (dom as any).FileReader as FileReader,
  };
  for (const globalAPI of Object.keys(globalAPIs)) {
    (global as any)[globalAPI] = globalAPIs[globalAPI];
  }
  try {
    const fileContent = new dom.File(['file content test'], 'filenametest.txt', {
      type: 'text/example',
    });
    const fullReadUrl =
      'https://gaia.testblockstack.org/hub/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U/file.json';

    const options = { encrypt: false };

    const uploadToGaiaHub = jest.fn().mockResolvedValue({
      publicURL: fullReadUrl,
    });
    jest.mock('../src/hub', () => ({
      uploadToGaiaHub,
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Storage } = require('../src');
    const storage = new Storage({ userSession });

    const publicURL = await storage.putFile(path, fileContent, options);
    expect(publicURL).toEqual(fullReadUrl);
    expect(uploadToGaiaHub.mock.calls[0][3]).toEqual('text/example');
  } finally {
    for (const globalAPI of Object.keys(globalAPIs)) {
      delete (global as any)[globalAPI];
    }
  }
});

test('putFile encrypted, using Blob content, encrypted', async () => {
  const dom = new jsdom.JSDOM('', {}).window;
  const globalAPIs: { [key: string]: any } = {
    File: dom.File,
    Blob: dom.Blob,
    FileReader: (dom as any).FileReader as FileReader,
  };
  for (const globalAPI of Object.keys(globalAPIs)) {
    (global as any)[globalAPI] = globalAPIs[globalAPI];
  }
  try {
    const contentDataString = 'file content test';
    const fileContent = new dom.File([contentDataString], 'filenametest.txt', {
      type: 'text/example',
    });

    const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
    const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
    const userSession = new UserSession({ appConfig });

    const path = 'file.json';
    const gaiaHubConfig = {
      address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
      server: 'https://hub.blockstack.org',
      token: '',
      url_prefix: 'https://gaia.testblockstack.org/hub/',
    };

    userSession.store.getSessionData().userData = <any>{
      appPrivateKey: privateKey,
      gaiaHubConfig,
    }; // manually set private key for testing

    const fullReadUrl =
      'https://gaia.testblockstack.org/hub/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8A/file.json';

    const uploadToGaiaHub = jest.fn().mockResolvedValue({
      publicURL: fullReadUrl,
    });
    const getFullReadUrl = jest.fn().mockResolvedValue(fullReadUrl);
    jest.mock('../src/hub', () => ({
      uploadToGaiaHub,
      getFullReadUrl,
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Storage } = require('../src');
    const storage = new Storage({ userSession });

    const encryptOptions = { encrypt: true };
    const decryptOptions = { decrypt: true };
    // put and encrypt the file
    const publicURL = await storage.putFile(path, fileContent, encryptOptions);
    expect(publicURL).toEqual(fullReadUrl);
    const encryptedContent = uploadToGaiaHub.mock.calls[0][1];
    fetchMock.once(encryptedContent);
    const readContent = await storage.getFile(path, decryptOptions);
    expect(bytesToUtf8(readContent)).toEqual(contentDataString);
  } finally {
    for (const globalAPI of Object.keys(globalAPIs)) {
      delete (global as any)[globalAPI];
    }
  }
});

test('putFile unencrypted, using TypedArray content, encrypted', async () => {
  try {
    const contentDataString = 'file content test1234567';
    const textEncoder = new util.TextEncoder();
    const encodedArray = textEncoder.encode(contentDataString);
    const fileContent = new Uint32Array(encodedArray.buffer);

    const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
    const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
    const userSession = new UserSession({ appConfig });

    const path = 'file.json';
    const gaiaHubConfig = {
      address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
      server: 'https://hub.blockstack.org',
      token: '',
      url_prefix: 'https://gaia.testblockstack.org/hub/',
    };

    userSession.store.getSessionData().userData = <any>{
      appPrivateKey: privateKey,
      gaiaHubConfig,
    }; // manually set private key for testing

    const fullReadUrl =
      'https://gaia.testblockstack.org/hub/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8A/file.json';

    const uploadToGaiaHub = jest.fn().mockResolvedValue({
      publicURL: fullReadUrl,
    });
    const getFullReadUrl = jest.fn().mockResolvedValue(fullReadUrl);
    jest.mock('../src/hub', () => ({
      uploadToGaiaHub,
      getFullReadUrl,
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Storage } = require('../src');
    const storage = new Storage({ userSession });

    const encryptOptions = { encrypt: false, contentType: 'text/plain; charset=utf-8' };
    const decryptOptions = { decrypt: false };
    // put and encrypt the file
    const publicURL = await storage.putFile(path, fileContent, encryptOptions);
    const postedContent = uploadToGaiaHub.mock.calls[0][1];
    expect(publicURL).toEqual(fullReadUrl);
    fetchMock.once(postedContent, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
    const readContent = await storage.getFile(path, decryptOptions);
    expect(readContent).toEqual(contentDataString);
  } finally {
  }
});

test('putFile encrypted, using TypedArray content, encrypted', async () => {
  try {
    const contentDataString = 'file content test1234567';
    const textEncoder = new util.TextEncoder();
    const encodedArray = textEncoder.encode(contentDataString);
    const fileContent = new Uint32Array(encodedArray.buffer);

    const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
    const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
    const userSession = new UserSession({ appConfig });

    const path = 'file.json';
    const gaiaHubConfig = {
      address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
      server: 'https://hub.blockstack.org',
      token: '',
      url_prefix: 'https://gaia.testblockstack.org/hub/',
    };

    userSession.store.getSessionData().userData = <any>{
      appPrivateKey: privateKey,
      gaiaHubConfig,
    }; // manually set private key for testing

    const fullReadUrl =
      'https://gaia.testblockstack.org/hub/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8A/file.json';

    const uploadToGaiaHub = jest.fn().mockResolvedValue({
      publicURL: fullReadUrl,
    });
    const getFullReadUrl = jest.fn().mockResolvedValue(fullReadUrl);
    jest.mock('../src/hub', () => ({
      uploadToGaiaHub,
      getFullReadUrl,
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Storage } = require('../src');
    const storage = new Storage({ userSession });

    const encryptOptions = { encrypt: true };
    const decryptOptions = { decrypt: true };
    // put and encrypt the file
    const publicURL = await storage.putFile(path, fileContent, encryptOptions);
    expect(publicURL).toEqual(fullReadUrl);
    const encryptedContent = uploadToGaiaHub.mock.calls[0][1];
    fetchMock.once(encryptedContent);
    const readContent = await storage.getFile(path, decryptOptions);
    expect(bytesToUtf8(readContent)).toEqual(contentDataString);
  } finally {
  }
});

test('putFile unencrypted, not signed', async () => {
  const path = 'file.json';
  const gaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'gaia.testblockstack.org/hub/',
  };

  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    gaiaHubConfig,
  };

  const fullReadUrl =
    'https://gaia.testblockstack.org/hub/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U/file.json';
  const fileContent = JSON.stringify({ test: 'test' });

  const uploadToGaiaHub = jest.fn().mockResolvedValue({
    publicURL: fullReadUrl,
  });
  jest.mock('../src/hub', () => ({
    uploadToGaiaHub,
  }));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Storage } = require('../src');
  const storage = new Storage({ userSession });
  const options = { encrypt: false };

  await storage.putFile(path, fileContent as any, options).then((publicURL: string) => {
    expect(publicURL).toEqual(fullReadUrl);
  });
});

test('putFile passes etag to upload function', async () => {
  const path = 'file.json';
  const gaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'gaia.testblockstack.org/hub/',
  };

  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    gaiaHubConfig,
  };

  const fileContent = 'test-content';
  const testEtag = 'test-etag';
  const options = { encrypt: false };

  const uploadToGaiaHub = jest.fn().mockResolvedValue({
    publicURL: 'url',
    etag: testEtag,
  });
  jest.mock('../src/hub', () => ({
    uploadToGaiaHub,
  }));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Storage } = require('../src');
  const storage = new Storage({ userSession });

  // create file and save etag
  await storage.putFile(path, fileContent, options);
  // update file, using saved etag
  await storage.putFile(path, fileContent, options);

  // test that saved etag was passed to upload function
  expect(uploadToGaiaHub.mock.calls[1][4]).toEqual(false);
  expect(uploadToGaiaHub.mock.calls[1][5]).toEqual(testEtag);
});

test('putFile includes If-None-Match header in request when creating a new file', async () => {
  const path = 'file.json';
  const gaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'gaia.testblockstack.org/hub/',
  };

  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    gaiaHubConfig,
  };

  const fileContent = 'test-content';
  const options = { encrypt: false };

  // const storeURL = `${gaiaHubConfig.server}/store/${gaiaHubConfig.address}/${path}`
  fetchMock.once('{}', {
    status: 202,
  });

  const storage = new Storage({ userSession });
  // create new file
  await storage.putFile(path, fileContent, options);
  const headers: any = fetchMock.mock.calls[0][1]!.headers;
  expect(headers['If-None-Match']).toEqual('*');
});

test('putFile throws correct error when server rejects etag', async () => {
  const path = 'file.json';
  const gaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'gaia.testblockstack.org/hub/',
  };

  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    gaiaHubConfig,
  };

  try {
    const content = 'test-content';
    // const storeURL = `${gaiaHubConfig.server}/store/${gaiaHubConfig.address}/${path}`

    // Mock a PreconditionFailedError
    fetchMock.once('Precondition Failed', {
      status: 412,
    });

    const storage = new Storage({ userSession });
    const options = { encrypt: false };

    await storage.putFile(path, content, options);
  } catch (err: any) {
    expect(err.code).toEqual('precondition_failed_error');
  }
});

test('putFile & getFile unencrypted, not signed, with contentType', async () => {
  const path = 'file.html';
  const gaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'https://gaia.testblockstack.org/hub/',
  };

  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    gaiaHubConfig,
  };

  const fullReadUrl =
    'https://gaia.testblockstack.org/hub/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U/file.html';
  const fileContent =
    '<!DOCTYPE html><html><head><title>Title</title></head><body>Blockstack</body></html>';

  // const uploadToGaiaHub = sinon.stub().resolves({ publicURL: fullReadUrl }) // eslint-disable-line no-shadow

  // const putFile = proxyquire('../../../src/storage', {
  //   './hub': { uploadToGaiaHub }
  // }).putFile as typeof import('../../../src/storage').putFile

  const uploadToGaiaHub = jest.fn().mockResolvedValue({
    publicURL: fullReadUrl,
  });
  jest.mock('../src/hub', () => ({
    uploadToGaiaHub,
    getFullReadUrl: jest.requireActual('../src/hub').getFullReadUrl,
  }));

  fetchMock.mockResponse(JSON.stringify(fileContent), {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Storage } = require('../src');
  const storage = new Storage({ userSession });

  const options = { encrypt: false, contentType: 'text/html' };
  await storage
    .putFile(path, fileContent, options)
    .then((publicURL: string) => {
      expect(publicURL).toBeTruthy();
    })
    .then(() => {
      const decryptOptions = { decrypt: false };
      return storage.getFile(path, decryptOptions).then((readContent: any) => {
        expect(readContent).toEqual(JSON.stringify(fileContent));
        expect(typeof readContent).toEqual('string');
      });
    });
});

test('putFile & getFile encrypted, not signed', async () => {
  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });

  const path = 'file.json';
  const gaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'https://gaia.testblockstack.org/hub/',
  };

  userSession.store.getSessionData().userData = <any>{
    appPrivateKey: privateKey,
    gaiaHubConfig,
  }; // manually set private key for testing

  const fullReadUrl =
    'https://gaia.testblockstack.org/hub/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8A/file.json';
  const fileContent = JSON.stringify({ test: 'test' });

  const uploadToGaiaHub = jest.fn().mockResolvedValue({
    publicURL: fullReadUrl,
  });
  const getFullReadUrl = jest.fn().mockResolvedValue(fullReadUrl);
  jest.mock('../src/hub', () => ({
    uploadToGaiaHub,
    getFullReadUrl,
  }));

  fetchMock.once(await userSession.encryptContent(fileContent));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Storage } = require('../src');
  const storage = new Storage({ userSession });

  const encryptOptions = { encrypt: true };
  const decryptOptions = { decrypt: true };
  // put and encrypt the file
  await storage
    .putFile(path, fileContent, encryptOptions)
    .then((publicURL: string) => {
      expect(publicURL).toBeTruthy();
    })
    .then(() => {
      // read and decrypt the file
      return storage.getFile(path, decryptOptions).then((readContent: string) => {
        expect(readContent).toEqual(fileContent);
        // put back whatever was inside before
      });
    });
});

test('putFile encrypt/no-sign using specifying public key & getFile decrypt', async () => {
  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
  const publicKey = getPublicKeyFromPrivate(privateKey);

  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });

  const path = 'file.json';
  const gaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'https://gaia.testblockstack.org/hub/',
  };

  userSession.store.getSessionData().userData = <any>{
    appPrivateKey: privateKey,
    gaiaHubConfig,
  }; // manually set private key for testing

  const fullReadUrl =
    'https://gaia.testblockstack.org/hub/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8A/file.json';
  const fileContent = JSON.stringify({ test: 'test' });

  const uploadToGaiaHub = jest.fn().mockResolvedValue({
    publicURL: fullReadUrl,
  });
  const getFullReadUrl = jest.fn().mockResolvedValue(fullReadUrl);
  jest.mock('../src/hub', () => ({
    uploadToGaiaHub,
    getFullReadUrl,
  }));

  fetchMock.once(await userSession.encryptContent(fileContent));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Storage } = require('../src');
  const storage = new Storage({ userSession });

  const encryptOptions = { encrypt: publicKey };
  const decryptOptions = { decrypt: privateKey };
  // put and encrypt the file
  await storage
    .putFile(path, fileContent, encryptOptions)
    .then((publicURL: string) => {
      expect(publicURL).toEqual(fullReadUrl);
    })
    .then(() => {
      // read and decrypt the file
      return storage.getFile(path, decryptOptions).then((readContent: string) => {
        expect(readContent).toEqual(fileContent);
      });
    });
});

test('putFile & getFile encrypted, signed', () => {
  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  const gaiaHubConfig: GaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'https://gaia.testblockstack2.org/hub/',
    max_file_upload_size_megabytes: 2,
  };
  userSession.store.getSessionData().userData = <any>{
    appPrivateKey: privateKey,
    gaiaHubConfig,
  }; // manually set private key for testing
  const readPrefix = 'https://gaia.testblockstack8.org/hub/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U';
  const fullReadUrl = `${readPrefix}/file.json`;
  const urlBadPK = `${readPrefix}/badPK.json`;
  const urlBadSig = `${readPrefix}/badSig.json`;
  const fileContent = JSON.stringify({ test: 'test' });
  const badPK = '0288580b020800f421d746f738b221d384f098e911b81939d8c94df89e74cba776';

  const uploadToGaiaHub = jest
    .fn()
    .mockResolvedValueOnce({
      publicURL: fullReadUrl,
    })
    .mockResolvedValueOnce({
      publicURL: urlBadPK,
    })
    .mockResolvedValueOnce({
      publicURL: urlBadSig,
    });
  const getFullReadUrl = jest.fn().mockResolvedValue(fullReadUrl);
  // .mockResolvedValueOnce(urlBadPK)

  const lookupProfile = jest.fn().mockResolvedValue({ apps: { origin: readPrefix } });
  jest.mock('../src/hub', () => ({
    uploadToGaiaHub,
    getFullReadUrl,
  }));

  jest.mock('@stacks/auth', () => ({
    lookupProfile,
  }));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Storage } = require('../src');
  const storage = new Storage({ userSession });

  const encryptOptions = { encrypt: true, sign: true };
  const decryptOptions = { decrypt: true, verify: true };
  // put and encrypt the file
  return storage
    .putFile('doesnt-matter.json', fileContent, encryptOptions)
    .then((publicURL: string) => {
      expect(publicURL).toEqual(fullReadUrl);

      const putFileContents = uploadToGaiaHub.mock.calls[0][1];
      const contentsObj = JSON.parse(putFileContents);
      fetchMock
        .once(putFileContents)
        .once(putFileContents)
        .once(
          JSON.stringify({
            signature: contentsObj.signature,
            publicKey: badPK,
            cipherText: contentsObj.cipherText,
          })
        )
        .once(
          JSON.stringify({
            signature: contentsObj.signature,
            publicKey: badPK,
            cipherText: contentsObj.cipherText,
          })
        )
        .once(
          JSON.stringify({
            signature: contentsObj.signature,
            publicKey: contentsObj.publicKey,
            cipherText: 'potato potato potato',
          })
        );
    })
    .then(() =>
      storage.getFile('file.json', decryptOptions).then((readContent: string) => {
        expect(readContent).toEqual(fileContent);
      })
    )
    .then(() =>
      storage
        .getFile('file.json', {
          decrypt: true,
          verify: true,
          username: 'applejacks.id',
          app: 'origin',
        })
        .then((readContent: string) => {
          expect(readContent).toEqual(fileContent);
        })
    )
    .then(() =>
      storage
        .getFile('badPK.json', decryptOptions)
        .then(() => fail('Should not successfully decrypt file'))
        .catch((err: Error) => {
          expect(err.message.indexOf("doesn't match gaia address")).toBeGreaterThanOrEqual(0);
        })
    )
    .then(() =>
      storage
        .getFile('badPK.json', {
          decrypt: true,
          verify: true,
          username: 'applejacks.id',
          app: 'origin',
        })
        .then(() => fail('Should not successfully decrypt file'))
        .catch((err: Error) => {
          expect(err.message.indexOf("doesn't match gaia address")).toBeGreaterThanOrEqual(0);
        })
    )
    .then(() =>
      storage
        .getFile('badSig.json', decryptOptions)
        .then(() => fail('Should not successfully decrypt file'))
        .catch((err: Error) => {
          expect(err.message.indexOf('do not match ECDSA')).toBeGreaterThanOrEqual(0);
        })
    )
    .catch((err: Error) => console.log(err.stack));
});

test('putFile & getFile unencrypted, signed', async () => {
  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');

  const gaiaHubConfig: GaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'gaia.testblockstack2.org/hub/',
    max_file_upload_size_megabytes: 2,
  };

  // manually set gaia config and private key for testing
  const userSession = new UserSession({
    appConfig,
    sessionOptions: {
      userData: {
        gaiaHubConfig: gaiaHubConfig,
        appPrivateKey: privateKey,
      } as UserData,
    },
  });

  const readPrefix = 'https://gaia.testblockstack4.org/hub/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U';

  const goodPath = 'file.json';
  const badPKPath = 'badPK.json';
  const badSigPath = 'badSig.json';
  const noSigPath = 'noSig.json';

  const fileContent = JSON.stringify({ test: 'test' });
  const badPK = '0288580b020800f421d746f738b221d384f098e911b81939d8c94df89e74cba776';

  const putFiledContents: [string, string, string][] = [];
  const pathToReadUrl = (fname: string) => `${readPrefix}/${fname}`;

  const uploadToGaiaHub = jest.fn().mockImplementation((fname, contents, _, contentType) => {
    const contentString = contents instanceof Uint8Array ? bytesToUtf8(contents) : contents;
    putFiledContents.push([fname, contentString, contentType]);
    if (!fname.endsWith('.sig')) {
      expect(contentString).toEqual(fileContent);
    }
    return Promise.resolve({ publicURL: pathToReadUrl(fname) });
  });

  const getFullReadUrl = jest.fn().mockImplementation(path => Promise.resolve(pathToReadUrl(path)));

  const lookupProfile = jest.fn().mockResolvedValue({ apps: { origin: readPrefix } });
  jest.mock('../src/hub', () => ({
    uploadToGaiaHub,
    getFullReadUrl,
    getBlockstackErrorFromResponse: jest.requireActual('../src/hub').getBlockstackErrorFromResponse,
  }));

  jest.mock('@stacks/auth', () => ({
    lookupProfile,
  }));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Storage } = require('../src');
  const storage = new Storage({ userSession });

  const encryptOptions = { encrypt: false, sign: true };
  const decryptOptions = { decrypt: false, verify: true };
  const multiplayerDecryptOptions = {
    username: 'applejacks.id',
    decrypt: false,
    verify: true,
    app: 'origin',
  };
  // put and encrypt the file
  const publicURL = await storage.putFile(goodPath, fileContent, encryptOptions);
  expect(publicURL).toEqual(pathToReadUrl(goodPath));
  expect(uploadToGaiaHub.mock.calls.length).toEqual(2);
  expect(putFiledContents.length).toEqual(2);

  let sigContents = '';

  // good path mocks
  putFiledContents.forEach(([path, contents, contentType]) => {
    fetchMock.once(contents.toString(), {
      headers: { 'Content-Type': contentType },
    });
    if (path.endsWith('.sig')) {
      sigContents = typeof contents === 'string' ? contents : bytesToUtf8(contents);
    }
  });
  const sigObject = JSON.parse(sigContents);

  fetchMock.mockResponse(request => {
    if (request.url.endsWith(pathToReadUrl(goodPath))) {
      return Promise.resolve(fileContent);
    } else if (request.url.endsWith(pathToReadUrl(`${goodPath}.sig`))) {
      return Promise.resolve(sigContents);
    } else if (request.url.endsWith(pathToReadUrl(badSigPath))) {
      return Promise.resolve('hello world, this is inauthentic.');
    } else if (request.url.endsWith(pathToReadUrl(`${badSigPath}.sig`))) {
      return Promise.resolve(sigContents);
    } else if (request.url.endsWith(pathToReadUrl(noSigPath))) {
      return Promise.resolve('hello world, this is inauthentic.');
    } else if (request.url.endsWith(pathToReadUrl(`${noSigPath}.sig`))) {
      return Promise.resolve({ body: 'nopers.', status: 404 });
    } else if (request.url.endsWith(pathToReadUrl(badPKPath))) {
      return Promise.resolve(fileContent);
    } else if (request.url.endsWith(pathToReadUrl(`${badPKPath}.sig`))) {
      return Promise.resolve(
        JSON.stringify({
          signature: sigObject.signature,
          publicKey: badPK,
        })
      );
    } else {
      fail('unexpected request');
    }
  });

  let readContent = await storage.getFile(goodPath, decryptOptions);
  expect(readContent).toEqual(fileContent);

  try {
    await storage.getFile(badSigPath, decryptOptions);
    fail('Should have failed to read file.');
  } catch (err: any) {
    expect(err.message.indexOf('do not match ECDSA')).toBeGreaterThanOrEqual(0);
  }

  try {
    await storage.getFile(noSigPath, decryptOptions);
    fail('Should have failed to read file.');
  } catch (err: any) {
    expect(err.message.indexOf('obtain signature for file')).toBeGreaterThanOrEqual(0);
  }

  try {
    await storage.getFile(badPKPath, decryptOptions);
    fail('Should have failed to read file.');
  } catch (err: any) {
    expect(err.message.indexOf('match gaia address')).toBeGreaterThanOrEqual(0);
  }

  readContent = await storage.getFile(goodPath, multiplayerDecryptOptions);
  expect(readContent).toEqual(fileContent);

  try {
    await storage.getFile(badSigPath, multiplayerDecryptOptions);
    fail('Should have failed to read file.');
  } catch (err: any) {
    expect(err.message.indexOf('do not match ECDSA')).toBeGreaterThanOrEqual(0);
  }

  try {
    await storage.getFile(noSigPath, multiplayerDecryptOptions);
    fail('Should have failed to read file.');
  } catch (err: any) {
    expect(err.message.indexOf('obtain signature for file')).toBeGreaterThanOrEqual(0);
  }

  try {
    await storage.getFile(badPKPath, multiplayerDecryptOptions);
    fail('Should have failed to read file.');
  } catch (err: any) {
    expect(err.message.indexOf('match gaia address')).toBeGreaterThanOrEqual(0);
  }
});

test('putFile oversized -- unencrypted, signed', async () => {
  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');

  const gaiaHubConfig: GaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'gaia.testblockstack2.org/hub/',
    // 500 bytes
    max_file_upload_size_megabytes: 0.0005,
  };

  // manually set gaia config and private key for testing
  const userSession = new UserSession({
    appConfig,
    sessionOptions: {
      userData: {
        gaiaHubConfig: gaiaHubConfig,
        appPrivateKey: privateKey,
      } as UserData,
    },
  });

  const readPrefix = 'https://gaia.testblockstack4.org/hub/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U';

  // 600 bytes
  const fileContent = new Uint8Array(600);
  const pathToReadUrl = (fname: string) => `${readPrefix}/${fname}`;

  const uploadToGaiaHub = jest.fn().mockImplementation(fname => {
    return Promise.resolve({ publicURL: pathToReadUrl(fname) });
  });

  jest.mock('../src/hub', () => ({
    uploadToGaiaHub,
  }));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Storage } = require('../src');
  const storage = new Storage({ userSession });

  const encryptOptions = { encrypt: false, sign: true };
  try {
    await storage.putFile('file.bin', fileContent, encryptOptions);
    fail('should have thrown error with oversized content -- unencrypted, signed');
  } catch (error: any) {
    expect(error.name).toEqual('PayloadTooLargeError');
  }
});

test('putFile oversized -- encrypted, signed', async () => {
  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');

  const gaiaHubConfig: GaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'gaia.testblockstack2.org/hub/',
    // 500 bytes
    max_file_upload_size_megabytes: 0.0005,
  };

  // manually set gaia config and private key for testing
  const userSession = new UserSession({
    appConfig,
    sessionOptions: {
      userData: {
        gaiaHubConfig: gaiaHubConfig,
        appPrivateKey: privateKey,
      } as UserData,
    },
  });

  const readPrefix = 'https://gaia.testblockstack4.org/hub/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U';

  // 600 bytes
  const fileContent = new Uint8Array(600);
  const pathToReadUrl = (fname: string) => `${readPrefix}/${fname}`;

  const uploadToGaiaHub = jest.fn().mockImplementation(fname => {
    return Promise.resolve({ publicURL: pathToReadUrl(fname) });
  });

  jest.mock('../src/hub', () => ({
    uploadToGaiaHub,
  }));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Storage } = require('../src');
  const storage = new Storage({ userSession });

  const encryptOptions = { encrypt: true, sign: true };
  try {
    await storage.putFile('file.bin', fileContent, encryptOptions);
    fail('should have thrown error with oversized content -- encrypted, signed');
  } catch (error: any) {
    expect(error.name).toEqual('PayloadTooLargeError');
  }
});

test('putFile oversized -- unencrypted', async () => {
  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');

  const gaiaHubConfig: GaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'gaia.testblockstack2.org/hub/',
    // 500 bytes
    max_file_upload_size_megabytes: 0.0005,
  };

  // manually set gaia config and private key for testing
  const userSession = new UserSession({
    appConfig,
    sessionOptions: {
      userData: {
        gaiaHubConfig: gaiaHubConfig,
        appPrivateKey: privateKey,
      } as UserData,
    },
  });

  const readPrefix = 'https://gaia.testblockstack4.org/hub/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U';

  // 600 bytes
  const fileContent = new Uint8Array(600);
  const pathToReadUrl = (fname: string) => `${readPrefix}/${fname}`;

  const uploadToGaiaHub = jest.fn().mockImplementation(fname => {
    return Promise.resolve({ publicURL: pathToReadUrl(fname) });
  });

  jest.mock('../src/hub', () => ({
    uploadToGaiaHub,
  }));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Storage } = require('../src');
  const storage = new Storage({ userSession });

  const encryptOptions = { encrypt: false, sign: false };
  try {
    await storage.putFile('file.bin', fileContent, encryptOptions);
    fail('should have thrown error with oversized content -- unencrypted');
  } catch (error: any) {
    expect(error.name).toEqual('PayloadTooLargeError');
  }
});

test('putFile oversized -- encrypted', async () => {
  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');

  const gaiaHubConfig: GaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'gaia.testblockstack2.org/hub/',
    // 500 bytes
    max_file_upload_size_megabytes: 0.0005,
  };

  // manually set gaia config and private key for testing
  const userSession = new UserSession({
    appConfig,
    sessionOptions: {
      userData: {
        gaiaHubConfig: gaiaHubConfig,
        appPrivateKey: privateKey,
      } as UserData,
    },
  });

  const readPrefix = 'https://gaia.testblockstack4.org/hub/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U';

  // 600 bytes
  const fileContent = new Uint8Array(600);
  const pathToReadUrl = (fname: string) => `${readPrefix}/${fname}`;

  const uploadToGaiaHub = jest.fn().mockImplementation(fname => {
    return Promise.resolve({ publicURL: pathToReadUrl(fname) });
  });

  jest.mock('../src/hub', () => ({
    uploadToGaiaHub,
  }));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Storage } = require('../src');
  const storage = new Storage({ userSession });

  const encryptOptions = { encrypt: true, sign: false };
  try {
    await storage.putFile('file.bin', fileContent, encryptOptions);
    fail('should have thrown error with oversized content -- encrypted');
  } catch (error: any) {
    expect(error.name).toEqual('PayloadTooLargeError');
  }
});

test('aes256Cbc output size calculation', async () => {
  const testLengths = [0, 1, 2, 3, 4, 8, 100, 500, 1000];
  for (let i = 0; i < 10; i++) {
    testLengths.push(Math.floor(Math.random() * Math.floor(1030)));
  }
  const iv = crypto.randomBytes(16);
  const key = hexToBytes('a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229');
  for (const len of testLengths) {
    const data = crypto.randomBytes(len);
    const encryptedData = await aes256CbcEncrypt(iv, key, data);
    const calculatedLength = getAesCbcOutputLength(len);
    expect(calculatedLength).toEqual(encryptedData.length);
  }
});

test('base64 output size calculation', () => {
  const testLengths = [0, 1, 2, 3, 4, 8, 100, 500, 1000];
  for (let i = 0; i < 10; i++) {
    testLengths.push(Math.floor(Math.random() * Math.floor(1030)));
  }
  for (const len of testLengths) {
    const data = crypto.randomBytes(len);
    const encodedLength = data.toString('base64');
    const calculatedLength = getBase64OutputLength(len);
    expect(calculatedLength).toEqual(encodedLength.length);
  }
});

test('payload size detection', async () => {
  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');

  const gaiaHubConfig: GaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'gaia.testblockstack2.org/hub/',
    // 500 bytes
    max_file_upload_size_megabytes: 0.0005,
  };

  // manually set gaia config and private key for testing
  const userSession = new UserSession({
    appConfig,
    sessionOptions: {
      userData: {
        gaiaHubConfig: gaiaHubConfig,
        appPrivateKey: privateKey,
      } as UserData,
    },
  });
  const data = new Uint8Array(100);

  const encryptedData1 = await userSession.encryptContent(data, {
    wasString: false,
    cipherTextEncoding: 'hex',
  });
  const detectedSize1 = eciesGetJsonStringLength({
    contentLength: data.byteLength,
    wasString: false,
    cipherTextEncoding: 'hex',
    sign: false,
  });
  expect(detectedSize1).toEqual(encryptedData1.length);

  const encryptedData2 = await userSession.encryptContent(data, {
    wasString: true,
    cipherTextEncoding: 'hex',
  });
  const detectedSize2 = eciesGetJsonStringLength({
    contentLength: data.byteLength,
    wasString: true,
    cipherTextEncoding: 'hex',
    sign: false,
  });
  expect(detectedSize2).toEqual(encryptedData2.length);

  const encryptedData3 = await userSession.encryptContent(data, {
    wasString: true,
    cipherTextEncoding: 'hex',
    sign: true,
  });
  const detectedSize3 = eciesGetJsonStringLength({
    contentLength: data.byteLength,
    wasString: true,
    cipherTextEncoding: 'hex',
    sign: true,
  });
  expect(detectedSize3).toEqual(729);

  // size can vary due to ECDSA signature DER encoding
  // range: 585 + (144 max)
  expect(encryptedData3.length).toBeGreaterThanOrEqual(585);
  expect(encryptedData3.length).toBeLessThanOrEqual(729);

  const encryptedData4 = await userSession.encryptContent(data, {
    wasString: true,
    cipherTextEncoding: 'base64',
  });
  const detectedSize4 = eciesGetJsonStringLength({
    contentLength: data.byteLength,
    wasString: true,
    cipherTextEncoding: 'base64',
    sign: false,
  });
  expect(detectedSize4).toEqual(encryptedData4.length);
});

test('promises reject', async () => {
  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  const path = 'file.json';
  // const fullReadUrl = 'https://hub.testblockstack.org/store/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U/file.json'
  const gaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.testblockstack.org',
    token: '',
    url_prefix: 'https://gaia.testblockstack.org/hub/',
  };
  userSession.store.getSessionData().userData = <any>{
    gaiaHubConfig,
  };

  const reject = jest.fn();
  fetchMock.once('Not found', {
    status: 404,
  });

  const storage = new Storage({ userSession });

  await storage
    .putFile(path, 'hello world', { encrypt: false })
    .then(() => fail('Should not have returned'))
    .catch(reject);

  expect(reject).toHaveBeenCalledTimes(1);

  const gaiaHubUrl = 'https://potato.hub.farm';
  const signer = '01010101';

  fetchMock.mockResponse('Nope.', {
    status: 421,
  });

  await connectToGaiaHub(gaiaHubUrl, signer)
    .then(() => fail('Should not have returned'))
    .catch(reject);

  expect(reject).toHaveBeenCalledTimes(2);
});

test('putFile gets a new gaia config and tries again', async () => {
  const path = 'file.json';
  // const fullWriteUrl = 'https://hub.testblockstack.org/store/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yabc/file.json'
  const invalidHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yabc',
    server: 'https://hub.testblockstack.org',
    token: '',
    url_prefix: 'https://gaia.testblockstack.org/hub/',
  };
  const validHubConfig = Object.assign({}, invalidHubConfig, {
    token: 'valid',
  });

  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    gaiaHubConfig: invalidHubConfig,
    hubUrl: 'https://hub.testblockstack.org',
  };

  const connectToGaiaHub = jest.fn().mockResolvedValue(validHubConfig);

  jest.mock('../src/hub', () => ({
    connectToGaiaHub,
    uploadToGaiaHub: jest.requireActual('../src/hub').uploadToGaiaHub,
  }));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Storage } = require('../src');
  const storage = new Storage({ userSession });

  const invalidToken = jest.fn();
  const validToken = jest.fn();
  fetchMock.mockResponse(request => {
    const authHeader = request.headers.get('Authorization');
    if (authHeader === 'bearer ') {
      invalidToken();
      return Promise.resolve({ body: '', status: 401 });
    } else if (authHeader === 'bearer valid') {
      validToken();
      return Promise.resolve({
        status: 200,
        body: JSON.stringify({ publicURL: 'readURL' }),
      });
    }
    return Promise.resolve({ body: '', status: 401 });
  });

  const success = jest.fn();
  await storage.putFile(path, 'hello world', { encrypt: false }).then(success);
  expect(invalidToken).toHaveBeenCalled();
  expect(validToken).toHaveBeenCalled();
  expect(success).toHaveBeenCalled();
});

test('getFileUrl', async () => {
  const config = {
    address: '19MoWG8u88L6t766j7Vne21Mg4wHsCQ7vk',
    url_prefix: 'https://gaia.testblockstack.org/hub/',
    token: '',
    server: 'https://hub.testblockstack.org',
  };

  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    appPrivateKey: privateKey,
    gaiaHubConfig: config,
  }; // manually set for testing

  const storage = new Storage({ userSession });

  fetchMock.mockResponse('', { status: 404 });

  await storage.getFileUrl('foo.json', {}).then(x => {
    expect(x).toEqual(
      'https://gaia.testblockstack.org/hub/19MoWG8u88L6t766j7Vne21Mg4wHsCQ7vk/foo.json'
    );
  });
});

test('getFile throw on 404', async () => {
  const config = {
    address: '19MoWG8u88L6t766j7Vne21Mg4wHsCQ7vk',
    url_prefix: 'gaia.testblockstack.org/hub/',
    token: '',
    server: 'hub.testblockstack.org',
  };

  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    appPrivateKey: privateKey,
    gaiaHubConfig: config,
  }; // manually set for testing

  fetchMock.mockResponse('', { status: 404 });

  const storage = new Storage({ userSession });

  const error = jest.fn();

  const optionsNoDecrypt = { decrypt: false };
  await storage
    .getFile('foo.json', optionsNoDecrypt)
    .then(() => fail('getFile (no decrypt) with 404 should fail'))
    .catch(error);

  expect(error).toHaveBeenCalled();

  const optionsDecrypt = { decrypt: true };
  await storage
    .getFile('foo.json', optionsDecrypt)
    .then(() => fail('getFile (decrypt) with 404 should fail'))
    .catch(err => {
      expect(err instanceof DoesNotExist).toEqual(true);
      expect(err.hubError.statusCode).toEqual(404);
      expect(err.hubError.statusText).toEqual('Not Found');
    });
});

test('uploadToGaiaHub', async () => {
  const config = {
    address: '19MoWG8u88L6t766j7Vne21Mg4wHsCQ7vk',
    url_prefix: 'gaia.testblockstack.org',
    token: '',
    server: 'hub.testblockstack.org',
    max_file_upload_size_megabytes: 20,
  };
  const resp = JSON.stringify({ publicURL: `${config.url_prefix}/${config.address}/foo.json` });

  fetchMock.mockResponse(resp);

  await uploadToGaiaHub('foo.json', 'foo the bar', config).then(res => {
    expect(res).toBeTruthy();
    expect(JSON.stringify(res)).toEqual(resp);
  });
});

test('deleteFromGaiaHub', async () => {
  const config = {
    address: '19MoWG8u88L6t766j7Vne21Mg4wHsCQ7vk',
    url_prefix: 'gaia.testblockstack.org',
    token: '',
    server: 'hub.testblockstack.org',
    max_file_upload_size_megabytes: 20,
  };

  fetchMock.mockResponse('', { status: 202 });

  const success = jest.fn();
  await deleteFromGaiaHub('foo.json', config).then(success);
  expect(success).toHaveBeenCalled();
});

test('getFullReadUrl', async () => {
  const config = {
    address: '19MoWG8u88L6t766j7Vne21Mg4wHsCQ7vk',
    url_prefix: 'gaia.testblockstack.org',
    token: '',
    server: 'hub.testblockstack.org',
    max_file_upload_size_megabytes: 20,
  };

  await getFullReadUrl('foo.json', config).then(outUrl => {
    expect(`${config.url_prefix}${config.address}/foo.json`).toEqual(outUrl);
  });
});

test('connectToGaiaHub', async () => {
  const hubServer = 'hub.testblockstack.org';

  const hubInfo = {
    read_url_prefix: 'gaia.testblockstack.org',
    challenge_text: 'please-sign',
    latest_auth_version: 'v1',
  };

  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
  const address = '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U';
  const publicKey = '027d28f9951ce46538951e3697c62588a87f1f1f295de4a14fdd4c780fc52cfe69';

  fetchMock.once(JSON.stringify(hubInfo));

  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    appPrivateKey: privateKey,
  }; // manually set for testing

  await connectToGaiaHub(hubServer, privateKey).then(config => {
    expect(config).toBeTruthy();
    expect(hubInfo.read_url_prefix).toEqual(config.url_prefix);
    expect(address).toEqual(config.address);
    expect(hubServer).toEqual(config.server);

    const jsonTokenPart = config.token.slice('v1:'.length);

    const verified = new TokenVerifier('ES256K', publicKey).verify(jsonTokenPart);

    expect(verified).toBe(true);
    expect(hubServer).toEqual((decodeToken(jsonTokenPart).payload as any).hubUrl);
  });
});

test('connectToGaiaHub call makeLegacyAuthToken and verify token', async () => {
  const hubServer = 'hub.testblockstack.org';

  // Set latest_auth_version value to v0 in hubInfo to execute makeLegacyAuthToken
  const hubInfo = {
    read_url_prefix: 'gaia.testblockstack.org',
    challenge_text: '["gaiahub","0","gaia-0","blockstack_storage_please_sign"]',
    latest_auth_version: 'v0',
  };

  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
  const address = '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U';

  fetchMock.once(JSON.stringify(hubInfo));

  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    appPrivateKey: privateKey,
  }; // manually set for testing

  // Calling connectToGaiaHub will internally call makeLegacyAuthToken which is intended for this test case
  const config = await connectToGaiaHub(hubServer, privateKey);

  expect(config).toBeTruthy();
  expect(hubInfo.read_url_prefix).toEqual(config.url_prefix);
  expect(address).toEqual(config.address);
  expect(hubServer).toEqual(config.server);

  // Get the base64 encoded token string
  const { token } = config;
  // Decode the base64 token and get the DER encoded signature value
  const decodedToken = bytesToUtf8(base64.decode(token));
  // Convert decodedToken string to json
  const payload = JSON.parse(decodedToken);
  // Get the hash of original payload for verification with noble-secp256k1
  const digest = hashSha256Sync(utf8ToBytes(hubInfo.challenge_text));
  // Verify signature against message hash and public key using @noble/secp256k1 verify
  const verifyResult = verifySignature(payload.signature, digest, payload.publickey);
  // @noble/secp256k1 should verify the DER encoded signature
  expect(verifyResult).toEqual(true);
});

test('Verify compatibility of bitcoinjs DER encoding with noble-secp256k1', () => {
  // Consider a DER encoded signature base64 generated by bitcoinjs library
  // This token is real base64, DER encoded signature so no need to import bitcoinjs as devDependency for generating DER encoding
  const encodedSignatureByBitcoinjs =
    'eyJwdWJsaWNrZXkiOiIwMjdkMjhmOTk1MWNlNDY1Mzg5NTFlMzY5N2M2MjU4OGE4N2YxZjFmMjk1ZGU0YTE0ZmRkNGM3ODBmYzUyY2ZlNjkiLCJzaWduYXR1cmUiOiIzMDQ0MDIyMDQ1NGE1NTMwYTBmOWY3YjdjMDMyOWE1MTFmOWJlNWVkZTFmNjU4ZDQ5MGY0OGRjNDE4YTgwYjNlNmJiNDJjZWIwMjIwMzVmMTRiMTU0NmE3NjkxNmJjOWJmNWNjMTk5YzQ3MTY5MGYzYmNiMWE2NmU3ZTQ5ZDZhNzY5NDJiM2FhZmM1ZiJ9';
  // Decode the base64 token and get the DER encoded signature value
  const decodedToken = bytesToUtf8(base64.decode(encodedSignatureByBitcoinjs));
  // Convert decodedToken string to json
  const payload = JSON.parse(decodedToken);
  // Get the hash of original payload for verification with noble-secp256k1
  const digest = hashSha256Sync(
    utf8ToBytes('["gaiahub","0","gaia-0","blockstack_storage_please_sign"]')
  );
  // Verify signature against message hash and public key using @noble/secp256k1 verify
  const verifyResult = verifySignature(payload.signature, digest, payload.publickey);
  // @noble/secp256k1 should accept and verify the DER encoded signature generated by bitcoinjs signature.encode method
  expect(verifyResult).toEqual(true);
});

test('connectToGaiaHub with an association token', async () => {
  const hubServer = 'hub.testblockstack.org';

  const hubInfo = {
    read_url_prefix: 'gaia.testblockstack.org',
    challenge_text: 'please-sign',
    latest_auth_version: 'v1',
  };

  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
  const address = '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U';
  const publicKey = '027d28f9951ce46538951e3697c62588a87f1f1f295de4a14fdd4c780fc52cfe69';

  const identityPrivateKey = '4dea04fe440d760664d96f1fd219e7a73324fc8faa28c7babd1a7813d05970aa01';
  const identityPublicKey = '0234f3c7aec9fe13190aede94d1eaa0a7d2b48d18fd86b9651fc3996a5f467fc73';

  const FOUR_MONTH_SECONDS = 60 * 60 * 24 * 31 * 4;
  const salt = '00000000000000000000000000000';
  const associationTokenClaim = {
    childToAssociate: publicKey,
    iss: identityPublicKey,
    exp: FOUR_MONTH_SECONDS + Date.now() / 1000,
    salt,
  };
  const gaiaAssociationToken = new TokenSigner('ES256K', identityPrivateKey).sign(
    associationTokenClaim
  );

  fetchMock.once(JSON.stringify(hubInfo));

  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    appPrivateKey: privateKey,
  }; // manually set for testing

  const config = await connectToGaiaHub(hubServer, privateKey, gaiaAssociationToken);
  expect(config).toBeTruthy();
  expect(hubInfo.read_url_prefix).toEqual(config.url_prefix);
  expect(address).toEqual(config.address);
  expect(hubServer).toEqual(config.server);

  const jsonTokenPart = config.token.slice('v1:'.length);

  const verified = new TokenVerifier('ES256K', publicKey).verify(jsonTokenPart);

  expect(verified).toBe(true);
  expect(hubServer).toEqual((decodeToken(jsonTokenPart).payload as any).hubUrl);
  expect(gaiaAssociationToken).toEqual(
    (decodeToken(jsonTokenPart).payload as any).associationToken
  );
});

test('getBucketUrl', () => {
  const hubServer = 'hub2.testblockstack.org';

  const hubInfo = {
    read_url_prefix: 'https://gaia.testblockstack.org/hub/',
    challenge_text: 'please-sign',
    latest_auth_version: 'v1',
  };

  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
  const address = '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U';

  fetchMock.once(JSON.stringify(hubInfo));

  return getBucketUrl(hubServer, privateKey).then(bucketUrl => {
    expect(bucketUrl).toBeTruthy();
    expect(bucketUrl).toEqual(`${hubInfo.read_url_prefix}${address}/`);
  });
});

test('getUserAppFileUrl', async () => {
  const path = 'file.json';
  const name = 'test.id';
  const appOrigin = 'testblockstack.org';
  const profile = {
    apps: {
      'testblockstack.org':
        'https://gaia.testblockstack.org/hub/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U/',
    },
  };

  const fileUrl =
    'https://gaia.testblockstack.org/hub/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U/file.json';

  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  const gaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.testblockstack.org',
    token: '',
    url_prefix: 'https://gaia.testblockstack.org/hub/',
  };
  userSession.store.getSessionData().userData = <any>{
    gaiaHubConfig,
  };

  const lookupProfile = jest.fn().mockResolvedValue(profile);

  jest.mock('@stacks/auth', () => ({
    lookupProfile,
  }));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Storage } = require('../src');
  const storage = new Storage({ userSession });

  await storage.getUserAppFileUrl(path, name, appOrigin).then((url: string) => {
    expect(url).toBeTruthy();
    expect(url).toEqual(fileUrl);
  });
});

test('getUserAppFileUrl without user session', async () => {
  const fileUrl = 'https://gaia.blockstack.org/hub/1DDUqfKtQgYNt722wuB4Z2fPC7aiNGQa5R/file.json';
  const zoneFileLookupURL = 'https://potato/v1/names';
  const path = 'file.json';
  const username = 'yukan.btc';
  const appOrigin = 'http://localhost:8080';
  const nameRecord = {
    status: 'registered',
    zonefile:
      '$ORIGIN yukan.id\n$TTL 3600\n_http._tcp URI 10 1 "https://gaia.testblockstack.org/hub/16zVUoP7f15nfTiHw2UNiX8NT5SWYqwNv3/0/profile.json"\n',
    expire_block: 581432,
    blockchain: 'bitcoin',
    last_txid: 'f7fa811518566b1914a098c3bd61a810aee56390815bd608490b0860ac1b5b4d',
    address: 'SP10VG75GE4PE0VBA3KD3NVKSYEMM3YV9V17HJ32N',
    zonefile_hash: '98f42e11026d42d394b3424d4d7f0cccd6f376e2',
  };
  /* eslint-disable */
  const profileContent = [
    {
      token:
        'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NksifQ.eyJqdGkiOiJjNDhmOTQ0OC1hMGZlLTRiOWUtOWQ2YS1mYzA5MzhjOGUyNzAiLCJpYXQiOiIyMDE4LTAxLTA4VDE4OjIyOjI0Ljc5NloiLCJleHAiOiIyMDE5LTAxLTA4VDE4OjIyOjI0Ljc5NloiLCJzdWJqZWN0Ijp7InB1YmxpY0tleSI6IjAyNDg3YTkxY2Q5NjZmYWVjZWUyYWVmM2ZkZTM3MjgwOWI0NmEzNmVlMTkyNDhjMDFmNzJiNjQ1ZjQ0Y2VmMmUyYyJ9LCJpc3N1ZXIiOnsicHVibGljS2V5IjoiMDI0ODdhOTFjZDk2NmZhZWNlZTJhZWYzZmRlMzcyODA5YjQ2YTM2ZWUxOTI0OGMwMWY3MmI2NDVmNDRjZWYyZTJjIn0sImNsYWltIjp7IkB0eXBlIjoiUGVyc29uIiwiQGNvbnRleHQiOiJodHRwOi8vc2NoZW1hLm9yZyIsImltYWdlIjpbeyJAdHlwZSI6IkltYWdlT2JqZWN0IiwibmFtZSI6ImF2YXRhciIsImNvbnRlbnRVcmwiOiJodHRwczovL3d3dy5kcm9wYm94LmNvbS9zL2oxaDBrdHMwbTdhYWRpcC9hdmF0YXItMD9kbD0xIn1dLCJnaXZlbk5hbWUiOiIiLCJmYW1pbHlOYW1lIjoiIiwiZGVzY3JpcHRpb24iOiIiLCJhY2NvdW50IjpbeyJAdHlwZSI6IkFjY291bnQiLCJwbGFjZWhvbGRlciI6ZmFsc2UsInNlcnZpY2UiOiJoYWNrZXJOZXdzIiwiaWRlbnRpZmllciI6Inl1a2FubCIsInByb29mVHlwZSI6Imh0dHAiLCJwcm9vZlVybCI6Imh0dHBzOi8vbmV3cy55Y29tYmluYXRvci5jb20vdXNlcj9pZD15dWthbmwifSx7IkB0eXBlIjoiQWNjb3VudCIsInBsYWNlaG9sZGVyIjpmYWxzZSwic2VydmljZSI6ImdpdGh1YiIsImlkZW50aWZpZXIiOiJ5a25sIiwicHJvb2ZUeXBlIjoiaHR0cCIsInByb29mVXJsIjoiaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20veWtubC8xZjcwMThiOThmNzE2ZjAxNWE2Y2Y0NGZkYTA4MDZkNyJ9LHsiQHR5cGUiOiJBY2NvdW50IiwicGxhY2Vob2xkZXIiOmZhbHNlLCJzZXJ2aWNlIjoidHdpdHRlciIsImlkZW50aWZpZXIiOiJ5dWthbmwiLCJwcm9vZlR5cGUiOiJodHRwIiwicHJvb2ZVcmwiOiJodHRwczovL3R3aXR0ZXIuY29tL3l1a2FuTC9zdGF0dXMvOTE2NzQwNzQ5MjM2MTAxMTIwIn1dLCJuYW1lIjoiS2VuIExpYW8iLCJhcHBzIjp7Imh0dHA6Ly9sb2NhbGhvc3Q6ODA4MCI6Imh0dHBzOi8vZ2FpYS5ibG9ja3N0YWNrLm9yZy9odWIvMUREVXFmS3RRZ1lOdDcyMnd1QjRaMmZQQzdhaU5HUWE1Ui8ifX19.UyQNZ02kBFHEovbwiGaS-VQd57w9kcwn1Nt3QbW3afEMArg1OndmeplB7lzjMuRCLAi-88lkpQLkFw7LwKZ31Q',
      decodedToken: {
        header: {
          typ: 'JWT',
          alg: 'ES256K',
        },
        payload: {
          jti: 'c48f9448-a0fe-4b9e-9d6a-fc0938c8e270',
          iat: '2018-01-08T18:22:24.796Z',
          exp: '2019-01-08T18:22:24.796Z',
          subject: {
            publicKey: '02487a91cd966faecee2aef3fde372809b46a36ee19248c01f72b645f44cef2e2c',
          },
          issuer: {
            publicKey: '02487a91cd966faecee2aef3fde372809b46a36ee19248c01f72b645f44cef2e2c',
          },
          claim: {
            '@type': 'Person',
            '@context': 'http://schema.org',
            image: [
              {
                '@type': 'ImageObject',
                name: 'avatar',
                contentUrl: 'https://www.dropbox.com/s/j1h0kts0m7aadip/avatar-0?dl=1',
              },
            ],
            givenName: '',
            familyName: '',
            description: '',
            account: [
              {
                '@type': 'Account',
                placeholder: false,
                service: 'hackerNews',
                identifier: 'yukanl',
                proofType: 'http',
                proofUrl: 'https://news.ycombinator.com/user?id=yukanl',
              },
              {
                '@type': 'Account',
                placeholder: false,
                service: 'github',
                identifier: 'yknl',
                proofType: 'http',
                proofUrl: 'https://gist.github.com/yknl/1f7018b98f716f015a6cf44fda0806d7',
              },
              {
                '@type': 'Account',
                placeholder: false,
                service: 'twitter',
                identifier: 'yukanl',
                proofType: 'http',
                proofUrl: 'https://twitter.com/yukanL/status/916740749236101120',
              },
            ],
            name: 'Ken Liao',
            apps: {
              'http://localhost:8080':
                'https://gaia.blockstack.org/hub/1DDUqfKtQgYNt722wuB4Z2fPC7aiNGQa5R/',
            },
          },
        },
        signature:
          'UyQNZ02kBFHEovbwiGaS-VQd57w9kcwn1Nt3QbW3afEMArg1OndmeplB7lzjMuRCLAi-88lkpQLkFw7LwKZ31Q',
      },
    },
  ];
  /* eslint-enable */
  const fileContents = JSON.stringify({ key: 'value' });

  fetchMock
    .once(JSON.stringify(nameRecord))
    .once(JSON.stringify(profileContent))
    .once(fileContents);

  const url = await getUserAppFileUrl({
    path,
    username,
    appOrigin,
    zoneFileLookupURL,
  });

  expect(url).toBeTruthy();
  expect(url).toEqual(fileUrl);

  const contents = await createFetchFn()(url as string).then(res => res.json());
  expect(JSON.stringify(contents)).toEqual(fileContents);
});

test('listFiles', async () => {
  const path = 'file.json';
  const gaiaHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U',
    server: 'https://hub.blockstack.org',
    token: '',
    url_prefix: 'gaia.testblockstack.org/hub/',
  };

  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    appPrivateKey: privateKey,
    gaiaHubConfig,
  }; // manually set for testing

  let callCount = 0;
  fetchMock.mockResponse(_ => {
    callCount += 1;
    if (callCount === 1) {
      return Promise.resolve(JSON.stringify({ entries: [path], page: callCount }));
    } else if (callCount === 2) {
      return Promise.resolve(JSON.stringify({ entries: [], page: callCount }));
    } else {
      fail('Called too many times');
    }
  });

  const storage = new Storage({ userSession });

  const files: string[] = [];
  await storage
    .listFiles(name => {
      files.push(name);
      return true;
    })
    .then(count => {
      expect(files.length).toEqual(1);
      expect(files[0]).toEqual('file.json');
      expect(count).toEqual(1);
    });
});

test('connect to gaia hub with a user session and association token', async () => {
  const hubServer = 'hub.testblockstack.org';
  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';

  const hubInfo = {
    read_url_prefix: 'gaia.testblockstack.org',
    challenge_text: 'please-sign',
    latest_auth_version: 'v1',
  };

  // const address = '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yg8U'
  const publicKey = '027d28f9951ce46538951e3697c62588a87f1f1f295de4a14fdd4c780fc52cfe69';

  const identityPrivateKey = '4dea04fe440d760664d96f1fd219e7a73324fc8faa28c7babd1a7813d05970aa01';
  const identityPublicKey = '0234f3c7aec9fe13190aede94d1eaa0a7d2b48d18fd86b9651fc3996a5f467fc73';

  const FOUR_MONTH_SECONDS = 60 * 60 * 24 * 31 * 4;
  const salt = '00000000000000000000000000000';
  const associationTokenClaim = {
    childToAssociate: publicKey,
    iss: identityPublicKey,
    exp: FOUR_MONTH_SECONDS + Date.now() / 1000,
    salt,
  };
  const gaiaAssociationToken = new TokenSigner('ES256K', identityPrivateKey).sign(
    associationTokenClaim
  );

  fetchMock.mockResponse(JSON.stringify(hubInfo));

  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    appPrivateKey: privateKey,
    hubUrl: hubServer,
    gaiaAssociationToken,
  };
  const storage = new Storage({ userSession });

  const gaiaConfig = await storage.setLocalGaiaHubConnection();
  const { token } = gaiaConfig;
  const assocToken = (decodeToken(token.slice(3)).payload as any).associationToken;
  expect(assocToken).toEqual(gaiaAssociationToken);
});

test('listFiles gets a new gaia config and tries again', async () => {
  const path = 'file.json';
  // const listFilesUrl = 'https://hub.testblockstack.org/list-files/1NZNxhoxobqwsNvTb16pdeiqvFvce3Yabc'
  const invalidHubConfig = {
    address: '1NZNxhoxobqwsNvTb16pdeiqvFvce3Yabc',
    server: 'https://hub.testblockstack.org',
    token: '',
    url_prefix: 'https://gaia.testblockstack.org/hub/',
  };
  const validHubConfig = Object.assign({}, invalidHubConfig, {
    token: 'valid',
  });

  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';

  const appConfig = new AppConfig(['store_write'], 'http://localhost:3000');
  const userSession = new UserSession({ appConfig });
  userSession.store.getSessionData().userData = <any>{
    appPrivateKey: privateKey,
    gaiaHubConfig: invalidHubConfig,
  };

  const connectToGaiaHub = jest.fn().mockResolvedValue(validHubConfig);

  jest.mock('../src/hub', () => ({
    connectToGaiaHub,
  }));

  let callCount = 0;
  const invalidToken = jest.fn();
  fetchMock.mockResponse(request => {
    if (request.headers.get('Authorization') === 'bearer ') {
      invalidToken();
      // t.ok(true, 'tries with invalid token')
      return Promise.resolve({ status: 401 });
    }
    callCount += 1;
    if (callCount === 1) {
      return Promise.resolve(JSON.stringify({ entries: [null], page: callCount }));
    } else if (callCount === 2) {
      return Promise.resolve(JSON.stringify({ entries: [path], page: callCount }));
    } else if (callCount === 3) {
      return Promise.resolve(JSON.stringify({ entries: [], page: callCount }));
    } else {
      throw new Error('Called too many times');
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Storage } = require('../src');
  const storage = new Storage({ userSession });

  const files: string[] = [];
  await storage
    .listFiles((name: string) => {
      files.push(name);
      return true;
    })
    .then((count: number) => {
      expect(files.length).toEqual(1);
      expect(files[0]).toEqual('file.json');
      expect(count).toEqual(1);
    });
});
