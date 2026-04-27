import Database from "better-sqlite3";
import type { Database as DatabaseType, Statement } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { nanoid } from "nanoid";
import { MemoryError } from "./errors.js";
import { checkForDuplicate, mergeMemory } from "./dedup.js";
import { extractWikilinks } from "./graph.js";
import { calculateImportance } from "./importance.js";
import { autoLinkMemory } from "./similarity.js";
import type {
  MemoryEntry,
  MemoryTier,
  CreateMemoryInput,
  SessionLogEntry,
} from "./types.js";

/** Prepared statements for all store operations. */
type PreparedStatements = {
  readonly insertMemory: Statement;
  readonly insertVec: Statement;
  readonly getById: Statement;
  readonly getByOriginId: Statement;
  readonly updateAccess: Statement;
  readonly deleteMemory: Statement;
  readonly deleteVec: Statement;
  readonly listRecent: Statement;
  readonly insertSessionLog: Statement;
  readonly insertLink: Statement;
  readonly deleteLinksFrom: Statement;
  readonly getBacklinks: Statement;
  readonly getForwardLinks: Statement;
  readonly checkMemoryExists: Statement;
  /**
   * Phase 84 SKILL-04 — tag+content exact-match lookup for
   * self-improving-agent `.learnings/*.md` dedup during migration.
   * Uses LIKE '%tag%' to match a JSON-encoded tags column containing
   * the tag as a substring; content is compared literally.
   */
  readonly findByTagAndContent: Statement;
  /**
   * Phase 100-fu — single-row access bump for non-search callers
   * (GraphSearch graph-walked neighbors). Mirrors `updateAccess`
   * verbatim — kept as a separate prepared statement so usage sites
   * are easy to grep and so the SemanticSearch path is unaffected.
   */
  readonly bumpAccess: Statement;
  /**
   * Phase 100-fu — count inbound wikilink edges for a memory id. Used
   * by TierManager.refreshHotTier() to surface graph-centrality as a
   * hot-tier promotion signal independent of direct access count.
   */
  readonly getBacklinkCount: Statement;
};

/**
 * MemoryStore — SQLite-backed memory storage with sqlite-vec for vector search.
 *
 * Opens a better-sqlite3 database, enables WAL mode, loads the sqlite-vec
 * extension, and creates all required tables. Provides CRUD operations
 * for memories and session log entries.
 */
/** Configuration for deduplication on insert. */
type DedupStoreConfig = {
  readonly enabled: boolean;
  readonly similarityThreshold: number;
};

/** Default deduplication configuration. */
const DEFAULT_DEDUP_CONFIG: DedupStoreConfig = {
  enabled: true,
  similarityThreshold: 0.85,
};

export class MemoryStore {
  private readonly db: DatabaseType;
  private readonly stmts: PreparedStatements;
  private readonly dbPath: string;
  private readonly dedupConfig: DedupStoreConfig;

  constructor(dbPath: string, dedupConfig?: DedupStoreConfig) {
    this.dbPath = dbPath;
    this.dedupConfig = dedupConfig ?? DEFAULT_DEDUP_CONFIG;

    try {
      this.db = new Database(dbPath);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("busy_timeout = 5000");
      this.db.pragma("synchronous = NORMAL");
      this.db.pragma("foreign_keys = ON");

      sqliteVec.load(this.db);

      this.initSchema();
      this.migrateSchema();
      this.migrateTierColumn();
      this.migrateEpisodeSource();
      this.migrateGraphLinks();
      this.migrateConversationTables();
      this.migrateSourceTurnIds();
      this.migrateInstructionFlags();
      this.migrateConversationTurnsFts();
      this.migrateApiKeySessionsTable();
      this.migrateOriginIdColumn();
      this.migrateMemoryChunks();
      this.stmts = this.prepareStatements();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      throw new MemoryError(`Failed to initialize store: ${message}`, dbPath);
    }
  }

  /** Exposes the underlying database for advanced queries (e.g., SemanticSearch). */
  getDatabase(): DatabaseType {
    return this.db;
  }

  /**
   * Insert a new memory with its embedding.
   * Both the memories table and vec_memories table are updated atomically.
   */
  insert(input: CreateMemoryInput, embedding: Float32Array): MemoryEntry {
    try {
      // Phase 80 MEM-02 — origin_id path skips dedup entirely. Idempotency
      // by hash is the contract; content-similarity merging is a different
      // semantic that does not apply to migrated imports.
      const hasOriginId =
        typeof input.origin_id === "string" && input.origin_id.length > 0;

      // Existing dedup path (preserved verbatim) — only runs when origin_id
      // is absent AND dedupConfig.enabled AND !skipDedup.
      if (!hasOriginId && this.dedupConfig.enabled && !input.skipDedup) {
        const dedupResult = checkForDuplicate(embedding, this.db, {
          similarityThreshold: this.dedupConfig.similarityThreshold,
        });

        if (dedupResult.action === "merge") {
          mergeMemory(this.db, dedupResult.existingId, {
            content: input.content,
            importance: input.importance ?? 0.5,
            tags: input.tags ?? [],
            embedding,
          });

          // Re-extract links after merge
          this.db.transaction(() => {
            const mergedTargets = extractWikilinks(input.content);
            this.stmts.deleteLinksFrom.run(dedupResult.existingId);
            const mergeNow = new Date().toISOString();
            for (const targetId of mergedTargets) {
              const exists = this.stmts.checkMemoryExists.get(targetId);
              if (exists) {
                this.stmts.insertLink.run(dedupResult.existingId, targetId, targetId, mergeNow);
              }
            }
          })();

          // Eager auto-link after merge
          try {
            autoLinkMemory(this, dedupResult.existingId);
          } catch {
            // Non-fatal: heartbeat auto-linker will catch missed links
          }

          const merged = this.getById(dedupResult.existingId);
          if (!merged) {
            throw new MemoryError(
              `Merged memory ${dedupResult.existingId} not found after merge`,
              this.dbPath,
            );
          }
          return merged;
        }
      }

      // Normal insert path
      const now = new Date().toISOString();
      const id = nanoid();
      const importance = input.importance != null && input.importance !== 0.5
        ? input.importance
        : calculateImportance(input.content);
      const tags = input.tags ?? [];
      const sourceTurnIdsJson =
        input.sourceTurnIds && input.sourceTurnIds.length > 0
          ? JSON.stringify([...input.sourceTurnIds])
          : null;
      const originIdOrNull = hasOriginId ? (input.origin_id as string) : null;

      let inserted = true;
      this.db.transaction(() => {
        const result = this.stmts.insertMemory.run(
          id,
          input.content,
          input.source,
          importance,
          JSON.stringify(tags),
          now,
          now,
          now,
          sourceTurnIdsJson,
          originIdOrNull,
        );
        if (result.changes === 0) {
          if (!hasOriginId) {
            // INSERT OR IGNORE suppresses CHECK-constraint failures too
            // (e.g., invalid `source` value). Without an origin_id this is
            // NEVER a legitimate idempotent skip — re-raise to preserve the
            // pre-existing validation contract (461 tests depend on invalid
            // source throwing).
            throw new MemoryError(
              `INSERT suppressed with no origin_id — likely constraint violation (source="${input.source}")`,
              this.dbPath,
            );
          }
          // origin_id collision — INSERT OR IGNORE fired. Do NOT write
          // vec_memories and do NOT extract wikilinks for this run (they
          // were already extracted on the original insert).
          inserted = false;
          return;
        }
        this.stmts.insertVec.run(id, embedding);

        // Extract wikilinks and create edges to existing targets
        const targets = extractWikilinks(input.content);
        for (const targetId of targets) {
          const exists = this.stmts.checkMemoryExists.get(targetId);
          if (exists) {
            this.stmts.insertLink.run(id, targetId, targetId, now);
          }
        }
      })();

      if (!inserted && hasOriginId) {
        // Idempotent skip — return the existing row. Callers (Plan 02
        // translator) compare returned entry.createdAt against a
        // "this run" marker to classify upserted vs skipped for the CLI.
        const existing = this.stmts.getByOriginId.get(input.origin_id) as
          | MemoryRow
          | undefined;
        if (!existing) {
          throw new MemoryError(
            `origin_id ${input.origin_id} collision but SELECT returned no row`,
            this.dbPath,
          );
        }
        return rowToEntry(existing);
      }

      // Eager auto-link: discover similar memories and create edges
      try {
        autoLinkMemory(this, id);
      } catch {
        // Non-fatal: heartbeat auto-linker will catch missed links
      }

      return Object.freeze({
        id,
        content: input.content,
        source: input.source,
        importance,
        accessCount: 0,
        tags: Object.freeze([...tags]),
        embedding,
        createdAt: now,
        updatedAt: now,
        accessedAt: now,
        tier: "warm" as const,
        sourceTurnIds:
          input.sourceTurnIds && input.sourceTurnIds.length > 0
            ? Object.freeze([...input.sourceTurnIds])
            : null,
      });
    } catch (error) {
      if (error instanceof MemoryError) throw error;
      const message =
        error instanceof Error ? error.message : "Unknown error";
      throw new MemoryError(`Failed to insert memory: ${message}`, this.dbPath);
    }
  }

  /**
   * Retrieve a memory by ID. Increments access_count and updates accessed_at.
   * Returns null if not found.
   */
  getById(id: string): MemoryEntry | null {
    try {
      const row = this.stmts.getById.get(id) as MemoryRow | undefined;
      if (!row) return null;

      const now = new Date().toISOString();
      this.stmts.updateAccess.run(now, id);

      return rowToEntry({
        ...row,
        access_count: row.access_count + 1,
        accessed_at: now,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      throw new MemoryError(
        `Failed to get memory ${id}: ${message}`,
        this.dbPath,
      );
    }
  }

  /**
   * Delete a memory from both memories and vec_memories tables.
   * Returns true if the memory existed and was deleted.
   */
  delete(id: string): boolean {
    try {
      let deleted = false;
      this.db.transaction(() => {
        const result = this.stmts.deleteMemory.run(id);
        deleted = result.changes > 0;
        if (deleted) {
          this.stmts.deleteVec.run(id);
        }
      })();
      return deleted;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      throw new MemoryError(
        `Failed to delete memory ${id}: ${message}`,
        this.dbPath,
      );
    }
  }

  /**
   * List recent memories ordered by created_at descending.
   */
  listRecent(limit: number): readonly MemoryEntry[] {
    try {
      const rows = this.stmts.listRecent.all(limit) as MemoryRow[];
      return Object.freeze(rows.map(rowToEntry));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      throw new MemoryError(
        `Failed to list recent memories: ${message}`,
        this.dbPath,
      );
    }
  }

  /**
   * Record a session log entry in the session_logs table.
   */
  recordSessionLog(
    entry: Omit<SessionLogEntry, "id" | "createdAt">,
  ): SessionLogEntry {
    const now = new Date().toISOString();
    const id = nanoid();

    try {
      this.stmts.insertSessionLog.run(
        id,
        entry.date,
        entry.filePath,
        entry.entryCount,
        now,
      );

      return Object.freeze({
        id,
        date: entry.date,
        filePath: entry.filePath,
        entryCount: entry.entryCount,
        createdAt: now,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      throw new MemoryError(
        `Failed to record session log: ${message}`,
        this.dbPath,
      );
    }
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  /**
   * Delete a session log entry by date (for archiving after consolidation).
   * Returns true if the entry existed and was deleted.
   */
  deleteSessionLog(date: string): boolean {
    try {
      const stmt = this.db.prepare(
        "DELETE FROM session_logs WHERE date = ?",
      );
      const result = stmt.run(date);
      return result.changes > 0;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      throw new MemoryError(
        `Failed to delete session log for ${date}: ${message}`,
        this.dbPath,
      );
    }
  }

  /**
   * Get all tracked session log dates in ascending order.
   * Used by the consolidation pipeline to discover available logs.
   */
  getSessionLogDates(): readonly string[] {
    try {
      const stmt = this.db.prepare(
        "SELECT DISTINCT date FROM session_logs ORDER BY date ASC",
      );
      const rows = stmt.all() as ReadonlyArray<{ date: string }>;
      return Object.freeze(rows.map((r) => r.date));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      throw new MemoryError(
        `Failed to get session log dates: ${message}`,
        this.dbPath,
      );
    }
  }

  /**
   * Retrieve the embedding vector for a memory by ID.
   * Returns null if the memory has no embedding stored.
   */
  getEmbedding(id: string): Float32Array | null {
    try {
      const row = this.db
        .prepare("SELECT embedding FROM vec_memories WHERE memory_id = ?")
        .get(id) as { embedding: Buffer | Float32Array } | undefined;
      if (!row?.embedding) return null;
      // SQLite returns Buffer; convert to Float32Array
      const buf = row.embedding;
      if (buf instanceof Float32Array) return buf;
      return new Float32Array(
        (buf as Buffer).buffer,
        (buf as Buffer).byteOffset,
        (buf as Buffer).byteLength / 4,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      throw new MemoryError(
        `Failed to get embedding for ${id}: ${message}`,
        this.dbPath,
      );
    }
  }

  /**
   * Phase 100-fu — bump access_count + accessed_at for a single memory id.
   *
   * Surfaced because GraphSearch's graph-walked neighbors were returned to
   * callers but never bumped — leaving heavily-linked nodes stuck at
   * access_count=0 forever and unable to qualify for hot-tier promotion
   * (production evidence: fin-acquisition agent had 1,161 of 1,182
   * memories at access_count=0 despite 7,338 wikilink edges).
   *
   * Mirrors the UPDATE shape that SemanticSearch.search() uses on its KNN
   * top-K. Non-existent ids are a silent no-op (UPDATE-WHERE-id=missing
   * affects 0 rows). When `accessedAt` is omitted, defaults to `new Date()`.
   *
   * Callers MUST NOT use this to double-bump a row already bumped by
   * SemanticSearch.search() in the same logical lookup — keep the bump
   * exactly one-per-search-call per memory id.
   */
  bumpAccess(memoryId: string, accessedAt?: string): void {
    this.stmts.bumpAccess.run(
      accessedAt ?? new Date().toISOString(),
      memoryId,
    );
  }

  /**
   * Phase 100-fu — return the number of inbound wikilink edges that
   * point at `memoryId`. Used by the tier manager to detect hub nodes
   * (memories with many backlinks) for graph-centrality promotion.
   *
   * Returns 0 for memories with no backlinks AND for memory IDs that
   * do not exist — both cases produce a single COUNT(*) row of `0`
   * because the WHERE clause matches no rows.
   */
  getBacklinkCount(memoryId: string): number {
    const row = this.stmts.getBacklinkCount.get(memoryId) as
      | { n: number }
      | undefined;
    return row?.n ?? 0;
  }

  /**
   * List memories filtered by tier, ordered by accessed_at descending.
   * Returns a frozen array of MemoryEntry objects.
   */
  listByTier(tier: MemoryTier, limit: number): readonly MemoryEntry[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT id, content, source, importance, access_count, tags,
                  created_at, updated_at, accessed_at, tier, source_turn_ids
           FROM memories WHERE tier = ? ORDER BY accessed_at DESC LIMIT ?`,
        )
        .all(tier, limit) as MemoryRow[];
      return Object.freeze(rows.map(rowToEntry));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      throw new MemoryError(
        `Failed to list memories by tier ${tier}: ${message}`,
        this.dbPath,
      );
    }
  }

  /**
   * Update the tier of a memory entry.
   * Returns true if the row was updated, false if not found.
   */
  updateTier(id: string, tier: MemoryTier): boolean {
    try {
      const now = new Date().toISOString();
      const result = this.db
        .prepare("UPDATE memories SET tier = ?, updated_at = ? WHERE id = ?")
        .run(tier, now, id);
      return result.changes > 0;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      throw new MemoryError(
        `Failed to update tier for ${id}: ${message}`,
        this.dbPath,
      );
    }
  }

  /**
   * Find memories that contain a specific tag in their tags JSON array.
   * Returns a frozen array of frozen MemoryEntry objects.
   */
  findByTag(tag: string): readonly MemoryEntry[] {
    try {
      const rows = this.db.prepare(`
        SELECT m.id, m.content, m.source, m.importance, m.access_count,
               m.tags, m.created_at, m.updated_at, m.accessed_at, m.tier,
               m.source_turn_ids
        FROM memories m, json_each(m.tags) AS t
        WHERE t.value = ?
      `).all(tag) as MemoryRow[];

      return Object.freeze(rows.map(rowToEntry));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      throw new MemoryError(
        `Failed to find memories by tag ${tag}: ${message}`,
        this.dbPath,
      );
    }
  }

  /** Get prepared statements for graph queries (used by graph module). */
  getGraphStatements(): Pick<PreparedStatements, 'getBacklinks' | 'getForwardLinks' | 'insertLink' | 'deleteLinksFrom' | 'checkMemoryExists'> {
    return this.stmts;
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('conversation', 'manual', 'system', 'consolidation', 'episode')),
        importance REAL NOT NULL DEFAULT 0.5 CHECK(importance >= 0.0 AND importance <= 1.0),
        access_count INTEGER NOT NULL DEFAULT 0,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        accessed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_logs (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        file_path TEXT NOT NULL,
        entry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
        memory_id TEXT PRIMARY KEY,
        embedding float[384] distance_metric=cosine
      );
    `);
  }

  /**
   * Migrate existing databases to support the 'consolidation' source value.
   * SQLite CHECK constraints cannot be altered in-place, so we use
   * the standard table recreation pattern inside a transaction.
   */
  private migrateSchema(): void {
    // Test if the current schema already accepts 'consolidation'
    try {
      this.db.exec("SAVEPOINT migration_test");
      try {
        this.db.exec(
          "INSERT INTO memories (id, content, source, importance, tags, created_at, updated_at, accessed_at) VALUES ('__migration_test__', 'test', 'consolidation', 0.5, '[]', '', '', '')",
        );
        // Constraint accepts 'consolidation' -- no migration needed
        this.db.exec("ROLLBACK TO migration_test");
        this.db.exec("RELEASE migration_test");
        return;
      } catch {
        // Constraint rejected 'consolidation' -- need migration
        this.db.exec("ROLLBACK TO migration_test");
        this.db.exec("RELEASE migration_test");
      }
    } catch {
      // Table doesn't exist yet (initSchema will create it)
      return;
    }

    // Recreate table with updated CHECK constraint
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE memories_new (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          source TEXT NOT NULL CHECK(source IN ('conversation', 'manual', 'system', 'consolidation', 'episode')),
          importance REAL NOT NULL DEFAULT 0.5 CHECK(importance >= 0.0 AND importance <= 1.0),
          access_count INTEGER NOT NULL DEFAULT 0,
          tags TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          accessed_at TEXT NOT NULL
        );
        INSERT INTO memories_new SELECT * FROM memories;
        DROP TABLE memories;
        ALTER TABLE memories_new RENAME TO memories;
      `);
    })();
  }

  /**
   * Migrate existing databases to add the tier column.
   * Uses PRAGMA table_info to detect if column already exists.
   */
  private migrateTierColumn(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(memories)")
      .all() as ReadonlyArray<{ name: string }>;
    const hasTier = columns.some((c) => c.name === "tier");

    if (!hasTier) {
      this.db.exec(
        "ALTER TABLE memories ADD COLUMN tier TEXT NOT NULL DEFAULT 'warm' CHECK(tier IN ('hot', 'warm', 'cold'))",
      );
    }
  }

  /**
   * Migrate existing databases to accept the 'episode' source value.
   * Uses the same savepoint-test pattern as migrateSchema().
   */
  private migrateEpisodeSource(): void {
    try {
      this.db.exec("SAVEPOINT episode_migration_test");
      try {
        this.db.exec(
          "INSERT INTO memories (id, content, source, importance, tags, created_at, updated_at, accessed_at, tier) VALUES ('__episode_migration_test__', 'test', 'episode', 0.5, '[]', '', '', '', 'warm')",
        );
        // Constraint accepts 'episode' -- no migration needed
        this.db.exec("ROLLBACK TO episode_migration_test");
        this.db.exec("RELEASE episode_migration_test");
        return;
      } catch {
        // Constraint rejected 'episode' -- need migration
        this.db.exec("ROLLBACK TO episode_migration_test");
        this.db.exec("RELEASE episode_migration_test");
      }
    } catch {
      return;
    }

    // Recreate table with updated CHECK constraint including 'episode'
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE memories_new (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          source TEXT NOT NULL CHECK(source IN ('conversation', 'manual', 'system', 'consolidation', 'episode')),
          importance REAL NOT NULL DEFAULT 0.5 CHECK(importance >= 0.0 AND importance <= 1.0),
          access_count INTEGER NOT NULL DEFAULT 0,
          tags TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          accessed_at TEXT NOT NULL,
          tier TEXT NOT NULL DEFAULT 'warm' CHECK(tier IN ('hot', 'warm', 'cold'))
        );
        INSERT INTO memories_new SELECT * FROM memories;
        DROP TABLE memories;
        ALTER TABLE memories_new RENAME TO memories;
      `);
    })();
  }

  /**
   * Migrate existing databases to add the memory_links graph table.
   * Creates an adjacency list with CASCADE foreign keys for edge cleanup.
   */
  private migrateGraphLinks(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_links (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        link_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (source_id, target_id),
        FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_links_target
        ON memory_links(target_id);
    `);
  }

  /**
   * Migrate existing databases to add conversation_sessions and conversation_turns tables.
   * Uses idempotent CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
   *
   * conversation_sessions tracks agent interaction lifecycles with status CHECK constraint.
   * conversation_turns stores individual turns with provenance fields (SEC-01).
   */
  private migrateConversationTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_sessions (
        id TEXT PRIMARY KEY,
        agent_name TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        turn_count INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        summary_memory_id TEXT,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK(status IN ('active', 'ended', 'crashed', 'summarized')),
        FOREIGN KEY (summary_memory_id) REFERENCES memories(id)
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_agent
        ON conversation_sessions(agent_name);
      CREATE INDEX IF NOT EXISTS idx_sessions_status
        ON conversation_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_started
        ON conversation_sessions(started_at);

      CREATE TABLE IF NOT EXISTS conversation_turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        token_count INTEGER,
        channel_id TEXT,
        discord_user_id TEXT,
        discord_message_id TEXT,
        is_trusted_channel INTEGER NOT NULL DEFAULT 0,
        origin TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES conversation_sessions(id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_session_order
        ON conversation_turns(session_id, turn_index, role);
      CREATE INDEX IF NOT EXISTS idx_turns_session
        ON conversation_turns(session_id, turn_index);
      CREATE INDEX IF NOT EXISTS idx_turns_created
        ON conversation_turns(created_at);
      CREATE INDEX IF NOT EXISTS idx_turns_channel
        ON conversation_turns(channel_id);
      CREATE INDEX IF NOT EXISTS idx_turns_user
        ON conversation_turns(discord_user_id);
    `);
  }

  /**
   * Migrate existing databases to add source_turn_ids column to memories table.
   * Uses PRAGMA table_info check pattern (same as migrateTierColumn).
   * Column is nullable TEXT (JSON array of turn IDs) for CONV-03 lineage tracking.
   */
  private migrateSourceTurnIds(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(memories)")
      .all() as ReadonlyArray<{ name: string }>;
    const hasColumn = columns.some((c) => c.name === "source_turn_ids");
    if (!hasColumn) {
      this.db.exec(
        "ALTER TABLE memories ADD COLUMN source_turn_ids TEXT DEFAULT NULL"
      );
    }
  }

  /**
   * Migrate existing databases to add instruction_flags column to conversation_turns.
   * Uses PRAGMA table_info check pattern (same as migrateSourceTurnIds).
   * Column is nullable TEXT (JSON string of InstructionDetectionResult) for SEC-02 flagging.
   */
  private migrateInstructionFlags(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(conversation_turns)")
      .all() as ReadonlyArray<{ name: string }>;
    const hasColumn = columns.some((c) => c.name === "instruction_flags");
    if (!hasColumn) {
      this.db.exec(
        "ALTER TABLE conversation_turns ADD COLUMN instruction_flags TEXT DEFAULT NULL"
      );
    }
  }

  /**
   * Phase 68 — RETR-02. Create FTS5 full-text index over conversation_turns.content
   * in external-content mode, plus AI/AD/AU triggers for automatic synchronization,
   * plus a one-shot backfill gated on sqlite_master lookup for idempotency across
   * daemon restarts (Pitfall 2: unconditional backfill would double-index on every
   * startup). Tokenizer: `unicode61 remove_diacritics 2` (SQLite default — handles
   * English safely without stemming; if agents report recall gaps during dogfooding,
   * swap to `porter unicode61` via a follow-up migration).
   *
   * External-content mode (`content='conversation_turns'`) avoids duplicating the
   * `content` text — FTS5 stores only tokens and looks up the original row by
   * rowid. Triggers run inside SQLite's transaction boundary so zero code changes
   * are required in `ConversationStore.recordTurn` / `DELETE` / `UPDATE` paths.
   */
  private migrateConversationTurnsFts(): void {
    const existing = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_turns_fts'",
      )
      .get();
    const needsBackfill = !existing;

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS conversation_turns_fts USING fts5(
        content,
        content='conversation_turns',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER IF NOT EXISTS conversation_turns_ai
      AFTER INSERT ON conversation_turns BEGIN
        INSERT INTO conversation_turns_fts(rowid, content)
          VALUES (new.rowid, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS conversation_turns_ad
      AFTER DELETE ON conversation_turns BEGIN
        INSERT INTO conversation_turns_fts(conversation_turns_fts, rowid, content)
          VALUES ('delete', old.rowid, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS conversation_turns_au
      AFTER UPDATE ON conversation_turns BEGIN
        INSERT INTO conversation_turns_fts(conversation_turns_fts, rowid, content)
          VALUES ('delete', old.rowid, old.content);
        INSERT INTO conversation_turns_fts(rowid, content)
          VALUES (new.rowid, new.content);
      END;
    `);

    if (needsBackfill) {
      // One-shot backfill so turns recorded BEFORE this migration ran (Phase 64/65
      // era rows under an older schema) become searchable on the first post-upgrade
      // daemon boot. Guarded by the sqlite_master existence check above — running
      // this on every construction would produce O(n²) duplicates.
      this.db.exec(`
        INSERT INTO conversation_turns_fts(rowid, content)
          SELECT rowid, content FROM conversation_turns;
      `);
    }
  }

  /**
   * Phase 69 — OPENAI-05. Per-bearer-key → Claude-session mapping lives in
   * each agent's memories.db so it survives daemon restarts alongside the
   * conversation sessions themselves.
   *
   * Quick task 260419-p51 (P51-SESSION-ISOLATION) — bumps the schema to v2
   * with composite PK `(key_hash, agent_name)`. Multi-agent bearer keys
   * carry independent session rows per agent; legacy pinned keys preserve
   * their single-agent mapping.
   *
   * Migration flow (wrapped in a transaction for atomicity):
   *   1. Create v1 table (idempotent) — kept as a tombstone for one release
   *      cycle so a downgrade doesn't lose data.
   *   2. Create v2 table (idempotent).
   *   3. If v2 is empty AND v1 has rows, copy v1 → v2 exactly once (the
   *      "v2 empty?" check is the idempotency guard — on the second boot
   *      v2 already has rows and the copy is skipped).
   */
  private migrateApiKeySessionsTable(): void {
    this.db.transaction(() => {
      // v1 — legacy tombstone (still created so the `INSERT...SELECT` below
      // always has a source table even on greenfield DBs).
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS api_key_sessions (
          key_hash      TEXT PRIMARY KEY,
          agent_name    TEXT NOT NULL,
          session_id    TEXT NOT NULL,
          created_at    INTEGER NOT NULL,
          last_used_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_api_key_sessions_agent ON api_key_sessions(agent_name);
      `);
      // v2 — composite PK (key_hash, agent_name).
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS api_key_sessions_v2 (
          key_hash      TEXT NOT NULL,
          agent_name    TEXT NOT NULL,
          session_id    TEXT NOT NULL,
          created_at    INTEGER NOT NULL,
          last_used_at  INTEGER NOT NULL,
          PRIMARY KEY(key_hash, agent_name)
        );
        CREATE INDEX IF NOT EXISTS idx_api_key_sessions_v2_agent ON api_key_sessions_v2(agent_name);
      `);
      // One-shot copy from v1 → v2, guarded by "v2 empty?". Once a v2 row
      // lands (either from this copy or from a fresh driver write), this
      // branch never re-runs on subsequent boots.
      const alreadyMigrated = this.db
        .prepare("SELECT 1 FROM api_key_sessions_v2 LIMIT 1")
        .get();
      if (!alreadyMigrated) {
        this.db.exec(`
          INSERT OR IGNORE INTO api_key_sessions_v2
            (key_hash, agent_name, session_id, created_at, last_used_at)
          SELECT key_hash, agent_name, session_id, created_at, last_used_at
          FROM api_key_sessions
        `);
      }
    })();
  }

  /**
   * Phase 80 MEM-02 — add `origin_id TEXT` column + UNIQUE partial index to
   * memories. Idempotent: PRAGMA-check pattern identical to
   * migrateSourceTurnIds. UNIQUE index uses WHERE origin_id IS NOT NULL so
   * pre-existing rows (NULL) coexist — SQLite already treats NULLs as
   * non-equal for plain UNIQUE, but the partial index makes the intent
   * explicit and slightly reduces index size. CREATE UNIQUE INDEX IF NOT
   * EXISTS guards re-opens.
   */
  private migrateOriginIdColumn(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(memories)")
      .all() as ReadonlyArray<{ name: string }>;
    const hasColumn = columns.some((c) => c.name === "origin_id");
    if (!hasColumn) {
      this.db.exec(
        "ALTER TABLE memories ADD COLUMN origin_id TEXT DEFAULT NULL",
      );
    }
    this.db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_origin_id ON memories(origin_id) WHERE origin_id IS NOT NULL",
    );
  }

  /**
   * Phase 90 MEM-02 — workspace memory file chunks + embeddings + FTS index.
   *
   * Four new tables, all idempotent via CREATE {TABLE,VIRTUAL TABLE,INDEX}
   * IF NOT EXISTS (matches migrateConversationTables discipline). Owned by
   * Plan 90-02 and consumed by memory-scanner.ts (upserts) +
   * memory-retrieval.ts (hybrid RRF lookup).
   *
   *   memory_files       — idempotency ledger keyed by absolute path.
   *                        Tracks mtime + sha256 so the scanner can skip
   *                        re-embedding files whose content hasn't changed.
   *   memory_chunks      — one row per H2 chunk (per chunkMarkdownByH2).
   *                        Stores heading + body + file_mtime_ms for the
   *                        D-24 time-window filter.
   *   vec_memory_chunks  — sqlite-vec virtual table (384-dim float32 cosine)
   *                        mirroring vec_memories' shape. One row per chunk.
   *   memory_chunks_fts  — FTS5 virtual table over heading + body. Keyed by
   *                        chunk_id (UNINDEXED) so the hybrid retrieval path
   *                        can join vec results → FTS results by chunk_id.
   *                        content='' (contentless mode) — we write the
   *                        body text directly, no trigger sync needed.
   */
  private migrateMemoryChunks(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_files (
        path          TEXT PRIMARY KEY,
        mtime_ms      INTEGER NOT NULL,
        sha256        TEXT NOT NULL,
        chunk_count   INTEGER NOT NULL,
        indexed_at    TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_chunks (
        id             TEXT PRIMARY KEY,
        path           TEXT NOT NULL,
        chunk_index    INTEGER NOT NULL,
        heading        TEXT,
        body           TEXT NOT NULL,
        token_count    INTEGER NOT NULL,
        score_weight   REAL NOT NULL DEFAULT 0.0,
        file_mtime_ms  INTEGER NOT NULL,
        created_at     TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_path ON memory_chunks(path);
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_memory_chunks USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding float[384] distance_metric=cosine
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        heading,
        body,
        tokenize='unicode61 remove_diacritics 2'
      );
    `);
  }

  /**
   * Phase 90 MEM-02 — insert one chunk row across all four memory-chunk
   * tables atomically (wrapped in a transaction). Returns the generated
   * chunk id so callers (memory-scanner) can log / cross-reference.
   *
   * memory_files is upserted: the first chunk for a given path initializes
   * chunk_count=1 + sha/mtime; subsequent chunks for the same path bump
   * chunk_count. Callers that are re-indexing MUST call
   * deleteMemoryChunksByPath(path) first to avoid double-counting.
   */
  insertMemoryChunk(input: Readonly<{
    path: string;
    chunkIndex: number;
    heading: string | null;
    body: string;
    tokenCount: number;
    scoreWeight: number;
    fileMtimeMs: number;
    fileSha256: string;
    embedding: Float32Array;
  }>): string {
    const chunkId = nanoid();
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO memory_files (path, mtime_ms, sha256, chunk_count, indexed_at)
           VALUES (?, ?, ?, 1, ?)
           ON CONFLICT(path) DO UPDATE SET
             mtime_ms   = excluded.mtime_ms,
             sha256     = excluded.sha256,
             chunk_count = memory_files.chunk_count + 1,
             indexed_at = excluded.indexed_at`,
        )
        .run(input.path, input.fileMtimeMs, input.fileSha256, now);

      this.db
        .prepare(
          `INSERT INTO memory_chunks
             (id, path, chunk_index, heading, body, token_count, score_weight, file_mtime_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          chunkId,
          input.path,
          input.chunkIndex,
          input.heading,
          input.body,
          input.tokenCount,
          input.scoreWeight,
          input.fileMtimeMs,
          now,
        );

      this.db
        .prepare(
          `INSERT INTO vec_memory_chunks (chunk_id, embedding) VALUES (?, ?)`,
        )
        .run(chunkId, input.embedding);

      this.db
        .prepare(
          `INSERT INTO memory_chunks_fts (chunk_id, heading, body) VALUES (?, ?, ?)`,
        )
        .run(chunkId, input.heading ?? "", input.body);
    })();
    return chunkId;
  }

  /**
   * Phase 90 MEM-02 — remove every chunk row for `path` across the four
   * tables. Returns the number of rows deleted from memory_chunks
   * (source-of-truth count). vec_memory_chunks + memory_chunks_fts are
   * cleaned by joining on the set of chunk_ids found for the path.
   */
  deleteMemoryChunksByPath(path: string): number {
    return this.db.transaction(() => {
      const ids = this.db
        .prepare(`SELECT id FROM memory_chunks WHERE path = ?`)
        .all(path) as Array<{ id: string }>;
      for (const { id } of ids) {
        this.db
          .prepare(`DELETE FROM vec_memory_chunks WHERE chunk_id = ?`)
          .run(id);
        this.db
          .prepare(`DELETE FROM memory_chunks_fts WHERE chunk_id = ?`)
          .run(id);
      }
      const info = this.db
        .prepare(`DELETE FROM memory_chunks WHERE path = ?`)
        .run(path);
      this.db.prepare(`DELETE FROM memory_files WHERE path = ?`).run(path);
      return info.changes as number;
    })();
  }

  /**
   * Phase 90 MEM-02 — idempotency gate for the scanner. Returns the stored
   * sha256 for `path` so the scanner can skip re-embedding when the file
   * content hasn't changed (big win for backfill runs).
   */
  getMemoryFileSha256(path: string): string | null {
    const row = this.db
      .prepare(`SELECT sha256 FROM memory_files WHERE path = ?`)
      .get(path) as { sha256: string } | undefined;
    return row ? row.sha256 : null;
  }

  /**
   * Phase 90 MEM-03 — cosine-similarity top-K over vec_memory_chunks. Used
   * by memory-retrieval.ts as one of the two RRF ranker inputs. Returns
   * chunk_id + distance (smaller = more similar).
   */
  searchMemoryChunksVec(
    queryEmbedding: Float32Array,
    limit: number,
  ): ReadonlyArray<Readonly<{ chunk_id: string; distance: number }>> {
    return this.db
      .prepare(
        `SELECT chunk_id, distance FROM vec_memory_chunks
         WHERE embedding MATCH ? AND k = ? ORDER BY distance`,
      )
      .all(queryEmbedding, limit) as ReadonlyArray<{
      chunk_id: string;
      distance: number;
    }>;
  }

  /**
   * Phase 90 MEM-03 — FTS5 top-K over memory_chunks_fts. MATCH syntax is
   * a plain token search ("zaid investment" finds docs containing both
   * tokens by default with AND semantics). Returns chunk_id + rank (more
   * negative = better match per FTS5 convention).
   */
  searchMemoryChunksFts(
    query: string,
    limit: number,
  ): ReadonlyArray<Readonly<{ chunk_id: string; rank: number }>> {
    // FTS5 MATCH is strict — bare tokens with special chars can throw.
    // Sanitize to alphanumeric + spaces for query safety (retrieval-time
    // concern, not a schema invariant).
    const safe = query.replace(/[^a-zA-Z0-9_ ]+/g, " ").trim();
    if (safe.length === 0) return [];
    try {
      return this.db
        .prepare(
          `SELECT chunk_id, rank FROM memory_chunks_fts
           WHERE memory_chunks_fts MATCH ? ORDER BY rank LIMIT ?`,
        )
        .all(safe, limit) as ReadonlyArray<{ chunk_id: string; rank: number }>;
    } catch {
      return [];
    }
  }

  /**
   * Phase 90 MEM-03 — hydrate a chunk by id for the retrieval pipeline.
   * Returns null on miss so the fuser can silently skip stale ids.
   */
  getMemoryChunk(
    chunkId: string,
  ): Readonly<{
    chunk_id: string;
    path: string;
    heading: string | null;
    body: string;
    file_mtime_ms: number;
    score_weight: number;
  }> | null {
    const row = this.db
      .prepare(
        `SELECT id AS chunk_id, path, heading, body, file_mtime_ms, score_weight
         FROM memory_chunks WHERE id = ?`,
      )
      .get(chunkId) as
      | {
          chunk_id: string;
          path: string;
          heading: string | null;
          body: string;
          file_mtime_ms: number;
          score_weight: number;
        }
      | undefined;
    return row ?? null;
  }

  private prepareStatements(): PreparedStatements {
    return {
      // Phase 80 MEM-02 — INSERT OR IGNORE. Safe even when origin_id is NULL
      // because SQLite UNIQUE on a nullable column does not match NULL=NULL
      // (and the partial UNIQUE index excludes NULLs entirely). The IGNORE
      // clause is inert on the no-origin_id path, preserving backward-compat.
      insertMemory: this.db.prepare(`
        INSERT OR IGNORE INTO memories (id, content, source, importance, tags, created_at, updated_at, accessed_at, tier, source_turn_ids, origin_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'warm', ?, ?)
      `),
      insertVec: this.db.prepare(`
        INSERT INTO vec_memories (memory_id, embedding)
        VALUES (?, ?)
      `),
      getById: this.db.prepare(`
        SELECT id, content, source, importance, access_count, tags,
               created_at, updated_at, accessed_at, tier, source_turn_ids
        FROM memories WHERE id = ?
      `),
      // Phase 80 MEM-02 — origin_id lookup for idempotent collision read-back.
      getByOriginId: this.db.prepare(`
        SELECT id, content, source, importance, access_count, tags,
               created_at, updated_at, accessed_at, tier, source_turn_ids
        FROM memories WHERE origin_id = ?
      `),
      updateAccess: this.db.prepare(`
        UPDATE memories SET access_count = access_count + 1, accessed_at = ? WHERE id = ?
      `),
      deleteMemory: this.db.prepare(`DELETE FROM memories WHERE id = ?`),
      deleteVec: this.db.prepare(`DELETE FROM vec_memories WHERE memory_id = ?`),
      listRecent: this.db.prepare(`
        SELECT id, content, source, importance, access_count, tags,
               created_at, updated_at, accessed_at, tier, source_turn_ids
        FROM memories ORDER BY created_at DESC, rowid DESC LIMIT ?
      `),
      insertSessionLog: this.db.prepare(`
        INSERT INTO session_logs (id, date, file_path, entry_count, created_at)
        VALUES (?, ?, ?, ?, ?)
      `),
      insertLink: this.db.prepare(
        "INSERT OR IGNORE INTO memory_links (source_id, target_id, link_text, created_at) VALUES (?, ?, ?, ?)",
      ),
      deleteLinksFrom: this.db.prepare(
        "DELETE FROM memory_links WHERE source_id = ?",
      ),
      getBacklinks: this.db.prepare(`
        SELECT m.id, m.content, m.source, m.importance, m.access_count, m.tags,
               m.created_at, m.updated_at, m.accessed_at, m.tier, m.source_turn_ids,
               ml.link_text
        FROM memory_links ml
        JOIN memories m ON ml.source_id = m.id
        WHERE ml.target_id = ?
        ORDER BY m.created_at DESC
      `),
      getForwardLinks: this.db.prepare(`
        SELECT m.id, m.content, m.source, m.importance, m.access_count, m.tags,
               m.created_at, m.updated_at, m.accessed_at, m.tier, m.source_turn_ids,
               ml.link_text
        FROM memory_links ml
        JOIN memories m ON ml.target_id = m.id
        WHERE ml.source_id = ?
        ORDER BY m.created_at DESC
      `),
      checkMemoryExists: this.db.prepare(
        "SELECT 1 FROM memories WHERE id = ?",
      ),
      // Phase 84 SKILL-04 — narrow lookup for the migration dedup path.
      // Tags are stored as a JSON array string (e.g. '["learning","seed"]'),
      // so we LIKE '%"tag"%' to match the exact token. Content is compared
      // verbatim via '='.
      findByTagAndContent: this.db.prepare(
        `SELECT id FROM memories WHERE tags LIKE ? AND content = ? LIMIT 1`,
      ),
      // Phase 100-fu — public single-row access bump (see `bumpAccess`
      // method below). Identical UPDATE shape to `updateAccess` — duplicated
      // intentionally so the semantic-search path stays untouched and the
      // call sites are easy to audit.
      bumpAccess: this.db.prepare(`
        UPDATE memories SET access_count = access_count + 1, accessed_at = ? WHERE id = ?
      `),
      // Phase 100-fu — graph-centrality signal for tier promotion. Counts
      // inbound wikilink edges (rows in memory_links targeting this id).
      // Uses the existing idx_memory_links_target index so the lookup is
      // O(log n) per call.
      getBacklinkCount: this.db.prepare(
        "SELECT COUNT(*) AS n FROM memory_links WHERE target_id = ?",
      ),
    };
  }

  /**
   * Phase 84 SKILL-04 — migration-only narrow lookup. Returns the id of a
   * memory whose `tags` JSON-array contains the given tag AND whose
   * `content` exactly matches. Returns undefined when no row matches.
   *
   * Scope is intentionally tight: used by src/migration/skills-learnings-dedup.ts
   * to dedupe `.learnings/*.md` imports against pre-existing
   * tag-"learning" rows seeded by v2.1 memory translation.
   */
  findByTagAndContent(
    tag: string,
    content: string,
  ): { id: string } | undefined {
    const likePattern = `%"${tag}"%`;
    return this.stmts.findByTagAndContent.get(likePattern, content) as
      | { id: string }
      | undefined;
  }
}

/** Raw row shape from SQLite queries. */
type MemoryRow = {
  readonly id: string;
  readonly content: string;
  readonly source: string;
  readonly importance: number;
  readonly access_count: number;
  readonly tags: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly accessed_at: string;
  readonly tier: string;
  readonly source_turn_ids: string | null;
};

/** Convert a raw SQLite row to an immutable MemoryEntry. */
function rowToEntry(row: MemoryRow): MemoryEntry {
  const rawTurnIds = row.source_turn_ids;
  const sourceTurnIds = rawTurnIds
    ? Object.freeze(JSON.parse(rawTurnIds) as string[])
    : null;

  return Object.freeze({
    id: row.id,
    content: row.content,
    source: row.source as MemoryEntry["source"],
    importance: row.importance,
    accessCount: row.access_count,
    tags: Object.freeze(JSON.parse(row.tags) as string[]),
    embedding: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    accessedAt: row.accessed_at,
    tier: (row.tier ?? "warm") as MemoryTier,
    sourceTurnIds,
  });
}
