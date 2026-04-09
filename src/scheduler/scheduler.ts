import { Cron } from "croner";
import type { Logger } from "pino";
import type { SessionManager } from "../manager/session-manager.js";
import type { ScheduleEntry, ScheduleStatus, TaskSchedulerOptions } from "./types.js";

/**
 * Mutable internal status record for tracking schedule execution.
 * Converted to readonly ScheduleStatus on read.
 */
type MutableStatus = {
  name: string;
  agentName: string;
  cron: string;
  enabled: boolean;
  lastRun: number | null;
  lastStatus: "success" | "error" | "pending";
  lastError: string | null;
  nextRun: number | null;
};

/**
 * Callback registered for a cron job trigger.
 * Used by _triggerForTest to invoke the handler manually.
 */
type TriggerCallback = () => Promise<void>;

/**
 * TaskScheduler manages cron-based task execution for agents.
 * Each agent can have multiple scheduled tasks that execute via sendToAgent().
 * Tasks run one at a time per agent (sequential, not parallel).
 */
export class TaskScheduler {
  private readonly sessionManager: SessionManager;
  private readonly log: Logger;
  private readonly jobs: Map<string, Cron[]> = new Map();
  private readonly statuses: Map<string, MutableStatus[]> = new Map();
  private readonly locks: Map<string, boolean> = new Map();
  private readonly triggers: Map<string, Map<string, TriggerCallback>> = new Map();

  constructor(options: TaskSchedulerOptions) {
    this.sessionManager = options.sessionManager;
    this.log = options.log;
  }

  /**
   * Register an agent's scheduled tasks.
   * Creates cron jobs for each enabled schedule entry.
   * Disabled schedules are skipped entirely.
   */
  addAgent(agentName: string, schedules: readonly ScheduleEntry[]): void {
    const agentJobs: Cron[] = [];
    const agentStatuses: MutableStatus[] = [];
    const agentTriggers = new Map<string, TriggerCallback>();

    for (const schedule of schedules) {
      if (!schedule.enabled) {
        continue;
      }

      const status: MutableStatus = {
        name: schedule.name,
        agentName,
        cron: schedule.cron,
        enabled: schedule.enabled,
        lastRun: null,
        lastStatus: "pending",
        lastError: null,
        nextRun: null,
      };

      const triggerHandler = async (): Promise<void> => {
        // Per-agent sequential lock (D-05)
        if (this.locks.get(agentName)) {
          this.log.info(
            { agent: agentName, task: schedule.name },
            "skipping scheduled task (agent locked by another task)",
          );
          return;
        }

        this.locks.set(agentName, true);
        try {
          this.log.info(
            { agent: agentName, task: schedule.name },
            "executing scheduled task",
          );

          await this.sessionManager.sendToAgent(agentName, schedule.prompt);

          status.lastRun = Date.now();
          status.lastStatus = "success";
          status.lastError = null;

          this.log.info(
            { agent: agentName, task: schedule.name },
            "scheduled task completed",
          );
        } catch (error) {
          status.lastRun = Date.now();
          status.lastStatus = "error";
          status.lastError = (error as Error).message;

          this.log.error(
            { agent: agentName, task: schedule.name, error: (error as Error).message },
            "scheduled task failed",
          );
        } finally {
          this.locks.set(agentName, false);

          // Update nextRun from the cron job
          const job = agentJobs.find((j) => (j as any)._scheduleName === schedule.name);
          if (job) {
            status.nextRun = job.nextRun()?.getTime() ?? null;
          }
        }
      };

      // Create the cron job
      const job = new Cron(schedule.cron, { paused: false }, () => {
        void triggerHandler();
      });

      // Tag the job so we can find it later for nextRun updates
      (job as any)._scheduleName = schedule.name;

      // Set initial nextRun
      status.nextRun = job.nextRun()?.getTime() ?? null;

      agentJobs.push(job);
      agentStatuses.push(status);
      agentTriggers.set(schedule.name, triggerHandler);
    }

    this.jobs.set(agentName, agentJobs);
    this.statuses.set(agentName, agentStatuses);
    this.triggers.set(agentName, agentTriggers);
    this.locks.set(agentName, false);

    this.log.info(
      { agent: agentName, scheduleCount: agentJobs.length },
      "agent schedules registered",
    );
  }

  /**
   * Remove an agent's scheduled tasks.
   * Stops all cron jobs and removes tracking state.
   */
  removeAgent(agentName: string): void {
    const agentJobs = this.jobs.get(agentName);
    if (agentJobs) {
      for (const job of agentJobs) {
        job.stop();
      }
    }

    this.jobs.delete(agentName);
    this.statuses.delete(agentName);
    this.triggers.delete(agentName);
    this.locks.delete(agentName);

    this.log.info({ agent: agentName }, "agent schedules removed");
  }

  /**
   * Get the status of all scheduled tasks across all agents.
   */
  getStatuses(): readonly ScheduleStatus[] {
    const result: ScheduleStatus[] = [];
    for (const statuses of this.statuses.values()) {
      for (const status of statuses) {
        result.push({ ...status });
      }
    }
    return result;
  }

  /**
   * Get the status of all scheduled tasks for a specific agent.
   */
  getAgentStatuses(agentName: string): readonly ScheduleStatus[] {
    const statuses = this.statuses.get(agentName);
    if (!statuses) {
      return [];
    }
    return statuses.map((s) => ({ ...s }));
  }

  /**
   * Stop all scheduled tasks for all agents.
   */
  stop(): void {
    for (const agentName of [...this.jobs.keys()]) {
      this.removeAgent(agentName);
    }
    this.log.info("all schedules stopped");
  }

  /**
   * Test helper: manually trigger a specific schedule's callback.
   * @internal
   */
  async _triggerForTest(agentName: string, scheduleName: string): Promise<void> {
    const agentTriggers = this.triggers.get(agentName);
    if (!agentTriggers) {
      throw new Error(`No triggers registered for agent '${agentName}'`);
    }

    const trigger = agentTriggers.get(scheduleName);
    if (!trigger) {
      throw new Error(`No trigger registered for schedule '${scheduleName}' on agent '${agentName}'`);
    }

    await trigger();
  }
}
