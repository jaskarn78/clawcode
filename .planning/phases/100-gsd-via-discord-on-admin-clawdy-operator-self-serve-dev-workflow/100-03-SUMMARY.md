---
phase: 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow
plan: 03
subsystem: config
tags: [differ, classification, settingSources, gsd, projectDir, agent-restart, NON_RELOADABLE_FIELDS, documentation-of-intent]

# Dependency graph
requires:
  - phase: 100
    plan: 01
    provides: agent.settingSources + agent.gsd.projectDir schema/types/resolver — the raw Config object the differ runs against now carries these fields when set
  - phase: 75
    plan: 01
    provides: NON_RELOADABLE_FIELDS documentation-of-intent pattern (memoryPath at types.ts:151) — Phase 100 mirrors this pattern verbatim
  - phase: 22
    plan: 01
    provides: RELOADABLE_FIELDS / NON_RELOADABLE_FIELDS classifier contract — watcher emits agent-restart-needed signal on reloadable=false changes
provides:
  - "agents.*.settingSources classification: NON-reloadable (agent-restart-required)"
  - "defaults.settingSources classification: NON-reloadable"
  - "agents.*.gsd classification: NON-reloadable (whole-block)"
  - "agents.*.gsd.projectDir classification: NON-reloadable (leaf-level)"
  - "defaults.gsd / defaults.gsd.projectDir classification: NON-reloadable"
  - "8 regression-pinned differ tests (DI1..DI8) covering the contract"
  - "Documentation-of-intent comment block citing Phase 100 GSD-07 + RESEARCH.md Architecture Pattern 5"
affects:
  - "Plan 100-08 SMOKE-TEST runbook — must include `clawcode restart admin-clawdy` as the operator step after editing settingSources/gsd.projectDir in clawcode.yaml"
  - "Watcher emits agent-restart-needed notification (Phase 22 contract — already correct, no changes needed)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "1st application of an agent-restart classification pattern in Phase 100 (vs. 11 prior reloadable classifications in 83/86/89/90/94/95/96)"
    - "v2.5 SHARED-01 memoryPath documentation-of-intent pattern reused verbatim (explicit NON_RELOADABLE entries even though classifier already falls through to false)"
    - "RESEARCH.md Architecture Pattern 5 — cwd + settingSources are SDK baseOptions captured at session start, NOT re-read per turn — informs the agent-restart classification rationale"

key-files:
  created: []
  modified:
    - "src/config/types.ts (+29 lines: 6 NON_RELOADABLE entries + 15-line rationale block + 9-line RELOADABLE-side hint)"
    - "src/config/__tests__/differ.test.ts (+243 lines: 8 DI* tests + describe block + Phase 100 helper makeAgent)"

key-decisions:
  - "Documentation-of-intent entries (settingSources + gsd + gsd.projectDir, agents + defaults) added to NON_RELOADABLE_FIELDS even though classifier already falls through to false. Matches v2.5 SHARED-01 memoryPath pattern. Visible to grep, comment, and future readers."
  - "Comment block placed in BOTH directions: (a) RELOADABLE_FIELDS gets a 'DELIBERATELY EXCLUDED' hint after the closing entry; (b) NON_RELOADABLE_FIELDS gets the full rationale block before the entries. Future readers find the documentation regardless of which list they're scanning."
  - "DI8 regression pin asserts BOTH that NON_RELOADABLE_FIELDS contains the entries AND that RELOADABLE_FIELDS does NOT. Defends against accidental future promotion."
  - "src/config/watcher.ts deliberately NOT modified. The watcher's reloadable=false handling is already correct (Phase 22 contract): emits agent-restart-needed signal. Plan 03 changes are pure classification + documentation."

requirements-completed: [REQ-100-07]

# Metrics
duration: 5min
completed: 2026-04-26
---

# Phase 100 Plan 03: Differ classification — settingSources + gsd.projectDir as agent-restart fields Summary

**Differ classifies `settingSources` and `gsd.projectDir` as NON-reloadable (agent-restart-required) — first application of an agent-restart classification in Phase 100, mirroring the v2.5 SHARED-01 `memoryPath` documentation-of-intent pattern; 6 explicit `NON_RELOADABLE_FIELDS` entries + 15-line rationale block + 8 DI* regression-pinned tests.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-26T18:19:21Z
- **Completed:** 2026-04-26T18:24:37Z
- **Tasks:** 1 (combined RED + GREEN per plan's combined-cycle directive — Plan 03 is small enough to combine)
- **Files modified:** 2 (`src/config/types.ts` + `src/config/__tests__/differ.test.ts`)
- **Net source-line delta:** +272 lines (29 source + 243 test)

## Accomplishments

- **6 explicit entries added to `NON_RELOADABLE_FIELDS`** (`src/config/types.ts:151-167`): `agents.*.settingSources`, `defaults.settingSources`, `agents.*.gsd`, `agents.*.gsd.projectDir`, `defaults.gsd`, `defaults.gsd.projectDir`. The classifier in `differ.ts:144-149` already falls through to `false` for unclassified paths, so these entries are documentation-of-intent — but they make the contract grep-visible and pin against accidental future promotion.
- **15-line rationale comment block** preceding the new entries cites: Phase 100 GSD-07, the SDK session-boot `baseOptions` mechanism (`src/manager/session-adapter.ts:585-636` — Plan 100-02), the v2.5 SHARED-01 memoryPath precedent, the operator command (`clawcode restart admin-clawdy`), and the count of prior reloadable-classification phases (83/86/89/90/94/95/96).
- **9-line hint at the end of `RELOADABLE_FIELDS`** explicitly notes Phase 100 fields are DELIBERATELY EXCLUDED. Defends against future readers who might assume the omission was an oversight.
- **8 new differ tests (DI1..DI8)** — extend `src/config/__tests__/differ.test.ts` with a `describe("Phase 100 — settingSources + gsd.projectDir agent-restart classification", ...)` block covering: settingSources change (DI1), gsd.projectDir change (DI2), gsd block added (DI3), gsd block removed (DI4), no false-positive on identical config (DI5), settingSources order change (DI6), multi-field-mix with both reloadable + non-reloadable changes (DI7), explicit-listing regression pin (DI8).
- **Behavior change: zero** — the classifier already returned `false` for unclassified paths. Phase 100 just makes the intent visible (entries) and documented (comment block).
- **Watcher untouched** — `src/config/watcher.ts` deliberately NOT modified. The Phase 22 contract on `reloadable=false` already emits the agent-restart-needed signal correctly.

## Task Commits

1. **Task 1 RED — 8 differ tests for settingSources + gsd.projectDir agent-restart classification** — `d654b09` (test): added describe block with DI1..DI8 + the `makeAgent` helper. 7 tests pass vacuously (classifier already returns false for unclassified paths); DI8 fails RED — proves Step B is needed.
2. **Task 1 GREEN — feat: classify settingSources + gsd.projectDir as agent-restart fields** — `f436c83` (feat): added 6 explicit `NON_RELOADABLE_FIELDS` entries + 15-line rationale block (citing Phase 100 GSD-07, RESEARCH.md Architecture Pattern 5, session-adapter line numbers, operator command, and v2.5 memoryPath precedent) + 9-line `RELOADABLE_FIELDS`-side hint comment. DI8 now passes; all 27 differ tests GREEN.

**Plan metadata commit:** TBD (final commit on this SUMMARY + STATE.md + ROADMAP.md update).

## Files Created/Modified

### Source

- `src/config/types.ts:131-138` — RELOADABLE_FIELDS gets a 9-line "DELIBERATELY EXCLUDED" hint comment AFTER the last entry (`defaults.outputDir`), pointing readers to the NON_RELOADABLE_FIELDS section + Plan 100-02 wire site.
- `src/config/types.ts:151-167` — NON_RELOADABLE_FIELDS gains:
  - **15-line rationale block** (lines 152-166) citing Phase 100 GSD-07, RESEARCH.md Architecture Pattern 5, `session-adapter.ts:585-636`, v2.5 memoryPath precedent, and operator restart command.
  - **6 entries** (lines 167-172): `agents.*.settingSources`, `defaults.settingSources`, `agents.*.gsd`, `agents.*.gsd.projectDir`, `defaults.gsd`, `defaults.gsd.projectDir`.

### Tests

- `src/config/__tests__/differ.test.ts:1-4` — added `import { RELOADABLE_FIELDS, NON_RELOADABLE_FIELDS } from "../types.js";` (DI8 needs both Sets accessible to the test).
- `src/config/__tests__/differ.test.ts:530-771` — appended `describe("Phase 100 — settingSources + gsd.projectDir agent-restart classification", () => { ... })` with:
  - 22-line preamble comment citing Architecture Pattern 5 + the 1st-application context.
  - `makeAgent(overrides)` helper inline in the describe block (mirrors the inline-fixture pattern from earlier tests).
  - **DI1** (lines 590-606) — settingSources change `['project']` → `['project','user']` produces 1 change at `agents.admin-clawdy.settingSources` with `reloadable=false`.
  - **DI2** (lines 611-628) — `gsd.projectDir` change `'/opt/a'` → `'/opt/b'` at `agents.admin-clawdy.gsd.projectDir` with `reloadable=false`.
  - **DI3** (lines 635-651) — adding `gsd` block (undefined → `{ projectDir: '/opt/x' }`) produces a change at `gsd` OR `gsd.projectDir`, either way `reloadable=false`.
  - **DI4** (lines 656-672) — removing `gsd` block (inverse of DI3), `reloadable=false`.
  - **DI5** (lines 677-696) — identical settingSources + gsd produces zero diff entries (no false-positive).
  - **DI6** (lines 703-718) — settingSources order change `['project','user']` → `['user','project']` produces 1 change with `reloadable=false` (isDeepEqual respects array order).
  - **DI7** (lines 724-748) — multi-field-mix: settingSources change AND effort change in same diff. Asserts `hasReloadableChanges=true` (effort) AND `hasNonReloadableChanges=true` (settingSources).
  - **DI8** (lines 757-770) — Regression pin. Asserts `NON_RELOADABLE_FIELDS.has("agents.*.settingSources") === true`, `NON_RELOADABLE_FIELDS.has("agents.*.gsd") === true`, AND `RELOADABLE_FIELDS.has(...)` returns false for all 5 Phase 100 paths (`agents.*.settingSources`, `agents.*.gsd`, `agents.*.gsd.projectDir`, `defaults.settingSources`, `defaults.gsd`, `defaults.gsd.projectDir`). Defends against accidental promotion.

### Watcher (intentionally NOT modified)

- `src/config/watcher.ts` — deliberately untouched. The Phase 22 contract on `reloadable=false` already correctly emits the agent-restart-needed signal. Plan 03 is pure classification + documentation; downstream behavior is already correct.

## Decisions Made

- **Documentation-of-intent over runtime dependence.** The classifier in `differ.ts:144-149` already returns `false` for unclassified paths, so the explicit entries don't change behavior. They're added because (a) future readers grep `NON_RELOADABLE_FIELDS` to discover what's restart-required; (b) DI8 regression-pins them against accidental promotion. Mirrors v2.5 SHARED-01 memoryPath pattern verbatim.
- **Comment block in both directions.** A reader scanning `RELOADABLE_FIELDS` sees the 9-line hint pointing to NON_RELOADABLE; a reader scanning `NON_RELOADABLE_FIELDS` sees the 15-line rationale. No matter which list a future debugging session lands in, the rationale is one scroll away.
- **`agents.*.gsd` listed alongside `agents.*.gsd.projectDir`.** The differ may produce either path depending on whether a child key changed (leaf-level) or the whole block was added/removed (whole-block). Both paths classify identically, so both are listed. DI3 + DI4 verify either-path semantics.
- **DI8 regression pin doubles as documentation.** A future engineer reading DI8 sees the assertion `RELOADABLE_FIELDS.has("agents.*.settingSources")` is `false` — that's a tighter contract than a comment alone. CI fails immediately if anyone moves the entries.
- **No watcher.ts changes.** The Phase 22 watcher contract treats `reloadable=false` as "emit agent-restart-needed" — already correct. Plan 03 doesn't need to touch the watcher; the classification change is sufficient on its own.

## Deviations from Plan

None — plan executed exactly as written. Both steps (RED + GREEN) committed atomically per the plan's combined-cycle directive.

## Issues Encountered

- **Pre-existing tsc errors (101 baseline, unchanged by Plan 03).** Multiple pre-existing tsc errors in unrelated files (`src/triggers/__tests__/engine.test.ts`, `src/usage/__tests__/daily-summary.test.ts`, `src/usage/budget.ts`, `src/config/__tests__/differ.test.ts:9` re: missing `outputDir` in `makeConfig` defaults from Phase 96). All confirmed out-of-scope per CLAUDE.md SCOPE BOUNDARY rule. Net tsc delta: **0 errors introduced by Plan 03**.
- **Pre-existing test failures: 3 `subagent-routing`-related tests in `schema-system-prompt-directives.test.ts` + `loader.test.ts`.** Confirmed pre-existing on a baseline check (commit `28f4c98` before Plan 03 changes). Already documented in Plan 100-01 SUMMARY as a known pre-existing issue from Phase 99-K. Out of scope.
- **Plan 100-02 parallel executor.** Plan 100-02 ran concurrently in Wave 2 (parallel execution mode); commits `490cb9f` (RED) and Plan 02's GREEN landed alongside Plan 03's commits. Both plans modify `src/config/types.ts` but in non-overlapping regions (Plan 02 doesn't touch the differ classification; Plan 03 doesn't touch session-adapter). Zero conflicts.

## User Setup Required

None — classification-tier change only. Production deploy is an operator-driven manual step on clawdy after the full Phase 100 lands (per Plan 100-08 SMOKE-TEST runbook + the deployment_constraint that this conversation's executor never touches clawdy).

## Next Phase Readiness

**Hand-off to Plan 100-08 (SMOKE-TEST runbook):**

When the smoke-test runbook documents post-deploy verification, it MUST include the operator step `clawcode restart admin-clawdy` after editing either:
- `agents[name=admin-clawdy].settingSources` (e.g., adding `"user"` to the array)
- `agents[name=admin-clawdy].gsd.projectDir` (e.g., changing the sandbox path)

The watcher will detect the YAML edit and the differ will report `reloadable=false` for these field paths — the watcher then emits an "agent restart needed" notification to the operator (Phase 22 contract). The operator's expected action is `clawcode restart admin-clawdy`, NOT a daemon restart (which would unnecessarily bounce the entire fleet).

**Plan 04+ dependencies:**

Plan 04 (slash dispatcher) and Plan 05 (subagent thread spawner) read `ResolvedAgentConfig.settingSources` and `ResolvedAgentConfig.gsd?.projectDir` directly. Plan 03's classification is consumed by the watcher, not by those plans, so they're independent of Plan 03.

**Watcher behavior verified by construction:**

`src/config/watcher.ts` consumes the differ output via `c.reloadable` and emits the appropriate notification. No code changes to the watcher were necessary. The Phase 22 contract on `reloadable=false` is already correct: the watcher writes the change to the audit log and signals "agent restart needed" — the operator (or CI runbook) is responsible for invoking `clawcode restart`.

---
*Phase: 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow*
*Plan: 03*
*Completed: 2026-04-26*

## Self-Check: PASSED

- ✓ src/config/types.ts FOUND
- ✓ src/config/__tests__/differ.test.ts FOUND
- ✓ commit d654b09 (RED) FOUND
- ✓ commit f436c83 (GREEN) FOUND
- ✓ All 8 Phase 100 differ tests pass GREEN (DI1..DI8)
- ✓ All 27 differ tests pass without regressions (19 prior + 8 new)
- ✓ Zero new tsc errors caused by Plan 03 (101 baseline = 101 with changes)
- ✓ Zero new test failures introduced (3 pre-existing schema-system-prompt-directives failures unchanged from baseline)
- ✓ NON_RELOADABLE_FIELDS contains 6 explicit Phase 100 entries (verified via grep)
- ✓ RELOADABLE_FIELDS does NOT contain Phase 100 entries (DI8 regression pin)
- ✓ Phase 100 GSD-07 cited in 2 places (RELOADABLE hint + NON_RELOADABLE rationale)
- ✓ src/config/watcher.ts intentionally NOT modified (per plan)
</content>
</invoke>