/**
 * Phase 81 Plan 01 Task 2 — rollbacker.ts unit tests.
 *
 * Pins 10 behaviors:
 *   1. Dedicated-workspace happy-path rollback (YAML removal + target fs.rm
 *      + ledger row + source hash invariant preserved)
 *   2. Finmentum-shared per-agent-only rollback (sibling files survive,
 *      shared basePath root survives)
 *   3. agent-not-in-config → outcome:"not-found", zero side effects
 *   4. Source-tree modified mid-rollback → throws SourceCorruptionError +
 *      writes refuse ledger row
 *   5. Source hash-map byte-for-byte pre vs post on happy path
 *   6. Ledger row shape on success (action/status/step/outcome/agent +
 *      file_hashes)
 *   7. Ledger status after rollback enables resume — latestStatusByAgent
 *      returns "rolled-back"
 *   8. clawcode.yaml surviving agents + their comments preserved
 *   9. memories.db included in source hash-map when present
 *  10. rollbackerFs dispatch holder exists + monkey-patch works
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm as realRm,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  rollbackAgent,
  hashSourceTree,
  SourceCorruptionError,
  rollbackerFs,
} from "../rollbacker.js";
import { readRows, latestStatusByAgent } from "../ledger.js";

const ORIG_RB_FS = { ...rollbackerFs };

afterEach(() => {
  rollbackerFs.rm = ORIG_RB_FS.rm;
  rollbackerFs.readFile = ORIG_RB_FS.readFile;
  rollbackerFs.readdir = ORIG_RB_FS.readdir;
  rollbackerFs.stat = ORIG_RB_FS.stat;
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

type DedicatedFixture = {
  readonly dir: string;
  readonly openclawRoot: string;
  readonly openclawMemoryDir: string;
  readonly configPath: string;
  readonly ledgerPath: string;
  readonly targetWorkspace: string;
  readonly agentName: string;
};

async function setupDedicatedFixture(
  args: { agentName?: string; stageSource?: boolean; stageMemoryDb?: boolean } = {},
): Promise<DedicatedFixture> {
  const agentName = args.agentName ?? "alpha";
  const stageSource = args.stageSource ?? true;
  const stageMemoryDb = args.stageMemoryDb ?? true;

  const dir = await mkdtemp(join(tmpdir(), "cc-rollback-dedicated-"));
  const openclawRoot = join(dir, "openclaw");
  const openclawMemoryDir = join(openclawRoot, "memory");
  const targetWorkspace = join(dir, "clawcode-agents", agentName);
  const configPath = join(dir, "clawcode.yaml");
  const ledgerPath = join(dir, "ledger.jsonl");

  if (stageSource) {
    const srcWorkspace = join(openclawRoot, `workspace-${agentName}`);
    await mkdir(srcWorkspace, { recursive: true });
    await writeFile(join(srcWorkspace, "SOUL.md"), "source soul\n", "utf8");
    await writeFile(
      join(srcWorkspace, "IDENTITY.md"),
      "source identity\n",
      "utf8",
    );
    await writeFile(
      join(srcWorkspace, "MEMORY.md"),
      "source memory\n",
      "utf8",
    );
  }
  if (stageMemoryDb) {
    await mkdir(openclawMemoryDir, { recursive: true });
    await writeFile(
      join(openclawMemoryDir, `${agentName}.sqlite`),
      "fake sqlite bytes",
      "utf8",
    );
  }

  // Target workspace
  await mkdir(targetWorkspace, { recursive: true });
  await writeFile(
    join(targetWorkspace, "SOUL.md"),
    "target soul\n",
    "utf8",
  );
  await writeFile(
    join(targetWorkspace, "IDENTITY.md"),
    "target identity\n",
    "utf8",
  );
  await writeFile(
    join(targetWorkspace, "MEMORY.md"),
    "target memory\n",
    "utf8",
  );
  const dbDir = join(targetWorkspace, "memory");
  await mkdir(dbDir, { recursive: true });
  await writeFile(
    join(dbDir, "memories.db"),
    "target db bytes",
    "utf8",
  );

  // Minimal clawcode.yaml — dedicated agent: workspace key ONLY (no
  // memoryPath), so resolver falls back to memoryPath === workspace and
  // the rollbacker's "is finmentum?" branch takes the dedicated path.
  const yaml = `version: 1
defaults:
  model: sonnet
  basePath: ~/.clawcode/agents
agents:
  - name: ${agentName}
    workspace: ${targetWorkspace}
    model: sonnet
    channels:
      - "111"
    mcpServers: []
`;
  await writeFile(configPath, yaml, "utf8");

  return {
    dir,
    openclawRoot,
    openclawMemoryDir,
    configPath,
    ledgerPath,
    targetWorkspace,
    agentName,
  };
}

type FinmentumFixture = {
  readonly dir: string;
  readonly openclawRoot: string;
  readonly openclawMemoryDir: string;
  readonly configPath: string;
  readonly ledgerPath: string;
  readonly sharedBasePath: string;
  readonly victimMemoryPath: string;
  readonly victimSoulFile: string;
  readonly victimIdentityFile: string;
  readonly victimInbox: string;
  readonly siblingMemoryPath: string;
  readonly siblingSoulFile: string;
  readonly victimName: string;
  readonly siblingName: string;
};

async function setupFinmentumFixture(): Promise<FinmentumFixture> {
  const dir = await mkdtemp(join(tmpdir(), "cc-rollback-finmentum-"));
  const openclawRoot = join(dir, "openclaw");
  const openclawMemoryDir = join(openclawRoot, "memory");
  const sharedBasePath = join(dir, "clawcode-agents", "finmentum");
  const victimName = "finmentum-content-creator";
  const siblingName = "finmentum-tax";

  const victimMemoryPath = join(sharedBasePath, "memory", victimName);
  const victimSoulFile = join(sharedBasePath, `SOUL.${victimName}.md`);
  const victimIdentityFile = join(
    sharedBasePath,
    `IDENTITY.${victimName}.md`,
  );
  const victimInbox = join(sharedBasePath, "inbox", victimName);
  const siblingMemoryPath = join(sharedBasePath, "memory", siblingName);
  const siblingSoulFile = join(sharedBasePath, `SOUL.${siblingName}.md`);

  // Shared basePath workspace files (neutral — not per-agent)
  await mkdir(sharedBasePath, { recursive: true });
  await writeFile(
    join(sharedBasePath, "SHARED.md"),
    "family shared\n",
    "utf8",
  );

  // Per-agent victim files
  await mkdir(victimMemoryPath, { recursive: true });
  await writeFile(
    join(victimMemoryPath, "memories.db"),
    "victim db",
    "utf8",
  );
  await writeFile(victimSoulFile, "victim soul\n", "utf8");
  await writeFile(victimIdentityFile, "victim identity\n", "utf8");
  await mkdir(victimInbox, { recursive: true });
  await writeFile(
    join(victimInbox, "pending.json"),
    "{}\n",
    "utf8",
  );

  // Per-agent sibling files — MUST survive rollback
  await mkdir(siblingMemoryPath, { recursive: true });
  await writeFile(
    join(siblingMemoryPath, "memories.db"),
    "sibling db",
    "utf8",
  );
  await writeFile(siblingSoulFile, "sibling soul\n", "utf8");

  const configPath = join(dir, "clawcode.yaml");
  const ledgerPath = join(dir, "ledger.jsonl");
  const yaml = `version: 1
defaults:
  model: sonnet
  basePath: ~/.clawcode/agents
agents:
  - name: ${victimName}
    workspace: ${sharedBasePath}
    memoryPath: ${victimMemoryPath}
    soulFile: ${victimSoulFile}
    identityFile: ${victimIdentityFile}
    model: sonnet
    channels:
      - "111"
    mcpServers: []
  - name: ${siblingName}
    workspace: ${sharedBasePath}
    memoryPath: ${siblingMemoryPath}
    soulFile: ${siblingSoulFile}
    model: sonnet
    channels:
      - "222"
    mcpServers: []
`;
  await writeFile(configPath, yaml, "utf8");

  return {
    dir,
    openclawRoot,
    openclawMemoryDir,
    configPath,
    ledgerPath,
    sharedBasePath,
    victimMemoryPath,
    victimSoulFile,
    victimIdentityFile,
    victimInbox,
    siblingMemoryPath,
    siblingSoulFile,
    victimName,
    siblingName,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rollbacker — dedicated happy path (Test 1)", () => {
  it("removes YAML entry + target workspace + writes success ledger row; source bytes preserved", async () => {
    const fx = await setupDedicatedFixture();
    expect(existsSync(fx.targetWorkspace)).toBe(true);

    const result = await rollbackAgent({
      agentName: fx.agentName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      ledgerPath: fx.ledgerPath,
    });

    expect(result.outcome).toBe("rolled-back");
    // Target gone
    expect(existsSync(fx.targetWorkspace)).toBe(false);
    // YAML agent removed
    const yamlAfter = await readFile(fx.configPath, "utf8");
    expect(yamlAfter).not.toContain(`name: ${fx.agentName}`);
    // Ledger row written
    const rows = await readRows(fx.ledgerPath);
    const completeRow = rows.find((r) => r.step === "rollback:complete");
    expect(completeRow).toBeDefined();
    expect(completeRow!.action).toBe("rollback");
    expect(completeRow!.status).toBe("rolled-back");
    expect(completeRow!.agent).toBe(fx.agentName);
    expect(completeRow!.outcome).toBe("allow");
  });
});

describe("rollbacker — finmentum-shared per-agent-only rollback (Test 2)", () => {
  it("removes victim per-agent files only; sibling files + shared basePath preserved", async () => {
    const fx = await setupFinmentumFixture();

    // Pre-rollback sibling file hashes (to verify byte-exact preservation)
    const siblingSoulBefore = createHash("sha256")
      .update(await readFile(fx.siblingSoulFile))
      .digest("hex");
    const siblingDbBefore = createHash("sha256")
      .update(await readFile(join(fx.siblingMemoryPath, "memories.db")))
      .digest("hex");
    const sharedShared = createHash("sha256")
      .update(await readFile(join(fx.sharedBasePath, "SHARED.md")))
      .digest("hex");

    const result = await rollbackAgent({
      agentName: fx.victimName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      ledgerPath: fx.ledgerPath,
    });

    expect(result.outcome).toBe("rolled-back");
    // Victim paths gone
    expect(existsSync(fx.victimMemoryPath)).toBe(false);
    expect(existsSync(fx.victimSoulFile)).toBe(false);
    expect(existsSync(fx.victimIdentityFile)).toBe(false);
    expect(existsSync(fx.victimInbox)).toBe(false);
    // Sibling paths survive byte-exact
    expect(existsSync(fx.siblingMemoryPath)).toBe(true);
    expect(existsSync(fx.siblingSoulFile)).toBe(true);
    const siblingSoulAfter = createHash("sha256")
      .update(await readFile(fx.siblingSoulFile))
      .digest("hex");
    const siblingDbAfter = createHash("sha256")
      .update(await readFile(join(fx.siblingMemoryPath, "memories.db")))
      .digest("hex");
    expect(siblingSoulAfter).toBe(siblingSoulBefore);
    expect(siblingDbAfter).toBe(siblingDbBefore);
    // Shared basePath root survives
    expect(existsSync(fx.sharedBasePath)).toBe(true);
    expect(existsSync(join(fx.sharedBasePath, "SHARED.md"))).toBe(true);
    const sharedSharedAfter = createHash("sha256")
      .update(await readFile(join(fx.sharedBasePath, "SHARED.md")))
      .digest("hex");
    expect(sharedSharedAfter).toBe(sharedShared);
  });
});

describe("rollbacker — agent not in config (Test 3)", () => {
  it("returns outcome:not-found with no filesystem or ledger side-effects", async () => {
    const fx = await setupDedicatedFixture();

    const yamlBefore = await readFile(fx.configPath, "utf8");
    const targetStillPresent = existsSync(fx.targetWorkspace);

    const result = await rollbackAgent({
      agentName: "not-in-config-ever",
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      ledgerPath: fx.ledgerPath,
    });

    expect(result.outcome).toBe("not-found");
    // Config bytes unchanged
    const yamlAfter = await readFile(fx.configPath, "utf8");
    expect(yamlAfter).toBe(yamlBefore);
    // Target still there (untouched — we only rolled back a nonexistent agent)
    expect(existsSync(fx.targetWorkspace)).toBe(targetStillPresent);
    // No ledger file written
    expect(existsSync(fx.ledgerPath)).toBe(false);
  });
});

describe("rollbacker — source corruption detection (Test 4)", () => {
  it("throws SourceCorruptionError when source bytes change mid-rollback + writes refuse ledger row", async () => {
    const fx = await setupDedicatedFixture();
    const srcWorkspace = join(
      fx.openclawRoot,
      `workspace-${fx.agentName}`,
    );
    const srcSoulPath = join(srcWorkspace, "SOUL.md");

    // Monkey-patch rm to mutate the source file on first call (target rm).
    const origRm = rollbackerFs.rm;
    let firstCall = true;
    rollbackerFs.rm = (async (
      ...args: Parameters<typeof realRm>
    ) => {
      if (firstCall) {
        firstCall = false;
        // Corrupt a source file before the target is removed; this
        // simulates a concurrent writer or disk bit-flip.
        await writeFile(srcSoulPath, "MUTATED SOURCE\n", "utf8");
      }
      return origRm(...args);
    }) as typeof rollbackerFs.rm;

    await expect(
      rollbackAgent({
        agentName: fx.agentName,
        clawcodeConfigPath: fx.configPath,
        openclawRoot: fx.openclawRoot,
        openclawMemoryDir: fx.openclawMemoryDir,
        ledgerPath: fx.ledgerPath,
      }),
    ).rejects.toThrow(SourceCorruptionError);

    // Refuse ledger row written
    const rows = await readRows(fx.ledgerPath);
    const refuseRow = rows.find(
      (r) => r.step === "rollback:source-corruption",
    );
    expect(refuseRow).toBeDefined();
    expect(refuseRow!.status).toBe("pending");
    expect(refuseRow!.outcome).toBe("refuse");
    expect(refuseRow!.agent).toBe(fx.agentName);
  });
});

describe("rollbacker — source hash invariant (Test 5)", () => {
  it("byte-for-byte sourceHashBefore === sourceHashAfter on happy path", async () => {
    const fx = await setupDedicatedFixture();
    const result = await rollbackAgent({
      agentName: fx.agentName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      ledgerPath: fx.ledgerPath,
    });
    expect(result.outcome).toBe("rolled-back");
    const beforeKeys = Object.keys(result.sourceHashBefore).sort();
    const afterKeys = Object.keys(result.sourceHashAfter).sort();
    expect(afterKeys).toEqual(beforeKeys);
    expect(beforeKeys.length).toBeGreaterThan(0);
    for (const k of beforeKeys) {
      expect(result.sourceHashAfter[k]).toBe(result.sourceHashBefore[k]);
    }
  });
});

describe("rollbacker — ledger row shape on success (Test 6)", () => {
  it("emits rollback:complete row with file_hashes map for source-workspace + source-memory-db", async () => {
    const fx = await setupDedicatedFixture();
    await rollbackAgent({
      agentName: fx.agentName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      ledgerPath: fx.ledgerPath,
    });
    const rows = await readRows(fx.ledgerPath);
    const completeRow = rows.find((r) => r.step === "rollback:complete");
    expect(completeRow).toBeDefined();
    expect(completeRow!.file_hashes).toBeDefined();
    // Expect workspace-prefixed hash key AND memory-prefixed hash key.
    const hashKeys = Object.keys(completeRow!.file_hashes!);
    const hasWorkspaceEntry = hashKeys.some((k) => k.startsWith("workspace/"));
    const hasMemoryEntry = hashKeys.some((k) => k.startsWith("memory/"));
    expect(hasWorkspaceEntry).toBe(true);
    expect(hasMemoryEntry).toBe(true);
  });
});

describe("rollbacker — ledger status enables resume (Test 7)", () => {
  it("latestStatusByAgent returns rolled-back after rollback", async () => {
    const fx = await setupDedicatedFixture();
    await rollbackAgent({
      agentName: fx.agentName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      ledgerPath: fx.ledgerPath,
    });
    const statusMap = await latestStatusByAgent(fx.ledgerPath);
    expect(statusMap.get(fx.agentName)).toBe("rolled-back");
  });
});

describe("rollbacker — clawcode.yaml survivor comments (Test 8)", () => {
  it("surviving agents + their comments preserved after one agent is removed", async () => {
    const fx = await setupFinmentumFixture();
    const yamlBefore = await readFile(fx.configPath, "utf8");
    expect(yamlBefore).toContain(fx.victimName);
    expect(yamlBefore).toContain(fx.siblingName);

    await rollbackAgent({
      agentName: fx.victimName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      ledgerPath: fx.ledgerPath,
    });

    const yamlAfter = await readFile(fx.configPath, "utf8");
    expect(yamlAfter).not.toContain(`name: ${fx.victimName}`);
    expect(yamlAfter).toContain(`name: ${fx.siblingName}`);
    // Sibling's workspace still referenced
    expect(yamlAfter).toContain(fx.siblingMemoryPath);
  });
});

describe("rollbacker — source hash map includes memories.db (Test 9)", () => {
  it("hashSourceTree keys memory sqlite under memory/<agent>.sqlite", async () => {
    const fx = await setupDedicatedFixture();
    const map = await hashSourceTree(
      fx.openclawRoot,
      fx.openclawMemoryDir,
      fx.agentName,
    );
    const memoryKey = `memory/${fx.agentName}.sqlite`;
    expect(map[memoryKey]).toBeDefined();
    expect(map[memoryKey]).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("rollbacker — rollbackerFs dispatch holder (Test 10)", () => {
  it("exposes rm/readFile/readdir/stat + monkey-patch rm intercepts rollback", async () => {
    expect(typeof rollbackerFs.rm).toBe("function");
    expect(typeof rollbackerFs.readFile).toBe("function");
    expect(typeof rollbackerFs.readdir).toBe("function");
    expect(typeof rollbackerFs.stat).toBe("function");

    const fx = await setupDedicatedFixture();
    const rmCalls: Array<string> = [];
    const origRm = rollbackerFs.rm;
    rollbackerFs.rm = (async (...args: Parameters<typeof realRm>) => {
      rmCalls.push(String(args[0]));
      return origRm(...args);
    }) as typeof rollbackerFs.rm;

    await rollbackAgent({
      agentName: fx.agentName,
      clawcodeConfigPath: fx.configPath,
      openclawRoot: fx.openclawRoot,
      openclawMemoryDir: fx.openclawMemoryDir,
      ledgerPath: fx.ledgerPath,
    });

    // At least one rm call hit the target workspace (the dedicated removal)
    expect(rmCalls.some((p) => p === fx.targetWorkspace)).toBe(true);
  });
});
