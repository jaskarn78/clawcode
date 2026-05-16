---
phase: 115-memory-context-prompt-cache-redesign
plan: 09
subsystem: closeout
tags: [cross-agent-coordinator, dashboard, perf-comparison, sub-scope-6b-gate, sub-scope-12, sub-scope-16c]

# Dependency graph
requires:
  - phase: 115-00
    provides: scripts/bench/115-perf.ts + baseline-pre-115.md
  - phase: 115-02
    provides: consolidation-runs.jsonl + tier1_inject_chars/budget_pct columns + prompt-bloat classifier
  - phase: 115-05
    provides: lazy_recall_call_count column + clawcode_memory_* tools
  - phase: 115-07
    provides: tool_cache_hit_rate / tool_cache_size_mb dashboard wiring pattern
  - phase: 115-08
    provides: wave-2-checkpoint.md skeleton + tool-latency-audit CLI + getSplitLatencyAggregate / computeToolUseRatePerTurn helpers
provides:
  - Cross-agent coordinator (`CrossAgentCoordinator`) wrapping multi-agent memory writes with `consolidation:<runId>` tagging + rollback semantics
  - Sub-scope 6-B gate decision artifact (PENDING-OPERATOR → de-facto DEFER; routes to Phase 116)
  - `clawcode perf-comparison` CLI — closeout receipt printer
  - Dashboard surface for tier1 / lazy_recall / prompt_bloat metrics (sub-scope 16c)
  - `getPhase115DashboardMetrics` trace-store aggregator
  - `post-115-comparison.md` closeout receipt structure
affects: [phase-116, future-fleet-orchestration, future-priority-dream-pass]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-agent coordinator pattern (CrossAgentCoordinator class wraps per-agent MemoryStore writes with run-id tagging + rollback)"
    - "Closeout-receipt CLI pattern (clawcode perf-comparison reads static markdown artifacts; works without daemon)"
    - "Gate-decision-as-artifact pattern (sub-scope-6b-decision.md is a grep-stable token-bearing markdown file)"
    - "Dashboard-surface aggregator pattern (mirror getToolCacheTelemetry shape: latest tier1_* / SUM lazy_recall + prompt_bloat)"

key-files:
  created:
    - .planning/phases/115-memory-context-prompt-cache-redesign/perf-comparisons/sub-scope-6b-decision.md
    - .planning/phases/115-memory-context-prompt-cache-redesign/perf-comparisons/post-115-comparison.md
    - src/cli/commands/perf-comparison.ts
    - src/manager/cross-agent-coordinator.ts
    - src/manager/cross-agent-coordinator.types.ts
    - src/manager/__tests__/cross-agent-coordinator.test.ts
    - src/performance/__tests__/trace-store-dashboard-metrics.test.ts
  modified:
    - src/cli/index.ts (registered perf-comparison command)
    - src/dashboard/static/app.js (3 new subtitle lines for tier1/lazy_recall/prompt_bloat)
    - src/manager/daemon.ts (computeSplitLatencyFields extended with phase115 fields)
    - src/memory/consolidation.ts (re-exports CrossAgentCoordinator + types)
    - src/performance/trace-store.ts (getPhase115DashboardMetrics aggregator)

key-decisions:
  - "Sub-scope 6-B: PENDING-OPERATOR → de-facto DEFER. wave-2-checkpoint.md is a skeleton with no production data; honest gate input does not exist; routes to Phase 116 once operator runs the audit CLI post-deploy."
  - "Cross-agent coordinator built as new abstraction (not retrofit into runConsolidation). Per-agent path preserved verbatim; coordinator wraps fleet-level orchestration when a future caller needs multi-agent atomic-batch semantics."
  - "Rollback policy: NOT auto-applied on partial failure. Operator decides whether to rollback or accept partial state and re-run only failed agent. Per CONTEXT D-10 three-tier policy."
  - "Dashboard fields rendered with NULL-graceful fallback ('no signal yet (115-XX writes pending)') instead of '—' so operators see WHY a metric is empty."
  - "Trace segments stay byte-identical (per ROADMAP line 877) — sub-scope 16(c) adds new SUBTITLE lines, doesn't rename or remove existing rows. Historical SLO comparisons against trace data continue to work."
  - "Post-115-comparison.md numeric cells = (operator-run) placeholders. Structure (acceptance criteria, fold-ins, backups, sub-scope 6-B status) is the durable record."
  - "Files modified deviated from plan frontmatter: T03 SHIP-only files (haiku-direct-fastpath.ts / turn-dispatcher.ts edits / config schema flag) intentionally NOT created per T01 DEFER. T04 added daemon.ts + trace-store.ts modifications because dashboard render needed server-side aggregation infrastructure."

patterns-established:
  - "Gate decision as durable markdown artifact: sub-scope-6b-decision.md carries SHIP/DEFER/PENDING-OPERATOR token + threshold + rationale. Phase 116 reads same file; tokens stay grep-stable across plan executions."
  - "Cross-agent coordinator: standalone class with `runBatch(batch)` + `rollback(runId, agents)`. Audit trail via existing `consolidation-runs.jsonl` (started → completed/failed → rolled-back). Per-agent atomicity via MemoryStore.insert's db.transaction (Phase 107 invariant); cross-agent atomicity via discriminated-union status + explicit rollback call."
  - "Closeout report receipts: 4-file evidentiary record (baseline + checkpoint + decision + comparison) covers 'broken state → mid-phase → gate decision → final results'. Each file grep-stable for its acceptance tokens."
  - "Dashboard panel additions: extend the cache panel's subtitle line rendering with NULL-graceful fallback. New aggregator on TraceStore mirrors getToolCacheTelemetry's shape (latest non-NULL for state metrics, SUM for event counts)."

requirements-completed: []  # Plan frontmatter has requirements: []; phase 115 has no REQUIREMENTS.md entries to mark.

# Metrics
duration: 28min
completed: 2026-05-08
---

# Phase 115 Plan 09: Closeout — cross-agent transactionality, dashboard surface, sub-scope 6-B gate, perf-comparison receipt Summary

**Cross-agent coordinator with run-id rollback (sub-scope 12), three new dashboard subtitle lines for tier1 / lazy_recall / prompt_bloat (sub-scope 16c), sub-scope 6-B gated DEFER → Phase 116, four-file perf-comparisons evidentiary record locked.**

## Performance

- **Duration:** ~28 min
- **Started:** 2026-05-08T07:51:00Z (approx — first commit at 07:51)
- **Completed:** 2026-05-08T08:03:00Z (approx — last commit at 08:02)
- **Tasks:** 5 (T01, T02, T04, T05 executed; T03 intentionally skipped per T01 DEFER decision)
- **Files modified:** 12 (7 created, 5 modified)

## Accomplishments

- **Sub-scope 6-B gate decision recorded** as durable markdown artifact at `.planning/phases/115-*/perf-comparisons/sub-scope-6b-decision.md`. Decision: PENDING-OPERATOR → de-facto DEFER; Phase 116 carries 6-B forward when operator runs `clawcode tool-latency-audit --json --window-hours 24` post-deploy.
- **`clawcode perf-comparison` CLI** registered at `src/cli/commands/perf-comparison.ts`. Reads all four perf-comparisons artifacts + extracts SHIP/DEFER/PENDING-OPERATOR token. JSON mode for scripting. Works without daemon — pure file-read.
- **CrossAgentCoordinator** at `src/manager/cross-agent-coordinator.ts` + types — fleet-level abstraction wrapping multi-agent memory writes with `consolidation:<runId>` tagging + rollback semantics. 8 vitest cases including 3-agent batch success, partial-failed (broken store throws), rollback (delete by tag), idempotent rollback, missing-store fallback, tagged-trace invariant, auto-runId, missing-store treated as per-agent failure. Audit trail via existing `consolidation-runs.jsonl` log.
- **Dashboard surface for sub-scope 16(c)** — three new subtitle lines added to per-agent cache panel rendering tier1_inject_chars + tier1_budget_pct ('near cap' warning when >90%), lazy_recall_call_count (24h sum), prompt_bloat_warnings_24h. NULL-graceful fallback ('no signal yet (115-XX writes pending)') for newly-deployed builds. Trace segments stay byte-identical; layout extends, doesn't replace.
- **`getPhase115DashboardMetrics` aggregator** on TraceStore — single SELECT computes latest tier1_* (most-recent non-NULL row) + SUM lazy_recall / prompt_bloat over the window. Mirrors getToolCacheTelemetry's NULL-bubble pattern. 7 vitest cases covering empty-window, latest-not-oldest, SUM aggregation, agent isolation, window isolation, NULL-only fallback, frozen result.
- **Phase 115 closeout receipt** at `.planning/phases/115-*/perf-comparisons/post-115-comparison.md`. All 6 perf targets, all 7 ROADMAP acceptance criteria (AC-01 through AC-07), backups list (do not GC), phase fold-in status (999.40 SUPERSEDED, 999.41 carve-out absorbed, 999.42 FTS5/tier parts absorbed), Ramy gate honored throughout.

## Task Commits

Each task was committed atomically:

1. **Task 1: Sub-scope 6-B gate decision (PENDING-OPERATOR → DEFER) + perf-comparison CLI** — `a340004` (feat)
2. **Task 2: Sub-scope 12 cross-agent consolidation transactionality** — `5c2adb9` (feat)
3. **Task 3: SKIPPED — sub-scope 6-B implementation deferred to Phase 116** (no commit; documented in T01 + T05)
4. **Task 4: Sub-scope 16(c) dashboard surface for tier1 / lazy_recall / prompt_bloat metrics** — `cb135f6` (feat)
4b. **Task 4 fixup: TurnStatus 'ok' → 'success' literal (Rule 1 self-fix)** — `53a3201` (fix)
5. **Task 5: Phase-115 closeout — post-115-comparison.md receipt** — `1148d79` (docs)

**Plan metadata:** (final commit lands SUMMARY.md + STATE.md + ROADMAP.md updates)

## Files Created/Modified

### Created
- `.planning/phases/115-memory-context-prompt-cache-redesign/perf-comparisons/sub-scope-6b-decision.md` — gate decision artifact (PENDING-OPERATOR → DEFER) with Phase 116 punt path
- `.planning/phases/115-memory-context-prompt-cache-redesign/perf-comparisons/post-115-comparison.md` — closeout receipt (6 perf targets, 7 acceptance criteria, backups, fold-ins)
- `src/cli/commands/perf-comparison.ts` — `clawcode perf-comparison` CLI (reads 4 artifacts + extracts gate decision; JSON mode for scripting)
- `src/manager/cross-agent-coordinator.ts` — `CrossAgentCoordinator` class (`runBatch`, `rollback`, `applyOneAgentSlice`, `consolidationRunTag`)
- `src/manager/cross-agent-coordinator.types.ts` — types (`CrossAgentBatch`, `CrossAgentBatchWrite`, `CrossAgentBatchStatus` discriminated union, `CONSOLIDATION_RUN_TAG_PREFIX`)
- `src/manager/__tests__/cross-agent-coordinator.test.ts` — 8 cases covering all status branches + rollback semantics
- `src/performance/__tests__/trace-store-dashboard-metrics.test.ts` — 7 cases for `getPhase115DashboardMetrics`

### Modified
- `src/cli/index.ts` — registered `registerPerfComparisonCommand` next to tool-latency-audit
- `src/dashboard/static/app.js` — three new cache-panel subtitle lines (tier1, lazy recall, prompt bloat) with NULL-graceful fallback
- `src/manager/daemon.ts` — `computeSplitLatencyFields` extended with `tier1_inject_chars` / `tier1_budget_pct` / `lazy_recall_call_count` / `prompt_bloat_warnings_24h` fields on the `case "cache"` report
- `src/memory/consolidation.ts` — re-exports `CrossAgentCoordinator` + types so callers wanting the cross-agent surface import from one module; doc-comment on `runConsolidation` cross-references the coordinator
- `src/performance/trace-store.ts` — new `getPhase115DashboardMetrics(agent, sinceIso)` aggregator (single SELECT; latest tier1_* + SUM lazy_recall / prompt_bloat)

## Decisions Made

See `key-decisions` in frontmatter. Key picks:

1. **6-B = DEFER, not SHIP.** wave-2-checkpoint.md is a skeleton (no production data). Stamping SHIP would mean creating a new auth code path on unmeasured assumptions. Cost of wrong-direction SHIP non-trivial (OAuth bearer plumbing, routing decision, second auth path to maintain). Cost of wrong-direction DEFER is a no-op. Asymmetric → DEFER until measurement.

2. **Coordinator is new abstraction, not retrofit.** `runConsolidation` is per-agent (called from daemon's per-agent cron loop). The 2026-05-07 admin-clawdy partial-failure happened across the per-agent loop, not inside it. Coordinator wraps fleet-level orchestration; per-agent path preserved verbatim. Re-export from `consolidation.ts` keeps both surfaces co-located.

3. **Manual rollback, not automatic.** When a fleet batch is `partial-failed`, the operator may prefer to keep partial state and re-run only the failed agent (CONTEXT D-10 three-tier policy). Auto-rollback would obliterate the operator's choice. Coordinator returns `partial-failed` status with explicit `rollback(runId, agents)` API for the human-decision path.

4. **Dashboard fields render 'no signal yet (115-XX writes pending)' instead of plain '—'.** On a freshly-deployed build, the 115-02 writers may not have fired yet; operators need to know WHY the panel is empty (writers pending vs no data vs daemon broken). Cleaner mental model.

5. **Closeout receipt = structure + tokens FINAL, numbers operator-run.** Phase 115 ships code only; production deploy is operator-confirmed (CLAUDE.md gates). Numeric cells = `(operator-run)` placeholders. The structure (6 perf targets, 7 acceptance criteria, backups, fold-ins, 6-B status) is the durable record regardless of deploy timing.

## Deviations from Plan

### Auto-applied (Rule 1-3) deviations

**1. [Rule 1 - Bug] TurnStatus literal mismatch in self-authored test fixture**
- **Found during:** Task 4 (final tsc check)
- **Issue:** `trace-store-dashboard-metrics.test.ts` used `status: "ok"` in test fixtures; `TurnStatus = "success" | "error"` per `src/performance/types.ts:16`. Vitest didn't validate at runtime (no Zod) so test passed; `npx tsc --noEmit` over the full project caught it.
- **Fix:** Changed `status: "ok"` → `status: "success"` in the `turn()` factory.
- **Files modified:** `src/performance/__tests__/trace-store-dashboard-metrics.test.ts`
- **Verification:** `npx tsc --noEmit` exits 0; new test still 7/7 passes.
- **Committed in:** `53a3201` (separate fix commit landing on top of T04)

### Plan-anticipated branch deviations (NOT auto-fix; conditional behavior baked into the plan itself)

**2. [Plan branch] Task 3 SHIP-branch files NOT created (DEFER branch executed)**
- **Found during:** Task 1 (gate decision read of wave-2-checkpoint.md)
- **Plan anticipated:** Task 3 has BRANCH A (SHIP — create haiku-direct-fastpath.ts + turn-dispatcher routing edit + config schema flag) AND BRANCH B (DEFER — write punt path; skip A1-A4). Plan explicitly says *"DECISION POINT for executor: Read T01's output. Run BRANCH A or BRANCH B accordingly."*
- **Decision:** BRANCH B (DEFER) per T01 PENDING-OPERATOR finding.
- **Files NOT modified (correctly):** `src/manager/haiku-direct-fastpath.ts` (not created), `src/manager/turn-dispatcher.ts`, `src/manager/session-manager.ts`, `src/config/schema.ts`, `src/manager/__tests__/haiku-direct-fastpath-gate.test.ts` (not created).
- **Files modified that ARE in T03 BRANCH B scope:** `sub-scope-6b-decision.md` carries `## Punt path` section with Phase 116 inputs + trigger conditions (acceptance criterion: `grep -c "Phase 116|punt|DEFERRED"` ≥2 → returns 10).
- **Committed in:** `a340004` (T01 commit folds T03 BRANCH B's documentation work).

**3. [Rule 2 - Critical infrastructure] T04 daemon.ts + trace-store.ts modifications not in plan frontmatter `files_modified`**
- **Found during:** Task 4 (dashboard render planning)
- **Issue:** Plan frontmatter listed only client-side files (`src/dashboard/static/app.js`, `index.html`). But the dashboard render needs server-side aggregation — the `report` object reaches `app.js` from the daemon's `case "cache"` IPC handler. Without a server-side aggregator the new fields would render NULL forever.
- **Fix:** Added `getPhase115DashboardMetrics` aggregator on `TraceStore` (mirrors `getToolCacheTelemetry`); extended daemon's `computeSplitLatencyFields` helper (115-08 pattern) to fold the four new fields onto the existing cache report. No new IPC route needed.
- **Files modified:** `src/performance/trace-store.ts`, `src/manager/daemon.ts` (T04 commit `cb135f6`).
- **Verification:** new `getPhase115DashboardMetrics` test 7/7 pass; existing trace-store 42/42 still pass; `npm run build` clean.
- **Why critical:** without this, sub-scope 16(c) ships dashboard rendering code that has NO data source — would have looked complete to grep but rendered empty in production. Rule 2 (required for sub-scope 16(c) to actually surface data).

---

**Total deviations:** 1 auto-fix (Rule 1) + 2 plan-branch / Rule-2 deviations.
**Impact on plan:** All deviations support the plan's stated outcomes. T03 DEFER is the conditional path the plan explicitly anticipated. T04 server-side aggregation is required for the dashboard render to function. T04 fixup is a self-authored typo. No scope creep.

## Issues Encountered

- **Test failure: frozen-array `.sort()` in T02.** Initial test called `rb.reverted.sort()` on a frozen readonly array. Fix: `[...rb.reverted].sort()`. One iteration; 8/8 passed afterward.
- **TS literal mismatch in T04 test fixture.** Documented above as Rule 1 deviation. One iteration; resolved.
- **Existing dirty-tree files left intact.** Pre-existing modified files (`.planning/milestones/v2.2-skills-migration-report.md`, `package-lock.json`, `package.json`, `src/manager/session-adapter.ts`, `src/usage/budget.ts`) and untracked artifacts in `.planning/phases/110-*` and `.planning/phases/999.*` were NOT in scope for this plan — left as-is per advisor guidance + rule "stage files individually, never `git add .`/-A". They will be cleaned up by other workflows.

## Known Stubs

None — placeholder behavior is intentional and documented:
- **`(operator-run)` cells in post-115-comparison.md** are documented operator-fill points. Closeout plan ships code; production deploy + benchmark are operator-confirmed (CLAUDE.md `feedback_no_auto_deploy` + `feedback_ramy_active_no_deploy`). Per-agent table in baseline-pre-115.md uses the same pattern (`_PENDING_`).
- **`no signal yet (115-XX writes pending)` dashboard renders** are documented graceful-fallback for freshly-deployed builds where 115-02 / 115-05 writers haven't fired yet. Renders the writer-source phase number so operators see WHY the panel is empty.

Both behaviors are intentional and not blocking the closeout plan. The phase reaches "code complete," not "shipped"; operator deploys gate the actual measurement.

## User Setup Required

None for this plan. Operator action AFTER the plan ships is documented in `post-115-comparison.md`:
1. Operator runs `scripts/deploy-clawdy.sh` during a Ramy-quiet window (with explicit "deploy" / "ship it" in same turn).
2. After 24h soak, operator runs `clawcode tool-latency-audit --json --window-hours 24` and pastes results into `wave-2-checkpoint.md`.
3. If non-fin-acq fleet avg < 30%, operator opens Phase 116 to ship sub-scope 6-B.
4. Operator runs `scripts/bench/115-perf.ts` per-agent × scenario and fills `post-115-comparison.md` numeric cells.
5. Acceptance criteria AC-01 through AC-07 verified live on running daemon.

## Next Phase Readiness

- **Code complete for phase 115.** All 10 plans (115-00 through 115-09) shipped.
- **Awaiting operator deploy.** Production deploy is the next gate. Migration timeline (Plan 115-06) starts post-deploy.
- **Phase 116 staged for sub-scope 6-B follow-on.** Inputs documented in `sub-scope-6b-decision.md` Phase 116 reference section.
- **No blockers from this plan.** All tests green, TS clean, build clean.

## Self-Check: PASSED

Verified:
- Created files exist:
  - `.planning/phases/115-memory-context-prompt-cache-redesign/perf-comparisons/sub-scope-6b-decision.md` ✓
  - `.planning/phases/115-memory-context-prompt-cache-redesign/perf-comparisons/post-115-comparison.md` ✓
  - `src/cli/commands/perf-comparison.ts` ✓
  - `src/manager/cross-agent-coordinator.ts` ✓
  - `src/manager/cross-agent-coordinator.types.ts` ✓
  - `src/manager/__tests__/cross-agent-coordinator.test.ts` ✓
  - `src/performance/__tests__/trace-store-dashboard-metrics.test.ts` ✓
- Commits exist: `a340004` (T01), `5c2adb9` (T02), `cb135f6` (T04), `53a3201` (T04 fixup), `1148d79` (T05) all confirmed in `git log --oneline -6` ✓
- T03 file does NOT exist: `src/manager/haiku-direct-fastpath.ts` — confirmed absent ✓
- All grep acceptance checks pass (T01: 30%/0.30/0.3, SHIP/DEFER, fin-acquisition; T02: CrossAgentCoordinator 5×, consolidation: 4×, appendConsolidationRun 5×; T04: tier1_inject_chars 8×, lazy_recall 3×, prompt_bloat 3×, end_to_end+first_token+context_assemble+tool_call 4+; T05: Ramy gate 3×, 6 perf targets 6×, AC-01..AC-07 8×, backups 4×, fold-ins 999.40/41/42 referenced) ✓
- `npx tsc --noEmit` exit=0 ✓
- `npm run build` exit=0 ✓
- New tests: cross-agent-coordinator 8/8, trace-store-dashboard-metrics 7/7 ✓
- Existing tests: trace-store 42/42, consolidation 38/38 ✓
- `clawcode perf-comparison --help` exit=0 ✓
- All 4 perf-comparisons artifacts present ✓

---
*Phase: 115-memory-context-prompt-cache-redesign*
*Plan: 09 (closeout)*
*Completed: 2026-05-08*
