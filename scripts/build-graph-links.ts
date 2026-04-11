#!/usr/bin/env npx tsx
/**
 * Build knowledge graph links between memories based on semantic similarity.
 *
 * Reads all memory embeddings, computes pairwise cosine similarity,
 * and creates edges between memories that exceed a similarity threshold.
 * Also links memories that share tags.
 *
 * Usage:
 *   npx tsx scripts/build-graph-links.ts <agent-name> [--threshold 0.6]
 */

import { join } from "node:path";
import { homedir } from "node:os";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

const AGENT_NAME = process.argv[2];
const thresholdIdx = process.argv.indexOf("--threshold");
const SIMILARITY_THRESHOLD = thresholdIdx !== -1 ? parseFloat(process.argv[thresholdIdx + 1]) : 0.55;
const MAX_LINKS_PER_NODE = 8;

if (!AGENT_NAME) {
  console.error("Usage: npx tsx scripts/build-graph-links.ts <agent-name> [--threshold 0.6]");
  process.exit(1);
}

const dbPath = join(
  process.env.CLAWCODE_HOME ?? join(homedir(), ".clawcode"),
  "agents",
  AGENT_NAME,
  "memory",
  "memories.db",
);

console.log(`Building knowledge graph links for '${AGENT_NAME}'`);
console.log(`Database: ${dbPath}`);
console.log(`Similarity threshold: ${SIMILARITY_THRESHOLD}`);
console.log("");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
sqliteVec.load(db);

// Get all memories with their tags
const memories = db.prepare(`
  SELECT id, content, tags, tier, importance
  FROM memories
  ORDER BY created_at
`).all() as Array<{
  id: string;
  content: string;
  tags: string;
  tier: string;
  importance: number;
}>;

console.log(`Found ${memories.length} memories.`);

// Count existing links
const existingCount = (db.prepare("SELECT COUNT(*) as cnt FROM memory_links").get() as { cnt: number }).cnt;
console.log(`Existing links: ${existingCount}`);

if (existingCount > 0) {
  console.log("Clearing existing auto-generated links...");
  db.prepare("DELETE FROM memory_links WHERE link_text LIKE 'auto:%'").run();
}

// Build links using KNN search via sqlite-vec
const knnStmt = db.prepare(`
  SELECT
    m.id,
    v.distance
  FROM vec_memories v
  INNER JOIN memories m ON m.id = v.memory_id
  WHERE v.embedding MATCH (SELECT embedding FROM vec_memories WHERE memory_id = ?)
    AND k = ?
  ORDER BY v.distance
`);

const insertLink = db.prepare(`
  INSERT OR IGNORE INTO memory_links (source_id, target_id, link_text, created_at)
  VALUES (?, ?, ?, ?)
`);

const now = new Date().toISOString();
let linksCreated = 0;
let processed = 0;

// Also build tag-based links
const tagIndex = new Map<string, string[]>();
for (const mem of memories) {
  const tags = JSON.parse(mem.tags) as string[];
  for (const tag of tags) {
    if (!tagIndex.has(tag)) tagIndex.set(tag, []);
    tagIndex.get(tag)!.push(mem.id);
  }
}

const insertTransaction = db.transaction(() => {
  for (const mem of memories) {
    // Find nearest neighbors via vector similarity
    const neighbors = knnStmt.all(mem.id, MAX_LINKS_PER_NODE + 1) as Array<{
      id: string;
      distance: number;
    }>;

    let nodeLinks = 0;
    for (const neighbor of neighbors) {
      // Skip self
      if (neighbor.id === mem.id) continue;
      if (nodeLinks >= MAX_LINKS_PER_NODE) break;

      // sqlite-vec cosine distance: 0 = identical, 2 = opposite
      // Convert to similarity: 1 - (distance / 2)
      const similarity = 1 - (neighbor.distance / 2);

      if (similarity >= SIMILARITY_THRESHOLD) {
        // Derive a link label from the relationship
        const label = `auto:similar (${(similarity * 100).toFixed(0)}%)`;

        try {
          insertLink.run(mem.id, neighbor.id, label, now);
          linksCreated++;
          nodeLinks++;
        } catch { /* duplicate or FK violation */ }
      }
    }

    // Tag-based links: connect memories that share 2+ tags
    const memTags = JSON.parse(mem.tags) as string[];
    const tagNeighbors = new Map<string, number>();
    for (const tag of memTags) {
      const group = tagIndex.get(tag) ?? [];
      for (const otherId of group) {
        if (otherId === mem.id) continue;
        tagNeighbors.set(otherId, (tagNeighbors.get(otherId) ?? 0) + 1);
      }
    }

    for (const [otherId, sharedCount] of tagNeighbors) {
      if (sharedCount >= 2 && nodeLinks < MAX_LINKS_PER_NODE) {
        const label = `auto:tags (${sharedCount} shared)`;
        try {
          insertLink.run(mem.id, otherId, label, now);
          linksCreated++;
          nodeLinks++;
        } catch { /* duplicate */ }
      }
    }

    processed++;
    if (processed % 50 === 0) {
      process.stdout.write(`\r  Processed ${processed}/${memories.length} memories, ${linksCreated} links created`);
    }
  }
});

insertTransaction();

console.log(`\r  Processed ${processed}/${memories.length} memories, ${linksCreated} links created`);
console.log(`\nDone! Created ${linksCreated} links.`);
console.log(`\nView the knowledge graph at http://localhost:3100/graph`);

db.close();
