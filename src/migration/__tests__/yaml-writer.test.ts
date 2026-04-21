/**
 * Phase 78 Plan 03 Task 1 — yaml-writer unit tests. TDD RED phase.
 *
 * Pins 14 load-bearing behaviors per 78-03-PLAN.md:
 *   1. Atomic temp+rename (tmp path matches /\.clawcode\.yaml\.\d+\.\d+\.tmp$/)
 *   2. Tmp path uniqueness across concurrent invocations (distinct pid segment)
 *   3. Tmp cleanup on rename failure (unlink runs + re-throw)
 *   4. Comment preservation byte-exact (every pre-existing line preserved in order)
 *   5. Top-level key ordering preserved byte-exact
 *   6. New agent entry shape (soulFile/identityFile/mcpServers/model/channels)
 *   7. Chokidar single 'change' event (no partial-write races)
 *   8. Pre-write secret refusal (no rename fires, content unchanged)
 *   9. Unmappable-model gate (refuses without --model-map override)
 *  10. Unmappable-model override (empty warnings = allow)
 *  11. Target sha256 matches independent hash of written bytes
 *  12. Idempotent re-run (same bytes, same sha256)
 *  13. Append-only agents order (existing agents never reordered)
 *  14. Missing existing file → refused with step: "file-not-found"
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import chokidar from "chokidar";
import { parse as parseYaml } from "yaml";
import {
  writeClawcodeYaml,
  writerFs,
  removeAgentFromConfig,
  updateAgentModel,
} from "../yaml-writer.js";
import { SECRET_REFUSE_MESSAGE } from "../guards.js";
import { configSchema } from "../../config/schema.js";
import type { MappedAgentNode, MapAgentWarning } from "../config-mapper.js";

const FIXTURE_PATH =
  "src/migration/__tests__/fixtures/clawcode.before.yaml";

function makeNode(overrides: Partial<MappedAgentNode> = {}): MappedAgentNode {
  return {
    name: "new-one",
    workspace: "/home/u/.clawcode/agents/new-one",
    soulFile: "/home/u/.clawcode/agents/new-one/SOUL.md",
    identityFile: "/home/u/.clawcode/agents/new-one/IDENTITY.md",
    model: "sonnet",
    channels: ["999999999999999999"],
    mcpServers: ["clawcode", "1password"],
    ...overrides,
  };
}

async function setupDestDir(): Promise<{ dir: string; destPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "cc-yaml-writer-"));
  const destPath = join(dir, "clawcode.yaml");
  await copyFile(FIXTURE_PATH, destPath);
  return { dir, destPath };
}

// Snapshot the real fs functions so afterEach can restore the dispatch
// holder after tests that swap them out.
const ORIG_FS = { ...writerFs };

afterEach(async () => {
  vi.restoreAllMocks();
  writerFs.readFile = ORIG_FS.readFile;
  writerFs.writeFile = ORIG_FS.writeFile;
  writerFs.rename = ORIG_FS.rename;
  writerFs.unlink = ORIG_FS.unlink;
});

describe("writeClawcodeYaml — atomic temp+rename (Tests 1-3)", () => {
  it("writes to a tmp file matching /\\.clawcode\\.yaml\\.<pid>\\.<ts>\\.tmp$/ then renames (Test 1)", async () => {
    const { destPath } = await setupDestDir();
    const writeCalls: Array<[string, unknown, unknown]> = [];
    const renameCalls: Array<[string, string]> = [];

    writerFs.writeFile = (async (...args: unknown[]) => {
      writeCalls.push([String(args[0]), args[1], args[2]]);
      return ORIG_FS.writeFile(
        args[0] as Parameters<typeof ORIG_FS.writeFile>[0],
        args[1] as Parameters<typeof ORIG_FS.writeFile>[1],
        args[2] as Parameters<typeof ORIG_FS.writeFile>[2],
      );
    }) as typeof writerFs.writeFile;
    writerFs.rename = (async (...args: unknown[]) => {
      renameCalls.push([String(args[0]), String(args[1])]);
      return ORIG_FS.rename(
        args[0] as Parameters<typeof ORIG_FS.rename>[0],
        args[1] as Parameters<typeof ORIG_FS.rename>[1],
      );
    }) as typeof writerFs.rename;

    const result = await writeClawcodeYaml({
      existingConfigPath: destPath,
      agentsToInsert: [makeNode()],
      modelMapWarnings: [],
      ts: () => "2026-04-20T00:00:00.000Z",
      pid: 1234,
    });

    expect(result.outcome).toBe("written");

    // writeFile was called with a tmp path (not the dest directly)
    const tmpWrite = writeCalls.find((c) =>
      /\.clawcode\.yaml\.\d+\.\d+\.tmp$/.test(c[0]),
    );
    expect(tmpWrite).toBeDefined();
    for (const c of writeCalls) {
      expect(c[0]).not.toBe(destPath);
    }

    // rename was called with (tmpPath, destPath)
    expect(renameCalls.length).toBeGreaterThan(0);
    const r0 = renameCalls[0]!;
    expect(r0[0]).toMatch(/\.clawcode\.yaml\.\d+\.\d+\.tmp$/);
    expect(r0[1]).toBe(destPath);
  });

  it("produces distinct tmp paths for different pid values (Test 2)", async () => {
    const { destPath: destA } = await setupDestDir();
    const { destPath: destB } = await setupDestDir();
    const writeCalls: string[] = [];

    writerFs.writeFile = (async (...args: unknown[]) => {
      writeCalls.push(String(args[0]));
      return ORIG_FS.writeFile(
        args[0] as Parameters<typeof ORIG_FS.writeFile>[0],
        args[1] as Parameters<typeof ORIG_FS.writeFile>[1],
        args[2] as Parameters<typeof ORIG_FS.writeFile>[2],
      );
    }) as typeof writerFs.writeFile;

    await writeClawcodeYaml({
      existingConfigPath: destA,
      agentsToInsert: [makeNode({ name: "a" })],
      modelMapWarnings: [],
      pid: 1234,
    });
    await writeClawcodeYaml({
      existingConfigPath: destB,
      agentsToInsert: [makeNode({ name: "b" })],
      modelMapWarnings: [],
      pid: 5678,
    });

    const tmpTargets = writeCalls.filter((p) =>
      /\.clawcode\.yaml\.\d+\.\d+\.tmp$/.test(p),
    );
    expect(tmpTargets.length).toBeGreaterThanOrEqual(2);
    expect(tmpTargets.some((p) => p.includes(".1234."))).toBe(true);
    expect(tmpTargets.some((p) => p.includes(".5678."))).toBe(true);
  });

  it("unlinks tmp file on rename failure and re-throws (Test 3)", async () => {
    const { destPath } = await setupDestDir();
    let renameCalled = false;
    const unlinkCalls: string[] = [];

    writerFs.rename = (async () => {
      renameCalled = true;
      throw new Error("EACCES: simulated rename failure");
    }) as typeof writerFs.rename;
    writerFs.unlink = (async (...args: unknown[]) => {
      unlinkCalls.push(String(args[0]));
      return ORIG_FS.unlink(
        args[0] as Parameters<typeof ORIG_FS.unlink>[0],
      );
    }) as typeof writerFs.unlink;

    await expect(
      writeClawcodeYaml({
        existingConfigPath: destPath,
        agentsToInsert: [makeNode()],
        modelMapWarnings: [],
        pid: 1234,
      }),
    ).rejects.toThrow(/EACCES/);

    expect(renameCalled).toBe(true);
    const tmpUnlink = unlinkCalls.find((p) =>
      /\.clawcode\.yaml\.\d+\.\d+\.tmp$/.test(p),
    );
    expect(tmpUnlink).toBeDefined();
  });
});

describe("writeClawcodeYaml — comment + key ordering preservation (Tests 4-5)", () => {
  it("preserves every pre-existing line verbatim in order (Test 4)", async () => {
    const { destPath } = await setupDestDir();
    const before = readFileSync(destPath, "utf8");
    const beforeLines = before.split("\n");

    const result = await writeClawcodeYaml({
      existingConfigPath: destPath,
      agentsToInsert: [makeNode()],
      modelMapWarnings: [],
      pid: 1234,
    });
    expect(result.outcome).toBe("written");

    const after = readFileSync(destPath, "utf8");
    const afterLines = after.split("\n");

    // Subsequence check: every pre-existing non-empty line must appear in
    // the after file in the same order. New lines may be inserted.
    let afterIdx = 0;
    for (const beforeLine of beforeLines) {
      if (beforeLine.trim() === "") continue; // skip blanks — yaml lib may collapse
      while (afterIdx < afterLines.length && afterLines[afterIdx] !== beforeLine) {
        afterIdx++;
      }
      expect(
        afterIdx < afterLines.length,
        `pre-existing line dropped or reordered: ${JSON.stringify(beforeLine)}`,
      ).toBe(true);
      afterIdx++;
    }

    // Specific pinned contents
    expect(after).toContain("v2.0 endpoint");
    expect(after).toContain("# op:// reference — safe");
    expect(after).toContain("# operator-edited line");
    expect(after).toContain("op://clawdbot/Finnhub/api-key");
  });

  it("preserves top-level key ordering byte-exact (Test 5)", async () => {
    const { destPath } = await setupDestDir();
    const before = readFileSync(destPath, "utf8");
    const beforeKeys = Object.keys(parseYaml(before) as Record<string, unknown>);

    const result = await writeClawcodeYaml({
      existingConfigPath: destPath,
      agentsToInsert: [makeNode()],
      modelMapWarnings: [],
    });
    expect(result.outcome).toBe("written");

    const after = readFileSync(destPath, "utf8");
    const afterKeys = Object.keys(parseYaml(after) as Record<string, unknown>);

    expect(afterKeys).toEqual(beforeKeys);
  });
});

describe("writeClawcodeYaml — new agent entry shape (Test 6)", () => {
  it("emits soulFile/identityFile/mcpServers/model/channels as YAML keys", async () => {
    const { destPath } = await setupDestDir();
    await writeClawcodeYaml({
      existingConfigPath: destPath,
      agentsToInsert: [makeNode()],
      modelMapWarnings: [],
    });

    const after = readFileSync(destPath, "utf8");
    expect(after).toMatch(/soulFile:/);
    expect(after).toMatch(/identityFile:/);
    expect(after).toMatch(/mcpServers:/);
    expect(after).toMatch(/\bmodel:\s*sonnet/);
    expect(after).toMatch(/channels:/);

    // No inline SOUL/IDENTITY blobs
    expect(after).not.toMatch(/\bsoul: \|/);
    expect(after).not.toMatch(/\bidentity: \|/);

    // Ensure mcpServers includes both auto-inject names
    const parsed = parseYaml(after) as {
      agents: Array<{ name: string; mcpServers: string[] }>;
    };
    const newEntry = parsed.agents.find((a) => a.name === "new-one");
    expect(newEntry).toBeDefined();
    expect(newEntry?.mcpServers).toContain("clawcode");
    expect(newEntry?.mcpServers).toContain("1password");
  });
});

describe("writeClawcodeYaml — chokidar single-event (Test 7)", () => {
  it("produces exactly 1 'change' event on atomic rename", async () => {
    const { destPath } = await setupDestDir();

    // Install chokidar BEFORE the write
    const watcher = chokidar.watch(destPath, {
      awaitWriteFinish: false,
      ignoreInitial: true,
      persistent: true,
    });

    // Wait for watcher to be ready
    await new Promise<void>((resolve) => watcher.on("ready", () => resolve()));

    const events: Array<{ type: string; path: string }> = [];
    watcher.on("add", (p) => events.push({ type: "add", path: p }));
    watcher.on("change", (p) => events.push({ type: "change", path: p }));

    await writeClawcodeYaml({
      existingConfigPath: destPath,
      agentsToInsert: [makeNode()],
      modelMapWarnings: [],
    });

    // Collect events over 500ms
    await new Promise((resolve) => setTimeout(resolve, 500));
    await watcher.close();

    const changeEvents = events.filter((e) => e.type === "change");
    // MUST be exactly 1 'change' event — not 2 (which would indicate
    // a partial-write race).
    expect(changeEvents.length).toBe(1);
  }, 10_000);
});

describe("writeClawcodeYaml — pre-write secret refusal (Test 8)", () => {
  it("refuses write with SECRET_REFUSE_MESSAGE when new node contains secret-shaped value", async () => {
    const { destPath } = await setupDestDir();
    const beforeBytes = readFileSync(destPath, "utf8");
    let renameCalled = false;
    writerFs.rename = (async () => {
      renameCalled = true;
    }) as typeof writerFs.rename;

    const secretNode = makeNode({
      // sk- prefix always refuses per Phase 77 guards
      channels: ["sk-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL"],
    });

    const result = await writeClawcodeYaml({
      existingConfigPath: destPath,
      agentsToInsert: [secretNode],
      modelMapWarnings: [],
    });

    expect(result.outcome).toBe("refused");
    if (result.outcome === "refused") {
      expect(result.reason).toBe(SECRET_REFUSE_MESSAGE);
      expect(result.step).toBe("secret");
    }

    // rename was never called
    expect(renameCalled).toBe(false);
    // dest file byte-identical to before
    const afterBytes = readFileSync(destPath, "utf8");
    expect(afterBytes).toBe(beforeBytes);
  });
});

describe("writeClawcodeYaml — unmappable-model gate (Tests 9-10)", () => {
  it("refuses with step 'unmappable-model' when an unmappable-model warning is present (Test 9)", async () => {
    const { destPath } = await setupDestDir();
    const warnings: MapAgentWarning[] = [
      { kind: "unmappable-model", id: "unknown/thing", agent: "new-one" },
    ];

    const result = await writeClawcodeYaml({
      existingConfigPath: destPath,
      agentsToInsert: [makeNode()],
      modelMapWarnings: warnings,
    });

    expect(result.outcome).toBe("refused");
    if (result.outcome === "refused") {
      expect(result.reason).toMatch(/unmappable model/);
      expect(result.step).toBe("unmappable-model");
    }
  });

  it("proceeds to write when modelMapWarnings is empty (override upstream resolved it) (Test 10)", async () => {
    const { destPath } = await setupDestDir();

    const result = await writeClawcodeYaml({
      existingConfigPath: destPath,
      agentsToInsert: [makeNode()],
      modelMapWarnings: [],
    });

    expect(result.outcome).toBe("written");
  });
});

describe("writeClawcodeYaml — target sha256 + determinism (Tests 11-12)", () => {
  it("returns targetSha256 as 64-char lowercase hex matching file content hash (Test 11)", async () => {
    const { destPath } = await setupDestDir();
    const result = await writeClawcodeYaml({
      existingConfigPath: destPath,
      agentsToInsert: [makeNode()],
      modelMapWarnings: [],
    });
    expect(result.outcome).toBe("written");
    if (result.outcome !== "written") return;

    expect(result.targetSha256).toMatch(/^[a-f0-9]{64}$/);
    const bytes = readFileSync(destPath, "utf8");
    const independentHash = createHash("sha256")
      .update(bytes, "utf8")
      .digest("hex");
    expect(result.targetSha256).toBe(independentHash);
  });

  it("is deterministic — two runs with identical inputs produce same bytes + hash (Test 12)", async () => {
    const { dir: dirA, destPath: destA } = await setupDestDir();
    const { dir: dirB, destPath: destB } = await setupDestDir();

    const r1 = await writeClawcodeYaml({
      existingConfigPath: destA,
      agentsToInsert: [makeNode()],
      modelMapWarnings: [],
    });
    const r2 = await writeClawcodeYaml({
      existingConfigPath: destB,
      agentsToInsert: [makeNode()],
      modelMapWarnings: [],
    });
    expect(r1.outcome).toBe("written");
    expect(r2.outcome).toBe("written");
    if (r1.outcome !== "written" || r2.outcome !== "written") return;

    const bytesA = readFileSync(destA, "utf8");
    const bytesB = readFileSync(destB, "utf8");
    expect(bytesA).toBe(bytesB);
    expect(r1.targetSha256).toBe(r2.targetSha256);

    // Cleanup (dirs used only for hashing comparison)
    void dirA;
    void dirB;
  });
});

describe("writeClawcodeYaml — agents append-only ordering (Test 13)", () => {
  it("appends new agent after existing agents — never reorders (Test 13)", async () => {
    const { destPath } = await setupDestDir();
    await writeClawcodeYaml({
      existingConfigPath: destPath,
      agentsToInsert: [makeNode()],
      modelMapWarnings: [],
    });

    const parsed = parseYaml(readFileSync(destPath, "utf8")) as {
      agents: Array<{ name: string }>;
    };
    const names = parsed.agents.map((a) => a.name);
    expect(names).toEqual(["existing-alpha", "existing-beta", "new-one"]);
  });
});

describe("writeClawcodeYaml — missing existing file (Test 14)", () => {
  it("refuses with step 'file-not-found' when existingConfigPath does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-yaml-noexist-"));
    const missing = join(dir, "does-not-exist.yaml");

    const result = await writeClawcodeYaml({
      existingConfigPath: missing,
      agentsToInsert: [makeNode()],
      modelMapWarnings: [],
    });

    expect(result.outcome).toBe("refused");
    if (result.outcome === "refused") {
      expect(result.reason).toMatch(/not found/i);
      expect(result.step).toBe("file-not-found");
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 81 Plan 01 Task 1 — removeAgentFromConfig extension tests.
// Additive: existing yaml-writer tests above are Phase 78 regression pins
// and remain untouched. These 5 tests land the new export contract.
// ---------------------------------------------------------------------------

describe("removeAgentFromConfig — Phase 81 extension (Tests 19-23)", () => {
  async function setupRemoveFixture(
    yaml: string,
  ): Promise<{ destPath: string }> {
    const dir = await mkdtemp(join(tmpdir(), "cc-yaml-remove-"));
    const destPath = join(dir, "clawcode.yaml");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(destPath, yaml, "utf8");
    return { destPath };
  }

  const THREE_AGENTS_YAML = `version: 1
defaults:
  model: sonnet
  basePath: ~/.clawcode/agents
agents:
  # alpha header comment
  - name: alpha
    workspace: ~/.clawcode/agents/alpha
    model: sonnet
    channels:
      - "111"
    mcpServers: []
  # middle header comment (for victim)
  - name: victim
    workspace: ~/.clawcode/agents/victim
    model: haiku
    channels:
      - "222"
    mcpServers: []
  # beta header comment
  - name: beta
    workspace: ~/.clawcode/agents/beta
    model: sonnet
    channels:
      - "333"
    mcpServers: []
`;

  it("removes the named middle agent — remaining agents + alpha/beta comments preserved (Test 19)", async () => {
    const { destPath } = await setupRemoveFixture(THREE_AGENTS_YAML);
    const result = await removeAgentFromConfig({
      existingConfigPath: destPath,
      agentName: "victim",
    });
    expect(result.outcome).toBe("removed");
    if (result.outcome !== "removed") return;
    expect(result.destPath).toBe(destPath);
    expect(result.targetSha256).toMatch(/^[a-f0-9]{64}$/);

    const after = readFileSync(destPath, "utf8");
    // Agents reparsed — victim gone, other two remain.
    const parsed = parseYaml(after) as { agents: Array<{ name: string }> };
    expect(parsed.agents.map((a) => a.name)).toEqual(["alpha", "beta"]);
    // Comments on surviving agents preserved (yaml lib may rewire the
    // orphan 'middle header comment' onto beta — we only pin survivors).
    expect(after).toContain("# alpha header comment");
    expect(after).toContain("# beta header comment");
    expect(after).not.toContain("name: victim");
  });

  it("returns not-found when agent missing; file bytes unchanged (Test 20)", async () => {
    const { destPath } = await setupRemoveFixture(THREE_AGENTS_YAML);
    const beforeBytes = readFileSync(destPath, "utf8");
    const beforeHash = createHash("sha256")
      .update(beforeBytes, "utf8")
      .digest("hex");

    const result = await removeAgentFromConfig({
      existingConfigPath: destPath,
      agentName: "does-not-exist",
    });
    expect(result.outcome).toBe("not-found");

    const afterBytes = readFileSync(destPath, "utf8");
    const afterHash = createHash("sha256")
      .update(afterBytes, "utf8")
      .digest("hex");
    expect(afterHash).toBe(beforeHash);
  });

  it("returns file-not-found when config path does not exist (Test 21)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-yaml-remove-noexist-"));
    const missing = join(dir, "does-not-exist.yaml");
    const result = await removeAgentFromConfig({
      existingConfigPath: missing,
      agentName: "anyone",
    });
    expect(result.outcome).toBe("file-not-found");
  });

  it("uses atomic temp+rename — tmp path matches .clawcode.yaml.<pid>.<ts>.tmp (Test 22)", async () => {
    const { destPath } = await setupRemoveFixture(THREE_AGENTS_YAML);
    const renameCalls: Array<[string, string]> = [];
    writerFs.rename = (async (...args: unknown[]) => {
      renameCalls.push([String(args[0]), String(args[1])]);
      return ORIG_FS.rename(
        args[0] as Parameters<typeof ORIG_FS.rename>[0],
        args[1] as Parameters<typeof ORIG_FS.rename>[1],
      );
    }) as typeof writerFs.rename;

    await removeAgentFromConfig({
      existingConfigPath: destPath,
      agentName: "victim",
      pid: 4242,
    });

    expect(renameCalls.length).toBeGreaterThan(0);
    expect(renameCalls[0]![0]).toMatch(
      /\.clawcode\.yaml\.4242\.\d+\.tmp$/,
    );
    expect(renameCalls[0]![1]).toBe(destPath);
  });

  it("unlinks tmp file on rename failure and re-throws (Test 23)", async () => {
    const { destPath } = await setupRemoveFixture(THREE_AGENTS_YAML);
    const unlinkCalls: string[] = [];
    writerFs.rename = (async () => {
      throw new Error("EACCES: simulated rename failure");
    }) as typeof writerFs.rename;
    writerFs.unlink = (async (...args: unknown[]) => {
      unlinkCalls.push(String(args[0]));
      return ORIG_FS.unlink(
        args[0] as Parameters<typeof ORIG_FS.unlink>[0],
      );
    }) as typeof writerFs.unlink;

    await expect(
      removeAgentFromConfig({
        existingConfigPath: destPath,
        agentName: "victim",
      }),
    ).rejects.toThrow(/EACCES/);

    const tmpUnlink = unlinkCalls.find((p) =>
      /\.clawcode\.yaml\.\d+\.\d+\.tmp$/.test(p),
    );
    expect(tmpUnlink).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 86 Plan 02 Task 1 — updateAgentModel tests (U1-U8).
// Pins the atomic, comment-preserving, idempotent single-field rewrite for
// agents[*].model used by the daemon IPC set-model handler after the live
// SDK swap succeeds.
// ---------------------------------------------------------------------------

describe("updateAgentModel — Phase 86 Plan 02 (Tests U1-U8)", () => {
  async function setupModelFixture(
    yaml: string,
  ): Promise<{ destPath: string }> {
    const dir = await mkdtemp(join(tmpdir(), "cc-yaml-update-model-"));
    const destPath = join(dir, "clawcode.yaml");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(destPath, yaml, "utf8");
    return { destPath };
  }

  const THREE_AGENTS_YAML = `# fleet comment at top
version: 1
defaults:
  model: sonnet
  basePath: ~/.clawcode/agents
agents:
  # clawdy header comment
  - name: clawdy  # personal
    workspace: ~/.clawcode/agents/clawdy
    model: haiku
    channels:
      - "111"
    mcpServers: []
  - name: alpha
    workspace: ~/.clawcode/agents/alpha
    model: sonnet
    channels:
      - "222"
    mcpServers: []
  - name: beta
    workspace: ~/.clawcode/agents/beta
    model: opus
    channels:
      - "333"
    mcpServers: []
`;

  it("U1: updates clawdy's model from haiku to sonnet; other agents unchanged", async () => {
    const { destPath } = await setupModelFixture(THREE_AGENTS_YAML);
    const result = await updateAgentModel({
      existingConfigPath: destPath,
      agentName: "clawdy",
      newModel: "sonnet",
    });
    expect(result.outcome).toBe("updated");
    if (result.outcome !== "updated") return;
    expect(result.destPath).toBe(destPath);
    expect(result.targetSha256).toMatch(/^[a-f0-9]{64}$/);

    const after = readFileSync(destPath, "utf8");
    const parsed = parseYaml(after) as {
      agents: Array<{ name: string; model: string }>;
    };
    const byName = new Map(parsed.agents.map((a) => [a.name, a.model]));
    expect(byName.get("clawdy")).toBe("sonnet");
    expect(byName.get("alpha")).toBe("sonnet");
    expect(byName.get("beta")).toBe("opus");
  });

  it("U2: idempotent — same model returns no-op; file bytes unchanged", async () => {
    const { destPath } = await setupModelFixture(THREE_AGENTS_YAML);
    const beforeBytes = readFileSync(destPath, "utf8");
    const beforeHash = createHash("sha256")
      .update(beforeBytes, "utf8")
      .digest("hex");

    const result = await updateAgentModel({
      existingConfigPath: destPath,
      agentName: "clawdy",
      newModel: "haiku",
    });
    expect(result.outcome).toBe("no-op");
    if (result.outcome === "no-op") {
      expect(result.reason).toMatch(/already/);
    }

    const afterBytes = readFileSync(destPath, "utf8");
    const afterHash = createHash("sha256")
      .update(afterBytes, "utf8")
      .digest("hex");
    expect(afterHash).toBe(beforeHash);
    expect(afterBytes).toBe(beforeBytes);
  });

  it("U3: preserves top-of-file and inline comments across the rewrite", async () => {
    const { destPath } = await setupModelFixture(THREE_AGENTS_YAML);
    await updateAgentModel({
      existingConfigPath: destPath,
      agentName: "clawdy",
      newModel: "sonnet",
    });

    const after = readFileSync(destPath, "utf8");
    // Top-of-file comment preserved
    expect(after).toContain("# fleet comment at top");
    // Header comment on clawdy preserved
    expect(after).toContain("# clawdy header comment");
    // Inline "# personal" comment on clawdy's name line preserved
    expect(after).toMatch(/name:\s*clawdy\s*#\s*personal/);
  });

  it("U4: agent not found — returns not-found; file bytes unchanged", async () => {
    const { destPath } = await setupModelFixture(THREE_AGENTS_YAML);
    const beforeBytes = readFileSync(destPath, "utf8");
    const beforeHash = createHash("sha256")
      .update(beforeBytes, "utf8")
      .digest("hex");

    const result = await updateAgentModel({
      existingConfigPath: destPath,
      agentName: "does-not-exist",
      newModel: "sonnet",
    });
    expect(result.outcome).toBe("not-found");
    if (result.outcome === "not-found") {
      expect(result.reason).toMatch(/does-not-exist/);
    }

    const afterBytes = readFileSync(destPath, "utf8");
    const afterHash = createHash("sha256")
      .update(afterBytes, "utf8")
      .digest("hex");
    expect(afterHash).toBe(beforeHash);
  });

  it("U5: file missing — returns file-not-found", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-yaml-update-noexist-"));
    const missing = join(dir, "does-not-exist.yaml");
    const result = await updateAgentModel({
      existingConfigPath: missing,
      agentName: "clawdy",
      newModel: "sonnet",
    });
    expect(result.outcome).toBe("file-not-found");
    if (result.outcome === "file-not-found") {
      expect(result.reason).toMatch(/not found/i);
    }
  });

  it("U6: atomic rename failure — unlinks tmp and re-throws", async () => {
    const { destPath } = await setupModelFixture(THREE_AGENTS_YAML);
    const unlinkCalls: string[] = [];
    writerFs.rename = (async () => {
      throw new Error("EACCES: simulated rename failure");
    }) as typeof writerFs.rename;
    writerFs.unlink = (async (...args: unknown[]) => {
      unlinkCalls.push(String(args[0]));
      return ORIG_FS.unlink(
        args[0] as Parameters<typeof ORIG_FS.unlink>[0],
      );
    }) as typeof writerFs.unlink;

    await expect(
      updateAgentModel({
        existingConfigPath: destPath,
        agentName: "clawdy",
        newModel: "sonnet",
      }),
    ).rejects.toThrow(/EACCES/);

    const tmpUnlink = unlinkCalls.find((p) =>
      /\.clawcode\.yaml\.\d+\.\d+\.tmp$/.test(p),
    );
    expect(tmpUnlink).toBeDefined();
  });

  it("U7: round-trip — re-parse after update validates against configSchema", async () => {
    const { destPath } = await setupModelFixture(THREE_AGENTS_YAML);
    const result = await updateAgentModel({
      existingConfigPath: destPath,
      agentName: "clawdy",
      newModel: "sonnet",
    });
    expect(result.outcome).toBe("updated");

    const after = readFileSync(destPath, "utf8");
    // Round-trip: parseYaml → configSchema.safeParse MUST succeed
    const parsed = parseYaml(after) as unknown;
    const schemaResult = configSchema.safeParse(parsed);
    expect(schemaResult.success).toBe(true);
  });

  it("U8: invalid model alias — returns refused with step invalid-model", async () => {
    const { destPath } = await setupModelFixture(THREE_AGENTS_YAML);
    const beforeBytes = readFileSync(destPath, "utf8");

    const result = await updateAgentModel({
      existingConfigPath: destPath,
      agentName: "clawdy",
      newModel: "gpt-4",
    });
    expect(result.outcome).toBe("refused");
    if (result.outcome === "refused") {
      expect(result.step).toBe("invalid-model");
      expect(result.reason).toMatch(/Invalid model/);
    }

    const afterBytes = readFileSync(destPath, "utf8");
    expect(afterBytes).toBe(beforeBytes);
  });
});
