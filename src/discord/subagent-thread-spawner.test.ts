import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { SubagentThreadSpawner } from "./subagent-thread-spawner.js";
import type { SubagentThreadConfig } from "./subagent-thread-types.js";
import type { SessionManager } from "../manager/session-manager.js";
import type { ResolvedAgentConfig } from "../shared/types.js";
import { readThreadRegistry } from "./thread-registry.js";

/**
 * Create a minimal mock ResolvedAgentConfig for testing.
 */
function makeAgentConfig(
  overrides: Partial<ResolvedAgentConfig> = {},
): ResolvedAgentConfig {
  return {
    name: "agent-a",
    workspace: "/tmp/agent-a",
    channels: ["channel-1"],
    model: "sonnet",
    effort: "low",
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
    sendToAgent: vi.fn(),
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
