import { createFetchFn } from '@stacks/common';
import * as bitcoin from 'bitcoinjs-lib';
import { CLI_CONFIG_TYPE } from './argparse';
import { STACKS_MAINNET, STACKS_TESTNET, StacksNetwork } from '@stacks/network';

export interface CLI_NETWORK_OPTS {
  consensusHash: string | null;
  feeRate: number | null;
  namespaceBurnAddress: string | null;
  priceToPay: string | null;
  priceUnits: string | null;
  receiveFeesPeriod: number | null;
  gracePeriod: number | null;
  altAPIUrl: string | null;
  altTransactionBroadcasterUrl: string | null;
  nodeAPIUrl: string | null;
}

export interface PriceType {
  units: 'BTC' | 'STACKS';
  amount: bigint;
}

export type AccountHistoryEntry = {
  address: string;
  credit_value: bigint;
  debit_value: bigint;
};

export type NameInfoType = {
  address: string;
  blockchain?: string;
  did?: string;
  expire_block?: number;
  grace_period?: number;
  last_txid?: string;
  renewal_deadline?: number;
  resolver?: string | null;
  status?: string;
  zonefile?: string | null;
  zonefile_hash?: string | null;
};

/*
 * Adapter class that allows us to use data obtained
 * from the CLI.
 */
export class CLINetworkAdapter {
  consensusHash: string | null;
  feeRate: number | null;
  namespaceBurnAddress: string | null;
  priceToPay: string | null;
  priceUnits: string | null;
  gracePeriod: number | null;
  receiveFeesPeriod: number | null;
  nodeAPIUrl: string;
  optAlwaysCoerceAddress: boolean;
  layer1: bitcoin.Network;

  constructor(network: ReturnType<typeof getNetwork>, opts: CLI_NETWORK_OPTS) {
    const optsDefault: CLI_NETWORK_OPTS = {
      consensusHash: null,
      feeRate: null,
      namespaceBurnAddress: null,
      priceToPay: null,
      priceUnits: null,
      receiveFeesPeriod: null,
      gracePeriod: null,
      altAPIUrl: opts.nodeAPIUrl,
      altTransactionBroadcasterUrl: network.broadcastServiceUrl,
      nodeAPIUrl: opts.nodeAPIUrl,
    };

    opts = Object.assign({}, optsDefault, opts);

    this.layer1 = network.layer1;
    this.consensusHash = opts.consensusHash;
    this.feeRate = opts.feeRate;
    this.namespaceBurnAddress = opts.namespaceBurnAddress;
    this.priceToPay = opts.priceToPay;
    this.priceUnits = opts.priceUnits;
    this.receiveFeesPeriod = opts.receiveFeesPeriod;
    this.gracePeriod = opts.gracePeriod;
    this.nodeAPIUrl = opts.nodeAPIUrl!;

    this.optAlwaysCoerceAddress = false;
  }

  isMainnet(): boolean {
    return this.layer1.pubKeyHash === bitcoin.networks.bitcoin.pubKeyHash;
  }

  isTestnet(): boolean {
    return this.layer1.pubKeyHash === bitcoin.networks.testnet.pubKeyHash;
  }

  setCoerceMainnetAddress(value: boolean) {
    this.optAlwaysCoerceAddress = value;
  }

  coerceMainnetAddress(address: string): string {
    const addressInfo = bitcoin.address.fromBase58Check(address);
    const addressHash = addressInfo.hash;
    const addressVersion = addressInfo.version;
    let newVersion = 0;

    if (addressVersion === this.layer1.pubKeyHash) {
      newVersion = 0;
    } else if (addressVersion === this.layer1.scriptHash) {
      newVersion = 5;
    }
    return bitcoin.address.toBase58Check(addressHash, newVersion);
  }

  getNameInfo(name: string): Promise<NameInfoType> {
    // optionally coerce addresses
    return this.fetchLegacy<NameInfoType>(`/v1/names/${name}`, 'Name not found').then(ni => {
      if (ni.address) ni.address = this.coerceAddress(ni.address);
      const nameInfo: NameInfoType = {
        address: this.optAlwaysCoerceAddress ? this.coerceMainnetAddress(ni.address) : ni.address,
        blockchain: ni.blockchain,
        did: ni.did,
        expire_block: ni.expire_block,
        grace_period: ni.grace_period,
        last_txid: ni.last_txid,
        renewal_deadline: ni.renewal_deadline,
        resolver: ni.resolver,
        status: ni.status,
        zonefile: ni.zonefile,
        zonefile_hash: ni.zonefile_hash,
      };
      return nameInfo;
    });
  }

  coerceAddress(address: string): string {
    const { hash, version } = bitcoin.address.fromBase58Check(address);
    let coercedVersion: number;
    if (
      [bitcoin.networks.bitcoin.scriptHash, bitcoin.networks.testnet.scriptHash].includes(version)
    ) {
      coercedVersion = this.layer1.scriptHash;
    } else if (
      [bitcoin.networks.bitcoin.pubKeyHash, bitcoin.networks.testnet.pubKeyHash].includes(version)
    ) {
      coercedVersion = this.layer1.pubKeyHash;
    } else {
      throw new Error(`Unrecognized address version number ${version} in ${address}`);
    }
    return bitcoin.address.toBase58Check(hash, coercedVersion);
  }

  private async fetchLegacy<T>(path: string, notFound: string): Promise<T> {
    const response = await createFetchFn()(`${this.nodeAPIUrl}${path}`);
    if (response.status === 404) throw new Error(notFound);
    if (response.status !== 200) throw new Error(`Bad response status: ${response.status}`);
    return response.json();
  }

  async getAccountHistoryPage(address: string, page: number): Promise<AccountHistoryEntry[]> {
    const history = await this.fetchLegacy<AccountHistoryEntry[] | { error: string }>(
      `/v1/accounts/${address}/history?page=${page}`,
      'Account not found'
    );
    if ('error' in history) throw new Error(`Unable to get account history page: ${history.error}`);
    return history.map(entry => ({
      ...entry,
      address: this.coerceAddress(entry.address),
      debit_value: BigInt(entry.debit_value),
      credit_value: BigInt(entry.credit_value),
    }));
  }
}

/*
 * Instantiate a network using settings from the config file.
 */
export function getNetwork(configData: CLI_CONFIG_TYPE, testNet: boolean) {
  return {
    layer1: testNet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin,
    broadcastServiceUrl: configData.broadcastServiceUrl,
  };
}

/** @internal helper to convert a CLINetworkAdapter to a StacksNetwork */
export function getStacksNetwork(network: CLINetworkAdapter): StacksNetwork {
  const basic = network.isMainnet() ? STACKS_MAINNET : STACKS_TESTNET;
  return {
    ...basic,
    client: {
      baseUrl: network.nodeAPIUrl,
    },
  };
}
