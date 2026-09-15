import type { EligibilityResult } from '../../src';
import { Pox5ErrorCode } from '../../src';

/**
 * Assert an eligibility preflight is ineligible for `code`. Fails loudly (not
 * silently skipped) if the result was unexpectedly `ok`.
 */
export function expectIneligible(result: EligibilityResult, code: Pox5ErrorCode): void {
  expect(result.ok).toBe(false);
  if (result.ok) return; // narrowing only — the toBe above already failed the test
  expect(result.reasons).toContain(code);
}
