/**
 * Phase 60 Plan 03 Task 1 — SchedulerSource adapter.
 *
 * Wraps prompt-based cron schedules as a TriggerSource, routing fires
 * through `engine.ingest()` instead of directly through TurnDispatcher.
 *
 * Handler-based schedules (memory consolidation, etc.) are NOT handled
 * here — they remain on the regular TaskScheduler which is called
 * directly from daemon.ts. SchedulerSource only touches prompt-based
 * schedules that produce agent turns.
 *
 * poll(since) computes missed cron ticks between the watermark and now,
 * enabling watermark-based replay on daemon restart (TRIG-06).
 */

import { Cron } from "croner";
import { nanoid } from "nanoid";
import type { Logger } from "pino";

import type { TriggerEvent, TriggerSource } from "./types.js";
import type { ScheduleEntry } from "../scheduler/types.js";
import type { SessionManager } from "../manager/session-manager.js";
import type { TurnDispatcher } from "../manager/turn-dispatcher.js";
import { ManagerError } from "../shared/errors.js";

/** Max horizon for one-shot reminders (30 days). Guards against typos like
 *  '2099-01-01' that would pin the daemon's process timer. */
const REMINDER_MAX_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Constructor options for SchedulerSource. The `ingest` callback is
 * bound to `TriggerEngine.ingest` by daemon.ts — the adapter never
 * references the engine directly.
 */
export type SchedulerSourceOptions = Readonly<{
  resolvedAgents: ReadonlyArray<{
    name: string;
    schedules: ReadonlyArray<ScheduleEntry>;
  }>;
  sessionManager: SessionManager;
  turnDispatcher: TurnDispatcher;
  ingest: (event: TriggerEvent) => Promise<void>;
  log: Logger;
}>;

/** Internal record for a prompt-based schedule entry. */
type PromptScheduleEntry = Readonly<{
  agentName: string;
  entry: ScheduleEntry;
}>;

/** Callback registered for cron triggers (used by _triggerForTest). */
type TriggerCallback = () => Promise<void>;

/**
 * SchedulerSource implements TriggerSource for cron-based schedules.
 *
 * - `start()` creates Cron jobs for each enabled prompt-based schedule.
 *   On each fire it builds a TriggerEvent and calls `ingest()`.
 * - `stop()` stops all cron jobs and clears internal state.
 * - `poll(since)` computes missed ticks for replay.
 */
export class SchedulerSource implements TriggerSource {
  readonly sourceId = "scheduler" as const;

  private readonly scheduleEntries: readonly PromptScheduleEntry[];
  private readonly ingestFn: (event: TriggerEvent) => Promise<void>;
  private readonly log: Logger;

  private readonly cronJobs: Cron[] = [];
  private readonly locks = new Map<string, boolean>();
  private readonly triggers = new Map<string, Map<string, TriggerCallback>>();
  /** Phase 100 follow-up — reminderId → callback for `_triggerReminderForTest`. */
  private readonly reminderTriggers = new Map<string, TriggerCallback>();

  constructor(options: SchedulerSourceOptions) {
    this.ingestFn = options.ingest;
    this.log = options.log;

    // Collect only enabled prompt-based schedules (no handler).
    const entries: PromptScheduleEntry[] = [];
    for (const agent of options.resolvedAgents) {
      for (const entry of agent.schedules) {
        if (entry.enabled && entry.prompt && !entry.handler) {
          entries.push({ agentName: agent.name, entry });
        }
      }
    }
    this.scheduleEntries = Object.freeze(entries);
  }

  /** Number of prompt-based schedules registered (for testing). */
  get promptScheduleCount(): number {
    return this.scheduleEntries.length;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Create Cron jobs for each prompt-based schedule. On each fire:
   * 1. Check per-agent lock (sequential execution per agent).
   * 2. Build TriggerEvent with `sourceId="scheduler"`.
   * 3. Call `ingestFn(event)`.
   * 4. Release lock in finally block.
   */
  start(): void {
    for (const { agentName, entry } of this.scheduleEntries) {
      const triggerHandler: TriggerCallback = async (): Promise<void> => {
        // Per-agent sequential lock — mirrors TaskScheduler pattern.
        if (this.locks.get(agentName)) {
          this.log.info(
            { agent: agentName, schedule: entry.name },
            "scheduler-source: skipping (agent locked by another schedule)",
          );
          return;
        }
        this.locks.set(agentName, true);

        try {
          const event: TriggerEvent = {
            sourceId: "scheduler",
            idempotencyKey: `${entry.name}:${Date.now()}`,
            targetAgent: agentName,
            payload: entry.prompt,
            timestamp: Date.now(),
          };
          await this.ingestFn(event);
        } catch (err) {
          this.log.error(
            { agent: agentName, schedule: entry.name, error: (err as Error).message },
            "scheduler-source: ingest failed",
          );
        } finally {
          this.locks.set(agentName, false);
        }
      };

      // Create the cron job
      const job = new Cron(entry.cron, { paused: false }, () => {
        void triggerHandler();
      });
      this.cronJobs.push(job);

      // Register the trigger callback for _triggerForTest
      if (!this.triggers.has(agentName)) {
        this.triggers.set(agentName, new Map());
      }
      this.triggers.get(agentName)!.set(entry.name, triggerHandler);
    }

    this.log.info(
      { scheduleCount: this.scheduleEntries.length },
      "scheduler-source: started",
    );
  }

  /** Stop all cron jobs and clear internal state. */
  stop(): void {
    for (const job of this.cronJobs) {
      job.stop();
    }
    this.cronJobs.length = 0;
    this.triggers.clear();
    this.reminderTriggers.clear();
    this.locks.clear();
  }

  // -----------------------------------------------------------------------
  // addOneShotReminder — Phase 100 follow-up (operator-surfaced 2026-04-27)
  // -----------------------------------------------------------------------

  /**
   * Schedule a one-off reminder. At `fireAt`, a TriggerEvent is built with
   * `sourceId="reminder:<reminderId>"` (per-reminder-scoped to keep the
   * 3-layer dedup pipeline distinct) and ingested through the engine. The
   * delivery callback (wired in commit f984008) then routes the agent's
   * response to its bound delivery surface (typically Discord webhook).
   *
   * In-memory only — daemon restart loses pending reminders. The MCP tool
   * description tells the LLM to caveat accordingly.
   *
   * Throws `ManagerError` for invalid / past / too-far-out fireAt values
   * so the IPC handler surfaces a clean JSON-RPC error instead of a raw
   * runtime crash.
   */
  async addOneShotReminder(opts: {
    readonly fireAt: Date;
    readonly agentName: string;
    readonly prompt: string;
  }): Promise<{ readonly reminderId: string }> {
    const now = Date.now();
    const fireMs = opts.fireAt.getTime();
    if (isNaN(fireMs)) {
      throw new ManagerError(`Invalid fireAt: ${opts.fireAt}`);
    }
    if (fireMs <= now) {
      throw new ManagerError(
        `fireAt must be in the future (got ${opts.fireAt.toISOString()})`,
      );
    }
    if (fireMs > now + REMINDER_MAX_HORIZON_MS) {
      throw new ManagerError(
        `fireAt cannot be more than 30 days in the future (got ${opts.fireAt.toISOString()})`,
      );
    }

    const reminderId = nanoid(8);
    const agentName = opts.agentName;
    const prompt = opts.prompt;

    const reminderCallback: TriggerCallback = async (): Promise<void> => {
      // Per-agent sequential lock — mirrors the recurring schedule path so a
      // reminder doesn't race a long-running scheduled prompt for the same
      // agent. The skip is logged + the watermark intentionally NOT advanced
      // (in-memory-only reminders have no replay anyway).
      if (this.locks.get(agentName)) {
        this.log.info(
          { agent: agentName, reminderId },
          "scheduler-source: reminder skipped (agent locked by another schedule)",
        );
        return;
      }
      this.locks.set(agentName, true);
      try {
        const event: TriggerEvent = {
          sourceId: `reminder:${reminderId}`,
          idempotencyKey: `reminder:${reminderId}`,
          targetAgent: agentName,
          payload: prompt,
          timestamp: Date.now(),
        };
        await this.ingestFn(event);
      } catch (err) {
        this.log.error(
          { agent: agentName, reminderId, error: (err as Error).message },
          "scheduler-source: reminder ingest failed",
        );
      } finally {
        this.locks.set(agentName, false);
      }
    };

    // croner accepts a Date as the first arg for one-shot scheduling. The
    // job auto-stops after the date passes; we keep the handle in cronJobs
    // so `stop()` cleanly tears it down on daemon shutdown.
    const cronJob = new Cron(opts.fireAt, { paused: false }, () => {
      void reminderCallback();
    });
    this.cronJobs.push(cronJob);
    this.reminderTriggers.set(reminderId, reminderCallback);

    this.log.info(
      { agent: agentName, reminderId, fireAt: opts.fireAt.toISOString() },
      "scheduler-source: one-shot reminder scheduled",
    );
    return { reminderId };
  }

  // -----------------------------------------------------------------------
  // poll — watermark-based replay (TRIG-06)
  // -----------------------------------------------------------------------

  /**
   * Compute missed cron ticks between `since` (epoch string or null)
   * and now for each prompt-based schedule entry. Returns sorted events
   * suitable for `TriggerEngine.ingest()`.
   *
   * When `since` is null, starts from now (no missed ticks returned).
   */
  async poll(since: string | null): Promise<readonly TriggerEvent[]> {
    const now = Date.now();

    if (since === null) {
      return [];
    }

    const sinceEpoch = parseInt(since, 10);
    if (isNaN(sinceEpoch) || sinceEpoch >= now) {
      return [];
    }

    const sinceDate = new Date(sinceEpoch);
    const nowDate = new Date(now);
    const events: TriggerEvent[] = [];
    const MAX_TICKS_PER_SCHEDULE = 1000;

    for (const { agentName, entry } of this.scheduleEntries) {
      // Create a paused cron to compute next runs
      const tempCron = new Cron(entry.cron, { paused: true });
      let current = sinceDate;
      let tickCount = 0;

      while (tickCount < MAX_TICKS_PER_SCHEDULE) {
        const next = tempCron.nextRun(current);
        if (!next || next > nowDate) {
          break;
        }
        const tickEpoch = next.getTime();
        events.push({
          sourceId: "scheduler",
          idempotencyKey: `${entry.name}:${tickEpoch}`,
          targetAgent: agentName,
          payload: entry.prompt,
          timestamp: tickEpoch,
        });
        // Move past this tick to find the next one
        current = new Date(tickEpoch + 1);
        tickCount++;
      }

      tempCron.stop();
    }

    // Sort by timestamp ascending
    events.sort((a, b) => a.timestamp - b.timestamp);
    return Object.freeze(events);
  }

  // -----------------------------------------------------------------------
  // Test helpers
  // -----------------------------------------------------------------------

  /**
   * Manually trigger a specific schedule's callback (test-only).
   * @internal
   */
  async _triggerForTest(agentName: string, scheduleName: string): Promise<void> {
    const agentTriggers = this.triggers.get(agentName);
    if (!agentTriggers) {
      throw new Error(`No triggers registered for agent '${agentName}'`);
    }
    const trigger = agentTriggers.get(scheduleName);
    if (!trigger) {
      throw new Error(`No trigger for schedule '${scheduleName}' on agent '${agentName}'`);
    }
    await trigger();
  }

  /**
   * Manually trigger a one-shot reminder's callback (test-only). Mirrors
   * `_triggerForTest` but keyed by the reminderId returned from
   * `addOneShotReminder`. Avoids fighting croner's internal setTimeout vs
   * vitest fake timers.
   * @internal
   */
  async _triggerReminderForTest(reminderId: string): Promise<void> {
    const trigger = this.reminderTriggers.get(reminderId);
    if (!trigger) {
      throw new Error(`No reminder registered for id '${reminderId}'`);
    }
    await trigger();
  }
}
