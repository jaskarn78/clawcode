import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { extractWikilinks, traverseGraph } from "../graph.js";
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
