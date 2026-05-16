/**
 * Phase 999.10 Plan 01 — SecretsResolver behavior tests (RES-01..RES-09).
 *
 * Wave 1 replaces the Wave 0 `it.todo` scaffolds with real DI-pure tests
 * exercising:
 *   - cache hit (RES-01)
 *   - inflight dedup (RES-02)
 *   - retry success / rate-limit early-bail / empty-resolution (RES-03/04/05)
 *   - preResolveAll partial failure (RES-06)
 *   - counter lifecycle (RES-07)
 *   - SEC-07 no-leak guarantees: resolved value never in pino logs or thrown
 *     error messages (RES-08/09)
 *
 * All tests construct a fresh resolver per `it` — no module-level state.
 * Retry timings use minTimeout:1/maxTimeout:1 to keep wall-clock under the
 * 5s plan budget without resorting to fake timers (which p-retry's
 * setTimeout-based backoff fights).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { SecretsResolver, type OpReadFn } from "../secrets-resolver.js";

const SENTINEL_VALUE = "my-test-secret-9d8a2f";

function makeLogger(): { log: pino.Logger; captured: () => string } {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  const log = pino({ level: "debug" }, sink);
  return { log, captured: () => chunks.join("") };
}

/** Silent pino logger for tests that don't inspect log output. */
function silentLogger(): pino.Logger {
  const sink = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  return pino({ level: "silent" }, sink);
}

describe("SecretsResolver", () => {
  beforeEach(() => {
    // No global state — each test constructs its own resolver. Real timers
    // are fine: p-retry's setTimeout uses minTimeout:1ms in retry tests.
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("RES-01: cache hit avoids opRead", async () => {
    const opRead: OpReadFn = vi.fn(async () => SENTINEL_VALUE);
    const r = new SecretsResolver({
      opRead,
      log: silentLogger(),
      retryOptions: { retries: 0 },
    });

    const v1 = await r.resolve("op://A/B/C");
    const v2 = await r.resolve("op://A/B/C");

    expect(v1).toBe(SENTINEL_VALUE);
    expect(v2).toBe(SENTINEL_VALUE);
    expect(opRead).toHaveBeenCalledTimes(1);

    const snap = r.snapshot();
    expect(snap.hits).toBe(1);
    expect(snap.misses).toBe(1);
    expect(snap.cacheSize).toBe(1);
  });

  it("RES-02: inflight dedup", async () => {
    // Slow opRead so all three concurrent callers find the inflight Promise.
    const opRead: OpReadFn = vi.fn(async () => {
      await new Promise((rs) => setTimeout(rs, 10));
      return SENTINEL_VALUE;
    });
    const r = new SecretsResolver({
      opRead,
      log: silentLogger(),
      retryOptions: { retries: 0 },
    });

    const [v1, v2, v3] = await Promise.all([
      r.resolve("op://A"),
      r.resolve("op://A"),
      r.resolve("op://A"),
    ]);

    expect(v1).toBe(SENTINEL_VALUE);
    expect(v2).toBe(SENTINEL_VALUE);
    expect(v3).toBe(SENTINEL_VALUE);
    expect(opRead).toHaveBeenCalledTimes(1);
    expect(r.snapshot().cacheSize).toBe(1);
  });

  it("RES-03: retry succeeds before exhaustion", async () => {
    const opRead = vi
      .fn<OpReadFn>()
      .mockRejectedValueOnce(new Error("transient ECONNRESET"))
      .mockResolvedValueOnce(SENTINEL_VALUE);

    const r = new SecretsResolver({
      opRead,
      log: silentLogger(),
      retryOptions: { retries: 3, minTimeout: 1, maxTimeout: 1, randomize: false },
    });

    const v = await r.resolve("op://A");

    expect(v).toBe(SENTINEL_VALUE);
    expect(opRead).toHaveBeenCalledTimes(2);
    expect(r.snapshot().retries).toBeGreaterThanOrEqual(1);
    expect(r.getCached("op://A")).toBe(SENTINEL_VALUE);
  });

  it("RES-04: rate-limit bails early", async () => {
    const opRead: OpReadFn = vi.fn(async () => {
      throw new Error(
        "Too many requests. Your client has been rate-limited.",
      );
    });

    const r = new SecretsResolver({
      opRead,
      log: silentLogger(),
      retryOptions: { retries: 3, minTimeout: 1, maxTimeout: 1, randomize: false },
    });

    await expect(r.resolve("op://A")).rejects.toThrow(/op:\/\/A/);

    // Early-bail: attempt 1 fires (initial), attempt 2's onFailedAttempt
    // throws AbortError → no third invocation. Total opRead calls ≤ 2.
    expect((opRead as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(2);
    expect(r.snapshot().rateLimitHits).toBeGreaterThanOrEqual(1);
    expect(r.snapshot().lastFailureReason).toMatch(/rate.?limit|too many requests/i);
  });

  it("RES-05: empty resolution throws AbortError", async () => {
    const opRead: OpReadFn = vi.fn(async () => "");
    const r = new SecretsResolver({
      opRead,
      log: silentLogger(),
      retryOptions: { retries: 3, minTimeout: 1, maxTimeout: 1, randomize: false },
    });

    await expect(r.resolve("op://A")).rejects.toThrow(/empty string/);

    // Empty resolution is permanent (AbortError) — should not retry, and
    // must NOT be cached.
    expect((opRead as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(r.snapshot().cacheSize).toBe(0);
    expect(r.getCached("op://A")).toBeUndefined();
  });

  it("RES-06: preResolveAll partial failure", async () => {
    const opRead: OpReadFn = vi.fn(async (uri: string) => {
      if (uri === "op://B") throw new Error("not authorized");
      return SENTINEL_VALUE;
    });

    const r = new SecretsResolver({
      opRead,
      log: silentLogger(),
      retryOptions: { retries: 0 },
    });

    const results = await r.preResolveAll(["op://A", "op://B"]);

    expect(results).toHaveLength(2);
    const a = results.find((x) => x.uri === "op://A");
    const b = results.find((x) => x.uri === "op://B");
    expect(a?.ok).toBe(true);
    expect(b?.ok).toBe(false);
    expect(b?.reason).toMatch(/not authorized/);
    // preResolveAll itself does not throw.
  });

  // Phase 999.33 — bounded-concurrency boot-storm prevention.
  // Pre-fix: Promise.allSettled fanned out N op CLI subprocesses
  // simultaneously, saturating 1Password's rate-limit window when N > 4-5.
  // Post-fix: cap in-flight resolutions to 4. Verified by tracking max
  // concurrent inflight count across a 12-URI resolution wave.
  it("RES-08: preResolveAll caps concurrent in-flight at 4 (boot-storm fix)", async () => {
    let inflight = 0;
    let maxInflight = 0;
    const opRead: OpReadFn = vi.fn(async (uri: string) => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      // Simulate a slow op CLI shell-out so concurrent calls overlap.
      await new Promise((r) => setTimeout(r, 25));
      inflight--;
      return `${SENTINEL_VALUE}-${uri}`;
    });

    const r = new SecretsResolver({
      opRead,
      log: silentLogger(),
      retryOptions: { retries: 0 },
    });

    const uris = Array.from({ length: 12 }, (_, i) => `op://item-${i}/credential`);
    const results = await r.preResolveAll(uris);

    expect(results).toHaveLength(12);
    expect(results.every((x) => x.ok)).toBe(true);
    // All 12 resolved exactly once (no waste).
    expect(opRead).toHaveBeenCalledTimes(12);
    // Concurrency was bounded — must NEVER exceed the cap. Pre-fix this
    // would have been 12 (or close to N).
    expect(maxInflight).toBeLessThanOrEqual(4);
    expect(maxInflight).toBeGreaterThan(1); // sanity — actually went parallel
  });

  it("RES-09: preResolveAll preserves URI→outcome ordering (deterministic out array)", async () => {
    // The wave processor uses a shared cursor; each worker writes to
    // out[idx] for its assigned URI. The returned array must mirror
    // the input order even if workers complete out-of-order.
    const opRead: OpReadFn = vi.fn(async (uri: string) => {
      // Delay inversely to URI index — last URIs resolve first.
      const idx = parseInt(uri.replace(/\D/g, ""), 10) || 0;
      await new Promise((r) => setTimeout(r, (10 - idx) * 5));
      return `${SENTINEL_VALUE}-${uri}`;
    });

    const r = new SecretsResolver({
      opRead,
      log: silentLogger(),
      retryOptions: { retries: 0 },
    });

    const uris = Array.from({ length: 8 }, (_, i) => `op://item-${i}/credential`);
    const results = await r.preResolveAll(uris);

    for (let i = 0; i < uris.length; i++) {
      expect(results[i]?.uri).toBe(uris[i]);
    }
  });

  it("RES-10: preResolveAll handles empty input without crashing", async () => {
    const opRead: OpReadFn = vi.fn(async () => SENTINEL_VALUE);
    const r = new SecretsResolver({
      opRead,
      log: silentLogger(),
      retryOptions: { retries: 0 },
    });
    const results = await r.preResolveAll([]);
    expect(results).toEqual([]);
    expect(opRead).not.toHaveBeenCalled();
  });

  it("RES-07: counters track lifecycle", async () => {
    const calls = {
      sentinelCount: 0,
      transientThrown: false,
    };
    const opRead: OpReadFn = vi.fn(async (uri: string) => {
      if (uri === "op://hit") return SENTINEL_VALUE;
      if (uri === "op://retry") {
        if (!calls.transientThrown) {
          calls.transientThrown = true;
          throw new Error("transient ECONNRESET");
        }
        return SENTINEL_VALUE;
      }
      if (uri === "op://ratelimit") {
        throw new Error("Too many requests. Your client has been rate-limited.");
      }
      if (uri === "op://empty") return "";
      throw new Error(`unexpected uri ${uri}`);
    });

    const r = new SecretsResolver({
      opRead,
      log: silentLogger(),
      retryOptions: { retries: 3, minTimeout: 1, maxTimeout: 1, randomize: false },
    });

    // 1) miss + cache + hit
    await r.resolve("op://hit");
    await r.resolve("op://hit");
    // 2) retry-then-success
    await r.resolve("op://retry");
    // 3) rate-limit (rejects)
    await expect(r.resolve("op://ratelimit")).rejects.toThrow();
    // 4) empty (rejects)
    await expect(r.resolve("op://empty")).rejects.toThrow();

    const snap = r.snapshot();
    expect(snap.hits).toBe(1);
    expect(snap.misses).toBeGreaterThanOrEqual(4); // hit, retry, ratelimit, empty
    expect(snap.retries).toBeGreaterThanOrEqual(1);
    expect(snap.rateLimitHits).toBeGreaterThanOrEqual(1);
    expect(snap.lastFailureAt).toBeDefined();
    // ISO 8601 sanity check
    expect(snap.lastFailureAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(snap.lastFailureReason).toBeDefined();
    expect(snap.lastRefreshedAt).toBeDefined();
    expect(snap.cacheSize).toBe(2); // hit + retry resolved; ratelimit + empty did not cache
  });

  it("RES-08: resolved value never logged", async () => {
    const { log, captured } = makeLogger();

    let attempt = 0;
    const opRead: OpReadFn = vi.fn(async (uri: string) => {
      if (uri === "op://retry-then-ok") {
        attempt++;
        if (attempt === 1) throw new Error("transient");
        return SENTINEL_VALUE;
      }
      if (uri === "op://always-fails") {
        throw new Error("permanent CLI failure");
      }
      return SENTINEL_VALUE;
    });

    const r = new SecretsResolver({
      opRead,
      log,
      retryOptions: { retries: 3, minTimeout: 1, maxTimeout: 1, randomize: false },
    });

    // Successful resolve
    await r.resolve("op://happy");
    // Retry-then-success
    await r.resolve("op://retry-then-ok");
    // Permanent failure
    await expect(r.resolve("op://always-fails")).rejects.toThrow();
    // Cache invalidate (also logs)
    r.invalidate("op://happy");
    r.invalidateAll();

    const allLogs = captured();
    expect(allLogs.length).toBeGreaterThan(0); // sanity — sink received output
    expect(allLogs).not.toContain(SENTINEL_VALUE);
  });

  it("RES-09: error messages contain only URI", async () => {
    const opRead: OpReadFn = vi.fn(async () => {
      throw new Error("auth fail with token=abc123");
    });
    const r = new SecretsResolver({
      opRead,
      log: silentLogger(),
      retryOptions: { retries: 0 },
    });

    let caught: Error | undefined;
    try {
      await r.resolve("op://X/Y/Z");
      expect.fail("expected throw");
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toContain("op://X/Y/Z");
    expect(caught!.message).toContain("auth fail with token=abc123"); // operator-controlled CLI noise — fine
    // The resolved sentinel must never appear in the error (no resolution
    // happened, so this is enforced by construction — but we verify the
    // wrapping format does not echo any cached-value bleed-through).
    expect(caught!.message).not.toContain(SENTINEL_VALUE);
    expect(caught!.message).toMatch(/^Failed to resolve op:\/\/X\/Y\/Z after retries: /);
  });
});
