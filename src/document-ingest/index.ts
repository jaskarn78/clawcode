/**
 * Phase 101 document-ingestion engine — public entrypoint.
 *
 * Flow:
 *   1. detect type via magic-byte sniff (T02)
 *   2. dispatch to per-type handler (T04) — returns BatchedPage[]
 *   3. for image-bearing handlers (scanned-pdf, image), run per-page OCR
 *      through the three-tier fallback chain (T03)
 *   4. assemble final concatenated text + telemetry
 *
 * Chunking + embedding + DB writes happen downstream at the daemon's
 * `case "ingest-document"` block (T05), not here — the engine is a pure
 * text extractor.
 */

import { basename } from "node:path";
import { detectDocumentType } from "./detect.js";
import { handleTextPdf } from "./handlers/text-pdf.js";
import { handleScannedPdf } from "./handlers/scanned-pdf.js";
import { handleDocx } from "./handlers/docx.js";
import { handleXlsx } from "./handlers/xlsx.js";
import { handleImage } from "./handlers/image.js";
import { handleText } from "./handlers/text.js";
import { ocrPage } from "./ocr/index.js";
import type {
  BatchedPage,
  DocumentType,
  IngestOptions,
  IngestResult,
  IngestTelemetry,
  OcrBackend,
} from "./types.js";

export { detectDocumentType } from "./detect.js";
export { batchPages, IngestError } from "./page-batch.js";
export {
  DEFAULT_BATCH_SIZE,
  DIMENSION_MAX_PX,
  MAX_BATCH_BYTES,
  MAX_PAGES,
} from "./page-batch.js";
export { ocrPage } from "./ocr/index.js";
export { logIngest, INGEST_LOG_TAG } from "./telemetry.js";
export type {
  DocumentType,
  OcrBackend,
  BatchedPage,
  TaskHint,
  IngestOptions,
  IngestTelemetry,
  IngestResult,
} from "./types.js";

/** Compute p50 / p95 from per-page wall-clock samples (integer ms). */
function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((p / 100) * sorted.length)),
  );
  return sorted[idx];
}

/** Run the per-type handler. Single dispatch surface. */
async function dispatchHandler(
  type: DocumentType,
  buf: Buffer,
): Promise<readonly BatchedPage[]> {
  switch (type) {
    case "text-pdf":
      return handleTextPdf(buf);
    case "scanned-pdf":
      return handleScannedPdf(buf);
    case "docx":
      return handleDocx(buf);
    case "xlsx":
      return handleXlsx(buf);
    case "image":
      return handleImage(buf);
    case "text":
      return handleText(buf);
  }
}

/**
 * Engine entrypoint. Detects type, dispatches handler, runs per-page OCR for
 * image-bearing handlers, returns concatenated text + structured telemetry.
 */
export async function ingest(
  buf: Buffer,
  filename: string,
  opts: IngestOptions = {},
): Promise<IngestResult & { text: string; pages: readonly BatchedPage[] }> {
  const type = await detectDocumentType(buf, filename);
  const slug = basename(filename).replace(/\.[^.]+$/, "") || "document";

  const pages = await dispatchHandler(type, buf);

  // Per-page OCR for image-bearing handlers. The CLI tier is the default;
  // tests pass skipCli/skipWasm via direct ocrPage calls if needed.
  const perPageTimings: number[] = [];
  let ocrUsed: OcrBackend = "none";
  const pageTexts: string[] = [];

  for (const page of pages) {
    const t0 = Date.now();
    if (page.text !== undefined && page.text.length > 0) {
      pageTexts.push(page.text);
    } else if (page.imageBuffer !== undefined) {
      const r = await ocrPage(page.imageBuffer, { taskHint: opts.taskHint });
      pageTexts.push(r.text);
      if (ocrUsed === "none") ocrUsed = r.backend;
    }
    perPageTimings.push(Date.now() - t0);
  }

  const text = pageTexts.join("\n\n").trim();
  const telemetry: IngestTelemetry = {
    docSlug: slug,
    type,
    pages: pages.length,
    ocrUsed,
    chunksCreated: 0, // populated downstream after embedder chunks the text
    p50_ms: percentile(perPageTimings, 50),
    p95_ms: percentile(perPageTimings, 95),
  };

  return {
    source: filename,
    chunksCreated: 0,
    totalChars: text.length,
    telemetry,
    text,
    pages,
  };
}
