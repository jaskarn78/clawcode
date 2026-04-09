import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "../shared/logger.js";
import { SessionError } from "../shared/errors.js";
import type { SessionAdapter, SessionHandle } from "./session-adapter.js";
import type {
  AgentSessionConfig,
  BackoffConfig,
  Registry,
} from "./types.js";
import { DEFAULT_BACKOFF_CONFIG } from "./types.js";
import {
  readRegistry,
  writeRegistry,
  updateEntry,
  createEntry,
  EMPTY_REGISTRY,
} from "./registry.js";
import { calculateBackoff } from "./backoff.js";
import type { ResolvedAgentConfig } from "../shared/types.js";
import type { Logger } from "pino";

/**
 * Configuration for creating a SessionManager.
 */
export type SessionManagerOptions = {
  readonly adapter: SessionAdapter;
  readonly registryPath: string;
  readonly backoffConfig?: BackoffConfig;
  readonly log?: Logger;
};

/**
 * Manages agent session lifecycles: start, stop, restart, crash recovery.
 *
 * Internal state: Map<agentName, SessionHandle> for active sessions.
 * Registry is persisted to disk on every state change.
 * Agents are in-process SDK session objects (per D-02).
 */
export class SessionManager {
  private readonly adapter: SessionAdapter;
  private readonly registryPath: string;
  private readonly backoffConfig: BackoffConfig;
  private readonly log: Logger;
  private readonly sessions: Map<string, SessionHandle> = new Map();
  private readonly configs: Map<string, ResolvedAgentConfig> = new Map();
  private readonly stabilityTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();
  private readonly restartTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();

  constructor(options: SessionManagerOptions) {
    this.adapter = options.adapter;
    this.registryPath = options.registryPath;
    this.backoffConfig = options.backoffConfig ?? DEFAULT_BACKOFF_CONFIG;
    this.log = options.log ?? logger;
  }

  /**
   * Start an agent by name. Creates a session via the adapter and updates the registry.
   *
   * @throws SessionError if the agent is already running
   */
  async startAgent(
    name: string,
    config: ResolvedAgentConfig,
  ): Promise<void> {
    if (this.sessions.has(name)) {
      throw new SessionError(`Agent '${name}' is already running`, name);
    }

    // Store config for restart use
    this.configs.set(name, config);

    // Ensure registry entry exists
    let registry = await readRegistry(this.registryPath);
    const existing = registry.entries.find((e) => e.name === name);
    if (!existing) {
      registry = {
        entries: [...registry.entries, createEntry(name)],
        updatedAt: Date.now(),
      };
    }

    // Transition to starting
    registry = updateEntry(registry, name, { status: "starting" });
    await writeRegistry(this.registryPath, registry);

    // Build session config
    const sessionConfig = await this.buildSessionConfig(config);

    // Create session
    const handle = await this.adapter.createSession(sessionConfig);

    // Store handle
    this.sessions.set(name, handle);

    // Register crash handler
    handle.onError((error: Error) => {
      this.handleCrash(name, config, error);
    });

    // Set stability timer
    this.setStabilityTimer(name);

    // Transition to running
    registry = await readRegistry(this.registryPath);
    registry = updateEntry(registry, name, {
      status: "running",
      sessionId: handle.sessionId,
      startedAt: Date.now(),
    });
    await writeRegistry(this.registryPath, registry);

    this.log.info({ agent: name, sessionId: handle.sessionId }, "agent started");
  }

  /**
   * Stop an agent by name. Closes the session and updates the registry.
   *
   * @throws SessionError if the agent is not running
   */
  async stopAgent(name: string): Promise<void> {
    const handle = this.sessions.get(name);
    if (!handle) {
      throw new SessionError(`Agent '${name}' is not running`, name);
    }

    // Cancel timers
    this.clearStabilityTimer(name);
    this.clearRestartTimer(name);

    // Transition to stopping
    let registry = await readRegistry(this.registryPath);
    registry = updateEntry(registry, name, { status: "stopping" });
    await writeRegistry(this.registryPath, registry);

    // Close session
    await handle.close();
    this.sessions.delete(name);

    // Transition to stopped
    registry = await readRegistry(this.registryPath);
    registry = updateEntry(registry, name, {
      status: "stopped",
      sessionId: null,
    });
    await writeRegistry(this.registryPath, registry);

    this.log.info({ agent: name }, "agent stopped");
  }

  /**
   * Restart an agent by name. Stops then starts, incrementing restartCount.
   */
  async restartAgent(
    name: string,
    config: ResolvedAgentConfig,
  ): Promise<void> {
    await this.stopAgent(name);

    // Increment restart count
    let registry = await readRegistry(this.registryPath);
    const entry = registry.entries.find((e) => e.name === name);
    const currentCount = entry?.restartCount ?? 0;
    registry = updateEntry(registry, name, { restartCount: currentCount + 1 });
    await writeRegistry(this.registryPath, registry);

    await this.startAgent(name, config);
  }

  /**
   * Start all agents from resolved configs.
   * Collects errors but does not stop on individual failure.
   */
  async startAll(
    configs: readonly ResolvedAgentConfig[],
  ): Promise<void> {
    const errors: Array<{ name: string; error: Error }> = [];

    for (const config of configs) {
      try {
        await this.startAgent(config.name, config);
      } catch (error) {
        errors.push({ name: config.name, error: error as Error });
        this.log.error(
          { agent: config.name, error: (error as Error).message },
          "failed to start agent",
        );
      }
    }

    if (errors.length > 0) {
      this.log.warn(
        { failed: errors.length, total: configs.length },
        "some agents failed to start",
      );
    }
  }

  /**
   * Stop all running agents. Returns when all are stopped.
   */
  async stopAll(): Promise<void> {
    const names = [...this.sessions.keys()];
    const errors: Array<{ name: string; error: Error }> = [];

    // Stop sequentially to avoid registry write races
    for (const name of names) {
      try {
        await this.stopAgent(name);
      } catch (error) {
        errors.push({ name, error: error as Error });
      }
    }

    if (errors.length > 0) {
      this.log.warn(
        { failed: errors.length, total: names.length },
        "some agents failed to stop",
      );
    }

    this.log.info({ stopped: names.length }, "all agents stopped");
  }

  /**
   * Reconcile existing registry on startup. For each "running" entry,
   * attempt to resume the session. On failure, mark crashed and apply
   * restart policy.
   */
  async reconcileRegistry(
    configs: readonly ResolvedAgentConfig[],
  ): Promise<void> {
    let registry = await readRegistry(this.registryPath);
    let resumed = 0;
    let crashed = 0;
    let failed = 0;

    for (const entry of registry.entries) {
      const config = configs.find((c) => c.name === entry.name);

      if (entry.status === "running" && entry.sessionId && config) {
        // Attempt to resume
        try {
          const sessionConfig = await this.buildSessionConfig(config);
          const handle = await this.adapter.resumeSession(
            entry.sessionId,
            sessionConfig,
          );
          this.sessions.set(entry.name, handle);
          this.configs.set(entry.name, config);

          // Register crash handler
          handle.onError((error: Error) => {
            this.handleCrash(entry.name, config, error);
          });

          // Set stability timer
          this.setStabilityTimer(entry.name);

          resumed++;
          this.log.info(
            { agent: entry.name, sessionId: entry.sessionId },
            "session resumed",
          );
        } catch (error) {
          // Resume failed -- mark crashed and apply restart policy
          registry = await readRegistry(this.registryPath);
          registry = updateEntry(registry, entry.name, {
            status: "crashed",
            lastError: (error as Error).message,
            consecutiveFailures: entry.consecutiveFailures + 1,
          });
          await writeRegistry(this.registryPath, registry);

          this.configs.set(entry.name, config);
          this.scheduleRestart(entry.name, config, entry.consecutiveFailures + 1);

          crashed++;
          this.log.warn(
            { agent: entry.name, error: (error as Error).message },
            "failed to resume session, marking crashed",
          );
        }
      } else if (entry.status === "crashed" || entry.status === "restarting") {
        if (config) {
          this.configs.set(entry.name, config);
          this.scheduleRestart(entry.name, config, entry.consecutiveFailures);
          crashed++;
        }
      } else if (entry.status === "failed") {
        failed++;
      }
    }

    this.log.info(
      { total: registry.entries.length, resumed, crashed, failed },
      "registry reconciliation complete",
    );
  }

  /**
   * Get the names of all currently tracked agents (running sessions).
   */
  getRunningAgents(): readonly string[] {
    return [...this.sessions.keys()];
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  /**
   * Handle an agent crash: update registry, calculate backoff, schedule restart.
   * Returns a promise that resolves when the crash has been recorded (for testing).
   */
  private handleCrash(
    name: string,
    config: ResolvedAgentConfig,
    error: Error,
  ): void {
    // Clear timers
    this.clearStabilityTimer(name);
    this.sessions.delete(name);

    // Update registry and schedule restart
    const crashPromise = this.updateRegistryOnCrash(name, error).then(
      (failures) => {
        this.scheduleRestart(name, config, failures);
      },
    );

    // Store the promise so tests can await it
    this._lastCrashPromise = crashPromise;
  }

  /**
   * Internal: promise from the last crash handler, used by tests to await async operations.
   * @internal
   */
  _lastCrashPromise: Promise<void> | null = null;

  /**
   * Internal: promise from the last restart attempt, used by tests to await async operations.
   * @internal
   */
  _lastRestartPromise: Promise<void> | null = null;

  /**
   * Internal: promise from the last stability reset, used by tests to await async operations.
   * @internal
   */
  _lastStabilityPromise: Promise<void> | null = null;

  /**
   * Update registry after a crash, returning the new consecutive failure count.
   */
  private async updateRegistryOnCrash(
    name: string,
    error: Error,
  ): Promise<number> {
    let registry = await readRegistry(this.registryPath);
    const entry = registry.entries.find((e) => e.name === name);
    const failures = (entry?.consecutiveFailures ?? 0) + 1;

    registry = updateEntry(registry, name, {
      status: "crashed",
      sessionId: null,
      lastError: error.message,
      consecutiveFailures: failures,
    });
    await writeRegistry(this.registryPath, registry);

    this.log.error(
      { agent: name, error: error.message, consecutiveFailures: failures },
      "agent crashed",
    );

    return failures;
  }

  /**
   * Schedule a restart with exponential backoff, or mark failed if max retries exceeded.
   */
  private scheduleRestart(
    name: string,
    config: ResolvedAgentConfig,
    consecutiveFailures: number,
  ): void {
    const delay = calculateBackoff(consecutiveFailures, this.backoffConfig);

    if (delay === -1) {
      // Max retries exceeded
      const p = this.markFailed(name);
      this._lastRestartPromise = p;
      return;
    }

    this.log.info(
      { agent: name, delayMs: delay, attempt: consecutiveFailures },
      "scheduling restart",
    );

    const timer = setTimeout(() => {
      const p = this.performRestart(name, config);
      this._lastRestartPromise = p;
    }, delay);

    this.restartTimers.set(name, timer);
  }

  /**
   * Mark an agent as failed (max retries exceeded).
   */
  private async markFailed(name: string): Promise<void> {
    let registry = await readRegistry(this.registryPath);
    registry = updateEntry(registry, name, { status: "failed" });
    await writeRegistry(this.registryPath, registry);

    this.log.error({ agent: name }, "agent failed after max retries");
  }

  /**
   * Perform a restart after backoff delay.
   */
  private async performRestart(
    name: string,
    config: ResolvedAgentConfig,
  ): Promise<void> {
    try {
      // Update status to restarting
      let registry = await readRegistry(this.registryPath);
      registry = updateEntry(registry, name, { status: "restarting" });
      await writeRegistry(this.registryPath, registry);

      await this.startAgent(name, config);
    } catch (error) {
      this.log.error(
        { agent: name, error: (error as Error).message },
        "restart attempt failed",
      );
    }
  }

  /**
   * Build an AgentSessionConfig from a ResolvedAgentConfig.
   * Reads SOUL.md and IDENTITY.md from the workspace for systemPrompt.
   */
  private async buildSessionConfig(
    config: ResolvedAgentConfig,
  ): Promise<AgentSessionConfig> {
    let systemPrompt = "";

    // Read SOUL.md if available
    if (config.soul) {
      systemPrompt += config.soul + "\n\n";
    } else {
      try {
        const soulContent = await readFile(
          join(config.workspace, "SOUL.md"),
          "utf-8",
        );
        systemPrompt += soulContent + "\n\n";
      } catch {
        // No SOUL.md, that's fine
      }
    }

    // Read IDENTITY.md if available
    if (config.identity) {
      systemPrompt += config.identity;
    } else {
      try {
        const identityContent = await readFile(
          join(config.workspace, "IDENTITY.md"),
          "utf-8",
        );
        systemPrompt += identityContent;
      } catch {
        // No IDENTITY.md, that's fine
      }
    }

    return {
      name: config.name,
      model: config.model,
      workspace: config.workspace,
      systemPrompt: systemPrompt.trim(),
    };
  }

  /**
   * Set a stability timer that resets consecutiveFailures after stableAfterMs.
   */
  private setStabilityTimer(name: string): void {
    this.clearStabilityTimer(name);

    const timer = setTimeout(() => {
      const p = this.resetBackoff(name);
      this._lastStabilityPromise = p;
    }, this.backoffConfig.stableAfterMs);

    this.stabilityTimers.set(name, timer);
  }

  /**
   * Reset the backoff counter for a stable agent.
   */
  private async resetBackoff(name: string): Promise<void> {
    let registry = await readRegistry(this.registryPath);
    const entry = registry.entries.find((e) => e.name === name);
    if (entry && entry.status === "running") {
      registry = updateEntry(registry, name, {
        consecutiveFailures: 0,
        lastStableAt: Date.now(),
      });
      await writeRegistry(this.registryPath, registry);
      this.log.info({ agent: name }, "backoff reset after stable period");
    }
  }

  /**
   * Clear the stability timer for an agent.
   */
  private clearStabilityTimer(name: string): void {
    const timer = this.stabilityTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.stabilityTimers.delete(name);
    }
  }

  /**
   * Clear the restart timer for an agent.
   */
  private clearRestartTimer(name: string): void {
    const timer = this.restartTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(name);
    }
  }
}
