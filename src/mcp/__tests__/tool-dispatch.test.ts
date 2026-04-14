import { describe, it, expect } from "vitest";
import { runWithConcurrencyLimit } from "../tool-dispatch.js";

/**
 * Phase 55 Plan 02 — runWithConcurrencyLimit unit tests (Tests 8-12).
 *
 * Verifies the semaphore-style concurrency cap + Promise.allSettled error
 * isolation that wraps our MCP handler batch dispatch.
 *
 * Timing tests use real timers with generous tolerance so they don't flake
 * on shared CI runners; medians on ~50ms / ~100ms delays should be stable.
 */

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("runWithConcurrencyLimit (Phase 55)", () => {
  it("Test 8: 5 handlers at 50ms each with maxConcurrent=5 finish in <150ms (parallel, not serial)", async () => {
    const handlers = Array.from({ length: 5 }, () => async () => {
      await delay(50);
      return "ok";
    });
    const start = Date.now();
    const results = await runWithConcurrencyLimit(handlers, 5);
    const elapsed = Date.now() - start;
    // Serial would be ~250ms; parallel should be ~50ms. Generous 150ms cap.
    expect(elapsed).toBeLessThan(150);
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("Test 9: 10 handlers at 100ms each with maxConcurrent=2 finish in ~500ms (5 batches)", async () => {
    const handlers = Array.from({ length: 10 }, () => async () => {
      await delay(100);
      return "ok";
    });
    const start = Date.now();
    const results = await runWithConcurrencyLimit(handlers, 2);
    const elapsed = Date.now() - start;
    // 5 batches of 2 x 100ms = ~500ms. Accept 400-900ms tolerance for CI noise.
    expect(elapsed).toBeGreaterThanOrEqual(400);
    expect(elapsed).toBeLessThan(900);
    expect(results).toHaveLength(10);
  });

  it("Test 10: error isolation — one handler throw does not block siblings", async () => {
    const handlers = [
      async () => {
        await delay(10);
        return "a";
      },
      async () => {
        await delay(10);
        throw new Error("boom");
      },
      async () => {
        await delay(10);
        return "c";
      },
    ];
    const results = await runWithConcurrencyLimit(handlers, 3);
    expect(results).toHaveLength(3);
    expect(results[0]!.status).toBe("fulfilled");
    expect(results[1]!.status).toBe("rejected");
    expect(results[2]!.status).toBe("fulfilled");
    if (results[0]!.status === "fulfilled") expect(results[0]!.value).toBe("a");
    if (results[2]!.status === "fulfilled") expect(results[2]!.value).toBe("c");
    if (results[1]!.status === "rejected") {
      expect((results[1]!.reason as Error).message).toBe("boom");
    }
  });

  it("Test 11: empty handlers array resolves to []", async () => {
    const results = await runWithConcurrencyLimit([], 10);
    expect(results).toEqual([]);
  });

  it("Test 12: maxConcurrent >= handlers.length is equivalent to unconstrained allSettled", async () => {
    const handlers = Array.from({ length: 3 }, (_, i) => async () => {
      await delay(20);
      return i;
    });
    const start = Date.now();
    const results = await runWithConcurrencyLimit(handlers, 100);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100); // All 3 run in parallel
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([0, 1, 2]);
  });

  it("Concurrency cap is honoured — 15 handlers with max 10 never exceed 10 in-flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const handlers = Array.from({ length: 15 }, () => async () => {
      inFlight++;
      if (inFlight > peak) peak = inFlight;
      await delay(30);
      inFlight--;
      return "ok";
    });
    await runWithConcurrencyLimit(handlers, 10);
    expect(peak).toBeLessThanOrEqual(10);
  });

  it("results preserve input order even under varying durations", async () => {
    const handlers = [
      async () => {
        await delay(50);
        return "slow";
      },
      async () => {
        await delay(5);
        return "fast";
      },
      async () => {
        await delay(25);
        return "mid";
      },
    ];
    const results = await runWithConcurrencyLimit(handlers, 3);
    expect(results).toHaveLength(3);
    const values = results.map((r) => (r.status === "fulfilled" ? r.value : null));
    expect(values).toEqual(["slow", "fast", "mid"]);
  });

  it("throws when maxConcurrent <= 0 (avoids deadlock)", async () => {
    const handlers = [async () => "ok"];
    await expect(runWithConcurrencyLimit(handlers, 0)).rejects.toThrow();
    await expect(runWithConcurrencyLimit(handlers, -1)).rejects.toThrow();
  });
});
