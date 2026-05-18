import { createFetchFn, FetchFn } from '@stacks/common';
import * as bitcoin from 'bitcoinjs-lib';
import blockstack from 'blockstack';
import { BlockstackNetwork } from 'blockstack/lib/network';
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
  legacyNetwork: BlockstackNetwork;

  constructor(network: BlockstackNetwork, opts: CLI_NETWORK_OPTS) {
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

    this.legacyNetwork = new BlockstackNetwork(
      opts.nodeAPIUrl!,
      opts.altTransactionBroadcasterUrl!,
      network.btc,
      network.layer1
    );
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
    return this.legacyNetwork.layer1.pubKeyHash === bitcoin.networks.bitcoin.pubKeyHash;
  }

  isTestnet(): boolean {
    return this.legacyNetwork.layer1.pubKeyHash === bitcoin.networks.testnet.pubKeyHash;
  }

  setCoerceMainnetAddress(value: boolean) {
    this.optAlwaysCoerceAddress = value;
  }

  coerceMainnetAddress(address: string): string {
    const addressInfo = bitcoin.address.fromBase58Check(address);
    const addressHash = addressInfo.hash;
    const addressVersion = addressInfo.version;
    let newVersion = 0;

    if (addressVersion === this.legacyNetwork.layer1.pubKeyHash) {
      newVersion = 0;
    } else if (addressVersion === this.legacyNetwork.layer1.scriptHash) {
      newVersion = 5;
    }
    return bitcoin.address.toBase58Check(addressHash, newVersion);
  }

  getFeeRate(): Promise<number> {
    if (this.feeRate) {
      // override with CLI option
      return Promise.resolve(this.feeRate);
    }
    return this.legacyNetwork.getFeeRate();
  }

  getConsensusHash(): Promise<string> {
    // override with CLI option
    if (this.consensusHash) {
      return new Promise((resolve: any) => resolve(this.consensusHash));
    }
    return this.legacyNetwork.getConsensusHash().then((c: string) => c);
  }

  getGracePeriod(): Promise<number> {
    if (this.gracePeriod) {
      return new Promise((resolve: any) => resolve(this.gracePeriod));
    }
    return this.legacyNetwork.getGracePeriod().then((g: number) => g);
  }

  getNamePrice(name: string): Promise<PriceType> {
    // override with CLI option
    if (this.priceUnits && this.priceToPay) {
      return new Promise((resolve: any) =>
        resolve({
          units: String(this.priceUnits),
          amount: BigInt(this.priceToPay || 0),
        } as PriceType)
      );
    }
    // @ts-ignore
    return this.legacyNetwork.getNamePrice(name).then((priceInfo: PriceType) => {
      // use v2 scheme
      if (!priceInfo.units) {
        priceInfo = {
          units: 'BTC',
          amount: BigInt(priceInfo.amount),
        };
      }
      return priceInfo;
    });
  }

  getNamespacePrice(namespaceID: string): Promise<PriceType> {
    // override with CLI option
    if (this.priceUnits && this.priceToPay) {
      return new Promise((resolve: any) =>
        resolve({
          units: String(this.priceUnits),
          amount: BigInt(this.priceToPay || 0),
        } as PriceType)
      );
    }
    // @ts-ignore
    return super.getNamespacePrice(namespaceID).then((priceInfo: PriceType) => {
      // use v2 scheme
      if (!priceInfo.units) {
        priceInfo = {
          units: 'BTC',
          amount: BigInt(priceInfo.amount),
        } as PriceType;
      }
      return priceInfo;
    });
  }

  getNamespaceBurnAddress(
    namespace: string,
    useCLI: boolean = true,
    receiveFeesPeriod: number = -1,
    fetchFn: FetchFn = createFetchFn()
  ): Promise<string> {
    // override with CLI option
    if (this.namespaceBurnAddress && useCLI) {
      return new Promise((resolve: any) => resolve(this.namespaceBurnAddress));
    }

    return Promise.all([
      fetchFn(`${this.legacyNetwork.blockstackAPIUrl}/v1/namespaces/${namespace}`),
      this.legacyNetwork.getBlockHeight(),
    ])
      .then(([resp, blockHeight]: [any, number]) => {
        if (resp.status === 404) {
          throw new Error(`No such namespace '${namespace}'`);
        } else if (resp.status !== 200) {
          throw new Error(`Bad response status: ${resp.status}`);
        } else {
          return resp.json().then((namespaceJson: unknown) => [namespaceJson, blockHeight]);
        }
      })
      .then(([namespaceInfo, blockHeight]: [any, number]) => {
        let address = '1111111111111111111114oLvT2'; // default burn address
        if (namespaceInfo.version === 2) {
          // pay-to-namespace-creator if this namespace is less than $receiveFeesPeriod blocks old
          if (receiveFeesPeriod < 0) {
            receiveFeesPeriod = this.receiveFeesPeriod!;
          }

          if (namespaceInfo.reveal_block + receiveFeesPeriod > blockHeight) {
            address = namespaceInfo.address;
          }
        }
        return address;
      })
      .then((address: string) => this.legacyNetwork.coerceAddress(address));
  }

  getNameInfo(name: string): Promise<NameInfoType> {
    // optionally coerce addresses
    return this.legacyNetwork.getNameInfo(name).then((ni: any) => {
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

  getBlockchainNameRecord(name: string, fetchFn: FetchFn = createFetchFn()): Promise<any> {
    // TODO: send to blockstack.js
    const url = `${this.legacyNetwork.blockstackAPIUrl}/v1/blockchains/bitcoin/names/${name}`;
    return fetchFn(url)
      .then(resp => {
        if (resp.status !== 200) {
          throw new Error(`Bad response status: ${resp.status}`);
        } else {
          return resp.json();
        }
      })
      .then(nameInfo => {
        // coerce all addresses
        const fixedAddresses: Record<string, any> = {};
        for (const addrAttr of ['address', 'importer_address', 'recipient_address']) {
          if (nameInfo.hasOwnProperty(addrAttr) && nameInfo[addrAttr]) {
            fixedAddresses[addrAttr] = this.legacyNetwork.coerceAddress(nameInfo[addrAttr]);
          }
        }
        return Object.assign(nameInfo, fixedAddresses);
      });
  }

  getNameHistory(
    name: string,
    page: number,
    fetchFn: FetchFn = createFetchFn()
  ): Promise<Record<string, any[]>> {
    // TODO: send to blockstack.js
    const url = `${this.legacyNetwork.blockstackAPIUrl}/v1/names/${name}/history?page=${page}`;
    return fetchFn(url)
      .then(resp => {
        if (resp.status !== 200) {
          throw new Error(`Bad response status: ${resp.status}`);
        }
        return resp.json();
      })
      .then(historyInfo => {
        // coerce all addresses
        const fixedHistory: Record<string, any[]> = {};
        for (const historyBlock of Object.keys(historyInfo)) {
          const fixedHistoryList: any[] = [];
          for (const historyEntry of historyInfo[historyBlock]) {
            const fixedAddresses: Record<string, string> = {};
            let fixedHistoryEntry: any = {};
            for (const addrAttr of ['address', 'importer_address', 'recipient_address']) {
              if (historyEntry.hasOwnProperty(addrAttr) && historyEntry[addrAttr]) {
                fixedAddresses[addrAttr] = this.legacyNetwork.coerceAddress(historyEntry[addrAttr]);
              }
            }
            fixedHistoryEntry = Object.assign(historyEntry, fixedAddresses);
            fixedHistoryList.push(fixedHistoryEntry);
          }
          fixedHistory[historyBlock] = fixedHistoryList;
        }
        return fixedHistory;
      });
  }

  coerceAddress(address: string) {
    return this.legacyNetwork.coerceAddress(address);
  }

  getAccountHistoryPage(address: string, page: number) {
    return this.legacyNetwork.getAccountHistoryPage(address, page);
  }

  broadcastTransaction(tx: string) {
    return this.legacyNetwork.broadcastTransaction(tx);
  }

  broadcastZoneFile(zonefile: string, txid: string) {
    return this.legacyNetwork.broadcastZoneFile(zonefile, txid);
  }

  getNamesOwned(address: string) {
    return this.legacyNetwork.getNamesOwned(address);
  }
}

/*
 * Instantiate a network using settings from the config file.
 */
export function getNetwork(configData: CLI_CONFIG_TYPE, testNet: boolean): BlockstackNetwork {
  if (testNet) {
    const network = new blockstack.network.LocalRegtest(
      configData.blockstackAPIUrl,
      configData.broadcastServiceUrl,
      new blockstack.network.BitcoindAPI(configData.utxoServiceUrl, {
        username: configData.bitcoindUsername || 'blockstack',
        password: configData.bitcoindPassword || 'blockstacksystem',
      })
    );

    return network;
  } else {
    const network = new BlockstackNetwork(
      configData.blockstackAPIUrl,
      configData.broadcastServiceUrl,
      new blockstack.network.BlockchainInfoApi(configData.utxoServiceUrl)
    );

    return network;
  }
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
