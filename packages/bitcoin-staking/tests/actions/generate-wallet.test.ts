/**
 * ACTION: generate a seed phrase + its first account.
 *
 * Pure/offline — no network. Prints one fresh 24-word seed phrase with its first
 * account as a single-line `##RESULT##` JSON marker (mnemonic / stxKey / stxAddr /
 * btcAddr) for composition. Need N? run it N times in a bash loop.
 *
 *   npx jest tests/actions/generate-wallet --collectCoverage=false
 */
import { generateAccount } from '../helpers/wallet';

describe('action: generate-wallet', () => {
  it('generates a seed phrase + first account', async () => {
    const { mnemonic, account } = await generateAccount();
    const wallet = { mnemonic, stxKey: account.key, stxAddr: account.address, btcAddr: account.btcAddress };
    console.log(`##RESULT## ${JSON.stringify(wallet)}`);
    expect(wallet.stxAddr).toMatch(/^ST/);
    expect(wallet.mnemonic.split(' ')).toHaveLength(24);
  });
});
