import { describe, it, expect, afterEach } from "vitest";
import { MemoryStore } from "../store.js";
import { ConversationStore } from "../conversation-store.js";

/** Create a real memory entry and return its ID (for FK-safe summary references). */
function createMemoryEntry(memStore: MemoryStore, label: string): string {
  const embedding = new Float32Array(384);
  for (let i = 0; i < 384; i++) embedding[i] = Math.sin(i + label.length);
  let norm = 0;
  for (let i = 0; i < 384; i++) norm += embedding[i] * embedding[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < 384; i++) embedding[i] /= norm;

  const entry = memStore.insert(
    { content: `Summary: ${label}`, source: "conversation", skipDedup: true },
    embedding,
  );
  return entry.id;
}

describe("ConversationStore", () => {
  let memStore: MemoryStore;
  let convStore: ConversationStore;

  afterEach(() => {
    memStore?.close();
  });

  function setup(): void {
    memStore = new MemoryStore(":memory:", {
      enabled: false,
      similarityThreshold: 0.85,
    });
    convStore = new ConversationStore(memStore.getDatabase());
  }

  describe("session lifecycle", () => {
    it("startSession creates an active session with zeroed counters", () => {
      setup();
      const session = convStore.startSession("agent-a");

      expect(session.agentName).toBe("agent-a");
      expect(session.status).toBe("active");
      expect(session.turnCount).toBe(0);
      expect(session.totalTokens).toBe(0);
      expect(session.endedAt).toBeNull();
      expect(session.summaryMemoryId).toBeNull();
      expect(session.id).toBeTruthy();
      expect(session.startedAt).toBeTruthy();
    });

    it("endSession transitions active to ended with endedAt set", () => {
      setup();
      const session = convStore.startSession("agent-a");
      const ended = convStore.endSession(session.id);

      expect(ended.status).toBe("ended");
      expect(ended.endedAt).toBeTruthy();
      expect(ended.id).toBe(session.id);
    });

    it("crashSession transitions active to crashed with endedAt set", () => {
      setup();
      const session = convStore.startSession("agent-a");
      const crashed = convStore.crashSession(session.id);

      expect(crashed.status).toBe("crashed");
      expect(crashed.endedAt).toBeTruthy();
      expect(crashed.id).toBe(session.id);
    });

    it("markSummarized transitions ended to summarized with summaryMemoryId", () => {
      setup();
      const memId = createMemoryEntry(memStore, "ended-summary");
      const session = convStore.startSession("agent-a");
      convStore.endSession(session.id);
      const summarized = convStore.markSummarized(session.id, memId);

      expect(summarized.status).toBe("summarized");
      expect(summarized.summaryMemoryId).toBe(memId);
    });

    it("markSummarized transitions crashed to summarized", () => {
      setup();
      const memId = createMemoryEntry(memStore, "crashed-summary");
      const session = convStore.startSession("agent-a");
      convStore.crashSession(session.id);
      const summarized = convStore.markSummarized(session.id, memId);

      expect(summarized.status).toBe("summarized");
      expect(summarized.summaryMemoryId).toBe(memId);
    });

    it("getSession returns session by id", () => {
      setup();
      const session = convStore.startSession("agent-a");
      const retrieved = convStore.getSession(session.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(session.id);
      expect(retrieved!.agentName).toBe("agent-a");
    });

    it("getSession returns null for nonexistent id", () => {
      setup();
      const result = convStore.getSession("nonexistent");
      expect(result).toBeNull();
    });

    it("listRecentSessions returns sessions ordered by started_at DESC", () => {
      setup();
      const s1 = convStore.startSession("agent-a");
      const s2 = convStore.startSession("agent-a");
      const s3 = convStore.startSession("agent-a");

      const recent = convStore.listRecentSessions("agent-a", 5);

      expect(recent).toHaveLength(3);
      // Most recent first
      expect(recent[0].id).toBe(s3.id);
      expect(recent[1].id).toBe(s2.id);
      expect(recent[2].id).toBe(s1.id);
    });

    it("listRecentSessions respects limit", () => {
      setup();
      convStore.startSession("agent-a");
      convStore.startSession("agent-a");
      convStore.startSession("agent-a");

      const recent = convStore.listRecentSessions("agent-a", 2);
      expect(recent).toHaveLength(2);
    });

    it("listRecentSessions filters by agent name", () => {
      setup();
      convStore.startSession("agent-a");
      convStore.startSession("agent-b");

      const aRecent = convStore.listRecentSessions("agent-a", 10);
      const bRecent = convStore.listRecentSessions("agent-b", 10);

      expect(aRecent).toHaveLength(1);
      expect(bRecent).toHaveLength(1);
      expect(aRecent[0].agentName).toBe("agent-a");
      expect(bRecent[0].agentName).toBe("agent-b");
    });
  });

  describe("state machine transitions", () => {
    it("endSession throws on non-active session", () => {
      setup();
      const session = convStore.startSession("agent-a");
      convStore.endSession(session.id);

      expect(() => convStore.endSession(session.id)).toThrow();
    });

    it("crashSession throws on non-active session", () => {
      setup();
      const session = convStore.startSession("agent-a");
      convStore.endSession(session.id);

      expect(() => convStore.crashSession(session.id)).toThrow();
    });

    it("markSummarized throws on active session", () => {
      setup();
      const memId = createMemoryEntry(memStore, "active-test");
      const session = convStore.startSession("agent-a");

      expect(() => convStore.markSummarized(session.id, memId)).toThrow();
    });

    it("endSession throws on nonexistent session", () => {
      setup();
      expect(() => convStore.endSession("does-not-exist")).toThrow();
    });

    it("crashSession throws on nonexistent session", () => {
      setup();
      expect(() => convStore.crashSession("does-not-exist")).toThrow();
    });

    it("markSummarized throws on nonexistent session", () => {
      setup();
      const memId = createMemoryEntry(memStore, "nonexistent-test");
      expect(() => convStore.markSummarized("does-not-exist", memId)).toThrow();
    });
  });

  describe("recordTurn", () => {
    it("records a turn with auto-incremented turnIndex (0-based)", () => {
      setup();
      const session = convStore.startSession("agent-a");

      const turn1 = convStore.recordTurn({
        sessionId: session.id,
        role: "user",
        content: "Hello",
        tokenCount: 10,
      });
      const turn2 = convStore.recordTurn({
        sessionId: session.id,
        role: "assistant",
        content: "Hi there",
        tokenCount: 20,
      });

      expect(turn1.turnIndex).toBe(0);
      expect(turn2.turnIndex).toBe(1);
      expect(turn1.id).toBeTruthy();
      expect(turn2.id).toBeTruthy();
    });

    it("increments session turn_count and total_tokens", () => {
      setup();
      const session = convStore.startSession("agent-a");

      convStore.recordTurn({
        sessionId: session.id,
        role: "user",
        content: "Hello",
        tokenCount: 10,
      });
      convStore.recordTurn({
        sessionId: session.id,
        role: "assistant",
        content: "Hi",
        tokenCount: 20,
      });

      const updated = convStore.getSession(session.id);
      expect(updated!.turnCount).toBe(2);
      expect(updated!.totalTokens).toBe(30);
    });

    it("records turn with all fields including optional ones", () => {
      setup();
      const session = convStore.startSession("agent-a");

      const turn = convStore.recordTurn({
        sessionId: session.id,
        role: "user",
        content: "Hello from Discord",
        tokenCount: 15,
        channelId: "ch-123",
        discordUserId: "user-456",
        discordMessageId: "msg-789",
        isTrustedChannel: true,
        origin: "discord:ch-123",
      });

      expect(turn.content).toBe("Hello from Discord");
      expect(turn.tokenCount).toBe(15);
      expect(turn.channelId).toBe("ch-123");
      expect(turn.discordUserId).toBe("user-456");
      expect(turn.discordMessageId).toBe("msg-789");
      expect(turn.isTrustedChannel).toBe(true);
      expect(turn.origin).toBe("discord:ch-123");
      expect(turn.createdAt).toBeTruthy();
    });

    it("defaults optional fields to null/false when omitted", () => {
      setup();
      const session = convStore.startSession("agent-a");

      const turn = convStore.recordTurn({
        sessionId: session.id,
        role: "user",
        content: "Simple message",
      });

      expect(turn.tokenCount).toBeNull();
      expect(turn.channelId).toBeNull();
      expect(turn.discordUserId).toBeNull();
      expect(turn.discordMessageId).toBeNull();
      expect(turn.isTrustedChannel).toBe(false);
      expect(turn.origin).toBeNull();
    });

    it("getTurnsForSession returns turns ordered by turn_index ASC", () => {
      setup();
      const session = convStore.startSession("agent-a");

      convStore.recordTurn({
        sessionId: session.id,
        role: "user",
        content: "First",
      });
      convStore.recordTurn({
        sessionId: session.id,
        role: "assistant",
        content: "Second",
      });
      convStore.recordTurn({
        sessionId: session.id,
        role: "user",
        content: "Third",
      });

      const turns = convStore.getTurnsForSession(session.id);
      expect(turns).toHaveLength(3);
      expect(turns[0].turnIndex).toBe(0);
      expect(turns[1].turnIndex).toBe(1);
      expect(turns[2].turnIndex).toBe(2);
      expect(turns[0].content).toBe("First");
      expect(turns[1].content).toBe("Second");
      expect(turns[2].content).toBe("Third");
    });

    it("getTurnsForSession with limit returns at most N turns", () => {
      setup();
      const session = convStore.startSession("agent-a");

      convStore.recordTurn({
        sessionId: session.id,
        role: "user",
        content: "First",
      });
      convStore.recordTurn({
        sessionId: session.id,
        role: "assistant",
        content: "Second",
      });
      convStore.recordTurn({
        sessionId: session.id,
        role: "user",
        content: "Third",
      });

      const turns = convStore.getTurnsForSession(session.id, 2);
      expect(turns).toHaveLength(2);
      expect(turns[0].turnIndex).toBe(0);
      expect(turns[1].turnIndex).toBe(1);
    });

    it("recording duplicate (session_id, turn_index, role) throws UNIQUE constraint error", () => {
      setup();
      const session = convStore.startSession("agent-a");

      convStore.recordTurn({
        sessionId: session.id,
        role: "user",
        content: "Hello",
      });

      // Manually try to insert duplicate via a second session with same session_id
      // Since recordTurn auto-increments, we need to reach the UNIQUE constraint
      // by using the underlying DB directly
      const db = memStore.getDatabase();
      expect(() => {
        db.prepare(
          `INSERT INTO conversation_turns (id, session_id, turn_index, role, content, is_trusted_channel, created_at)
           VALUES ('dup-id', ?, 0, 'user', 'duplicate', 0, datetime('now'))`,
        ).run(session.id);
      }).toThrow(/UNIQUE/);
    });
  });

  describe("provenance fields (SEC-01)", () => {
    it("stores isTrustedChannel=true as 1 and returns boolean true", () => {
      setup();
      const session = convStore.startSession("agent-a");

      const turn = convStore.recordTurn({
        sessionId: session.id,
        role: "user",
        content: "Trusted message",
        isTrustedChannel: true,
      });

      expect(turn.isTrustedChannel).toBe(true);
      expect(typeof turn.isTrustedChannel).toBe("boolean");

      // Verify via raw DB that it's stored as 1
      const db = memStore.getDatabase();
      const row = db
        .prepare(
          "SELECT is_trusted_channel FROM conversation_turns WHERE id = ?",
        )
        .get(turn.id) as { is_trusted_channel: number };
      expect(row.is_trusted_channel).toBe(1);
    });

    it("stores isTrustedChannel=false (default) as 0 and returns boolean false", () => {
      setup();
      const session = convStore.startSession("agent-a");

      const turn = convStore.recordTurn({
        sessionId: session.id,
        role: "user",
        content: "Untrusted message",
      });

      expect(turn.isTrustedChannel).toBe(false);
      expect(typeof turn.isTrustedChannel).toBe("boolean");

      // Verify raw DB
      const db = memStore.getDatabase();
      const row = db
        .prepare(
          "SELECT is_trusted_channel FROM conversation_turns WHERE id = ?",
        )
        .get(turn.id) as { is_trusted_channel: number };
      expect(row.is_trusted_channel).toBe(0);
    });

    it("stores channelId and discordUserId correctly", () => {
      setup();
      const session = convStore.startSession("agent-a");

      const turn = convStore.recordTurn({
        sessionId: session.id,
        role: "user",
        content: "From Discord",
        channelId: "channel-abc",
        discordUserId: "user-def",
      });

      expect(turn.channelId).toBe("channel-abc");
      expect(turn.discordUserId).toBe("user-def");

      // Verify persisted via getTurnsForSession
      const turns = convStore.getTurnsForSession(session.id);
      expect(turns[0].channelId).toBe("channel-abc");
      expect(turns[0].discordUserId).toBe("user-def");
    });
  });

  describe("immutability", () => {
    it("returned ConversationSession objects are frozen", () => {
      setup();
      const session = convStore.startSession("agent-a");
      expect(Object.isFrozen(session)).toBe(true);
    });

    it("returned ConversationTurn objects are frozen", () => {
      setup();
      const session = convStore.startSession("agent-a");
      const turn = convStore.recordTurn({
        sessionId: session.id,
        role: "user",
        content: "Test",
      });
      expect(Object.isFrozen(turn)).toBe(true);
    });

    it("returned arrays from listRecentSessions are frozen", () => {
      setup();
      convStore.startSession("agent-a");
      const sessions = convStore.listRecentSessions("agent-a", 10);
      expect(Object.isFrozen(sessions)).toBe(true);
    });

    it("returned arrays from getTurnsForSession are frozen", () => {
      setup();
      const session = convStore.startSession("agent-a");
      convStore.recordTurn({
        sessionId: session.id,
        role: "user",
        content: "Test",
      });
      const turns = convStore.getTurnsForSession(session.id);
      expect(Object.isFrozen(turns)).toBe(true);
    });

    it("getSession returns frozen session", () => {
      setup();
      const session = convStore.startSession("agent-a");
      const retrieved = convStore.getSession(session.id);
      expect(Object.isFrozen(retrieved)).toBe(true);
    });

    it("endSession returns frozen session", () => {
      setup();
      const session = convStore.startSession("agent-a");
      const ended = convStore.endSession(session.id);
      expect(Object.isFrozen(ended)).toBe(true);
    });

    it("crashSession returns frozen session", () => {
      setup();
      const session = convStore.startSession("agent-a");
      const crashed = convStore.crashSession(session.id);
      expect(Object.isFrozen(crashed)).toBe(true);
    });

    it("markSummarized returns frozen session", () => {
      setup();
      const memId = createMemoryEntry(memStore, "frozen-test");
      const session = convStore.startSession("agent-a");
      convStore.endSession(session.id);
      const summarized = convStore.markSummarized(session.id, memId);
      expect(Object.isFrozen(summarized)).toBe(true);
    });
  });

  describe("instructionFlags", () => {
    it("recordTurn persists instructionFlags when provided", () => {
      setup();
      const session = convStore.startSession("agent-a");
      const flags = '{"detected":true,"patterns":["<\\\\s*system\\\\s*>"],"riskLevel":"high"}';

      const turn = convStore.recordTurn({
        sessionId: session.id,
        role: "user",
        content: "<system>evil</system>",
        instructionFlags: flags,
      });

      expect(turn.instructionFlags).toBe(flags);

      // Verify via raw DB
      const db = memStore.getDatabase();
      const row = db
        .prepare(
          "SELECT instruction_flags FROM conversation_turns WHERE id = ?",
        )
        .get(turn.id) as { instruction_flags: string | null };
      expect(row.instruction_flags).toBe(flags);
    });

    it("recordTurn stores null instructionFlags when omitted", () => {
      setup();
      const session = convStore.startSession("agent-a");

      const turn = convStore.recordTurn({
        sessionId: session.id,
        role: "user",
        content: "Hello, normal message",
      });

      expect(turn.instructionFlags).toBeNull();
    });

    it("getTurnsForSession returns instructionFlags field", () => {
      setup();
      const session = convStore.startSession("agent-a");
      const flags = '{"detected":true,"patterns":[],"riskLevel":"medium"}';

      convStore.recordTurn({
        sessionId: session.id,
        role: "user",
        content: "Flagged message",
        instructionFlags: flags,
      });
      convStore.recordTurn({
        sessionId: session.id,
        role: "assistant",
        content: "Response",
      });

      const turns = convStore.getTurnsForSession(session.id);
      expect(turns).toHaveLength(2);
      expect(turns[0].instructionFlags).toBe(flags);
      expect(turns[1].instructionFlags).toBeNull();
    });
  });

  describe("lineage support", () => {
    it("source_turn_ids column exists on memories table", () => {
      setup();
      const db = memStore.getDatabase();
      const columns = db
        .prepare("PRAGMA table_info(memories)")
        .all() as ReadonlyArray<{ name: string }>;
      const hasColumn = columns.some((c) => c.name === "source_turn_ids");
      expect(hasColumn).toBe(true);
    });

    it("conversation_sessions table exists with expected columns", () => {
      setup();
      const db = memStore.getDatabase();
      const columns = db
        .prepare("PRAGMA table_info(conversation_sessions)")
        .all() as ReadonlyArray<{ name: string }>;
      const colNames = columns.map((c) => c.name);
      expect(colNames).toContain("id");
      expect(colNames).toContain("agent_name");
      expect(colNames).toContain("started_at");
      expect(colNames).toContain("ended_at");
      expect(colNames).toContain("turn_count");
      expect(colNames).toContain("total_tokens");
      expect(colNames).toContain("summary_memory_id");
      expect(colNames).toContain("status");
    });

    it("conversation_turns table exists with provenance columns", () => {
      setup();
      const db = memStore.getDatabase();
      const columns = db
        .prepare("PRAGMA table_info(conversation_turns)")
        .all() as ReadonlyArray<{ name: string }>;
      const colNames = columns.map((c) => c.name);
      expect(colNames).toContain("id");
      expect(colNames).toContain("session_id");
      expect(colNames).toContain("turn_index");
      expect(colNames).toContain("role");
      expect(colNames).toContain("content");
      expect(colNames).toContain("token_count");
      expect(colNames).toContain("channel_id");
      expect(colNames).toContain("discord_user_id");
      expect(colNames).toContain("discord_message_id");
      expect(colNames).toContain("is_trusted_channel");
      expect(colNames).toContain("origin");
      expect(colNames).toContain("created_at");
    });
  });
});
