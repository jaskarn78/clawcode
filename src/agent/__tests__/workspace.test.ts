import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, readFile, lstat, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkspace, createWorkspaces } from "../workspace.js";
import { DEFAULT_SOUL, DEFAULT_IDENTITY_TEMPLATE, renderIdentity } from "../../config/defaults.js";
import type { ResolvedAgentConfig } from "../../shared/types.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clawcode-ws-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeAgent(overrides: Partial<ResolvedAgentConfig> & { workspace: string }): ResolvedAgentConfig {
  return {
    name: "test-agent",
    channels: [],
    model: "sonnet",
    skills: [],
    soul: undefined,
    identity: undefined,
    memory: { compactionThreshold: 0.75, searchTopK: 10, consolidation: { enabled: true, weeklyThreshold: 7, monthlyThreshold: 4 }, decay: { halfLifeDays: 30, semanticWeight: 0.7, decayWeight: 0.3 }, deduplication: { enabled: true, similarityThreshold: 0.85 } },
    schedules: [],
    heartbeat: {
      enabled: true,
      intervalSeconds: 60,
      checkTimeoutSeconds: 10,
      contextFill: {
        warningThreshold: 0.6,
        criticalThreshold: 0.75,
      },
    },
    ...overrides,
  };
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.length = 0;
});

describe("createWorkspace", () => {
  it("creates workspace directory at agent.workspace path", async () => {
    const tmp = await makeTempDir();
    const wsPath = join(tmp, "my-agent");
    const agent = makeAgent({ workspace: wsPath });

    await createWorkspace(agent);

    const stat = await lstat(wsPath);
    expect(stat.isDirectory()).toBe(true);
  });

  it("creates memory/ subdirectory inside workspace", async () => {
    const tmp = await makeTempDir();
    const wsPath = join(tmp, "my-agent");
    const agent = makeAgent({ workspace: wsPath });

    await createWorkspace(agent);

    const stat = await lstat(join(wsPath, "memory"));
    expect(stat.isDirectory()).toBe(true);
  });

  it("creates skills/ subdirectory inside workspace", async () => {
    const tmp = await makeTempDir();
    const wsPath = join(tmp, "my-agent");
    const agent = makeAgent({ workspace: wsPath });

    await createWorkspace(agent);

    const stat = await lstat(join(wsPath, "skills"));
    expect(stat.isDirectory()).toBe(true);
  });

  it("writes SOUL.md with DEFAULT_SOUL content when agent.soul is undefined", async () => {
    const tmp = await makeTempDir();
    const wsPath = join(tmp, "my-agent");
    const agent = makeAgent({ workspace: wsPath, soul: undefined });

    await createWorkspace(agent);

    const content = await readFile(join(wsPath, "SOUL.md"), "utf-8");
    expect(content).toBe(DEFAULT_SOUL);
  });

  it("writes SOUL.md with config-provided inline content when agent.soul is set", async () => {
    const tmp = await makeTempDir();
    const wsPath = join(tmp, "my-agent");
    const customSoul = "# Custom Soul\nBe bold.";
    const agent = makeAgent({ workspace: wsPath, soul: customSoul });

    await createWorkspace(agent);

    const content = await readFile(join(wsPath, "SOUL.md"), "utf-8");
    expect(content).toBe(customSoul);
  });

  it("writes IDENTITY.md with agent name interpolated from DEFAULT_IDENTITY_TEMPLATE when agent.identity is undefined", async () => {
    const tmp = await makeTempDir();
    const wsPath = join(tmp, "my-agent");
    const agent = makeAgent({ workspace: wsPath, name: "researcher", identity: undefined });

    await createWorkspace(agent);

    const content = await readFile(join(wsPath, "IDENTITY.md"), "utf-8");
    const expected = renderIdentity(DEFAULT_IDENTITY_TEMPLATE, "researcher");
    expect(content).toBe(expected);
    expect(content).toContain("researcher");
  });

  it("writes IDENTITY.md with config-provided content when agent.identity is set", async () => {
    const tmp = await makeTempDir();
    const wsPath = join(tmp, "my-agent");
    const customIdentity = "# Custom Identity\nI am special.";
    const agent = makeAgent({ workspace: wsPath, identity: customIdentity });

    await createWorkspace(agent);

    const content = await readFile(join(wsPath, "IDENTITY.md"), "utf-8");
    expect(content).toBe(customIdentity);
  });

  it("does NOT overwrite existing SOUL.md when agent.soul is undefined (idempotency)", async () => {
    const tmp = await makeTempDir();
    const wsPath = join(tmp, "my-agent");
    const agent = makeAgent({ workspace: wsPath, soul: undefined });

    // First run -- creates default SOUL.md
    await createWorkspace(agent);

    // Simulate user editing SOUL.md
    const { writeFile } = await import("node:fs/promises");
    const userContent = "# User edited SOUL\nMy custom soul.";
    await writeFile(join(wsPath, "SOUL.md"), userContent);

    // Second run -- should preserve user edit
    await createWorkspace(agent);

    const content = await readFile(join(wsPath, "SOUL.md"), "utf-8");
    expect(content).toBe(userContent);
  });

  it("DOES overwrite SOUL.md when agent.soul is explicitly set in config (config is source of truth)", async () => {
    const tmp = await makeTempDir();
    const wsPath = join(tmp, "my-agent");

    // First run with default
    const agentDefault = makeAgent({ workspace: wsPath, soul: undefined });
    await createWorkspace(agentDefault);

    // Second run with explicit soul
    const configSoul = "# Config Soul\nFrom config.";
    const agentExplicit = makeAgent({ workspace: wsPath, soul: configSoul });
    await createWorkspace(agentExplicit);

    const content = await readFile(join(wsPath, "SOUL.md"), "utf-8");
    expect(content).toBe(configSoul);
  });

  it("does NOT overwrite existing IDENTITY.md when agent.identity is undefined (idempotency)", async () => {
    const tmp = await makeTempDir();
    const wsPath = join(tmp, "my-agent");
    const agent = makeAgent({ workspace: wsPath, identity: undefined });

    // First run
    await createWorkspace(agent);

    // Simulate user editing
    const { writeFile } = await import("node:fs/promises");
    const userContent = "# My custom identity";
    await writeFile(join(wsPath, "IDENTITY.md"), userContent);

    // Second run -- should preserve
    await createWorkspace(agent);

    const content = await readFile(join(wsPath, "IDENTITY.md"), "utf-8");
    expect(content).toBe(userContent);
  });

  it("returns WorkspaceResult with correct fields", async () => {
    const tmp = await makeTempDir();
    const wsPath = join(tmp, "my-agent");
    const agent = makeAgent({ workspace: wsPath, name: "coder" });

    const result = await createWorkspace(agent);

    expect(result.agentName).toBe("coder");
    expect(result.path).toBe(wsPath);
    expect(result.created).toBe(true);
    expect(result.filesWritten.length).toBeGreaterThan(0);
  });

  it("no symlinks exist in any created workspace", async () => {
    const tmp = await makeTempDir();
    const wsPath = join(tmp, "my-agent");
    const agent = makeAgent({ workspace: wsPath });

    await createWorkspace(agent);

    const filesToCheck = [
      join(wsPath, "SOUL.md"),
      join(wsPath, "IDENTITY.md"),
    ];

    for (const filePath of filesToCheck) {
      const stat = await lstat(filePath);
      expect(stat.isSymbolicLink()).toBe(false);
    }

    // Directories should also not be symlinks
    const dirsToCheck = [wsPath, join(wsPath, "memory"), join(wsPath, "skills")];
    for (const dirPath of dirsToCheck) {
      const stat = await lstat(dirPath);
      expect(stat.isSymbolicLink()).toBe(false);
    }
  });
});

describe("createWorkspaces", () => {
  it("processes multiple agents and returns WorkspaceResult[] for each", async () => {
    const tmp = await makeTempDir();
    const agents: ResolvedAgentConfig[] = [
      makeAgent({ workspace: join(tmp, "agent-a"), name: "agent-a" }),
      makeAgent({ workspace: join(tmp, "agent-b"), name: "agent-b" }),
    ];

    const results = await createWorkspaces(agents);

    expect(results).toHaveLength(2);
    expect(results[0].agentName).toBe("agent-a");
    expect(results[1].agentName).toBe("agent-b");

    // Both workspaces should exist
    await expect(access(join(tmp, "agent-a"))).resolves.toBeUndefined();
    await expect(access(join(tmp, "agent-b"))).resolves.toBeUndefined();
  });

  it("two agent workspaces share no files (different absolute paths)", async () => {
    const tmp = await makeTempDir();
    const agents: ResolvedAgentConfig[] = [
      makeAgent({ workspace: join(tmp, "agent-x"), name: "agent-x" }),
      makeAgent({ workspace: join(tmp, "agent-y"), name: "agent-y" }),
    ];

    const results = await createWorkspaces(agents);

    // Collect all file paths from both workspaces
    const allPathsA = new Set([
      results[0].path,
      join(results[0].path, "SOUL.md"),
      join(results[0].path, "IDENTITY.md"),
      join(results[0].path, "memory"),
      join(results[0].path, "skills"),
    ]);

    const allPathsB = new Set([
      results[1].path,
      join(results[1].path, "SOUL.md"),
      join(results[1].path, "IDENTITY.md"),
      join(results[1].path, "memory"),
      join(results[1].path, "skills"),
    ]);

    // No overlap
    for (const pathA of allPathsA) {
      expect(allPathsB.has(pathA)).toBe(false);
    }
  });
});
