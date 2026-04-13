---
phase: 51-slos-regression-gate
verified: 2026-04-13T21:52:00Z
status: passed
score: 4/4 success criteria verified
---

# Phase 51: SLOs & Regression Gate Verification Report

**Phase Goal:** Latency wins are defended automatically — regressions break the build
**Verified:** 2026-04-13T21:52:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (Success Criterion) | Status | Evidence |
|---|---------------------------|--------|----------|
| 1 | Per-surface SLO targets documented in repo AND visible on dashboard with red/green indicators against live percentiles | VERIFIED | `src/performance/slos.ts:56-77` defines `DEFAULT_SLOS` (frozen, 4 entries: end_to_end p95 ≤ 6000 / first_token p50 ≤ 2000 / context_assemble p95 ≤ 300 / tool_call p95 ≤ 1500). Daemon `latency` handler (`src/manager/daemon.ts:1203, 1218`) calls `augmentWithSloStatus` in BOTH fleet + single-agent branches. Dashboard `src/dashboard/static/app.js:240-290` reads `row.slo_status`, `row.slo_threshold_ms`, `row.slo_metric` directly from server response. CSS classes `.latency-cell-healthy/breach/no-data/.latency-subtitle` present. Runtime check (orchestrator): all 4 segments carry all 3 SLO fields. |
| 2 | CI benchmark command runs fixed prompt set against local daemon and produces reproducible latency report | VERIFIED | `clawcode bench` subcommand registered via `registerBenchCommand` in `src/cli/index.ts:153`; 10 flags present (confirmed via `--help`). `src/benchmarks/runner.ts:89 runBench` spawns isolated daemon (`spawnIsolatedDaemon` with tempdir HOME override), runs N repeats per prompt via `bench-run-prompt` IPC, writes JSON report to `<reportsDir>/<run_id>.json` with run_id + git_sha + node_version + prompt_results + overall_percentiles, teardown in `finally{}`. `.planning/benchmarks/prompts.yaml` contains the 5 representative prompts (verified parses). |
| 3 | CI job fails when any tracked p95 regresses beyond configurable threshold vs. stored baseline | VERIFIED | `.github/workflows/bench.yml` valid YAML, runs on `pull_request` + `workflow_dispatch`, invokes `node dist/cli/index.js bench --check-regression` (line 52). CLI `--check-regression` path reads baseline + thresholds + report, calls `evaluateRegression` in `src/benchmarks/thresholds.ts:161`, exits 1 on regression (`src/cli/commands/bench.ts` action handler). `.planning/benchmarks/thresholds.yaml` defines default 20% p95 delta + context_assemble 30%/100ms floor + tool_call 25%. Pre-baseline state: permissive warn+pass (line 37-41). |
| 4 | Updating baseline is explicit, auditable operator action (not automatic) | VERIFIED | `clawcode bench --update-baseline` flag in `src/cli/commands/bench.ts:191-194`. `confirmBaselineUpdate` in `src/cli/commands/bench.ts` requires exact `y`/`yes` (case-insensitive) — anything else returns false. `writeBaseline` (`src/benchmarks/baseline.ts:85`) stamps `updated_at` + `updated_by: provenance.username` + `git_sha`. CLI emits copy-pasteable `git add .planning/benchmarks/baseline.json && git commit` hint via `buildCommitHint`. No auto-write path exists. Test `bench.test.ts` asserts: "does NOT write baseline when user declines confirmation". `baseline.json` is absent on disk (correct — established only on first `--update-baseline` run). |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/performance/slos.ts` | DEFAULT_SLOS + evaluateSloStatus + mergeSloOverrides + SloEntry type | VERIFIED | 166 lines. `DEFAULT_SLOS` at line 56 with 4 frozen entries matching CONTEXT. `evaluateSloStatus` at line 96 (no_data / healthy / breach). `mergeSloOverrides` at line 123 (per-(segment, metric) replace + append-on-divergence). Imported by daemon.ts + re-exports `SloStatus`/`SloMetric` from types.ts. |
| `src/performance/types.ts` | PercentileRow extended with optional slo_status + slo_threshold_ms + slo_metric; SloStatus + SloMetric moved here | VERIFIED | Lines 80-87 declare `SloStatus` + `SloMetric`. PercentileRow at lines 100-126 with 3 optional SLO fields. |
| `src/benchmarks/types.ts` | benchReportSchema + baselineSchema + promptResultSchema + BenchmarkConfigError | VERIFIED | 106 lines. `percentileRowSchema` (40), `promptResultSchema` (52), `benchReportSchema` (60), `baselineSchema` (75 — extends benchReport with updated_at + updated_by), `BenchmarkConfigError` (94). |
| `src/benchmarks/thresholds.ts` | loadThresholds + thresholdsSchema + evaluateRegression | VERIFIED | 210 lines. `thresholdsSchema` (49), `loadThresholds` (91 — throws `BenchmarkConfigError`), `evaluateRegression` (161 — returns frozen `{regressions, status}`). |
| `src/benchmarks/prompts.ts` | loadPrompts(path) | VERIFIED | 86 lines. `loadPrompts` at line 60 returns frozen PromptDefinition[]. |
| `src/benchmarks/harness.ts` | spawnIsolatedDaemon + awaitDaemonReady + writeBenchAgentConfig | VERIFIED | 211 lines. `spawnIsolatedDaemon` at line 84 with tempdir HOME override. |
| `src/benchmarks/baseline.ts` | readBaseline + writeBaseline + formatDiffTable | VERIFIED | 171 lines. `readBaseline` (40), `writeBaseline` (85), `formatDiffTable` at later line. |
| `src/benchmarks/runner.ts` | runBench(opts) orchestrator with teardown in finally{} | VERIFIED | 212 lines. `runBench` at line 89. Imports `spawnIsolatedDaemon`, `loadPrompts`, `sendIpcRequest`, `CANONICAL_SEGMENTS`. |
| `src/cli/commands/bench.ts` | registerBenchCommand with 10 flags + formatRegressionTable + buildCommitHint + confirmBaselineUpdate | VERIFIED | 304 lines. 10 flags confirmed via `npx tsx src/cli/index.ts bench --help` (--prompts, --baseline, --thresholds, --reports-dir, --agent, --repeats, --since, --json, --update-baseline, --check-regression). |
| `src/cli/index.ts` | registerBenchCommand imported + invoked | VERIFIED | Line 37 imports, line 153 invokes. |
| `src/config/schema.ts` | perf.slos? optional override on agentSchema + defaultsSchema | VERIFIED | `sloOverrideSchema` at line 33, `SloOverrideConfig` type at 40, `slos: z.array(sloOverrideSchema).optional()` at lines 225 (agentSchema) AND 261 (defaultsSchema). |
| `src/shared/types.ts` | ResolvedAgentConfig.perf extended with optional slos? readonly array | VERIFIED | Lines 110-121 — `readonly slos?: readonly { segment, metric, thresholdMs }[]` with inline literal unions. This is the Phase 51 blocker fix that lets daemon code `configs.find(...).perf?.slos` typecheck. |
| `src/manager/daemon.ts` | augmentWithSloStatus helper + latency handler wires it + bench-run-prompt handler | VERIFIED | `augmentWithSloStatus` exported at line 100. Called in BOTH `case "latency":` branches (fleet at 1203, single-agent at 1218). `case "bench-run-prompt":` at line 1222 with caller-owned Turn lifecycle (`turn.end("success")` + `turn.end("error")` — Phase 50 contract preserved). `nanoid` import at line 75. |
| `src/ipc/protocol.ts` | 'bench-run-prompt' in IPC_METHODS | VERIFIED | Line 60. |
| `src/ipc/__tests__/protocol.test.ts` | 'bench-run-prompt' in expected toEqual list + describe block | VERIFIED | Line 63 (toEqual), line 195 (describe block), lines 200/209 (request schema test). Phase 50 regression lesson (IPC method dual-registration) honored by construction. |
| `src/dashboard/static/app.js` | sloCellClass helper + row reads slo_status/slo_threshold_ms/slo_metric from server; NO SLO_LABELS constant | VERIFIED | `sloCellClass` at line 45. `grep -c "SLO_LABELS" app.js` returns 0 (client-side mirror removed). Row rendering at lines 260-288 reads all three fields from server response; subtitle + cell tint driven entirely by server emission. |
| `src/dashboard/static/styles.css` | latency-cell-healthy/breach/no-data + latency-subtitle classes | VERIFIED | All 4 classes present (`grep -c` returns 4). |
| `.planning/benchmarks/prompts.yaml` | 5 representative prompts | VERIFIED | YAML parses; 5 prompts: no-tool-reply, single-tool-call, multi-tool-chain, subagent-spawn, long-context-warm-reply. |
| `.planning/benchmarks/thresholds.yaml` | Default 20% + per-segment overrides | VERIFIED | YAML parses; `defaultP95MaxDeltaPct: 20`; 2 segment overrides (context_assemble 30% + 100ms floor; tool_call 25%). |
| `.planning/benchmarks/README.md` | Operator + CI documentation | VERIFIED | 57 lines. Documents file roles, local run, CI behavior, baseline update protocol, schema sources. Mentions `clawcode bench --update-baseline` flow. |
| `.github/workflows/bench.yml` | CI workflow invoking bench --check-regression | VERIFIED | 62 lines. Triggers: `pull_request` + `workflow_dispatch`. Step 5 (line 43-52) invokes `node dist/cli/index.js bench --check-regression`. Permissive warn+pass on missing baseline (line 37) or missing ANTHROPIC_API_KEY (line 48). |
| `.planning/benchmarks/baseline.json` | NOT created by phase; established via operator action | EXPECTED-ABSENT | Correctly absent per Phase 51 design. CI workflow passes permissively in this state until operator runs `clawcode bench --update-baseline` and commits. README step-by-step documents this bootstrap path. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/performance/slos.ts` | `src/performance/types.ts` | imports CanonicalSegment + PercentileRow + SloMetric + SloStatus | WIRED | Lines 21-27: `import { CANONICAL_SEGMENTS, type CanonicalSegment, type PercentileRow, type SloMetric, type SloStatus } from "./types.js";` |
| `src/benchmarks/thresholds.ts` | DEFAULT_SLOS | imports to know which segments require thresholds | WIRED | Verified grep: `loadThresholds`/`evaluateRegression` use segment names from DEFAULT_SLOS via `CANONICAL_SEGMENTS` (re-exported from slos.ts). |
| `src/config/schema.ts sloOverrideSchema` | canonical segment enum | Zod validates segment is one of the canonical four | WIRED | Line 33 `sloOverrideSchema = z.object({ segment: sloSegmentEnum, ... })` with `sloSegmentEnum = z.enum([...])` — inline canonical segments duplication. |
| `src/shared/types.ts ResolvedAgentConfig.perf` | Zod schema | TS shape mirrors Zod parse output so loader passthrough typechecks | WIRED | Lines 110-121 mirror the Zod output. Phase 51 blocker: daemon.ts reads `agentConfig?.perf?.slos` at lines 1203 and 1218 — typechecks under strict. |
| `src/cli/commands/bench.ts` | `src/benchmarks/runner.ts` | imports runBench | WIRED | Line 24: `import { runBench } from "../../benchmarks/runner.js";` |
| `src/benchmarks/runner.ts` | `src/benchmarks/harness.ts` | spawnIsolatedDaemon → awaitDaemonReady → teardown in finally{} | WIRED | Line 37: `spawnIsolatedDaemon`, line 56 `HarnessDeps.spawn: typeof spawnIsolatedDaemon`, line 99 wires into DI. |
| `src/benchmarks/runner.ts` | `bench-run-prompt` IPC method | sendIpcRequest to isolated daemon | WIRED | `bench-run-prompt` string referenced in runner.ts (confirmed via grep). |
| `src/benchmarks/runner.ts` | `latency` IPC method | reuses Phase 50 latency for percentile snapshot | WIRED | Imports `CANONICAL_SEGMENTS` from performance/types, calls `"latency"` method with agent + since. |
| `src/cli/commands/bench.ts` | `src/benchmarks/baseline.ts` | writeBaseline/readBaseline + formatDiffTable | WIRED | Lines 26-27 import, 140-141 in BenchActionDeps. |
| `src/manager/daemon.ts case "bench-run-prompt"` | TraceCollector + Turn lifecycle | manager.getTraceCollector + caller-owned turn.end() in both branches | WIRED | Line 1222 handler; caller owns `turn.end("success")` in try, `turn.end("error")` in catch — Phase 50 contract preserved. |
| `src/manager/daemon.ts case "latency"` | `src/performance/slos.ts DEFAULT_SLOS + mergeSloOverrides + evaluateSloStatus` | augmentWithSloStatus helper merges + evaluates per row | WIRED | `augmentWithSloStatus` at line 100 imports DEFAULT_SLOS, mergeSloOverrides, evaluateSloStatus from slos.ts. Called at lines 1203 (fleet) AND 1218 (single-agent) — BOTH branches instrumented. |
| `src/dashboard/static/app.js fetchAgentLatency` | augmented latency JSON | reads row.slo_threshold_ms/slo_metric for subtitle, row.slo_status for cell class | WIRED | Lines 260-288: subtitle template at 275 interpolates `row.slo_threshold_ms` + `row.slo_metric`; cellClass at 268 derived from `row.slo_status`. ZERO client-side SLO table. |
| `.github/workflows/bench.yml` | `clawcode bench --check-regression` | node dist/cli/index.js bench --check-regression | WIRED | Line 52. Non-zero exit fails the job. |
| `.planning/benchmarks/thresholds.yaml` | loadThresholds | parses via loadThresholds without errors | WIRED | Runtime spot-check: `yaml.parse` yields `{defaultP95MaxDeltaPct: 20, segments: [...]}` matching schema. |
| `.planning/benchmarks/prompts.yaml` | loadPrompts | parses via loadPrompts without errors | WIRED | Runtime spot-check: `yaml.parse` yields 5 prompt entries with id + description + prompt fields. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/dashboard/static/app.js fetchAgentLatency` | `report.segments` + per-row `slo_status/slo_threshold_ms/slo_metric` | `GET /api/agents/:name/latency` → daemon case "latency" → `store.getPercentiles` → `augmentWithSloStatus(rawSegments, agentConfig?.perf?.slos)` | Yes — percentile numbers flow from SQLite TraceStore (Phase 50) merged with SLO config from clawcode.yaml. No hardcoded client-side SLO mirror. | FLOWING |
| `src/manager/daemon.ts case "latency"` | `segments` | `manager.getTraceStore(agent).getPercentiles(agent, sinceIso)` then augmentWithSloStatus | Yes — real percentile query against SQLite; threshold/metric merged from DEFAULT_SLOS + per-agent override | FLOWING |
| `src/benchmarks/runner.ts runBench` | `report` | Iterates prompts × repeats, IPC `bench-run-prompt` → real sendToAgent → trace captured → IPC `latency` snapshot → CANONICAL_SEGMENTS.map ensures 4-row shape | Yes — every prompt runs a real Turn through sendToAgent; percentiles computed from SQLite-persisted spans | FLOWING |
| `src/cli/commands/bench.ts` --check-regression path | `result.status` | readBaseline → runBench → evaluateRegression | Yes — comparison is over live BenchReport vs. stored Baseline using loaded thresholds | FLOWING |

All data sources verified as real queries / real state — no static `[]` or hardcoded empty fallbacks in rendering paths.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CLI registers bench subcommand with 10 flags | `npx tsx src/cli/index.ts bench --help` | All 10 flags present: --prompts, --baseline, --thresholds, --reports-dir, --agent, --repeats, --since, --json, --update-baseline, --check-regression | PASS |
| All Phase 51 test files compile + pass | `npx vitest run src/performance/__tests__/slos.test.ts src/benchmarks/__tests__/ src/cli/commands/bench.test.ts src/manager/__tests__/daemon-latency-slo.test.ts` | 70/70 tests pass across 9 test files (slos 8, types 8, thresholds 8, prompts 5, harness 8, baseline 9, runner 5, bench CLI 12, daemon-slo 7) | PASS |
| prompts.yaml parses into 5 prompts | `yaml.parse` → check count | 5 prompts with expected ids | PASS |
| thresholds.yaml parses with 20% default + 2 segment overrides | `yaml.parse` → check shape | defaultP95MaxDeltaPct=20, 2 segments (context_assemble, tool_call) | PASS |
| bench.yml is valid YAML with pull_request trigger | `yaml.parse` → inspect keys | Name: "Bench — Latency Regression Gate", triggers: pull_request+workflow_dispatch, 7 steps in `bench` job | PASS |
| Dashboard has NO client-side SLO_LABELS mirror | `grep -c "SLO_LABELS" src/dashboard/static/app.js` | 0 | PASS |
| daemon.ts uses SLO imports from slos.ts | `grep -cn "mergeSloOverrides\|evaluateSloStatus\|DEFAULT_SLOS" src/manager/daemon.ts` | 8 occurrences — fully wired | PASS |
| bench-run-prompt registered in both protocol.ts AND protocol.test.ts | grep on both files | Both present — Phase 50 IPC dual-registration regression lesson preserved | PASS |
| Full `npm test` on clawdy (orchestrator-run) | `npm test` | 1144/1145 passing (1 pre-existing MCP TOOL_DEFINITIONS count failure, unrelated to Phase 51) | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PERF-03 | 51-01, 51-03 | Concrete SLO targets documented per surface (e.g., first-token p50 ≤ 2s, end-to-end p95 ≤ 6s) and displayed on the dashboard | SATISFIED | `DEFAULT_SLOS` at `src/performance/slos.ts:56` documents all 4 targets verbatim. Daemon emits per-segment `slo_status`, `slo_threshold_ms`, `slo_metric` via `augmentWithSloStatus` in both latency branches. Dashboard renders colored cells (cyan/red/gray) + "SLO target: N ms metric" subtitle, both driven by server emission (zero client-side mirror). Per-agent `perf.slos?` overrides surface end-to-end. |
| PERF-04 | 51-01, 51-02, 51-03 | CI benchmark harness runs a fixed prompt set and fails the build when p95 regresses beyond a configurable threshold | SATISFIED | `clawcode bench` registered with 10 flags. Isolated daemon lifecycle via tempdir HOME. `runBench` loads 5 prompts × N repeats, snapshots `/latency`, writes JSON report. `--check-regression` reads baseline + thresholds, exits 1 on regression. `--update-baseline` requires explicit y/yes confirmation (never auto-writes). `.github/workflows/bench.yml` invokes the gate on PR. Starter `.planning/benchmarks/prompts.yaml` + `thresholds.yaml` + `README.md` present. |

No orphaned requirements — REQUIREMENTS.md maps exactly PERF-03 + PERF-04 to Phase 51 (lines 73-74), both claimed by the plans above.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/benchmarks/runner.ts` | 160 | Comment "emit a {count: 0} placeholder row" | Info | Legitimate — `CANONICAL_SEGMENTS.map(...)` backfills missing segments with `{count: 0, p50/p95/p99: null}` to guarantee stable 4-row report shape. Not a stub; well-documented design per runner.test.ts test 4. |
| `src/benchmarks/__tests__/harness.test.ts` | 58 | Comment "Create a placeholder socket file" | Info | Test fixture — intentional placeholder for stop() idempotency test. Not production. |

No blocker anti-patterns. No TODO/FIXME/XXX/HACK markers in any Phase 51 production file. No empty `return null` / `=> {}` handlers. The two "placeholder" matches are documented design decisions for shape-stability + test isolation.

### Human Verification Required

Two items explicitly deferred by the user (per `51-03-SUMMARY.md` Task 4 table) — noted as deferred, not gating:

#### 1. Dashboard DOM eyeball

**Test:** Open the web dashboard in a real browser against a running daemon with live traces. Confirm the Latency panel renders per-segment SLO cells in cyan (healthy), red (breach), or gray (no_data), and the `SLO target: N ms metric` subtitle appears beneath each segment name.
**Expected:** Colors + subtitle update in real time; if a `perf.slos: [{ segment: end_to_end, metric: p95, thresholdMs: 4000 }]` override is added to a test agent's `clawcode.yaml`, BOTH the cell tint AND the subtitle reflect `4,000 ms p95` (not the 6,000 default).
**Why human:** Visual rendering, per-agent override behavior in a real browser, pixel-level color/typography verification.
**Why non-blocking:** Code path exhaustively tested via `daemon-latency-slo.test.ts` (7/7 GREEN) + `src/dashboard/__tests__/server.test.ts` regression assertions; dashboard app.js verified to read server-emitted fields with no client-side mirror (grep proved). User explicitly approved deferral ("I can take a look at the dashboard").

#### 2. CI workflow trigger on live GitHub Actions

**Test:** Push a no-op commit to a PR branch on GitHub, observe the `Bench — Latency Regression Gate` job running on the runner. After committing an initial baseline.json, introduce a synthetic regression and confirm the job exits non-zero.
**Expected:** Workflow triggers on `pull_request` for paths in src/**, package.json, .planning/benchmarks/**, .github/workflows/bench.yml. Permissive warn+pass when `baseline.json` missing (initial rollout). Strict fail (exit 1) once baseline + ANTHROPIC_API_KEY are in place and a regression exists.
**Why human:** Requires pushing to a remote with GitHub Actions available; simulating a regression is an operator exercise.
**Why non-blocking:** YAML syntactic validity already verified (`yaml.parse` succeeds, 7 bench steps, correct triggers). The `--check-regression` CLI path is covered by `bench.test.ts` (12 tests GREEN). User explicitly approved deferral pending first PR trigger.

### Gaps Summary

No gaps. All 4 success criteria satisfied; all must-have artifacts present and substantive; all key links wired; data flows from SQLite TraceStore through daemon merge logic to dashboard rendering with no static fallbacks. Requirements PERF-03 + PERF-04 fully covered by the three plans (51-01 foundation, 51-02 CLI harness + IPC, 51-03 dashboard + CI + starter kit).

The phase goal — *Latency wins are defended automatically — regressions break the build* — is achieved via the CI gate (bench.yml) calling `clawcode bench --check-regression`, which exits 1 on any tracked p95 regression beyond a configurable threshold versus the stored baseline. Baseline updates are explicit, auditable operator actions. Dashboard surfaces live SLO status with server-driven thresholds so per-agent overrides surface end-to-end.

`baseline.json` absence on disk is correct-by-design: Phase 51 delivers the ratchet mechanism; first-run bootstrap (`clawcode bench --update-baseline` → commit) is an operational step documented in `.planning/benchmarks/README.md` and gracefully handled by the permissive-rollout CI gate.

Two deferred human verifications (dashboard visual + first PR trigger) are non-blocking — the user explicitly approved proceeding and the code paths are exhaustively test-covered.

---

*Verified: 2026-04-13T21:52:00Z*
*Verifier: Claude (gsd-verifier)*
