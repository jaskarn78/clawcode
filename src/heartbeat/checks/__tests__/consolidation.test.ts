import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CheckContext, CheckResult } from "../../types.js";

// Mock the consolidation module before importing the check
vi.mock("../../../memory/consolidation.js", () => ({
  runConsolidation: vi.fn(),
}));

import consolidationCheck, { _resetLock } from "../consolidation.js";
import { runConsolidation } from "../../../memory/consolidation.js";

const mockRunConsolidation = vi.mocked(runConsolidation);

/** Build a mock CheckContext with controllable SessionManager methods. */
function buildContext(overrides: {
  agentName?: string;
  memoryStore?: unknown;
  embedder?: unknown;
  agentConfig?: unknown;
} = {}): CheckContext {
  const agentName = overrides.agentName ?? "test-agent";

  const sessionManager: CheckContext["sessionManager"] = {
    getMemoryStore: vi.fn().mockReturnValue(overrides.memoryStore ?? {}),
    getEmbedder: vi.fn().mockReturnValue(overrides.embedder ?? {}),
    getAgentConfig: vi.fn().mockReturnValue(
      overrides.agentConfig ?? {
        workspace: "/tmp/test-workspace",
        memory: {
          consolidation: {
            enabled: true,
            weeklyThreshold: 7,
            monthlyThreshold: 4,
          },
        },
      },
    ),
    sendToAgent: vi.fn().mockResolvedValue("summarized content"),
    getRunningAgents: vi.fn().mockReturnValue([agentName]),
    getContextFillProvider: vi.fn(),
    getSessionLogger: vi.fn(),
    getCompactionManager: vi.fn(),
    warmupEmbeddings: vi.fn(),
    startAgent: vi.fn(),
    streamFromAgent: vi.fn(),
    forwardToAgent: vi.fn(),
    forkSession: vi.fn(),
    stopAgent: vi.fn(),
    restartAgent: vi.fn(),
    startAll: vi.fn(),
    stopAll: vi.fn(),
    reconcileRegistry: vi.fn(),
    getTierManager: vi.fn(),
    getUsageTracker: vi.fn(),
    saveContextSummary: vi.fn(),
    setSkillsCatalog: vi.fn(),
    setAllAgentConfigs: vi.fn(),
  } as CheckContext["sessionManager"];

  return {
    agentName,
    sessionManager,
    registry: { entries: [], updatedAt: Date.now() },
    config: {
      enabled: true,
      intervalSeconds: 60,
      checkTimeoutSeconds: 10,
      contextFill: { warningThreshold: 0.7, criticalThreshold: 0.9 },
    },
  };
}

describe("consolidation heartbeat check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLock();
  });

  it("has correct name, interval, and timeout", () => {
    expect(consolidationCheck.name).toBe("consolidation");
    expect(consolidationCheck.interval).toBe(86400);
    expect(consolidationCheck.timeout).toBe(120);
  });

  it("returns healthy with consolidation counts when consolidation succeeds", async () => {
    mockRunConsolidation.mockResolvedValue({
      weeklyDigestsCreated: 2,
      monthlyDigestsCreated: 1,
      filesArchived: 14,
      errors: [],
    });

    const context = buildContext();
    const result = await consolidationCheck.execute(context);

    expect(result.status).toBe("healthy");
    expect(result.message).toContain("Consolidated");
    expect(result.message).toContain("2 weekly");
    expect(result.message).toContain("1 monthly");
    expect(result.metadata).toMatchObject({
      weeklyDigestsCreated: 2,
      monthlyDigestsCreated: 1,
      filesArchived: 14,
    });
  });

  it("returns warning with error details when consolidation partially fails", async () => {
    mockRunConsolidation.mockResolvedValue({
      weeklyDigestsCreated: 1,
      monthlyDigestsCreated: 0,
      filesArchived: 7,
      errors: ["Weekly consolidation failed for 2026-W10: LLM timeout"],
    });

    const context = buildContext();
    const result = await consolidationCheck.execute(context);

    expect(result.status).toBe("warning");
    expect(result.message).toContain("partial");
    expect(result.message).toContain("1 errors");
  });

  it("returns healthy with skipped message when no consolidation needed", async () => {
    mockRunConsolidation.mockResolvedValue({
      weeklyDigestsCreated: 0,
      monthlyDigestsCreated: 0,
      filesArchived: 0,
      errors: [],
    });

    const context = buildContext();
    const result = await consolidationCheck.execute(context);

    expect(result.status).toBe("healthy");
    expect(result.message).toContain("No consolidation needed");
  });

  it("returns warning when agent has no memory store configured", async () => {
    const context = buildContext({ memoryStore: undefined });
    (context.sessionManager.getMemoryStore as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const result = await consolidationCheck.execute(context);

    expect(result.status).toBe("warning");
    expect(result.message).toContain("No memory system configured");
  });

  it("prevents concurrent execution with lock", async () => {
    // First call takes a while
    let resolveFirst: (v: unknown) => void;
    const firstPromise = new Promise((r) => { resolveFirst = r; });
    mockRunConsolidation.mockImplementationOnce(() => firstPromise as never);

    const context = buildContext();

    // Start first call (don't await)
    const first = consolidationCheck.execute(context);

    // Second call should return immediately with "already running"
    const second = await consolidationCheck.execute(context);

    expect(second.status).toBe("healthy");
    expect(second.message).toContain("already running");
    expect(second.metadata).toMatchObject({ skipped: true });

    // Resolve first call to clean up
    resolveFirst!({
      weeklyDigestsCreated: 0,
      monthlyDigestsCreated: 0,
      filesArchived: 0,
      errors: [],
    });
    await first;
  });

  it("releases lock after execution completes even on error", async () => {
    mockRunConsolidation.mockRejectedValueOnce(new Error("LLM failure"));

    const context = buildContext();
    const result = await consolidationCheck.execute(context);

    // Should have returned warning (caught error)
    expect(result.status).toBe("warning");
    expect(result.message).toContain("Consolidation failed");

    // Lock should be released -- next call should proceed (not return "already running")
    mockRunConsolidation.mockResolvedValueOnce({
      weeklyDigestsCreated: 0,
      monthlyDigestsCreated: 0,
      filesArchived: 0,
      errors: [],
    });

    const result2 = await consolidationCheck.execute(context);
    expect(result2.message).not.toContain("already running");
  });
});
