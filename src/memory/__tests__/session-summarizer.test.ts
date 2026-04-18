/**
 * SessionSummarizer unit tests.
 *
 * Covers: happy path, skip conditions (<3 turns, already-summarized,
 * session-not-terminal, session-not-found), timeout/error fallback,
 * pure helper shapes. Uses real MemoryStore(":memory:") + real
 * ConversationStore (mirrors conversation-store.test.ts harness) with
 * mocked embedder and summarize function.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import pino from "pino";
import { MemoryStore } from "../store.js";
import { ConversationStore } from "../conversation-store.js";
import type { EmbeddingService } from "../embedder.js";
import type {
  SummarizeFn,
  SummarizeSessionDeps,
} from "../session-summarizer.types.js";
import {
  summarizeSession,
  buildSessionSummarizationPrompt,
  buildRawTurnFallback,
  DEFAULT_IMPORTANCE,
} from "../session-summarizer.js";
import type { ConversationTurn } from "../conversation-types.js";

function createMockEmbedder(): EmbeddingService {
  return {
    embed: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
    warmup: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
  } as unknown as EmbeddingService;
}

function silentLog() {
  return pino({ level: "silent" });
}

/** Build a ConversationTurn fixture (for pure-helper tests). */
function makeTurn(
  overrides: Partial<ConversationTurn> & Pick<ConversationTurn, "role" | "content" | "turnIndex">,
): ConversationTurn {
  return Object.freeze({
    id: overrides.id ?? "t-fixture",
    sessionId: overrides.sessionId ?? "s-fixture",
    turnIndex: overrides.turnIndex,
    role: overrides.role,
    content: overrides.content,
    tokenCount: overrides.tokenCount ?? null,
    channelId: overrides.channelId ?? null,
    discordUserId: overrides.discordUserId ?? null,
    discordMessageId: overrides.discordMessageId ?? null,
    isTrustedChannel: overrides.isTrustedChannel ?? false,
    origin: overrides.origin ?? null,
    instructionFlags: overrides.instructionFlags ?? null,
    createdAt: overrides.createdAt ?? "2026-04-18T00:00:00Z",
  });
}

describe("SessionSummarizer", () => {
  let memStore: MemoryStore;
  let convStore: ConversationStore;

  beforeEach(() => {
    memStore = new MemoryStore(":memory:", {
      enabled: false,
      similarityThreshold: 0.85,
    });
    convStore = new ConversationStore(memStore.getDatabase());
  });

  afterEach(() => {
    memStore?.close();
  });

  /** Seed a session with N turns, then end it so it is terminal. */
  function seedEndedSession(turnCount: number): {
    sessionId: string;
    turnIds: string[];
  } {
    const session = convStore.startSession("agent-a");
    const turnIds: string[] = [];
    for (let i = 0; i < turnCount; i++) {
      const turn = convStore.recordTurn({
        sessionId: session.id,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Turn ${i} content with enough text to be meaningful.`,
      });
      turnIds.push(turn.id);
    }
    convStore.endSession(session.id);
    return { sessionId: session.id, turnIds };
  }

  describe("happy path", () => {
    it("writes MemoryEntry with correct source, tags, importance, and sourceTurnIds", async () => {
      const { sessionId, turnIds } = seedEndedSession(5);
      const mockSummarize: SummarizeFn = vi
        .fn()
        .mockResolvedValue(
          "## User Preferences\n- Prefers terse responses\n\n## Decisions\n- Used SQLite\n\n## Open Threads\n(none)\n\n## Commitments\n(none)\n",
        );
      const deps: SummarizeSessionDeps = {
        conversationStore: convStore,
        memoryStore: memStore,
        embedder: createMockEmbedder(),
        summarize: mockSummarize,
        log: silentLog(),
      };

      const result = await summarizeSession(
        { agentName: "agent-a", sessionId },
        deps,
      );

      expect(result).toMatchObject({
        success: true,
        fallback: false,
        turnCount: 5,
      });
      if ("success" in result && result.success) {
        const entry = memStore.getById(result.memoryId);
        expect(entry).not.toBeNull();
        expect(entry!.source).toBe("conversation");
        expect(entry!.tags).toContain("session-summary");
        expect(entry!.tags).toContain(`session:${sessionId}`);
        expect(entry!.tags).not.toContain("raw-fallback");
        expect(entry!.importance).toBe(DEFAULT_IMPORTANCE);
        expect(entry!.sourceTurnIds).toEqual(turnIds);
      }
      expect(mockSummarize).toHaveBeenCalledTimes(1);
    });

    it("links summary to session via markSummarized (status=summarized, summary_memory_id set)", async () => {
      const { sessionId } = seedEndedSession(3);
      const mockSummarize: SummarizeFn = vi
        .fn()
        .mockResolvedValue("## User Preferences\n(none)\n");
      const deps: SummarizeSessionDeps = {
        conversationStore: convStore,
        memoryStore: memStore,
        embedder: createMockEmbedder(),
        summarize: mockSummarize,
        log: silentLog(),
      };

      const result = await summarizeSession(
        { agentName: "agent-a", sessionId },
        deps,
      );
      expect("success" in result && result.success).toBe(true);

      const updated = convStore.getSession(sessionId);
      expect(updated!.status).toBe("summarized");
      if ("success" in result && result.success) {
        expect(updated!.summaryMemoryId).toBe(result.memoryId);
      }
    });

    it("success result is frozen", async () => {
      const { sessionId } = seedEndedSession(3);
      const deps: SummarizeSessionDeps = {
        conversationStore: convStore,
        memoryStore: memStore,
        embedder: createMockEmbedder(),
        summarize: vi.fn().mockResolvedValue("## User Preferences\n(none)\n"),
        log: silentLog(),
      };
      const result = await summarizeSession(
        { agentName: "agent-a", sessionId },
        deps,
      );
      expect(Object.isFrozen(result)).toBe(true);
    });

    it("passes AbortSignal to the summarize function", async () => {
      const { sessionId } = seedEndedSession(3);
      const mockSummarize = vi
        .fn()
        .mockResolvedValue("## User Preferences\n(none)\n");
      const deps: SummarizeSessionDeps = {
        conversationStore: convStore,
        memoryStore: memStore,
        embedder: createMockEmbedder(),
        summarize: mockSummarize as unknown as SummarizeFn,
        log: silentLog(),
      };

      await summarizeSession({ agentName: "agent-a", sessionId }, deps);

      expect(mockSummarize).toHaveBeenCalledTimes(1);
      const call = mockSummarize.mock.calls[0];
      expect(call[0]).toContain("User Preferences"); // prompt arg
      expect(call[1]).toHaveProperty("signal");
      expect(call[1].signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("skip conditions", () => {
    it("skips sessions with fewer than 3 turns (default minTurns)", async () => {
      const { sessionId } = seedEndedSession(2);
      const mockSummarize: SummarizeFn = vi.fn();
      const deps: SummarizeSessionDeps = {
        conversationStore: convStore,
        memoryStore: memStore,
        embedder: createMockEmbedder(),
        summarize: mockSummarize,
        log: silentLog(),
      };

      const result = await summarizeSession(
        { agentName: "agent-a", sessionId },
        deps,
      );

      expect(result).toMatchObject({
        skipped: true,
        reason: "insufficient-turns",
        turnCount: 2,
      });
      expect(mockSummarize).not.toHaveBeenCalled();

      // Session NOT transitioned to summarized — still ended
      const session = convStore.getSession(sessionId);
      expect(session!.status).toBe("ended");
    });

    it("respects custom minTurns via config", async () => {
      const { sessionId } = seedEndedSession(5);
      const mockSummarize: SummarizeFn = vi.fn();
      const deps: SummarizeSessionDeps = {
        conversationStore: convStore,
        memoryStore: memStore,
        embedder: createMockEmbedder(),
        summarize: mockSummarize,
        log: silentLog(),
        config: { minTurns: 10 },
      };

      const result = await summarizeSession(
        { agentName: "agent-a", sessionId },
        deps,
      );
      expect(result).toMatchObject({
        skipped: true,
        reason: "insufficient-turns",
        turnCount: 5,
      });
      expect(mockSummarize).not.toHaveBeenCalled();
    });

    it("is idempotent: already-summarized session returns skipped with no side effects", async () => {
      const { sessionId } = seedEndedSession(3);
      const mockSummarize: SummarizeFn = vi
        .fn()
        .mockResolvedValue("## User Preferences\n(none)\n");
      const deps: SummarizeSessionDeps = {
        conversationStore: convStore,
        memoryStore: memStore,
        embedder: createMockEmbedder(),
        summarize: mockSummarize,
        log: silentLog(),
      };

      // First call summarizes
      await summarizeSession({ agentName: "agent-a", sessionId }, deps);
      expect(mockSummarize).toHaveBeenCalledTimes(1);

      // Second call short-circuits
      const result2 = await summarizeSession(
        { agentName: "agent-a", sessionId },
        deps,
      );
      expect(result2).toMatchObject({
        skipped: true,
        reason: "already-summarized",
      });
      expect(mockSummarize).toHaveBeenCalledTimes(1); // still 1, no second call
    });

    it("rejects active sessions with session-not-terminal", async () => {
      const session = convStore.startSession("agent-a");
      for (let i = 0; i < 5; i++) {
        convStore.recordTurn({
          sessionId: session.id,
          role: "user",
          content: `Turn ${i}`,
        });
      }
      // NOT ending the session — still active
      const mockSummarize: SummarizeFn = vi.fn();
      const deps: SummarizeSessionDeps = {
        conversationStore: convStore,
        memoryStore: memStore,
        embedder: createMockEmbedder(),
        summarize: mockSummarize,
        log: silentLog(),
      };

      const result = await summarizeSession(
        { agentName: "agent-a", sessionId: session.id },
        deps,
      );
      expect(result).toMatchObject({
        skipped: true,
        reason: "session-not-terminal",
      });
      expect(mockSummarize).not.toHaveBeenCalled();
    });

    it("returns session-not-found for nonexistent session ID", async () => {
      const deps: SummarizeSessionDeps = {
        conversationStore: convStore,
        memoryStore: memStore,
        embedder: createMockEmbedder(),
        summarize: vi.fn(),
        log: silentLog(),
      };
      const result = await summarizeSession(
        { agentName: "agent-a", sessionId: "nonexistent" },
        deps,
      );
      expect(result).toMatchObject({
        skipped: true,
        reason: "session-not-found",
      });
    });

    it("works on crashed sessions (ended or crashed both trigger summarization)", async () => {
      const session = convStore.startSession("agent-a");
      for (let i = 0; i < 3; i++) {
        convStore.recordTurn({
          sessionId: session.id,
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Turn ${i}`,
        });
      }
      convStore.crashSession(session.id);

      const deps: SummarizeSessionDeps = {
        conversationStore: convStore,
        memoryStore: memStore,
        embedder: createMockEmbedder(),
        summarize: vi.fn().mockResolvedValue("## User Preferences\n(none)\n"),
        log: silentLog(),
      };

      const result = await summarizeSession(
        { agentName: "agent-a", sessionId: session.id },
        deps,
      );
      expect("success" in result && result.success).toBe(true);
      expect(convStore.getSession(session.id)!.status).toBe("summarized");
    });
  });

  describe("timeout and error fallback", () => {
    it("timeout falls back to raw-turn markdown and tags raw-fallback", async () => {
      const { sessionId, turnIds } = seedEndedSession(3);
      // Summarize hangs forever — abort controller must fire
      const mockSummarize: SummarizeFn = (_prompt, opts) =>
        new Promise((_, reject) => {
          opts.signal?.addEventListener("abort", () =>
            reject(new Error("AbortError")),
          );
        });
      const deps: SummarizeSessionDeps = {
        conversationStore: convStore,
        memoryStore: memStore,
        embedder: createMockEmbedder(),
        summarize: mockSummarize,
        log: silentLog(),
        config: { timeoutMs: 50 }, // very short for test
      };

      const result = await summarizeSession(
        { agentName: "agent-a", sessionId },
        deps,
      );

      expect(result).toMatchObject({
        success: true,
        fallback: true,
        turnCount: 3,
      });
      if ("success" in result && result.success) {
        const entry = memStore.getById(result.memoryId);
        expect(entry).not.toBeNull();
        expect(entry!.tags).toContain("raw-fallback");
        expect(entry!.content).toContain("## Raw Turns");
        expect(entry!.sourceTurnIds).toEqual(turnIds);
      }
    });

    it("LLM error falls back to raw turns with raw-fallback tag", async () => {
      const { sessionId } = seedEndedSession(3);
      const mockSummarize: SummarizeFn = vi
        .fn()
        .mockRejectedValue(new Error("Anthropic 500"));
      const deps: SummarizeSessionDeps = {
        conversationStore: convStore,
        memoryStore: memStore,
        embedder: createMockEmbedder(),
        summarize: mockSummarize,
        log: silentLog(),
      };

      const result = await summarizeSession(
        { agentName: "agent-a", sessionId },
        deps,
      );
      expect(result).toMatchObject({ success: true, fallback: true });
      if ("success" in result && result.success) {
        const entry = memStore.getById(result.memoryId);
        expect(entry!.tags).toContain("raw-fallback");
      }
    });

    it("empty LLM response triggers fallback", async () => {
      const { sessionId } = seedEndedSession(3);
      const mockSummarize: SummarizeFn = vi
        .fn()
        .mockResolvedValue("   \n  \n");
      const deps: SummarizeSessionDeps = {
        conversationStore: convStore,
        memoryStore: memStore,
        embedder: createMockEmbedder(),
        summarize: mockSummarize,
        log: silentLog(),
      };

      const result = await summarizeSession(
        { agentName: "agent-a", sessionId },
        deps,
      );
      expect(result).toMatchObject({ success: true, fallback: true });
    });

    it("session still transitions to summarized even on fallback path", async () => {
      const { sessionId } = seedEndedSession(3);
      const mockSummarize: SummarizeFn = vi
        .fn()
        .mockRejectedValue(new Error("LLM error"));
      const deps: SummarizeSessionDeps = {
        conversationStore: convStore,
        memoryStore: memStore,
        embedder: createMockEmbedder(),
        summarize: mockSummarize,
        log: silentLog(),
      };

      await summarizeSession({ agentName: "agent-a", sessionId }, deps);
      const updated = convStore.getSession(sessionId);
      expect(updated!.status).toBe("summarized");
      expect(updated!.summaryMemoryId).not.toBeNull();
    });
  });

  describe("pure helpers", () => {
    it("buildSessionSummarizationPrompt includes all 4 section headers", () => {
      const turns = [
        makeTurn({ id: "t1", turnIndex: 0, role: "user", content: "hello" }),
      ];
      const prompt = buildSessionSummarizationPrompt(turns);
      expect(prompt).toContain("## User Preferences");
      expect(prompt).toContain("## Decisions");
      expect(prompt).toContain("## Open Threads");
      expect(prompt).toContain("## Commitments");
      expect(prompt).toContain("user");
      expect(prompt).toContain("hello");
    });

    it("buildSessionSummarizationPrompt truncates content over MAX_PROMPT_CHARS", () => {
      const hugeTurn = "x".repeat(50_000);
      const turns = [
        makeTurn({ id: "t1", turnIndex: 0, role: "user", content: hugeTurn }),
      ];
      const prompt = buildSessionSummarizationPrompt(turns);
      expect(prompt).toContain("[...truncated due to length]");
      expect(prompt.length).toBeLessThan(50_000);
    });

    it("buildSessionSummarizationPrompt handles empty turns without crashing", () => {
      const prompt = buildSessionSummarizationPrompt([]);
      expect(prompt).toContain("## User Preferences");
      expect(prompt).toContain("## Commitments");
      expect(typeof prompt).toBe("string");
    });

    it("buildRawTurnFallback returns (no turns) for empty input", () => {
      const result = buildRawTurnFallback([]);
      expect(result).toContain("## Raw Turns");
      expect(result).toContain("(no turns)");
    });

    it("buildRawTurnFallback includes role, turn index, and content for each turn", () => {
      const turns = [
        makeTurn({ id: "t1", turnIndex: 0, role: "user", content: "alpha" }),
        makeTurn({
          id: "t2",
          turnIndex: 1,
          role: "assistant",
          content: "beta",
        }),
      ];
      const result = buildRawTurnFallback(turns);
      expect(result).toContain("### user (turn 0)");
      expect(result).toContain("alpha");
      expect(result).toContain("### assistant (turn 1)");
      expect(result).toContain("beta");
    });
  });
});
