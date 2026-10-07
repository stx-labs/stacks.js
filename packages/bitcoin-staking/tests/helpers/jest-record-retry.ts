/**
 * RECORD-only auto-retry harness — makes a live recording run largely hands-off,
 * for a single test (`npx jest <path>`) or the whole suite (`npx jest tests/regtest`)
 * alike, using only jest's own retry + hooks.
 *
 * A flaky record attempt (u47 prepare-phase abort, nonce contention, event-relay
 * lag) is retried; the keyed fixture files that attempt wrote are discarded first
 * so the rerun records CLEAN instead of merging onto a bad partial. Applies to
 * both the regtest and privatenet recordings.
 *
 * Inert under replay (`RECORD` unset): no retries are installed, so a replay
 * failure stays a hard failure — it means a real regression, not a flake.
 *
 * Tune with `RECORD_RETRIES` (default 3). Soft only: it does NOT wipe/restart the
 * chain — a wedged chain or a bond-index collision needs a fresh env, handled
 * outside this layer.
 */
import { rmSync } from 'node:fs';
import { ENV, clearFixtureCache, observeFixtureWrites } from './utils';

if (ENV.RECORD) {
  jest.retryTimes(Number(process.env.RECORD_RETRIES ?? 3), { logErrorsBeforeRetry: true });

  // Keyed fixture files the current attempt has written (fed by utils via the
  // write observer). The default store (undefined key) never fires this, so it's
  // never discarded — it's shared boot state.
  const written = new Set<string>();
  observeFixtureWrites(path => written.add(path));

  const attempts = new Map<string, number>();
  beforeEach(() => {
    const name = expect.getState().currentTestName ?? '';
    const n = attempts.get(name) ?? 0;
    attempts.set(name, n + 1);
    if (n > 0) {
      // A retry: drop what the failed attempt wrote so this one re-records fresh.
      for (const path of written) rmSync(path, { force: true });
      clearFixtureCache();
    }
    written.clear();
  });
}
