/**
 * Phase 79 Plan 02 — session-archiver unit tests. TDD RED phase.
 *
 * Pins 8 load-bearing behaviors per 79-02-PLAN.md:
 *   1. Happy-path copy — target files byte-identical to source
 *   2. Missing sessions subdir — skip, pass:true, no target subtree
 *   3. Missing source agentDir entirely — skip, pass:true
 *   4. Ledger row on success — step:'session-archive:copy', outcome:'allow',
 *      file_hashes contains ARCHIVE_SESSIONS_SUBDIR → sha256
 *   5. Ledger row on skip — step:'session-archive:skip', outcome:'allow'
 *   6. Nested subdir preservation (recursive copy)
 *   7. mtime preservation (preserveTimestamps)
 *   8. ConversationStore isolation — static grep in module source returns zero
 *      matches (WORK-04 archive-only invariant)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import {
  mkdtemp,
  writeFile,
  mkdir,
  utimes,
  stat,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveOpenclawSessions,
  ARCHIVE_SESSIONS_SUBDIR,
} from "../session-archiver.js";
import { readRows } from "../ledger.js";

describe("session-archiver — Phase 79 Plan 02", () => {
  let tmp: string;
  let sourceAgentDir: string;
  let targetBasePath: string;
  let ledger: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "cc-p79-02-"));
    sourceAgentDir = join(tmp, "agents", "test-agent");
    targetBasePath = join(tmp, "target");
    ledger = join(tmp, "ledger.jsonl");
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("Test 1: happy-path copy — target files byte-identical to source", async () => {
    await mkdir(join(sourceAgentDir, "sessions"), { recursive: true });
    await writeFile(
      join(sourceAgentDir, "sessions", "a.jsonl"),
      "line1\nline2",
    );
    await writeFile(join(sourceAgentDir, "sessions", "b.jsonl"), "x");

    const result = await archiveOpenclawSessions({
      agentId: "test-agent",
      sourceAgentDir,
      targetBasePath,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    expect(result.pass).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.copied).toBe(2);
    const archiveDest = join(targetBasePath, ARCHIVE_SESSIONS_SUBDIR);
    expect(result.archiveDestPath).toBe(archiveDest);
    expect(readFileSync(join(archiveDest, "a.jsonl"), "utf8")).toBe(
      "line1\nline2",
    );
    expect(readFileSync(join(archiveDest, "b.jsonl"), "utf8")).toBe("x");
  });

  it("Test 2: missing sessions subdir — skip gracefully", async () => {
    // sourceAgentDir exists but has no `sessions` subdir — this is the
    // common case for fin-* sub-agents per 79-CONTEXT.
    await mkdir(sourceAgentDir, { recursive: true });

    const result = await archiveOpenclawSessions({
      agentId: "test-agent",
      sourceAgentDir,
      targetBasePath,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    expect(result.pass).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.copied).toBe(0);
    expect(existsSync(join(targetBasePath, ARCHIVE_SESSIONS_SUBDIR))).toBe(
      false,
    );
  });

  it("Test 3: missing source agentDir entirely — skip", async () => {
    // sourceAgentDir never created
    const result = await archiveOpenclawSessions({
      agentId: "test-agent",
      sourceAgentDir,
      targetBasePath,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    expect(result.pass).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.copied).toBe(0);
  });

  it("Test 4: ledger row on success — session-archive:copy with manifest sha256", async () => {
    await mkdir(join(sourceAgentDir, "sessions"), { recursive: true });
    await writeFile(join(sourceAgentDir, "sessions", "a.jsonl"), "content");

    await archiveOpenclawSessions({
      agentId: "test-agent",
      sourceAgentDir,
      targetBasePath,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    const rows = await readRows(ledger);
    const copyRow = rows.find((r) => r.step === "session-archive:copy");
    expect(copyRow).toBeDefined();
    expect(copyRow?.outcome).toBe("allow");
    expect(copyRow?.agent).toBe("test-agent");
    expect(copyRow?.action).toBe("apply");
    expect(copyRow?.file_hashes?.[ARCHIVE_SESSIONS_SUBDIR]).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it("Test 5: ledger row on skip — session-archive:skip with notes", async () => {
    // No source → skip path
    await archiveOpenclawSessions({
      agentId: "test-agent",
      sourceAgentDir,
      targetBasePath,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    const rows = await readRows(ledger);
    const skipRow = rows.find((r) => r.step === "session-archive:skip");
    expect(skipRow).toBeDefined();
    expect(skipRow?.outcome).toBe("allow");
    expect(skipRow?.agent).toBe("test-agent");
    // Skip row should carry a notes field explaining the absence.
    expect(skipRow?.notes).toMatch(/not found|missing|sessions/i);
  });

  it("Test 6: nested session files preserved recursively", async () => {
    const nested = join(sourceAgentDir, "sessions", "2024", "jan");
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, "a.jsonl"), "nested-content");

    const result = await archiveOpenclawSessions({
      agentId: "test-agent",
      sourceAgentDir,
      targetBasePath,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    expect(result.pass).toBe(true);
    const dest = join(
      targetBasePath,
      ARCHIVE_SESSIONS_SUBDIR,
      "2024",
      "jan",
      "a.jsonl",
    );
    expect(readFileSync(dest, "utf8")).toBe("nested-content");
  });

  it("Test 7: mtime preservation (preserveTimestamps)", async () => {
    await mkdir(join(sourceAgentDir, "sessions"), { recursive: true });
    const filePath = join(sourceAgentDir, "sessions", "a.jsonl");
    await writeFile(filePath, "x");
    const mtime = new Date("2020-01-01T00:00:00Z");
    await utimes(filePath, mtime, mtime);

    await archiveOpenclawSessions({
      agentId: "test-agent",
      sourceAgentDir,
      targetBasePath,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    const destStat = await stat(
      join(targetBasePath, ARCHIVE_SESSIONS_SUBDIR, "a.jsonl"),
    );
    expect(Math.abs(destStat.mtime.getTime() - mtime.getTime())).toBeLessThan(
      2000,
    );
  });

  it("Test 8: ConversationStore isolation — static grep invariant", () => {
    // WORK-04 contract: archive-only, no ConversationStore replay. This is
    // pinned at the source-code level via a grep of the module text. A file
    // that does not import or reference ConversationStore cannot accidentally
    // write to it.
    const src = readFileSync(
      "src/migration/session-archiver.ts",
      "utf8",
    );
    expect(src).not.toMatch(/ConversationStore/);
  });
});
