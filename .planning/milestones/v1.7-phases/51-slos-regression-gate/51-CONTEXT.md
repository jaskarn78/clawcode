# Phase 51: SLOs & Regression Gate - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning
**Mode:** Smart discuss — all 4 grey areas accepted as recommended

<domain>
## Phase Boundary

Defend latency wins automatically. Lock Phase 50's measurement substrate into a ratchet: document SLO targets, surface them on the dashboard with red/green indicators against live percentiles, add a `clawcode bench` CLI that runs a fixed prompt set through an isolated daemon and produces a reproducible report, store a baseline in git that requires explicit operator action to update, and make the CI job fail when any tracked p95 regresses beyond a configurable threshold.

Scope lines:
- IN: SLO source of truth, dashboard status indicators, `clawcode bench` + `--update-baseline` + `--check-regression`, baseline file under git, thresholds config, CI-gate exit-code contract, per-prompt JSON + console report.
- OUT: Optimizations themselves (Phase 52-56), cross-repo benchmark aggregation, offline/mocked LLM modes (Phase 52+ may add them if needed), sparkline/trend visualization.

</domain>

<decisions>
## Implementation Decisions

### SLO Definitions & Surfacing
- **SLO storage:** Single source of truth at `src/performance/slos.ts` — exports `DEFAULT_SLOS: readonly SloEntry[]`, imported by both dashboard and CI gate.
- **Default SLOs:**
  - `end_to_end` p95 ≤ 6000ms
  - `first_token` p50 ≤ 2000ms
  - `context_assemble` p95 ≤ 300ms
  - `tool_call` p95 ≤ 1500ms
- **Dashboard indicator:** The `/api/agents/:name/latency` response gains `slo_status: "healthy" | "breach" | "no_data"` per segment. Dashboard colors the percentile cell cyan (healthy) / red (breach) / gray (no_data) and adds a subtitle "SLO target: {threshold} ms {metric}" under each row.
- **Config override:** Extend the Zod `perf` object with optional `slos?: Array<{segment, metric, thresholdMs}>`. Merge is per-segment override (not full replacement). Canonical segment names validated at schema parse.

### CI Benchmark Harness
- **CLI surface:** New `clawcode bench` subcommand. Registered in `src/cli/commands/bench.ts` + `src/cli/index.ts`.
- **Prompt set:** `.planning/benchmarks/prompts.yaml` — versioned with the repo for reproducibility. Start with 5 representative prompts:
  1. No-tool short reply
  2. Single tool-call (memory_lookup)
  3. Multi-tool chain (memory_lookup + search_documents)
  4. Subagent spawn
  5. Long-context warm reply (context-heavy prompt)
- **Bench agent:** Dedicated `bench-agent` entry — isolated from real agents. Uses `haiku` (fast, cheap, sensitive to regressions). Can be overridden via `--agent <name>` flag.
- **Report format:** JSON at `.planning/benchmarks/reports/<timestamp>.json` plus pretty console summary. Schema: `{ run_id, started_at, git_sha, node_version, prompt_results: [{ id, turnIds, percentiles }], overall_percentiles }`.

### Baseline Storage & Regression Gate
- **Baseline file:** `.planning/benchmarks/baseline.json` — tracked in git. Schema: `{ updated_at, updated_by, git_sha, overall_percentiles, per_prompt_percentiles? }`. Committing is an explicit PR-visible action.
- **Thresholds:** `.planning/benchmarks/thresholds.yaml` — per-segment `p95_max_delta_pct` (default 20%). Optional `p95_max_delta_ms` absolute floor for noisy segments (`context_assemble`). Validated via Zod at load time.
- **Baseline update UX:** `clawcode bench --update-baseline` flag — prints current baseline vs new report (ASCII diff table), prompts for confirmation, writes `baseline.json` with current `git_sha` and user (`os.userInfo().username`). Emits a commit hint ready for copy-paste: `git add .planning/benchmarks/baseline.json && git commit -m "perf(bench): update baseline (...)"`. Never auto-writes.
- **CI gate:** `clawcode bench --check-regression` flag — reads report + baseline + thresholds, exits 1 with a formatted diff table if any segment exceeds threshold, exits 0 if clean. Designed to be invoked from `.github/workflows/ci.yml` (if present) or any CI runner.

### Determinism & CI Environment
- **Bench daemon lifecycle:** Harness spawns its own isolated daemon via a tempdir-scoped config + tempdir socket. Tears down on completion (success or failure). No reliance on user's long-running daemon — reproducible anywhere.
- **Model non-determinism:** Accept it. Run each prompt N=5 times per bench invocation (configurable via `--repeats <N>`). Percentiles smooth over outliers. Single-run outliers ≠ regression. CI gate evaluates aggregate percentiles only.
- **Network dependency:** Bench requires live Anthropic API access (via Claude Code OAuth). No offline mode in Phase 51 — deferred to a later milestone if needed. Emit a clear error if auth is missing.
- **Baseline reviewability:** Baseline update commit message includes: old-vs-new percentile diff table, benchmark `run_id`, operator user. CLI emits the ready-to-use commit message template so reviewability is frictionless.

### Claude's Discretion
- File organization within `src/benchmarks/` vs inlining under `src/cli/commands/bench.ts` — prefer a new `src/benchmarks/` directory for >1 file of logic.
- Exact JSON schema for `baseline.json` / `report.json` — derive from Zod schema in `src/benchmarks/types.ts`.
- Whether bench streams progress inline or prints once at the end — pick whichever is cleaner.
- Test fixture layout (`__tests__/fixtures/bench-baseline.json` etc).
- Whether `--update-baseline` is a subcommand flag or a separate `clawcode bench update` sub-subcommand — either is fine; lean toward flag for CLI economy.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/performance/percentiles.ts`** — `parseSinceDuration`, `percentileFromRows`, segment constants. Reuse for the bench CLI's time-window handling and report aggregation.
- **`src/performance/trace-store.ts`** — `getPercentiles({ agent, since })` returns exactly the shape we need. Bench harness runs its prompts then queries this for the report.
- **`src/performance/trace-collector.ts`** — Already emits per-turn spans during real agent runs. The bench harness triggers real turns through the SessionManager, so span capture is automatic.
- **`src/cli/commands/costs.ts`** — CLI-output precedent (pretty table + `--json`). The bench report formatter mirrors this.
- **`src/cli/commands/latency.ts`** — Even closer precedent: --since/--all/--json + canonical-segment table formatting.
- **`src/config/schema.ts`** — Extend `perf` with `slos?` and add the bench-related config (if any — can also live entirely in `.planning/benchmarks/`).
- **`src/manager/daemon.ts`** — Bench harness spawns a daemon using the same `startDaemon` entry; wiring is existing.
- **`src/dashboard/server.ts` + `src/dashboard/static/app.js`** — Extend the existing /latency endpoint to include `slo_status` per segment; extend the Latency panel to color cells + show SLO threshold subtitle.

### Established Patterns
- Per-agent SQLite stores, prepared statements, `Object.freeze` returns.
- Zod v4 (`zod/v4`) for schema + `z.infer<>` for types.
- CLI commands in `src/cli/commands/<name>.ts`, registered from `src/cli/index.ts`.
- Atomic commits per task.
- ESM `.js` extension on relative imports.

### Integration Points
- **Dashboard:** `src/dashboard/server.ts` `/api/agents/:name/latency` — augment response with `slo_status` per segment row.
- **Dashboard UI:** `src/dashboard/static/app.js` Latency panel rendering — colorize cells, add SLO target subtitle line.
- **CLI:** `src/cli/index.ts` — register the new `bench` command.
- **Daemon:** `src/manager/daemon.ts` — may need new IPC methods for the bench harness to trigger turns programmatically (e.g., `bench-run-prompt` with a one-shot prompt + agent args). Alternatively the bench harness uses the existing `send-message`/streaming IPC methods.
- **CI workflow:** `.github/workflows/ci.yml` (if absent, create a minimal one invoking `clawcode bench --check-regression`). If repo has a different CI provider, document integration.

</code_context>

<specifics>
## Specific Ideas

- **Report + baseline shared schema** — a `BenchReport` Zod schema in `src/benchmarks/types.ts` doubles as the baseline shape; baseline is just a frozen historical report plus provenance fields (`updated_by`, `updated_at`, `git_sha`). Ensures diff logic is symmetric.
- **Thresholds split from baseline** — thresholds.yaml is SEPARATE from baseline.json. Changing thresholds (policy) must be reviewable independently from rolling the baseline (measurement). Both are git-tracked; both require explicit commits.
- **run_id provenance** — every bench invocation mints a nanoid `run_id`. Reports include it. CI logs reference it. If a regression is found, the operator can download the exact report to reproduce.
- **Default prompt set stays small** — 5 prompts × 5 repeats = 25 turns per bench. Haiku keeps that cheap. Scaling beyond is a future concern.

</specifics>

<deferred>
## Deferred Ideas

- Offline / mocked-LLM bench mode — accepted as Phase 52+ if cost or flakiness becomes a CI blocker.
- Trend graphs (sparklines over historical reports) — future milestone.
- Cross-agent aggregate SLOs — YAGNI for now; per-agent is enough.
- Automatic baseline update when all thresholds drop by >X% (efficiency celebration) — too magical for Phase 51; keep updates explicit.
- Alerting / paging on breach (Slack / PagerDuty) — out of scope.
- External APM / OpenTelemetry export — deferred.

</deferred>
