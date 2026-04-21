---
phase: 78-config-mapping-yaml-writer
plan: 01
subsystem: config
tags: [zod, schema, config, yaml, soul, identity, file-pointer, lazy-read, hot-reload, migration]

# Dependency graph
requires:
  - phase: 75-shared-workspace-runtime-support
    provides: "configSchema.superRefine pattern (memoryPath conflict detection), ResolvedAgentConfig optional-field-plus-loader-expansion pattern, expandHome conditional usage"
provides:
  - "agentSchema.soulFile + agentSchema.identityFile optional z.string().min(1) fields"
  - "configSchema per-agent mutual-exclusion guard (inline soul/identity vs file pointers) via superRefine"
  - "ResolvedAgentConfig.soulFile / .identityFile optional absolute-path fields (expandHome'd by loader)"
  - "session-config.ts 3-branch lazy-read precedence: soulFile -> workspace/SOUL.md -> inline (mirrored for identity)"
  - "CONF-01 success criterion prerequisite: rg 'readFile.*soulFile' src/ non-empty"
affects: [78-02-config-mapper, 78-03-yaml-writer, 79-workspace-copy, 80-memory-translation]

# Tech tracking
tech-stack:
  added: []  # Zero new deps — reuses existing zod, expandHome, node:fs/promises.readFile
  patterns:
    - "File-pointer + mutual-exclusion pattern (Phase 75 memoryPath pattern extended to SOUL/IDENTITY)"
    - "3-branch silent-fall-through lazy-read precedence chain"
    - "superRefine block extension (append, do NOT chain second .superRefine — Zod allows only one)"

key-files:
  created:
    - ".planning/phases/78-config-mapping-yaml-writer/deferred-items.md"
  modified:
    - "src/config/schema.ts"
    - "src/shared/types.ts"
    - "src/config/loader.ts"
    - "src/manager/session-config.ts"
    - "src/config/__tests__/schema.test.ts"
    - "src/config/__tests__/loader.test.ts"
    - "src/manager/__tests__/session-config.test.ts"

key-decisions:
  - "Appended Phase 78 mutual-exclusion block INSIDE existing Phase 75 superRefine arrow function (single superRefine chain — Zod doesn't support chaining a second)"
  - "Error message copy made grep-verifiable: literal 'cannot be used together' substring with agent name inline"
  - "Silent fall-through on read errors at every precedence step — a configured-but-deleted soulFile does not crash session boot"
  - "storeSoulMemory in session-memory.ts intentionally NOT updated in this plan (deferred-items.md documents the mirror-change follow-up)"
  - "differ.ts / NON_RELOADABLE_FIELDS intentionally untouched per plan verification section; differ classification follow-up tracked in deferred-items.md"

patterns-established:
  - "File-pointer fields stored raw at schema layer (z.string().min(1).optional()); expansion via expandHome in loader.ts at resolution time"
  - "Per-agent mutual exclusion via superRefine: loop over cfg.agents, addIssue with agent name + offending keys in message"
  - "Lazy-read 3-branch precedence: if (pointer) readFile; if (!content) try workspace; if (!content) content = inline ?? ''"

requirements-completed:
  - CONF-01

# Metrics
duration: 6min
completed: 2026-04-20
---

# Phase 78 Plan 01: Schema Surface + Lazy-Read Precedence for soulFile/identityFile Summary

**File-pointer SOUL/IDENTITY contract landed: agentSchema + Zod mutual-exclusion guard + ResolvedAgentConfig + loader expandHome + session-config 3-branch lazy-read precedence. Plans 02/03 can now build the writer and mapper on a stable, typed contract.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-20T18:38:41Z
- **Completed:** 2026-04-20T18:45:01Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 7 (4 src, 3 test)
- **Files created:** 1 (deferred-items.md)

## Accomplishments

- `agentSchema` extended with optional `soulFile` + `identityFile` (`z.string().min(1).optional()`)
- `configSchema.superRefine` per-agent mutual-exclusion guard: rejects `(soul + soulFile)` and `(identity + identityFile)` combinations at load time with grep-verifiable error text ("cannot be used together") naming the offending agent
- `ResolvedAgentConfig` surfaces both pointers as optional absolute paths — `expandHome()` expansion happens in `resolveAgentConfig` exactly when the raw field is set
- `session-config.ts` `buildSessionConfig` implements 3-branch lazy-read precedence for BOTH soul and identity: `pointerFile -> <workspace>/X.md -> inline config.X`
- Silent fall-through on read errors at every precedence step — broken pointers fall through to workspace file and inline string; session boot never crashes on a deleted soulFile
- CONF-01 phase success criterion prerequisite met: `rg 'readFile.*soulFile' src/` returns non-empty (lazy-read code path proven in source)

## Task Commits

TDD tasks — 2 commits each (test → feat):

1. **Task 1 RED: Schema + types + loader failing tests** — `b9708c3` (test)
2. **Task 1 GREEN: Schema + types + loader implementation** — `442d19c` (feat)
3. **Task 2 RED: session-config lazy-read precedence failing tests** — `f4517b5` (test)
4. **Task 2 GREEN: session-config 3-branch precedence implementation** — `e31ae0d` (feat)

## Files Created/Modified

- `src/config/schema.ts` — `agentSchema.soulFile` + `agentSchema.identityFile` + `configSchema.superRefine` mutual-exclusion guard (appended inside existing Phase 75 block)
- `src/shared/types.ts` — `ResolvedAgentConfig.soulFile?` + `ResolvedAgentConfig.identityFile?` (readonly, absolute paths post-expansion)
- `src/config/loader.ts` — `resolveAgentConfig` now expands both via `expandHome()` when set; leaves `undefined` when unset
- `src/manager/session-config.ts` — `buildSessionConfig` 3-branch precedence replacing the prior 2-branch SOUL block (lines 154-162) and 2-branch IDENTITY block (lines 170-182)
- `src/config/__tests__/schema.test.ts` — +10 new tests (5 agentSchema field tests, 5 configSchema mutual-exclusion + Phase 75 regression tests)
- `src/config/__tests__/loader.test.ts` — +4 new tests (soulFile expansion set/unset, identityFile mirror, workspace-independence)
- `src/manager/__tests__/session-config.test.ts` — +8 new tests (soulFile precedence, workspace fallback, inline fallback, all-absent no-crash, identityFile mirror, precedence-correctness pin, LOAD-02 regression)
- `.planning/phases/78-config-mapping-yaml-writer/deferred-items.md` — storeSoulMemory + differ classification follow-ups

## Test Counts

| Suite | New Tests |
|-------|-----------|
| schema (agentSchema + configSchema mutual-exclusion) | 10 |
| loader (resolveAgentConfig soulFile/identityFile expansion) | 4 |
| session-config (buildSessionConfig 3-branch precedence) | 8 |
| **Total new** | **22** |
| **Total passing (config + session-config suites)** | **273** (0 failures, 0 skips) |

## Decisions Made

- **Appended Phase 78 guard INSIDE existing Phase 75 superRefine arrow function** — Zod doesn't support chaining a second `.superRefine()`. The two guard blocks (Phase 75 memoryPath conflict + Phase 78 mutual exclusion) now coexist in one `superRefine` body; regression test asserts both fire independently.
- **Error message copy pinned verbatim** — `agent "<name>": inline "soul" and "soulFile" cannot be used together — pick one (soulFile is preferred for migrated agents).` Literal "cannot be used together" substring is the grep-verifiable contract and explicitly called out in `<critical_constraints>`.
- **Silent fall-through on read errors** — a configured `soulFile` pointing at a deleted file must not crash session boot. Three branches, each `try { } catch { /* fall through */ }`; last branch falls back to `config.soul ?? ""`.
- **`storeSoulMemory` intentionally not updated** — deferred-items.md tracks the mirror-change follow-up. Rationale: migrated agents (Phase 79) will have `SOUL.md` inside their workspace, so the existing hard-coded `join(config.workspace, "SOUL.md")` read works; `soulFile:` pointing at an external path is a migration edge case, not the common path. Expanding blast radius of Plan 01 was not justified.
- **differ.ts untouched** — Plan verification section explicitly says "No changes to differ.ts / NON_RELOADABLE_FIELDS". CONTEXT.md's aspiration ("Mark as reloadable: true") is tracked in deferred-items.md for Plan 02/03 to address once the yaml-writer is in play.

## Deviations from Plan

None — plan executed exactly as written.

All acceptance-criteria greps satisfied:
- `grep -E "soulFile: z\.string\(\)\.min\(1\)\.optional\(\)" src/config/schema.ts` → 1 match
- `grep -E "identityFile: z\.string\(\)\.min\(1\)\.optional\(\)" src/config/schema.ts` → 1 match
- `grep "cannot be used together" src/config/schema.ts` → 2 matches
- `grep -c "superRefine" src/config/schema.ts` → 1 (single chain, extended in place)
- `grep "readonly soulFile" src/shared/types.ts` → 1 match
- `grep "readonly identityFile" src/shared/types.ts` → 1 match
- `grep "soulFile: agent.soulFile ? expandHome" src/config/loader.ts` → 1 match
- `grep "identityFile: agent.identityFile ? expandHome" src/config/loader.ts` → 1 match
- `grep "config.soulFile" src/manager/session-config.ts` → 3 matches (comment + if + readFile)
- `grep "config.identityFile" src/manager/session-config.ts` → 3 matches (comment + if + readFile)
- `grep "Phase 78 CONF-01" src/manager/session-config.ts` → 2 matches (one SOUL, one IDENTITY)
- `rg 'readFile.*soulFile' src/` → non-empty (CONF-01 success criterion prerequisite met)

## Issues Encountered

None. Pre-existing TSC errors in unrelated files (src/usage/budget.ts, src/memory/__tests__/graph.test.ts, src/tasks/task-manager.ts, src/triggers/__tests__/engine.test.ts, src/usage/__tests__/daily-summary.test.ts) are NOT introduced by this plan — verified via `git stash + tsc + stash pop`. Out of scope per deviation-rules SCOPE BOUNDARY.

## Deferred Items

See `deferred-items.md` in this phase directory:

1. **`storeSoulMemory` mirror change** — apply 3-branch precedence to the memory-store-insert path in `session-memory.ts:217-243`. Currently workspace-hardcoded; works for migrated agents (Phase 79 copies SOUL.md to workspace) but asymmetric with the session-config read path.
2. **Differ classification upgrade** — add `agents.*.soulFile` + `agents.*.identityFile` to `RELOADABLE_FIELDS` in `src/config/types.ts`. Currently both default to `reloadable: false`; semantically they are hot-reloadable (content re-read lazily at next session boot, no live-state surgery needed).

## Regression Surface

Unchanged — all preserved:
- Phase 75 memoryPath conflict detection — dedicated regression test exercises both superRefine blocks firing independently.
- Phase 75 SHARED-02 shared-workspace context-summary resume path — 273 tests pass across config + session-config suites.
- LOAD-02 / Phase 45 — workspace SOUL.md + IDENTITY.md still load byte-for-byte when soulFile/identityFile are unset.
- `differ.ts` + `NON_RELOADABLE_FIELDS` — byte-identical to pre-Plan state.

## Next Phase Readiness

Plan 02 (config-mapper) and Plan 03 (yaml-writer) can now:
- Generate YAML entries with `soulFile:` + `identityFile:` string keys and trust the schema accepts them
- Trust `ResolvedAgentConfig.soulFile` / `.identityFile` are absolute paths when the writer produces them
- Trust the daemon reads the pointed-at file at session boot via the 3-branch precedence chain
- Emit mutually-exclusive YAML (`soulFile` xor `soul`, `identityFile` xor `identity`) with confidence that mixed output will be rejected at load time

## Self-Check: PASSED

- `src/config/schema.ts` — FOUND (agentSchema.soulFile + agentSchema.identityFile + superRefine guard)
- `src/shared/types.ts` — FOUND (ResolvedAgentConfig.soulFile? + .identityFile?)
- `src/config/loader.ts` — FOUND (expandHome on soulFile/identityFile)
- `src/manager/session-config.ts` — FOUND (3-branch precedence for SOUL + IDENTITY)
- `src/config/__tests__/schema.test.ts` — FOUND (+10 tests)
- `src/config/__tests__/loader.test.ts` — FOUND (+4 tests)
- `src/manager/__tests__/session-config.test.ts` — FOUND (+8 tests)
- `.planning/phases/78-config-mapping-yaml-writer/deferred-items.md` — FOUND
- Commit `b9708c3` — FOUND (Task 1 RED)
- Commit `442d19c` — FOUND (Task 1 GREEN)
- Commit `f4517b5` — FOUND (Task 2 RED)
- Commit `e31ae0d` — FOUND (Task 2 GREEN)

---
*Phase: 78-config-mapping-yaml-writer*
*Completed: 2026-04-20*
