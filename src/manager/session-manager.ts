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
import type { DocumentStore } from "../documents/store.js";
import type { TraceStore } from "../performance/trace-store.js";
import type { TraceCollector, Turn } from "../performance/trace-collector.js";
import type { ConversationStore } from "../memory/conversation-store.js";
import { AgentMemoryManager } from "./session-memory.js";
import { SessionRecoveryManager } from "./session-recovery.js";
import { buildSessionConfig } from "./session-config.js";
import { detectBootstrapNeeded } from "../bootstrap/detector.js";
import { computePrefixHash } from "./context-assembler.js";
import { SkillUsageTracker } from "../usage/skill-usage-tracker.js";
import type { SkillTrackingConfig } from "./session-adapter.js";
import { runWarmPathCheck, WARM_PATH_TIMEOUT_MS } from "./warm-path-check.js";

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
  /** Phase 65 -- tracks the active ConversationStore session ID per agent. */
  private readonly activeConversationSessionIds: Map<string, string> = new Map();
  private skillsCatalog: SkillsCatalog = new Map();
  private allAgentConfigs: readonly ResolvedAgentConfig[] = [];
  /**
   * Phase 52 Plan 02 — per-agent prefixHash across turns.
   *
   * Keyed by agent name; value is the sha256 of the stable prefix assembled
   * for that agent's most recent turn. Updated from inside the adapter's
   * `prefixHashProvider.persist()` hook. Enables CACHE-04 eviction detection.
   */
  private readonly lastPrefixHashByAgent: Map<string, string> = new Map();
  /**
   * Phase 52 Plan 02 — per-agent hot-tier stable token across turns.
   *
   * Used by `buildSessionConfig` / `assembleContext` to decide hot-tier
   * placement (stable prefix vs mutable suffix) so a single hot-tier
   * mutation doesn't thrash the cache.
   */
  private readonly lastHotStableTokenByAgent: Map<string, string> = new Map();
  /**
   * Phase 52 Plan 02 — per-agent latest stablePrefix string.
   *
   * Stored at `buildSessionConfig` time (session start + hot-reload) so the
   * per-turn `prefixHashProvider` can compute `sha256(latest)` on every
   * iteration. Skills hot-reload updates this via `refreshStablePrefix`
   * which triggers a fresh `buildSessionConfig` run.
   */
  private readonly latestStablePrefixByAgent: Map<string, string> = new Map();

  /**
   * Phase 53 Plan 03 — shared in-memory skill-usage tracker across all
   * agents. Per-agent isolation happens INSIDE the tracker (keyed by
   * agent name). Capacity 20 matches Plan 53-01's default
   * `lazySkills.usageThresholdTurns` — operators can tune per-agent
   * thresholds downstream at the assembler; the tracker retains up to
   * 20 turns regardless.
   */
  private readonly skillUsageTracker: SkillUsageTracker = new SkillUsageTracker({
    capacity: 20,
  });

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

  /**
   * Phase 53 Plan 03 — shared SkillUsageTracker. Exposed for buildSessionConfig
   * (so the assembler can read the per-turn usage window) and for tests.
   */
  getSkillUsageTracker(): SkillUsageTracker {
    return this.skillUsageTracker;
  }

  /**
   * Build a SkillTrackingConfig for `agent`, pulling the skill catalog names
   * from the agent's config. Returns undefined when the agent has no skills
   * (nothing to track).
   */
  private makeSkillTracking(
    config: ResolvedAgentConfig,
  ): SkillTrackingConfig | undefined {
    const skills = config.skills ?? [];
    if (skills.length === 0) return undefined;
    return {
      skillUsageTracker: this.skillUsageTracker,
      agentName: config.name,
      skillCatalogNames: [...skills],
    };
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
   * Phase 52 Plan 02 — read the most recent prefixHash for `agent` (or
   * undefined on a fresh session). Used by tests + the per-turn provider
   * closure.
   */
  getLastPrefixHash(agent: string): string | undefined {
    return this.lastPrefixHashByAgent.get(agent);
  }

  /**
   * Phase 52 Plan 02 — record the latest prefixHash for `agent`.
   * Called by the provider closure's `persist` hook AFTER recordCacheUsage
   * so the NEXT turn's comparison has a fresh baseline.
   */
  setLastPrefixHash(agent: string, hash: string): void {
    this.lastPrefixHashByAgent.set(agent, hash);
  }

  /**
   * Phase 52 Plan 02 — build a PrefixHashProvider closure for `agent`.
   *
   * On every turn, returns `{ current: sha256(latestStablePrefix), last }`
   * where `latestStablePrefix` is the most recent stablePrefix rebuilt via
   * buildSessionConfig (refreshed on skills hot-reload). `persist` updates
   * the per-agent Map so the next turn can compare.
   *
   * Returns undefined when the agent has no cached stablePrefix — the
   * adapter treats this as "no prefix drift signal" and records the
   * cache telemetry snapshot without the prefix fields.
   */
  private makePrefixHashProvider(agent: string) {
    return {
      get: () => {
        const prefix = this.latestStablePrefixByAgent.get(agent) ?? "";
        return {
          current: prefix.length > 0 ? computePrefixHash(prefix) : "",
          last: this.lastPrefixHashByAgent.get(agent),
        };
      },
      persist: (hash: string) => {
        this.lastPrefixHashByAgent.set(agent, hash);
      },
    };
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

    // Initialize memory, store SOUL.md as retrievable memory, and refresh hot tier
    this.memory.initMemory(name, config);

    // Phase 65: start a ConversationStore session alongside the agent session
    const convStore = this.memory.conversationStores.get(name);
    if (convStore) {
      try {
        const convSession = convStore.startSession(name);
        this.activeConversationSessionIds.set(name, convSession.id);
      } catch (err) {
        this.log.warn({ agent: name, error: (err as Error).message }, "failed to start conversation session (non-fatal)");
      }
    }

    await this.memory.storeSoulMemory(name, config);
    const tierManager = this.memory.tierManagers.get(name);
    if (tierManager) tierManager.refreshHotTier();

    const bootstrapStatus = await detectBootstrapNeeded(config);
    this.log.info({ agent: name, bootstrapStatus }, "bootstrap check");

    // Phase 52 Plan 02 — thread priorHotStableToken for hot-tier placement.
    const sessionConfig = await buildSessionConfig(
      config,
      this.configDeps(name),
      undefined,
      bootstrapStatus,
    );

    // Phase 52 Plan 02 — cache latest stablePrefix + hotStableToken for the
    // per-turn prefixHashProvider + next buildSessionConfig respectively.
    this.latestStablePrefixByAgent.set(name, sessionConfig.systemPrompt);
    if (sessionConfig.hotStableToken) {
      this.lastHotStableTokenByAgent.set(name, sessionConfig.hotStableToken);
    }

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

    // Phase 52 Plan 02 — attach per-turn prefixHash provider so the adapter
    // can record cache_eviction_expected against the in-flight stablePrefix.
    // Phase 53 Plan 03 — attach skill-mention tracking so `iterateWithTracing`
    // records which skills appear in each turn's assistant text.
    const handle = await this.adapter.createSession(
      sessionConfig,
      usageCallback,
      this.makePrefixHashProvider(name),
      this.makeSkillTracking(config),
    );
    sessionIdRef.current = handle.sessionId;
    this.sessions.set(name, handle);

    handle.onError((error: Error) => {
      // Phase 65: crash the ConversationStore session
      const convSessionId = this.activeConversationSessionIds.get(name);
      const convStoreForCrash = this.memory.conversationStores.get(name);
      if (convStoreForCrash && convSessionId) {
        try { convStoreForCrash.crashSession(convSessionId); } catch { /* best-effort */ }
      }
      this.activeConversationSessionIds.delete(name);

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

    // Phase 56 Plan 02 — warm-path ready gate. Registry stays in 'starting'
    // while we warm SQLite + verify embedder + probe session plumbing. On
    // failure or timeout (10s), mark the agent 'failed' with a structured
    // error — daemon keeps running other agents. On success, a single atomic
    // registry write flips status -> 'running' AND records warm_path_ready +
    // warm_path_readiness_ms in the same transaction.
    const warmResult = await runWarmPathCheck({
      agent: name,
      sqliteWarm: (agentName) => this.memory.warmSqliteStores(agentName),
      embedder: this.memory.embedder,
      sessionProbe: async () => {
        // Session plumbing verified by the handle existing + sessionId
        // populated. If the handle is missing or empty, throw to record a
        // session-scoped warm-path error.
        if (!handle || !handle.sessionId) {
          throw new Error("session handle not ready");
        }
      },
      timeoutMs: WARM_PATH_TIMEOUT_MS,
    });

    registry = await readRegistry(this.registryPath);

    if (!warmResult.ready) {
      const errMsg = `warm-path: ${warmResult.errors.join("; ")}`;
      registry = updateEntry(registry, name, {
        status: "failed",
        lastError: errMsg,
        warm_path_ready: false,
        warm_path_readiness_ms: warmResult.total_ms,
      });
      await writeRegistry(this.registryPath, registry);
      this.log.error(
        {
          agent: name,
          errors: warmResult.errors,
          total_ms: warmResult.total_ms,
          durations_ms: warmResult.durations_ms,
        },
        "warm-path check failed — agent marked failed",
      );
      // Clean up the session we just created since the agent never came
      // ready. Close swallows any error from the mock/SDK handle.
      this.sessions.delete(name);
      this.recovery.clearStabilityTimer(name);
      try {
        await handle.close();
      } catch {
        /* handle may already be closed */
      }
      return;
    }

    registry = updateEntry(registry, name, {
      status: "running",
      sessionId: handle.sessionId,
      startedAt: Date.now(),
      warm_path_ready: true,
      warm_path_readiness_ms: warmResult.total_ms,
    });
    await writeRegistry(this.registryPath, registry);
    this.log.info(
      {
        agent: name,
        sessionId: handle.sessionId,
        total_ms: warmResult.total_ms,
        durations_ms: warmResult.durations_ms,
      },
      "warm-path ready — agent started",
    );
  }

  /**
   * @throws SessionError if the agent is not running
   *
   * Accepts an OPTIONAL pre-constructed Turn (caller-owned lifecycle, Phase 50).
   * The caller (DiscordBridge / Scheduler) constructs the Turn via
   * `getTraceCollector(name).startTurn(...)` and owns `turn.end()`. SessionManager
   * is pure passthrough — it does NOT create or end Turn objects.
   */
  async sendToAgent(
    name: string,
    message: string,
    turn?: Turn,
    options?: { readonly signal?: AbortSignal },  // Phase 59
  ): Promise<string> {
    const handle = this.requireSession(name);
    this.log.info({ agent: name, messageLength: message.length }, "sending message to agent");
    const response = await handle.sendAndCollect(message, turn, options);
    this.log.info({ agent: name, responseLength: response.length }, "agent responded");
    return response;
    // NOTE: SessionManager does NOT call turn.end() — caller owns Turn lifecycle (50-02b).
    // If the handle throws, the exception propagates and the caller's try/catch ends the turn with 'error'.
  }

  /**
   * @throws SessionError if the agent is not running
   *
   * Accepts an OPTIONAL pre-constructed Turn (caller-owned lifecycle, Phase 50).
   * See sendToAgent docstring for the lifecycle contract.
   */
  async streamFromAgent(
    name: string,
    message: string,
    onChunk: (accumulated: string) => void,
    turn?: Turn,
    options?: { readonly signal?: AbortSignal },  // Phase 59
  ): Promise<string> {
    const handle = this.requireSession(name);
    this.log.info({ agent: name, messageLength: message.length }, "streaming message to agent");
    const response = await handle.sendAndStream(message, onChunk, turn, options);
    this.log.info({ agent: name, responseLength: response.length }, "agent stream complete");
    return response;
    // NOTE: SessionManager does NOT call turn.end() — caller owns Turn lifecycle (50-02b).
  }

  /** Set the reasoning effort level for a running agent. Takes effect on next turn. */
  setEffortForAgent(name: string, level: "low" | "medium" | "high" | "max"): void {
    const handle = this.requireSession(name);
    handle.setEffort(level);
    this.log.info({ agent: name, effort: level }, "effort level updated");
  }

  /** Get the current reasoning effort level for a running agent. */
  getEffortForAgent(name: string): "low" | "medium" | "high" | "max" {
    const handle = this.requireSession(name);
    return handle.getEffort();
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

    // Phase 65: end the ConversationStore session before memory cleanup
    const convSessionId = this.activeConversationSessionIds.get(name);
    const convStoreForStop = this.memory.conversationStores.get(name);
    if (convStoreForStop && convSessionId) {
      try { convStoreForStop.endSession(convSessionId); } catch { /* session may already be ended */ }
    }
    this.activeConversationSessionIds.delete(name);

    this.memory.cleanupMemory(name);

    let registry = await readRegistry(this.registryPath);
    registry = updateEntry(registry, name, { status: "stopping" });
    await writeRegistry(this.registryPath, registry);

    await handle.close();
    this.sessions.delete(name);
    // Phase 52 Plan 02 — drop per-agent cache-prefix state so a fresh start
    // records cacheEvictionExpected=false on turn 1 (no prior hash).
    this.lastPrefixHashByAgent.delete(name);
    this.lastHotStableTokenByAgent.delete(name);
    this.latestStablePrefixByAgent.delete(name);
    // Phase 53 Plan 03 — clear per-agent skill-usage buffer so a restart
    // warms up cleanly (no stale mentions from prior session).
    this.skillUsageTracker.resetAgent(name);

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
          const sessionConfig = await buildSessionConfig(
            config,
            this.configDeps(entry.name),
          );
          // Phase 52 Plan 02 — cache latest stable bits for provider + next call.
          this.latestStablePrefixByAgent.set(
            entry.name,
            sessionConfig.systemPrompt,
          );
          if (sessionConfig.hotStableToken) {
            this.lastHotStableTokenByAgent.set(
              entry.name,
              sessionConfig.hotStableToken,
            );
          }
          const handle = await this.adapter.resumeSession(
            entry.sessionId,
            sessionConfig,
            undefined,
            this.makePrefixHashProvider(entry.name),
            this.makeSkillTracking(config),
          );
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
  getDocumentStore(agentName: string): DocumentStore | undefined { return this.memory.documentStores.get(agentName); }
  /** Phase 50 — per-agent trace store for latency instrumentation (retention reads via heartbeat). */
  getTraceStore(agentName: string): TraceStore | undefined { return this.memory.traceStores.get(agentName); }
  /** Phase 50 — per-agent trace collector; callers construct Turn via `.startTurn(...)` and own lifecycle. */
  getTraceCollector(agentName: string): TraceCollector | undefined { return this.memory.traceCollectors.get(agentName); }

  /** Phase 65 -- per-agent ConversationStore for turn persistence. */
  getConversationStore(agentName: string): ConversationStore | undefined {
    return this.memory.conversationStores.get(agentName);
  }

  /** Phase 65 -- active conversation session ID for an agent (undefined if no active session). */
  getActiveConversationSessionId(agentName: string): string | undefined {
    return this.activeConversationSessionIds.get(agentName);
  }

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

  /**
   * Phase 52 Plan 02 — optionally thread the per-agent `priorHotStableToken`
   * so hot-tier placement is consistent across builds. Callers without an
   * agent name (historically: none remain after this plan) get undefined
   * and hot-tier enters the stable prefix by default (first-turn path).
   */
  private configDeps(agentName?: string) {
    const priorHotStableToken =
      agentName !== undefined
        ? this.lastHotStableTokenByAgent.get(agentName)
        : undefined;
    return {
      tierManagers: this.memory.tierManagers,
      skillsCatalog: this.skillsCatalog,
      allAgentConfigs: this.allAgentConfigs,
      priorHotStableToken,
      // Phase 53 Plan 02 — thread SessionManager's pino logger into the
      // assembler so per-section budget-exceeded events + resume-summary
      // hard-truncation events surface in structured logs.
      log: this.log,
      // Phase 53 Plan 03 — thread the shared SkillUsageTracker so the
      // assembler can read the per-agent usage window.
      skillUsageTracker: this.skillUsageTracker,
    };
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
