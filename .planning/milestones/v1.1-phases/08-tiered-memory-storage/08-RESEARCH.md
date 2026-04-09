# Phase 8: Tiered Memory Storage - Research

**Researched:** 2026-04-08
**Domain:** Memory tiering (hot/warm/cold), SQLite schema migration, file-based cold archival, system prompt injection
**Confidence:** HIGH

## Summary

Phase 8 adds a three-tier memory system (hot/warm/cold) to the existing SQLite-backed memory store. Hot memories are loaded into the agent's system prompt on session start. Warm memories remain in SQLite searchable via semantic search (the current default). Cold memories are archived to markdown files and removed from SQLite to keep the database lean.

The existing codebase provides strong foundations: `MemoryStore` already tracks `access_count` and `accessed_at` (needed for promotion logic), `calculateRelevanceScore` in `decay.ts` provides the score used for cold demotion thresholds, `scoreAndRank` in `relevance.ts` selects top-N candidates for hot tier, and `consolidation.ts` has an established archive pattern (rename to subdirectory + cleanup) reusable for cold storage. The `buildSessionConfig` method in `SessionManager` is the injection point for hot memories into the system prompt.

**Primary recommendation:** Add a `tier` column to the `memories` table (default `'warm'`), create a new `src/memory/tiers.ts` module containing all tier transition logic as pure functions, and wire hot-tier injection into `SessionManager.buildSessionConfig()`. Cold archival follows the existing `consolidation.ts` archive pattern.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Hot tier: memories loaded into agent's active context (system prompt). Limited by context budget
- **D-02:** Warm tier: memories in SQLite, searchable via semantic search, not loaded by default
- **D-03:** Cold tier: archived markdown files in `memory/archive/cold/`, excluded from SQLite search
- **D-04:** Default tier for new memories: warm (they earn hot status through access frequency)
- **D-05:** Warm -> Hot: memory accessed 3+ times in last 7 days (configurable thresholds)
- **D-06:** Hot -> Warm: memory not accessed for 7 days (drops from active context on next refresh)
- **D-07:** Warm -> Cold: relevance score drops below configurable threshold (default 0.05, from Phase 7 decay)
- **D-08:** Cold -> Warm: search hit promotes back to warm (re-inserted into SQLite with fresh embedding)
- **D-09:** Hot tier budget: configurable max memories in context (default 20)
- **D-10:** Hot tier refreshed on session start and after compaction -- queries warm tier for top candidates
- **D-11:** Hot memories injected into system prompt as a "## Key Memories" section
- **D-12:** Refresh uses combined relevance score (Phase 7) to select top-N from warm tier
- **D-13:** Cold tier uses archived markdown format (one file per memory with metadata header)
- **D-14:** Cold memories removed from SQLite `memories` and `vec_memories` tables to keep DB lean
- **D-15:** Cold archive includes embedding as base64 in markdown metadata for fast re-warming

### Claude's Discretion
- Exact format of cold archive markdown files
- Hot tier refresh frequency beyond session start
- Whether to add a `clawcode memory tiers <agent>` CLI command

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AMEM-08 | Tiered storage -- hot memories loaded into active context, warm searchable in SQLite, cold archived to markdown | Schema migration adds `tier` column; hot injection in `buildSessionConfig`; cold archival to `memory/archive/cold/`; warm is existing default behavior |
| AMEM-09 | Automatic promotion from cold to warm on search hit, warm to hot on repeated access | Tier transition functions using `access_count`/`accessed_at` for warm->hot, `calculateRelevanceScore` for warm->cold, search-hit detection for cold->warm re-insertion |
</phase_requirements>

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.8.0 | SQLite storage for warm tier | Already in use. Schema migration adds `tier` column. |
| sqlite-vec | 0.1.9 | Vector search (warm tier only) | Already loaded. Cold memories removed from vec_memories. |
| @huggingface/transformers | 4.0.1 | Re-embed on cold->warm promotion | Already in use via EmbeddingService. |
| zod | 4.3.6 | Tier config schema validation | Already in use for memory config schemas. |
| date-fns | 4.1.0 | Date arithmetic for access window checks | Already in use in consolidation. |
| nanoid | 5.1.7 | ID generation | Already in use. |
| pino | 9.x | Structured logging for tier transitions | Already in use. |

### No New Dependencies Required

This phase requires zero new packages. Everything needed is already in the dependency tree.

## Architecture Patterns

### Recommended Project Structure
```
src/memory/
  tiers.ts              # NEW: Tier transition logic (pure functions)
  tier-manager.ts       # NEW: TierManager class (orchestrates transitions, cold I/O)
  types.ts              # MODIFY: Add MemoryTier type, tier field to MemoryEntry
  schema.ts             # MODIFY: Add tierConfigSchema
  store.ts              # MODIFY: Add tier column, migration, tier-aware queries
  search.ts             # MODIFY: Cold->warm promotion on search hit
  index.ts              # MODIFY: Export new tier types and TierManager

memory/archive/cold/    # NEW: Cold storage directory (per agent workspace)
  {id}-{slug}.md        # One file per cold memory
```

### Pattern 1: Schema Migration for Tier Column

**What:** Add `tier TEXT NOT NULL DEFAULT 'warm'` column to the `memories` table with a CHECK constraint.
**When to use:** On store initialization (follows existing `migrateSchema()` pattern).
**Example:**
```typescript
// Follows the existing migration pattern in store.ts (lines 333-373)
private migrateTierColumn(): void {
  // Check if tier column exists
  const columns = this.db.pragma("table_info(memories)") as Array<{ name: string }>;
  const hasTier = columns.some((c) => c.name === "tier");
  if (hasTier) return;

  this.db.transaction(() => {
    this.db.exec(`
      ALTER TABLE memories ADD COLUMN tier TEXT NOT NULL DEFAULT 'warm'
        CHECK(tier IN ('hot', 'warm', 'cold'));
    `);
  })();
}
```

**Note:** SQLite supports `ALTER TABLE ADD COLUMN` with defaults and CHECK constraints directly -- no need for the table recreation pattern used for the source constraint migration. This is simpler and faster.

### Pattern 2: Pure Tier Transition Functions (tiers.ts)

**What:** Stateless functions that determine tier transitions based on memory metadata.
**When to use:** Called by TierManager during refresh cycles.
**Example:**
```typescript
// src/memory/tiers.ts

import { calculateRelevanceScore, type DecayParams } from "./decay.js";

export type TierConfig = {
  readonly hotAccessThreshold: number;      // D-05: default 3
  readonly hotAccessWindowDays: number;     // D-05: default 7
  readonly hotDemotionDays: number;         // D-06: default 7
  readonly coldRelevanceThreshold: number;  // D-07: default 0.05
  readonly hotBudget: number;               // D-09: default 20
  readonly decayHalfLifeDays: number;       // from existing decay config
};

export const DEFAULT_TIER_CONFIG: TierConfig = {
  hotAccessThreshold: 3,
  hotAccessWindowDays: 7,
  hotDemotionDays: 7,
  coldRelevanceThreshold: 0.05,
  hotBudget: 20,
  decayHalfLifeDays: 30,
};

/** Check if a warm memory qualifies for hot promotion (D-05). */
export function shouldPromoteToHot(
  accessCount: number,
  accessedAt: string,
  now: Date,
  config: TierConfig,
): boolean {
  const daysSinceAccess = (now.getTime() - new Date(accessedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceAccess > config.hotAccessWindowDays) return false;
  return accessCount >= config.hotAccessThreshold;
}

/** Check if a hot memory should demote to warm (D-06). */
export function shouldDemoteToWarm(
  accessedAt: string,
  now: Date,
  config: TierConfig,
): boolean {
  const daysSinceAccess = (now.getTime() - new Date(accessedAt).getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceAccess >= config.hotDemotionDays;
}

/** Check if a warm memory should archive to cold (D-07). */
export function shouldArchiveToCold(
  importance: number,
  accessedAt: string,
  now: Date,
  config: TierConfig,
): boolean {
  const score = calculateRelevanceScore(importance, accessedAt, now, {
    halfLifeDays: config.decayHalfLifeDays,
  });
  return score < config.coldRelevanceThreshold;
}
```

### Pattern 3: Cold Archive Markdown Format (Claude's Discretion)

**What:** One markdown file per cold memory, with YAML frontmatter containing metadata and base64 embedding.
**Example:**
```markdown
---
id: abc123xyz
tier: cold
source: conversation
importance: 0.4
access_count: 2
tags: ["project-setup", "architecture"]
created_at: 2026-03-15T10:30:00.000Z
updated_at: 2026-03-15T10:30:00.000Z
accessed_at: 2026-03-20T14:00:00.000Z
archived_at: 2026-04-08T09:00:00.000Z
embedding_base64: "AAAA..."
---

# Memory: abc123xyz

The project uses a microservices architecture with Redis for inter-service communication...
```

**Filename convention:** `{id}-{sanitized-slug}.md` where slug is first 40 chars of content, sanitized to `[a-z0-9-]`. This makes cold archives browsable per D-13 and the specific idea in CONTEXT.md.

### Pattern 4: Hot Memory System Prompt Injection (D-11)

**What:** Inject hot-tier memories into `buildSessionConfig()` as a markdown section.
**Example:**
```typescript
// In SessionManager.buildSessionConfig():
// After existing system prompt assembly...

// Inject hot memories (D-11)
const hotMemories = await this.getHotMemories(config.name);
if (hotMemories.length > 0) {
  const memoriesSection = hotMemories
    .map((m) => `- ${m.content}`)
    .join("\n");
  systemPrompt += `\n\n## Key Memories\n\n${memoriesSection}`;
}
```

### Pattern 5: Cold-to-Warm Re-warming on Search Hit (D-08)

**What:** When a user searches and a cold memory would match, check cold archives and promote back.
**Implementation detail:** Since cold memories are removed from SQLite (D-14), they cannot be found via normal `vec_memories` search. Two approaches:

**Recommended approach:** Do NOT search cold archives during normal semantic search (that would defeat the purpose of cold storage). Instead, provide an explicit `searchCold(query)` function that:
1. Loads cold archive files
2. Compares the query embedding against stored base64 embeddings
3. If a match is found above threshold, re-inserts into SQLite with tier='warm' and fresh embedding
4. Returns the promoted result alongside normal warm results

This keeps normal search fast (warm-only) while allowing explicit cold recovery.

**Alternative (simpler, recommended for v1):** Add a `clawcode memory search --include-cold` flag that triggers cold scanning. Normal search stays warm-only. This avoids scanning cold files on every search.

### Anti-Patterns to Avoid
- **Mutating MemoryEntry objects:** All tier transitions must produce new objects (project immutability convention)
- **Scanning cold files on every search:** Cold tier exists to reduce search scope -- scanning it by default negates the benefit
- **Storing tier state only in memory (not persisted):** Tier must be a database column, not runtime-only state
- **Blocking session start on cold scan:** Hot tier refresh should query warm tier only (fast), not cold archives

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Base64 encoding for embeddings | Custom binary encoding | `Buffer.from(float32Array.buffer).toString('base64')` | Node.js Buffer handles Float32Array backing buffer directly |
| YAML frontmatter parsing | Custom regex parser | Split on `---` delimiters, parse YAML section with `yaml` package (already in deps) | Edge cases with multiline values, escaping |
| Date arithmetic for access windows | Manual millisecond math | `date-fns` `differenceInDays`, `subDays` | Already in deps, handles DST/timezone correctly |
| Relevance scoring for cold threshold | New decay formula | `calculateRelevanceScore()` from `decay.ts` | Already exists, tested, matches Phase 7 |
| Top-N selection for hot tier | Custom sorting | `scoreAndRank()` from `relevance.ts` | Already exists with combined semantic + decay scoring |

**Key insight:** Phase 7 already built the scoring primitives this phase needs. The tier module is primarily an orchestration layer that calls existing functions with tier-specific thresholds.

## Common Pitfalls

### Pitfall 1: Access Count Reset on Cold-to-Warm Promotion
**What goes wrong:** Re-inserting a cold memory with access_count=0 means it can never earn hot status from its pre-cold history.
**Why it happens:** Using `MemoryStore.insert()` creates a fresh entry with access_count=0.
**How to avoid:** When re-warming, use a dedicated `reinsertFromCold()` method that preserves the original access_count (stored in cold archive metadata). Or start at access_count=1 (the search hit itself counts as an access).
**Warning signs:** Memories that cycle between warm and cold without ever reaching hot.

### Pitfall 2: Schema Migration on Existing Databases
**What goes wrong:** `ALTER TABLE ADD COLUMN` with CHECK constraint fails on SQLite versions that don't support it in ALTER.
**Why it happens:** SQLite only added CHECK constraint support in ALTER TABLE ADD COLUMN in version 3.37.0 (2021-11-27).
**How to avoid:** The project uses better-sqlite3 12.8.0 which bundles SQLite 3.46+. This is safe. But verify with `sqlite3_version()` if concerned. Alternative: add column without CHECK, enforce in application code.
**Warning signs:** Migration errors on first start after upgrade.

### Pitfall 3: Hot Tier Budget Overflow
**What goes wrong:** More than `hotBudget` memories qualify for hot status, causing bloated system prompts.
**Why it happens:** The D-05 threshold (3 accesses in 7 days) is a qualification, not a cap.
**How to avoid:** After identifying all hot-qualifying memories, use `scoreAndRank()` to select top-N (where N = hotBudget). D-12 already specifies this.
**Warning signs:** System prompts growing unexpectedly large, context fill hitting thresholds faster.

### Pitfall 4: Race Between Hot Refresh and Search Access Updates
**What goes wrong:** A hot tier refresh runs concurrently with a search that updates `accessed_at`, causing stale tier assignments.
**Why it happens:** better-sqlite3 is synchronous within a single process, so this is only an issue if hot refresh and search run in different async flows that interleave.
**How to avoid:** Run hot refresh as a synchronous transaction. Since better-sqlite3 is synchronous, all reads and writes within a transaction are atomic. No concurrent access issue within the same process.
**Warning signs:** Memories flickering between hot and warm.

### Pitfall 5: Cold Archive Directory Not Existing
**What goes wrong:** First cold archival fails because `memory/archive/cold/` doesn't exist.
**Why it happens:** Directory is only created on first use.
**How to avoid:** `mkdirSync(coldDir, { recursive: true })` before writing -- follows the existing pattern in `consolidation.ts` line 296.
**Warning signs:** ENOENT errors in logs during first cold archival.

### Pitfall 6: Embedding Drift After Re-warming
**What goes wrong:** Cold memory's base64-stored embedding was generated with a different model version or parameters than current warm memories.
**Why it happens:** Model updates between archival and re-warming. The project uses `all-MiniLM-L6-v2` which is stable, but if the model ever changes, stored embeddings become incompatible.
**How to avoid:** D-08 says "re-inserted with fresh embedding" -- always re-embed on promotion, using the stored base64 embedding only as a fallback/optimization for cold-to-cold search matching. The re-embed on warm insertion ensures vector space consistency.
**Warning signs:** Re-warmed memories showing poor search relevance.

## Code Examples

### Base64 Embedding Serialization/Deserialization
```typescript
// Serialize Float32Array to base64 for cold archive
function embeddingToBase64(embedding: Float32Array): string {
  return Buffer.from(embedding.buffer).toString("base64");
}

// Deserialize base64 back to Float32Array for re-warming
function base64ToEmbedding(base64: string): Float32Array {
  const buffer = Buffer.from(base64, "base64");
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}
```

### Cold Archive Write (following consolidation.ts pattern)
```typescript
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { stringify as yamlStringify } from "yaml";

function archiveToCold(
  memoryDir: string,
  entry: MemoryEntry,
  embedding: Float32Array,
): string {
  const coldDir = join(memoryDir, "archive", "cold");
  mkdirSync(coldDir, { recursive: true });

  const slug = entry.content
    .slice(0, 40)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const fileName = `${entry.id}-${slug}.md`;
  const filePath = join(coldDir, fileName);

  const frontmatter = yamlStringify({
    id: entry.id,
    tier: "cold",
    source: entry.source,
    importance: entry.importance,
    access_count: entry.accessCount,
    tags: [...entry.tags],
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
    accessed_at: entry.accessedAt,
    archived_at: new Date().toISOString(),
    embedding_base64: embeddingToBase64(embedding),
  });

  const markdown = `---\n${frontmatter}---\n\n# Memory: ${entry.id}\n\n${entry.content}\n`;
  writeFileSync(filePath, markdown, "utf-8");
  return filePath;
}
```

### Hot Tier Refresh Query
```typescript
// Query warm memories sorted by combined relevance for hot tier selection
function selectHotCandidates(
  db: DatabaseType,
  config: TierConfig,
  scoringConfig: ScoringConfig,
  now: Date,
): readonly MemoryEntry[] {
  // Get all warm memories
  const rows = db.prepare(`
    SELECT id, content, source, importance, access_count, tags,
           created_at, updated_at, accessed_at
    FROM memories
    WHERE tier = 'warm'
    ORDER BY accessed_at DESC
    LIMIT 100
  `).all() as MemoryRow[];

  // Score using existing relevance scoring
  // Filter by hot-qualification (D-05), then rank by combined score (D-12)
  // Return top hotBudget entries
}
```

### Tier Config Schema Extension
```typescript
// Addition to schema.ts
export const tierConfigSchema = z.object({
  hotAccessThreshold: z.number().int().min(1).default(3),
  hotAccessWindowDays: z.number().int().min(1).default(7),
  hotDemotionDays: z.number().int().min(1).default(7),
  coldRelevanceThreshold: z.number().min(0).max(1).default(0.05),
  hotBudget: z.number().int().min(1).default(20),
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Flat memory (all in SQLite) | Three-tier (hot/warm/cold) | Phase 8 | Reduces system prompt bloat, keeps DB lean |
| All memories in search | Warm-only search (cold excluded) | Phase 8 | Faster search, smaller vector index |
| No context injection | Hot memories in system prompt | Phase 8 | Agent has immediate access to frequently-used facts |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (latest, in devDependencies) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/memory/__tests__/tiers.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AMEM-08 | New memories default to warm tier | unit | `npx vitest run src/memory/__tests__/store.test.ts -t "tier" -x` | No -- Wave 0 |
| AMEM-08 | Hot memories appear in system prompt | unit | `npx vitest run src/memory/__tests__/tiers.test.ts -t "hot injection" -x` | No -- Wave 0 |
| AMEM-08 | Cold memories archived to markdown files | unit | `npx vitest run src/memory/__tests__/tiers.test.ts -t "cold archive" -x` | No -- Wave 0 |
| AMEM-08 | Cold memories removed from SQLite | unit | `npx vitest run src/memory/__tests__/tiers.test.ts -t "cold removal" -x` | No -- Wave 0 |
| AMEM-09 | Warm->Hot promotion on repeated access | unit | `npx vitest run src/memory/__tests__/tiers.test.ts -t "warm to hot" -x` | No -- Wave 0 |
| AMEM-09 | Hot->Warm demotion after inactivity | unit | `npx vitest run src/memory/__tests__/tiers.test.ts -t "hot to warm" -x` | No -- Wave 0 |
| AMEM-09 | Warm->Cold on low relevance score | unit | `npx vitest run src/memory/__tests__/tiers.test.ts -t "warm to cold" -x` | No -- Wave 0 |
| AMEM-09 | Cold->Warm promotion on search hit | unit | `npx vitest run src/memory/__tests__/tiers.test.ts -t "cold to warm" -x` | No -- Wave 0 |
| AMEM-08 | Base64 embedding round-trip in cold archive | unit | `npx vitest run src/memory/__tests__/tiers.test.ts -t "base64" -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/memory/__tests__/tiers.test.ts --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/memory/__tests__/tiers.test.ts` -- covers AMEM-08, AMEM-09 tier transition logic
- [ ] Update `src/memory/__tests__/store.test.ts` -- covers tier column migration, tier-aware queries
- [ ] Update `src/memory/__tests__/search.test.ts` -- covers cold-to-warm promotion on search

## Project Constraints (from CLAUDE.md)

- **Immutability:** All tier transitions must produce new frozen objects (Object.freeze). Never mutate MemoryEntry.
- **Small files:** New `tiers.ts` and `tier-manager.ts` should each stay under 400 lines. Tier logic (pure functions) separate from I/O (manager class).
- **Error handling:** All tier transitions must handle errors explicitly. Cold archive failures should not crash the agent.
- **Input validation:** Tier config validated via zod schema at startup.
- **No hardcoded secrets:** N/A for this phase.
- **Security:** N/A for this phase (no user input, no network).
- **Git workflow:** Meaningful commits per logical unit.

## Open Questions

1. **Hot tier refresh on heartbeat?**
   - What we know: D-10 says refresh on session start and after compaction. CONTEXT.md says "Hot tier refresh frequency beyond session start" is at Claude's discretion.
   - What's unclear: Whether to also refresh on heartbeat tick.
   - Recommendation: Add an optional heartbeat check that refreshes hot tier every N heartbeat cycles (e.g., every 10 minutes). Low cost since it's a SQLite query. Keeps hot tier current without waiting for compaction or restart.

2. **How to retrieve embeddings for cold archival?**
   - What we know: `MemoryStore.getById()` returns `MemoryEntry` with `embedding: null` (the rowToEntry function sets it to null). The embedding is only in `vec_memories`.
   - What's unclear: Need a way to read the embedding from `vec_memories` before archiving to cold.
   - Recommendation: Add a `getEmbedding(id: string): Float32Array | null` method to MemoryStore that queries `vec_memories` directly. This is needed to store the base64 embedding in cold archive (D-15).

3. **CLI command for tier status?**
   - What we know: CONTEXT.md lists `clawcode memory tiers <agent>` as Claude's discretion.
   - Recommendation: Add it -- useful for debugging. Shows count per tier and lists hot-tier memory IDs/content previews.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/memory/store.ts`, `src/memory/search.ts`, `src/memory/decay.ts`, `src/memory/relevance.ts`, `src/memory/consolidation.ts`, `src/memory/types.ts`, `src/memory/schema.ts`, `src/manager/session-manager.ts`
- SQLite ALTER TABLE documentation: ALTER TABLE ADD COLUMN supports DEFAULT and CHECK since SQLite 3.37.0
- Node.js Buffer API: Buffer.from(ArrayBuffer) for base64 encoding of Float32Array

### Secondary (MEDIUM confidence)
- `yaml` package (already in deps at 2.8.3) for YAML frontmatter serialization in cold archives

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in use, zero new dependencies
- Architecture: HIGH - builds directly on existing patterns (migration, archive, scoring)
- Pitfalls: HIGH - identified from direct code analysis of existing codebase

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (stable -- internal architecture, no external API dependencies)
