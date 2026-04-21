---
phase: 80-memory-translation-re-embedding
plan: 03
subsystem: migration
tags: [cli, runApplyAction, memory-translate, integration-test, embedder-singleton, tdd]

# Dependency graph
requires:
  - phase: 80-memory-translation-re-embedding
    plan: 01
    provides: MemoryStore.insert({origin_id}) idempotent UNIQUE path + getByOriginId read-back
  - phase: 80-memory-translation-re-embedding
    plan: 02
    provides: translateAgentMemories serial per-agent translator + translatorFs dispatch holder
  - phase: 79-workspace-migration
    provides: runApplyAction per-agent loop (workspace-copy + session-archive) + sortedCopyPlans ordering
  - phase: 75-shared-workspace-runtime-support
    provides: config.memoryPath semantics (per-agent memories.db location)
provides:
  - runApplyAction memory-translate block — per-agent MemoryStore lifecycle, serial translator invocation, literal CLI output
  - getMigrationEmbedder — lazy CLI-local EmbeddingService singleton (separate from daemon)
  - _resetMigrationEmbedderForTests — test hook to clear the CLI embedder between integration runs
  - migrateOpenclawHandlers.translateAgentMemories — ESM-safe test monkey-patch hook
  - Phase 80 end-to-end integration suite (6 tests) pinning MEM-01 / MEM-02 / MEM-03 / MEM-04 / MEM-05 + ledger step ordering
  - Updated singleton-invariant test whitelisting CLI as second production construction site
  - Augmented workspace-personal fixture (+1 memory/note-bar.md, +1 .learnings/pattern-immutability.md, MEMORY.md extended to 3 H2 sections)
affects:
  - 81-verify-rollback (rollback via DELETE WHERE origin_id LIKE 'openclaw:<agent>:%' is end-to-end witnessed here)
  - 82-pilot-cutover-complete (pilot apply produces the full ledger + DB invariants that cutover reads)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CLI-local lazy singleton via module-scope let-var with reset hook — mirrors daemon singleton pattern but scoped to a different process"
    - "Per-agent MemoryStore open+close with try/finally — store is closed even when translator throws (non-fatal path)"
    - "Translator error → refuse ledger row + workspaceFailures push — symmetric with workspace-copy failure semantics"
    - "Static-grep self-assertion inside integration test — walks src/migration + src/cli/commands for forbidden patterns within the test body, catching regressions without out-of-band grep"
    - "Integration-test timeouts tiered by embedding cost — 30s for tests with <8 memories, 60-90s for multi-agent or re-run tests"

key-files:
  created:
    - src/migration/__tests__/fixtures/workspace-personal/memory/note-bar.md
    - src/migration/__tests__/fixtures/workspace-personal/.learnings/pattern-immutability.md
  modified:
    - src/cli/commands/migrate-openclaw.ts
    - src/cli/__tests__/migrate-openclaw.test.ts
    - src/manager/__tests__/daemon-warmup-probe.test.ts
    - src/migration/workspace-copier.ts
    - src/migration/__tests__/fixtures/workspace-personal/MEMORY.md

key-decisions:
  - "CLI embedder is a SECOND legitimate production EmbeddingService construction site — daemon-warmup-probe singleton-invariant test is widened to a whitelist of 2 entrypoints, not a hard 1-match assertion. Rationale: CLI and daemon are independent processes; each needs its own embedder lifecycle."
  - "Memory-translate block uses the existing workspaceFailures array for exit-code propagation — a translator throw is semantically the same as a workspace-copy rollback at the apply-completion level (exit 1, other agents proceed). No new failure tracking variable."
  - "Non-skip-empty-source agents ALL get memory-translate (full + uploads-only). Uploads-only agents have no MEMORY.md/memory/.learnings on disk, so translator discovers 0 items and returns quickly. Cheaper than a mode-aware gate and preserves the forensic ledger footprint."
  - "Ledger rows from translator are appended sequentially inside runApplyAction (after archiveOpenclawSessions's own rows) — preserves the workspace-copy → session-archive → memory-translate ordering per agent without cross-agent interleaving."
  - "Integration tests use the REAL embedder (not a mock) — MEM-03's vec_length=384 assertion requires actual ONNX output, and MEM-02's cross-run idempotency requires the real INSERT OR IGNORE path. Cost is ~200ms cold-start per worker + ~50ms/embed, amortized to ~3-8s per test."

patterns-established:
  - "CLI-local singleton with test reset hook — transplantable to any future CLI subcommand that needs stateful infra (e.g. Convex CLI client, Discord bot handle)"
  - "Per-agent resource lifecycle in the apply loop — MemoryStore join in, translator invoke, close in finally; mirrors the workspace-copier install/uninstall pattern and scales to future per-agent resources"
  - "sweepDir tolerates target-only files via existsSync(srcPath) gate + 'target-only' ledger witness — forensic completeness preserved, re-runs succeed"

requirements-completed:
  - MEM-01
  - MEM-02
  - MEM-03
  - MEM-04
  - MEM-05

# Metrics
duration: 62min
completed: 2026-04-20
---

# Phase 80 Plan 03: runApplyAction Memory-Translate Wiring + End-to-End Integration Suite Summary

**Wires `translateAgentMemories` into `runApplyAction`'s per-agent loop, introduces a CLI-local `EmbeddingService` singleton distinct from the daemon's, and pins all five Phase 80 success criteria via an end-to-end integration test that exercises the real ONNX pipeline + sqlite-vec + origin_id idempotency path.**

## Performance

- **Duration:** 62 min
- **Started:** 2026-04-20T21:35:37Z
- **Completed:** 2026-04-20T22:37:39Z
- **Tasks:** 2 (both TDD)
- **Files created:** 2 fixture files
- **Files modified:** 5

## Accomplishments

- `runApplyAction` per-agent loop now routes workspace-copied agents through `translateAgentMemories` with proper lifecycle: `mkdir memory/ → new MemoryStore(dbPath) → await translator → append ledgerRows → cliLog literal "upserted N, skipped M" → store.close() in finally`.
- CLI-local `EmbeddingService` singleton added (`getMigrationEmbedder` + `_resetMigrationEmbedderForTests`) — lazy init, one instance per CLI process, exported via `migrateOpenclawHandlers` for ESM-safe test monkey-patching.
- Singleton-invariant test widened to a 2-site whitelist (daemon `session-memory.ts` + CLI `migrate-openclaw.ts`); asserts `hits.length <= 2`, each hit file is in the allowed set, each allowed file has exactly 1 match, AND the daemon site is still present.
- Translator error path: refuse ledger row (`step:"memory-translate:error"`, `outcome:"refuse"`) + `workspaceFailures` push — non-fatal for other agents, exit 1 at apply end.
- Skipped for `skip-empty-source` agents AND for rolled-back agents (handled by the existing `continue` statements in the loop).
- 7 Task-1 unit tests with mocked translator + 6 Task-2 integration tests with REAL translator pin end-to-end contract.
- Phase 80 end-to-end suite passes all 5 phase-level success criteria AND the ledger-step-ordering invariant.
- `grep -rn "INSERT INTO vec_memories" src/migration/ src/cli/commands/` — 0 matches (MEM-03 invariant preserved, checked as a live test).
- Memory suite 381/381, migration suite 202/202, daemon-warmup-probe 24/24, all Plan 80 unit + integration 13/13 → total **641 tests green across all Phase 80-related files**.

## Task Commits

Task 1 (TDD RED → GREEN, no refactor needed):

1. **Task 1 RED: failing tests for runApplyAction memory-translate wiring + singleton invariant update** — `f9fad5b` (test)
2. **Task 1 GREEN: wire translateAgentMemories into runApplyAction per-agent loop** — `1331df0` (feat)

Task 2 (TDD RED+GREEN combined — tests pass on first run because the wiring from Task 1 already satisfies them; refactor omitted):

3. **Task 2: Phase 80 end-to-end integration suite + workspace-copier re-run fix** — `a2c350d` (test, includes Rule-1 deviation auto-fix)
4. **Task 2 follow-up: bump Phase 79 test timeouts to 30s for Plan 80 embedder overhead** — `b90c336` (fix, Rule-1 deviation)

## Files Created/Modified

- `src/cli/commands/migrate-openclaw.ts` — added imports (MemoryStore, EmbeddingService, translateAgentMemories, mkdirSync), lazy CLI embedder singleton (getMigrationEmbedder + reset hook), extended migrateOpenclawHandlers with translateAgentMemories, inserted ~75-line memory-translate block inside the per-agent loop after archiveOpenclawSessions
- `src/cli/__tests__/migrate-openclaw.test.ts` — +7 unit tests (Task 1), +6 integration tests (Task 2), bumped 6 pre-existing Phase 79 test timeouts to 30-60s for embedder overhead
- `src/manager/__tests__/daemon-warmup-probe.test.ts` — singleton-invariant test widened to 2-site whitelist
- `src/migration/workspace-copier.ts` — sweepDir now tolerates target-only files via existsSync(srcPath) gate with "target-only" ledger witness (Rule-1 bug fix)
- `src/migration/__tests__/fixtures/workspace-personal/MEMORY.md` — extended from 1 H2 section to 3 (Test memory section, Discord Setup, Server Topology)
- `src/migration/__tests__/fixtures/workspace-personal/memory/note-bar.md` — new whole-file memory fixture
- `src/migration/__tests__/fixtures/workspace-personal/.learnings/pattern-immutability.md` — new .learnings fixture for MEM-04 witness

## Decisions Made

- **Singleton-invariant widening over refactor-to-shared-singleton.** The daemon-warmup-probe singleton is a process-level invariant, not a host-level one. Refactoring to share the embedder across processes would require an IPC bridge and would add a ~23MB memory cost per process invariant that doesn't match either workload's actual usage. The whitelist approach encodes the true contract: "at most N process entrypoints, each constructs their own embedder once."
- **`existsSync(srcPath)` gate in sweepDir.** A `try/catch` around `readFile(srcPath)` would work, but existsSync is more explicit and produces a proper ledger witness row on the skip path. Alternative rejected: moving memories.db OUTSIDE the target workspace — would require refactoring `<memoryPath>/memory/memories.db` semantics, which is a Phase 75 runtime contract, not something Plan 03 should touch.
- **Translator errors count as apply failures (exit 1) instead of soft warnings.** A translator throw leaves the agent in a partially-migrated state (workspace is there, memory isn't). Returning exit 0 would mask that divergence. Consistent with workspace-copy rollback semantics: any agent that doesn't cleanly complete its stage makes the whole apply exit non-zero, but other agents still run.
- **Integration tests use the REAL ONNX embedder.** Mocking the embedder for Task 2 tests would make them faster but would NOT exercise the real vec_length=384 assertion (MEM-03) or the real dedup skip-path (MEM-02). The cost (~3-8s per test) is acceptable given the singleton is warmed across tests in the same worker.
- **Fixture augmentation was ADDITIVE (not overwriting).** MEMORY.md was extended from 1 to 3 H2 sections while keeping the original "Test memory section" first. Existing Phase 79 tests pass because they assert `toBeGreaterThanOrEqual(6)` on witness row count, not equality, and their sha256 sweep compares source↔target pairs that stay in lockstep.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `workspace-copier.sweepDir` throws ENOENT on re-run when target has translator-generated files**

- **Found during:** Task 2 — MEM-02 integration test (first integration test to exercise a re-run through the full pipeline).
- **Issue:** Plan 80 writes `<targetMemoryPath>/memory/memories.db` INTO the target workspace (for dedicated-workspace agents, `targetMemoryPath === workspace` per Phase 75 fallback). On a re-run of `migrate openclaw apply`, `fs.cp` with `force:true + errorOnExist:false` overwrites source files in the target but does NOT delete extras. The subsequent hash-witness sweep walks the target tree (including `memory/memories.db`) and tries `readFile(srcPath)` — the source has no such file → ENOENT → the whole apply crashes before reaching Plan 80's translator, breaking MEM-02.
- **Fix:** Added `existsSync(srcPath)` gate inside `sweepDir` BEFORE the symlink / directory / file branches. Target-only entries (source counterpart missing) receive a `"target-only"` ledger witness row with notes `"target-only file (no source counterpart — skipped)"` and are skipped by the sweep. `onFile()` counter still increments so the overall file-count invariants hold.
- **Files modified:** `src/migration/workspace-copier.ts` (+22 lines — 1 import addition, 1 guard block). Full byte-level preservation of all other sweep semantics.
- **Verification:** 15/15 workspace-copier unit tests green + all 5 Phase 79 SC tests + MEM-02 re-run passes with `"upserted 0, skipped 8"` matching the first-run count.
- **Committed in:** `a2c350d` (Task 2 commit).

**2. [Rule 1 - Bug] Phase 79 SC-2 test times out at 5s when Plan 80 translator runs for 5 finmentum-family agents**

- **Found during:** Full project `npx vitest run` after Task 2 — SC-2 passes in isolation (5.1s) but fails in the full-suite run (exceeds 5s default) due to parallel worker pressure + ONNX cold-start on the shared embedder singleton.
- **Issue:** Phase 79 SC tests predate Plan 80. They were authored under the assumption that `runApplyAction` doesn't perform embedding work. Plan 80's wiring now runs `translateAgentMemories` for each copied agent, adding ~200ms cold-start + ~50ms/embed serial cost. SC-2 has 5 finmentum-family agents; the content-creator primary has 8 memories from the augmented fixture, pushing total test time past 5s under parallel-worker load.
- **Fix:** Bumped test timeouts to 30s for SC-1 / SC-3 / SC-4 / SC-5 / workspace-rollback / env-var-overrides (all tests that run full `runApplyAction` against the markdown-bearing fixture), and to 60s for SC-2 (5 agents, ~40 total embeds). Did NOT add global `testTimeout` to vitest config — localized timeouts are more explicit about which tests have embedding overhead.
- **Files modified:** `src/cli/__tests__/migrate-openclaw.test.ts` (7 timeout additions, +7 -7 lines).
- **Verification:** All 34 migrate-openclaw tests green both in isolation AND in the full suite.
- **Committed in:** `b90c336` (Task 2 follow-up).

---

**Total deviations:** 2 auto-fixed (both Rule-1 bugs — one in workspace-copier, one in test timeouts).
**Impact on plan:** Deviation 1 is a real production bug that would have broken Phase 81's rollback-then-retry cycle and any manual re-run of `migrate openclaw apply`. Deviation 2 is test-config hygiene that keeps CI green as the suite grows. Neither altered the public contract of any Plan 03 API.

## Issues Encountered

**Pre-existing failures (out-of-scope, inherited from Plan 01/02):**

- 10 failures across 3 unrelated test files (`bootstrap-integration.test.ts`, `daemon-openai.test.ts`, `session-manager.test.ts`) — verified pre-existing by stashing Plan 03 changes and running the same tests on the Plan 02-closed HEAD. Logged in `.planning/phases/80-memory-translation-re-embedding/deferred-items.md`.
- Under parallel-worker load, `src/config/__tests__/shared-workspace.integration.test.ts` and `src/cli/commands/__tests__/triggers.test.ts` occasionally flake with timeouts when the full suite runs — passes in isolation. Not touched.

Phase 80 related suites: **641 / 641 green** (migrate-openclaw.test.ts 34, daemon-warmup-probe.test.ts 24, migration 202, memory 381).

## User Setup Required

None — the pilot `clawcode migrate openclaw apply --only personal` command is now fully operational end-to-end in CI test form. Real-world pilot execution is covered by Phase 82.

## Next Phase Readiness

**Ready for Phase 81 (verify + rollback):**

- `store.findByTag("migrated")` returns every imported memory for an agent (verified by MEM-04 integration test).
- Rollback via `DELETE FROM memories WHERE origin_id LIKE 'openclaw:<agent>:%'` is semantically well-defined — the CASCADE on `vec_memories` + `memory_links` cleans everything up in one statement.
- The ledger's `memory-translate:embed-insert` rows provide forensic per-memory provenance: file path + sha256 + notes="new"|"already-imported". Phase 81's verifier can reconstruct the full import timeline from the ledger alone.
- Re-run idempotency is pinned by MEM-02 (integration test 2): second apply prints `"upserted 0, skipped 8"` and the `SELECT COUNT(*) FROM memories WHERE origin_id LIKE 'openclaw:mem02:%'` is stable across runs.

**Ready for Phase 82 (pilot + cutover + complete):**

- `clawcode migrate openclaw apply --only <agent>` is now fully end-to-end operational: config write → workspace copy → session archive → memory translate → ledger witness. Running it against `personal` in production WILL produce a queryable memories.db with 384-dim embeddings + correct tags + origin_id idempotency.
- CLI literal output `"upserted N, skipped M"` per agent is a stable grep contract for pilot verification scripts.

**Outstanding for future work (deferred, not blocking):**

- The pre-existing 10 test failures across `manager/` / `config/` unrelated domains should be triaged in a dedicated quick-task before v2.1 ships (not Plan 03's scope).
- If the pilot agent has more than ~200 markdown memories, consider reporting per-file progress via stderr during translation (the current implementation is silent between "upserted N, skipped M" and the next agent).

## Self-Check: PASSED

Verified (all checks pass):

- `src/cli/commands/migrate-openclaw.ts` — contains `translateAgentMemories` (6 matches), `upserted.*skipped` (1 match), `memory-translate:error` (1 match), `new EmbeddingService` (1 match), `getMigrationEmbedder` (2 matches), `_resetMigrationEmbedderForTests` (2 matches)
- `src/cli/__tests__/migrate-openclaw.test.ts` — contains "Phase 80 Plan 03 Task 1" and "Phase 80 Plan 03 Task 2 — end-to-end" describe blocks, `upserted 0, skipped` (3 matches), `vec_length(embedding)` (1 match), `findByTag("learning")` (1 match)
- `src/manager/__tests__/daemon-warmup-probe.test.ts` — singleton-invariant test updated to 2-site whitelist + passes
- `src/migration/workspace-copier.ts` — contains the `existsSync(srcPath)` gate + `target-only` ledger notes
- `src/migration/__tests__/fixtures/workspace-personal/memory/note-bar.md` and `.learnings/pattern-immutability.md` — both exist on disk
- Commits in git log: `f9fad5b`, `1331df0`, `a2c350d`, `b90c336` — all present on master
- `grep -rn "INSERT INTO vec_memories" src/migration/ src/cli/commands/` → 0 matches (MEM-03 invariant preserved)
- `grep -rn "new EmbeddingService" src/ --include="*.ts" | grep -v __tests__` → 2 matches (daemon + CLI)
- `npx tsc --noEmit` on Plan 03 modified files → CLEAN (pre-existing errors in unrelated files)
- `npx vitest run src/cli/__tests__/migrate-openclaw.test.ts` → 34/34
- `npx vitest run src/manager/__tests__/daemon-warmup-probe.test.ts` → 24/24
- `npx vitest run src/migration/__tests__/` → 202/202
- `npx vitest run src/memory/__tests__/` → 381/381

---
*Phase: 80-memory-translation-re-embedding*
*Completed: 2026-04-20*
