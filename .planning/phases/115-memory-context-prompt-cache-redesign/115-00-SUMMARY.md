---
phase: 115-memory-context-prompt-cache-redesign
plan: 00
subsystem: testing
tags: [bench, performance, traces, sqlite, baseline]

# Dependency graph
requires:
  - phase: 50-latency-instrumentation
    provides: traces.db schema + canonical span names (first_token, end_to_end, tool_call, first_visible_token)
  - phase: 52-prompt-caching
    provides: cache_read_input_tokens / cache_creation_input_tokens / input_tokens / prefix_hash columns + idempotent migrateSchema() pattern
  - phase: 75-shared-workspace-runtime-support
    provides: per-agent memoryPath override (used by bench --memory-path flag for finmentum family)
provides:
  - Phase 115 perf benchmark harness (scripts/bench/115-perf.ts + scripts/bench/115-perf-runner.ts)
  - 6 new traces.db column slots (tier1_inject_chars, tier1_budget_pct, tool_cache_hit_rate, tool_cache_size_mb, lazy_recall_call_count, prompt_bloat_warnings_24h)
  - Locked pre-115 baseline anchor numbers (5,200ms first_token p50, 288,713ms end_to_end p95, 92.8% / <30% bimodal cache hit, 32,989-char fin-acq prefix)
  - perf-comparisons/ scaffold (baseline + README) for the wave-2 checkpoint and Plan 115-09 closeout reports to extend
affects: [115-02, 115-05, 115-07, 115-08, 115-09]

# Tech tracking
tech-stack:
  added: []  # zero new dependencies — built entirely on existing better-sqlite3 + tsx
  patterns:
    - "Phase 115 column-slot opening: migration first, writes deferred to consumer plans"
    - "Bench harness reads trace_spans.duration_ms (not wall-clock) so numbers match dashboard / clawcode latency"
    - "Operator-gate refusal at CLI level (fin-acquisition cold-start without --allow-fin-acq-cold-start)"

key-files:
  created:
    - scripts/bench/115-perf.ts
    - scripts/bench/115-perf-runner.ts
    - src/performance/__tests__/trace-store-115-columns.test.ts
    - .planning/phases/115-memory-context-prompt-cache-redesign/perf-comparisons/baseline-pre-115.md
    - .planning/phases/115-memory-context-prompt-cache-redesign/perf-comparisons/README.md
    - .planning/phases/115-memory-context-prompt-cache-redesign/CHECKPOINT.md
  modified:
    - src/performance/trace-store.ts (extended migrateSchema() additions array + Phase115TurnColumns type export)
    - src/performance/types.ts (extended TurnRecord with 6 optional Phase 115 fields)

key-decisions:
  - "Bench reads traces.db span durations directly rather than measuring wall-clock — same data path as dashboard / clawcode latency CLI"
  - "Nearest-rank percentile (no interpolation, sorted[ceil(p*n)-1]) — matches existing PERCENTILE_SQL convention in src/performance/percentiles.ts"
  - "Column slots opened in 115-00; producer wiring deferred to 115-02 (tier1_*, prompt_bloat_*), 115-05 (lazy_recall_*), 115-07 (tool_cache_*) — keeps each consumer plan migration-free"
  - "Phase115TurnColumns type alias exported from trace-store.ts so consumer plans don't re-derive the column list"
  - "fin-acquisition cold-start hardcoded to skip without --allow-fin-acq-cold-start flag — Ramy gate enforced at CLI, not runtime config (per CLAUDE.md feedback_ramy_active_no_deploy)"
  - "Headline anchor numbers (5,200/288,713/92.8/32,989) locked from 2026-05-07 incident response, NOT re-measured — Plan 115-09 closeout compares against these regardless of fleet-run completion"

patterns-established:
  - "Bench artifacts at ~/.clawcode/bench/115/<label>/ — outside repo, per-machine; only summary .md reports committed"
  - "Operator-quiet-window gate for live-fleet bench runs (Discord-visible turn loop, not just internal state)"
  - "Migration-only plan: open column slots in T+0 plan so consumer plans never re-ship migration code"

requirements-completed: []

# Metrics
duration: 21min
completed: 2026-05-08
---

# Phase 115 Plan 00: Baseline benchmark suite + pre-115 broken numbers lock — Summary

**Phase 115 perf benchmark harness with 5 canonical scenarios, 6 new traces.db column slots opened, and the 2026-05-07 fin-acq incident anchor numbers (5,200ms first_token p50 / 288,713ms end_to_end p95 / 92.8% bimodal cache hit / 32,989-char wedge) locked as the immovable pre-115 reference.**

## Performance

- **Duration:** ~21 min (worktree fast-forward at 2026-05-08T01:01Z, last commit 2026-05-08T01:22Z)
- **Started:** 2026-05-08T01:01:21Z
- **Completed:** 2026-05-08T01:22:21Z
- **Tasks:** 3 (T01 fully shipped, T02 fully shipped, T03 partial — fleet bench run deferred to operator quiet window)
- **Files modified:** 8 created/modified across `scripts/bench/`, `src/performance/`, and `.planning/phases/115-*/perf-comparisons/`

## Accomplishments

- **Bench harness shipped** (T01) — `scripts/bench/115-perf.ts` CLI + `scripts/bench/115-perf-runner.ts` library exposing five canonical scenarios (`cold-start`, `discord-ack`, `tool-heavy`, `memory-recall`, `extended-thinking`). Reads `trace_spans.duration_ms` from each agent's `traces.db` rather than wall-clock so numbers stay byte-identical to what the dashboard / `clawcode latency` CLI report. Fin-acquisition cold-start hardcoded to refuse without `--allow-fin-acq-cold-start` (Ramy gate per `CLAUDE.md`).
- **6 traces.db column slots opened** (T02) — `tier1_inject_chars`, `tier1_budget_pct`, `tool_cache_hit_rate`, `tool_cache_size_mb`, `lazy_recall_call_count`, `prompt_bloat_warnings_24h` extended into `migrateSchema()`'s additions array. Idempotent (existing `PRAGMA table_info(traces)` check), nullable on all legacy turns, INTEGER vs REAL types match the metric semantics. Plans 115-02 / 115-05 / 115-07 can now ship producers without re-shipping migration code. New `Phase115TurnColumns` type alias exported from `trace-store.ts` documents the column shape; matching optional camelCase fields added to `TurnRecord` in `types.ts`. Test (`src/performance/__tests__/trace-store-115-columns.test.ts`) asserts fresh-open creates all 6 columns + idempotent re-open + correct INTEGER/REAL types — 4 specs, all green.
- **Pre-115 anchor numbers locked** (T03 partial) — `perf-comparisons/baseline-pre-115.md` records the 2026-05-07 fin-acquisition incident anchor (5,200ms first_token p50 / 288,713ms end_to_end p95 / 120,659ms mysql_query p50 / 32,989-char `systemPrompt.append` wedge / 92.8% Ramy active / <30% idle bimodal cache hit) plus the six-row Phase 115 perf-targets table. These numbers do NOT depend on the fleet bench run — they're the immovable reference Plan 115-09's closeout will compare against. The per-agent rows + cache-hit-rate table are PENDING the operator quiet-window run (deferred via `CHECKPOINT.md`).

## Task Commits

1. **T01: Add Phase 115 perf benchmark harness with 5 canonical scenarios** — `0778f19` (feat)
2. **T02: Open 6 Phase 115 metrics column slots on traces.db** — `7eb62dd` (feat)
3. **T03: Pre-115 baseline anchor + perf-comparisons scaffold + fleet-run checkpoint** — `7819983` (docs, partial)

_Note: T03 ships the locked anchor numbers + the scaffolding the rest of Phase 115 needs. The fleet bench run (per-agent rows in baseline-pre-115.md) is deferred to the operator's next quiet window via `CHECKPOINT.md` — see "Issues Encountered" below._

## Files Created/Modified

- `scripts/bench/115-perf.ts` (created) — CLI entrypoint accepting `--agent --scenario --runs --label`. Exit-0 on `--help`, hardcoded fin-acq cold-start refusal without override flag.
- `scripts/bench/115-perf-runner.ts` (created) — `runBenchScenario()` library. Reads `trace_spans.duration_ms` from each agent's `traces.db` after the IPC `send-message` (or `start` for cold-start) lands a real turn. Nearest-rank percentile via `sorted[ceil(percentile * n) - 1]`. Per-run JSONL + summary.jsonl emitted to `~/.clawcode/bench/115/<label>/`.
- `src/performance/trace-store.ts` (modified) — extended `migrateSchema()` additions array with the 6 Phase 115 columns; added `Phase115TurnColumns` type export documenting the row shape.
- `src/performance/types.ts` (modified) — added 6 optional camelCase fields to `TurnRecord` (`tier1InjectChars`, `tier1BudgetPct`, `toolCacheHitRate`, `toolCacheSizeMb`, `lazyRecallCallCount`, `promptBloatWarnings24h`), all `number | null`.
- `src/performance/__tests__/trace-store-115-columns.test.ts` (created) — 4 specs asserting column slots, idempotent re-open, INTEGER/REAL types, type alias export.
- `.planning/phases/115-memory-context-prompt-cache-redesign/perf-comparisons/baseline-pre-115.md` (created) — locked anchor numbers + 6-row perf-targets table + per-agent fleet table (PENDING) + cache-hit-rate SQL block (PENDING).
- `.planning/phases/115-memory-context-prompt-cache-redesign/perf-comparisons/README.md` (created) — describes the 3-file lifecycle (baseline / wave-2-checkpoint / post-115-comparison) and methodology shared by all three.
- `.planning/phases/115-memory-context-prompt-cache-redesign/CHECKPOINT.md` (created) — documents the deferred fleet bench run + exact bash for the operator + the 2 unmet T03 acceptance criteria.

## Decisions Made

All key decisions are captured in the frontmatter `key-decisions:` block above. The two highest-impact ones:

1. **Bench reads trace_spans.duration_ms, not wall-clock** — guarantees the bench numbers match the dashboard / `clawcode latency` numbers byte-for-byte. If they ever diverge, the trace store is the source of truth and the bench is wrong. This means a freshly running daemon is required to bench (not optional), but it also means we never have a "the bench says X but the dashboard says Y" reconciliation problem.
2. **Headline anchor numbers locked, NOT re-measured** — the 2026-05-07 incident produced specific, recorded numbers (incident postmortem cites them directly). Re-measuring would either confirm them (waste of operator quiet-window time) or surface a different number (which raises the question of which incident the bench was capturing). Lock them as documented and let the per-agent fleet rows be the new measurement.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan referred to "ALTER TABLE turns" but the actual schema uses table name `traces`**

- **Found during:** T02 (column migration)
- **Issue:** The plan body said `ALTER TABLE turns ADD COLUMN ...` but `trace-store.ts:543-553` defines the table as `traces` (with `trace_spans` as the per-span child table). The plan acknowledged this ambiguity in its action block — "Use the actual table name verified by reading the file" — but the SQL snippets in the plan still wrote `turns`.
- **Fix:** Used `traces` (the real table name) in the migration. The 6 columns land on the row that already carries `prefix_hash` and `cache_eviction_expected` (Phase 52 columns), which is the same `traces` table.
- **Files modified:** `src/performance/trace-store.ts`
- **Verification:** All 4 specs in `trace-store-115-columns.test.ts` green; full `trace-store` test suite (35 specs) still green; `tsc --noEmit` clean.
- **Committed in:** `7eb62dd` (T02)

**2. [Rule 4-style operator gate, NOT autonomous fix] Deferred T03 fleet bench run to operator quiet window**

- **Found during:** T03 (live-fleet baseline run)
- **Issue:** T03's action block expected an autonomous bench run across all 11 production agents. Two operator-policy reasons block this autonomously:
  1. `feedback_ramy_active_no_deploy` (CLAUDE.md): Ramy is in #fin-acquisition; restarting the agent disrupts his live thread. The bench's `cold-start` scenario calls `clawcode stop` + `clawcode start`. Bench CLI hardcodes a refusal at `scripts/bench/115-perf.ts:155-179` for fin-acquisition cold-start unless `--allow-fin-acq-cold-start` is passed.
  2. The non-cold-start scenarios send real Discord-shaped messages via `send-message` IPC into the agents' channels — they DO disrupt operator threads, just less than a restart. Same `feedback_no_auto_deploy` policy applies.
- **Fix:** Wrote the locked anchor numbers + scaffold; documented the deferred fleet run via `CHECKPOINT.md`. Operator runs the fleet bench during the next quiet window using exact bash provided in both `baseline-pre-115.md` and `CHECKPOINT.md`. After the run lands the per-agent rows, `CHECKPOINT.md` is removed.
- **Files affected:** `.planning/phases/115-memory-context-prompt-cache-redesign/perf-comparisons/baseline-pre-115.md` (per-agent rows = PENDING), `.planning/phases/115-memory-context-prompt-cache-redesign/CHECKPOINT.md`
- **Verification:** All 6 of the 8 T03 acceptance grep checks pass (anchor numbers + Ramy gate note + file existence). The 2 unmet checks (`summary.jsonl` exists, ≥10 data rows) are explicitly listed in `CHECKPOINT.md` as deferred.
- **Committed in:** `7819983` (T03 partial)

---

**Total deviations:** 2 (1 plan-text fix per Rule 1, 1 operator-gate deferral per the existing Ramy / no-auto-deploy policy)
**Impact on plan:** Neither deviation changes scope. Both are within the plan's explicit guardrails — the plan body called out the table-name verification step, and CONTEXT.md D-12 + the deploy memories already require operator confirmation before touching fin-acquisition.

## Issues Encountered

- **Worktree was behind master at session start.** The worktree branch was created from `2e7796e` but the Phase 115 plan files were committed to master at commits `5fc0eac` and earlier. Worktree was a direct ancestor of master, so a `git merge --ff-only master` was clean. Then proceeded with the plan.
- **No local daemon running, no traces.db on this box.** Confirmed via `ls ~/.clawcode/manager/clawcode.sock` (does not exist) — this box is the operator's dev workstation, not the production `clawdy` host. The bench *can* run from this box (it talks to the daemon over the IPC socket and reads the per-agent traces.db), but only when the operator wires that up. Reinforces the deferral decision in T03.

## User Setup Required

None — no external service configuration required. The fleet bench run (T03 partial) is operator-driven (paste the bash from `CHECKPOINT.md`), but it doesn't add any new external service or env var.

## Next Phase Readiness

- **Plans 115-01 through 115-08 unblocked.** None of them depend on the fleet bench rows; they only need:
  - Anchor numbers (LOCKED in `baseline-pre-115.md`) — to size their improvements
  - Column slots (OPENED in T02) — Plans 115-02 (`tier1_*`, `prompt_bloat_*`), 115-05 (`lazy_recall_*`), 115-07 (`tool_cache_*`) write to these without re-shipping migration code
  - Bench harness (SHIPPED in T01) — Plan 115-08's wave-2 checkpoint and Plan 115-09's post-comparison both call this same CLI with different `--label`s
- **Plan 115-09 closeout will need the fleet rows filled in** before its pre/post diff is publishable. `CHECKPOINT.md` flags this; expectation is the operator runs the bench during a quiet window before then (multiple opportunities across the phase's expected duration).
- **Production deploy unaffected.** Per `feedback_ramy_active_no_deploy` and `feedback_no_auto_deploy`, no deploy was performed in this plan. Production daemon doesn't need a redeploy yet — the trace-store migration runs at the daemon's next normal restart, and there's no bench harness consumer in production yet (next bench run is operator-driven).

## Self-Check: PASSED

- [x] `scripts/bench/115-perf.ts` exists
- [x] `scripts/bench/115-perf-runner.ts` exists
- [x] `src/performance/__tests__/trace-store-115-columns.test.ts` exists
- [x] `.planning/phases/115-memory-context-prompt-cache-redesign/perf-comparisons/baseline-pre-115.md` exists
- [x] `.planning/phases/115-memory-context-prompt-cache-redesign/perf-comparisons/README.md` exists
- [x] `.planning/phases/115-memory-context-prompt-cache-redesign/CHECKPOINT.md` exists
- [x] Commit `0778f19` (T01) found in git log
- [x] Commit `7eb62dd` (T02) found in git log
- [x] Commit `7819983` (T03 partial) found in git log
- [x] `npm test -- --run trace-store-115-columns` exit 0 — 4 specs green
- [x] Existing trace-store test suite still green — 35 specs green
- [x] `npx tsc --noEmit` clean
- [x] `npx tsx scripts/bench/115-perf.ts --help` exit 0
- [x] T01 acceptance grep — 7 matches (≥5 required) for `scenario.*<id>` patterns in `scripts/bench/115-perf.ts`
- [x] T02 acceptance grep — `tier1_inject_chars` 4 matches (≥1), `tool_cache_*` 8 matches (≥2), `lazy_recall_*` / `prompt_bloat_*` 8 matches (≥2), `PRAGMA table_info` 2 matches (≥1), `tier1_inject_chars.*number.*null` 1 match (≥1)
- [x] T03 acceptance grep — `5200`, `288,713`, `92.8`, `32,989`, `Ramy active gate` all ≥1 match
- [ ] T03 acceptance — `~/.clawcode/bench/115/pre-115-baseline-2026-05-08/summary.jsonl` exists — DEFERRED (operator quiet window run; tracked in `CHECKPOINT.md`)
- [ ] T03 acceptance — per-agent table has ≥10 data rows — DEFERRED (same)

Two T03 acceptance criteria are explicitly deferred via `CHECKPOINT.md` per the operator-gate policy in `CLAUDE.md` (see "Deviations from Plan" #2). The remaining 16 of 18 self-checks pass.

---
*Phase: 115-memory-context-prompt-cache-redesign*
*Plan: 00*
*Completed: 2026-05-08*
