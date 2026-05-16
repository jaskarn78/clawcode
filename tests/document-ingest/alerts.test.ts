/**
 * Phase 101 Plan 02 T05 — recordIngestAlert tests (U7, SC-7).
 *
 * Covers all 5 reason codes round-tripping through recordIngestAlert:
 *   - ocr-low-confidence            (severity: 'warn'  → log only)
 *   - extraction-missing-required   (severity: 'error' → log + Discord)
 *   - max-pages-exceeded            (severity: 'error' → log + Discord)
 *   - mistral-disabled              (severity: 'error' → log + Discord)
 *   - embedder-failure              (severity: 'error' → log + Discord)
 *
 * Plus PII guard: alert payloads never include extracted field VALUES
 * — only metadata (T-101-06).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  recordIngestAlert,
  setIngestAlertDeps,
  _getIngestAlertDepsForTests,
  INGEST_ALERT_TAG,
  type IngestAlertReason,
} from "../../src/document-ingest/alerts.js";

type LogCall = { level: "warn" | "error"; payload: unknown; msg: unknown };

function makeFakeLogger(): {
  logger: {
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
    fatal: (...args: unknown[]) => void;
    trace: (...args: unknown[]) => void;
    child: () => unknown;
  };
  calls: LogCall[];
} {
  const calls: LogCall[] = [];
  const logger = {
    warn: (...args: unknown[]) =>
      calls.push({ level: "warn", payload: args[0], msg: args[1] }),
    error: (...args: unknown[]) =>
      calls.push({ level: "error", payload: args[0], msg: args[1] }),
    info: () => undefined,
    debug: () => undefined,
    fatal: () => undefined,
    trace: () => undefined,
    child: () => logger,
  };
  return { logger, calls };
}

describe("T05 recordIngestAlert", () => {
  let posted: string[];
  let postToAdminClawdy: ReturnType<typeof vi.fn>;
  let fakeLogger: ReturnType<typeof makeFakeLogger>;

  beforeEach(() => {
    posted = [];
    postToAdminClawdy = vi.fn(async (msg: string) => {
      posted.push(msg);
    });
    fakeLogger = makeFakeLogger();
    setIngestAlertDeps({
      logger: fakeLogger.logger as never,
      postToAdminClawdy,
    });
  });

  afterEach(() => {
    setIngestAlertDeps({});
  });

  it("emits a phase101-ingest-alert log line on every call", async () => {
    await recordIngestAlert({
      docSlug: "pon-2024",
      type: "scanned-pdf",
      reason: "ocr-low-confidence",
      severity: "warn",
      ocrConfidence: 0.12,
      agent: "fin-acquisition",
    });
    expect(fakeLogger.calls.length).toBe(1);
    expect(fakeLogger.calls[0].level).toBe("warn");
    expect(fakeLogger.calls[0].msg).toBe(INGEST_ALERT_TAG);
    const payload = fakeLogger.calls[0].payload as Record<string, unknown>;
    expect(payload.tag).toBe(INGEST_ALERT_TAG);
    expect(payload.reason).toBe("ocr-low-confidence");
    expect(payload.docSlug).toBe("pon-2024");
  });

  it("ocr-low-confidence (severity:warn) does NOT post to admin-clawdy", async () => {
    await recordIngestAlert({
      docSlug: "pon-2024",
      type: "scanned-pdf",
      reason: "ocr-low-confidence",
      severity: "warn",
      ocrConfidence: 0.15,
    });
    expect(postToAdminClawdy).not.toHaveBeenCalled();
    expect(posted.length).toBe(0);
  });

  it("extraction-missing-required (severity:error) posts to admin-clawdy with missingFields summary", async () => {
    await recordIngestAlert({
      docSlug: "pon-2024",
      type: "scanned-pdf",
      reason: "extraction-missing-required",
      severity: "error",
      missingFields: ["box1Wages", "scheduleC.netProfit"],
      agent: "fin-acquisition",
    });
    expect(postToAdminClawdy).toHaveBeenCalledTimes(1);
    expect(posted[0]).toMatch(/pon-2024/);
    expect(posted[0]).toMatch(/box1Wages/);
    expect(posted[0]).toMatch(/scheduleC.netProfit/);
  });

  it("max-pages-exceeded (severity:error) posts to admin-clawdy", async () => {
    await recordIngestAlert({
      docSlug: "huge-doc",
      type: "scanned-pdf",
      reason: "max-pages-exceeded",
      severity: "error",
      agent: "fin-acquisition",
    });
    expect(postToAdminClawdy).toHaveBeenCalledTimes(1);
    expect(posted[0]).toMatch(/huge-doc/);
    expect(posted[0]).toMatch(/MAX_PAGES/);
  });

  it("mistral-disabled (severity:error) posts to admin-clawdy with D-08 reference", async () => {
    await recordIngestAlert({
      docSlug: "weird-format",
      type: "image",
      reason: "mistral-disabled",
      severity: "error",
      agent: "fin-acquisition",
    });
    expect(postToAdminClawdy).toHaveBeenCalledTimes(1);
    expect(posted[0]).toMatch(/D-08|allowMistralOcr/);
  });

  it("embedder-failure (severity:error) posts to admin-clawdy", async () => {
    await recordIngestAlert({
      docSlug: "doc-x",
      type: "text-pdf",
      reason: "embedder-failure",
      severity: "error",
    });
    expect(postToAdminClawdy).toHaveBeenCalledTimes(1);
    expect(posted[0]).toMatch(/embedder/);
  });

  it("all 5 reason codes round-trip (SC-7 fail-mode coverage)", async () => {
    const reasons: IngestAlertReason[] = [
      "ocr-low-confidence",
      "extraction-missing-required",
      "max-pages-exceeded",
      "mistral-disabled",
      "embedder-failure",
    ];
    for (const reason of reasons) {
      await recordIngestAlert({
        docSlug: `doc-${reason}`,
        type: "text-pdf",
        reason,
        severity: reason === "ocr-low-confidence" ? "warn" : "error",
      });
    }
    expect(fakeLogger.calls.length).toBe(reasons.length);
    // Discord post fires for all 4 error-severity reasons (not the warn one).
    expect(postToAdminClawdy).toHaveBeenCalledTimes(4);
  });

  it("PII guard: no extracted value or extracted text appears in alert payload (T-101-06 — no PII)", async () => {
    // Even if the caller mistakenly includes a SSN-shaped string in
    // missingFields, the surface area for leaks is the docSlug/missing-
    // fields metadata; the alert payload MUST NOT carry extracted body
    // text. Assert the serialized payload contains only metadata fields.
    await recordIngestAlert({
      docSlug: "pon-2024",
      type: "scanned-pdf",
      reason: "extraction-missing-required",
      severity: "error",
      missingFields: ["box1Wages"],
      agent: "fin-acquisition",
    });
    const logPayload = JSON.stringify(fakeLogger.calls[0].payload);
    // Common PII patterns must NOT appear:
    expect(logPayload).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/); // SSN
    expect(logPayload).not.toMatch(/\bSSN\b/i);
    expect(logPayload).not.toMatch(/extracted value/i);
    // Whitelisted metadata fields:
    expect(logPayload).toContain("docSlug");
    expect(logPayload).toContain("reason");
  });

  it("Discord post failure does not poison the alert path", async () => {
    postToAdminClawdy = vi.fn(async () => {
      throw new Error("discord webhook 429");
    });
    setIngestAlertDeps({
      logger: fakeLogger.logger as never,
      postToAdminClawdy,
    });
    await expect(
      recordIngestAlert({
        docSlug: "doc-x",
        type: "text-pdf",
        reason: "extraction-missing-required",
        severity: "error",
      }),
    ).resolves.toBeUndefined();
    // The initial log line + the failure log line (warn).
    const failureLog = fakeLogger.calls.find(
      (c) => typeof c.msg === "string" && /discord post failed/.test(String(c.msg)),
    );
    expect(failureLog).toBeDefined();
  });

  it("alert path survives missing deps (boot race) — falls back to console", async () => {
    setIngestAlertDeps({});
    expect(_getIngestAlertDepsForTests()).toEqual({});
    await expect(
      recordIngestAlert({
        docSlug: "pre-boot",
        type: "text-pdf",
        reason: "embedder-failure",
        severity: "error",
      }),
    ).resolves.toBeUndefined();
  });
});
