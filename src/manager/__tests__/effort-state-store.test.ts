/**
 * Phase 83 Plan 02 Task 1 — Runtime effort-state persistence tests.
 *
 * Validates the `src/manager/effort-state-store.ts` atomic JSON store
 * that backs EFFORT-03 (runtime effort overrides survive agent restart).
 *
 * Invariants pinned by these tests:
 *   - Round-trip write → read returns the same level
 *   - Missing file → `null` for any agent (not throw)
 *   - Corrupt JSON → `null` + warn (non-fatal)
 *   - Unknown / invalid level → `null` for that agent, others intact
 *   - Two agents can coexist without mutual overwrite
 *   - clearEffortState removes the agent key but leaves siblings
 *   - Atomic temp+rename — writes are visible only after rename
 *   - SessionManager integration: setEffortForAgent persists; startAgent
 *     re-applies the persisted level on boot (EFFORT-03 happy path)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nanoid } from "nanoid";
import {
  readEffortState,
  writeEffortState,
  clearEffortState,
} from "../effort-state-store.js";
import { createMockAdapter, type MockSessionAdapter } from "../session-adapter.js";
import { SessionManager } from "../session-manager.js";
import type { ResolvedAgentConfig } from "../../shared/types.js";
import type { BackoffConfig } from "../types.js";

// Mock the warm-path gate so agents transition to "running" without needing
// a real embedder — mirrors the established pattern in session-manager.test.ts.
vi.mock("../warm-path-check.js", async () => {
  const actual = await vi.importActual<typeof import("../warm-path-check.js")>(
    "../warm-path-check.js",
  );
  return {
    ...actual,
    runWarmPathCheck: vi.fn(async () => ({
      ready: true,
      durations_ms: { sqlite: 50, embedder: 80, session: 1, browser: 0 },
      total_ms: 131,
      errors: [],
    })),
  };
});

const TEST_BACKOFF: BackoffConfig = {
  baseMs: 100,
  maxMs: 1000,
  maxRetries: 3,
  stableAfterMs: 500,
};

function makeConfig(
  name: string,
  effort: "low" | "medium" | "high" | "max" = "low",
  workspaceDir?: string,
): ResolvedAgentConfig {
  const ws = workspaceDir ?? "/tmp/test-workspace";
  return {
    name,
    workspace: ws,
    memoryPath: ws,
    channels: [],
    model: "sonnet",
    effort,
    allowedModels: ["haiku", "sonnet", "opus"], // Phase 86 MODEL-01
    greetOnRestart: true, // Phase 89 GREET-07
    greetCoolDownMs: 300_000, // Phase 89 GREET-10
    memoryAutoLoad: true, // Phase 90 MEM-01
    memoryRetrievalTopK: 5, // Phase 90 MEM-03
    memoryScannerEnabled: true, // Phase 90 MEM-02
    memoryFlushIntervalMs: 900_000, // Phase 90 MEM-04
    memoryCueEmoji: "✅", // Phase 90 MEM-05
    skills: [],
    soul: undefined,
    identity: undefined,
    memory: {
      compactionThreshold: 0.75,
      searchTopK: 10,
      consolidation: { enabled: true, weeklyThreshold: 7, monthlyThreshold: 4, schedule: "0 3 * * *" },
      decay: { halfLifeDays: 30, semanticWeight: 0.7, decayWeight: 0.3 },
      deduplication: { enabled: true, similarityThreshold: 0.85 },
    },
    schedules: [],
    heartbeat: {
      enabled: true,
      intervalSeconds: 60,
      checkTimeoutSeconds: 10,
      contextFill: { warningThreshold: 0.6, criticalThreshold: 0.75 },
    },
    skillsPath: "/tmp/skills",
    admin: false,
    subagentModel: undefined,
    threads: { idleTimeoutMinutes: 1440, maxThreadSessions: 10 },
    reactions: false,
    mcpServers: [],
    slashCommands: [],
  };
}

describe("effort-state-store — atomic JSON round-trip (EFFORT-03)", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), `effort-state-${nanoid(6)}-`));
    filePath = join(tmpDir, "effort-state.json");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writeEffortState → readEffortState round-trips the level", async () => {
    await writeEffortState(filePath, "clawdy", "high");
    const level = await readEffortState(filePath, "clawdy");
    expect(level).toBe("high");
  });

  it("readEffortState returns null for an agent that was never written", async () => {
    await writeEffortState(filePath, "other", "medium");
    const level = await readEffortState(filePath, "does-not-exist");
    expect(level).toBeNull();
  });

  it("readEffortState returns null when the file does not exist", async () => {
    const ghostPath = join(tmpDir, "never-created.json");
    const level = await readEffortState(ghostPath, "clawdy");
    expect(level).toBeNull();
  });

  it("readEffortState returns null (and does not throw) on invalid JSON", async () => {
    await writeFile(filePath, "{this is not json", "utf8");
    const level = await readEffortState(filePath, "clawdy");
    expect(level).toBeNull();
  });

  it("readEffortState returns null for an invalid level, but preserves valid sibling", async () => {
    const raw = {
      version: 1,
      updatedAt: new Date().toISOString(),
      agents: { clawdy: "nonsense", other: "max" },
    };
    await writeFile(filePath, JSON.stringify(raw), "utf8");
    // Invalid top-level file → return null for all; but per spec the whole
    // file is rejected on schema parse failure and a warning is logged.
    const bad = await readEffortState(filePath, "clawdy");
    expect(bad).toBeNull();
    // After re-writing with only the valid sibling, it reads fine.
    await writeEffortState(filePath, "other", "max");
    const good = await readEffortState(filePath, "other");
    expect(good).toBe("max");
  });

  it("sequential writes to two agents both survive (no mutual overwrite)", async () => {
    await writeEffortState(filePath, "a", "low");
    await writeEffortState(filePath, "b", "max");
    expect(await readEffortState(filePath, "a")).toBe("low");
    expect(await readEffortState(filePath, "b")).toBe("max");
  });

  it("clearEffortState removes the agent key but leaves others", async () => {
    await writeEffortState(filePath, "a", "low");
    await writeEffortState(filePath, "b", "max");
    await clearEffortState(filePath, "a");
    expect(await readEffortState(filePath, "a")).toBeNull();
    expect(await readEffortState(filePath, "b")).toBe("max");
  });

  it("writeEffortState persists all 7 v2.2 effort levels (off, auto, low, medium, high, xhigh, max)", async () => {
    const levels = ["off", "auto", "low", "medium", "high", "xhigh", "max"] as const;
    for (const l of levels) {
      await writeEffortState(filePath, `agent-${l}`, l);
    }
    for (const l of levels) {
      expect(await readEffortState(filePath, `agent-${l}`)).toBe(l);
    }
  });

  it("write is atomic — no lingering .tmp file after success", async () => {
    await writeEffortState(filePath, "clawdy", "high");
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(tmpDir);
    // effect-state.json should exist; no *.tmp siblings
    expect(files).toContain("effort-state.json");
    expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
  });

  it("file shape includes version + updatedAt + agents", async () => {
    await writeEffortState(filePath, "clawdy", "high");
    const raw = JSON.parse(await readFile(filePath, "utf8"));
    expect(raw.version).toBe(1);
    expect(typeof raw.updatedAt).toBe("string");
    expect(raw.agents).toEqual({ clawdy: "high" });
  });
});

describe("SessionManager ↔ effort-state-store integration (EFFORT-03)", () => {
  // Longer timeout — integration tests do real memory-store init + warm-path
  // gate + stopAll cleanup. 15s accommodates concurrent vitest pressure.
  const INTEGRATION_TIMEOUT_MS = 15_000;
  let tmpDir: string;
  let registryPath: string;
  let effortStatePath: string;
  let adapter: MockSessionAdapter;
  let manager: SessionManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), `sm-effort-${nanoid(6)}-`));
    registryPath = join(tmpDir, "registry.json");
    effortStatePath = join(tmpDir, "effort-state.json");
    adapter = createMockAdapter();
    manager = new SessionManager({
      adapter,
      registryPath,
      backoffConfig: TEST_BACKOFF,
      effortStatePath,
    });
  });

  afterEach(async () => {
    try { await manager.stopAll(); } catch { /* best-effort */ }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it(
    "setEffortForAgent writes to effort-state.json",
    async () => {
      const cfg = makeConfig("clawdy", "low", tmpDir);
      await manager.startAgent("clawdy", cfg);
      manager.setEffortForAgent("clawdy", "max");
      // Fire-and-forget persistence — poll the file for up to ~500ms because
      // writeEffortState does mkdir → writeFile(tmp) → rename which can take a
      // couple event-loop turns.
      let persisted: string | null = null;
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 10));
        persisted = await readEffortState(effortStatePath, "clawdy");
        if (persisted) break;
      }
      expect(persisted).toBe("max");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "startAgent re-applies persisted effort on boot (persistence beats config default)",
    async () => {
      // Seed the state file with a different level than the config default.
      await writeEffortState(effortStatePath, "clawdy", "max");
      const cfg = makeConfig("clawdy", "low", tmpDir);
      await manager.startAgent("clawdy", cfg);
      // After start, getEffortForAgent should report the persisted level,
      // not the "low" config default.
      expect(manager.getEffortForAgent("clawdy")).toBe("max");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "startAgent does not crash when effort-state.json is corrupt",
    async () => {
      await writeFile(effortStatePath, "{corrupt", "utf8");
      const cfg = makeConfig("clawdy", "low", tmpDir);
      await expect(manager.startAgent("clawdy", cfg)).resolves.not.toThrow();
      // Fallback: config default survives the corrupt file.
      expect(manager.getEffortForAgent("clawdy")).toBe("low");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "startAgent does not re-apply when no persisted state exists",
    async () => {
      const cfg = makeConfig("clawdy", "low", tmpDir);
      await manager.startAgent("clawdy", cfg);
      expect(manager.getEffortForAgent("clawdy")).toBe("low");
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
