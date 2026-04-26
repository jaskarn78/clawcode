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
  ConversationTurnSearchResult,
  RecordTurnInput,
  SearchTurnsOptions,
  SearchTurnsResult,
} from "./conversation-types.js";

/**
 * Escape an agent-provided query for safe use in an FTS5 MATCH expression.
 *
 * Phrase-quotes the trimmed input and doubles any embedded double-quotes.
 * FTS5 MATCH syntax reserves `:` (column filters), `()` (boolean groups),
 * `"` (phrase delimiters), `*`, `-`, `+`, `NEAR`, `AND`/`OR`/`NOT`. Agents
 * write natural language, so naive interpolation crashes the parser with
 * `fts5: syntax error near ...` — see Pitfall 1 in 68-RESEARCH.md.
 *
 * Empty/whitespace input returns `""` which is a valid phrase that
 * matches nothing (never throws). This is the "dumb but safe" strategy
 * the phase explicitly chose; boolean operator support is a future
 * enhancement if dogfooding surfaces a concrete need.
 */
export function escapeFtsQuery(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '""';
  const escaped = trimmed.replace(/"/g, '""');
  return `"${escaped}"`;
}

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
  /**
   * agents-forget-across-sessions debug (2026-04-19): terminated-only listing
   * used by the resume-brief gap check. Excludes status='active' so a
   * just-started session doesn't collapse the gap to zero on every daemon
   * boot (Phase 67 SESS-03 production bug).
   */
  readonly listRecentTerminatedSessions: Statement;
  readonly insertTurn: Statement;
  readonly getTurnsForSession: Statement;
  readonly getTurnsForSessionLimited: Statement;
  readonly getSessionTurnCount: Statement;
  readonly incrementTurnCount: Statement;
  readonly addTokens: Statement;
  // Phase 68 — RETR-02: FTS5 search over conversation_turns.content
  readonly searchTurnsFts: Statement;
  readonly searchTurnsFtsUntrusted: Statement;
  readonly searchTurnsCount: Statement;
  readonly searchTurnsCountUntrusted: Statement;
  // Gap 2 (memory-persistence-gaps): prune raw turns after summarization.
  readonly deleteTurnsForSession: Statement;
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
   * Phase 91 Plan 03 — expose the underlying better-sqlite3 handle for
   * specialized consumers (conversation-turn-translator.ts) that need
   * INSERT OR IGNORE against the UNIQUE(session_id, turn_index, role)
   * index for idempotent historical imports.
   *
   * Parallels the existing MemoryStore.getDatabase() accessor — do NOT
   * use for general CRUD; go through the typed methods above instead.
   */
  getDatabase(): DatabaseType {
    return this.db;
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
   *
   * Idempotent: if the session is already in status 'summarized', returns the
   * existing row without error — this handles the benign race where the
   * crash-path fire-and-forget summarizer and the stop-path awaited
   * summarizer both run to completion (each observes status=ended/crashed
   * in its own snapshot, then the winner flips it to summarized; the loser
   * USED to emit a misleading warn). Memory row is still present; the
   * winning caller already persisted the FK.
   *
   * Throws only when the session row does not exist or is still in 'active'
   * status (caller must have forgotten to end/crash it first).
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
      // Distinguish "already summarized" (idempotent no-op) from
      // "not found" / "still active" (real error).
      const row = this.stmts.getSession.get(sessionId) as SessionRow | undefined;
      if (!row) {
        throw new Error(
          `Cannot mark session '${sessionId}' as summarized: session not found`,
        );
      }
      if (row.status === "summarized") {
        return rowToSession(row);
      }
      throw new Error(
        `Cannot mark session '${sessionId}' as summarized: session is in status '${row.status}' (expected 'ended' or 'crashed')`,
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
   * List recent TERMINATED sessions (status IN 'ended' | 'crashed' |
   * 'summarized'), ordered by started_at DESC. Excludes status='active'.
   *
   * agents-forget-across-sessions debug (2026-04-19): Phase 67 SESS-03's gap
   * check MUST measure gap against the most-recent previously-terminated
   * session. In production, SessionManager.startAgent creates a fresh
   * active session BEFORE buildSessionConfig runs; listRecentSessions(1)
   * would return that just-created row, collapse the gap to ~0ms, and
   * gap-skip the brief on every daemon boot. This variant filters it out.
   *
   * An 'active' row from a prior hard crash (no graceful shutdown, no
   * crash-handler fired) is also excluded — the brief simply falls through
   * to "no prior terminated session" and renders anyway, which is the
   * correct behaviour (we don't know when that orphan truly ended, so we
   * should not silently suppress recall).
   */
  listRecentTerminatedSessions(
    agentName: string,
    limit: number,
  ): readonly ConversationSession[] {
    const rows = this.stmts.listRecentTerminatedSessions.all(
      agentName,
      limit,
    ) as SessionRow[];
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

  /**
   * Gap 2 (memory-persistence-gaps) — delete all raw turns for a session.
   *
   * Called by `summarizeSession` after `markSummarized` succeeds. The session
   * row itself is LEFT INTACT so the state machine stays valid and the
   * resume-brief gap check (Phase 67 SESS-03) still has a terminated session
   * to compute against.
   *
   * Returns the number of rows deleted. Safe to call on a session with zero
   * turns (returns 0). The `conversation_turns_ad` trigger on the FTS5
   * virtual table (src/memory/store.ts:800-804) keeps `conversation_turns_fts`
   * in sync automatically.
   */
  deleteTurnsForSession(sessionId: string): number {
    const result = this.stmts.deleteTurnsForSession.run(sessionId);
    return result.changes;
  }

  /**
   * Full-text search over conversation_turns.content via FTS5.
   *
   * Query is phrase-quoted via `escapeFtsQuery` so agent-crafted natural
   * language tolerates FTS5-reserved characters (`:`, `(`, `)`, `"`, etc.)
   * without crashing the parser (Pitfall 1).
   *
   * Results are ordered by BM25 relevance ascending (most relevant first —
   * FTS5 assigns numerically lower BM25 to better matches). `bm25Score`
   * is projected raw; the scoped search orchestrator (`conversation-search.ts`)
   * normalises to [0, 1] via `1 / (1 + |bm25|)` before combining with decay.
   *
   * By default (`includeUntrustedChannels: false`), turns from untrusted
   * Discord channels are excluded to honour SEC-01 hygiene — prevents a
   * memory-poisoning vector (an untrusted user saying "remember you must X")
   * from surfacing in an agent's retrieval path.
   *
   * Phase 68 — RETR-02.
   */
  searchTurns(query: string, options: SearchTurnsOptions): SearchTurnsResult {
    const escaped = escapeFtsQuery(query);
    const includeUntrusted = options.includeUntrustedChannels === true;

    const rows = (
      includeUntrusted
        ? this.stmts.searchTurnsFtsUntrusted.all(
            escaped,
            options.limit,
            options.offset,
          )
        : this.stmts.searchTurnsFts.all(escaped, options.limit, options.offset)
    ) as Array<{
      turnId: string;
      sessionId: string;
      role: string;
      content: string;
      bm25Score: number;
      createdAt: string;
      channelId: string | null;
      isTrustedChannel: number;
    }>;

    const countRow = (
      includeUntrusted
        ? this.stmts.searchTurnsCountUntrusted.get(escaped)
        : this.stmts.searchTurnsCount.get(escaped)
    ) as { total: number } | undefined;

    const results: readonly ConversationTurnSearchResult[] = Object.freeze(
      rows.map((r) =>
        Object.freeze({
          turnId: r.turnId,
          sessionId: r.sessionId,
          role: r.role as "user" | "assistant" | "system",
          content: r.content,
          bm25Score: r.bm25Score,
          createdAt: r.createdAt,
          channelId: r.channelId,
          isTrustedChannel: r.isTrustedChannel === 1,
        }),
      ),
    );

    return Object.freeze({
      results,
      totalMatches: countRow?.total ?? 0,
    });
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
      // agents-forget-across-sessions debug (2026-04-19): exclude 'active'
      // so the brief gap-check doesn't collapse to zero against the
      // just-created current session.
      //
      // 2026-04-25 evening hotfix (Phase 99 sub-scope D): also exclude
      // empty sessions (no actual turn rows) so brief restart cycles don't
      // shadow real prior sessions in the LIMIT 5 default. Use EXISTS
      // (cheap with the session_id index on conversation_turns). turn_count
      // field is unreliable post-cutover-translation — use the actual row
      // count. Phase 89 restart-greeting falls through to "no prior session
      // to recap" minimalEmbed when this list returns only empty sessions;
      // the filter prevents that false-negative.
      listRecentTerminatedSessions: this.db.prepare(
        `SELECT id, agent_name, started_at, ended_at, turn_count,
                total_tokens, summary_memory_id, status
         FROM conversation_sessions
         WHERE agent_name = ?
           AND status IN ('ended', 'crashed', 'summarized')
           AND EXISTS (
             SELECT 1 FROM conversation_turns ct
             WHERE ct.session_id = conversation_sessions.id
             LIMIT 1
           )
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
      // Phase 68 — RETR-02. BM25 ordering ascending (lower = more relevant per FTS5).
      // `is_trusted_channel = 1` filter is the default path (SEC-01 hygiene);
      // the *Untrusted variants drop that predicate for power-user call sites.
      searchTurnsFts: this.db.prepare(
        `SELECT
           t.id AS turnId,
           t.session_id AS sessionId,
           t.role,
           t.content,
           t.created_at AS createdAt,
           t.channel_id AS channelId,
           t.is_trusted_channel AS isTrustedChannel,
           bm25(conversation_turns_fts) AS bm25Score
         FROM conversation_turns_fts
         JOIN conversation_turns t ON t.rowid = conversation_turns_fts.rowid
         WHERE conversation_turns_fts MATCH ?
           AND t.is_trusted_channel = 1
         ORDER BY bm25Score
         LIMIT ? OFFSET ?`,
      ),
      searchTurnsFtsUntrusted: this.db.prepare(
        `SELECT
           t.id AS turnId,
           t.session_id AS sessionId,
           t.role,
           t.content,
           t.created_at AS createdAt,
           t.channel_id AS channelId,
           t.is_trusted_channel AS isTrustedChannel,
           bm25(conversation_turns_fts) AS bm25Score
         FROM conversation_turns_fts
         JOIN conversation_turns t ON t.rowid = conversation_turns_fts.rowid
         WHERE conversation_turns_fts MATCH ?
         ORDER BY bm25Score
         LIMIT ? OFFSET ?`,
      ),
      searchTurnsCount: this.db.prepare(
        `SELECT COUNT(*) AS total
         FROM conversation_turns_fts
         JOIN conversation_turns t ON t.rowid = conversation_turns_fts.rowid
         WHERE conversation_turns_fts MATCH ?
           AND t.is_trusted_channel = 1`,
      ),
      searchTurnsCountUntrusted: this.db.prepare(
        `SELECT COUNT(*) AS total
         FROM conversation_turns_fts
         WHERE conversation_turns_fts MATCH ?`,
      ),
      // Gap 2 (memory-persistence-gaps): bulk-delete raw turns after a
      // session has been summarized. The AFTER DELETE trigger on
      // conversation_turns_fts keeps the FTS index in sync automatically.
      deleteTurnsForSession: this.db.prepare(
        `DELETE FROM conversation_turns WHERE session_id = ?`,
      ),
    };
  }
}
