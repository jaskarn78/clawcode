# Phase 68: Conversation Search + Deep Retrieval - Research

**Researched:** 2026-04-18
**Domain:** FTS5 full-text search over raw turns, semantic session-summary search, decay-weighted merge, MCP tool extension with pagination
**Confidence:** HIGH

## Summary

Phase 68 ships the on-demand retrieval surface for v1.9 — the "I need to look further back than the auto-injected brief" escape hatch. The infrastructure required is almost entirely additive: the semantic path reuses `MemoryStore.findByTag("session-summary")` + `SemanticSearch` (no changes), and the full-text path adds a new FTS5 virtual table over `conversation_turns.content` — **which was NOT created by Phase 64** (verified: only `vec_memories` and `vec_document_chunks` virtual tables exist; `migrateConversationTables()` at `src/memory/store.ts:633-680` creates the raw tables without any FTS5 index). Phase 68 MUST create the FTS5 table as a migration, along with triggers to keep it synchronized with `conversation_turns`. SQLite's `better-sqlite3@12.8.0` ships with `ENABLE_FTS5` compiled in — verified at `node -e` runtime on the project toolchain. No new dependencies.

The critical integration is the `memory_lookup` MCP tool at `src/mcp/server.ts:419-454` and its IPC handler at `src/manager/daemon.ts:1655-1681`. Both need a backward-compatible `scope` parameter (Zod enum `"memories" | "conversations" | "all"`, default `"memories"`) plus pagination fields (`page` / `limit`, response `hasMore` + `nextOffset`). The current handler uses `GraphSearch` which over-fetches and expands 1-hop graph neighbors — the new paths must mirror this response shape (`{ id, content, relevance_score, tags, created_at, source, linked_from }`) plus a new `origin` field distinguishing `"memory" | "conversation-turn" | "session-summary"`. All existing callers continue to work unchanged; response shape is a superset.

Pagination recommendation: **offset-based** for initial MVP (simpler agent-facing consumption, matches the 10-result-per-page hard cap from CONTEXT.md). Document the known caveat in the tool description: "If new conversation turns are recorded between page requests, page boundaries may shift slightly — re-issue the query if strict consistency is required." Cursor-based pagination on `(combinedScore, id)` would be more stable but significantly more complex for a first cut, and the blast radius of new turns during multi-page pagination is minimal (< 10 turns in typical agent lifetimes between adjacent tool invocations).

**Primary recommendation:** Split into two plans. **68-01** builds the query layer — adds `migrateConversationTurnsFts()` migration + triggers, extends `ConversationStore` with `searchTurns(query, options)` returning `readonly ConversationTurnSearchResult[]`, adds a new `src/memory/conversation-search.ts` module exporting `searchByScope()` that orchestrates the semantic + FTS5 merge with decay weighting (reusing `calculateRelevanceScore` from `src/memory/decay.ts`). Pure functions, dependency-injected, fully unit-tested against `:memory:` DBs following the `conversation-store.test.ts` harness. **68-02** wires the query layer into the daemon IPC handler (`memory-lookup` case) and extends the `memory_lookup` MCP tool schema with `scope` + `page` parameters, adds integration tests that exercise the full IPC → orchestrator → response path.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

All implementation choices are at Claude's discretion — infrastructure phase. Key research guidance (locked in prior decisions logged in STATE.md):

- FTS5 virtual table already created on raw-turn text in Phase 64 (per REQUIREMENTS.md CONV-03 traceability). Phase 68 ADDs the query surface, not the schema. **VERIFIED FALSE by research** — Phase 64 did NOT create the FTS5 table. Phase 68 MUST create it. See "Corrected Understanding" below.
- Semantic search reuses `MemoryStore` + `sqlite-vec` KNN search — session summaries are already standard MemoryEntries with `source="conversation"` tag from Phase 66 (SESS-04)
- `memory_lookup` MCP tool already exists (`src/mcp/server.ts:419-454`) — extend its parameter schema with `scope` (Zod enum: `"memories" | "conversations" | "all"`, default `"memories"` for backward compatibility)
- Pagination: max 10 results per page, cursor or offset-based (Claude's discretion; cursor is more robust if multiple writes happen between pages, but offset is simpler for agent-facing consumption) — **research recommends offset-based for MVP**
- Time-decay weighting: reuse the existing decay formula from `src/memory/decay.ts` if compatible, otherwise a multiplicative decay factor applied to combined relevance score (half-life configurable — default reuse memory default of 14 days) — **confirmed compatible; reuse `calculateRelevanceScore` directly**
- Zero new npm dependencies — **confirmed achievable; FTS5 ships with better-sqlite3**
- Integration point: daemon IPC handler in `src/manager/daemon.ts` for the search method; MCP tool wrapper in `src/mcp/server.ts`
- Response shape should include origin tag per result (`source: "memory"` vs `source: "conversation-turn"` vs `source: "session-summary"`) so the agent can reason about provenance

### Corrected Understanding (supersedes CONTEXT.md assumption)

**CONTEXT.md states** the FTS5 virtual table "already created in Phase 64 (per REQUIREMENTS.md CONV-03 traceability)." **Research finding: this is FALSE.** Phase 64 created `conversation_sessions`, `conversation_turns`, and `source_turn_ids`, but NO FTS5 index. The only `VIRTUAL TABLE` clauses in the codebase are `vec_memories` (sqlite-vec at `src/memory/store.ts:488`) and `vec_document_chunks` (sqlite-vec at `src/documents/store.ts:213`).

REQUIREMENTS.md CONV-03 reads: *"Extracted memories carry `source_turn_ids` linking them back to the conversation turns they came from (lineage tracking for dual-write integrity)."* This is a `source_turn_ids` column on the `memories` table, NOT an FTS5 index. The `scope="conversations"` FTS5 requirement is RETR-02, which is Phase 68's own requirement.

**Impact on plan split:** Plan 68-01 MUST include the FTS5 migration — this is not a trivial add-on; it needs `CREATE VIRTUAL TABLE ... USING fts5(content, content='conversation_turns', content_rowid='rowid')` plus three triggers (AI/AD/AU) for synchronization, plus a one-shot backfill for any turns that already exist when agents upgrade to Phase 68's schema version.

### Claude's Discretion

Everything — infrastructure phase, no user-specific locks beyond the decisions above.

### Deferred Ideas (OUT OF SCOPE)

- Cross-agent conversation search (ADV-03) — out of scope; per-agent DB is the boundary
- Proactive mid-turn conversation surfacing (ADV-02) — out of scope
- Conversation topic threading across sessions (ADV-01) — out of scope
- FACT-01 / FACT-02 (structured fact extraction, preference tracking) — v1.9.x, not this phase
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RETR-01 | Agent can search conversation history on demand via an enhanced `memory_lookup` MCP tool with a `scope` parameter (backward-compatible with existing callers) | Extend `memory_lookup` Zod schema in `src/mcp/server.ts:422-426` with optional `scope: z.enum(["memories","conversations","all"]).default("memories")`; omitting → default keeps existing behavior. Extend daemon IPC handler at `src/manager/daemon.ts:1655` to branch on scope. Response shape is a backward-compatible superset — new `origin` field per result; all existing fields preserved. |
| RETR-02 | Raw conversation turn text is searchable via FTS5 full-text search for precise keyword recall when semantic search is insufficient | New `migrateConversationTurnsFts()` migration on `MemoryStore` creating `CREATE VIRTUAL TABLE ... USING fts5(content, content='conversation_turns', content_rowid='rowid')` + AI/AD/AU triggers per SQLite FTS5 best practice. New `ConversationStore.searchTurns(query, { limit, offset, sessionStatus? })` method running `SELECT ... FROM conversation_turns_fts JOIN conversation_turns WHERE conversation_turns_fts MATCH ? ORDER BY bm25(conversation_turns_fts) LIMIT ? OFFSET ?`. Query sanitization via `escapeFtsQuery()` helper (strip/quote special chars to prevent parse errors on agent-crafted queries containing colons/parens/quotes). |
| RETR-03 | Search results are paginated (max 10 per page) and time-decay-weighted so recent conversations rank higher than old ones | Hard cap `limit: z.number().int().min(1).max(10).default(10)` in MCP tool schema. Response includes `hasMore: boolean` + `nextOffset: number \| null`. Decay weighting: reuse `calculateRelevanceScore(importance, createdAt, now, { halfLifeDays: 14 })` from `src/memory/decay.ts:27-43`. For MemoryEntry results, `importance` is the stored value. For conversation_turn results, use a constant (e.g., 0.5) since raw turns lack an importance score. Combined score = `rawRelevance * 0.7 + decayFactor * 0.3` mirroring `relevance.ts:scoreAndRank` weights. |
</phase_requirements>

## Standard Stack

### Core (Existing — Zero New Dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.8.0 | FTS5 virtual table + triggers on same per-agent DB | `ENABLE_FTS5` compile option verified at runtime; same connection owns `conversation_turns`, `memories`, `vec_memories` — cross-table JOINs stay cheap |
| sqlite-vec | ^0.1.9 | Existing `vec_memories` KNN for `scope="memories"` + `scope="all"` semantic path | No changes needed; `SemanticSearch` (`src/memory/search.ts`) already wraps it with decay + importance weighting |
| zod | ^4.3.6 | Extend `memory_lookup` tool schema + IPC param validation with backward-compatible `scope` + `page` | Same `z.enum(...).default(...)` pattern used by `send_message.priority` (`src/mcp/server.ts:272`) |
| nanoid | ^5.1.7 | Not needed in this phase — all rows already have stable IDs | No new IDs generated; FTS5 uses `content_rowid` |
| pino | ^9 | Structured logging for FTS5 migration status + search query observability | Pattern mirrors `migrateGraphLinks` which logs via MemoryStore's parent logger |
| vitest | ^4.1.3 | Unit tests for `searchTurns`, `searchByScope`, pagination, decay merge | `src/memory/__tests__/conversation-store.test.ts` fixture is the template |

### Supporting (Existing)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @huggingface/transformers | ^4.0.1 | Embedding the query string for the semantic path | Already called via `manager.getEmbedder()` at `src/manager/daemon.ts:1636, 1666` — reuse directly |

### New Dependencies Required

**None.** Zero new npm dependencies. FTS5 is compiled into better-sqlite3's bundled SQLite.

**Version verification** (npm view, 2026-04-18):
- `better-sqlite3@12.8.0` — unchanged since Phase 64; FTS5 presence confirmed by runtime probe
- No other versions need re-verification; all packages unchanged since Phase 67

**Runtime FTS5 probe** (captured during research):
```
node -e "... CREATE VIRTUAL TABLE t USING fts5(body) ..."
→ FTS5 works: [ { body: 'hello world' } ]
→ compile_options includes ENABLE_FTS5
```

## Architecture Patterns

### Recommended Module Layout

```
src/memory/
├── conversation-store.ts           # MODIFIED — add searchTurns(query, opts) method
│                                   #            + prepared FTS5 statements in prepareStatements()
├── conversation-types.ts           # MODIFIED — add ConversationTurnSearchResult,
│                                   #            SearchTurnsOptions, SearchTurnsResult
├── conversation-search.ts          # NEW — searchByScope() orchestrator (pure function):
│                                   #        merges semantic + FTS5 results, applies decay,
│                                   #        deduplicates (prefer summary over raw turn),
│                                   #        truncates snippets, returns paginated page
├── conversation-search.types.ts    # NEW — ConversationSearchScope enum,
│                                   #        ScopedSearchResult (discriminated union by `origin`),
│                                   #        ScopedSearchOptions, ScopedSearchPage
├── store.ts                        # MODIFIED — add migrateConversationTurnsFts()
│                                   #            called AFTER migrateInstructionFlags()
│                                   #            in the constructor migration chain
└── __tests__/
    ├── conversation-store.test.ts       # MODIFIED — add searchTurns tests
    ├── conversation-search.test.ts      # NEW — searchByScope unit tests
    └── store-migration.test.ts          # MODIFIED (if exists) — assert FTS5 table present

src/mcp/
├── server.ts                       # MODIFIED — extend memory_lookup Zod schema
│                                   #            with scope + page, add origin to response
└── __tests__/
    └── memory-lookup.test.ts       # MODIFIED — assert new schema shape,
                                    #            backward-compatibility assertions

src/manager/
├── daemon.ts                       # MODIFIED — extend "memory-lookup" case
│                                   #            to branch on scope; return paginated response
└── __tests__/
    └── daemon-memory-lookup.test.ts # NEW (or merge into existing) — IPC-level integration
```

### Pattern 1: FTS5 External-Content Migration (New Pattern for Codebase)

**What:** Create an FTS5 virtual table in "external-content" mode that indexes `conversation_turns.content` via the source table's `rowid`, plus three triggers (INSERT/DELETE/UPDATE) to keep the index synchronized. Include a one-shot backfill for agents upgrading with existing turn data.

**When to use:** Only for this phase. Other full-text needs in the codebase are solved by sqlite-vec KNN; FTS5 is specifically for exact-keyword recall over raw turns.

**Migration SQL (to add in `src/memory/store.ts` after `migrateInstructionFlags` at line ~714):**
```typescript
/**
 * Migrate existing databases to add FTS5 full-text index over conversation_turns.content.
 * Uses external-content FTS5 (content=conversation_turns) to avoid duplicating row data.
 * Three triggers (AI/AD/AU) keep the index synchronized on INSERT/DELETE/UPDATE.
 *
 * Phase 68 — RETR-02. Idempotent via IF NOT EXISTS on both table and triggers.
 */
private migrateConversationTurnsFts(): void {
  // Detect whether FTS5 table already exists to decide if backfill is needed
  const existing = this.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_turns_fts'"
    )
    .get();
  const needsBackfill = !existing;

  this.db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS conversation_turns_fts USING fts5(
      content,
      content='conversation_turns',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS conversation_turns_ai
    AFTER INSERT ON conversation_turns BEGIN
      INSERT INTO conversation_turns_fts(rowid, content)
        VALUES (new.rowid, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS conversation_turns_ad
    AFTER DELETE ON conversation_turns BEGIN
      INSERT INTO conversation_turns_fts(conversation_turns_fts, rowid, content)
        VALUES ('delete', old.rowid, old.content);
    END;

    CREATE TRIGGER IF NOT EXISTS conversation_turns_au
    AFTER UPDATE ON conversation_turns BEGIN
      INSERT INTO conversation_turns_fts(conversation_turns_fts, rowid, content)
        VALUES ('delete', old.rowid, old.content);
      INSERT INTO conversation_turns_fts(rowid, content)
        VALUES (new.rowid, new.content);
    END;
  `);

  if (needsBackfill) {
    // One-shot backfill for existing turns recorded before Phase 68 migration ran.
    // Uses FTS5's bulk-insert form. Safe to run even on empty tables.
    this.db.exec(`
      INSERT INTO conversation_turns_fts(rowid, content)
        SELECT rowid, content FROM conversation_turns;
    `);
  }
}
```

**Why this pattern:**
- External-content avoids duplicating `content` text (tokens stored in index, not the raw string)
- `unicode61 remove_diacritics 2` is the SQLite default tokenizer — handles English safely, diacritics-insensitive (per https://sqlite.org/fts5.html)
- Triggers ensure zero-maintenance synchronization — no explicit `insertTurn` changes needed in `ConversationStore` (Phase 65's capture path continues working unchanged)
- Backfill ensures Phase 64/65-era turns are indexed when the agent upgrades to Phase 68 schema

### Pattern 2: Query Sanitization for Agent-Crafted FTS5 Queries

**What:** Wrap user-provided query strings in an `escapeFtsQuery()` helper that quotes the string as a phrase query, escaping embedded double-quotes. This prevents FTS5 syntax errors when agents include colons, parentheses, quotes, or boolean operators in their queries.

**When to use:** Every path that feeds a string into an FTS5 `MATCH` clause from an external caller.

**Example:**
```typescript
// Source: src/memory/conversation-store.ts (new helper)
/**
 * Escape a user-provided query for safe use in an FTS5 MATCH expression.
 * Quotes the entire string as a phrase, doubling any embedded quotes.
 * This is the "dumb but safe" strategy — no advanced operator support
 * until a concrete need emerges.
 */
function escapeFtsQuery(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '""';
  const escaped = trimmed.replace(/"/g, '""');
  return `"${escaped}"`;
}
```

**Why:** FTS5 query syntax treats colons (column filters), parens (boolean groups), and quotes (phrases) as reserved. Agents write natural-language queries like `"deployment issue we discussed: the API timeout"` — unquoted, FTS5 parses `deployment` as a term and `issue we discussed` as... nothing interpretable, usually crashing with `fts5: syntax error near ":"`. Phrase-quoting the whole input sidesteps this entirely. Future enhancement (not this phase): add a `rawQuery` escape hatch for power users.

### Pattern 3: Scoped Search Orchestrator (New Module)

**What:** A pure function `searchByScope()` in `src/memory/conversation-search.ts` that receives the scope, query string, pagination options, and injected dependencies (MemoryStore, ConversationStore, Embedder, now). Dispatches to semantic, FTS5, or both. Applies decay weighting. Deduplicates when `scope="all"` (if a session has a summary AND raw turns match, prefer the summary). Truncates snippets. Returns a single paginated page.

**When to use:** Every `scope` branch in the IPC handler routes through this function.

**Example shape:**
```typescript
// Source: src/memory/conversation-search.ts (NEW)
import type { MemoryStore } from "./store.js";
import type { ConversationStore } from "./conversation-store.js";
import type { EmbeddingService } from "./embedder.js";
import { SemanticSearch } from "./search.js";
import { calculateRelevanceScore } from "./decay.js";

export type ConversationSearchScope = "memories" | "conversations" | "all";

export type ScopedSearchResult = {
  readonly id: string;
  readonly content: string;
  readonly snippet: string;        // Truncated to SNIPPET_MAX_CHARS
  readonly origin: "memory" | "session-summary" | "conversation-turn";
  readonly relevanceScore: number;
  readonly combinedScore: number;  // Decay-weighted
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly sessionId: string | null;  // populated for session-summary + conversation-turn
};

export type ScopedSearchOptions = {
  readonly scope: ConversationSearchScope;
  readonly query: string;
  readonly limit: number;         // 1-10
  readonly offset: number;        // >= 0
  readonly halfLifeDays?: number; // default 14
  readonly now?: Date;            // default new Date(); injectable for tests
};

export type ScopedSearchPage = {
  readonly results: readonly ScopedSearchResult[];
  readonly hasMore: boolean;
  readonly nextOffset: number | null;
  readonly totalCandidates: number;  // For observability; not required by spec
};

export type ScopedSearchDeps = {
  readonly memoryStore: MemoryStore;
  readonly conversationStore: ConversationStore;
  readonly embedder: EmbeddingService;
};

/**
 * Orchestrate scoped search across semantic + FTS5 paths.
 * Pure dependency-injected function; all I/O via deps.
 * Returns at most `limit` results per call; caller paginates via offset.
 */
export async function searchByScope(
  deps: ScopedSearchDeps,
  options: ScopedSearchOptions,
): Promise<ScopedSearchPage> {
  // 1. Branch on scope
  // 2. For "memories": SemanticSearch + findByTag filtering (no session-summaries leak as separate)
  // 3. For "conversations": FTS5 over raw turns + session-summaries (both are "conversations" per CONTEXT.md specifics)
  // 4. For "all": union of both, deduplicate by session (prefer session-summary over raw-turn), sort by combinedScore
  // 5. Apply decay weighting to every result using calculateRelevanceScore
  // 6. Slice to [offset, offset + limit]
  // 7. Truncate snippets to SNIPPET_MAX_CHARS
  // 8. Compute hasMore + nextOffset from total candidate count
}
```

**Why this design:**
- Pure function with injected deps mirrors `assembleConversationBrief` pattern from Phase 67 — proven testability
- `now: Date` injection enables deterministic decay tests without `vi.setSystemTime()`
- Discriminated `origin` union lets downstream callers (MCP tool, potentially CLI) render differently per origin
- Returns a single page, not a cursor — caller constructs next request with `offset + results.length`
- `totalCandidates` is a diagnostic field; agents see `hasMore` + `nextOffset`

### Pattern 4: Backward-Compatible MCP Tool Schema Extension

**What:** Extend an existing tool's Zod schema with new optional fields that have defaults matching current behavior. Existing callers (who don't pass the new fields) get identical responses to before.

**When to use:** Any MCP tool evolution that must not break existing agents.

**Example:**
```typescript
// Source: src/mcp/server.ts:419-454 (MODIFIED shape)
server.tool(
  "memory_lookup",
  "Search your memory for relevant context, past decisions, and knowledge. " +
  "Use scope='conversations' to search older Discord conversation history " +
  "when the auto-injected resume brief is insufficient.",
  {
    query: z.string().describe("What to search for"),
    limit: z.number().int().min(1).max(10).default(5)
      .describe("Max results per page (1-10, hard cap at 10)"),
    agent: z.string().describe("Your agent name (pass your own name)"),
    scope: z.enum(["memories", "conversations", "all"]).default("memories")
      .describe("What to search: 'memories' (default, matches pre-v1.9 behavior), " +
                "'conversations' (session summaries + raw turns), or 'all' (both)"),
    page: z.number().int().min(0).default(0)
      .describe("Zero-based page index for pagination (default 0). " +
                "Response includes hasMore + nextOffset if more results exist."),
  },
  async ({ query, limit, agent, scope, page }) => { /* ... */ },
);
```

**Why:** Existing agents calling `memory_lookup({ query, limit, agent })` get `scope="memories"` + `page=0` automatically — identical to pre-Phase-68 behavior. The IPC handler must preserve the pre-v1.9 response shape when `scope="memories"` and `page=0` to fully honor backward-compatibility contracts (existing test `src/mcp/__tests__/memory-lookup.test.ts` at lines 1-16 continues passing without edits).

### Anti-Patterns to Avoid

- **FTS5 as standalone table (not external-content):** Duplicates the `content` column; doubles storage for a write-heavy table. Use `content='conversation_turns'` external-content mode.
- **Raw MATCH without escaping:** Agent queries containing `:`, `(`, `"` will crash FTS5's parser. Always route through `escapeFtsQuery()`.
- **Cursor-based pagination in Plan 68-02 MVP:** Adds complexity (opaque cursor encoding, `combinedScore` ties, rowid stability assumptions) for marginal robustness. Offset-based is adequate for 10-per-page + typical agent usage.
- **Per-turn embedding for semantic search:** Deferred per v1.9 storage bloat decision (STATE.md). FTS5 handles raw-turn keyword search; session summaries handle semantic.
- **Mixing MCP tool response shapes across scopes:** Every response from `memory_lookup` (regardless of scope) should share the superset shape `{ id, content, relevance_score, tags, created_at, source, origin?, session_id?, linked_from?, hasMore?, nextOffset? }`. Existing `linked_from` stays populated only when GraphSearch runs (i.e., `scope="memories"` path).
- **Treating FTS5 rank as a similarity score:** FTS5's `bm25()` is negative (lower is better). Convert to a positive relevance score via `Math.max(0, -bm25Value)` or normalization before combining with decay.
- **Running FTS5 migration on every startup with live backfill:** The backfill query must be gated on `needsBackfill` (detected via `sqlite_master` lookup) to avoid re-indexing the entire turns table on every daemon restart.
- **Forgetting to include `session-summary` MemoryEntries in `scope="conversations"` path:** Per CONTEXT.md Specifics: "Session-summary entries should be searchable under both `scope='memories'` AND `scope='conversations'`." The orchestrator MUST include them in both paths — for `scope="conversations"`, they're additional semantic candidates (via `findByTag("session-summary")`) on top of FTS5 raw-turn matches.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Full-text search over raw turns | Custom LIKE/REGEX query over `conversation_turns.content` | SQLite FTS5 via `CREATE VIRTUAL TABLE ... USING fts5(...)` | FTS5 is compiled in, handles tokenization + BM25 ranking, runs O(log n) vs O(n) full-table scan |
| FTS5 synchronization | Manual INSERT into both tables from `ConversationStore.recordTurn` | Three triggers (AI/AD/AU) on `conversation_turns` | Triggers run inside SQLite's transaction boundary, can't get out of sync; zero code change to recordTurn |
| Decay weighting formula | New multiplicative decay helper | `calculateRelevanceScore(importance, timestamp, now, { halfLifeDays })` from `src/memory/decay.ts:27-43` | Pure function, already tested, matches the exact formula used in `SemanticSearch` re-ranking |
| Pagination structure | Custom cursor encoding | Zero-based `page` parameter + `offset = page * limit` | Simplest agent-facing API; matches REST API conventions; avoids stateful cursor server-side |
| Query escaping | Full FTS5 query parser | Phrase-quote the entire input + escape embedded quotes (`escapeFtsQuery`) | Dumb-but-safe beats complex. Agents can re-learn to use quotes if they need boolean syntax (future work). |
| Session-summary filtering | Custom SQL predicate | `MemoryStore.findByTag("session-summary")` (`src/memory/store.ts:440`) | Already used by Phase 67 `conversation-brief.ts`; returns MemoryEntry objects directly |
| Semantic re-ranking | Manual distance-to-score conversion | `SemanticSearch` (`src/memory/search.ts`) — already wraps KNN + decay + importance weighting | Consistent scoring across all semantic paths |

## Runtime State Inventory

> Phase 68 is a pure additive code-change phase. No renames, refactors, or data migrations beyond the schema extension (which is idempotent and forward-only).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — existing `conversation_turns` rows will be backfilled into the new FTS5 index by the one-shot backfill in `migrateConversationTurnsFts()` | Backfill runs once per agent DB on first daemon startup post-upgrade; idempotent via `sqlite_master` presence check |
| Live service config | None — no external services reference the schema | None |
| OS-registered state | None — no OS-level registrations affected | None |
| Secrets/env vars | None — no new secrets or env var references | None |
| Build artifacts | None — `dist/` will rebuild from source; no committed binaries | None |

## Common Pitfalls

### Pitfall 1: FTS5 MATCH Query Parse Errors from Agent-Crafted Queries

**What goes wrong:** Agent calls `memory_lookup({ query: "deployment: the timeout issue", scope: "conversations" })`. FTS5 sees `deployment:` as a column filter (FTS5 reserved syntax), no column named `deployment` exists, throws `fts5: no such column 'deployment'`. The IPC error propagates back to the agent as a generic tool failure.

**Why it happens:** FTS5 MATCH syntax treats `:`, `(`, `)`, `"`, `*`, `-`, `+`, and boolean operators (AND/OR/NOT/NEAR) as reserved. Agent-authored queries are natural language, not FTS5 expressions.

**How to avoid:** Route every query through `escapeFtsQuery()` which phrase-quotes the entire input (`"deployment: the timeout issue"`). Phrase queries tolerate all special characters inside the quotes.

**Warning signs:** Test your implementation with queries containing `:`, parens, and quotes. If any throw or silently return zero results when results clearly exist, escaping is broken.

### Pitfall 2: Backfill Running on Every Daemon Startup

**What goes wrong:** `migrateConversationTurnsFts()` runs on every `MemoryStore` construction (daemon startup, agent restart). If backfill is unconditional, every restart re-inserts every turn into FTS5, creating massive duplicate rows and O(n²) query latency.

**Why it happens:** `CREATE VIRTUAL TABLE IF NOT EXISTS` is idempotent, but `INSERT INTO ... SELECT ...` is not.

**How to avoid:** Detect FTS5 table existence via `SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_turns_fts'`. Only run backfill if the lookup returns nothing. The triggers handle new rows going forward.

**Warning signs:** `SELECT COUNT(*) FROM conversation_turns_fts` > `SELECT COUNT(*) FROM conversation_turns`. If FTS5 row count exceeds turn count, duplicate backfill has occurred.

### Pitfall 3: BM25 Score Sign Confusion

**What goes wrong:** Code treats FTS5's `bm25()` rank as a positive similarity score. Lower-is-better semantics cause decay-weighted merge to promote the WORST FTS5 matches to the top of results.

**Why it happens:** SQLite's FTS5 docs state: *"Better matches are assigned numerically lower values"* due to FTS5's "-1" multiplication convention.

**How to avoid:** Convert BM25 to a positive relevance score before combining with decay:
```typescript
// BM25 returns negative values; more-negative = more-relevant.
// Normalize to [0, 1] via: relevance = 1 / (1 + |bm25|)
const rawRelevance = 1 / (1 + Math.abs(bm25Value));
```

**Warning signs:** Unit tests where "obviously more relevant" query-result pairs rank below less-relevant ones.

### Pitfall 4: `scope="all"` Producing Duplicate Results

**What goes wrong:** A session has a summary (indexed as MemoryEntry with tag `session-summary`) AND two of its raw turns match the FTS5 query. Under `scope="all"`, the user sees three results about the same session: the summary + two turns. This wastes page slots and confuses the agent.

**Why it happens:** Semantic and FTS5 paths run independently; without explicit deduplication, both surface overlapping information.

**How to avoid:** After merging both result lists but before pagination, group by `sessionId` (for session-summary) and `sessionId` (for conversation-turn). If a session-summary is present for a given `sessionId`, drop all conversation-turn results for that same session (prefer the distilled summary per CONTEXT.md Specifics). Keep raw-turn results only for sessions that don't have a summary.

**Warning signs:** An agent searching "deployment" gets five results, and three of them mention the same session — the summary plus two verbose turns quoting each other.

### Pitfall 5: Pagination Shift Under Concurrent Writes

**What goes wrong:** Agent calls `memory_lookup({ query, scope: "conversations", page: 0 })` → gets 10 results. Between that call and `page: 1`, a new Discord message arrives and `recordTurn` inserts a matching row at the top of FTS5's BM25 ranking. `page: 1` uses `offset: 10`, but the previously-seen result at (old) index 9 is now at index 10 — so the agent sees it twice.

**Why it happens:** Offset-based pagination over a mutable sorted list has inherent consistency gaps. Cursor-based pagination on `(combinedScore, id)` would be stable but requires encoding the cursor and handling ties.

**How to avoid:** Document the caveat in the tool description: "If new conversation turns are recorded between page requests, pagination boundaries may shift. Re-issue your query with page 0 if you need strict consistency." In practice, the write rate of turns (human typing speed in Discord) is low enough that this is a minor issue for typical agent usage.

**Warning signs:** Duplicate results across pages when concurrent Discord activity is high. Not a data-integrity issue, just a UX wrinkle.

### Pitfall 6: Response Size Blowup from Verbose Session Summaries

**What goes wrong:** A session-summary MemoryEntry is 2000 characters long (Phase 66 produces ~500-2000 char summaries). Ten such results in a single page = 20KB of text in the MCP tool response. Tool responses have size limits; the agent's context window fills fast; tool caching bloats memory.

**Why it happens:** The MCP response returns full `content`. No truncation.

**How to avoid:** Truncate each result's content to a `SNIPPET_MAX_CHARS` constant (recommend 500 chars) in the orchestrator's output mapping. Include full `id` so the agent can `memory_lookup` for the full text if needed (future enhancement: add a `get_full_memory(id)` tool in v1.9.x).

**Warning signs:** MCP tool responses exceeding 10KB for a single `memory_lookup` call.

### Pitfall 7: Forgetting the `session_id` Link for Raw-Turn Results

**What goes wrong:** Agent sees a raw-turn result but has no way to pull the full session context ("what was the conversation around that turn?"). Result shape only includes turn-level info.

**Why it happens:** `ConversationStore.searchTurns` joins FTS5 to `conversation_turns` but forgets to project `session_id` through.

**How to avoid:** Include `session_id` in the `SearchTurnsResult` and in the final `ScopedSearchResult.sessionId`. Enables a future `fetch_session(session_id)` tool to retrieve the full turn sequence.

**Warning signs:** Search returns results but an agent can't follow up with "give me the full session."

### Pitfall 8: Tokenizer Choice Impacting Recall

**What goes wrong:** Default `unicode61` tokenizer removes diacritics but doesn't stem. Agent searches for "deployed" but the turn contains "deploying" — no match.

**Why it happens:** SQLite FTS5 default tokenizer does NOT stem. `porter` tokenizer does (English-only stemming).

**How to avoid:** For v1.9 Phase 68 MVP, use `unicode61 remove_diacritics 2` (matches project's English-primary use case, handles accented chars). Document in the plan that if recall is found insufficient during dogfooding, swapping to `porter unicode61` is a one-line change (recreate the FTS5 table with a migration). Don't over-engineer the initial shipping version.

**Warning signs:** Agents reporting "I know I said this but the search didn't find it." Analytics on false-negative rate (hard to measure automatically).

## Code Examples

### Example 1: ConversationStore.searchTurns signature

```typescript
// Source: extension to src/memory/conversation-store.ts
export type SearchTurnsOptions = {
  readonly limit: number;       // 1-10
  readonly offset: number;      // >= 0
  readonly sessionStatus?: readonly ("active" | "ended" | "crashed" | "summarized")[];
  readonly includeUntrustedChannels?: boolean;  // default false for SEC-01 hygiene
};

export type ConversationTurnSearchResult = {
  readonly turnId: string;
  readonly sessionId: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly bm25Score: number;           // Raw FTS5 bm25() output (negative; lower = better)
  readonly createdAt: string;
  readonly channelId: string | null;
  readonly isTrustedChannel: boolean;
};

export type SearchTurnsResult = {
  readonly results: readonly ConversationTurnSearchResult[];
  readonly totalMatches: number;        // COUNT(*) for hasMore computation
};

/**
 * Full-text search over conversation_turns.content via FTS5.
 * Query is phrase-quoted via escapeFtsQuery to tolerate special chars.
 * Results ordered by BM25 relevance ascending (most relevant first).
 * Phase 68 — RETR-02.
 */
searchTurns(query: string, options: SearchTurnsOptions): SearchTurnsResult;
```

### Example 2: Prepared FTS5 statement inside ConversationStore

```typescript
// Source: extension to prepareStatements() in src/memory/conversation-store.ts:333
// Note: MATCH uses a placeholder; escapeFtsQuery is applied BEFORE .all() is called.
searchTurnsFts: this.db.prepare(`
  SELECT
    t.id AS turnId,
    t.session_id AS sessionId,
    t.role,
    t.content,
    t.created_at AS createdAt,
    t.channel_id AS channelId,
    t.is_trusted_channel AS isTrustedChannel,
    bm25(conversation_turns_fts) AS bm25Score
  FROM conversation_turns_fts fts
  JOIN conversation_turns t ON t.rowid = fts.rowid
  WHERE conversation_turns_fts MATCH ?
  ORDER BY bm25Score
  LIMIT ? OFFSET ?
`),
searchTurnsCount: this.db.prepare(`
  SELECT COUNT(*) AS total
  FROM conversation_turns_fts
  WHERE conversation_turns_fts MATCH ?
`),
```

### Example 3: Existing MemoryStore.findByTag (reused verbatim for scope='memories' session-summary filter)

```typescript
// Source: src/memory/store.ts:440-459 (NO CHANGES — reuse as-is)
findByTag(tag: string): readonly MemoryEntry[] {
  const rows = this.db.prepare(`
    SELECT m.id, m.content, m.source, m.importance, m.access_count,
           m.tags, m.created_at, m.updated_at, m.accessed_at, m.tier,
           m.source_turn_ids
    FROM memories m, json_each(m.tags) AS t
    WHERE t.value = ?
  `).all(tag) as MemoryRow[];
  return Object.freeze(rows.map(rowToEntry));
}
```

### Example 4: Existing calculateRelevanceScore (reused for decay weighting)

```typescript
// Source: src/memory/decay.ts:27-43 (NO CHANGES — reuse as-is)
export function calculateRelevanceScore(
  importance: number,
  accessedAt: string,
  now: Date,
  config: DecayParams,
): number {
  const accessedTime = new Date(accessedAt).getTime();
  const nowTime = now.getTime();
  const daysSinceAccess = (nowTime - accessedTime) / (1000 * 60 * 60 * 24);

  if (daysSinceAccess <= 0) {
    return Math.max(0, Math.min(1, importance));
  }

  const decayed = importance * Math.pow(0.5, daysSinceAccess / config.halfLifeDays);
  return Math.max(0, Math.min(1, decayed));
}
```

For conversation-turn results (which lack an `importance` field), use a constant `0.5` — this matches the default importance in `createMemoryInputSchema`.

### Example 5: Test fixture pattern (to lift from conversation-store.test.ts)

```typescript
// Source: lifted from src/memory/__tests__/conversation-store.test.ts:21-35 (proven harness)
import { describe, it, expect, afterEach } from "vitest";
import { MemoryStore } from "../store.js";
import { ConversationStore } from "../conversation-store.js";

describe("ConversationStore.searchTurns", () => {
  let memStore: MemoryStore;
  let convStore: ConversationStore;

  afterEach(() => {
    memStore?.close();
  });

  function setup(): void {
    memStore = new MemoryStore(":memory:", {
      enabled: false,
      similarityThreshold: 0.85,
    });
    convStore = new ConversationStore(memStore.getDatabase());
  }

  it("backfills existing turns into FTS5 on first construction", () => {
    setup();
    const session = convStore.startSession("agent-a");
    convStore.recordTurn({
      sessionId: session.id,
      role: "user",
      content: "let's discuss deployment strategy",
    });
    const { results, totalMatches } = convStore.searchTurns("deployment", {
      limit: 10,
      offset: 0,
    });
    expect(totalMatches).toBe(1);
    expect(results[0]!.content).toContain("deployment");
  });

  it("escapes special characters in queries without crashing", () => {
    setup();
    const session = convStore.startSession("agent-a");
    convStore.recordTurn({
      sessionId: session.id,
      role: "user",
      content: "API endpoint: /v1/deploy — timeout after 30s",
    });
    // Agent-crafted query with colon — must not throw
    const { results } = convStore.searchTurns("endpoint: timeout", {
      limit: 10,
      offset: 0,
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Semantic-only memory search (sqlite-vec KNN) | Semantic + FTS5 full-text search combined with decay weighting | v1.9 Phase 68 | Precise keyword recall for exact-phrase queries that semantic misses |
| `memory_lookup` with 3 parameters (query/limit/agent) | 5 parameters (+ scope + page), backward-compatible | v1.9 Phase 68 | Agents can scope search to conversations; pagination enables deeper investigation |
| No full-text search in the codebase | FTS5 as an established pattern alongside sqlite-vec KNN | v1.9 Phase 68 | Future features (e.g., FACT-01 keyword-based fact extraction) have a tested FTS5 harness |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| better-sqlite3 with FTS5 | RETR-02 | ✓ | 12.8.0 | — |
| sqlite-vec | RETR-01 semantic path | ✓ | 0.1.9 | — |
| @huggingface/transformers | RETR-01 query embedding | ✓ | 4.0.1 | — |
| zod v4 | MCP tool schema | ✓ | 4.3.6 | — |
| Node 22 LTS | Runtime | ✓ | 22 | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.3 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run src/memory/__tests__/conversation-store.test.ts src/memory/__tests__/conversation-search.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RETR-01 | `memory_lookup` accepts `scope` parameter | unit | `npx vitest run src/mcp/__tests__/memory-lookup.test.ts --reporter=verbose` | ✅ (extend existing) |
| RETR-01 | Backward-compat: calls without `scope` behave exactly as pre-v1.9 | unit | `npx vitest run src/mcp/__tests__/memory-lookup.test.ts -t "backward" --reporter=verbose` | ❌ Wave 0 |
| RETR-01 | IPC handler branches correctly on `scope` values | integration | `npx vitest run src/manager/__tests__/daemon-memory-lookup.test.ts --reporter=verbose` | ❌ Wave 0 |
| RETR-02 | FTS5 migration creates table + triggers (idempotent) | unit | `npx vitest run src/memory/__tests__/conversation-store.test.ts -t "FTS5 migration" --reporter=verbose` | ❌ Wave 0 |
| RETR-02 | FTS5 backfills existing turns on first migration | unit | `npx vitest run src/memory/__tests__/conversation-store.test.ts -t "backfill" --reporter=verbose` | ❌ Wave 0 |
| RETR-02 | Triggers keep FTS5 in sync with INSERT/DELETE/UPDATE on `conversation_turns` | unit | `npx vitest run src/memory/__tests__/conversation-store.test.ts -t "trigger" --reporter=verbose` | ❌ Wave 0 |
| RETR-02 | `searchTurns` returns BM25-ranked matches for simple queries | unit | `npx vitest run src/memory/__tests__/conversation-store.test.ts -t "searchTurns" --reporter=verbose` | ❌ Wave 0 |
| RETR-02 | Query escaping tolerates special characters without crashing | unit | `npx vitest run src/memory/__tests__/conversation-store.test.ts -t "escape" --reporter=verbose` | ❌ Wave 0 |
| RETR-03 | Pagination honors `limit: 10` hard cap | unit | `npx vitest run src/memory/__tests__/conversation-search.test.ts -t "pagination" --reporter=verbose` | ❌ Wave 0 |
| RETR-03 | `hasMore` + `nextOffset` computed correctly | unit | `npx vitest run src/memory/__tests__/conversation-search.test.ts -t "hasMore" --reporter=verbose` | ❌ Wave 0 |
| RETR-03 | Decay weighting: recent results rank above old ones given equal raw relevance | unit | `npx vitest run src/memory/__tests__/conversation-search.test.ts -t "decay" --reporter=verbose` | ❌ Wave 0 |
| RETR-03 | `scope="all"` deduplicates: prefers session-summary over raw-turn for same session | unit | `npx vitest run src/memory/__tests__/conversation-search.test.ts -t "deduplicate" --reporter=verbose` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/memory/__tests__/conversation-store.test.ts src/memory/__tests__/conversation-search.test.ts src/mcp/__tests__/memory-lookup.test.ts --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/memory/__tests__/conversation-store.test.ts` — add `searchTurns` test suite (extend existing file, ~10 new tests)
- [ ] `src/memory/__tests__/conversation-search.test.ts` — NEW file covering `searchByScope()` orchestrator (semantic/FTS5/all paths, pagination, decay, deduplication)
- [ ] `src/mcp/__tests__/memory-lookup.test.ts` — extend with Zod schema assertions (new `scope` + `page` fields) and backward-compat tests
- [ ] `src/manager/__tests__/daemon-memory-lookup.test.ts` — NEW file (or add tests to existing daemon test module) for IPC-level integration testing
- [ ] Migration test: assert `conversation_turns_fts` table present + all three triggers present in `sqlite_master` after MemoryStore construction

*(Existing test infrastructure via `conversation-store.test.ts` and `memory-lookup.test.ts` provides the harness foundation; gaps are new test files + extensions.)*

## Plan Split Recommendation

### Plan 68-01: FTS5 Query Layer + Decay Merge + searchByScope Helper

**Scope:** Infrastructure — all the pieces that have no MCP/IPC surface yet.

**Deliverables:**
1. `src/memory/store.ts` — new `migrateConversationTurnsFts()` method; wire it into constructor after `migrateInstructionFlags()`
2. `src/memory/conversation-types.ts` — add `SearchTurnsOptions`, `ConversationTurnSearchResult`, `SearchTurnsResult` types
3. `src/memory/conversation-store.ts` — add `searchTurns(query, opts)` method; add `escapeFtsQuery()` private helper; add `searchTurnsFts` + `searchTurnsCount` prepared statements
4. `src/memory/conversation-search.types.ts` — NEW file with `ConversationSearchScope`, `ScopedSearchResult`, `ScopedSearchOptions`, `ScopedSearchPage`, `ScopedSearchDeps`
5. `src/memory/conversation-search.ts` — NEW file with `searchByScope()` orchestrator (pure, DI)
6. `src/memory/__tests__/conversation-store.test.ts` — extend with `searchTurns` + FTS5 migration + trigger sync tests
7. `src/memory/__tests__/conversation-search.test.ts` — NEW file with `searchByScope` unit tests

**Acceptance:** All three requirements (RETR-01/02/03) have passing unit tests at the helper-function level. No MCP/IPC wiring yet. Existing test suite remains green.

### Plan 68-02: MCP Tool Extension + IPC Wiring + Pagination

**Scope:** Integration — expose the Plan 68-01 surface to agents via MCP and the daemon IPC layer.

**Deliverables:**
1. `src/mcp/server.ts` — extend `memory_lookup` Zod schema with `scope` + `page`; extend description; pass through to IPC
2. `src/manager/daemon.ts` — extend `"memory-lookup"` IPC case at line 1655 to branch on scope, instantiate `searchByScope` with DI, return paginated response. Preserve exact pre-v1.9 response shape when `scope="memories"` + `page=0` for backward-compat.
3. `src/mcp/__tests__/memory-lookup.test.ts` — extend with new schema assertions + backward-compat tests
4. `src/manager/__tests__/daemon-memory-lookup.test.ts` — NEW file (or merge into existing daemon test file) with end-to-end IPC integration tests
5. `src/ipc/protocol.ts` — no changes expected (`memory-lookup` already in `IPC_METHODS` at line 36); params are `Record<string, unknown>` so new fields flow through automatically

**Acceptance:** End-to-end test from MCP tool call → IPC → orchestrator → SQL → response validates each scope + pagination scenario. Existing memory_lookup tests pass without modification (backward-compat verified).

## Open Questions

1. **Should raw-turn results include the full content or a snippet context window?**
   - What we know: CONTEXT.md specifies `SNIPPET_MAX_CHARS` truncation to bound response size. FTS5 provides a `snippet()` auxiliary function that returns highlighted excerpts around matching terms.
   - What's unclear: Do agents want BM25-matched term highlighting (`<b>deployment</b>`) or plain truncation?
   - Recommendation: Plain truncation for MVP (simpler; predictable size). Document in plan that if dogfooding shows agents want highlighting, swap the `content` column projection to `snippet(conversation_turns_fts, -1, '[[', ']]', '…', 32)` — one-line change.

2. **Should `scope="all"` be the default instead of `"memories"`?**
   - What we know: CONTEXT.md locks `default="memories"` for backward-compatibility.
   - What's unclear: Is backward-compat more valuable than broader recall by default?
   - Recommendation: Keep `"memories"` default. Backward-compat is more valuable. Agents opt into broader scope when they need it; the tool description should note that `scope="all"` is recommended for "I don't remember if we talked about X" queries.

3. **Half-life default: CONTEXT.md says "14 days"; is this consistent with existing semantic search decay?**
   - What we know: `src/memory/search.ts:25` uses `halfLifeDays: 30` as `DEFAULT_SCORING_CONFIG`. Configured via `decayConfigSchema` which defaults to 30.
   - What's unclear: Why 14 for conversation search specifically? Recent conversations should decay faster than general memories.
   - Recommendation: Use 14-day half-life for Phase 68 (matches CONTEXT.md) — conversations have faster-decaying relevance than distilled knowledge. Make it configurable via an optional `conversation.retrievalHalfLifeDays` field in `conversationConfigSchema` (`src/memory/schema.ts:66-75`). Not blocking for the initial plan; follow-up refinement.

4. **Should untrusted-channel turns be included in search results?**
   - What we know: SEC-01 populates `is_trusted_channel` for every turn. Phase 65 capture stores turns regardless of trust level.
   - What's unclear: When an agent searches "what did that Discord user ask me?", do we include turns from untrusted channels?
   - Recommendation: Expose via a `SearchTurnsOptions.includeUntrustedChannels?: boolean` (default `false`). The MCP `memory_lookup` tool does NOT expose this flag directly; it's set to `false` at the IPC handler level. An advanced CLI tool (future) could flip it. Rationale: agents shouldn't be pulling memory-poisoning vectors back into their context unintentionally.

## Sources

### Primary (HIGH confidence)

- `src/memory/conversation-store.ts` (full file read) — existing ConversationStore CRUD pattern to extend
- `src/memory/conversation-types.ts` (full file read) — existing types to extend with SearchTurnsResult
- `src/memory/store.ts` (relevant sections) — migration chain pattern, `findByTag`, `initSchema`, `migrateGraphLinks`, `migrateConversationTables`
- `src/memory/search.ts` (full file read) — `SemanticSearch` reuse pattern
- `src/memory/decay.ts` (full file read) — `calculateRelevanceScore` to reuse for time decay
- `src/memory/relevance.ts` (full file read) — `scoreAndRank` pattern for combining semantic + decay
- `src/memory/graph-search.ts` (full file read) — `GraphSearch` wraps semantic; current `memory_lookup` uses this
- `src/memory/schema.ts` (full file read) — `conversationConfigSchema` extension pattern
- `src/mcp/server.ts:419-454` (memory_lookup tool definition) — extension target
- `src/manager/daemon.ts:1655-1681` (memory-lookup IPC handler) — extension target
- `src/manager/daemon.ts:2674-2682` (validateStringParam helper) — param validation pattern
- `src/ipc/protocol.ts` (full file read) — confirms `memory-lookup` method already registered, params are flexible
- `src/memory/__tests__/conversation-store.test.ts:1-100` — test fixture harness to lift
- `src/memory/__tests__/conversation-brief.test.ts:1-120` — DI pattern for `now` injection
- `src/manager/session-memory.ts:93-108` — ConversationStore wiring in AgentMemoryManager
- Runtime probe: `node -e "... CREATE VIRTUAL TABLE t USING fts5(body) ..."` confirmed FTS5 compile option + working on better-sqlite3@12.8.0
- `.planning/phases/64-conversationstore-schema-foundation/64-RESEARCH.md` — Phase 64 schema design + patterns
- `.planning/phases/67-resume-auto-injection/67-RESEARCH.md` (summary section) — conversation-brief helper pattern to mirror

### Secondary (HIGH confidence — official docs)

- SQLite FTS5 documentation (https://sqlite.org/fts5.html) — external-content tables, triggers, BM25, tokenizer, special-char handling (verified via WebFetch 2026-04-18)

### Tertiary (LOW confidence)

- None. All findings cross-verified against source code + official SQLite documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies; all versions verified in package.json + runtime probe
- Architecture: HIGH — follows patterns from Phase 64-67 with clear prior art; pure-function DI helpers are well-established
- Pitfalls: HIGH — FTS5 pitfalls cross-checked against official SQLite docs; pagination/dedup pitfalls derived from analysis
- FTS5 migration necessity: HIGH — verified by grep that Phase 64 did NOT create the virtual table
- Backward-compatibility approach: HIGH — Zod defaults pattern proven in existing tools (e.g., `send_message.priority`)

**Research date:** 2026-04-18
**Valid until:** 2026-05-18 (stable infrastructure, no external dependency changes; FTS5 is a frozen SQLite feature)
