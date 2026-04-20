/**
 * Phase 81 Plan 01 Task 1 — verifier.ts unit tests.
 *
 * Pins all 4 check-status combinations, the offline-env override, and the
 * exit-code helper. 18 tests total; removeAgentFromConfig extension tests
 * live in yaml-writer.test.ts (colocated with Phase 78 writer tests).
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  verifyAgent,
  computeVerifyExitCode,
  verifierFetch,
  REQUIRED_WORKSPACE_FILES,
  DISCORD_CHANNEL_URL_PREFIX,
} from "../verifier.js";
import { MemoryStore } from "../../memory/store.js";

const ORIG_FETCH = verifierFetch.fetch;

afterEach(() => {
  verifierFetch.fetch = ORIG_FETCH;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function stageTargetWorkspace(
  dir: string,
  opts: { omit?: readonly string[] } = {},
): Promise<void> {
  const omit = new Set(opts.omit ?? []);
  await mkdir(dir, { recursive: true });
  for (const f of REQUIRED_WORKSPACE_FILES) {
    if (omit.has(f)) continue;
    await writeFile(join(dir, f), `# ${f}\n`, "utf8");
  }
}

async function stageClawcodeYaml(
  configPath: string,
  args: {
    readonly agentName: string;
    readonly workspace: string;
    readonly channels?: readonly string[];
    readonly model?: "sonnet" | "opus" | "haiku";
    readonly soulFile?: string;
    readonly identityFile?: string;
    readonly memoryPath?: string;
    readonly extraAgents?: readonly {
      readonly name: string;
      readonly workspace: string;
    }[];
  },
): Promise<void> {
  const agentEntries: string[] = [];
  agentEntries.push(`  - name: ${args.agentName}`);
  agentEntries.push(`    workspace: ${args.workspace}`);
  if (args.soulFile) {
    agentEntries.push(`    soulFile: ${args.soulFile}`);
  }
  if (args.identityFile) {
    agentEntries.push(`    identityFile: ${args.identityFile}`);
  }
  if (args.memoryPath) {
    agentEntries.push(`    memoryPath: ${args.memoryPath}`);
  }
  agentEntries.push(`    model: ${args.model ?? "sonnet"}`);
  agentEntries.push(`    channels:`);
  for (const c of args.channels ?? ["999999999999999999"]) {
    agentEntries.push(`      - "${c}"`);
  }
  agentEntries.push(`    mcpServers: []`);
  for (const extra of args.extraAgents ?? []) {
    agentEntries.push(`  - name: ${extra.name}`);
    agentEntries.push(`    workspace: ${extra.workspace}`);
    agentEntries.push(`    model: sonnet`);
    agentEntries.push(`    channels:`);
    agentEntries.push(`      - "888888888888888888"`);
    agentEntries.push(`    mcpServers: []`);
  }
  const text = `version: 1
defaults:
  model: sonnet
  basePath: ~/.clawcode/agents
agents:
${agentEntries.join("\n")}
`;
  await writeFile(configPath, text, "utf8");
}

function randomEmbedding(): Float32Array {
  const vec = new Float32Array(384);
  for (let i = 0; i < 384; i++) vec[i] = Math.random();
  return vec;
}

async function stageSourceMarkdown(
  dir: string,
  agentId: string,
  sectionCount: number,
): Promise<void> {
  // MEMORY.md with N-1 H2 sections + 1 intro section (so total = N)
  // H2-splitter always emits an intro section + one per H2 heading.
  await mkdir(dir, { recursive: true });
  const parts: string[] = ["# Intro\n", "Intro content.\n\n"];
  for (let i = 1; i < sectionCount; i++) {
    parts.push(`## Section ${i}\n`);
    parts.push(`Content ${i}\n\n`);
  }
  await writeFile(join(dir, "MEMORY.md"), parts.join(""), "utf8");
  void agentId;
}

async function insertMemoryRows(
  dbPath: string,
  agentName: string,
  count: number,
): Promise<void> {
  const store = new MemoryStore(dbPath);
  try {
    for (let i = 0; i < count; i++) {
      store.insert(
        {
          content: `m${i}`,
          source: "manual",
          origin_id: `openclaw:${agentName}:${i.toString().padStart(8, "0")}`,
          skipDedup: true,
        },
        randomEmbedding(),
      );
    }
  } finally {
    store.close();
  }
}

async function setupHappyFixture(): Promise<{
  readonly dir: string;
  readonly configPath: string;
  readonly workspace: string;
  readonly openclawRoot: string;
  readonly openclawMemoryDir: string;
  readonly agentName: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "cc-verifier-"));
  const openclawRoot = join(dir, "openclaw");
  const openclawMemoryDir = join(openclawRoot, "memory");
  const workspace = join(dir, "target", "alpha");
  const configPath = join(dir, "clawcode.yaml");
  const agentName = "alpha";

  await stageTargetWorkspace(workspace);
  await stageClawcodeYaml(configPath, { agentName, workspace });
  // source MEMORY.md: 4 sections (so source count = 4 from H2 splitter =
  // 1 intro + 3 H2)
  const srcWorkspace = join(openclawRoot, `workspace-${agentName}`);
  await stageSourceMarkdown(srcWorkspace, agentName, 4);
  // target memories.db: 4 rows (match)
  const dbDir = join(workspace, "memory");
  await mkdir(dbDir, { recursive: true });
  await insertMemoryRows(join(dbDir, "memories.db"), agentName, 4);

  return {
    dir,
    configPath,
    workspace,
    openclawRoot,
    openclawMemoryDir,
    agentName,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("verifier — workspace-files-present check (Tests 1-2)", () => {
  it("all 6 files present → pass (Test 1)", async () => {
    const fx = await setupHappyFixture();
    const results = await verifyAgent({
      agentName: fx.agentName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      offline: true,
    });
    const r = results.find((r) => r.check === "workspace-files-present");
    expect(r).toBeDefined();
    expect(r!.status).toBe("pass");
    expect(r!.detail).toContain("6");
  });

  it("missing MEMORY.md → fail with filename in detail (Test 2)", async () => {
    const fx = await setupHappyFixture();
    // Delete MEMORY.md from the workspace — setupHappyFixture already staged
    // all 6 files; stageTargetWorkspace is additive (won't remove existing).
    const { rm } = await import("node:fs/promises");
    await rm(join(fx.workspace, "MEMORY.md"));
    const results = await verifyAgent({
      agentName: fx.agentName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      offline: true,
    });
    const r = results.find((r) => r.check === "workspace-files-present");
    expect(r).toBeDefined();
    expect(r!.status).toBe("fail");
    expect(r!.detail).toContain("MEMORY.md");
  });
});

describe("verifier — memory-count check (Tests 3-5)", () => {
  it("within ±5% → pass (Test 3)", async () => {
    const fx = await setupHappyFixture();
    // Happy fixture: source=4, migrated=4 → 0% drift
    const results = await verifyAgent({
      agentName: fx.agentName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      offline: true,
    });
    const r = results.find((r) => r.check === "memory-count");
    expect(r).toBeDefined();
    expect(r!.status).toBe("pass");
  });

  it("outside ±5% → fail with source + migrated counts in detail (Test 4)", async () => {
    const fx = await setupHappyFixture();
    // Source is 4 from happy fixture; blow up migrated to 6 (50% drift)
    const dbPath = join(fx.workspace, "memory", "memories.db");
    await insertMemoryRows(dbPath, fx.agentName, 6);
    // insertMemoryRows re-inserts rows 0-5; the first 4 collide with existing
    // rows (same origin_id) and are skipped; rows 4 and 5 are new. Total = 6.
    const results = await verifyAgent({
      agentName: fx.agentName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      offline: true,
    });
    const r = results.find((r) => r.check === "memory-count");
    expect(r).toBeDefined();
    expect(r!.status).toBe("fail");
    expect(r!.detail).toContain("source=4");
    expect(r!.detail).toContain("migrated=6");
  });

  it("exactly at 5% boundary → pass (Test 5)", async () => {
    // source=20 sections, migrated=19 → drift = 1/20 = 0.05 exact
    const dir = await mkdtemp(join(tmpdir(), "cc-verifier-boundary-"));
    const openclawRoot = join(dir, "openclaw");
    const openclawMemoryDir = join(openclawRoot, "memory");
    const workspace = join(dir, "target", "beta");
    const configPath = join(dir, "clawcode.yaml");
    const agentName = "beta";
    await stageTargetWorkspace(workspace);
    await stageClawcodeYaml(configPath, { agentName, workspace });
    const srcWorkspace = join(openclawRoot, `workspace-${agentName}`);
    await stageSourceMarkdown(srcWorkspace, agentName, 20);
    const dbDir = join(workspace, "memory");
    await mkdir(dbDir, { recursive: true });
    await insertMemoryRows(join(dbDir, "memories.db"), agentName, 19);

    const results = await verifyAgent({
      agentName,
      clawcodeConfigPath: configPath,
      openclawRoot,
      openclawMemoryDir,
      offline: true,
    });
    const r = results.find((r) => r.check === "memory-count");
    expect(r).toBeDefined();
    expect(r!.status).toBe("pass");
  });
});

describe("verifier — discord-reachable check (Tests 6-10)", () => {
  let fx: Awaited<ReturnType<typeof setupHappyFixture>>;
  beforeEach(async () => {
    fx = await setupHappyFixture();
  });

  it("200 → pass (Test 6)", async () => {
    verifierFetch.fetch = (async () =>
      new Response("", { status: 200 })) as typeof fetch;
    const results = await verifyAgent({
      agentName: fx.agentName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      discordToken: "test-token",
    });
    const r = results.find((r) => r.check === "discord-reachable");
    expect(r).toBeDefined();
    expect(r!.status).toBe("pass");
  });

  it("403 → fail with status code in detail (Test 7)", async () => {
    verifierFetch.fetch = (async () =>
      new Response("", { status: 403 })) as typeof fetch;
    const results = await verifyAgent({
      agentName: fx.agentName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      discordToken: "test-token",
    });
    const r = results.find((r) => r.check === "discord-reachable");
    expect(r).toBeDefined();
    expect(r!.status).toBe("fail");
    expect(r!.detail).toContain("403");
  });

  it("no token → skip + fetch NOT called (Test 8)", async () => {
    let fetchCalled = false;
    verifierFetch.fetch = (async () => {
      fetchCalled = true;
      return new Response("", { status: 200 });
    }) as typeof fetch;
    const results = await verifyAgent({
      agentName: fx.agentName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      // no discordToken
    });
    const r = results.find((r) => r.check === "discord-reachable");
    expect(r).toBeDefined();
    expect(r!.status).toBe("skip");
    expect(r!.detail).toContain("CLAWCODE_DISCORD_TOKEN absent");
    expect(fetchCalled).toBe(false);
  });

  it("offline mode → skip even with token (Test 9)", async () => {
    let fetchCalled = false;
    verifierFetch.fetch = (async () => {
      fetchCalled = true;
      return new Response("", { status: 200 });
    }) as typeof fetch;
    const results = await verifyAgent({
      agentName: fx.agentName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      discordToken: "test-token",
      offline: true,
    });
    const r = results.find((r) => r.check === "discord-reachable");
    expect(r).toBeDefined();
    expect(r!.status).toBe("skip");
    expect(r!.detail).toContain("offline");
    expect(fetchCalled).toBe(false);
  });

  it("multiple channels — any 200 wins (Test 10)", async () => {
    // Re-stage config with 2 channels
    await stageClawcodeYaml(fx.configPath, {
      agentName: fx.agentName,
      workspace: fx.workspace,
      channels: ["111", "222"],
    });
    let call = 0;
    verifierFetch.fetch = (async () => {
      call++;
      if (call === 1) return new Response("", { status: 403 });
      return new Response("", { status: 200 });
    }) as typeof fetch;
    const results = await verifyAgent({
      agentName: fx.agentName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      discordToken: "test-token",
    });
    const r = results.find((r) => r.check === "discord-reachable");
    expect(r).toBeDefined();
    expect(r!.status).toBe("pass");
    expect(r!.detail).toContain("200");
  });
});

describe("verifier — daemon-parse check (Tests 11-13)", () => {
  it("loadConfig + resolveAllAgents succeed → pass (Test 11)", async () => {
    const fx = await setupHappyFixture();
    const results = await verifyAgent({
      agentName: fx.agentName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      offline: true,
    });
    const r = results.find((r) => r.check === "daemon-parse");
    expect(r).toBeDefined();
    expect(r!.status).toBe("pass");
  });

  it("malformed yaml → fail with parse error detail (Test 12)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-verifier-malformed-"));
    const configPath = join(dir, "clawcode.yaml");
    await writeFile(configPath, "not: valid:\n  yaml: [", "utf8");

    const results = await verifyAgent({
      agentName: "alpha",
      clawcodeConfigPath: configPath,
      openclawRoot: dir,
      openclawMemoryDir: dir,
      offline: true,
    });
    const r = results.find((r) => r.check === "daemon-parse");
    expect(r).toBeDefined();
    expect(r!.status).toBe("fail");
    // Detail mentions the failure mode (loadConfig threw or validation error).
    expect(r!.detail.length).toBeGreaterThan(0);
  });

  it("agent missing from resolved array → fail with agent name in detail (Test 13)", async () => {
    const fx = await setupHappyFixture();
    const results = await verifyAgent({
      agentName: "nonexistent-agent",
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      offline: true,
    });
    const r = results.find((r) => r.check === "daemon-parse");
    expect(r).toBeDefined();
    expect(r!.status).toBe("fail");
    expect(r!.detail).toContain("nonexistent-agent");
  });
});

describe("verifier — computeVerifyExitCode (Tests 14-15)", () => {
  it("no fails → 0 (Test 14)", () => {
    const results = [
      { check: "workspace-files-present" as const, status: "pass" as const, detail: "" },
      { check: "memory-count" as const, status: "pass" as const, detail: "" },
      { check: "discord-reachable" as const, status: "skip" as const, detail: "" },
      { check: "daemon-parse" as const, status: "pass" as const, detail: "" },
    ];
    expect(computeVerifyExitCode(results)).toBe(0);
  });

  it("any fail → 1 (Test 15)", () => {
    const results = [
      { check: "workspace-files-present" as const, status: "pass" as const, detail: "" },
      { check: "memory-count" as const, status: "fail" as const, detail: "" },
      { check: "discord-reachable" as const, status: "skip" as const, detail: "" },
      { check: "daemon-parse" as const, status: "pass" as const, detail: "" },
    ];
    expect(computeVerifyExitCode(results)).toBe(1);
  });
});

describe("verifier — fixed check order (Test 16)", () => {
  it("results always in order: workspace → memory → discord → daemon", async () => {
    const fx = await setupHappyFixture();
    const results = await verifyAgent({
      agentName: fx.agentName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      offline: true,
    });
    expect(results.map((r) => r.check)).toEqual([
      "workspace-files-present",
      "memory-count",
      "discord-reachable",
      "daemon-parse",
    ]);
  });
});

describe("verifier — Discord URL + auth header literal contract (Tests 17-18)", () => {
  it("fetch called with literal 'https://discord.com/api/v9/channels/<id>' URL (Test 17)", async () => {
    const fx = await setupHappyFixture();
    // Re-stage config with single channel 'abc123'
    await stageClawcodeYaml(fx.configPath, {
      agentName: fx.agentName,
      workspace: fx.workspace,
      channels: ["abc123"],
    });
    const fetchCalls: Array<[string, RequestInit | undefined]> = [];
    verifierFetch.fetch = (async (url: string, init?: RequestInit) => {
      fetchCalls.push([url, init]);
      return new Response("", { status: 200 });
    }) as typeof fetch;

    await verifyAgent({
      agentName: fx.agentName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      discordToken: "tok",
    });

    expect(fetchCalls.length).toBeGreaterThan(0);
    expect(fetchCalls[0]![0]).toBe(
      "https://discord.com/api/v9/channels/abc123",
    );
    // Constant prefix matches the expected literal
    expect(DISCORD_CHANNEL_URL_PREFIX).toBe(
      "https://discord.com/api/v9/channels/",
    );
  });

  it("auth header is exactly 'Bot <token>' (Test 18)", async () => {
    const fx = await setupHappyFixture();
    const fetchCalls: Array<[string, RequestInit | undefined]> = [];
    verifierFetch.fetch = (async (url: string, init?: RequestInit) => {
      fetchCalls.push([url, init]);
      return new Response("", { status: 200 });
    }) as typeof fetch;

    await verifyAgent({
      agentName: fx.agentName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      discordToken: "my-secret-token",
    });

    expect(fetchCalls.length).toBeGreaterThan(0);
    const headers = fetchCalls[0]![1]?.headers as
      | Record<string, string>
      | undefined;
    expect(headers?.Authorization).toBe("Bot my-secret-token");
  });
});
