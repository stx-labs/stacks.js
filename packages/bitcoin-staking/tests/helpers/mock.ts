/**
 * Record/replay for the regtest e2e actions — one paradigm, both directions.
 *
 * `useFixtures(key?)` routes a test to a fixtures file (`fixtures.json` by
 * default, `fixtures-<key>.json` for a key, co-located):
 *  - RECORD (`RECORD=1`): points the recorder at that file, so this phase's
 *    captures land there (see `setFixtureFile` in utils).
 *  - replay: installs ONE jest-fetch-mock handler that serves the default file +
 *    the keyed file, matched by the SAME `fixtureKey` the recorder used — so
 *    Stacks REST, bitcoind JSON-RPC and mempool all resolve through it.
 *
 * Test PHASES that need the same path to return different bodies over time use
 * different keys (call `useFixtures('…-after')` at the transition). The `waitFor*`
 * loops short-circuit under replay (see `isMocking` in wait.ts), so the recorded
 * snapshots don't need to satisfy a polling condition.
 *
 * `setApiMocks` / `BASE_POX5` remain for the simpler path-keyed actions
 * (`reads`, `setup-bond`) that predate this.
 */
import { setApiMocks } from '@stacks/internal';
import fetchMock from 'jest-fetch-mock';
import { fixtureKey, isMocking, loadFixtures, setFixtureFile, type Fixture } from './utils';
import { FIXTURES } from '../regtest/fixtures';

export { setApiMocks };

/** Minimal pox-5-active `/v2/pox` snapshot (only the fields the raw reads use). */
const POX5_FALLBACK = `{"contract_id":"ST000000000000000000002AMW42H.pox-5","current_burnchain_block_height":200,"reward_cycle_id":10,"current_cycle":{"id":10,"is_pox_active":true}}`;
const INFO_FALLBACK = `{"burn_block_height":200}`;

/** Base replay map for the legacy `setApiMocks` actions. */
export const BASE_POX5: Record<string, string> = {
  '/v2/pox': FIXTURES['/v2/pox'] ?? POX5_FALLBACK,
  '/v2/info': FIXTURES['/v2/info'] ?? INFO_FALLBACK,
};

/**
 * Replay map, built ADDITIVELY across `useFixtures` calls so a phase switch
 * layers its changed endpoints on top of the previous phase (your "…going into
 * that" model). Seeded once with fallbacks + the default file.
 */
/**
 * Replay is a dumb switch: each useFixtures(key) installs a FRESH flat map —
 * fallbacks < default file < key file — with no carry-over between calls.
 * A phase's fixture file is self-contained (the recorder captures every request
 * made while that key is active).
 */
export function useFixtures(key?: string): void {
  if (!isMocking) {
    setFixtureFile(key); // RECORD: subsequent captures go to this file
    return;
  }
  const map: Record<string, Fixture> = {
    '/v2/pox': { status: 200, body: POX5_FALLBACK },
    '/v2/info': { status: 200, body: INFO_FALLBACK },
    ...loadFixtures(),
    ...(key ? loadFixtures(key) : {}),
  };
  fetchMock.mockResponse(async req => {
    const body = req.method === 'POST' ? await req.clone().text() : undefined;
    const k = fixtureKey(req.url, body !== undefined ? { body } : undefined);
    const hit = map[k];
    if (hit === undefined) {
      throw new Error(`useFixtures: no fixture for "${k}"${key ? ` (file key: ${key})` : ''}`);
    }
    return { body: hit.body, init: { status: hit.status } };
  });
}
