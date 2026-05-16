/**
 * Phase 101 Plan 02 T03 — extractStructured + Mistral stub tests.
 *
 * - Sonnet vs Haiku model selection via `pickExtractionModel`.
 * - tool_choice forces the schemaName at the SDK call.
 * - zod.parse failure throws IngestError with missingFields list.
 * - Mistral stub throws the documented "not yet implemented" error.
 * - OCR dispatcher rejects `backend: 'mistral'` when allowMistralOcr=false.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  extractStructured,
  _setExtractorClientForTests,
  pickExtractionModel,
  EXTRACTOR_MODEL_DEFAULT,
  EXTRACTOR_MODEL_HIGH_PRECISION,
  IngestError,
} from "../../src/document-ingest/extractor.js";
import { ocrPageMistral } from "../../src/document-ingest/ocr/mistral-stub.js";
import {
  ocrPage,
  setAllowMistralOcr,
} from "../../src/document-ingest/ocr/index.js";

const TRUTH_FIXTURE_PATH = join(
  process.cwd(),
  "tests/fixtures/pon-2024-truth.json",
);

function loadTruthFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(TRUTH_FIXTURE_PATH, "utf-8")) as Record<
    string,
    unknown
  >;
}

describe("T03 model selection (D-02)", () => {
  it("picks Haiku by default and Sonnet on high-precision hint", () => {
    expect(pickExtractionModel(undefined)).toBe(EXTRACTOR_MODEL_DEFAULT);
    expect(pickExtractionModel("standard")).toBe(EXTRACTOR_MODEL_DEFAULT);
    expect(pickExtractionModel("high-precision")).toBe(
      EXTRACTOR_MODEL_HIGH_PRECISION,
    );
  });
});

describe("T03 extractStructured — tool-use round trip", () => {
  beforeEach(() => _setExtractorClientForTests(null));
  afterEach(() => _setExtractorClientForTests(null));

  it("issues a tool-use call with tool_choice forced to the schema name", async () => {
    const truth = loadTruthFixture();
    let observed: {
      model: string;
      tools: ReadonlyArray<{ name: string }>;
      tool_choice: { type: string; name: string };
    } | null = null;

    _setExtractorClientForTests({
      messages: {
        create: async (args) => {
          observed = args as unknown as typeof observed;
          return {
            content: [
              {
                type: "tool_use",
                id: "toolu_test",
                name: "taxReturn",
                input: truth,
              },
            ],
          } as unknown as never;
        },
      },
    });

    const result = await extractStructured("dummy doc text", "taxReturn", {
      taskHint: "high-precision",
    });

    expect(observed).not.toBeNull();
    expect(observed?.model).toBe(EXTRACTOR_MODEL_HIGH_PRECISION);
    expect(observed?.tool_choice.type).toBe("tool");
    expect(observed?.tool_choice.name).toBe("taxReturn");
    expect(observed?.tools[0].name).toBe("taxReturn");
    expect(result.extractionSchemaVersion).toBe("v1");
    expect(result.taxYear).toBe(2024);
  });

  it("uses Haiku when taskHint is omitted", async () => {
    const truth = loadTruthFixture();
    let observedModel: string | null = null;
    _setExtractorClientForTests({
      messages: {
        create: async (args) => {
          observedModel = (args as { model: string }).model;
          return {
            content: [
              { type: "tool_use", id: "toolu_test", name: "taxReturn", input: truth },
            ],
          } as unknown as never;
        },
      },
    });
    await extractStructured("dummy", "taxReturn");
    expect(observedModel).toBe(EXTRACTOR_MODEL_DEFAULT);
  });

  it("throws IngestError when the tool result fails zod validation", async () => {
    _setExtractorClientForTests({
      messages: {
        create: async () =>
          ({
            content: [
              {
                type: "tool_use",
                id: "toolu_test",
                name: "taxReturn",
                input: { taxYear: "not-a-number" },
              },
            ],
          }) as unknown as never,
      },
    });

    await expect(
      extractStructured("dummy text", "taxReturn"),
    ).rejects.toThrow(/structured extraction failed/);
  });

  it("attaches missingFields list on parse failure for alerts pipeline (T05)", async () => {
    _setExtractorClientForTests({
      messages: {
        create: async () =>
          ({
            content: [
              {
                type: "tool_use",
                id: "toolu_test",
                name: "taxReturn",
                input: { taxYear: 2024 }, // missing many fields
              },
            ],
          }) as unknown as never,
      },
    });

    try {
      await extractStructured("dummy text", "taxReturn");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(IngestError);
      const missing = (err as IngestError & { missingFields?: readonly string[] })
        .missingFields;
      expect(Array.isArray(missing)).toBe(true);
      expect(missing!.length).toBeGreaterThan(0);
    }
  });

  it("throws when no tool_use block is present in the response", async () => {
    _setExtractorClientForTests({
      messages: {
        create: async () =>
          ({
            content: [{ type: "text", text: "I cannot extract this." }],
          }) as unknown as never,
      },
    });

    await expect(
      extractStructured("dummy text", "taxReturn"),
    ).rejects.toThrow(/no tool_use block/);
  });
});

describe("T03 Mistral OCR stub (D-08)", () => {
  afterEach(() => setAllowMistralOcr(() => false));

  it("throws the documented 'not yet implemented' error", async () => {
    await expect(ocrPageMistral(Buffer.alloc(8))).rejects.toThrow(
      /Mistral OCR backend not yet implemented \(D-08/,
    );
  });

  it("ocrPage rejects backend='mistral' when allowMistralOcr=false (config gate)", async () => {
    setAllowMistralOcr(() => false);
    await expect(
      ocrPage(Buffer.alloc(8), { backend: "mistral" }),
    ).rejects.toThrow(/Mistral OCR backend disabled in config/);
  });

  it("ocrPage routes to the Mistral stub when allowMistralOcr=true (and stub then throws)", async () => {
    setAllowMistralOcr(() => true);
    await expect(
      ocrPage(Buffer.alloc(8), { backend: "mistral" }),
    ).rejects.toThrow(/Mistral OCR backend not yet implemented \(D-08/);
  });
});

// ---------------------------------------------------------------------------
// T04 follow-up — backend threading through the engine entrypoint (advisor fix)
// ---------------------------------------------------------------------------

describe("T04 backend threading: ingest() → ocrPage (D-08 selectability)", () => {
  afterEach(() => setAllowMistralOcr(() => false));

  it("threads backend: 'mistral' through ingest() to ocrPage and rejects when allowMistralOcr=false", async () => {
    // Lazy-import the engine here so the test doesn't pay the cost when
    // the surrounding describe blocks run in isolation.
    const { ingest } = await import("../../src/document-ingest/index.js");
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    setAllowMistralOcr(() => false);

    // Use the existing PNG fixture so the image handler runs and the
    // engine actually invokes ocrPage (text handlers short-circuit before
    // the OCR layer, hiding the backend dispatch).
    const fixturePath = join(
      process.cwd(),
      "tests/fixtures/document-ingest/sample.png",
    );
    const buf = await readFile(fixturePath);

    await expect(
      ingest(buf, "sample.png", { backend: "mistral" }),
    ).rejects.toThrow(/Mistral OCR backend disabled in config/);
  });

  it("threads backend: 'mistral' through ingest() to ocrPage and reaches the stub when allowMistralOcr=true", async () => {
    const { ingest } = await import("../../src/document-ingest/index.js");
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    setAllowMistralOcr(() => true);

    const fixturePath = join(
      process.cwd(),
      "tests/fixtures/document-ingest/sample.png",
    );
    const buf = await readFile(fixturePath);

    await expect(
      ingest(buf, "sample.png", { backend: "mistral" }),
    ).rejects.toThrow(/Mistral OCR backend not yet implemented \(D-08/);
  });
});
