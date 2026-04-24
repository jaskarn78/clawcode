import { logger } from "../shared/logger.js";
import { SessionError } from "../shared/errors.js";
import type { SessionAdapter, SessionHandle } from "./session-adapter.js";
import type { BackoffConfig } from "./types.js";
import { DEFAULT_BACKOFF_CONFIG } from "./types.js";
import { readRegistry, writeRegistry, updateEntry, createEntry } from "./registry.js";
import type { ResolvedAgentConfig } from "../shared/types.js";
import type { EffortLevel } from "../config/schema.js";
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
import { summarizeSession, flushSessionMidway } from "../memory/session-summarizer.js";
import type { SummarizeFn } from "../memory/session-summarizer.types.js";
import { summarizeWithHaiku } from "./summarize-with-haiku.js";
import { AgentMemoryManager } from "./session-memory.js";
import { SessionRecoveryManager } from "./session-recovery.js";
import { buildSessionConfig } from "./session-config.js";
import { detectBootstrapNeeded } from "../bootstrap/detector.js";
import { computePrefixHash } from "./context-assembler.js";
import { SkillUsageTracker } from "../usage/skill-usage-tracker.js";
import type { SkillTrackingConfig } from "./session-adapter.js";
import { runWarmPathCheck, WARM_PATH_TIMEOUT_MS } from "./warm-path-check.js";
import {
  performMcpReadinessHandshake,
  type McpReadinessReport,
  type McpServerState,
} from "../mcp/readiness.js";
import { ConversationBriefCache } from "./conversation-brief-cache.js";
import {
  readEffortState,
  writeEffortState,
  DEFAULT_EFFORT_STATE_PATH,
} from "./effort-state-store.js";
import { resolveModelId } from "./model-resolver.js";
import { ModelNotAllowedError } from "./model-errors.js";
import type { PermissionMode } from "./sdk-types.js";
import type { WebhookManager } from "../discord/webhook-manager.js";
import { sendRestartGreeting, classifyRestart } from "./restart-greeting.js";
import type { MemoryScanner } from "../memory/memory-scanner.js";
import {
  retrieveMemoryChunks,
  type MemoryRetrievalResult,
} from "../memory/memory-retrieval.js";
import { MemoryFlushTimer } from "../memory/memory-flush.js";

/** Configuration for creating a SessionManager. */
export type SessionManagerOptions = {
  readonly adapter: SessionAdapter;
  readonly registryPath: string;
  readonly backoffConfig?: BackoffConfig;
  readonly log?: Logger;
  /**
   * Phase 66 -- test-only override for the Haiku summarize function.
   * Production leaves this undefined; the constructor defaults to
   * summarizeWithHaiku so integration tests can inject a mock.
   */
  readonly summarizeFn?: SummarizeFn;
  /**
   * Gap 3 (memory-persistence-gaps) -- test-only override that bypasses the
   * minutes→ms conversion for the periodic mid-session flush timer. When set
   * to a positive number, the flush timer fires every `flushIntervalMsOverride`
   * milliseconds regardless of the per-agent config value. Used to keep the
   * Gap 3 integration tests fast (real-timer-based). Production leaves this
   * undefined so the agent-level knob controls the interval.
   */
  readonly flushIntervalMsOverride?: number;
  /**
   * Phase 83 Plan 02 EFFORT-03 — path to the per-agent runtime effort-state
   * JSON store. Defaults to `~/.clawcode/manager/effort-state.json`. Tests
   * inject a tmpdir-rooted path for isolation.
   */
  readonly effortStatePath?: string;
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

  /** Phase 73 Plan 02 — per-agent conversation-brief cache (LAT-02). */
  private readonly briefCache = new ConversationBriefCache();
  /**
   * Phase 66 -- production SummarizeFn (summarizeWithHaiku) with a test-only
   * injection hook. Passed into summarizeSession at session-boundary events.
   */
  private readonly summarizeFn: SummarizeFn;

  /**
   * Gap 3 (memory-persistence-gaps) -- test-only override for the flush
   * interval in milliseconds. When set, bypasses the per-agent
   * `flushIntervalMinutes` config so tests can exercise the timer path with
   * real timers in ~100ms instead of ~15min.
   */
  private readonly flushIntervalMsOverride: number | undefined;

  /**
   * Phase 83 Plan 02 EFFORT-03 — resolved path to the effort-state JSON
   * store. Set once at construction; all persistence / re-apply paths
   * reference this field so test-time paths and production defaults never
   * diverge.
   */
  private readonly effortStatePath: string;

  /**
   * 260419-q2z Fix B — in-flight session summaries awaited by {@link drain}
   * at daemon shutdown. Each call to `summarizeSessionIfPossible` is wrapped
   * in {@link trackSummary} so SIGTERM never truncates an unfinished summary.
   */
  private readonly pendingSummaries: Set<Promise<void>> = new Set();

  /**
   * Gap 3 (memory-persistence-gaps) — per-agent periodic flush timers. Each
   * timer fires a non-terminating `flushSessionMidway` call so the current
   * conversation is checkpointed to the memory DB at the configured interval,
   * protecting against data loss on unclean shutdowns (SIGKILL, OOM, power).
   * Cleared on stopAgent + crash + drain.
   */
  private readonly flushTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Gap 3 (memory-persistence-gaps) — per-agent flush sequence counter.
   * Encoded into the memory row's `flush:N` tag so operators can trace the
   * evolution of a long session. Resets on agent stop.
   */
  private readonly flushSequenceByAgent: Map<string, number> = new Map();

  /**
   * Phase 85 Plan 01 TOOL-01 — per-agent MCP state map.
   *
   * Populated at `startAgent` by the MCP readiness probe; mutated by the
   * `mcp-reconnect` heartbeat check as servers flap/recover. Drained on
   * `stopAgent` so a restart starts clean.
   *
   * Read by `/clawcode-tools` (via IPC `list-mcp-status`) and by the
   * two-block prompt-builder in Plan 02 to expose live tool health in
   * the system prompt (TOOL-02/TOOL-05).
   */
  private readonly mcpStateByAgent: Map<
    string,
    Map<string, McpServerState>
  > = new Map();

  /**
   * Phase 89 GREET-08 / D-14 — per-agent last-greeting-at timestamp (ms epoch).
   * Cool-down Map: if an entry exists and (now - entry) < agent.greetCoolDownMs,
   * the greeting is suppressed inside sendRestartGreeting. Reset on daemon boot
   * (in-memory only — matches CONTEXT.md §Claude's Discretion). Cleared
   * per-agent on stopAgent so an operator stop + restart does NOT see the
   * cool-down window (operator-initiated restart is a clean restart by intent).
   */
  private readonly greetCoolDownByAgent: Map<string, number> = new Map();

  /**
   * Phase 89 GREET-01 / D-08 — optional WebhookManager reference, wired in
   * from daemon.ts via setWebhookManager() AFTER the daemon constructs the
   * WebhookManager (which happens after SessionManager construction in boot
   * order). When undefined, the greeting helper is simply not invoked —
   * graceful degradation. Matches the setSkillsCatalog DI pattern at line 254.
   */
  private webhookManager: WebhookManager | undefined = undefined;

  /**
   * Phase 90.1 hotfix — bot-direct fallback sender for Phase 89 restart
   * greetings when per-agent webhooks are missing (e.g., bot lacks
   * MANAGE_WEBHOOKS permission in the target channel, or the auto-provisioner
   * hasn't run). Wired from daemon.ts via setBotDirectSender() AFTER the
   * DiscordBridge starts. When undefined, behavior matches Phase 89 original:
   * greeting is skipped with `skipped-no-webhook` outcome.
   */
  private botDirectSender: import("./restart-greeting.js").BotDirectSender | undefined = undefined;

  /**
   * Phase 90 MEM-02 — per-agent MemoryScanner references, wired in from
   * daemon.ts via setMemoryScanner(name, scanner) AFTER daemon boot
   * constructs the scanner for each agent (mirrors the
   * setWebhookManager DI pattern). When an agent has no scanner (opt-out
   * via memoryScannerEnabled=false), retrieval still works against the
   * existing memory_chunks rows — the scanner is only responsible for
   * keeping them up-to-date. Scanners are stop()'d on agent stop.
   */
  private readonly memoryScanners: Map<string, MemoryScanner> = new Map();

  /**
   * Phase 90 MEM-04 — per-agent MemoryFlushTimer map. NOT to be confused
   * with `flushTimers` above (Gap 3 memory-persistence-gaps: mid-session
   * DB summarization via flushSessionMidway). The MEM-04 timer fires a
   * Haiku-summarized DISK flush to memory/YYYY-MM-DD-HHMM.md every 15 min
   * (configurable), surviving SIGKILL-class shutdowns. Distinct concerns;
   * distinct map.
   *
   * Created in startAgent AFTER warm-path success; stopped + final-flushed
   * (with 10s cap, D-29) in stopAgent BEFORE handle.close.
   */
  private readonly memoryFileFlushTimers: Map<string, MemoryFlushTimer> = new Map();

  /**
   * 260419-q2z Fix B — set to `true` by {@link drain}; causes
   * `streamFromAgent` / `sendToAgent` to reject new work with
   * `SessionError('shutting down ...')`. `stopAgent` / `reconcileRegistry`
   * continue to function so the daemon can still clean up cleanly.
   */
  private draining: boolean = false;

  constructor(options: SessionManagerOptions) {
    this.adapter = options.adapter;
    this.registryPath = options.registryPath;
    this.log = options.log ?? logger;
    this.summarizeFn = options.summarizeFn ?? summarizeWithHaiku;
    this.flushIntervalMsOverride = options.flushIntervalMsOverride;
    // Phase 83 Plan 02 EFFORT-03 — persist path resolves via DI or default.
    this.effortStatePath = options.effortStatePath ?? DEFAULT_EFFORT_STATE_PATH;
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

  /**
   * Phase 89 GREET-01 — inject the WebhookManager reference after both this
   * SessionManager and the WebhookManager are constructed (daemon boot order
   * has SessionManager first at ~line 1014, WebhookManager at ~1823/1834/1839).
   * Called exactly once by the daemon. When left unset, restartAgent's
   * greeting side-effect is a no-op (graceful degradation).
   */
  setWebhookManager(wm: WebhookManager): void {
    this.webhookManager = wm;
  }

  /**
   * Phase 90.1 hotfix — inject the bot-direct fallback sender. Called once by
   * daemon.ts AFTER the DiscordBridge starts. Greeting helper will use this
   * when the per-agent webhook is missing. Idempotent.
   */
  setBotDirectSender(sender: import("./restart-greeting.js").BotDirectSender): void {
    this.botDirectSender = sender;
  }

  /**
   * Phase 90 MEM-02 — inject a per-agent MemoryScanner reference. Called
   * exactly once per agent by daemon.ts during boot after the scanner is
   * constructed. Mirrors the setWebhookManager post-construction DI
   * pattern; keeps the SessionManager constructor signature stable.
   *
   * Idempotent — re-calling with the same name replaces the previous
   * scanner (daemon config reload path). The caller is responsible for
   * stopping the prior scanner before re-injecting.
   */
  setMemoryScanner(agentName: string, scanner: MemoryScanner): void {
    this.memoryScanners.set(agentName, scanner);
  }

  /**
   * Phase 90 MEM-02 — test helper (read-only view of the scanner map).
   * Tests assert scanner stop() called on stopAgent; production callers
   * MUST NOT reach into this map directly.
   * @internal
   */
  get _memoryScanners(): ReadonlyMap<string, MemoryScanner> {
    return this.memoryScanners;
  }

  /**
   * Phase 90 MEM-04 — test helper (read-only view of the disk-flush timer
   * map). Tests assert the timer is created on startAgent and removed on
   * stopAgent. Production callers MUST NOT reach into this map directly.
   * @internal
   */
  get _memoryFileFlushTimers(): ReadonlyMap<string, MemoryFlushTimer> {
    return this.memoryFileFlushTimers;
  }

  /**
   * Phase 90 MEM-03 — build a pre-turn retrieval closure for `agentName`.
   * Returns undefined when the agent has no MemoryStore (not initialized /
   * already stopped) — the TurnDispatcher short-circuits to zero-retrieval
   * in that case.
   *
   * The closure captures the agent's MemoryStore + the shared MiniLM
   * embedder. Re-reads topK per turn from this.configs so a YAML hot-reload
   * takes effect without re-wiring. 14-day time window is hard-coded per
   * D-24; the budget reads from this.allAgentConfigs' defaults (defaults.
   * memoryRetrievalTokenBudget).
   */
  getMemoryRetrieverForAgent(
    agentName: string,
  ): ((query: string) => Promise<readonly MemoryRetrievalResult[]>) | undefined {
    const store = this.memory.memoryStores.get(agentName);
    if (!store) return undefined;
    const config = this.configs.get(agentName);
    const topK = config?.memoryRetrievalTopK ?? 5;
    const embedder = this.memory.embedder;
    return async (query: string) => {
      return retrieveMemoryChunks({
        query,
        store,
        embed: (text: string) => embedder.embed(text),
        topK,
        timeWindowDays: 14,
      });
    };
  }

  /**
   * @internal Phase 89 test-only — exposes the cool-down map for integration
   * tests (stopAgent cleanup + GREET-10 cool-down semantics). Read-only view
   * so production callers can't mutate the map through this getter.
   */
  get _greetCoolDownByAgent(): ReadonlyMap<string, number> {
    return this.greetCoolDownByAgent;
  }

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

  /** Phase 73 Plan 02 — escape hatch (stop/crash auto-invalidate). */
  invalidateBriefCache(n: string): void { this.briefCache.invalidate(n); }

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

    // Initialize memory, store SOUL.md as retrievable memory, and refresh hot tier.
    //
    // Quick task 260419-mvh — fail-fast on memory init failure.
    //
    // Two guards handle the two failure modes of AgentMemoryManager.initMemory:
    //   1. try/catch — forward-compat: if initMemory starts propagating errors
    //      (better error hygiene), capture the REAL cause in one place.
    //   2. `!memoryStores.has(name)` — today's silent-swallow path. initMemory's
    //      own try/catch (session-memory.ts:125) logs ERROR but does NOT throw,
    //      leaving no MemoryStore behind. Before this guard the cascade continued
    //      into warm-path which THEN threw `warmSqliteStores: no MemoryStore for
    //      agent '${name}'` — hiding the real root cause in the prior log line.
    //
    // On either failure: mark the agent 'failed' with a single-line cause in
    // lastError, skip warm-path/createSession/etc., and return cleanly so the
    // daemon keeps serving the other agents (same contract as warm-path failure).
    try {
      this.memory.initMemory(name, config);
    } catch (initErr) {
      const errMsg = (initErr as Error).message;
      this.log.warn(
        { agent: name, error: errMsg },
        "failed to initialize memory — agent marked failed, skipping warm-path",
      );
      registry = await readRegistry(this.registryPath);
      registry = updateEntry(registry, name, {
        status: "failed",
        lastError: `initMemory: ${errMsg}`,
      });
      await writeRegistry(this.registryPath, registry);
      return;
    }
    if (!this.memory.memoryStores.has(name)) {
      const errMsg =
        "MemoryStore missing after initMemory (check earlier 'failed to initialize memory' log for root cause)";
      this.log.warn({ agent: name }, errMsg);
      registry = await readRegistry(this.registryPath);
      registry = updateEntry(registry, name, {
        status: "failed",
        lastError: `initMemory: ${errMsg}`,
      });
      await writeRegistry(this.registryPath, registry);
      return;
    }

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

    // Phase 83 Plan 02 EFFORT-03 — re-apply persisted runtime effort override
    // so `/clawcode-effort` survives `clawcode restart <agent>`. Read happens
    // BEFORE warm-path to keep startup ordering predictable; a corrupt /
    // missing state file falls back to the config default (no throw). MUST
    // NOT block startup on persistence — any error is logged and swallowed.
    try {
      const persisted = await readEffortState(this.effortStatePath, name, this.log);
      if (persisted && persisted !== config.effort) {
        handle.setEffort(persisted);
        this.log.info(
          { agent: name, effort: persisted, configDefault: config.effort },
          "re-applied persisted effort override",
        );
      } else if (persisted) {
        // Persistence matches config default — no-op, but record at debug for
        // operator traceability.
        this.log.debug(
          { agent: name, effort: persisted },
          "persisted effort matches config default",
        );
      }
    } catch (err) {
      // Observational — never block startup on persistence.
      this.log.warn(
        { agent: name, error: (err as Error).message },
        "effort-state read failed on start (non-fatal)",
      );
    }

    this.attachCrashHandler(name, config, handle);
    this.recovery.setStabilityTimer(name);

    // Phase 56 Plan 02 — warm-path ready gate. Registry stays in 'starting'
    // while we warm SQLite + verify embedder + probe session plumbing. On
    // failure or timeout (10s), mark the agent 'failed' with a structured
    // error — daemon keeps running other agents. On success, a single atomic
    // registry write flips status -> 'running' AND records warm_path_ready +
    // warm_path_readiness_ms in the same transaction.
    // Phase 85 Plan 01 TOOL-01 — mcpProbe closes over a ref so the report
    // is reachable after runWarmPathCheck resolves (for subsequent handle
    // + state-map population). Optional failures are warn-logged here and
    // do NOT contribute to the gate-blocking errors array.
    const mcpReadiness: { current: McpReadinessReport | null } = { current: null };
    const mcpServers = config.mcpServers ?? [];
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
      // Phase 85 Plan 01 TOOL-01 — JSON-RPC `initialize` handshake against
      // every configured MCP server. Mandatory failures block the warm-
      // path; optional failures are warn-logged and allowed through.
      ...(mcpServers.length > 0
        ? {
            mcpProbe: async () => {
              const rep = await performMcpReadinessHandshake(mcpServers);
              mcpReadiness.current = rep;
              if (rep.optionalErrors.length > 0) {
                this.log.warn(
                  { agent: name, optionalErrors: rep.optionalErrors },
                  "mcp: optional servers failed handshake (non-blocking)",
                );
              }
              return { errors: rep.errors };
            },
          }
        : {}),
      timeoutMs: WARM_PATH_TIMEOUT_MS,
    });

    // Persist the MCP state map regardless of gate outcome. On a mandatory
    // failure we still want the state visible (e.g. for `list-mcp-status`
    // + Plan 03's /clawcode-tools) even though the agent is marked failed.
    // On success this gets re-persisted alongside the handle below.
    if (mcpReadiness.current) {
      this.setMcpStateForAgent(name, mcpReadiness.current.stateByName);
    }

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
      lastError: null,
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

    // Phase 85 Plan 01 TOOL-01 — mirror MCP state onto the handle so
    // TurnDispatcher-scope consumers (Plan 02 prompt-builder) can read
    // live tool health without reaching into SessionManager's private
    // maps. Mirror is ALSO kept in sync by the mcp-reconnect heartbeat
    // check every tick (see src/heartbeat/checks/mcp-reconnect.ts).
    if (mcpReadiness.current) {
      handle.setMcpState(mcpReadiness.current.stateByName);
    }

    // Gap 3 (memory-persistence-gaps): start mid-session flush timer AFTER
    // warm-path success. Before the gate is green there is no active
    // conversation to flush, and starting the timer earlier would waste a
    // tick if warm-path fails.
    this.startFlushTimer(name, config);

    // Phase 90 MEM-04 — per-agent disk-flush timer. Writes a Haiku-summarized
    // session delta to memory/YYYY-MM-DD-HHMM.md every intervalMs. Separate
    // from the Gap 3 DB flush above (that one summarizes into the memories
    // table via flushSessionMidway; this one lands on DISK so a SIGKILL
    // between DB flushes doesn't lose the active session's context). Skip
    // heuristic prevents spam on idle windows.
    this.startMemoryFileFlushTimer(name, config);
  }

  /**
   * Phase 90 MEM-04 — construct + start the disk-flush MemoryFlushTimer
   * for `name`. Safe to call from startAgent; defensive stop-first so
   * hot-reloads don't leak a timer. Uses the agent's config
   * memoryFlushIntervalMs (populated by loader.ts from the defaults
   * fallback) and wires getTurnsSince against the active ConversationStore
   * session (falls back to empty array when no active session, which
   * yields a skip per the meaningfulTurnsSince heuristic).
   */
  private startMemoryFileFlushTimer(
    name: string,
    config: ResolvedAgentConfig,
  ): void {
    this.stopMemoryFileFlushTimer(name); // defensive: never leak a prior timer

    const timer = new MemoryFlushTimer({
      workspacePath: config.workspace,
      agentName: name,
      intervalMs: config.memoryFlushIntervalMs,
      getTurnsSince: (sinceTs: number) => {
        const convStore = this.memory.conversationStores.get(name);
        const convSessionId = this.activeConversationSessionIds.get(name);
        if (!convStore || !convSessionId) return [];
        const turns = convStore.getTurnsForSession(convSessionId);
        // Filter to turns created after sinceTs (epoch ms). ConversationTurn
        // carries an ISO createdAt — parse once per turn. When parsing fails
        // (defensive), include the turn rather than silently drop it.
        return turns.filter((t) => {
          const ts = Date.parse(t.createdAt);
          return Number.isFinite(ts) ? ts > sinceTs : true;
        });
      },
      summarize: (prompt, opts) =>
        this.summarizeFn(prompt, { signal: opts.signal }),
      log: this.log.child({ memoryFlush: name }),
    });
    timer.start();
    this.memoryFileFlushTimers.set(name, timer);
    this.log.info(
      { agent: name, intervalMs: config.memoryFlushIntervalMs },
      "memory-file flush timer started (MEM-04)",
    );
  }

  /**
   * Phase 90 MEM-04 — stop the disk-flush timer for `name`. Safe to call
   * when no timer is registered (no-op). Does NOT await in-flight flush —
   * use awaitMemoryFileFinalFlush for that (stopAgent path).
   */
  private stopMemoryFileFlushTimer(name: string): void {
    const timer = this.memoryFileFlushTimers.get(name);
    if (timer) {
      timer.stop();
      this.memoryFileFlushTimers.delete(name);
    }
  }

  /**
   * Phase 90 MEM-04 D-29 — final flush with 10s cap, invoked by stopAgent
   * BEFORE handle.close() so the final session delta lands on disk. Both
   * paths (resolve / 10s-timeout) log and fall through — a stuck summarizer
   * must not block operator-initiated stops.
   */
  private async awaitMemoryFileFinalFlush(name: string): Promise<void> {
    const timer = this.memoryFileFlushTimers.get(name);
    if (!timer) return;
    try {
      await Promise.race([
        timer.flushNow(),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("flush timeout")), 10_000),
        ),
      ]);
    } catch (err) {
      this.log.warn(
        { agent: name, err: (err as Error).message },
        "final memory-file flush hit 10s cap or failed (non-fatal)",
      );
    } finally {
      timer.stop();
      this.memoryFileFlushTimers.delete(name);
    }
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
    // 260419-q2z Fix B — reject new turns once drain() has been called.
    if (this.draining) {
      throw new SessionError(
        `shutting down, agent '${name}' is no longer accepting turns`,
        name,
      );
    }
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
    // 260419-q2z Fix B — reject new turns once drain() has been called.
    if (this.draining) {
      throw new SessionError(
        `shutting down, agent '${name}' is no longer accepting turns`,
        name,
      );
    }
    const handle = this.requireSession(name);
    this.log.info({ agent: name, messageLength: message.length }, "streaming message to agent");
    const response = await handle.sendAndStream(message, onChunk, turn, options);
    this.log.info({ agent: name, responseLength: response.length }, "agent stream complete");
    return response;
    // NOTE: SessionManager does NOT call turn.end() — caller owns Turn lifecycle (50-02b).
  }

  /**
   * Set the reasoning effort level for a running agent. Takes effect on next turn.
   * Phase 83 EFFORT-04 — accepts the full v2.2 EffortLevel set.
   * Phase 83 Plan 02 EFFORT-03 — persist to disk so the override survives
   * `clawcode restart <name>`. Fire-and-forget: the runtime side-effect is
   * already on the handle; persistence is best-effort. A persistence failure
   * MUST NOT block the caller — the SDK call has already fired.
   */
  setEffortForAgent(name: string, level: EffortLevel): void {
    const handle = this.requireSession(name);
    handle.setEffort(level);
    this.log.info({ agent: name, effort: level }, "effort level updated");
    // Best-effort persistence — see docblock above.
    void writeEffortState(this.effortStatePath, name, level, this.log).catch((err) => {
      this.log.warn(
        { agent: name, error: (err as Error).message },
        "effort-state persist failed (non-fatal)",
      );
    });
  }

  /** Get the current reasoning effort level for a running agent. */
  getEffortForAgent(name: string): EffortLevel {
    const handle = this.requireSession(name);
    return handle.getEffort();
  }

  /**
   * Phase 86 MODEL-03 / MODEL-06 — set the active model for a running agent
   * via SDK Query.setModel. Validates `alias` against the agent's resolved
   * `allowedModels` BEFORE dispatching to the handle. Throws
   * ModelNotAllowedError (typed) on violation so the caller (IPC / slash
   * command) can render an ephemeral error with the allowed list.
   *
   * Plan 02 adds atomic YAML persistence AFTER this call returns; the
   * persistence path is owned by the daemon IPC handler to keep
   * SessionManager single-responsibility.
   *
   * `alias` is a config alias (e.g. "sonnet"); this method resolves it
   * to a full SDK model id via resolveModelId (same helper used by
   * session-adapter.ts). Runtime-only: does NOT modify clawcode.yaml.
   *
   * @throws SessionError if the agent is not running
   * @throws ModelNotAllowedError if alias is not in the agent's allowedModels
   */
  setModelForAgent(name: string, alias: "haiku" | "sonnet" | "opus"): void {
    const handle = this.requireSession(name);
    const config = this.configs.get(name);
    // Defensive — configs is always populated for running agents (set in
    // startAgent), but an allowlist violation must fail loud if somehow
    // reached without a config entry.
    const allowed = (config?.allowedModels ?? [
      "haiku",
      "sonnet",
      "opus",
    ]) as readonly string[];
    if (!allowed.includes(alias)) {
      throw new ModelNotAllowedError(name, alias, allowed);
    }
    const modelId = resolveModelId(alias);
    handle.setModel(modelId);
    this.log.info({ agent: name, model: alias, modelId }, "model updated");
  }

  /**
   * Phase 86 MODEL-07 — current live model alias/id for /clawcode-status.
   * Returns the most recent id dispatched to the handle, or undefined when
   * the session started without a model and setModel was never called.
   *
   * @throws SessionError if the agent is not running
   */
  getModelForAgent(name: string): string | undefined {
    const handle = this.requireSession(name);
    return handle.getModel();
  }

  /**
   * Phase 87 CMD-02 — set the permission mode for a running agent via
   * SDK Query.setPermissionMode. Validates the mode is one of the 6
   * supported values before dispatch. Runtime-only — does NOT modify
   * clawcode.yaml (unlike setModelForAgent's Plan 02 path; permissions are
   * intentionally ephemeral and reset on restart).
   *
   * Unlike setModelForAgent, there is NO per-agent allowlist: every agent
   * can set every PermissionMode by design. The only validation is the
   * STATIC 6-value union.
   *
   * @throws SessionError if the agent is not running
   * @throws Error if mode is not a valid PermissionMode
   */
  setPermissionModeForAgent(name: string, mode: string): void {
    const handle = this.requireSession(name);
    const validModes: readonly PermissionMode[] = [
      "default",
      "acceptEdits",
      "bypassPermissions",
      "plan",
      "dontAsk",
      "auto",
    ];
    if (!validModes.includes(mode as PermissionMode)) {
      throw new Error(
        `Invalid permission mode '${mode}'. Valid: ${validModes.join(", ")}`,
      );
    }
    handle.setPermissionMode(mode as PermissionMode);
    this.log.info({ agent: name, permissionMode: mode }, "permission mode updated");
  }

  /**
   * Phase 87 CMD-02 — current live permission mode for a running agent.
   * Returns the value most recently passed to setPermissionModeForAgent, or
   * the session-start default ("default" when unset).
   *
   * @throws SessionError if the agent is not running
   */
  getPermissionModeForAgent(name: string): PermissionMode {
    const handle = this.requireSession(name);
    return handle.getPermissionMode();
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
    this.briefCache.invalidate(name); // Phase 73 Plan 02 — LAT-02
    this.recovery.clearStabilityTimer(name);
    this.recovery.clearRestartTimer(name);
    // Gap 3 (memory-persistence-gaps): stop the flush timer BEFORE
    // summarization so a timer tick cannot race against endSession and
    // try to flush a session that has just transitioned out of 'active'.
    this.stopFlushTimer(name);

    // Phase 90 MEM-04 D-29 — final disk flush with 10s cap BEFORE
    // handle.close. Awaits an in-flight flush OR starts a final one
    // (skip heuristic applies — no flush if no meaningful turns since
    // last tick). Sibling to the Gap 3 DB-summarization cleanup above;
    // distinct concerns (DB memories vs disk markdown).
    await this.awaitMemoryFileFinalFlush(name);

    // Phase 65: end the ConversationStore session before memory cleanup
    const convSessionId = this.activeConversationSessionIds.get(name);
    const convStoreForStop = this.memory.conversationStores.get(name);
    if (convStoreForStop && convSessionId) {
      try { convStoreForStop.endSession(convSessionId); } catch { /* session may already be ended */ }
      // Phase 66 -- awaited summarization (bounded by its internal 10s
      // timeout). MUST run BEFORE cleanupMemory because cleanupMemory closes
      // the MemoryStore + ConversationStore connections. Wrapped in try/catch
      // so a summarization failure never blocks a stop.
      try {
        // 260419-q2z Fix B — track stop-path summary so drain() waits for it.
        await this.trackSummary(
          this.summarizeSessionIfPossible(name, convSessionId),
        );
      } catch (err) {
        this.log.warn(
          {
            agent: name,
            session: convSessionId,
            error: (err as Error).message,
          },
          "stop-path summarization failed (non-fatal)",
        );
      }
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
    // Phase 85 Plan 01 TOOL-01 — drop per-agent MCP state so a restart
    // starts clean (no stale failed-server entries from a prior session).
    this.mcpStateByAgent.delete(name);
    // Phase 89 D-14 — reset cool-down on agent stop so an operator-initiated
    // stop + restart sequence bypasses the 5-min suppression (operator intent
    // is NOT a crash loop).
    this.greetCoolDownByAgent.delete(name);
    // Phase 90 MEM-02 — stop the chokidar watcher + drop the reference.
    // Swallow errors (a mid-close watcher on a unit-tested path shouldn't
    // block agent stop). Scheduled for a future unit-level refactor if
    // chokidar close() starts throwing during daemon shutdown.
    const scanner = this.memoryScanners.get(name);
    if (scanner) {
      this.memoryScanners.delete(name);
      void scanner.stop().catch((err) => {
        this.log.warn(
          { agent: name, error: (err as Error).message },
          "memory-scanner stop failed (non-fatal)",
        );
      });
    }

    registry = await readRegistry(this.registryPath);
    // clawdy-v2-stability (2026-04-19): record stoppedAt so reconcileRegistry's
    // TTL-prune pass can reap stale subagent/thread gravestones. Parent agents
    // also get the timestamp but are never TTL-reaped — only sub/thread entries.
    registry = updateEntry(registry, name, {
      status: "stopped",
      sessionId: null,
      stoppedAt: Date.now(),
    });
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

  /**
   * Quick task 260419-nic — interrupt the agent's in-flight SDK turn.
   *
   * Returns a 2-flag result so callers (e.g., Discord `/clawcode-interrupt`
   * slash handler) can render the right ephemeral message:
   *   - hadActiveTurn=false, interrupted=false → "No active turn for X"
   *   - hadActiveTurn=true,  interrupted=true  → "Stopped X mid-turn"
   *
   * No-op (returns {false,false}) when:
   *   - the agent is not in this.sessions (never started / already stopped)
   *   - the handle does not expose interrupt/hasActiveTurn (legacy handles)
   *   - hasActiveTurn() returns false
   *
   * Throws if handle.interrupt() itself throws — caller (slash-command layer)
   * surfaces the error ephemerally.
   */
  async interruptAgent(
    name: string,
  ): Promise<{ readonly interrupted: boolean; readonly hadActiveTurn: boolean }> {
    const handle = this.sessions.get(name);
    if (!handle) {
      return { interrupted: false, hadActiveTurn: false };
    }
    // Duck-type guard — legacy wrapSdkQuery handles (used by the test-only
    // createTracedSessionHandle) do expose stubs for these, but newer MCP
    // adapters or custom handles may not. Belt-and-suspenders.
    if (
      typeof handle.interrupt !== "function" ||
      typeof handle.hasActiveTurn !== "function"
    ) {
      return { interrupted: false, hadActiveTurn: false };
    }
    if (!handle.hasActiveTurn()) {
      return { interrupted: false, hadActiveTurn: false };
    }
    try {
      handle.interrupt();
    } catch (err) {
      this.log.warn(
        { agent: name, error: (err as Error).message },
        "interrupt failed",
      );
      throw err;
    }
    this.log.info(
      { agent: name, event: "agent_interrupted" },
      "agent turn interrupted",
    );
    return { interrupted: true, hadActiveTurn: true };
  }

  /**
   * Quick task 260419-nic — expose the handle's hasActiveTurn() for the
   * `/clawcode-steer` slash-command's poll loop. Returns false when the
   * agent is not running OR the handle predates the Task 1 primitive.
   */
  hasActiveTurn(name: string): boolean {
    const handle = this.sessions.get(name);
    if (!handle) return false;
    if (typeof handle.hasActiveTurn !== "function") return false;
    return handle.hasActiveTurn();
  }

  async restartAgent(name: string, config: ResolvedAgentConfig): Promise<void> {
    await this.stopAgent(name);
    let registry = await readRegistry(this.registryPath);
    const prevEntry = registry.entries.find((e) => e.name === name);
    // Phase 89 GREET-03 — capture BEFORE the restartCount bump so the
    // classifier sees the pre-restart failure state. classifyRestart
    // treats >0 as crash-suspected, 0 as clean (Finding 3 in 89-RESEARCH).
    const prevConsecutiveFailures = prevEntry?.consecutiveFailures ?? 0;
    registry = updateEntry(registry, name, {
      restartCount: (prevEntry?.restartCount ?? 0) + 1,
    });
    await writeRegistry(this.registryPath, registry);
    await this.startAgent(name, config);

    // Phase 89 GREET-01 / GREET-09 — fire-and-forget greeting.
    // This MUST stay async: D-16 requires restart success to be independent
    // of Discord availability. Rejections are logged and swallowed per the
    // Phase 83 canary blueprint (see setEffortForAgent at line ~656).
    const webhookManager = this.webhookManager;
    const convStore = this.memory.conversationStores.get(name);
    // Phase 90.1 debug — log the OUTER GUARD state so we can see whether we
    // even reached sendRestartGreeting. Previously this branch was silent.
    this.log.info(
      {
        agent: name,
        hasWebhookManager: Boolean(webhookManager),
        hasConvStore: Boolean(convStore),
        hasBotDirectSender: Boolean(this.botDirectSender),
      },
      "[greeting] restartAgent: evaluating greeting guards",
    );
    if (webhookManager && convStore) {
      void sendRestartGreeting(
        {
          webhookManager,
          conversationStore: convStore,
          summarize: this.summarizeFn,
          now: () => Date.now(),
          log: this.log,
          coolDownState: this.greetCoolDownByAgent,
          // Phase 90.1 hotfix — pass bot-direct fallback if wired. Greeting
          // helper uses it when no per-agent webhook is provisioned.
          botDirectSender: this.botDirectSender,
        },
        {
          agentName: name,
          config,
          restartKind: classifyRestart(prevConsecutiveFailures),
        },
      )
        .then((outcome) => {
          // Phase 90.1 debug — log every greeting outcome so silent-skip
          // classes (empty-state, cool-down, dormant, no-webhook) are
          // visible in production logs without requiring a debugger.
          this.log.info(
            { agent: name, outcome },
            "[greeting] sendRestartGreeting outcome",
          );
        })
        .catch((err: unknown) => {
          this.log.warn(
            { agent: name, error: (err as Error).message },
            "[greeting] sendRestartGreeting threw (non-fatal)",
          );
        });
    }
  }

  async startAll(configs: readonly ResolvedAgentConfig[]): Promise<void> {
    const errors: Array<{ name: string; error: Error }> = [];
    for (const config of configs) {
      // Gap 1 (memory-persistence-gaps): skip agents already resumed by
      // reconcileRegistry. Before this guard, startAll would call startAgent
      // for every config in the list, startAgent's `this.sessions.has(name)`
      // precondition would throw "already running", and the error was
      // caught + logged as a noisy `error` on every daemon boot even though
      // the outcome was correct (agent IS running).
      if (this.sessions.has(config.name)) {
        this.log.debug(
          { agent: config.name },
          "startAll: agent already running (resumed by reconcile) — skipping",
        );
        continue;
      }
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
          // Gap 1 (memory-persistence-gaps): initialize memory BEFORE
          // buildSessionConfig so the resumed agent has a MemoryStore +
          // ConversationStore. Without this, stopAgent's summarization
          // branch is a no-op because activeConversationSessionIds stays
          // empty and conversationStores.get() returns undefined.
          try {
            this.memory.initMemory(entry.name, config);
          } catch (initErr) {
            this.log.warn(
              { agent: entry.name, error: (initErr as Error).message },
              "failed to initialize memory during reconcile (resumed agent will have no memory persistence)",
            );
          }

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

          // Gap 1 (memory-persistence-gaps): start a FRESH ConversationStore
          // session for the resumed agent. We intentionally do NOT try to
          // reattach to any orphaned 'active' row in the DB — conversation-
          // store.ts:298-303 already documents that orphans are unrecoverable
          // (we don't know when they truly ended). A fresh session keeps the
          // state machine clean and guarantees stopAgent summarization fires.
          const convStore = this.memory.conversationStores.get(entry.name);
          if (convStore) {
            try {
              const convSession = convStore.startSession(entry.name);
              this.activeConversationSessionIds.set(entry.name, convSession.id);
            } catch (err) {
              this.log.warn(
                { agent: entry.name, error: (err as Error).message },
                "failed to start conversation session during reconcile (non-fatal)",
              );
            }
          }

          this.attachCrashHandler(entry.name, config, handle);
          this.recovery.setStabilityTimer(entry.name);
          // Gap 3 (memory-persistence-gaps): resumed sessions also get the
          // periodic flush timer so a daemon reboot doesn't silently extend
          // the at-risk window between persistence checkpoints.
          this.startFlushTimer(entry.name, config);
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

  /**
   * Phase 87 CMD-01 — expose the per-agent SessionHandle for consumers that
   * need to read SDK-surfaced state without going through a named accessor.
   *
   * Current consumers:
   *   - SlashCommandHandler.register() — calls handle.getSupportedCommands()
   *     per agent to build the native-CC registration set (CMD-01)
   *   - Plan 02 dispatch paths — will reach through this to invoke
   *     handle.setPermissionMode / other SDK control-plane methods
   *
   * Returns undefined when the agent has never started or has been stopped.
   */
  getSessionHandle(name: string): SessionHandle | undefined {
    return this.sessions.get(name);
  }

  /**
   * Post-v2.0 hardening — single-name boolean readiness probe.
   *
   * Used by the OpenAI endpoint (src/openai/server.ts) to bound the warm-path
   * startup race. During the ~5s window between daemon start and the agent's
   * warm path completing, `streamFromAgent` / `nonStreamFromAgent` throw
   * `SessionError('not running')`. The endpoint polls this helper to decide
   * between wait-then-dispatch and a 503 Retry-After response.
   *
   * Deliberately does NOT differentiate "starting" vs "fully warm" —
   * `this.sessions.has(name)` flips to true AFTER warmupAgent returns, which
   * is exactly the gate the endpoint needs.
   */
  isRunning(name: string): boolean {
    return this.sessions.has(name);
  }

  // Memory accessors (delegate to AgentMemoryManager)
  getMemoryStore(agentName: string): MemoryStore | undefined { return this.memory.memoryStores.get(agentName); }
  getCompactionManager(agentName: string): CompactionManager | undefined { return this.memory.compactionManagers.get(agentName); }
  getContextFillProvider(agentName: string): CharacterCountFillProvider | undefined { return this.memory.contextFillProviders.get(agentName); }
  getEmbedder(): EmbeddingService { return this.memory.embedder; }
  getAgentConfig(agentName: string): ResolvedAgentConfig | undefined { return this.configs.get(agentName); }

  /**
   * Phase 85 Plan 01 TOOL-01 — read the per-agent MCP state map.
   *
   * Returns an empty `Map` for agents with no MCP servers or unknown
   * agent names. Consumed by:
   *   - `src/heartbeat/checks/mcp-reconnect.ts` (reconcile prior vs current)
   *   - `src/manager/daemon.ts` IPC `list-mcp-status` handler
   *   - Plan 02 prompt-builder (surface live tool health in system prompt)
   */
  getMcpStateForAgent(name: string): ReadonlyMap<string, McpServerState> {
    return this.mcpStateByAgent.get(name) ?? new Map();
  }

  /**
   * Phase 85 Plan 01 TOOL-01 — persist the per-agent MCP state map.
   *
   * Called at `startAgent` after the readiness probe runs and by the
   * `mcp-reconnect` heartbeat check after every tick's probe. Always
   * stores a DEFENSIVE COPY so external mutations of the passed-in map
   * don't leak into the SessionManager's state.
   */
  setMcpStateForAgent(
    name: string,
    state: ReadonlyMap<string, McpServerState>,
  ): void {
    this.mcpStateByAgent.set(name, new Map(state));
  }
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
    // Phase 75 SHARED-01 — pass memoryPath (not workspace) so shared-workspace
    // agents write context summaries into their per-agent memory dir.
    await this.memory.saveContextSummary(agentName, config.memoryPath, summary);
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
      // Phase 67 gap-closure — thread per-agent ConversationStore + MemoryStore
      // Maps so buildSessionConfig can invoke assembleConversationBrief.
      // `now` is intentionally omitted — buildSessionConfig defaults to Date.now().
      conversationStores: this.memory.conversationStores,
      memoryStores: this.memory.memoryStores,
      briefCache: this.briefCache, // Phase 73 Plan 02 — LAT-02
      // Phase 85 Plan 02 — thread per-agent MCP readiness state so
      // renderMcpPromptBlock can populate the live status table in the
      // stable prefix (TOOL-02 / TOOL-07).
      mcpStateProvider: (name: string) => this.getMcpStateForAgent(name),
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

  /**
   * Phase 66 -- invoke session summarization for a terminal session.
   *
   * Non-fatal on any failure. Returns after summarizeSession resolves (which
   * includes its internal 10s timeout + raw-turn fallback). Callers decide
   * whether to await this (stopAgent: awaited) or fire-and-forget it
   * (onError crash handler: void + .catch).
   *
   * Pulls all deps from AgentMemoryManager + the injected summarizeFn so
   * tests can swap the LLM call without touching the rest of the pipeline.
   */
  /**
   * 260419-q2z Fix B — register an in-flight summarization promise with the
   * shutdown drain. Adds to {@link pendingSummaries} and removes on settle.
   *
   * Returns the original promise so callers can await / catch exactly as
   * before — the tracker is invisible to happy-path code.
   */
  private trackSummary(p: Promise<void>): Promise<void> {
    this.pendingSummaries.add(p);
    const settle = (): void => {
      this.pendingSummaries.delete(p);
    };
    p.then(settle, settle);
    return p;
  }

  /**
   * 260419-q2z Fix B — test-only hook that feeds a promise into the same
   * pendingSummaries set used by production crash/stop paths.
   * Production code MUST NOT call this; it exists so the shutdown drain tests
   * can exercise drain() without standing up full agent+memory infrastructure.
   */
  __testTrackSummary(p: Promise<void>): Promise<void> {
    return this.trackSummary(p);
  }

  /**
   * 260419-q2z Fix B — test-only inspector for the draining flag.
   */
  __testIsDraining(): boolean {
    return this.draining;
  }

  /**
   * 260419-q2z Fix B — drain in-flight summarization promises before daemon
   * shutdown so SIGTERM does not truncate a registry update or memory insert
   * mid-flight.
   *
   * After calling drain(), new turn dispatches (streamFromAgent /
   * sendToAgent) reject with `SessionError('shutting down, agent X is no
   * longer accepting turns')`. This is the ONE surface that blocks new work;
   * stopAgent / reconcileRegistry continue to function so the daemon can
   * still clean up.
   *
   * @param timeoutMs - Hard ceiling on how long to wait for pending
   *                    summaries. On timeout, the promises are NOT cancelled
   *                    — drain just stops waiting. The summaries continue in
   *                    the background; any SIGKILL that follows will kill
   *                    them.
   * @returns Counts of settled vs. timed-out summaries. `settled + timedOut`
   *          equals the number of summaries that were in flight when drain
   *          was called.
   */
  async drain(
    timeoutMs: number,
  ): Promise<{ readonly settled: number; readonly timedOut: number }> {
    this.draining = true;
    const count = this.pendingSummaries.size;
    if (count === 0) {
      return { settled: 0, timedOut: 0 };
    }
    const snapshot = [...this.pendingSummaries];
    const allSettled = Promise.allSettled(snapshot).then(() => "done" as const);
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timeoutHandle = setTimeout(() => resolve("timeout"), timeoutMs);
      // Don't keep the event loop alive just for this timer.
      timeoutHandle.unref?.();
    });
    try {
      const winner = await Promise.race([allSettled, timeout]);
      if (winner === "done") {
        return { settled: count, timedOut: 0 };
      }
      return { settled: 0, timedOut: this.pendingSummaries.size };
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }

  /**
   * Gap 1 (memory-persistence-gaps) — shared onError handler used by
   * `startAgent` (fresh start) AND `reconcileRegistry` (resume-after-reboot).
   *
   * Previously this block lived inline inside `startAgent`. `reconcileRegistry`
   * attached a DIFFERENT onError that only delegated to `recovery.handleCrash`,
   * leaving resumed sessions without crash-time summarization. Extracting the
   * handler keeps both call sites identical and guarantees conversation
   * summaries survive daemon reboots.
   */
  private attachCrashHandler(
    name: string,
    config: ResolvedAgentConfig,
    handle: SessionHandle,
  ): void {
    handle.onError((error: Error) => {
      // Phase 65: crash the ConversationStore session
      const convSessionId = this.activeConversationSessionIds.get(name);
      const convStoreForCrash = this.memory.conversationStores.get(name);
      if (convStoreForCrash && convSessionId) {
        try { convStoreForCrash.crashSession(convSessionId); } catch { /* best-effort */ }
        // Phase 66 -- fire-and-forget summarization (non-fatal, non-blocking).
        // BEFORE recovery.handleCrash so summarize starts even if recovery
        // synchronously resets state. Detached so crash recovery is never
        // delayed waiting on Haiku (up to 10s internal timeout).
        // 260419-q2z Fix B — track the crash-path summary so shutdown drain
        // waits for it even though we're fire-and-forget at this callsite.
        void this.trackSummary(
          this.summarizeSessionIfPossible(name, convSessionId),
        ).catch((err) => {
          this.log.warn(
            {
              agent: name,
              session: convSessionId,
              error: (err as Error).message,
            },
            "crash-path summarization failed (non-fatal)",
          );
        });
      }
      this.activeConversationSessionIds.delete(name);
      this.briefCache.invalidate(name); // Phase 73 Plan 02 — LAT-02
      // Gap 3 (memory-persistence-gaps): crash also stops the flush timer —
      // crashSession transitioned the session out of 'active' so flushes
      // would now skip anyway, but killing the timer here saves wakeups.
      this.stopFlushTimer(name);
      // Phase 90 MEM-04 — stop the disk-flush timer on crash. Do NOT await
      // a final flush here: the session already crashed and the Haiku call
      // would likely fail on the corrupted state. Timer is just stopped.
      this.stopMemoryFileFlushTimer(name);

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
  }

  /**
   * Gap 3 (memory-persistence-gaps) — start the periodic mid-session flush
   * timer for an agent. Reads `config.memory.conversation.flushIntervalMinutes`
   * (default 15, `0` disables). Safe to call from startAgent and
   * reconcileRegistry. Clears any pre-existing timer first (so hot-reloads
   * that re-enter this path do not leak).
   */
  private startFlushTimer(name: string, config: ResolvedAgentConfig): void {
    this.stopFlushTimer(name); // defensive: never leak a prior timer

    // Test-only override takes precedence so Gap 3 integration tests can
    // exercise the timer path without waiting real minutes.
    const intervalMs =
      this.flushIntervalMsOverride !== undefined
        ? this.flushIntervalMsOverride
        : (config.memory.conversation?.flushIntervalMinutes ?? 15) * 60_000;

    if (intervalMs <= 0) {
      this.log.debug(
        { agent: name },
        "flush timer disabled (interval <= 0)",
      );
      return;
    }
    this.flushSequenceByAgent.set(name, 0);
    const timer = setInterval(() => {
      // Non-blocking: fire-and-forget through trackSummary so drain() at
      // daemon shutdown waits for an in-flight flush.
      const convSessionId = this.activeConversationSessionIds.get(name);
      if (!convSessionId) return; // no active session — skip this tick
      if (this.draining) return; // shutdown in progress — new flushes pointless
      const nextSeq = (this.flushSequenceByAgent.get(name) ?? 0) + 1;
      this.flushSequenceByAgent.set(name, nextSeq);
      void this.trackSummary(
        this.flushSessionIfPossible(name, convSessionId, nextSeq),
      ).catch((err) => {
        this.log.warn(
          {
            agent: name,
            session: convSessionId,
            flushSequence: nextSeq,
            error: (err as Error).message,
          },
          "mid-session flush failed (non-fatal)",
        );
      });
    }, intervalMs);
    // Never keep the event loop alive just for this timer — if everything
    // else shuts down, the flush timer should not stop the process.
    timer.unref?.();
    this.flushTimers.set(name, timer);

    this.log.info(
      { agent: name, intervalMs },
      "mid-session flush timer started",
    );
  }

  /**
   * Gap 3 (memory-persistence-gaps) — stop the flush timer for an agent.
   * Safe to call when no timer is registered (no-op).
   */
  private stopFlushTimer(name: string): void {
    const timer = this.flushTimers.get(name);
    if (timer !== undefined) {
      clearInterval(timer);
      this.flushTimers.delete(name);
    }
    this.flushSequenceByAgent.delete(name);
  }

  /**
   * Gap 3 (memory-persistence-gaps) — invoke the mid-session flush pipeline.
   * Mirrors summarizeSessionIfPossible's shape so tests can exercise the
   * production wiring end-to-end.
   */
  private async flushSessionIfPossible(
    agentName: string,
    sessionId: string,
    flushSequence: number,
  ): Promise<void> {
    const memoryStore = this.memory.memoryStores.get(agentName);
    const conversationStore = this.memory.conversationStores.get(agentName);
    if (!memoryStore || !conversationStore) {
      this.log.warn(
        { agent: agentName, session: sessionId, flushSequence },
        "flush: missing memoryStore or conversationStore (non-fatal)",
      );
      return;
    }
    try {
      await flushSessionMidway(
        { agentName, sessionId, flushSequence },
        {
          conversationStore,
          memoryStore,
          embedder: this.memory.embedder,
          summarize: this.summarizeFn,
          log: this.log,
        },
      );
    } catch (err) {
      // flushSessionMidway is designed to never throw, but log defensively.
      this.log.warn(
        {
          agent: agentName,
          session: sessionId,
          flushSequence,
          error: (err as Error).message,
        },
        "flush threw unexpectedly (non-fatal)",
      );
    }
  }

  private async summarizeSessionIfPossible(
    agentName: string,
    sessionId: string,
  ): Promise<void> {
    const memoryStore = this.memory.memoryStores.get(agentName);
    const conversationStore = this.memory.conversationStores.get(agentName);
    if (!memoryStore || !conversationStore) {
      this.log.warn(
        { agent: agentName, session: sessionId },
        "summarize: missing memoryStore or conversationStore (non-fatal)",
      );
      return;
    }
    try {
      const result = await summarizeSession(
        { agentName, sessionId },
        {
          conversationStore,
          memoryStore,
          embedder: this.memory.embedder,
          summarize: this.summarizeFn,
          log: this.log,
        },
      );
      if ("success" in result && result.success) {
        this.log.info(
          {
            agent: agentName,
            session: sessionId,
            memoryId: result.memoryId,
            fallback: result.fallback,
            turnCount: result.turnCount,
          },
          "session summarized",
        );
      } else {
        this.log.info(
          {
            agent: agentName,
            session: sessionId,
            reason: (result as { reason: string }).reason,
          },
          "session summarization skipped",
        );
      }
    } catch (err) {
      // summarizeSession is designed to never throw, but log defensively so
      // an unexpected exception doesn't propagate past the lifecycle hook.
      this.log.warn(
        {
          agent: agentName,
          session: sessionId,
          error: (err as Error).message,
        },
        "summarization threw unexpectedly (non-fatal)",
      );
    }
  }
}
