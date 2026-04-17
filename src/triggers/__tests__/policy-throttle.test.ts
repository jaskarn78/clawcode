/**
 * Phase 62 Plan 01 — TokenBucket (sliding-window throttle) tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { TokenBucket } from "../policy-throttle.js";

describe("TokenBucket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tryConsume() returns true up to maxPerMinute times", () => {
    const bucket = new TokenBucket(3);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
  });

  it("tryConsume() returns false after maxPerMinute exhausted within 60s", () => {
    const bucket = new TokenBucket(2);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it("old timestamps outside 60s window are evicted", () => {
    const bucket = new TokenBucket(1);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);

    // Advance time past the 60s window
    vi.advanceTimersByTime(61_000);

    expect(bucket.tryConsume()).toBe(true);
  });

  it("successive rapid calls respect the limit", () => {
    const bucket = new TokenBucket(5);
    const results: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      results.push(bucket.tryConsume());
    }
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(results.filter((r) => !r)).toHaveLength(3);
  });

  it("maxPerMinute of 1 allows exactly one event per window", () => {
    const bucket = new TokenBucket(1);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
    expect(bucket.tryConsume()).toBe(false);

    vi.advanceTimersByTime(60_001);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it("sliding window allows refilling mid-window", () => {
    const bucket = new TokenBucket(2);

    // Consume both at t=0
    expect(bucket.tryConsume()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);

    // Advance 60s so the first timestamp expires but the second doesn't
    vi.advanceTimersByTime(59_900);
    // First stamp at t=0 is now >60s old (evicted). Second at t=100 still alive.
    expect(bucket.tryConsume()).toBe(true); // one slot freed
    expect(bucket.tryConsume()).toBe(false); // still one from t=100
  });
});
