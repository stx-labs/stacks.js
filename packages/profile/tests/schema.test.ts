import { ECPair } from 'bitcoinjs-lib';
import fetchMock from 'jest-fetch-mock';
import { Person, Profile, resolveZoneFileToPerson, wrapProfileToken } from '../src';
import { sampleProfiles, sampleTokenFiles } from './sampleData';

beforeEach(() => {
  fetchMock.resetMocks();
});

const keyPair = ECPair.makeRandom();
const privateKey = keyPair.privateKey!.toString('hex');
const publicKey = keyPair.publicKey.toString('hex');

test('Profile', () => {
  const profileObject = new Profile(sampleProfiles.naval);
  expect(profileObject).toBeTruthy();

  const validationResults = Profile.validateSchema(sampleProfiles.naval);
  expect(validationResults.valid).toBeTruthy();

  const profileJson = profileObject.toJSON();
  expect(profileJson).toBeTruthy();

  const tokenRecords = profileObject.toToken(privateKey);
  expect(tokenRecords).toBeTruthy();

  const profileObject2 = Profile.fromToken(tokenRecords, publicKey);
  expect(profileObject2).toBeTruthy();
});

test('Person', () => {
  const personObject = new Person(sampleProfiles.naval);
  expect(personObject).toBeTruthy();

  const validationResults = Person.validateSchema(sampleProfiles.naval, true);
  expect(validationResults.valid).toBeTruthy();

  const token = personObject.toToken(privateKey);
  const tokenRecords = [wrapProfileToken(token)];
  expect(tokenRecords).toBeTruthy();

  const profileObject2 = Person.fromToken(tokenRecords[0].token, publicKey);
  expect(profileObject2).toBeTruthy();

  const name = personObject.name();
  expect(name).toBeTruthy();
  expect(name).toEqual('Naval Ravikant');

  const givenName = personObject.givenName();
  expect(givenName).toBeTruthy();
  expect(givenName).toEqual('Naval');

  const familyName = personObject.familyName();
  expect(familyName).toBeTruthy();
  expect(familyName).toEqual('Ravikant');

  const description = personObject.description();
  expect(description).toBeTruthy();

  const avatarUrl = personObject.avatarUrl();
  expect(avatarUrl).toBeTruthy();

  const verifiedAccounts = personObject.verifiedAccounts([]);
  expect(verifiedAccounts).toBeTruthy();
  expect(verifiedAccounts!.length).toEqual(0);

  const address = personObject.address();
  expect(address).toBeTruthy();

  const birthDate = personObject.birthDate();
  expect(birthDate).toBeTruthy();

  const connections = personObject.connections();
  expect(connections).toBeTruthy();

  const organizations = personObject.organizations();
  expect(organizations).toBeTruthy();
});

test('legacyFormat', () => {
  const profileObject = Person.fromLegacyFormat(sampleProfiles.navalLegacy);
  expect(profileObject).toBeTruthy();

  const validationResults = Person.validateSchema(profileObject.toJSON(), true);
  expect(validationResults).toBeTruthy();
  expect(profileObject.toJSON()).toStrictEqual(sampleProfiles.navalLegacyConvert);
});

test('resolveZoneFileToPerson', () => {
  const zoneFile =
    '$ORIGIN ryan.id\n$TTL 3600\n_http._tcp IN URI 10 1 "https://_example_.s3.amazonaws.com/ryan.id"\n';
  const ownerAddress = 'SP3AMDH2ZZB8XQK467V9HV5CRQF2RPBZ4MDMSBHJZ';
  fetchMock.once(JSON.stringify(sampleTokenFiles.ryan.body));

  resolveZoneFileToPerson(zoneFile, ownerAddress, profile => {
    expect(profile).toBeTruthy();
    expect(profile?.name).toEqual('Ryan Shea');
  });
});
