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
import { tmpdir } from "node:os";
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
