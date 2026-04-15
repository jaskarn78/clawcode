/**
 * Phase 58 Plan 02 — TaskStore.
 *
 * SQLite persistence layer for the task lifecycle (LIFE-01 + LIFE-02). Wraps
 * a single daemon-scoped `tasks.db` with:
 *
 *   - tasks table (15 LIFE-02 fields + CHECK constraints on status & depth)
 *   - trigger_state table (Phase 60 source watermarks + opaque cursor blobs)
 *   - 4 covering indexes (reconciler scan, causation walk, retention cleanup,
 *     and clawcode-tasks CLI filter per CONTEXT <specifics>)
 *
 * Conventions mirror `src/performance/trace-store.ts` and
 * `src/memory/store.ts`: synchronous better-sqlite3, WAL + foreign_keys
 * PRAGMAs, prepared statements in a readonly struct, and typed wrapping of
 * SQLite failures into `TaskStoreError`. `TaskNotFoundError` /
 * `IllegalTaskTransitionError` remain distinct so callers can branch on
 * them via `instanceof` without parsing error messages.
 *
 * Task 1 lands the skeleton (schema + migration + insert + get + close);
 * Task 2 extends it with transition + markOrphaned + listStaleRunning +
 * trigger_state CRUD.
 */

import Database from "better-sqlite3";
import type { Database as DatabaseType, Statement } from "better-sqlite3";

import {
  TaskRowSchema,
  type TaskRow,
} from "./schema.js";
import { TaskStoreError } from "./errors.js";

/**
 * Default reconciler threshold — 5 minutes. Matches the daemon heartbeat
 * cadence; Plan 58-03 passes this to `listStaleRunning()` on each tick.
 */
export const ORPHAN_THRESHOLD_MS_DEFAULT = 5 * 60 * 1000;

/** Constructor options — single daemon-scoped DB path. */
export type TaskStoreOptions = {
  readonly dbPath: string;
};

/** Prepared statements used by TaskStore. */
type PreparedStatements = {
  readonly insertTask: Statement;
  readonly getTask: Statement;
  readonly updateTaskStatus: Statement;
  readonly markOrphanedStmt: Statement;
  readonly listStaleRunningStmt: Statement;
  readonly upsertTriggerStateStmt: Statement;
  readonly getTriggerStateStmt: Statement;
};

/**
 * Raw row shape returned by `SELECT * FROM tasks`. Zod re-parses this into
 * a `TaskRow` so the caller never touches raw SQLite output.
 */
type TaskRawRow = {
  readonly task_id: string;
  readonly task_type: string;
  readonly caller_agent: string;
  readonly target_agent: string;
  readonly causation_id: string;
  readonly parent_task_id: string | null;
  readonly depth: number;
  readonly input_digest: string;
  readonly status: string;
  readonly started_at: number;
  readonly ended_at: number | null;
  readonly heartbeat_at: number;
  readonly result_digest: string | null;
  readonly error: string | null;
  readonly chain_token_cost: number;
};

export class TaskStore {
  private readonly db: DatabaseType;
  private readonly dbPath: string;
  private readonly stmts: PreparedStatements;

  constructor(options: TaskStoreOptions) {
    this.dbPath = options.dbPath;
    try {
      this.db = new Database(options.dbPath);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("busy_timeout = 5000");
      this.db.pragma("synchronous = NORMAL");
      this.db.pragma("foreign_keys = ON");

      this.ensureSchema();
      this.stmts = this.prepareStatements();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      throw new TaskStoreError(`open failed: ${msg}`, options.dbPath);
    }
  }

  /**
   * Create tables + indexes idempotently.
   *
   * Uses `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` in a
   * single transaction. Future v1.9+ schema changes will use the
   * PRAGMA table_info migration pattern from `src/performance/trace-store.ts`
   * (see Phase 52 / 57-02 precedent).
   */
  private ensureSchema(): void {
    const ddl = `
      BEGIN;

      CREATE TABLE IF NOT EXISTS tasks (
        task_id          TEXT PRIMARY KEY,
        task_type        TEXT NOT NULL,
        caller_agent     TEXT NOT NULL,
        target_agent     TEXT NOT NULL,
        causation_id     TEXT NOT NULL,
        parent_task_id   TEXT,
        depth            INTEGER NOT NULL CHECK(depth >= 0),
        input_digest     TEXT NOT NULL,
        status           TEXT NOT NULL CHECK(status IN
                          ('pending','running','awaiting_input',
                           'complete','failed','cancelled','timed_out','orphaned')),
        started_at       INTEGER NOT NULL,
        ended_at         INTEGER,
        heartbeat_at     INTEGER NOT NULL,
        result_digest    TEXT,
        error            TEXT,
        chain_token_cost INTEGER NOT NULL DEFAULT 0 CHECK(chain_token_cost >= 0)
      );

      CREATE TABLE IF NOT EXISTS trigger_state (
        source_id      TEXT PRIMARY KEY,
        last_watermark TEXT,
        cursor_blob    TEXT,
        updated_at     INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status_heartbeat ON tasks(status, heartbeat_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_causation_id     ON tasks(causation_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_ended_at         ON tasks(ended_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_caller_target    ON tasks(caller_agent, target_agent);

      COMMIT;
    `;
    this.db.exec(ddl);
  }

  /**
   * Insert a new task row. Zod-validates the full 15-field shape before any
   * SQL runs, so invalid statuses / negative depth / empty strings fail fast
   * with the Zod error propagated directly (callers that want `instanceof
   * TaskStoreError` semantics should catch Zod separately).
   *
   * SQLite-level failures (CHECK constraint, UNIQUE violation) are wrapped in
   * `TaskStoreError` with the db path for log debugging.
   */
  insert(row: TaskRow): void {
    const parsed = TaskRowSchema.parse(row);
    try {
      this.stmts.insertTask.run(
        parsed.task_id,
        parsed.task_type,
        parsed.caller_agent,
        parsed.target_agent,
        parsed.causation_id,
        parsed.parent_task_id,
        parsed.depth,
        parsed.input_digest,
        parsed.status,
        parsed.started_at,
        parsed.ended_at,
        parsed.heartbeat_at,
        parsed.result_digest,
        parsed.error,
        parsed.chain_token_cost,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      throw new TaskStoreError(`insert failed: ${msg}`, this.dbPath);
    }
  }

  /**
   * Fetch a task by id. Returns `null` (never throws) when the id is absent —
   * callers that need the not-found-as-error semantics use `transition` or
   * `markOrphaned` (both throw `TaskNotFoundError`).
   */
  get(taskId: string): TaskRow | null {
    try {
      const raw = this.stmts.getTask.get(taskId) as TaskRawRow | undefined;
      if (!raw) return null;
      return TaskRowSchema.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      throw new TaskStoreError(`get failed: ${msg}`, this.dbPath);
    }
  }

  /** Release the underlying SQLite handle. Subsequent calls throw. */
  close(): void {
    this.db.close();
  }

  // Task 2 extends with: transition, markOrphaned, listStaleRunning,
  //                     upsertTriggerState, getTriggerState.

  private prepareStatements(): PreparedStatements {
    return {
      insertTask: this.db.prepare(`
        INSERT INTO tasks
          (task_id, task_type, caller_agent, target_agent, causation_id,
           parent_task_id, depth, input_digest, status, started_at,
           ended_at, heartbeat_at, result_digest, error, chain_token_cost)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getTask: this.db.prepare(`SELECT * FROM tasks WHERE task_id = ?`),
      // Task 2 replaces these five stubs with real statements.
      updateTaskStatus: this.db.prepare(`SELECT 1`),
      markOrphanedStmt: this.db.prepare(`SELECT 1`),
      listStaleRunningStmt: this.db.prepare(`SELECT 1`),
      upsertTriggerStateStmt: this.db.prepare(`SELECT 1`),
      getTriggerStateStmt: this.db.prepare(`SELECT 1`),
    };
  }
}
