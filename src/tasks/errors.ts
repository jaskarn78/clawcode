/**
 * Phase 58 — task subsystem typed errors.
 *
 * Follows the src/shared/errors.ts convention: extend Error, set this.name to
 * the class name, expose readonly context fields, format messages with structured
 * suffixes for grep-ability in pino logs.
 *
 * Kept feature-local (matches src/memory/errors.ts pattern) since these are
 * only thrown by the tasks subsystem and Phase 59/60 typed catches.
 */

import type { TaskStatus } from "./types.js";

/**
 * Thrown when a TaskStore SQLite operation fails. dbPath surfaces the daemon
 * tasks.db location for pino log debugging.
 */
export class TaskStoreError extends Error {
  readonly dbPath: string;

  constructor(message: string, dbPath: string) {
    super(`TaskStore: ${message} (${dbPath})`);
    this.name = "TaskStoreError";
    this.dbPath = dbPath;
  }
}

/**
 * Thrown by assertLegalTransition (src/tasks/state-machine.ts) when a caller
 * attempts a (from, to) transition not present in LEGAL_TRANSITIONS. Phase 59
 * TaskManager + Phase 60 TriggerEngine catch this to translate into MCP / IPC
 * typed responses.
 */
export class IllegalTaskTransitionError extends Error {
  readonly from: TaskStatus;
  readonly to: TaskStatus;

  constructor(from: TaskStatus, to: TaskStatus) {
    super(`Illegal task transition: ${from} → ${to}`);
    this.name = "IllegalTaskTransitionError";
    this.from = from;
    this.to = to;
  }
}

/**
 * Thrown by TaskStore.get / TaskStore.transition (Plan 58-02) when the
 * referenced task_id is not in the tasks table. Distinct from TaskStoreError
 * so callers can `instanceof` the not-found path separately from generic
 * SQLite failures.
 */
export class TaskNotFoundError extends Error {
  readonly taskId: string;

  constructor(taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = "TaskNotFoundError";
    this.taskId = taskId;
  }
}
