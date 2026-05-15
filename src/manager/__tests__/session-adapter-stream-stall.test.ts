import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Phase 127 — synthetic stream-stall tests.
 *
 * Anchors on the `createStreamStallTracker` chokepoint module
 * (`src/manager/stream-stall-tracker.ts`) so both the production
 * `persistent-session-handle.ts` iteration loop AND the test-only
 * `wrapSdkQuery` path can be exercised through a single, deterministic
 * harness. The tests use `vi.useFakeTimers()` to drive the
 * setInterval-based stall checker without real wall-clock waits.
 *
 * Three cases (STALL-01..03) cover the matrix from 127-01-PLAN T-04:
 *   - STALL-01: keepalive-only stream (no useful tokens) → trip at
 *     threshold + 200ms.
 *   - STALL-02: `content_block_delta.text_delta.text` resets the
 *     tracker → no trip across threshold * 3 of simulated activity.
 *   - STALL-03: `content_block_delta.input_json_delta.partial_json`
 *     resets the tracker (D-02 anti-pattern definition) → no trip.
 *
 * Threshold pinned to 1000ms throughout for fast iteration; the
 * tracker's internal `checkIntervalMs` is overridden to 100ms via the
 * test option so the production cadence
 * (Math.min(threshold/4, 30_000)) doesn't dominate the test runtime.
 */

import {
  createStreamStallTracker,
  type StreamStallPayload,
} from "../stream-stall-tracker.js";

// ---------------------------------------------------------------------------
// Synthetic stream-event types — mirror the narrow shape consumed at
// `persistent-session-handle.ts:858+` and `session-adapter.ts:1912+`.
// We don't import the full SDK union — these synthetic events flow
// only through our test harness which decides whether to call
// `markUsefulToken()` per the production predicate.
// ---------------------------------------------------------------------------

type StreamEventDelta =
  | { readonly type: "text_delta"; readonly text: string }
  | { readonly type: "input_json_delta"; readonly partial_json: string };

type SyntheticStreamEvent =
  | { readonly type: "content_block_start" }
  | { readonly type: "ping" }
  | {
      readonly type: "content_block_delta";
      readonly delta: StreamEventDelta;
    };

/**
 * Apply the production predicate (D-02 anti-pattern definition):
 * a useful token is any `content_block_delta` with non-empty
 * `text_delta.text` OR non-empty `input_json_delta.partial_json`.
 * Mirrors the predicate used at the chokepoints in
 * `persistent-session-handle.ts` (production) and
 * `session-adapter.ts` (test parity).
 */
function isUsefulToken(event: SyntheticStreamEvent): boolean {
  if (event.type !== "content_block_delta") return false;
  const delta = event.delta;
  if (delta.type === "text_delta") {
    return typeof delta.text === "string" && delta.text.length > 0;
  }
  if (delta.type === "input_json_delta") {
    return (
      typeof delta.partial_json === "string" && delta.partial_json.length > 0
    );
  }
  return false;
}

/**
 * Drive the tracker through a synthetic stream. Each event is dispatched
 * at `event.dispatchAtMs` simulated time. After each dispatch, we
 * advance the fake clock to the next dispatch time, letting the
 * tracker's setInterval fire and decide whether the stall threshold
 * has elapsed.
 *
 * Returns the trip payload (if any) captured by the `onStall` spy. We
 * also collect every text_delta / partial_json the predicate would
 * forward to `onAssistantText` in production — used to assert the
 * STALL-02 / STALL-03 "tracker resets but stream continues" path.
 */
async function drive(opts: {
  thresholdMs: number;
  checkIntervalMs: number;
  events: ReadonlyArray<{
    dispatchAtMs: number;
    event: SyntheticStreamEvent;
  }>;
  totalElapsedMs: number;
}): Promise<{
  trippedWith: StreamStallPayload | null;
  usefulTokenCount: number;
  onStallSpy: ReturnType<typeof vi.fn>;
}> {
  const onStallSpy = vi.fn<(payload: StreamStallPayload) => void>();
  const tracker = createStreamStallTracker({
    thresholdMs: opts.thresholdMs,
    onStall: onStallSpy,
    checkIntervalMs: opts.checkIntervalMs,
  });

  let usefulTokenCount = 0;
  let currentSimulatedMs = 0;

  for (const { dispatchAtMs, event } of opts.events) {
    // Advance fake time up to this dispatch instant. Several setInterval
    // ticks may fire during this advance — the tracker decides per tick
    // whether the trip-condition is met.
    const delta = dispatchAtMs - currentSimulatedMs;
    if (delta > 0) {
      await vi.advanceTimersByTimeAsync(delta);
      currentSimulatedMs = dispatchAtMs;
    }
    // Apply the production predicate.
    if (isUsefulToken(event)) {
      usefulTokenCount += 1;
      tracker.markUsefulToken();
    }
  }

  // Advance to the totalElapsedMs deadline (final stall window).
  if (opts.totalElapsedMs > currentSimulatedMs) {
    await vi.advanceTimersByTimeAsync(
      opts.totalElapsedMs - currentSimulatedMs,
    );
  }

  // Stop the tracker (production cleanup happens here in both success
  // and catch paths — T-127-04 mitigation).
  tracker.stop();

  return {
    trippedWith: onStallSpy.mock.calls[0]?.[0] ?? null,
    usefulTokenCount,
    onStallSpy,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("phase127 — stream-stall tracker (synthetic stream)", () => {
  it("STALL-01: keepalive-only stream trips at threshold + 200ms", async () => {
    // Stream emits ONLY content_block_start + ping events — no useful
    // tokens. The fin-acquisition 2026-05-14 pattern in microcosm.
    const events: Array<{
      dispatchAtMs: number;
      event: SyntheticStreamEvent;
    }> = [];
    // Spam keepalives every 100ms across the threshold window.
    for (let t = 100; t <= 1100; t += 100) {
      events.push({
        dispatchAtMs: t,
        event: t % 200 === 0
          ? { type: "content_block_start" }
          : { type: "ping" },
      });
    }

    const result = await drive({
      thresholdMs: 1000,
      checkIntervalMs: 100,
      events,
      totalElapsedMs: 1200, // threshold + 200ms cushion
    });

    expect(result.trippedWith).not.toBeNull();
    expect(result.trippedWith?.lastUsefulTokenAgeMs).toBeGreaterThan(1000);
    expect(result.trippedWith?.thresholdMs).toBe(1000);
    expect(result.usefulTokenCount).toBe(0);
    expect(result.onStallSpy).toHaveBeenCalledTimes(1);
  });

  it("STALL-02: text_delta tokens reset the tracker (no trip)", async () => {
    // Stream emits a text_delta every (threshold/2 - 50)ms — well within
    // the reset window. Run for threshold * 3 of simulated time.
    const tickEveryMs = 450; // threshold/2 - 50 with threshold=1000
    const events: Array<{
      dispatchAtMs: number;
      event: SyntheticStreamEvent;
    }> = [];
    for (let t = tickEveryMs; t <= 3000; t += tickEveryMs) {
      events.push({
        dispatchAtMs: t,
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "x" },
        },
      });
    }

    const result = await drive({
      thresholdMs: 1000,
      checkIntervalMs: 100,
      events,
      totalElapsedMs: 3000,
    });

    expect(result.trippedWith).toBeNull();
    expect(result.usefulTokenCount).toBeGreaterThanOrEqual(6);
    expect(result.onStallSpy).not.toHaveBeenCalled();
  });

  it("STALL-03: input_json_delta.partial_json tokens reset the tracker (no trip)", async () => {
    // Tool-use streams emit partial_json (not text_delta). D-02 anti-
    // pattern definition includes this as a useful-token signal so an
    // agent dictating a long tool-use parameter doesn't false-stall.
    const tickEveryMs = 450;
    const events: Array<{
      dispatchAtMs: number;
      event: SyntheticStreamEvent;
    }> = [];
    for (let t = tickEveryMs; t <= 3000; t += tickEveryMs) {
      events.push({
        dispatchAtMs: t,
        event: {
          type: "content_block_delta",
          delta: { type: "input_json_delta", partial_json: '{"a":' },
        },
      });
    }

    const result = await drive({
      thresholdMs: 1000,
      checkIntervalMs: 100,
      events,
      totalElapsedMs: 3000,
    });

    expect(result.trippedWith).toBeNull();
    expect(result.usefulTokenCount).toBeGreaterThanOrEqual(6);
    expect(result.onStallSpy).not.toHaveBeenCalled();
  });
});

describe("phase127 — tracker cleanup (T-127-04 mitigation)", () => {
  it("stop() is idempotent and clears the interval", async () => {
    const onStallSpy = vi.fn<(payload: StreamStallPayload) => void>();
    const tracker = createStreamStallTracker({
      thresholdMs: 1000,
      onStall: onStallSpy,
      checkIntervalMs: 100,
    });

    // Two stops in a row must not throw.
    tracker.stop();
    tracker.stop();

    // After stop, advancing time past threshold MUST NOT trip.
    await vi.advanceTimersByTimeAsync(2000);
    expect(onStallSpy).not.toHaveBeenCalled();
  });

  it("trip fires onStall exactly once even with many ticks past threshold", async () => {
    const onStallSpy = vi.fn<(payload: StreamStallPayload) => void>();
    const tracker = createStreamStallTracker({
      thresholdMs: 200,
      onStall: onStallSpy,
      checkIntervalMs: 50,
    });

    // Advance well past threshold; the interval fires many times, but
    // only the first trip counts.
    await vi.advanceTimersByTimeAsync(2000);
    tracker.stop();
    expect(onStallSpy).toHaveBeenCalledTimes(1);
  });

  it("markUsefulToken after stop() is a no-op", async () => {
    const onStallSpy = vi.fn<(payload: StreamStallPayload) => void>();
    const tracker = createStreamStallTracker({
      thresholdMs: 1000,
      onStall: onStallSpy,
      checkIntervalMs: 100,
    });
    tracker.stop();
    tracker.markUsefulToken();
    // Internal state remains inert.
    await vi.advanceTimersByTimeAsync(2000);
    expect(onStallSpy).not.toHaveBeenCalled();
  });
});
