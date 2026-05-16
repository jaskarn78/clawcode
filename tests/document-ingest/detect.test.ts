/**
 * Phase 101 T02 — file-type detection (one test per DocumentType branch).
 *
 * Fixtures committed at tests/fixtures/document-ingest/. The text-PDF and
 * scanned-PDF fixtures are hand-crafted at ~600B / ~4.5KB respectively so
 * they live in-repo without bloating git history.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectDocumentType } from "../../src/document-ingest/detect.js";
import { ingest } from "../../src/document-ingest/index.js";

const FIXTURES = join(__dirname, "..", "fixtures", "document-ingest");

function load(name: string): Buffer {
  return readFileSync(join(FIXTURES, name));
}

describe("phase101 detectDocumentType", () => {
  it("classifies a PDF with a text layer as 'text-pdf'", async () => {
    const buf = load("sample-text.pdf");
    expect(await detectDocumentType(buf, "sample-text.pdf")).toBe("text-pdf");
  });

  it("classifies a PDF with no text layer as 'scanned-pdf'", async () => {
    const buf = load("sample-scanned.pdf");
    expect(await detectDocumentType(buf, "sample-scanned.pdf")).toBe(
      "scanned-pdf",
    );
  });

  it("classifies a .docx by ZIP-magic + filename as 'docx'", async () => {
    const buf = load("sample.docx");
    expect(await detectDocumentType(buf, "sample.docx")).toBe("docx");
  });

  it("classifies a .xlsx by ZIP-magic + filename as 'xlsx'", async () => {
    const buf = load("sample.xlsx");
    expect(await detectDocumentType(buf, "sample.xlsx")).toBe("xlsx");
  });

  it("classifies a PNG by magic-byte as 'image'", async () => {
    const buf = load("sample.png");
    expect(await detectDocumentType(buf, "sample.png")).toBe("image");
  });

  it("classifies a plain-text buffer as 'text'", async () => {
    const buf = Buffer.from("just plain ascii text here\nnothing fancy.\n");
    expect(await detectDocumentType(buf, "notes.txt")).toBe("text");
  });

  it("ingest() stub returns detected type in telemetry", async () => {
    const buf = load("sample-text.pdf");
    const result = await ingest(buf, "sample-text.pdf");
    expect(result.telemetry.type).toBe("text-pdf");
    expect(result.telemetry.docSlug).toBe("sample-text");
    expect(result.source).toBe("sample-text.pdf");
  });
});
