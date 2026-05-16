# Phase 120: Dashboard Observability Cleanup — Context

**Gathered:** 2026-05-14
**Status:** Ready for planning
**Mode:** Auto-discuss — Phase 119 pattern (auto-decisions locked from ROADMAP + REQUIREMENTS; downstream planner may surface counter-evidence and replan).

<canonical_refs>
## Canonical References (MANDATORY)

| Ref | Why | Path |
|-----|-----|------|
| ROADMAP entry | Phase boundary, 5 success criteria, sequencing note | `.planning/ROADMAP.md` §"Phase Details — v2.9" / Phase 120 |
| REQUIREMENTS DASH-01..05 | Traceability + merge notes (999.49, 999.7 follow-ups) | `.planning/REQUIREMENTS.md` §"DASH · Dashboard Backend Observability Cleanup" |
| Phase 116 dashboard surface | Owning phase for BenchmarksView, the surface DASH-01..03 fix | `.planning/phases/116-dashboard-redesign-modern-ui-mobile-first-basic-advanced-modes-in-ui-config-editor-conversations-view-task-assignment-folds-99938/` |
| Phase 106 hotfix `fa72303` | CLI Invalid Request fix that DASH-05 verifies end-to-end | git: `git show fa72303 -- src/cli/commands/tool-latency-audit.ts` |
| Phase 999.7 follow-ups | Split-latency producer regression context (DASH-04) | `.planning/phases/999.7-context-audit-telemetry-pipeline-restoration-tool-call-latency/` (no_directory yet — context in commit history) |
| BenchmarksView | Frontend target for DASH-01..03 | `src/dashboard/views/BenchmarksView.tsx` (or sibling — confirm via grep) |
| `tool-latency-audit` CLI | Target for DASH-05 verification | `src/cli/commands/tool-latency-audit.ts` |
| `persistent-session-handle.ts` | Canonical split-latency producer (DASH-04 — pin THIS, NOT `session-adapter.ts`) | `src/manager/persistent-session-handle.ts` |
| `feedback_silent_path_bifurcation.md` | Anti-pattern — DASH-04 is a Phase-115-08-class regression sentinel | memory |
</canonical_refs>

<domain>
## Phase Boundary

Five operator-flagged regressions in the post-Phase-116 Benchmarks tab. All sit on the dashboard observability surface (BenchmarksView frontend + fleet-stats endpoint + trace-spans SQL + `tool-latency-audit` CLI). Bundled because they share the tab, share a single deploy, and three of them (DASH-01..03) live in the same React component.

### DASH-01 — Tool rollup blank-name rows
Tool names render blank for some agents — particularly those whose display name contains a space ("Admin Clawdy"). Underlying span data exists; the join/group-by path drops names. Two root causes per 999.49: (1) SQL `LENGTH(name) <= 11` guard misfires on long-prefixed tool names; (2) IPC string binding loses space-bearing names. Pattern A absence-bug.

### DASH-02 — Null percentiles render as red breach
Cells where the percentile is NULL (no data) render with `text-danger` styling — the same red as true SLO breaches. Operator can't distinguish "metric is broken" from "metric is bad." Fix: NULL → neutral `text-fg-3` with "—" label. Static-grep regression test pins the rule.

### DASH-03 — Empty rollup table renders row of nulls
When an agent has zero spans in the window, the table renders a row of NULL cells instead of an explicit empty-state message. Pure UX hygiene.

### DASH-04 — Split-latency producer regression (Phase 115-08-class)
[RECONCILED 2026-05-14] Original framing named `prep_latency_ms`,
`tool_latency_ms`, `model_latency_ms` — those columns do not exist in
`src/`. Real schema (`trace-store.ts:846`) has `tool_execution_ms`,
`tool_roundtrip_ms`, `parallel_tool_call_count` (Phase 115-08 columns,
written by `Turn.addToolExecutionMs` etc. from `persistent-session-handle.ts:iterateUntilResult`).
The silent-path-bifurcation regression sentinel still applies and has
shipped (Plan 03, commit `ba33aa9`): `session-adapter.ts:iterateWithTracing`
is barred from production paths. A separate `addToolExecutionMs`-gating
regression (139 post-deploy traces with tool spans but NULL `tool_execution_ms`,
vs 93 populated) surfaced during reconciliation — deferred as architectural
(see `120-DIAGNOSTIC.md` §"DASH-04 disambiguation"). Plan 03 ships the
sentinel; the gating fix is out of Phase 120 scope.

### DASH-05 — `clawcode tool-latency-audit` CLI verification
Phase 106 hotfix `fa72303` fixed an "Invalid Request" error. DASH-05 closes the loop: verify the CLI exits 0 with valid JSON against a non-empty trace window on clawdy.
</domain>

<decisions>
## Implementation Decisions

### D-01 — Diagnostic SQL FIRST, code SECOND (per ROADMAP sequencing note)
Before writing any fix code, run on clawdy production:
```sql
SELECT name, COUNT(*) FROM trace_spans
WHERE name LIKE 'tool_call.%' AND LENGTH(name) <= 11
GROUP BY name;
```
Captured result lands in the phase verification artifact (`120-DIAGNOSTIC.md`) BEFORE any plan executes. This localizes DASH-01's root cause (empty-name emitter vs IPC space-binding vs frontend null-styling). Three plans CAN run in parallel after diagnostic if SQL confirms; if SQL surfaces unexpected pattern, replan.

### D-02 — Three frontend fixes (DASH-01/02/03) ship as one PLAN, one deploy
Same component (`BenchmarksView.tsx` or sibling), same render-path, same machine cycle tests all three. Mirror the Phase 999.36 bundle pattern.

### D-03 — DASH-04 ships SEPARATELY with a static-grep regression test
[RECONCILED 2026-05-14] The static-grep test is the anti-pattern prevention
mechanism per `feedback_silent_path_bifurcation`. It asserts that no
production-path file references `session-adapter.ts:iterateWithTracing`
(test fixture only). The pinned canonical producer is
`persistent-session-handle.ts:iterateUntilResult` which writes the Phase
115-08 columns `tool_execution_ms`, `tool_roundtrip_ms`,
`parallel_tool_call_count` (NOT `prep_latency_ms` / `tool_latency_ms` /
`model_latency_ms` — those names never existed in `src/`). The sentinel
prevents a future commit from silently bifurcating; the canonical-name
correctness is a separate concern owned by the deferred follow-up phase.

### D-04 — DASH-05 is verification-only, no new code
Phase 106 hotfix already shipped. Phase 120 just captures the verification artifact: invoke the CLI on clawdy against a non-empty window, assert exit 0 + valid JSON, attach output to phase verification.

### D-05 — Null styling: single utility, applied universally
Create one `percentileCell({value, isBreach})` utility that returns `<td className={isBreach ? 'text-danger' : value === null ? 'text-fg-3' : 'text-fg-1'}>{value ?? '—'}</td>`. Every percentile renderer (BenchmarksView, sibling tiles) uses this utility — no per-site styling. Static-grep regression: any `text-danger` applied to a value-could-be-null path fails the test.

### D-06 — Empty-state message is a string literal, no i18n
"No tool spans recorded in window" — exactly that string. No translation, no template — operator-facing only. The string IS the assertion (text-match test).

### D-07 — Wave structure
- **Wave 1 (parallel):** 120-01 (diagnostic SQL run + capture) — blocks all others until result lands.
- **Wave 2 (parallel after Wave 1):** 120-02 (DASH-01..03 frontend bundle), 120-03 (DASH-04 producer pin + static-grep test), 120-04 (DASH-05 verification artifact).

### D-08 — No new abstractions for "dashboard observability"
The temptation: build a `MetricCell` framework. Rejected — DASH-01..03 fix existing rendering, not invent a new framework. Future polish can extract. This phase is hygiene, not architecture.

### D-09 — Deploy hold continues
Ramy active. Code commits + local tests, no deploy. DASH-05 verification (CLI exit 0 on clawdy) deferred to operator-cleared deploy window.

### D-10 — Static-grep tests pin behaviors, not implementation
DASH-02 + DASH-04 both ship with static-grep tests (grep CI assertions). Pattern: a node test that `grep`s the codebase for a forbidden pattern (e.g., `text-danger` on a null-path, or `iterateWithTracing` outside test files) and fails the suite if found.
</decisions>

<code_context>
## Existing Code Insights

- **`src/dashboard/views/BenchmarksView.tsx`** — DASH-01/02/03 frontend target. Probable location of the tool rollup table + percentile cells. (Confirm via `find src -name "BenchmarksView*"`.)
- **`src/manager/persistent-session-handle.ts`** — canonical split-latency writer (DASH-04 target). The function `iterateUntilResult` writes `prep_latency_ms` / `tool_latency_ms` / `model_latency_ms` rows. This must be the production path.
- **`src/manager/session-adapter.ts`** — test-only `iterateWithTracing`. MUST NOT be the production path (DASH-04 regression).
- **`src/cli/commands/tool-latency-audit.ts`** — DASH-05 target. Phase 106 `fa72303` hotfix lives here.
- **Trace span SQL helpers** — likely under `src/manager/trace-spans/` or `src/storage/`. Confirm via grep on `LENGTH(name) <= 11` or similar guards.

## Reusable Patterns

- Phase 119's static-grep regression pattern (Plan 01 T-01 D-09 anti-pattern enforcement) — reuse for DASH-04 + DASH-02.
- Phase 999.36's bundle pattern (multiple fixes, one PLAN, one deploy when surface is the same) — reuse for D-02.
- Phase 106 hotfix verification pattern (CLI exit-code + JSON-schema validate) — reuse for DASH-05.
</code_context>

<specifics>
## Specific Requirements

- DASH-04's static-grep test is non-negotiable per ROADMAP success criterion 4 (`Pattern A: 115-08-class regression sentinel`). The test prevents a future commit from silently switching producers again.
- DASH-05 must verify against a non-empty trace window. If the trace window is empty at verification time, wait for live traffic to accumulate (or synthetic trigger) — do NOT report PASS against empty data.
- All percentile cells are checked, not just the obvious ones. The static-grep test covers every `text-danger` use across `src/dashboard/`.
</specifics>

<deferred>
## Deferred Ideas

- **`MetricCell` framework abstraction** — see D-08. Defer until a third dashboard view needs identical percentile-cell behavior.
- **Tool-rollup performance pass** — if the GROUP BY query is slow on large windows, optimize separately. Out of scope.
- **Per-agent SLO threshold editor** — Phase 999.38 territory, not Phase 120.
- **Dashboard mobile-responsive polish** — Phase 116 owns this.
</deferred>
