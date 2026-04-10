import { describe, it, expect, vi, beforeEach } from "vitest";
import { EscalationMonitor } from "./escalation.js";
import type { EscalationConfig } from "./escalation.js";
import type { SessionManager } from "./session-manager.js";

function createMockSessionManager() {
  return {
    forkSession: vi.fn().mockResolvedValue({
      forkName: "agent-fork-abc123",
      parentAgent: "agent",
      sessionId: "sess-1",
    }),
    sendToAgent: vi.fn().mockResolvedValue("escalated response"),
    stopAgent: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionManager;
}

const defaultConfig: EscalationConfig = {
  errorThreshold: 3,
  escalationModel: "sonnet",
  keywordTriggers: ["this needs opus"],
};

describe("EscalationMonitor", () => {
  let mockManager: SessionManager;
  let monitor: EscalationMonitor;

  beforeEach(() => {
    mockManager = createMockSessionManager();
    monitor = new EscalationMonitor(mockManager, defaultConfig);
  });

  describe("shouldEscalate", () => {
    it("returns false when errorCount < threshold", () => {
      expect(monitor.shouldEscalate("agent", "some response", true)).toBe(false);
      expect(monitor.shouldEscalate("agent", "some response", true)).toBe(false);
    });

    it("returns true when errorCount reaches threshold", () => {
      monitor.shouldEscalate("agent", "error response", true);
      monitor.shouldEscalate("agent", "error response", true);
      const result = monitor.shouldEscalate("agent", "error response", true);
      expect(result).toBe(true);
    });

    it("returns true when message contains keyword trigger", () => {
      const result = monitor.shouldEscalate("agent", "I think this needs opus for this task", false);
      expect(result).toBe(true);
    });

    it("keyword trigger is case-insensitive", () => {
      const result = monitor.shouldEscalate("agent", "THIS NEEDS OPUS please", false);
      expect(result).toBe(true);
    });

    it("returns false for fork sessions (name contains '-fork-')", () => {
      monitor.shouldEscalate("agent-fork-abc123", "error", true);
      monitor.shouldEscalate("agent-fork-abc123", "error", true);
      const result = monitor.shouldEscalate("agent-fork-abc123", "error", true);
      expect(result).toBe(false);
    });

    it("returns false when escalation is already in progress", async () => {
      // Trigger 3 errors to make it escalatable
      monitor.shouldEscalate("agent", "error", true);
      monitor.shouldEscalate("agent", "error", true);
      monitor.shouldEscalate("agent", "error", true);

      // Start escalation (don't await - keeps lock held)
      const slowManager = createMockSessionManager();
      (slowManager.sendToAgent as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve("done"), 100)),
      );
      const slowMonitor = new EscalationMonitor(slowManager, defaultConfig);
      slowMonitor.shouldEscalate("agent", "error", true);
      slowMonitor.shouldEscalate("agent", "error", true);
      slowMonitor.shouldEscalate("agent", "error", true);

      // Start escalation without awaiting
      const escalatePromise = slowMonitor.escalate("agent", "help");

      // While escalation is in progress, shouldEscalate returns false
      expect(slowMonitor.shouldEscalate("agent", "error", true)).toBe(false);

      await escalatePromise;
    });

    it("resets error count on non-error response without keyword", () => {
      monitor.shouldEscalate("agent", "error", true);
      monitor.shouldEscalate("agent", "error", true);
      // Non-error resets the count
      monitor.shouldEscalate("agent", "all good", false);
      // Third error after reset is not at threshold
      expect(monitor.shouldEscalate("agent", "error", true)).toBe(false);
    });
  });

  describe("escalate", () => {
    it("calls forkSession with modelOverride, sends message, stops fork", async () => {
      const result = await monitor.escalate("agent", "complex task");

      expect((mockManager.forkSession as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        "agent",
        { modelOverride: "sonnet" },
      );
      expect((mockManager.sendToAgent as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        "agent-fork-abc123",
        "complex task",
      );
      expect((mockManager.stopAgent as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        "agent-fork-abc123",
      );
      expect(result).toBe("escalated response");
    });

    it("resets error count after successful escalation", async () => {
      // Build up errors
      monitor.shouldEscalate("agent", "error", true);
      monitor.shouldEscalate("agent", "error", true);
      monitor.shouldEscalate("agent", "error", true);

      await monitor.escalate("agent", "help");

      // Error count should be reset - next errors don't trigger immediately
      expect(monitor.shouldEscalate("agent", "error", true)).toBe(false);
      expect(monitor.shouldEscalate("agent", "error", true)).toBe(false);
    });

    it("releases lock even if fork throws", async () => {
      const failManager = createMockSessionManager();
      (failManager.forkSession as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fork failed"));
      const failMonitor = new EscalationMonitor(failManager, defaultConfig);

      await expect(failMonitor.escalate("agent", "help")).rejects.toThrow("fork failed");

      // Lock should be released - shouldEscalate should work
      failMonitor.shouldEscalate("agent", "error", true);
      failMonitor.shouldEscalate("agent", "error", true);
      expect(failMonitor.shouldEscalate("agent", "error", true)).toBe(true);
    });
  });

  describe("resetErrorCount", () => {
    it("clears the error counter for a specific agent", () => {
      monitor.shouldEscalate("agent", "error", true);
      monitor.shouldEscalate("agent", "error", true);
      monitor.resetErrorCount("agent");
      // After reset, need 3 more errors
      expect(monitor.shouldEscalate("agent", "error", true)).toBe(false);
      expect(monitor.shouldEscalate("agent", "error", true)).toBe(false);
      expect(monitor.shouldEscalate("agent", "error", true)).toBe(true);
    });
  });
});
