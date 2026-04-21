/**
 * Phase 83 Plan 01 Task 2 — Regression-pin spy tests for setEffort wiring.
 *
 * REGRESSION GUARD: Every test asserts the SDK spy was CALLED with the mapped
 * budget. If `setEffort` is ever silently un-wired (the Phase 73 bug), these
 * tests fail loudly — no silent no-op can recur without breaking CI.
 *
 * Contract:
 *   - handle.setEffort(level) → q.setMaxThinkingTokens(mapEffortToTokens(level))
 *   - setEffort is synchronous (slash-command / IPC path cannot wait)
 *   - SDK rejection is swallowed + logged, never crashes the caller
 *   - getEffort() returns the most-recently-set level (state parity)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPersistentSessionHandle } from "../persistent-session-handle.js";
import type { SdkModule, SdkQuery } from "../sdk-types.js";

// ---------------------------------------------------------------------------
// Harness — build an SdkModule whose Query exposes a spy'd
// setMaxThinkingTokens. No stream messages are needed; these tests only
// exercise the mutation path.
// ---------------------------------------------------------------------------

function buildHandleWithSpy(
  setMaxThinkingTokensSpy: ReturnType<typeof vi.fn>,
): ReturnType<typeof createPersistentSessionHandle> {
  // Minimal async-iterator shim — never yields. Tests don't consume the
  // stream; they only call setEffort + inspect the spy.
  const next = (): Promise<IteratorResult<never>> =>
    new Promise(() => {
      // Never resolve — handle can't consume anything because these tests
      // never call send(). That's fine; setEffort is synchronous-dispatch
      // and doesn't depend on the stream.
    });

  const query = {
    [Symbol.asyncIterator]() {
      return { next };
    },
    next,
    return: async () => ({ value: undefined, done: true as const }),
    throw: async (err: unknown) => {
      throw err;
    },
    interrupt: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => undefined),
    streamInput: vi.fn(() => Promise.resolve()),
    mcpServerStatus: vi.fn(() => Promise.resolve([])),
    setMcpServers: vi.fn(() => Promise.resolve(undefined)),
    setMaxThinkingTokens: setMaxThinkingTokensSpy,
  } as unknown as SdkQuery;

  const sdkMock: SdkModule = {
    query: vi.fn(() => query),
  } as unknown as SdkModule;

  return createPersistentSessionHandle(sdkMock, {}, "sess-effort");
}

describe("persistent-session-handle setEffort — SDK wire regression pin (Phase 83 EFFORT-01)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Silence the log-and-continue warn path so test output stays clean.
    // Tests that exercise the rejection branch still observe the spy.
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    warnSpy.mockRestore();
  });

  it("setEffort('high') invokes q.setMaxThinkingTokens(16384) exactly once", async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    const handle = buildHandleWithSpy(spy);
    handle.setEffort("high");
    // Give the unwrapped Promise a tick to resolve (the call is fire-and-forget).
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(16384);
    await handle.close();
  });

  it("setEffort('off') invokes q.setMaxThinkingTokens(0) — explicit disable", async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    const handle = buildHandleWithSpy(spy);
    handle.setEffort("off");
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(0);
    await handle.close();
  });

  it("setEffort('auto') invokes q.setMaxThinkingTokens(null) — model default", async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    const handle = buildHandleWithSpy(spy);
    handle.setEffort("auto");
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(null);
    await handle.close();
  });

  it("setEffort('xhigh') invokes q.setMaxThinkingTokens(24576)", async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    const handle = buildHandleWithSpy(spy);
    handle.setEffort("xhigh");
    await Promise.resolve();
    expect(spy).toHaveBeenCalledWith(24576);
    await handle.close();
  });

  it("setEffort('max') invokes q.setMaxThinkingTokens(32768)", async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    const handle = buildHandleWithSpy(spy);
    handle.setEffort("max");
    await Promise.resolve();
    expect(spy).toHaveBeenCalledWith(32768);
    await handle.close();
  });

  it("two sequential setEffort calls produce two SDK calls in order (no coalescing)", async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    const handle = buildHandleWithSpy(spy);
    handle.setEffort("low");
    handle.setEffort("high");
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls).toEqual([[1024], [16384]]);
    await handle.close();
  });

  it("getEffort() returns the most recently set level (state parity preserved)", async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    const handle = buildHandleWithSpy(spy);
    handle.setEffort("high");
    expect(handle.getEffort()).toBe("high");
    handle.setEffort("off");
    expect(handle.getEffort()).toBe("off");
    handle.setEffort("auto");
    expect(handle.getEffort()).toBe("auto");
    await handle.close();
  });

  it("SDK rejection does not throw synchronously from setEffort (log-and-continue)", async () => {
    const spy = vi.fn().mockRejectedValue(new Error("sdk blew up"));
    const handle = buildHandleWithSpy(spy);
    // Must not throw synchronously — slash-command / IPC path relies on this.
    expect(() => handle.setEffort("max")).not.toThrow();
    // Give the rejection a chance to propagate through the .catch handler.
    await Promise.resolve();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledWith(32768);
    // Warning logged, not thrown.
    expect(warnSpy).toHaveBeenCalled();
    await handle.close();
  });
});
