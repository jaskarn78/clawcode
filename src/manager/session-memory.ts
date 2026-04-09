import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import type { Logger } from "pino";
import type { ResolvedAgentConfig } from "../shared/types.js";
import { MemoryStore } from "../memory/store.js";
import { EmbeddingService } from "../memory/embedder.js";
import { SessionLogger } from "../memory/session-log.js";
import {
  CompactionManager,
  CharacterCountFillProvider,
} from "../memory/compaction.js";
import { TierManager } from "../memory/tier-manager.js";
import { DEFAULT_TIER_CONFIG } from "../memory/tiers.js";
import { saveSummary } from "../memory/context-summary.js";
import { UsageTracker } from "../usage/tracker.js";
import { EpisodeStore } from "../memory/episode-store.js";

/**
 * Manages per-agent memory lifecycle: initialization, cleanup, and accessors.
 *
 * Each agent gets its own MemoryStore, SessionLogger, CompactionManager,
 * TierManager, UsageTracker, and CharacterCountFillProvider.
 */
export class AgentMemoryManager {
  readonly memoryStores: Map<string, MemoryStore> = new Map();
  readonly compactionManagers: Map<string, CompactionManager> = new Map();
  readonly sessionLoggers: Map<string, SessionLogger> = new Map();
  readonly contextFillProviders: Map<string, CharacterCountFillProvider> =
    new Map();
  readonly tierManagers: Map<string, TierManager> = new Map();
  readonly usageTrackers: Map<string, UsageTracker> = new Map();
  readonly episodeStores: Map<string, EpisodeStore> = new Map();
  readonly embedder: EmbeddingService = new EmbeddingService();

  constructor(private readonly log: Logger) {}

  /**
   * Initialize memory resources for an agent.
   * Creates MemoryStore, SessionLogger, CompactionManager, TierManager,
   * UsageTracker, and CharacterCountFillProvider.
   */
  initMemory(name: string, config: ResolvedAgentConfig): void {
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

      // Create EpisodeStore for this agent
      const episodeStore = new EpisodeStore(store, this.embedder);
      this.episodeStores.set(name, episodeStore);

      // Create UsageTracker for this agent
      const usageDbPath = join(memoryDir, "usage.db");
      const usageTracker = new UsageTracker(usageDbPath);
      this.usageTrackers.set(name, usageTracker);

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
   * Closes the MemoryStore and UsageTracker, removes from all maps.
   */
  cleanupMemory(name: string): void {
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

    const usageTracker = this.usageTrackers.get(name);
    if (usageTracker) {
      try {
        usageTracker.close();
      } catch (error) {
        this.log.warn(
          { agent: name, error: (error as Error).message },
          "error closing usage tracker",
        );
      }
      this.usageTrackers.delete(name);
    }
  }

  /**
   * Persist a context summary after compaction.
   * Saves to the agent's memory directory for injection on next resume.
   */
  async saveContextSummary(
    agentName: string,
    workspace: string,
    summary: string,
  ): Promise<void> {
    const memoryDir = join(workspace, "memory");
    await saveSummary(memoryDir, agentName, summary);
    this.log.info({ agent: agentName }, "context summary saved");
  }

  /**
   * Pre-warm the embedding model at daemon startup.
   * Call before starting any agents to avoid cold-start latency.
   */
  async warmupEmbeddings(): Promise<void> {
    await this.embedder.warmup();
    this.log.info("embedding model warmed up");
  }
}
