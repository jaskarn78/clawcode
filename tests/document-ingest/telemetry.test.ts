/**
 * Phase 101 T01 — telemetry emitter contract.
 */

import { describe, it, expect, vi } from "vitest";
import pino from "pino";
import { Writable } from "node:stream";
import { logIngest, INGEST_LOG_TAG } from "../../src/document-ingest/telemetry.js";
import type { IngestTelemetry } from "../../src/document-ingest/types.js";

/** Build a pino logger that captures lines into an in-memory array. */
function makeCapturingLogger(): { logger: pino.Logger; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { logger: pino({ level: "info" }, stream), lines };
}

const validTelemetry: IngestTelemetry = {
  docSlug: "pon-2024",
  type: "text-pdf",
  pages: 12,
  ocrUsed: "none",
  chunksCreated: 27,
  p50_ms: 14,
  p95_ms: 32,
};

describe("phase101 telemetry.logIngest", () => {
  it("emits a single JSON line tagged phase101-ingest", () => {
    const { logger, lines } = makeCapturingLogger();
    logIngest(validTelemetry, logger);

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.tag).toBe(INGEST_LOG_TAG);
    expect(parsed.docSlug).toBe("pon-2024");
    expect(parsed.type).toBe("text-pdf");
    expect(parsed.pages).toBe(12);
    expect(parsed.ocrUsed).toBe("none");
    expect(parsed.chunksCreated).toBe(27);
    expect(parsed.p50_ms).toBe(14);
    expect(parsed.p95_ms).toBe(32);
  });

  it("INGEST_LOG_TAG is the single grep target 'phase101-ingest'", () => {
    expect(INGEST_LOG_TAG).toBe("phase101-ingest");
  });

  it("throws when a required field is missing", () => {
    const { logger } = makeCapturingLogger();
    const partial = { ...validTelemetry } as Partial<IngestTelemetry>;
    delete (partial as Record<string, unknown>).pages;

    expect(() => logIngest(partial as IngestTelemetry, logger)).toThrow(
      /missing required field: pages/,
    );
  });

  it("throws when chunksCreated is missing", () => {
    const { logger } = makeCapturingLogger();
    const partial = { ...validTelemetry } as Partial<IngestTelemetry>;
    delete (partial as Record<string, unknown>).chunksCreated;

    expect(() => logIngest(partial as IngestTelemetry, logger)).toThrow(
      /missing required field: chunksCreated/,
    );
  });

  it("preserves optional fields when present", () => {
    const { logger, lines } = makeCapturingLogger();
    logIngest(
      { ...validTelemetry, ocrConfidence: 0.91, apiCostUsd: 0.0125 },
      logger,
    );
    const parsed = JSON.parse(lines[0]);
    expect(parsed.ocrConfidence).toBe(0.91);
    expect(parsed.apiCostUsd).toBe(0.0125);
  });
});

// Silence unused-var lint of `vi`.
void vi;
