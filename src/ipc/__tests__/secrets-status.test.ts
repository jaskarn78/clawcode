/**
 * Phase 999.10 — SEC-06 IPC handler tests.
 *
 * Wave 3 plan 04 wires the `secrets-status` + `secrets-invalidate` IPC
 * methods into the daemon. These tests exercise the pure handler module
 * (`secrets-ipc-handler.ts`) directly — no IPC server boot required —
 * verifying the zod-validated response shape, single-URI invalidation,
 * full-cache flush, and zod request-shape rejection of non-op:// URIs.
 *
 * IPC-SECSTATUS-01 — counter snapshot returned, validates against zod
 * IPC-SECSTATUS-02 — invalidate clears one URI when uri param present
 * IPC-SECSTATUS-03 — invalidate clears entire cache when uri param omitted
 * IPC-SECSTATUS-04 — invalidate rejects non-op:// uri via zod (defense-in-depth)
 */

import { describe, it, expect, vi } from "vitest";
import pino from "pino";
import { Writable } from "node:stream";
import { SecretsResolver } from "../../manager/secrets-resolver.js";
import {
  handleSecretsStatus,
  handleSecretsInvalidate,
} from "../../manager/secrets-ipc-handler.js";
import { SecretsStatusResponseSchema } from "../protocol.js";

/** Silent pino logger — handler tests don't inspect log output. */
function makeSilentLog(): pino.Logger {
  const sink = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  return pino({ level: "silent" }, sink);
}

describe("ipc method secrets-status", () => {
  it("IPC-SECSTATUS-01: returns zod-validated counter snapshot", async () => {
    const log = makeSilentLog();
    const opRead = vi.fn(async (uri: string) => `value-${uri}`);
    const r = new SecretsResolver({
      opRead,
      log,
      retryOptions: { retries: 0, minTimeout: 1, maxTimeout: 1, randomize: false },
    });
    // 1 miss + cache, then 1 hit on the same URI.
    await r.resolve("op://A/B/C");
    await r.resolve("op://A/B/C");

    const response = handleSecretsStatus(r);

    // The response MUST validate against the wire-level zod schema —
    // catches drift between SecretsResolver.snapshot() and the IPC
    // contract before it reaches a CLI consumer.
    const parsed = SecretsStatusResponseSchema.safeParse(response);
    expect(parsed.success, parsed.success ? "ok" : JSON.stringify(parsed.error)).toBe(true);

    expect(response.ok).toBe(true);
    expect(response.cacheSize).toBe(1);
    expect(response.hits).toBe(1);
    expect(response.misses).toBe(1);
    expect(response.retries).toBe(0);
    expect(response.rateLimitHits).toBe(0);
    // lastRefreshedAt populated on the happy path.
    expect(response.lastRefreshedAt).toBeDefined();
    // No failures yet — failure fields stay undefined (omitted from response).
    expect(response.lastFailureAt).toBeUndefined();
    expect(response.lastFailureReason).toBeUndefined();
  });

  it("IPC-SECSTATUS-02: secrets-invalidate clears single URI when uri param present", async () => {
    const log = makeSilentLog();
    const opRead = vi.fn(async (uri: string) => `value-${uri}`);
    const r = new SecretsResolver({
      opRead,
      log,
      retryOptions: { retries: 0, minTimeout: 1, maxTimeout: 1, randomize: false },
    });
    await r.resolve("op://A/B/C");
    await r.resolve("op://D/E/F");
    expect(r.snapshot().cacheSize).toBe(2);

    const response = handleSecretsInvalidate(r, { uri: "op://A/B/C" });

    expect(response).toEqual({ ok: true, invalidated: "op://A/B/C" });
    // First URI flushed, second untouched.
    expect(r.getCached("op://A/B/C")).toBeUndefined();
    expect(r.getCached("op://D/E/F")).toBe("value-op://D/E/F");
    expect(r.snapshot().cacheSize).toBe(1);
  });

  it("IPC-SECSTATUS-03: secrets-invalidate clears all when uri param omitted", async () => {
    const log = makeSilentLog();
    const opRead = vi.fn(async (uri: string) => `value-${uri}`);
    const r = new SecretsResolver({
      opRead,
      log,
      retryOptions: { retries: 0, minTimeout: 1, maxTimeout: 1, randomize: false },
    });
    await r.resolve("op://A/B/C");
    await r.resolve("op://D/E/F");
    expect(r.snapshot().cacheSize).toBe(2);

    // Omit uri — should flush everything.
    const response = handleSecretsInvalidate(r, {});

    expect(response).toEqual({ ok: true, invalidated: "all" });
    expect(r.snapshot().cacheSize).toBe(0);
    expect(r.getCached("op://A/B/C")).toBeUndefined();
    expect(r.getCached("op://D/E/F")).toBeUndefined();
  });

  it("IPC-SECSTATUS-04: secrets-invalidate rejects non-op:// uri via zod", () => {
    const log = makeSilentLog();
    // No opRead invocation — this test asserts the zod guard fires before
    // the resolver is touched. opRead is a never-called sentinel.
    const opRead = vi.fn(async () => {
      throw new Error("opRead should not be invoked when zod rejects params");
    });
    const r = new SecretsResolver({ opRead, log });

    const response = handleSecretsInvalidate(r, { uri: "not-an-op-ref" });

    expect(response.ok).toBe(false);
    if (response.ok === false) {
      expect(response.error).toMatch(/Invalid params/);
    }
    // Sanity: cache untouched, opRead never called.
    expect(opRead).not.toHaveBeenCalled();
    expect(r.snapshot().cacheSize).toBe(0);
  });
});
