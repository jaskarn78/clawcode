---
phase: 75-shared-workspace-runtime-support
plan: 01
subsystem: config
tags: [zod, schema-validation, hot-reload, memoryPath, shared-workspace, finmentum]

# Dependency graph
requires:
  - phase: (none — first plan of Phase 75)
    provides: (N/A)
provides:
  - agentSchema.memoryPath optional field (raw string, loader-expanded)
  - configSchema.superRefine duplicate-memoryPath conflict guard
  - ResolvedAgentConfig.memoryPath required readonly string contract
  - NON_RELOADABLE_FIELDS entry for agents.*.memoryPath
  - TEMP loader.ts stub (memoryPath = resolvedWorkspace) keeping tsc green
affects:
  - 75-02 (runtime consumers: session-memory.ts, heartbeat runner, inbox source)
  - 75-03 (end-to-end finmentum 5-agent boot test)
  - Phase 79+ (finmentum workspace migration — unblocked by this contract)

# Tech tracking
tech-stack:
  added: []  # zero new dependencies — pure Zod + TypeScript extension
  patterns:
    - Zod superRefine at full-config level for cross-agent conflict detection
    - Optional YAML field + required resolved type (loader fills fallback)
    - Hot-reload classification entry as documentation-of-intent (classifier already returns false by default)

key-files:
  created:
    - .planning/phases/75-shared-workspace-runtime-support/deferred-items.md
  modified:
    - src/config/schema.ts (agentSchema.memoryPath + configSchema.superRefine)
    - src/shared/types.ts (ResolvedAgentConfig.memoryPath required field)
    - src/config/types.ts (NON_RELOADABLE_FIELDS entry)
    - src/config/loader.ts (TEMP stub — Plan 02 replaces)
    - src/config/__tests__/schema.test.ts (10 new tests)
    - src/config/__tests__/differ.test.ts (5 new tests)
    - 13 test-fixture files updated for new required ResolvedAgentConfig.memoryPath field

key-decisions:
  - "Raw-string conflict detection: superRefine compares unexpanded memoryPath strings; path normalization (trailing slashes, ./ prefixes) is deferred to loader.ts in Plan 02"
  - "Stubbed loader.ts with memoryPath = resolvedWorkspace + TEMP comment to keep tsc green; Plan 02 replaces with expandHome(agent.memoryPath ?? agent.workspace ?? basePath/name)"
  - "z.string().min(1).optional() — optional YAML field but rejects empty strings to catch config typos"
  - "NON_RELOADABLE_FIELDS entry is documentation-of-intent: classifier already returns false for unmatched fields; entry exists for auditability and to aid future RELOADABLE_FIELDS additions"

patterns-established:
  - "Schema-level conflict detection via superRefine: emits ctx.addIssue with multi-agent-name message; error names ALL conflicting agents, not just first pair"
  - "ResolvedAgentConfig expansion: optional YAML fields become required resolved fields after loader populates fallbacks"

requirements-completed:
  - SHARED-01

# Metrics
duration: 10min
completed: 2026-04-20
---

# Phase 75 Plan 01: memoryPath Contract Summary

**Adds optional `memoryPath:` config field with schema validation, cross-agent conflict guard, resolved-type contract, and hot-reload classification — unblocking the 5-agent finmentum family to share one workspace while keeping memories/inbox/heartbeat isolated.**

## Performance

- **Duration:** 10 min 1s
- **Started:** 2026-04-20T13:44:37Z
- **Completed:** 2026-04-20T13:54:38Z
- **Tasks:** 2/2 completed
- **Files modified:** 19 (4 source, 2 test-suite additions, 13 test-fixture updates)

## Accomplishments

- **agentSchema.memoryPath field landed** — `z.string().min(1).optional()`, accepts absolute + relative + `~/` paths, rejects empty/non-string values.
- **configSchema conflict guard landed** — `.superRefine()` groups agents by raw memoryPath string and emits a `z.ZodIssueCode.custom` issue naming ALL conflicting agent names (verified by 3-agent test case that only names the two colliding agents, not the distinct third).
- **ResolvedAgentConfig contract established** — `readonly memoryPath: string` required field means downstream consumers (Plan 02 runtime, Plan 03 boot test) can read it unconditionally.
- **Hot-reload classification codified** — `agents.*.memoryPath` added to `NON_RELOADABLE_FIELDS`; 5 differ tests cover change/no-change/add/remove/only-memoryPath cases and assert `reloadable: false`.
- **Zero runtime consumers touched** — pure contract plan; loader.ts has a TEMPORARY stub that Plan 02 will replace.

## Task Commits

1. **Task 1 RED: failing tests for agentSchema.memoryPath + conflict guard** — `17be5bf` (test)
2. **Task 1 GREEN: memoryPath field + conflict guard + ResolvedAgentConfig** — `1501c8d` (feat)
3. **Task 2: classify agents.*.memoryPath as non-reloadable** — `74bb8c2` (feat — tests were GREEN from the start because `classifyField` defaults to false; commit codifies intent and adds 5 regression tests)

_Task 2 TDD: tests passed immediately — the classifier already returned `false` for unmatched fields, so NON_RELOADABLE_FIELDS entry + tests serve as regression pin + documentation-of-intent._

## Files Created/Modified

### Source
- `src/config/schema.ts` — agentSchema gains `memoryPath` field (line 649); configSchema gains `.superRefine()` conflict guard (line 932–955).
- `src/shared/types.ts` — ResolvedAgentConfig gains required `readonly memoryPath: string` field (line 16) with JSDoc explaining the loader-fallback contract.
- `src/config/types.ts` — NON_RELOADABLE_FIELDS Set gains `"agents.*.memoryPath"` entry (line 69) with rationale block.
- `src/config/loader.ts` — **TEMPORARY STUB at lines 151–162** — `memoryPath: resolvedWorkspace` with `// TEMP Plan 01 — Plan 02 replaces with expandHome(...)` comment. **Plan 02 MUST replace these 4 lines** with real resolution: `memoryPath: expandHome(agent.memoryPath ?? resolvedWorkspace)`.

### Tests
- `src/config/__tests__/schema.test.ts` — +10 tests: 5 agentSchema.memoryPath + 5 configSchema conflict detection.
- `src/config/__tests__/differ.test.ts` — +5 tests: change/no-change/add/remove/only-memoryPath.

### Test fixtures (13 files — new required `memoryPath` field on ResolvedAgentConfig literals)
- `src/agent/__tests__/workspace.test.ts`
- `src/bootstrap/__tests__/detector.test.ts`
- `src/discord/__tests__/router.test.ts`
- `src/discord/subagent-thread-spawner.test.ts`
- `src/discord/thread-manager.test.ts`
- `src/heartbeat/__tests__/runner.test.ts`
- `src/manager/__tests__/config-reloader.test.ts`
- `src/manager/__tests__/mcp-session.test.ts`
- `src/manager/__tests__/persistent-session-recovery.test.ts`
- `src/manager/__tests__/session-config.test.ts`
- `src/manager/__tests__/session-manager-memory-failure.test.ts`
- `src/manager/__tests__/session-manager.test.ts`
- `src/manager/fork.test.ts`

### Deferred
- `.planning/phases/75-shared-workspace-runtime-support/deferred-items.md` — lists 29 pre-existing tsc errors unrelated to Phase 75 (`src/tasks/task-manager.ts` causationId, `src/usage/__tests__/daily-summary.test.ts` tuple-index, etc.). NOT fixed in this plan per scope boundary.

## Decisions Made

- **Schema compares RAW strings** — path-normalization edge cases (trailing slash, `./` prefixes) deferred to loader.ts per D-03 in 75-CONTEXT.md. Schema test case documents this boundary (`~/shared/A` vs `~/shared/A/` accepted as distinct).
- **Loader stub mirrors `workspace`** — simplest valid value that keeps tsc green and doesn't break any existing test assertions. Plan 02 replaces with real expandHome-based resolution.
- **`memoryPath` is a REQUIRED field on ResolvedAgentConfig** (not optional) — per D-01: downstream consumers read unconditionally; loader guarantees the fallback. This caused 13 test fixtures to need updates, but preserves the zero-optional-chain pattern across runtime code.
- **NON_RELOADABLE_FIELDS entry is documentation** — classifier default already returns false; entry exists for auditability and so future developers see the rationale in the Set literal rather than inferring it from absence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added memoryPath to 13 test-fixture files**
- **Found during:** Task 1 GREEN phase, after adding `readonly memoryPath: string` to ResolvedAgentConfig
- **Issue:** 24 tsc errors across 13 test files that construct ResolvedAgentConfig literals (e.g., `makeAgent()`, `makeConfig()`, `parentConfig`). The required field was missing from every fixture.
- **Fix:** Added `memoryPath: <workspace-path>` to each fixture, mirroring the workspace value (since these fixtures don't exercise memoryPath, matching workspace preserves existing test semantics). Files: workspace.test.ts, detector.test.ts, router.test.ts, subagent-thread-spawner.test.ts, thread-manager.test.ts, runner.test.ts (5 instances), config-reloader.test.ts, mcp-session.test.ts, persistent-session-recovery.test.ts, session-config.test.ts, session-manager-memory-failure.test.ts, session-manager.test.ts (3 instances), fork.test.ts.
- **Verification:** `npx tsc --noEmit 2>&1 | grep memoryPath` returns zero results. Full config test suite (200 tests) passes.
- **Committed in:** `1501c8d` (part of Task 1 GREEN commit — inline with the schema change that introduced the requirement).

**2. [Rule 3 - Blocking documentation] Logged 29 pre-existing tsc errors to deferred-items.md**
- **Found during:** Task 1 verification (running full `npx tsc --noEmit`)
- **Issue:** The acceptance criteria required `npx tsc --noEmit exits 0`, but 29 pre-existing errors exist in unrelated files (task-manager.ts, daemon.ts, daily-summary.test.ts, etc.). Baseline before my changes: 31 errors. After my changes: 29 errors (my fixture updates happen to resolve 2 side-effects).
- **Fix:** Per scope boundary rule ("only auto-fix issues DIRECTLY caused by the current task"), logged the 29 remaining pre-existing errors to `.planning/phases/75-shared-workspace-runtime-support/deferred-items.md`. Did NOT attempt to fix them.
- **Committed in:** deferred-items.md will be included in the final plan metadata commit.

## Deferred Issues

See `.planning/phases/75-shared-workspace-runtime-support/deferred-items.md` for the full list of 29 pre-existing tsc errors out of scope for this plan. Highlights:
- `src/tasks/task-manager.ts` — 4 missing `causationId` errors
- `src/usage/__tests__/daily-summary.test.ts` — 4 empty-tuple index errors
- `src/manager/daemon.ts` — 3 import/property errors (ImageProvider, schedule.handler, CostByAgentModel)
- `src/image/daemon-handler.ts` — 3 errors (not inspected)
- `src/cli/commands/__tests__/tasks.test.ts` — 3 errors (not inspected)
- `src/cli/commands/__tests__/latency.test.ts` — 3 errors (not inspected)

## Test Counts Added

- **schema.test.ts:** 10 new tests (5 agentSchema.memoryPath + 5 configSchema conflict detection)
- **differ.test.ts:** 5 new tests (change/no-change/add/remove/only-memoryPath)
- **Total:** 15 new tests, 100% passing.
- **Full suite:** 200 config tests pass (up from 185 pre-plan).

## Plan 02 Handoff Notes

**CRITICAL: Replace the loader.ts stub.** Lines 151–162 of `src/config/loader.ts` contain:

```typescript
const resolvedWorkspace =
  agent.workspace ?? join(expandHome(defaults.basePath), agent.name);

return {
  name: agent.name,
  workspace: resolvedWorkspace,
  // TEMP Plan 01 — Plan 02 replaces with expandHome(agent.memoryPath ?? agent.workspace ?? basePath/name)
  // Plan 01 only lands the type contract + schema validation; this stub keeps
  // `npx tsc --noEmit` green so the ResolvedAgentConfig.memoryPath field can
  // be consumed by Plan 02 which wires session-memory/inbox/heartbeat/etc.
  memoryPath: resolvedWorkspace,
```

Plan 02 must replace `memoryPath: resolvedWorkspace` with proper resolution that respects the agent's `memoryPath` YAML override and expands `~/...` paths via `expandHome()`. The expected implementation is documented in the TEMP comment.

**Call sites to wire in Plan 02** (from 75-01-PLAN.md `<interfaces>`):
- `src/manager/session-memory.ts:53,115` — memoryDir + tracesDbPath
- `src/heartbeat/runner.ts:337` — heartbeat.log location
- `src/heartbeat/checks/inbox.ts:55` — inbox discovery
- `src/manager/daemon.ts:644,801,1706,1752,2704` — consolidation + inbox + send-message + health log reader
- `src/discord/bridge.ts:404,497` — attachment download dir

## Self-Check: PASSED

- All 7 expected files exist at claimed paths
- All 3 task commit hashes (`17be5bf`, `1501c8d`, `74bb8c2`) present in `git log --all`
- No missing items
