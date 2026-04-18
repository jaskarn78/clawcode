# Phase 64: ConversationStore + Schema Foundation - Research

**Researched:** 2026-04-17
**Domain:** SQLite schema design, per-agent conversation persistence, session lifecycle, memory lineage tracking
**Confidence:** HIGH

## Summary

Phase 64 establishes the data foundation for persistent conversation memory. Every subsequent v1.9 phase (65-68) depends on the tables, types, migration, and store class created here. The work is pure infrastructure: two new SQLite tables (`conversation_sessions`, `conversation_turns`) added to the existing per-agent `memories.db` via the established migration pattern, a new `ConversationStore` class following the `EpisodeStore` pattern, a `source_turn_ids` lineage column on the `memories` table, provenance fields on every turn, and a Zod config schema for conversation settings.

The existing codebase provides strong prior art. `MemoryStore.migrateGraphLinks()` is the exact template for adding new tables to `memories.db`. `EpisodeStore` is the template for a domain-specific store class that wraps `MemoryStore` with its own queries. The Zod schema pattern in `src/memory/schema.ts` is the template for the conversation config. All of these patterns are well-established across 63 prior phases.

**Primary recommendation:** Follow the existing patterns exactly. ConversationStore gets the same DB via `store.getDatabase()`, uses prepared statements, returns frozen objects, and gets wired into AgentMemoryManager alongside EpisodeStore. No new dependencies. No architectural novelty. The value is in getting the schema right so Phases 65-68 have a solid foundation.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None explicitly locked -- all implementation choices are at Claude's discretion (infrastructure phase).

### Claude's Discretion
All implementation choices are at Claude's discretion. Key research guidance from CONTEXT.md:
- New tables (conversation_turns, conversation_sessions) go in existing memories.db via migrateGraphLinks-style migration
- ConversationStore class follows episode-store.ts pattern
- Provenance fields (discord_user_id, channel_id, is_trusted_channel) on every turn from day one
- source_turn_ids FK on memories table for lineage tracking
- No per-turn embeddings -- only session summaries get embedded later

### Deferred Ideas (OUT OF SCOPE)
None -- discuss phase skipped.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONV-01 | Every Discord message exchange stored as structured turn pair with timestamps, channel_id, discord_user_id provenance | Schema design: `conversation_turns` table with all provenance columns; ConversationStore CRUD methods |
| CONV-02 | Session boundaries tracked as explicit lifecycle records with session_id grouping | Schema design: `conversation_sessions` table with status state machine (active/ended/crashed/summarized); ConversationStore session lifecycle methods |
| CONV-03 | Extracted memories carry source_turn_ids linking back to source turns | Schema design: `source_turn_ids` TEXT column on `memories` table via ALTER TABLE migration; lineage verification via JOIN |
| SEC-01 | Every stored turn includes discord_user_id, channel_id, is_trusted_channel provenance | Schema design: three provenance columns on `conversation_turns`; ConversationStore enforces non-null provenance on insert |
</phase_requirements>

## Standard Stack

### Core (Existing -- Zero New Dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.8.0 | Turn/session storage in per-agent memories.db | Already loaded, WAL configured, sqlite-vec extension active |
| zod | ^4.3.6 | Config validation for conversationConfigSchema | Same pattern as memoryConfigSchema, decayConfigSchema, etc. |
| nanoid | ^5.1.7 | ID generation for turns and sessions | Already used throughout MemoryStore |
| date-fns | ^4.1.0 | Timestamps, retention windows | Already imported in consolidation/decay modules |

### Supporting (Existing)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | ^9 | Structured logging | ConversationStore operations, migration status |
| vitest | latest | Unit testing | ConversationStore CRUD, schema migration, config validation |

### New Dependencies Required

**None.** Zero new npm dependencies for Phase 64.

## Architecture Patterns

### Recommended Project Structure

```
src/memory/
  conversation-store.ts    # NEW: ConversationStore class (session + turn CRUD)
  conversation-types.ts    # NEW: ConversationTurn, ConversationSession, ConversationConfig types
  schema.ts                # MODIFIED: add conversationConfigSchema
  types.ts                 # MODIFIED: add MemoryEntry.sourceTurnIds optional field
  store.ts                 # MODIFIED: add migrateConversationTables() + migrateSourceTurnIds()

src/manager/
  session-memory.ts        # MODIFIED: create ConversationStore per agent in initMemory()

src/config/
  schema.ts                # MODIFIED: add conversation config to memorySchema
```

### Pattern 1: Migration via migrateGraphLinks Pattern

**What:** Add new tables to existing memories.db using `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` in a new private migration method on MemoryStore.

**When to use:** Adding any new table to the existing per-agent database.

**Example (from existing codebase -- `store.ts` lines 597-611):**
```typescript
private migrateConversationTables(): void {
  this.db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_sessions (
      id TEXT PRIMARY KEY,
      agent_name TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      turn_count INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      summary_memory_id TEXT,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'ended', 'crashed', 'summarized')),
      FOREIGN KEY (summary_memory_id) REFERENCES memories(id)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_agent
      ON conversation_sessions(agent_name);
    CREATE INDEX IF NOT EXISTS idx_sessions_status
      ON conversation_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_started
      ON conversation_sessions(started_at);

    CREATE TABLE IF NOT EXISTS conversation_turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_index INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      token_count INTEGER,
      channel_id TEXT,
      discord_user_id TEXT,
      discord_message_id TEXT,
      is_trusted_channel INTEGER NOT NULL DEFAULT 0,
      origin TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES conversation_sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_turns_session
      ON conversation_turns(session_id, turn_index);
    CREATE INDEX IF NOT EXISTS idx_turns_created
      ON conversation_turns(created_at);
    CREATE INDEX IF NOT EXISTS idx_turns_channel
      ON conversation_turns(channel_id);
    CREATE INDEX IF NOT EXISTS idx_turns_user
      ON conversation_turns(discord_user_id);
  `);
}
```

**Why this pattern:** Idempotent (`IF NOT EXISTS`), no savepoint-test needed (unlike source CHECK constraint migrations), runs in constructor chain after `migrateGraphLinks()`.

### Pattern 2: Domain-Specific Store Class (EpisodeStore Pattern)

**What:** A class that wraps `MemoryStore` (receives it via constructor), accesses the underlying DB via `store.getDatabase()`, manages its own prepared statements, and returns frozen objects.

**When to use:** Any domain-specific data that lives in memories.db but has its own CRUD methods.

**Example (from existing codebase -- `episode-store.ts`):**
```typescript
export class ConversationStore {
  private readonly db: DatabaseType;
  private readonly stmts: ConversationStatements;

  constructor(db: DatabaseType) {
    this.db = db;
    this.stmts = this.prepareStatements();
  }

  // Domain methods: startSession, endSession, recordTurn, getTurnsForSession, etc.
}
```

**Key difference from EpisodeStore:** ConversationStore receives the raw `DatabaseType` (from `store.getDatabase()`) rather than the full `MemoryStore` instance. It does not need `MemoryStore.insert()` because conversation turns are NOT MemoryEntry objects -- they are their own table. The only interaction with MemoryStore is the `source_turn_ids` lineage column, which Phase 66 will populate when extracting memories.

### Pattern 3: AgentMemoryManager Wiring

**What:** Create ConversationStore in `initMemory()`, store in a new Map, cleanup in `cleanupMemory()`.

**Example (from existing codebase -- `session-memory.ts` lines 93-94):**
```typescript
// In initMemory(), after EpisodeStore creation:
const conversationStore = new ConversationStore(store.getDatabase());
this.conversationStores.set(name, conversationStore);

// In cleanupMemory():
this.conversationStores.delete(name);
// No close() needed -- ConversationStore uses the same DB connection
// that MemoryStore closes.
```

### Pattern 4: Zod Config Schema (memoryConfigSchema Pattern)

**What:** Add `conversationConfigSchema` to `src/memory/schema.ts`, nest it inside `memoryConfigSchema` as an optional field.

**Example:**
```typescript
export const conversationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  turnRetentionDays: z.number().int().min(7).default(90),
});

// In memoryConfigSchema:
export const memoryConfigSchema = z.object({
  // ... existing fields ...
  conversation: conversationConfigSchema.optional(),
});
```

### Anti-Patterns to Avoid

- **Separate database file for conversations:** Adds WAL contention, file handle, warm-path complexity. Same-db, new-tables is the proven pattern (memory_links table added in v1.5).
- **Embedding every turn:** Storage bloat (~1.5KB per embedding * hundreds of turns per day). Embed session summaries only (Phase 66).
- **Storing turns as MemoryEntry objects:** Turns are NOT memories. They are raw data. Using MemoryEntry would trigger dedup, auto-linking, importance scoring, and tier management -- all wrong for raw conversation turns.
- **Making ConversationStore extend MemoryStore:** Wrong inheritance. ConversationStore USES the same database but has completely different CRUD semantics. Composition, not inheritance.
- **Mutable return objects:** Every method must return `Object.freeze()` results per project immutability convention.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ID generation | Custom UUID/timestamp IDs | `nanoid()` | Already used throughout MemoryStore, URL-safe, collision-resistant |
| Schema validation | Manual type checking | Zod schema + `.parse()` | Established pattern; `episodeInputSchema` is the exact template |
| Timestamp formatting | Manual Date.toISOString | `new Date().toISOString()` | Consistent with every existing table's created_at/updated_at |
| Database connection setup | New Database() in ConversationStore | `store.getDatabase()` | Single connection per agent; WAL/busy_timeout already configured |
| Token counting | chars/4 approximation | `countTokens()` from `performance/token-count.ts` | Deterministic BPE tokenizer; Phase 53 established this as canonical |

## Common Pitfalls

### Pitfall 1: Missing Foreign Key Enforcement

**What goes wrong:** SQLite foreign keys are OFF by default. The `conversation_turns.session_id` FK to `conversation_sessions.id` silently does nothing.

**Why it happens:** SQLite requires `PRAGMA foreign_keys = ON` per connection. MemoryStore already sets this (store.ts line 68), but if ConversationStore ever opens its own connection (which it should NOT), FKs would be silent.

**How to avoid:** ConversationStore MUST use the MemoryStore's existing database connection (via `store.getDatabase()`), which already has `foreign_keys = ON`. Never open a second connection.

**Warning signs:** Orphaned turns with session_ids that don't exist in conversation_sessions.

### Pitfall 2: Turn Index Race Condition

**What goes wrong:** Two concurrent Discord messages for the same agent arrive simultaneously. Both try to INSERT into conversation_turns with the same turn_index for the same session_id.

**Why it happens:** Better-sqlite3 is synchronous within a single Node.js process, so this is actually NOT a race condition at the DB level -- writes are serialized. But the `turn_index` must be computed correctly: either by MAX(turn_index) query or by using the session's `turn_count` as the next index.

**How to avoid:** Use a transaction: `SELECT turn_count FROM conversation_sessions WHERE id = ? FOR UPDATE` equivalent (SQLite serializes transactions anyway). Increment `turn_count` in the same transaction as the turn INSERT. The UNIQUE constraint on `(session_id, turn_index, role)` is the safety net.

**Warning signs:** UNIQUE constraint violations on conversation_turns.

### Pitfall 3: source_turn_ids Column Migration Breaking Existing Data

**What goes wrong:** Adding `source_turn_ids` to the `memories` table via `ALTER TABLE ADD COLUMN` is straightforward (nullable, defaults to NULL). But if the migration runs on a database with existing memories, the column is NULL for all existing rows -- which is correct and expected. The pitfall is if downstream code (Phase 66) treats NULL as "no lineage" differently from "not yet migrated."

**How to avoid:** Make `source_turn_ids` nullable with DEFAULT NULL. Document that NULL means "memory created before lineage tracking" (v1.0-v1.8 memories) OR "memory not derived from conversation turns" (manual/system/episode sources). Only `source="conversation"` memories should have non-null `source_turn_ids`.

**Warning signs:** Code that does `WHERE source_turn_ids IS NOT NULL` to find conversation-derived memories -- this is wrong because consolidation memories also lack turn IDs.

### Pitfall 4: Session Status State Machine Not Enforced in Code

**What goes wrong:** The `conversation_sessions.status` CHECK constraint enforces valid values at the DB level, but the valid STATE TRANSITIONS (active->ended, active->crashed, ended->summarized, crashed->summarized) are not enforced. Code could set status from 'summarized' back to 'active'.

**How to avoid:** ConversationStore methods should enforce the state machine:
- `startSession()` creates with status='active'
- `endSession(id)` transitions active->ended (rejects if not active)
- `crashSession(id)` transitions active->crashed (rejects if not active)
- `markSummarized(id)` transitions ended->summarized or crashed->summarized

**Warning signs:** Sessions with unexpected status transitions in the data.

### Pitfall 5: is_trusted_channel Boolean as INTEGER

**What goes wrong:** SQLite has no native BOOLEAN type. Using `INTEGER NOT NULL DEFAULT 0` is the standard pattern, but TypeScript code needs to handle the 0/1 <-> boolean conversion correctly.

**How to avoid:** Store as INTEGER (0/1) in SQLite. Convert to boolean in the `rowToTurn()` helper function. Accept boolean in the TypeScript API and convert to 0/1 before INSERT.

**Warning signs:** `is_trusted_channel` being compared with `=== true` against a raw number from SQLite.

## Code Examples

### ConversationStore Class Shape

```typescript
// Source: following EpisodeStore pattern (src/memory/episode-store.ts)
import type { Database as DatabaseType, Statement } from "better-sqlite3";
import { nanoid } from "nanoid";
import type { ConversationTurn, ConversationSession } from "./conversation-types.js";

type ConversationStatements = {
  readonly insertSession: Statement;
  readonly endSession: Statement;
  readonly crashSession: Statement;
  readonly markSummarized: Statement;
  readonly getSession: Statement;
  readonly listSessions: Statement;
  readonly insertTurn: Statement;
  readonly getTurnsForSession: Statement;
  readonly getSessionTurnCount: Statement;
  readonly incrementTurnCount: Statement;
};

export class ConversationStore {
  private readonly db: DatabaseType;
  private readonly stmts: ConversationStatements;

  constructor(db: DatabaseType) {
    this.db = db;
    this.stmts = this.prepareStatements();
  }

  startSession(agentName: string): ConversationSession { /* ... */ }
  endSession(sessionId: string): ConversationSession { /* ... */ }
  crashSession(sessionId: string): ConversationSession { /* ... */ }
  markSummarized(sessionId: string, summaryMemoryId: string): ConversationSession { /* ... */ }

  recordTurn(input: RecordTurnInput): ConversationTurn { /* ... */ }
  getTurnsForSession(sessionId: string, limit?: number): readonly ConversationTurn[] { /* ... */ }
  getSession(sessionId: string): ConversationSession | null { /* ... */ }
  listRecentSessions(agentName: string, limit: number): readonly ConversationSession[] { /* ... */ }

  private prepareStatements(): ConversationStatements { /* ... */ }
}
```

### Type Definitions Shape

```typescript
// Source: following types.ts pattern (src/memory/types.ts)
export type ConversationSession = {
  readonly id: string;
  readonly agentName: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly turnCount: number;
  readonly totalTokens: number;
  readonly summaryMemoryId: string | null;
  readonly status: SessionStatus;
};

export type SessionStatus = "active" | "ended" | "crashed" | "summarized";

export type ConversationTurn = {
  readonly id: string;
  readonly sessionId: string;
  readonly turnIndex: number;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly tokenCount: number | null;
  readonly channelId: string | null;
  readonly discordUserId: string | null;
  readonly discordMessageId: string | null;
  readonly isTrustedChannel: boolean;
  readonly origin: string | null;
  readonly createdAt: string;
};

export type RecordTurnInput = {
  readonly sessionId: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly tokenCount?: number;
  readonly channelId?: string;
  readonly discordUserId?: string;
  readonly discordMessageId?: string;
  readonly isTrustedChannel?: boolean;
  readonly origin?: string;
};
```

### Migration Method

```typescript
// Source: following migrateGraphLinks pattern (store.ts lines 597-611)
private migrateConversationTables(): void {
  this.db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_sessions ( /* ... */ );
    CREATE TABLE IF NOT EXISTS conversation_turns ( /* ... */ );
    /* indexes */
  `);
}

private migrateSourceTurnIds(): void {
  const columns = this.db
    .prepare("PRAGMA table_info(memories)")
    .all() as ReadonlyArray<{ name: string }>;
  const hasColumn = columns.some((c) => c.name === "source_turn_ids");
  if (!hasColumn) {
    this.db.exec(
      "ALTER TABLE memories ADD COLUMN source_turn_ids TEXT DEFAULT NULL"
    );
  }
}
```

### Test Pattern

```typescript
// Source: following episode-store.test.ts pattern
import { describe, it, expect, afterEach } from "vitest";
import { MemoryStore } from "../store.js";
import { ConversationStore } from "../conversation-store.js";

describe("ConversationStore", () => {
  let memStore: MemoryStore;
  let convStore: ConversationStore;

  afterEach(() => {
    memStore?.close();
  });

  it("creates session and records turns", () => {
    memStore = new MemoryStore(":memory:", { enabled: false, similarityThreshold: 0.85 });
    convStore = new ConversationStore(memStore.getDatabase());
    // ... test body
  });
});
```

## Schema Design Details

### conversation_sessions Table

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| id | TEXT | PRIMARY KEY | nanoid |
| agent_name | TEXT | NOT NULL | Which agent owns this session |
| started_at | TEXT | NOT NULL | ISO 8601 timestamp |
| ended_at | TEXT | nullable | Set when session ends/crashes |
| turn_count | INTEGER | NOT NULL DEFAULT 0 | Incremented per turn INSERT |
| total_tokens | INTEGER | NOT NULL DEFAULT 0 | Sum of all turn token_counts |
| summary_memory_id | TEXT | FK -> memories(id) | Set by Phase 66 when summary is created |
| status | TEXT | NOT NULL DEFAULT 'active', CHECK | State machine: active/ended/crashed/summarized |

### conversation_turns Table

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| id | TEXT | PRIMARY KEY | nanoid |
| session_id | TEXT | NOT NULL, FK -> conversation_sessions(id) | Groups turns into sessions |
| turn_index | INTEGER | NOT NULL | Ordering within session (0-based) |
| role | TEXT | NOT NULL, CHECK(IN user/assistant/system) | Speaker role |
| content | TEXT | NOT NULL | Message text |
| token_count | INTEGER | nullable | Token count via countTokens() |
| channel_id | TEXT | nullable | Discord channel snowflake (SEC-01) |
| discord_user_id | TEXT | nullable | Discord user snowflake (SEC-01) |
| discord_message_id | TEXT | nullable | Discord message snowflake (for linking) |
| is_trusted_channel | INTEGER | NOT NULL DEFAULT 0 | 0/1 boolean from SECURITY.md ACL (SEC-01) |
| origin | TEXT | nullable | TurnOrigin JSON (from TurnDispatcher) |
| created_at | TEXT | NOT NULL | ISO 8601 timestamp |

**Unique constraint:** `UNIQUE(session_id, turn_index, role)` -- prevents duplicate turns within a session.

### memories Table Addition

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| source_turn_ids | TEXT | DEFAULT NULL | JSON array of conversation_turn IDs this memory was derived from (CONV-03) |

**Migration:** `ALTER TABLE memories ADD COLUMN source_turn_ids TEXT DEFAULT NULL` -- same pattern as `migrateTierColumn()`.

### State Machine: Session Status Transitions

```
[created] --> active --> ended --> summarized
                   \--> crashed --> summarized
```

- `active`: Session started, turns being recorded
- `ended`: Session stopped gracefully (stopAgent)
- `crashed`: Session terminated unexpectedly (error/crash)
- `summarized`: Phase 66 has generated and stored a session summary

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Daily markdown session logs only | Structured SQLite turns + markdown logs (complementary) | v1.9 Phase 64 | Queryable conversation history alongside existing human-readable logs |
| No lineage from memories to source data | source_turn_ids on memories table | v1.9 Phase 64 | Extracted facts traceable to specific conversation turns |
| No provenance on stored data | Provenance fields on every turn | v1.9 Phase 64 | Trust-level distinction for memory poisoning defense |

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (latest) |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run src/memory/__tests__/conversation-store.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONV-01 | Turn pair storage with provenance | unit | `npx vitest run src/memory/__tests__/conversation-store.test.ts -t "recordTurn" -x` | Wave 0 |
| CONV-02 | Session lifecycle tracking | unit | `npx vitest run src/memory/__tests__/conversation-store.test.ts -t "session" -x` | Wave 0 |
| CONV-03 | source_turn_ids on memories | unit | `npx vitest run src/memory/__tests__/conversation-store.test.ts -t "lineage" -x` | Wave 0 |
| SEC-01 | Provenance fields present | unit | `npx vitest run src/memory/__tests__/conversation-store.test.ts -t "provenance" -x` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/memory/__tests__/conversation-store.test.ts --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/memory/__tests__/conversation-store.test.ts` -- covers CONV-01, CONV-02, CONV-03, SEC-01
- [ ] Schema migration test: verify tables created, verify `source_turn_ids` column added to memories
- [ ] Session state machine test: verify valid transitions, reject invalid transitions
- [ ] Provenance fields test: verify discord_user_id, channel_id, is_trusted_channel stored and retrievable
- [ ] Turn ordering test: verify turn_index increments correctly, UNIQUE constraint enforced

## Open Questions

1. **Should `conversation_turns` content be stored full-length or truncated?**
   - What we know: STACK.md suggests truncating assistant responses to 500 chars for storage, keeping full in session log markdown. ARCHITECTURE.md stores full content.
   - What's unclear: Whether truncation is needed in Phase 64 or deferred to Phase 65 (capture integration).
   - Recommendation: Store full content in Phase 64. Truncation is an optimization concern for Phase 65's capture path. The schema should support full content; the capture layer decides what to store.

2. **Should `turn_index` be per-session or global?**
   - What we know: ARCHITECTURE.md schema uses `UNIQUE(session_id, turn_index, role)`. STACK.md uses `turn_id` (separate from primary key `id`).
   - What's unclear: Whether turn_index should be a simple 0-based counter per session.
   - Recommendation: Per-session 0-based counter. Derived from `conversation_sessions.turn_count` at insert time. Simpler than global counters and sufficient for ordering within a session.

3. **Should `crashed` be a separate session status from `ended`?**
   - What we know: ARCHITECTURE.md schema has `CHECK(status IN ('active', 'ended', 'summarized'))`. PITFALLS.md discusses crash recovery.
   - Recommendation: Add `crashed` as a fourth status. Phase 66 needs to distinguish "session ended gracefully" from "session crashed" to adjust summarization strategy (graceful = full summary, crash = best-effort from available turns).

## Sources

### Primary (HIGH confidence)

- `src/memory/store.ts` -- MemoryStore class, schema, migration patterns (`migrateGraphLinks`, `migrateTierColumn`)
- `src/memory/episode-store.ts` -- Domain-specific store pattern (constructor, getDatabase(), prepared statements, frozen returns)
- `src/memory/schema.ts` -- Zod schema patterns (memoryConfigSchema, episodeInputSchema)
- `src/memory/types.ts` -- Type definitions (MemoryEntry, MemorySource, EpisodeInput)
- `src/manager/session-memory.ts` -- AgentMemoryManager initialization pattern (EpisodeStore, DocumentStore wiring)
- `src/config/schema.ts` -- Config schema nesting pattern (memorySchema inside agentSchema)
- `src/manager/context-assembler.ts` -- Context assembly pipeline, SectionTokenCounts, MemoryAssemblyBudgets
- `src/memory/context-summary.ts` -- Resume summary budget enforcement pattern
- `src/manager/turn-dispatcher.ts` -- TurnDispatcher chokepoint, TurnOrigin threading
- `src/discord/bridge.ts` -- streamAndPostResponse capture hook point (line 625)

### Secondary (HIGH confidence -- project research docs)

- `.planning/research/ARCHITECTURE.md` -- Complete data flow, component boundaries, integration points
- `.planning/research/STACK.md` -- Schema design, migration strategy, what not to use
- `.planning/research/PITFALLS.md` -- Dual-write divergence, storage bloat, memory poisoning

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, all existing libraries verified in codebase
- Architecture: HIGH -- follows exact patterns from 63 prior phases with clear prior art
- Pitfalls: HIGH -- identified from codebase analysis + v1.9 research documents
- Schema design: HIGH -- two research documents independently converge on same table structure

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (stable infrastructure, no external dependency changes)
