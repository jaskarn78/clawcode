/**
 * Phase 101 Plan 02 T03 — Pon UAT regression test (SC-8 PARTIAL).
 *
 * IMPORTANT: this test runs against the SYNTHETIC truth fixture at
 * `tests/fixtures/pon-2024-truth.json` (see `_SYNTHETIC_PLACEHOLDER: true`
 * at top). The values are shape-correct placeholders only; field-value
 * accuracy is NOT yet validated. SC-8 is PARTIAL until the operator
 * swaps in real values from Pon's 2024 Form 1040 — Plan 05 owns the
 * live UAT gate.
 *
 * What this test validates today:
 *   1. The extractStructured() round-trip succeeds against the truth fixture
 *      (= mocked SDK returns the truth file as `tool_use.input`).
 *   2. The deep-equality comparison helper computes a field-match score and
 *      asserts ≥ 95%. With the synthetic mock-as-truth, the rate is 100% —
 *      that's the "shape-passes, values-pending-operator" baseline. The
 *      comparison helper itself is the load-bearing artifact for SC-8.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  extractStructured,
  _setExtractorClientForTests,
} from "../../src/document-ingest/extractor.js";
import { ExtractedTaxReturn } from "../../src/document-ingest/schemas/index.js";

const TRUTH_FIXTURE_PATH = join(
  process.cwd(),
  "tests/fixtures/pon-2024-truth.json",
);

/**
 * Recursively count leaf nodes (primitives + array entries) and matching
 * leaves between two values. Symmetric in structure: missing keys on either
 * side count as a mismatch. Returns `{ total, matched }`.
 *
 * Compares STRUCTURALLY: scalars by deep-equal, arrays by index-aligned
 * pairwise descent, objects by sorted-key descent. Sufficient for the
 * `ExtractedTaxReturn` shape; not a general-purpose deep-equal.
 */
export function countLeafMatches(
  actual: unknown,
  expected: unknown,
): { total: number; matched: number } {
  // Both null/undefined or both primitive — single leaf.
  const isScalar = (v: unknown) =>
    v === null || v === undefined || typeof v !== "object";
  if (isScalar(actual) && isScalar(expected)) {
    return { total: 1, matched: actual === expected ? 1 : 0 };
  }
  // Type mismatch (one scalar one composite, or array vs object) — single leaf miss.
  if (isScalar(actual) !== isScalar(expected)) {
    return { total: 1, matched: 0 };
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    const len = Math.max(actual.length, expected.length);
    let total = 0;
    let matched = 0;
    for (let i = 0; i < len; i += 1) {
      const sub = countLeafMatches(actual[i], expected[i]);
      total += sub.total;
      matched += sub.matched;
    }
    // Empty arrays are a single equality leaf.
    return total === 0 ? { total: 1, matched: 1 } : { total, matched };
  }
  if (Array.isArray(actual) !== Array.isArray(expected)) {
    return { total: 1, matched: 0 };
  }
  // Both objects — union of keys.
  const aObj = actual as Record<string, unknown>;
  const eObj = expected as Record<string, unknown>;
  const keys = Array.from(
    new Set([...Object.keys(aObj), ...Object.keys(eObj)]),
  ).sort();
  let total = 0;
  let matched = 0;
  for (const k of keys) {
    const sub = countLeafMatches(aObj[k], eObj[k]);
    total += sub.total;
    matched += sub.matched;
  }
  return total === 0 ? { total: 1, matched: 1 } : { total, matched };
}

describe("Pon UAT (SC-8 PARTIAL — synthetic fixture)", () => {
  beforeEach(() => _setExtractorClientForTests(null));
  afterEach(() => _setExtractorClientForTests(null));

  it("countLeafMatches helper computes a per-leaf match score", () => {
    const a = { x: 1, y: { z: 2 } };
    const b = { x: 1, y: { z: 3 } };
    const r = countLeafMatches(a, b);
    expect(r.total).toBe(2);
    expect(r.matched).toBe(1);
  });

  it("countLeafMatches treats missing keys as a mismatch", () => {
    const a = { x: 1 };
    const b = { x: 1, y: 2 };
    const r = countLeafMatches(a, b);
    expect(r.matched).toBe(1);
    expect(r.total).toBe(2);
  });

  it("extractStructured against synthetic truth fixture matches ≥95% (PARTIAL — operator swaps real values for live UAT)", async () => {
    // Parse the fixture through the SAME zod schema the extractor's tool
    // result goes through, so both sides have synthetic `_*` markers
    // stripped and we compare apples-to-apples (advisor recommendation #2).
    const rawTruth = JSON.parse(readFileSync(TRUTH_FIXTURE_PATH, "utf-8"));
    const truth = ExtractedTaxReturn.parse(rawTruth);

    _setExtractorClientForTests({
      messages: {
        create: async () =>
          ({
            content: [
              {
                type: "tool_use",
                id: "toolu_test",
                name: "taxReturn",
                // Mock returns the parsed truth — structural baseline only.
                input: truth,
              },
            ],
          }) as unknown as never,
      },
    });

    const stubText =
      "(synthetic input — fixture-mocked; real OCR text replaces this in Plan 05)";
    const extracted = await extractStructured(stubText, "taxReturn", {
      taskHint: "high-precision",
    });

    const { total, matched } = countLeafMatches(extracted, truth);
    const ratio = matched / total;
    // Synthetic baseline: mock-as-truth → 100%. Threshold of 0.95 holds.
    // Once the operator swaps in real curated values AND the live extraction
    // path runs against the real PDF (Plan 05), this threshold becomes a
    // genuine accuracy gate per SC-8.
    expect(ratio).toBeGreaterThanOrEqual(0.95);
  });
});
