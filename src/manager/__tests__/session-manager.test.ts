import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createMockAdapter, MockSessionHandle } from "../session-adapter.js";
import type { MockSessionAdapter } from "../session-adapter.js";
import type { ResolvedAgentConfig } from "../../shared/types.js";
import type { BackoffConfig, Registry } from "../types.js";
import { writeRegistry, readRegistry } from "../registry.js";
import { SessionManager } from "../session-manager.js";

const TEST_BACKOFF: BackoffConfig = {
  baseMs: 100,
  maxMs: 1000,
  maxRetries: 3,
  stableAfterMs: 500,
};

function makeConfig(name: string): ResolvedAgentConfig {
  return {
    name,
    workspace: "/tmp/test-workspace",
    memoryPath: "/tmp/test-workspace", // Phase 75 SHARED-01
    channels: ["#general"],
    model: "sonnet",
    effort: "low",
    skills: [],
    soul: undefined,
    identity: undefined,
    memory: { compactionThreshold: 0.75, searchTopK: 10, consolidation: { enabled: true, weeklyThreshold: 7, monthlyThreshold: 4, schedule: "0 3 * * *" }, decay: { halfLifeDays: 30, semanticWeight: 0.7, decayWeight: 0.3 }, deduplication: { enabled: true, similarityThreshold: 0.85 } },
    schedules: [],
    heartbeat: {
      enabled: true,
      intervalSeconds: 60,
      checkTimeoutSeconds: 10,
      contextFill: {
        warningThreshold: 0.6,
        criticalThreshold: 0.75,
      },
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

describe("SessionManager", () => {
  let adapter: MockSessionAdapter;
  let registryPath: string;
  let tmpDir: string;
  let manager: SessionManager;

  beforeEach(async () => {
    vi.useFakeTimers();
    adapter = createMockAdapter();
    tmpDir = await mkdtemp(join(tmpdir(), "sm-test-"));
    registryPath = join(tmpDir, "registry.json");
    manager = new SessionManager({
      adapter,
      registryPath,
      backoffConfig: TEST_BACKOFF,
    });
  });

  afterEach(async () => {
    // Stop all agents to clean up pending timers
    try {
      await manager.stopAll();
    } catch {
      // Ignore errors during cleanup
    }
    vi.clearAllTimers();
    vi.useRealTimers();
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("startAgent", () => {
    it("transitions agent from stopped to running and creates session", async () => {
      const config = makeConfig("agent-a");
      await manager.startAgent("agent-a", config);

      const registry = await readRegistry(registryPath);
      const entry = registry.entries.find((e) => e.name === "agent-a");
      expect(entry).toBeDefined();
      expect(entry!.status).toBe("running");
      expect(entry!.sessionId).toMatch(/^mock-agent-a-/);
      expect(entry!.startedAt).toBeTypeOf("number");
    });

    it("throws SessionError when agent is already running", async () => {
      const config = makeConfig("agent-a");
      await manager.startAgent("agent-a", config);
      await expect(manager.startAgent("agent-a", config)).rejects.toThrow(
        /already running/i,
      );
    });
  });

  describe("stopAgent", () => {
    it("transitions running agent to stopped and closes session", async () => {
      const config = makeConfig("agent-b");
      await manager.startAgent("agent-b", config);
      await manager.stopAgent("agent-b");

      const registry = await readRegistry(registryPath);
      const entry = registry.entries.find((e) => e.name === "agent-b");
      expect(entry).toBeDefined();
      expect(entry!.status).toBe("stopped");
      expect(entry!.sessionId).toBeNull();
    });

    it("throws SessionError when agent is not running", async () => {
      await expect(manager.stopAgent("nonexistent")).rejects.toThrow(
        /not running/i,
      );
    });
  });

  describe("restartAgent", () => {
    it("stops then starts the agent, incrementing restartCount", async () => {
      const config = makeConfig("agent-c");
      await manager.startAgent("agent-c", config);
      await manager.restartAgent("agent-c", config);

      const registry = await readRegistry(registryPath);
      const entry = registry.entries.find((e) => e.name === "agent-c");
      expect(entry).toBeDefined();
      expect(entry!.status).toBe("running");
      expect(entry!.restartCount).toBe(1);
    });
  });

  describe("startAll", () => {
    it("starts all agents from resolved configs", async () => {
      const configs = [
        makeConfig("agent-1"),
        makeConfig("agent-2"),
        makeConfig("agent-3"),
      ];
      await manager.startAll(configs);

      const registry = await readRegistry(registryPath);
      expect(registry.entries).toHaveLength(3);
      for (const entry of registry.entries) {
        expect(entry.status).toBe("running");
      }
    });

    it("continues starting other agents when one fails", async () => {
      const origCreate = adapter.createSession.bind(adapter);
      adapter.createSession = async (config) => {
        if (config.name === "fail-agent") {
          throw new Error("Simulated failure");
        }
        return origCreate(config);
      };

      const configs = [
        makeConfig("good-1"),
        makeConfig("fail-agent"),
        makeConfig("good-2"),
      ];
      await manager.startAll(configs);

      const registry = await readRegistry(registryPath);
      const running = registry.entries.filter((e) => e.status === "running");
      expect(running).toHaveLength(2);
    });
  });

  describe("stopAll", () => {
    it("stops all running agents", async () => {
      const configs = [makeConfig("s-1"), makeConfig("s-2")];
      await manager.startAll(configs);
      await manager.stopAll();

      const registry = await readRegistry(registryPath);
      for (const entry of registry.entries) {
        expect(entry.status).toBe("stopped");
      }
    });
  });

  describe("crash recovery", () => {
    it("detects crash and restarts with backoff", async () => {
      const config = makeConfig("crash-agent");
      await manager.startAgent("crash-agent", config);

      // Get the mock handle and simulate crash
      const registry1 = await readRegistry(registryPath);
      const sessionId = registry1.entries[0]!.sessionId!;
      const handle = adapter.sessions.get(sessionId) as MockSessionHandle;
      handle.simulateCrash(new Error("boom"));

      // Wait for the async crash handler to complete
      await manager._lastCrashPromise;

      // After crash, registry should show crashed
      const registry2 = await readRegistry(registryPath);
      const entry2 = registry2.entries.find((e) => e.name === "crash-agent");
      expect(entry2!.status).toBe("crashed");
      expect(entry2!.consecutiveFailures).toBe(1);

      // Advance timers past backoff delay to trigger restart
      await vi.advanceTimersByTimeAsync(TEST_BACKOFF.maxMs + 100);
      // Wait for the restart promise to resolve
      await manager._lastRestartPromise;

      const registry3 = await readRegistry(registryPath);
      const entry3 = registry3.entries.find((e) => e.name === "crash-agent");
      expect(entry3!.status).toBe("running");
    });

    it("enters failed state after max retries", async () => {
      const config = makeConfig("fail-max");
      await manager.startAgent("fail-max", config);

      // Crash maxRetries times
      for (let i = 0; i < TEST_BACKOFF.maxRetries; i++) {
        const reg = await readRegistry(registryPath);
        const entry = reg.entries.find((e) => e.name === "fail-max");
        if (!entry || entry.status !== "running") {
          break;
        }
        const sid = entry.sessionId!;
        const h = adapter.sessions.get(sid) as MockSessionHandle;
        h.simulateCrash(new Error(`crash-${i}`));

        // Wait for crash handler and any scheduled restart/markFailed
        await manager._lastCrashPromise;
        await manager._lastRestartPromise;

        if (i < TEST_BACKOFF.maxRetries - 1) {
          // Advance past backoff to trigger restart
          await vi.advanceTimersByTimeAsync(TEST_BACKOFF.maxMs + 500);
          // Wait for restart to complete
          await manager._lastRestartPromise;
        }
      }

      const finalReg = await readRegistry(registryPath);
      const finalEntry = finalReg.entries.find((e) => e.name === "fail-max");
      expect(finalEntry!.status).toBe("failed");
    });

    it("resets consecutiveFailures after stable period", async () => {
      const config = makeConfig("stable-agent");
      await manager.startAgent("stable-agent", config);

      // Crash once to get consecutiveFailures to 1
      const reg1 = await readRegistry(registryPath);
      const sid1 = reg1.entries[0]!.sessionId!;
      const h1 = adapter.sessions.get(sid1) as MockSessionHandle;
      h1.simulateCrash(new Error("crash-1"));

      // Wait for crash handler
      await manager._lastCrashPromise;

      // Advance past backoff to restart
      await vi.advanceTimersByTimeAsync(TEST_BACKOFF.maxMs + 100);
      await manager._lastRestartPromise;

      // Verify it restarted with consecutiveFailures=1
      const reg2 = await readRegistry(registryPath);
      expect(reg2.entries[0]!.consecutiveFailures).toBe(1);

      // Now advance past stability window
      await vi.advanceTimersByTimeAsync(TEST_BACKOFF.stableAfterMs + 100);
      await manager._lastStabilityPromise;

      // After stable period, consecutiveFailures should be reset
      const reg3 = await readRegistry(registryPath);
      expect(reg3.entries[0]!.consecutiveFailures).toBe(0);
    });
  });

  describe("reconcileRegistry", () => {
    it("resumes running sessions from existing registry", async () => {
      // Seed a registry with a running entry
      const seededRegistry: Registry = {
        entries: [
          {
            name: "resume-agent",
            status: "running",
            sessionId: "existing-session-1",
            startedAt: Date.now() - 60000,
            restartCount: 0,
            consecutiveFailures: 0,
            lastError: null,
            lastStableAt: null,
          },
        ],
        updatedAt: Date.now(),
      };
      await writeRegistry(registryPath, seededRegistry);

      const configs = [makeConfig("resume-agent")];
      await manager.reconcileRegistry(configs);

      // Session should be tracked
      const reg = await readRegistry(registryPath);
      const entry = reg.entries.find((e) => e.name === "resume-agent");
      expect(entry!.status).toBe("running");
      expect(entry!.sessionId).toBe("existing-session-1");
    });

    it("marks crashed when resume fails and applies restart policy", async () => {
      // Make resume fail
      adapter.resumeSession = async () => {
        throw new Error("Session not found");
      };

      const seededRegistry: Registry = {
        entries: [
          {
            name: "stale-agent",
            status: "running",
            sessionId: "stale-session-1",
            startedAt: Date.now() - 60000,
            restartCount: 0,
            consecutiveFailures: 0,
            lastError: null,
            lastStableAt: null,
          },
        ],
        updatedAt: Date.now(),
      };
      await writeRegistry(registryPath, seededRegistry);

      const configs = [makeConfig("stale-agent")];
      await manager.reconcileRegistry(configs);

      const reg = await readRegistry(registryPath);
      const entry = reg.entries.find((e) => e.name === "stale-agent");
      expect(entry!.status).toBe("crashed");
      expect(entry!.consecutiveFailures).toBe(1);
      expect(entry!.lastError).toMatch(/session not found/i);

      // Restore normal adapter behavior so restart works
      const freshAdapter = createMockAdapter();
      adapter.createSession = freshAdapter.createSession.bind(freshAdapter);

      // Advance past backoff to verify restart attempt
      await vi.advanceTimersByTimeAsync(TEST_BACKOFF.maxMs + 100);
      await manager._lastRestartPromise;

      const reg2 = await readRegistry(registryPath);
      const entry2 = reg2.entries.find((e) => e.name === "stale-agent");
      expect(entry2!.status).toBe("running");
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 56 Plan 02 — warm-path ready gate
// ---------------------------------------------------------------------------

// Spy on runWarmPathCheck so we can force ready/failed/timeout shapes without
// needing real SQLite / embedder plumbing. The test-facing signature mirrors
// the module contract (WarmPathResult frozen object). vi.mock is hoisted to
// the top of this file, so it applies to EVERY describe block — earlier
// tests (startAgent / crash recovery / startAll / reconcileRegistry) still
// get a ready result by default via the global beforeEach below.
vi.mock("../warm-path-check.js", async () => {
  const actual = await vi.importActual<typeof import("../warm-path-check.js")>(
    "../warm-path-check.js",
  );
  return {
    ...actual,
    runWarmPathCheck: vi.fn(),
  };
});

import { runWarmPathCheck, WARM_PATH_TIMEOUT_MS } from "../warm-path-check.js";

const mockedRunWarmPathCheck = vi.mocked(runWarmPathCheck);

// Global default — every test starts with warm-path check succeeding so
// pre-Phase-56 tests keep seeing `status === "running"`. Individual tests
// override via `mockResolvedValueOnce(...)` for failure + timeout paths.
beforeEach(() => {
  mockedRunWarmPathCheck.mockReset();
  mockedRunWarmPathCheck.mockResolvedValue(
    Object.freeze({
      ready: true,
      durations_ms: Object.freeze({ sqlite: 50, embedder: 80, session: 1, browser: 0 }),
      total_ms: 131,
      errors: Object.freeze([]) as readonly string[],
    }),
  );
});

function makeReadyResult(totalMs = 131) {
  return Object.freeze({
    ready: true,
    durations_ms: Object.freeze({ sqlite: 50, embedder: 80, session: 1, browser: 0 }),
    total_ms: totalMs,
    errors: Object.freeze([]) as readonly string[],
  });
}

function makeFailureResult(errors: readonly string[], totalMs = 85) {
  return Object.freeze({
    ready: false,
    durations_ms: Object.freeze({ sqlite: 20, embedder: 65, session: 0, browser: 0 }),
    total_ms: totalMs,
    errors: Object.freeze([...errors]) as readonly string[],
  });
}

describe("startAgent warm-path gate (Phase 56)", () => {
  let adapter: MockSessionAdapter;
  let registryPath: string;
  let tmpDir: string;
  let manager: SessionManager;

  beforeEach(async () => {
    vi.useFakeTimers();
    // Global beforeEach already reset + set a ready default; tests that need
    // failure shapes use mockResolvedValueOnce.
    adapter = createMockAdapter();
    tmpDir = await mkdtemp(join(tmpdir(), "sm-warm-"));
    registryPath = join(tmpDir, "registry.json");
    manager = new SessionManager({
      adapter,
      registryPath,
      backoffConfig: TEST_BACKOFF,
    });
  });

  afterEach(async () => {
    try {
      await manager.stopAll();
    } catch {
      /* cleanup */
    }
    vi.clearAllTimers();
    vi.useRealTimers();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("happy path: registry flips to running + warm_path_ready=true + readiness_ms in one atomic write", async () => {
    const config = makeConfig("warm-ok");
    mockedRunWarmPathCheck.mockResolvedValueOnce(makeReadyResult(131));

    await manager.startAgent("warm-ok", config);

    const registry = await readRegistry(registryPath);
    const entry = registry.entries.find((e) => e.name === "warm-ok");
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("running");
    expect(entry!.warm_path_ready).toBe(true);
    expect(entry!.warm_path_readiness_ms).toBe(131);
    expect(entry!.sessionId).toMatch(/^mock-warm-ok-/);
  });

  it("failure path: ready=false marks agent 'failed' with lastError prefix and removes session", async () => {
    const config = makeConfig("warm-fail");
    mockedRunWarmPathCheck.mockResolvedValueOnce(
      makeFailureResult(["embedder: not ready"]),
    );

    await manager.startAgent("warm-fail", config);

    const registry = await readRegistry(registryPath);
    const entry = registry.entries.find((e) => e.name === "warm-fail");
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("failed");
    expect(entry!.lastError).toBe("warm-path: embedder: not ready");
    expect(entry!.warm_path_ready).toBe(false);
    expect(entry!.warm_path_readiness_ms).toBe(85);

    // Session map must NOT retain the failed agent.
    expect(manager.getRunningAgents()).not.toContain("warm-fail");
  });

  it("timeout path: warm-path timeout surfaces as lastError 'warm-path: timeout after 10000ms'", async () => {
    const config = makeConfig("warm-timeout");
    mockedRunWarmPathCheck.mockResolvedValueOnce(
      makeFailureResult(["timeout after 10000ms"], 10_000),
    );

    await manager.startAgent("warm-timeout", config);

    const registry = await readRegistry(registryPath);
    const entry = registry.entries.find((e) => e.name === "warm-timeout");
    expect(entry!.status).toBe("failed");
    expect(entry!.lastError).toBe("warm-path: timeout after 10000ms");
    expect(entry!.warm_path_readiness_ms).toBe(10_000);
  });

  it("warm-path runs AFTER createSession (session probe verifies handle)", async () => {
    const config = makeConfig("warm-order");
    let sawSessionInProbe = false;
    mockedRunWarmPathCheck.mockImplementationOnce(async (deps) => {
      // When wired, the sessionProbe depends on the already-created handle
      // being non-empty. Simulate that by calling the probe and observing
      // it resolves without throwing.
      if (deps.sessionProbe) {
        await deps.sessionProbe();
        sawSessionInProbe = true;
      }
      return makeReadyResult(120);
    });

    await manager.startAgent("warm-order", config);
    expect(sawSessionInProbe).toBe(true);
  });

  it("sqliteWarm delegates to AgentMemoryManager.warmSqliteStores with the agent name", async () => {
    const config = makeConfig("warm-sqlite");
    let sqliteWarmCalledWith: string | undefined;
    mockedRunWarmPathCheck.mockImplementationOnce(async (deps) => {
      // Call it through — but replace the body so we don't need real DBs.
      // (In production it calls this.memory.warmSqliteStores; the mock
      // simply verifies the agent name is threaded through.)
      sqliteWarmCalledWith = deps.agent;
      return makeReadyResult(90);
    });

    await manager.startAgent("warm-sqlite", config);
    expect(sqliteWarmCalledWith).toBe("warm-sqlite");
  });

  it("calls runWarmPathCheck with timeoutMs=WARM_PATH_TIMEOUT_MS (10_000)", async () => {
    const config = makeConfig("warm-timeout-arg");
    mockedRunWarmPathCheck.mockResolvedValueOnce(makeReadyResult(50));

    await manager.startAgent("warm-timeout-arg", config);
    expect(mockedRunWarmPathCheck).toHaveBeenCalled();
    const args = mockedRunWarmPathCheck.mock.calls[0]![0];
    expect(args.timeoutMs).toBe(WARM_PATH_TIMEOUT_MS);
    expect(WARM_PATH_TIMEOUT_MS).toBe(10_000);
  });

  it("emits 'warm-path ready' log line with agent + total_ms + durations", async () => {
    const infoCalls: Array<{ obj: unknown; msg: string }> = [];
    const testLogger = {
      info: (obj: unknown, msg?: string) => {
        infoCalls.push({ obj, msg: msg ?? "" });
      },
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      child: () => testLogger,
    };
    const m = new SessionManager({
      adapter,
      registryPath,
      backoffConfig: TEST_BACKOFF,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      log: testLogger as any,
    });

    mockedRunWarmPathCheck.mockResolvedValueOnce(makeReadyResult(142));
    await m.startAgent("warm-log", makeConfig("warm-log"));

    const readyLog = infoCalls.find((c) => c.msg.includes("warm-path ready"));
    expect(readyLog).toBeDefined();
    const payload = readyLog!.obj as {
      agent: string;
      total_ms: number;
      durations_ms: { sqlite: number; embedder: number; session: number; browser: number };
    };
    expect(payload.agent).toBe("warm-log");
    expect(payload.total_ms).toBe(142);
    expect(payload.durations_ms).toEqual({
      sqlite: 50,
      embedder: 80,
      session: 1,
      browser: 0,
    });

    await m.stopAll();
  });
});

// ---------------------------------------------------------------------------
// Phase 66 Plan 03 — session-boundary summarization wiring
// ---------------------------------------------------------------------------
import type { SummarizeFn } from "../../memory/session-summarizer.types.js";
import { EmbeddingService } from "../../memory/embedder.js";

// Pre-warm the embedding model ONCE for the Phase 66 block so the first
// test doesn't pay the ~3-5s cold-start cost inside its 5s timeout. The
// @huggingface/transformers module caches pipelines, so subsequent
// EmbeddingService instances constructed by AgentMemoryManager reuse the
// already-loaded ONNX model from the module cache.
beforeAll(async () => {
  const warmer = new EmbeddingService();
  await warmer.warmup();
}, 60_000);

describe("SessionManager session-boundary summarization (Phase 66)", () => {
  let adapter: MockSessionAdapter;
  let registryPath: string;
  let tmpDir: string;
  let manager: SessionManager;
  let mockSummarize: ReturnType<typeof vi.fn>;

  // Per-test unique workspace so each agent gets a fresh memories.db and
  // ConversationStore. Shared /tmp/test-workspace across tests would mean
  // a previous test's sessions persist, inflating turn counts.
  function makeIsolatedConfig(name: string): ResolvedAgentConfig {
    return { ...makeConfig(name), workspace: tmpDir, memoryPath: tmpDir };
  }

  beforeEach(async () => {
    // Use REAL timers for these tests. The crash-path test awaits a real
    // promise released via releaseSummarize(), so fake timers would hang.
    vi.useRealTimers();
    adapter = createMockAdapter();
    tmpDir = await mkdtemp(join(tmpdir(), "sm-p66-"));
    registryPath = join(tmpDir, "registry.json");
    // Default mock returns a well-formed markdown summary synchronously.
    mockSummarize = vi.fn().mockResolvedValue(
      "## User Preferences\n- mock pref\n\n## Decisions\n(none)\n\n## Open Threads\n(none)\n\n## Commitments\n(none)\n",
    );
    // Warm-path check is mocked module-wide from earlier; default from the
    // outer beforeEach already returns ready=true.
    manager = new SessionManager({
      adapter,
      registryPath,
      backoffConfig: TEST_BACKOFF,
      summarizeFn: mockSummarize as unknown as SummarizeFn,
    });
  });

  afterEach(async () => {
    try {
      await manager.stopAll();
    } catch {
      /* ignore */
    }
    // The crash-path test leaves a detached summarize promise that writes
    // to memories.db after the test body returns. Give it a beat to settle
    // before rm so we don't race open SQLite handles against directory
    // removal (ENOTEMPTY on Linux when a *.db-journal sibling lingers).
    await new Promise((r) => setTimeout(r, 100));
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* directory may still contain open DB handles -- non-fatal for tests */
    }
  });

  it("stopAgent with >=3 turns triggers summarize and inserts a session-summary memory", async () => {
    const config = makeIsolatedConfig("stop-summarize");
    await manager.startAgent("stop-summarize", config);

    const convStore = manager.getConversationStore("stop-summarize")!;
    const convSessionId = manager.getActiveConversationSessionId(
      "stop-summarize",
    )!;
    expect(convStore).toBeDefined();
    expect(convSessionId).toBeTruthy();

    // Seed 4 turns (above the minTurns=3 threshold)
    for (let i = 0; i < 4; i++) {
      convStore.recordTurn({
        sessionId: convSessionId,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `turn ${i} content with enough text`,
      });
    }

    // Spy on memoryStore.insert BEFORE stopAgent (cleanupMemory closes the store).
    const memStore = manager.getMemoryStore("stop-summarize")!;
    const insertSpy = vi.spyOn(memStore, "insert");

    await manager.stopAgent("stop-summarize");

    // summarize was invoked exactly once with the agent-facing prompt
    expect(mockSummarize).toHaveBeenCalledTimes(1);
    const [prompt, opts] = mockSummarize.mock.calls[0]!;
    expect(typeof prompt).toBe("string");
    expect(prompt).toContain("## User Preferences");
    expect(opts).toHaveProperty("signal");

    // memoryStore.insert called with a session-summary entry
    const sessionSummaryCall = insertSpy.mock.calls.find(
      (call) =>
        (call[0] as { tags?: readonly string[] }).tags?.includes(
          "session-summary",
        ) ?? false,
    );
    expect(sessionSummaryCall).toBeDefined();
    const input = sessionSummaryCall![0] as {
      source: string;
      tags: readonly string[];
      sourceTurnIds?: readonly string[];
    };
    expect(input.source).toBe("conversation");
    expect(input.tags).toContain("session-summary");
    expect(input.tags).toContain(`session:${convSessionId}`);
    expect(input.sourceTurnIds).toBeDefined();
    expect(input.sourceTurnIds!.length).toBe(4);
  }, 30_000);

  it("stopAgent with <3 turns skips summarize (minTurns guard)", async () => {
    const config = makeIsolatedConfig("stop-skip");
    await manager.startAgent("stop-skip", config);

    const convStore = manager.getConversationStore("stop-skip")!;
    const convSessionId = manager.getActiveConversationSessionId(
      "stop-skip",
    )!;

    // Seed only 2 turns — below minTurns=3
    convStore.recordTurn({
      sessionId: convSessionId,
      role: "user",
      content: "first",
    });
    convStore.recordTurn({
      sessionId: convSessionId,
      role: "assistant",
      content: "second",
    });

    await manager.stopAgent("stop-skip");

    expect(mockSummarize).not.toHaveBeenCalled();
  }, 30_000);

  it("onError (crash) schedules summarize fire-and-forget: crashSession transitions state synchronously, summarize completes asynchronously", async () => {
    const config = makeIsolatedConfig("crash-summarize");
    await manager.startAgent("crash-summarize", config);

    const convStore = manager.getConversationStore("crash-summarize")!;
    const convSessionId = manager.getActiveConversationSessionId(
      "crash-summarize",
    )!;

    // Seed 4 turns so summarize will actually run (>= minTurns)
    for (let i = 0; i < 4; i++) {
      convStore.recordTurn({
        sessionId: convSessionId,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `crash turn ${i}`,
      });
    }

    // Make summarize HANG until we release it — lets us observe that crash
    // handler returns synchronously while summarize is still pending.
    let releaseSummarize: ((value: string) => void) | null = null;
    const summarizePromise = new Promise<string>((resolve) => {
      releaseSummarize = resolve;
    });
    mockSummarize.mockReturnValue(summarizePromise);

    // Get the MockSessionHandle via the existing harness pattern
    const registry = await readRegistry(registryPath);
    const entry = registry.entries.find((e) => e.name === "crash-summarize")!;
    const sessionId = entry.sessionId!;
    const handle = adapter.sessions.get(sessionId) as MockSessionHandle;
    expect(handle).toBeDefined();

    // Trigger crash — this calls onError synchronously inside MockSessionHandle
    handle.simulateCrash(new Error("simulated crash"));

    // Wait for the crash handler to complete (awaits crashSession sync work
    // + recovery.handleCrash; leaves summarize detached).
    await manager._lastCrashPromise;

    // ASSERT 1: session status transitioned to "crashed" synchronously,
    // BEFORE we release the hung summarize promise.
    const sessionAfterCrash = convStore.getSession(convSessionId);
    expect(sessionAfterCrash).not.toBeNull();
    expect(sessionAfterCrash!.status).toBe("crashed");

    // ASSERT 2: summarize was SCHEDULED (called) but has not yet resolved.
    expect(mockSummarize).toHaveBeenCalledTimes(1);

    // Now release summarize so the detached promise can complete.
    releaseSummarize!(
      "## User Preferences\n(none)\n\n## Decisions\n(none)\n\n## Open Threads\n(none)\n\n## Commitments\n(none)\n",
    );

    // Give the detached promise a few macrotasks to resolve + run markSummarized.
    await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 50));

    // ASSERT 3: summarize was called with correct prompt.
    expect(mockSummarize).toHaveBeenCalledTimes(1);
    const [prompt] = mockSummarize.mock.calls[0]!;
    expect(typeof prompt).toBe("string");
    expect(prompt).toContain("## User Preferences");

    // Manually close the memory store — crash recovery doesn't call
    // cleanupMemory, so without this the better-sqlite3 handle stays open
    // and ENOTEMPTY trips during tmpDir rm in afterEach.
    const memStore = manager.getMemoryStore("crash-summarize");
    if (memStore) {
      try { memStore.close(); } catch { /* already closed */ }
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Phase 67 Plan 03 — configDeps wiring gap-closure
// ---------------------------------------------------------------------------

// Wrap buildSessionConfig with a vi.fn that forwards to the actual impl so
// every pre-existing test keeps its real behavior (systemPrompt, hotStableToken,
// etc.). The new test below inspects mock.calls to prove that configDeps() now
// threads conversationStores + memoryStores through to the build call.
vi.mock("../session-config.js", async () => {
  const actual = await vi.importActual<typeof import("../session-config.js")>(
    "../session-config.js",
  );
  return {
    ...actual,
    buildSessionConfig: vi.fn(actual.buildSessionConfig),
  };
});

import { buildSessionConfig as _buildSessionConfigForMock } from "../session-config.js";
const mockedBuildSessionConfig = vi.mocked(_buildSessionConfigForMock);

describe("configDeps wiring — Phase 67 gap-closure", () => {
  let adapter: MockSessionAdapter;
  let registryPath: string;
  let tmpDir: string;
  let manager: SessionManager;

  beforeEach(async () => {
    vi.useRealTimers();
    // Keep the forwarding impl; only clear call history so this test's
    // assertions are isolated from prior suites' startAgent invocations.
    mockedBuildSessionConfig.mockClear();
    adapter = createMockAdapter();
    tmpDir = await mkdtemp(join(tmpdir(), "sm-p67-03-"));
    registryPath = join(tmpDir, "registry.json");
    manager = new SessionManager({
      adapter,
      registryPath,
      backoffConfig: TEST_BACKOFF,
    });
  });

  afterEach(async () => {
    try {
      await manager.stopAll();
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 50));
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* non-fatal — DB handles may linger briefly */
    }
  });

  it("configDeps passes conversationStores and memoryStores", async () => {
    const agentName = "agent-wire-test";
    // Per-agent workspace so AgentMemoryManager.initMemory creates a real
    // memories.db and ConversationStore for this agent.
    const config: ResolvedAgentConfig = {
      ...makeConfig(agentName),
      workspace: tmpDir,
      memoryPath: tmpDir,
    };

    await manager.startAgent(agentName, config);

    // Exactly one buildSessionConfig call for this agent start.
    expect(mockedBuildSessionConfig).toHaveBeenCalledTimes(1);
    const [, deps] = mockedBuildSessionConfig.mock.calls[0]!;

    // 1+2: Both Maps are present and are actual Map instances.
    expect(deps.conversationStores).toBeInstanceOf(Map);
    expect(deps.memoryStores).toBeInstanceOf(Map);

    // 3+4: Reference-equality against the SessionManager's AgentMemoryManager
    // — proves configDeps passes the reference, not a copy/wrap.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const memoryMgr = (manager as any).memory as {
      conversationStores: Map<string, unknown>;
      memoryStores: Map<string, unknown>;
    };
    expect(deps.conversationStores).toBe(memoryMgr.conversationStores);
    expect(deps.memoryStores).toBe(memoryMgr.memoryStores);

    // 5+6: Populated stores — startAgent initializes both for this agent.
    expect(deps.conversationStores!.get(agentName)).toBeTruthy();
    expect(deps.memoryStores!.get(agentName)).toBeTruthy();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Phase 73 Plan 02 — brief cache invalidation on stop + crash (LAT-02)
// ---------------------------------------------------------------------------

import { ConversationBriefCache } from "../conversation-brief-cache.js";

describe("brief cache invalidation", () => {
  let adapter: MockSessionAdapter;
  let registryPath: string;
  let tmpDir: string;
  let manager: SessionManager;
  let invalidateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.useRealTimers();
    mockedBuildSessionConfig.mockClear();
    // Spy on the prototype so every ConversationBriefCache instance (including
    // the one SessionManager owns privately) reports calls through this mock.
    invalidateSpy = vi.spyOn(ConversationBriefCache.prototype, "invalidate");
    adapter = createMockAdapter();
    tmpDir = await mkdtemp(join(tmpdir(), "sm-p73-brief-"));
    registryPath = join(tmpDir, "registry.json");
    manager = new SessionManager({
      adapter,
      registryPath,
      backoffConfig: TEST_BACKOFF,
    });
  });

  afterEach(async () => {
    invalidateSpy.mockRestore();
    try {
      await manager.stopAll();
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 50));
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* non-fatal */
    }
  });

  it("stopAgent invalidates brief cache entry", async () => {
    const agentName = "agent-cache-stop";
    const config: ResolvedAgentConfig = {
      ...makeConfig(agentName),
      workspace: tmpDir,
      memoryPath: tmpDir,
    };

    await manager.startAgent(agentName, config);
    invalidateSpy.mockClear(); // ignore any warm-path invalidations

    await manager.stopAgent(agentName);

    // stopAgent MUST have invalidated the cache for this agent name.
    const calls = invalidateSpy.mock.calls as Array<[string]>;
    expect(calls.some((c) => c[0] === agentName)).toBe(true);
  }, 30_000);

  it("crash invalidates brief cache entry", async () => {
    const agentName = "agent-cache-crash";
    const config: ResolvedAgentConfig = {
      ...makeConfig(agentName),
      workspace: tmpDir,
      memoryPath: tmpDir,
    };

    await manager.startAgent(agentName, config);
    // MockSessionAdapter.sessions is keyed by sessionId (mock-<agent>-<n>),
    // not by agent name. Grab the handle whichever mock ID it was given.
    const handle = [...adapter.sessions.values()].find(
      (h) => h !== undefined,
    );
    expect(handle).toBeDefined();

    invalidateSpy.mockClear();

    handle!.simulateCrash(new Error("boom"));
    // simulateCrash fires the onError handler synchronously; recovery
    // scheduling is async but the invalidate fires BEFORE handleCrash.

    const calls = invalidateSpy.mock.calls as Array<[string]>;
    expect(calls.some((c) => c[0] === agentName)).toBe(true);
  }, 30_000);

  it("invalidateBriefCache(agent) is the public API and fires invalidate", async () => {
    const agentName = "agent-cache-public";
    const config: ResolvedAgentConfig = {
      ...makeConfig(agentName),
      workspace: tmpDir,
      memoryPath: tmpDir,
    };

    await manager.startAgent(agentName, config);
    invalidateSpy.mockClear();

    // Smoke: public method exists and delegates to the private cache.
    expect(() => manager.invalidateBriefCache(agentName)).not.toThrow();

    const calls = invalidateSpy.mock.calls as Array<[string]>;
    expect(calls.some((c) => c[0] === agentName)).toBe(true);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Quick task 260419-nic — SessionManager.interruptAgent primitive
// ---------------------------------------------------------------------------

describe("interruptAgent", () => {
  let adapter: MockSessionAdapter;
  let registryPath: string;
  let tmpDir: string;
  let manager: SessionManager;
  let infoLogs: Array<{ obj: unknown; msg: string }>;
  let warnLogs: Array<{ obj: unknown; msg: string }>;
  let testLogger: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: () => void;
    debug: () => void;
    child: () => unknown;
  };

  beforeEach(async () => {
    vi.useRealTimers();
    adapter = createMockAdapter();
    tmpDir = await mkdtemp(join(tmpdir(), "sm-interrupt-"));
    registryPath = join(tmpDir, "registry.json");
    infoLogs = [];
    warnLogs = [];
    testLogger = {
      info: (obj, msg) => infoLogs.push({ obj, msg: msg ?? "" }),
      warn: (obj, msg) => warnLogs.push({ obj, msg: msg ?? "" }),
      error: () => undefined,
      debug: () => undefined,
      child: () => testLogger,
    };
    manager = new SessionManager({
      adapter,
      registryPath,
      backoffConfig: TEST_BACKOFF,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      log: testLogger as any,
    });
  });

  afterEach(async () => {
    try {
      await manager.stopAll();
    } catch {
      /* ignore */
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("Test 1: unknown agent → returns {interrupted:false, hadActiveTurn:false}, no throw", async () => {
    const sessionsBefore = adapter.sessions.size;
    const result = await manager.interruptAgent("nonexistent-agent");
    expect(result).toEqual({ interrupted: false, hadActiveTurn: false });
    expect(adapter.sessions.size).toBe(sessionsBefore);
  });

  it("Test 2: agent running but no active turn → {interrupted:false, hadActiveTurn:false}", async () => {
    const config = makeConfig("idle-agent");
    await manager.startAgent("idle-agent", config);
    const handle = [...adapter.sessions.values()][0] as MockSessionHandle;
    expect(handle.hasActiveTurn()).toBe(false);

    const result = await manager.interruptAgent("idle-agent");
    expect(result).toEqual({ interrupted: false, hadActiveTurn: false });
  });

  it("Test 3: agent with active turn → calls handle.interrupt(), returns {interrupted:true, hadActiveTurn:true}, logs info event:'agent_interrupted'", async () => {
    const config = makeConfig("active-agent");
    await manager.startAgent("active-agent", config);
    const handle = [...adapter.sessions.values()][0] as MockSessionHandle;

    // Flip activeTurn flag so interruptAgent takes the positive path.
    handle.__testSetActiveTurn(true);
    const interruptSpy = vi.spyOn(handle, "interrupt");

    const result = await manager.interruptAgent("active-agent");
    expect(result).toEqual({ interrupted: true, hadActiveTurn: true });
    expect(interruptSpy).toHaveBeenCalledTimes(1);

    const infoMsg = infoLogs.find(
      (l) => (l.obj as { event?: string }).event === "agent_interrupted",
    );
    expect(infoMsg).toBeDefined();
    expect((infoMsg!.obj as { agent: string }).agent).toBe("active-agent");
  });

  it("Test 4: handle.interrupt() throws → re-throws and log.warn captures the failure", async () => {
    const config = makeConfig("boom-agent");
    await manager.startAgent("boom-agent", config);
    const handle = [...adapter.sessions.values()][0] as MockSessionHandle;
    handle.__testSetActiveTurn(true);
    handle.interrupt = () => {
      throw new Error("interrupt boom");
    };

    await expect(manager.interruptAgent("boom-agent")).rejects.toThrow(
      /interrupt boom/,
    );

    const warnMsg = warnLogs.find(
      (l) => (l.obj as { error?: string }).error === "interrupt boom",
    );
    expect(warnMsg).toBeDefined();
    expect((warnMsg!.obj as { agent: string }).agent).toBe("boom-agent");
  });
});
