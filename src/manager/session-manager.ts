import { logger } from "../shared/logger.js";
import { SessionError } from "../shared/errors.js";
import type { SessionAdapter, SessionHandle } from "./session-adapter.js";
import type { BackoffConfig } from "./types.js";
import { DEFAULT_BACKOFF_CONFIG } from "./types.js";
import { readRegistry, writeRegistry, updateEntry, createEntry } from "./registry.js";
import type { ResolvedAgentConfig } from "../shared/types.js";
import type { Logger } from "pino";
import type { SkillsCatalog } from "../skills/types.js";
import type { MemoryStore } from "../memory/store.js";
import type { EmbeddingService } from "../memory/embedder.js";
import type { SessionLogger } from "../memory/session-log.js";
import type { CompactionManager, CharacterCountFillProvider } from "../memory/compaction.js";
import type { TierManager } from "../memory/tier-manager.js";
import { buildForkName, buildForkConfig } from "./fork.js";
import type { ForkOptions, ForkResult } from "./fork.js";
import type { UsageTracker } from "../usage/tracker.js";
import { AgentMemoryManager } from "./session-memory.js";
import { SessionRecoveryManager } from "./session-recovery.js";
import { buildSessionConfig } from "./session-config.js";
import { detectBootstrapNeeded } from "../bootstrap/detector.js";

/** Configuration for creating a SessionManager. */
export type SessionManagerOptions = {
  readonly adapter: SessionAdapter;
  readonly registryPath: string;
  readonly backoffConfig?: BackoffConfig;
  readonly log?: Logger;
};

/**
 * Manages agent session lifecycles: start, stop, restart, crash recovery.
 * Composes AgentMemoryManager, SessionRecoveryManager, and buildSessionConfig.
 */
export class SessionManager {
  private readonly adapter: SessionAdapter;
  private readonly registryPath: string;
  private readonly log: Logger;
  private readonly sessions: Map<string, SessionHandle> = new Map();
  private readonly configs: Map<string, ResolvedAgentConfig> = new Map();
  private readonly memory: AgentMemoryManager;
  private readonly recovery: SessionRecoveryManager;
  private readonly sessionEndCallbacks: Map<string, () => Promise<void>> = new Map();
  private skillsCatalog: SkillsCatalog = new Map();
  private allAgentConfigs: readonly ResolvedAgentConfig[] = [];

  constructor(options: SessionManagerOptions) {
    this.adapter = options.adapter;
    this.registryPath = options.registryPath;
    this.log = options.log ?? logger;
    this.memory = new AgentMemoryManager(this.log);
    this.recovery = new SessionRecoveryManager(
      this.registryPath,
      options.backoffConfig ?? DEFAULT_BACKOFF_CONFIG,
      this.log,
      async (name, config) => this.performRestart(name, config),
    );
  }

  // Test helpers (delegate to recovery)
  get _lastCrashPromise(): Promise<void> | null { return this.recovery._lastCrashPromise; }
  set _lastCrashPromise(v: Promise<void> | null) { this.recovery._lastCrashPromise = v; }
  get _lastRestartPromise(): Promise<void> | null { return this.recovery._lastRestartPromise; }
  set _lastRestartPromise(v: Promise<void> | null) { this.recovery._lastRestartPromise = v; }
  get _lastStabilityPromise(): Promise<void> | null { return this.recovery._lastStabilityPromise; }
  set _lastStabilityPromise(v: Promise<void> | null) { this.recovery._lastStabilityPromise = v; }

  setSkillsCatalog(catalog: SkillsCatalog): void { this.skillsCatalog = catalog; }

  setAllAgentConfigs(configs: readonly ResolvedAgentConfig[]): void {
    this.allAgentConfigs = configs;
  }

  /**
   * Register a callback to be invoked when a session ends (stop or crash).
   * Used by daemon to auto-cleanup subagent thread bindings.
   */
  registerSessionEndCallback(sessionName: string, callback: () => Promise<void>): void {
    this.sessionEndCallbacks.set(sessionName, callback);
  }

  /** @throws SessionError if the agent is already running */
  async startAgent(name: string, config: ResolvedAgentConfig): Promise<void> {
    if (this.sessions.has(name)) {
      throw new SessionError(`Agent '${name}' is already running`, name);
    }
    this.configs.set(name, config);

    // Ensure registry entry exists
    let registry = await readRegistry(this.registryPath);
    if (!registry.entries.find((e) => e.name === name)) {
      registry = { entries: [...registry.entries, createEntry(name)], updatedAt: Date.now() };
    }
    registry = updateEntry(registry, name, { status: "starting" });
    await writeRegistry(this.registryPath, registry);

    // Initialize memory and refresh hot tier
    this.memory.initMemory(name, config);
    const tierManager = this.memory.tierManagers.get(name);
    if (tierManager) tierManager.refreshHotTier();

    const bootstrapStatus = await detectBootstrapNeeded(config);
    this.log.info({ agent: name, bootstrapStatus }, "bootstrap check");

    const sessionConfig = await buildSessionConfig(config, this.configDeps(), undefined, bootstrapStatus);

    // Build usage callback
    const usageTracker = this.memory.usageTrackers.get(name);
    const sessionIdRef = { current: "" };
    const usageCallback = usageTracker
      ? (data: { tokens_in: number; tokens_out: number; cost_usd: number; turns: number; model: string; duration_ms: number }) => {
          try {
            usageTracker.record({ agent: name, timestamp: new Date().toISOString(), session_id: sessionIdRef.current, ...data });
          } catch { /* non-fatal */ }
        }
      : undefined;

    const handle = await this.adapter.createSession(sessionConfig, usageCallback);
    sessionIdRef.current = handle.sessionId;
    this.sessions.set(name, handle);

    handle.onError((error: Error) => {
      this.recovery.handleCrash(name, config, error, this.sessions);
      // Invoke session end callback on crash (e.g., subagent thread cleanup)
      const endCallback = this.sessionEndCallbacks.get(name);
      if (endCallback) {
        this.sessionEndCallbacks.delete(name);
        endCallback().catch((err) => {
          this.log.warn({ agent: name, error: (err as Error).message }, "session end callback failed on crash");
        });
      }
    });
    this.recovery.setStabilityTimer(name);

    registry = await readRegistry(this.registryPath);
    registry = updateEntry(registry, name, { status: "running", sessionId: handle.sessionId, startedAt: Date.now() });
    await writeRegistry(this.registryPath, registry);
    this.log.info({ agent: name, sessionId: handle.sessionId }, "agent started");
  }

  /** @throws SessionError if the agent is not running */
  async sendToAgent(name: string, message: string): Promise<string> {
    const handle = this.requireSession(name);
    this.log.info({ agent: name, messageLength: message.length }, "sending message to agent");
    const response = await handle.sendAndCollect(message);
    this.log.info({ agent: name, responseLength: response.length }, "agent responded");
    return response;
  }

  /** @throws SessionError if the agent is not running */
  async streamFromAgent(name: string, message: string, onChunk: (accumulated: string) => void): Promise<string> {
    const handle = this.requireSession(name);
    this.log.info({ agent: name, messageLength: message.length }, "streaming message to agent");
    const response = await handle.sendAndStream(message, onChunk);
    this.log.info({ agent: name, responseLength: response.length }, "agent stream complete");
    return response;
  }

  /** @throws SessionError if the agent is not running */
  async forwardToAgent(name: string, message: string): Promise<void> {
    const handle = this.requireSession(name);
    this.log.info({ agent: name, messageLength: message.length }, "forwarding message to agent");
    await handle.send(message);
  }

  async forkSession(agentName: string, options?: ForkOptions): Promise<ForkResult> {
    if (!this.sessions.has(agentName)) {
      throw new SessionError(`Agent '${agentName}' is not running`, agentName);
    }
    const parentConfig = this.configs.get(agentName);
    if (!parentConfig) {
      throw new SessionError(`Config for agent '${agentName}' not found`, agentName);
    }
    const forkName = buildForkName(agentName);
    await this.startAgent(forkName, buildForkConfig(parentConfig, forkName, options));
    const sessionId = this.sessions.get(forkName)?.sessionId ?? "unknown";
    this.log.info({ parent: agentName, fork: forkName, sessionId }, "session forked");
    return { forkName, parentAgent: agentName, sessionId };
  }

  /** @throws SessionError if the agent is not running */
  async stopAgent(name: string): Promise<void> {
    const handle = this.requireSession(name);
    this.recovery.clearStabilityTimer(name);
    this.recovery.clearRestartTimer(name);
    this.memory.cleanupMemory(name);

    let registry = await readRegistry(this.registryPath);
    registry = updateEntry(registry, name, { status: "stopping" });
    await writeRegistry(this.registryPath, registry);

    await handle.close();
    this.sessions.delete(name);

    registry = await readRegistry(this.registryPath);
    registry = updateEntry(registry, name, { status: "stopped", sessionId: null });
    await writeRegistry(this.registryPath, registry);

    // Invoke session end callback (e.g., subagent thread cleanup)
    const endCallback = this.sessionEndCallbacks.get(name);
    if (endCallback) {
      this.sessionEndCallbacks.delete(name);
      try {
        await endCallback();
      } catch (err) {
        this.log.warn({ agent: name, error: (err as Error).message }, "session end callback failed");
      }
    }

    this.log.info({ agent: name }, "agent stopped");
  }

  async restartAgent(name: string, config: ResolvedAgentConfig): Promise<void> {
    await this.stopAgent(name);
    let registry = await readRegistry(this.registryPath);
    const entry = registry.entries.find((e) => e.name === name);
    registry = updateEntry(registry, name, { restartCount: (entry?.restartCount ?? 0) + 1 });
    await writeRegistry(this.registryPath, registry);
    await this.startAgent(name, config);
  }

  async startAll(configs: readonly ResolvedAgentConfig[]): Promise<void> {
    const errors: Array<{ name: string; error: Error }> = [];
    for (const config of configs) {
      try { await this.startAgent(config.name, config); }
      catch (error) {
        errors.push({ name: config.name, error: error as Error });
        this.log.error({ agent: config.name, error: (error as Error).message }, "failed to start agent");
      }
    }
    if (errors.length > 0) {
      this.log.warn({ failed: errors.length, total: configs.length }, "some agents failed to start");
    }
  }

  async stopAll(): Promise<void> {
    const names = [...this.sessions.keys()];
    const errors: Array<{ name: string; error: Error }> = [];
    for (const name of names) {
      try { await this.stopAgent(name); }
      catch (error) { errors.push({ name, error: error as Error }); }
    }
    if (errors.length > 0) {
      this.log.warn({ failed: errors.length, total: names.length }, "some agents failed to stop");
    }
    this.log.info({ stopped: names.length }, "all agents stopped");
  }

  async reconcileRegistry(configs: readonly ResolvedAgentConfig[]): Promise<void> {
    let registry = await readRegistry(this.registryPath);
    let resumed = 0, crashed = 0, failed = 0;

    for (const entry of registry.entries) {
      const config = configs.find((c) => c.name === entry.name);

      if (entry.status === "running" && entry.sessionId && config) {
        try {
          const sessionConfig = await buildSessionConfig(config, this.configDeps());
          const handle = await this.adapter.resumeSession(entry.sessionId, sessionConfig);
          this.sessions.set(entry.name, handle);
          this.configs.set(entry.name, config);
          handle.onError((error: Error) => {
            this.recovery.handleCrash(entry.name, config, error, this.sessions);
          });
          this.recovery.setStabilityTimer(entry.name);
          resumed++;
          this.log.info({ agent: entry.name, sessionId: entry.sessionId }, "session resumed");
        } catch (error) {
          registry = await readRegistry(this.registryPath);
          registry = updateEntry(registry, entry.name, {
            status: "crashed", lastError: (error as Error).message,
            consecutiveFailures: entry.consecutiveFailures + 1,
          });
          await writeRegistry(this.registryPath, registry);
          this.configs.set(entry.name, config);
          this.recovery.scheduleRestart(entry.name, config, entry.consecutiveFailures + 1);
          crashed++;
          this.log.warn({ agent: entry.name, error: (error as Error).message }, "failed to resume session, marking crashed");
        }
      } else if ((entry.status === "crashed" || entry.status === "restarting") && config) {
        this.configs.set(entry.name, config);
        this.recovery.scheduleRestart(entry.name, config, entry.consecutiveFailures);
        crashed++;
      } else if (entry.status === "failed") {
        failed++;
      }
    }
    this.log.info({ total: registry.entries.length, resumed, crashed, failed }, "registry reconciliation complete");
  }

  getRunningAgents(): readonly string[] { return [...this.sessions.keys()]; }

  // Memory accessors (delegate to AgentMemoryManager)
  getMemoryStore(agentName: string): MemoryStore | undefined { return this.memory.memoryStores.get(agentName); }
  getCompactionManager(agentName: string): CompactionManager | undefined { return this.memory.compactionManagers.get(agentName); }
  getContextFillProvider(agentName: string): CharacterCountFillProvider | undefined { return this.memory.contextFillProviders.get(agentName); }
  getEmbedder(): EmbeddingService { return this.memory.embedder; }
  getAgentConfig(agentName: string): ResolvedAgentConfig | undefined { return this.configs.get(agentName); }
  getSessionLogger(agentName: string): SessionLogger | undefined { return this.memory.sessionLoggers.get(agentName); }
  getTierManager(agentName: string): TierManager | undefined { return this.memory.tierManagers.get(agentName); }
  getUsageTracker(agentName: string): UsageTracker | undefined { return this.memory.usageTrackers.get(agentName); }
  getEpisodeStore(agentName: string) { return this.memory.episodeStores.get(agentName); }

  async saveContextSummary(agentName: string, summary: string): Promise<void> {
    const config = this.configs.get(agentName);
    if (!config) {
      this.log.warn({ agent: agentName }, "cannot save context summary: config not found");
      return;
    }
    await this.memory.saveContextSummary(agentName, config.workspace, summary);
  }

  async warmupEmbeddings(): Promise<void> { await this.memory.warmupEmbeddings(); }

  // Private helpers
  private requireSession(name: string): SessionHandle {
    const handle = this.sessions.get(name);
    if (!handle) throw new SessionError(`Agent '${name}' is not running`, name);
    return handle;
  }

  private configDeps() {
    return { tierManagers: this.memory.tierManagers, skillsCatalog: this.skillsCatalog, allAgentConfigs: this.allAgentConfigs };
  }

  private async performRestart(name: string, config: ResolvedAgentConfig): Promise<void> {
    try {
      let registry = await readRegistry(this.registryPath);
      registry = updateEntry(registry, name, { status: "restarting" });
      await writeRegistry(this.registryPath, registry);
      await this.startAgent(name, config);
    } catch (error) {
      this.log.error({ agent: name, error: (error as Error).message }, "restart attempt failed");
    }
  }
}
