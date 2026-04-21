/**
 * Phase 82 Plan 02 Task 2 — complete subcommand integration tests.
 *
 * Pins Success Criteria 3 + 4:
 *   SC-3 — `complete` writes `.planning/milestones/v2.1-migration-report.md`
 *          with per-agent H3 sections + cross-agent invariants + zero secrets.
 *   SC-4 — Post-complete: zero Discord channel ID overlap between
 *          openclaw.json:bindings and clawcode.yaml:agents[].channels
 *          (verified via the zeroChannelOverlap invariant in the built report).
 *
 * Scenarios:
 *   1. Happy path — zero overlap, zero duplicate origin_ids, zero secrets →
 *      exit 0; report file written with per-agent section + three `[x]`
 *      invariants; stdout "Migration complete. Report: <path>".
 *   2. Refuse on pending without --force (literal message byte-exact).
 *   3. Refuse on cross-agent channel overlap (SC-4 positive proof — when the
 *      invariant would fail, complete refuses and does NOT write the file).
 *   4. Refuse on secret in ledger warnings (stderr + file not written).
 *   5. --force bypasses refused-pending → proceeds past pending gate.
 *   6. Dispatch-holder swap — tests that the CLI surfaces built outcome
 *      and calls writeMigrationReport through the holder.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../../../memory/store.js";
import { appendRow } from "../../../migration/ledger.js";
import { REPORT_PATH_LITERAL } from "../../../migration/report-writer.js";

function randomEmbedding(): Float32Array {
  const vec = new Float32Array(384);
  for (let i = 0; i < 384; i++) vec[i] = Math.random();
  return vec;
}

function makeOpenclawJson(args: {
  agentIds: readonly string[];
  bindings: ReadonlyArray<{ agentId: string; channelId: string }>;
}): string {
  const obj = {
    meta: { lastTouchedVersion: "2026.4.15" },
    agents: {
      list: args.agentIds.map((id) => ({
        id,
        name: id,
        workspace: `/home/u/.openclaw/workspace-${id}`,
        agentDir: `/home/u/.openclaw/agents/${id}/agent`,
        model: { primary: "sonnet", fallbacks: [] },
        identity: {},
      })),
    },
    bindings: args.bindings.map((b) => ({
      agentId: b.agentId,
      match: {
        channel: "discord",
        peer: { kind: "channel", id: b.channelId },
      },
    })),
  };
  return JSON.stringify(obj, null, 2) + "\n";
}

function makeClawcodeYaml(
  agents: ReadonlyArray<{
    name: string;
    workspace: string;
    channels: readonly string[];
  }>,
): string {
  const entries = agents
    .map((a) => {
      const channelLines =
        a.channels.length > 0
          ? a.channels.map((c) => `      - "${c}"`).join("\n")
          : "";
      return `  - name: ${a.name}\n    workspace: ${a.workspace}\n    memoryPath: ${a.workspace}\n    model: sonnet\n    channels:\n${channelLines || "      []"}\n    mcpServers: []`;
    })
    .join("\n");
  return `version: 1\ndefaults:\n  model: sonnet\n  basePath: ~/.clawcode/agents\nagents:\n${entries}\n`;
}

async function seedMemoriesDb(
  dbPath: string,
  agentName: string,
  count: number,
): Promise<void> {
  const store = new MemoryStore(dbPath);
  try {
    for (let i = 0; i < count; i++) {
      store.insert(
        {
          content: `${agentName} row ${i}`,
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

async function seedLedger(
  ledgerPath: string,
  rows: ReadonlyArray<{
    agent: string;
    status: "migrated" | "verified" | "pending" | "rolled-back";
    action?: "apply" | "verify" | "cutover";
    notes?: string;
    step?: string;
    outcome?: "allow" | "refuse";
  }>,
): Promise<void> {
  const ts = "2026-04-20T10:00:00.000Z";
  for (const r of rows) {
    await appendRow(ledgerPath, {
      ts,
      action: r.action ?? "apply",
      agent: r.agent,
      status: r.status,
      source_hash: "testhash",
      notes: r.notes,
      step: r.step,
      outcome: r.outcome,
    });
  }
}

describe("Phase 82 Plan 02 — complete subcommand", () => {
  let tmp: string;
  let openclawRoot: string;
  let openclawJson: string;
  let openclawMemoryDir: string;
  let clawcodeConfigPath: string;
  let clawcodeAgentsRoot: string;
  let ledgerPath: string;
  let stdoutCapture: string[];
  let stderrCapture: string[];
  let writeStdoutSpy: ReturnType<typeof vi.spyOn>;
  let writeStderrSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cc-complete-"));
    openclawRoot = join(tmp, "openclaw-src");
    openclawJson = join(openclawRoot, "openclaw.json");
    openclawMemoryDir = join(openclawRoot, "memory");
    clawcodeConfigPath = join(tmp, "clawcode.yaml");
    clawcodeAgentsRoot = join(tmp, "cc-agents");
    ledgerPath = join(tmp, "ledger.jsonl");

    stdoutCapture = [];
    stderrCapture = [];
    writeStdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: string | Uint8Array) => {
        stdoutCapture.push(typeof chunk === "string" ? chunk : chunk.toString());
        return true;
      }) as typeof process.stdout.write);
    writeStderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(((chunk: string | Uint8Array) => {
        stderrCapture.push(typeof chunk === "string" ? chunk : chunk.toString());
        return true;
      }) as typeof process.stderr.write);
    originalEnv = { ...process.env };
    process.env.CLAWCODE_OPENCLAW_JSON = openclawJson;
    process.env.CLAWCODE_OPENCLAW_MEMORY_DIR = openclawMemoryDir;
    process.env.CLAWCODE_AGENTS_ROOT = clawcodeAgentsRoot;
    process.env.CLAWCODE_LEDGER_PATH = ledgerPath;
    process.env.CLAWCODE_CONFIG_PATH = clawcodeConfigPath;
    process.env.CLAWCODE_OPENCLAW_ROOT = openclawRoot;
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
  });

  afterEach(() => {
    writeStdoutSpy.mockRestore();
    writeStderrSpy.mockRestore();
    rmSync(tmp, { recursive: true, force: true });
    process.env = originalEnv;
  });

  // --- SC-3 Happy Path ---------------------------------------------------
  it("SC-3: happy path — writes report with per-agent section + three [x] invariants, exit 0", async () => {
    // Fixture: 2 verified agents. Zero channel overlap (openclaw binding=111,
    // clawcode channel=999). One agent fully cut over (no binding remaining).
    const alphaWorkspace = join(clawcodeAgentsRoot, "alpha");
    const betaWorkspace = join(clawcodeAgentsRoot, "beta");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(alphaWorkspace, "memory"), { recursive: true });
    mkdirSync(join(betaWorkspace, "memory"), { recursive: true });
    mkdirSync(openclawRoot, { recursive: true });
    mkdirSync(join(openclawRoot, "workspace-alpha"), { recursive: true });
    mkdirSync(join(openclawRoot, "workspace-beta"), { recursive: true });
    writeFileSync(
      join(openclawRoot, "workspace-alpha", "MEMORY.md"),
      "# Intro\n\n## Section 1\nContent\n",
    );
    writeFileSync(
      join(openclawRoot, "workspace-beta", "MEMORY.md"),
      "# Intro\n\n## Section 1\nContent\n",
    );

    await seedMemoriesDb(join(alphaWorkspace, "memory", "memories.db"), "alpha", 2);
    await seedMemoriesDb(join(betaWorkspace, "memory", "memories.db"), "beta", 2);

    // Openclaw.json with one remaining binding for beta (alpha already cut over).
    writeFileSync(
      openclawJson,
      makeOpenclawJson({
        agentIds: ["alpha", "beta"],
        bindings: [{ agentId: "beta", channelId: "111" }],
      }),
    );
    writeFileSync(
      clawcodeConfigPath,
      makeClawcodeYaml([
        { name: "alpha", workspace: alphaWorkspace, channels: ["999"] },
        { name: "beta", workspace: betaWorkspace, channels: ["888"] },
      ]),
    );

    await seedLedger(ledgerPath, [
      { agent: "alpha", status: "verified", action: "verify" },
      { agent: "beta", status: "verified", action: "verify" },
    ]);

    // Swap writeMigrationReport to land at a tmp path so we don't pollute
    // .planning/ in the repo.
    const mod = await import("../migrate-openclaw.js");
    const origWrite = mod.migrateOpenclawHandlers.writeMigrationReport;
    const capturedReportPath = join(tmp, "v2.1-migration-report.md");
    const wrappedWrite = vi.fn(
      async (
        built: Parameters<typeof origWrite>[0],
      ) => origWrite(built, capturedReportPath),
    );
    (mod.migrateOpenclawHandlers as unknown as {
      writeMigrationReport: typeof wrappedWrite;
    }).writeMigrationReport = wrappedWrite;

    try {
      const code = await mod.migrateOpenclawHandlers.runCompleteAction({});
      expect(code).toBe(0);
      expect(wrappedWrite).toHaveBeenCalledTimes(1);
      expect(existsSync(capturedReportPath)).toBe(true);

      const md = readFileSync(capturedReportPath, "utf8");
      // Per-agent H3 sections for both
      expect(md).toMatch(/### alpha\b/);
      expect(md).toMatch(/### beta\b/);
      // Cross-agent invariants: three [x] lines
      const xCount = (md.match(/^- \[x\]/gm) ?? []).length;
      expect(xCount).toBe(3);
      expect(md).toContain("Zero Discord channel IDs");

      // stdout has the literal success line
      const out = stdoutCapture.join("");
      expect(out).toContain("Migration complete. Report:");
    } finally {
      (mod.migrateOpenclawHandlers as unknown as {
        writeMigrationReport: typeof origWrite;
      }).writeMigrationReport = origWrite;
    }
  });

  // --- Refuse-pending without --force ------------------------------------
  it("refuse-pending: exit 1, literal message byte-exact, no write to REPORT_PATH_LITERAL", async () => {
    const alphaWorkspace = join(clawcodeAgentsRoot, "alpha");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(alphaWorkspace, "memory"), { recursive: true });
    mkdirSync(openclawRoot, { recursive: true });

    writeFileSync(
      openclawJson,
      makeOpenclawJson({ agentIds: ["alpha"], bindings: [] }),
    );
    writeFileSync(
      clawcodeConfigPath,
      makeClawcodeYaml([
        { name: "alpha", workspace: alphaWorkspace, channels: ["999"] },
      ]),
    );
    await seedLedger(ledgerPath, [
      { agent: "alpha", status: "pending", action: "apply" },
    ]);

    const mod = await import("../migrate-openclaw.js");
    // Swap writeMigrationReport to fail loudly if called (must NOT be called
    // on refuse-pending).
    const origWrite = mod.migrateOpenclawHandlers.writeMigrationReport;
    const wrappedWrite = vi.fn(async () => {
      throw new Error("writeMigrationReport must not be called on refuse-pending");
    });
    (mod.migrateOpenclawHandlers as unknown as {
      writeMigrationReport: typeof wrappedWrite;
    }).writeMigrationReport = wrappedWrite;

    try {
      const code = await mod.migrateOpenclawHandlers.runCompleteAction({
        force: false,
      });
      expect(code).toBe(1);
      expect(wrappedWrite).not.toHaveBeenCalled();

      const err = stderrCapture.join("");
      // Byte-exact literal (locked per D-07).
      expect(err).toContain(
        "Cannot complete: 1 agent(s) still pending. Run apply + verify first, or pass --force to acknowledge gaps.",
      );
    } finally {
      (mod.migrateOpenclawHandlers as unknown as {
        writeMigrationReport: typeof origWrite;
      }).writeMigrationReport = origWrite;
    }
  });

  // --- --force bypasses refused-pending ----------------------------------
  it("--force: bypasses refused-pending gate (does NOT hit the pending refuse branch)", async () => {
    const alphaWorkspace = join(clawcodeAgentsRoot, "alpha");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(alphaWorkspace, "memory"), { recursive: true });
    mkdirSync(openclawRoot, { recursive: true });

    writeFileSync(
      openclawJson,
      makeOpenclawJson({ agentIds: ["alpha"], bindings: [] }),
    );
    writeFileSync(
      clawcodeConfigPath,
      makeClawcodeYaml([
        { name: "alpha", workspace: alphaWorkspace, channels: ["999"] },
      ]),
    );
    await seedLedger(ledgerPath, [
      { agent: "alpha", status: "pending", action: "apply" },
    ]);

    const mod = await import("../migrate-openclaw.js");
    // Capture buildMigrationReport call so we can inspect what CLI passed
    // (forceOnPending should be true).
    const origBuild = mod.migrateOpenclawHandlers.buildMigrationReport;
    const wrappedBuild = vi.fn(origBuild);
    (mod.migrateOpenclawHandlers as unknown as {
      buildMigrationReport: typeof wrappedBuild;
    }).buildMigrationReport = wrappedBuild;

    // Prevent an accidental real write — swap writeMigrationReport to a no-op
    // tmp writer.
    const origWrite = mod.migrateOpenclawHandlers.writeMigrationReport;
    const capturedReportPath = join(tmp, "v2.1-migration-report.md");
    (mod.migrateOpenclawHandlers as unknown as {
      writeMigrationReport: typeof origWrite;
    }).writeMigrationReport = (async (built: Parameters<typeof origWrite>[0]) =>
      origWrite(built, capturedReportPath)) as typeof origWrite;

    try {
      await mod.migrateOpenclawHandlers.runCompleteAction({ force: true });
      expect(wrappedBuild).toHaveBeenCalledTimes(1);
      const calls = wrappedBuild.mock.calls as unknown as Array<
        [{ forceOnPending?: boolean }]
      >;
      expect(calls[0]![0].forceOnPending).toBe(true);
      // The CLI should not have emitted the refused-pending literal.
      const err = stderrCapture.join("");
      expect(err).not.toContain("Cannot complete: 1 agent(s) still pending");
    } finally {
      (mod.migrateOpenclawHandlers as unknown as {
        buildMigrationReport: typeof origBuild;
      }).buildMigrationReport = origBuild;
      (mod.migrateOpenclawHandlers as unknown as {
        writeMigrationReport: typeof origWrite;
      }).writeMigrationReport = origWrite;
    }
  });

  // --- SC-4 Cross-agent channel overlap refusal --------------------------
  it("SC-4: cross-agent channel overlap → exit 1, failing invariants listed, no file written", async () => {
    const alphaWorkspace = join(clawcodeAgentsRoot, "alpha");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(alphaWorkspace, "memory"), { recursive: true });
    mkdirSync(openclawRoot, { recursive: true });
    mkdirSync(join(openclawRoot, "workspace-alpha"), { recursive: true });

    await seedMemoriesDb(
      join(alphaWorkspace, "memory", "memories.db"),
      "alpha",
      1,
    );

    // Intentional overlap: openclaw.json has binding channel=777;
    // clawcode.yaml declares agent alpha on channel=777.
    const SHARED = "7777777777";
    writeFileSync(
      openclawJson,
      makeOpenclawJson({
        agentIds: ["alpha"],
        bindings: [{ agentId: "alpha", channelId: SHARED }],
      }),
    );
    writeFileSync(
      clawcodeConfigPath,
      makeClawcodeYaml([
        { name: "alpha", workspace: alphaWorkspace, channels: [SHARED] },
      ]),
    );
    await seedLedger(ledgerPath, [
      { agent: "alpha", status: "verified", action: "verify" },
    ]);

    const mod = await import("../migrate-openclaw.js");
    const origWrite = mod.migrateOpenclawHandlers.writeMigrationReport;
    const wrappedWrite = vi.fn(async () => {
      throw new Error("writeMigrationReport must not be called on refuse-invariants");
    });
    (mod.migrateOpenclawHandlers as unknown as {
      writeMigrationReport: typeof wrappedWrite;
    }).writeMigrationReport = wrappedWrite;

    try {
      const code = await mod.migrateOpenclawHandlers.runCompleteAction({});
      expect(code).toBe(1);
      expect(wrappedWrite).not.toHaveBeenCalled();
      const err = stderrCapture.join("");
      expect(err).toMatch(/Cannot complete: cross-agent invariant/);
      expect(err).toContain("zeroChannelOverlap");
    } finally {
      (mod.migrateOpenclawHandlers as unknown as {
        writeMigrationReport: typeof origWrite;
      }).writeMigrationReport = origWrite;
    }
  });

  // --- SC-4 Zero overlap positive proof ----------------------------------
  it("SC-4 (positive): post-cutover scenario — zero channel overlap → invariant [x], file written", async () => {
    // After cutover ran: openclaw.json has ZERO bindings for alpha;
    // clawcode.yaml has alpha on channel 999. Overlap = empty → pass.
    const alphaWorkspace = join(clawcodeAgentsRoot, "alpha");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(alphaWorkspace, "memory"), { recursive: true });
    mkdirSync(openclawRoot, { recursive: true });
    mkdirSync(join(openclawRoot, "workspace-alpha"), { recursive: true });
    writeFileSync(
      join(openclawRoot, "workspace-alpha", "MEMORY.md"),
      "# Intro\n\n## Section 1\nOne\n",
    );
    await seedMemoriesDb(
      join(alphaWorkspace, "memory", "memories.db"),
      "alpha",
      1,
    );

    writeFileSync(
      openclawJson,
      makeOpenclawJson({ agentIds: ["alpha"], bindings: [] }),
    );
    writeFileSync(
      clawcodeConfigPath,
      makeClawcodeYaml([
        { name: "alpha", workspace: alphaWorkspace, channels: ["999"] },
      ]),
    );
    await seedLedger(ledgerPath, [
      { agent: "alpha", status: "verified", action: "verify" },
    ]);

    const mod = await import("../migrate-openclaw.js");
    const origWrite = mod.migrateOpenclawHandlers.writeMigrationReport;
    const capturedReportPath = join(tmp, "v2.1-migration-report.md");
    (mod.migrateOpenclawHandlers as unknown as {
      writeMigrationReport: typeof origWrite;
    }).writeMigrationReport = (async (built: Parameters<typeof origWrite>[0]) =>
      origWrite(built, capturedReportPath)) as typeof origWrite;

    try {
      const code = await mod.migrateOpenclawHandlers.runCompleteAction({});
      expect(code).toBe(0);
      expect(existsSync(capturedReportPath)).toBe(true);
      const md = readFileSync(capturedReportPath, "utf8");
      expect(md).toContain(
        "- [x] Zero Discord channel IDs present in both",
      );
    } finally {
      (mod.migrateOpenclawHandlers as unknown as {
        writeMigrationReport: typeof origWrite;
      }).writeMigrationReport = origWrite;
    }
  });

  // --- SC-3 secret-shape refusal -----------------------------------------
  it("SC-3 (secret): sk- prefix in ledger warnings → exit 1, stderr 'secret-shaped', no file written", async () => {
    const alphaWorkspace = join(clawcodeAgentsRoot, "alpha");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(alphaWorkspace, "memory"), { recursive: true });
    mkdirSync(openclawRoot, { recursive: true });
    mkdirSync(join(openclawRoot, "workspace-alpha"), { recursive: true });

    await seedMemoriesDb(
      join(alphaWorkspace, "memory", "memories.db"),
      "alpha",
      1,
    );

    writeFileSync(
      openclawJson,
      makeOpenclawJson({ agentIds: ["alpha"], bindings: [] }),
    );
    writeFileSync(
      clawcodeConfigPath,
      makeClawcodeYaml([
        { name: "alpha", workspace: alphaWorkspace, channels: ["999"] },
      ]),
    );
    // Inject a secret-shape string into ledger notes via a refuse row —
    // report-writer picks these up as warnings for the per-agent section.
    await seedLedger(ledgerPath, [
      { agent: "alpha", status: "verified", action: "verify" },
      {
        agent: "alpha",
        action: "apply",
        status: "pending",
        step: "pre-flight:secret",
        outcome: "refuse",
        notes: "sk-abcdefghijklmnopqrstuvwxyz12",
      },
    ]);

    const mod = await import("../migrate-openclaw.js");
    const origWrite = mod.migrateOpenclawHandlers.writeMigrationReport;
    const wrappedWrite = vi.fn(async () => {
      throw new Error("writeMigrationReport must not be called on refuse-secret");
    });
    (mod.migrateOpenclawHandlers as unknown as {
      writeMigrationReport: typeof wrappedWrite;
    }).writeMigrationReport = wrappedWrite;

    try {
      const code = await mod.migrateOpenclawHandlers.runCompleteAction({
        force: true, // pending agent is only there if we'd refuse-pending; we force past that to hit secret gate
      });
      // The fixture has one verified + one refused-pending-aggregate for
      // alpha — latestStatusByAgent returns the LAST appended row, which is
      // the "pending" refuse row. --force bypasses refused-pending so we
      // reach the secret scan gate.
      expect(code).toBe(1);
      expect(wrappedWrite).not.toHaveBeenCalled();
      const err = stderrCapture.join("");
      expect(err).toContain("secret-shaped value detected");
    } finally {
      (mod.migrateOpenclawHandlers as unknown as {
        writeMigrationReport: typeof origWrite;
      }).writeMigrationReport = origWrite;
    }
  });

  // --- Dispatch holder smoke test ----------------------------------------
  it("dispatch holder has buildMigrationReport + writeMigrationReport + runCompleteAction", async () => {
    const mod = await import("../migrate-openclaw.js");
    expect(typeof mod.migrateOpenclawHandlers.buildMigrationReport).toBe(
      "function",
    );
    expect(typeof mod.migrateOpenclawHandlers.writeMigrationReport).toBe(
      "function",
    );
    expect(typeof mod.migrateOpenclawHandlers.runCompleteAction).toBe(
      "function",
    );
  });

  // --- REPORT_PATH_LITERAL cross-check -----------------------------------
  it("REPORT_PATH_LITERAL is the locked report path literal (D-06)", () => {
    expect(REPORT_PATH_LITERAL).toBe(
      ".planning/milestones/v2.1-migration-report.md",
    );
  });
});
