import * as logger from 'winston';
import * as bitcoinjs from 'bitcoinjs-lib';
import * as readline from 'readline';
import * as stream from 'stream';
import * as fs from 'fs';
import * as blockstack from 'blockstack';
import {
  getTypeString,
  ClarityAbiType,
  isClarityAbiPrimitive,
  isClarityAbiStringAscii,
  isClarityAbiStringUtf8,
  isClarityAbiBuffer,
  isClarityAbiResponse,
  isClarityAbiOptional,
  isClarityAbiTuple,
  isClarityAbiList,
  ClarityValue,
  intCV,
  uintCV,
  bufferCVFromString,
  stringAsciiCV,
  stringUtf8CV,
  someCV,
  trueCV,
  falseCV,
  standardPrincipalCV,
} from '@stacks/transactions';

import { StacksNetwork, TransactionVersion } from '@stacks/network';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ZoneFile = require('zone-file');

import {
  PRIVATE_KEY_NOSIGN_PATTERN,
  PRIVATE_KEY_PATTERN,
  PRIVATE_KEY_MULTISIG_PATTERN,
  PRIVATE_KEY_SEGWIT_P2SH_PATTERN,
  ID_ADDRESS_PATTERN,
} from './argparse';

import { CLITransactionSigner, isCLITransactionSigner } from './common';

import { decryptBackupPhrase } from './encrypt';

import { getOwnerKeyInfo, getApplicationKeyInfo, extractAppKey } from './keys';

import { NameInfoType, CLINetworkAdapter } from './network';

export interface UTXO {
  value?: number;
  confirmations?: number;
  tx_hash: string;
  tx_output_n: number;
}

export class NullSigner extends CLITransactionSigner {}

export class MultiSigKeySigner extends CLITransactionSigner {
  redeemScript: Buffer;
  privateKeys: string[];
  m: number;

  constructor(redeemScript: string, privateKeys: string[]) {
    super();
    this.redeemScript = Buffer.from(redeemScript, 'hex');
    this.privateKeys = privateKeys;
    this.isComplete = true;
    try {
      // try to deduce m (as in m-of-n)
      const chunks = bitcoinjs.script.decompile(this.redeemScript);
      const firstOp = chunks![0];
      this.m = parseInt(bitcoinjs.script.toASM([firstOp]).slice(3), 10);
      this.address = bitcoinjs.address.toBase58Check(
        bitcoinjs.crypto.hash160(this.redeemScript),
        blockstack.config.network.layer1.scriptHash
      );
    } catch (e) {
      logger.error(e);
      throw new Error('Improper redeem script for multi-sig input.');
    }
  }

  getAddress(): Promise<string> {
    return Promise.resolve().then(() => this.address);
  }

  signTransaction(txIn: bitcoinjs.TransactionBuilder, signingIndex: number): Promise<void> {
    return Promise.resolve().then(() => {
      const keysToUse = this.privateKeys.slice(0, this.m);
      keysToUse.forEach(keyHex => {
        const ecPair = blockstack.hexStringToECPair(keyHex);
        txIn.sign(signingIndex, ecPair, this.redeemScript);
      });
    });
  }

  signerVersion(): number {
    return 0;
  }
}

export class SegwitP2SHKeySigner extends CLITransactionSigner {
  redeemScript: Buffer;
  witnessScript: Buffer;
  privateKeys: string[];
  m: number;

  constructor(redeemScript: string, witnessScript: string, m: number, privateKeys: string[]) {
    super();
    this.redeemScript = Buffer.from(redeemScript, 'hex');
    this.witnessScript = Buffer.from(witnessScript, 'hex');
    this.address = bitcoinjs.address.toBase58Check(
      bitcoinjs.crypto.hash160(this.redeemScript),
      blockstack.config.network.layer1.scriptHash
    );

    this.privateKeys = privateKeys;
    this.m = m;
    this.isComplete = true;
  }

  getAddress(): Promise<string> {
    return Promise.resolve().then(() => this.address);
  }

  findUTXO(txIn: bitcoinjs.TransactionBuilder, signingIndex: number, utxos: UTXO[]): UTXO {
    // NOTE: this is O(n*2) complexity for n UTXOs when signing an n-input transaction
    // NOTE: as of bitcoinjs-lib 4.x, the "tx" field is private
    const private_tx = (txIn as any).__TX;
    const txidBuf = new Buffer(private_tx.ins[signingIndex].hash.slice());
    const outpoint = private_tx.ins[signingIndex].index;

    txidBuf.reverse(); // NOTE: bitcoinjs encodes txid as big-endian
    const txid = txidBuf.toString('hex');

    for (let i = 0; i < utxos.length; i++) {
      if (utxos[i].tx_hash === txid && utxos[i].tx_output_n === outpoint) {
        if (!utxos[i].value) {
          throw new Error(`UTXO for hash=${txid} vout=${outpoint} has no value`);
        }
        return utxos[i];
      }
    }
    throw new Error(`No UTXO for input hash=${txid} vout=${outpoint}`);
  }

  signTransaction(txIn: bitcoinjs.TransactionBuilder, signingIndex: number): Promise<void> {
    // This is an interface issue more than anything else.  Basically, in order to
    // form the segwit sighash, we need the UTXOs.  If we knew better, we would have
    // blockstack.js simply pass the consumed UTXO into this method.  But alas, we do
    // not.  Therefore, we need to re-query them.  This is probably fine, since we're
    // not pressured for time when it comes to generating transactions.
    return Promise.resolve()
      .then(() => {
        return this.getAddress();
      })
      .then(address => {
        return blockstack.config.network.getUTXOs(address);
      })
      .then(utxos => {
        const utxo = this.findUTXO(txIn, signingIndex, utxos);
        if (this.m === 1) {
          // p2sh-p2wpkh
          const ecPair = blockstack.hexStringToECPair(this.privateKeys[0]);
          txIn.sign(signingIndex, ecPair, this.redeemScript, undefined, utxo.value);
        } else {
          // p2sh-p2wsh
          const keysToUse = this.privateKeys.slice(0, this.m);
          keysToUse.forEach(keyHex => {
            const ecPair = blockstack.hexStringToECPair(keyHex);
            txIn.sign(
              signingIndex,
              ecPair,
              this.redeemScript,
              undefined,
              utxo.value,
              this.witnessScript
            );
          });
        }
      });
  }

  signerVersion(): number {
    return 0;
  }
}

export function hasKeys(signer: string | CLITransactionSigner): boolean {
  if (isCLITransactionSigner(signer)) {
    const s = signer;
    return s.isComplete;
  } else {
    return true;
  }
}

/*
 * Parse a string into a NullSigner
 * The string has the format "nosign:address"
 * @return a NullSigner instance
 */
export function parseNullSigner(addrString: string): NullSigner {
  if (!addrString.startsWith('nosign:')) {
    throw new Error('Invalid nosign string');
  }

  const addr = addrString.slice('nosign:'.length);
  return new NullSigner(addr);
}

/*
 * Parse a string into a MultiSigKeySigner.
 * The string has the format "m,pk1,pk2,...,pkn"
 * @serializedPrivateKeys (string) the above string
 * @return a MultiSigKeySigner instance
 */
export function parseMultiSigKeys(serializedPrivateKeys: string): MultiSigKeySigner {
  const matches = serializedPrivateKeys.match(PRIVATE_KEY_MULTISIG_PATTERN);
  if (!matches) {
    throw new Error('Invalid multisig private key string');
  }

  const m = parseInt(matches[1]);
  const parts = serializedPrivateKeys.split(',');
  const privkeys = [];
  for (let i = 1; i < 256; i++) {
    const pk = parts[i];
    if (!pk) {
      break;
    }

    if (!pk.match(PRIVATE_KEY_PATTERN)) {
      throw new Error('Invalid private key string');
    }

    privkeys.push(pk);
  }

  // generate public keys
  const pubkeys = privkeys.map(pk => {
    return Buffer.from(getPublicKeyFromPrivateKey(pk), 'hex');
  });

  // generate redeem script
  const multisigInfo = bitcoinjs.payments.p2ms({ m, pubkeys });
  return new MultiSigKeySigner(multisigInfo.output!.toString('hex'), privkeys);
}

/*
 * Parse a string into a SegwitP2SHKeySigner
 * The string has the format "segwit:p2sh:m,pk1,pk2,...,pkn"
 * @serializedPrivateKeys (string) the above string
 * @return a MultiSigKeySigner instance
 */
export function parseSegwitP2SHKeys(serializedPrivateKeys: string): SegwitP2SHKeySigner {
  const matches = serializedPrivateKeys.match(PRIVATE_KEY_SEGWIT_P2SH_PATTERN);
  if (!matches) {
    throw new Error('Invalid segwit p2sh private key string');
  }

  const m = parseInt(matches[1]);
  const parts = serializedPrivateKeys.split(',');
  const privkeys = [];
  for (let i = 1; i < 256; i++) {
    const pk = parts[i];
    if (!pk) {
      break;
    }

    if (!pk.match(PRIVATE_KEY_PATTERN)) {
      throw new Error('Invalid private key string');
    }

    privkeys.push(pk);
  }

  // generate public keys
  const pubkeys = privkeys.map(pk => {
    return Buffer.from(getPublicKeyFromPrivateKey(pk), 'hex');
  });

  // generate redeem script for p2wpkh or p2sh, depending on how many keys
  let redeemScript: string;
  let witnessScript = '';
  if (m === 1) {
    // p2wpkh
    const p2wpkh = bitcoinjs.payments.p2wpkh({ pubkey: pubkeys[0] });
    const p2sh = bitcoinjs.payments.p2sh({ redeem: p2wpkh });

    redeemScript = p2sh.redeem!.output!.toString('hex');
  } else {
    // p2wsh
    const p2ms = bitcoinjs.payments.p2ms({ m, pubkeys });
    const p2wsh = bitcoinjs.payments.p2wsh({ redeem: p2ms });
    const p2sh = bitcoinjs.payments.p2sh({ redeem: p2wsh });

    redeemScript = p2sh.redeem!.output!.toString('hex');
    witnessScript = p2wsh.redeem!.output!.toString('hex');
  }

  return new SegwitP2SHKeySigner(redeemScript, witnessScript, m, privkeys);
}

/*
 * Decode one or more private keys from a string.
 * Can be used to parse single private keys (as strings),
 * or multisig bundles (as CLITransactionSigners)
 * @serializedPrivateKey (string) the private key, encoded
 * @return a CLITransactionSigner or a String
 */
export function decodePrivateKey(serializedPrivateKey: string): string | CLITransactionSigner {
  const nosignMatches = serializedPrivateKey.match(PRIVATE_KEY_NOSIGN_PATTERN);
  if (!!nosignMatches) {
    // no private key
    return parseNullSigner(serializedPrivateKey);
  }

  const singleKeyMatches = serializedPrivateKey.match(PRIVATE_KEY_PATTERN);
  if (!!singleKeyMatches) {
    // one private key
    return serializedPrivateKey;
  }

  const multiKeyMatches = serializedPrivateKey.match(PRIVATE_KEY_MULTISIG_PATTERN);
  if (!!multiKeyMatches) {
    // multisig bundle
    return parseMultiSigKeys(serializedPrivateKey);
  }

  const segwitP2SHMatches = serializedPrivateKey.match(PRIVATE_KEY_SEGWIT_P2SH_PATTERN);
  if (!!segwitP2SHMatches) {
    // segwit p2sh bundle
    return parseSegwitP2SHKeys(serializedPrivateKey);
  }

  throw new Error('Unparseable private key');
}

type AnyJson = string | number | boolean | null | { [property: string]: AnyJson } | AnyJson[];

/*
 * JSON stringify helper
 * -- if stdout is a TTY, then pretty-format the JSON
 * -- otherwise, print it all on one line to make it easy for programs to consume
 */
export function JSONStringify(obj: AnyJson, stderr: boolean = false): string {
  if ((!stderr && process.stdout.isTTY) || (stderr && process.stderr.isTTY)) {
    return JSON.stringify(obj, null, 2);
  }
  return JSON.stringify(obj);
}

/*
 * Get a private key's public key, while honoring the 01 to compress it.
 * @privateKey (string) the hex-encoded private key
 */
export function getPublicKeyFromPrivateKey(privateKey: string): string {
  const ecKeyPair = blockstack.hexStringToECPair(privateKey);
  return ecKeyPair.publicKey.toString('hex');
}

/*
 * Get the canonical form of a hex-encoded private key
 * (i.e. strip the trailing '01' if present)
 */
export function canonicalPrivateKey(privkey: string): string {
  if (privkey.length == 66 && privkey.slice(-2) === '01') {
    return privkey.substring(0, 64);
  }
  return privkey;
}

/*
 * Hash160 function for zone files
 */
export function hash160(buff: Buffer): Buffer {
  return bitcoinjs.crypto.hash160(buff);
}

/*
 * Sign a profile into a JWT
 */
export function makeProfileJWT(profileData: object, privateKey: string): string {
  const signedToken = blockstack.signProfileToken(profileData, privateKey);
  const wrappedToken = blockstack.wrapProfileToken(signedToken);
  const tokenRecords = [wrappedToken];
  return JSONStringify(tokenRecords as unknown as AnyJson);
}

/*
 * Easier-to-use getNameInfo.  Returns null if the name does not exist.
 */
export function getNameInfoEasy(
  network: CLINetworkAdapter,
  name: string
): Promise<NameInfoType | null> {
  const nameInfoPromise = network
    .getNameInfo(name)
    .then((nameInfo: NameInfoType) => nameInfo)
    .catch((error: Error): null => {
      if (error.message === 'Name not found') {
        return null;
      } else {
        throw error;
      }
    });

  return nameInfoPromise;
}

/*
 * Look up a name's zone file, profile URL, and profile
 * Returns a Promise to the above, or throws an error.
 */
export async function nameLookup(
  network: CLINetworkAdapter,
  name: string,
  includeProfile: boolean = true
): Promise<{ profile: any; profileUrl?: string; zonefile?: string }> {
  const nameInfoPromise = getNameInfoEasy(network, name);
  const profilePromise = includeProfile
    ? blockstack.lookupProfile(name).catch(() => null)
    : Promise.resolve().then(() => null);

  const zonefilePromise = nameInfoPromise.then((nameInfo: NameInfoType | null) =>
    nameInfo ? nameInfo.zonefile : null
  );

  const [profile, zonefile, nameInfo] = await Promise.all([
    profilePromise,
    zonefilePromise,
    nameInfoPromise,
  ]);
  let profileObj = profile;

  if (!nameInfo) {
    throw new Error('Name not found');
  }
  if (nameInfo.hasOwnProperty('grace_period') && nameInfo.grace_period) {
    throw new Error(
      `Name is expired at block ${nameInfo.expire_block} ` +
        `and must be renewed by block ${nameInfo.renewal_deadline}`
    );
  }

  let profileUrl = null;
  try {
    const zonefileJSON = ZoneFile.parseZoneFile(zonefile);
    if (zonefileJSON.uri && zonefileJSON.hasOwnProperty('$origin')) {
      profileUrl = blockstack.getTokenFileUrl(zonefileJSON);
    }
  } catch (e) {
    profileObj = null;
  }

  const ret = {
    zonefile: zonefile,
    profile: profileObj,
    profileUrl: profileUrl,
  };
  // @ts-ignore
  return ret;
}

/*
 * Get a password.  Don't echo characters to stdout.
 * Password will be passed to the given callback.
 */
export function getpass(promptStr: string, cb: (passwd: string) => void) {
  const silentOutput = new stream.Writable({
    write: (_chunk, _encoding, callback) => {
      callback();
    },
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: silentOutput,
    terminal: true,
  });

  process.stderr.write(promptStr);
  rl.question('', passwd => {
    rl.close();
    process.stderr.write('\n');
    cb(passwd);
  });

  return;
}

/*
 * Extract a 12-word backup phrase.  If the raw 12-word phrase is given, it will
 * be returned.  If the ciphertext is given, the user will be prompted for a password
 * (if a password is not given as an argument).
 */
export async function getBackupPhrase(
  backupPhraseOrCiphertext: string,
  password?: string
): Promise<string> {
  if (backupPhraseOrCiphertext.split(/ +/g).length > 1) {
    // raw backup phrase
    return backupPhraseOrCiphertext;
  } else {
    // ciphertext
    const pass: string = await new Promise((resolve, reject) => {
      if (!process.stdin.isTTY && !password) {
        // password must be given
        reject(new Error('Password argument required in non-interactive mode'));
      } else if (process.env.password) {
        // Do not prompt password for unit tests
        resolve(process.env.password);
      } else {
        // prompt password
        getpass('Enter password: ', p => {
          resolve(p);
        });
      }
    });
    return await decryptBackupPhrase(Buffer.from(backupPhraseOrCiphertext, 'base64'), pass);
  }
}

/*
 * mkdir -p
 * path must be absolute
 */
export function mkdirs(path: string): void {
  if (path.length === 0 || path[0] !== '/') {
    throw new Error('Path must be absolute');
  }

  const pathParts = path.replace(/^\//, '').split('/');
  let tmpPath = '/';
  for (let i = 0; i <= pathParts.length; i++) {
    try {
      const statInfo = fs.lstatSync(tmpPath);
      if ((statInfo.mode & fs.constants.S_IFDIR) === 0) {
        throw new Error(`Not a directory: ${tmpPath}`);
      }
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        // need to create
        fs.mkdirSync(tmpPath);
      } else {
        throw e;
      }
    }
    if (i === pathParts.length) {
      break;
    }
    tmpPath = `${tmpPath}/${pathParts[i]}`;
  }
}

/*
 * Given a name or ID address, return a promise to the ID Address
 */
export async function getIDAddress(
  network: CLINetworkAdapter,
  nameOrIDAddress: string
): Promise<string> {
  if (nameOrIDAddress.match(ID_ADDRESS_PATTERN)) {
    return nameOrIDAddress;
  } else {
    // need to look it up
    const nameInfo = await network.getNameInfo(nameOrIDAddress);
    return `ID-${nameInfo.address}`;
  }
}

/*
 * Find all identity addresses until we have one that matches the given one.
 * Loops forever if not found
 */
export async function getOwnerKeyFromIDAddress(
  network: CLINetworkAdapter,
  mnemonic: string,
  idAddress: string
): Promise<string> {
  let index = 0;
  while (true) {
    const keyInfo = await getOwnerKeyInfo(network, mnemonic, index);
    if (keyInfo.idAddress === idAddress) {
      return keyInfo.privateKey;
    }
    index++;
  }
}

/*
 * Given a name or an ID address and a possibly-encrypted mnemonic, get the owner and app
 * private keys.
 * May prompt for a password if mnemonic is encrypted.
 */
export interface IDAppKeys {
  ownerPrivateKey: string;
  appPrivateKey: string;
  mnemonic: string;
}

export async function getIDAppKeys(
  network: CLINetworkAdapter,
  nameOrIDAddress: string,
  appOrigin: string,
  mnemonicOrCiphertext: string
): Promise<IDAppKeys> {
  const mnemonic = await getBackupPhrase(mnemonicOrCiphertext);
  const idAddress = await getIDAddress(network, nameOrIDAddress);
  const appKeyInfo = await getApplicationKeyInfo(network, mnemonic, idAddress, appOrigin);
  const appPrivateKey = extractAppKey(network, appKeyInfo);
  const ownerPrivateKey = await getOwnerKeyFromIDAddress(network, mnemonic, idAddress);
  const ret = {
    appPrivateKey,
    ownerPrivateKey,
    mnemonic,
  };
  return ret;
}

interface InquirerPrompt {
  type: string;
  name: string;
  message: string;
  choices?: string[];
}

export function makePromptsFromArgList(expectedArgs: ClarityFunctionArg[]): InquirerPrompt[] {
  const prompts = [];
  for (let i = 0; i < expectedArgs.length; i++) {
    prompts.push(argToPrompt(expectedArgs[i]));
  }
  return prompts;
}

export interface ClarityFunctionArg {
  name: string;
  type: ClarityAbiType;
}

export function argToPrompt(arg: ClarityFunctionArg): InquirerPrompt {
  const name = arg.name;
  const type = arg.type;
  const typeString = getTypeString(type);
  if (isClarityAbiPrimitive(type)) {
    if (type === 'uint128') {
      return {
        type: 'input',
        name,
        message: `Enter value for function argument "${name}" of type ${typeString}`,
      };
    } else if (type === 'int128') {
      return {
        type: 'input',
        name,
        message: `Enter value for function argument "${name}" of type ${typeString}`,
      };
    } else if (type === 'bool') {
      return {
        type: 'list',
        name,
        message: `Enter value for function argument "${name}" of type ${typeString}`,
        choices: ['True', 'False'],
      };
    } else if (type === 'principal') {
      return {
        type: 'input',
        name,
        message: `Enter value for function argument "${name}" of type ${typeString}`,
      };
    } else {
      throw new Error(`Contract function contains unsupported Clarity ABI type: ${typeString}`);
    }
  } else if (isClarityAbiBuffer(type)) {
    return {
      type: 'input',
      name,
      message: `Enter value for function argument "${name}" of type ${typeString}`,
    };
  } else if (isClarityAbiStringAscii(type)) {
    return {
      type: 'input',
      name,
      message: `Enter value for function argument "${name}" of type ${typeString}`,
    };
  } else if (isClarityAbiStringUtf8(type)) {
    return {
      type: 'input',
      name,
      message: `Enter value for function argument "${name}" of type ${typeString}`,
    };
  } else if (isClarityAbiResponse(type)) {
    throw new Error(`Contract function contains unsupported Clarity ABI type: ${typeString}`);
  } else if (isClarityAbiOptional(type)) {
    return {
      type: 'input',
      name,
      message: `Enter value for function argument "${name}" of type ${typeString}`,
    };
  } else if (isClarityAbiTuple(type)) {
    throw new Error(`Contract function contains unsupported Clarity ABI type: ${typeString}`);
  } else if (isClarityAbiList(type)) {
    throw new Error(`Contract function contains unsupported Clarity ABI type: ${typeString}`);
  } else {
    throw new Error(`Contract function contains unsupported Clarity ABI type: ${typeString}`);
  }
}

export function parseClarityFunctionArgAnswers(
  answers: any,
  expectedArgs: ClarityFunctionArg[]
): ClarityValue[] {
  const functionArgs: ClarityValue[] = [];
  for (let i = 0; i < expectedArgs.length; i++) {
    const expectedArg = expectedArgs[i];
    const answer = answers[expectedArg.name];
    functionArgs.push(answerToClarityValue(answer, expectedArg));
  }
  return functionArgs;
}

export function answerToClarityValue(answer: any, arg: ClarityFunctionArg): ClarityValue {
  const type = arg.type;
  const typeString = getTypeString(type);
  if (isClarityAbiPrimitive(type)) {
    if (type === 'uint128') {
      return uintCV(answer);
    } else if (type === 'int128') {
      return intCV(answer);
    } else if (type === 'bool') {
      return answer == 'True' ? trueCV() : falseCV();
    } else if (type === 'principal') {
      // TODO handle contract principals
      return standardPrincipalCV(answer);
    } else {
      throw new Error(`Contract function contains unsupported Clarity ABI type: ${typeString}`);
    }
  } else if (isClarityAbiBuffer(type)) {
    return bufferCVFromString(answer);
  } else if (isClarityAbiStringAscii(type)) {
    return stringAsciiCV(answer);
  } else if (isClarityAbiStringUtf8(type)) {
    return stringUtf8CV(answer);
  } else if (isClarityAbiResponse(type)) {
    throw new Error(`Contract function contains unsupported Clarity ABI type: ${typeString}`);
  } else if (isClarityAbiOptional(type)) {
    return someCV(
      answerToClarityValue(answer, { name: arg.name, type: type.optional } as ClarityFunctionArg)
    );
  } else if (isClarityAbiTuple(type)) {
    throw new Error(`Contract function contains unsupported Clarity ABI type: ${typeString}`);
  } else if (isClarityAbiList(type)) {
    throw new Error(`Contract function contains unsupported Clarity ABI type: ${typeString}`);
  } else {
    throw new Error(`Contract function contains unsupported Clarity ABI type: ${typeString}`);
  }
}

export function generateExplorerTxPageUrl(txid: string, network: StacksNetwork): string {
  if (network.transactionVersion === TransactionVersion.Testnet) {
    return `https://explorer.hiro.so/txid/0x${txid}?chain=testnet`;
  } else {
    return `https://explorer.hiro.so/txid/0x${txid}?chain=mainnet`;
  }
}

export function isTestnetAddress(address: string) {
  const addressInfo = bitcoinjs.address.fromBase58Check(address);
  return addressInfo.version === bitcoinjs.networks.testnet.pubKeyHash;
}

/**
 * Reference: https://github.com/stacks-network/subdomain-registrar/blob/da2d144f4355bb1d67f67d1ae5f329b476d647d6/src/operations.js#L18
 */
export type SubdomainOp = {
  owner: string;
  sequenceNumber: number;
  zonefile: string;
  subdomainName: string;
  signature?: string;
};

/**
 * Reference: https://github.com/stacks-network/subdomain-registrar/blob/da2d144f4355bb1d67f67d1ae5f329b476d647d6/src/operations.js#L55
 */
function destructZonefile(zonefile: string) {
  const encodedZonefile = Buffer.from(zonefile).toString('base64');
  // we pack into 250 byte strings -- the entry "zf99=" eliminates 5 useful bytes,
  // and the max is 255.
  const pieces = 1 + Math.floor(encodedZonefile.length / 250);
  const destructed = [];
  for (let i = 0; i < pieces; i++) {
    const startIndex = i * 250;
    const currentPiece = encodedZonefile.slice(startIndex, startIndex + 250);
    if (currentPiece.length > 0) {
      destructed.push(currentPiece);
    }
  }
  return destructed;
}

/**
 * Reference: https://github.com/stacks-network/subdomain-registrar/blob/da2d144f4355bb1d67f67d1ae5f329b476d647d6/src/operations.js#L71
 */
export function subdomainOpToZFPieces(operation: SubdomainOp) {
  const destructedZonefile = destructZonefile(operation.zonefile);
  const txt = [
    `owner=${operation.owner}`,
    `seqn=${operation.sequenceNumber}`,
    `parts=${destructedZonefile.length}`,
  ];
  destructedZonefile.forEach((zfPart, ix) => txt.push(`zf${ix}=${zfPart}`));

  if (operation.signature) {
    txt.push(`sig=${operation.signature}`);
  }

  return {
    name: operation.subdomainName,
    txt,
  };
}
