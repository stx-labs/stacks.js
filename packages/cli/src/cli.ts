import * as scureBip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { buildPreorderNameTx, buildRegisterNameTx } from '@stacks/bns';
import { bytesToHex } from '@stacks/common';
import {
  ACCOUNT_PATH,
  broadcastTransaction,
  Cl,
  ClarityAbi,
  ClarityValue,
  ContractCallPayload,
  createContractCallPayload,
  cvToJSON,
  cvToString,
  estimateTransactionByteLength,
  fetchAbi,
  fetchCallReadOnlyFunction,
  fetchFeeEstimateTransaction,
  fetchFeeEstimateTransfer,
  getAddressFromPrivateKey,
  makeContractCall,
  makeContractDeploy,
  makeSTXTokenTransfer,
  PostConditionMode,
  privateKeyToPublic,
  ReadOnlyFunctionOptions,
  serializePayload,
  SignedContractCallOptions,
  SignedContractDeployOptions,
  SignedTokenTransferOptions,
  signWithKey,
  StacksTransactionWire,
  TransactionSigner,
  TxBroadcastResult,
  validateContractCall,
} from '@stacks/transactions';
import * as bitcoin from 'bitcoinjs-lib';
import * as blockstack from 'blockstack';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { prompt } from 'inquirer';
import fetch from 'node-fetch';
import * as path from 'path';
import * as process from 'process';
import * as winston from 'winston';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const c32check = require('c32check');

import { UserData } from '@stacks/auth';
import 'cross-fetch/polyfill';

import { StackerInfo, StackingClient } from '@stacks/stacking';

import { AccountsApi, Configuration, FaucetsApi } from '@stacks/blockchain-api-client';

import { GaiaHubConfig } from '@stacks/storage';

import {
  extractAppKey,
  getApplicationKeyInfo,
  getOwnerKeyInfo,
  getPaymentKeyInfo,
  getStacksWalletKeyInfo,
  OwnerKeyInfoType,
  PaymentKeyInfoType,
  StacksKeyInfoType,
  STX_WALLET_COMPATIBLE_SEED_STRENGTH,
} from './keys';

import {
  checkArgs,
  CLI_ARGS,
  CLIOptAsBool,
  CLIOptAsString,
  CLIOptAsStringArray,
  DEFAULT_CONFIG_PATH,
  DEFAULT_CONFIG_TESTNET_PATH,
  getCLIOpts,
  ID_ADDRESS_PATTERN,
  loadConfig,
  makeAllCommandsList,
  makeCommandUsageString,
  STACKS_ADDRESS_PATTERN,
  USAGE,
} from './argparse';

import { decryptBackupPhrase, encryptBackupPhrase } from './encrypt';

import {
  CLI_NETWORK_OPTS,
  CLINetworkAdapter,
  getNetwork,
  getStacksNetwork,
  NameInfoType,
} from './network';

import { gaiaAuth, gaiaConnect, gaiaUploadProfileAll, getGaiaAddressFromProfile } from './data';

import { STACKS_TESTNET } from '@stacks/network';
import { internal_parseCommaSeparated } from '@stacks/transactions';
import {
  generateNewAccount,
  generateWallet,
  getAppPrivateKey,
  restoreWalletAccounts,
} from '@stacks/wallet-sdk';
import { getMaxIDSearchIndex, getPrivateKeyAddress, setMaxIDSearchIndex } from './common';
import {
  canonicalPrivateKey,
  ClarityFunctionArg,
  decodePrivateKey,
  generateExplorerTxPageUrl,
  getBackupPhrase,
  getIDAppKeys,
  getNameInfoEasy,
  getpass,
  IDAppKeys,
  isTestnetAddress,
  JSONStringify,
  makeProfileJWT,
  makePromptsFromArgList,
  mkdirs,
  parseClarityFunctionArgAnswers,
  SubdomainOp,
  subdomainOpToZFPieces,
} from './utils';

// global CLI options
let txOnly = false;
let estimateOnly = false;
let safetyChecks = true;
let receiveFeesPeriod = 52595;
let gracePeriod = 5000;
const noExit = false;

let BLOCKSTACK_TEST = !!process.env.BLOCKSTACK_TEST;

/*
 * Sign a profile.
 * @path (string) path to the profile
 * @privateKey (string) the owner key (must be single-sig)
 */
// TODO: fix, network is never used
// @ts-ignore
function profileSign(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const profilePath = args[0];
  const profileData = JSON.parse(fs.readFileSync(profilePath).toString());
  return Promise.resolve().then(() => makeProfileJWT(profileData, args[1]));
}

/*
 * Verify a profile with an address or public key
 * @path (string) path to the profile
 * @publicKeyOrAddress (string) public key or address
 */
function profileVerify(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const profilePath = args[0];
  let publicKeyOrAddress = args[1];

  // need to coerce mainnet
  if (publicKeyOrAddress.match(ID_ADDRESS_PATTERN)) {
    publicKeyOrAddress = _network.coerceMainnetAddress(publicKeyOrAddress.slice(3));
  }

  const profileString = fs.readFileSync(profilePath).toString();

  return Promise.resolve().then(() => {
    let profileToken = null;

    try {
      const profileTokens = JSON.parse(profileString);
      profileToken = profileTokens[0].token;
    } catch (e) {
      // might be a raw token
      profileToken = profileString;
    }

    if (!profileToken) {
      throw new Error(`Data at ${profilePath} does not appear to be a signed profile`);
    }

    const profile = blockstack.extractProfile(profileToken, publicKeyOrAddress);
    return JSONStringify(profile);
  });
}

/*
 * Store a signed profile for a name or an address.
 * * verify that the profile was signed by the name's owner address
 * * verify that the private key matches the name's owner address
 *
 * Assumes that the URI records are all Gaia hubs
 *
 * @nameOrAddress (string) name or address that owns the profile
 * @path (string) path to the signed profile token
 * @privateKey (string) owner private key for the name
 * @gaiaUrl (string) this is the write endpoint of the Gaia hub to use
 */
function profileStore(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const nameOrAddress = args[0];
  const signedProfilePath = args[1];
  const privateKey = decodePrivateKey(args[2]);
  const gaiaHubUrl = args[3];

  const signedProfileData = fs.readFileSync(signedProfilePath).toString();

  const ownerAddress = getPrivateKeyAddress(_network, privateKey);
  const ownerAddressMainnet = _network.coerceMainnetAddress(ownerAddress);

  let nameInfoPromise: Promise<NameInfoType | null>;
  let name = '';

  if (nameOrAddress.startsWith('ID-')) {
    // ID-address
    nameInfoPromise = Promise.resolve().then(() => {
      return {
        address: nameOrAddress.slice(3),
      };
    });
  } else {
    // name; find the address
    nameInfoPromise = getNameInfoEasy(_network, nameOrAddress);
    name = nameOrAddress;
  }

  const verifyProfilePromise = profileVerify(_network, [
    signedProfilePath,
    `ID-${ownerAddressMainnet}`,
  ]);

  return Promise.all([nameInfoPromise, verifyProfilePromise])
    .then(([nameInfo, _verifiedProfile]: [NameInfoType | null, any]) => {
      if (
        safetyChecks &&
        (!nameInfo ||
          _network.coerceAddress(nameInfo.address) !== _network.coerceAddress(ownerAddress))
      ) {
        throw new Error(
          'Name owner address either could not be found, or does not match ' +
            `private key address ${ownerAddress}`
        );
      }
      return gaiaUploadProfileAll(_network, [gaiaHubUrl], signedProfileData, args[2], name);
    })
    .then((gaiaUrls: { dataUrls?: string[] | null; error?: string | null }) => {
      if (gaiaUrls.hasOwnProperty('error')) {
        return JSONStringify({ dataUrls: gaiaUrls.dataUrls!, error: gaiaUrls.error! }, true);
      } else {
        return JSONStringify({ profileUrls: gaiaUrls.dataUrls! });
      }
    });
}

/*
 * Get the app private key(s) from a backup phrase
 * and an index of the enumerated accounts
 * args:
 * @mnemonic (string) the 12-word phrase
 * @index (number) the index of the account
 * @appOrigin (string) the application's origin URL
 */
async function getAppKeys(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const mnemonic = await getBackupPhrase(args[0]);
  const index = parseInt(args[1]);
  if (index <= 0) throw new Error('index must be greater than 0');
  const appDomain = args[2];
  let wallet = await generateWallet({ secretKey: mnemonic, password: '' });
  for (let i = 0; i < index; i++) {
    wallet = generateNewAccount(wallet);
  }
  const account = wallet.accounts[index - 1];
  const privateKey = getAppPrivateKey({ account, appDomain });
  const address = getAddressFromPrivateKey(privateKey, getStacksNetwork(_network));

  return JSON.stringify({ keyInfo: { privateKey, address } });
}

/*
 * Get the owner private key(s) from a backup phrase
 * args:
 * @mnemonic (string) the 12-word phrase
 * @max_index (integer) (optional) the profile index maximum
 */
async function getOwnerKeys(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const mnemonic = await getBackupPhrase(args[0]);
  let maxIndex = 1;
  if (args.length > 1 && !!args[1]) {
    maxIndex = parseInt(args[1]);
  }

  const keyInfo: OwnerKeyInfoType[] = [];
  for (let i = 0; i < maxIndex; i++) {
    keyInfo.push(await getOwnerKeyInfo(_network, mnemonic, i));
  }

  return JSONStringify(keyInfo);
}

/*
 * Get the payment private key from a backup phrase
 * args:
 * @mnemonic (string) the 12-word phrase
 */
async function getPaymentKey(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const mnemonic = await getBackupPhrase(args[0]);
  // keep the return value consistent with getOwnerKeys
  const keyObj = await getPaymentKeyInfo(_network, mnemonic);
  const keyInfo: PaymentKeyInfoType[] = [];
  keyInfo.push(keyObj);
  return JSONStringify(keyInfo);
}

/*
 * Get the payment private key from a backup phrase used by the Stacks wallet
 * args:
 * @mnemonic (string) the 24-word phrase
 */
async function getStacksWalletKey(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const mnemonic = await getBackupPhrase(args[0]);
  const derivationPath: string | undefined = args[1] || undefined;
  // keep the return value consistent with getOwnerKeys
  const keyObj = await getStacksWalletKeyInfo(_network, mnemonic, derivationPath);
  const keyInfo: StacksKeyInfoType[] = [];
  keyInfo.push(keyObj);
  return JSONStringify(keyInfo);
}

/**
 * Enable users to transfer subdomains to wallet-key addresses that correspond to all data-key addresses
 * Reference: https://github.com/hirosystems/stacks.js/issues/1209
 * args:
 * @mnemonic (string) the seed phrase to retrieve the privateKey & address
 * @registrarUrl (string) URL of the registrar to use (defaults to 'https://registrar.stacks.co')
 */
async function migrateSubdomains(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const mnemonic: string = await getBackupPhrase(args[0]); // args[0] is the cli argument for mnemonic
  const baseWallet = await generateWallet({ secretKey: mnemonic, password: '' });
  const network = getStacksNetwork(_network);
  const wallet = await restoreWalletAccounts({
    wallet: baseWallet,
    gaiaHubUrl: 'https://hub.blockstack.org',
    network,
  });
  console.log(
    `Accounts found: ${wallet.accounts.length}\n(Accounts will be checked for both compressed and uncompressed public keys)`
  );
  const payload = { subdomains_list: <SubdomainOp[]>[] }; // Payload required by transfer endpoint

  const accounts = wallet.accounts
    .map(account => [
      // Duplicate accounts (taking once as uncompressed, once as compressed)
      { ...account, dataPrivateKey: account.dataPrivateKey },
      { ...account, dataPrivateKey: account.dataPrivateKey + '01' },
    ])
    .flat();

  for (const account of accounts) {
    console.log('\nAccount:', account);

    const dataKeyAddress = getAddressFromPrivateKey(account.dataPrivateKey, network); // source
    const walletKeyAddress = getAddressFromPrivateKey(account.stxPrivateKey, network); // target

    console.log(`Finding subdomains for data-key address '${dataKeyAddress}'`);
    const namesResponse = await fetch(
      `${network.client.baseUrl}/v1/addresses/stacks/${dataKeyAddress}`
    );
    const namesJson = await namesResponse.json();

    if ((namesJson.names?.length || 0) <= 0) {
      console.log(`No subdomains found for address '${dataKeyAddress}'`);
      continue;
    }

    const regExp = /(\..*){2,}/; // has two or more dots somewhere
    const subDomains = namesJson.names.filter((val: string) => regExp.test(val));

    if (subDomains.length === 0) console.log(`No subdomains found for address '${dataKeyAddress}'`);

    for (const subdomain of subDomains) {
      // Alerts the user to any subdomains that can't be migrated to these wallet-key-derived addresses
      // Given collision with existing usernames owned by them
      const namesResponse = await fetch(
        `${network.client.baseUrl}/v1/addresses/stacks/${walletKeyAddress}`
      );
      const existingNames = await namesResponse.json();
      if (existingNames.names?.includes(subdomain)) {
        console.log(`Error: Subdomain '${subdomain}' already exists in wallet-key address.`);
        continue;
      }

      // Validate user owns the subdomain
      const nameInfo = await fetch(`${network.client.baseUrl}/v1/names/${subdomain}`);
      const nameInfoJson = await nameInfo.json();
      console.log('Subdomain Info: ', nameInfoJson);
      if (nameInfoJson.address !== dataKeyAddress) {
        console.log(`Error: The account is not the owner of the subdomain '${subdomain}'`);
        continue;
      }

      const promptName = subdomain.replaceAll('.', '_'); // avoid confusing with nested prompt response
      const confirmMigration: { [promptName: string]: string } = await prompt([
        {
          name: promptName,
          message: `Do you want to migrate the domain '${subdomain}'`,
          type: 'confirm',
        },
      ]);
      // On 'NO', move to next account
      if (!confirmMigration[promptName]) continue;

      // Prepare migration operation
      const [subdomainName] = subdomain.split('.'); // registrar expects only the first part of a subdomain
      const subDomainOp: SubdomainOp = {
        subdomainName,
        owner: walletKeyAddress, // new owner address / wallet-key address (compressed)
        zonefile: nameInfoJson.zonefile,
        sequenceNumber: 1, // should be 'old sequence number + 1', but cannot find old sequence number so assuming 1. client should calculate it again.
      };

      const subdomainPieces = subdomainOpToZFPieces(subDomainOp);
      const textToSign = subdomainPieces.txt.join(',');

      // Generate signature: https://docs.stacks.co/build-apps/references/bns#subdomain-lifecycle
      /**
       * *********************** IMPORTANT **********************************************
       * If the subdomain owner wants to change the address of their subdomain,         *
       * they need to sign a subdomain-transfer operation and                           *
       * give it to the on-chain name owner who created the subdomain.                  *
       * They then package it into a zone file and broadcast it.                        *
       * *********************** IMPORTANT **********************************************
       * subdomain operation will only be accepted if it has a later "sequence=" number,*
       * and a valid signature in "sig=" over the transaction body .The "sig=" field    *
       * includes both the public key and signature, and the public key must hash to    *
       * the previous subdomain operation's "addr=" field                               *
       * ********************************************************************************
       */
      const hash = crypto.createHash('sha256').update(textToSign).digest('hex');
      const sig = signWithKey(account.dataPrivateKey, hash);

      // https://docs.stacks.co/build-apps/references/bns#subdomain-lifecycle
      subDomainOp.signature = sig;

      payload.subdomains_list.push(subDomainOp);
    }
  }

  console.log('\nSubdomain Operation Payload:', payload);
  if (payload.subdomains_list.length <= 0) {
    return '"No subdomains found or selected. Canceling..."';
  }

  // Subdomains batch migration
  // Payload contains list of subdomains that user opted for migration
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };

  // args[1] is the cli argument for registrarUrl to optionally replace default url
  const registrarUrl = args[1] || 'https://registrar.stacks.co';
  const migrationURL = `${registrarUrl}/transfer`;

  console.log('Sending migration request...');
  return fetch(migrationURL, options)
    .then(response => {
      if (response.status === 404) {
        return Promise.reject({
          status: response.status,
          error: response.statusText,
        });
      }
      return response.json();
    })
    .then(response => {
      if (response.txid)
        console.log(
          `The transaction will take some time to complete. Track its progress using the explorer: https://explorer.hiro.so/txid/0x${response.txid}`
        );
      return Promise.resolve(JSONStringify(response));
    })
    .catch(error => error);
}

/*
 * Make a private key and output it
 * args:
 * @mnemonic (string) OPTIONAL; the 12-word phrase
 */
async function makeKeychain(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const mnemonic: string = args[0]
    ? await getBackupPhrase(args[0])
    : scureBip39.generateMnemonic(wordlist, STX_WALLET_COMPATIBLE_SEED_STRENGTH);

  const derivationPath: string | undefined = args[1] || undefined;
  const stacksKeyInfo = await getStacksWalletKeyInfo(_network, mnemonic, derivationPath);

  return JSONStringify({
    mnemonic,
    keyInfo: stacksKeyInfo,
  });
}

/*
 * Get an address's tokens and their balances.
 * Takes either a Bitcoin or Stacks address
 * args:
 * @address (string) the address
 */
function balance(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  let address = args[0];

  if (BLOCKSTACK_TEST) {
    // force testnet address if we're in testnet mode
    address = _network.coerceAddress(address);
  }

  const url = _network.nodeAPIUrl;
  return fetch(`${url}${ACCOUNT_PATH}/${address}?proof=0`)
    .then(response => {
      if (response.status === 404) {
        return Promise.reject({
          status: response.status,
          error: response.statusText,
        });
      }
      return response.json();
    })
    .then(response => {
      const res = {
        balance: BigInt(response.balance).toString(10),
        locked: BigInt(response.locked).toString(10),
        unlock_height: response.unlock_height,
        nonce: response.nonce,
      };
      return Promise.resolve(JSONStringify(res));
    })
    .catch(error => error);
}

/*
 * Get a page of the account's history
 * args:
 * @address (string) the account address
 * @page (int) the page of the history to fetch (optional)
 */
function getAccountHistory(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const address = c32check.c32ToB58(args[0]);

  if (args.length >= 2 && !!args[1]) {
    const page = parseInt(args[1]);
    return Promise.resolve()
      .then(() => {
        return _network.getAccountHistoryPage(address, page);
      })
      .then(accountStates =>
        JSONStringify(
          accountStates.map((s: any) => {
            const new_s = {
              address: c32check.b58ToC32(s.address),
              credit_value: s.credit_value.toString(),
              debit_value: s.debit_value.toString(),
            };
            return new_s;
          })
        )
      );
  } else {
    // all pages
    let history: any[] = [];

    function getAllAccountHistoryPages(page: number): Promise<any[]> {
      return _network.getAccountHistoryPage(address, page).then((results: any[]) => {
        if (results.length == 0) {
          return history;
        } else {
          history = history.concat(results);
          return getAllAccountHistoryPages(page + 1);
        }
      });
    }

    return getAllAccountHistoryPages(0).then((accountStates: any[]) =>
      JSONStringify(
        accountStates.map((s: any) => {
          const new_s = {
            address: c32check.b58ToC32(s.address),
            credit_value: s.credit_value.toString(),
            debit_value: s.debit_value.toString(),
          };
          return new_s;
        })
      )
    );
  }
}

// /*
//  * Get the account's state(s) at a particular block height
//  * args:
//  * @address (string) the account address
//  * @blockHeight (int) the height at which to query
//  */
// function getAccountAt(network: CLINetworkAdapter, args: string[]) : Promise<string> {
//   const address = c32check.c32ToB58(args[0]);
//   const blockHeight = parseInt(args[1]);

//   return Promise.resolve().then(() => {
//     return network.getAccountAt(address, blockHeight);
//   })
//     .then(accountStates => accountStates.map((s : any) => {
//       const new_s = {
//         address: c32check.b58ToC32(s.address),
//         credit_value: s.credit_value.toString(),
//         debit_value: s.debit_value.toString()
//       };
//       return new_s;
//     }))
//     .then(history => JSONStringify(history));
// }

// /*
//  * Sends BTC from one private key to another address
//  * args:
//  * @recipientAddress (string) the recipient's address
//  * @amount (string) the amount of BTC to send
//  * @privateKey (string) the private key that owns the BTC
//  */
// function sendBTC(network: CLINetworkAdapter, args: string[]) : Promise<string> {
//   const destinationAddress = args[0];
//   const amount = parseInt(args[1]);
//   const paymentKeyHex = decodePrivateKey(args[2]);

//   if (amount <= 5500) {
//     throw new Error('Invalid amount (must be greater than 5500)');
//   }

//   let paymentKey;
//   if (typeof paymentKeyHex === 'string') {
//     // single-sig
//     paymentKey = blockstack.PubkeyHashSigner.fromHexString(paymentKeyHex);
//   }
//   else {
//     // multi-sig or segwit
//     paymentKey = paymentKeyHex;
//   }

//   const txPromise = blockstack.transactions.makeBitcoinSpend(destinationAddress, paymentKey, amount, !hasKeys(paymentKeyHex))
//     .catch((e : Error) => {
//       if (e.name === 'InvalidAmountError') {
//         return JSONStringify({
//           'status': false,
//           'error': e.message
//         }, true);
//       }
//       else {
//         throw e;
//       }
//     });

//   if (txOnly) {
//     return txPromise;
//   }
//   else {
//     return txPromise.then((tx : string) => {
//       return network.broadcastTransaction(tx);
//     })
//       .then((txid : string) => {
//         return txid;
//       });
//   }
// }

/*
 * Send tokens from one account private key to another account's address.
 * args:
 * @recipientAddress (string) the recipient's account address
 * @tokenAmount (int) the number of tokens to send
 * @fee (int) the transaction fee to be paid
 * @nonce (int) integer nonce needs to be incremented after each transaction from an account
 * @privateKey (string) the hex-encoded private key to use to send the tokens
 * @memo (string) OPTIONAL: a 34-byte memo to include
 */
async function sendTokens(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const recipientAddress = args[0];
  const tokenAmount = BigInt(args[1]);
  const fee = BigInt(args[2]);
  const nonce = BigInt(args[3]);
  const privateKey = args[4];

  let memo = '';

  if (args.length > 4 && !!args[5]) {
    memo = args[5];
  }

  const network = getStacksNetwork(_network);

  const options: SignedTokenTransferOptions = {
    recipient: recipientAddress,
    amount: tokenAmount,
    senderKey: privateKey,
    fee,
    nonce,
    memo,
    network,
  };

  const tx: StacksTransactionWire = await makeSTXTokenTransfer(options);

  if (estimateOnly) {
    return fetchFeeEstimateTransfer({ transaction: tx, network }).then(cost => {
      return cost.toString(10);
    });
  }

  if (txOnly) {
    return Promise.resolve(tx.serialize());
  }

  return broadcastTransaction({ transaction: tx, network })
    .then((response: TxBroadcastResult) => {
      if (response.hasOwnProperty('error')) {
        return response;
      }
      return {
        txid: `0x${tx.txid()}`,
        transaction: generateExplorerTxPageUrl(tx.txid(), network),
      };
    })
    .catch(error => {
      return error.toString();
    });
}

/*
 * Depoly a Clarity smart contract.
 * args:
 * @source (string) path to the contract source file
 * @contractName (string) the name of the contract
 * @fee (int) the transaction fee to be paid
 * @nonce (int) integer nonce needs to be incremented after each transaction from an account
 * @privateKey (string) the hex-encoded private key to use to send the tokens
 */
async function contractDeploy(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const sourceFile = args[0];
  const contractName = args[1];
  const fee = BigInt(args[2]);
  const nonce = BigInt(args[3]);
  const privateKey = args[4];

  const source = fs.readFileSync(sourceFile).toString();

  const network = getStacksNetwork(_network);

  const options: SignedContractDeployOptions = {
    contractName,
    codeBody: source,
    senderKey: privateKey,
    fee,
    nonce,
    network,
    postConditionMode: 'allow',
  };

  const tx = await makeContractDeploy(options);

  if (estimateOnly) {
    return fetchFeeEstimateTransaction({
      payload: serializePayload(tx.payload),
      estimatedLength: estimateTransactionByteLength(tx),
      network,
    }).then(costs => costs[1].fee.toString(10));
  }

  if (txOnly) {
    return Promise.resolve(tx.serialize());
  }

  return broadcastTransaction({ transaction: tx, network })
    .then(response => {
      if (response.hasOwnProperty('error')) {
        return response;
      }
      return {
        txid: `0x${tx.txid()}`,
        transaction: generateExplorerTxPageUrl(tx.txid(), network),
      };
    })
    .catch(error => {
      return error.toString();
    });
}

/** @internal */
export function parseDirectFunctionArgs(functionArgsStr: string): ClarityValue[] {
  return internal_parseCommaSeparated(functionArgsStr);
}

// Get function arguments via interactive prompts
async function getInteractiveFunctionArgs(abiArgs: ClarityFunctionArg[]): Promise<ClarityValue[]> {
  const prompts = makePromptsFromArgList(abiArgs);
  const answers = await prompt(prompts);
  return parseClarityFunctionArgAnswers(answers, abiArgs);
}

/*
 * Call a Clarity smart contract function.
 * args:
 * @contractAddress (string) the address of the contract
 * @contractName (string) the name of the contract
 * @functionName (string) the name of the function to call
 * @fee (int) the transaction fee to be paid
 * @nonce (int) integer nonce needs to be incremented after each transaction from an account
 * @privateKey (string) the hex-encoded private key to use to send the tokens
 */
async function contractFunctionCall(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const contractAddress = args[0];
  const contractName = args[1];
  const functionName = args[2];
  const fee = BigInt(args[3]);
  const nonce = BigInt(args[4]);
  const privateKey = args[5];
  const functionArgsStr = args.length > 6 ? args[6] : undefined;

  const network = getStacksNetwork(_network);

  const abi = await fetchAbi({ contractAddress, contractName, network });
  const filteredFn = abi.functions.filter(fn => fn.name === functionName);

  if (filteredFn.length !== 1) {
    throw new Error(`Function ${functionName} not found in contract ${contractName}`);
  }

  const abiArgs = filteredFn[0].args;
  const functionArgs = functionArgsStr
    ? parseDirectFunctionArgs(functionArgsStr)
    : await getInteractiveFunctionArgs(abiArgs);

  const payload = createContractCallPayload(
    contractAddress,
    contractName,
    functionName,
    functionArgs
  );
  validateContractCall(payload, abi);

  const options: SignedContractCallOptions = {
    contractAddress,
    contractName,
    functionName,
    functionArgs,
    senderKey: privateKey,
    fee,
    nonce,
    network,
    postConditionMode: PostConditionMode.Allow,
  };

  const tx = await makeContractCall(options);

  if (!validateContractCall(tx.payload as ContractCallPayload, abi)) {
    throw new Error('Failed to validate function arguments against ABI');
  }

  if (estimateOnly) {
    const costs = await fetchFeeEstimateTransaction({
      payload: serializePayload(tx.payload),
      estimatedLength: estimateTransactionByteLength(tx),
      network,
    });
    return costs[1].fee.toString(10);
  }

  if (txOnly) return tx.serialize();

  try {
    const response = await broadcastTransaction({ transaction: tx, network });
    if (response.hasOwnProperty('error')) return JSONStringify(response);

    return JSONStringify({
      txid: `0x${tx.txid()}`,
      transaction: generateExplorerTxPageUrl(tx.txid(), network),
    });
  } catch (error) {
    if (error instanceof Error) return error.message;
    return 'Unknown error occurred';
  }
}

/*
 * Call a read-only Clarity smart contract function.
 * args:
 * @contractAddress (string) the address of the contract
 * @contractName (string) the name of the contract
 * @functionName (string) the name of the function to call
 * @senderAddress (string) the sender address
 */
async function readOnlyContractFunctionCall(
  _network: CLINetworkAdapter,
  args: string[]
): Promise<string> {
  const contractAddress = args[0];
  const contractName = args[1];
  const functionName = args[2];
  const senderAddress = args[3];

  const network = getStacksNetwork(_network);

  let abi: ClarityAbi;
  let abiArgs: ClarityFunctionArg[];
  let functionArgs: ClarityValue[] = [];

  return fetchAbi({ contractAddress, contractName, network })
    .then(responseAbi => {
      abi = responseAbi;
      const filtered = abi.functions.filter(fn => fn.name === functionName);
      if (filtered.length === 1) {
        abiArgs = filtered[0].args;
        return makePromptsFromArgList(abiArgs);
      } else {
        return null;
      }
    })
    .then(prompts => prompt(prompts!))
    .then(answers => {
      functionArgs = parseClarityFunctionArgAnswers(answers, abiArgs);

      const options: ReadOnlyFunctionOptions = {
        contractAddress,
        contractName,
        functionName,
        functionArgs,
        senderAddress,
        network,
      };

      return fetchCallReadOnlyFunction(options);
    })
    .then(returnValue => {
      return cvToString(returnValue);
    })
    .catch(error => {
      return error.toString();
    });
}

/*
 * Decode a serialized Clarity value
 * args:
 * @value (string) the hex string of the serialized value, or '-' to read from stdin
 * @format (string) the format to output the value in; one of 'pretty', 'json', or 'repr'
 */
function decodeCV(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const inputArg = args[0];
  const format = args[1];

  let inputValue: string;
  if (inputArg === '-') {
    inputValue = fs.readFileSync(process.stdin.fd, 'utf-8').trim();
  } else {
    inputValue = inputArg;
  }

  const cv = Cl.deserialize(inputValue);
  let cvString: string;
  if (format === 'pretty') {
    cvString = Cl.prettyPrint(cv, 2);
  } else if (format === 'json') {
    cvString = JSON.stringify(cvToJSON(cv));
  } else if (format === 'repr' || !format) {
    cvString = cvToString(cv);
  } else {
    throw new Error('Invalid format option');
  }
  return Promise.resolve(cvString);
}

// /*
//  * Get the number of confirmations of a txid.
//  * args:
//  * @txid (string) the transaction ID as a hex string
//  */
// function getConfirmations(network: CLINetworkAdapter, args: string[]) : Promise<string> {
//   const txid = args[0];
//   return Promise.all([network.getBlockHeight(), network.getTransactionInfo(txid)])
//     .then(([blockHeight, txInfo]) => {
//       return JSONStringify({
//         'blockHeight': txInfo.block_height,
//         'confirmations': blockHeight - txInfo.block_height + 1
//       });
//     })
//     .catch((e) => {
//       if (e.message.toLowerCase() === 'unconfirmed transaction') {
//         return JSONStringify({
//           'blockHeight': 'unconfirmed',
//           'confirmations': 0
//         });
//       }
//       else {
//         throw e;
//       }
//     });
// }

/*
 * Get the address of a private key
 * args:
 * @private_key (string) the hex-encoded private key or key bundle
 */
function getKeyAddress(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const privateKey = decodePrivateKey(args[0]);
  return Promise.resolve().then(() => {
    const addr = getPrivateKeyAddress(_network, privateKey);
    return JSONStringify({
      BTC: addr,
      STACKS: c32check.b58ToC32(addr),
    });
  });
}

/*
 * Get a file from Gaia.
 * args:
 * @username (string) the blockstack ID of the user who owns the data
 * @origin (string) the application origin
 * @path (string) the file to read
 * @appPrivateKey (string) OPTIONAL: the app private key to decrypt/verify with
 * @decrypt (string) OPTINOAL: if '1' or 'true', then decrypt
 * @verify (string) OPTIONAL: if '1' or 'true', then search for and verify a signature file
 *  along with the data
 */
function gaiaGetFile(_network: CLINetworkAdapter, args: string[]): Promise<string | Buffer> {
  const username = args[0];
  const origin = args[1];
  const path = args[2];
  let appPrivateKey = args[3];
  let decrypt = false;
  let verify = false;

  if (!!appPrivateKey && args.length > 4 && !!args[4]) {
    decrypt = args[4].toLowerCase() === 'true' || args[4].toLowerCase() === '1';
  }

  if (!!appPrivateKey && args.length > 5 && !!args[5]) {
    verify = args[5].toLowerCase() === 'true' || args[5].toLowerCase() === '1';
  }

  if (!appPrivateKey) {
    // make a fake private key (it won't be used)
    appPrivateKey = 'fda1afa3ff9ef25579edb5833b825ac29fae82d03db3f607db048aae018fe882';
  }

  // force mainnet addresses
  blockstack.config.network.layer1 = bitcoin.networks.bitcoin;
  return gaiaAuth(_network, appPrivateKey, null)
    .then((_userData: UserData) =>
      blockstack.getFile(path, {
        decrypt: decrypt,
        verify: verify,
        app: origin,
        username: username,
      })
    )
    .then((data: ArrayBuffer | Buffer | string) => {
      if (data instanceof ArrayBuffer) {
        return Buffer.from(data);
      } else {
        return data;
      }
    });
}

/*
 * Put a file into a Gaia hub
 * args:
 * @hubUrl (string) the URL to the write endpoint of the gaia hub
 * @appPrivateKey (string) the private key used to authenticate to the gaia hub
 * @dataPath (string) the path (on disk) to the data to store
 * @gaiaPath (string) the path (in Gaia) where the data will be stored
 * @encrypt (string) OPTIONAL: if '1' or 'true', then encrypt the file
 * @sign (string) OPTIONAL: if '1' or 'true', then sign the file and store the signature too.
 */
function gaiaPutFile(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const hubUrl = args[0];
  const appPrivateKey = args[1];
  const dataPath = args[2];
  const gaiaPath = path.normalize(args[3].replace(/^\/+/, ''));

  let encrypt = false;
  let sign = false;

  if (args.length > 4 && !!args[4]) {
    encrypt = args[4].toLowerCase() === 'true' || args[4].toLowerCase() === '1';
  }
  if (args.length > 5 && !!args[5]) {
    sign = args[5].toLowerCase() === 'true' || args[5].toLowerCase() === '1';
  }

  const data = fs.readFileSync(dataPath);

  // force mainnet addresses
  // TODO
  blockstack.config.network.layer1 = bitcoin.networks.bitcoin;
  return gaiaAuth(_network, appPrivateKey, hubUrl)
    .then((_userData: UserData) => {
      return blockstack.putFile(gaiaPath, data, { encrypt: encrypt, sign: sign });
    })
    .then((url: string) => {
      return JSONStringify({ urls: [url] });
    });
}

/*
 * Delete a file in a Gaia hub
 * args:
 * @hubUrl (string) the URL to the write endpoint of the gaia hub
 * @appPrivateKey (string) the private key used to authenticate to the gaia hub
 * @gaiaPath (string) the path (in Gaia) to delete
 * @wasSigned (string) OPTIONAL: if '1' or 'true'.  Delete the signature file as well.
 */
function gaiaDeleteFile(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const hubUrl = args[0];
  const appPrivateKey = args[1];
  const gaiaPath = path.normalize(args[2].replace(/^\/+/, ''));

  let wasSigned = false;

  if (args.length > 3 && !!args[3]) {
    wasSigned = args[3].toLowerCase() === 'true' || args[3].toLowerCase() === '1';
  }

  // force mainnet addresses
  // TODO
  blockstack.config.network.layer1 = bitcoin.networks.bitcoin;
  return gaiaAuth(_network, appPrivateKey, hubUrl)
    .then((_userData: UserData) => {
      return blockstack.deleteFile(gaiaPath, { wasSigned: wasSigned });
    })
    .then(() => {
      return JSONStringify('ok');
    });
}

/*
 * List files in a Gaia hub
 * args:
 * @hubUrl (string) the URL to the write endpoint of the gaia hub
 * @appPrivateKey (string) the private key used to authenticate to the gaia hub
 */
function gaiaListFiles(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const hubUrl = args[0];
  const appPrivateKey = args[1];

  // force mainnet addresses
  // TODO
  let count = 0;
  blockstack.config.network.layer1 = bitcoin.networks.bitcoin;
  return gaiaAuth(_network, canonicalPrivateKey(appPrivateKey), hubUrl)
    .then((_userData: UserData) => {
      return blockstack.listFiles((name: string) => {
        // print out incrementally
        console.log(name);
        count += 1;
        return true;
      });
    })
    .then(() => JSONStringify(count));
}

/*
 * Group array items into batches
 */
function batchify<T>(input: T[], batchSize: number = 50): T[][] {
  const output = [];
  let currentBatch = [];
  for (let i = 0; i < input.length; i++) {
    currentBatch.push(input[i]);
    if (currentBatch.length >= batchSize) {
      output.push(currentBatch);
      currentBatch = [];
    }
  }
  if (currentBatch.length > 0) {
    output.push(currentBatch);
  }
  return output;
}

/**
 * Sleep for a number of milliseconds.
 */
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/*
 * Dump all files from a Gaia hub bucket to a directory on disk.
 * args:
 * @nameOrIDAddress (string) the name or ID address that owns the bucket to dump
 * @appOrigin (string) the application for which to dump data
 * @hubUrl (string) the URL to the write endpoint of the gaia hub
 * @mnemonic (string) the 12-word phrase or ciphertext
 * @dumpDir (string) the directory to hold the dumped files
 */
function gaiaDumpBucket(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const nameOrIDAddress = args[0];
  const appOrigin = args[1];
  const hubUrl = args[2];
  const mnemonicOrCiphertext = args[3];
  let dumpDir = args[4];

  if (dumpDir.length === 0) {
    throw new Error('Invalid directory (not given)');
  }
  if (dumpDir[0] !== '/') {
    // relative path.  make absolute
    const cwd = fs.realpathSync('.');
    dumpDir = path.normalize(`${cwd}/${dumpDir}`);
  }

  mkdirs(dumpDir);

  function downloadFile(hubConfig: GaiaHubConfig, fileName: string): Promise<void> {
    const gaiaReadUrl = `${hubConfig.url_prefix.replace(/\/+$/, '')}/${hubConfig.address}`;
    const fileUrl = `${gaiaReadUrl}/${fileName}`;
    const destPath = `${dumpDir}/${fileName.replace(/\//g, '\\x2f')}`;

    console.log(`Download ${fileUrl} to ${destPath}`);
    return fetch(fileUrl)
      .then((resp: any) => {
        if (resp.status !== 200) {
          throw new Error(`Bad status code for ${fileUrl}: ${resp.status}`);
        }

        // javascript can be incredibly stupid at fetching data despite being a Web language...
        const contentType = resp.headers.get('Content-Type');
        if (
          contentType === null ||
          contentType.startsWith('text') ||
          contentType === 'application/json'
        ) {
          return resp.text();
        } else {
          return resp.arrayBuffer();
        }
      })
      .then((filebytes: Buffer | ArrayBuffer) => {
        return new Promise((resolve, reject) => {
          try {
            fs.writeFileSync(destPath, Buffer.from(filebytes), { encoding: null, mode: 0o660 });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
  }

  // force mainnet addresses
  // TODO: better way of doing this
  blockstack.config.network.layer1 = bitcoin.networks.bitcoin;

  const fileNames: string[] = [];
  let gaiaHubConfig: GaiaHubConfig;
  let appPrivateKey: string;
  let ownerPrivateKey: string;

  return getIDAppKeys(_network, nameOrIDAddress, appOrigin, mnemonicOrCiphertext)
    .then((keyInfo: IDAppKeys) => {
      appPrivateKey = keyInfo.appPrivateKey;
      ownerPrivateKey = keyInfo.ownerPrivateKey;
      return gaiaAuth(_network, appPrivateKey, hubUrl, ownerPrivateKey);
    })
    .then((_userData: UserData) => {
      return gaiaConnect(_network, hubUrl, appPrivateKey);
    })
    .then((hubConfig: GaiaHubConfig) => {
      gaiaHubConfig = hubConfig;
      return blockstack.listFiles(name => {
        fileNames.push(name);
        return true;
      });
    })
    .then(async (fileCount: number) => {
      // rate limit is 100rpm
      const batchSize = 99;
      const sleepTime = 120;
      console.log(`Download ${fileCount} files...`);
      if (fileCount > batchSize) {
        console.log(
          `This may take a while, downloading around ${batchSize} files per 2 minutes...`
        );
      }
      const fileBatches: string[][] = batchify(fileNames, batchSize);
      for (const [index, batch] of fileBatches.entries()) {
        const filePromises = batch.map(fileName => downloadFile(gaiaHubConfig, fileName));
        await Promise.all(filePromises);
        if (index < fileBatches.length - 1) {
          console.log(
            `${
              (index + 1) * batchSize
            }/${fileCount} downloaded, waiting ${sleepTime} seconds before next batch...`
          );
          await sleep(sleepTime * 1000);
        }
      }

      return JSONStringify(fileCount);
    });
}

/*
 * Restore all of the files in a Gaia bucket dump to a new Gaia hub
 * args:
 * @nameOrIDAddress (string) the name or ID address that owns the bucket to dump
 * @appOrigin (string) the origin of the app for which to restore data
 * @hubUrl (string) the URL to the write endpoint of the new gaia hub
 * @mnemonic (string) the 12-word phrase or ciphertext
 * @dumpDir (string) the directory to hold the dumped files
 */
function gaiaRestoreBucket(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const nameOrIDAddress = args[0];
  const appOrigin = args[1];
  const hubUrl = args[2];
  const mnemonicOrCiphertext = args[3];
  let dumpDir = args[4];

  if (dumpDir.length === 0) {
    throw new Error('Invalid directory (not given)');
  }
  if (dumpDir[0] !== '/') {
    // relative path.  make absolute
    const cwd = fs.realpathSync('.');
    dumpDir = path.normalize(`${cwd}/${dumpDir}`);
  }

  const fileList = fs.readdirSync(dumpDir);
  const fileBatches = batchify(fileList, 10);

  let appPrivateKey: string;
  let ownerPrivateKey: string;

  // force mainnet addresses
  // TODO better way of doing this
  blockstack.config.network.layer1 = bitcoin.networks.bitcoin;

  return getIDAppKeys(_network, nameOrIDAddress, appOrigin, mnemonicOrCiphertext)
    .then((keyInfo: IDAppKeys) => {
      appPrivateKey = keyInfo.appPrivateKey;
      ownerPrivateKey = keyInfo.ownerPrivateKey;
      return gaiaAuth(_network, appPrivateKey, hubUrl, ownerPrivateKey);
    })
    .then(async (_userData: UserData) => {
      const batchSize = 99;
      const sleepTime = 120;

      for (const [index, batch] of fileBatches.entries()) {
        const uploadBatchPromises = batch.map(async (fileName: string) => {
          const filePath = path.join(dumpDir, fileName);
          const dataBuf = fs.readFileSync(filePath);
          const gaiaPath = fileName.replace(/\\x2f/g, '/');
          const url = await blockstack.putFile(gaiaPath, dataBuf, { encrypt: false, sign: false });
          console.log(`Uploaded ${fileName} to ${url}`);
        });
        await Promise.all(uploadBatchPromises);
        if (index < fileBatches.length - 1) {
          console.log(
            `${(index + 1) * batchSize}/${
              fileList.length
            } uploaded, waiting ${sleepTime} seconds before next batch...`
          );
          await sleep(sleepTime * 1000);
        }
      }
      return JSONStringify(fileList.length);
    });
}

/*
 * Set the Gaia hub for an application for a blockstack ID.
 * args:
 * @blockstackID (string) the blockstack ID of the user
 * @profileHubUrl (string) the URL to the write endpoint of the user's profile gaia hub
 * @appOrigin (string) the application's Origin
 * @hubUrl (string) the URL to the write endpoint of the app's gaia hub
 * @mnemonic (string) the 12-word backup phrase, or the ciphertext of it
 */
async function gaiaSetHub(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  _network.setCoerceMainnetAddress(true);

  const blockstackID = args[0];
  const ownerHubUrl = args[1];
  const appOrigin = args[2];
  const hubUrl = args[3];
  const mnemonicPromise = getBackupPhrase(args[4]);

  const nameInfoPromise = getNameInfoEasy(_network, blockstackID).then(
    (nameInfo: NameInfoType | null) => {
      if (!nameInfo) {
        throw new Error('Name not found');
      }
      return nameInfo;
    }
  );

  const profilePromise = blockstack.lookupProfile(blockstackID);

  const [nameInfo, nameProfile, mnemonic]: [NameInfoType, any, string] = await Promise.all([
    nameInfoPromise,
    profilePromise,
    mnemonicPromise,
  ]);

  if (!nameProfile) {
    throw new Error('No profile found');
  }
  if (!nameInfo) {
    throw new Error('Name not found');
  }
  if (!nameInfo.zonefile) {
    throw new Error('No zone file found');
  }

  if (!nameProfile.apps) {
    nameProfile.apps = {};
  }

  // get owner ID-address
  const ownerAddress = _network.coerceMainnetAddress(nameInfo.address);
  const idAddress = `ID-${ownerAddress}`;

  // get owner and app key info
  const appKeyInfo = await getApplicationKeyInfo(_network, mnemonic, idAddress, appOrigin);
  const ownerKeyInfo = await getOwnerKeyInfo(_network, mnemonic, appKeyInfo.ownerKeyIndex);

  // do we already have an address set for this app?
  let existingAppAddress: string | null = null;
  let appPrivateKey: string;
  try {
    existingAppAddress = getGaiaAddressFromProfile(_network, nameProfile, appOrigin);
    appPrivateKey = extractAppKey(_network, appKeyInfo, existingAppAddress);
  } catch (e) {
    console.log(`No profile application entry for ${appOrigin}`);
    appPrivateKey = extractAppKey(_network, appKeyInfo);
  }

  appPrivateKey = `${canonicalPrivateKey(appPrivateKey)}01`;
  const appAddress = _network.coerceMainnetAddress(getPrivateKeyAddress(_network, appPrivateKey));

  if (existingAppAddress && appAddress !== existingAppAddress) {
    throw new Error(`BUG: ${existingAppAddress} !== ${appAddress}`);
  }

  const profile = nameProfile;
  const ownerPrivateKey = ownerKeyInfo.privateKey;

  const ownerGaiaHubPromise = gaiaConnect(_network, ownerHubUrl, ownerPrivateKey);
  const appGaiaHubPromise = gaiaConnect(_network, hubUrl, appPrivateKey);

  const [ownerHubConfig, appHubConfig]: [GaiaHubConfig, GaiaHubConfig] = await Promise.all([
    ownerGaiaHubPromise,
    appGaiaHubPromise,
  ]);

  if (!ownerHubConfig.url_prefix) {
    throw new Error('Invalid owner hub config: no url_prefix defined');
  }

  if (!appHubConfig.url_prefix) {
    throw new Error('Invalid app hub config: no url_prefix defined');
  }

  const gaiaReadUrl = appHubConfig.url_prefix.replace(/\/+$/, '');

  const newAppEntry: Record<string, string> = {};
  newAppEntry[appOrigin] = `${gaiaReadUrl}/${appAddress}/`;

  const apps = Object.assign({}, profile.apps ? profile.apps : {}, newAppEntry);
  profile.apps = apps;

  // sign the new profile
  const signedProfile = makeProfileJWT(profile, ownerPrivateKey);
  const profileUrls: {
    dataUrls?: string[] | null;
    error?: string | null;
  } = await gaiaUploadProfileAll(
    _network,
    [ownerHubUrl],
    signedProfile,
    ownerPrivateKey,
    blockstackID
  );

  if (profileUrls.error) {
    return JSONStringify({
      error: profileUrls.error,
    });
  } else {
    return JSONStringify({
      profileUrls: profileUrls.dataUrls!,
    });
  }
}

/*
 * Convert an address between mainnet and testnet, and between
 * base58check and c32check.
 * args:
 * @address (string) the input address.  can be in any format
 */
function addressConvert(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const addr = args[0];
  let b58addr: string;
  let testnetb58addr: string;

  if (addr.match(STACKS_ADDRESS_PATTERN)) {
    b58addr = c32check.c32ToB58(addr);
  } else if (addr.match(/[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+/)) {
    b58addr = addr;
  } else {
    throw new Error(`Unrecognized address ${addr}`);
  }

  if (isTestnetAddress(b58addr)) {
    testnetb58addr = b58addr;
  } else if (_network.isTestnet()) {
    testnetb58addr = _network.coerceAddress(b58addr);
  }

  return Promise.resolve().then(() => {
    const mainnetb58addr = _network.coerceMainnetAddress(b58addr);
    const result: any = {
      mainnet: {
        STACKS: c32check.b58ToC32(mainnetb58addr),
        BTC: mainnetb58addr,
      },
      testnet: undefined,
    };

    if (testnetb58addr) {
      result.testnet = {
        STACKS: c32check.b58ToC32(testnetb58addr),
        BTC: testnetb58addr,
      };
    }

    return JSONStringify(result);
  });
}

/*
 * Encrypt a backup phrase
 * args:
 * @backup_phrase (string) the 12-word phrase to encrypt
 * @password (string) the password (will be interactively prompted if not given)
 */
// TODO: fix: network is never used
// @ts-ignore
function encryptMnemonic(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const mnemonic = args[0];
  if (mnemonic.split(/ +/g).length !== 12) {
    throw new Error('Invalid backup phrase: must be 12 words');
  }

  const passwordPromise: Promise<string> = new Promise((resolve, reject) => {
    let pass = '';
    if (args.length === 2 && !!args[1]) {
      pass = args[1];
      resolve(pass);
    } else {
      if (!process.stdin.isTTY) {
        // password must be given as an argument
        const errMsg = 'Password argument required on non-interactive mode';
        reject(new Error(errMsg));
      } else {
        // prompt password
        getpass('Enter password: ', (pass1: string) => {
          getpass('Enter password again: ', (pass2: string) => {
            if (pass1 !== pass2) {
              const errMsg = 'Passwords do not match';
              reject(new Error(errMsg));
            } else {
              resolve(pass1);
            }
          });
        });
      }
    }
  });

  return passwordPromise
    .then((pass: string) => encryptBackupPhrase(mnemonic, pass))
    .then((cipherTextBuffer: Buffer) => cipherTextBuffer.toString('base64'))
    .catch((e: Error) => {
      return JSONStringify({ error: e.message });
    });
}

/* Decrypt a backup phrase
 * args:
 * @encrypted_backup_phrase (string) the encrypted base64-encoded backup phrase
 * @password 9string) the password (will be interactively prompted if not given)
 */
// TODO: fix: network is never used
// @ts-ignore
function decryptMnemonic(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const ciphertext = args[0];

  const passwordPromise: Promise<string> = new Promise((resolve, reject) => {
    if (args.length === 2 && !!args[1]) {
      const pass = args[1];
      resolve(pass);
    } else {
      if (!process.stdin.isTTY) {
        // password must be given
        reject(new Error('Password argument required in non-interactive mode'));
      } else {
        // prompt password
        getpass('Enter password: ', p => {
          resolve(p);
        });
      }
    }
  });

  return passwordPromise
    .then((pass: string) => decryptBackupPhrase(Buffer.from(ciphertext, 'base64'), pass))
    .catch((e: Error) => {
      return JSONStringify({
        error:
          'Failed to decrypt (wrong password or corrupt ciphertext), ' + `details: ${e.message}`,
      });
    });
}

async function stackingStatus(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const address = args[0];

  const network = getStacksNetwork(_network);
  const stacker = new StackingClient({ address, network });

  return stacker
    .getStatus()
    .then((status: StackerInfo) => {
      if (status.stacked) {
        return {
          // amount_microstx: status.details.amount_microstx, // todo: add again via other client call?
          first_reward_cycle: status.details.first_reward_cycle,
          lock_period: status.details.lock_period,
          unlock_height: status.details.unlock_height,
          pox_address: {
            version: bytesToHex(status.details.pox_address.version),
            hashbytes: bytesToHex(status.details.pox_address.hashbytes),
          },
        };
      } else {
        return 'Account not actively participating in Stacking';
      }
    })
    .catch((error: any) => {
      return error.toString();
    });
}

async function canStack(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const amount = BigInt(args[0]);
  const cycles = Number(args[1]);
  const poxAddress = args[2];
  const stxAddress = args[3];

  const network = getStacksNetwork(_network);
  const stacker = new StackingClient({ address: stxAddress, network });

  const apiConfig = new Configuration({
    basePath: network.client.baseUrl,
  });
  const accounts = new AccountsApi(apiConfig);

  const balancePromise = accounts.getAccountBalance({
    principal: stxAddress,
  });

  const poxInfoPromise = stacker.getPoxInfo();

  const stackingEligiblePromise = stacker.canStack({ poxAddress, cycles });

  return Promise.all([balancePromise, poxInfoPromise, stackingEligiblePromise])
    .then(([balance, poxInfo, stackingEligible]) => {
      const minAmount = BigInt(poxInfo.min_amount_ustx);
      const balanceBN = BigInt(balance.stx.balance);

      if (minAmount > amount) {
        throw new Error(
          `Stacking amount less than required minimum of ${minAmount.toString()} microstacks`
        );
      }

      if (amount > balanceBN) {
        throw new Error(
          `Stacking amount greater than account balance of ${balanceBN.toString()} microstacks`
        );
      }

      if (!stackingEligible.eligible) {
        throw new Error(`Account cannot participate in stacking. ${stackingEligible.reason}`);
      }

      return stackingEligible;
    })
    .catch(error => {
      return error;
    });
}

async function stack(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const amount = BigInt(args[0]);
  const cycles = Number(args[1]);
  const poxAddress = args[2];
  const privateKey = args[3];

  // let fee = new BN(0);
  // let nonce = new BN(0);

  // if (args.length > 3 && !!args[4]) {
  //   fee = new BN(args[4]);
  // }

  // if (args.length > 4 && !!args[5]) {
  //   nonce = new BN(args[5]);
  // }

  const network = getStacksNetwork(_network);

  const apiConfig = new Configuration({
    basePath: network.client.baseUrl,
  });
  const accounts = new AccountsApi(apiConfig);

  const stxAddress = getAddressFromPrivateKey(privateKey, network);

  const balancePromise = accounts.getAccountBalance({
    principal: stxAddress,
  });

  const stacker = new StackingClient({ address: stxAddress, network });

  const poxInfoPromise = stacker.getPoxInfo();

  const coreInfoPromise = stacker.getCoreInfo();

  const stackingEligiblePromise = stacker.canStack({ poxAddress, cycles });

  return Promise.all([balancePromise, poxInfoPromise, coreInfoPromise, stackingEligiblePromise])
    .then(([balance, poxInfo, coreInfo, stackingEligible]) => {
      const minAmount = BigInt(poxInfo.min_amount_ustx);
      const balanceBN = BigInt(balance.stx.balance);
      const burnChainBlockHeight = coreInfo.burn_block_height;
      const startBurnBlock = burnChainBlockHeight + 3;

      if (minAmount > amount) {
        throw new Error(
          `Stacking amount less than required minimum of ${minAmount.toString()} microstacks`
        );
      }

      if (amount > balanceBN) {
        throw new Error(
          `Stacking amount greater than account balance of ${balanceBN.toString()} microstacks`
        );
      }

      if (!stackingEligible.eligible) {
        throw new Error(`Account cannot participate in stacking. ${stackingEligible.reason}`);
      }

      return stacker.stack({
        amountMicroStx: amount,
        poxAddress,
        cycles,
        privateKey,
        burnBlockHeight: startBurnBlock,
      });
    })
    .then((response: TxBroadcastResult) => {
      if ('error' in response) {
        return response;
      }
      return {
        txid: `0x${response.txid}`,
        transaction: generateExplorerTxPageUrl(response.txid, network),
      };
    })
    .catch(error => {
      return error;
    });
}

async function register(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const fullyQualifiedName = args[0];
  const privateKey = args[1];
  const salt = args[2];
  const zonefile = args[3];
  const publicKey = privateKeyToPublic(privateKey);

  const network = getStacksNetwork(_network);

  const unsignedTransaction = await buildRegisterNameTx({
    fullyQualifiedName,
    publicKey,
    salt,
    zonefile,
    network,
  });

  const signer = new TransactionSigner(unsignedTransaction);
  signer.signOrigin(privateKey);

  return broadcastTransaction({ transaction: signer.transaction, network })
    .then((response: TxBroadcastResult) => {
      if (response.hasOwnProperty('error')) {
        return response;
      }
      return {
        txid: `0x${response.txid}`,
        transaction: generateExplorerTxPageUrl(response.txid, network),
      };
    })
    .catch(error => {
      return error;
    });
}

async function preorder(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const fullyQualifiedName = args[0];
  const privateKey = args[1];
  const salt = args[2];
  const stxToBurn = args[3];
  const publicKey = privateKeyToPublic(privateKey);

  const network = getStacksNetwork(_network);

  const unsignedTransaction = await buildPreorderNameTx({
    fullyQualifiedName,
    publicKey,
    salt,
    stxToBurn,
    network,
  });

  const signer = new TransactionSigner(unsignedTransaction);
  signer.signOrigin(privateKey);

  return broadcastTransaction({ transaction: signer.transaction, network })
    .then((response: TxBroadcastResult) => {
      if (response.hasOwnProperty('error')) {
        return response;
      }
      return {
        txid: `0x${response.txid}`,
        transaction: generateExplorerTxPageUrl(response.txid, network),
      };
    })
    .catch(error => {
      return error;
    });
}

function faucetCall(_network: CLINetworkAdapter, args: string[]): Promise<string> {
  const address = args[0];

  const network = getStacksNetwork(_network);
  const config = new Configuration({ basePath: network.client.baseUrl });
  const faucets = new FaucetsApi(config);

  return faucets
    .runFaucetStx({ address })
    .then((faucetTx: any) => {
      return JSONStringify({
        txid: faucetTx.txId!,
        transaction: generateExplorerTxPageUrl(faucetTx.txId!.replace(/^0x/, ''), STACKS_TESTNET),
      });
    })
    .catch((error: any) => error.toString());
}

/* Print out all documentation on usage in JSON
 */
type DocsArgsType = {
  name: string;
  type: string;
  value: string;
  format: string;
};

type FormattedDocsType = {
  command: string;
  args: DocsArgsType[];
  usage: string;
  group: string;
};

function printDocs(_network: CLINetworkAdapter, _args: string[]): Promise<string> {
  return Promise.resolve().then(() => {
    const formattedDocs: FormattedDocsType[] = [];
    const commandNames: string[] = Object.keys(CLI_ARGS.properties);
    for (let i = 0; i < commandNames.length; i++) {
      const commandName = commandNames[i];
      const args: DocsArgsType[] = [];
      const usage = CLI_ARGS.properties[commandName].help;
      const group = CLI_ARGS.properties[commandName].group;

      for (let j = 0; j < CLI_ARGS.properties[commandName].items.length; j++) {
        const argItem = CLI_ARGS.properties[commandName].items[j];
        args.push({
          name: argItem.name,
          type: argItem.type,
          value: argItem.realtype,
          format: argItem.pattern ? argItem.pattern : '.+',
        } as DocsArgsType);
      }

      formattedDocs.push({
        command: commandName,
        args: args,
        usage: usage,
        group: group,
      } as FormattedDocsType);
    }
    return JSONStringify(formattedDocs);
  });
}

type CommandFunction = (network: CLINetworkAdapter, args: string[]) => Promise<string | Buffer>;

/*
 * Decrypt a backup phrase
 * args:
 * @p
/*
 * Global set of commands
 */
const COMMANDS: Record<string, CommandFunction> = {
  balance: balance,
  can_stack: canStack,
  call_contract_func: contractFunctionCall,
  call_read_only_contract_func: readOnlyContractFunctionCall,
  decode_cv: decodeCV,
  convert_address: addressConvert,
  decrypt_keychain: decryptMnemonic,
  deploy_contract: contractDeploy,
  docs: printDocs,
  encrypt_keychain: encryptMnemonic,
  gaia_deletefile: gaiaDeleteFile,
  gaia_dump_bucket: gaiaDumpBucket,
  gaia_getfile: gaiaGetFile,
  gaia_listfiles: gaiaListFiles,
  gaia_putfile: gaiaPutFile,
  gaia_restore_bucket: gaiaRestoreBucket,
  gaia_sethub: gaiaSetHub,
  get_address: getKeyAddress,
  get_account_history: getAccountHistory,
  get_app_keys: getAppKeys,
  get_owner_keys: getOwnerKeys,
  get_payment_key: getPaymentKey,
  get_stacks_wallet_key: getStacksWalletKey,
  make_keychain: makeKeychain,
  profile_sign: profileSign,
  profile_store: profileStore,
  profile_verify: profileVerify,
  // 'send_btc': sendBTC, // todo: fix
  register: register,
  tx_preorder: preorder,
  send_tokens: sendTokens,
  stack: stack,
  migrate_subdomains: migrateSubdomains,
  stacking_status: stackingStatus,
  faucet: faucetCall,
};

/*
 * CLI main entry point
 */
export function CLIMain() {
  const argv = process.argv;
  const opts = getCLIOpts(argv);

  const cmdArgs: any = checkArgs(
    CLIOptAsStringArray(opts, '_') ? CLIOptAsStringArray(opts, '_')! : []
  );
  if (!cmdArgs.success) {
    if (cmdArgs.error) {
      console.log(cmdArgs.error);
    }
    if (cmdArgs.usage) {
      if (cmdArgs.command) {
        console.log(makeCommandUsageString(cmdArgs.command));
        console.log('Use "help" to list all commands.');
      } else {
        console.log(USAGE);
        console.log(makeAllCommandsList());
      }
    }
    process.exit(1);
  } else {
    txOnly = CLIOptAsBool(opts, 'x');
    estimateOnly = CLIOptAsBool(opts, 'e');
    safetyChecks = !CLIOptAsBool(opts, 'U');
    receiveFeesPeriod = opts['N'] ? parseInt(CLIOptAsString(opts, 'N')!) : receiveFeesPeriod;
    gracePeriod = opts['G'] ? parseInt(CLIOptAsString(opts, 'N')!) : gracePeriod;
    const maxIDSearchIndex = opts['M']
      ? parseInt(CLIOptAsString(opts, 'M')!)
      : getMaxIDSearchIndex();
    setMaxIDSearchIndex(maxIDSearchIndex);
    const debug = CLIOptAsBool(opts, 'd') || Boolean(process.env.DEBUG);
    const consensusHash = CLIOptAsString(opts, 'C');
    const integration_test = CLIOptAsBool(opts, 'i');
    let testnet = CLIOptAsBool(opts, 't');
    const localnet = CLIOptAsBool(opts, 'l');

    const magicBytes = CLIOptAsString(opts, 'm');
    const apiUrl = CLIOptAsString(opts, 'H');
    const transactionBroadcasterUrl = CLIOptAsString(opts, 'T');
    const nodeAPIUrl = CLIOptAsString(opts, 'I');
    const utxoUrl = CLIOptAsString(opts, 'X');
    const bitcoindUsername = CLIOptAsString(opts, 'u');
    const bitcoindPassword = CLIOptAsString(opts, 'p');

    if (integration_test) {
      BLOCKSTACK_TEST = integration_test;
    }

    // Command specific checks and overrides
    if (cmdArgs.command === 'help') {
      console.log(makeCommandUsageString(cmdArgs.args[0]));
      process.exit(0);
    }

    if (cmdArgs.command === 'faucet') {
      if (!testnet && !localnet && !nodeAPIUrl && !apiUrl) {
        // If not otherwise configured the `faucet` command will default to testnet for backwards compatibility
        testnet = true;
      }
      if (localnet || nodeAPIUrl || apiUrl) {
        console.info('The "faucet" feature may be unavailable for custom API setups.');
      }
    }

    const configPath = CLIOptAsString(opts, 'c')
      ? CLIOptAsString(opts, 'c')
      : testnet
        ? DEFAULT_CONFIG_TESTNET_PATH
        : DEFAULT_CONFIG_PATH;

    const namespaceBurnAddr = CLIOptAsString(opts, 'B');
    const feeRate = CLIOptAsString(opts, 'F') ? parseInt(CLIOptAsString(opts, 'F')!) : 0;
    const priceToPay = CLIOptAsString(opts, 'P') ? CLIOptAsString(opts, 'P') : '0';
    const priceUnits = CLIOptAsString(opts, 'D');

    const networkType = testnet ? 'testnet' : localnet ? 'localnet' : 'mainnet';

    const configData = loadConfig(configPath!, networkType);

    if (debug) {
      configData.logConfig.level = 'debug';
    } else {
      configData.logConfig.level = 'info';
    }
    if (bitcoindUsername) {
      configData.bitcoindUsername = bitcoindUsername;
    }
    if (bitcoindPassword) {
      configData.bitcoindPassword = bitcoindPassword;
    }

    if (utxoUrl) {
      configData.utxoServiceUrl = utxoUrl;
    }

    winston.configure({
      level: configData.logConfig.level,
      transports: [new winston.transports.Console(configData.logConfig)],
    });

    const cliOpts: CLI_NETWORK_OPTS = {
      consensusHash: consensusHash ? consensusHash : null,
      feeRate: feeRate ? feeRate : null,
      namespaceBurnAddress: namespaceBurnAddr ? namespaceBurnAddr : null,
      priceToPay: priceToPay ? priceToPay : null,
      priceUnits: priceUnits ? priceUnits : null,
      receiveFeesPeriod: receiveFeesPeriod ? receiveFeesPeriod : null,
      gracePeriod: gracePeriod ? gracePeriod : null,
      altAPIUrl: apiUrl ? apiUrl : configData.blockstackAPIUrl,
      altTransactionBroadcasterUrl: transactionBroadcasterUrl
        ? transactionBroadcasterUrl
        : configData.broadcastServiceUrl,
      nodeAPIUrl: nodeAPIUrl ? nodeAPIUrl : apiUrl ? apiUrl : configData.blockstackNodeUrl,
    };

    // wrap command-line options
    const wrappedNetwork = getNetwork(
      configData,
      !!BLOCKSTACK_TEST || !!integration_test || !!testnet || !!localnet
    );
    const blockstackNetwork = new CLINetworkAdapter(wrappedNetwork, cliOpts);
    if (magicBytes) {
      // blockstackNetwork.MAGIC_BYTES = magicBytes;
    }

    // blockstack.config.network = blockstackNetwork;
    blockstack.config.logLevel = 'error';

    const method = COMMANDS[cmdArgs.command];
    let exitcode = 0;

    method(blockstackNetwork, cmdArgs.args)
      .then((result: string | Buffer) => {
        try {
          // if this is a JSON object with 'status', set the exit code
          if (result instanceof Buffer) {
            return result;
          } else {
            const resJson: any = JSON.parse(result);
            if (resJson.hasOwnProperty('status') && !resJson.status) {
              exitcode = 1;
            }
            return result;
          }
        } catch (e) {
          return result;
        }
      })
      .then((result: string | Buffer) => {
        if (result instanceof Buffer) {
          process.stdout.write(result);
        } else {
          console.log(result);
        }
      })
      .then(() => {
        if (!noExit) {
          process.exit(exitcode);
        }
      })
      .catch((e: Error) => {
        console.error(e.stack);
        console.error(e.message);
        if (!noExit) {
          process.exit(1);
        }
      });
  }
}

/* test only exports */
export const testables =
  process.env.NODE_ENV === 'test'
    ? {
        addressConvert,
        decodeCV,
        canStack,
        contractFunctionCall,
        getStacksWalletKey,
        makeKeychain,
        migrateSubdomains,
        preorder,
        register,
        parseDirectFunctionArgs,
      }
    : undefined;
