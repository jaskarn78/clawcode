import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
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
import type { SkillsCatalog } from "../skills/types.js";
import { MemoryStore } from "../memory/store.js";
import { EmbeddingService } from "../memory/embedder.js";
import { SessionLogger } from "../memory/session-log.js";
import { CompactionManager, CharacterCountFillProvider } from "../memory/compaction.js";
import { TierManager } from "../memory/tier-manager.js";
import { DEFAULT_TIER_CONFIG } from "../memory/tiers.js";
import { buildForkName, buildForkConfig } from "./fork.js";
import type { ForkOptions, ForkResult } from "./fork.js";

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

  // Memory lifecycle maps (per-agent)
  private readonly memoryStores: Map<string, MemoryStore> = new Map();
  private readonly compactionManagers: Map<string, CompactionManager> = new Map();
  private readonly sessionLoggers: Map<string, SessionLogger> = new Map();
  private readonly contextFillProviders: Map<string, CharacterCountFillProvider> = new Map();

  // Tier management (per-agent)
  private readonly tierManagers: Map<string, TierManager> = new Map();

  // Skills catalog (set by daemon after scanning)
  private skillsCatalog: SkillsCatalog = new Map();

  // All agent configs (set by daemon for admin prompt injection)
  private allAgentConfigs: readonly ResolvedAgentConfig[] = [];

  // Shared embedding service (singleton across all agents)
  private readonly embedder: EmbeddingService = new EmbeddingService();

  constructor(options: SessionManagerOptions) {
    this.adapter = options.adapter;
    this.registryPath = options.registryPath;
    this.backoffConfig = options.backoffConfig ?? DEFAULT_BACKOFF_CONFIG;
    this.log = options.log ?? logger;
  }

  /**
   * Set the skills catalog for system prompt injection.
   * Called by daemon after scanning the skills directory.
   */
  setSkillsCatalog(catalog: SkillsCatalog): void {
    this.skillsCatalog = catalog;
  }

  /**
   * Set all agent configs for admin prompt injection.
   * Called by daemon after resolving agents.
   */
  setAllAgentConfigs(configs: readonly ResolvedAgentConfig[]): void {
    this.allAgentConfigs = configs;
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

    // Initialize memory resources BEFORE building session config (so hot memories are available)
    this.initMemory(name, config);

    // Refresh hot tier before building session config
    const tierManager = this.tierManagers.get(name);
    if (tierManager) {
      tierManager.refreshHotTier();
    }

    // Build session config (includes hot memory injection)
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
   * Send a message to a running agent and collect the response.
   * Used when the caller needs the response text (e.g., for programmatic use).
   *
   * @throws SessionError if the agent is not running
   */
  async sendToAgent(name: string, message: string): Promise<string> {
    const handle = this.sessions.get(name);
    if (!handle) {
      throw new SessionError(`Agent '${name}' is not running`, name);
    }

    this.log.info({ agent: name, messageLength: message.length }, "sending message to agent");
    const response = await handle.sendAndCollect(message);
    this.log.info({ agent: name, responseLength: response.length }, "agent responded");
    return response;
  }

  /**
   * Forward a message to a running agent (fire-and-forget).
   * The agent processes the message and responds via its own tools (e.g., Discord plugin).
   * Used by the Discord bridge for one-way message forwarding.
   *
   * @throws SessionError if the agent is not running
   */
  async forwardToAgent(name: string, message: string): Promise<void> {
    const handle = this.sessions.get(name);
    if (!handle) {
      throw new SessionError(`Agent '${name}' is not running`, name);
    }

    this.log.info({ agent: name, messageLength: message.length }, "forwarding message to agent");
    await handle.send(message);
  }

  /**
   * Fork an agent's session into a new independent session.
   * The fork inherits the parent's config but has no channel bindings.
   *
   * @param agentName - Name of the agent to fork
   * @param options - Optional system prompt and model overrides
   * @returns ForkResult with the fork name and session ID
   * @throws SessionError if the agent is not running or config not found
   */
  async forkSession(
    agentName: string,
    options?: ForkOptions,
  ): Promise<ForkResult> {
    if (!this.sessions.has(agentName)) {
      throw new SessionError(`Agent '${agentName}' is not running`, agentName);
    }

    const parentConfig = this.configs.get(agentName);
    if (!parentConfig) {
      throw new SessionError(`Config for agent '${agentName}' not found`, agentName);
    }

    const forkName = buildForkName(agentName);
    const forkConfig = buildForkConfig(parentConfig, forkName, options);

    await this.startAgent(forkName, forkConfig);

    const handle = this.sessions.get(forkName);
    const sessionId = handle?.sessionId ?? "unknown";

    this.log.info(
      { parent: agentName, fork: forkName, sessionId },
      "session forked",
    );

    return {
      forkName,
      parentAgent: agentName,
      sessionId,
    };
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

    // Clean up memory resources
    this.cleanupMemory(name);

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
  // Memory accessors
  // ---------------------------------------------------------------------------

  /** Get the MemoryStore for a specific agent (for CLI search commands). */
  getMemoryStore(agentName: string): MemoryStore | undefined {
    return this.memoryStores.get(agentName);
  }

  /** Get the CompactionManager for a specific agent. */
  getCompactionManager(agentName: string): CompactionManager | undefined {
    return this.compactionManagers.get(agentName);
  }

  /** Get the CharacterCountFillProvider for a specific agent (used by heartbeat). */
  getContextFillProvider(agentName: string): CharacterCountFillProvider | undefined {
    return this.contextFillProviders.get(agentName);
  }

  /** Get the shared EmbeddingService (for consolidation digest embedding). */
  getEmbedder(): EmbeddingService {
    return this.embedder;
  }

  /** Get the resolved config for a specific agent (for workspace path lookup). */
  getAgentConfig(agentName: string): ResolvedAgentConfig | undefined {
    return this.configs.get(agentName);
  }

  /** Get the SessionLogger for a specific agent (for consolidation log discovery). */
  getSessionLogger(agentName: string): SessionLogger | undefined {
    return this.sessionLoggers.get(agentName);
  }

  /** Get the TierManager for a specific agent (for tier maintenance and cold operations). */
  getTierManager(agentName: string): TierManager | undefined {
    return this.tierManagers.get(agentName);
  }

  /**
   * Pre-warm the embedding model at daemon startup (D-09).
   * Call before starting any agents to avoid cold-start latency.
   */
  async warmupEmbeddings(): Promise<void> {
    await this.embedder.warmup();
    this.log.info("embedding model warmed up");
  }

  // ---------------------------------------------------------------------------
  // Memory lifecycle (private)
  // ---------------------------------------------------------------------------

  /**
   * Initialize memory resources for an agent.
   * Creates MemoryStore, SessionLogger, and CompactionManager.
   */
  private initMemory(name: string, config: ResolvedAgentConfig): void {
    try {
      const memoryDir = join(config.workspace, "memory");
      if (!existsSync(memoryDir)) {
        mkdirSync(memoryDir, { recursive: true });
      }

      const dbPath = join(memoryDir, "memories.db");
      const store = new MemoryStore(dbPath);
      this.memoryStores.set(name, store);

      const sessionLogger = new SessionLogger(memoryDir);
      this.sessionLoggers.set(name, sessionLogger);

      const compactionManager = new CompactionManager({
        memoryStore: store,
        embedder: this.embedder,
        sessionLogger,
        threshold: config.memory.compactionThreshold,
        log: this.log,
      });
      this.compactionManagers.set(name, compactionManager);

      // Create a fill provider for heartbeat monitoring
      const fillProvider = new CharacterCountFillProvider();
      this.contextFillProviders.set(name, fillProvider);

      // Create TierManager for this agent
      const tierConfig = config.memory?.tiers ?? DEFAULT_TIER_CONFIG;
      const tierManager = new TierManager({
        store,
        embedder: this.embedder,
        memoryDir,
        tierConfig,
        scoringConfig: {
          semanticWeight: config.memory?.decay?.semanticWeight ?? 0.7,
          decayWeight: config.memory?.decay?.decayWeight ?? 0.3,
          halfLifeDays: config.memory?.decay?.halfLifeDays ?? 30,
        },
        log: this.log,
      });
      this.tierManagers.set(name, tierManager);

      this.log.info({ agent: name, dbPath }, "memory initialized");
    } catch (error) {
      this.log.error(
        { agent: name, error: (error as Error).message },
        "failed to initialize memory (non-fatal)",
      );
    }
  }

  /**
   * Clean up memory resources for an agent.
   * Closes the MemoryStore and removes from all maps.
   */
  private cleanupMemory(name: string): void {
    const store = this.memoryStores.get(name);
    if (store) {
      try {
        store.close();
      } catch (error) {
        this.log.warn(
          { agent: name, error: (error as Error).message },
          "error closing memory store",
        );
      }
      this.memoryStores.delete(name);
    }
    this.compactionManagers.delete(name);
    this.sessionLoggers.delete(name);
    this.contextFillProviders.delete(name);
    this.tierManagers.delete(name);
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
    contextSummary?: string,
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

    // Append Discord channel binding instructions if channels are configured
    const channels = config.channels ?? [];
    if (channels.length > 0) {
      systemPrompt += "\n\n## Discord Channel Bindings\n";
      systemPrompt += `You are bound to the following Discord channel(s): ${channels.join(", ")}\n`;
      systemPrompt += "ONLY respond to messages from these channels. Ignore messages from any other channel.\n";
      systemPrompt += "When replying, use the reply tool with the chat_id from the incoming message.";
    }

    // Append context summary from compaction restart (D-17)
    if (contextSummary) {
      systemPrompt += `\n\n## Context Summary (from previous session)\n${contextSummary}`;
    }

    // Inject hot memories into system prompt (D-11)
    const agentTierManager = this.tierManagers.get(config.name);
    if (agentTierManager) {
      const hotMemories = agentTierManager.getHotMemories();
      if (hotMemories.length > 0) {
        systemPrompt += "\n\n## Key Memories\n\n";
        systemPrompt += hotMemories.map((mem) => `- ${mem.content}`).join("\n");
      }
    }

    // Inject assigned skill descriptions into system prompt (D-06, D-08)
    const assignedSkills = config.skills ?? [];
    if (assignedSkills.length > 0) {
      const skillDescriptions: string[] = [];
      for (const skillName of assignedSkills) {
        const entry = this.skillsCatalog.get(skillName);
        if (entry) {
          const versionPart = entry.version !== null ? ` (v${entry.version})` : "";
          skillDescriptions.push(`- **${entry.name}**${versionPart}: ${entry.description}`);
        }
      }
      if (skillDescriptions.length > 0) {
        systemPrompt += "\n\n## Available Skills\n\n";
        systemPrompt += skillDescriptions.join("\n");
        systemPrompt += "\n\nYour skill directories are symlinked in your workspace under skills/. Read SKILL.md in each for detailed instructions.\n";
      }
    }

    // Inject admin agent information (per D-11, D-12)
    if (config.admin && this.allAgentConfigs.length > 0) {
      const otherAgents = this.allAgentConfigs.filter(a => a.name !== config.name);
      if (otherAgents.length > 0) {
        systemPrompt += "\n\n## Admin Agent — Managed Agents\n\n";
        systemPrompt += "You are the admin agent. You can read files in any agent's workspace and coordinate cross-agent tasks.\n\n";
        systemPrompt += "| Agent | Workspace | Model |\n";
        systemPrompt += "|-------|-----------|-------|\n";
        for (const agent of otherAgents) {
          systemPrompt += `| ${agent.name} | ${agent.workspace} | ${agent.model} |\n`;
        }
        systemPrompt += "\nTo send a message to another agent, describe what you want to communicate and the system will route it via the messaging system.\n";
      }
    }

    // Inject subagent model guidance (per D-02, D-03)
    if (config.subagentModel) {
      systemPrompt += `\n\n## Subagent Configuration\n\nWhen spawning subagents via the Agent tool, use model: "${config.subagentModel}" unless a specific task requires a different model.\n`;
    }

    return {
      name: config.name,
      model: config.model,
      workspace: config.workspace,
      systemPrompt: systemPrompt.trim(),
      channels,
      contextSummary,
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
