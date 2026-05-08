/**
 * Phase 115 sub-scope 13(c) — MEMORY.md auto-load truncation surface.
 *
 * Replaces the in-prompt marker `…(truncated at 50KB cap)` with a
 * daemon-side warn log `[diag] memory-md-truncation`.
 *
 * Verifies:
 *   - When MEMORY.md > 50KB, the returned body does NOT contain the marker
 *   - When MEMORY.md > 50KB, deps.log.warn fires with the structured fields
 *   - When MEMORY.md ≤ 50KB, no truncation, no warn
 *
 * Uses the public buildSessionConfig API with a tmp workspace + a fake
 * SessionConfigDeps. We assert on the assembled stable prefix (the
 * AgentSessionConfig.systemPrompt) for marker absence and on the captured
 * warn calls for the diagnostic.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSessionConfig } from "../session-config.js";
import type { ResolvedAgentConfig } from "../../shared/types.js";

let workspace: string;

const warnCalls: Array<{ obj: Record<string, unknown>; msg?: string }> = [];

function makeMinimalConfig(name: string): ResolvedAgentConfig {
  // Cast through unknown — a minimal stub for the buildSessionConfig path
  // we exercise. The truncation block reads only `name`, `workspace`,
  // `memoryAutoLoad`, `memoryAutoLoadPath` from this config.
  return {
    name,
    workspace,
    memoryPath: workspace,
    channels: [],
    model: "haiku",
    effort: "low",
    allowedModels: ["haiku", "sonnet", "opus"],
    greetOnRestart: false,
    greetCoolDownMs: 0,
    settingSources: ["project"],
    memoryAutoLoad: true,
    memoryRetrievalTopK: 5,
    memoryScannerEnabled: false,
    memoryFlushIntervalMs: 900_000,
    memoryCueEmoji: "✅",
    autoStart: false,
    skills: [],
    soul: undefined,
    identity: undefined,
    memory: {
      compactionThreshold: 0.85,
      searchTopK: 5,
      consolidation: {
        enabled: false,
        weeklyThreshold: 7,
        monthlyThreshold: 4,
        schedule: "0 3 * * *",
      },
      decay: {
        halfLifeDays: 30,
        semanticWeight: 0.7,
        decayWeight: 0.3,
      },
      deduplication: {
        enabled: false,
        similarityThreshold: 0.95,
      },
    },
    heartbeat: {
      enabled: false,
      intervalSeconds: 60,
      checkTimeoutSeconds: 10,
      contextFill: {
        warningThreshold: 0.7,
        criticalThreshold: 0.9,
      },
    },
    skillsPath: workspace,
    schedules: [],
    admin: false,
    subagentModel: undefined,
    threads: { idleTimeoutMinutes: 60, maxThreadSessions: 5 },
    reactions: false,
    mcpServers: [],
    slashCommands: [],
  } as unknown as ResolvedAgentConfig;
}

function makeDeps(): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deps: any;
  warns: typeof warnCalls;
} {
  warnCalls.length = 0;
  const deps = {
    tierManagers: new Map(),
    skillsCatalog: { entries: [], byName: new Map() },
    allAgentConfigs: [],
    log: {
      warn(obj: Record<string, unknown>, msg?: string): void {
        warnCalls.push({ obj, msg });
      },
    },
  };
  return { deps, warns: warnCalls };
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "phase115-truncwarn-"));
  warnCalls.length = 0;
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// buildSessionConfig does heavy I/O + MCP probes — bump testTimeout for this
// suite. Each test takes 1-7s on a cold-imported module set.
describe("session-config — Phase 115 sub-scope 13(c) MEMORY.md truncation surface", () => {
  it(
    "when MEMORY.md > 50KB, body does NOT contain `(truncated at 50KB cap)` marker",
    async () => {
      // Generate 60KB of content. Use ASCII so byte-length ~ char-length.
      const big = "a".repeat(60_000);
      writeFileSync(join(workspace, "MEMORY.md"), big, "utf8");
      const { deps } = makeDeps();
      const config = makeMinimalConfig("test-agent-trunc");

      const result = await buildSessionConfig(config, deps);

      expect(result.systemPrompt).not.toContain("(truncated at 50KB cap)");
      expect(result.systemPrompt).not.toContain("…(truncated");
    },
    30_000,
  );

  it(
    "when MEMORY.md > 50KB, deps.log.warn fires with structured fields",
    async () => {
      const big = "a".repeat(60_000);
      writeFileSync(join(workspace, "MEMORY.md"), big, "utf8");
      const { deps, warns } = makeDeps();
      const config = makeMinimalConfig("test-agent-trunc-2");

      await buildSessionConfig(config, deps);

      const truncWarns = warns.filter(
        (w) => w.obj.action === "memory-md-truncation",
      );
      expect(truncWarns).toHaveLength(1);
      expect(truncWarns[0].obj).toMatchObject({
        agent: "test-agent-trunc-2",
        action: "memory-md-truncation",
      });
      expect(typeof truncWarns[0].obj.originalBytes).toBe("number");
      expect(typeof truncWarns[0].obj.capBytes).toBe("number");
      expect(truncWarns[0].obj.originalBytes).toBeGreaterThan(50_000);
      expect(truncWarns[0].msg).toBe("[diag] memory-md-truncation");
    },
    30_000,
  );

  it(
    "when MEMORY.md ≤ 50KB, no truncation and no warn fires",
    async () => {
      const small = "a".repeat(30_000);
      writeFileSync(join(workspace, "MEMORY.md"), small, "utf8");
      const { deps, warns } = makeDeps();
      const config = makeMinimalConfig("test-agent-small");

      await buildSessionConfig(config, deps);

      const truncWarns = warns.filter(
        (w) => w.obj.action === "memory-md-truncation",
      );
      expect(truncWarns).toHaveLength(0);
    },
    30_000,
  );
});
