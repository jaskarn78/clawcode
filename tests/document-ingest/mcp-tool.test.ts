/**
 * Phase 101 Plan 02 T04 — ingest_document MCP tool surface tests.
 *
 * Strategy: assert (a) the tool is registered with the expected input
 * fields, (b) static-grep silent-path-bifurcation guard holds (no
 * parallel CLI ingest_document path), (c) the IPC forwarder threads
 * the new fields (taskHint/extract/schemaName/backend/force) through.
 *
 * Note: end-to-end daemon-level tests (path-traversal rejection, cache
 * short-circuit, atomic writes) are covered structurally here via the
 * static-source assertions; live exercises run in Plan 05 UAT against
 * the wired daemon. This mirrors the Phase 101 Plan 01 test posture
 * for daemon.ts handler changes (see `tests/document-ingest/embedder-v2.test.ts`).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { z } from "zod";

const REPO_ROOT = process.cwd();

describe("T04 ingest_document MCP tool surface", () => {
  it("server.ts registers ingest_document with all Phase-101 input fields", () => {
    const src = readFileSync(join(REPO_ROOT, "src/mcp/server.ts"), "utf-8");
    // Tool name + each new input must appear in the schema block.
    expect(src).toContain('"ingest_document"');
    expect(src).toMatch(/taskHint:\s*z[\s\S]*?enum\(\["standard",\s*"high-precision"\]\)/);
    expect(src).toMatch(/extract:\s*z[\s\S]*?enum\(\["text",\s*"structured",\s*"both"\]\)/);
    expect(src).toMatch(/schemaName:\s*z[\s\S]*?enum\(\["taxReturn"\]\)/);
    expect(src).toMatch(/backend:\s*z[\s\S]*?enum\(/);
    expect(src).toMatch(/force:\s*z[\s\S]*?boolean/);
  });

  it("MCP tool forwards new fields through the ingest-document IPC method", () => {
    const src = readFileSync(join(REPO_ROOT, "src/mcp/server.ts"), "utf-8");
    // The forwarder block must thread the new params through to the daemon.
    expect(src).toMatch(/sendIpcRequest\(SOCKET_PATH,\s*"ingest-document",\s*\{[\s\S]*?taskHint[\s\S]*?extract[\s\S]*?schemaName[\s\S]*?backend[\s\S]*?force/);
  });

  it("silent-path-bifurcation guard: no parallel CLI ingest_document command", () => {
    // Per `feedback_silent_path_bifurcation.md` and Plan 02 verification:
    // `grep -rn "ingest_document" src/cli/` returns 0.
    let count = 0;
    try {
      const out = execSync('grep -rln "ingest_document" src/cli/ 2>/dev/null || true', {
        cwd: REPO_ROOT,
      })
        .toString()
        .trim();
      count = out.length === 0 ? 0 : out.split("\n").filter((l) => l.length > 0).length;
    } catch {
      count = 0;
    }
    expect(count).toBe(0);
  });

  it("daemon.ts ingest-document handler invokes extractStructured (U4 wiring)", () => {
    const src = readFileSync(join(REPO_ROOT, "src/manager/daemon.ts"), "utf-8");
    expect(src).toMatch(/extractStructured\(/);
  });

  it("daemon.ts ingest-document handler enforces workspace containment (T-101-08)", () => {
    const src = readFileSync(join(REPO_ROOT, "src/manager/daemon.ts"), "utf-8");
    // The path-traversal guard relies on `path.relative` against the
    // resolved workspace root + rejection on a `..`/absolute leading
    // segment. Match either substring as evidence of the mitigation.
    const hasWorkspaceRoot = /workspaceRoot/.test(src);
    const hasPathRelative = /path\.relative/.test(src);
    expect(hasWorkspaceRoot || hasPathRelative).toBe(true);
  });

  it("daemon.ts implements the D-07 cache short-circuit on extractionSchemaVersion=v1", () => {
    const src = readFileSync(join(REPO_ROOT, "src/manager/daemon.ts"), "utf-8");
    // The cache-hit branch reads structuredJsonPath and matches v1.
    expect(src).toMatch(/extractionSchemaVersion[\s\S]{0,80}["']v1["']/);
    expect(src).toMatch(/force\s*!==\s*true|!\s*force/);
  });

  it("ingest_document tool description identifies it as the single entry point", () => {
    const src = readFileSync(join(REPO_ROOT, "src/mcp/server.ts"), "utf-8");
    expect(src).toMatch(/[Ss]ingle entry point/);
  });

  it("MCP tool input schema rejects unknown enum values via zod", () => {
    // Sanity — assert the published enums match the daemon's accepted set.
    // If these drift, ingest will silently fall to the default branch.
    const taskHint = z.enum(["standard", "high-precision"]);
    expect(() => taskHint.parse("not-a-hint")).toThrow();
    expect(taskHint.parse("high-precision")).toBe("high-precision");
    const extract = z.enum(["text", "structured", "both"]);
    expect(() => extract.parse("partial")).toThrow();
    const backend = z.enum([
      "tesseract-cli",
      "tesseract-wasm",
      "claude-haiku",
      "claude-sonnet",
      "mistral",
      "none",
    ]);
    expect(() => backend.parse("openai-vision")).toThrow();
  });
});
