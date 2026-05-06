/**
 * Phase 110 Stage 0b — schema enum widening tests for
 * `defaults.shimRuntime.{search,image,browser}`.
 *
 * Stage 0a shipped the dial as `["node"]` (single-value enum, default
 * "node"). Stage 0b widens it to `["node","static","python"]` while
 * keeping the default at "node" so existing operator config is byte-
 * identical until they explicitly flip a flag.
 *
 * These tests pin the post-widen enum shape so a future contributor
 * who narrows the enum (e.g. drops "python") gets a CI signal before
 * landing the change.
 *
 * Crash-fallback policy (LOCKED, see CONTEXT.md): if a "static" spawn
 * fails, the loader fails loud — does NOT auto-fall-back to "node".
 * Encoded by absence elsewhere; this file just pins the schema contract.
 */
import { describe, it, expect } from "vitest";
import { defaultsSchema } from "../schema.js";

describe("defaults.shimRuntime — Phase 110 Stage 0b enum widen", () => {
  it("accepts `node` (preserved default) for all three sub-fields", () => {
    const parsed = defaultsSchema.parse({
      shimRuntime: { search: "node", image: "node", browser: "node" },
    });
    expect(parsed.shimRuntime).toEqual({
      search: "node",
      image: "node",
      browser: "node",
    });
  });

  it("accepts `static` (new in Stage 0b) for the search sub-field", () => {
    const parsed = defaultsSchema.parse({
      shimRuntime: { search: "static" },
    });
    expect(parsed.shimRuntime?.search).toBe("static");
  });

  it("accepts `python` (reserved in Stage 0b) for the browser sub-field", () => {
    const parsed = defaultsSchema.parse({
      shimRuntime: { browser: "python" },
    });
    expect(parsed.shimRuntime?.browser).toBe("python");
  });

  it("rejects an unknown runtime value (e.g. `rust`) for the search sub-field", () => {
    expect(() =>
      defaultsSchema.parse({ shimRuntime: { search: "rust" } }),
    ).toThrow();
  });

  it("yields undefined when shimRuntime is omitted entirely AND `node` per-type when sub-field omitted", () => {
    // Whole-block omission: undefined (the parent .optional() applies).
    const parsedAbsent = defaultsSchema.parse({});
    expect(parsedAbsent.shimRuntime).toBeUndefined();

    // Per-type omission: empty object yields all-`node` defaults.
    const parsedEmpty = defaultsSchema.parse({ shimRuntime: {} });
    expect(parsedEmpty.shimRuntime).toEqual({
      search: "node",
      image: "node",
      browser: "node",
    });
  });

  it("supports per-type independence — three different runtimes in one block", () => {
    const parsed = defaultsSchema.parse({
      shimRuntime: {
        search: "static",
        image: "node",
        browser: "python",
      },
    });
    expect(parsed.shimRuntime).toEqual({
      search: "static",
      image: "node",
      browser: "python",
    });
  });
});
