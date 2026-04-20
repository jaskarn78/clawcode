import { describe, it, expect, afterEach } from "vitest";
import { MemoryStore } from "../store.js";
import { MemoryError } from "../errors.js";

function createTestStore(): MemoryStore {
  return new MemoryStore(":memory:");
}

function randomEmbedding(): Float32Array {
  const arr = new Float32Array(384);
  for (let i = 0; i < 384; i++) {
    arr[i] = Math.random() * 2 - 1;
  }
  return arr;
}

describe("MemoryStore", () => {
  let store: MemoryStore;

  afterEach(() => {
    store?.close();
  });

  describe("constructor", () => {
    it("creates all required tables", () => {
      store = createTestStore();
      const db = store.getDatabase();

      // Check memories table
      const memoriesInfo = db
        .prepare("PRAGMA table_info(memories)")
        .all() as Array<{ name: string }>;
      const memoryColumns = memoriesInfo.map((c) => c.name);
      expect(memoryColumns).toContain("id");
      expect(memoryColumns).toContain("content");
      expect(memoryColumns).toContain("source");
      expect(memoryColumns).toContain("importance");
      expect(memoryColumns).toContain("access_count");
      expect(memoryColumns).toContain("tags");
      expect(memoryColumns).toContain("created_at");
      expect(memoryColumns).toContain("updated_at");
      expect(memoryColumns).toContain("accessed_at");

      // Check session_logs table
      const sessionInfo = db
        .prepare("PRAGMA table_info(session_logs)")
        .all() as Array<{ name: string }>;
      const sessionColumns = sessionInfo.map((c) => c.name);
      expect(sessionColumns).toContain("id");
      expect(sessionColumns).toContain("date");
      expect(sessionColumns).toContain("file_path");
      expect(sessionColumns).toContain("entry_count");
      expect(sessionColumns).toContain("created_at");

      // Check vec_memories virtual table exists (query it)
      const vecCount = db
        .prepare("SELECT count(*) as cnt FROM vec_memories")
        .get() as { cnt: number };
      expect(vecCount.cnt).toBe(0);
    });
  });

  describe("insert", () => {
    it("creates memory with all fields populated", () => {
      store = createTestStore();
      const embedding = randomEmbedding();

      const entry = store.insert(
        {
          content: "test content",
          source: "conversation",
          importance: 0.8,
          tags: ["tag1", "tag2"],
        },
        embedding,
      );

      expect(entry.id).toBeTruthy();
      expect(entry.content).toBe("test content");
      expect(entry.source).toBe("conversation");
      expect(entry.importance).toBe(0.8);
      expect(entry.accessCount).toBe(0);
      expect(entry.tags).toEqual(["tag1", "tag2"]);
      expect(entry.embedding).toBe(embedding);
      expect(entry.createdAt).toBeTruthy();
      expect(entry.updatedAt).toBeTruthy();
      expect(entry.accessedAt).toBeTruthy();
    });

    it("returns a frozen (readonly) entry", () => {
      store = createTestStore();
      const entry = store.insert(
        { content: "test", source: "manual" },
        randomEmbedding(),
      );

      expect(Object.isFrozen(entry)).toBe(true);
    });

    it("stores embedding in vec_memories", () => {
      store = createTestStore();
      const db = store.getDatabase();

      store.insert(
        { content: "test", source: "manual" },
        randomEmbedding(),
      );

      const vecCount = db
        .prepare("SELECT count(*) as cnt FROM vec_memories")
        .get() as { cnt: number };
      expect(vecCount.cnt).toBe(1);
    });

    it("auto-calculates importance when not explicitly provided", () => {
      store = createTestStore();
      const entry = store.insert(
        { content: "test", source: "system" },
        randomEmbedding(),
      );

      // Short content gets low score from calculateImportance (recencyBoost + tiny lengthScore)
      expect(entry.importance).toBeGreaterThan(0);
      expect(entry.importance).toBeLessThan(0.5);
    });

    it("defaults tags to empty array", () => {
      store = createTestStore();
      const entry = store.insert(
        { content: "test", source: "system" },
        randomEmbedding(),
      );

      expect(entry.tags).toEqual([]);
    });
  });

  describe("getById", () => {
    it("returns entry and increments access_count", () => {
      store = createTestStore();
      const created = store.insert(
        { content: "findme", source: "conversation" },
        randomEmbedding(),
      );

      const found = store.getById(created.id);
      expect(found).not.toBeNull();
      expect(found!.content).toBe("findme");
      expect(found!.accessCount).toBe(1);

      // Second access should increment again
      const found2 = store.getById(created.id);
      expect(found2!.accessCount).toBe(2);
    });

    it("updates accessed_at on retrieval", () => {
      store = createTestStore();
      const created = store.insert(
        { content: "test", source: "manual" },
        randomEmbedding(),
      );

      const found = store.getById(created.id);
      expect(found!.accessedAt).toBeTruthy();
      // accessed_at should be >= created_at
      expect(found!.accessedAt >= created.createdAt).toBe(true);
    });

    it("returns null for non-existent ID", () => {
      store = createTestStore();
      const result = store.getById("nonexistent-id");
      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("removes from both memories and vec_memories", () => {
      store = createTestStore();
      const db = store.getDatabase();
      const created = store.insert(
        { content: "deleteme", source: "manual" },
        randomEmbedding(),
      );

      const deleted = store.delete(created.id);
      expect(deleted).toBe(true);

      // Verify gone from memories
      expect(store.getById(created.id)).toBeNull();

      // Verify gone from vec_memories
      const vecCount = db
        .prepare("SELECT count(*) as cnt FROM vec_memories")
        .get() as { cnt: number };
      expect(vecCount.cnt).toBe(0);
    });

    it("returns false for non-existent ID", () => {
      store = createTestStore();
      expect(store.delete("nonexistent")).toBe(false);
    });
  });

  describe("listRecent", () => {
    it("returns entries ordered by created_at DESC", () => {
      store = createTestStore();

      // Insert with slight delays to ensure different timestamps
      store.insert({ content: "first", source: "manual" }, randomEmbedding());
      store.insert(
        { content: "second", source: "manual" },
        randomEmbedding(),
      );
      store.insert({ content: "third", source: "manual" }, randomEmbedding());

      const recent = store.listRecent(10);
      expect(recent).toHaveLength(3);
      // Most recent first
      expect(recent[0].content).toBe("third");
      expect(recent[2].content).toBe("first");
    });

    it("respects limit parameter", () => {
      store = createTestStore();
      store.insert({ content: "a", source: "manual" }, randomEmbedding());
      store.insert({ content: "b", source: "manual" }, randomEmbedding());
      store.insert({ content: "c", source: "manual" }, randomEmbedding());

      const recent = store.listRecent(2);
      expect(recent).toHaveLength(2);
    });
  });

  describe("recordSessionLog", () => {
    it("creates session log entry with all fields", () => {
      store = createTestStore();

      const entry = store.recordSessionLog({
        date: "2026-04-09",
        filePath: "/memory/2026-04-09.md",
        entryCount: 5,
      });

      expect(entry.id).toBeTruthy();
      expect(entry.date).toBe("2026-04-09");
      expect(entry.filePath).toBe("/memory/2026-04-09.md");
      expect(entry.entryCount).toBe(5);
      expect(entry.createdAt).toBeTruthy();
      expect(Object.isFrozen(entry)).toBe(true);
    });
  });

  describe("deduplication on insert", () => {
    /** Create a normalized directional embedding. */
    function directionalEmbedding(dim: number, value: number): Float32Array {
      const arr = new Float32Array(384);
      arr[dim] = value;
      const norm = Math.abs(value);
      if (norm > 0) arr[dim] /= norm;
      return arr;
    }

    it("merges near-duplicate embedding instead of creating two entries", () => {
      store = new MemoryStore(":memory:", { enabled: true, similarityThreshold: 0.85 });
      const vec = directionalEmbedding(0, 1.0);

      store.insert({ content: "original", source: "manual" }, vec);
      store.insert({ content: "duplicate", source: "manual" }, vec);

      const list = store.listRecent(100);
      expect(list.length).toBe(1);
      expect(list[0].content).toBe("duplicate");
    });

    it("merged entry keeps max importance and union of tags", () => {
      store = new MemoryStore(":memory:", { enabled: true, similarityThreshold: 0.85 });
      const vec = directionalEmbedding(0, 1.0);

      store.insert(
        { content: "original", source: "manual", importance: 0.3, tags: ["a"] },
        vec,
      );
      store.insert(
        { content: "updated", source: "manual", importance: 0.8, tags: ["b"] },
        vec,
      );

      const list = store.listRecent(100);
      expect(list.length).toBe(1);
      expect(list[0].importance).toBe(0.8);
      expect([...list[0].tags].sort()).toEqual(["a", "b"]);
    });

    it("skipDedup creates new entry even with duplicate embedding", () => {
      store = new MemoryStore(":memory:", { enabled: true, similarityThreshold: 0.85 });
      const vec = directionalEmbedding(0, 1.0);

      store.insert({ content: "original", source: "manual" }, vec);
      store.insert({ content: "skip-dedup", source: "manual", skipDedup: true }, vec);

      const list = store.listRecent(100);
      expect(list.length).toBe(2);
    });

    it("first insert into empty DB succeeds normally", () => {
      store = new MemoryStore(":memory:", { enabled: true, similarityThreshold: 0.85 });
      const vec = directionalEmbedding(0, 1.0);

      const entry = store.insert({ content: "first", source: "manual" }, vec);
      expect(entry.content).toBe("first");
      expect(entry.id).toBeTruthy();
    });
  });

  describe("tier column migration", () => {
    it("tier column exists after store creation", () => {
      store = createTestStore();
      const db = store.getDatabase();

      const columns = db
        .prepare("PRAGMA table_info(memories)")
        .all() as Array<{ name: string }>;
      const columnNames = columns.map((c) => c.name);
      expect(columnNames).toContain("tier");
    });

    it("new memories default to warm tier", () => {
      store = createTestStore();
      const entry = store.insert(
        { content: "tier test", source: "manual" },
        randomEmbedding(),
      );

      expect(entry.tier).toBe("warm");

      // Also verify from DB directly
      const db = store.getDatabase();
      const row = db
        .prepare("SELECT tier FROM memories WHERE id = ?")
        .get(entry.id) as { tier: string };
      expect(row.tier).toBe("warm");
    });
  });

  describe("updateTier", () => {
    it("changes the tier value", () => {
      store = createTestStore();
      const entry = store.insert(
        { content: "update tier", source: "manual" },
        randomEmbedding(),
      );

      const updated = store.updateTier(entry.id, "hot");
      expect(updated).toBe(true);

      const db = store.getDatabase();
      const row = db
        .prepare("SELECT tier FROM memories WHERE id = ?")
        .get(entry.id) as { tier: string };
      expect(row.tier).toBe("hot");
    });

    it("returns false for non-existent ID", () => {
      store = createTestStore();
      expect(store.updateTier("nonexistent", "cold")).toBe(false);
    });

    it("can set tier to cold", () => {
      store = createTestStore();
      const entry = store.insert(
        { content: "cold test", source: "manual" },
        randomEmbedding(),
      );

      store.updateTier(entry.id, "cold");

      const db = store.getDatabase();
      const row = db
        .prepare("SELECT tier FROM memories WHERE id = ?")
        .get(entry.id) as { tier: string };
      expect(row.tier).toBe("cold");
    });
  });

  describe("listByTier", () => {
    it("filters by tier correctly", () => {
      store = createTestStore();
      const e1 = store.insert(
        { content: "warm1", source: "manual" },
        randomEmbedding(),
      );
      const e2 = store.insert(
        { content: "warm2", source: "manual" },
        randomEmbedding(),
      );
      store.insert(
        { content: "warm3", source: "manual" },
        randomEmbedding(),
      );

      // Promote one to hot, one to cold
      store.updateTier(e1.id, "hot");
      store.updateTier(e2.id, "cold");

      const warm = store.listByTier("warm", 100);
      expect(warm).toHaveLength(1);
      expect(warm[0].content).toBe("warm3");

      const hot = store.listByTier("hot", 100);
      expect(hot).toHaveLength(1);
      expect(hot[0].content).toBe("warm1");

      const cold = store.listByTier("cold", 100);
      expect(cold).toHaveLength(1);
      expect(cold[0].content).toBe("warm2");
    });

    it("respects limit parameter", () => {
      store = createTestStore();
      for (let i = 0; i < 5; i++) {
        store.insert(
          { content: `entry${i}`, source: "manual" },
          randomEmbedding(),
        );
      }

      const limited = store.listByTier("warm", 2);
      expect(limited).toHaveLength(2);
    });

    it("returns frozen array", () => {
      store = createTestStore();
      store.insert(
        { content: "test", source: "manual" },
        randomEmbedding(),
      );

      const results = store.listByTier("warm", 10);
      expect(Object.isFrozen(results)).toBe(true);
    });
  });

  describe("getEmbedding", () => {
    it("returns Float32Array for existing memory", () => {
      store = createTestStore();
      const embedding = randomEmbedding();
      const entry = store.insert(
        { content: "embed test", source: "manual" },
        embedding,
      );

      const retrieved = store.getEmbedding(entry.id);
      expect(retrieved).toBeInstanceOf(Float32Array);
      expect(retrieved).toHaveLength(384);
    });

    it("returns null for non-existent memory", () => {
      store = createTestStore();
      const result = store.getEmbedding("nonexistent-id");
      expect(result).toBeNull();
    });
  });

  describe("source validation", () => {
    it("rejects invalid source values", () => {
      store = createTestStore();

      expect(() =>
        store.insert(
          { content: "test", source: "invalid" as any },
          randomEmbedding(),
        ),
      ).toThrow();
    });

    it("accepts all valid source values", () => {
      store = createTestStore();
      const sources = ["conversation", "manual", "system", "episode"] as const;

      for (const source of sources) {
        const entry = store.insert(
          { content: `test-${source}`, source },
          randomEmbedding(),
        );
        expect(entry.source).toBe(source);
      }
    });
  });

  describe("origin_id idempotency (Phase 80 MEM-02)", () => {
    it("origin_id column exists after MemoryStore construction", () => {
      store = createTestStore();
      const db = store.getDatabase();
      const columns = db
        .prepare("PRAGMA table_info(memories)")
        .all() as Array<{ name: string; type: string }>;
      const originRow = columns.find((c) => c.name === "origin_id");
      expect(originRow).toBeDefined();
      expect(originRow!.type).toBe("TEXT");
    });

    it("origin_id UNIQUE index is present on memories table", () => {
      store = createTestStore();
      const db = store.getDatabase();
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='memories'",
        )
        .all() as Array<{ name: string }>;
      const hasOriginIdIndex = indexes.some((i) => /origin_id/i.test(i.name));
      expect(hasOriginIdIndex).toBe(true);
    });

    it("migration is idempotent — re-opening DB does not throw and column count is stable", () => {
      // Use a tmp-file DB so it survives close/reopen (":memory:" doesn't).
      const tmpPath = `/tmp/store-origin-id-idempotent-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
      const first = new MemoryStore(tmpPath);
      const colsBefore = (first.getDatabase()
        .prepare("PRAGMA table_info(memories)")
        .all() as Array<{ name: string }>).length;
      first.close();

      // Re-opening must not throw and must leave column count unchanged.
      expect(() => {
        const second = new MemoryStore(tmpPath);
        const colsAfter = (second.getDatabase()
          .prepare("PRAGMA table_info(memories)")
          .all() as Array<{ name: string }>).length;
        expect(colsAfter).toBe(colsBefore);
        second.close();
      }).not.toThrow();
    });

    it("existing rows with NULL origin_id coexist under UNIQUE (no collision on NULL=NULL)", () => {
      store = createTestStore();
      const db = store.getDatabase();

      store.insert(
        { content: "row one", source: "manual" },
        randomEmbedding(),
      );
      store.insert(
        { content: "row two", source: "manual" },
        randomEmbedding(),
      );

      const nullCount = db
        .prepare(
          "SELECT COUNT(*) as cnt FROM memories WHERE origin_id IS NULL",
        )
        .get() as { cnt: number };
      expect(nullCount.cnt).toBe(2);
    });

    it("CreateMemoryInput.origin_id is optional — insert accepts with AND without", () => {
      store = createTestStore();

      // Without origin_id (existing behavior).
      const withoutOrigin = store.insert(
        { content: "no origin", source: "manual", skipDedup: true },
        randomEmbedding(),
      );
      expect(withoutOrigin.id).toBeTruthy();

      // With origin_id (Task 2 tests full semantics; here we only assert the
      // type accepts the field and insert() does not throw).
      const withOrigin = store.insert(
        {
          content: "has origin",
          source: "manual",
          skipDedup: true,
          origin_id: "openclaw:test:column-accepts-field",
        },
        randomEmbedding(),
      );
      expect(withOrigin.id).toBeTruthy();
    });
  });

  describe("sourceTurnIds (CONV-03 write path)", () => {
    it("sourceTurnIds input is returned on insert (not null)", () => {
      store = createTestStore();
      const entry = store.insert(
        {
          content: "test content with lineage",
          source: "conversation",
          skipDedup: true,
          sourceTurnIds: ["turn-a", "turn-b"],
        },
        randomEmbedding(),
      );
      expect(entry.sourceTurnIds).toEqual(["turn-a", "turn-b"]);
      expect(Object.isFrozen(entry.sourceTurnIds)).toBe(true);
    });

    it("source_turn_ids roundtrip preserves exact array on getById", () => {
      store = createTestStore();
      const entry = store.insert(
        {
          content: "roundtrip test content",
          source: "conversation",
          skipDedup: true,
          sourceTurnIds: ["t1", "t2", "t3"],
        },
        randomEmbedding(),
      );
      const fetched = store.getById(entry.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.sourceTurnIds).toEqual(["t1", "t2", "t3"]);
      expect(Object.isFrozen(fetched!.sourceTurnIds)).toBe(true);
    });

    it("omitted sourceTurnIds yields null", () => {
      store = createTestStore();
      const entry = store.insert(
        {
          content: "no lineage here",
          source: "manual",
          skipDedup: true,
        },
        randomEmbedding(),
      );
      expect(entry.sourceTurnIds).toBeNull();
      const fetched = store.getById(entry.id);
      expect(fetched!.sourceTurnIds).toBeNull();
    });

    it("empty sourceTurnIds array yields null (treated as no lineage)", () => {
      store = createTestStore();
      const entry = store.insert(
        {
          content: "empty lineage",
          source: "conversation",
          skipDedup: true,
          sourceTurnIds: [],
        },
        randomEmbedding(),
      );
      expect(entry.sourceTurnIds).toBeNull();
    });

    it("source_turn_ids column stores JSON string in DB", () => {
      store = createTestStore();
      const entry = store.insert(
        {
          content: "check raw column",
          source: "conversation",
          skipDedup: true,
          sourceTurnIds: ["alpha", "beta"],
        },
        randomEmbedding(),
      );
      const db = store.getDatabase();
      const row = db
        .prepare("SELECT source_turn_ids FROM memories WHERE id = ?")
        .get(entry.id) as { source_turn_ids: string | null };
      expect(row.source_turn_ids).toBe('["alpha","beta"]');
    });
  });
});
