/**
 * Phase 101 document-ingestion engine — public entrypoint.
 *
 * T02 stub: only file-type detection is wired here. Full handler dispatch +
 * OCR + chunk-creation lands in T04 (page-batching) and T05 (embedder
 * cutover at the daemon-side call site).
 */

import { basename } from "node:path";
import { detectDocumentType } from "./detect.js";
import type { IngestOptions, IngestResult, IngestTelemetry } from "./types.js";

export { detectDocumentType } from "./detect.js";
export type {
  DocumentType,
  OcrBackend,
  BatchedPage,
  TaskHint,
  IngestOptions,
  IngestTelemetry,
  IngestResult,
} from "./types.js";
export { logIngest, INGEST_LOG_TAG } from "./telemetry.js";

/**
 * Public engine entrypoint. T02 returns a detect-only stub; later tasks fill
 * in real handler dispatch + telemetry.
 */
export async function ingest(
  buf: Buffer,
  filename: string,
  _opts: IngestOptions = {},
): Promise<IngestResult> {
  const t0 = Date.now();
  const type = await detectDocumentType(buf, filename);
  const slug = basename(filename).replace(/\.[^.]+$/, "") || "document";
  const elapsed = Date.now() - t0;

  const telemetry: IngestTelemetry = {
    docSlug: slug,
    type,
    pages: 0,
    ocrUsed: "none",
    chunksCreated: 0,
    p50_ms: elapsed,
    p95_ms: elapsed,
  };

  return {
    source: filename,
    chunksCreated: 0,
    totalChars: 0,
    telemetry,
  };
}
