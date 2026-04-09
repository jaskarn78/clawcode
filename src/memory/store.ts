import Database from "better-sqlite3";
import type { Database as DatabaseType, Statement } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { nanoid } from "nanoid";
import { MemoryError } from "./errors.js";
import { checkForDuplicate, mergeMemory } from "./dedup.js";
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

      sqliteVec.load(this.db);

      this.initSchema();
      this.migrateSchema();
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
      const importance = input.importance ?? 0.5;
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
      })();

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

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('conversation', 'manual', 'system', 'consolidation')),
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
          source TEXT NOT NULL CHECK(source IN ('conversation', 'manual', 'system', 'consolidation')),
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

  private prepareStatements(): PreparedStatements {
    return {
      insertMemory: this.db.prepare(`
        INSERT INTO memories (id, content, source, importance, tags, created_at, updated_at, accessed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      insertVec: this.db.prepare(`
        INSERT INTO vec_memories (memory_id, embedding)
        VALUES (?, ?)
      `),
      getById: this.db.prepare(`
        SELECT id, content, source, importance, access_count, tags,
               created_at, updated_at, accessed_at
        FROM memories WHERE id = ?
      `),
      updateAccess: this.db.prepare(`
        UPDATE memories SET access_count = access_count + 1, accessed_at = ? WHERE id = ?
      `),
      deleteMemory: this.db.prepare(`DELETE FROM memories WHERE id = ?`),
      deleteVec: this.db.prepare(`DELETE FROM vec_memories WHERE memory_id = ?`),
      listRecent: this.db.prepare(`
        SELECT id, content, source, importance, access_count, tags,
               created_at, updated_at, accessed_at
        FROM memories ORDER BY created_at DESC, rowid DESC LIMIT ?
      `),
      insertSessionLog: this.db.prepare(`
        INSERT INTO session_logs (id, date, file_path, entry_count, created_at)
        VALUES (?, ?, ?, ?, ?)
      `),
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
};

/** Convert a raw SQLite row to an immutable MemoryEntry. */
function rowToEntry(row: MemoryRow): MemoryEntry {
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
  });
}
