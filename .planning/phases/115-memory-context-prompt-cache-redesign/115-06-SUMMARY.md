---
phase: 115-memory-context-prompt-cache-redesign
plan: 06
subsystem: memory
tags: [embedding, bge-small, int8, sqlite-vec, migration, onnx]

# Dependency graph
requires:
  - phase: 90-clawhub-marketplace-fin-acquisition-memory-prep
    provides: per-agent SQLite isolation lock (D-MEM-02) — every per-agent migration step is its own DB transaction.
  - phase: 99-memory-translator-and-sync-hygiene
    provides: getAgentMemoryDbPath helper + CI grep regression pin (Phase 99-A) — migration code MUST NOT regress this.
  - phase: 107-memory-pipeline-integrity-dream-json-vec-memories-orphan-cleanup
    provides: VEC-CLEAN-* atomic-cascade invariant (memories + vec_memories deletes inside one db.transaction()) — extended in this plan to vec_memories_v2 + vec_memory_chunks_v2.
  - phase: 115-memory-context-prompt-cache-redesign
    provides: D-06 (bge-small-en-v1.5 lock), D-07 (int8 quantization lock), D-08 (dual-write transition lock), D-09 (5% CPU budget cost discipline).
provides:
  - bge-small-en-v1.5 ONNX embedder (BGE_SMALL_MODEL_ID + warmupBgeSmall + embedBgeSmall) parallel to legacy MiniLM
  - EmbeddingService dispatcher (embedV1 / embedV2Float32 / embedV2 + warmupV2 + isV2Ready) preserving the Phase 1-114 embed(text) contract
  - int8 scalar quantization helpers (quantizeInt8 / dequantizeInt8 / recallLossEstimate / int8ToBuffer) at fixed [-1, +1] range
  - vec_memories_v2 + vec_memory_chunks_v2 sqlite-vec virtual tables (int8[384] cosine)
  - migrations table + EmbeddingV2Migrator state machine (7-phase: idle → dual-write → re-embedding → re-embed-complete → cutover → v1-dropped, plus rolled-back)
  - Resumable batch re-embed runner (runReEmbedBatch) with cursor-based pagination + Discord-active priority gate + per-entry failure recovery
  - clawcode memory migrate-embeddings CLI (8 subcommands: status / start / re-embed / pause / resume / force-cutover / rollback / v1-dropped)
  - Daemon-side IPC handlers (embedding-migration-status / -transition / -pause / -resume) wired to per-agent EmbeddingV2Migrator
  - Cascade-delete extension to v2 (delete + deleteMemoryChunksByPath + cleanupOrphans + cleanupOrphansSplit)
  - insertWithDualWrite primitive for atomic v1 + v2 + memories triple-write
  - listMemoriesMissingV2Embedding / countMemoriesMissingV2Embedding / countVecMemoriesV2 read API for runner
  - Config schema: defaults.embeddingMigration { cpuBudgetPct=5, batchSize=50, pausedAgents=[] }
affects: [115-07, 115-08, 115-09, 115-10, future-phases-touching-memory-retrieval]

# Tech tracking
tech-stack:
  added:
    - BAAI/bge-small-en-v1.5 (Apache 2.0 ONNX model, MTEB ~64, 384-dim, ~33MB)
    - sqlite-vec int8[384] column type via vec_int8(?) SQL function
  patterns:
    - "Embedding-version dispatcher: legacy embed(text) preserved unchanged; new explicit embedV1 / embedV2Float32 / embedV2 entry points for migration-aware callers"
    - "Fixed-range int8 quantization (NOT per-vector min/max) — sqlite-vec native distance metric requires shared range across all vectors"
    - "Per-agent migration state machine in per-agent SQLite DB — Phase 90 isolation invariant preserved"
    - "Resumable cursor-based batch processing with phase-guarded saveCursor (silent no-op outside dual-write/re-embedding)"
    - "Idempotent INSERT OR REPLACE for v2 vector writes; DELETE-WHERE-no-match no-op cascades for pre-dual-write entries"

key-files:
  created:
    - src/memory/embedder-bge-small.ts
    - src/memory/embedder-quantize.ts
    - src/memory/migrations/embedding-v2.ts
    - src/memory/migrations/embedding-v2-runner.ts
    - src/cli/commands/memory-migrate-embeddings.ts
    - src/memory/__tests__/embedder-bge-small.test.ts
    - src/memory/__tests__/embedder-quantize.test.ts
    - src/memory/__tests__/embedding-v2-cascade-delete.test.ts
    - src/memory/__tests__/embedding-v2-migration.test.ts
  modified:
    - src/memory/embedder.ts (refactored to dispatcher; legacy embed(text) preserved)
    - src/memory/store.ts (vec_memories_v2 + vec_memory_chunks_v2 schema, cascade-delete extension, insertWithDualWrite, list/count missing-v2)
    - src/config/schema.ts (defaults.embeddingMigration field)
    - src/ipc/protocol.ts (4 new IPC methods)
    - src/manager/daemon.ts (4 new IPC handler cases)
    - src/cli/commands/memory.ts (registerMigrateEmbeddingsCommand wiring)

key-decisions:
  - "Fixed-range [-1, +1] quantization, NOT per-vector min/max. Per-vector scaling would make sqlite-vec native distance comparisons across vectors meaningless. Locked range is tight bound for L2-unit-norm bge-small output."
  - "EmbeddingService.embed(text) signature preserved unchanged (returns Float32Array, defaults to v1 MiniLM). 7 existing callers (compaction / consolidation / conversation-search / episode-store / memory-scanner / session-summarizer / tier-manager) require zero changes during dual-write transition."
  - "Migrations table lives in per-agent DB (key='embeddingV2'), NOT in shared manager DB. Phase 90 lock preserved — pause / status / rollback are per-agent operations."
  - "Cascade delete extension is idempotent — pre-dual-write entries with no v2 row see DELETE-WHERE-no-match as a 0-row no-op, no error."
  - "CPU budget enforced via heartbeat scheduler cadence (NOT in-runner sleeping). Heartbeat ticks fire every 5min by default; one batch per tick produces well below 5% CPU. Operators can tighten heartbeat to spend budget more aggressively."
  - "embeddingMigration config field is .optional() (mirrors shimRuntime/brokers Phase 110 pattern). Schema-only this plan; runtime wiring lands in wave 4."
  - "force-cutover and rollback CLI subcommands require interactive y/N confirmation (-y/--yes flag bypasses for scripted use). Operator confirmation is the safety gate per Phase 115 D-08 threat model."

patterns-established:
  - "Embedding dispatcher pattern: EmbeddingService keeps the legacy embed(text) contract while adding explicit version-aware entry points (embedV1 / embedV2Float32 / embedV2). Migration-aware callers (dual-write hooks, batch runner) use the explicit forms; legacy callers continue unchanged."
  - "Per-agent state machine in per-agent DB: every per-agent operation (status, pause, transition) opens a fresh EmbeddingV2Migrator constructed from manager.getMemoryStore(agent).getDatabase(). No shared singleton."
  - "Fixed-range int8 quantization for sqlite-vec: shared QUANTIZATION_MIN/MAX across all vectors (not per-vector min/max). Pinned by static-grep regression test on the constants."

requirements-completed: []

# Metrics
duration: 18 min
completed: 2026-05-08
---

# Phase 115 Plan 06: Embedding upgrade (bge-small-en-v1.5 + int8) + dual-write migration machinery

**Ships the machinery for migrating from MiniLM-L6 (MTEB ~56) to bge-small-en-v1.5 + int8 (MTEB ~64, 78% storage reduction) via dual-write + resumable background batch re-embed; T+0/T+7d/T+14d timeline runs post-deploy via the new clawcode memory migrate-embeddings CLI.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-05-08T03:55:00Z
- **Completed:** 2026-05-08T04:25:30Z
- **Tasks:** 5 (T01–T05) + advisor-driven atomicity fix
- **Files created:** 9
- **Files modified:** 6
- **New tests:** 56 (all passing)
- **Total commits:** 7 (5 task commits + 1 docs + 1 atomicity fix)

## Accomplishments

- **bge-small-en-v1.5 ONNX embedder** alongside legacy MiniLM — same 384-dim, no MRL truncation, mean-pool + L2-normalize per documented retrieval setup, 200-word truncation discipline matching MiniLM for dual-write parity.
- **Int8 scalar quantization at fixed [-1, +1] range** — sqlite-vec compatible (the per-vector min/max scheme the plan body literally proposed would have broken cross-vector distance comparisons; fixed range is correct per the sqlite-vec scalar-quant guide).
- **vec_memories_v2 + vec_memory_chunks_v2** sqlite-vec virtual tables (int8[384] cosine) + per-agent `migrations` state machine table.
- **7-phase EmbeddingV2Migrator** (idle / dual-write / re-embedding / re-embed-complete / cutover / v1-dropped / rolled-back) with legal-transition matrix enforcement, cursor-based resumable progress tracking, currentReadVersion / currentWriteVersions selectors driving the dual-write hook.
- **Resumable batch re-embed runner** (runReEmbedBatch) with Discord-active priority gate, per-entry failure recovery, mid-batch agent-active yield, auto-transition to re-embed-complete, cursor save after each batch.
- **`clawcode memory migrate-embeddings` CLI** — 8 subcommands (status / start / re-embed / pause / resume / force-cutover / rollback / v1-dropped) with tabular status output + interactive y/N confirmation on DANGER subcommands (-y/--yes bypass for scripted use).
- **Phase 107 VEC-CLEAN-\* atomic-cascade invariant extended to v2** — both vec_memories AND vec_memories_v2 (and chunk equivalents) deletes happen inside one db.transaction(). cleanupOrphans + cleanupOrphansSplit handle both vec tables atomically. cold-archive shape (memory present + vec absent) preserved.

## Task Commits

Each task was committed atomically:

1. **T01: bge-small-en-v1.5 embedder + dispatcher refactor** — `dfe3194` (feat)
2. **T02: int8 scalar quantization** — `d90b3e4` (feat)
3. **T03: vec_memories_v2 + cascade-delete extension** — `f34e961` (feat)
4. **T04: state machine + resumable batch runner** — `86696d7` (feat)
5. **T05: CLI + IPC + config** — `932582f` (feat)

**Atomicity fix (post-advisor):** `52afd36` (fix) — extended `insert(input, embedding, opts?: {embeddingV2?})` to write v2 INSIDE the same `db.transaction()` as v1 + memories. Phase 107 atomic-cascade invariant now holds on the insert side identically to the delete side.

**Plan metadata commit:** `e3364da` (docs) plus this commit

## Files Created/Modified

### Created

- `src/memory/embedder-bge-small.ts` — bge-small-en-v1.5 ONNX wrapper (warmupBgeSmall + embedBgeSmall + isBgeSmallReady + BGE_SMALL_MODEL_ID + BGE_SMALL_DIM constants).
- `src/memory/embedder-quantize.ts` — int8 quantization helpers (quantizeInt8 + dequantizeInt8 + recallLossEstimate + int8ToBuffer + QUANTIZATION_MIN/MAX constants).
- `src/memory/migrations/embedding-v2.ts` — EmbeddingV2Migrator state machine class (240 lines).
- `src/memory/migrations/embedding-v2-runner.ts` — runReEmbedBatch resumable batch runner (~200 lines).
- `src/cli/commands/memory-migrate-embeddings.ts` — operator CLI subcommand.
- `src/memory/__tests__/embedder-bge-small.test.ts` — 11 tests, mocked transformers per existing embedder.test.ts pattern.
- `src/memory/__tests__/embedder-quantize.test.ts` — 13 tests covering quantization + dequant + KNN recall + edge cases.
- `src/memory/__tests__/embedding-v2-cascade-delete.test.ts` — 12 tests covering Phase 107 invariant extension to v2.
- `src/memory/__tests__/embedding-v2-migration.test.ts` — 17 tests covering state machine + runner.

### Modified

- `src/memory/embedder.ts` — refactored to dispatcher pattern. Legacy `embed(text)` returns Float32Array unchanged (defaults to v1 MiniLM); new `embedV1` / `embedV2Float32` / `embedV2` entry points for migration-aware callers.
- `src/memory/store.ts` — added migrateEmbeddingV2Tables (vec_memories_v2 + vec_memory_chunks_v2 + migrations table); extended delete + deleteMemoryChunksByPath + cleanupOrphans cascade to v2; added cleanupOrphansSplit, insertEmbeddingV2, insertChunkEmbeddingV2, insertWithDualWrite, listMemoriesMissingV2Embedding, countMemoriesMissingV2Embedding, listChunksMissingV2Embedding, countVecMemoriesV2.
- `src/config/schema.ts` — added defaults.embeddingMigration optional field { cpuBudgetPct, batchSize, pausedAgents }.
- `src/ipc/protocol.ts` — registered 4 new IPC methods.
- `src/manager/daemon.ts` — added 4 closure-intercept IPC handler cases.
- `src/cli/commands/memory.ts` — wired registerMigrateEmbeddingsCommand alongside registerMemoryBackfillCommand.

## Decisions Made

1. **Fixed-range [-1, +1] quantization, NOT per-vector min/max.** The plan body literally proposed per-vector min/max scaling — caught during pre-execution advisor consult. sqlite-vec's int8 distance metric runs on raw int8 values without per-vector scale/offset, so per-vector scaling would have made cross-vector distance comparisons mathematically incoherent. Fixed range is the documented sqlite-vec pattern. The choice of [-1, +1] is the tight theoretical bound for L2-unit-norm bge-small output (with `normalize: true` per documented retrieval setup).

2. **EmbeddingService.embed(text) contract preserved.** Refactored embedder.ts to dispatcher form but kept the legacy `embed(text): Promise<Float32Array>` method delegating to `embedV1`. 7 existing callers (compaction / consolidation / conversation-search / episode-store / memory-scanner / session-summarizer / tier-manager) require zero changes during the dual-write transition. The `embedV1` / `embedV2Float32` / `embedV2` explicit forms are for migration-aware callers (dual-write hooks, batch runner).

3. **embeddingMigration config field is .optional()** (mirrors Phase 110 shimRuntime/brokers schema-only-default pattern). Schema ships in this plan; runtime wiring (heartbeat runner reading config + skipping paused agents) lands in wave 4. Operators who don't override see undefined — runner fills in cpuBudgetPct=5, batchSize=50, pausedAgents=[] defaults at consumption time.

4. **Idempotent v2 cascades.** All cascade-delete + dual-write paths use INSERT OR REPLACE / DELETE-WHERE-no-match-is-no-op semantics so pre-dual-write entries (no v2 row yet) trigger no errors. The migration runner picks up missing v2 rows on its next batch.

5. **Per-agent migrations table.** State lives in each agent's per-agent memories.db (key='embeddingV2'), NOT in a shared manager DB. Phase 90 isolation lock preserved. Pause / status / rollback are all per-agent operations.

6. **Manual confirmation gate on DANGER subcommands.** force-cutover, rollback, v1-dropped require interactive y/N. -y/--yes flag bypasses for scripted use. Per Phase 115 D-08 threat model: force-cutover before re-embed-complete is the highest-risk operator action; CLI confirms instead of silently allowing it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed quantization scheme — per-vector min/max → fixed [-1, +1] range**

- **Found during:** Pre-execution advisor consult (before T01).
- **Issue:** The plan body's `quantizeInt8` proposed per-vector min/max scaling (each vector gets its own min/max stored in a header). sqlite-vec's `int8[N] distance_metric=cosine` operates on raw int8 values directly — no per-vector scale/offset header. With per-vector scaling, two vectors quantized with different ranges would not produce meaningful distance comparisons.
- **Fix:** Switched to fixed-range quantization at [-1, +1] → [-128, 127] mapped uniformly across all vectors. This is the documented sqlite-vec pattern (https://alexgarcia.xyz/sqlite-vec/guides/scalar-quant.html). Per-vector empirical magnitude is much smaller (~0.05-0.15) for L2-normalized output, but the [-1, +1] bound is the tight theoretical guarantee.
- **Files modified:** src/memory/embedder-quantize.ts
- **Verification:** 13 quantization tests pass including int8 cosine vs float32 cosine within 0.1 absolute on randomly sampled normalized vectors, and KNN top-10 recall ≥80% over 200 synthetic 384-dim vectors.
- **Committed in:** d90b3e4 (T02 commit).

**2. [Rule 1 - Bug] Fixed sqlite-vec int8 binding — Int8Array → vec_int8(buffer) SQL function**

- **Found during:** Pre-T03 sanity check (verifying sqlite-vec accepts int8 column type).
- **Issue:** Initial test with `db.prepare("INSERT INTO t (id, e) VALUES (?, ?)").run("a", new Int8Array([1,2,3,4]))` threw `Inserted vector for the "e" column is expected to be of type int8, but a float32 vector was provided.` Even when using Buffer.from(int8Array.buffer) the same error fires — sqlite-vec rejects raw byte buffers for int8 columns.
- **Fix:** Use the sqlite-vec `vec_int8(?)` SQL function constructor: `INSERT INTO t (id, e) VALUES (?, vec_int8(?))`. The Buffer is passed through `vec_int8` which constructs the int8 vector cell type sqlite-vec expects.
- **Files modified:** src/memory/store.ts (insertVecV2 prepared statement uses `vec_int8(?)`; insertChunkEmbeddingV2 uses same pattern).
- **Verification:** embedding-v2-cascade-delete.test.ts plants v2 rows + queries via `embedding MATCH vec_int8(?) AND k = 1` → returns inserted memory_id at distance ~0.
- **Committed in:** f34e961 (T03 commit).

**3. [Rule 3 - Blocking] Fixed TypeScript narrowing on Object.freeze in legal-transitions matrix**

- **Found during:** Type-check after T04 first pass.
- **Issue:** `Object.freeze(["dual-write", "rolled-back"])` infers as `readonly string[]`, not `readonly EmbeddingMigrationPhase[]`. The `Record<EmbeddingMigrationPhase, ReadonlyArray<EmbeddingMigrationPhase>>` constraint rejected the wider type.
- **Fix:** Pass explicit type parameter to Object.freeze: `Object.freeze<EmbeddingMigrationPhase[]>(["dual-write", "rolled-back"])`.
- **Files modified:** src/memory/migrations/embedding-v2.ts.
- **Verification:** `npx tsc --noEmit` clean; 17 migration tests pass.
- **Committed in:** 86696d7 (T04 commit).

**4. [Rule 3 - Blocking] Made defaults.embeddingMigration optional to match Phase 110 pattern**

- **Found during:** Type-check after T05 first pass.
- **Issue:** Initial `.default(()=>({...}))` made the field required in inferred config type. 7 test fixtures across `src/config/__tests__/loader.test.ts` and `src/config/__tests__/differ.test.ts` lacked the field and broke TypeScript.
- **Fix:** Changed to `.optional()` to match the Phase 110 shimRuntime/brokers schema-only-default pattern. Schema ships in this plan; runtime wiring (heartbeat runner reading the config) lands in wave 4. Runner consumers fill in defaults (cpuBudgetPct=5, batchSize=50, pausedAgents=[]) at consumption time.
- **Files modified:** src/config/schema.ts.
- **Verification:** `npx tsc --noEmit` clean; build succeeds.
- **Committed in:** 932582f (T05 commit).

---

**5. [Rule 1 - Bug] Made insert() dual-write atomic (advisor catch)**

- **Found during:** Post-execution advisor consult.
- **Issue:** PLAN.md must_have requires "Dual-write transaction is ATOMIC — both vec_memories and vec_memories_v2 writes inside one db.transaction() per Phase 107 lock." Original `insertWithDualWrite` ran two separate transactions: `insert()` opened + committed one txn for v1 + memories, then `insertVecV2` ran OUTSIDE any txn. If v2 INSERT failed mid-write (vec_int8 type rejection, disk-full, table-dropped), v1 + memories rows would leak — Phase 107 atomic-cascade invariant violated on the insert side.
- **Fix:** Extended `MemoryStore.insert(input, embedding, opts?: {embeddingV2?})` to write the v2 row INSIDE the same `db.transaction()` that wraps v1 + memories writes. A throw inside the transaction rolls back all 3 writes. Same extension applied to dedup-merge path. Length validation happens BEFORE the transaction. `insertWithDualWrite` collapsed to one-line wrapper.
- **Files modified:** src/memory/store.ts (insert + insertWithDualWrite + dedup-merge path); src/memory/\_\_tests\_\_/embedding-v2-cascade-delete.test.ts (3 new tests covering caller-side length rejection + in-txn rollback + happy path + Phase 1-114 contract preservation).
- **Verification:** All 16 cascade-delete tests pass including the new in-txn-rollback test (drops vec_memories_v2 table mid-test → verifies memories + vec_memories rows roll back too). 133 total in-scope memory tests pass.
- **Committed in:** 52afd36 (post-T05 follow-up).

---

**Total deviations:** 5 auto-fixed (3 bugs + 2 blocking).
**Impact on plan:** All 5 fixes were essential for correctness or build. Deviation #1 (quantization scheme) is the highest-impact — without it, the v2 KNN distance comparisons would have produced wrong rankings, breaking the entire migration. Deviation #2 (vec_int8 binding) is similar — without it, no v2 row could be inserted. Deviation #5 (insert atomicity) was advisor-caught after the initial plan-complete declaration — Phase 107 atomic-cascade invariant on insert side was violated by two-transaction pattern; fixed by extending insert() with opt.embeddingV2 inside one db.transaction(). No scope creep; all fixes within the T01-T05 acceptance criteria.

## Issues Encountered

- **Pre-existing failures in `conversation-brief.test.ts`** — 2 unrelated test failures discovered during full memory test suite run. Verified pre-existing via `git stash` test (failures persist on master before any 115-06 changes). Logged to `.planning/phases/115-memory-context-prompt-cache-redesign/deferred-items.md` per execution-flow Rule SCOPE BOUNDARY. Out of scope for this plan.

## Notes

### Migration timeline (runs POST-DEPLOY in production — NOT a task in this plan)

This plan ships the **machinery**. The wall-clock timeline executes in production after operator-confirmed deploy:

- **T+0**: Operator runs `clawcode memory migrate-embeddings start <agent>` for each agent. Phase transitions to `dual-write`. New writes embed both v1 (MiniLM) and v2 (bge-small-int8). Reads still use v1.
- **T+0 → T+7d**: Operator monitors via `clawcode memory migrate-embeddings status <agent>`. v2 row counts grow from natural agent activity (new memories from agent + scanner indexing).
- **T+7d**: Operator transitions phase to `re-embedding` via `clawcode memory migrate-embeddings re-embed <agent>`. Background heartbeat-driven batch runs at 5% CPU when daemon idle (Discord-active agents have priority — runner skips when `isAgentActive` returns true). Per-agent: 11 agents × ~30K vectors avg = ~330K total at 50ms each = 4.6 wall-hours of CPU; at 5% budget = 92 wall-clock hours = ~4 days.
- **T+7d → T+14d**: Re-embed runs; resumable across daemon restarts; pausable per-agent via `clawcode memory migrate-embeddings pause <agent>`.
- **T+14d**: Phase auto-transitions to `re-embed-complete` when no more memories missing v2 (runner detects this in its no-work-found branch). Operator runs `clawcode memory migrate-embeddings status` to verify, then transitions to `cutover` via `force-cutover` (interactive confirmation). Reads switch to v2; v1 column kept for 24h soak.
- **T+14d + 24h**: Operator transitions to `v1-dropped` via `clawcode memory migrate-embeddings v1-dropped <agent>` (interactive confirmation). Migration complete.
- **Rollback path**: At any phase before `v1-dropped`, operator can run `clawcode memory migrate-embeddings rollback <agent>` to revert reads to v1. v2 column data is preserved for re-attempt (operator can flip back to dual-write to resume).

### Wave 4 wiring deferred

Two wiring tasks are deliberately deferred to wave 4 (per plan scope — this plan ships the machinery, wave 4 kicks off the migration):

1. **Heartbeat runner integration** — registering `embedding-v2-reembed.ts` as a heartbeat check in `src/heartbeat/check-registry.ts`. The runner is shipped; the heartbeat tick wiring is the wave-4 connection. This is the mechanism that actually triggers `runReEmbedBatch` per per-agent per-tick.
2. **pausedAgents persistence on daemon restart** — currently the IPC pause/resume mutates in-memory config. Wave 4 either persists to clawcode.yaml via the configWriter pattern OR moves the paused list into the per-agent migrations table metadata field.

**No longer deferred (resolved by atomicity fix `52afd36`):** Dual-write hook in MemoryStore.insert. The `insert(input, embedding, opts?: {embeddingV2?})` signature now natively supports atomic dual-write — wave-4 callers consult `EmbeddingV2Migrator.currentWriteVersions()` and pass `embeddingV2` when "v2" is in the result. No further dispatcher work is needed at the storage layer.

### Phase 107 cascade invariant preserved

Both `vec_memories` AND `vec_memories_v2` deletes happen inside ONE `db.transaction(...)` per Phase 107 VEC-CLEAN-* lock. This holds during the dual-write window AND post-cutover. Test `embedding-v2-cascade-delete.test.ts` regression-pins this invariant via:

- `delete(id)` cascades to all 3 tables atomically.
- `cleanupOrphans` cleans both v1 and v2 atomically (mid-transaction throw test verifies rollback of both).
- Cold-archive shape (memory present + v1/v2 vec absent) is preserved by the directional invariant — cleanup only touches vec tables, never memories.

### Per-agent isolation

Per Phase 90 lock — every per-agent migration step is its own `db.transaction()` against the agent's per-agent SQLite file. No shared state. Migrator instances are per-agent. The `migrations` table is in each agent's per-agent DB (key='embeddingV2'), making rollback / pause / status all per-agent operations.

### Phase 99-A regression pin preserved

Migration code does NOT compute agent DB paths itself. EmbeddingV2Migrator constructor takes a `Database` instance the daemon hands in, and the daemon resolves stores via `manager.getMemoryStore(agent)` which uses the established `getAgentMemoryDbPath` path. Verified via grep: no `join.*memories\.db` or `memoryPath.*memories\.db` patterns in src/memory/migrations/ or the new CLI file.

### Cost discipline

Per D-09: ~50ms per embedding × ~330K total embeddings = 4.6 hours of CPU time. At 5% budget = 92 wall-clock hours = ~4 days. Fits the T+7d → T+14d window with margin. Discord-active agents have priority — runner yields immediately when `isAgentActive()` returns true (verified by test "yields mid-batch when isAgentActive flips true").

### Why bge-small over alternatives

D-06 lock — synthesis §2.1 + perf-caching-retrieval §3 both confirm: 5-7 MTEB points over MiniLM, same 384-dim (no MRL truncation), Apache 2.0, ~33MB ONNX, drop-in replacement via `@huggingface/transformers`. Operator's "memory does not need to be human-readable" releases the int8 quantization constraint per D-07.

## User Setup Required

None — schema-only this plan; no external service configuration. Migration kickoff happens at next operator-confirmed deploy window via the `clawcode memory migrate-embeddings start <agent>` CLI.

## Next Phase Readiness

- **Wave 2 plan 7 (115-06) complete.** Sub-scope 10 (embedding upgrade + dual-write migration kickoff) machinery shipped.
- **Wave 4 dependencies satisfied.** All primitives wave 4 needs are in place: state machine, runner, dual-write helper, CLI, IPC.
- **Ramy gate respected.** Code commits only; no deploys this plan. Activation happens at next operator-confirmed deploy window.
- **Pre-existing conversation-brief.test.ts failures (2)** logged to deferred-items.md; out of scope.

## Self-Check: PASSED

Files created (verified):
- src/memory/embedder-bge-small.ts: FOUND
- src/memory/embedder-quantize.ts: FOUND
- src/memory/migrations/embedding-v2.ts: FOUND
- src/memory/migrations/embedding-v2-runner.ts: FOUND
- src/cli/commands/memory-migrate-embeddings.ts: FOUND
- src/memory/__tests__/embedder-bge-small.test.ts: FOUND
- src/memory/__tests__/embedder-quantize.test.ts: FOUND
- src/memory/__tests__/embedding-v2-cascade-delete.test.ts: FOUND
- src/memory/__tests__/embedding-v2-migration.test.ts: FOUND

Commits (verified via `git log`):
- dfe3194 (T01): FOUND
- d90b3e4 (T02): FOUND
- f34e961 (T03): FOUND
- 86696d7 (T04): FOUND
- 932582f (T05): FOUND

Tests (verified via vitest):
- embedder-bge-small.test.ts: 11/11 passed
- embedder-quantize.test.ts: 13/13 passed
- embedding-v2-cascade-delete.test.ts: 16/16 passed (12 original + 4 new atomicity tests)
- embedding-v2-migration.test.ts: 17/17 passed
- store-orphan-cleanup.test.ts (Phase 107 regression): 5/5 passed
- store.test.ts (base regression): 65/65 passed
- embedder.test.ts (v1 regression): 6/6 passed
- **Total: 133 passed, 0 failed in scope (serial run via --no-file-parallelism — store.test.ts has a pre-existing /tmp file collision flake under concurrent runs, unrelated to 115-06).**

Pre-existing failures (out of scope, logged to deferred-items.md):
- src/memory/__tests__/conversation-brief.test.ts (2 failures)
- src/manager/__tests__/ (16 failures across 5 files: daemon-openai, daemon-warmup-probe, bootstrap-integration, session-config, dream-prompt-builder)

All pre-existing failures verified pre-existing via `git stash` test (failures persist with all 115-06 changes stashed).

Build (verified): `npm run build` succeeds, `clawcode memory migrate-embeddings --help` registers all 8 subcommands.

---
*Phase: 115-memory-context-prompt-cache-redesign*
*Completed: 2026-05-08*
