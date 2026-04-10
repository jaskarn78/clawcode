import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { extractWikilinks, traverseGraph, getBacklinks, getForwardLinks } from "../graph.js";
import { MemoryStore } from "../store.js";
import type { Database as DatabaseType } from "better-sqlite3";

describe("extractWikilinks", () => {
  it("extracts a single wikilink", () => {
    expect(extractWikilinks("Hello [[abc123]] world")).toEqual(["abc123"]);
  });

  it("extracts multiple wikilinks", () => {
    expect(extractWikilinks("[[a]] and [[b]] linked")).toEqual(["a", "b"]);
  });

  it("deduplicates repeated wikilinks", () => {
    expect(extractWikilinks("[[a]] duplicate [[a]]")).toEqual(["a"]);
  });

  it("returns empty array for no links", () => {
    expect(extractWikilinks("no links here")).toEqual([]);
  });

  it("ignores empty brackets", () => {
    expect(extractWikilinks("empty [[]] brackets")).toEqual([]);
  });

  it("trims whitespace inside brackets", () => {
    expect(extractWikilinks("  [[ spaced ]]  ")).toEqual(["spaced"]);
  });

  it("handles regex lastIndex correctly across calls", () => {
    const first = extractWikilinks("[[x]] and [[y]]");
    const second = extractWikilinks("[[z]]");
    expect(first).toEqual(["x", "y"]);
    expect(second).toEqual(["z"]);
  });
});

describe("traverseGraph", () => {
  it("traverses a linear chain", () => {
    const neighbors: Record<string, readonly string[]> = {
      A: ["B"],
      B: ["C"],
      C: [],
    };
    const result = traverseGraph("A", (id) => neighbors[id] ?? [], 2);
    expect(result).toEqual(new Set(["B", "C"]));
  });

  it("terminates on circular references", () => {
    const neighbors: Record<string, readonly string[]> = {
      A: ["B"],
      B: ["C"],
      C: ["A"],
    };
    const result = traverseGraph("A", (id) => neighbors[id] ?? [], 10);
    expect(result).toEqual(new Set(["B", "C"]));
  });

  it("respects depth limit", () => {
    const neighbors: Record<string, readonly string[]> = {
      A: ["B"],
      B: ["C"],
      C: [],
    };
    const result = traverseGraph("A", (id) => neighbors[id] ?? [], 1);
    expect(result).toEqual(new Set(["B"]));
  });

  it("returns empty set when no neighbors", () => {
    const result = traverseGraph("A", () => [], 5);
    expect(result).toEqual(new Set());
  });
});

/** Zero-vector embedding for test inserts. */
const zeroEmbedding = () => new Float32Array(384);

/** Row shape from memory_links table. */
type LinkRow = {
  readonly source_id: string;
  readonly target_id: string;
  readonly link_text: string;
  readonly created_at: string;
};

describe("MemoryStore graph integration", () => {
  let store: MemoryStore;
  let db: DatabaseType;

  beforeEach(() => {
    store = new MemoryStore(":memory:", { enabled: false, similarityThreshold: 0.85 });
    db = store.getDatabase();
  });

  afterEach(() => {
    store.close();
  });

  it("creates an edge when inserting memory with wikilink to existing memory", () => {
    // Insert target memory B first
    const memB = store.insert(
      { content: "I am memory B", source: "manual", skipDedup: true },
      zeroEmbedding(),
    );

    // Insert memory A linking to B
    store.insert(
      { content: `links to [[${memB.id}]]`, source: "manual", skipDedup: true },
      zeroEmbedding(),
    );

    const links = db.prepare("SELECT * FROM memory_links").all() as LinkRow[];
    expect(links).toHaveLength(1);
    expect(links[0].target_id).toBe(memB.id);
  });

  it("creates no edge for nonexistent target", () => {
    store.insert(
      { content: "links to [[nonexistent-id]]", source: "manual", skipDedup: true },
      zeroEmbedding(),
    );

    const links = db.prepare("SELECT * FROM memory_links").all() as LinkRow[];
    expect(links).toHaveLength(0);
  });

  it("creates multiple edges for multiple existing targets", () => {
    const memB = store.insert(
      { content: "B content", source: "manual", skipDedup: true },
      zeroEmbedding(),
    );
    const memC = store.insert(
      { content: "C content", source: "manual", skipDedup: true },
      zeroEmbedding(),
    );

    store.insert(
      { content: `links to [[${memB.id}]] and [[${memC.id}]]`, source: "manual", skipDedup: true },
      zeroEmbedding(),
    );

    const links = db.prepare("SELECT * FROM memory_links").all() as LinkRow[];
    expect(links).toHaveLength(2);
    const targetIds = links.map((l) => l.target_id).sort();
    expect(targetIds).toEqual([memB.id, memC.id].sort());
  });

  it("cascades edge deletion when target memory is deleted", () => {
    const memB = store.insert(
      { content: "B content", source: "manual", skipDedup: true },
      zeroEmbedding(),
    );
    store.insert(
      { content: `links to [[${memB.id}]]`, source: "manual", skipDedup: true },
      zeroEmbedding(),
    );

    // Verify edge exists
    let links = db.prepare("SELECT * FROM memory_links").all() as LinkRow[];
    expect(links).toHaveLength(1);

    // Delete target -- CASCADE should remove edges
    store.delete(memB.id);

    links = db.prepare("SELECT * FROM memory_links").all() as LinkRow[];
    expect(links).toHaveLength(0);
  });

  it("prevents duplicate edges via composite primary key", () => {
    const memB = store.insert(
      { content: "B content", source: "manual", skipDedup: true },
      zeroEmbedding(),
    );

    // Insert two memories with the same wikilink to B
    store.insert(
      { content: `first [[${memB.id}]]`, source: "manual", skipDedup: true },
      zeroEmbedding(),
    );
    store.insert(
      { content: `second [[${memB.id}]]`, source: "manual", skipDedup: true },
      zeroEmbedding(),
    );

    const links = db.prepare("SELECT * FROM memory_links WHERE target_id = ?").all(memB.id) as LinkRow[];
    // Two different sources linking to B = 2 edges (different source_ids)
    expect(links).toHaveLength(2);
  });
});

describe("getBacklinks and getForwardLinks", () => {
  let store: MemoryStore;
  let db: DatabaseType;

  beforeEach(() => {
    store = new MemoryStore(":memory:", { enabled: false, similarityThreshold: 0.85 });
    db = store.getDatabase();
  });

  afterEach(() => {
    store.close();
  });

  /** Insert a memory with a known ID directly into SQLite. */
  function insertWithKnownId(id: string, content: string): void {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO memories (id, content, source, importance, access_count, tags, created_at, updated_at, accessed_at, tier)
       VALUES (?, ?, 'manual', 0.5, 0, '[]', ?, ?, ?, 'warm')`,
    ).run(id, content, now, now, now);
    db.prepare("INSERT INTO vec_memories (memory_id, embedding) VALUES (?, ?)").run(
      id,
      zeroEmbedding(),
    );
  }

  it("getBacklinks returns memories that link to a target", () => {
    // Insert target B with known ID
    insertWithKnownId("B-id", "I am memory B");

    // Insert memory A that links to B via store.insert (triggers edge creation)
    const memA = store.insert(
      { content: "A links to [[B-id]]", source: "manual", skipDedup: true },
      zeroEmbedding(),
    );

    const results = getBacklinks(store, "B-id");
    expect(results).toHaveLength(1);
    expect(results[0].memory.id).toBe(memA.id);
    expect(results[0].linkText).toBe("B-id");
  });

  it("getBacklinks returns empty array for nonexistent target", () => {
    const results = getBacklinks(store, "nonexistent");
    expect(results).toHaveLength(0);
  });

  it("getForwardLinks returns memories that a source links to", () => {
    // Insert targets B and C with known IDs
    insertWithKnownId("B-id", "I am B");
    insertWithKnownId("C-id", "I am C");

    // Insert A linking to both B and C
    store.insert(
      { content: "A links to [[B-id]] and [[C-id]]", source: "manual", skipDedup: true },
      zeroEmbedding(),
    );

    // Get forward links from A (need to find A's ID first)
    const links = db.prepare("SELECT source_id FROM memory_links LIMIT 1").get() as { source_id: string };
    const results = getForwardLinks(store, links.source_id);
    expect(results).toHaveLength(2);
    const targetIds = results.map((r) => r.memory.id).sort();
    expect(targetIds).toEqual(["B-id", "C-id"]);
  });

  it("getForwardLinks returns empty array for memory with no outbound links", () => {
    insertWithKnownId("isolated", "No outbound links here");
    const results = getForwardLinks(store, "isolated");
    expect(results).toHaveLength(0);
  });

  it("results are frozen", () => {
    insertWithKnownId("B-id", "target");
    store.insert(
      { content: "links to [[B-id]]", source: "manual", skipDedup: true },
      zeroEmbedding(),
    );

    const backlinks = getBacklinks(store, "B-id");
    expect(Object.isFrozen(backlinks)).toBe(true);
    expect(Object.isFrozen(backlinks[0])).toBe(true);

    const links = db.prepare("SELECT source_id FROM memory_links LIMIT 1").get() as { source_id: string };
    const forwards = getForwardLinks(store, links.source_id);
    expect(Object.isFrozen(forwards)).toBe(true);
    expect(Object.isFrozen(forwards[0])).toBe(true);
  });

  it("results are ordered by created_at DESC", () => {
    insertWithKnownId("target-id", "the target");

    // Insert two memories linking to target at different times
    // Use direct SQL to control created_at ordering
    const oldTime = "2024-01-01T00:00:00Z";
    const newTime = "2025-01-01T00:00:00Z";
    db.prepare(
      `INSERT INTO memories (id, content, source, importance, access_count, tags, created_at, updated_at, accessed_at, tier)
       VALUES (?, ?, 'manual', 0.5, 0, '[]', ?, ?, ?, 'warm')`,
    ).run("old-linker", "links to [[target-id]]", oldTime, oldTime, oldTime);
    db.prepare("INSERT INTO vec_memories (memory_id, embedding) VALUES (?, ?)").run("old-linker", zeroEmbedding());
    db.prepare("INSERT INTO memory_links (source_id, target_id, link_text, created_at) VALUES (?, ?, ?, ?)").run(
      "old-linker", "target-id", "target-id", oldTime,
    );

    db.prepare(
      `INSERT INTO memories (id, content, source, importance, access_count, tags, created_at, updated_at, accessed_at, tier)
       VALUES (?, ?, 'manual', 0.5, 0, '[]', ?, ?, ?, 'warm')`,
    ).run("new-linker", "also links to [[target-id]]", newTime, newTime, newTime);
    db.prepare("INSERT INTO vec_memories (memory_id, embedding) VALUES (?, ?)").run("new-linker", zeroEmbedding());
    db.prepare("INSERT INTO memory_links (source_id, target_id, link_text, created_at) VALUES (?, ?, ?, ?)").run(
      "new-linker", "target-id", "target-id", newTime,
    );

    const results = getBacklinks(store, "target-id");
    expect(results).toHaveLength(2);
    // DESC order: newest first
    expect(results[0].memory.id).toBe("new-linker");
    expect(results[1].memory.id).toBe("old-linker");
  });
});
