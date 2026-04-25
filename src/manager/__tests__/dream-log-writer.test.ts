import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Phase 95 Plan 02 Task 1 — writeDreamLog atomic markdown emission tests (RED).
 *
 * Pin D-05 contract:
 *   - L1: no prior file → atomic create with header + section; appended=false
 *   - L2: existing same-day file → APPENDS new ## section, preserves prior
 *         content; appended=true
 *   - L3: tmp+rename pattern (file lands on .tmp.<nonce> first then renamed)
 *   - L4: rename failure → tmp file cleanup attempted; error propagates
 *   - L5: renderDreamLogSection matches D-05 specifics verbatim (header
 *         shape, sub-bullets, cost+duration footer)
 *   - L6: dreams subdirectory auto-created via mkdir recursive (deeply nested
 *         memoryRoot)
 *   - L7: timestamps zero-padded UTC HH:MM; date bucket YYYY-MM-DD
 *
 * Module under test does not exist yet — imports fail (RED).
 */

import {
  writeDreamLog,
  renderDreamLogSection,
  type DreamLogEntry,
} from "../dream-log-writer.js";
import type { DreamResult } from "../dream-pass.js";

const SAMPLE_RESULT: DreamResult = {
  newWikilinks: [
    {
      from: "memory/2026-04-25-cutover-fix.md",
      to: "memory/2026-04-22-phase91-deploy.md",
      rationale: "workspace path drift recurring pattern",
    },
  ],
  promotionCandidates: [
    {
      chunkId: "chunk-routing",
      currentPath: "memory/vault/openclaw-routing.md",
      rationale: "Referenced 4 times in last 24h",
      priorityScore: 80,
    },
  ],
  themedReflection:
    "Recent activity centered on cutover verification debugging.",
  suggestedConsolidations: [
    {
      sources: ["memory/a.md", "memory/b.md"],
      newPath: "memory/consolidations/deploy.md",
      rationale: "Same incident; consolidate for clean recall",
    },
  ],
};

function buildEntry(overrides: Partial<DreamLogEntry> = {}): DreamLogEntry {
  return {
    timestamp: overrides.timestamp ?? new Date("2026-04-25T03:07:42.000Z"),
    idleMinutes: overrides.idleMinutes ?? 35,
    model: overrides.model ?? "haiku",
    result: overrides.result ?? SAMPLE_RESULT,
    tokensIn: overrides.tokensIn ?? 12_400,
    tokensOut: overrides.tokensOut ?? 1_800,
    durationMs: overrides.durationMs ?? 4_200,
  };
}

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const d of tmpDirs) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
  tmpDirs.length = 0;
  vi.restoreAllMocks();
});

async function makeTmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dream-log-test-"));
  tmpDirs.push(dir);
  return dir;
}

describe("writeDreamLog — D-05 atomic markdown emission", () => {
  it("L1: no prior file — creates dreams/<date>.md with header + section, appended=false", async () => {
    const memoryRoot = await makeTmp();
    const out = await writeDreamLog({
      agentName: "atlas",
      memoryRoot,
      entry: buildEntry(),
    });
    expect(out.appended).toBe(false);
    expect(out.logPath).toBe(`${memoryRoot}/dreams/2026-04-25.md`);
    const content = await readFile(out.logPath, "utf8");
    expect(content.startsWith("# Dream log — atlas — 2026-04-25\n")).toBe(true);
    expect(content).toContain("## [03:07 UTC] Dream pass");
    expect(content).toContain("Recent activity centered on cutover");
  });

  it("L2: existing same-day file — APPENDS new ## section preserving prior content; appended=true", async () => {
    const memoryRoot = await makeTmp();
    // First pass
    await writeDreamLog({
      agentName: "atlas",
      memoryRoot,
      entry: buildEntry({ timestamp: new Date("2026-04-25T03:07:42.000Z") }),
    });
    // Second pass — same day
    const out = await writeDreamLog({
      agentName: "atlas",
      memoryRoot,
      entry: buildEntry({ timestamp: new Date("2026-04-25T15:30:00.000Z") }),
    });
    expect(out.appended).toBe(true);
    const content = await readFile(out.logPath, "utf8");
    // Both sections present; header only once
    const headerMatches = content.match(/^# Dream log/gm) ?? [];
    expect(headerMatches.length).toBe(1);
    expect(content).toContain("## [03:07 UTC] Dream pass");
    expect(content).toContain("## [15:30 UTC] Dream pass");
    // First section content not destroyed
    expect(content.indexOf("## [03:07 UTC]")).toBeLessThan(
      content.indexOf("## [15:30 UTC]"),
    );
  });

  it("L3: tmp+rename pattern — writeFile lands on a tmp path then rename to final", async () => {
    const memoryRoot = await makeTmp();
    const fsPromises = await import("node:fs/promises");
    const writeFileSpy = vi.spyOn(fsPromises, "writeFile");
    const renameSpy = vi.spyOn(fsPromises, "rename");
    await writeDreamLog({
      agentName: "atlas",
      memoryRoot,
      entry: buildEntry(),
    });
    expect(writeFileSpy).toHaveBeenCalled();
    expect(renameSpy).toHaveBeenCalled();
    const writePath = writeFileSpy.mock.calls[0]![0] as string;
    const renameFromPath = renameSpy.mock.calls[0]![0] as string;
    const renameToPath = renameSpy.mock.calls[0]![1] as string;
    expect(writePath).toContain(".tmp");
    expect(writePath).toBe(renameFromPath);
    expect(renameToPath).toBe(`${memoryRoot}/dreams/2026-04-25.md`);
    expect(renameToPath.includes(".tmp")).toBe(false);
  });

  it("L4: rename failure — tmp file cleanup attempted; error propagated", async () => {
    const memoryRoot = await makeTmp();
    const fsPromises = await import("node:fs/promises");
    const renameSpy = vi
      .spyOn(fsPromises, "rename")
      .mockRejectedValueOnce(new Error("EXDEV: cross-device rename"));
    const unlinkSpy = vi.spyOn(fsPromises, "unlink");
    await expect(
      writeDreamLog({
        agentName: "atlas",
        memoryRoot,
        entry: buildEntry(),
      }),
    ).rejects.toThrow(/EXDEV/);
    expect(renameSpy).toHaveBeenCalledTimes(1);
    expect(unlinkSpy).toHaveBeenCalled();
    const unlinkPath = unlinkSpy.mock.calls[0]![0] as string;
    expect(unlinkPath).toContain(".tmp");
  });

  it("L5: renderDreamLogSection matches D-05 specifics verbatim", () => {
    const md = renderDreamLogSection(buildEntry());
    // Header shape
    expect(md).toMatch(/^## \[03:07 UTC\] Dream pass \(idle 35min, model=haiku\)/);
    // Themed reflection
    expect(md).toContain("**Themed reflection:**");
    expect(md).toContain("Recent activity centered on cutover");
    // New wikilinks section
    expect(md).toContain("**New wikilinks (1):**");
    expect(md).toContain(
      "- memory/2026-04-25-cutover-fix.md → memory/2026-04-22-phase91-deploy.md",
    );
    // Promotion candidates SURFACED
    expect(md).toContain("**Promotion candidates (1):**");
    expect(md).toContain("consider promoting");
    expect(md).toContain("operator review");
    // Suggested consolidations SURFACED
    expect(md).toContain("**Suggested consolidations (1):**");
    expect(md).toContain("memory/a.md+memory/b.md → memory/consolidations/deploy.md");
    // Cost + Duration footer
    expect(md).toContain("**Cost:** 12400 in / 1800 out tokens");
    expect(md).toContain("Duration: 4.2s");
  });

  it("L5b: empty sections render _(none)_", () => {
    const empty: DreamResult = {
      newWikilinks: [],
      promotionCandidates: [],
      themedReflection: "Quiet day.",
      suggestedConsolidations: [],
    };
    const md = renderDreamLogSection(buildEntry({ result: empty }));
    expect(md).toContain("**New wikilinks (0):**");
    expect(md).toContain("**Promotion candidates (0):**");
    expect(md).toContain("**Suggested consolidations (0):**");
    expect(md.match(/_\(none\)_/g)?.length).toBe(3);
  });

  it("L6: dreams subdirectory auto-created via mkdir recursive (deeply nested memoryRoot)", async () => {
    const memoryRoot = join(await makeTmp(), "deep", "nest", "memory");
    // Don't pre-create — writeDreamLog must mkdir -p
    const out = await writeDreamLog({
      agentName: "atlas",
      memoryRoot,
      entry: buildEntry(),
    });
    expect(out.logPath).toBe(`${memoryRoot}/dreams/2026-04-25.md`);
    const content = await readFile(out.logPath, "utf8");
    expect(content).toContain("# Dream log");
  });

  it("L7: HH:MM zero-padded UTC; date bucket YYYY-MM-DD zero-padded", async () => {
    const memoryRoot = await makeTmp();
    // Time with single-digit hour and minute and month/day
    const out = await writeDreamLog({
      agentName: "atlas",
      memoryRoot,
      entry: buildEntry({ timestamp: new Date("2026-01-05T03:07:42.000Z") }),
    });
    expect(out.logPath.endsWith("2026-01-05.md")).toBe(true);
    const content = await readFile(out.logPath, "utf8");
    expect(content).toContain("## [03:07 UTC]");
    expect(content).toContain("# Dream log — atlas — 2026-01-05");
  });
});
