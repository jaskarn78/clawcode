/**
 * Phase 82 Plan 01 Task 2 — report-writer.ts unit tests. TDD RED phase.
 *
 * Pins per 82-01-PLAN.md + 82-CONTEXT:
 *   1. REPORT_PATH_LITERAL byte-exact
 *   2. Refuse-pending: literal "Cannot complete: <N> agent(s) still pending..."
 *   3. Refuse-pending override via forceOnPending=true
 *   4. Refuse-invariants: channel ID appears in both openclaw.json:bindings
 *      AND clawcode.yaml:agents[].channels → refused-invariants
 *   5. Refuse-secret: sk- string in a field → refused-secret
 *   6. Happy path: markdown contains [x] for each invariant + per-agent H2
 *      sections + frontmatter has expected keys
 *   7. Memory-drift calculation (tolerance ±5%)
 *   8. Atomic write: rename failure → tmp unlinked, no partial dest file
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  rm,
  rename,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMigrationReport,
  writeMigrationReport,
  REPORT_PATH_LITERAL,
  reportWriterFs,
} from "../report-writer.js";
import { MemoryStore } from "../../memory/store.js";
import { appendRow } from "../ledger.js";

const ORIG_FS = { ...reportWriterFs };

afterEach(() => {
  reportWriterFs.writeFile = ORIG_FS.writeFile;
  reportWriterFs.rename = ORIG_FS.rename;
  reportWriterFs.unlink = ORIG_FS.unlink;
  reportWriterFs.mkdir = ORIG_FS.mkdir;
});

function randomEmbedding(): Float32Array {
  const vec = new Float32Array(384);
  for (let i = 0; i < 384; i++) vec[i] = Math.random();
  return vec;
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

type ReportFixture = Readonly<{
  dir: string;
  openclawRoot: string;
  openclawMemoryDir: string;
  openclawJsonPath: string;
  clawcodeConfigPath: string;
  ledgerPath: string;
  agentName: string;
  targetWorkspace: string;
}>;

async function setupReportFixture(args: {
  agentName?: string;
  agentStatus?: "verified" | "migrated" | "pending" | "rolled-back";
  openclawBindings?: Array<{ agentId: string; channelId: string }>;
  clawcodeChannels?: readonly string[]; // channels on the agent in clawcode.yaml
  sourceMemoryCount?: number;
  migratedMemoryCount?: number;
  injectSecretInWarnings?: boolean;
} = {}): Promise<ReportFixture> {
  const agentName = args.agentName ?? "alpha";
  const dir = await mkdtemp(join(tmpdir(), "cc-report-"));
  const openclawRoot = join(dir, "openclaw-src");
  const openclawMemoryDir = join(openclawRoot, "memory");
  const openclawJsonPath = join(dir, "openclaw.json");
  const clawcodeConfigPath = join(dir, "clawcode.yaml");
  const ledgerPath = join(dir, "ledger.jsonl");
  const targetWorkspace = join(dir, "clawcode-agents", agentName);

  // Source workspace
  const srcWorkspace = join(openclawRoot, `workspace-${agentName}`);
  await mkdir(srcWorkspace, { recursive: true });
  const srcCount = args.sourceMemoryCount ?? 4;
  // MEMORY.md with N H2 sections so discoverWorkspaceMarkdown returns srcCount
  const parts: string[] = ["# Intro\n", "Intro content.\n\n"];
  for (let i = 1; i < srcCount; i++) {
    parts.push(`## Section ${i}\n`);
    parts.push(`Content ${i}\n\n`);
  }
  await writeFile(join(srcWorkspace, "MEMORY.md"), parts.join(""), "utf8");

  // Target workspace + memories.db
  await mkdir(join(targetWorkspace, "memory"), { recursive: true });
  const migCount = args.migratedMemoryCount ?? srcCount;
  if (migCount > 0) {
    await insertMemoryRows(
      join(targetWorkspace, "memory", "memories.db"),
      agentName,
      migCount,
    );
  }

  // openclaw.json with bindings
  const defaultBindings = [
    { agentId: agentName, channelId: "1111111111" },
    { agentId: "other", channelId: "2222222222" },
  ];
  const bindings = (args.openclawBindings ?? defaultBindings).map((b) => ({
    agentId: b.agentId,
    match: { channel: "discord", peer: { kind: "channel", id: b.channelId } },
  }));
  const openclawJson = {
    agents: {
      list: [
        {
          id: agentName,
          name: "Alpha",
          workspace: srcWorkspace,
          agentDir: "/home/u/.openclaw/agents/alpha/agent",
          model: { primary: "anthropic-api/claude-sonnet-4-6", fallbacks: [] },
          identity: {},
        },
      ],
    },
    bindings,
  };
  await writeFile(
    openclawJsonPath,
    JSON.stringify(openclawJson, null, 2) + "\n",
    "utf8",
  );

  // clawcode.yaml — agent with some channels
  const channels = args.clawcodeChannels ?? ["3333333333"];
  const channelLines = channels.map((c) => `      - "${c}"`).join("\n");
  const yaml = `version: 1
defaults:
  model: sonnet
  basePath: ~/.clawcode/agents
agents:
  - name: ${agentName}
    workspace: ${targetWorkspace}
    memoryPath: ${targetWorkspace}
    model: sonnet
    channels:
${channelLines}
    mcpServers: []
`;
  await writeFile(clawcodeConfigPath, yaml, "utf8");

  // Ledger: apply row with status, optional secret-injected notes
  await appendRow(ledgerPath, {
    ts: "2026-04-20T11:00:00.000Z",
    action: "apply",
    agent: agentName,
    status: args.agentStatus ?? "verified",
    source_hash: "testhash",
    notes: args.injectSecretInWarnings ? "sk-abc123def456ghij789klmno" : undefined,
    step: args.injectSecretInWarnings ? "pre-flight:secret" : undefined,
    outcome: args.injectSecretInWarnings ? "refuse" : "allow",
  });

  return {
    dir,
    openclawRoot,
    openclawMemoryDir,
    openclawJsonPath,
    clawcodeConfigPath,
    ledgerPath,
    agentName,
    targetWorkspace,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("REPORT_PATH_LITERAL", () => {
  it("equals the exact literal '.planning/milestones/v2.1-migration-report.md'", () => {
    expect(REPORT_PATH_LITERAL).toBe(
      ".planning/milestones/v2.1-migration-report.md",
    );
  });
});

describe("buildMigrationReport — refuse-pending", () => {
  it("refuses when any agent has latest status 'pending' and forceOnPending is not set", async () => {
    const fx = await setupReportFixture({ agentStatus: "pending" });
    const result = await buildMigrationReport({
      ledgerPath: fx.ledgerPath,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    expect(result.outcome).toBe("refused-pending");
    if (result.outcome === "refused-pending") {
      expect(result.message).toMatch(
        /Cannot complete: \d+ agent\(s\) still pending\. Run apply \+ verify first, or pass --force to acknowledge gaps\./,
      );
      expect(result.pendingCount).toBe(1);
    }
  });

  it("proceeds past pending gate when forceOnPending=true", async () => {
    const fx = await setupReportFixture({ agentStatus: "pending" });
    const result = await buildMigrationReport({
      ledgerPath: fx.ledgerPath,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      forceOnPending: true,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    // It should NOT be refused-pending anymore; it may be refused-invariants
    // (the pending agent's openclaw bindings still list the agent, which is
    // allowed here since we haven't cutover) or built.
    expect(result.outcome).not.toBe("refused-pending");
  });
});

describe("buildMigrationReport — refuse-invariants (channel overlap)", () => {
  it("refuses when a channel ID exists in BOTH openclaw.json:bindings AND clawcode.yaml:agents[].channels", async () => {
    // Set up collision: same channel id on both sides
    const sharedChannel = "7777777777";
    const fx = await setupReportFixture({
      agentStatus: "verified",
      openclawBindings: [{ agentId: "alpha", channelId: sharedChannel }],
      clawcodeChannels: [sharedChannel],
    });
    const result = await buildMigrationReport({
      ledgerPath: fx.ledgerPath,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    expect(result.outcome).toBe("refused-invariants");
    if (result.outcome === "refused-invariants") {
      expect(result.failing).toContain("zeroChannelOverlap");
      expect(result.message).toMatch(/Cannot complete: cross-agent invariant/);
    }
  });
});

describe("buildMigrationReport — happy path", () => {
  it("built outcome + markdown contains '- [x] Zero Discord channel' + per-agent section + frontmatter keys", async () => {
    // Ensure no channel overlap (openclaw binding=1111, clawcode=3333)
    const fx = await setupReportFixture({ agentStatus: "verified" });
    const result = await buildMigrationReport({
      ledgerPath: fx.ledgerPath,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    expect(result.outcome).toBe("built");
    if (result.outcome === "built") {
      expect(result.markdown).toContain("- [x] Zero Discord channel");
      // per-agent section
      expect(result.markdown).toMatch(/### alpha/);
      // frontmatter keys
      expect(result.frontmatter.milestone).toBe("v2.1");
      expect(result.frontmatter.date).toBeDefined();
      expect(result.frontmatter.agents_migrated).toBeDefined();
      expect(result.frontmatter.source_integrity_sha).toBeDefined();
      // All 3 invariants pass
      expect(result.invariants.zeroChannelOverlap).toBe(true);
      expect(result.invariants.sourceTreeByteIdentical).toBe(true);
      expect(result.invariants.zeroDuplicateOriginIds).toBe(true);
      // Per-agent row shape
      expect(result.perAgent).toHaveLength(1);
      const row = result.perAgent[0]!;
      expect(row.agentName).toBe("alpha");
      expect(typeof row.memoryDriftPct).toBe("number");
    }
  });

  it("memory-drift calculation: source=100, migrated=102 → driftPct ≈ 2.0", async () => {
    const fx = await setupReportFixture({
      agentStatus: "verified",
      sourceMemoryCount: 100,
      migratedMemoryCount: 102,
    });
    const result = await buildMigrationReport({
      ledgerPath: fx.ledgerPath,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    expect(result.outcome).toBe("built");
    if (result.outcome === "built") {
      const row = result.perAgent[0]!;
      expect(row.sourceMemoryCount).toBe(100);
      expect(row.migratedMemoryCount).toBe(102);
      expect(row.memoryDriftPct).toBeCloseTo(2.0, 1);
    }
  });
});

describe("buildMigrationReport — refuse-secret", () => {
  it("refuses when a sk- prefix secret appears in any rendered field (warnings)", async () => {
    const fx = await setupReportFixture({
      agentStatus: "verified",
      injectSecretInWarnings: true,
    });
    const result = await buildMigrationReport({
      ledgerPath: fx.ledgerPath,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    expect(result.outcome).toBe("refused-secret");
  });
});

describe("writeMigrationReport — atomic temp+rename", () => {
  it("writes to tmp path then renames to dest (atomic pattern)", async () => {
    const fx = await setupReportFixture({ agentStatus: "verified" });
    const built = await buildMigrationReport({
      ledgerPath: fx.ledgerPath,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    expect(built.outcome).toBe("built");
    if (built.outcome !== "built") throw new Error("unreachable");

    const destPath = join(fx.dir, "v2.1-migration-report.md");
    const result = await writeMigrationReport(built, destPath);
    expect(result.destPath).toBe(destPath);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(destPath)).toBe(true);
    const written = await readFile(destPath, "utf8");
    expect(written).toBe(built.markdown);
  });

  it("creates parent directory if missing (mkdir -p .planning/milestones/)", async () => {
    const fx = await setupReportFixture({ agentStatus: "verified" });
    const built = await buildMigrationReport({
      ledgerPath: fx.ledgerPath,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    if (built.outcome !== "built") throw new Error("unreachable");
    const destPath = join(fx.dir, "nested", "dir", "report.md");
    const result = await writeMigrationReport(built, destPath);
    expect(result.destPath).toBe(destPath);
    expect(existsSync(destPath)).toBe(true);
  });

  it("rename failure → tmp is unlinked, error re-thrown, no partial dest", async () => {
    const fx = await setupReportFixture({ agentStatus: "verified" });
    const built = await buildMigrationReport({
      ledgerPath: fx.ledgerPath,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    if (built.outcome !== "built") throw new Error("unreachable");

    let unlinkCalled = false;
    reportWriterFs.rename = (async () => {
      throw new Error("synthetic rename failure");
    }) as typeof rename;
    reportWriterFs.unlink = (async (p: unknown) => {
      unlinkCalled = true;
      return ORIG_FS.unlink(p as Parameters<typeof ORIG_FS.unlink>[0]);
    }) as typeof ORIG_FS.unlink;

    const destPath = join(fx.dir, "should-not-land.md");
    await expect(writeMigrationReport(built, destPath)).rejects.toThrow(
      /synthetic rename failure/,
    );
    expect(unlinkCalled).toBe(true);
    expect(existsSync(destPath)).toBe(false);
  });
});
