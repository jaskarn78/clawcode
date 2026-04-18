/**
 * ConversationStore -- Session lifecycle management and turn recording.
 *
 * Provides CRUD operations for conversation_sessions and conversation_turns
 * tables created by MemoryStore.migrateConversationTables(). Enforces the
 * session state machine: active -> ended/crashed -> summarized.
 *
 * All returned objects and arrays are Object.freeze()d per project immutability
 * convention. Boolean conversion for is_trusted_channel (SQLite INTEGER 0/1
 * to JS boolean) is handled in row conversion helpers.
 *
 * Receives DatabaseType directly (not MemoryStore) since ConversationStore
 * does not use MemoryStore.insert().
 */

import type { Database as DatabaseType, Statement } from "better-sqlite3";
import { nanoid } from "nanoid";
import type {
  ConversationSession,
  ConversationTurn,
  RecordTurnInput,
} from "./conversation-types.js";

/** Raw session row shape from SQLite. */
type SessionRow = {
  readonly id: string;
  readonly agent_name: string;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly turn_count: number;
  readonly total_tokens: number;
  readonly summary_memory_id: string | null;
  readonly status: string;
};

/** Raw turn row shape from SQLite. */
type TurnRow = {
  readonly id: string;
  readonly session_id: string;
  readonly turn_index: number;
  readonly role: string;
  readonly content: string;
  readonly token_count: number | null;
  readonly channel_id: string | null;
  readonly discord_user_id: string | null;
  readonly discord_message_id: string | null;
  readonly is_trusted_channel: number;
  readonly origin: string | null;
  readonly instruction_flags: string | null;
  readonly created_at: string;
};

/** Prepared statements for all conversation operations. */
type ConversationStatements = {
  readonly insertSession: Statement;
  readonly updateSessionEnd: Statement;
  readonly updateSessionCrash: Statement;
  readonly updateSessionSummarized: Statement;
  readonly getSession: Statement;
  readonly listSessions: Statement;
  readonly insertTurn: Statement;
  readonly getTurnsForSession: Statement;
  readonly getTurnsForSessionLimited: Statement;
  readonly getSessionTurnCount: Statement;
  readonly incrementTurnCount: Statement;
  readonly addTokens: Statement;
};

/** Convert a raw SQLite session row to an immutable ConversationSession. */
function rowToSession(row: SessionRow): ConversationSession {
  return Object.freeze({
    id: row.id,
    agentName: row.agent_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    turnCount: row.turn_count,
    totalTokens: row.total_tokens,
    summaryMemoryId: row.summary_memory_id,
    status: row.status as ConversationSession["status"],
  });
}

/**
 * Convert a raw SQLite turn row to an immutable ConversationTurn.
 * CRITICAL: is_trusted_channel INTEGER (0/1) is converted to boolean.
 */
function rowToTurn(row: TurnRow): ConversationTurn {
  return Object.freeze({
    id: row.id,
    sessionId: row.session_id,
    turnIndex: row.turn_index,
    role: row.role as ConversationTurn["role"],
    content: row.content,
    tokenCount: row.token_count,
    channelId: row.channel_id,
    discordUserId: row.discord_user_id,
    discordMessageId: row.discord_message_id,
    isTrustedChannel: row.is_trusted_channel === 1,
    origin: row.origin,
    instructionFlags: row.instruction_flags,
    createdAt: row.created_at,
  });
}

/**
 * ConversationStore -- manages conversation session lifecycle and turn recording.
 *
 * Constructor receives a better-sqlite3 Database instance (from store.getDatabase()).
 * Tables must already exist (created by MemoryStore.migrateConversationTables()).
 *
 * Session state machine:
 *   active -> ended   (endSession)
 *   active -> crashed  (crashSession)
 *   ended  -> summarized (markSummarized)
 *   crashed -> summarized (markSummarized)
 *
 * All other transitions throw.
 */
export class ConversationStore {
  private readonly db: DatabaseType;
  private readonly stmts: ConversationStatements;

  constructor(db: DatabaseType) {
    this.db = db;
    this.stmts = this.prepareStatements();
  }

  /**
   * Create a new conversation session for the given agent.
   * Returns a frozen ConversationSession with status="active".
   */
  startSession(agentName: string): ConversationSession {
    const id = nanoid();
    const now = new Date().toISOString();

    this.stmts.insertSession.run(id, agentName, now);

    return Object.freeze({
      id,
      agentName,
      startedAt: now,
      endedAt: null,
      turnCount: 0,
      totalTokens: 0,
      summaryMemoryId: null,
      status: "active" as const,
    });
  }

  /**
   * End an active session. Sets status="ended" and records ended_at.
   * Throws if the session is not in "active" status.
   */
  endSession(sessionId: string): ConversationSession {
    const now = new Date().toISOString();
    const result = this.stmts.updateSessionEnd.run(now, sessionId);

    if (result.changes === 0) {
      throw new Error(
        `Cannot end session '${sessionId}': not found or not in 'active' status`,
      );
    }

    const row = this.stmts.getSession.get(sessionId) as SessionRow;
    return rowToSession(row);
  }

  /**
   * Crash an active session. Sets status="crashed" and records ended_at.
   * Throws if the session is not in "active" status.
   */
  crashSession(sessionId: string): ConversationSession {
    const now = new Date().toISOString();
    const result = this.stmts.updateSessionCrash.run(now, sessionId);

    if (result.changes === 0) {
      throw new Error(
        `Cannot crash session '${sessionId}': not found or not in 'active' status`,
      );
    }

    const row = this.stmts.getSession.get(sessionId) as SessionRow;
    return rowToSession(row);
  }

  /**
   * Mark an ended or crashed session as summarized with a link to the summary memory.
   * Throws if the session is not in "ended" or "crashed" status.
   */
  markSummarized(
    sessionId: string,
    summaryMemoryId: string,
  ): ConversationSession {
    const result = this.stmts.updateSessionSummarized.run(
      summaryMemoryId,
      sessionId,
    );

    if (result.changes === 0) {
      throw new Error(
        `Cannot mark session '${sessionId}' as summarized: not found or not in 'ended'/'crashed' status`,
      );
    }

    const row = this.stmts.getSession.get(sessionId) as SessionRow;
    return rowToSession(row);
  }

  /**
   * Retrieve a session by ID.
   * Returns null if not found.
   */
  getSession(sessionId: string): ConversationSession | null {
    const row = this.stmts.getSession.get(sessionId) as SessionRow | undefined;
    if (!row) return null;
    return rowToSession(row);
  }

  /**
   * List recent sessions for an agent, ordered by started_at DESC.
   * Returns a frozen array of frozen ConversationSession objects.
   */
  listRecentSessions(
    agentName: string,
    limit: number,
  ): readonly ConversationSession[] {
    const rows = this.stmts.listSessions.all(agentName, limit) as SessionRow[];
    return Object.freeze(rows.map(rowToSession));
  }

  /**
   * Record a new turn in a conversation session.
   *
   * Uses a transaction to atomically:
   * 1. Read the current turn_count from the session
   * 2. Insert the turn with turn_index = current turn_count
   * 3. Increment the session's turn_count
   * 4. Add tokenCount to the session's total_tokens
   *
   * Converts isTrustedChannel boolean to SQLite INTEGER (0/1).
   * Returns a frozen ConversationTurn.
   */
  recordTurn(input: RecordTurnInput): ConversationTurn {
    const id = nanoid();
    const now = new Date().toISOString();
    const tokenCount = input.tokenCount ?? null;
    const channelId = input.channelId ?? null;
    const discordUserId = input.discordUserId ?? null;
    const discordMessageId = input.discordMessageId ?? null;
    const isTrustedChannel = input.isTrustedChannel === true ? 1 : 0;
    const origin = input.origin ?? null;
    const instructionFlags = input.instructionFlags ?? null;

    const turnIndex = this.db.transaction(() => {
      // Get current turn_count as the next turn_index
      const sessionRow = this.stmts.getSessionTurnCount.get(
        input.sessionId,
      ) as { turn_count: number } | undefined;

      if (!sessionRow) {
        throw new Error(
          `Cannot record turn: session '${input.sessionId}' not found`,
        );
      }

      const idx = sessionRow.turn_count;

      // Insert the turn
      this.stmts.insertTurn.run(
        id,
        input.sessionId,
        idx,
        input.role,
        input.content,
        tokenCount,
        channelId,
        discordUserId,
        discordMessageId,
        isTrustedChannel,
        origin,
        instructionFlags,
        now,
      );

      // Increment turn_count
      this.stmts.incrementTurnCount.run(input.sessionId);

      // Add tokens
      if (tokenCount !== null) {
        this.stmts.addTokens.run(tokenCount, input.sessionId);
      }

      return idx;
    })();

    return Object.freeze({
      id,
      sessionId: input.sessionId,
      turnIndex,
      role: input.role,
      content: input.content,
      tokenCount,
      channelId,
      discordUserId,
      discordMessageId,
      isTrustedChannel: isTrustedChannel === 1,
      origin,
      instructionFlags,
      createdAt: now,
    });
  }

  /**
   * Get all turns for a session, ordered by turn_index ASC.
   * Optionally limited to N turns. Returns a frozen array.
   */
  getTurnsForSession(
    sessionId: string,
    limit?: number,
  ): readonly ConversationTurn[] {
    const rows =
      limit !== undefined
        ? (this.stmts.getTurnsForSessionLimited.all(
            sessionId,
            limit,
          ) as TurnRow[])
        : (this.stmts.getTurnsForSession.all(sessionId) as TurnRow[]);

    return Object.freeze(rows.map(rowToTurn));
  }

  /** Prepare all SQL statements for conversation operations. */
  private prepareStatements(): ConversationStatements {
    return {
      insertSession: this.db.prepare(
        `INSERT INTO conversation_sessions (id, agent_name, started_at, status)
         VALUES (?, ?, ?, 'active')`,
      ),
      updateSessionEnd: this.db.prepare(
        `UPDATE conversation_sessions
         SET status = 'ended', ended_at = ?
         WHERE id = ? AND status = 'active'`,
      ),
      updateSessionCrash: this.db.prepare(
        `UPDATE conversation_sessions
         SET status = 'crashed', ended_at = ?
         WHERE id = ? AND status = 'active'`,
      ),
      updateSessionSummarized: this.db.prepare(
        `UPDATE conversation_sessions
         SET status = 'summarized', summary_memory_id = ?
         WHERE id = ? AND status IN ('ended', 'crashed')`,
      ),
      getSession: this.db.prepare(
        `SELECT id, agent_name, started_at, ended_at, turn_count,
                total_tokens, summary_memory_id, status
         FROM conversation_sessions WHERE id = ?`,
      ),
      listSessions: this.db.prepare(
        `SELECT id, agent_name, started_at, ended_at, turn_count,
                total_tokens, summary_memory_id, status
         FROM conversation_sessions
         WHERE agent_name = ?
         ORDER BY started_at DESC, rowid DESC
         LIMIT ?`,
      ),
      insertTurn: this.db.prepare(
        `INSERT INTO conversation_turns
         (id, session_id, turn_index, role, content, token_count,
          channel_id, discord_user_id, discord_message_id,
          is_trusted_channel, origin, instruction_flags, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      getTurnsForSession: this.db.prepare(
        `SELECT id, session_id, turn_index, role, content, token_count,
                channel_id, discord_user_id, discord_message_id,
                is_trusted_channel, origin, instruction_flags, created_at
         FROM conversation_turns
         WHERE session_id = ?
         ORDER BY turn_index ASC`,
      ),
      getTurnsForSessionLimited: this.db.prepare(
        `SELECT id, session_id, turn_index, role, content, token_count,
                channel_id, discord_user_id, discord_message_id,
                is_trusted_channel, origin, instruction_flags, created_at
         FROM conversation_turns
         WHERE session_id = ?
         ORDER BY turn_index ASC
         LIMIT ?`,
      ),
      getSessionTurnCount: this.db.prepare(
        `SELECT turn_count FROM conversation_sessions WHERE id = ?`,
      ),
      incrementTurnCount: this.db.prepare(
        `UPDATE conversation_sessions
         SET turn_count = turn_count + 1
         WHERE id = ?`,
      ),
      addTokens: this.db.prepare(
        `UPDATE conversation_sessions
         SET total_tokens = total_tokens + ?
         WHERE id = ?`,
      ),
    };
  }
}
