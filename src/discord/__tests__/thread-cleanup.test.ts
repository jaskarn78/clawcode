/**
 * Phase 999.14 Plan 00 — MCP-08 RED tests for the Discord-cleanup classifier
 * and the cleanupThreadWithClassifier helper.
 *
 * Wave 0 status: these tests are RED on purpose. The module
 * `../thread-cleanup` exists as a thrower stub (see thread-cleanup.ts);
 * every test below either:
 *   - asserts a classifier branch that the stub does not implement, OR
 *   - exercises the cleanup helper which throws "not implemented in Wave 0".
 *
 * Wave 1 Task 1 replaces the stub with the real implementation, turning
 * all 17 tests GREEN.
 *
 * Contract this file pins:
 *   - classifyDiscordCleanupError truth table (50001/10003/404 → prune;
 *     5xx/429/network → retain; unknown → unknown).
 *   - cleanupThreadWithClassifier success / prune / retain / unknown paths.
 *   - Canonical warn log shape includes agentName field (operator-triage
 *     regression — fin-acquisition vs fin-test).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyDiscordCleanupError,
  cleanupThreadWithClassifier,
  type ThreadCleanupSpawner,
} from "../thread-cleanup.js";

// Mock the registry module so we can verify removeBinding + writeThreadRegistry
// are invoked exactly when classification is "prune".
const { removeBindingMock, writeThreadRegistryMock, readThreadRegistryMock } =
  vi.hoisted(() => ({
    removeBindingMock: vi.fn(),
    writeThreadRegistryMock: vi.fn(),
    readThreadRegistryMock: vi.fn(),
  }));

vi.mock("../thread-registry.js", async () => {
  const actual =
    await vi.importActual<typeof import("../thread-registry.js")>(
      "../thread-registry.js",
    );
  return {
    ...actual,
    removeBinding: removeBindingMock,
    writeThreadRegistry: writeThreadRegistryMock,
    readThreadRegistry: readThreadRegistryMock,
  };
});

function makeLog(): {
  warn: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  child: ReturnType<typeof vi.fn>;
} {
  const log = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  log.child.mockReturnValue(log);
  return log;
}

function makeSpawner(
  archiveImpl: () => Promise<{ bindingPruned: boolean }>,
): ThreadCleanupSpawner {
  return {
    archiveThread: vi.fn(archiveImpl),
  };
}

const REGISTRY_PATH = "/tmp/test-thread-bindings.json";
const THREAD_ID = "thread-abc";
const AGENT_NAME = "fin-acquisition";

describe("classifyDiscordCleanupError truth table (MCP-08)", () => {
  it("Test 1: code 50001 (Missing Access) → prune", () => {
    expect(classifyDiscordCleanupError({ code: 50001 })).toBe("prune");
  });

  it("Test 2: code 10003 (Unknown Channel) → prune", () => {
    expect(classifyDiscordCleanupError({ code: 10003 })).toBe("prune");
  });

  it("Test 3: status 404 → prune", () => {
    expect(classifyDiscordCleanupError({ status: 404 })).toBe("prune");
  });

  it("Test 4: status 500 → retain", () => {
    expect(classifyDiscordCleanupError({ status: 500 })).toBe("retain");
  });

  it("Test 5: status 503 → retain", () => {
    expect(classifyDiscordCleanupError({ status: 503 })).toBe("retain");
  });

  it("Test 6: status 429 (rate-limited) → retain", () => {
    expect(classifyDiscordCleanupError({ status: 429 })).toBe("retain");
  });

  it("Test 7: code ECONNRESET → retain", () => {
    expect(classifyDiscordCleanupError({ code: "ECONNRESET" })).toBe("retain");
  });

  it("Test 8: code ETIMEDOUT → retain", () => {
    expect(classifyDiscordCleanupError({ code: "ETIMEDOUT" })).toBe("retain");
  });

  it("Test 9: code ENOTFOUND → retain", () => {
    expect(classifyDiscordCleanupError({ code: "ENOTFOUND" })).toBe("retain");
  });

  it("Test 10: random Error → unknown", () => {
    expect(classifyDiscordCleanupError(new Error("random"))).toBe("unknown");
  });

  it("Test 11: null → unknown", () => {
    expect(classifyDiscordCleanupError(null)).toBe("unknown");
  });
});

describe("cleanupThreadWithClassifier orchestration (MCP-08)", () => {
  beforeEach(() => {
    removeBindingMock.mockReset();
    writeThreadRegistryMock.mockReset();
    readThreadRegistryMock.mockReset();
    readThreadRegistryMock.mockResolvedValue({ bindings: [], updatedAt: 0 });
    removeBindingMock.mockImplementation((reg: unknown) => reg);
    writeThreadRegistryMock.mockResolvedValue(undefined);
  });

  it("Test 12: happy path — archive resolves, no warn log", async () => {
    const spawner = makeSpawner(async () => ({ bindingPruned: true }));
    const log = makeLog();

    const result = await cleanupThreadWithClassifier({
      spawner,
      registryPath: REGISTRY_PATH,
      threadId: THREAD_ID,
      agentName: AGENT_NAME,
      log: log as unknown as import("pino").Logger,
    });

    expect(result.archived).toBe(true);
    expect(result.bindingPruned).toBe(true);
    expect(result.classification).toBe("success");
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("Test 13: Discord 50001 → registry pruned, classification=prune, canonical warn log", async () => {
    const spawner = makeSpawner(async () => {
      const err = new Error("Missing Access") as Error & { code: number };
      err.code = 50001;
      throw err;
    });
    const log = makeLog();

    const result = await cleanupThreadWithClassifier({
      spawner,
      registryPath: REGISTRY_PATH,
      threadId: THREAD_ID,
      agentName: AGENT_NAME,
      log: log as unknown as import("pino").Logger,
    });

    expect(result.archived).toBe(false);
    expect(result.bindingPruned).toBe(true);
    expect(result.classification).toBe("prune");
    expect(removeBindingMock).toHaveBeenCalledWith(
      expect.any(Object),
      THREAD_ID,
    );
    expect(writeThreadRegistryMock).toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "thread-cleanup",
        action: "prune-after-discord-error",
        discordCode: 50001,
        threadId: THREAD_ID,
        agentName: AGENT_NAME,
      }),
      expect.any(String),
    );
  });

  it("Test 14: Discord 10003 → registry pruned, classification=prune, canonical warn log", async () => {
    const spawner = makeSpawner(async () => {
      const err = new Error("Unknown Channel") as Error & { code: number };
      err.code = 10003;
      throw err;
    });
    const log = makeLog();

    const result = await cleanupThreadWithClassifier({
      spawner,
      registryPath: REGISTRY_PATH,
      threadId: THREAD_ID,
      agentName: AGENT_NAME,
      log: log as unknown as import("pino").Logger,
    });

    expect(result.classification).toBe("prune");
    expect(result.bindingPruned).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "thread-cleanup",
        action: "prune-after-discord-error",
        discordCode: 10003,
      }),
      expect.any(String),
    );
  });

  it("Test 15: 5xx → registry NOT pruned, classification=retain, info log only (NOT warn)", async () => {
    const spawner = makeSpawner(async () => {
      const err = new Error("Internal Error") as Error & { status: number };
      err.status = 503;
      throw err;
    });
    const log = makeLog();

    const result = await cleanupThreadWithClassifier({
      spawner,
      registryPath: REGISTRY_PATH,
      threadId: THREAD_ID,
      agentName: AGENT_NAME,
      log: log as unknown as import("pino").Logger,
    });

    expect(result.archived).toBe(false);
    expect(result.bindingPruned).toBe(false);
    expect(result.classification).toBe("retain");
    expect(removeBindingMock).not.toHaveBeenCalled();
    expect(writeThreadRegistryMock).not.toHaveBeenCalled();
    // 5xx storms must not blow up logs — info, not warn.
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "thread-cleanup",
        action: "retain-on-transient-error",
      }),
      expect.any(String),
    );
  });

  it("Test 16: unknown error → registry NOT pruned, classification=unknown", async () => {
    const spawner = makeSpawner(async () => {
      throw new Error("totally unexpected");
    });
    const log = makeLog();

    const result = await cleanupThreadWithClassifier({
      spawner,
      registryPath: REGISTRY_PATH,
      threadId: THREAD_ID,
      agentName: AGENT_NAME,
      log: log as unknown as import("pino").Logger,
    });

    expect(result.archived).toBe(false);
    expect(result.bindingPruned).toBe(false);
    expect(result.classification).toBe("unknown");
    expect(removeBindingMock).not.toHaveBeenCalled();
  });

  it("Test 17: prune-after-discord-error log includes agentName for operator triage", async () => {
    const spawner = makeSpawner(async () => {
      const err = new Error("Missing Access") as Error & { code: number };
      err.code = 50001;
      throw err;
    });
    const log = makeLog();

    await cleanupThreadWithClassifier({
      spawner,
      registryPath: REGISTRY_PATH,
      threadId: THREAD_ID,
      agentName: AGENT_NAME,
      log: log as unknown as import("pino").Logger,
    });

    // The agentName field is the regression — operators must be able to
    // filter logs by agent during incident triage (e.g. fin-acquisition
    // vs fin-test from today's incident).
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "thread-cleanup",
        action: "prune-after-discord-error",
        discordCode: 50001,
        threadId: expect.any(String),
        agentName: expect.any(String),
      }),
      expect.any(String),
    );
  });
});
