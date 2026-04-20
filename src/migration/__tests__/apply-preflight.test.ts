/**
 * Unit tests for Phase 77 Plan 02 apply-preflight orchestrator.
 *
 * Pins five load-bearing invariants:
 *   1. Canonical guard order daemon → readonly → secret → channel — never
 *      reorder. Operator expectation is "fastest fail first".
 *   2. Fail-fast short-circuit — on first `pass:false`, remaining guards
 *      are NOT invoked and NOT logged. The refused guard's row IS logged.
 *   3. Every invoked guard writes exactly one ledger row BEFORE the
 *      orchestrator evaluates pass/fail. Forensic evidence survives crashes.
 *   4. `filter` (from --only <agent>) threads through to checkDaemonRunning.agent
 *      and detectChannelCollisions.filter — every ledger row carries it.
 *   5. `ts` DI pins every ledger row to the same timestamp for deterministic
 *      test assertions.
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runApplyPreflight } from "../apply-preflight.js";
import { readRows } from "../ledger.js";
import type { PlanReport, AgentPlan } from "../diff-builder.js";
import type { OpenclawSourceInventory } from "../openclaw-config-reader.js";

const FIXED_TS = () => "2026-04-20T12:00:00.000Z";
const SOURCE_HASH = "deadbeef1234";

function makeAgentPlan(overrides: Partial<AgentPlan> = {}): AgentPlan {
  return {
    sourceId: "general",
    sourceName: "general",
    sourceWorkspace: "/home/u/.openclaw/workspace-general",
    sourceAgentDir: "/home/u/.openclaw/workspace-general/agent",
    sourceModel: "claude-sonnet-4-5",
    memoryChunkCount: 0,
    memoryStatus: "empty",
    discordChannelId: "1491623782807244880",
    isFinmentumFamily: false,
    targetBasePath: "/home/u/.clawcode/agents/general",
    targetMemoryPath: "/home/u/.clawcode/agents/general",
    targetAgentName: "general",
    ...overrides,
  };
}

function makePlanReport(agents: AgentPlan[]): PlanReport {
  return {
    agents,
    warnings: [],
    sourcePath: "/tmp/openclaw.json",
    targetRoot: "/tmp/clawcode-agents",
    generatedAt: "2026-04-20T00:00:00.000Z",
    planHash: "pinned-hash",
  };
}

function makeInventory(
  bindings: { agentId: string; channelId: string }[] = [],
): OpenclawSourceInventory {
  return {
    agents: [],
    bindings: bindings.map((b) => ({
      agentId: b.agentId,
      match: {
        channel: b.channelId,
        peer: { kind: "channel", id: b.channelId },
      },
    })),
    sourcePath: "/tmp/openclaw.json",
  };
}

function writeYaml(
  dir: string,
  agents: { name: string; channels: string[] }[],
): string {
  const yaml = [
    "version: 1",
    "defaults:",
    "  model: sonnet",
    "agents:",
    ...agents.flatMap((a) => [
      `  - name: ${a.name}`,
      `    channels: [${a.channels.map((c) => `"${c}"`).join(", ")}]`,
    ]),
  ].join("\n");
  const p = join(dir, "clawcode.yaml");
  writeFileSync(p, yaml);
  return p;
}

function setupTmp() {
  const dir = mkdtempSync(join(tmpdir(), "apply-preflight-"));
  return {
    dir,
    ledgerPath: join(dir, "planning", "migration", "ledger.jsonl"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// Runner that resolves with a stdout matching the given word.
const runnerSaying = (status: "active" | "inactive" | "failed") =>
  vi.fn().mockResolvedValue({ stdout: `${status}\n`, exitCode: 0 });

describe("runApplyPreflight", () => {
  it("fail-fast on daemon refuse — remaining 3 guards NOT invoked, ledger has 1 row", async () => {
    const t = setupTmp();
    try {
      const runner = runnerSaying("active");
      const result = await runApplyPreflight({
        inventory: makeInventory(),
        report: makePlanReport([makeAgentPlan()]),
        existingConfigPath: join(t.dir, "does-not-exist.yaml"),
        ledgerPath: t.ledgerPath,
        sourceHash: SOURCE_HASH,
        ts: FIXED_TS,
        execaRunner: runner,
      });
      expect(result.exitCode).toBe(1);
      expect(result.firstRefusal?.step).toBe("pre-flight:daemon");
      expect(result.ranGuards).toEqual(["pre-flight:daemon"]);
      const rows = await readRows(t.ledgerPath);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.step).toBe("pre-flight:daemon");
      expect(rows[0]?.outcome).toBe("refuse");
    } finally {
      t.cleanup();
    }
  });

  it("fail-fast on secret refuse — daemon + readonly rows written, channel NOT called", async () => {
    const t = setupTmp();
    try {
      const runner = runnerSaying("inactive");
      const dirty = makeAgentPlan({
        sourceModel: "sk-abcdefghijklmnopqrstuvwxyz12",
      });
      const result = await runApplyPreflight({
        inventory: makeInventory(),
        report: makePlanReport([dirty]),
        existingConfigPath: join(t.dir, "clawcode.yaml"),
        ledgerPath: t.ledgerPath,
        sourceHash: SOURCE_HASH,
        ts: FIXED_TS,
        execaRunner: runner,
      });
      expect(result.exitCode).toBe(1);
      expect(result.firstRefusal?.step).toBe("pre-flight:secret");
      expect(result.ranGuards).toEqual([
        "pre-flight:daemon",
        "pre-flight:readonly",
        "pre-flight:secret",
      ]);
      const rows = await readRows(t.ledgerPath);
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.step)).toEqual([
        "pre-flight:daemon",
        "pre-flight:readonly",
        "pre-flight:secret",
      ]);
      expect(rows[2]?.outcome).toBe("refuse");
    } finally {
      t.cleanup();
    }
  });

  it("fail-fast on channel collision — all 4 rows present, reportBody has aligned-column table", async () => {
    const t = setupTmp();
    try {
      const runner = runnerSaying("inactive");
      const yamlPath = writeYaml(t.dir, [
        { name: "target-a", channels: ["111"] },
      ]);
      const inv = makeInventory([{ agentId: "general", channelId: "111" }]);
      const result = await runApplyPreflight({
        inventory: inv,
        report: makePlanReport([makeAgentPlan()]),
        existingConfigPath: yamlPath,
        ledgerPath: t.ledgerPath,
        sourceHash: SOURCE_HASH,
        ts: FIXED_TS,
        execaRunner: runner,
      });
      expect(result.exitCode).toBe(1);
      expect(result.firstRefusal?.step).toBe("pre-flight:channel");
      expect(result.firstRefusal?.reportBody).toContain("Source agent (OpenClaw)");
      expect(result.firstRefusal?.reportBody).toContain(
        "Resolution: unbind the OpenClaw side — ClawCode is the migration target.",
      );
      expect(result.ranGuards).toEqual([
        "pre-flight:daemon",
        "pre-flight:readonly",
        "pre-flight:secret",
        "pre-flight:channel",
      ]);
      const rows = await readRows(t.ledgerPath);
      expect(rows).toHaveLength(4);
      expect(rows[3]?.outcome).toBe("refuse");
    } finally {
      t.cleanup();
    }
  });

  it("all-pass — exitCode=0, all 4 ranGuards, ledger has 4 allow rows", async () => {
    const t = setupTmp();
    try {
      const runner = runnerSaying("inactive");
      const result = await runApplyPreflight({
        inventory: makeInventory(),
        report: makePlanReport([makeAgentPlan()]),
        existingConfigPath: join(t.dir, "does-not-exist.yaml"),
        ledgerPath: t.ledgerPath,
        sourceHash: SOURCE_HASH,
        ts: FIXED_TS,
        execaRunner: runner,
      });
      expect(result.exitCode).toBe(0);
      expect(result.firstRefusal).toBeUndefined();
      expect(result.ranGuards).toHaveLength(4);
      const rows = await readRows(t.ledgerPath);
      expect(rows).toHaveLength(4);
      for (const r of rows) {
        expect(r.outcome).toBe("allow");
      }
    } finally {
      t.cleanup();
    }
  });

  it("ledger rows appear in canonical order daemon → readonly → secret → channel", async () => {
    const t = setupTmp();
    try {
      const runner = runnerSaying("inactive");
      await runApplyPreflight({
        inventory: makeInventory(),
        report: makePlanReport([makeAgentPlan()]),
        existingConfigPath: join(t.dir, "does-not-exist.yaml"),
        ledgerPath: t.ledgerPath,
        sourceHash: SOURCE_HASH,
        ts: FIXED_TS,
        execaRunner: runner,
      });
      const rows = await readRows(t.ledgerPath);
      expect(rows.map((r) => r.step)).toEqual([
        "pre-flight:daemon",
        "pre-flight:readonly",
        "pre-flight:secret",
        "pre-flight:channel",
      ]);
    } finally {
      t.cleanup();
    }
  });

  it("filter='general' threads through to every guard — ledger agent column = 'general'", async () => {
    const t = setupTmp();
    try {
      const runner = runnerSaying("inactive");
      await runApplyPreflight({
        inventory: makeInventory(),
        report: makePlanReport([makeAgentPlan()]),
        existingConfigPath: join(t.dir, "does-not-exist.yaml"),
        ledgerPath: t.ledgerPath,
        sourceHash: SOURCE_HASH,
        filter: "general",
        ts: FIXED_TS,
        execaRunner: runner,
      });
      const rows = await readRows(t.ledgerPath);
      // daemon + readonly + channel all accept the filter → agent="general".
      // secret is fleet-wide by design (scans the whole PlanReport) → agent="ALL".
      expect(rows[0]?.agent).toBe("general"); // daemon
      expect(rows[1]?.agent).toBe("general"); // readonly witness
      expect(rows[2]?.agent).toBe("ALL"); // secret scan is fleet-wide
      expect(rows[3]?.agent).toBe("general"); // channel
      // daemon runner still invoked with canonical argv regardless of filter.
      expect(runner).toHaveBeenCalledWith("systemctl", [
        "--user",
        "is-active",
        "openclaw-gateway.service",
      ]);
    } finally {
      t.cleanup();
    }
  });

  it("ts DI pins every ledger row to 2026-04-20T12:00:00.000Z", async () => {
    const t = setupTmp();
    try {
      const runner = runnerSaying("inactive");
      await runApplyPreflight({
        inventory: makeInventory(),
        report: makePlanReport([makeAgentPlan()]),
        existingConfigPath: join(t.dir, "does-not-exist.yaml"),
        ledgerPath: t.ledgerPath,
        sourceHash: SOURCE_HASH,
        ts: FIXED_TS,
        execaRunner: runner,
      });
      const rows = await readRows(t.ledgerPath);
      for (const r of rows) {
        expect(r.ts).toBe("2026-04-20T12:00:00.000Z");
      }
    } finally {
      t.cleanup();
    }
  });
});
