/**
 * Phase 999.13 Wave 0 stub — Plan 02 implements.
 *
 * TZ-01..05 helper for rendering UTC instants into operator-local
 * `YYYY-MM-DD HH:mm:ss ZZZ` timestamps at the agent-visible serialization
 * boundary. Internal storage / DB / structured event keys stay UTC; only
 * agent-visible *rendering* uses this helper.
 *
 * RESEARCH.md Pattern 3 — pure helper, no global state, accepts both
 * `Date` and ISO `string` inputs, falls back to UTC when passed a bad
 * IANA TZ string instead of throwing (Pitfall 6).
 *
 * This stub exists ONLY so `src/shared/__tests__/agent-visible-time.test.ts`
 * can import it cleanly during Wave 0 RED. Plan 02 (Wave 2) replaces the
 * throw-stubs with the real `Intl.DateTimeFormat`-based implementation.
 */
export function renderAgentVisibleTimestamp(
  _date: Date | string,
  _tz?: string,
): string {
  throw new Error("not implemented");
}

export function resolveAgentTimezone(_configTz: string | undefined): string {
  throw new Error("not implemented");
}
