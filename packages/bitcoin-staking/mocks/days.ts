/**
 * Day-axis selection for `@stacks/bitcoin-staking/mocks`.
 *
 * The mock scenario in effect is chosen by the `?d=<day>` URL search param.
 * Function args are ignored — only the day matters. When running outside a
 * browser (Node, SSR) we fall back to `DEFAULT_DAY`.
 */

/** Canonical day labels — superset across all functions. */
export const DAYS = [
  'd-30',
  'd-7',
  'd-1',
  'd0',
  'd1',
  'd14',
  'd90',
  'd171',
  'd172',
  'd177',
  'd182',
  'd183',
  'default',
] as const;

export type Day = (typeof DAYS)[number];

/** SSR/Node fallback. Mid-bond steady-state. */
export const DEFAULT_DAY: Day = 'd90';

/**
 * Returns the active day for a given function.
 *
 * - Browser: read `?d=<day>` from `window.location.search`.
 * - SSR / Node: always returns `DEFAULT_DAY` (or `'default'` if that day
 *   isn't covered).
 * - If the chosen day is not in `availableDays`, falls back to
 *   `DEFAULT_DAY`, then to `'default'`.
 */
export function currentMockDay(_fn: string, availableDays: string[]): string {
  const pick = (d: string) =>
    availableDays.includes(d) ? d : availableDays.includes(DEFAULT_DAY) ? DEFAULT_DAY : 'default';

  const w: unknown = typeof globalThis !== 'undefined' ? (globalThis as { window?: unknown }).window : undefined;
  if (
    !w ||
    typeof (w as { location?: { search?: string } }).location !== 'object' ||
    !(w as { location?: { search?: string } }).location ||
    typeof (w as { location: { search?: string } }).location.search !== 'string'
  ) {
    return pick(DEFAULT_DAY);
  }
  const search = (w as { location: { search: string } }).location.search;
  const d = new URLSearchParams(search).get('d');
  if (d && availableDays.includes(d)) return d;
  return pick(DEFAULT_DAY);
}
