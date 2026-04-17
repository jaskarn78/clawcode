/**
 * Phase 61 Plan 02 Task 1 -- InboxSource TriggerSource adapter.
 *
 * Watches an agent's collaboration/inbox/ directory via chokidar for new
 * message files. On each new file: read, parse, build TriggerEvent, ingest
 * through TriggerEngine, then move to processed/ via markProcessed.
 *
 * Key behaviors:
 * - ignoreInitial: true -- pre-existing files handled by poll(since) on
 *   daemon restart, NOT by the watcher (Research pitfall 3)
 * - awaitWriteFinish with configurable stabilityThreshold (default 500ms)
 * - On ingest failure, file is NOT moved to processed (retry on next cycle)
 * - poll(since) replays unprocessed messages for watermark-based replay
 *
 * This is the PRIMARY inbox delivery path. The existing heartbeat inbox
 * check (src/heartbeat/checks/inbox.ts) becomes a reconciler/fallback.
 * Plan 61-03 will handle the heartbeat coordination in daemon.ts.
 */

import { watch, type FSWatcher } from "chokidar";
import { readFile } from "node:fs/promises";
import type { Logger } from "pino";

import type { TriggerEvent, TriggerSource } from "../types.js";
import { readMessages, markProcessed } from "../../collaboration/inbox.js";

/**
 * Constructor options for InboxSource. The `ingest` callback is bound to
 * `TriggerEngine.ingest` by daemon.ts.
 */
export type InboxSourceOptions = Readonly<{
  agentName: string;
  inboxDir: string;
  stabilityThresholdMs: number;
  targetAgent: string;
  ingest: (event: TriggerEvent) => Promise<void>;
  log: Logger;
}>;

/**
 * InboxSource implements TriggerSource for filesystem inbox watching.
 *
 * - `start()` creates a chokidar watcher on the inbox directory.
 * - `stop()` closes the watcher.
 * - `poll(since)` replays unprocessed messages for watermark-based restart.
 */
export class InboxSource implements TriggerSource {
  readonly sourceId: string;

  private readonly agentName: string;
  private readonly inboxDir: string;
  private readonly stabilityThresholdMs: number;
  private readonly targetAgent: string;
  private readonly ingestFn: (event: TriggerEvent) => Promise<void>;
  private readonly log: Logger;

  private watcher: FSWatcher | null = null;

  constructor(options: InboxSourceOptions) {
    this.agentName = options.agentName;
    this.inboxDir = options.inboxDir;
    this.stabilityThresholdMs = options.stabilityThresholdMs;
    this.targetAgent = options.targetAgent;
    this.ingestFn = options.ingest;
    this.log = options.log;
    this.sourceId = `inbox:${options.agentName}`;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start watching the inbox directory. Uses ignoreInitial: true so
   * pre-existing files are NOT replayed on start (handled by poll(since)
   * during daemon restart via TriggerEngine.replayMissed).
   */
  start(): void {
    this.watcher = watch(this.inboxDir, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: this.stabilityThresholdMs,
      },
    });

    this.watcher.on("add", (filePath: string) => {
      // Fire-and-forget in production; tests extract this callback and
      // await it to ensure deterministic ordering.
      return this.handleNewFile(filePath);
    });

    this.log.info(
      { sourceId: this.sourceId, inboxDir: this.inboxDir },
      "inbox-source: started",
    );
  }

  /** Stop watching. Closes the chokidar watcher if active. */
  stop(): void {
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
  }

  // -------------------------------------------------------------------------
  // poll -- watermark-based replay (TRIG-06)
  // -------------------------------------------------------------------------

  /**
   * Replay unprocessed messages from the inbox directory.
   *
   * When `since` is null, returns ALL unprocessed messages (first boot).
   * When `since` is a timestamp string, returns only messages with
   * timestamp > parseInt(since, 10).
   *
   * Does NOT call ingestFn -- the engine handles that during replay.
   */
  async poll(since: string | null): Promise<readonly TriggerEvent[]> {
    const messages = await readMessages(this.inboxDir);
    const sinceTs = since !== null ? parseInt(since, 10) : 0;

    const filtered = messages.filter((msg) => msg.timestamp > sinceTs);

    const events: TriggerEvent[] = filtered.map((msg) => ({
      sourceId: this.sourceId,
      idempotencyKey: msg.id,
      targetAgent: this.targetAgent,
      payload: `[Message from ${msg.from}]: ${msg.content}`,
      timestamp: msg.timestamp,
    }));

    // Already sorted by readMessages (timestamp ascending)
    return Object.freeze(events);
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /**
   * Handle a new file detected by chokidar.
   * 1. Read file content
   * 2. JSON parse (skip non-JSON with warning)
   * 3. Validate InboxMessage shape (must have id, from, content, timestamp)
   * 4. Build TriggerEvent and call ingestFn
   * 5. On success, markProcessed to move to processed/
   * 6. On ingest failure, log error and leave file for retry
   */
  private async handleNewFile(filePath: string): Promise<void> {
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch (err) {
      this.log.warn(
        { filePath, error: (err as Error).message },
        "inbox-source: failed to read file",
      );
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      this.log.warn(
        { filePath },
        "inbox-source: file is not valid JSON, skipping",
      );
      return;
    }

    // Validate required InboxMessage fields
    if (
      typeof parsed["id"] !== "string" ||
      typeof parsed["from"] !== "string" ||
      typeof parsed["content"] !== "string" ||
      typeof parsed["timestamp"] !== "number"
    ) {
      this.log.warn(
        { filePath },
        "inbox-source: file missing required InboxMessage fields, skipping",
      );
      return;
    }

    const event: TriggerEvent = {
      sourceId: this.sourceId,
      idempotencyKey: parsed["id"] as string,
      targetAgent: this.targetAgent,
      payload: `[Message from ${parsed["from"] as string}]: ${parsed["content"] as string}`,
      timestamp: parsed["timestamp"] as number,
    };

    try {
      await this.ingestFn(event);
    } catch (err) {
      this.log.error(
        { sourceId: this.sourceId, filePath, error: (err as Error).message },
        "inbox-source: ingest failed, file NOT moved to processed",
      );
      return;
    }

    // Ingest succeeded -- move to processed/
    try {
      await markProcessed(this.inboxDir, parsed["id"] as string);
    } catch (err) {
      this.log.error(
        { sourceId: this.sourceId, messageId: parsed["id"], error: (err as Error).message },
        "inbox-source: markProcessed failed",
      );
    }
  }
}
