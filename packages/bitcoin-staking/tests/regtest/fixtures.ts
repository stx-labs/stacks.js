/**
 * Typed accessor for the recorded regtest responses in `fixtures.json` — the
 * canonical store, keyed by request `path + search` → raw response body.
 *
 * The store is maintained programmatically by the recorder in
 * `tests/helpers/utils.ts` under `RECORD=1` (deduped, latest wins). Tests import
 * the entries they need by key and feed them to `setApiMocks` for offline
 * replay. Bodies are full JSON and can be very long — import only the keys a
 * test needs; don't read/rewrite the whole store. Re-record, never hand-edit.
 */
import data from './fixtures.json';

export const FIXTURES: Record<string, string> = data;
