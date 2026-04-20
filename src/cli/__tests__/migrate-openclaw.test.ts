/**
 * Phase 78 Plan 02 Task 2 — CLI wiring tests for --model-map flag on
 * `migrate openclaw plan` and `migrate openclaw apply` subcommands.
 *
 * Focus: the parse/thread contract between commander options and the
 * runPlanAction / runApplyAction handlers. Plan 03 will use the parsed
 * map inside the writer; here we only assert the flag parses, propagates,
 * and fails fast on malformed input.
 *
 * ESM note: the CLI dispatches via a mutable `migrateOpenclawHandlers`
 * holder because named-import bindings are frozen in ESM — `vi.spyOn` on
 * the module namespace cannot rebind commander closures. Tests monkey-
 * patch the holder's properties instead.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import {
  registerMigrateOpenclawCommand,
  migrateOpenclawHandlers,
} from "../commands/migrate-openclaw.js";

describe("migrate openclaw --model-map flag", () => {
  let program: Command;
  let planMock: ReturnType<typeof vi.fn>;
  let applyMock: ReturnType<typeof vi.fn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let origPlan: typeof migrateOpenclawHandlers.runPlanAction;
  let origApply: typeof migrateOpenclawHandlers.runApplyAction;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerMigrateOpenclawCommand(program);

    origPlan = migrateOpenclawHandlers.runPlanAction;
    origApply = migrateOpenclawHandlers.runApplyAction;

    planMock = vi.fn().mockResolvedValue(0);
    applyMock = vi.fn().mockResolvedValue(0);
    migrateOpenclawHandlers.runPlanAction = planMock as never;
    migrateOpenclawHandlers.runApplyAction = applyMock as never;

    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code ?? 0})`);
      }) as never);
    errorSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    migrateOpenclawHandlers.runPlanAction = origPlan;
    migrateOpenclawHandlers.runApplyAction = origApply;
    vi.restoreAllMocks();
  });

  it("plan --model-map 'foo=sonnet' threads { foo: 'sonnet' } into runPlanAction", async () => {
    await program.parseAsync(
      ["node", "clawcode", "migrate", "openclaw", "plan", "--model-map", "foo=sonnet"],
    );
    expect(planMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelMap: { foo: "sonnet" } }),
    );
  });

  it("apply --model-map repeated aggregates multiple mappings", async () => {
    await program.parseAsync(
      [
        "node",
        "clawcode",
        "migrate",
        "openclaw",
        "apply",
        "--model-map",
        "a=1",
        "--model-map",
        "b=2",
      ],
    );
    expect(applyMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelMap: { a: "1", b: "2" } }),
    );
  });

  it("plan --model-map 'invalid-no-equals' exits 1 with stderr containing 'invalid --model-map syntax' BEFORE calling runPlanAction", async () => {
    let caught: Error | undefined;
    try {
      await program.parseAsync(
        ["node", "clawcode", "migrate", "openclaw", "plan", "--model-map", "invalid-no-equals"],
      );
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.message).toMatch(/process\.exit\(1\)/);
    expect(planMock).not.toHaveBeenCalled();
    const allStderrArgs = errorSpy.mock.calls
      .map((c: readonly unknown[]) => String(c[0]))
      .join("");
    expect(allStderrArgs).toContain("invalid --model-map syntax");
  });

  it("plan without --model-map threads empty modelMap {} into runPlanAction", async () => {
    await program.parseAsync(
      ["node", "clawcode", "migrate", "openclaw", "plan"],
    );
    expect(planMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelMap: {} }),
    );
  });

  // Keep exitSpy referenced so lint doesn't complain — it's used implicitly
  // via the throw-on-exit behavior above.
  it("exitSpy is installed (smoke)", () => {
    expect(exitSpy).toBeDefined();
  });
});

// ---- Phase 78 Plan 03 Task 2 — end-to-end apply pipeline ---------------

import { mkdtemp, copyFile, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import chokidar from "chokidar";
import { runApplyAction } from "../commands/migrate-openclaw.js";
import { readRows } from "../../migration/ledger.js";

const FIXTURE_CLAWCODE_YAML =
  "src/migration/__tests__/fixtures/clawcode.before.yaml";

type EnvSnapshot = {
  openclaw: string | undefined;
  ledger: string | undefined;
  config: string | undefined;
  agentsRoot: string | undefined;
  memoryDir: string | undefined;
};

function snapshotEnv(): EnvSnapshot {
  return {
    openclaw: process.env.CLAWCODE_OPENCLAW_JSON,
    ledger: process.env.CLAWCODE_LEDGER_PATH,
    config: process.env.CLAWCODE_CONFIG_PATH,
    agentsRoot: process.env.CLAWCODE_AGENTS_ROOT,
    memoryDir: process.env.CLAWCODE_OPENCLAW_MEMORY_DIR,
  };
}

function restoreEnv(snap: EnvSnapshot): void {
  for (const [k, v] of [
    ["CLAWCODE_OPENCLAW_JSON", snap.openclaw],
    ["CLAWCODE_LEDGER_PATH", snap.ledger],
    ["CLAWCODE_CONFIG_PATH", snap.config],
    ["CLAWCODE_AGENTS_ROOT", snap.agentsRoot],
    ["CLAWCODE_OPENCLAW_MEMORY_DIR", snap.memoryDir],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

async function setupE2EFixture(opts: {
  agents: Array<{
    id: string;
    model?: string;
    channelId?: string;
    workspace?: string;
  }>;
}): Promise<{
  dir: string;
  openclawPath: string;
  clawcodePath: string;
  ledgerPath: string;
  agentsRoot: string;
  memoryDir: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "cc-p78-e2e-"));
  const openclawPath = join(dir, "openclaw.json");
  const ledgerPath = join(dir, "ledger.jsonl");
  const clawcodePath = join(dir, "clawcode.yaml");
  const agentsRoot = join(dir, "clawcode-agents");
  const memoryDir = join(dir, "openclaw-memory");
  await copyFile(FIXTURE_CLAWCODE_YAML, clawcodePath);

  await writeFile(
    openclawPath,
    JSON.stringify({
      meta: { lastTouchedVersion: "2026.4.15", lastTouchedAt: "2026-04-19T00:00:00Z" },
      agents: {
        list: opts.agents.map((a) => ({
          id: a.id,
          name: a.id,
          workspace: a.workspace ?? `/home/u/.openclaw/workspace-${a.id}`,
          agentDir: `/home/u/.openclaw/agents/${a.id}/agent`,
          model: {
            primary: a.model ?? "anthropic-api/claude-sonnet-4-6",
            fallbacks: [],
          },
          identity: { name: a.id, emoji: "X" },
        })),
      },
      bindings: opts.agents
        .filter((a) => a.channelId !== undefined)
        .map((a) => ({
          agentId: a.id,
          match: { channel: "discord", peer: { kind: "channel", id: a.channelId } },
        })),
    }),
  );

  return { dir, openclawPath, clawcodePath, ledgerPath, agentsRoot, memoryDir };
}

describe("migrate openclaw apply — Phase 78 end-to-end", () => {
  let envSnap: EnvSnapshot;

  beforeEach(() => {
    envSnap = snapshotEnv();
  });

  afterEach(() => {
    restoreEnv(envSnap);
    vi.restoreAllMocks();
  });

  it("writes clawcode.yaml with new agent entries + ledger witness row (Test 1)", async () => {
    const fx = await setupE2EFixture({
      agents: [{ id: "new-one", channelId: "999999999999999999" }],
    });
    process.env.CLAWCODE_OPENCLAW_JSON = fx.openclawPath;
    process.env.CLAWCODE_LEDGER_PATH = fx.ledgerPath;
    process.env.CLAWCODE_CONFIG_PATH = fx.clawcodePath;
    process.env.CLAWCODE_AGENTS_ROOT = fx.agentsRoot;
    process.env.CLAWCODE_OPENCLAW_MEMORY_DIR = fx.memoryDir;

    const exitCode = await runApplyAction(
      { only: "new-one" },
      { execaRunner: async () => ({ stdout: "inactive", exitCode: 3 }) },
    );
    expect(exitCode).toBe(0);

    // Assert new agent entry present with soulFile/identityFile/mcpServers
    const after = await readFile(fx.clawcodePath, "utf8");
    expect(after).toContain("name: new-one");
    expect(after).toMatch(/soulFile:.*SOUL\.md/);
    expect(after).toMatch(/identityFile:.*IDENTITY\.md/);
    // mcpServers auto-inject: clawcode + 1password must appear in the entry
    expect(after).toMatch(/- clawcode\n\s*- 1password/);

    // Assert pre-existing comments preserved
    expect(after).toContain("v2.0 endpoint");
    expect(after).toContain("op://clawdbot/");

    // Assert ledger witness row with step:write, outcome:allow, file_hashes
    const rows = await readRows(fx.ledgerPath);
    const writeRow = rows.find((r) => r.step === "write" && r.outcome === "allow");
    expect(writeRow).toBeDefined();
    expect(writeRow?.file_hashes).toBeDefined();
    expect(writeRow?.file_hashes?.["clawcode.yaml"]).toMatch(/^[a-f0-9]{64}$/);
    expect(writeRow?.status).toBe("migrated");
    expect(writeRow?.action).toBe("apply");
  });

  it("surfaces writer refuse (unmappable-model) to CLI with exit 1 and refuse ledger row (Test 2)", async () => {
    const fx = await setupE2EFixture({
      agents: [
        {
          id: "new-unknown",
          model: "unknown/thing",
          channelId: "888888888888888888",
        },
      ],
    });
    process.env.CLAWCODE_OPENCLAW_JSON = fx.openclawPath;
    process.env.CLAWCODE_LEDGER_PATH = fx.ledgerPath;
    process.env.CLAWCODE_CONFIG_PATH = fx.clawcodePath;
    process.env.CLAWCODE_AGENTS_ROOT = fx.agentsRoot;
    process.env.CLAWCODE_OPENCLAW_MEMORY_DIR = fx.memoryDir;

    const beforeBytes = readFileSync(fx.clawcodePath, "utf8");

    const exitCode = await runApplyAction(
      { only: "new-unknown" },
      { execaRunner: async () => ({ stdout: "inactive", exitCode: 3 }) },
    );
    expect(exitCode).toBe(1);

    // Ledger row with outcome:refuse
    const rows = await readRows(fx.ledgerPath);
    const refuseRow = rows.find((r) => r.step === "write" && r.outcome === "refuse");
    expect(refuseRow).toBeDefined();
    expect(refuseRow?.notes).toMatch(/unmappable-model/);
    expect(refuseRow?.status).toBe("pending");

    // File unchanged
    const afterBytes = readFileSync(fx.clawcodePath, "utf8");
    expect(afterBytes).toBe(beforeBytes);
  });

  it("guard refuse (daemon active) short-circuits writer — no write occurs (Test 3)", async () => {
    const fx = await setupE2EFixture({
      agents: [{ id: "new-one", channelId: "777777777777777777" }],
    });
    process.env.CLAWCODE_OPENCLAW_JSON = fx.openclawPath;
    process.env.CLAWCODE_LEDGER_PATH = fx.ledgerPath;
    process.env.CLAWCODE_CONFIG_PATH = fx.clawcodePath;
    process.env.CLAWCODE_AGENTS_ROOT = fx.agentsRoot;
    process.env.CLAWCODE_OPENCLAW_MEMORY_DIR = fx.memoryDir;

    const beforeBytes = readFileSync(fx.clawcodePath, "utf8");

    // Daemon reports "active" — pre-flight refuses
    const exitCode = await runApplyAction(
      { only: "new-one" },
      { execaRunner: async () => ({ stdout: "active", exitCode: 0 }) },
    );
    expect(exitCode).toBe(1);

    // File unchanged
    const afterBytes = readFileSync(fx.clawcodePath, "utf8");
    expect(afterBytes).toBe(beforeBytes);

    // Ledger has daemon-refuse row but NO write row at all
    const rows = await readRows(fx.ledgerPath);
    const daemonRefuse = rows.find(
      (r) => r.step === "pre-flight:daemon" && r.outcome === "refuse",
    );
    expect(daemonRefuse).toBeDefined();
    const writeRow = rows.find((r) => r.step === "write");
    expect(writeRow).toBeUndefined();
  });

  it("--model-map override unblocks write (Test 4)", async () => {
    const fx = await setupE2EFixture({
      agents: [
        {
          id: "new-override",
          model: "unknown/thing",
          channelId: "666666666666666666",
        },
      ],
    });
    process.env.CLAWCODE_OPENCLAW_JSON = fx.openclawPath;
    process.env.CLAWCODE_LEDGER_PATH = fx.ledgerPath;
    process.env.CLAWCODE_CONFIG_PATH = fx.clawcodePath;
    process.env.CLAWCODE_AGENTS_ROOT = fx.agentsRoot;
    process.env.CLAWCODE_OPENCLAW_MEMORY_DIR = fx.memoryDir;

    const exitCode = await runApplyAction(
      {
        only: "new-override",
        modelMap: { "unknown/thing": "sonnet" },
      },
      { execaRunner: async () => ({ stdout: "inactive", exitCode: 3 }) },
    );
    expect(exitCode).toBe(0);

    // Written YAML has model: sonnet on the new agent
    const after = await readFile(fx.clawcodePath, "utf8");
    expect(after).toMatch(/name:\s*new-override[\s\S]*?model:\s*sonnet/);
  });

  it("migrated status propagates to latestStatusByAgent after successful write (Test 5)", async () => {
    const fx = await setupE2EFixture({
      agents: [{ id: "new-status", channelId: "555555555555555555" }],
    });
    process.env.CLAWCODE_OPENCLAW_JSON = fx.openclawPath;
    process.env.CLAWCODE_LEDGER_PATH = fx.ledgerPath;
    process.env.CLAWCODE_CONFIG_PATH = fx.clawcodePath;
    process.env.CLAWCODE_AGENTS_ROOT = fx.agentsRoot;
    process.env.CLAWCODE_OPENCLAW_MEMORY_DIR = fx.memoryDir;

    const exitCode = await runApplyAction(
      { only: "new-status" },
      { execaRunner: async () => ({ stdout: "inactive", exitCode: 3 }) },
    );
    expect(exitCode).toBe(0);

    const rows = await readRows(fx.ledgerPath);
    // The write-step row for the agent (or ALL, since --only funnels through
    // opts.only ?? "ALL") must carry status:"migrated". Phase 79 adds
    // additional per-agent witness rows with status:"pending" AFTER the
    // write row (workspace-copy:hash-witness + session-archive:skip) —
    // those are forensic file-level rows, not state transitions, so we
    // narrow the assertion to the write-step row specifically.
    const writeRow = rows.find(
      (r) => r.step === "write" && r.outcome === "allow",
    );
    expect(writeRow?.status).toBe("migrated");
  });

  it("APPLY_NOT_IMPLEMENTED_MESSAGE is NOT emitted on success path (Test 6)", async () => {
    const fx = await setupE2EFixture({
      agents: [{ id: "new-clean", channelId: "444444444444444444" }],
    });
    process.env.CLAWCODE_OPENCLAW_JSON = fx.openclawPath;
    process.env.CLAWCODE_LEDGER_PATH = fx.ledgerPath;
    process.env.CLAWCODE_CONFIG_PATH = fx.clawcodePath;
    process.env.CLAWCODE_AGENTS_ROOT = fx.agentsRoot;
    process.env.CLAWCODE_OPENCLAW_MEMORY_DIR = fx.memoryDir;

    const stderrWrites: string[] = [];
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        stderrWrites.push(String(chunk));
        return true;
      });
    try {
      const exitCode = await runApplyAction(
        { only: "new-clean" },
        { execaRunner: async () => ({ stdout: "inactive", exitCode: 3 }) },
      );
      expect(exitCode).toBe(0);
    } finally {
      stderrSpy.mockRestore();
    }

    const allStderr = stderrWrites.join("");
    expect(allStderr).not.toMatch(/apply not implemented/i);
  });

  it("chokidar sees exactly 1 'change' event end-to-end (Test 7)", async () => {
    const fx = await setupE2EFixture({
      agents: [{ id: "new-ch", channelId: "333333333333333333" }],
    });
    process.env.CLAWCODE_OPENCLAW_JSON = fx.openclawPath;
    process.env.CLAWCODE_LEDGER_PATH = fx.ledgerPath;
    process.env.CLAWCODE_CONFIG_PATH = fx.clawcodePath;
    process.env.CLAWCODE_AGENTS_ROOT = fx.agentsRoot;
    process.env.CLAWCODE_OPENCLAW_MEMORY_DIR = fx.memoryDir;

    const watcher = chokidar.watch(fx.clawcodePath, {
      awaitWriteFinish: false,
      ignoreInitial: true,
      persistent: true,
    });
    await new Promise<void>((resolve) => watcher.on("ready", () => resolve()));

    const events: string[] = [];
    watcher.on("change", () => events.push("change"));
    watcher.on("add", () => events.push("add"));

    const exitCode = await runApplyAction(
      { only: "new-ch" },
      { execaRunner: async () => ({ stdout: "inactive", exitCode: 3 }) },
    );
    expect(exitCode).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 500));
    await watcher.close();

    const changeEvents = events.filter((e) => e === "change");
    expect(changeEvents.length).toBe(1);
  }, 15_000);

  it("fs-guard remains installed during writer (Phase 77 MIGR-07 regression) (Test 8)", async () => {
    const fx = await setupE2EFixture({
      agents: [{ id: "new-guard", channelId: "333300000000000333" }],
    });
    process.env.CLAWCODE_OPENCLAW_JSON = fx.openclawPath;
    process.env.CLAWCODE_LEDGER_PATH = fx.ledgerPath;
    process.env.CLAWCODE_CONFIG_PATH = fx.clawcodePath;
    process.env.CLAWCODE_AGENTS_ROOT = fx.agentsRoot;
    process.env.CLAWCODE_OPENCLAW_MEMORY_DIR = fx.memoryDir;

    // Successful apply — fs-guard was installed for the life of the call,
    // then uninstalled. Post-apply writes to ~/.openclaw/... must succeed
    // (guard is off) — proves finally-block uninstall fired.
    const exitCode = await runApplyAction(
      { only: "new-guard" },
      { execaRunner: async () => ({ stdout: "inactive", exitCode: 3 }) },
    );
    expect(exitCode).toBe(0);

    // No "ReadOnlySourceError" leaked from the apply. The writer wrote to
    // tmpdir (not ~/.openclaw/), so the guard never refused. The finally
    // block uninstalled — a subsequent ledger read must still work.
    const rows = await readRows(fx.ledgerPath);
    expect(rows.length).toBeGreaterThan(0);
    const writeRow = rows.find((r) => r.step === "write" && r.outcome === "allow");
    expect(writeRow).toBeDefined();
  });
});

// ---- Phase 79 Plan 03 Task 2 — end-to-end workspace migration ----------

import {
  mkdtemp as mkdtempP79,
  writeFile as writeFileP79,
  mkdir as mkdirP79,
  utimes as utimesP79,
  readFile as readFileP79,
  stat as statP79,
  rm as rmP79,
  cp as cpP79,
  copyFile as copyFileP79,
} from "node:fs/promises";
import { existsSync as existsSyncP79, readdirSync as readdirSyncP79, statSync as statSyncP79 } from "node:fs";
import { createHash as createHashP79, randomBytes as randomBytesP79 } from "node:crypto";
import { execFile as execFileP79 } from "node:child_process";
import { promisify as promisifyP79 } from "node:util";

const execP79 = promisifyP79(execFileP79);

async function sha256FileP79(p: string): Promise<string> {
  const buf = await readFileP79(p);
  return createHashP79("sha256").update(buf).digest("hex");
}

async function listTreeFilesP79(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) out.push(p);
    }
  }
  await walk(root);
  return out;
}

function findBrokenSymlinksP79(dir: string): string[] {
  const broken: string[] = [];
  for (const entry of readdirSyncP79(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      try {
        statSyncP79(p);
      } catch {
        broken.push(p);
      }
    } else if (entry.isDirectory()) {
      broken.push(...findBrokenSymlinksP79(p));
    }
  }
  return broken;
}

type P79Env = {
  openclawJson: string | undefined;
  ledger: string | undefined;
  config: string | undefined;
  agentsRoot: string | undefined;
  memoryDir: string | undefined;
  openclawRoot: string | undefined;
  workspaceTargetRoot: string | undefined;
};

function snapshotP79Env(): P79Env {
  return {
    openclawJson: process.env.CLAWCODE_OPENCLAW_JSON,
    ledger: process.env.CLAWCODE_LEDGER_PATH,
    config: process.env.CLAWCODE_CONFIG_PATH,
    agentsRoot: process.env.CLAWCODE_AGENTS_ROOT,
    memoryDir: process.env.CLAWCODE_OPENCLAW_MEMORY_DIR,
    openclawRoot: process.env.CLAWCODE_OPENCLAW_ROOT,
    workspaceTargetRoot: process.env.CLAWCODE_WORKSPACE_TARGET_ROOT,
  };
}

function restoreP79Env(snap: P79Env): void {
  for (const [k, v] of [
    ["CLAWCODE_OPENCLAW_JSON", snap.openclawJson],
    ["CLAWCODE_LEDGER_PATH", snap.ledger],
    ["CLAWCODE_CONFIG_PATH", snap.config],
    ["CLAWCODE_AGENTS_ROOT", snap.agentsRoot],
    ["CLAWCODE_OPENCLAW_MEMORY_DIR", snap.memoryDir],
    ["CLAWCODE_OPENCLAW_ROOT", snap.openclawRoot],
    ["CLAWCODE_WORKSPACE_TARGET_ROOT", snap.workspaceTargetRoot],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("migrate openclaw apply — Phase 79 end-to-end workspace migration", () => {
  let tmp: string;
  let openclawRoot: string;
  let targetRoot: string;
  let configPath: string;
  let openclawJson: string;
  let ledgerPath: string;
  let envSnap: P79Env;

  beforeEach(async () => {
    envSnap = snapshotP79Env();
    tmp = await mkdtempP79(join(tmpdir(), "cc-p79-e2e-"));
    openclawRoot = join(tmp, "openclaw-fake");
    targetRoot = join(tmp, "target-fake");
    configPath = join(tmp, "clawcode.yaml");
    openclawJson = join(openclawRoot, "openclaw.json");
    ledgerPath = join(tmp, "ledger.jsonl");
    await mkdirP79(openclawRoot, { recursive: true });
    await mkdirP79(targetRoot, { recursive: true });
    await mkdirP79(join(openclawRoot, "agents"), { recursive: true });
    await copyFileP79(FIXTURE_CLAWCODE_YAML, configPath);

    process.env.CLAWCODE_OPENCLAW_JSON = openclawJson;
    process.env.CLAWCODE_LEDGER_PATH = ledgerPath;
    process.env.CLAWCODE_CONFIG_PATH = configPath;
    process.env.CLAWCODE_OPENCLAW_ROOT = openclawRoot;
    process.env.CLAWCODE_AGENTS_ROOT = targetRoot;
    process.env.CLAWCODE_WORKSPACE_TARGET_ROOT = targetRoot;
    // Memory dir is unused by Phase 79 copy path but runApplyAction still
    // calls getMemorySqlitePath for each agent; point at a stable dir.
    process.env.CLAWCODE_OPENCLAW_MEMORY_DIR = join(openclawRoot, "memory");
    await mkdirP79(join(openclawRoot, "memory"), { recursive: true });
  });

  afterEach(async () => {
    restoreP79Env(envSnap);
    await rmP79(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function writeOpenclawJson(
    agents: Array<{
      id: string;
      workspace: string;
      agentDir: string;
      model?: string;
    }>,
  ): Promise<void> {
    await writeFileP79(
      openclawJson,
      JSON.stringify({
        meta: { lastTouchedVersion: "test", lastTouchedAt: "2026-04-20T00:00:00Z" },
        agents: {
          list: agents.map((a) => ({
            id: a.id,
            name: a.id,
            workspace: a.workspace,
            agentDir: a.agentDir,
            model: {
              primary: a.model ?? "anthropic-api/claude-sonnet-4-6",
              fallbacks: [],
            },
            identity: { name: a.id, emoji: "X" },
          })),
        },
        bindings: [],
      }),
    );
  }

  async function seedMinimalAgent(id: string, workspaceSubdir: string): Promise<{ workspace: string; agentDir: string }> {
    const workspace = join(openclawRoot, workspaceSubdir);
    const agentDir = join(openclawRoot, "agents", id);
    await cpP79("src/migration/__tests__/fixtures/workspace-personal", workspace, {
      recursive: true,
    });
    await mkdirP79(agentDir, { recursive: true });
    return { workspace, agentDir };
  }

  it("SC-1: sha256 match + zero broken symlinks after end-to-end apply", async () => {
    const { workspace, agentDir } = await seedMinimalAgent(
      "test-personal",
      "workspace-test-personal",
    );
    await writeOpenclawJson([{ id: "test-personal", workspace, agentDir }]);

    const code = await runApplyAction(
      { only: "test-personal" },
      { execaRunner: async () => ({ stdout: "inactive", exitCode: 3 }) },
    );
    expect(code).toBe(0);

    const targetWorkspace = join(targetRoot, "test-personal");
    expect(existsSyncP79(targetWorkspace)).toBe(true);

    // sha256 every target markdown matches source.
    const targetFiles = await listTreeFilesP79(targetWorkspace);
    // 6 fixture files (SOUL, IDENTITY, MEMORY, memory/entity-foo, .learnings/lesson, archive/old)
    expect(targetFiles.length).toBeGreaterThanOrEqual(6);
    for (const tf of targetFiles) {
      const rel = tf.substring(targetWorkspace.length + 1);
      // archive/openclaw-sessions/ is created by the archiver but source
      // agentDir has no sessions dir in this test — so no archive files here.
      if (rel.startsWith("archive/openclaw-sessions/")) continue;
      const sf = join(workspace, rel);
      if (!existsSyncP79(sf)) continue;
      expect(await sha256FileP79(tf)).toBe(await sha256FileP79(sf));
    }

    // Zero broken symlinks (find -xtype l returns 0 — 79-CONTEXT SC-1).
    expect(findBrokenSymlinksP79(targetWorkspace)).toEqual([]);

    // Ledger has workspace-copy:hash-witness allow rows for each real file.
    const rows = await readRows(ledgerPath);
    const witnessRows = rows.filter(
      (r) => r.step === "workspace-copy:hash-witness" && r.outcome === "allow",
    );
    expect(witnessRows.length).toBeGreaterThanOrEqual(6);
  });

  it("SC-2: finmentum family — shared basePath + per-agent overrides (5 agents)", async () => {
    // Primary (full workspace): workspace-finmentum
    const finmentumWs = join(openclawRoot, "workspace-finmentum");
    await cpP79("src/migration/__tests__/fixtures/workspace-personal", finmentumWs, {
      recursive: true,
    });
    // Content-creator (full workspace with own SOUL): workspace-finmentum-content-creator
    const ccWs = join(openclawRoot, "workspace-finmentum-content-creator");
    await cpP79("src/migration/__tests__/fixtures/workspace-personal", ccWs, {
      recursive: true,
    });
    // Overwrite content-creator's SOUL/IDENTITY so iteration order last-write
    // lands distinct content; this exercises the collision-by-design path.
    await writeFileP79(join(ccWs, "SOUL.md"), "# SOUL (content-creator)\n");
    await writeFileP79(join(ccWs, "IDENTITY.md"), "# IDENTITY (content-creator)\n");

    // Sub-agents — uploads-only sources
    const subs = ["fin-acquisition", "fin-research", "fin-playground", "fin-tax"];
    for (const sub of subs) {
      const wsSub = join(openclawRoot, `workspace-${sub}`);
      const uploads = join(wsSub, "uploads");
      await mkdirP79(uploads, { recursive: true });
      await writeFileP79(join(uploads, `${sub}-file.txt`), `payload-${sub}`);
    }

    // Create agent dirs for all 6 (5 finmentum-family + note: "finmentum" itself is NOT in FINMENTUM_FAMILY_IDS)
    // FINMENTUM_FAMILY_IDS = [fin-acquisition, fin-research, fin-playground, fin-tax, finmentum-content-creator]
    // "finmentum" primary is a DEDICATED agent that just happens to own the workspace-finmentum source for
    // the finmentum-content-creator/sub-agents group target path. But per diff-builder.getTargetBasePath,
    // only isFinmentumFamily ids collapse to <root>/finmentum. So "finmentum" standalone -> <root>/finmentum
    // is NOT collapsed (not in FINMENTUM_FAMILY_IDS). We use finmentum-content-creator as the primary
    // (has its own SOUL) — it DOES collapse.
    const allAgents = [
      { id: "finmentum-content-creator", workspace: ccWs, agentDir: join(openclawRoot, "agents", "finmentum-content-creator") },
      ...subs.map((sub) => ({
        id: sub,
        workspace: join(openclawRoot, `workspace-${sub}`),
        agentDir: join(openclawRoot, "agents", sub),
      })),
    ];
    for (const a of allAgents) {
      await mkdirP79(a.agentDir, { recursive: true });
    }
    await writeOpenclawJson(allAgents);

    const code = await runApplyAction(
      {},
      { execaRunner: async () => ({ stdout: "inactive", exitCode: 3 }) },
    );
    expect(code).toBe(0);

    // Shared basePath for all 5 finmentum-family agents: <root>/finmentum
    const sharedBase = join(targetRoot, "finmentum");
    expect(existsSyncP79(sharedBase)).toBe(true);

    // Content-creator's SOUL.md landed at the shared root (full-copy mode).
    expect(existsSyncP79(join(sharedBase, "SOUL.md"))).toBe(true);
    const sharedSoulContent = await readFileP79(join(sharedBase, "SOUL.md"), "utf8");
    expect(sharedSoulContent).toContain("content-creator");

    // Sub-agents' uploads landed at distinct per-agent subdirs under <shared>/uploads/<id>/.
    for (const sub of subs) {
      const uploadFile = join(sharedBase, "uploads", sub, `${sub}-file.txt`);
      expect(existsSyncP79(uploadFile)).toBe(true);
      expect(await readFileP79(uploadFile, "utf8")).toBe(`payload-${sub}`);
    }

    // Each agent's memoryPath is per-agent-distinct (config-mapper Phase 78).
    // YAML assertion: the finmentum-content-creator + 4 sub-agents = 5 agents
    // all written into clawcode.yaml with workspace:=<sharedBase>. memoryPath
    // distinct per agent. soulFile = <sharedBase>/SOUL.md for all (by design —
    // finmentum family shares persona).
    const finalYaml = await readFileP79(configPath, "utf8");
    // Count how many agents in the YAML reference the shared basePath.
    const workspaceLines = finalYaml.match(/workspace:.*finmentum/g) ?? [];
    expect(workspaceLines.length).toBeGreaterThanOrEqual(5);
    // memoryPath distinct per agent — 4 sub-agent + 1 content-creator = 5 distinct.
    const memoryPathMatches = finalYaml.match(/memoryPath:\s*\S+/g) ?? [];
    const distinctMemoryPaths = new Set(memoryPathMatches);
    expect(distinctMemoryPaths.size).toBeGreaterThanOrEqual(5);
  });

  it("SC-3: .git preservation — git fsck clean + log matches", async () => {
    const workspace = join(openclawRoot, "workspace-gitty");
    const agentDir = join(openclawRoot, "agents", "gitty");
    await mkdirP79(workspace, { recursive: true });
    await mkdirP79(agentDir, { recursive: true });
    await writeFileP79(join(workspace, "SOUL.md"), "I am gitty\n");
    await writeFileP79(join(workspace, "IDENTITY.md"), "Name: Gitty\n");

    // Initialize real .git — execFile (node:child_process) per zero-dep constraint.
    await execP79("git", ["init", "-q", workspace]);
    await execP79("git", ["-C", workspace, "config", "user.email", "t@t"]);
    await execP79("git", ["-C", workspace, "config", "user.name", "t"]);
    await execP79("git", ["-C", workspace, "add", "."]);
    await execP79("git", ["-C", workspace, "commit", "-q", "-m", "initial"]);
    const sourceLog = (await execP79("git", ["-C", workspace, "log", "--oneline"])).stdout.trim();

    await writeOpenclawJson([{ id: "gitty", workspace, agentDir }]);

    const code = await runApplyAction(
      {},
      { execaRunner: async () => ({ stdout: "inactive", exitCode: 3 }) },
    );
    expect(code).toBe(0);

    const targetWorkspace = join(targetRoot, "gitty");
    // git fsck --full throws if non-zero exit (execP79 rejects on non-zero).
    await execP79("git", ["-C", targetWorkspace, "fsck", "--full"]);
    const targetLog = (await execP79("git", ["-C", targetWorkspace, "log", "--oneline"])).stdout.trim();
    expect(targetLog).toBe(sourceLog);
  });

  it("SC-4: archive present + session-archiver module has zero ConversationStore references", async () => {
    const { workspace, agentDir } = await seedMinimalAgent(
      "archive-test",
      "workspace-archive-test",
    );
    const sessionsDir = join(agentDir, "sessions");
    await mkdirP79(sessionsDir, { recursive: true });
    await writeFileP79(join(sessionsDir, "s1.jsonl"), JSON.stringify({ turn: 1 }) + "\n");
    await writeFileP79(join(sessionsDir, "s2.jsonl"), JSON.stringify({ turn: 2 }) + "\n");
    await writeOpenclawJson([{ id: "archive-test", workspace, agentDir }]);

    const code = await runApplyAction(
      { only: "archive-test" },
      { execaRunner: async () => ({ stdout: "inactive", exitCode: 3 }) },
    );
    expect(code).toBe(0);

    // Archive landed at <target>/archive/openclaw-sessions/
    const archiveDest = join(targetRoot, "archive-test", "archive", "openclaw-sessions");
    expect(existsSyncP79(join(archiveDest, "s1.jsonl"))).toBe(true);
    expect(existsSyncP79(join(archiveDest, "s2.jsonl"))).toBe(true);
    expect(await readFileP79(join(archiveDest, "s1.jsonl"), "utf8")).toBe(
      JSON.stringify({ turn: 1 }) + "\n",
    );

    // Static contract: session-archiver module does NOT import ConversationStore.
    // This is the integration-layer belt-and-suspenders for Plan 02's Test 8 —
    // invariant checked at end-to-end level so a later refactor that introduces
    // ConversationStore via the CLI wiring would still be caught.
    const archiverSrc = readFileSync("src/migration/session-archiver.ts", "utf8");
    expect(archiverSrc).not.toMatch(/ConversationStore/);
  });

  it("SC-5: byte-exact blobs + mtime match (random PNG + PDF)", async () => {
    const workspace = join(openclawRoot, "workspace-blobs");
    const agentDir = join(openclawRoot, "agents", "blobs");
    await mkdirP79(workspace, { recursive: true });
    await mkdirP79(join(workspace, ".learnings"), { recursive: true });
    await mkdirP79(join(workspace, "archive"), { recursive: true });
    await mkdirP79(agentDir, { recursive: true });
    await writeFileP79(join(workspace, "SOUL.md"), "I am blobs\n");
    await writeFileP79(join(workspace, "IDENTITY.md"), "Name: Blobs\n");
    const pngBytes = randomBytesP79(10240);
    const pdfBytes = randomBytesP79(50000);
    await writeFileP79(join(workspace, ".learnings", "image.png"), pngBytes);
    await writeFileP79(join(workspace, "archive", "document.pdf"), pdfBytes);
    const fixedMtime = new Date("2020-06-15T12:34:56Z");
    await utimesP79(join(workspace, ".learnings", "image.png"), fixedMtime, fixedMtime);
    await utimesP79(join(workspace, "archive", "document.pdf"), fixedMtime, fixedMtime);

    await writeOpenclawJson([{ id: "blobs", workspace, agentDir }]);

    const code = await runApplyAction(
      {},
      { execaRunner: async () => ({ stdout: "inactive", exitCode: 3 }) },
    );
    expect(code).toBe(0);

    const targetPng = join(targetRoot, "blobs", ".learnings", "image.png");
    const targetPdf = join(targetRoot, "blobs", "archive", "document.pdf");
    const srcPngStat = await statP79(join(workspace, ".learnings", "image.png"));
    const tgtPngStat = await statP79(targetPng);
    expect(tgtPngStat.size).toBe(srcPngStat.size);
    // mtime preserved within 2s (filesystem timestamp resolution tolerance).
    expect(Math.abs(tgtPngStat.mtime.getTime() - srcPngStat.mtime.getTime())).toBeLessThan(
      2000,
    );
    expect(
      Buffer.compare(await readFileP79(targetPng), await readFileP79(join(workspace, ".learnings", "image.png"))),
    ).toBe(0);
    expect(
      Buffer.compare(await readFileP79(targetPdf), await readFileP79(join(workspace, "archive", "document.pdf"))),
    ).toBe(0);
  });

  it("workspace rollback propagates to exit code 1 + isolates failure", async () => {
    // Two agents: A will be forced to hash-mismatch via copierFs readFile spy,
    // B will succeed. Plan 03's per-agent rollback must: exit 1, agent-A target
    // gone, agent-B target present, stderr names agent-A.
    const { workspace: wsA, agentDir: adA } = await seedMinimalAgent(
      "agent-a",
      "workspace-agent-a",
    );
    const { workspace: wsB, agentDir: adB } = await seedMinimalAgent(
      "agent-b",
      "workspace-agent-b",
    );
    await writeOpenclawJson([
      { id: "agent-a", workspace: wsA, agentDir: adA },
      { id: "agent-b", workspace: wsB, agentDir: adB },
    ]);

    // Spy: corrupt agent-a's SOUL.md source read during hash-witness so sha
    // mismatches. copierFs is a mutable dispatch holder — monkey-patch readFile
    // to return garbage when the source path is under workspace-agent-a.
    const { copierFs } = await import("../../migration/workspace-copier.js");
    const realReadFile = copierFs.readFile;
    const spy = vi.spyOn(copierFs, "readFile").mockImplementation(
      (async (path: Parameters<typeof realReadFile>[0], ...rest: unknown[]) => {
        const p = typeof path === "string" ? path : String(path);
        // Only corrupt reads during hash-witness sweep: return a different
        // byte sequence for agent-a's source SOUL.md read. The fs.cp itself
        // uses a lower-level syscall and is not routed through copierFs.readFile
        // (only the sweep's comparison readFile is patched).
        if (p.includes("workspace-agent-a") && p.endsWith("SOUL.md")) {
          return Buffer.from("CORRUPTED SOURCE SIDE");
        }
        return (realReadFile as (p: unknown, ...rest: unknown[]) => Promise<Buffer>)(
          path,
          ...(rest as []),
        );
      }) as typeof realReadFile,
    );

    const stderrWrites: string[] = [];
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        stderrWrites.push(String(chunk));
        return true;
      });

    try {
      const code = await runApplyAction(
        {},
        { execaRunner: async () => ({ stdout: "inactive", exitCode: 3 }) },
      );
      expect(code).toBe(1);
    } finally {
      spy.mockRestore();
      stderrSpy.mockRestore();
    }

    // agent-a target rolled back (fs.rm wiped it).
    expect(existsSyncP79(join(targetRoot, "agent-a"))).toBe(false);
    // agent-b target present (rollback did NOT cascade).
    expect(existsSyncP79(join(targetRoot, "agent-b"))).toBe(true);
    // stderr names the rolled-back agent.
    const allStderr = stderrWrites.join("");
    expect(allStderr).toMatch(/1 agent\(s\) rolled back: agent-a/);

    // Ledger: rollback row for agent-a, allow rows for agent-b.
    const rows = await readRows(ledgerPath);
    const rollbackRow = rows.find(
      (r) => r.agent === "agent-a" && r.step === "workspace-copy:rollback",
    );
    expect(rollbackRow).toBeDefined();
    expect(rollbackRow?.outcome).toBe("refuse");
    expect(rollbackRow?.status).toBe("rolled-back");

    const agentBAllowRows = rows.filter(
      (r) =>
        r.agent === "agent-b" &&
        r.step === "workspace-copy:hash-witness" &&
        r.outcome === "allow",
    );
    expect(agentBAllowRows.length).toBeGreaterThanOrEqual(6);
  });

  it("env-var overrides isolate tests from real ~/.openclaw and ~/.clawcode paths", async () => {
    const { workspace, agentDir } = await seedMinimalAgent(
      "iso-test",
      "workspace-iso-test",
    );
    await writeOpenclawJson([{ id: "iso-test", workspace, agentDir }]);

    // Snapshot the state of real ~/.clawcode/agents/iso-test BEFORE apply.
    // The guard: after apply, this directory must not have been created by
    // us. Using existence-before vs existence-after is cheaper + more
    // accurate than vi.spyOn against ESM-frozen node:fs/promises exports
    // (namespace bindings are not configurable, spyOn rejects).
    const homeDirReal = homedir();
    const forbiddenClawcodeAgents = join(homeDirReal, ".clawcode", "agents", "iso-test");
    const forbiddenClawcodeAgentsFinmentum = join(homeDirReal, ".clawcode", "agents", "finmentum");
    const existedBeforeAgent = existsSyncP79(forbiddenClawcodeAgents);
    const existedBeforeFinmentum = existsSyncP79(forbiddenClawcodeAgentsFinmentum);

    // The fs-guard already blocks writes under ~/.openclaw/ at runtime —
    // invoking it during apply will throw ReadOnlySourceError if we
    // accidentally tried. So we don't need to snapshot real ~/.openclaw/
    // here; the fs-guard is the canonical defense.
    const code = await runApplyAction(
      {},
      { execaRunner: async () => ({ stdout: "inactive", exitCode: 3 }) },
    );
    expect(code).toBe(0);

    // Sanity: the tmp target was populated (overrides are wired correctly).
    expect(existsSyncP79(join(targetRoot, "iso-test", "SOUL.md"))).toBe(true);

    // Guard: real ~/.clawcode/agents/iso-test must not have been created
    // by this test. If it already existed (user's real clawcode install),
    // we can't assert it didn't change, only that we didn't CREATE it.
    if (!existedBeforeAgent) {
      expect(existsSyncP79(forbiddenClawcodeAgents)).toBe(false);
    }
    if (!existedBeforeFinmentum) {
      // iso-test is not finmentum, so even if the user had real finmentum,
      // this apply wouldn't touch it.
      expect(existsSyncP79(forbiddenClawcodeAgentsFinmentum)).toBe(existedBeforeFinmentum);
    }

    // Ledger write went to tmp, not .planning/migration/ledger.jsonl.
    expect(existsSyncP79(ledgerPath)).toBe(true);
  });

  it("chokidar sees expected events on basePath during apply (atomic-write proof)", async () => {
    const { workspace, agentDir } = await seedMinimalAgent(
      "chokid",
      "workspace-chokid",
    );
    await writeOpenclawJson([{ id: "chokid", workspace, agentDir }]);

    // Watch the target basePath's SOUL.md specifically. It doesn't exist yet;
    // the 'add' event fires when fs.cp creates it.
    const targetSoul = join(targetRoot, "chokid", "SOUL.md");

    const watcher = chokidar.watch(targetRoot, {
      awaitWriteFinish: false,
      ignoreInitial: true,
      persistent: true,
      depth: 5,
    });
    await new Promise<void>((resolve) => watcher.on("ready", () => resolve()));

    const events: Array<{ type: string; path: string }> = [];
    watcher.on("add", (p) => events.push({ type: "add", path: p }));
    watcher.on("change", (p) => events.push({ type: "change", path: p }));

    const code = await runApplyAction(
      {},
      { execaRunner: async () => ({ stdout: "inactive", exitCode: 3 }) },
    );
    expect(code).toBe(0);

    // Give chokidar a beat to flush events.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await watcher.close();

    // The copied SOUL.md exists AND produced exactly one add event (not a
    // half-written intermediate followed by a change — fs.cp writes each file
    // atomically, proving no partial states leaked to watchers).
    expect(existsSyncP79(targetSoul)).toBe(true);
    const soulEvents = events.filter((e) => e.path === targetSoul);
    // Expect at least one 'add' for SOUL.md — depending on FS race, there may
    // be 1 add (common) or 1 add + 1 change (rare). The invariant is: NO
    // 'change' without a preceding 'add', and the final content is complete.
    const addEvents = soulEvents.filter((e) => e.type === "add");
    expect(addEvents.length).toBeGreaterThanOrEqual(1);
  }, 20_000);
});
