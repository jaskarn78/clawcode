/**
 * Guards consolidation summarize output against API error strings.
 *
 * When dispatchTurn hits credit/rate/auth errors it returns the error
 * text as the completion string rather than throwing. Without this guard
 * the consolidation worker writes those strings verbatim as digest content.
 *
 * Intentionally separate from restart-greeting's API_ERROR_FINGERPRINTS,
 * which checks session turn domination (% of turns). This module checks
 * whether a single LLM output string IS itself an error response.
 */

const SUMMARY_ERROR_PATTERNS: readonly RegExp[] = [
  /\bCredit balance is too low\b/i,
  /\bAPI Error:\s*\d{3}\b/i,
  /\bFailed to authenticate\b/i,
  /\bpermission_error\b/i,
  /\brate_limit_error\b/i,
  /\bauthentication_error\b/i,
  /\bauthentication error\b/i,
  /\bnot a member of the organization\b/i,
  /\b(401|403|429|500|502|503|529)\s+error\b/i,
];

/**
 * Returns true if the LLM summary output appears to be an API error string
 * rather than a valid summary. Used to prevent error text from being
 * persisted as digest content.
 */
export function isErrorSummary(text: string): boolean {
  return SUMMARY_ERROR_PATTERNS.some((p) => p.test(text));
}
