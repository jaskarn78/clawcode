/**
 * TierManager orchestrates all tier transitions for memory storage.
 *
 * Manages cold archival (warm -> cold markdown files), re-warming
 * (cold -> warm with fresh embedding), hot tier refresh (promote/demote),
 * and full maintenance cycles.
 */

import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";
import { extractWikilinks } from "./graph.js";
import { shouldPromoteToHot, shouldDemoteToWarm, shouldArchiveToCold } from "./tiers.js";
import type { TierConfig } from "./tiers.js";
import { scoreAndRank, type ScoringConfig } from "./relevance.js";
import type { MemoryStore } from "./store.js";
import type { EmbeddingService } from "./embedder.js";
import type { MemoryEntry, SearchResult } from "./types.js";
import type { Logger } from "pino";

/** Dependencies injected into TierManager for testability. */
export type TierManagerDeps = {
  readonly store: MemoryStore;
  readonly embedder: EmbeddingService;
  readonly memoryDir: string;
  readonly tierConfig: TierConfig;
  readonly scoringConfig: ScoringConfig;
  readonly log: Logger;
};

/** Result of a maintenance cycle. */
export type MaintenanceResult = {
  readonly demoted: number;
  readonly archived: number;
  readonly promoted: number;
};

/**
 * Convert a Float32Array embedding to a base64 string for cold archival.
 */
export function embeddingToBase64(embedding: Float32Array): string {
  const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  return buffer.toString("base64");
}

/**
 * Convert a base64 string back to a Float32Array embedding.
 */
export function base64ToEmbedding(base64: string): Float32Array {
  const buffer = Buffer.from(base64, "base64");
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

/**
 * Generate a filesystem-safe slug from memory content.
 * Takes first 40 chars, lowercases, replaces non-alphanumeric with hyphens, trims hyphens.
 */
export function generateColdSlug(content: string): string {
  const truncated = content.slice(0, 40);
  const slug = truncated
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug;
}

/**
 * TierManager class orchestrating all tier transitions and cold I/O.
 */
export class TierManager {
  private readonly store: MemoryStore;
  private readonly embedder: EmbeddingService;
  private readonly memoryDir: string;
  private readonly tierConfig: TierConfig;
  private readonly scoringConfig: ScoringConfig;
  private readonly log: Logger;
  private readonly coldDir: string;

  constructor(deps: TierManagerDeps) {
    this.store = deps.store;
    this.embedder = deps.embedder;
    this.memoryDir = deps.memoryDir;
    this.tierConfig = deps.tierConfig;
    this.scoringConfig = deps.scoringConfig;
    this.log = deps.log;
    this.coldDir = join(deps.memoryDir, "archive", "cold");
  }

  /**
   * Archive a warm memory to cold storage as a markdown file.
   *
   * Writes YAML frontmatter with all metadata + base64 embedding,
   * then deletes from SQLite. Returns the file path, or null if
   * the embedding is not found.
   */
  archiveToCold(entry: MemoryEntry): string | null {
    const embedding = this.store.getEmbedding(entry.id);
    if (!embedding) {
      this.log.warn({ id: entry.id }, "no embedding found for cold archival, skipping");
      return null;
    }

    const slug = generateColdSlug(entry.content);
    const fileName = `${entry.id}-${slug}.md`;
    mkdirSync(this.coldDir, { recursive: true });
    const filePath = join(this.coldDir, fileName);

    const frontmatter = {
      id: entry.id,
      source: entry.source,
      importance: entry.importance,
      access_count: entry.accessCount,
      tags: [...entry.tags],
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
      accessed_at: entry.accessedAt,
      tier: "cold",
      archived_at: new Date().toISOString(),
      embedding_base64: embeddingToBase64(embedding),
    };

    const markdown = `---\n${yamlStringify(frontmatter)}---\n\n# Memory: ${entry.content.slice(0, 80)}\n\n${entry.content}\n`;

    writeFileSync(filePath, markdown, "utf-8");

    // Remove from SQLite (both memories and vec_memories)
    this.store.delete(entry.id);

    this.log.info({ id: entry.id, path: filePath }, "memory archived to cold");
    return filePath;
  }

  /**
   * Re-warm a cold archive file back into SQLite as a warm memory.
   *
   * Reads the archive, re-embeds the content for a fresh vector,
   * inserts with tier='warm', preserves original access_count + 1,
   * and deletes the cold file.
   */
  async rewarmFromCold(filePath: string): Promise<MemoryEntry> {
    const raw = readFileSync(filePath, "utf-8");

    // Parse YAML frontmatter (between first and second ---)
    const parts = raw.split("---");
    if (parts.length < 3) {
      throw new Error(`Invalid cold archive format: ${filePath}`);
    }

    const frontmatter = yamlParse(parts[1]) as {
      id: string;
      source: string;
      importance: number;
      access_count: number;
      tags: string[];
      created_at: string;
      updated_at: string;
      accessed_at: string;
    };

    // Extract content from markdown body (after second ---, skip header line)
    const bodyRaw = parts.slice(2).join("---").trim();
    const lines = bodyRaw.split("\n");
    // Skip the "# Memory: ..." header line
    const contentLines = lines.filter((line) => !line.startsWith("# Memory:"));
    const content = contentLines.join("\n").trim();

    // Re-embed for fresh vector
    const embedding = await this.embedder.embed(content);

    // Insert with preserved metadata + tier='warm'
    // Access count is archived count + 1 (the search hit that triggered re-warm)
    const db = this.store.getDatabase();
    const now = new Date().toISOString();
    const id = frontmatter.id;
    const accessCount = (frontmatter.access_count ?? 0) + 1;

    db.transaction(() => {
      db.prepare(
        `INSERT INTO memories (id, content, source, importance, access_count, tags, created_at, updated_at, accessed_at, tier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'warm')`,
      ).run(
        id,
        content,
        frontmatter.source,
        frontmatter.importance,
        accessCount,
        JSON.stringify(frontmatter.tags ?? []),
        frontmatter.created_at,
        now,
        now,
      );
      db.prepare("INSERT INTO vec_memories (memory_id, embedding) VALUES (?, ?)").run(id, embedding);
    })();

    // Re-extract graph edges from rewarmed content
    const targets = extractWikilinks(content);
    if (targets.length > 0) {
      const stmts = this.store.getGraphStatements();
      const linkNow = new Date().toISOString();
      db.transaction(() => {
        for (const targetId of targets) {
          const exists = stmts.checkMemoryExists.get(targetId);
          if (exists) {
            stmts.insertLink.run(id, targetId, targetId, linkNow);
          }
        }
      })();
    }

    // Delete the cold archive file
    unlinkSync(filePath);

    this.log.info({ id, path: filePath }, "memory re-warmed from cold");

    return Object.freeze({
      id,
      content,
      source: frontmatter.source as MemoryEntry["source"],
      importance: frontmatter.importance,
      accessCount,
      tags: Object.freeze([...(frontmatter.tags ?? [])]),
      embedding,
      createdAt: frontmatter.created_at,
      updatedAt: now,
      accessedAt: now,
      tier: "warm" as const,
      sourceTurnIds: null,
    });
  }

  /**
   * Refresh the hot tier: demote stale hot memories, promote qualifying warm memories.
   *
   * Selects top hotBudget candidates by combined relevance score.
   */
  refreshHotTier(): { demoted: number; promoted: number } {
    const now = new Date();
    let demoted = 0;
    let promoted = 0;

    // Step 1: Demote stale hot memories back to warm
    const hotMemories = this.store.listByTier("hot", 1000);
    for (const mem of hotMemories) {
      if (shouldDemoteToWarm(mem.accessedAt, now, this.tierConfig)) {
        this.store.updateTier(mem.id, "warm");
        demoted++;
        this.log.info({ id: mem.id }, "demoted hot -> warm (stale)");
      }
    }

    // Step 2: Get warm candidates that qualify for promotion. Phase
    // 100-fu adds a graph-centrality signal — we look up each warm
    // memory's inbound-link count and pass it into shouldPromoteToHot
    // so heavy-linked hubs (e.g. fin-acquisition style nodes referenced
    // by many turn summaries) can promote even when their direct
    // access_count is low.
    //
    // Phase 999.8 follow-up (2026-04-30) — bumped scan window from 100
    // to 5000 AND switched to `listWarmCandidatesForPromotion` which
    // orders by backlink_count DESC. Original 100-cap + accessed_at
    // ordering surfaced recently-created memories first and pushed
    // high-centrality hubs out of the scan window — production diagnosis
    // showed 1029 warm memories with ≥5 backlinks but only 100 ever
    // scanned, none of them the hubs. The 5000 cap covers any agent's
    // full warm tier comfortably and the centrality ordering ensures
    // hubs surface first when the cap IS reached.
    const warmMemories = this.store.listWarmCandidatesForPromotion(5000);
    let firstSampleBl: number | undefined;
    let firstSampleId: string | undefined;
    const qualifyingWarm = warmMemories.filter((mem) => {
      const backlinkCount = this.store.getBacklinkCount(mem.id);
      if (firstSampleBl === undefined) {
        firstSampleBl = backlinkCount;
        firstSampleId = mem.id;
      }
      return shouldPromoteToHot(
        mem.accessCount,
        mem.accessedAt,
        now,
        this.tierConfig,
        backlinkCount,
      );
    });

    this.log.info(
      {
        warmScanned: warmMemories.length,
        qualifying: qualifyingWarm.length,
        topSample: { id: firstSampleId, backlinks: firstSampleBl },
        centralityThreshold: this.tierConfig.centralityPromoteThreshold,
        hotBudget: this.tierConfig.hotBudget,
      },
      "[tier-debug] promotion-scan diagnostic",
    );

    if (qualifyingWarm.length === 0) {
      return { demoted, promoted };
    }

    // Score qualifying candidates using scoreAndRank
    const searchResults: readonly SearchResult[] = qualifyingWarm.map((mem) =>
      Object.freeze({
        ...mem,
        distance: 0, // Not doing vector search, just scoring by relevance
      }),
    );

    const ranked = scoreAndRank(searchResults, this.scoringConfig, now);

    // Count current hot memories (not demoted)
    const currentHot = this.store.listByTier("hot", 1000);
    const slotsAvailable = Math.max(0, this.tierConfig.hotBudget - currentHot.length);

    // Promote top candidates up to available slots
    const toPromote = ranked.slice(0, slotsAvailable);
    for (const candidate of toPromote) {
      this.store.updateTier(candidate.id, "hot");
      promoted++;
      this.log.info({ id: candidate.id, score: candidate.combinedScore }, "promoted warm -> hot");
    }

    return { demoted, promoted };
  }

  /**
   * Get current hot-tier memories sorted by importance descending.
   * Returns a frozen array of frozen MemoryEntry objects.
   */
  getHotMemories(): readonly MemoryEntry[] {
    const hot = this.store.listByTier("hot", 1000);
    const sorted = [...hot].sort((a, b) => b.importance - a.importance);
    return Object.freeze(sorted);
  }

  /**
   * Phase 52 Plan 02 — stable_token for the top-3 hot-tier memories.
   *
   * Returns a deterministic sha256 hex over the sorted `id:accessedAt`
   * signatures of the top-3 hot memories. The context-assembler compares
   * this across turns to decide whether hot-tier enters the cacheable stable
   * prefix (token matches) or falls into the mutable suffix for one turn
   * (token differs from the prior turn's).
   *
   * Empty hot-tier → sha256("") — a known constant that matches the
   * empty-case path used by the assembler.
   */
  getHotMemoriesStableToken(): string {
    const hotMems = this.getHotMemories().slice(0, 3);
    const signature = hotMems
      .map((m) => `${m.id}:${m.accessedAt ?? m.createdAt}`)
      .sort()
      .join("|");
    return createHash("sha256").update(signature, "utf8").digest("hex");
  }

  /**
   * Run a full maintenance cycle: demote, archive, promote.
   *
   * Step 1: Demote stale hot -> warm
   * Step 2: Archive low-relevance warm -> cold
   * Step 3: Promote qualifying warm -> hot
   */
  runMaintenance(): MaintenanceResult {
    const now = new Date();
    let demoted = 0;
    let archived = 0;
    let promoted = 0;

    // Step 1 + 3: Refresh hot tier (handles both demotion and promotion)
    const hotResult = this.refreshHotTier();
    demoted = hotResult.demoted;

    // Step 2: Archive low-relevance warm -> cold
    const warmMemories = this.store.listByTier("warm", 1000);
    for (const mem of warmMemories) {
      if (shouldArchiveToCold(mem.importance, mem.accessedAt, now, this.tierConfig)) {
        const result = this.archiveToCold(mem);
        if (result !== null) {
          archived++;
        }
      }
    }

    // Re-run promotion after archival (warm pool changed)
    const promoResult = this.refreshHotTier();
    promoted = hotResult.promoted + promoResult.promoted;

    this.log.info({ demoted, archived, promoted }, "maintenance cycle complete");

    return Object.freeze({ demoted, archived, promoted });
  }
}
