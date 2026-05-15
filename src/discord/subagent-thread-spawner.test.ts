import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  SubagentThreadSpawner,
  resolveArtifactRoot,
  discoverArtifactPaths,
} from "./subagent-thread-spawner.js";
import type { SubagentThreadConfig } from "./subagent-thread-types.js";
import type { SessionManager } from "../manager/session-manager.js";
import type { ResolvedAgentConfig } from "../shared/types.js";
import { readThreadRegistry, writeThreadRegistry } from "./thread-registry.js";

/**
 * Create a minimal mock ResolvedAgentConfig for testing.
 */
function makeAgentConfig(
  overrides: Partial<ResolvedAgentConfig> = {},
): ResolvedAgentConfig {
  return {
    name: "agent-a",
    workspace: "/tmp/agent-a",
    memoryPath: "/tmp/agent-a", // Phase 75 SHARED-01
    channels: ["channel-1"],
    model: "sonnet",
    effort: "low",
    allowedModels: ["haiku", "sonnet", "opus"], // Phase 86 MODEL-01
    greetOnRestart: true, // Phase 89 GREET-07
    greetCoolDownMs: 300_000, // Phase 89 GREET-10
    autoCompactAt: 0.7, // Phase 124 D-06
    memoryAutoLoad: true, // Phase 90 MEM-01
    memoryRetrievalTopK: 5, // Phase 90 MEM-03
    memoryScannerEnabled: true, // Phase 90 MEM-02
    memoryFlushIntervalMs: 900_000, // Phase 90 MEM-04
    memoryCueEmoji: "✅", // Phase 90 MEM-05
    settingSources: ["project"], // Phase 100 GSD-02
    autoStart: true, // Phase 100 follow-up
    skills: [],
    soul: "You are a test agent.",
    identity: "Test identity.",
    memory: {
      compactionThreshold: 80,
      searchTopK: 10,
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
        similarityThreshold: 0.9,
      },
    },
    heartbeat: {
      enabled: false,
      intervalSeconds: 60,
      checkTimeoutSeconds: 30,
      contextFill: {
        warningThreshold: 70,
        criticalThreshold: 90,
      },
    },
    skillsPath: "/tmp/skills",
    schedules: [],
    admin: false,
    subagentModel: undefined,
    threads: {
      idleTimeoutMinutes: 1440,
      maxThreadSessions: 10,
    },
    slashCommands: [],
    reactions: false,
    mcpServers: [],
    ...overrides,
  };
}

/**
 * Create a mock SessionManager with the methods SubagentThreadSpawner needs.
 */
function makeMockSessionManager() {
  const configs = new Map<string, ResolvedAgentConfig>();
  const running = new Set<string>();

  const mock = {
    startAgent: vi.fn(async (name: string, _config: ResolvedAgentConfig) => {
      running.add(name);
    }),
    stopAgent: vi.fn(async (name: string) => {
      running.delete(name);
    }),
    getAgentConfig: vi.fn((agentName: string) => configs.get(agentName)),
    getRunningAgents: vi.fn(() => [...running]),
    forwardToAgent: vi.fn(),
    dispatchTurn: vi.fn(),
    streamFromAgent: vi.fn(),
    forkSession: vi.fn(),
    restartAgent: vi.fn(),
    startAll: vi.fn(),
    stopAll: vi.fn(),
    reconcileRegistry: vi.fn(),
    getMemoryStore: vi.fn(),
    getCompactionManager: vi.fn(),
    getContextFillProvider: vi.fn(),
    getEmbedder: vi.fn(),
    getSessionLogger: vi.fn(),
    getTierManager: vi.fn(),
    getUsageTracker: vi.fn(),
    getEpisodeStore: vi.fn(),
    saveContextSummary: vi.fn(),
    warmupEmbeddings: vi.fn(),
    setSkillsCatalog: vi.fn(),
    setAllAgentConfigs: vi.fn(),
    _setConfig(name: string, config: ResolvedAgentConfig) {
      configs.set(name, config);
    },
  };

  return mock as unknown as SessionManager & {
    startAgent: ReturnType<typeof vi.fn>;
    stopAgent: ReturnType<typeof vi.fn>;
    getAgentConfig: ReturnType<typeof vi.fn>;
    _setConfig: (name: string, config: ResolvedAgentConfig) => void;
  };
}

/**
 * Create a mock Discord client with channels.fetch returning a mock channel.
 */
function makeMockDiscordClient() {
  const mockThread = {
    id: "thread-123",
    name: "test-thread",
    send: vi.fn(),
  };

  const mockChannel = {
    id: "channel-1",
    threads: {
      create: vi.fn(async () => mockThread),
    },
    isTextBased: () => true,
  };

  const client = {
    channels: {
      fetch: vi.fn(async () => mockChannel),
    },
  };

  return {
    client,
    mockChannel,
    mockThread,
    setThreadId(id: string) {
      mockThread.id = id;
    },
  };
}

describe("SubagentThreadSpawner", () => {
  let tmpDir: string;
  let registryPath: string;
  let sessionManager: ReturnType<typeof makeMockSessionManager>;
  let discordMock: ReturnType<typeof makeMockDiscordClient>;
  let spawner: SubagentThreadSpawner;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "subagent-spawner-"));
    registryPath = join(tmpDir, "thread-bindings.json");
    sessionManager = makeMockSessionManager();
    discordMock = makeMockDiscordClient();

    const agentConfig = makeAgentConfig({
      webhook: {
        displayName: "Agent A",
        avatarUrl: "https://example.com/avatar.png",
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
      },
    });
    sessionManager._setConfig("agent-a", agentConfig);

    spawner = new SubagentThreadSpawner({
      sessionManager,
      registryPath,
      discordClient: discordMock.client as any,
    });
  });

  afterEach(async () => {
    // Phase 999.36 sub-bug D — postInitialMessage now stamps lastDeliveryAt
    // via fs I/O in the fire-and-forget `void` chain; settle before rm to
    // avoid an ENOTEMPTY race when writeThreadRegistry's mkdir recreates
    // the parent directory after rm starts.
    await new Promise((r) => setTimeout(r, 50));
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("spawnInThread", () => {
    it("creates a Discord thread, starts subagent session, persists binding, and returns SubagentSpawnResult", async () => {
      const config: SubagentThreadConfig = {
        parentAgentName: "agent-a",
        threadName: "research-task",
      };

      const result = await spawner.spawnInThread(config);

      // Discord thread was created
      expect(discordMock.mockChannel.threads.create).toHaveBeenCalledOnce();
      expect(discordMock.mockChannel.threads.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "research-task",
          autoArchiveDuration: 1440,
        }),
      );

      // Session was started
      expect(sessionManager.startAgent).toHaveBeenCalledOnce();

      // Result has correct shape
      expect(result.threadId).toBe("thread-123");
      expect(result.parentAgent).toBe("agent-a");
      expect(result.channelId).toBe("channel-1");
      expect(result.sessionName).toMatch(/^agent-a-sub-/);

      // Binding was persisted
      const registry = await readThreadRegistry(registryPath);
      expect(registry.bindings).toHaveLength(1);
      expect(registry.bindings[0].threadId).toBe("thread-123");
      expect(registry.bindings[0].agentName).toBe("agent-a");
      expect(registry.bindings[0].sessionName).toBe(result.sessionName);
    });

    it("uses parent's subagentModel for session config, defaulting to parent model if not set", async () => {
      // First: with subagentModel set
      const configWithSubmodel = makeAgentConfig({
        subagentModel: "haiku",
      });
      sessionManager._setConfig("agent-a", configWithSubmodel);

      await spawner.spawnInThread({
        parentAgentName: "agent-a",
        threadName: "task-1",
      });

      const callArgs1 = sessionManager.startAgent.mock.calls[0];
      const sessionConfig1 = callArgs1[1] as ResolvedAgentConfig;
      expect(sessionConfig1.model).toBe("haiku");

      // Reset and test without subagentModel
      vi.mocked(sessionManager.startAgent).mockClear();
      const configNoSubmodel = makeAgentConfig({
        subagentModel: undefined,
        model: "opus",
      });
      sessionManager._setConfig("agent-a", configNoSubmodel);

      discordMock.setThreadId("thread-456");

      await spawner.spawnInThread({
        parentAgentName: "agent-a",
        threadName: "task-2",
      });

      const callArgs2 = sessionManager.startAgent.mock.calls[0];
      const sessionConfig2 = callArgs2[1] as ResolvedAgentConfig;
      expect(sessionConfig2.model).toBe("opus");
    });

    it("injects thread context into subagent soul including threadId, threadName, parentChannelId, and parentAgent", async () => {
      await spawner.spawnInThread({
        parentAgentName: "agent-a",
        threadName: "research-task",
      });

      const callArgs = sessionManager.startAgent.mock.calls[0];
      const sessionConfig = callArgs[1] as ResolvedAgentConfig;

      expect(sessionConfig.soul).toContain("thread-123");
      expect(sessionConfig.soul).toContain("research-task");
      expect(sessionConfig.soul).toContain("channel-1");
      expect(sessionConfig.soul).toContain("agent-a");
      expect(sessionConfig.soul).toContain("Subagent Thread Context");
    });

    it("respects maxThreadSessions limit from parent config and throws when exceeded", async () => {
      const config = makeAgentConfig({
        threads: { idleTimeoutMinutes: 1440, maxThreadSessions: 1 },
        webhook: {
          displayName: "Agent A",
          webhookUrl: "https://discord.com/api/webhooks/123/abc",
        },
      });
      sessionManager._setConfig("agent-a", config);

      // First spawn succeeds
      await spawner.spawnInThread({
        parentAgentName: "agent-a",
        threadName: "task-1",
      });

      // Second spawn should throw
      discordMock.setThreadId("thread-456");
      await expect(
        spawner.spawnInThread({
          parentAgentName: "agent-a",
          threadName: "task-2",
        }),
      ).rejects.toThrow(/max.*thread.*sessions/i);
    });

    it("creates webhook identity with display name '{parentAgent}-sub-{shortId}' when parent has webhookUrl", async () => {
      const result = await spawner.spawnInThread({
        parentAgentName: "agent-a",
        threadName: "research-task",
      });

      const callArgs = sessionManager.startAgent.mock.calls[0];
      const sessionConfig = callArgs[1] as ResolvedAgentConfig;

      // Webhook identity should be set with a subagent-specific display name
      expect(sessionConfig.webhook).toBeDefined();
      expect(sessionConfig.webhook?.displayName).toMatch(/^agent-a-sub-/);
      expect(sessionConfig.webhook?.webhookUrl).toBe(
        "https://discord.com/api/webhooks/123/abc",
      );
    });
  });

  describe("cleanupSubagentThread", () => {
    it("stops the subagent session, removes the binding, but does NOT delete the Discord thread", async () => {
      const result = await spawner.spawnInThread({
        parentAgentName: "agent-a",
        threadName: "task-to-cleanup",
      });

      // Phase 999.36 sub-bug D — settle the void postInitialMessage chain
      // (which now writes lastDeliveryAt) BEFORE cleanup so the stamp's
      // read-modify-write doesn't race cleanup's removeBinding write.
      await new Promise((r) => setTimeout(r, 50));

      await spawner.cleanupSubagentThread(result.threadId);

      // Session was stopped
      expect(sessionManager.stopAgent).toHaveBeenCalledWith(
        result.sessionName,
      );

      // Binding was removed
      const registry = await readThreadRegistry(registryPath);
      expect(registry.bindings).toHaveLength(0);

      // Discord thread was NOT deleted (no thread.delete call)
      // This is implicit -- there's no delete mock to check
    });

    it("is a no-op when the threadId has no binding", async () => {
      // Should not throw
      await spawner.cleanupSubagentThread("nonexistent-thread");
      expect(sessionManager.stopAgent).not.toHaveBeenCalled();
    });
  });

  /**
   * Phase 100-fu — overflow chunk diagnostics. The pre-fu code chunked
   * overflow with no aggregate "summary" log line, so the next time
   * Discord silently dropped chunks, there was no breadcrumb to debug
   * from. Add structured logging that captures totalLength + chunksSent
   * + fullySent so the failure mode is observable in production.
   */
  describe("postInitialMessage overflow diagnostics (Phase 100-fu)", () => {
    it("OF-LOG-1 — emits 'subagent overflow chunks summary' log line with chunksSent + fullySent fields", async () => {
      // Build a fake logger that records every log call
      const logCalls: { level: string; obj: any; msg: string }[] = [];
      const fakeLog = {
        info: vi.fn((obj: any, msg: string) => {
          logCalls.push({ level: "info", obj, msg });
        }),
        warn: vi.fn((obj: any, msg: string) => {
          logCalls.push({ level: "warn", obj, msg });
        }),
        debug: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(() => fakeLog),
      };

      // Build a mock thread surface with edit support so canEdit=true.
      const sentChunks: string[] = [];
      const placeholder = {
        id: "msg-placeholder",
        edit: vi.fn(async (_content: string) => undefined),
      };
      const mockThread = {
        id: "thread-overflow",
        send: vi.fn(async (content: string) => {
          sentChunks.push(content);
          return placeholder;
        }),
      };

      // Mock channel + client just enough for the spawner to fetch.
      const mockChannel = {
        id: "channel-1",
        threads: { create: vi.fn(async () => mockThread) },
        isTextBased: () => true,
      };
      const localDiscordClient = {
        channels: { fetch: vi.fn(async () => mockChannel) },
      };

      // Reply text > 2000 chars (5000 chars → 3 chunks of 2000 + tail of <2000)
      const bigReply = "X".repeat(5000);
      const localSessionManager = makeMockSessionManager();
      localSessionManager._setConfig(
        "agent-a",
        makeAgentConfig({
          webhook: {
            displayName: "Agent A",
            avatarUrl: "https://example.com/a.png",
            webhookUrl: "https://discord.com/api/webhooks/123/abc",
          },
        }),
      );
      vi.mocked(localSessionManager.streamFromAgent).mockResolvedValue(
        bigReply as any,
      );

      const spawner = new SubagentThreadSpawner({
        sessionManager: localSessionManager,
        registryPath,
        discordClient: localDiscordClient as any,
        log: fakeLog as any,
      });

      await spawner.spawnInThread({
        parentAgentName: "agent-a",
        threadName: "overflow-test",
        autoRelay: false, // skip relay path — we're testing overflow logging only
      });

      // Wait a tick so the deliberately-not-awaited postInitialMessage runs.
      // It uses placeholder.edit + thread.send for tail chunks.
      await new Promise((r) => setTimeout(r, 50));

      // Assert: a structured "summary" log captures chunksSent + fullySent.
      const summaryLog = logCalls.find((c) =>
        c.msg.includes("subagent overflow chunks summary"),
      );
      expect(summaryLog).toBeDefined();
      expect(summaryLog!.obj).toMatchObject({
        totalLength: 5000,
        chunksSent: expect.any(Number),
        fullySent: expect.any(Boolean),
      });
      // For a 5000-char reply: 2000 in placeholder + 2 tail chunks of 2000
      // + final chunk of 1000 = 3 tail chunks. fullySent must be true.
      expect(summaryLog!.obj.fullySent).toBe(true);
      expect(summaryLog!.obj.chunksSent).toBeGreaterThanOrEqual(2);
    });

    it("999.36-A1 — typing loop fires sendTyping AND chunk-boundary diag log carries editorCutoffIndex/overflowStartCursor/seamGapBytes (sub-bug A wiring + sub-bug B diag)", async () => {
      // Phase 999.36 Plan 00 Task 5 — smoke test that:
      //   (1) spawnInThread → postInitialMessage starts the typing loop
      //       (sendTyping called at t=0 per startTypingLoop's eager fire,
      //       Plan 00 Task 1)
      //   (2) chunk-boundary diag fields are present on the
      //       'subagent overflow chunks summary' log line (Plan 00 Task 3)
      //
      // Both behaviors live on the postInitialMessage path; reusing the
      // OF-LOG-1 scaffolding above (5000-char reply triggers overflow).
      const logCalls: { level: string; obj: any; msg: string }[] = [];
      const fakeLog = {
        info: vi.fn((obj: any, msg: string) => {
          logCalls.push({ level: "info", obj, msg });
        }),
        warn: vi.fn((obj: any, msg: string) => {
          logCalls.push({ level: "warn", obj, msg });
        }),
        debug: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(() => fakeLog),
      };

      const sentChunks: string[] = [];
      const placeholder = {
        id: "msg-placeholder",
        edit: vi.fn(async (_content: string) => undefined),
      };
      // Mock thread surface with sendTyping spy — startTypingLoop calls
      // this on entry (eager fire, t=0) per Plan 00 Task 1's contract.
      const sendTyping = vi.fn(async () => undefined);
      const mockThread = {
        id: "thread-A1",
        sendTyping,
        send: vi.fn(async (content: string) => {
          sentChunks.push(content);
          return placeholder;
        }),
      };
      const mockChannel = {
        id: "channel-1",
        threads: { create: vi.fn(async () => mockThread) },
        isTextBased: () => true,
      };
      const localDiscordClient = {
        channels: { fetch: vi.fn(async () => mockChannel) },
      };

      const bigReply = "X".repeat(5000);
      const localSessionManager = makeMockSessionManager();
      localSessionManager._setConfig(
        "agent-a",
        makeAgentConfig({
          webhook: {
            displayName: "Agent A",
            avatarUrl: "https://example.com/a.png",
            webhookUrl: "https://discord.com/api/webhooks/123/abc",
          },
        }),
      );
      vi.mocked(localSessionManager.streamFromAgent).mockResolvedValue(
        bigReply as any,
      );

      const spawner = new SubagentThreadSpawner({
        sessionManager: localSessionManager,
        registryPath,
        discordClient: localDiscordClient as any,
        log: fakeLog as any,
      });

      await spawner.spawnInThread({
        parentAgentName: "agent-a",
        threadName: "A1-typing-and-diag",
        autoRelay: false,
      });

      await new Promise((r) => setTimeout(r, 50));

      // Sub-bug A wiring assertion — the eager t=0 fire from startTypingLoop
      // must have hit the thread's sendTyping spy at least once. We don't
      // try to wait for the 8s heartbeat (test runs in <1s), the eager
      // fire is sufficient evidence the loop was wired.
      expect(sendTyping).toHaveBeenCalled();

      // Sub-bug B diag assertion — the chunk-boundary fields must be
      // present on the 'subagent overflow chunks summary' info log so a
      // grep on prod logs surfaces editorCutoffIndex/overflowStartCursor/
      // seamGapBytes for D-08 hypothesis confirmation.
      const summaryLog = logCalls.find((c) =>
        c.msg.includes("subagent overflow chunks summary"),
      );
      expect(summaryLog).toBeDefined();
      // Phase 121-02 sub-bug B fix (D-07) — overflowStartCursor now aligns
      // with editorCutoffIndex (1997), and seamGapBytes is 0. Pre-fix
      // values (cursor=2000, gap=3) confirmed the seam was real (Plan
      // 121-01 diagnostic cycle); post-fix the seam is closed.
      expect(summaryLog!.obj).toMatchObject({
        totalLength: 5000,
        editorCutoffIndex: 1997,
        overflowStartCursor: 1997,
        seamGapBytes: 0,
        endReason: "drained",
      });
    });

    it("999.36-A2 — typingHandle.stop() called even when streamFromAgent rejects (sub-bug A finally-block invariant)", async () => {
      // Phase 999.36 Plan 00 Task 5 — invariant: when streamFromAgent
      // throws, the finally block in postInitialMessage must still call
      // typingHandle.stop() so the 8s setInterval doesn't leak. We can't
      // peek the interval handle from the test surface, but we CAN assert
      // that no further sendTyping fires happen after the test wait,
      // which is the operator-visible failure mode.
      const fakeLog = {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(),
      };
      fakeLog.child.mockReturnValue(fakeLog);

      const sendTyping = vi.fn(async () => undefined);
      const mockThread = {
        id: "thread-A2",
        sendTyping,
        send: vi.fn(async () => ({ id: "p", edit: vi.fn() })),
      };
      const mockChannel = {
        id: "channel-1",
        threads: { create: vi.fn(async () => mockThread) },
        isTextBased: () => true,
      };
      const localDiscordClient = {
        channels: { fetch: vi.fn(async () => mockChannel) },
      };

      const localSessionManager = makeMockSessionManager();
      localSessionManager._setConfig(
        "agent-a",
        makeAgentConfig({
          webhook: {
            displayName: "Agent A",
            avatarUrl: "https://example.com/a.png",
            webhookUrl: "https://discord.com/api/webhooks/123/abc",
          },
        }),
      );
      // streamFromAgent rejects — emulates a mid-turn SDK failure.
      vi.mocked(localSessionManager.streamFromAgent).mockRejectedValue(
        new Error("synthetic stream-from-agent failure"),
      );

      const spawner = new SubagentThreadSpawner({
        sessionManager: localSessionManager,
        registryPath,
        discordClient: localDiscordClient as any,
        log: fakeLog as any,
      });

      await spawner.spawnInThread({
        parentAgentName: "agent-a",
        threadName: "A2-stream-rejects",
        autoRelay: false,
      });

      // Allow the deliberately-not-awaited postInitialMessage to settle:
      // catch logs the warn, finally clears the interval.
      await new Promise((r) => setTimeout(r, 100));

      // Eager fire happened before the rejection.
      expect(sendTyping).toHaveBeenCalled();
      const earlyCount = sendTyping.mock.calls.length;

      // Wait LONGER than one 8s tick. If the interval wasn't cleared by
      // the finally block, sendTyping would fire again. Use fake timers
      // to advance instantly without making the test suite slow.
      vi.useFakeTimers({ now: Date.now() });
      try {
        await vi.advanceTimersByTimeAsync(20_000);
      } finally {
        vi.useRealTimers();
      }
      // Note: the interval may have been cleared BEFORE we engaged fake
      // timers (real-timer ticks during the 100ms settle above don't fire
      // because 100ms < 8000ms). The contract is: post-finally, no more
      // fires. earlyCount === current count proves the interval is dead.
      expect(sendTyping.mock.calls.length).toBe(earlyCount);
    });
  });

  describe("getSubagentBindings", () => {
    it("returns all bindings from the registry", async () => {
      await spawner.spawnInThread({
        parentAgentName: "agent-a",
        threadName: "task-1",
      });

      discordMock.setThreadId("thread-456");
      await spawner.spawnInThread({
        parentAgentName: "agent-a",
        threadName: "task-2",
      });

      const bindings = await spawner.getSubagentBindings();
      expect(bindings).toHaveLength(2);
    });
  });
});

/**
 * Phase 100 — relay prompt artifact-paths extension (Plan 100-05 / GSD-06).
 *
 * Phase 99-M's `relayCompletionToParent` (shipped 2026-04-26) summarizes the
 * subagent's last assistant message into a parent-agent turn. Phase 100
 * extends the prompt with discovered artifact paths so the parent's
 * main-channel summary mentions the `.planning/phases/<phase>/` dirs the
 * subagent created/touched.
 *
 * Two new exported pure helpers:
 *   - resolveArtifactRoot(parentConfig?) — extracts gsd.projectDir or undefined
 *   - discoverArtifactPaths({readdir,stat}, root, taskHint?) — lists relative
 *     paths under <root>/.planning/phases/, filtered by 24h mtime window,
 *     prioritized by phase-number prefix matching the task hint, capped at 5.
 *     Failures resolve to []. Pure DI so tests don't touch real filesystem.
 *
 * Plus an integration test asserting `relayCompletionToParent` appends an
 * "Artifacts written: ..." line when the parent has gsd.projectDir set.
 */
describe("Phase 100 — relay prompt artifact-paths extension", () => {
  // Helper — build a Dirent-shaped object with isDirectory()/isFile().
  function makeDirent(
    name: string,
    isDir = true,
  ): { name: string; isDirectory: () => boolean; isFile: () => boolean } {
    return {
      name,
      isDirectory: () => isDir,
      isFile: () => !isDir,
    };
  }

  describe("resolveArtifactRoot", () => {
    it("AP7 — returns gsd.projectDir when set on parentConfig", () => {
      const parent = {
        gsd: { projectDir: "/opt/clawcode-projects/sandbox" },
      } as ResolvedAgentConfig;
      expect(resolveArtifactRoot(parent)).toBe("/opt/clawcode-projects/sandbox");
    });

    it("AP8 — returns undefined when parentConfig.gsd is absent", () => {
      // Cast minimally — gsd is optional on ResolvedAgentConfig, so {} is allowed
      // by the type system from the consumer's perspective.
      const parent = {} as ResolvedAgentConfig;
      expect(resolveArtifactRoot(parent)).toBeUndefined();
    });

    it("AP9 — returns undefined when parentConfig itself is undefined", () => {
      expect(resolveArtifactRoot(undefined)).toBeUndefined();
    });
  });

  describe("discoverArtifactPaths", () => {
    let mockReaddir: ReturnType<typeof vi.fn>;
    let mockStat: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockReaddir = vi.fn();
      mockStat = vi.fn();
    });

    it("AP1 — happy path: 3 phase dirs in window returns 3 relative paths", async () => {
      const now = Date.now();
      // Root exists
      mockStat.mockImplementation(async (p: string) => {
        if (p.endsWith(".planning/phases")) return { mtimeMs: now } as any;
        // Each phase dir entry — all within 24h window
        return { mtimeMs: now - 60_000 } as any;
      });
      mockReaddir.mockResolvedValue([
        makeDirent("100-foo"),
        makeDirent("99-bar"),
        makeDirent("101-baz"),
      ] as any);

      const out = await discoverArtifactPaths(
        { readdir: mockReaddir as any, stat: mockStat as any },
        "/proj",
        "/gsd:plan-phase 100",
      );
      expect(out.length).toBe(3);
      // All paths are RELATIVE (no leading slash, start with .planning/phases/)
      for (const p of out) {
        expect(p.startsWith(".planning/phases/")).toBe(true);
        expect(p.startsWith("/")).toBe(false);
      }
      // Each contains one of the three dir names
      const joined = out.join("|");
      expect(joined).toContain("100-foo");
      expect(joined).toContain("99-bar");
      expect(joined).toContain("101-baz");
    });

    it("AP2 — mtime filter: dirs older than 24h excluded", async () => {
      const now = Date.now();
      const TWO_DAYS_AGO = now - 2 * 24 * 60 * 60 * 1000;
      mockStat.mockImplementation(async (p: string) => {
        if (p.endsWith(".planning/phases")) return { mtimeMs: now } as any;
        if (p.includes("recent")) return { mtimeMs: now - 60_000 } as any;
        if (p.includes("stale")) return { mtimeMs: TWO_DAYS_AGO } as any;
        return { mtimeMs: now - 60_000 } as any;
      });
      mockReaddir.mockResolvedValue([
        makeDirent("recent-1"),
        makeDirent("stale-1"),
        makeDirent("recent-2"),
        makeDirent("stale-2"),
      ] as any);

      const out = await discoverArtifactPaths(
        { readdir: mockReaddir as any, stat: mockStat as any },
        "/proj",
      );
      expect(out.length).toBe(2);
      const joined = out.join("|");
      expect(joined).toContain("recent-1");
      expect(joined).toContain("recent-2");
      expect(joined).not.toContain("stale");
    });

    it("AP3 — max-5 cap: 7 dirs in window returns exactly 5", async () => {
      const now = Date.now();
      mockStat.mockImplementation(async (p: string) => {
        if (p.endsWith(".planning/phases")) return { mtimeMs: now } as any;
        return { mtimeMs: now - 60_000 } as any;
      });
      mockReaddir.mockResolvedValue([
        makeDirent("a"),
        makeDirent("b"),
        makeDirent("c"),
        makeDirent("d"),
        makeDirent("e"),
        makeDirent("f"),
        makeDirent("g"),
      ] as any);

      const out = await discoverArtifactPaths(
        { readdir: mockReaddir as any, stat: mockStat as any },
        "/proj",
      );
      expect(out.length).toBe(5);
    });

    it("AP4 — phase-prefix priority: matching phase number sorts first", async () => {
      const now = Date.now();
      // Make NON-matching dirs more recent so default mtime sort would surface them first.
      // Phase-prefix priority must override the recency sort.
      mockStat.mockImplementation(async (p: string) => {
        if (p.endsWith(".planning/phases")) return { mtimeMs: now } as any;
        if (p.includes("100-bar")) return { mtimeMs: now - 60 * 60 * 1000 } as any; // 1h ago
        if (p.includes("99-x")) return { mtimeMs: now - 1000 } as any; // very recent
        if (p.includes("101-y")) return { mtimeMs: now - 2000 } as any;
        return { mtimeMs: now } as any;
      });
      mockReaddir.mockResolvedValue([
        makeDirent("99-x"),
        makeDirent("100-bar"),
        makeDirent("101-y"),
      ] as any);

      const out = await discoverArtifactPaths(
        { readdir: mockReaddir as any, stat: mockStat as any },
        "/proj",
        "/gsd:plan-phase 100",
      );
      expect(out.length).toBe(3);
      // FIRST entry must be the phase-100 match despite being older than 99-x
      expect(out[0]).toContain("100-bar");
    });

    it("AP5 — readdir failure returns empty array (failures-swallow contract)", async () => {
      const now = Date.now();
      // Root stat succeeds...
      mockStat.mockResolvedValue({ mtimeMs: now } as any);
      // ...but readdir blows up.
      mockReaddir.mockRejectedValue(new Error("ENOENT: no such file"));

      const out = await discoverArtifactPaths(
        { readdir: mockReaddir as any, stat: mockStat as any },
        "/proj",
      );
      expect(out).toEqual([]);
    });

    it("AP6 — root .planning/phases doesn't exist returns []", async () => {
      // Stat on the root throws (ENOENT)
      mockStat.mockImplementation(async () => {
        throw new Error("ENOENT");
      });
      mockReaddir.mockResolvedValue([] as any);

      const out = await discoverArtifactPaths(
        { readdir: mockReaddir as any, stat: mockStat as any },
        "/nope",
      );
      expect(out).toEqual([]);
      // readdir should NOT have been called when stat fails
      expect(mockReaddir).not.toHaveBeenCalled();
    });

    it("AP6b — non-directory entries are filtered out (only isDirectory()==true)", async () => {
      const now = Date.now();
      mockStat.mockImplementation(async (p: string) => {
        if (p.endsWith(".planning/phases")) return { mtimeMs: now } as any;
        return { mtimeMs: now - 60_000 } as any;
      });
      mockReaddir.mockResolvedValue([
        makeDirent("100-real-dir", true),
        makeDirent("README.md", false), // file, not dir
        makeDirent("101-also-real", true),
      ] as any);

      const out = await discoverArtifactPaths(
        { readdir: mockReaddir as any, stat: mockStat as any },
        "/proj",
      );
      expect(out.length).toBe(2);
      expect(out.join("|")).not.toContain("README");
    });

    it("AP6c — per-entry stat failures are silently skipped", async () => {
      const now = Date.now();
      mockStat.mockImplementation(async (p: string) => {
        if (p.endsWith(".planning/phases")) return { mtimeMs: now } as any;
        if (p.includes("good")) return { mtimeMs: now - 60_000 } as any;
        if (p.includes("broken")) throw new Error("EACCES");
        return { mtimeMs: now - 60_000 } as any;
      });
      mockReaddir.mockResolvedValue([
        makeDirent("good-1"),
        makeDirent("broken-1"),
        makeDirent("good-2"),
      ] as any);

      const out = await discoverArtifactPaths(
        { readdir: mockReaddir as any, stat: mockStat as any },
        "/proj",
      );
      expect(out.length).toBe(2);
      expect(out.join("|")).not.toContain("broken");
    });
  });

  describe("relayCompletionToParent integration", () => {
    let tmpDir: string;
    let registryPath: string;
    let sessionManager: ReturnType<typeof makeMockSessionManager>;
    // Quick task 260501-nfe — relay now uses dispatchStream + ProgressiveMessageEditor
    // posting to the parent's main channel via channel.send. Mock returns a non-empty
    // string so the post happens (mirrors bridge.ts:585-665 user-message path).
    let turnDispatcher: { dispatchStream: ReturnType<typeof vi.fn> };
    // Spy for the parent channel's `send` — the assertion that proves the bug fix:
    // before quick task 260501-nfe this was never invoked.
    let parentChannelSendSpy: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "relay-artifact-test-"));
      registryPath = join(tmpDir, "thread-bindings.json");
      sessionManager = makeMockSessionManager();
      turnDispatcher = {
        dispatchStream: vi.fn(async (_origin, _agent, _prompt, onChunk) => {
          onChunk?.("OK summary");
          return "OK summary";
        }),
      };
      parentChannelSendSpy = vi.fn(async () => ({
        edit: vi.fn(async () => {}),
        id: "msg-1",
      }));
    });

    /**
     * Build a discordClient mock that routes channels.fetch:
     *   - parentChannelId → fake parent channel exposing `send` spy
     *   - any other id (the threadId) → the supplied thread channel
     */
    function buildDiscordClient(
      threadChannel: unknown,
      parentChannelId: string,
    ) {
      const parentChannel = { send: parentChannelSendSpy };
      return {
        channels: {
          fetch: vi.fn(async (id: string) =>
            id === parentChannelId ? parentChannel : threadChannel,
          ),
        },
      };
    }

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    /**
     * AP10 — integration test asserting the full relay flow appends an
     * Artifacts: line when the parent has gsd.projectDir AND the discovery
     * helper returns non-empty paths.
     *
     * We can't easily DI discoverArtifactPaths through the spawner constructor
     * (it's used directly), so we use a real-on-disk tempDir as gsd.projectDir
     * and create a recently-mtime'd phase directory under it. That exercises
     * the live fs path end-to-end.
     */
    it("AP10 — appends 'Artifacts written:' line when parent has gsd.projectDir AND a recent phase dir exists", async () => {
      // Set up a real fake project root with a recent .planning/phases/100-foo/ dir
      const projectDir = join(tmpDir, "fake-project");
      const phasesDir = join(projectDir, ".planning", "phases");
      const recentPhase = join(phasesDir, "100-fake-phase");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(recentPhase, { recursive: true });

      // Bind parent agent to thread-id-A, with gsd.projectDir set
      const parentConfig = makeAgentConfig({
        gsd: { projectDir: projectDir },
      });
      sessionManager._setConfig("admin-clawdy", parentConfig);
      await writeThreadRegistry(registryPath, {
        bindings: [
          {
            threadId: "thread-id-A",
            parentChannelId: "channel-X",
            agentName: "admin-clawdy",
            sessionName: "admin-clawdy-sub-abc",
            createdAt: Date.now(),
            lastActivity: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      });

      // Mock Discord client with a thread that has a single subagent message
      const subagentMessage = {
        author: { bot: true },
        webhookId: "webhook-123",
        content: "All work done.",
      };
      const fetched = new Map([["m1", subagentMessage]]);
      const mockChannel = {
        id: "thread-id-A",
        name: "gsd:plan:100",
        messages: {
          fetch: vi.fn(async () => fetched),
        },
      };
      const discordClient = buildDiscordClient(mockChannel, "channel-X");

      const spawner = new SubagentThreadSpawner({
        sessionManager,
        registryPath,
        discordClient: discordClient as any,
        turnDispatcher: turnDispatcher as any,
      });

      await spawner.relayCompletionToParent("thread-id-A");

      expect(turnDispatcher.dispatchStream).toHaveBeenCalledTimes(1);
      const dispatchCall = turnDispatcher.dispatchStream.mock.calls[0];
      // dispatchStream(origin, agentName, prompt, onChunk, options)
      const prompt: string = dispatchCall[2];
      // Base Phase 99-M shape preserved
      expect(prompt).toContain("[SUBAGENT_COMPLETION]");
      expect(prompt).toContain("All work done.");
      expect(prompt).toContain("thread-id-A");
      // Phase 100 extension
      expect(prompt).toContain("Artifacts written:");
      expect(prompt).toContain(".planning/phases/100-fake-phase/");
    });

    /**
     * Phase 100-fu — relay must walk back through CONSECUTIVE bot messages
     * (newest→oldest) and concatenate them oldest-first, stopping at the
     * first operator (non-bot) message OR the start of the thread. This
     * fixes the silent-truncation bug where a multi-chunk subagent reply
     * (>2000 chars split across N thread.send() calls) was relayed to the
     * parent using only the LAST chunk — losing chunks 1..N-1.
     */
    it("REL-MULTI-1 — concatenates multiple consecutive bot messages oldest-first", async () => {
      const parentConfig = makeAgentConfig({});
      sessionManager._setConfig("admin-clawdy", parentConfig);
      await writeThreadRegistry(registryPath, {
        bindings: [
          {
            threadId: "thread-multi",
            parentChannelId: "channel-X",
            agentName: "admin-clawdy",
            sessionName: "admin-clawdy-sub-multi",
            createdAt: Date.now(),
            lastActivity: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      });

      // Discord fetch returns newest-first. Three consecutive bot messages.
      const fetched = new Map<string, any>([
        ["m3", { author: { bot: true }, webhookId: "wh", content: "CHUNK_THREE" }],
        ["m2", { author: { bot: true }, webhookId: "wh", content: "CHUNK_TWO" }],
        ["m1", { author: { bot: true }, webhookId: "wh", content: "CHUNK_ONE" }],
      ]);
      const mockChannel = {
        id: "thread-multi",
        name: "research-task",
        messages: { fetch: vi.fn(async () => fetched) },
      };
      const discordClient = buildDiscordClient(mockChannel, "channel-X");

      const spawner = new SubagentThreadSpawner({
        sessionManager,
        registryPath,
        discordClient: discordClient as any,
        turnDispatcher: turnDispatcher as any,
      });

      await spawner.relayCompletionToParent("thread-multi");

      expect(turnDispatcher.dispatchStream).toHaveBeenCalledTimes(1);
      const prompt: string = turnDispatcher.dispatchStream.mock.calls[0][2];
      // All three chunks present, oldest→newest order
      const idxOne = prompt.indexOf("CHUNK_ONE");
      const idxTwo = prompt.indexOf("CHUNK_TWO");
      const idxThree = prompt.indexOf("CHUNK_THREE");
      expect(idxOne).toBeGreaterThan(-1);
      expect(idxTwo).toBeGreaterThan(idxOne);
      expect(idxThree).toBeGreaterThan(idxTwo);
    });

    it("REL-MULTI-2 — stops at first operator (non-bot) message", async () => {
      const parentConfig = makeAgentConfig({});
      sessionManager._setConfig("admin-clawdy", parentConfig);
      await writeThreadRegistry(registryPath, {
        bindings: [
          {
            threadId: "thread-stop",
            parentChannelId: "channel-X",
            agentName: "admin-clawdy",
            sessionName: "admin-clawdy-sub-stop",
            createdAt: Date.now(),
            lastActivity: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      });

      // Newest first: bot, bot, OPERATOR, bot. Walk back from newest should
      // pick up the two recent bot messages then STOP at the operator —
      // the older bot message must NOT be included.
      const fetched = new Map<string, any>([
        ["m4", { author: { bot: true }, webhookId: "wh", content: "AFTER_OP_TWO" }],
        ["m3", { author: { bot: true }, webhookId: "wh", content: "AFTER_OP_ONE" }],
        ["m2", { author: { bot: false }, webhookId: null, content: "operator follow-up" }],
        ["m1", { author: { bot: true }, webhookId: "wh", content: "OLD_BOT_REPLY" }],
      ]);
      const mockChannel = {
        id: "thread-stop",
        name: "research-task",
        messages: { fetch: vi.fn(async () => fetched) },
      };
      const discordClient = buildDiscordClient(mockChannel, "channel-X");

      const spawner = new SubagentThreadSpawner({
        sessionManager,
        registryPath,
        discordClient: discordClient as any,
        turnDispatcher: turnDispatcher as any,
      });

      await spawner.relayCompletionToParent("thread-stop");

      expect(turnDispatcher.dispatchStream).toHaveBeenCalledTimes(1);
      const prompt: string = turnDispatcher.dispatchStream.mock.calls[0][2];
      expect(prompt).toContain("AFTER_OP_ONE");
      expect(prompt).toContain("AFTER_OP_TWO");
      expect(prompt).not.toContain("OLD_BOT_REPLY");
      expect(prompt).not.toContain("operator follow-up");
    });

    it("REL-MULTI-3 — empty bot messages are skipped", async () => {
      const parentConfig = makeAgentConfig({});
      sessionManager._setConfig("admin-clawdy", parentConfig);
      await writeThreadRegistry(registryPath, {
        bindings: [
          {
            threadId: "thread-empty",
            parentChannelId: "channel-X",
            agentName: "admin-clawdy",
            sessionName: "admin-clawdy-sub-empty",
            createdAt: Date.now(),
            lastActivity: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      });

      const fetched = new Map<string, any>([
        ["m3", { author: { bot: true }, webhookId: "wh", content: "REAL_CONTENT" }],
        ["m2", { author: { bot: true }, webhookId: "wh", content: "   " }], // whitespace only
        ["m1", { author: { bot: true }, webhookId: "wh", content: "" }], // empty (e.g. embed-only)
      ]);
      const mockChannel = {
        id: "thread-empty",
        name: "research-task",
        messages: { fetch: vi.fn(async () => fetched) },
      };
      const discordClient = buildDiscordClient(mockChannel, "channel-X");

      const spawner = new SubagentThreadSpawner({
        sessionManager,
        registryPath,
        discordClient: discordClient as any,
        turnDispatcher: turnDispatcher as any,
      });

      await spawner.relayCompletionToParent("thread-empty");

      expect(turnDispatcher.dispatchStream).toHaveBeenCalledTimes(1);
      const prompt: string = turnDispatcher.dispatchStream.mock.calls[0][2];
      expect(prompt).toContain("REAL_CONTENT");
    });

    it("REL-MULTI-4 — single bot message: behavior identical to prior single-message logic", async () => {
      const parentConfig = makeAgentConfig({});
      sessionManager._setConfig("admin-clawdy", parentConfig);
      await writeThreadRegistry(registryPath, {
        bindings: [
          {
            threadId: "thread-single",
            parentChannelId: "channel-X",
            agentName: "admin-clawdy",
            sessionName: "admin-clawdy-sub-single",
            createdAt: Date.now(),
            lastActivity: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      });

      const fetched = new Map<string, any>([
        ["m1", { author: { bot: true }, webhookId: "wh", content: "Just one reply." }],
      ]);
      const mockChannel = {
        id: "thread-single",
        name: "research-task",
        messages: { fetch: vi.fn(async () => fetched) },
      };
      const discordClient = buildDiscordClient(mockChannel, "channel-X");

      const spawner = new SubagentThreadSpawner({
        sessionManager,
        registryPath,
        discordClient: discordClient as any,
        turnDispatcher: turnDispatcher as any,
      });

      await spawner.relayCompletionToParent("thread-single");

      expect(turnDispatcher.dispatchStream).toHaveBeenCalledTimes(1);
      const prompt: string = turnDispatcher.dispatchStream.mock.calls[0][2];
      expect(prompt).toContain("Just one reply.");
      expect(prompt).toContain("[SUBAGENT_COMPLETION]");
    });

    it("AP10b — no Artifacts line when parent has no gsd.projectDir (Phase 99-M base behavior preserved)", async () => {
      // Bind parent agent — NO gsd field set
      const parentConfig = makeAgentConfig({});
      sessionManager._setConfig("admin-clawdy", parentConfig);
      await writeThreadRegistry(registryPath, {
        bindings: [
          {
            threadId: "thread-id-B",
            parentChannelId: "channel-X",
            agentName: "admin-clawdy",
            sessionName: "admin-clawdy-sub-xyz",
            createdAt: Date.now(),
            lastActivity: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      });

      const subagentMessage = {
        author: { bot: true },
        webhookId: "webhook-123",
        content: "Done with the non-GSD task.",
      };
      const fetched = new Map([["m1", subagentMessage]]);
      const mockChannel = {
        id: "thread-id-B",
        name: "research-task",
        messages: { fetch: vi.fn(async () => fetched) },
      };
      const discordClient = buildDiscordClient(mockChannel, "channel-X");

      const spawner = new SubagentThreadSpawner({
        sessionManager,
        registryPath,
        discordClient: discordClient as any,
        turnDispatcher: turnDispatcher as any,
      });

      await spawner.relayCompletionToParent("thread-id-B");

      expect(turnDispatcher.dispatchStream).toHaveBeenCalledTimes(1);
      const prompt: string = turnDispatcher.dispatchStream.mock.calls[0][2];
      // Phase 99-M base shape preserved
      expect(prompt).toContain("[SUBAGENT_COMPLETION]");
      expect(prompt).toContain("Done with the non-GSD task.");
      // Crucially — NO Artifacts line for non-GSD subthreads
      expect(prompt).not.toContain("Artifacts written:");
    });

    /**
     * Quick task 260501-nfe — REGRESSION TEST FOR THE ROOT-CAUSE BUG.
     *
     * Before the fix, `relayCompletionToParent` called `turnDispatcher.dispatch(...)`
     * and discarded the returned response. The parent generated a summary but
     * it never reached Discord. This test pins the fix: a successful relay
     * MUST invoke `parentChannel.send(...)` with the streamed content.
     */
    it("posts the parent's summary to the parent's main channel via channel.send", async () => {
      const parentConfig = makeAgentConfig({});
      sessionManager._setConfig("admin-clawdy", parentConfig);
      await writeThreadRegistry(registryPath, {
        bindings: [
          {
            threadId: "thread-id-relay",
            parentChannelId: "parent-chan-1",
            agentName: "admin-clawdy",
            sessionName: "admin-clawdy-sub-relay",
            createdAt: Date.now(),
            lastActivity: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      });

      const fetched = new Map<string, any>([
        ["m1", { author: { bot: true }, webhookId: "wh", content: "Subagent finished work." }],
      ]);
      const mockThreadChannel = {
        id: "thread-id-relay",
        name: "research-task",
        messages: { fetch: vi.fn(async () => fetched) },
      };
      const discordClient = buildDiscordClient(mockThreadChannel, "parent-chan-1");

      // Override default mock so dispatchStream emits a distinctive token via onChunk.
      turnDispatcher.dispatchStream = vi.fn(async (_origin, _agent, _prompt, onChunk) => {
        onChunk?.("Brief summary");
        return "Brief summary";
      });

      const spawner = new SubagentThreadSpawner({
        sessionManager,
        registryPath,
        discordClient: discordClient as any,
        turnDispatcher: turnDispatcher as any,
      });

      await spawner.relayCompletionToParent("thread-id-relay");

      // The bug was: dispatch returned, value discarded, no send. The fix
      // streams onChunk into a ProgressiveMessageEditor that calls channel.send
      // for the first chunk. Assertion: send invoked with content containing
      // the summary string.
      expect(parentChannelSendSpy).toHaveBeenCalled();
      const sendArgs = parentChannelSendSpy.mock.calls.flat();
      const anyContainsSummary = sendArgs.some(
        (arg) => typeof arg === "string" && arg.includes("Brief summary"),
      );
      expect(anyContainsSummary).toBe(true);
    });

    /**
     * Quick task 260501-nfe — failure-mode regression: when channels.fetch
     * returns null for the parent channel, relay must log a structured
     * relay-skipped reason and return without dispatching.
     */
    it("logs relay-skipped reason=parent-channel-fetch-failed when channels.fetch returns null", async () => {
      const parentConfig = makeAgentConfig({});
      sessionManager._setConfig("admin-clawdy", parentConfig);
      await writeThreadRegistry(registryPath, {
        bindings: [
          {
            threadId: "thread-id-fetchfail",
            parentChannelId: "parent-chan-missing",
            agentName: "admin-clawdy",
            sessionName: "admin-clawdy-sub-fetchfail",
            createdAt: Date.now(),
            lastActivity: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      });

      // Thread fetch returns a normal channel; parent fetch returns null.
      const fetched = new Map<string, any>([
        ["m1", { author: { bot: true }, webhookId: "wh", content: "Work done." }],
      ]);
      const mockThreadChannel = {
        id: "thread-id-fetchfail",
        name: "research-task",
        messages: { fetch: vi.fn(async () => fetched) },
      };
      const discordClient = {
        channels: {
          fetch: vi.fn(async (id: string) =>
            id === "parent-chan-missing" ? null : mockThreadChannel,
          ),
        },
      };

      const logInfo = vi.fn();
      const log = {
        info: logInfo,
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(() => log),
      } as any;

      const spawner = new SubagentThreadSpawner({
        sessionManager,
        registryPath,
        discordClient: discordClient as any,
        turnDispatcher: turnDispatcher as any,
        log,
      });

      await spawner.relayCompletionToParent("thread-id-fetchfail");

      // Structured log line emitted with the new reason tag
      const skippedCalls = logInfo.mock.calls.filter(
        (c) =>
          typeof c[1] === "string" && c[1].includes("subagent relay skipped"),
      );
      const fetchFailedCall = skippedCalls.find(
        (c) =>
          c[0] &&
          typeof c[0] === "object" &&
          c[0].reason === "parent-channel-fetch-failed",
      );
      expect(fetchFailedCall).toBeDefined();
      // Dispatch was NOT called — short-circuit before streaming.
      expect(turnDispatcher.dispatchStream).not.toHaveBeenCalled();
    });

    /**
     * Quick task 260501-nfe — failure-mode regression: when dispatchStream
     * resolves with empty content AND no chunk fired (so messageRef is still
     * null), relay must log relay-skipped reason=empty-response-from-parent
     * and avoid posting anything.
     */
    it("logs relay-skipped reason=empty-response-from-parent when dispatchStream resolves empty", async () => {
      const parentConfig = makeAgentConfig({});
      sessionManager._setConfig("admin-clawdy", parentConfig);
      await writeThreadRegistry(registryPath, {
        bindings: [
          {
            threadId: "thread-id-empty-resp",
            parentChannelId: "parent-chan-2",
            agentName: "admin-clawdy",
            sessionName: "admin-clawdy-sub-empty-resp",
            createdAt: Date.now(),
            lastActivity: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      });

      const fetched = new Map<string, any>([
        ["m1", { author: { bot: true }, webhookId: "wh", content: "Subagent finished." }],
      ]);
      const mockThreadChannel = {
        id: "thread-id-empty-resp",
        name: "research-task",
        messages: { fetch: vi.fn(async () => fetched) },
      };
      const discordClient = buildDiscordClient(mockThreadChannel, "parent-chan-2");

      // dispatchStream resolves with empty string and never invokes onChunk.
      turnDispatcher.dispatchStream = vi.fn(async () => "");

      const logInfo = vi.fn();
      const log = {
        info: logInfo,
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(() => log),
      } as any;

      const spawner = new SubagentThreadSpawner({
        sessionManager,
        registryPath,
        discordClient: discordClient as any,
        turnDispatcher: turnDispatcher as any,
        log,
      });

      await spawner.relayCompletionToParent("thread-id-empty-resp");

      const skippedCalls = logInfo.mock.calls.filter(
        (c) =>
          typeof c[1] === "string" && c[1].includes("subagent relay skipped"),
      );
      const emptyCall = skippedCalls.find(
        (c) =>
          c[0] &&
          typeof c[0] === "object" &&
          c[0].reason === "empty-response-from-parent",
      );
      expect(emptyCall).toBeDefined();
      // No content was sent to the parent channel.
      expect(parentChannelSendSpy).not.toHaveBeenCalled();
    });
  });
});

/**
 * Phase 999.3 — DEL-01..DEL-10 — delegateTo behavior pins.
 *
 * When the caller passes `delegateTo: <name>` to spawn_subagent_thread, the
 * spawned subagent inherits the DELEGATE's identity (model/soul/skills/
 * subagentModel/mcpServers) but lands in the CALLER's channel. See
 * .planning/phases/999.3-.../999.3-CONTEXT.md for D-INH-01..03, D-NAM-01..03,
 * D-TCX-01..03, D-EDG-01..05.
 */
describe("spawnInThread with delegateTo", () => {
  let tmpDir: string;
  let registryPath: string;
  let sessionManager: ReturnType<typeof makeMockSessionManager>;
  let discordMock: ReturnType<typeof makeMockDiscordClient>;
  let spawner: SubagentThreadSpawner;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "subagent-delegate-"));
    registryPath = join(tmpDir, "thread-bindings.json");
    sessionManager = makeMockSessionManager();
    discordMock = makeMockDiscordClient();

    // Caller "agent-a": haiku model, plain soul, caller-side webhook
    const callerConfig = makeAgentConfig({
      name: "agent-a",
      model: "haiku",
      soul: "caller soul",
      skills: [],
      mcpServers: [],
      threads: { idleTimeoutMinutes: 1440, maxThreadSessions: 3 },
      webhook: {
        displayName: "Agent A",
        avatarUrl: "https://example.com/agent-a.png",
        webhookUrl: "https://discord.com/api/webhooks/CALLER_URL",
      },
    });
    sessionManager._setConfig("agent-a", callerConfig);

    // Delegate "research": opus model, research soul, opus skills + mcp
    const delegateConfig = makeAgentConfig({
      name: "research",
      model: "opus",
      soul: "research soul",
      identity: "research identity",
      skills: ["search-first", "market-research"],
      mcpServers: [
        { name: "exa", command: "exa", args: [], env: {}, optional: false },
      ],
      subagentModel: "sonnet",
      threads: { idleTimeoutMinutes: 1440, maxThreadSessions: 99 },
      webhook: {
        displayName: "Research",
        avatarUrl: "https://example.com/research.png",
        webhookUrl: "https://discord.com/api/webhooks/DELEGATE_URL",
      },
    });
    sessionManager._setConfig("research", delegateConfig);

    spawner = new SubagentThreadSpawner({
      sessionManager,
      registryPath,
      discordClient: discordMock.client as any,
    });
  });

  afterEach(async () => {
    // Phase 999.36 sub-bug D — postInitialMessage now stamps lastDeliveryAt
    // via fs I/O in the fire-and-forget `void` chain; settle before rm to
    // avoid an ENOTEMPTY race when writeThreadRegistry's mkdir recreates
    // the parent directory after rm starts.
    await new Promise((r) => setTimeout(r, 50));
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("DEL-01: subagent inherits delegate's model/soul/skills/mcpServers/subagentModel (D-INH-01)", async () => {
    await spawner.spawnInThread({
      parentAgentName: "agent-a",
      threadName: "research-task",
      delegateTo: "research",
    });

    const startedConfig = sessionManager.startAgent.mock.calls[0][1] as ResolvedAgentConfig;
    // delegate.subagentModel ("sonnet") wins over delegate.model ("opus")
    expect(startedConfig.model).toBe("sonnet");
    // soul carries delegate's content (then threadContext is appended)
    expect(startedConfig.soul).toContain("research soul");
    // skills and mcpServers come from delegate
    expect(startedConfig.skills).toEqual(["search-first", "market-research"]);
    expect(startedConfig.mcpServers).toHaveLength(1);
    expect(startedConfig.mcpServers[0].name).toBe("exa");
    // identity carried from delegate via spread
    expect(startedConfig.identity).toBe("research identity");
  });

  it("DEL-02: session name uses ${parent}-via-${delegate}-${shortId} (D-NAM-01)", async () => {
    const result = await spawner.spawnInThread({
      parentAgentName: "agent-a",
      threadName: "research-task",
      delegateTo: "research",
    });
    expect(result.sessionName).toMatch(/^agent-a-via-research-[A-Za-z0-9_-]{6}$/);
  });

  it("DEL-03: threadContext appends Delegation Context block w/ canonical 'acting on behalf of' phrase (D-TCX-01)", async () => {
    await spawner.spawnInThread({
      parentAgentName: "agent-a",
      threadName: "research-task",
      delegateTo: "research",
    });
    const startedConfig = sessionManager.startAgent.mock.calls[0][1] as ResolvedAgentConfig;
    expect(startedConfig.soul).toContain("## Delegation Context");
    expect(startedConfig.soul).toContain("acting on behalf of");
    // Parent agent name surfaces in the delegation block
    expect(startedConfig.soul).toContain("agent-a");
  });

  it("DEL-04: webhook = caller's URL + delegate's displayName + delegate's avatar (D-INH-03)", async () => {
    await spawner.spawnInThread({
      parentAgentName: "agent-a",
      threadName: "research-task",
      delegateTo: "research",
    });
    const startedConfig = sessionManager.startAgent.mock.calls[0][1] as ResolvedAgentConfig;
    expect(startedConfig.webhook).toBeDefined();
    // CALLER's webhookUrl (channel-bound)
    expect(startedConfig.webhook?.webhookUrl).toBe(
      "https://discord.com/api/webhooks/CALLER_URL",
    );
    // DELEGATE's displayName + avatar (per-message overrides)
    expect(startedConfig.webhook?.displayName).toBe("Research");
    expect(startedConfig.webhook?.avatarUrl).toBe(
      "https://example.com/research.png",
    );
  });

  it("DEL-05: recursion guard regression — disallowedTools set even when delegateTo is provided (D-TCX-03)", async () => {
    await spawner.spawnInThread({
      parentAgentName: "agent-a",
      threadName: "research-task",
      delegateTo: "research",
    });
    const startedConfig = sessionManager.startAgent.mock.calls[0][1] as ResolvedAgentConfig;
    expect(startedConfig.disallowedTools).toContain(
      "mcp__clawcode__spawn_subagent_thread",
    );
  });

  it("DEL-06: caller's threads.maxThreadSessions wins over delegate's (D-INH-02)", async () => {
    await spawner.spawnInThread({
      parentAgentName: "agent-a",
      threadName: "research-task",
      delegateTo: "research",
    });
    const startedConfig = sessionManager.startAgent.mock.calls[0][1] as ResolvedAgentConfig;
    // Caller's quota (3) wins, NOT delegate's (99)
    expect(startedConfig.threads.maxThreadSessions).toBe(3);
  });

  it("DEL-07: dormant delegate (autoStart=false) is allowed — config read regardless of running state (D-EDG-02)", async () => {
    // Replace research with an autoStart=false (dormant) variant.
    const dormantDelegate = makeAgentConfig({
      name: "research",
      model: "opus",
      soul: "research soul",
      autoStart: false,
      threads: { idleTimeoutMinutes: 1440, maxThreadSessions: 99 },
      webhook: {
        displayName: "Research",
        avatarUrl: "https://example.com/research.png",
        webhookUrl: "https://discord.com/api/webhooks/DELEGATE_URL",
      },
    });
    sessionManager._setConfig("research", dormantDelegate);

    await expect(
      spawner.spawnInThread({
        parentAgentName: "agent-a",
        threadName: "research-task",
        delegateTo: "research",
      }),
    ).resolves.toBeDefined();
  });

  it("DEL-08: self-delegation allowed; sessionName retains -via- infix (D-EDG-03)", async () => {
    const result = await spawner.spawnInThread({
      parentAgentName: "agent-a",
      threadName: "self-task",
      delegateTo: "agent-a",
    });
    expect(result.sessionName).toMatch(/^agent-a-via-agent-a-[A-Za-z0-9_-]{6}$/);
  });

  it("DEL-09: back-compat — no delegateTo → sessionName uses -sub- infix (NOT -via-) (SPEC-07 / D-EDG-04)", async () => {
    const result = await spawner.spawnInThread({
      parentAgentName: "agent-a",
      threadName: "no-delegate-task",
    });
    expect(result.sessionName).toMatch(/^agent-a-sub-[A-Za-z0-9_-]{6}$/);
    expect(result.sessionName).not.toContain("-via-");
  });

  it("DEL-10: defense-in-depth — delegate not found throws ManagerError verbatim at spawner level (D-EDG-05)", async () => {
    await expect(
      spawner.spawnInThread({
        parentAgentName: "agent-a",
        threadName: "ghost-task",
        delegateTo: "ghost-agent",
      }),
    ).rejects.toThrow(/Delegate agent 'ghost-agent' not found/);
  });

  // Phase 999.57 (2026-05-15) — delegated spawns must NOT auto-relay on the
  // subagent's first-message-stream-end. The subagent must call
  // `subagent_complete` to fire the relay. Pre-999.57 the relay grabbed
  // turn-1 ack text (or memory-leaked content) as "final response" and
  // archived the thread in 5-10s (production failures, admin-clawdy →
  // research, 2026-05-15 18:04 + 18:09).
  it("DEL-11 (999.57): delegated spawn does NOT auto-relay by default — relay is gated on subagent_complete", async () => {
    const spy = vi.spyOn(spawner, "relayCompletionToParent").mockResolvedValue();
    await spawner.spawnInThread({
      parentAgentName: "agent-a",
      threadName: "research-task",
      delegateTo: "research",
      task: "look up cool features openclaw has that we don't",
    });
    // Allow the fire-and-forget postInitialMessage chain to settle.
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });

  it("DEL-12 (999.57): delegated spawn WITH explicit autoRelay: true bypasses the gate (legacy one-shot path)", async () => {
    const spy = vi.spyOn(spawner, "relayCompletionToParent").mockResolvedValue();
    await spawner.spawnInThread({
      parentAgentName: "agent-a",
      threadName: "quick-lookup",
      delegateTo: "research",
      task: "what's the current btc price",
      autoRelay: true,
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(spy).toHaveBeenCalled();
  });

  it("DEL-13 (999.57): non-delegated spawn keeps legacy auto-relay-by-default behavior (back-compat pin)", async () => {
    const spy = vi.spyOn(spawner, "relayCompletionToParent").mockResolvedValue();
    await spawner.spawnInThread({
      parentAgentName: "agent-a",
      threadName: "self-spawn",
      task: "do a quick thing",
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(spy).toHaveBeenCalled();
  });

  it("DEL-14 (999.57): subagent threadContext instructs delegate to call subagent_complete", async () => {
    await spawner.spawnInThread({
      parentAgentName: "agent-a",
      threadName: "research-task",
      delegateTo: "research",
    });
    const startedConfig = sessionManager.startAgent.mock.calls[0][1] as ResolvedAgentConfig;
    expect(startedConfig.soul).toContain("subagent_complete");
    // Production-failure language carried through so future maintainers
    // understand why this instruction exists.
    expect(startedConfig.soul).toContain("ack-and-wait");
  });

  // Phase 999.58 (2026-05-15) — long-deliverable contract. Production
  // failure: research subagent's capability-gap table hit Discord's 2000-char
  // cap mid-row at BOOTSTRAP.md. The relay summarized truncated content
  // because no file artifact was shared. Pin: subagents must be told to
  // use clawcode_share_file for long/structured deliverables.
  it("DEL-15 (999.58): subagent threadContext instructs use of clawcode_share_file for long deliverables", async () => {
    await spawner.spawnInThread({
      parentAgentName: "agent-a",
      threadName: "research-task",
      delegateTo: "research",
    });
    const startedConfig = sessionManager.startAgent.mock.calls[0][1] as ResolvedAgentConfig;
    // The instruction mentions the share tool.
    expect(startedConfig.soul).toContain("clawcode_share_file");
    // The threshold guidance is present (1500 chars or structured content).
    expect(startedConfig.soul).toMatch(/1500|structured/);
    // The failure-mode reasoning is captured so the prompt isn't fragile —
    // a future maintainer who reads it understands the 2000-char Discord cap.
    expect(startedConfig.soul).toContain("2000");
  });

  it("DEL-16 (999.58): non-delegated subagent ALSO gets the long-deliverable instruction (baseContext, not delegationContext)", async () => {
    await spawner.spawnInThread({
      parentAgentName: "agent-a",
      threadName: "self-spawn",
    });
    const startedConfig = sessionManager.startAgent.mock.calls[0][1] as ResolvedAgentConfig;
    expect(startedConfig.soul).toContain("clawcode_share_file");
    expect(startedConfig.soul).toMatch(/1500|structured/);
  });
});

// Phase 999.59 (2026-05-15) — overflow chunking trigger uses
// accumulatedSeen (longest stream content) instead of just the SDK final
// reply. Pre-999.59 production failure: subagent emitted a long table
// mid-stream then closed with a short "Research complete." final block
// (responseLength: 254). The overflow handler's `text.length > 2000`
// check evaluated against 254 chars and never fired, so the editor-
// truncated placeholder was the only artifact and the deliverable was
// silently lost mid-row.
describe("postInitialMessage overflow trigger (Phase 999.59)", () => {
  let tmpDir: string;
  let registryPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "subagent-overflow-trigger-"));
    registryPath = join(tmpDir, "thread-bindings.json");
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 50));
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("OF-TRIG-1 (999.59): multi-block stream where final reply is short but accumulated > 2000 chars still triggers overflow chunks", async () => {
    const logCalls: { level: string; obj: any; msg: string }[] = [];
    const fakeLog = {
      info: vi.fn((obj: any, msg: string) => {
        logCalls.push({ level: "info", obj, msg });
      }),
      warn: vi.fn((obj: any, msg: string) => {
        logCalls.push({ level: "warn", obj, msg });
      }),
      debug: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(() => fakeLog),
    };

    const sentChunks: string[] = [];
    const placeholder = {
      id: "msg-placeholder",
      edit: vi.fn(async (_content: string) => undefined),
    };
    const sendTyping = vi.fn(async () => undefined);
    const mockThread = {
      id: "thread-of-trig-1",
      sendTyping,
      send: vi.fn(async (content: string) => {
        sentChunks.push(content);
        return placeholder;
      }),
    };
    const mockChannel = {
      id: "channel-of-trig-1",
      threads: { create: vi.fn(async () => mockThread) },
      isTextBased: () => true,
    };
    const localDiscordClient = {
      channels: { fetch: vi.fn(async () => mockChannel) },
      // Phase 999.36 sub-bug C: webhook send mock used by postInitialMessage
      // pipeline. Not exercised in this test but needs to exist.
      user: { id: "bot-user-id" },
    };

    const localSessionManager = makeMockSessionManager();
    localSessionManager._setConfig(
      "agent-a",
      makeAgentConfig({
        webhook: {
          displayName: "Agent A",
          avatarUrl: "https://example.com/a.png",
          webhookUrl: "https://discord.com/api/webhooks/999/abc",
        },
      }),
    );

    // The production failure pattern: SDK emits a long block during the
    // stream (via the onChunk callback's `accumulated`) but the SDK's
    // returned reply value is the short final-block text only.
    const longAccumulated = "Y".repeat(5000); // mid-stream table content
    const shortFinalReply = "Research complete. See deliverable above."; // ~42 chars
    vi.mocked(localSessionManager.streamFromAgent).mockImplementation(
      async (_name, _msg, onChunk) => {
        if (onChunk) onChunk(longAccumulated);
        return shortFinalReply;
      },
    );

    const spawner = new SubagentThreadSpawner({
      sessionManager: localSessionManager,
      registryPath,
      discordClient: localDiscordClient as any,
      log: fakeLog as any,
    });

    await spawner.spawnInThread({
      parentAgentName: "agent-a",
      threadName: "overflow-trigger-test",
      autoRelay: false,
    });

    await new Promise((r) => setTimeout(r, 50));

    // The overflow handler must have fired despite the short final reply.
    const summaryLog = logCalls.find((c) =>
      c.msg.includes("subagent overflow chunks summary"),
    );
    expect(summaryLog).toBeDefined();
    expect(summaryLog!.obj.fullySent).toBe(true);
    // totalLength should reflect accumulatedSeen (5000), not the short final
    // reply (~42) — proves the fix uses the longer of the two.
    expect(summaryLog!.obj.totalLength).toBeGreaterThan(2000);
    expect(summaryLog!.obj.chunksSent).toBeGreaterThanOrEqual(1);
  });

  it("OF-TRIG-2 (999.59): when final reply IS the full content (single-block turn), overflow still works correctly (back-compat with OF-LOG-1)", async () => {
    const logCalls: { level: string; obj: any; msg: string }[] = [];
    const fakeLog = {
      info: vi.fn((obj: any, msg: string) => {
        logCalls.push({ level: "info", obj, msg });
      }),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(() => fakeLog),
    };

    const sentChunks: string[] = [];
    const placeholder = {
      id: "msg-placeholder",
      edit: vi.fn(async (_content: string) => undefined),
    };
    const mockThread = {
      id: "thread-of-trig-2",
      sendTyping: vi.fn(async () => undefined),
      send: vi.fn(async (content: string) => {
        sentChunks.push(content);
        return placeholder;
      }),
    };
    const mockChannel = {
      id: "channel-of-trig-2",
      threads: { create: vi.fn(async () => mockThread) },
      isTextBased: () => true,
    };
    const localDiscordClient = {
      channels: { fetch: vi.fn(async () => mockChannel) },
      user: { id: "bot-user-id" },
    };

    const localSessionManager = makeMockSessionManager();
    localSessionManager._setConfig(
      "agent-a",
      makeAgentConfig({
        webhook: {
          displayName: "Agent A",
          avatarUrl: "https://example.com/a.png",
          webhookUrl: "https://discord.com/api/webhooks/999/abc",
        },
      }),
    );

    // Single-block: accumulated == reply (5000 chars in both).
    const big = "Z".repeat(5000);
    vi.mocked(localSessionManager.streamFromAgent).mockImplementation(
      async (_name, _msg, onChunk) => {
        if (onChunk) onChunk(big);
        return big;
      },
    );

    const spawner = new SubagentThreadSpawner({
      sessionManager: localSessionManager,
      registryPath,
      discordClient: localDiscordClient as any,
      log: fakeLog as any,
    });

    await spawner.spawnInThread({
      parentAgentName: "agent-a",
      threadName: "overflow-trigger-test-back-compat",
      autoRelay: false,
    });
    await new Promise((r) => setTimeout(r, 50));

    const summaryLog = logCalls.find((c) =>
      c.msg.includes("subagent overflow chunks summary"),
    );
    expect(summaryLog).toBeDefined();
    expect(summaryLog!.obj.fullySent).toBe(true);
    expect(summaryLog!.obj.totalLength).toBe(5000);
  });
});
