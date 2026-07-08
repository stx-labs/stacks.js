// Pure helpers — no network, runs everywhere. Round-trips and known vectors;
// the regtest reads-sweep cross-checks the on-chain mirrors of the math.
import { Cl } from '@stacks/transactions';
import { BtcAddress, PoXAddressVersion, fetchEligibleCalculateRewards } from '../src';
import {
  bondPeriodToBurnHeight,
  bondPeriodToRewardCycle,
  bondPhaseRanges,
  bondStatus,
  burnHeightToDistributionIndex,
  burnHeightToRewardCycle,
  currentDistributionCycle,
  distributionCycleToBurnHeight,
  firstPox5RewardCycle,
  isBondActiveAtHeight,
  isInPreparePhase,
  minUstxForSatsAmount,
  rewardCycleToBurnHeight,
} from '../src/cycles';
import { networkNameFrom } from '../src/network';
import { STACKS_MAINNET, STACKS_TESTNET } from '@stacks/network';
import type { PoxInfo } from '../src';

// Regtest-shaped pox snapshot: cycle length 20, prepare 5, pox-5 from cycle 8.
const poxInfo = {
  firstBurnchainBlockHeight: 0,
  rewardCycleLength: 20,
  prepareCycleLength: 5,
  currentBurnchainBlockHeight: 305,
  rewardCycleId: 15,
  contractId: 'ST000000000000000000002AMW42H.pox-5',
  contractVersions: [
    { contractId: 'ST000000000000000000002AMW42H.pox-5', firstRewardCycleId: 8 },
  ],
} as unknown as PoxInfo;

describe('cycle math', () => {
  test('burn height ↔ reward cycle round-trip', () => {
    expect(burnHeightToRewardCycle({ burnHeight: 305, poxInfo })).toBe(15);
    expect(rewardCycleToBurnHeight({ cycle: 15, poxInfo })).toBe(300);
    expect(burnHeightToRewardCycle({ burnHeight: rewardCycleToBurnHeight({ cycle: 42, poxInfo }), poxInfo })).toBe(42);
  });

  test('prepare phase boundaries', () => {
    expect(isInPreparePhase({ burnHeight: 314, poxInfo })).toBe(false);
    expect(isInPreparePhase({ burnHeight: 316, poxInfo })).toBe(true);
    expect(isInPreparePhase({ burnHeight: 319, poxInfo })).toBe(true);
    expect(isInPreparePhase({ burnHeight: 320, poxInfo })).toBe(false);
  });

  test('distribution cycles tick twice per reward cycle', () => {
    const distributionCycle = burnHeightToDistributionIndex({ burnHeight: 305, poxInfo });
    expect(currentDistributionCycle(poxInfo)).toBe(distributionCycle);
    expect(distributionCycleToBurnHeight({ distributionCycle, poxInfo })).toBeLessThanOrEqual(305);
    expect(distributionCycleToBurnHeight({ distributionCycle: distributionCycle + 1, poxInfo })).toBeGreaterThan(305);
  });

  test('bond period ↔ cycle/burn mapping', () => {
    const bondIndex = 4;
    const cycle = bondPeriodToRewardCycle({ bondIndex, poxInfo });
    expect(bondPeriodToBurnHeight({ bondIndex, poxInfo })).toBe(
      rewardCycleToBurnHeight({ cycle, poxInfo })
    );
  });

  test('firstPox5RewardCycle from epochs', () => {
    expect(firstPox5RewardCycle(poxInfo)).toBe(8);
  });

  test('minUstxForSatsAmount applies ratio and bps floor', () => {
    expect(
      minUstxForSatsAmount({ sats: 10_000n, stxValueRatio: 1_000n, minUstxRatioBps: 500n })
    ).toBe(5_000n);
  });

  test('bondPhaseRanges are contiguous and ordered', () => {
    const ranges = bondPhaseRanges({ bondIndex: 4, poxInfo });
    expect(ranges.map(r => r.name)).toEqual(['open', 'locked', 'unlocked', 'finished']);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]!.startBurnHeight).toBe(ranges[i - 1]!.endBurnHeight);
    }
  });

  test('bondStatus walks eligible → open → locked → unlocked → finished', () => {
    const at = (burnHeight: number, isBondSetup: boolean) =>
      bondStatus({
        bondIndex: 10,
        isBondSetup,
        poxInfo: { ...poxInfo, currentBurnchainBlockHeight: burnHeight } as PoxInfo,
      });
    const start = bondPeriodToBurnHeight({ bondIndex: 10, poxInfo });
    expect(at(start - 200, false)).toBe('too-early');
    expect(at(start - 10, false)).toBe('eligible');
    expect(at(start + 1, false)).toBe('missed');
    expect(at(start - 10, true)).toBe('open');
    expect(at(start + 1, true)).toBe('locked');
    expect(at(start + 12 * 20 - 5, true)).toBe('unlocked');
    expect(at(start + 12 * 20 + 1, true)).toBe('finished');
  });

  test('isBondActiveAtHeight matches the locked range', () => {
    const start = bondPeriodToBurnHeight({ bondIndex: 10, poxInfo });
    expect(isBondActiveAtHeight({ bondIndex: 10, burnHeight: start + 1, poxInfo })).toBe(true);
    expect(isBondActiveAtHeight({ bondIndex: 10, burnHeight: start - 1, poxInfo })).toBe(false);
  });
});

describe('fetchEligibleCalculateRewards guards', () => {
  test('throws a descriptive error during distribution cycle 0 (no fetches issued)', async () => {
    // Burn height inside the first distribution cycle (length = 20 / 2 = 10).
    const early = { ...(poxInfo as object), currentBurnchainBlockHeight: 5 } as PoxInfo;
    await expect(
      fetchEligibleCalculateRewards({ bondIndices: [0], poxInfo: early, network: 'devnet' })
    ).rejects.toThrow(/distribution cycle 0/);
  });
});

// TODO(coverage): add testnet/devnet segwit round-trips (tb1q/tb1p/bcrt1q) and
// per-branch reject vectors (bad checksum, witness version >1, mixed-case).
describe('BtcAddress parse/stringify', () => {
  // One known vector per script family, both directions.
  const vectors: { address: string; network: 'mainnet' | 'testnet'; version: PoXAddressVersion }[] = [
    { address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', network: 'mainnet', version: PoXAddressVersion.P2PKH },
    { address: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', network: 'mainnet', version: PoXAddressVersion.P2SH },
    { address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', network: 'mainnet', version: PoXAddressVersion.P2WPKH },
    { address: 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3', network: 'mainnet', version: PoXAddressVersion.P2WSH },
    { address: 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0', network: 'mainnet', version: PoXAddressVersion.P2TR },
    { address: 'mzxXgV6e4BZSsz8zVHm3TmqbECt7mbuErt', network: 'testnet', version: PoXAddressVersion.P2PKH },
  ];

  test.each(vectors)('round-trips $address', ({ address, network, version }) => {
    const parsed = BtcAddress.parse(address);
    expect(parsed.version).toBe(version);
    expect(BtcAddress.stringify(parsed, network)).toBe(address);
  });

  test('rejects garbage', () => {
    expect(() => BtcAddress.parse('not-an-address')).toThrow();
  });

  test('parse with network asserts the address belongs to it', () => {
    const mainnetSegwit = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
    const mainnetB58 = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
    const testnetB58 = 'mzxXgV6e4BZSsz8zVHm3TmqbECt7mbuErt';
    // matching network parses
    expect(() => BtcAddress.parse(mainnetSegwit, 'mainnet')).not.toThrow();
    expect(() => BtcAddress.parse(mainnetB58, 'mainnet')).not.toThrow();
    expect(() => BtcAddress.parse(testnetB58, 'testnet')).not.toThrow();
    // wrong network throws
    expect(() => BtcAddress.parse(mainnetSegwit, 'testnet')).toThrow(/testnet/);
    expect(() => BtcAddress.parse(mainnetB58, 'testnet')).toThrow(/testnet/);
    expect(() => BtcAddress.parse(testnetB58, 'mainnet')).toThrow(/mainnet/);
    // devnet/regtest expects the bcrt prefix, not tb
    expect(() => BtcAddress.parse(mainnetSegwit, 'devnet')).toThrow(/devnet/);
    // omitted network keeps the permissive behavior
    expect(() => BtcAddress.parse(mainnetSegwit)).not.toThrow();
  });

  // P2SH-wrapped segwit versions are indistinguishable from plain P2SH on-chain,
  // so they only exist on the stringify side.
  test('stringify covers every PoX version variant', () => {
    const h20 = new Uint8Array(20).fill(7);
    const h32 = new Uint8Array(32).fill(7);
    for (const network of ['mainnet', 'testnet'] as const) {
      for (const version of [
        PoXAddressVersion.P2PKH,
        PoXAddressVersion.P2SH,
        PoXAddressVersion.P2SHP2WPKH,
        PoXAddressVersion.P2SHP2WSH,
        PoXAddressVersion.P2WPKH,
      ]) {
        expect(BtcAddress.stringify({ version, data: h20 }, network)).toBeTruthy();
      }
      for (const version of [PoXAddressVersion.P2WSH, PoXAddressVersion.P2TR]) {
        expect(BtcAddress.stringify({ version, data: h32 }, network)).toBeTruthy();
      }
    }
  });

  test('stringify rejects wrong data lengths per version (no silent truncation)', () => {
    const h20 = new Uint8Array(20).fill(7);
    const h32 = new Uint8Array(32).fill(7);
    // 32-byte data on a 20-byte version: base58 would have silently truncated,
    // segwit v0 would have emitted a P2WSH-shaped program.
    for (const version of [
      PoXAddressVersion.P2PKH,
      PoXAddressVersion.P2SH,
      PoXAddressVersion.P2SHP2WPKH,
      PoXAddressVersion.P2SHP2WSH,
      PoXAddressVersion.P2WPKH,
    ]) {
      expect(() => BtcAddress.stringify({ version, data: h32 }, 'mainnet')).toThrow('20 bytes');
    }
    for (const version of [PoXAddressVersion.P2WSH, PoXAddressVersion.P2TR]) {
      expect(() => BtcAddress.stringify({ version, data: h20 }, 'mainnet')).toThrow('32 bytes');
    }
    expect(() =>
      BtcAddress.stringify({ version: PoXAddressVersion.P2WPKH, data: new Uint8Array(0) }, 'mainnet')
    ).toThrow('20 bytes');
  });

  test('stringify rejects unknown version bytes', () => {
    expect(() =>
      BtcAddress.stringify(
        { version: 0x07 as PoXAddressVersion, data: new Uint8Array(20) },
        'mainnet'
      )
    ).toThrow('Unexpected PoX address version');
  });

  test('stringify validates pox tuples (hashbytes length must match version)', () => {
    const tuple = (version: number, len: number) =>
      Cl.tuple({ version: Cl.buffer(Uint8Array.of(version)), hashbytes: Cl.buffer(new Uint8Array(len).fill(7)) });
    expect(BtcAddress.stringify(tuple(PoXAddressVersion.P2WSH, 32), 'mainnet')).toMatch(/^bc1q/);
    expect(() => BtcAddress.stringify(tuple(PoXAddressVersion.P2WSH, 20), 'mainnet')).toThrow('32 bytes');
    expect(() => BtcAddress.stringify(tuple(PoXAddressVersion.P2PKH, 32), 'mainnet')).toThrow('20 bytes');
    // empty version buffer -> version undefined -> unknown
    const emptyVersion = Cl.tuple({ version: Cl.buffer(new Uint8Array(0)), hashbytes: Cl.buffer(new Uint8Array(20)) });
    expect(() => BtcAddress.stringify(emptyVersion, 'mainnet')).toThrow('Unexpected PoX address version');
  });
});

describe('networkNameFrom', () => {
  test('resolves names and network objects', () => {
    expect(networkNameFrom('testnet')).toBe('testnet');
    expect(networkNameFrom(STACKS_MAINNET)).toBe('mainnet');
    expect(networkNameFrom(STACKS_TESTNET)).toBe('testnet');
  });
});
