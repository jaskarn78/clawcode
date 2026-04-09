import { describe, it, expect, afterEach } from "vitest";
import { MemoryStore } from "../store.js";
import { SemanticSearch } from "../search.js";

function createTestStore(): MemoryStore {
  return new MemoryStore(":memory:");
}

/** Create a normalized random vector. */
function randomEmbedding(): Float32Array {
  const arr = new Float32Array(384);
  let norm = 0;
  for (let i = 0; i < 384; i++) {
    arr[i] = Math.random() * 2 - 1;
    norm += arr[i] * arr[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < 384; i++) {
    arr[i] /= norm;
  }
  return arr;
}

/** Create a vector pointing in a specific direction (for predictable similarity). */
function directionalEmbedding(dim: number, value: number): Float32Array {
  const arr = new Float32Array(384);
  arr[dim] = value;
  // Normalize
  const norm = Math.abs(value);
  if (norm > 0) {
    arr[dim] /= norm;
  }
  return arr;
}

describe("SemanticSearch", () => {
  let store: MemoryStore;

  afterEach(() => {
    store?.close();
  });

  it("search returns results ordered by distance (nearest first)", () => {
    store = createTestStore();
    const db = store.getDatabase();
    const search = new SemanticSearch(db);

    // Create query vector pointing in dimension 0
    const queryVec = directionalEmbedding(0, 1.0);

    // Create similar vector (close to query)
    const similarVec = new Float32Array(384);
    similarVec[0] = 0.9;
    similarVec[1] = 0.1;
    const norm1 = Math.sqrt(0.81 + 0.01);
    similarVec[0] /= norm1;
    similarVec[1] /= norm1;

    // Create dissimilar vector (far from query)
    const dissimilarVec = directionalEmbedding(1, 1.0);

    store.insert({ content: "dissimilar", source: "manual" }, dissimilarVec);
    store.insert({ content: "similar", source: "manual" }, similarVec);

    const results = search.search(queryVec, 10);
    expect(results.length).toBe(2);
    expect(results[0].content).toBe("similar");
    expect(results[1].content).toBe("dissimilar");
    expect(results[0].distance).toBeLessThan(results[1].distance);
  });

  it("search respects topK limit", () => {
    store = createTestStore();
    const db = store.getDatabase();
    const search = new SemanticSearch(db);

    // Insert 5 memories
    for (let i = 0; i < 5; i++) {
      store.insert(
        { content: `memory-${i}`, source: "manual" },
        randomEmbedding(),
      );
    }

    const results = search.search(randomEmbedding(), 2);
    expect(results.length).toBe(2);
  });

  it("search updates access_count for returned results", () => {
    store = createTestStore();
    const db = store.getDatabase();
    const search = new SemanticSearch(db);

    const entry = store.insert(
      { content: "tracked", source: "manual" },
      randomEmbedding(),
    );

    // Initial access_count is 0
    expect(entry.accessCount).toBe(0);

    // Search should increment access_count
    search.search(randomEmbedding(), 10);

    // Verify via direct DB query (bypass getById which also increments)
    const row = db
      .prepare("SELECT access_count FROM memories WHERE id = ?")
      .get(entry.id) as { access_count: number };
    expect(row.access_count).toBe(1);
  });

  it("search updates accessed_at for returned results", () => {
    store = createTestStore();
    const db = store.getDatabase();
    const search = new SemanticSearch(db);

    const entry = store.insert(
      { content: "tracked", source: "manual" },
      randomEmbedding(),
    );

    const results = search.search(randomEmbedding(), 10);
    expect(results.length).toBe(1);
    expect(results[0].accessedAt).toBeTruthy();
    // accessed_at should be >= original
    expect(results[0].accessedAt >= entry.createdAt).toBe(true);
  });

  it("search with no matching embeddings returns empty array", () => {
    store = createTestStore();
    const db = store.getDatabase();
    const search = new SemanticSearch(db);

    // No memories inserted
    const results = search.search(randomEmbedding(), 10);
    expect(results).toEqual([]);
  });

  it("search results are frozen (readonly)", () => {
    store = createTestStore();
    const db = store.getDatabase();
    const search = new SemanticSearch(db);

    store.insert(
      { content: "test", source: "manual" },
      randomEmbedding(),
    );

    const results = search.search(randomEmbedding(), 10);
    expect(Object.isFrozen(results)).toBe(true);
    if (results.length > 0) {
      expect(Object.isFrozen(results[0])).toBe(true);
    }
  });
});
