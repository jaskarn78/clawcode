import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "pino";
import type { SessionManager } from "../manager/session-manager.js";
import type { Registry } from "../manager/types.js";
import type { ResolvedAgentConfig } from "../shared/types.js";
import type { ThreadManager } from "../discord/thread-manager.js";
import type { TaskStore } from "../tasks/store.js";
import type { SecretsResolver } from "../manager/secrets-resolver.js";
import type { BrokerStatusProvider } from "./checks/mcp-broker.js";
import type {
  CheckModule,
  CheckContext,
  CheckResult,
  HeartbeatConfig,
  HeartbeatLogEntry,
} from "./types.js";
import { discoverChecks } from "./discovery.js";
import {
  ContextZoneTracker,
  DEFAULT_ZONE_THRESHOLDS,
} from "./context-zones.js";
import type {
  ContextZone,
  ZoneTransition,
  ZoneThresholds,
  SnapshotCallback,
} from "./context-zones.js";

/**
 * Callback invoked on any zone transition (for Discord notifications etc.).
 */
export type ZoneNotificationCallback = (
  agentName: string,
  transition: ZoneTransition,
) => Promise<void>;

/**
 * Options for creating a HeartbeatRunner.
 */
export type HeartbeatRunnerOptions = {
  readonly sessionManager: SessionManager;
  readonly registryPath: string;
  readonly config: HeartbeatConfig;
  readonly checksDir: string;
  readonly log: Logger;
  readonly snapshotCallback?: SnapshotCallback;
  readonly notificationCallback?: ZoneNotificationCallback;
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
  private readonly snapshotCallback?: SnapshotCallback;
  private readonly notificationCallback?: ZoneNotificationCallback;

  private checks: readonly CheckModule[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly lastRun: Map<string, number> = new Map();
  private readonly latestResults: Map<
    string,
    Map<string, { result: CheckResult; lastChecked: string }>
  > = new Map();
  private readonly agentConfigs: Map<string, ResolvedAgentConfig> = new Map();
  private readonly zoneTrackers: Map<string, ContextZoneTracker> = new Map();
  private threadManager: ThreadManager | undefined;
  private taskStore: TaskStore | undefined;
  // Phase 104 plan 03 (SEC-05) — passed into CheckContext so mcp-reconnect's
  // RecoveryDeps factory can wire `invalidate: (ref) => secretsResolver.invalidate(ref)`.
  private secretsResolver: SecretsResolver | undefined;
  // Phase 108 (POOL-07) — daemon-side adapter exposing
  // broker.getPoolStatus() to the mcp-broker check. Threaded into
  // CheckContext per-tick. Setter wired in daemon.ts after broker
  // construction, mirroring setSecretsResolver / setThreadManager /
  // setTaskStore.
  private brokerStatusProvider: BrokerStatusProvider | undefined;

  constructor(options: HeartbeatRunnerOptions) {
    this.sessionManager = options.sessionManager;
    this.registryPath = options.registryPath;
    this.config = options.config;
    this.checksDir = options.checksDir;
    this.log = options.log;
    this.snapshotCallback = options.snapshotCallback;
    this.notificationCallback = options.notificationCallback;
  }

  /**
   * Discover and load check modules from the checks directory.
   *
   * Phase 999.8 Plan 03 — discovery is now a static registry (see
   * check-registry.ts). The boot log surfaces both the count AND the
   * registered names so production journalctl gives operators an unambiguous
   * read of which checks are alive after a restart. The message string
   * changes from "discovered" → "registered" to make the new shape easy to
   * grep against the prior (broken) deployment's log lines.
   */
  async initialize(): Promise<void> {
    this.checks = await discoverChecks(this.checksDir);
    this.log.info(
      {
        checkCount: this.checks.length,
        checks: this.checks.map((c) => c.name),
      },
      "heartbeat checks registered",
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
   * Set the ThreadManager reference for thread-idle check context injection.
   */
  setThreadManager(tm: ThreadManager): void {
    this.threadManager = tm;
  }

  /**
   * Set the TaskStore reference for task-retention check context injection.
   * Phase 60 Plan 03 — mirrors the setThreadManager pattern.
   */
  setTaskStore(store: TaskStore): void {
    this.taskStore = store;
  }

  /**
   * Phase 104 plan 03 (SEC-05) — inject the SecretsResolver into
   * CheckContext so the op-refresh recovery handler can call
   * deps.invalidate(ref) before re-reading via op CLI. Mirrors the
   * setThreadManager / setTaskStore pattern.
   */
  setSecretsResolver(resolver: SecretsResolver): void {
    this.secretsResolver = resolver;
  }

  /**
   * Phase 108 (POOL-07) — inject the BrokerStatusProvider so the
   * `mcp-broker` heartbeat check can poll pool liveness without holding
   * a direct reference to the broker (keeps the check decoupled from
   * the broker module's lifecycle). Mirrors the setSecretsResolver /
   * setThreadManager / setTaskStore setter pattern.
   */
  setBrokerStatusProvider(provider: BrokerStatusProvider): void {
    this.brokerStatusProvider = provider;
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

    // Cleanup zone trackers for agents no longer running
    const runningSet = new Set(agentNames);
    for (const [name, tracker] of this.zoneTrackers) {
      if (!runningSet.has(name)) {
        tracker.reset();
        this.zoneTrackers.delete(name);
      }
    }

    // Build a minimal registry for context (read-only snapshot)
    const registry: Registry = {
      entries: [],
      updatedAt: Date.now(),
    };

    for (const agentName of agentNames) {
      // Skip agents with heartbeat disabled (D-13)
      const agentConfig = this.agentConfigs.get(agentName);
      if (agentConfig && agentConfig.heartbeat.enabled === false) {
        continue;
      }

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
          ...(this.threadManager ? { threadManager: this.threadManager } : {}),
          ...(this.taskStore ? { taskStore: this.taskStore } : {}),
          ...(this.secretsResolver ? { secretsResolver: this.secretsResolver } : {}),
          ...(this.brokerStatusProvider
            ? { brokerStatusProvider: this.brokerStatusProvider }
            : {}),
        };

        // Phase 999.12 HB-01 — special-case the inbox check timeout. Cross-
        // agent turns commonly take 30-90s; the fleet-wide checkTimeoutSeconds
        // (default 10s) creates false-positive critical alerts on the inbox
        // check. inboxTimeoutMs (default 60_000 from schema) overrides ONLY
        // the inbox check; other checks keep the fleet-wide timeout.
        const timeoutMs =
          check.name === "inbox" && this.config.inboxTimeoutMs !== undefined
            ? this.config.inboxTimeoutMs
            : (check.timeout ?? this.config.checkTimeoutSeconds) * 1000;
        const result = await this.executeWithTimeout(check, context, timeoutMs);
        const timestamp = new Date().toISOString();

        agentResults.set(check.name, { result, lastChecked: timestamp });
        this.lastRun.set(runKey, now);

        // Log to NDJSON file
        // Phase 75 SHARED-01 — memoryPath (not workspace) so shared-workspace
        // agents write heartbeat.log into their private per-agent memory dir.
        if (agentConfig) {
          this.logResult(agentConfig.memoryPath, agentName, check.name, result, timestamp);
        }

        // Critical results logged at warn level
        if (result.status === "critical") {
          this.log.warn(
            { agent: agentName, check: check.name, message: result.message },
            "heartbeat check critical",
          );
        }

        // Zone tracking: update zone tracker if fill percentage is present in metadata
        if (check.name === "context-fill" && result.metadata && typeof result.metadata.fillPercentage === "number") {
          await this.updateZoneTracker(agentName, result.metadata.fillPercentage as number, agentConfig);
        }
      }
    }
  }

  /**
   * Update the zone tracker for an agent with a new fill percentage.
   * Creates tracker lazily if needed. Logs transitions and fires callbacks.
   */
  private async updateZoneTracker(
    agentName: string,
    fillPercentage: number,
    agentConfig: ResolvedAgentConfig | undefined,
  ): Promise<void> {
    // Get or create zone tracker
    if (!this.zoneTrackers.has(agentName)) {
      const thresholds: ZoneThresholds =
        agentConfig?.heartbeat?.contextFill?.zoneThresholds ?? DEFAULT_ZONE_THRESHOLDS;
      const tracker = new ContextZoneTracker({
        agentName,
        thresholds,
        onSnapshot: this.snapshotCallback,
      });
      this.zoneTrackers.set(agentName, tracker);
    }

    const tracker = this.zoneTrackers.get(agentName)!;
    const transition = await tracker.update(fillPercentage);

    if (transition) {
      this.log.info(
        {
          agent: agentName,
          from: transition.from,
          to: transition.to,
          fillPercentage: transition.fillPercentage,
        },
        "context zone transition",
      );

      // Fire notification callback (fire-and-forget)
      if (this.notificationCallback) {
        this.notificationCallback(agentName, transition).catch((err) => {
          this.log.warn(
            { agent: agentName, error: (err as Error).message },
            "zone notification callback failed",
          );
        });
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
   * Get current zone statuses for all tracked agents.
   * Returns zone and last known fill percentage from latest results.
   */
  getZoneStatuses(): ReadonlyMap<string, { zone: ContextZone; fillPercentage: number }> {
    const result = new Map<string, { zone: ContextZone; fillPercentage: number }>();
    for (const [name, tracker] of this.zoneTrackers) {
      // Extract last known fill percentage from latest results metadata
      let fillPercentage = 0;
      const agentResults = this.latestResults.get(name);
      if (agentResults) {
        const fillResult = agentResults.get("context-fill");
        if (fillResult?.result.metadata && typeof fillResult.result.metadata.fillPercentage === "number") {
          fillPercentage = fillResult.result.metadata.fillPercentage as number;
        }
      }
      result.set(name, { zone: tracker.zone, fillPercentage });
    }
    return result;
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
   *
   * Phase 75 SHARED-01 — takes memoryPath (not workspace) so shared-workspace
   * agents get isolated heartbeat.log files in their private memory dirs.
   */
  private logResult(
    memoryPath: string,
    agentName: string,
    checkName: string,
    result: CheckResult,
    timestamp: string,
  ): void {
    const memoryDir = join(memoryPath, "memory");
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
