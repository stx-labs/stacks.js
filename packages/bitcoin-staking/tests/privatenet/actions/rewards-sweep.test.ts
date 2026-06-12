/**
 * Read-only sweep: claimable rewards across EVERY bond on the private testnet.
 *
 * For each existing protocol-bond, reads `get-earned(signer, isBond=true, index)`
 * (the bond leg). Also reads the STX-only leg `get-earned(signer, isBond=false,
 * cycle)` for the recent reward cycles. Builds a table.
 *
 * NOTE: rewards accrue per SIGNER (the signer-manager principal). The only real
 * deployed signer-manager on this net is the daemon's; our bonds have no
 * enrollments, so their bond legs are 0 by construction. Override the signer with
 * SIGNER_MANAGER env to check a different one.
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so RECORD=1 \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *     npx jest tests/privatenet/actions/rewards-sweep.test.ts --runInBand --collectCoverage=false
 */
import {
  fetchPoxInfo,
  fetchProtocolBond,
  fetchEarned,
} from '../../../src';
import { getNetwork } from '../../helpers/utils';

jest.setTimeout(30 * 60_000);

const network = getNetwork();
const SIGNER_MANAGER =
  process.env.SIGNER_MANAGER ?? 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';
const MAX_BOND_INDEX = Number(process.env.MAX_BOND_INDEX ?? 50);
const CYCLE_LOOKBACK = Number(process.env.CYCLE_LOOKBACK ?? 12);

test('rewards sweep: get-earned across all bonds + recent STX-only cycles', async () => {
  const pox = await fetchPoxInfo({ network });
  console.log('=== rewards sweep ===');
  console.log('signer-manager:', SIGNER_MANAGER);
  console.log('current cycle:', pox.rewardCycleId, 'burn:', pox.currentBurnchainBlockHeight);

  // --- bond legs ---
  console.log('\n--- BOND LEGS  get-earned(isBond=true, bondIndex) ---');
  console.log('bondIndex | exists | earned (uSTX/sats)');
  const bondRows: { index: number; earned: bigint }[] = [];
  for (let i = 0; i < MAX_BOND_INDEX; i++) {
    let exists = false;
    try {
      exists = (await fetchProtocolBond({ bondIndex: i, network })) !== undefined;
    } catch {
      // skip read errors
    }
    if (!exists) continue;
    let earned = -1n;
    try {
      earned = await fetchEarned({ signerManager: SIGNER_MANAGER, rewardCycle: pox.rewardCycleId, bondIndex: i, network });
    } catch (err) {
      console.log(`  bond ${i}: earned read FAILED — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    bondRows.push({ index: i, earned });
    console.log(`  bond ${String(i).padStart(2)} |   yes  | ${earned.toString()}`);
  }
  console.log(`(found ${bondRows.length} bonds; ${bondRows.filter(r => r.earned > 0n).length} with non-zero bond-leg rewards)`);

  // --- STX-only legs (by cycle) ---
  console.log('\n--- STX-ONLY LEGS  get-earned(isBond=false, cycle) ---');
  console.log('cycle | earned (uSTX)');
  const start = Math.max(0, pox.rewardCycleId - CYCLE_LOOKBACK);
  const cycleRows: { cycle: number; earned: bigint }[] = [];
  for (let c = start; c <= pox.rewardCycleId; c++) {
    let earned = -1n;
    try {
      earned = await fetchEarned({ signerManager: SIGNER_MANAGER, rewardCycle: c, network });
    } catch (err) {
      console.log(`  cycle ${c}: read FAILED — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    cycleRows.push({ cycle: c, earned });
    console.log(`  ${String(c).padStart(3)} | ${earned.toString()}`);
  }
  console.log(`(${cycleRows.filter(r => r.earned > 0n).length} cycles with non-zero STX-only rewards)`);

  // --- summary ---
  const totalBond = bondRows.reduce((a, r) => a + (r.earned > 0n ? r.earned : 0n), 0n);
  const totalCycle = cycleRows.reduce((a, r) => a + (r.earned > 0n ? r.earned : 0n), 0n);
  console.log('\n=== SUMMARY ===');
  console.log('bonds found:', bondRows.length, '| indices:', bondRows.map(r => r.index).join(','));
  console.log('total claimable bond-leg rewards (this signer):', totalBond.toString());
  console.log('total claimable STX-only rewards (this signer):', totalCycle.toString());

  expect(bondRows.length).toBeGreaterThan(0);
});
