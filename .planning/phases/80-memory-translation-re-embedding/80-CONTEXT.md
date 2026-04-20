# Phase 80: Memory Translation + Re-embedding - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement `memory-translator.ts` that reads each migrated agent's workspace markdown (MEMORY.md, memory/*.md, .learnings/*.md) from the target workspace (copied by Phase 79), chunks each file into memories, generates fresh 384-dim MiniLM embeddings via the resident singleton, and inserts through `MemoryStore.insert()` with an `origin_id UNIQUE` column ensuring idempotency. `.learnings/*` entries are tagged as first-class `"learning"` memories. Disk is the source of truth — the OpenClaw sqlite `chunks` table is NOT read by this phase.

Delivers MEM-01 (verbatim text preservation), MEM-02 (origin_id UNIQUE idempotency), MEM-03 (MemoryStore.insert() — no raw SQL), MEM-04 (.learnings tag="learning"), MEM-05 (disk-as-truth; sqlite not read).

</domain>

<decisions>
## Implementation Decisions

### Chunking & Origin ID
- **MEMORY.md:** Split by H2 (`## `) headings. Each H2 section (heading + body until next H2 or EOF) becomes one memory. If file has no H2s, treat whole file as a single memory. Full section text preserved verbatim (including heading).
- **memory/*.md and .learnings/*.md:** One memory per file. Full file content preserved verbatim as the memory's content.
- **origin_id format:** `openclaw:<agent>:<sha256-of-relative-path>` — path-only hash. Same path → same origin_id across re-runs → UNIQUE constraint triggers idempotent skip. Content changes don't create duplicates. Relative path is relative to the TARGET workspace (e.g., `MEMORY.md`, `memory/foo.md`, `.learnings/bar.md`).
- **Section-level origin_id for MEMORY.md H2 sections:** `openclaw:<agent>:<sha256-of-relative-path>:section:<slug-of-h2-heading>` — ensures each H2 section is idempotently re-insertable even when MEMORY.md is re-run.
- **Importance scoring:**
  - Default (memory/*.md): **0.5**
  - `.learnings/*.md`: **0.7** (explicitly captured insights)
  - MEMORY.md first H2 section (top of file): **0.6** (user's most-prominent content)
  - MEMORY.md other sections: **0.5**

### Tags & Memory Source
- **All migrated memories:** tag `"migrated"` + `"openclaw-import"`
- **`.learnings/*.md`:** additionally add `"learning"` + basename (without `.md`)
- **MEMORY.md sections:** additionally add `"workspace-memory"` + H2 heading slugified (lowercase, spaces→hyphens, non-alphanum stripped)
- **memory/*.md:** additionally add `"memory-file"` + filename stem
- **`source` field on CreateMemoryInput:** use existing MemorySource enum — pick `"workspace-markdown"` (add if doesn't exist) or reuse `"user"` with the tags carrying the distinction

### Idempotency via origin_id UNIQUE
- **Schema migration:** Add `origin_id TEXT UNIQUE` column to `memories` table via existing migration pattern in `src/memory/store.ts` (look for `migrate*` methods). Column is nullable (existing rows have NULL — NULL values are not considered equal for UNIQUE purposes in SQLite, so existing rows coexist fine).
- **Extend `CreateMemoryInput` type:** add optional `origin_id?: string` in `src/memory/types.ts`.
- **Extend `MemoryStore.insert()`:** when `origin_id` is provided, use `INSERT OR IGNORE INTO memories (..., origin_id) VALUES (...)` semantics. If row already exists with that origin_id → return the existing row (read back via `SELECT ... WHERE origin_id = ?`). CLI output: `upserted 0, skipped N (already imported via origin_id)`.
- **Backward compat:** existing callers don't pass origin_id → column remains NULL → no behavior change. All 461 existing migration/memory tests stay green.

### Stale Source & Embedder
- **Disk as truth:** Migrator reads TARGET workspace markdown files (post-Phase 79 copy). Does NOT read `~/.openclaw/memory/<agent>.sqlite`. The sqlite was a derived file-RAG index; may be stale; adds no value.
- **Embedder:** Reuse existing singleton at `src/memory/embedding.ts` (384-dim all-MiniLM-L6-v2 via @huggingface/transformers). One embedding call per memory; serial processing per-agent (embedder non-reentrancy).
- **Performance:** ~131s total for 2,617 chunks per STACK.md estimate. Zero API cost (local ONNX).

### Integration & Ledger
- **Module:** `src/migration/memory-translator.ts` — exports `translateAgentMemories(agentName, targetWorkspace, memoryPath, options)` returning `{upserted: number, skipped: number, ledgerRows: LedgerRow[]}`.
- **Called by:** `runApplyAction` in `migrate-openclaw.ts` after workspace-copier + session-archiver succeed for that agent.
- **Ledger rows:** one per memory — `{step: "memory-translate:embed-insert", outcome: "allow" | "skipped", agent, file_hashes: {<relpath>: <sha>}, notes: "new" | "already-imported"}`. CLI prints aggregate count per agent.
- **Zero raw SQL:** `rg 'INSERT INTO vec_memories' src/migration/` must return zero matches. All inserts go through `MemoryStore.insert()`.

### Claude's Discretion
- Exact signature refinements
- Whether to add a `MemorySource` enum value for "workspace-markdown" or reuse existing
- H2 heading slugification exact algorithm (reasonable: lowercase, collapse whitespace, strip non-alphanum)
- Test fixture layout

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/memory/store.ts:MemoryStore.insert(input, embedding)` — public API. Has dedup support already. Returns `MemoryEntry`.
- `src/memory/types.ts:CreateMemoryInput` — has `content, source, importance?, tags?, skipDedup?, sourceTurnIds?`. NO `origin_id` yet — Phase 80 adds it.
- `src/memory/embedding.ts` — resident singleton for 384-dim MiniLM embedder (per STACK.md)
- `src/memory/store.ts` has migrate* methods for schema evolution (FTS, conversation turns, api key sessions) — follow that pattern for origin_id column
- `src/migration/ledger.ts` — append ledger rows with extended schema (Phase 77)

### Established Patterns
- Schema migrations in `store.ts` run on `initDatabase`: check PRAGMA table_info, ALTER TABLE ADD COLUMN if missing, idempotent
- `MemoryStore.insert()` returns `MemoryEntry` (merged if dedup, new if inserted)
- Local ONNX embedder has warmup latency (~first call 200ms, subsequent 50ms) — serial is fine

### Integration Points
- New module: `src/migration/memory-translator.ts`
- Extend: `src/memory/types.ts:CreateMemoryInput` (additive optional field)
- Extend: `src/memory/store.ts:MemoryStore.insert()` — handle origin_id INSERT OR IGNORE path
- Extend: `src/memory/store.ts` schema init — add `origin_id TEXT UNIQUE` migration method
- Extend: `src/cli/commands/migrate-openclaw.ts:runApplyAction` — call translator per agent after workspace copy
- Target workspace paths: use `config.memoryPath` (Phase 75) + `config.workspace` (existing) to locate target markdown files — the per-agent `memories.db` lives under `memoryPath/memory/memories.db`

</code_context>

<specifics>
## Specific Ideas

- CLI output format for re-run (per success criterion #2): `upserted 0, skipped N (already imported via origin_id)` — use this literal string pattern.
- vec_length validation command (per success criterion #3): `sqlite3 <memories.db> "SELECT vec_length(embedding) FROM vec_memories"` returns 384 for all rows.
- Tag format for memory_lookup queries (per success criterion #4): `memory_lookup {tag: "learning"}` retrieves .learnings entries.
- Ledger witness for file-deleted-from-source scenario: NOT applicable since we only read disk, never compare against sqlite. Success criterion #5's "skipped: file-deleted-from-source" is vacuously satisfied — no comparison occurs.

</specifics>

<deferred>
## Deferred Ideas

- Reading OpenClaw's `chunks` sqlite table for cross-reference — STATE.md decision: don't; disk is truth
- Re-embedding existing (non-migrated) memories — out of scope; only migrated rows get fresh embeddings
- Rich markdown parsing (extract code blocks as separate memories, YAML frontmatter parsing) — phase 80 keeps it simple; whole-file or H2-split is sufficient
- Verify / rollback of memory translation — Phase 81 handles verify via re-query; rollback is via `DELETE FROM memories WHERE origin_id LIKE 'openclaw:<agent>:%'` in Phase 81
- Auto-summary / auto-link of imported memories — skip during import; heartbeat auto-linker (v1.5) will pick them up at next cycle

</deferred>
