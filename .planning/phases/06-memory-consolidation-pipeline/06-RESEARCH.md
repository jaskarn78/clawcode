# Phase 6: Memory Consolidation Pipeline - Research

**Researched:** 2026-04-08
**Domain:** Memory consolidation, LLM summarization, heartbeat check framework
**Confidence:** HIGH

## Summary

Phase 6 transforms daily session logs into structured weekly and monthly digests. The existing codebase provides all necessary primitives: `SessionLogger` writes daily markdown files, `MemoryStore` handles SQLite persistence with embeddings, `HeartbeatRunner` supports pluggable checks with per-check interval overrides, and `SessionManager.sendToAgent()` enables LLM-powered summarization through the agent's own session.

The primary technical challenge is extending established patterns rather than building new infrastructure. A consolidation heartbeat check discovers unconsolidated daily logs, sends them to the agent for structured extraction, writes digest files (both markdown and SQLite memory entries), and archives source logs. The main gotcha is the SQLite `source` column CHECK constraint, which currently restricts to `('conversation', 'manual', 'system')` and must be altered to include `'consolidation'` before any digest memory entries can be inserted.

**Primary recommendation:** Implement as a single heartbeat check module (`consolidation.ts`) that orchestrates the full pipeline -- detect, summarize, store, archive -- following the exact same pattern as `context-fill.ts`. Extend the `CheckContext` to expose memory resources (MemoryStore, SessionLogger, EmbeddingService) so the check can operate without tightly coupling to SessionManager internals.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Consolidation runs as a heartbeat check (daily check interval) -- reuses Phase 5's extensible check framework
- **D-02:** Weekly consolidation triggers when 7+ daily logs exist without a corresponding weekly digest
- **D-03:** Monthly consolidation triggers when 4+ weekly digests exist without a corresponding monthly digest
- **D-04:** Consolidation is idempotent -- running it multiple times doesn't create duplicate digests
- **D-05:** LLM-powered structured extraction via the agent's own session
- **D-06:** Each digest contains: key facts, decisions made, topics discussed, important context preserved
- **D-07:** Digests stored as both markdown files (`memory/digests/weekly-YYYY-WNN.md`, `memory/digests/monthly-YYYY-MM.md`) and as memory entries in SQLite with embeddings
- **D-08:** Digest memory entries have source="consolidation" and higher default importance (0.7 for weekly, 0.8 for monthly)
- **D-09:** Consolidated daily logs moved to `memory/archive/YYYY/` subdirectory
- **D-10:** Archived logs removed from session_logs table in SQLite (excluded from active search)
- **D-11:** Archive preserves original files unmodified -- they're still accessible on disk if needed
- **D-12:** Weekly source dailies archived after weekly digest created; weekly digests archived after monthly digest created
- **D-13:** Use the agent's own session via `sendAndCollect` to generate summaries -- the agent knows what matters in its context
- **D-14:** Summary prompt includes the raw daily logs and asks for structured extraction
- **D-15:** Configurable summarization model override in clawcode.yaml (default: agent's model, can set to haiku for cost)

### Claude's Discretion
- Exact summary prompt wording
- Digest markdown template layout
- How to handle partial weeks (< 7 days at month boundary)
- Whether to include token/word count metadata in digests

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AMEM-01 | Daily session logs automatically consolidated into weekly digest summaries | Heartbeat check with daily interval discovers 7+ unconsolidated dailies, sends to agent via `sendToAgent()`, writes weekly digest markdown + SQLite memory entry |
| AMEM-02 | Weekly digests automatically consolidated into monthly summaries | Same check detects 4+ weekly digests without monthly, synthesizes via agent, writes monthly digest |
| AMEM-03 | Raw daily logs archived after consolidation (preserved but not in active search) | File move to `memory/archive/YYYY/`, DELETE from `session_logs` table, original file preserved on disk |
</phase_requirements>

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.8.0 | Memory store, session_logs table | Already in use for MemoryStore |
| @huggingface/transformers | 4.0.1 | Embed digest content | Already in use via EmbeddingService |
| zod | 4.3.6 | Config schema extension | Already validates clawcode.yaml |
| pino | 9.x | Structured logging | Already used throughout |
| nanoid | 5.x | ID generation for memory entries | Already used in MemoryStore |

### Supporting (already in project)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| date-fns | 4.x | ISO week number calculation, date arithmetic | Listed in CLAUDE.md stack but check if installed |

### No New Dependencies Required
This phase uses only existing project dependencies. No new packages needed.

## Architecture Patterns

### New Files
```
src/heartbeat/checks/consolidation.ts    # The heartbeat check module
src/memory/consolidation.ts              # Core consolidation logic (detect, summarize, store, archive)
src/memory/consolidation.types.ts        # Types for digests, consolidation state
src/memory/__tests__/consolidation.test.ts  # Unit tests
src/heartbeat/checks/__tests__/consolidation.test.ts  # Integration test for check module
```

### Digest File Layout
```
{workspace}/memory/
  digests/
    weekly-2026-W14.md
    weekly-2026-W15.md
    monthly-2026-04.md
  archive/
    2026/
      2026-04-01.md
      2026-04-02.md
      ...
```

### Pattern 1: Heartbeat Check Module (follow existing context-fill.ts)
**What:** A default-exported `CheckModule` object with `name`, optional `interval`, and `execute` function.
**When to use:** This is the only pattern for pluggable checks.
**Example:**
```typescript
// Source: src/heartbeat/checks/context-fill.ts (existing pattern)
const consolidationCheck: CheckModule = {
  name: "consolidation",
  interval: 86400, // 24 hours in seconds (daily)

  async execute(context): Promise<CheckResult> {
    const { agentName, sessionManager, config } = context;
    // ... consolidation logic
  },
};

export default consolidationCheck;
```

### Pattern 2: Idempotent Detection via File/DB State
**What:** Check whether a digest already exists before creating one. Weekly digest existence determined by file path (`memory/digests/weekly-YYYY-WNN.md`) and/or a query against memories table with `source='consolidation'` and matching tags.
**When to use:** Every consolidation run must be idempotent (D-04).
**Example:**
```typescript
// Check if weekly digest exists for a given ISO week
function weeklyDigestExists(memoryDir: string, year: number, week: number): boolean {
  const paddedWeek = String(week).padStart(2, '0');
  const path = join(memoryDir, 'digests', `weekly-${year}-W${paddedWeek}.md`);
  return existsSync(path);
}
```

### Pattern 3: LLM Summarization via sendToAgent
**What:** Use `SessionManager.sendToAgent(agentName, prompt)` to send raw logs and get back structured extraction.
**When to use:** For both weekly and monthly digest generation (D-05, D-13).
**Critical constraint:** The response is a string. The prompt must instruct the agent to return structured content that can be parsed (e.g., markdown with known headers).

### Pattern 4: Dual Storage (Markdown + SQLite)
**What:** Each digest is written to both a markdown file on disk AND inserted as a memory entry in SQLite with an embedding.
**When to use:** Every digest creation (D-07).
**Why both:** Markdown is human-readable and survives DB corruption. SQLite entry makes digests searchable via semantic search.

### Anti-Patterns to Avoid
- **Coupling consolidation logic inside HeartbeatRunner:** Keep consolidation logic in `src/memory/consolidation.ts`, not in the check file. The check file orchestrates; the logic module does the work.
- **Querying all daily logs with SELECT *:** Use the file system as source of truth for daily log discovery. The `session_logs` table tracks metadata but the actual content is in markdown files.
- **Blocking the heartbeat tick for too long:** Monthly consolidation synthesizes 4+ weekly digests via LLM. This could be slow. The check timeout (default 10s from config) may need adjustment, or the consolidation check needs its own longer timeout.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ISO week number calculation | Manual week math | `date-fns` `getISOWeek()` and `getISOWeekYear()` | ISO week numbering is non-trivial (week 1 = week containing first Thursday, year can differ from calendar year at boundaries) |
| File move (archive) | `readFile` + `writeFile` + `unlink` | `fs.rename()` (same filesystem) or `fs.copyFile()` + `fs.unlink()` | Atomic on same filesystem, handles edge cases |
| Date grouping (which logs belong to which week) | Manual date arithmetic | `date-fns` `startOfISOWeek()`, `endOfISOWeek()`, `getISOWeek()` | Handles year boundaries, partial weeks cleanly |

**Key insight:** ISO week numbering is the single most error-prone piece of this phase. Week 1 of a year may start in December of the previous year. Use `date-fns` functions exclusively for week calculations.

## Critical Discovery: Schema Migration Required

**Confidence:** HIGH (verified from source code)

The `memories` table has a CHECK constraint on the `source` column:
```sql
source TEXT NOT NULL CHECK(source IN ('conversation', 'manual', 'system'))
```
Source: `src/memory/store.ts` line 219

D-08 requires `source="consolidation"`. This INSERT will fail with the current schema.

**Required changes:**
1. Add `'consolidation'` to the CHECK constraint in `initSchema()` SQL
2. Add `'consolidation'` to the `MemorySource` type union in `src/memory/types.ts`
3. Add `'consolidation'` to the `memorySourceSchema` zod enum in `src/memory/schema.ts`
4. For existing databases: SQLite does not support `ALTER TABLE ... ALTER CONSTRAINT`. Options:
   - **Option A (recommended):** Drop the CHECK constraint entirely and rely on Zod validation at the application layer. SQLite makes CHECK constraint changes very difficult.
   - **Option B:** Recreate the table with the new constraint (requires data migration). Risky for production databases.
   - **Option C:** Use `PRAGMA writable_schema` to modify the constraint in-place. Fragile and not recommended.

**Recommendation:** Option A. The Zod schema already validates `MemorySource` at the application boundary. The SQL CHECK constraint is redundant defense-in-depth that creates migration pain. Remove it from `initSchema()` and add `'consolidation'` to the Zod enum. New databases get no CHECK; existing databases continue working (the old CHECK won't block reads, only writes with the new source).

Actually, a simpler approach: since `initSchema()` uses `CREATE TABLE IF NOT EXISTS`, existing databases won't have the schema altered. For existing databases, we need a migration step. The cleanest solution:
1. Update `initSchema()` to include `'consolidation'` in the CHECK for new databases
2. Add a one-time migration that runs `ALTER TABLE memories DROP CONSTRAINT` -- but SQLite doesn't support this
3. **Simplest path:** In `initSchema()`, after CREATE TABLE, run a conditional ALTER that recreates the table only if the old constraint exists. Or, check if the constraint needs updating and handle it.

**Final recommendation:** Update the CHECK constraint in `initSchema()` to include `'consolidation'`. For existing databases, add a migration function that creates a new table, copies data, drops old, renames new. This is standard SQLite migration pattern and better-sqlite3's synchronous API makes it safe inside a transaction.

## Common Pitfalls

### Pitfall 1: ISO Week Year Boundary
**What goes wrong:** December 29-31 can belong to ISO week 1 of the NEXT year. January 1-3 can belong to ISO week 52/53 of the PREVIOUS year.
**Why it happens:** ISO 8601 week numbering follows different rules than calendar months.
**How to avoid:** Always use `getISOWeekYear()` paired with `getISOWeek()` from date-fns. Never assume calendar year === week year.
**Warning signs:** Digest named `weekly-2025-W01.md` containing December 2025 logs.

### Pitfall 2: Check Timeout Too Short for LLM Summarization
**What goes wrong:** The heartbeat check timeout (default 10 seconds from `checkTimeoutSeconds`) is too short for an LLM to summarize 7 days of logs.
**Why it happens:** `sendToAgent()` calls the agent's session which calls the LLM. This takes 10-60+ seconds depending on log volume and model.
**How to avoid:** Set `interval` override on the consolidation check to run daily (86400 seconds). The check's own execution may exceed `checkTimeoutSeconds`. Either: (a) increase `checkTimeoutSeconds` in config for this check, or (b) have the consolidation check handle its own timeout internally, bypassing the runner's timeout.
**Warning signs:** Consolidation check always returns "timed out" in heartbeat.log.

**Recommendation:** The consolidation check should use a much longer timeout. The simplest approach is to add a `timeout` property to `CheckModule` that overrides the runner's default, or handle timeout internally within the consolidation check.

### Pitfall 3: Partial Week Handling at Month Boundaries
**What goes wrong:** A week spans two months (e.g., March 30 - April 5). Should this be in the March or April monthly digest?
**Why it happens:** ISO weeks don't align with calendar months.
**How to avoid:** Monthly digests consolidate weekly digests by the ISO week's start date. If week 14 starts March 31, it goes in the March monthly digest. OR: monthly digests consolidate by calendar month of the daily logs, not the weekly digest dates.
**Warning signs:** Some weeks appear in two monthly digests, or some weeks are missing from monthly digests.

**Recommendation (Claude's discretion):** Monthly digest consolidates all weekly digests whose ISO week START falls within the month. This is deterministic and avoids double-counting.

### Pitfall 4: Race Condition on Concurrent Ticks
**What goes wrong:** If a heartbeat tick takes longer than the interval, a second tick could start consolidation while the first is still running.
**Why it happens:** `HeartbeatRunner.tick()` iterates checks sequentially per agent, but the interval timer fires independently.
**How to avoid:** The consolidation check should use a simple lock (boolean flag or file lock) per agent to prevent concurrent consolidation. The idempotency check (D-04) is the safety net, but a lock prevents wasted LLM calls.
**Warning signs:** Duplicate digest files or duplicate memory entries.

### Pitfall 5: Enormous Prompt from 7 Days of Logs
**What goes wrong:** Seven days of verbose session logs could easily exceed the agent's context window when sent as a summarization prompt.
**Why it happens:** Daily logs can be thousands of lines each.
**How to avoid:** Truncate or chunk logs before sending to the agent. Calculate approximate token count (chars/4 as rough estimate). If too large, summarize in chunks (e.g., 2-3 days at a time, then synthesize).
**Warning signs:** Agent returns an error or truncated response from `sendToAgent()`.

### Pitfall 6: Archive Before Verify
**What goes wrong:** Archiving daily logs before confirming the digest was successfully written and stored in SQLite.
**Why it happens:** Optimistic code flow without error handling between steps.
**How to avoid:** Archive step must be the LAST step, after both markdown file write AND SQLite insert are confirmed. Use a transaction pattern: write digest -> insert memory -> archive sources. Any failure rolls back (or rather, simply doesn't archive, so the next run retries).
**Warning signs:** Archived logs but no corresponding digest; lost data.

## Code Examples

### CheckModule Pattern (from existing codebase)
```typescript
// Source: src/heartbeat/checks/context-fill.ts
const contextFillCheck: CheckModule = {
  name: "context-fill",
  async execute(context): Promise<CheckResult> {
    const { agentName, sessionManager, config } = context;
    // ... check logic
    return { status: "healthy", message: "...", metadata: {} };
  },
};
export default contextFillCheck;
```

### Memory Insert Pattern (from existing codebase)
```typescript
// Source: src/memory/store.ts (insert method)
// Insert with embedding -- atomic transaction across memories + vec_memories tables
const embedding = await embedder.embed(digestContent);
memoryStore.insert(
  { content: digestContent, source: "consolidation", importance: 0.7, tags: ["weekly-digest", "2026-W14"] },
  embedding,
);
```

### sendToAgent Pattern (from existing codebase)
```typescript
// Source: src/manager/session-manager.ts
const response = await sessionManager.sendToAgent(agentName, summarizationPrompt);
// response is a string -- must be parsed by the caller
```

### SQLite Migration Pattern (standard better-sqlite3)
```typescript
// Standard SQLite table recreation for constraint changes
db.transaction(() => {
  db.exec(`CREATE TABLE memories_new (...source TEXT NOT NULL CHECK(source IN ('conversation', 'manual', 'system', 'consolidation'))...)`);
  db.exec(`INSERT INTO memories_new SELECT * FROM memories`);
  db.exec(`DROP TABLE memories`);
  db.exec(`ALTER TABLE memories_new RENAME TO memories`);
  // Recreate vec_memories references if needed
})();
```

### Recommended Summarization Prompt Structure
```typescript
const prompt = `You are consolidating ${dailyLogs.length} days of session logs into a weekly digest.

Extract the following from these logs:
1. **Key Facts**: Important information learned or established
2. **Decisions Made**: Any decisions or choices that were committed to
3. **Topics Discussed**: Major themes and subjects covered
4. **Important Context**: Anything that would be important to remember in future conversations

Format your response as markdown with these exact headers:
## Key Facts
## Decisions Made
## Topics Discussed
## Important Context

Be concise but preserve specifics (names, dates, numbers, URLs).

---

${logsContent}`;
```

## CheckContext Extension Required

The current `CheckContext` type provides:
```typescript
type CheckContext = {
  readonly agentName: string;
  readonly sessionManager: SessionManager;
  readonly registry: Registry;
  readonly config: HeartbeatConfig;
};
```

The consolidation check needs access to:
1. `SessionManager.sendToAgent()` -- already available via `sessionManager`
2. `MemoryStore` -- accessible via `sessionManager.getMemoryStore(agentName)`
3. `EmbeddingService` -- NOT currently exposed by SessionManager (it's a private `embedder` field)
4. Agent workspace path -- accessible via `sessionManager` configs map (but private)

**Options:**
- **Option A:** Add `getEmbedder()` accessor to SessionManager (follows existing `getMemoryStore()` pattern)
- **Option B:** Add agent workspace and embedder to `CheckContext`
- **Option C:** Add a `getAgentConfig()` accessor to SessionManager to expose workspace paths

**Recommendation:** Option A + Option C. Add `getEmbedder(): EmbeddingService` and `getAgentConfig(name: string): ResolvedAgentConfig | undefined` to SessionManager's public API. This follows the existing accessor pattern (`getMemoryStore`, `getCompactionManager`, `getContextFillProvider`).

## Config Schema Extension

The `memoryConfigSchema` in `src/memory/schema.ts` needs a `consolidation` section:
```typescript
export const consolidationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  weeklyThreshold: z.number().int().min(1).default(7),  // D-02: days needed
  monthlyThreshold: z.number().int().min(1).default(4),  // D-03: weeks needed
  summaryModel: modelSchema.optional(),                   // D-15: model override
});
```

This should be added to `memoryConfigSchema` or as a sibling in the config hierarchy.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual memory curation | Automated consolidation pipeline | This phase | Daily noise becomes structured knowledge without intervention |
| Flat daily log directory | Hierarchical archive with digests | This phase | Prevents unbounded growth of active search corpus |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (latest) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/memory/__tests__/consolidation.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AMEM-01 | Weekly digest created from 7+ daily logs | unit | `npx vitest run src/memory/__tests__/consolidation.test.ts -t "weekly" -x` | Wave 0 |
| AMEM-01 | Digest stored as markdown + SQLite memory | unit | `npx vitest run src/memory/__tests__/consolidation.test.ts -t "dual storage" -x` | Wave 0 |
| AMEM-02 | Monthly digest created from 4+ weekly digests | unit | `npx vitest run src/memory/__tests__/consolidation.test.ts -t "monthly" -x` | Wave 0 |
| AMEM-03 | Daily logs archived after consolidation | unit | `npx vitest run src/memory/__tests__/consolidation.test.ts -t "archive" -x` | Wave 0 |
| AMEM-03 | Archived logs removed from session_logs table | unit | `npx vitest run src/memory/__tests__/consolidation.test.ts -t "session_logs" -x` | Wave 0 |
| D-04 | Idempotent -- no duplicate digests on re-run | unit | `npx vitest run src/memory/__tests__/consolidation.test.ts -t "idempotent" -x` | Wave 0 |
| D-08 | Source="consolidation" with correct importance | unit | `npx vitest run src/memory/__tests__/consolidation.test.ts -t "importance" -x` | Wave 0 |
| D-01 | Heartbeat check triggers consolidation | integration | `npx vitest run src/heartbeat/checks/__tests__/consolidation.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/memory/__tests__/consolidation.test.ts --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/memory/__tests__/consolidation.test.ts` -- covers AMEM-01, AMEM-02, AMEM-03, D-04, D-08
- [ ] `src/heartbeat/checks/__tests__/consolidation.test.ts` -- covers D-01 (heartbeat integration)
- [ ] Schema migration test for adding 'consolidation' source

## Open Questions

1. **Check timeout for LLM calls**
   - What we know: Default `checkTimeoutSeconds` is 10. LLM summarization via `sendToAgent` takes 10-60+ seconds.
   - What's unclear: Whether to add a per-check timeout override to `CheckModule` type, or handle internally.
   - Recommendation: Add optional `timeout` property to `CheckModule` interface. Consolidation check sets it to 120 seconds (or higher). This is a minimal, backward-compatible extension.

2. **date-fns installation status**
   - What we know: Listed in CLAUDE.md stack as a supporting library. Not in package.json dependencies.
   - What's unclear: Whether it's already installed or needs adding.
   - Recommendation: Check `node_modules/date-fns` at plan time. If missing, add install step. ISO week calculation is critical -- do not hand-roll.

3. **Partial week handling**
   - What we know: User left this to Claude's discretion.
   - What's unclear: Whether to consolidate partial weeks (< 7 days) or wait.
   - Recommendation: Consolidate when 7+ undigested daily logs exist (D-02). Don't wait for a "complete" calendar week. If there are 10 daily logs spanning two weeks, create the digest for the earliest complete week first. Partial weeks at month end get picked up in the next weekly cycle.

## Sources

### Primary (HIGH confidence)
- `src/heartbeat/checks/context-fill.ts` -- Reference check module pattern
- `src/heartbeat/runner.ts` -- HeartbeatRunner tick/timeout/interval mechanics
- `src/heartbeat/types.ts` -- CheckModule, CheckContext, CheckResult types
- `src/heartbeat/discovery.ts` -- Auto-discovery of check modules from directory
- `src/memory/store.ts` -- MemoryStore schema, insert, session_logs, CHECK constraint
- `src/memory/types.ts` -- MemorySource type union
- `src/memory/schema.ts` -- Zod schemas for memory config and source enum
- `src/memory/session-log.ts` -- SessionLogger daily log writing
- `src/memory/compaction.ts` -- CompactionManager pattern (similar workflow: detect -> process -> store)
- `src/manager/session-manager.ts` -- sendToAgent(), memory accessors, embedder lifecycle
- `src/config/schema.ts` -- Config schema structure, heartbeat config, memory config

### Secondary (MEDIUM confidence)
- date-fns ISO week functions -- well-established library, verified from training data

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies
- Architecture: HIGH -- follows established heartbeat check pattern exactly
- Pitfalls: HIGH -- identified from direct code inspection (CHECK constraint, timeout, ISO weeks)
- Schema migration: MEDIUM -- SQLite migration pattern is standard but needs careful testing with vec_memories table

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (stable -- all findings based on existing codebase patterns)
