import { describe, it, expect, vi } from "vitest";
import { parseReadinessWaitMs } from "../endpoint-bootstrap.js";

/**
 * Phase 73 Plan 02 — parseReadinessWaitMs unit tests (LAT-04).
 *
 * Pin the parse contract without booting an endpoint:
 *   - undefined / empty → undefined (server uses its 300ms default).
 *   - valid integer in [0, 60_000] → that integer.
 *   - anything else → undefined + warn log fires.
 */

type WarnLog = { obj: Record<string, unknown>; msg?: string };

function makeLog(): {
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  calls: WarnLog[];
} {
  const calls: WarnLog[] = [];
  return {
    calls,
    warn: (obj, msg) => {
      calls.push({ obj, msg });
    },
  };
}

describe("parseReadinessWaitMs", () => {
  it("env absent (undefined) → undefined, no warn", () => {
    const log = makeLog();
    expect(parseReadinessWaitMs(undefined, log)).toBeUndefined();
    expect(log.calls).toHaveLength(0);
  });

  it("env empty string → undefined, no warn", () => {
    const log = makeLog();
    expect(parseReadinessWaitMs("", log)).toBeUndefined();
    expect(log.calls).toHaveLength(0);
  });

  it("env whitespace-only → undefined, no warn (treated as absent)", () => {
    const log = makeLog();
    expect(parseReadinessWaitMs("   ", log)).toBeUndefined();
    expect(log.calls).toHaveLength(0);
  });

  it("env='500' → 500 (valid integer passes through)", () => {
    const log = makeLog();
    expect(parseReadinessWaitMs("500", log)).toBe(500);
    expect(log.calls).toHaveLength(0);
  });

  it("env='0' → 0 (zero is the lower bound, no wait)", () => {
    const log = makeLog();
    expect(parseReadinessWaitMs("0", log)).toBe(0);
    expect(log.calls).toHaveLength(0);
  });

  it("env='60000' → 60000 (upper bound accepted)", () => {
    const log = makeLog();
    expect(parseReadinessWaitMs("60000", log)).toBe(60_000);
    expect(log.calls).toHaveLength(0);
  });

  it("env='-5' → undefined + warn (negative rejected)", () => {
    const log = makeLog();
    expect(parseReadinessWaitMs("-5", log)).toBeUndefined();
    expect(log.calls).toHaveLength(1);
    expect(log.calls[0]!.obj.raw).toBe("-5");
    expect(log.calls[0]!.obj.default).toBe(300);
    expect(log.calls[0]!.msg).toMatch(/invalid/i);
  });

  it("env='abc' → undefined + warn (non-numeric rejected)", () => {
    const log = makeLog();
    expect(parseReadinessWaitMs("abc", log)).toBeUndefined();
    expect(log.calls).toHaveLength(1);
    expect(log.calls[0]!.obj.raw).toBe("abc");
  });

  it("env='999999' → undefined + warn (out of range, > 60_000)", () => {
    const log = makeLog();
    expect(parseReadinessWaitMs("999999", log)).toBeUndefined();
    expect(log.calls).toHaveLength(1);
    expect(log.calls[0]!.obj.raw).toBe("999999");
    expect(log.calls[0]!.obj.default).toBe(300);
  });

  it("works without a log (warn path is silent)", () => {
    // No throw when log is undefined and input is invalid.
    expect(() => parseReadinessWaitMs("bogus")).not.toThrow();
    expect(parseReadinessWaitMs("bogus")).toBeUndefined();
    expect(parseReadinessWaitMs(undefined)).toBeUndefined();
    expect(parseReadinessWaitMs("250")).toBe(250);
  });

  it("decimals truncate via parseInt (env='300.7' → 300)", () => {
    // parseInt semantics — operator intent for a 300ms bound is preserved.
    const log = makeLog();
    expect(parseReadinessWaitMs("300.7", log)).toBe(300);
    expect(log.calls).toHaveLength(0);
  });
});
