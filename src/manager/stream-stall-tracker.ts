/**
 * Phase 127 — No-useful-tokens stream-stall supervisor.
 *
 * Closes the 2026-05-14 fin-acquisition 16-min stall pattern where the
 * SDK iteration loop received keepalive bytes / empty deltas but never
 * produced a usable token, yet the dead-stream timeout never fired
 * because the underlying connection had "traffic." The tracker watches
 * the stream of useful tokens (text_delta.text OR
 * input_json_delta.partial_json — anti-pattern definition D-02 in
 * 127-CONTEXT.md) and aborts the in-flight turn when the gap exceeds
 * the configured threshold.
 *
 * Single-chokepoint design (per feedback_silent_path_bifurcation.md):
 * BOTH the production `persistent-session-handle.ts` iteration loop AND
 * the test-only `wrapSdkQuery` path in `session-adapter.ts` construct
 * exactly one tracker per turn and call `markUsefulToken()` from the
 * SAME predicate that already detects text/json deltas. Tests directly
 * exercise this module to assert the trip behavior without needing a
 * full SDK iterator harness.
 *
 * Invariants enforced by tests in
 * `src/manager/__tests__/session-adapter-stream-stall.test.ts`:
 *   - The interval ticks at Math.min(threshold/4, 30_000)ms — frequent
 *     enough to catch a fresh stall within a quarter-threshold window
 *     and bounded so very-long thresholds don't starve the event loop.
 *   - `markUsefulToken()` resets `lastUsefulTokenAt` to the current
 *     `getNow()` so subsequent ticks restart the countdown.
 *   - First trip wins: once the interval callback decides Date.now() -
 *     lastUsefulTokenAt > threshold, it clears the interval, invokes
 *     `onStall(payload)` exactly once, and the tracker becomes inert.
 *     `stop()` is idempotent and safe to call after a trip.
 *   - `stop()` clears the interval if it hasn't already fired — critical
 *     for T-127-04 mitigation (no leaked timers on success/abort paths).
 *
 * The tracker is intentionally injection-friendly: `getNow` defaults to
 * `Date.now` but tests pass a deterministic clock when using
 * `vi.useFakeTimers()`. `intervalSetter` / `intervalClearer` are not
 * configurable — we always use the real timer functions so
 * `vi.useFakeTimers()` controls them at the global level (this matches
 * the existing memory-flush / heartbeat test posture in the codebase).
 */

/**
 * Structured payload handed to the `onStall` callback. Mirrors the
 * `phase127-stream-stall` log key shape locked in 127-CONTEXT.md D-06
 * so the caller can both `console.info(payload)` AND forward it
 * elsewhere (Discord notification, session-log row) without
 * re-serialising. Optional fields are omitted (spread-conditional) by
 * the caller — the tracker itself doesn't know agent/turn metadata.
 */
export type StreamStallPayload = {
  /** Wall-clock ms elapsed since the last useful token. > thresholdMs by definition. */
  readonly lastUsefulTokenAgeMs: number;
  /** The threshold that triggered this stall (carried so the log line is self-describing). */
  readonly thresholdMs: number;
};

/**
 * Construction options for the tracker. `thresholdMs` is the only
 * required field — everything else is optional and exists for the
 * test path (deterministic clock, custom interval) or future
 * production extension.
 */
export type StreamStallTrackerOptions = {
  /**
   * Stall threshold in milliseconds. Must be > 0. When `Date.now() -
   * lastUsefulTokenAt > thresholdMs`, the tracker trips.
   */
  readonly thresholdMs: number;
  /**
   * Called exactly once when the tracker trips. The caller is expected
   * to invoke `AbortController.abort()` on the SDK query (or do
   * whatever termination semantics they own) AFTER the callback
   * returns. The tracker does NOT own the abort controller — keeps
   * this module agnostic of SDK plumbing.
   */
  readonly onStall: (payload: StreamStallPayload) => void;
  /**
   * Clock override for tests. Defaults to `Date.now`. Production code
   * must NOT pass this — `vi.useFakeTimers()` is the test-side knob.
   */
  readonly getNow?: () => number;
  /**
   * Optional override for the interval cadence. Defaults to
   * `Math.min(thresholdMs / 4, 30_000)` — production paths should
   * omit this. Test paths pass a smaller value to drive the tick loop
   * faster without scaling threshold up.
   */
  readonly checkIntervalMs?: number;
};

/**
 * The handle returned by `createStreamStallTracker`. The caller
 * `markUsefulToken()` on every text_delta / partial_json event and
 * `stop()` on iteration exit (both success and catch paths — T-127-04).
 */
export type StreamStallTracker = {
  /**
   * Reset the "last useful token" timestamp to the current `getNow()`.
   * No-op after `stop()` or after the tracker has tripped.
   */
  markUsefulToken: () => void;
  /**
   * Clear the interval and make the tracker inert. Idempotent — safe to
   * call after a trip or after a previous stop. MUST be called in the
   * iteration loop's success path AND in its catch-block cleanup
   * (T-127-04 mitigation: no leaked timers).
   */
  stop: () => void;
  /**
   * Read-only view of the current age (Date.now() - lastUsefulTokenAt)
   * in ms. Useful for tests and diagnostics; not used by production
   * call sites.
   */
  getLastUsefulTokenAgeMs: () => number;
};

/**
 * Construct a new tracker. The interval starts immediately — the
 * caller does NOT need a separate `start()` call. The first
 * `markUsefulToken()` is implicit (we initialize
 * `lastUsefulTokenAt = getNow()` at construction).
 */
export function createStreamStallTracker(
  opts: StreamStallTrackerOptions,
): StreamStallTracker {
  if (!Number.isFinite(opts.thresholdMs) || opts.thresholdMs <= 0) {
    throw new Error(
      `createStreamStallTracker: thresholdMs must be > 0 (got ${opts.thresholdMs})`,
    );
  }

  const getNow = opts.getNow ?? Date.now;
  const checkIntervalMs =
    opts.checkIntervalMs ?? Math.min(Math.floor(opts.thresholdMs / 4), 30_000);
  // Sanity floor: if threshold < 4, integer floor yields 0 which would
  // make setInterval spin. Clamp to 1ms minimum so tests with
  // microscopic thresholds still behave.
  const safeInterval = Math.max(1, checkIntervalMs);

  let lastUsefulTokenAt = getNow();
  let stopped = false;
  let tripped = false;

  const intervalHandle = setInterval(() => {
    if (stopped || tripped) return;
    const now = getNow();
    const age = now - lastUsefulTokenAt;
    if (age > opts.thresholdMs) {
      tripped = true;
      // Clear BEFORE the callback so a callback that throws can't leak
      // the interval. The boolean guard above also prevents a re-entry
      // if the callback synchronously triggers another tick somehow.
      clearInterval(intervalHandle);
      try {
        opts.onStall({
          lastUsefulTokenAgeMs: age,
          thresholdMs: opts.thresholdMs,
        });
      } catch {
        // The tracker MUST NEVER let a misbehaving callback prevent
        // cleanup. The caller will observe the trip via their own
        // AbortController + error handler.
      }
    }
  }, safeInterval);

  return {
    markUsefulToken: () => {
      if (stopped || tripped) return;
      lastUsefulTokenAt = getNow();
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(intervalHandle);
    },
    getLastUsefulTokenAgeMs: () => getNow() - lastUsefulTokenAt,
  };
}
