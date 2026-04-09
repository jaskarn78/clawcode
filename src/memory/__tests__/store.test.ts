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

    it("defaults importance to 0.5", () => {
      store = createTestStore();
      const entry = store.insert(
        { content: "test", source: "system" },
        randomEmbedding(),
      );

      expect(entry.importance).toBe(0.5);
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
      const sources = ["conversation", "manual", "system"] as const;

      for (const source of sources) {
        const entry = store.insert(
          { content: `test-${source}`, source },
          randomEmbedding(),
        );
        expect(entry.source).toBe(source);
      }
    });
  });
});
