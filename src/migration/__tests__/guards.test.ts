/**
 * Unit tests for Phase 77 Plan 02 pre-flight guards.
 *
 * Proves the load-bearing literal-string + behavior invariants:
 *   1. DAEMON_REFUSE_MESSAGE / SECRET_REFUSE_MESSAGE are EXACT copy from
 *      77-CONTEXT — any drift breaks phase success criteria.
 *   2. Each of the 4 guards produces a ledger row carrying `step` + `outcome`
 *      (Phase 77 Plan 01 schema extension) + never throws on a standard
 *      failure path (collisions / secrets / daemon-running are data, not
 *      exceptions — read-only guard IS an exception by design).
 *   3. assertReadOnlySource treats ~/.openclaw/ and its entire subtree as a
 *      refused write zone — similar-prefix dirs (e.g. ~/.openclaw-backup/)
 *      are NOT under the ban.
 *   4. scanSecrets is fail-fast on the first secret-shaped value encountered,
 *      with the offending path encoded in ledgerRow.notes.
 *   5. detectChannelCollisions returns an aligned-column report with header,
 *      separator, per-collision rows, and a footer with the resolution hint.
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  checkDaemonRunning,
  scanSecrets,
  detectChannelCollisions,
  assertReadOnlySource,
  ReadOnlySourceError,
  computeShannonEntropy,
  DAEMON_REFUSE_MESSAGE,
  SECRET_REFUSE_MESSAGE,
  SYSTEMD_FALLBACK_MESSAGE,
} from "../guards.js";
import type { PlanReport, AgentPlan } from "../diff-builder.js";
import type { OpenclawSourceInventory } from "../openclaw-config-reader.js";

// Deterministic ts for every test — pins ledger rows byte-stable.
const FIXED_TS = () => "2026-04-20T12:00:00.000Z";
const SOURCE_HASH = "deadbeef1234";

// ---- Helpers ---------------------------------------------------------

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
    "defaults:",
    "  model: claude-sonnet-4-5",
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

// ---- checkDaemonRunning (5 tests) -----------------------------------

describe("checkDaemonRunning", () => {
  it("refuses with DAEMON_REFUSE_MESSAGE when systemctl reports 'active'", async () => {
    const runner = vi
      .fn()
      .mockResolvedValue({ stdout: "active\n", exitCode: 0 });
    const result = await checkDaemonRunning({
      ts: FIXED_TS,
      agent: "ALL",
      source_hash: SOURCE_HASH,
      execaRunner: runner,
    });
    expect(result.pass).toBe(false);
    expect(result.message).toBe(DAEMON_REFUSE_MESSAGE);
    expect(result.ledgerRow.step).toBe("pre-flight:daemon");
    expect(result.ledgerRow.outcome).toBe("refuse");
    expect(result.ledgerRow.agent).toBe("ALL");
    expect(result.ledgerRow.ts).toBe("2026-04-20T12:00:00.000Z");
    expect(result.ledgerRow.source_hash).toBe(SOURCE_HASH);
    expect(result.ledgerRow.action).toBe("apply");
    expect(result.ledgerRow.status).toBe("pending");
  });

  it("allows when systemctl reports 'inactive'", async () => {
    const runner = vi
      .fn()
      .mockResolvedValue({ stdout: "inactive\n", exitCode: 3 });
    const result = await checkDaemonRunning({
      ts: FIXED_TS,
      agent: "ALL",
      source_hash: SOURCE_HASH,
      execaRunner: runner,
    });
    expect(result.pass).toBe(true);
    expect(result.ledgerRow.step).toBe("pre-flight:daemon");
    expect(result.ledgerRow.outcome).toBe("allow");
  });

  it("allows when systemctl reports 'failed' (service defined but dormant)", async () => {
    const runner = vi
      .fn()
      .mockResolvedValue({ stdout: "failed\n", exitCode: 3 });
    const result = await checkDaemonRunning({
      ts: FIXED_TS,
      agent: "ALL",
      source_hash: SOURCE_HASH,
      execaRunner: runner,
    });
    expect(result.pass).toBe(true);
    expect(result.ledgerRow.outcome).toBe("allow");
  });

  it("refuses with SYSTEMD_FALLBACK_MESSAGE when execaRunner rejects (ENOENT systemctl)", async () => {
    const runner = vi.fn().mockRejectedValue(new Error("ENOENT systemctl"));
    const result = await checkDaemonRunning({
      ts: FIXED_TS,
      agent: "ALL",
      source_hash: SOURCE_HASH,
      execaRunner: runner,
    });
    expect(result.pass).toBe(false);
    expect(result.message).toBe(SYSTEMD_FALLBACK_MESSAGE);
    expect(result.ledgerRow.step).toBe("pre-flight:daemon");
    expect(result.ledgerRow.outcome).toBe("refuse");
    expect(result.ledgerRow.notes).toContain("ENOENT systemctl");
  });

  it("invokes systemctl with the exact argv ['--user', 'is-active', 'openclaw-gateway.service']", async () => {
    const runner = vi
      .fn()
      .mockResolvedValue({ stdout: "inactive\n", exitCode: 3 });
    await checkDaemonRunning({
      ts: FIXED_TS,
      agent: "ALL",
      source_hash: SOURCE_HASH,
      execaRunner: runner,
    });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith("systemctl", [
      "--user",
      "is-active",
      "openclaw-gateway.service",
    ]);
  });
});

// ---- assertReadOnlySource (4 tests) ---------------------------------

describe("assertReadOnlySource", () => {
  it("throws ReadOnlySourceError for a path under ~/.openclaw/", () => {
    const target = join(homedir(), ".openclaw", "memory", "general.sqlite");
    let caught: unknown;
    try {
      assertReadOnlySource(target);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ReadOnlySourceError);
    const err = caught as ReadOnlySourceError;
    expect(err.name).toBe("ReadOnlySourceError");
    expect(err.attemptedPath).toBe(resolve(target));
    expect(err.message).toContain("migrator refused write under ~/.openclaw/");
  });

  it("throws for ~/.openclaw exactly (no trailing slash, boundary case)", () => {
    expect(() => assertReadOnlySource(join(homedir(), ".openclaw"))).toThrow(
      ReadOnlySourceError,
    );
  });

  it("does NOT throw for ~/.openclaw-backup/foo (similar-prefix guard)", () => {
    expect(() =>
      assertReadOnlySource(join(homedir(), ".openclaw-backup", "foo")),
    ).not.toThrow();
  });

  it("does NOT throw for ~/.clawcode/agents/personal/memory.db", () => {
    expect(() =>
      assertReadOnlySource(
        join(homedir(), ".clawcode", "agents", "personal", "memory.db"),
      ),
    ).not.toThrow();
  });
});

// ---- scanSecrets (8 tests) ------------------------------------------

describe("scanSecrets", () => {
  it("allows a plan containing a numeric-only Discord channel id", () => {
    const report = makePlanReport([makeAgentPlan({ discordChannelId: "1491623782807244880" })]);
    const result = scanSecrets({ ts: FIXED_TS, report, source_hash: SOURCE_HASH });
    expect(result.pass).toBe(true);
    expect(result.ledgerRow.step).toBe("pre-flight:secret");
    expect(result.ledgerRow.outcome).toBe("allow");
  });

  it("allows a plan containing short-ident agent names", () => {
    const report = makePlanReport([makeAgentPlan({ targetAgentName: "general", sourceId: "general" })]);
    const result = scanSecrets({ ts: FIXED_TS, report, source_hash: SOURCE_HASH });
    expect(result.pass).toBe(true);
  });

  it("refuses a plan with an sk- prefix secret, with exact SECRET_REFUSE_MESSAGE", () => {
    // Inject a secret-shaped string onto a scalar field. Use sourceModel which
    // is a free-form string per AgentPlan.
    const agent = makeAgentPlan({ sourceModel: "sk-abcdefghijklmnopqrstuvwxyz12" });
    const report = makePlanReport([agent]);
    const result = scanSecrets({ ts: FIXED_TS, report, source_hash: SOURCE_HASH });
    expect(result.pass).toBe(false);
    expect(result.message).toBe(SECRET_REFUSE_MESSAGE);
    expect(result.ledgerRow.step).toBe("pre-flight:secret");
    expect(result.ledgerRow.outcome).toBe("refuse");
    expect(result.ledgerRow.notes).toMatch(/secret-shaped at /);
  });

  it("refuses a plan with a Discord MT-prefix bot token", () => {
    const agent = makeAgentPlan({
      sourceModel: "MTQ3MDE2MjYzMDY4NDcwNDg4MQ.GLLa1Z.abcdefghijklmnop",
    });
    const report = makePlanReport([agent]);
    const result = scanSecrets({ ts: FIXED_TS, report, source_hash: SOURCE_HASH });
    expect(result.pass).toBe(false);
    expect(result.message).toBe(SECRET_REFUSE_MESSAGE);
  });

  it("allows an op:// 1Password reference in a scalar field", () => {
    const agent = makeAgentPlan({
      sourceModel: "op://clawdbot/Clawdbot Discord Token/credential",
    });
    const report = makePlanReport([agent]);
    const result = scanSecrets({ ts: FIXED_TS, report, source_hash: SOURCE_HASH });
    expect(result.pass).toBe(true);
  });

  it("refuses a high-entropy 40-char string with 4 char classes", () => {
    // 40-char string with upper + lower + digit + special, uniformly distributed
    // so shannon entropy is well over 4 bits/char.
    const highEntropy = "Ab3$Cd4%Ef5^Gh6&Ij7*Kl8(Mn9)Op0_Qr1-St2+";
    const agent = makeAgentPlan({ sourceModel: highEntropy });
    const report = makePlanReport([agent]);
    const result = scanSecrets({ ts: FIXED_TS, report, source_hash: SOURCE_HASH });
    expect(result.pass).toBe(false);
    expect(result.message).toBe(SECRET_REFUSE_MESSAGE);
  });

  it("computeShannonEntropy('aaaa') = 0 and computeShannonEntropy('abcd') = 2 (sanity)", () => {
    expect(computeShannonEntropy("aaaa")).toBe(0);
    expect(computeShannonEntropy("abcd")).toBe(2);
    expect(computeShannonEntropy("")).toBe(0);
  });

  it("walks nested arrays and reports the first offender's key path in ledgerRow.notes", () => {
    // Two agents: first clean, second carries a sk- secret. Walker must find
    // it and encode the path (e.g. agents[1].sourceModel).
    const clean = makeAgentPlan({ sourceId: "a", sourceModel: "claude-sonnet-4-5" });
    const dirty = makeAgentPlan({
      sourceId: "b",
      sourceModel: "sk-abcdefghijklmnopqrstuvwxyz12",
    });
    const report = makePlanReport([clean, dirty]);
    const result = scanSecrets({ ts: FIXED_TS, report, source_hash: SOURCE_HASH });
    expect(result.pass).toBe(false);
    expect(result.ledgerRow.notes).toMatch(/agents\[1\]\.sourceModel/);
  });
});

// ---- detectChannelCollisions (4 tests) ------------------------------

describe("detectChannelCollisions", () => {
  it("allows when the existing clawcode.yaml is missing", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ch-missing-"));
    try {
      const missing = join(tmp, "clawcode.yaml"); // not created
      const inv = makeInventory([{ agentId: "general", channelId: "111" }]);
      const result = await detectChannelCollisions({
        ts: FIXED_TS,
        inventory: inv,
        existingConfigPath: missing,
        source_hash: SOURCE_HASH,
      });
      expect(result.pass).toBe(true);
      expect(result.ledgerRow.step).toBe("pre-flight:channel");
      expect(result.ledgerRow.outcome).toBe("allow");
      expect(result.ledgerRow.notes).toContain("no existing clawcode.yaml");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("allows when there are zero overlapping channel ids", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ch-zero-"));
    try {
      const path = writeYaml(tmp, [
        { name: "target-a", channels: ["999", "888"] },
      ]);
      const inv = makeInventory([
        { agentId: "general", channelId: "111" },
        { agentId: "research", channelId: "222" },
      ]);
      const result = await detectChannelCollisions({
        ts: FIXED_TS,
        inventory: inv,
        existingConfigPath: path,
        source_hash: SOURCE_HASH,
      });
      expect(result.pass).toBe(true);
      expect(result.ledgerRow.notes).toMatch(
        /0 collisions across 2 OpenClaw channels vs 2 ClawCode channels/,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("refuses with an aligned-column report containing header, rows, and footer", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ch-collision-"));
    try {
      const path = writeYaml(tmp, [
        { name: "target-a", channels: ["111", "222"] },
        { name: "target-b", channels: ["333"] },
      ]);
      const inv = makeInventory([
        { agentId: "src-alpha", channelId: "111" },
        { agentId: "src-beta", channelId: "222" },
        { agentId: "src-gamma", channelId: "unique-999" },
      ]);
      const result = await detectChannelCollisions({
        ts: FIXED_TS,
        inventory: inv,
        existingConfigPath: path,
        source_hash: SOURCE_HASH,
      });
      expect(result.pass).toBe(false);
      expect(result.reportBody).toBeDefined();
      const body = result.reportBody!;
      expect(body).toContain("Source agent (OpenClaw)");
      expect(body).toContain("Target agent (ClawCode)");
      expect(body).toContain("Channel ID");
      expect(body).toContain("src-alpha");
      expect(body).toContain("target-a");
      expect(body).toContain("111");
      expect(body).toContain("src-beta");
      expect(body).toContain("target-a"); // target-a carries both 111 and 222
      expect(body).toContain("222");
      expect(body).toContain(
        "Resolution: unbind the OpenClaw side — ClawCode is the migration target.",
      );
      expect(result.ledgerRow.step).toBe("pre-flight:channel");
      expect(result.ledgerRow.outcome).toBe("refuse");
      expect(result.ledgerRow.notes).toMatch(/2 collisions/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("filter='general' narrows the OpenClaw side to only that agent's bindings", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ch-filter-"));
    try {
      const path = writeYaml(tmp, [
        { name: "target-a", channels: ["111", "222"] },
      ]);
      const inv = makeInventory([
        { agentId: "general", channelId: "111" }, // would collide but filter='general' keeps it
        { agentId: "research", channelId: "222" }, // filtered out
      ]);
      const result = await detectChannelCollisions({
        ts: FIXED_TS,
        inventory: inv,
        existingConfigPath: path,
        source_hash: SOURCE_HASH,
        filter: "general",
      });
      expect(result.pass).toBe(false);
      const body = result.reportBody!;
      expect(body).toContain("general");
      expect(body).toContain("111");
      expect(body).not.toContain("research");
      expect(body).not.toContain("222");
      expect(result.ledgerRow.agent).toBe("general");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
