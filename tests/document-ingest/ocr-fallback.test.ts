/**
 * Phase 101 T03 — OCR fallback chain tests.
 *
 * Mocks each tier (`tesseract-cli`, `tesseract-wasm`, `claude-vision`) via
 * vi.mock and asserts the orchestrator transitions through them per the
 * D-01 ladder. No live API calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock each tier BEFORE importing the orchestrator. vi.mock is hoisted.
vi.mock("../../src/document-ingest/ocr/tesseract-cli.js", () => ({
  ocrPageTesseract: vi.fn(),
}));
vi.mock("../../src/document-ingest/ocr/tesseract-wasm.js", () => ({
  ocrPageTesseractWasm: vi.fn(),
}));
vi.mock("../../src/document-ingest/ocr/claude-vision.js", () => ({
  ocrPageClaudeVision: vi.fn(),
  pickVisionModel: (hint?: string) =>
    hint === "high-precision" ? "claude-sonnet-4-5" : "claude-haiku-4-5",
}));

import { ocrPage } from "../../src/document-ingest/ocr/index.js";
import { ocrPageTesseract } from "../../src/document-ingest/ocr/tesseract-cli.js";
import { ocrPageTesseractWasm } from "../../src/document-ingest/ocr/tesseract-wasm.js";
import { ocrPageClaudeVision } from "../../src/document-ingest/ocr/claude-vision.js";

const fakeImage = Buffer.from("fake-png-bytes");

const mockCli = ocrPageTesseract as unknown as ReturnType<typeof vi.fn>;
const mockWasm = ocrPageTesseractWasm as unknown as ReturnType<typeof vi.fn>;
const mockVision = ocrPageClaudeVision as unknown as ReturnType<typeof vi.fn>;

describe("phase101 ocrPage fallback chain", () => {
  beforeEach(() => {
    mockCli.mockReset();
    mockWasm.mockReset();
    mockVision.mockReset();
  });

  it("returns Tesseract CLI result when confidence ≥ threshold (cli-ok)", async () => {
    mockCli.mockResolvedValue({
      text: "tax return page 1 content",
      confidence: 0.92,
      backend: "tesseract-cli",
    });
    const r = await ocrPage(fakeImage);
    expect(r.backend).toBe("tesseract-cli");
    expect(r.text).toContain("tax return");
    expect(mockWasm).not.toHaveBeenCalled();
    expect(mockVision).not.toHaveBeenCalled();
  });

  it("falls through CLI → WASM when CLI confidence below threshold (cli-low→wasm)", async () => {
    mockCli.mockResolvedValue({
      text: "g4rb4ge",
      confidence: 0.4,
      backend: "tesseract-cli",
    });
    mockWasm.mockResolvedValue({
      text: "clean wasm transcription",
      confidence: 0.88,
      backend: "tesseract-wasm",
    });
    const r = await ocrPage(fakeImage);
    expect(r.backend).toBe("tesseract-wasm");
    expect(mockWasm).toHaveBeenCalledOnce();
    expect(mockVision).not.toHaveBeenCalled();
  });

  it("falls through WASM → Claude vision (Haiku default) (wasm-low→haiku)", async () => {
    mockCli.mockResolvedValue({
      text: "",
      confidence: 0,
      backend: "tesseract-cli",
    });
    mockWasm.mockResolvedValue({
      text: "still bad",
      confidence: 0.3,
      backend: "tesseract-wasm",
    });
    mockVision.mockResolvedValue({
      text: "vision-extracted text",
      confidence: 1,
      backend: "claude-haiku",
    });
    const r = await ocrPage(fakeImage);
    expect(r.backend).toBe("claude-haiku");
    expect(mockVision).toHaveBeenCalledOnce();
    expect(mockVision.mock.calls[0][1]).toEqual({
      taskHint: undefined,
      signal: undefined,
    });
  });

  it("escalates to claude-sonnet on taskHint='high-precision' (taskHint→sonnet)", async () => {
    mockCli.mockResolvedValue({
      text: "",
      confidence: 0,
      backend: "tesseract-cli",
    });
    mockWasm.mockResolvedValue({
      text: "",
      confidence: 0,
      backend: "tesseract-wasm",
    });
    mockVision.mockResolvedValue({
      text: "high-precision transcription with table",
      confidence: 1,
      backend: "claude-sonnet",
    });
    const r = await ocrPage(fakeImage, { taskHint: "high-precision" });
    expect(r.backend).toBe("claude-sonnet");
    expect(mockVision).toHaveBeenCalledOnce();
    expect(mockVision.mock.calls[0][1]).toMatchObject({
      taskHint: "high-precision",
    });
  });

  it("propagates CLI thrown error to WASM tier (CLI binary missing)", async () => {
    mockCli.mockRejectedValue(new Error("tesseract: command not found"));
    mockWasm.mockResolvedValue({
      text: "wasm rescued the day",
      confidence: 0.91,
      backend: "tesseract-wasm",
    });
    const r = await ocrPage(fakeImage);
    expect(r.backend).toBe("tesseract-wasm");
  });
});

describe("phase101 claude-vision model selection (D-02)", () => {
  it("uses claude-haiku-4-5 by default", async () => {
    // Reset mocks and re-import the (real, not mocked) pickVisionModel via
    // dynamic import — the file-level vi.mock above replaces only the
    // ocrPageClaudeVision function but keeps pickVisionModel for grep
    // visibility.
    const mod = await import(
      "../../src/document-ingest/ocr/claude-vision.js"
    );
    expect(mod.pickVisionModel(undefined)).toBe("claude-haiku-4-5");
    expect(mod.pickVisionModel("standard")).toBe("claude-haiku-4-5");
  });
  it("uses claude-sonnet-4-5 on high-precision", async () => {
    const mod = await import(
      "../../src/document-ingest/ocr/claude-vision.js"
    );
    expect(mod.pickVisionModel("high-precision")).toBe("claude-sonnet-4-5");
  });
});
