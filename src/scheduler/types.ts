import type { SessionManager } from "../manager/session-manager.js";
import type { Logger } from "pino";

/**
 * A single scheduled task entry for an agent.
 * Parsed from clawcode.yaml schedule config.
 */
export type ScheduleEntry = {
  readonly name: string;
  readonly cron: string;
  readonly prompt?: string;
  readonly handler?: () => Promise<void>;
  readonly enabled: boolean;
};

/**
 * Runtime status of a scheduled task.
 * Tracks execution history and next run timing.
 */
export type ScheduleStatus = {
  readonly name: string;
  readonly agentName: string;
  readonly cron: string;
  readonly enabled: boolean;
  readonly lastRun: number | null;
  readonly lastStatus: "success" | "error" | "pending";
  readonly lastError: string | null;
  readonly nextRun: number | null;
};

/**
 * Options for creating a TaskScheduler instance.
 */
export type TaskSchedulerOptions = {
  readonly sessionManager: SessionManager;
  readonly log: Logger;
};
