import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
    channels: ["#general"],
    model: "sonnet",
    skills: [],
    soul: undefined,
    identity: undefined,
    memory: { compactionThreshold: 0.75, searchTopK: 10 },
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
