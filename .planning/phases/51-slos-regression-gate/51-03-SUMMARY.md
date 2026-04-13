---
phase: 51-slos-regression-gate
plan: 03
subsystem: performance
tags: [slo, dashboard, ci, regression-gate, bench-workflow, ipc-augmentation]

# Dependency graph
requires:
  - phase: 51-01
    provides: DEFAULT_SLOS, evaluateSloStatus, mergeSloOverrides, ResolvedAgentConfig.perf.slos? TS mirror, loadThresholds
  - phase: 51-02
    provides: bench CLI (`clawcode bench`), bench-run-prompt IPC method, loadPrompts, runBench
  - phase: 50-03
    provides: dashboard `/api/agents/:name/latency` REST passthrough + Latency panel
provides:
  - augmentWithSloStatus(segments, agentSlos?) — exported from daemon.ts; merges DEFAULT_SLOS with per-agent perf.slos? and returns frozen PercentileRow[] carrying slo_status, slo_threshold_ms, slo_metric per row
  - PercentileRow extended with 3 optional SLO fields (slo_status, slo_threshold_ms, slo_metric); SloStatus + SloMetric moved into src/performance/types.ts to break circular import
  - Dashboard Latency panel: cell coloring (cyan healthy / red breach / gray no_data) + "SLO target" subtitle — BOTH driven by server-emitted fields so per-agent perf.slos? overrides surface in color AND text
  - .planning/benchmarks/prompts.yaml (5 prompts) + thresholds.yaml (20% default, context_assemble floor, tool_call 25%) + README.md
  - .github/workflows/bench.yml — CI regression gate invoking `clawcode bench --check-regression`; permissive during rollout (warn+pass on missing baseline or missing secret)
affects: []

# Tech tracking
tech-stack:
  added: []  # Zero new runtime dependencies
  patterns:
    - "Server-emitted SLO thresholds + metrics — dashboard has NO client-side threshold mirror. Per-agent perf.slos? overrides merged in daemon.ts; dashboard reads row.slo_threshold_ms + row.slo_metric and renders. Color and subtitle never drift."
    - "SloStatus + SloMetric live in types.ts (not slos.ts) so PercentileRow can reference them without a circular import. slos.ts re-exports the two types for callers that already import from there."
    - "augmentWithSloStatus is pure + exported from daemon.ts — unit-tested in isolation with 7 behavioral tests; wired into BOTH fleet (--all) and single-agent branches of case `latency`."
    - "Permissive CI rollout: bench.yml warns-and-passes (exit 0) when baseline.json is absent OR ANTHROPIC_API_KEY is unset. Gate becomes strict once a baseline is committed and the secret is wired."
    - "Absolute-floor escape hatch for noisy segments: context_assemble requires BOTH 30% spike AND >=100ms absolute delta before flagging; tool_call gets 25% percentage-only headroom."

key-files:
  created:
    - src/manager/__tests__/daemon-latency-slo.test.ts
    - .planning/benchmarks/prompts.yaml
    - .planning/benchmarks/thresholds.yaml
    - .planning/benchmarks/README.md
    - .github/workflows/bench.yml
  modified:
    - src/performance/types.ts  # Moved SloStatus + SloMetric here; added 3 optional fields to PercentileRow
    - src/performance/slos.ts   # Re-exports SloStatus + SloMetric from types.ts
    - src/manager/daemon.ts     # augmentWithSloStatus helper + wired into both latency branches
    - src/dashboard/__tests__/server.test.ts  # Fixture + regression assertion for slo_threshold_ms/slo_metric
    - src/dashboard/static/app.js             # sloCellClass helper + row rendering reads server-emitted SLO fields
    - src/dashboard/static/styles.css         # 4 new classes (healthy/breach/no-data/subtitle)
    - .gitignore                              # Appended .planning/benchmarks/reports/

key-decisions:
  - "Phase 51 Plan 03 — Move SloStatus + SloMetric from slos.ts to types.ts. This is the right home because PercentileRow (in types.ts) now references them; re-exporting from slos.ts keeps existing imports working. No behavior change, confirmed by slos.test.ts still GREEN (Plan 51-01's 7 tests)."
  - "Phase 51 Plan 03 — Daemon emits slo_threshold_ms + slo_metric alongside slo_status. This resolves plan-checker WARNING 2: a client-side SLO_LABELS constant would hardcode the defaults and drift from per-agent overrides. By emitting the merged threshold the server produces a single source of truth end-to-end; the dashboard subtitle ('SLO target: 4,000 ms p95') and the cell color (red or cyan vs 4,000ms) can never disagree."
  - "Phase 51 Plan 03 — augmentWithSloStatus is exported from daemon.ts (not a helper in slos.ts) because it depends on PercentileRow producer shape + the daemon's closure-scope agentConfig resolution. Keeping the pure mapping in daemon.ts co-locates it with its only call site AND lets unit tests import it directly without spawning a daemon."
  - "Phase 51 Plan 03 — Unknown segments (future additions not in DEFAULT_SLOS) pass through augmentWithSloStatus with slo_threshold_ms: null + slo_metric: null + slo_status UNSET. The dashboard falls back to latency-cell-no-data styling and omits the subtitle. This makes the pipeline forward-compatible; a new canonical segment can land in Phase 52+ without a schema break."
  - "Phase 51 Plan 03 — CI permissive rollout: bench.yml warns-and-passes on missing baseline.json OR missing ANTHROPIC_API_KEY. Strict gating kicks in automatically once both are in place. Alternative (hard-fail from day one) would block fork PRs that don't have access to the secret."
  - "Phase 51 Plan 03 — Dashboard tints ONLY the SLO-metric cell (identified by row.slo_metric). Tinting all 3 percentile columns would dilute the signal; the operator's attention should land on the one metric the SLO actually watches."

patterns-established:
  - "Pattern: Server-shape augmentation over client-side mirroring — when a constant needs per-agent overrides, emit the resolved value from the server response so the client is a dumb renderer. Used for SLO thresholds here; reusable for any future cross-cutting config (rate limits, retention windows, etc.)."
  - "Pattern: Cross-module type placement via dependency direction — when a shared type (SloStatus/SloMetric) is referenced by both a low-level types module and a high-level module, place it in the low-level module and re-export from the high-level one. Avoids circular imports without duplicating declarations."
  - "Pattern: Pure augmentation helper co-located with its call site — augmentWithSloStatus lives in daemon.ts (its only consumer) AND is exported for direct unit testing. Avoids the 'utility drawer' pitfall while keeping tests isolated from the IPC/daemon boot path."

requirements-completed: []  # PERF-03 + PERF-04 closure gated on Task 4 human-verify checkpoint approval

# Metrics
duration: "~6min through Task 3 (checkpoint pending)"
completed: 2026-04-13
---

# Phase 51 Plan 03: Dashboard SLO Indicators + Bench Starter Kit + CI Regression Gate Summary

**Closes Phase 51's user-visible and CI-visible surface: dashboard Latency panel surfaces per-segment SLO status (cyan/red/gray cell tint + monospace "SLO target" subtitle driven by server-emitted fields so per-agent overrides never drift), bench starter kit (prompts.yaml + thresholds.yaml + README.md) ships, and .github/workflows/bench.yml fails any PR that regresses a tracked p95 past threshold. Tasks 1-3 complete and atomically committed; Task 4 is a human-verify checkpoint that confirms the dashboard renders correctly in a browser AND the CI workflow is syntactically valid on GitHub.**

## Performance

- **Duration (Tasks 1-3):** ~6 min
- **Started:** 2026-04-13T21:32:45Z
- **Tasks 1-3 completed:** 2026-04-13T21:39:30Z
- **Task 4 status:** AWAITING HUMAN VERIFICATION (checkpoint:human-verify)
- **Tasks:** 3 of 4 complete; Task 4 is the final gate.
- **Files created/modified:** 5 created + 7 modified

## Accomplishments (Tasks 1-3)

- **Daemon's `latency` IPC response is augmented end-to-end.** Each segment row now carries `slo_status: "healthy" | "breach" | "no_data"`, `slo_threshold_ms: number | null`, and `slo_metric: "p50" | "p95" | "p99" | null`. The three fields are computed by `augmentWithSloStatus`, which merges `DEFAULT_SLOS` with per-agent `perf.slos?` overrides via `mergeSloOverrides`, then evaluates each row via `evaluateSloStatus`. Wired into BOTH branches (fleet `--all` and single-agent) of `case "latency":` in `routeMethod`.
- **SloStatus + SloMetric moved to types.ts to break the circular-import risk.** `PercentileRow` (in `src/performance/types.ts`) now references `SloStatus` and `SloMetric` from the same file. `src/performance/slos.ts` re-exports both so every existing caller keeps working — Plan 51-01's 7 slos.test.ts tests still GREEN, confirmed by running the suite post-move.
- **Dashboard reads thresholds from the server, not a local constant.** `src/dashboard/static/app.js` has ZERO client-side SLO mirror (grep proves it: `grep -c "SLO_LABELS" src/dashboard/static/app.js` returns 0). The `sloCellClass` helper maps `slo_status` to a CSS class; the row render reads `row.slo_threshold_ms` + `row.slo_metric` to emit a "SLO target: 4,000 ms p95"-style subtitle. Per-agent overrides surface correctly in BOTH color AND text because the daemon emits both.
- **CSS palette stays on-brand.** Four new classes (`.latency-cell-healthy`, `.latency-cell-breach`, `.latency-cell-no-data`, `.latency-subtitle`) pull from existing design tokens (`--accent-secondary`, `--status-error`, `--text-secondary`). The JetBrains Mono typography stack is reused for the subtitle, keeping it consistent with the rest of the Latency panel.
- **Bench starter kit ships in-repo.** `.planning/benchmarks/prompts.yaml` contains the 5 CONTEXT-specified prompts (verified via `loadPrompts` → 5 prompts returned). `.planning/benchmarks/thresholds.yaml` is the policy file (default 20%, context_assemble 30%/100ms escape hatch, tool_call 25%; verified via `loadThresholds`). `.planning/benchmarks/README.md` documents the operator loop.
- **CI regression gate landed.** `.github/workflows/bench.yml` runs on `pull_request` + `workflow_dispatch`. Builds the CLI, checks for `baseline.json` + secret availability, and invokes `node dist/cli/index.js bench --check-regression`. Permissive during rollout: warns-and-passes (exit 0) on missing baseline or missing API key. Upload reports/ directory as artifact regardless.
- **.gitignore updated** to exclude `.planning/benchmarks/reports/` so transient JSON reports never leak into git; the baseline and policy files remain reviewable.
- **Zero new runtime dependencies. Zero new tsc errors introduced** (pre-existing deferred errors in unrelated files documented in deferred-items.md from Plan 51-01 remain; the line number for the pre-existing `src/manager/daemon.ts` CostByAgentModel error shifted from 1475 → 1584 because Task 1 inserted the `augmentWithSloStatus` block — same error, different line).

## Shape of Augmented `latency` IPC Response

Every segment row now carries three new fields. Example after Task 1:

```json
{
  "agent": "alpha",
  "since": "2026-04-13T00:00:00.000Z",
  "segments": [
    {
      "segment": "end_to_end",
      "p50": 1000,
      "p95": 2000,
      "p99": 3000,
      "count": 10,
      "slo_status": "healthy",
      "slo_threshold_ms": 6000,
      "slo_metric": "p95"
    },
    {
      "segment": "first_token",
      "p50": 400,
      "p95": 800,
      "p99": 1200,
      "count": 10,
      "slo_status": "healthy",
      "slo_threshold_ms": 2000,
      "slo_metric": "p50"
    },
    {
      "segment": "context_assemble",
      "p50": 50,
      "p95": 100,
      "p99": 150,
      "count": 10,
      "slo_status": "healthy",
      "slo_threshold_ms": 300,
      "slo_metric": "p95"
    },
    {
      "segment": "tool_call",
      "p50": 75,
      "p95": 150,
      "p99": 225,
      "count": 20,
      "slo_status": "healthy",
      "slo_threshold_ms": 1500,
      "slo_metric": "p95"
    }
  ]
}
```

If the agent has a `perf.slos: [{ segment: end_to_end, metric: p95, thresholdMs: 4000 }]` override, the first row becomes `"slo_threshold_ms": 4000`, the cell may tint red (if p95 > 4000), and the dashboard subtitle reads "SLO target: 4,000 ms p95" — all three values are server-computed and consistent.

## Dashboard SLO Panel Behavior

(Screenshot pending — confirmed via human-verify checkpoint Task 4.)

For each agent card's Latency (24h) table:
- **Segment name cell** renders the segment plus, directly below, a monospace subtitle like `SLO target: 6,000 ms p95` (end_to_end) / `SLO target: 2,000 ms p50` (first_token). Subtitle text is read from the SERVER response (`row.slo_threshold_ms` + `row.slo_metric`) — the dashboard has no threshold constant.
- **Percentile cells** (p50 / p95 / p99) render in a `tabular-nums` font. Only the cell matching `row.slo_metric` gets the SLO tint:
  - `.latency-cell-healthy` (cyan, using `--accent-secondary`) when `slo_status === "healthy"`
  - `.latency-cell-breach` (red, using `--status-error`) when `slo_status === "breach"`
  - `.latency-cell-no-data` (gray, using `--text-secondary`) when `slo_status === "no_data"` OR undefined
- **Per-agent overrides work end-to-end.** An agent with `perf: { slos: [{ segment: end_to_end, metric: p95, thresholdMs: 4000 }] }` in its `clawcode.yaml` will have BOTH:
  - Its cell color evaluated against 4,000 ms (not 6,000 ms)
  - Its subtitle read "SLO target: 4,000 ms p95"
  This is the resolution of plan-checker WARNING 2 (dashboard subtitle threshold consistency): previously a client-side `SLO_LABELS` constant mirrored defaults; now the dashboard reads everything from the server so color and text never drift.

## `.planning/benchmarks/` Directory Layout

| Path | Git-tracked | Purpose |
|------|-------------|---------|
| `.planning/benchmarks/prompts.yaml` | YES | 5-prompt starter set (no-tool-reply / single-tool-call / multi-tool-chain / subagent-spawn / long-context-warm-reply) |
| `.planning/benchmarks/thresholds.yaml` | YES | Regression policy (default 20% p95 delta + per-segment overrides) |
| `.planning/benchmarks/README.md` | YES | Operator + CI documentation |
| `.planning/benchmarks/baseline.json` | YES (once established) | Established via `clawcode bench --update-baseline` — NOT created by this plan |
| `.planning/benchmarks/reports/*.json` | NO (gitignored) | Transient per-run reports written by `clawcode bench` |

## CI Workflow Triggers + Exit Codes

| Trigger | Condition | Exit Code | Annotation |
|---------|-----------|-----------|------------|
| `pull_request` on src/**, package.json, package-lock.json, .planning/benchmarks/**, .github/workflows/bench.yml | baseline.json missing | 0 (pass) | `::warning::No baseline.json found` |
| `pull_request` (same paths) | baseline.json present, ANTHROPIC_API_KEY missing | 0 (pass) | `::warning::ANTHROPIC_API_KEY secret is not set` |
| `pull_request` (same paths) | baseline + secret present, no regressions | 0 (pass) | "No regressions detected (status: clean)." |
| `pull_request` (same paths) | baseline + secret present, regressions found | 1 (fail) | CLI prints regression table |
| `workflow_dispatch` | Any | Same matrix as above | Manual re-run |

## Test Counts

| Test File | Count | RED→GREEN Delta | Status |
|-----------|-------|-----------------|--------|
| `src/manager/__tests__/daemon-latency-slo.test.ts` | 7 | 7 new | GREEN (7/7) |
| `src/dashboard/__tests__/server.test.ts` | 5 | +1 new (Phase 51 row-shape regression assertion) | GREEN (5/5) |
| `src/performance/__tests__/slos.test.ts` | 7 | 0 (post-SloStatus+SloMetric move — Plan 51-01 invariants preserved) | GREEN (7/7) |
| **New in Plan 51-03** | **8** | **8** | **GREEN (8/8)** |
| **Suite run (the three files above, all deps pulled in)** | **132** | **+8 vs pre-plan** | **GREEN (132/132)** |

## Commits

| Task | Commit | Type | Files |
|------|--------|------|-------|
| 1 | `ef8eb5d` | feat | src/performance/types.ts, src/performance/slos.ts, src/manager/daemon.ts, src/manager/__tests__/daemon-latency-slo.test.ts, src/dashboard/__tests__/server.test.ts |
| 2 | `3d014c9` | feat | src/dashboard/static/app.js, src/dashboard/static/styles.css |
| 3 | `e208d28` | feat | .planning/benchmarks/prompts.yaml, .planning/benchmarks/thresholds.yaml, .planning/benchmarks/README.md, .github/workflows/bench.yml, .gitignore |
| 4 | PENDING | - | (checkpoint:human-verify — no files) |

Plan metadata commit will follow approval of Task 4.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] JSDoc comment on `sloCellClass` contained the literal string "SLO_LABELS"**
- **Found during:** Task 2 automated verification
- **Issue:** The first draft of the `sloCellClass` JSDoc explained "there is intentionally NO client-side SLO_LABELS / DEFAULT_SLOS constant" — but the automated Task 2 verifier greps for the substring `SLO_LABELS` in app.js to confirm the client-side mirror was removed. The mention in a comment was enough to fail the check.
- **Fix:** Rewrote the JSDoc to use the semantic phrase "no client-side threshold mirror constant" instead of naming the specific (absent) constant. No behavioral change.
- **Files modified:** `src/dashboard/static/app.js`
- **Verification:** Re-running the Task 2 verify one-liner now exits 0 with `ok`. `grep -c "SLO_LABELS" src/dashboard/static/app.js` returns 0.
- **Committed in:** `3d014c9` (Task 2 commit — fix rolled into the same commit as initial implementation)

---

**Total deviations:** 1 auto-fixed (a comment-only lint issue caught by the plan's own verifier; no code path affected).

## Authentication Gates

None — Plan 51-03 is library + config + static-asset level. The `.github/workflows/bench.yml` references `secrets.ANTHROPIC_API_KEY`, but the workflow is permissive when the secret is absent (warns-and-passes), so no manual auth step is required for the plan to complete. The secret is an operational concern for the repo owner, independent of this plan.

## Plan-Checker Resolution

**WARNING 2 resolved:** "Dashboard subtitle threshold consistency under per-agent overrides". The fix pattern shipped:
- Daemon emits `slo_threshold_ms` + `slo_metric` per row (Task 1), AFTER merging per-agent `perf.slos?` overrides via `mergeSloOverrides`.
- Dashboard reads both fields directly from the response (Task 2) — no client-side mirror.
- Task 4 checkpoint step 6 explicitly asks the human to add a `perf.slos` override to an agent config, reload the dashboard, and verify the subtitle updates in lock-step with the cell color.

## SloStatus + SloMetric Type Move — Plan 51-01 Regression Check

Confirmed that moving `SloStatus` and `SloMetric` from `slos.ts` to `types.ts` (with re-export from `slos.ts`) did NOT break any Plan 51-01 invariants:
- `npx vitest run src/performance/__tests__/slos.test.ts` → 7/7 GREEN
- `DEFAULT_SLOS` shape unchanged (4 frozen entries, assertions in tests 1+2 still pass)
- `evaluateSloStatus` signature unchanged (tests 3-6 still pass)
- `mergeSloOverrides` semantics unchanged (tests 7+8 still pass, including append-on-divergence)

## Requirements Satisfied

**PERF-03 — SLO source of truth + dashboard surfacing with override-correct subtitle:** Daemon (Task 1) merges `DEFAULT_SLOS` with per-agent `perf.slos?` and emits threshold + metric per row. Dashboard (Task 2) renders cell color + subtitle from those fields. Human-verify step 6 (Task 4) explicitly tests per-agent override end-to-end.

**PERF-04 — CI regression gate:** `.github/workflows/bench.yml` (Task 3) invokes `clawcode bench --check-regression`, exits 1 on regression, 0 on clean. Permissive during rollout (warn+pass on missing baseline or secret). Starter prompts + thresholds + operator README shipped. Full loop functional once the operator runs `clawcode bench --update-baseline` to bootstrap the canonical baseline.

## Issues Encountered

- Pre-existing `tsc --noEmit` errors (10) in unrelated files remain (documented in `.planning/phases/51-slos-regression-gate/deferred-items.md` from Plan 51-01). Plan 51-03 introduces ZERO new tsc errors. Line number for the existing `src/manager/daemon.ts` CostByAgentModel error shifted from 1475 → 1584 because Task 1 inserted the `augmentWithSloStatus` helper — same error, different line. Not a new issue.
- Initial draft of Task 2's JSDoc mentioned the absent `SLO_LABELS` constant literally; the plan's own automated verifier flagged it. Fixed inline (deviation #1 above).

## User Setup Required

Task 4 is a human-verify checkpoint. The user must:
1. `npm run build` and restart the daemon so the new code is loaded.
2. Open the dashboard and visually confirm cell coloring + subtitles per the 14-step checklist.
3. Optionally push a no-op commit on a PR branch to watch the CI workflow trigger.
4. Respond "approved" (or describe the specific failure) to signal continuation.

See the `<how-to-verify>` block in `51-03-PLAN.md` for the full 14-step protocol.

## Next Phase Readiness

- **Phase 51 closure pending on Task 4 approval.** Once approved, milestone v1.7 optimization phases (52-56) can begin — regressions will be caught automatically on every PR because the CI workflow enforces tracked p95 thresholds against the git-committed baseline.
- **Baseline bootstrap path is clear.** Operator runs `clawcode bench --update-baseline` once locally to generate `baseline.json`. Commits it. From that point forward, the CI gate is strict.
- **`clawcode.yaml` per-agent SLO overrides work end-to-end.** Plan 51-01 shipped the Zod schema + TS type; Plan 51-03 makes them surface on the dashboard. An operator can tighten `end_to_end` to 4000ms for a latency-sensitive agent and the dashboard will both color the cell against 4000 AND display "SLO target: 4,000 ms p95" — previously impossible with a client-side mirror.

## Self-Check: PASSED (Tasks 1-3 only — Task 4 pending)

All five created files exist at expected paths:
- `src/manager/__tests__/daemon-latency-slo.test.ts` FOUND
- `.planning/benchmarks/prompts.yaml` FOUND
- `.planning/benchmarks/thresholds.yaml` FOUND
- `.planning/benchmarks/README.md` FOUND
- `.github/workflows/bench.yml` FOUND

All seven modified files carry the expected changes:
- `src/performance/types.ts` — `SloStatus` + `SloMetric` declared; 3 optional fields on `PercentileRow`
- `src/performance/slos.ts` — re-exports `SloStatus` + `SloMetric` from types.ts
- `src/manager/daemon.ts` — `augmentWithSloStatus` exported; wired into both latency branches; `agentConfig?.perf?.slos` read 2x
- `src/dashboard/__tests__/server.test.ts` — fixture carries the 3 new fields; regression assertion added
- `src/dashboard/static/app.js` — `sloCellClass` helper; `SLO_LABELS` absent (0 matches); subtitle injection
- `src/dashboard/static/styles.css` — 4 new classes appended (healthy/breach/no-data/subtitle)
- `.gitignore` — `.planning/benchmarks/reports/` excluded

All three task commits exist in `git log --oneline`:
- `ef8eb5d` FOUND
- `3d014c9` FOUND
- `e208d28` FOUND

All specified verification passes:
- `npx vitest run src/manager/__tests__/daemon-latency-slo.test.ts src/dashboard/__tests__/server.test.ts src/performance/__tests__/slos.test.ts` → 132/132 GREEN
- `grep -c "SLO_LABELS" src/dashboard/static/app.js` → 0 (required)
- `grep -c "slo_threshold_ms" src/performance/types.ts src/manager/daemon.ts src/dashboard/static/app.js` → positive counts in all three files
- `node -e "yaml.parse(fs.readFileSync('.github/workflows/bench.yml','utf-8'))"` → `ok`
- prompts.yaml round-trips through `loadPrompts` → 5 prompts
- thresholds.yaml round-trips through `loadThresholds` → default=20, 2 segments

**Plan execution status:** Tasks 1-3 COMPLETE + COMMITTED. Task 4 AWAITING human verification per the checkpoint protocol.

---
*Phase: 51-slos-regression-gate*
*Plan: 03*
*Tasks 1-3 completed: 2026-04-13*
*Task 4: checkpoint:human-verify — pending operator approval*
