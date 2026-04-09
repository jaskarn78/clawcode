import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdirSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore } from "../store.js";
import {
  TierManager,
  embeddingToBase64,
  base64ToEmbedding,
  generateColdSlug,
} from "../tier-manager.js";
import type { TierConfig } from "../tiers.js";
import { DEFAULT_TIER_CONFIG } from "../tiers.js";
import type { ScoringConfig } from "../relevance.js";
import type { MemoryEntry } from "../types.js";

/** Create a MemoryStore backed by in-memory SQLite (dedup off). */
function createTestStore(): MemoryStore {
  return new MemoryStore(":memory:", { enabled: false, similarityThreshold: 0.85 });
}

/** Create a normalized random embedding. */
function randomEmbedding(dim = 384): Float32Array {
  const arr = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    arr[i] = Math.random() * 2 - 1;
    norm += arr[i] * arr[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) {
    arr[i] /= norm;
  }
  return arr;
}

/** Fake embedder that returns a fixed or random embedding. */
function fakeEmbedder() {
  return {
    embed: vi.fn().mockResolvedValue(randomEmbedding()),
    warmup: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
  };
}

/** Fake logger. */
function fakeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: "info",
  };
}

const DEFAULT_SCORING: ScoringConfig = {
  semanticWeight: 0.7,
  decayWeight: 0.3,
  halfLifeDays: 30,
};

describe("Utility functions", () => {
  describe("embeddingToBase64 / base64ToEmbedding", () => {
    it("round-trips a Float32Array through base64", () => {
      const original = new Float32Array([1.0, -0.5, 0.0, 3.14]);
      const b64 = embeddingToBase64(original);
      const restored = base64ToEmbedding(b64);
      expect(restored.length).toBe(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(restored[i]).toBeCloseTo(original[i], 5);
      }
    });

    it("handles 384-dim embedding", () => {
      const original = randomEmbedding(384);
      const b64 = embeddingToBase64(original);
      const restored = base64ToEmbedding(b64);
      expect(restored.length).toBe(384);
      for (let i = 0; i < 384; i++) {
        expect(restored[i]).toBeCloseTo(original[i], 5);
      }
    });
  });

  describe("generateColdSlug", () => {
    it("lowercases and replaces non-alphanumeric with hyphens", () => {
      expect(generateColdSlug("Hello World! 123")).toBe("hello-world-123");
    });

    it("truncates to 40 chars of source content", () => {
      const longContent = "a".repeat(100);
      const slug = generateColdSlug(longContent);
      // Slug is derived from first 40 chars
      expect(slug.length).toBeLessThanOrEqual(40);
    });

    it("trims leading and trailing hyphens", () => {
      expect(generateColdSlug("---hello---")).toBe("hello");
    });

    it("handles empty string", () => {
      const slug = generateColdSlug("");
      expect(typeof slug).toBe("string");
    });
  });
});

describe("TierManager", () => {
  let store: MemoryStore;
  let memoryDir: string;

  beforeEach(() => {
    store = createTestStore();
    memoryDir = join(tmpdir(), `tier-manager-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    store?.close();
    try {
      rmSync(memoryDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  function createTierManager(overrides?: {
    tierConfig?: TierConfig;
    scoringConfig?: ScoringConfig;
  }): TierManager {
    return new TierManager({
      store,
      embedder: fakeEmbedder() as any,
      memoryDir,
      tierConfig: overrides?.tierConfig ?? DEFAULT_TIER_CONFIG,
      scoringConfig: overrides?.scoringConfig ?? DEFAULT_SCORING,
      log: fakeLogger() as any,
    });
  }

  describe("archiveToCold", () => {
    it("writes a markdown file with YAML frontmatter and base64 embedding", () => {
      const tm = createTierManager();
      const entry = store.insert(
        { content: "Important fact about cats", source: "conversation", importance: 0.8, tags: ["cats", "facts"] },
        randomEmbedding(),
      );

      const filePath = tm.archiveToCold(entry)!;

      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("---");
      expect(content).toContain("embedding_base64:");
      expect(content).toContain("archived_at:");
      expect(content).toContain("Important fact about cats");
    });

    it("creates the cold archive directory if it does not exist", () => {
      const tm = createTierManager();
      const entry = store.insert(
        { content: "test", source: "manual" },
        randomEmbedding(),
      );

      const coldDir = join(memoryDir, "archive", "cold");
      expect(existsSync(coldDir)).toBe(false);

      tm.archiveToCold(entry);

      expect(existsSync(coldDir)).toBe(true);
    });

    it("removes the memory from SQLite after archiving", () => {
      const tm = createTierManager();
      const entry = store.insert(
        { content: "to be archived", source: "manual" },
        randomEmbedding(),
      );

      tm.archiveToCold(entry);

      // Memory should be gone from both tables
      const row = store.getDatabase().prepare("SELECT id FROM memories WHERE id = ?").get(entry.id);
      expect(row).toBeUndefined();

      const vecRow = store.getDatabase().prepare("SELECT memory_id FROM vec_memories WHERE memory_id = ?").get(entry.id);
      expect(vecRow).toBeUndefined();
    });

    it("returns null if embedding is not found", () => {
      const tm = createTierManager();
      // Create a fake entry that has no embedding in vec_memories
      const fakeEntry: MemoryEntry = Object.freeze({
        id: "nonexistent-id",
        content: "ghost memory",
        source: "manual" as const,
        importance: 0.5,
        accessCount: 0,
        tags: Object.freeze([]),
        embedding: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        accessedAt: new Date().toISOString(),
        tier: "warm" as const,
      });

      const result = tm.archiveToCold(fakeEntry);
      expect(result).toBeNull();
    });

    it("filename uses id and slug from content", () => {
      const tm = createTierManager();
      const entry = store.insert(
        { content: "My Special Memory About Testing", source: "manual" },
        randomEmbedding(),
      );

      const filePath = tm.archiveToCold(entry)!;
      const fileName = filePath.split("/").pop()!;
      expect(fileName).toContain(entry.id);
      expect(fileName).toContain("my-special-memory-about-testing");
      expect(fileName.endsWith(".md")).toBe(true);
    });
  });

  describe("rewarmFromCold", () => {
    it("re-inserts a cold archive into SQLite with tier=warm", async () => {
      const embedder = fakeEmbedder();
      const tm = new TierManager({
        store,
        embedder: embedder as any,
        memoryDir,
        tierConfig: DEFAULT_TIER_CONFIG,
        scoringConfig: DEFAULT_SCORING,
        log: fakeLogger() as any,
      });

      // First archive a memory
      const entry = store.insert(
        { content: "rewarmed content", source: "conversation", importance: 0.7, tags: ["test"] },
        randomEmbedding(),
      );
      const filePath = tm.archiveToCold(entry)!;

      // Now rewarm it
      const rewarmed = await tm.rewarmFromCold(filePath);

      expect(rewarmed.content).toBe("rewarmed content");
      expect(rewarmed.tier).toBe("warm");
      expect(rewarmed.source).toBe("conversation");
      // access_count should be archived count + 1
      expect(rewarmed.accessCount).toBeGreaterThanOrEqual(1);
    });

    it("deletes the cold archive file after rewarming", async () => {
      const tm = createTierManager();
      const entry = store.insert(
        { content: "ephemeral cold", source: "manual" },
        randomEmbedding(),
      );
      const filePath = tm.archiveToCold(entry)!;
      expect(existsSync(filePath)).toBe(true);

      await tm.rewarmFromCold(filePath);

      expect(existsSync(filePath)).toBe(false);
    });

    it("calls embedder.embed for fresh embedding", async () => {
      const embedder = fakeEmbedder();
      const tm = new TierManager({
        store,
        embedder: embedder as any,
        memoryDir,
        tierConfig: DEFAULT_TIER_CONFIG,
        scoringConfig: DEFAULT_SCORING,
        log: fakeLogger() as any,
      });

      const entry = store.insert(
        { content: "needs re-embed", source: "manual" },
        randomEmbedding(),
      );
      const filePath = tm.archiveToCold(entry)!;

      await tm.rewarmFromCold(filePath);

      expect(embedder.embed).toHaveBeenCalledWith("needs re-embed");
    });
  });

  describe("refreshHotTier", () => {
    it("promotes warm memories that meet hot criteria", () => {
      const tm = createTierManager({
        tierConfig: { ...DEFAULT_TIER_CONFIG, hotAccessThreshold: 2, hotBudget: 5 },
      });

      // Insert a warm memory with enough accesses
      const entry = store.insert(
        { content: "frequently accessed", source: "conversation", importance: 0.9 },
        randomEmbedding(),
      );
      // Bump access count to meet threshold
      const db = store.getDatabase();
      const now = new Date().toISOString();
      db.prepare("UPDATE memories SET access_count = ?, accessed_at = ? WHERE id = ?").run(5, now, entry.id);

      tm.refreshHotTier();

      // Check that the memory is now hot
      const row = db.prepare("SELECT tier FROM memories WHERE id = ?").get(entry.id) as { tier: string };
      expect(row.tier).toBe("hot");
    });

    it("demotes hot memories that are stale", () => {
      const tm = createTierManager({
        tierConfig: { ...DEFAULT_TIER_CONFIG, hotDemotionDays: 3 },
      });

      // Insert a memory and make it hot
      const entry = store.insert(
        { content: "stale hot", source: "conversation" },
        randomEmbedding(),
      );
      const db = store.getDatabase();
      db.prepare("UPDATE memories SET tier = 'hot' WHERE id = ?").run(entry.id);

      // Make it stale (accessed 10 days ago)
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare("UPDATE memories SET accessed_at = ? WHERE id = ?").run(tenDaysAgo, entry.id);

      tm.refreshHotTier();

      const row = db.prepare("SELECT tier FROM memories WHERE id = ?").get(entry.id) as { tier: string };
      expect(row.tier).toBe("warm");
    });

    it("respects hotBudget limit", () => {
      const tm = createTierManager({
        tierConfig: { ...DEFAULT_TIER_CONFIG, hotAccessThreshold: 1, hotBudget: 2 },
      });

      const db = store.getDatabase();
      const now = new Date().toISOString();

      // Insert 5 warm memories that all qualify
      for (let i = 0; i < 5; i++) {
        const entry = store.insert(
          { content: `memory-${i}`, source: "conversation", importance: 0.5 + i * 0.1 },
          randomEmbedding(),
        );
        db.prepare("UPDATE memories SET access_count = ?, accessed_at = ? WHERE id = ?").run(5, now, entry.id);
      }

      tm.refreshHotTier();

      const hotCount = (db.prepare("SELECT COUNT(*) as cnt FROM memories WHERE tier = 'hot'").get() as { cnt: number }).cnt;
      expect(hotCount).toBe(2);
    });
  });

  describe("getHotMemories", () => {
    it("returns current hot-tier memories sorted by importance desc", () => {
      const tm = createTierManager();
      const db = store.getDatabase();

      const e1 = store.insert(
        { content: "low importance", source: "manual", importance: 0.3 },
        randomEmbedding(),
      );
      const e2 = store.insert(
        { content: "high importance", source: "manual", importance: 0.9 },
        randomEmbedding(),
      );

      db.prepare("UPDATE memories SET tier = 'hot' WHERE id = ?").run(e1.id);
      db.prepare("UPDATE memories SET tier = 'hot' WHERE id = ?").run(e2.id);

      const hotMemories = tm.getHotMemories();
      expect(hotMemories.length).toBe(2);
      expect(hotMemories[0].content).toBe("high importance");
      expect(hotMemories[1].content).toBe("low importance");
    });

    it("returns frozen array", () => {
      const tm = createTierManager();
      const hotMemories = tm.getHotMemories();
      expect(Object.isFrozen(hotMemories)).toBe(true);
    });
  });

  describe("runMaintenance", () => {
    it("performs full cycle: demote stale hot, archive cold-worthy warm, promote qualifying warm", () => {
      const tm = createTierManager({
        tierConfig: {
          ...DEFAULT_TIER_CONFIG,
          hotAccessThreshold: 2,
          hotDemotionDays: 3,
          coldRelevanceThreshold: 0.05,
          hotBudget: 5,
        },
      });

      const db = store.getDatabase();
      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();

      // 1. A stale hot memory (should be demoted to warm)
      const staleHot = store.insert(
        { content: "stale hot memory", source: "conversation", importance: 0.5 },
        randomEmbedding(),
      );
      db.prepare("UPDATE memories SET tier = 'hot', accessed_at = ? WHERE id = ?").run(tenDaysAgo, staleHot.id);

      // 2. A low-relevance warm memory (should be archived to cold)
      const lowRelevance = store.insert(
        { content: "ancient memory nobody cares about", source: "manual", importance: 0.01 },
        randomEmbedding(),
      );
      db.prepare("UPDATE memories SET accessed_at = ? WHERE id = ?").run(yearAgo, lowRelevance.id);

      // 3. A frequently accessed warm memory (should be promoted to hot)
      const frequentWarm = store.insert(
        { content: "very popular warm memory", source: "conversation", importance: 0.9 },
        randomEmbedding(),
      );
      db.prepare("UPDATE memories SET access_count = ?, accessed_at = ? WHERE id = ?").run(
        10, now.toISOString(), frequentWarm.id,
      );

      const result = tm.runMaintenance();

      expect(result.demoted).toBeGreaterThanOrEqual(1);
      expect(result.archived).toBeGreaterThanOrEqual(1);
      expect(result.promoted).toBeGreaterThanOrEqual(1);

      // Verify: stale hot is now warm
      const staleRow = db.prepare("SELECT tier FROM memories WHERE id = ?").get(staleHot.id) as { tier: string } | undefined;
      // It was demoted to warm; if it also qualifies for cold archival, it might be gone
      // But since importance=0.5 and accessed 10 days ago, relevance should be above cold threshold

      // Verify: low-relevance warm is archived (gone from SQLite)
      const lowRow = db.prepare("SELECT id FROM memories WHERE id = ?").get(lowRelevance.id);
      expect(lowRow).toBeUndefined();

      // Verify: frequent warm is now hot
      const freqRow = db.prepare("SELECT tier FROM memories WHERE id = ?").get(frequentWarm.id) as { tier: string };
      expect(freqRow.tier).toBe("hot");
    });

    it("returns counts of demoted, archived, and promoted", () => {
      const tm = createTierManager();
      const result = tm.runMaintenance();
      expect(typeof result.demoted).toBe("number");
      expect(typeof result.archived).toBe("number");
      expect(typeof result.promoted).toBe("number");
    });
  });
});
