/**
 * Cosine similarity utility and auto-link discovery for the knowledge graph.
 *
 * The auto-linker scans for semantically similar unlinked memories and
 * creates bidirectional edges between them, enriching the knowledge graph
 * without relying on manual wikilinks.
 */

import type { MemoryStore } from "./store.js";

/**
 * Compute cosine similarity between two L2-normalized vectors.
 * Since embeddings from EmbeddingService are pre-normalized, dot product = cosine similarity.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/** Configuration for the auto-link discovery process. */
export type AutoLinkConfig = {
  readonly similarityThreshold: number; // default 0.6
  readonly batchSize: number; // default 50
};

/** Result of an auto-link discovery run. */
export type AutoLinkResult = {
  readonly linksCreated: number;
  readonly pairsScanned: number;
  readonly skippedExisting: number;
};

const DEFAULT_CONFIG: AutoLinkConfig = {
  similarityThreshold: 0.6,
  batchSize: 50,
};

/**
 * Discover and create bidirectional edges between semantically similar unlinked memories.
 *
 * Algorithm:
 * 1. Find recent non-cold memories that have no outbound auto-created edges
 * 2. For each candidate, find top-5 KNN neighbors via sqlite-vec
 * 3. For each similar pair above threshold, create bidirectional edges
 * 4. Skip already-linked pairs and memories without embeddings
 *
 * All operations are wrapped in a transaction for atomicity.
 */
export function discoverAutoLinks(
  store: MemoryStore,
  config?: Partial<AutoLinkConfig>,
): AutoLinkResult {
  const merged: AutoLinkConfig = { ...DEFAULT_CONFIG, ...config };
  const db = store.getDatabase();

  let linksCreated = 0;
  let pairsScanned = 0;
  let skippedExisting = 0;

  const run = db.transaction(() => {
    // Step 1: Find candidate memories (non-cold, no existing auto-links outbound)
    const candidates = db
      .prepare(
        `SELECT m.id FROM memories m
         WHERE m.tier != 'cold'
           AND NOT EXISTS (
             SELECT 1 FROM memory_links ml
             WHERE ml.source_id = m.id AND ml.link_text = 'auto:similar'
           )
         ORDER BY m.created_at DESC
         LIMIT ?`,
      )
      .all(merged.batchSize) as ReadonlyArray<{ id: string }>;

    pairsScanned = candidates.length;

    // Prepare statements for reuse
    const checkEdgeStmt = db.prepare(
      `SELECT 1 FROM memory_links
       WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)`,
    );
    const insertLinkStmt = db.prepare(
      "INSERT OR IGNORE INTO memory_links (source_id, target_id, link_text, created_at) VALUES (?, ?, ?, ?)",
    );
    const checkTierStmt = db.prepare(
      "SELECT tier FROM memories WHERE id = ?",
    );

    // Step 2-5: For each candidate, find KNN neighbors and create links
    for (const candidate of candidates) {
      const embedding = store.getEmbedding(candidate.id);
      if (!embedding) continue;

      // KNN search via sqlite-vec (k=6 to account for self-match)
      let neighbors: ReadonlyArray<{ memory_id: string; distance: number }>;
      try {
        neighbors = db
          .prepare(
            `SELECT memory_id, distance FROM vec_memories
             WHERE embedding MATCH ? AND k = 6
             ORDER BY distance`,
          )
          .all(embedding) as ReadonlyArray<{ memory_id: string; distance: number }>;
      } catch {
        // vec_memories may not have enough entries for KNN
        continue;
      }

      for (const neighbor of neighbors) {
        // Skip self
        if (neighbor.memory_id === candidate.id) continue;

        // Skip cold-tier neighbors
        const neighborRow = checkTierStmt.get(neighbor.memory_id) as { tier: string } | undefined;
        if (neighborRow?.tier === "cold") continue;

        // Convert cosine distance to similarity (sqlite-vec with cosine metric returns 1 - similarity)
        const similarity = 1 - neighbor.distance;
        if (similarity < merged.similarityThreshold) continue;

        // Check if edge already exists (either direction)
        const existingEdge = checkEdgeStmt.get(
          candidate.id,
          neighbor.memory_id,
          neighbor.memory_id,
          candidate.id,
        );

        if (existingEdge) {
          skippedExisting++;
          continue;
        }

        // Create bidirectional edges
        const now = new Date().toISOString();
        insertLinkStmt.run(candidate.id, neighbor.memory_id, "auto:similar", now);
        insertLinkStmt.run(neighbor.memory_id, candidate.id, "auto:similar", now);
        linksCreated += 2;
      }
    }
  });

  run();

  return Object.freeze({ linksCreated, pairsScanned, skippedExisting });
}
