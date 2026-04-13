---
phase: 50-latency-instrumentation
plan: 00
subsystem: testing
tags: [vitest, tdd, red-green-refactor, tracing, sqlite, percentiles]

# Dependency graph
requires:
  - phase: prior validation strategy definition
    provides: 50-VALIDATION.md per-task verification map with exact -t filter strings
provides:
  - Ten Wave 0 test files (6 new, 4 appended) that fail in expected RED state
  - Interface contracts for TraceCollector, TraceStore, parseSinceDuration, sinceToIso, LatencyReport
  - Behavior contracts for DiscordBridge tracing, SdkSessionAdapter tracing, context-assembler tracing, scheduler tracing
  - Dashboard GET /api/agents/:name/latency route contract
  - clawcode latency CLI command contract
  - trace-retention heartbeat check contract
  - Nyquist-compliant automated verify hooks for every Wave 1/2/3 task
affects: [50-01, 50-02, 50-02b, 50-03]

# Tech tracking
tech-stack:
  added: []  # Wave 0 adds only tests — no runtime deps
  patterns:
    - "Wave 0 RED scaffolding: tests reference Wave 1/2 exports so imports fail until later waves land"
    - "Test name convention: exact -t filter substrings embedded in describe/it names (receive span, first_token, tool_call, subagent, cascade, persists, daemon-restart, since parser, tracing, trace, latency, json, all)"
    - "APPEND-ONLY edits to pre-existing test files (context-assembler, scheduler, server) with explicit comment banner for orientation"
    - "Mid-file import statements for Wave 2-added exports marked with @ts-expect-error for RED state without breaking TypeScript compilation"

key-files:
  created:
    - src/performance/__tests__/trace-collector.test.ts
    - src/performance/__tests__/trace-store.test.ts
    - src/performance/__tests__/trace-store-persistence.test.ts
    - src/performance/__tests__/percentiles.test.ts
    - src/cli/commands/__tests__/latency.test.ts
    - src/heartbeat/checks/__tests__/trace-retention.test.ts
    - src/discord/__tests__/bridge.test.ts
    - src/manager/__tests__/session-adapter.test.ts
  modified:
    - src/dashboard/__tests__/server.test.ts
    - src/manager/__tests__/context-assembler.test.ts
    - src/scheduler/__tests__/scheduler.test.ts

key-decisions:
  - "Dedicated trace-store-persistence.test.ts for daemon-restart semantic (PERF-01 success criterion #4)"
  - "Imported Wave 2-only symbols (assembleContextTraced, createTracedSessionHandle) with @ts-expect-error to force clean RED"
  - "APPEND mode on pre-existing files — top-level describe count increased by exactly 1 per file; original tests untouched and still green"
  - "Mix of 'red-by-missing-import' and 'red-by-failing-assertion' is honest RED; both categories are intentional"
  - "Test name substrings chosen to match the exact -t filter strings in 50-VALIDATION.md (receive span, first_token, tool_call, subagent, cascade, persists, daemon-restart, since parser, tracing, trace, latency, json, all)"

patterns-established:
  - "Pattern: Wave 0 RED scaffolding — failing tests are the interface contract future waves must satisfy"
  - "Pattern: Test name substrings as API surface — each -t filter in VALIDATION map resolves to exactly one describe/it match"
  - "Pattern: Per-agent SQLite test harness — mkdtempSync tmpdir + rmSync teardown (mirrors src/usage/tracker.test.ts)"
  - "Pattern: Additive describe blocks on shared test files to avoid touching existing tests"

requirements-completed: [PERF-01, PERF-02]

# Metrics
duration: 10min
completed: 2026-04-13
---

# Phase 50 Plan 00: Wave 0 Test Scaffolding Summary

**Ten RED test files scaffolded (6 new + 4 APPEND-only) with exact describe/it names matching every `-t` filter in 50-VALIDATION.md; downstream Wave 1/2/3 can now follow strict TDD.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-13T17:17:59Z
- **Completed:** 2026-04-13T17:27:32Z
- **Tasks:** 3 (all auto, no checkpoints)
- **Files modified:** 11 (8 created + 3 appended)

## Accomplishments

- All automated verify commands referenced in 50-VALIDATION.md now resolve to a real scaffolded test
- Dedicated daemon-restart persistence test closes PERF-01 success criterion #4 (opens a NEW `TraceStore` on the same path and reads back from fresh prepared-statement cache)
- Every `-t` filter string in the validation map has a matching `describe` or `it` name (receive span, first_token, tool_call, subagent, cascade, persists, daemon-restart, since parser, tracing, trace, latency, json, all)
- Pre-existing tests in `src/dashboard/__tests__/server.test.ts`, `src/manager/__tests__/context-assembler.test.ts`, and `src/scheduler/__tests__/scheduler.test.ts` remain green — zero regression
- Interface contracts established for Wave 1 (TraceCollector, TraceStore, percentiles helpers, clawcode latency CLI, trace-retention heartbeat) and Wave 2 (DiscordBridge tracing, SdkSessionAdapter tracing, assembleContextTraced, scheduler turnId prefix)

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold performance/ subsystem tests** — `cb13d82` (test)
   - 4 files in `src/performance/__tests__/`: trace-collector, trace-store, trace-store-persistence, percentiles
2. **Task 2: Scaffold CLI latency + retention heartbeat + dashboard latency block** — `3c079de` (test)
   - 2 new files (latency.test.ts, trace-retention.test.ts) + APPEND to server.test.ts
3. **Task 3: Scaffold Wave 2 hot-path tests** — `5dc2f20` (test)
   - 2 new files (bridge.test.ts, session-adapter.test.ts) + APPEND to context-assembler.test.ts & scheduler.test.ts

**Plan metadata:** _(see final metadata commit below)_

_Note: This plan is test-only (no source code yet). All three task commits are `test(...)` type._

## Files Created/Modified

### Created

| Path | Test Count | Describe/It Summary |
|------|------------|---------------------|
| `src/performance/__tests__/trace-collector.test.ts` | 7 | `describe("TraceCollector")` — startTurn, startSpan, duration recording, single writeTurn commit, freeze semantics, error status, metadata passthrough |
| `src/performance/__tests__/trace-store.test.ts` | 8 | `describe("TraceStore")` — WAL+FK pragmas, schema init, batched writeTurn, idempotency, pruneOlderThan, cascade, persists across reopen, getPercentiles |
| `src/performance/__tests__/trace-store-persistence.test.ts` | 3 | `describe("TraceStore daemon-restart persistence")` — fresh-store open on same path, schema idempotency across 3 reopens, WAL checkpoint persistence |
| `src/performance/__tests__/percentiles.test.ts` | 7 | `describe("parseSinceDuration")` (1h/6h/24h/7d, 30m/90s, invalid throws) + `describe("sinceToIso")` (relative to now, 7d offset) + `describe("percentile SQL math")` (100-row p50/p95/p99, tool_call.* aggregation) |
| `src/cli/commands/__tests__/latency.test.ts` | 6 | `describe("clawcode latency")` — IPC invocation, --since 7d, --json output, --all flag, 4-segment table, ms unit suffix |
| `src/heartbeat/checks/__tests__/trace-retention.test.ts` | 6 | `describe("trace-retention check")` — name export, no-config/no-store graceful, cutoff math with fake timers, 7-day default, metadata with deleted count |
| `src/discord/__tests__/bridge.test.ts` | 4 | `describe("DiscordBridge tracing")` — receive span, end_to_end success/error, no-collector no-op |
| `src/manager/__tests__/session-adapter.test.ts` | 5 | `describe("SdkSessionAdapter tracing")` — first_token, tool_call, subagent filter, end_to_end, sendAndCollect parity |

### Modified (APPEND ONLY — existing tests untouched)

| Path | Top-level describes before → after | New describe block |
|------|-----------------------------------|--------------------|
| `src/dashboard/__tests__/server.test.ts` | 1 → 2 | `describe("latency endpoint")` — 4 tests (200 with payload, 24h default, 7d passthrough, 500 on IPC error) |
| `src/manager/__tests__/context-assembler.test.ts` | 4 → 5 | `describe("context_assemble tracing")` — 3 tests (span lifecycle + finally + no-op when turn undefined) |
| `src/scheduler/__tests__/scheduler.test.ts` | 1 → 2 | `describe("scheduler tracing")` — 4 tests (scheduler: prefix, null channelId, success/error end) |

### Baseline Regression Guard

Pre-existing test counts before Wave 0 vs. after:

| File | Existing `describe(` blocks before | After | Existing tests still passing |
|------|------------------------------------|-------|------------------------------|
| `src/dashboard/__tests__/server.test.ts` | 1 (`Dashboard Server`, 7 tests) | 2 (1 appended) | 7 of 7 ✓ |
| `src/manager/__tests__/context-assembler.test.ts` | 4 (15 tests) | 5 (1 appended) | 15 of 15 ✓ |
| `src/scheduler/__tests__/scheduler.test.ts` | 1 (12 tests) | 2 (1 appended) | 12 of 12 ✓ |

All 34 pre-existing tests continue to pass. Only new `latency:` / `tracing` / `trace:` test names fail, as required by RED state.

## Decisions Made

- **Dedicated persistence test file:** Created `trace-store-persistence.test.ts` in addition to the `persists across reopen` test inside `trace-store.test.ts`. The dedicated file explicitly exercises a fresh `TraceStore` instance on the same path (simulating daemon restart), which the sibling test may not if implementation reuses statement caches. This closes the PERF-01 success criterion #4 gap flagged by the checker.
- **Wave 2 export sentinels:** Used `createTracedSessionHandle` (session-adapter) and `assembleContextTraced` (context-assembler) as Wave 2-added import sentinels. Both are marked `@ts-expect-error` so the TypeScript compilation proceeds cleanly even while the symbols are missing — giving a clean runtime RED ("not a function" or "Cannot find name") rather than a TS compile blowout.
- **Test name substrings as the contract:** Every `-t` filter in 50-VALIDATION.md (e.g., `-t "first_token"`, `-t "cascade"`, `-t "tracing"`) is verbatim embedded in at least one scaffolded test name. Verified by spot-checking each filter resolves to a real failing test in vitest output.
- **Mid-file `import` for append blocks:** The appended describe blocks in context-assembler.test.ts need `vi` and the Wave 2 export; adding them as mid-file imports (hoisted by ES module semantics) avoids touching the existing top-of-file imports, preserving the APPEND-only promise.

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria met:

- All 11 test files exist ✓
- All exact describe/it names required by the plan are present ✓
- All `-t` filters resolve ✓
- RED state confirmed (19 new failing tests across the scaffolded files) ✓
- Pre-existing tests remain green (34 of 34) ✓
- No `.skip`, `.only`, `--watch` flags used ✓
- All relative imports use `.js` extension ✓

## Issues Encountered

None during execution. One minor implementation detail worth noting for downstream waves:

- The current `SdkSessionAdapter` uses a narrowed local `SdkStreamMessage` type where `msg.content` is `string`. Wave 2 will need to switch to content-block inspection (`BetaToolUseBlock[]`, `content_block_delta` for first_token detection) per the RESEARCH.md `Pattern 3` guidance. The Wave 0 test expects the Wave 2 export signature `createTracedSessionHandle({ sdk, baseOptions, sessionId, turn })` — Wave 2 implementers may choose a different shape but must at minimum accept an optional `turn` injection point.

## User Setup Required

None — no external service configuration required for Wave 0 test scaffolding.

## Next Phase Readiness

- Wave 1 (plan 50-01) can begin: every source file Wave 1 needs to create has a matching RED test ready to turn green.
- Wave 2 (plans 50-02 and 50-02b) has scaffolded hot-path tracing tests (bridge, session-adapter, context-assembler, scheduler) ready to exercise.
- Wave 3 (plan 50-03) has CLI and dashboard tests in place; the dashboard test's 4 new `latency:` tests will turn green once `server.ts` routes the endpoint and `daemon.ts` exposes the `latency` IPC method.
- `50-VALIDATION.md` can flip `wave_0_complete: true` in its frontmatter.

## Self-Check: PASSED

All created test files present at expected paths. All three task commits (cb13d82, 3c079de, 5dc2f20) recorded in `git log`. 11 files tracked, 19 RED failures confirmed, 34 pre-existing tests still green.

---
*Phase: 50-latency-instrumentation*
*Plan: 00*
*Completed: 2026-04-13*
