// TODO: most of this code should be in blockstack.js
// Will remove most of this code once the wallet functionality is there instead.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const c32check = require('c32check');

import { HDKey } from '@scure/bip32';
import * as scureBip39 from '@scure/bip39';

import { getPublicKeyFromPrivate, publicKeyToBtcAddress } from '@stacks/encryption';
import { DerivationType, deriveAccount, generateWallet, getRootNode } from '@stacks/wallet-sdk';
import * as bip32 from 'bip32';
import * as bip39 from 'bip39';
import * as blockstack from 'blockstack';
import * as wif from 'wif';

import { getMaxIDSearchIndex, getPrivateKeyAddress } from './common';
import { CLINetworkAdapter } from './network';
import { compressPrivateKey } from '@stacks/transactions';

const BITCOIN_PUBKEYHASH = 0;
const BITCOIN_PUBKEYHASH_TESTNET = 111;
const BITCOIN_WIF = 128;
const BITCOIN_WIF_TESTNET = 239;

export const STX_WALLET_COMPATIBLE_SEED_STRENGTH = 256;
export const DERIVATION_PATH = "m/44'/5757'/0'/0/0";

export type OwnerKeyInfoType = {
  privateKey: string;
  version: string;
  index: number;
  idAddress: string;
};

export type PaymentKeyInfoType = {
  privateKey: string;
  address: {
    BTC: string;
    STACKS: string;
  };
  index: number;
};

export type StacksKeyInfoType = {
  privateKey: string;
  address: string;
  btcAddress: string;
  wif: string;
  index: number;
};

export type AppKeyInfoType = {
  keyInfo: {
    privateKey: string;
    address: string;
  };
  legacyKeyInfo: {
    privateKey: string;
    address: string;
  };
  ownerKeyIndex: number;
};

async function walletFromMnemonic(mnemonic: string): Promise<blockstack.BlockstackWallet> {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  return new blockstack.BlockstackWallet(bip32.fromSeed(seed));
}

/*
 * Get the owner key information for a 12-word phrase, at a specific index.
 * @network (object) the blockstack network
 * @mnemonic (string) the 12-word phrase
 * @index (number) the account index
 * @version (string) the derivation version string
 *
 * Returns an object with:
 *    .privateKey (string) the hex private key
 *    .version (string) the version string of the derivation
 *    .idAddress (string) the ID-address
 */
export async function getOwnerKeyInfo(
  network: CLINetworkAdapter,
  mnemonic: string,
  index: number,
  version: string = 'v0.10-current'
): Promise<OwnerKeyInfoType> {
  const wallet = await generateWallet({ secretKey: mnemonic, password: '' });
  const account = deriveAccount({
    rootNode: getRootNode(wallet),
    salt: wallet.salt,
    stxDerivationType: DerivationType.Wallet,
    index,
  });
  const publicKey = getPublicKeyFromPrivate(account.dataPrivateKey);
  const addr = network.coerceAddress(publicKeyToBtcAddress(publicKey));
  return {
    privateKey: account.dataPrivateKey + '01',
    idAddress: `ID-${addr}`,
    version,
    index,
  } as OwnerKeyInfoType;
}

/*
 * Get the payment key information for a 12-word phrase.
 * @network (object) the blockstack network
 * @mnemonic (string) the 12-word phrase
 *
 * Returns an object with:
 *    .privateKey (string) the hex private key
 *    .address (string) the address of the private key
 */
export async function getPaymentKeyInfo(
  network: CLINetworkAdapter,
  mnemonic: string
): Promise<PaymentKeyInfoType> {
  const wallet = await walletFromMnemonic(mnemonic);
  const privkey = wallet.getBitcoinPrivateKey(0);
  const addr = getPrivateKeyAddress(network, privkey);
  const result: PaymentKeyInfoType = {
    privateKey: privkey,
    address: {
      BTC: addr,
      STACKS: c32check.b58ToC32(addr),
    },
    index: 0,
  };
  return result;
}

/*
 * Get the payment key information for a 24-word phrase used by the Stacks wallet.
 * @network (object) the blockstack network
 * @mnemonic (string) the 24-word phrase
 *
 * Returns an object with:
 *    .privateKey (string) the hex private key
 *    .address (string) the address of the private key
 */
export async function getStacksWalletKeyInfo(
  network: CLINetworkAdapter,
  mnemonic: string,
  derivationPath = DERIVATION_PATH
): Promise<StacksKeyInfoType> {
  const seed = await scureBip39.mnemonicToSeed(mnemonic);
  const master = HDKey.fromMasterSeed(seed);
  const child = master.derive(derivationPath);
  const pubkey = Buffer.from(child.publicKey!);
  const privkeyBuffer = Buffer.from(child.privateKey!);
  const privkey = compressPrivateKey(privkeyBuffer);
  const wifVersion = network.isTestnet() ? BITCOIN_WIF_TESTNET : BITCOIN_WIF;
  const walletImportFormat = wif.encode(wifVersion, privkeyBuffer, true);

  const addr = getPrivateKeyAddress(network, privkey);
  const btcAddress = publicKeyToBtcAddress(
    pubkey,
    network.isTestnet() ? BITCOIN_PUBKEYHASH_TESTNET : BITCOIN_PUBKEYHASH
  );

  return {
    privateKey: privkey,
    publicKey: pubkey.toString('hex'),
    address: c32check.b58ToC32(addr),
    btcAddress,
    wif: walletImportFormat,
    index: 0,
  } as StacksKeyInfoType;
}

/*
 * Find the index of an ID address, given the mnemonic.
 * Returns the index if found
 * Returns -1 if not found
 */
export async function findIdentityIndex(
  network: CLINetworkAdapter,
  mnemonic: string,
  idAddress: string,
  maxIndex?: number
): Promise<number> {
  if (!maxIndex) {
    maxIndex = getMaxIDSearchIndex();
  }

  if (idAddress.substring(0, 3) !== 'ID-') {
    throw new Error('Not an identity address');
  }

  const wallet = await generateWallet({ secretKey: mnemonic, password: '' });
  const needle = network.coerceAddress(idAddress.slice(3));

  for (let i = 0; i < maxIndex; i++) {
    const account = deriveAccount({
      rootNode: getRootNode(wallet),
      salt: wallet.salt,
      stxDerivationType: DerivationType.Wallet,
      index: i,
    });
    const publicKey = getPublicKeyFromPrivate(account.dataPrivateKey);
    const address = network.coerceAddress(publicKeyToBtcAddress(publicKey));

    if (address === needle) return i;
  }

  return -1;
}

/*
 * Get the Gaia application key from a 12-word phrase
 * @network (object) the blockstack network
 * @mmemonic (string) the 12-word phrase
 * @idAddress (string) the ID-address used to sign in
 * @appDomain (string) the application's Origin
 *
 * Returns an object with
 *    .keyInfo (object) the app key info with the current derivation path
 *      .privateKey (string) the app's hex private key
 *      .address (string) the address of the private key
 *    .legacyKeyInfo (object) the app key info with the legacy derivation path
 *      .privateKey (string) the app's hex private key
 *      .address (string) the address of the private key
 */
export async function getApplicationKeyInfo(
  network: CLINetworkAdapter,
  mnemonic: string,
  idAddress: string,
  appDomain: string,
  idIndex?: number
): Promise<AppKeyInfoType> {
  if (!idIndex) {
    idIndex = -1;
  }

  if (idIndex < 0) {
    idIndex = await findIdentityIndex(network, mnemonic, idAddress);
    if (idIndex < 0) {
      throw new Error('Identity address does not belong to this keychain');
    }
  }

  const wallet = await walletFromMnemonic(mnemonic);
  const identityOwnerAddressNode = wallet.getIdentityAddressNode(idIndex);
  const appsNode = blockstack.BlockstackWallet.getAppsNode(identityOwnerAddressNode);

  //const appPrivateKey = blockstack.BlockstackWallet.getAppPrivateKey(
  //  appsNode.toBase58(), wallet.getIdentitySalt(), appDomain);
  const legacyAppPrivateKey = blockstack.BlockstackWallet.getLegacyAppPrivateKey(
    appsNode.toBase58(),
    wallet.getIdentitySalt(),
    appDomain
  );

  // TODO: figure out when we can start using the new derivation path
  const res: AppKeyInfoType = {
    keyInfo: {
      privateKey: 'TODO', // appPrivateKey,
      address: 'TODO', // getPrivateKeyAddress(network, `${appPrivateKey}01`)
    },
    legacyKeyInfo: {
      privateKey: legacyAppPrivateKey,
      address: getPrivateKeyAddress(network, `${legacyAppPrivateKey}01`),
    },
    ownerKeyIndex: idIndex,
  };
  return res;
}

/*
 * Extract the "right" app key
 */
export function extractAppKey(
  network: CLINetworkAdapter,
  appKeyInfo: {
    keyInfo: { privateKey: string; address: string };
    legacyKeyInfo: { privateKey: string; address: string };
  },
  appAddress?: string
): string {
  if (appAddress) {
    if (
      network.coerceMainnetAddress(appKeyInfo.keyInfo.address) ===
      network.coerceMainnetAddress(appAddress)
    ) {
      return appKeyInfo.keyInfo.privateKey;
    }
    if (
      network.coerceMainnetAddress(appKeyInfo.legacyKeyInfo.address) ===
      network.coerceMainnetAddress(appAddress)
    ) {
      return appKeyInfo.legacyKeyInfo.privateKey;
    }
  }

  const appPrivateKey =
    appKeyInfo.keyInfo.privateKey === 'TODO' || !appKeyInfo.keyInfo.privateKey
      ? appKeyInfo.legacyKeyInfo.privateKey
      : appKeyInfo.keyInfo.privateKey;
  return appPrivateKey;
}
