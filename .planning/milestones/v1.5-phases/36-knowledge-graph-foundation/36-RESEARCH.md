# Phase 36: Knowledge Graph Foundation - Research

**Researched:** 2026-04-10
**Domain:** SQLite adjacency list graph over existing memory store
**Confidence:** HIGH

## Summary

This phase adds wikilink-based knowledge graph edges to the existing per-agent SQLite memory system. The core work is: (1) a regex parser that extracts `[[target]]` wikilinks from memory content, (2) a new `memory_links` adjacency table in the same per-agent `memories.db`, (3) link extraction on every insert/merge path, (4) backlink query API, and (5) edge preservation during consolidation, tier transitions, and episode archival.

The implementation is entirely within existing infrastructure -- no new dependencies. The `MemoryStore` class already manages schema migrations, prepared statements, and transactional writes. The adjacency table pattern is the simplest correct approach for a directed graph in SQLite. Graph traversal with cycle detection uses a standard visited-set BFS/DFS.

**Primary recommendation:** Add a `memory_links` table with `(source_id, target_id, link_text, created_at)` columns. Extract links on insert via regex, store edges transactionally with the memory write, and expose `getBacklinks(targetId)` and `getForwardLinks(sourceId)` as prepared-statement queries. Hook edge cleanup into all delete paths (direct delete, cold archival, consolidation).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GRAPH-01 | Agent memories support `[[wikilink]]` syntax that creates explicit links between memory entries | Wikilink regex parser + adjacency table `memory_links` + transactional insert with link extraction |
| GRAPH-02 | Agent can query backlinks for any memory entry (what links to this?) | `getBacklinks(targetId)` prepared statement on `memory_links` table, returns list of source memory IDs with content |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Immutability**: All domain objects returned as frozen with `Object.freeze()`, `readonly` on all type properties
- **File organization**: Many small files, 200-400 lines typical, 800 max
- **Error handling**: Named error classes extending Error with contextual readonly fields
- **ESM**: `.js` extension on all imports, `node:` prefix for Node built-ins
- **Zod**: Import from `zod/v4` for schema validation
- **Testing**: vitest, tests in `__tests__/` subdirectory
- **Dependencies**: Zero new dependencies for this phase (decided in v1.5 roadmap)
- **SQLite**: Per-agent isolation, better-sqlite3 with WAL mode, prepared statements for all operations
- **Constructor injection** for dependencies

## Standard Stack

### Core (Already Installed -- No New Dependencies)

| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| better-sqlite3 | 12.8.0 | Adjacency table storage | Already in use by MemoryStore |
| zod | 4.3.6 | Schema validation for link types | Import from `zod/v4` |
| nanoid | 5.x | ID generation if needed | Already in use |

### No New Dependencies

This phase explicitly requires zero new dependencies per the v1.5 roadmap decision. The adjacency list is pure SQL. Link parsing is a regex. Graph traversal is vanilla TypeScript.

## Architecture Patterns

### Recommended File Structure

```
src/memory/
  graph.ts              # Link extraction, graph query functions (~200 lines)
  graph.types.ts        # MemoryLink type, GraphEdge, etc. (~40 lines)
  __tests__/
    graph.test.ts       # Graph unit tests (~300 lines)
```

### Pattern 1: Adjacency List Table

**What:** A simple `memory_links` table with `(source_id, target_id, link_text, created_at)` storing directed edges. Foreign keys reference `memories(id)` but use `ON DELETE CASCADE` to auto-clean when memories are deleted.

**When to use:** Always for this type of sparse, directed graph in SQLite. Adjacency lists are the standard approach when the graph has simple "links to" relationships and queries are primarily "what links to X" and "what does X link to."

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS memory_links (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  link_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id),
  FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_links_target
  ON memory_links(target_id);
```

**Why this design:**
- Composite primary key `(source_id, target_id)` prevents duplicate edges naturally
- `ON DELETE CASCADE` means deleting a memory auto-removes all its edges (both inbound and outbound) -- critical for consolidation/archival safety
- Index on `target_id` makes backlink queries fast (forward links use the primary key prefix)
- `link_text` stores the raw wikilink text for display/debugging (e.g., "project-setup" from `[[project-setup]]`)

**IMPORTANT:** SQLite requires `PRAGMA foreign_keys = ON` per-connection for CASCADE to work. This pragma must be added to the MemoryStore constructor alongside the existing WAL mode pragma.

### Pattern 2: Wikilink Extraction Regex

**What:** Parse `[[target]]` patterns from memory content to extract link targets.

```typescript
const WIKILINK_PATTERN = /\[\[([^\]]+)\]\]/g;

function extractWikilinks(content: string): readonly string[] {
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_PATTERN.exec(content)) !== null) {
    matches.push(match[1].trim());
  }
  WIKILINK_PATTERN.lastIndex = 0; // Reset stateful regex
  return Object.freeze([...new Set(matches)]);
}
```

**Design decisions:**
- Target text is the raw string inside brackets: `[[my memory title]]` yields `"my memory title"`
- Targets are deduplicated per content (same link appearing twice creates one edge)
- Empty brackets `[[]]` are ignored (trim + filter empty)
- Nested brackets `[[foo [[bar]]]]` -- the regex captures `foo [[bar` which is fine, the inner link gets its own match on `bar`

### Pattern 3: Link Resolution Strategy

**What:** How to match `[[target-text]]` to an actual memory ID.

**Two resolution approaches:**

1. **ID-based linking** (simpler): `[[memory-id]]` links directly by nanoid. Precise but unfriendly for agents to type.

2. **Content-based linking** (recommended): `[[descriptive text]]` resolves by searching for a memory whose content or a `slug` field matches. More natural for agent-written memories.

**Recommended approach for this phase:** Use a **slug column** on the memories table. When a memory is inserted, generate a slug from its content (first ~60 chars, lowercased, hyphenated). Wikilinks resolve by slug match. If no match found, the edge is stored as **unresolved** (target_id = NULL or a sentinel) and resolved lazily on next query.

**Simpler alternative:** Skip slug resolution entirely. Store `link_text` as the link identifier. Resolution happens at query time by matching `link_text` against memory content via `LIKE` or exact match on a title/slug. This avoids schema changes to the memories table.

**Simplest viable approach (recommended for Phase 36):** Links reference memory IDs directly. The agent writes `[[abc123]]` where `abc123` is the nanoid of another memory. This is precise, requires no resolution logic, and no schema changes to the memories table. The agent already knows memory IDs from search results. Content-based slug resolution can be added in a later phase if needed.

### Pattern 4: Transactional Edge Insertion

**What:** Extract and insert links atomically with the memory insert.

```typescript
// Inside MemoryStore.insert(), within the existing transaction:
this.db.transaction(() => {
  this.stmts.insertMemory.run(/* ... */);
  this.stmts.insertVec.run(id, embedding);

  // Extract and insert graph edges
  const targets = extractWikilinks(input.content);
  for (const targetId of targets) {
    // Only create edge if target memory exists
    const targetExists = this.stmts.checkMemoryExists.get(targetId);
    if (targetExists) {
      this.stmts.insertLink.run(id, targetId, targetId, now);
    }
  }
})();
```

### Pattern 5: Graph Traversal with Cycle Detection

**What:** BFS/DFS traversal with a visited Set to prevent infinite loops on circular references.

```typescript
function traverseGraph(
  startId: string,
  getNeighbors: (id: string) => readonly string[],
  maxDepth: number,
): ReadonlySet<string> {
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id) || current.depth > maxDepth) continue;
    visited.add(current.id);

    for (const neighborId of getNeighbors(current.id)) {
      if (!visited.has(neighborId)) {
        queue.push({ id: neighborId, depth: current.depth + 1 });
      }
    }
  }

  visited.delete(startId); // Don't include start node
  return Object.freeze(visited);
}
```

**maxDepth = 1** for Phase 36 (backlinks only). Phase 38 (GRAPH-03) will use multi-hop traversal for neighbor context.

### Anti-Patterns to Avoid

- **Graph library dependency (graphology, etc.):** Decided against in v1.5 roadmap. The adjacency list is ~30 lines of SQL.
- **Storing the full graph in memory:** SQLite IS the graph store. Query on demand, don't build an in-memory representation.
- **Recursive CTEs for simple backlinks:** A single `SELECT * FROM memory_links WHERE target_id = ?` is sufficient for 1-hop backlinks. Save recursive CTEs for multi-hop traversal in Phase 38.
- **Deferred link resolution at insert time:** For Phase 36, only create edges when the target exists. Don't store unresolved links -- it adds complexity for a feature the agent doesn't need yet.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Graph database | Custom graph engine | SQLite adjacency table | At this scale (<10K nodes per agent), adjacency list in SQLite is optimal |
| Cycle detection | Custom visited-set tracker | Standard BFS with Set | Textbook algorithm, no library needed |
| Schema migration | Manual ALTER TABLE | Existing migration pattern in MemoryStore | Follow `migrateTierColumn()` / `migrateEpisodeSource()` precedent |

## Common Pitfalls

### Pitfall 1: Foreign Key Cascade Not Enabled

**What goes wrong:** `ON DELETE CASCADE` silently does nothing because SQLite requires `PRAGMA foreign_keys = ON` per connection.
**Why it happens:** SQLite has foreign keys OFF by default for backwards compatibility. The existing MemoryStore does not enable this pragma.
**How to avoid:** Add `this.db.pragma("foreign_keys = ON")` in the MemoryStore constructor, right after the existing pragmas. Test that deleting a memory removes its edges.
**Warning signs:** Edges remaining in `memory_links` after the source/target memory is deleted.

### Pitfall 2: Stale Edges After Consolidation

**What goes wrong:** Consolidation creates a new "consolidation" memory summarizing several older memories, then the old memories get archived/deleted. If consolidation doesn't transfer edges, graph connectivity is lost.
**Why it happens:** `writeWeeklyDigest` and `writeMonthlyDigest` in `consolidation.ts` call `memoryStore.insert()` for the digest entry but don't handle graph edges from source memories.
**How to avoid:** Two strategies: (a) let CASCADE handle deletion cleanup automatically (edges from deleted sources disappear), or (b) transfer outbound edges from source memories to the consolidation memory before archival. Strategy (a) is correct for Phase 36 -- edges are content-derived, so the consolidation digest will have its own `[[links]]` if the LLM preserves them.
**Warning signs:** `getBacklinks()` returning fewer results over time as consolidation runs.

### Pitfall 3: Cold Archival Deletes Edges

**What goes wrong:** `TierManager.archiveToCold()` calls `this.store.delete(entry.id)` which removes the memory from SQLite. With CASCADE, this also removes all edges.
**Why it happens:** Cold archival moves memory to markdown files and removes from SQLite entirely.
**How to avoid:** This is actually correct behavior for Phase 36. Cold memories are out of the active graph. When re-warmed via `rewarmFromCold()`, the content still contains `[[links]]` -- edges will be re-created on re-insert if we hook link extraction into the re-warm path.
**Warning signs:** None -- this is expected. Document that cold memories temporarily leave the graph.

### Pitfall 4: Regex Reset for Global Pattern

**What goes wrong:** JavaScript regex with `/g` flag is stateful. If `exec()` is called multiple times without resetting `lastIndex`, subsequent calls may miss matches.
**Why it happens:** The `/g` flag makes the regex object maintain state between calls.
**How to avoid:** Either (a) reset `lastIndex = 0` after extraction, (b) use `String.matchAll()` which returns a fresh iterator, or (c) create a new regex each time.
**Warning signs:** Intermittent missing links when the same regex is reused across calls.

### Pitfall 5: Dedup Merge Path Misses Link Extraction

**What goes wrong:** When `MemoryStore.insert()` detects a near-duplicate and calls `mergeMemory()`, the merge updates content but doesn't extract wikilinks from the new content.
**Why it happens:** The merge path in `dedup.ts` is separate from the normal insert path. Link extraction must be added to both.
**How to avoid:** After `mergeMemory()` completes, re-extract links from the merged content and update the `memory_links` table for the existing memory ID (delete old edges, insert new ones).
**Warning signs:** Merged memories having stale or missing graph edges.

## Code Examples

### Schema Migration (follow existing pattern)

```typescript
// In MemoryStore, new migration method
private migrateGraphLinks(): void {
  // Enable foreign keys (required for CASCADE)
  this.db.pragma("foreign_keys = ON");

  this.db.exec(`
    CREATE TABLE IF NOT EXISTS memory_links (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      link_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (source_id, target_id),
      FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_memory_links_target
      ON memory_links(target_id);
  `);
}
```

### Prepared Statements to Add

```typescript
// Add to PreparedStatements type
readonly insertLink: Statement;
readonly deleteLinksFrom: Statement;
readonly getBacklinks: Statement;
readonly getForwardLinks: Statement;
readonly checkMemoryExists: Statement;

// Preparation
insertLink: this.db.prepare(
  "INSERT OR IGNORE INTO memory_links (source_id, target_id, link_text, created_at) VALUES (?, ?, ?, ?)"
),
deleteLinksFrom: this.db.prepare(
  "DELETE FROM memory_links WHERE source_id = ?"
),
getBacklinks: this.db.prepare(`
  SELECT m.id, m.content, m.source, m.importance, m.access_count, m.tags,
         m.created_at, m.updated_at, m.accessed_at, m.tier, ml.link_text
  FROM memory_links ml
  JOIN memories m ON ml.source_id = m.id
  WHERE ml.target_id = ?
  ORDER BY m.created_at DESC
`),
getForwardLinks: this.db.prepare(`
  SELECT m.id, m.content, m.source, m.importance, m.access_count, m.tags,
         m.created_at, m.updated_at, m.accessed_at, m.tier, ml.link_text
  FROM memory_links ml
  JOIN memories m ON ml.target_id = m.id
  WHERE ml.source_id = ?
  ORDER BY m.created_at DESC
`),
checkMemoryExists: this.db.prepare(
  "SELECT 1 FROM memories WHERE id = ?"
),
```

### Backlink Query API

```typescript
// In graph.ts
export type MemoryLink = {
  readonly sourceId: string;
  readonly targetId: string;
  readonly linkText: string;
  readonly createdAt: string;
};

export type BacklinkResult = {
  readonly memory: MemoryEntry;
  readonly linkText: string;
};

// Query function (uses prepared statements from MemoryStore)
export function getBacklinks(
  db: DatabaseType,
  targetId: string,
): readonly BacklinkResult[] {
  const rows = db.prepare(`
    SELECT m.id, m.content, m.source, m.importance, m.access_count, m.tags,
           m.created_at, m.updated_at, m.accessed_at, m.tier, ml.link_text
    FROM memory_links ml
    JOIN memories m ON ml.source_id = m.id
    WHERE ml.target_id = ?
    ORDER BY m.created_at DESC
  `).all(targetId);

  return Object.freeze(rows.map(row => Object.freeze({
    memory: rowToEntry(row),
    linkText: row.link_text,
  })));
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| graphology / neo4j for agent memory graphs | SQLite adjacency list | Standard for small-scale agent memory | Zero dependency, simpler, sufficient at <100K nodes |
| Property graph with typed edges | Simple directed links | N/A | Typed edges add complexity without value for wikilink-style connections |

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (latest, ESM-first) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/memory/__tests__/graph.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GRAPH-01 | Wikilink extraction from content | unit | `npx vitest run src/memory/__tests__/graph.test.ts -t "extractWikilinks"` | No -- Wave 0 |
| GRAPH-01 | Edge creation on memory insert | unit | `npx vitest run src/memory/__tests__/graph.test.ts -t "insert.*link"` | No -- Wave 0 |
| GRAPH-01 | Edge creation on merge path | unit | `npx vitest run src/memory/__tests__/graph.test.ts -t "merge.*link"` | No -- Wave 0 |
| GRAPH-02 | Backlink query returns linking memories | unit | `npx vitest run src/memory/__tests__/graph.test.ts -t "backlink"` | No -- Wave 0 |
| GRAPH-02 | Forward link query | unit | `npx vitest run src/memory/__tests__/graph.test.ts -t "forward"` | No -- Wave 0 |
| SC-3 | Consolidation/archival preserve edges | unit | `npx vitest run src/memory/__tests__/graph.test.ts -t "consolidation\|archival"` | No -- Wave 0 |
| SC-4 | Circular reference traversal terminates | unit | `npx vitest run src/memory/__tests__/graph.test.ts -t "circular"` | No -- Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/memory/__tests__/graph.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/memory/__tests__/graph.test.ts` -- covers GRAPH-01, GRAPH-02, SC-3, SC-4
- [ ] No framework install needed -- vitest already configured

## Open Questions

1. **Link resolution strategy: IDs vs. slugs vs. content search?**
   - What we know: Agent gets memory IDs from search results. Using IDs directly is simplest.
   - What's unclear: Will agents naturally write `[[nanoid]]` in their memories, or do they need friendlier slug-based references?
   - Recommendation: Start with ID-based linking for Phase 36. If agent experience shows IDs are awkward, add slug resolution in a later iteration. Phase 38 (GRAPH-03/GRAPH-04) could add semantic link suggestions that auto-create `[[id]]` references.

2. **Should re-warming from cold restore graph edges?**
   - What we know: `rewarmFromCold()` re-inserts the memory with a fresh embedding. The content still contains `[[links]]`.
   - What's unclear: Should we automatically re-extract and re-insert edges during re-warm, or let the agent's next interaction trigger it?
   - Recommendation: Re-extract edges during re-warm. The content is already being processed; extracting links is near-zero cost and maintains graph consistency.

3. **Edge direction semantics**
   - What we know: Memory A contains `[[B]]` means A links to B. Backlink query on B returns A.
   - What's unclear: Should bidirectional links be supported? (A links to B AND B links to A?)
   - Recommendation: No. Directed edges only. If B also links to A, that's a separate edge created when B's content contains `[[A]]`. This is the standard wikilink semantic.

## Sources

### Primary (HIGH confidence)

- Project codebase: `src/memory/store.ts` -- existing schema, migrations, prepared statements pattern
- Project codebase: `src/memory/consolidation.ts` -- consolidation pipeline, archive behavior
- Project codebase: `src/memory/tier-manager.ts` -- cold archival/re-warm lifecycle
- Project codebase: `src/memory/dedup.ts` -- merge path that needs link extraction hook
- Project codebase: `src/memory/episode-archival.ts` -- episode archival pattern
- SQLite documentation: foreign key pragma behavior, CASCADE semantics

### Secondary (MEDIUM confidence)

- SQLite adjacency list pattern: standard relational graph modeling approach, well-documented across database literature

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, pure SQL + TypeScript
- Architecture: HIGH -- adjacency list is textbook, codebase patterns are clear
- Pitfalls: HIGH -- identified from direct code reading (foreign key pragma, merge path, cold archival)

**Research date:** 2026-04-10
**Valid until:** 2026-05-10 (stable -- no external dependencies to go stale)
