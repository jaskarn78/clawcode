import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "pino";
import type { SessionManager } from "../manager/session-manager.js";
import type { Registry } from "../manager/types.js";
import type { ResolvedAgentConfig } from "../shared/types.js";
import type {
  CheckModule,
  CheckContext,
  CheckResult,
  HeartbeatConfig,
  HeartbeatLogEntry,
} from "./types.js";
import { discoverChecks } from "./discovery.js";

/**
 * Options for creating a HeartbeatRunner.
 */
export type HeartbeatRunnerOptions = {
  readonly sessionManager: SessionManager;
  readonly registryPath: string;
  readonly config: HeartbeatConfig;
  readonly checksDir: string;
  readonly log: Logger;
};

/**
 * HeartbeatRunner executes discovered health checks sequentially
 * at a configurable interval for each running agent.
 *
 * Results are stored in memory and logged to NDJSON files per agent workspace.
 */
export class HeartbeatRunner {
  private readonly sessionManager: SessionManager;
  private readonly registryPath: string;
  private readonly config: HeartbeatConfig;
  private readonly checksDir: string;
  private readonly log: Logger;

  private checks: readonly CheckModule[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly lastRun: Map<string, number> = new Map();
  private readonly latestResults: Map<
    string,
    Map<string, { result: CheckResult; lastChecked: string }>
  > = new Map();
  private readonly agentConfigs: Map<string, ResolvedAgentConfig> = new Map();

  constructor(options: HeartbeatRunnerOptions) {
    this.sessionManager = options.sessionManager;
    this.registryPath = options.registryPath;
    this.config = options.config;
    this.checksDir = options.checksDir;
    this.log = options.log;
  }

  /**
   * Discover and load check modules from the checks directory.
   */
  async initialize(): Promise<void> {
    this.checks = await discoverChecks(this.checksDir);
    this.log.info(
      { checkCount: this.checks.length },
      "heartbeat checks discovered",
    );
  }

  /**
   * Set agent configurations for workspace path lookup during logging.
   */
  setAgentConfigs(configs: readonly ResolvedAgentConfig[]): void {
    for (const config of configs) {
      this.agentConfigs.set(config.name, config);
    }
  }

  /**
   * Start the heartbeat interval timer.
   */
  start(): void {
    if (this.intervalId !== null) {
      return;
    }
    this.intervalId = setInterval(
      () => void this.tick(),
      this.config.intervalSeconds * 1000,
    );
  }

  /**
   * Stop the heartbeat interval timer.
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Execute one tick: run all checks for all running agents sequentially.
   */
  async tick(): Promise<void> {
    const agentNames = this.sessionManager.getRunningAgents();

    // Build a minimal registry for context (read-only snapshot)
    const registry: Registry = {
      entries: [],
      updatedAt: Date.now(),
    };

    for (const agentName of agentNames) {
      if (!this.latestResults.has(agentName)) {
        this.latestResults.set(agentName, new Map());
      }
      const agentResults = this.latestResults.get(agentName)!;

      for (const check of this.checks) {
        // Check per-check interval override
        const effectiveIntervalMs =
          (check.interval ?? this.config.intervalSeconds) * 1000;
        const runKey = `${agentName}:${check.name}`;
        const lastRunTime = this.lastRun.get(runKey) ?? 0;
        const now = Date.now();

        if (now - lastRunTime < effectiveIntervalMs) {
          continue; // Not due yet
        }

        const context: CheckContext = {
          agentName,
          sessionManager: this.sessionManager,
          registry,
          config: this.config,
        };

        const timeoutMs = this.config.checkTimeoutSeconds * 1000;
        const result = await this.executeWithTimeout(check, context, timeoutMs);
        const timestamp = new Date().toISOString();

        agentResults.set(check.name, { result, lastChecked: timestamp });
        this.lastRun.set(runKey, now);

        // Log to NDJSON file
        const agentConfig = this.agentConfigs.get(agentName);
        if (agentConfig) {
          this.logResult(agentConfig.workspace, agentName, check.name, result, timestamp);
        }

        // Critical results logged at warn level
        if (result.status === "critical") {
          this.log.warn(
            { agent: agentName, check: check.name, message: result.message },
            "heartbeat check critical",
          );
        }
      }
    }
  }

  /**
   * Get the latest results for all agents and checks.
   */
  getLatestResults(): ReadonlyMap<
    string,
    ReadonlyMap<string, { result: CheckResult; lastChecked: string }>
  > {
    return this.latestResults;
  }

  /**
   * Execute a check with a timeout. If the check exceeds the timeout,
   * a critical result is returned.
   */
  private async executeWithTimeout(
    check: CheckModule,
    context: CheckContext,
    timeoutMs: number,
  ): Promise<CheckResult> {
    return Promise.race([
      check.execute(context),
      new Promise<CheckResult>((resolve) => {
        setTimeout(() => {
          resolve({
            status: "critical",
            message: `Check '${check.name}' timed out after ${timeoutMs}ms`,
          });
        }, timeoutMs);
      }),
    ]);
  }

  /**
   * Log a check result to the agent's NDJSON heartbeat.log file.
   * Creates the memory directory defensively.
   */
  private logResult(
    workspace: string,
    agentName: string,
    checkName: string,
    result: CheckResult,
    timestamp: string,
  ): void {
    const memoryDir = join(workspace, "memory");
    try {
      mkdirSync(memoryDir, { recursive: true });
    } catch {
      // Directory may already exist
    }

    const entry: HeartbeatLogEntry = {
      timestamp,
      agent: agentName,
      check: checkName,
      status: result.status,
      message: result.message,
      ...(result.metadata ? { metadata: { ...result.metadata } } : {}),
    };

    const logPath = join(memoryDir, "heartbeat.log");
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  }
}
