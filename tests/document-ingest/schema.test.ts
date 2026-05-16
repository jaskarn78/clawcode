/**
 * Phase 101 Plan 02 T02 — ExtractedTaxReturn schema tests.
 *
 * Exercises `ExtractedTaxReturn.parse()` against the synthetic truth fixture
 * (`tests/fixtures/pon-2024-truth.json`) and asserts the
 * `extractionSchemaVersion: "v1"` literal constraint.
 *
 * The truth fixture currently holds operator-curated SHAPE placeholders (see
 * `_SYNTHETIC_PLACEHOLDER: true` at top); SC-8 is PARTIAL until the operator
 * swaps in real values. Plan 05 owns the live UAT gate.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import {
  ExtractedTaxReturn,
  EXTRACTION_SCHEMAS,
} from "../../src/document-ingest/schemas/index.js";

const TRUTH_FIXTURE_PATH = join(
  process.cwd(),
  "tests/fixtures/pon-2024-truth.json",
);

function loadTruthFixture(): unknown {
  return JSON.parse(readFileSync(TRUTH_FIXTURE_PATH, "utf-8"));
}

describe("T02 ExtractedTaxReturn schema", () => {
  it("parses the operator truth fixture (strips synthetic markers)", () => {
    const raw = loadTruthFixture();
    const parsed = ExtractedTaxReturn.parse(raw);
    expect(parsed.taxYear).toBe(2024);
    expect(parsed.extractionSchemaVersion).toBe("v1");
    expect(Array.isArray(parsed.scheduleC?.expenses)).toBe(true);
  });

  it("rejects missing extractionSchemaVersion", () => {
    const raw = loadTruthFixture() as Record<string, unknown>;
    delete raw.extractionSchemaVersion;
    expect(() => ExtractedTaxReturn.parse(raw)).toThrow();
  });

  it('rejects extractionSchemaVersion === "v2"', () => {
    const raw = loadTruthFixture() as Record<string, unknown>;
    raw.extractionSchemaVersion = "v2";
    expect(() => ExtractedTaxReturn.parse(raw)).toThrow();
  });

  it("exposes EXTRACTION_SCHEMAS.taxReturn", () => {
    expect(EXTRACTION_SCHEMAS.taxReturn).toBe(ExtractedTaxReturn);
  });

  it("schema is convertible to JSON Schema via zod 4 native z.toJSONSchema", () => {
    const json = z.toJSONSchema(ExtractedTaxReturn);
    expect(json).toBeDefined();
    expect(typeof json).toBe("object");
    const props = (json as { properties?: Record<string, unknown> }).properties;
    expect(props).toBeDefined();
    expect(props && "taxYear" in props).toBe(true);
    expect(props && "extractionSchemaVersion" in props).toBe(true);
  });
});
