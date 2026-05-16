---
phase: 101-robust-document-ingestion-pipeline-operator-daily-driver-unb
plan: 03
subsystem: memory-cross-ingest + time-window-filter
tags: [cross-ingest, memory_chunks, applyTimeWindowFilter, embedding-v2, phase101, CF-1, CF-2, U6]
requires:
  - Phase 49 RAG (memory_chunks + vec_memory_chunks + memory_chunks_fts)
  - Phase 90 MEM-02 (applyTimeWindowFilter — extended by CF-1)
  - Phase 101 Plan 01 (document-ingest engine + vec_document_chunks int8[384])
  - Phase 101 Plan 02 (ingest_document MCP tool + extractor + alerts)
  - Phase 115 D-08 (EmbeddingV2Migrator state machine; embedder.embedV2)
provides:
  - src/document-ingest/cross-ingest.ts (crossIngestToMemory + MigrationPhaseStore)
  - extended applyTimeWindowFilter allow-list — document: prefix exempt (CF-1)
  - computeDocSlug shared helper (single source of truth for the doc slug)
  - phase101-ingest telemetry fields: memoryChunksWritten + migrationPhaseAfter
affects:
  - src/memory/memory-chunks.ts (CF-1 allow-list)
  - src/manager/daemon.ts (cross-ingest wiring + telemetry augmentation)
  - src/document-ingest/index.ts (computeDocSlug export)
tech-stack:
  added: []
  patterns:
    - "Reuse existing Phase 115 EmbeddingV2Migrator state machine rather than
      forking a new ~/.clawcode/agents/<agent>/migration-phase.json store
      (plan's 'reuse if a store of this shape exists' clause)"
    - "3-phase facade over Phase 115's 7-phase state machine (idle/rolled-back
      -> v1-only; dual-write/re-embedding/re-embed-complete -> dual-write;
      cutover/v1-dropped -> v2-only) keeps the cross-ingest seam speaking
      the plan's simpler vocabulary while the underlying truth stays canonical"
    - "Non-fatal cross-ingest failure path — alerts never poison the parent
      ingest; document is still committed to DocumentStore"
key-files:
  created:
    - src/document-ingest/cross-ingest.ts
    - tests/memory/applyTimeWindowFilter.test.ts
    - tests/document-ingest/cross-ingest.test.ts
  modified:
    - src/memory/memory-chunks.ts (CF-1 1-LOC + JSDoc)
    - src/document-ingest/index.ts (export computeDocSlug)
    - src/manager/daemon.ts (cross-ingest wiring + telemetry fields)
    - tests/document-ingest/mcp-tool.test.ts (crossIngestToMemory wiring guard)
decisions:
  - "MigrationPhaseStore is a thin adapter over Phase 115's existing
    EmbeddingV2Migrator, not a new JSON file. Plan's explicit fallback
    clause ('If a store of this shape already exists in the codebase,
    reuse it') applies — the migrations SQLite table per-agent is the
    canonical source of truth and forking would split-brain the state."
  - "v2-only branch reuses the v1+v2 dual-write write path. Chunks-side
    cutover (future plan-115-09) hasn't shipped; vec_memory_chunks v1 stays
    populated for v2-only mode today. When 115-09 lands it will reconcile
    the v1 chunk vec column; cross-ingest behavior at that point auto-aligns
    because the migrator's phase machine drives both surfaces."
  - "Cross-ingest failure → 'embedder-failure' alert reason (existing
    enum, no alerts.ts change). 'cross-ingest-failed' was considered but
    deferred — the actual failure modes (embedV1/embedV2 throws, SQLite
    write throws) all fall under the existing semantic category."
  - "computeDocSlug centralized in src/document-ingest/index.ts so the
    daemon's docs/<doc-slug>-<date>.{md,json} path and the cross-ingest
    'document:<slug>' key derive from the same algorithm — eliminates
    a class of bugs where the two paths might drift."
metrics:
  duration: "~30 minutes"
  completed: 2026-05-16
  commits: 3 task commits + 1 summary commit
  tasks: 3
  tests-added: 11 (5 applyTimeWindowFilter regression + 6 cross-ingest end-to-end)
  files-changed: 7 (3 created, 4 modified)
---

# Phase 101 Plan 03: CF-1 Filter Fix + crossIngestToMemory + Phase 115 Dual-Write Auto-Flip Summary

**One-liner:** Mirrors every ingested document chunk into the agent's memory pipeline (memory_chunks + memory_chunks_fts + vec_memory_chunks{_v2}) under `path: "document:<slug>"` so Phase 90 hybrid-RRF surfaces document content on subsequent operator turns; extends `applyTimeWindowFilter`'s allow-list to exempt the `document:` prefix from the 14-day expiry (CF-1); auto-flips v1-only agents to Phase 115 `dual-write` mode on first document ingest (CF-2 coordination) by reusing the existing `EmbeddingV2Migrator` state machine via a 3-phase facade.

## What Shipped

### 1. CF-1 — `applyTimeWindowFilter` allow-list extension (T01)

- **`src/memory/memory-chunks.ts`** — single new branch in the filter body matching the existing vault/procedures allow-list pattern:
  ```typescript
  if (c.path.startsWith("document:")) return true;
  ```
  JSDoc updated to reference Phase 101 U6 cross-ingest and the CF-1 fix rationale (documents are operator-curated artifacts, not session notes — they MUST survive the 14-day expiry).
- **`tests/memory/applyTimeWindowFilter.test.ts`** — dedicated 5-case regression guard with a fixed `NOW = 2026-05-16` epoch:
  - CF-1-TW1: vault path retained when 365d old (regression guard for pre-existing behavior).
  - CF-1-TW2: procedures path retained when 100d old (regression guard).
  - CF-1-TW3: `document:pon-2024-tax-return` retained when 30d old (new behavior).
  - CF-1-TW4: `document:` exact prefix required — `documentary_film_notes.md` NOT exempted (prefix-not-substring).
  - CF-1-TW5: generic session path filtered when older than `days` (no allow-list leak).

### 2. `crossIngestToMemory` helper (T02)

- **`src/document-ingest/cross-ingest.ts`** — new module exporting:
  - `crossIngestToMemory(args): Promise<{chunksWritten, migrationPhaseAfter}>`
  - `MigrationPhaseStore` class (thin adapter over `EmbeddingV2Migrator`)
  - `CrossIngestMigrationPhase` type (`'v1-only' | 'dual-write' | 'v2-only'`)
- **Write surface:**
  - `memory_chunks` (path = `document:<docSlug>`, body = chunk content, file_mtime_ms = now)
  - `memory_chunks_fts` (FTS5 mirror)
  - `vec_memory_chunks` (v1 float[384]) — for v1-only + dual-write
  - `vec_memory_chunks_v2` (int8[384]) — for dual-write + v2-only
- **Idempotency:** `MemoryStore.deleteMemoryChunksByPath(path)` runs BEFORE the per-chunk insert loop, so re-ingestion DELETEs + re-INSERTs cleanly with fresh nanoid chunk ids.
- **CF-2 dual-write coordination:** `MigrationPhaseStore.flipToDualWriteIfV1Only()` detects an `idle` (or `rolled-back`) agent via the existing per-agent `migrations` SQLite table and transitions it to `dual-write` (a legal transition per `LEGAL_TRANSITIONS`). The phase persists across new `EmbeddingV2Migrator` instances because state lives in the agent's per-agent SQLite DB.
- **Phase mapping** (3-phase facade ↔ 7-phase Phase 115 truth):
  | Cross-ingest facade | Phase 115 phases |
  |---------------------|-------------------|
  | `'v1-only'`         | `idle`, `rolled-back` |
  | `'dual-write'`      | `dual-write`, `re-embedding`, `re-embed-complete` |
  | `'v2-only'`         | `cutover`, `v1-dropped` |
- **T-101-11 mitigation:** `DOC_SLUG_RE = /^[a-z0-9-]+$/` validates the slug BEFORE any write. Inputs like `pon-2024 tax return` (space) or `../../etc/passwd` (slashes + dots) throw `Error("invalid docSlug: ...")`.
- **`tests/document-ingest/cross-ingest.test.ts`** — 6 end-to-end cases using temp SQLite DBs:
  - U6-T01: v1-only agent auto-flips to dual-write; both vec tables populated.
  - U6-T02: dual-write entry stays dual-write; FTS row written.
  - U6-T03: v2-only (cutover) path; vec_v2 populated; phase persists.
  - U6-T04: idempotency — second call DELETEs + re-INSERTs with NEW chunk ids (disjoint sets).
  - U6-T05: invalid docSlug with space rejected per T-101-11.
  - U6-T06: CF-1 round-trip — `applyTimeWindowFilter` retains the cross-ingested chunk past the 14-day expiry.

### 3. Daemon wiring (T03)

- **`src/document-ingest/index.ts`** — new shared helper `computeDocSlug(filePath)` exported from the engine entrypoint. Algorithm: basename → strip extension → lowercase → collapse non-`[a-z0-9-]` to `-` → trim leading/trailing `-` → fall back to `"document"`. Compatible with cross-ingest's `DOC_SLUG_RE` by construction.
- **`src/manager/daemon.ts`** — ingest-document IPC handler updated:
  - Imports `computeDocSlug`, `crossIngestToMemory`, `MigrationPhaseStore`.
  - Replaces inline slug computation with `computeDocSlug(filePath)`.
  - After `docStore.ingest(source, chunks, embeddings)` succeeds, calls `crossIngestToMemory` with the same chunks. Uses the same `manager.getEmbedder()` instance for both `embedderV1` and `embedderV2` (single object exposes `embed()` AND `embedV2()` per Phase 115).
  - Cross-ingest failure is non-fatal: caught, logged as `phase101-ingest cross-ingest-failed`, routed through `recordIngestAlert({reason: 'embedder-failure', severity: 'error'})`. The parent ingest continues with `memoryChunksWritten = 0`; the document is still committed to the DocumentStore.
  - Telemetry payload augmented with `memoryChunksWritten` (int) + optional `migrationPhaseAfter` (`'v1-only' | 'dual-write' | 'v2-only'`). Both flow through `logIngest()` so operators can grep `phase101-ingest` for the auto-flip event.
- **`tests/document-ingest/mcp-tool.test.ts`** — one new static-grep case asserts daemon.ts contains `crossIngestToMemory(`, `memoryChunksWritten`, and `migrationPhaseAfter`. Mirrors the existing Plan 02 wiring guards.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - T01 atomic-commit discipline violated by external process]** During T01 execution a concurrent process swept my staged T01 files (`memory-chunks.ts` CF-1 fix + the new test file) into commit `a1b6495` — a Plan 02 follow-up titled "fix(101-02): thread backend param through engine to ocrPage." A subsequent commit `413a466` ("revert(101-02): unintended Plan 03 CF-1 leak") then explicitly reverted the CF-1 work, leaving a note that Plan 03 T01 owns this. I re-applied the same diff cleanly under commit `659325d` (`feat(101-03-T01)`). The CF-1 source-code change is byte-identical between `a1b6495` and `659325d`. Atomic-commit discipline was not violated by this executor; it was violated by an external process and then corrected by another external process before this executor's T01 commit landed. Documented for clarity.

**2. [Rule 3 - MigrationPhaseStore reuses Phase 115 EmbeddingV2Migrator, not a new JSON file]** Plan T02 action text described `~/.clawcode/agents/<agent>/migration-phase.json` (a new 30-LOC JSON file reader/writer). The plan ALSO said: "If a store of this shape already exists in the codebase, reuse it." Phase 115's `EmbeddingV2Migrator` does exist (`src/memory/migrations/embedding-v2.ts`), encodes a richer 7-phase state machine with explicit legal transitions, and persists per-agent state in the agent's own SQLite `migrations` table. Forking a JSON file would split-brain the agent's migration state. Reused per the plan's own fallback clause. Documented the 7→3 phase mapping in `cross-ingest.ts`'s module docblock.

**3. [Rule 3 - v2-only branch reuses dual-write write path]** Plan T02 behavior point (c) says "vec_memory_chunks row using embedderV1.embed() IFF migrationPhase is 'v1-only' OR 'dual-write'" — implying v2-only should skip the v1 vec table. The existing `MemoryStore.insertMemoryChunk()` always writes `vec_memory_chunks` (it's a single transaction across all four memory-chunk tables). Adding a v2-only chunk-insert primitive to MemoryStore would touch a file the plan's T02 `<files>` block did not list. Since chunks-side cutover (`v2-only` mapping = Phase 115 `cutover` / `v1-dropped`) is a future Plan 115-09 concern that hasn't shipped, today's behavior writes v1 + v2 in the v2-only branch. Test U6-T03 was written to assert `vec_memory_chunks_v2` IS populated (not that v1 is absent). When 115-09 lands and drops the v1 chunk vec column, cross-ingest behavior auto-aligns because the migrator's phase machine drives both surfaces.

**4. [Rule 3 - 'embedder-failure' reused for cross-ingest failure path]** Plan T03 action text offered either reusing `'embedder-failure'` or adding a new `'cross-ingest-failed'` alert reason. Picked `'embedder-failure'` because the actual failure modes (embedV1/embedV2 throws, SQLite write throws inside the transaction) all fall under that semantic category, and avoiding the alerts.ts touch keeps T03's surface within the plan's `<files>` block.

### Auth Gates / Architectural Decisions

None. No Rule 4 surfaces hit. No auth gates triggered (the only external dependency added was the existing Phase 115 EmbeddingV2Migrator class, all local).

## Success Criteria Status

| ID | Description | Status | Notes |
|----|-------------|--------|-------|
| SC-6 | Auto cross-ingest into memory pipeline + CF-1 filter fix | **MET** | Every chunk lands in memory_chunks + vec_memory_chunks(_v2) + memory_chunks_fts under path 'document:<slug>'. CF-1 allow-list extends applyTimeWindowFilter to exempt the document: prefix. 11 dedicated tests pass (5 CF-1 regression + 6 cross-ingest end-to-end). |
| CF-1 | Single-LOC + dedicated regression test for applyTimeWindowFilter | **MET** | 1 LOC + 4-line JSDoc in src/memory/memory-chunks.ts. 5-case test file at tests/memory/applyTimeWindowFilter.test.ts. |
| CF-2 | Cross-write coordination — v1-only agents auto-flip to dual-write | **MET** | MigrationPhaseStore.flipToDualWriteIfV1Only() called BEFORE any chunk write; persisted via the existing EmbeddingV2Migrator → migrations SQLite table. U6-T01 verifies the persistence across new migrator instances. |
| Graceful degradation | Cross-ingest failure non-fatal to parent ingest | **MET** | Try/catch in daemon.ts; alert routed through recordIngestAlert; telemetry continues with memoryChunksWritten=0; document still in DocumentStore. |

## Smoke Check (Deferred to Plan 05)

The plan calls for a live smoke check (`ingest pon-2024-tax-return.pdf` → next turn's `"what was Pon's Schedule C net profit?"` retrieves via Phase 90 RRF). Deferred to Plan 05's operator-gated deploy + UAT step. This is not a regression — Plan 05 is the canonical phase-closer and owns the live deploy.

## Test Coverage

- `tests/memory/applyTimeWindowFilter.test.ts` — 5 cases (CF-1 allow-list extension).
- `tests/document-ingest/cross-ingest.test.ts` — 6 cases (end-to-end against temp SQLite).
- `tests/document-ingest/mcp-tool.test.ts` — 1 new static-grep wiring guard added (now 9 total).

**Totals:** 11 new vitest cases added; 94/94 across `tests/document-ingest/`, `tests/memory/`, and `src/memory/__tests__/memory-chunks.test.ts`. `npx tsc --noEmit` clean.

## Wiring Status

- **Cross-ingest is live:** every successful ingest-document IPC call now mirrors chunks into memory_chunks (auto-flipping v1-only agents to dual-write on first document for the agent).
- **CF-1 allow-list is live:** any chunk with `path` starting `document:` survives the 14-day expiry.
- **Telemetry fields exposed:** `phase101-ingest` log lines now carry `memoryChunksWritten` + (when present) `migrationPhaseAfter`.
- **NOT yet reranking:** Plan 04 ships `Xenova/bge-reranker-base` over the Phase 90 RRF top-20.
- **NOT yet deployed:** Plan 05 closes the phase with operator-gated deploy + live UAT against the real Pon 2024 PDF.

## Known Stubs

None. Cross-ingest writes real rows to real SQLite tables; phase auto-flip writes a real state-machine transition to the agent's `migrations` table.

## Threat Flags

None. The plan's `<threat_model>` enumerated T-101-09 through T-101-11; all are mitigated:

- **T-101-09** (info disclosure via FTS): mitigated by Phase 49's per-agent SQLite isolation — cross-ingest writes only to the same-agent store. No cross-agent surface added.
- **T-101-10** (DoS via large documents): mitigated by Phase 101 Plan 01's `MAX_PAGES=500` engine guard upstream of cross-ingest. `memoryChunksWritten` telemetry field gives operators a per-doc visibility into chunk count growth.
- **T-101-11** (path tampering via adversarial docSlug): mitigated by `DOC_SLUG_RE = /^[a-z0-9-]+$/` validation BEFORE any write. Test U6-T05 pins the rejection path.

No new threat surface introduced beyond what the model documented.

## Decisions Affecting Future Plans

- **Cross-ingest writes v1 vec_memory_chunks rows even in v2-only mode.** When Plan 115-09 (chunks-side cutover) lands and drops the v1 chunk vec column, cross-ingest behavior auto-aligns because the migrator's phase machine drives the conditional. No cross-ingest code change required at that time — only the column-drop transition.
- **`computeDocSlug` is the single source of truth.** Future plans touching the docSlug grammar (e.g., adding Unicode normalization or longer-form slugs) should update only `src/document-ingest/index.ts` — the daemon + cross-ingest derive from it.
- **`'embedder-failure'` alert reason now covers cross-ingest failure paths in addition to the parent embedder.embedV2 failure.** If a future plan needs to distinguish them at the dashboard level, add a new `'cross-ingest-failed'` reason to `IngestAlertReason` and split the catch branches in daemon.ts.

## Self-Check: PASSED

- src/document-ingest/cross-ingest.ts: FOUND
- tests/memory/applyTimeWindowFilter.test.ts: FOUND
- tests/document-ingest/cross-ingest.test.ts: FOUND
- T01 commit 659325d: FOUND
- T02 commit f431c72: FOUND
- T03 commit 69ac22d: FOUND
- 94/94 vitest cases pass across tests/document-ingest + tests/memory + src/memory/__tests__/memory-chunks.test.ts
- npx tsc --noEmit clean
- Static-grep `grep -E "vault/|procedures/|document:" src/memory/memory-chunks.ts` returns the three allow-list entries
- `grep -v '^#' src/manager/daemon.ts | grep -c "crossIngestToMemory"` = 2 (≥1)
- `grep -v '^#' src/manager/daemon.ts | grep -c "memoryChunksWritten"` = 3 (≥1)
- `grep -v '^#' src/document-ingest/index.ts | grep -c "computeDocSlug"` = 1 (≥1)
