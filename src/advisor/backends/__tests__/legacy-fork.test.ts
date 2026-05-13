/**
 * Parity + invariant tests for `LegacyForkAdvisor` and the underlying
 * `forkAdvisorConsult()` primitive extracted from `daemon.ts:9843–9854`
 * in Plan 117-03.
 *
 * Pattern: `src/manager/escalation.test.ts:1–16` — mock `SessionManager`
 * with `vi.fn()` covering `forkSession`, `dispatchTurn`, `stopAgent`.
 *
 * Coverage (per Plan 117-03 §Verification + RESEARCH §5):
 *   A. Happy path — `consult()` returns `{ answer }` matching the
 *      mock `dispatchTurn` return; `forkSession` called with parent
 *      agent + modelOverride + systemPromptOverride; `dispatchTurn`
 *      called with fork name + question; `stopAgent` called with
 *      fork name in `finally`.
 *   B. Regression — try/finally stopAgent invariant: when
 *      `dispatchTurn` rejects, `consult()` propagates the rejection
 *      AND `stopAgent` is still called. This is the most important
 *      behavioral guarantee preserved by the extraction.
 *   C. `id === "fork"` — the backend self-identifies as the legacy
 *      fork backend for registry lookup.
 *
 * EXTRACTION_BASELINE — verbatim copy of the pre-117-03 fork body
 * from `src/manager/daemon.ts:9843–9854` (the source of truth this
 * test pins behavior against; do not delete during reviewer diff
 * comparison):
 *
 *   const fork = await manager.forkSession(agentName, {
 *     modelOverride: "opus" as const,
 *     systemPromptOverride: systemPrompt,
 *   });
 *
 *   let answer: string;
 *   try {
 *     answer = await manager.dispatchTurn(fork.forkName, question);
 *   } finally {
 *     // Always clean up the fork
 *     await manager.stopAgent(fork.forkName).catch(() => {});
 *   }
 *
 * (System-prompt assembly + memory-context retrieval + budget +
 * truncation lived in the surrounding IPC handler in pre-117-03
 * code; those concerns are NOT part of forkAdvisorConsult and are
 * NOT covered here — see `src/advisor/__tests__/service.test.ts`.)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LegacyForkAdvisor } from "../legacy-fork.js";
import { forkAdvisorConsult } from "../../../manager/daemon.js";
import type { SessionManager } from "../../../manager/session-manager.js";

function createMockSessionManager() {
  return {
    forkSession: vi.fn().mockResolvedValue({
      forkName: "agent-fork-abc",
      parentAgent: "agent",
      sessionId: "sess-1",
    }),
    dispatchTurn: vi.fn().mockResolvedValue("advice text"),
    stopAgent: vi.fn().mockResolvedValue(undefined),
    getMemoryStore: vi.fn().mockReturnValue(null),
    getEmbedder: vi.fn(),
  } as unknown as SessionManager;
}

const DEFAULT_ARGS = {
  agent: "agent",
  question: "q",
  systemPrompt: "sp",
  advisorModel: "opus",
};

describe("LegacyForkAdvisor", () => {
  let mockManager: SessionManager;
  let advisor: LegacyForkAdvisor;

  beforeEach(() => {
    mockManager = createMockSessionManager();
    advisor = new LegacyForkAdvisor(mockManager);
  });

  // Assertion C — id surface
  it("identifies as the legacy fork backend (id === 'fork')", () => {
    expect(advisor.id).toBe("fork");
  });

  // Assertion A — happy path parity
  describe("consult() — happy path", () => {
    it("returns the raw answer from dispatchTurn (no truncation)", async () => {
      const result = await advisor.consult(DEFAULT_ARGS);
      expect(result).toEqual({ answer: "advice text" });
    });

    it("forks the parent agent with the supplied advisorModel + systemPrompt", async () => {
      await advisor.consult({
        agent: "agent",
        question: "should I refactor?",
        systemPrompt: "You are an advisor to agent \"agent\".",
        advisorModel: "opus",
      });
      expect(mockManager.forkSession).toHaveBeenCalledTimes(1);
      expect(mockManager.forkSession).toHaveBeenCalledWith("agent", {
        modelOverride: "opus",
        systemPromptOverride: "You are an advisor to agent \"agent\".",
      });
    });

    it("dispatches one turn carrying the question to the fork", async () => {
      await advisor.consult({
        ...DEFAULT_ARGS,
        question: "should I refactor?",
      });
      expect(mockManager.dispatchTurn).toHaveBeenCalledTimes(1);
      expect(mockManager.dispatchTurn).toHaveBeenCalledWith(
        "agent-fork-abc",
        "should I refactor?",
      );
    });

    it("calls stopAgent(forkName) in finally on the happy path", async () => {
      await advisor.consult(DEFAULT_ARGS);
      expect(mockManager.stopAgent).toHaveBeenCalledTimes(1);
      expect(mockManager.stopAgent).toHaveBeenCalledWith("agent-fork-abc");
    });
  });

  // Assertion B — try/finally invariant (the parity-critical regression)
  describe("consult() — try/finally stopAgent invariant", () => {
    it("still calls stopAgent when dispatchTurn rejects, then re-throws", async () => {
      const boom = new Error("dispatchTurn boom");
      (mockManager.dispatchTurn as ReturnType<typeof vi.fn>).mockRejectedValue(
        boom,
      );

      await expect(advisor.consult(DEFAULT_ARGS)).rejects.toThrow(
        "dispatchTurn boom",
      );

      // The invariant: even after dispatchTurn throws, stopAgent fires.
      expect(mockManager.stopAgent).toHaveBeenCalledTimes(1);
      expect(mockManager.stopAgent).toHaveBeenCalledWith("agent-fork-abc");
    });

    it("swallows stopAgent errors after a successful dispatch (parity with daemon .catch(() => {}))", async () => {
      (mockManager.stopAgent as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("stopAgent failed"),
      );
      // Should NOT reject — the legacy code wraps stopAgent in `.catch(() => {})`
      const result = await advisor.consult(DEFAULT_ARGS);
      expect(result).toEqual({ answer: "advice text" });
      expect(mockManager.stopAgent).toHaveBeenCalledTimes(1);
    });
  });

  // Cross-check: the standalone function (without the class wrapper) has
  // the same behavior. LegacyForkAdvisor is a pure adapter — if these
  // diverge, the adapter has gained behavior it shouldn't.
  describe("forkAdvisorConsult() — direct function parity", () => {
    it("produces the same result the class wrapper would (no adapter logic)", async () => {
      const direct = await forkAdvisorConsult(mockManager, DEFAULT_ARGS);
      expect(direct).toEqual({ answer: "advice text" });
    });

    it("preserves the try/finally invariant at the function level", async () => {
      (mockManager.dispatchTurn as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("boom"),
      );
      await expect(
        forkAdvisorConsult(mockManager, DEFAULT_ARGS),
      ).rejects.toThrow("boom");
      expect(mockManager.stopAgent).toHaveBeenCalledTimes(1);
    });
  });
});
