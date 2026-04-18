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
      // Dedup check: if enabled and not skipped, check for near-duplicates
      if (this.dedupConfig.enabled && !input.skipDedup) {
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

      this.db.transaction(() => {
        this.stmts.insertMemory.run(
          id,
          input.content,
          input.source,
          importance,
          JSON.stringify(tags),
          now,
          now,
          now,
        );
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
        sourceTurnIds: null,
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

  private prepareStatements(): PreparedStatements {
    return {
      insertMemory: this.db.prepare(`
        INSERT INTO memories (id, content, source, importance, tags, created_at, updated_at, accessed_at, tier)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'warm')
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
    };
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
