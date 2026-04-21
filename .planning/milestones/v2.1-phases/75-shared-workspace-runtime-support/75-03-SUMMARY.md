---
phase: 75-shared-workspace-runtime-support
plan: 03
subsystem: testing
tags: [vitest, integration-test, shared-workspace, finmentum, memoryPath, sqlite-vec, inbox, isolation]

# Dependency graph
requires:
  - phase: 75-01
    provides: "agentSchema.memoryPath field + configSchema conflict guard + ResolvedAgentConfig.memoryPath contract"
  - phase: 75-02
    provides: "loader.ts expandHome resolution + session-memory.ts memoryDir swap + inbox discovery under memoryPath + all 13 runtime call-site swaps"
provides:
  - "End-to-end integration test proving 2-agent memory/inbox/file-inode isolation (SHARED-02)"
  - "End-to-end integration test proving 5-agent finmentum pairwise isolation with the exact REQUIREMENTS.md agent name list (SHARED-03)"
  - "Negative tests proving configSchema.safeParse AND loadConfig both reject duplicate memoryPath with both conflicting names in the error"
  - "CI regression guardrail — any future change that silently falls back to workspace (breaking shared-basePath isolation) fails this suite"
affects:
  - 76+ (migration phases — can now assume shared-workspace behavior is CI-verified)
  - 79 (workspace migration — finmentum 5-agent layout has proven runtime semantics)
  - 80 (memory translation — per-agent memories.db isolation guarantee underpins migration correctness)

# Tech tracking
tech-stack:
  added: []  # zero new dependencies — uses existing vitest + node:fs/promises + pino
  patterns:
    - "Temp-dir integration test: mkdtemp + writeFile YAML + loadConfig + AgentMemoryManager + cleanupMemory in try/finally + rm(tempDir, recursive)"
    - "On-disk inode witness — fs.stat().ino across per-agent memories.db to prove distinct files rather than a single shared handle"
    - "Zero-vector Float32Array(384) + skipDedup:true for tag-only isolation assertions (bypasses dedup layer + embedding cost)"
    - "Per-test timeout extension (15s/20s) for tests that init multiple MemoryStore instances (sqlite-vec cold-start + WAL + migration + auto-linker exceed the 5s vitest default under parallel test load)"
    - "Schema-error + loadConfig-error parity assertion — two different entry points, same conflict, both surface both agent names"

key-files:
  created:
    - src/config/__tests__/shared-workspace.integration.test.ts (419 lines, 9 tests, 4 describe blocks)
  modified: []

key-decisions:
  - "Extended per-test timeouts (15s for 2-agent, 20s for 5-agent) to cover sqlite-vec cold-start + schema migrations + auto-linker under parallel test load — NOT a global testTimeout change. Default 5s fits pure-config tests; MemoryStore init needs more headroom."
  - "Zero-vector Float32Array(384) embeddings are acceptable because every assertion uses tag-based findByTag queries, not vector similarity. Skipping real embedding generation shaves ~50ms × 5 = 250ms off the 5-agent test."
  - "skipDedup: true on every insert — dedup layer would see identical zero-vector embeddings and merge everything into one entry, wrecking the isolation assertions. The isolation being tested is filesystem-level (separate DB files), not dedup-level."
  - "Per-scenario fresh mkdtemp + rm(recursive, force) in afterEach — SQLite WAL files (memories.db-shm, memories.db-wal) live alongside the main file, so recursive unlink is required. Stores closed via mgr.cleanupMemory() before rm releases file handles (Linux permits unlink of open files, but cleanup is good hygiene)."
  - "Error-message assertions check both /memoryPath conflict/i AND the literal agent names — proves the schema's `.superRefine()` produces an actionable message naming ALL conflicting agents, not just `result.success === false`."
  - "No daemon boot, no chokidar watcher in this test — pure function-level integration. Chokidar behavior under shared basePath is covered at the inbox-source unit-test level already."

patterns-established:
  - "Integration-test pattern for multi-agent runtime: loadConfig(YAML string) → resolveAllAgents → AgentMemoryManager.initMemory(each) → insert/writeMessage → findByTag/readMessages assertions → cleanupMemory(each) + rm(tempDir)"
  - "Verbatim requirement-list binding in tests: the 5 finmentum names are declared as a `const FIN_AGENTS = [...] as const` at the top of the describe block — future changes to REQUIREMENTS.md line 17 force this constant to move in lockstep (grep-friendly)"

requirements-completed:
  - SHARED-02
  - SHARED-03

# Metrics
duration: 11min
completed: 2026-04-20
---

# Phase 75 Plan 03: Shared-Workspace Integration Test Summary

**End-to-end integration test locks in SHARED-02 (2-agent memory/inbox/file-inode isolation) and SHARED-03 (5-agent finmentum pairwise isolation across 25 cross-agent queries) against a real temp filesystem — plus negative tests proving the Plan 01 schema + loadConfig conflict guards both surface both conflicting agent names.**

## Performance

- **Duration:** ~11 minutes
- **Started:** 2026-04-20T14:16:33Z
- **Completed:** 2026-04-20T14:27:39Z
- **Tasks:** 1/1 completed
- **Files modified:** 1 (new test file)
- **Tests added:** 9 passing (419 lines, 4 describe blocks)

## Accomplishments

- **SHARED-02 (2-agent) locked**: Three tests prove resolved workspace sharing + distinct memoryPaths, memory isolation via findByTag across two MemoryStores, on-disk inode divergence of memories.db files, and inbox isolation via writeMessage/readMessages.
- **SHARED-03 (5-agent finmentum) locked**: Three tests boot the exact 5-agent family from REQUIREMENTS.md (fin-acquisition, fin-research, fin-playground, fin-tax, finmentum-content-creator), prove Set-level workspace sharing (size=1) + memoryPath distinctness (size=5) + 5-inode on-disk witness + 25 pairwise memory-isolation checks (5 self-tag hits + 20 off-diagonal zero-hits) + targeted inbox routing (fin-acquisition → fin-research lands only in research's inbox; other 4 inboxes empty).
- **Plan 01 conflict guard CI-enforced**: Three tests prove configSchema.safeParse rejection with both agent names in the issue message, loadConfig throws ConfigValidationError with both names in the error text, and positive control (5 distinct memoryPaths parse cleanly).
- **Zero new project tsc errors**: 29 pre-existing errors → 29 post-plan (unchanged); new test file compiles clean.
- **Full test suite green modulo pre-existing failures**: 3271/3278 tests pass; the 7 remaining daemon-openai failures are the same pre-existing baseline documented in Plan 02 SUMMARY.

## Task Commits

1. **Task 1: Integration test file with 9 tests covering SHARED-02 + SHARED-03 + conflict detection** — `bf62842` (test)

_Single-task plan — all 9 tests landed in one commit. Plan 01 + Plan 02 already shipped the runtime; this plan is pure verification, so there's no RED/GREEN split in the classic sense (the "RED" would have been running these tests against a pre-Plan-01 tree, which is now ancient history)._

## Files Created/Modified

### Source
- `src/config/__tests__/shared-workspace.integration.test.ts` (NEW, 419 lines)
  - 4 describe blocks (1 outer + 3 inner)
  - 9 `it(...)` blocks
  - 28 matches for the finmentum agent names (all 5 appear multiple times)
  - 5 `memoryStores.get` references (cross-agent isolation assertions)
  - 5 `readMessages` references (inbox routing tests)
  - 3 `ConfigValidationError` references
  - 3 `memoryPath conflict` string matches (schema + loadConfig + 1 positive-control message text)

## Acceptance Criteria Verification

| # | Criterion | Expected | Actual | Pass |
|---|-----------|----------|--------|------|
| 1 | Line count (`wc -l`) | ≥150 | 419 | ✅ |
| 2 | `grep -c 'it('` | ≥8 | 9 | ✅ |
| 3 | `grep -c 'describe('` | ≥4 | 4 | ✅ |
| 4 | Finmentum agent names present | ≥5 | 28 matches | ✅ |
| 5 | `grep -c 'memoryStores.get'` | ≥3 | 5 | ✅ |
| 6 | `grep -c 'readMessages'` | ≥2 | 5 | ✅ |
| 7 | `grep -c 'ConfigValidationError'` | ≥1 | 3 | ✅ |
| 8 | `grep -c 'memoryPath conflict'` | ≥1 | 3 | ✅ |
| 9 | `npx vitest run <file>` exit 0 | pass | pass (9/9) | ✅ |
| 10 | `npx tsc --noEmit` — no new errors | unchanged baseline | 29 pre, 29 post | ✅ |

## Describe-Block / Test Inventory

### Describe 1: "2-agent minimum (SHARED-02)" — 3 tests

| Test | Asserts |
|------|---------|
| `resolves two agents sharing basePath with distinct memoryPath` | resolved.length===2, resolved[0].workspace===resolved[1].workspace, resolved[0].memoryPath!==resolved[1].memoryPath, each memoryPath matches YAML value |
| `memories inserted into agent A do not appear in agent B (tag query)` | storeA.findByTag("p75-iso-a").length===1, storeB.findByTag("p75-iso-a").length===0, stat(memA/memory/memories.db).ino !== stat(memB/memory/memories.db).ino |
| `inbox messages for agent A do not land in agent B's inbox` | readMessages(inboxA).length===1 with matching content/to, readMessages(inboxB).length===0 |

### Describe 2: "Finmentum family — 5-agent shared basePath (SHARED-03)" — 3 tests

| Test | Asserts |
|------|---------|
| `resolveAllAgents returns 5 agents with 1 shared workspace + 5 distinct memoryPaths` | resolved.length===5, Set(workspaces).size===1, Set(memoryPaths).size===5, names and memoryPaths match YAML |
| `5 agents maintain full pairwise memory isolation` | Set of 5 inodes has size 5, each agent's self-tag returns 1, every cross-agent tag query returns 0 (20 off-diagonal checks) |
| `inbox routing: fin-acquisition → fin-research delivers only to fin-research's inbox` | readMessages(fin-research's inbox).length===1 with correct from/to/content, readMessages(each of 4 other inboxes).length===0 |

### Describe 3: "Conflict detection (Plan 01 guard)" — 3 tests

| Test | Asserts |
|------|---------|
| `configSchema rejects two agents with identical memoryPath — error names both agents` | result.success===false, error message matches /memoryPath conflict/i AND contains "fin-acquisition" AND contains "fin-research" |
| `loadConfig throws ConfigValidationError on memoryPath conflict in YAML` | loadConfig rejects with ConfigValidationError, thrown message contains /memoryPath conflict/i AND both agent names |
| `5 agents with distinct memoryPath values parse successfully (positive control)` | result.success===true |

## Decisions Made

- **Per-test timeout extensions (15s/20s)**: The first run of the 5-agent test timed out at the vitest 5s default — 5 MemoryStore inits each run WAL + sqlite-vec extension load + all 10 schema migrations + prepared-statement setup + the eager auto-linker path. Bumping the single test to 20s and the 2-agent variant to 15s avoids false timeouts under parallel test load without touching the global testTimeout (which would mask real slowness elsewhere). Pure test-framework config; zero impact on production runtime.
- **Zero-vector embeddings + skipDedup:true**: findByTag is the only query surface used; real embeddings would add ~50ms per insert × 5 agents × 1 insert each = 250ms of cold-start model load for zero semantic value. skipDedup bypasses the dedup layer's cosine check, which would otherwise merge identical zero-vector embeddings into a single row and destroy the isolation test.
- **Verbatim FIN_AGENTS `as const` tuple at top of 5-agent describe**: Grep-friendly single source of truth; if REQUIREMENTS.md line 17 ever changes, this constant needs a matching update, and the `it(...)` titles + assertions inherit the change mechanically.
- **Error-message text assertions, not just success===false**: Asserting only `result.success===false` would let a future regression where the schema rejects for the wrong reason (e.g., empty-string memoryPath) slip through. Matching /memoryPath conflict/i AND the literal agent names pins the UX contract — operators see which two configs to fix.
- **mgr.cleanupMemory + rm(recursive, force) teardown**: Close stores before filesystem unlink; SQLite on Linux tolerates unlink-of-open-files but cleanup matches the pattern in session-memory-warmup.test.ts (Phase 56) and releases WAL/SHM side-files cleanly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking test infrastructure] Extended per-test timeout on MemoryStore-heavy tests**
- **Found during:** Task 1 initial run (8/9 passed; the 5-agent pairwise test timed out at 5000ms)
- **Issue:** vitest's 5s default testTimeout is insufficient for cold-start paths that run 5× MemoryStore inits (WAL + sqlite-vec load + all 10 schema migrations + conversation_turns_fts backfill + prepared-statement setup) plus the eager autoLinkMemory path on each insert. Under parallel test load (`vitest run src/config src/collaboration src/memory`), even the 2-agent test exceeded 5s. Not a production-code bug — sqlite-vec initialization and migrations are one-time-per-DB, so this only hits tests that open multiple DBs.
- **Fix:** Added explicit per-test timeouts: 15s on the 2-agent memory-isolation test, 20s on the 5-agent pairwise test. Inline comments cite the sqlite-vec + migration cold-start cost so future readers understand the bump.
- **Files modified:** `src/config/__tests__/shared-workspace.integration.test.ts` (inline only)
- **Verification:** `npx vitest run src/config/__tests__/shared-workspace.integration.test.ts` → 9/9 pass (10.19s). `npx vitest run src/config src/collaboration src/memory` → 602/602 pass (14.85s).
- **Committed in:** `bf62842` (Task 1 commit — timeouts were part of the initial delivery)

---

**Total deviations:** 1 auto-fixed (blocking test infrastructure)
**Impact on plan:** Pure test-framework configuration. Zero production-code changes, zero scope creep.

## Issues Encountered

- **Cold-start sqlite-vec + schema migrations**: First discovered during the timeout failure above. Resolved via per-test timeout extension (documented in Decisions). The underlying cost (sqlite-vec extension load + 10 chained migrations per MemoryStore) is a known property of the store, not a bug.
- **Pre-existing test failures carried forward**: 7 failures in `src/manager/__tests__/daemon-openai.test.ts` remain on master — these pre-date Phase 75 Plan 01 and are documented in the Plan 02 SUMMARY "Deferred Issues" section. My Plan 03 run verified zero new failures introduced (3271/3278 passing; same 7 pre-existing fails).

## Edge Cases Surfaced

- **SQLite WAL side-files under mkdtemp teardown**: memories.db-wal and memories.db-shm live alongside memories.db. `rm(tempDir, recursive, force)` handles them cleanly; no explicit WAL-close needed because `mgr.cleanupMemory` already calls `store.close()` which triggers WAL checkpoint.
- **Zero-vector embedding + sqlite-vec KNN behavior**: vec_memories accepts float[384] with any values including all-zero. The auto-linker's KNN path runs without error on zero vectors — all similarity scores are 0, so no spurious edges get created, which is exactly what tag-only isolation tests want.
- **YAML heredoc indentation**: Building the 5-agent YAML programmatically via string interpolation requires exactly 2-space indentation under `agents:` and 4-space indentation for nested keys. Helper function `buildFinmentumConfig` encapsulates this so all 3 finmentum tests share the same YAML layout.

## How Success Criteria from ROADMAP Phase 75 Map to CI

From `.planning/ROADMAP.md` (Phase 75 success criteria implied by SHARED-01/02/03):

| ROADMAP criterion | Enforced by test |
|-------------------|------------------|
| Two agents with shared basePath + distinct memoryPath get independent memories.db | SHARED-02 test 2 — storeA vs storeB findByTag |
| Inbox writes for agent A do not leak to agent B | SHARED-02 test 3 + SHARED-03 test 3 — writeMessage/readMessages assertions |
| 5-agent finmentum family boots under one basePath | SHARED-03 test 1 — resolveAllAgents on the exact 5 names |
| Full pairwise memory isolation across the 5 agents | SHARED-03 test 2 — 20 cross-agent findByTag assertions |
| Duplicate memoryPath rejected before daemon boot | Conflict-detection tests 1 + 2 — schema + loadConfig both |
| Error surfaces both conflicting agent names | Conflict-detection tests 1 + 2 — assert both names in message |

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Plan 03 ships the verification layer. Phases 76+ (the actual OpenClaw migration work) can now safely assume:

1. **Contract stability**: Any future change that silently regresses ResolvedAgentConfig.memoryPath fallback (e.g., typo making loader fall back to `basePath/<name>` instead of `workspace`) fails the inode-witness + cross-agent isolation tests.
2. **Conflict detection stability**: Any future schema refactor that drops the `.superRefine()` block fails 2 conflict-detection tests.
3. **5-agent finmentum scenario is live**: Phase 79 (workspace migration) and Phase 80 (memory translation) can copy-paste the FIN_AGENTS constant + buildFinmentumConfig helper for their own boot tests.
4. **No daemon dependency**: These tests run pure-function style. Integration with the full daemon lifecycle happens later (Phase 77 pre-flight checks and Phase 81 cutover smoke).

**Blockers:** None — Phase 75 is complete (SHARED-01 + SHARED-02 + SHARED-03 all landed across Plans 01/02/03).

## Self-Check: PASSED

- `src/config/__tests__/shared-workspace.integration.test.ts` exists (419 lines)
- Commit `bf62842` present in `git log`
- All 10 acceptance criteria met (see table above)
- All 9 tests pass in isolation (`npx vitest run src/config/__tests__/shared-workspace.integration.test.ts` → 9/9)
- 602/602 pass across config + collaboration + memory suites
- 3271/3278 pass full project-wide (7 pre-existing failures in daemon-openai.test.ts, unchanged from Plan 02 baseline)
- `npx tsc --noEmit` — 29 errors pre-plan → 29 errors post-plan (new file contributes zero)
- No missing items

---
*Phase: 75-shared-workspace-runtime-support*
*Completed: 2026-04-20*
