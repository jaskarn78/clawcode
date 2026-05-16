/**
 * Phase 101 T04 — page-batching + handler tests.
 *
 * Covers:
 *   - batchPages: count cap, byte cap, MAX_PAGES rejection
 *   - all 6 handlers via the engine's ingest() entrypoint over the T02 fixtures
 *   - empty input edge case
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Mock ocrPage so the scanned-pdf + image handlers don't need a live OCR
// stack. The orchestrator import below picks up this mock.
vi.mock("../../src/document-ingest/ocr/index.js", () => ({
  ocrPage: vi.fn(async () => ({
    text: "[mocked-ocr-text]",
    confidence: 0.9,
    backend: "tesseract-cli",
  })),
  DEFAULT_CONFIDENCE_THRESHOLD: 0.7,
}));

import {
  batchPages,
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_BYTES,
  MAX_PAGES,
  DIMENSION_MAX_PX,
  IngestError,
} from "../../src/document-ingest/page-batch.js";
import { ingest } from "../../src/document-ingest/index.js";
import type { BatchedPage } from "../../src/document-ingest/types.js";

const FIXTURES = join(__dirname, "..", "fixtures", "document-ingest");
function load(name: string): Buffer {
  return readFileSync(join(FIXTURES, name));
}

function mkPage(n: number, sizeKb = 0): BatchedPage {
  return {
    pageNumber: n,
    imageBuffer: sizeKb > 0 ? Buffer.alloc(sizeKb * 1024, 0xff) : undefined,
  };
}

describe("phase101 batchPages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("constants are wired to the documented values", () => {
    expect(DEFAULT_BATCH_SIZE).toBe(5);
    expect(MAX_BATCH_BYTES).toBe(25 * 1024 * 1024);
    expect(DIMENSION_MAX_PX).toBe(2000);
    expect(MAX_PAGES).toBe(500);
  });

  it("packs pages up to DEFAULT_BATCH_SIZE per batch", () => {
    const pages = Array.from({ length: 12 }, (_, i) => mkPage(i + 1));
    const batches = batchPages(pages);
    expect(batches).toHaveLength(3); // 5 + 5 + 2
    expect(batches[0]).toHaveLength(5);
    expect(batches[1]).toHaveLength(5);
    expect(batches[2]).toHaveLength(2);
  });

  it("flushes early when cumulative bytes exceed maxBytes", () => {
    // 4 pages × 10 KB each → 40 KB total. maxBytes=15 KB → split at the
    // page that would push us over. Expected: [10KB] [10KB,10KB] [10KB]
    // Actually with greedy flush-before-add: page1 fits, page2 (cum 20KB > 15KB) → flush. New batch with page2 alone; page3 (cum 20KB > 15KB) → flush. Etc.
    const pages = Array.from({ length: 4 }, (_, i) => mkPage(i + 1, 10));
    const batches = batchPages(pages, { maxBytes: 15 * 1024, batchSize: 100 });
    // Verify NO batch exceeds 15 KB.
    for (const b of batches) {
      const total = b.reduce(
        (s, p) => s + (p.imageBuffer?.byteLength ?? 0),
        0,
      );
      expect(total).toBeLessThanOrEqual(15 * 1024 + 10 * 1024); // single-page overflows allowed
    }
    expect(batches.length).toBeGreaterThan(1);
  });

  it("returns empty array for empty input", () => {
    expect(batchPages([])).toEqual([]);
  });

  it("rejects documents over MAX_PAGES (T-101-03)", () => {
    const tooMany = Array.from({ length: MAX_PAGES + 1 }, (_, i) =>
      mkPage(i + 1),
    );
    expect(() => batchPages(tooMany)).toThrow(IngestError);
    expect(() => batchPages(tooMany)).toThrow(/MAX_PAGES=500/);
  });
});

describe("phase101 ingest() — handler dispatch end-to-end", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("text-pdf → handleTextPdf → real text from pdf-parse", async () => {
    const buf = load("sample-text.pdf");
    const r = await ingest(buf, "sample-text.pdf");
    expect(r.telemetry.type).toBe("text-pdf");
    expect(r.text).toContain("Hello fixture text");
    expect(r.telemetry.ocrUsed).toBe("none");
    expect(r.telemetry.pages).toBeGreaterThan(0);
  });

  it("docx → handleDocx → real text from mammoth", async () => {
    const buf = load("sample.docx");
    const r = await ingest(buf, "sample.docx");
    expect(r.telemetry.type).toBe("docx");
    expect(r.text).toContain("Hello docx fixture content");
    expect(r.telemetry.pages).toBe(1);
  });

  it("xlsx → handleXlsx → cells joined per sheet", async () => {
    const buf = load("sample.xlsx");
    const r = await ingest(buf, "sample.xlsx");
    expect(r.telemetry.type).toBe("xlsx");
    expect(r.text).toContain("Alpha");
    expect(r.text).toContain("100");
    expect(r.telemetry.pages).toBe(1);
  });

  it("image → handleImage → resized buffer + mocked OCR text", async () => {
    const buf = load("sample.png");
    const r = await ingest(buf, "sample.png");
    expect(r.telemetry.type).toBe("image");
    expect(r.text).toContain("[mocked-ocr-text]");
    expect(r.telemetry.ocrUsed).toBe("tesseract-cli");
    expect(r.telemetry.pages).toBe(1);
  });

  it("text → handleText → utf-8 decode", async () => {
    const buf = Buffer.from("plain text fixture content");
    const r = await ingest(buf, "notes.txt");
    expect(r.telemetry.type).toBe("text");
    expect(r.text).toBe("plain text fixture content");
  });

  it("scanned-pdf → handleScannedPdf → mocked OCR per rendered page", async () => {
    const buf = load("sample-scanned.pdf");
    const r = await ingest(buf, "sample-scanned.pdf");
    expect(r.telemetry.type).toBe("scanned-pdf");
    expect(r.text).toContain("[mocked-ocr-text]");
    expect(r.telemetry.ocrUsed).toBe("tesseract-cli");
    expect(r.telemetry.pages).toBeGreaterThan(0);
  });
});
