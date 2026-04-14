---
phase: 54-streaming-typing-indicator
plan: 03
subsystem: discord, benchmarks
tags: [streaming-cadence, first-visible-token, rate-limit-backoff, progressive-message-editor, bench-regression-gate, stream-01, stream-02]

# Dependency graph
requires:
  - phase: 54-01
    provides: streamingConfigSchema + StreamingConfig type + ResolvedAgentConfig.perf.streaming inline TS mirror + first_visible_token canonical segment + bench segmentEnum kept at 4 names
  - phase: 50-02
    provides: Caller-owned Turn lifecycle into streamAndPostResponse + Turn.startSpan API
  - phase: 51-02
    provides: Bench harness + runner + bench-run-prompt IPC handler + baseline.json + --check-regression hard-fail path
provides:
  - ProgressiveMessageEditor with 750ms default (down from 1500ms), per-agent editIntervalMs override, first_visible_token span emission on first editFn call, rate-limit error detection + doubling backoff per turn, single pino.WARN per turn on rate-limit hit
  - Exported isDiscordRateLimitError(err) helper — centralizes DiscordAPIError code 20028 / HTTP 429 / RateLimitError name detection
  - streamAndPostResponse wires agentConfig.perf.streaming.editIntervalMs + maxLength into the editor, passes Turn for first_visible_token span emission
  - benchReportSchema gains optional rate_limit_errors counter (backward-compat)
  - runner.ts BACKWARD_COMPAT_BENCH_SEGMENTS — the 4-segment filter that keeps overall_percentiles shape compatible with committed baseline.json
  - bench --check-regression hard-fails on rate_limit_errors > 0 with CONTEXT-verbatim message
  - baseline.ts formatDiffTable aligned to same 4-segment BENCH_DIFF_SEGMENTS list (fix: pre-existing diff-rendering bug from Phase 54-01 CANONICAL_SEGMENTS expansion)
  - daemon.ts bench-run-prompt response shape extended with rate_limit_errors: number (forward-compat hook — always 0 today because bench-agent has no Discord binding; isDiscordRateLimitError imported for reuse if/when bench exercises Discord edit pipeline)
affects: [54-04]

# Tech tracking
tech-stack:
  added: []  # No new runtime dependencies
  patterns:
    - "Floor-at-Zod, default-at-consumer — 300ms floor on editIntervalMs at schema load (Plan 54-01); 750ms default lives in ProgressiveMessageEditor (Plan 54-03). Separation keeps schema shape minimal + default collocated with code that applies it."
    - "Per-editor-instance backoff state — doubling editIntervalMs lives on the mutable instance field, reset naturally because streamAndPostResponse constructs a fresh editor per turn (no cross-turn state leak)."
    - "Single-WARN-per-turn rate-limit log throttle — boolean flag (rateLimitWarnEmitted) gates the pino.warn so a rate-limit storm does not blow up log volume regardless of edit count."
    - "Centralized error-shape detection via isDiscordRateLimitError — three discord.js shapes (code 20028, status 429, RateLimitError name) in one helper, reused in both streaming.ts (editor backoff) and daemon.ts (bench forward-compat)."
    - "Bench runner segment divergence — runner writes the 4-name BACKWARD_COMPAT_BENCH_SEGMENTS shape in overall_percentiles so baseline.json Zod parse keeps working; per-prompt percentiles preserve the full 6-name shape for debugging."
    - "Forward-compat IPC shape — daemon bench-run-prompt response gains rate_limit_errors: 0 even though no producer exists today; the wire is ready for a future bench path that exercises the Discord edit pipeline."

key-files:
  created:
    - src/discord/__tests__/streaming.test.ts
  modified:
    - src/discord/streaming.ts
    - src/discord/bridge.ts
    - src/discord/__tests__/bridge.test.ts
    - src/benchmarks/types.ts
    - src/benchmarks/runner.ts
    - src/benchmarks/baseline.ts
    - src/benchmarks/__tests__/types.test.ts
    - src/benchmarks/__tests__/runner.test.ts
    - src/cli/commands/bench.ts
    - src/cli/commands/bench.test.ts
    - src/manager/daemon.ts

key-decisions:
  - "Phase 54 Plan 03 — `DEFAULT_EDIT_INTERVAL_MS = 750` declared as a top-level const in src/discord/streaming.ts (line 66). The prior 1500ms comment was removed from the file so `grep -c '1500' src/discord/streaming.ts` returns 0 — the new default is the only cadence number in the source."
  - "Phase 54 Plan 03 — `editIntervalMs` changed from `readonly` to mutable private field so rate-limit backoff can double it per turn. Fresh editor per turn (streamAndPostResponse constructs one each time) means the doubled value resets naturally on the next message — no cross-turn cleanup code needed."
  - "Phase 54 Plan 03 — `isDiscordRateLimitError` is an exported module-level function (not a class method) because it has zero dependencies on editor state; it's imported into src/manager/daemon.ts for reuse in the bench-run-prompt handler forward-compat branch."
  - "Phase 54 Plan 03 — `first_visible_token` span emission lives ONLY in streaming.ts (inside the update() method before the first editFn call). bridge.ts passes the Turn through but does not call startSpan for first_visible_token — verified by `grep -c 'first_visible_token' src/discord/bridge.ts` returning 0. Keeps the responsibility where the actual first-visible moment happens (the first editFn call is the first Discord-visible chunk)."
  - "Phase 54 Plan 03 — first_visible_token span is opened AND ended synchronously on the same update() call, then `void this.editFn(text).catch(...)` fires. Span duration captures ONLY the scheduling cost — the actual network round-trip to Discord is async and does not inflate the measurement. This matches the typing_indicator span pattern from Plan 54-02 (span closes synchronously right after fire, captures fire latency only)."
  - "Phase 54 Plan 03 — rate-limit backoff DOUBLES editIntervalMs on ANY rate-limit classified by isDiscordRateLimitError. Non-rate-limit rejections (permission errors, network timeouts, etc.) are silently swallowed per the pre-plan non-fatal behavior. Test 9 asserts this distinction."
  - "Phase 54 Plan 03 — single pino.WARN per editor instance via rateLimitWarnEmitted boolean flag. Subsequent rate-limit hits still DOUBLE the interval but stay silent in the log stream. Prevents log spam during a rate-limit storm while still preserving observability of the first hit per turn."
  - "Phase 54 Plan 03 — bench runner's overall_percentiles filter uses a hardcoded `BACKWARD_COMPAT_BENCH_SEGMENTS` const (4 names) rather than importing CANONICAL_SEGMENTS. Per Plan 54-01 SUMMARY decision: bench enum + trace-store canonical list are intentionally divergent. Using a hardcoded 4-name list at the runner boundary makes the divergence explicit and grep-able."
  - "Phase 54 Plan 03 — `rate_limit_errors` field on the BenchReport is OPTIONAL (z.number().int().nonnegative().optional()) rather than required. Keeps pre-Phase-54 reports + baselines parseable under the new schema. The --check-regression guard uses `?? 0` fallback so a missing field is treated as clean."
  - "Phase 54 Plan 03 — rate-limit hard-fail fires BEFORE the existing p95 delta check + BEFORE the baseline-required check. A non-zero rate_limit_errors is an absolute failure regardless of baseline presence (if there are rate-limit errors, the run is broken regardless of whether a baseline exists to compare against)."
  - "Phase 54 Plan 03 — baseline.ts formatDiffTable aligned to the same 4-segment BENCH_DIFF_SEGMENTS list as the runner. This fixed 2 tsc errors and 1 pre-existing test failure introduced by Phase 54-01's CANONICAL_SEGMENTS expansion. The bench universe (report + baseline + diff rendering) now consistently uses 4 segments; the runtime trace-store universe uses 6."
  - "Phase 54 Plan 03 — daemon.ts bench-run-prompt handler returns `rate_limit_errors: 0` as a forward-compat hook. Bench agents have no Discord channel binding today (no streaming pipeline exercised during bench) so the count is always 0. The wire exists so future bench variants that DO exercise the Discord edit pipeline can populate it without an IPC shape change. `isDiscordRateLimitError` is imported and used in the catch branch for symmetry even though the non-Discord bench path makes it almost unreachable in practice."
  - "Phase 54 Plan 03 — ZERO new IPC methods. `grep -c 'IPC_METHODS\\|IpcMethod' src/discord/streaming.ts src/discord/bridge.ts` returns 0. `git diff -- src/ipc/protocol.ts` is empty. Per Phase 50 regression lesson."

patterns-established:
  - "Pattern: Per-turn editor instance as the backoff boundary — mutable per-instance state (editIntervalMs, rateLimitWarnEmitted, firstVisibleTokenEmitted) naturally resets because a fresh editor is constructed per Discord message turn. No explicit cleanup, no cross-turn leak, no timer-based reset logic."
  - "Pattern: Centralized error-shape helper — isDiscordRateLimitError detects ALL three documented discord.js rate-limit shapes (code 20028, HTTP 429, RateLimitError name) in one place. Reusable across modules (editor + daemon) without duplicating the detection logic."
  - "Pattern: Forward-compat shape hook — add a new field to an IPC response even when no producer exists today, so downstream consumers (bench runner + --check-regression gate) can be wired now. The wire stays dormant at zero until a producer starts populating it."
  - "Pattern: Dual-segment lists at an intentional boundary — runtime trace universe uses CANONICAL_SEGMENTS (6 names); bench universe uses BACKWARD_COMPAT_BENCH_SEGMENTS + BENCH_DIFF_SEGMENTS (4 names). The divergence is explicit, grep-able, and documented in multiple SUMMARY files. Bench baseline.json backward compat is preserved at the price of two const-list declarations."
  - "Pattern: Single-WARN-per-turn throttle — boolean flag gates a pino.warn so a log-storm is avoided. First hit gets the signal, subsequent hits still apply the behavioral change (doubling) but stay silent."

requirements-completed: [STREAM-01, STREAM-02]

# Metrics
duration: 11m 11s
completed: 2026-04-14
---

# Phase 54 Plan 03: Streaming Cadence + first_visible_token Span + Rate-Limit Backoff + Bench Regression Gate Summary

**ProgressiveMessageEditor default editIntervalMs drops 1500 -> 750ms with a per-agent override wired through `agentConfig.perf.streaming.editIntervalMs` (300ms floor enforced by Zod in Plan 54-01); first_visible_token span emitted once per editor on the first editFn call; rate-limit errors (DiscordAPIError code 20028, HTTP 429, RateLimitError) DOUBLE the interval for the rest of the turn via isDiscordRateLimitError + a single pino.WARN per editor; bench report carries rate_limit_errors counter; --check-regression hard-fails on non-zero with the CONTEXT-verbatim message; runner overall_percentiles filtered to the 4 Phase 51 segments so baseline.json Zod parse keeps working; zero new IPC methods.**

## Performance

- **Duration:** ~11 min 11 sec
- **Started:** 2026-04-14T03:22:02Z
- **Completed:** 2026-04-14T03:33:13Z
- **Tasks:** 2 (both `auto` + `tdd`, no checkpoints)
- **Files modified:** 11 (1 created + 10 edited)

## Accomplishments

- **DEFAULT_EDIT_INTERVAL_MS dropped 1500 -> 750ms** at `src/discord/streaming.ts:66`. Per CONTEXT D-05. `grep -c "1500" src/discord/streaming.ts` returns 0 — the only cadence number in the source is the new 750 default.
- **`isDiscordRateLimitError(err: unknown): boolean` exported** at `src/discord/streaming.ts:57`. Centralizes detection of the 3 discord.js rate-limit shapes: `code === 20028`, `status === 429`, `name === "RateLimitError"`. Safe for any `unknown` value (null/undefined/non-object returns false). Imported by `src/manager/daemon.ts` bench-run-prompt handler for forward-compat reuse.
- **ProgressiveEditorOptions extended** with optional `turn`, `log`, `agent`, `turnId` fields. All optional — existing callers continue to work without modification.
- **`editIntervalMs` changed from readonly to mutable** private field so rate-limit backoff can double it per turn. Fresh editor per turn (streamAndPostResponse constructs one each Discord message) means the doubled value naturally resets — no explicit cleanup.
- **first_visible_token span emission** in `ProgressiveMessageEditor.update()` (streaming.ts:115-129). Fires ONCE per editor instance on the FIRST editFn call. Wrapped in try/catch so trace-setup races never propagate. `span?.end()` fires synchronously so the span duration captures ONLY the scheduling cost (matches Plan 54-02 typing_indicator pattern).
- **Rate-limit backoff** in `ProgressiveMessageEditor.handleEditError()` (streaming.ts:155-179). On rate-limit detection: `this.editIntervalMs = prev * 2`. Single pino.WARN per editor instance via `rateLimitWarnEmitted` boolean. Non-rate-limit rejections stay silent (preserves pre-plan non-fatal behavior).
- **bridge.ts `streamAndPostResponse` wires agent config** into the editor (bridge.ts:494-517). Reads `agentConfig.perf?.streaming` via the existing `sessionManager.getAgentConfig(sessionName)` call, passes `editIntervalMs` + `maxLength` + `turn` + `log` + `agent` + `turnId` into the ProgressiveMessageEditor constructor. Turn-piggybacked first_visible_token span emission lives in streaming.ts only (bridge.ts count of `first_visible_token` = 0 per acceptance criterion).
- **benchReportSchema extended** with `rate_limit_errors: z.number().int().nonnegative().optional()` at `src/benchmarks/types.ts:76-83`. Backward compat: pre-Phase-54 reports + baselines without this field still parse (it's optional).
- **runner.ts accumulates rate_limit_errors** across every bench-run-prompt response (runner.ts:181-183 sums + runner.ts:267 stamps on report).
- **runner.ts BACKWARD_COMPAT_BENCH_SEGMENTS 4-filter** (runner.ts:65-76 declaration + runner.ts:223 use). Overall_percentiles is mapped from 4 hardcoded names rather than `CANONICAL_SEGMENTS` (6 names) so baseline.json Zod parse keeps working. Per-prompt `promptResults.percentiles` stays verbatim from the latency IPC (preserves the full 6-segment shape for per-prompt debugging).
- **bench.ts `--check-regression` hard-fail** on `rate_limit_errors > 0` (bench.ts:283-293). Fires BEFORE the existing p95 delta check + BEFORE the baseline-required check. The error message text matches CONTEXT verbatim: `"Streaming cadence triggered {N} Discord rate-limit error(s) — consider raising \`perf.streaming.editIntervalMs\` or reverting the cadence change"`.
- **baseline.ts formatDiffTable aligned to the same 4-segment list** (baseline.ts:34-45 new BENCH_DIFF_SEGMENTS + baseline.ts:132 substitution). This fixed 2 pre-existing tsc errors (pre-existing from Phase 54-01 CANONICAL_SEGMENTS expansion) AND 1 pre-existing test failure (`formatDiffTable > returns "(no baseline yet)" for all segments when baseline is null` now passes 4-occurrence count).
- **daemon.ts bench-run-prompt forward-compat hook** — response shape extended with `rate_limit_errors: 0` (daemon.ts:1351-1353). Bench agents have no Discord binding today so the count is always 0, but the shape is ready. `isDiscordRateLimitError` imported from `src/discord/streaming.js` at daemon.ts:84 and used in the error branch (daemon.ts:1362-1364) for symmetry.
- **Zero new IPC methods.** Verified via `git diff -- src/ipc/protocol.ts` (empty) and `grep -c "IPC_METHODS\|IpcMethod" src/discord/streaming.ts src/discord/bridge.ts` = 0. Per Phase 50 regression lesson.

## Task Commits

Each task was committed atomically (TDD RED + GREEN per task):

1. **Task 1 RED: failing streaming cadence + first_visible_token + rate-limit backoff tests** — `45d40db` (test)
   - `src/discord/__tests__/streaming.test.ts` — NEW file with 5 isDiscordRateLimitError tests + 12 ProgressiveMessageEditor tests (750ms default, editIntervalMs override, first_visible_token span emission once per editor, rate-limit doubling, cumulative doubling, single WARN, flush regression)
   - `src/discord/__tests__/bridge.test.ts` — 2 bridge integration tests in a new `streamAndPostResponse streaming cadence wire (Phase 54)` describe block
   - 12 failing at RED (5 isDiscordRateLimitError + 7 ProgressiveMessageEditor) + 5 passing accidentally under current impl
2. **Task 1 GREEN: ProgressiveMessageEditor 750ms + rate-limit backoff + first_visible_token span** — `214fe90` (feat)
   - `src/discord/streaming.ts` — `isDiscordRateLimitError` export, extended `ProgressiveEditorOptions`, mutable `editIntervalMs` + backoff state, first_visible_token span emission, `handleEditError` method with single WARN + doubling logic, 750ms default const
   - `src/discord/bridge.ts` — streamAndPostResponse reads `agentConfig.perf?.streaming` + threads `editIntervalMs + maxLength + turn + log + agent + turnId` into the editor constructor
   - All 17 new tests + existing 16 bridge tests GREEN
3. **Task 2 RED: failing bench rate_limit_errors counter + regression guard tests** — `a7988b8` (test)
   - `src/benchmarks/__tests__/types.test.ts` — 3 schema tests (present/absent/negative)
   - `src/benchmarks/__tests__/runner.test.ts` — 4 runner tests (count accumulation, 4-segment overall filter, 6-segment per-prompt preservation)
   - `src/cli/commands/bench.test.ts` — 3 CLI tests (exit 0 on clean, exit 1 on > 0, error text signals)
   - 7 failing at RED (2 schema + 2 runner + 2 CLI + 1 runner-existing-4-segment test that was also breaking post-54-01 CANONICAL expansion)
4. **Task 2 GREEN: bench rate_limit_errors counter + --check-regression hard-fail + 4-segment filter** — `c69ac85` (feat)
   - `src/benchmarks/types.ts` — `rate_limit_errors: z.number().int().nonnegative().optional()` appended to benchReportSchema
   - `src/benchmarks/runner.ts` — `BACKWARD_COMPAT_BENCH_SEGMENTS` const (4 names), accumulator loop, replaced `CANONICAL_SEGMENTS.map(...)` with filter, report field stamped
   - `src/benchmarks/baseline.ts` — new `BENCH_DIFF_SEGMENTS` const, `formatDiffTable` uses it instead of `CANONICAL_SEGMENTS` (fixes 2 tsc errors + 1 pre-existing test failure)
   - `src/cli/commands/bench.ts` — hard-fail guard with exact CONTEXT message text, fires before p95 delta check + baseline-required check
   - `src/manager/daemon.ts` — `isDiscordRateLimitError` import at line 84, `bench-run-prompt` response extended with `rate_limit_errors` field (JSDoc documents forward-compat hook rationale)
   - 10 new tests + existing 41 bench tests GREEN; all 2087 scope tests GREEN

**Plan metadata:** _(final `docs` commit below after STATE + ROADMAP + REQUIREMENTS update)_

## Files Created/Modified

### Created

| Path                                          | Change                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `src/discord/__tests__/streaming.test.ts`     | NEW test file: 5 isDiscordRateLimitError tests + 12 ProgressiveMessageEditor tests (17 total; all Phase 54 Plan 03) |

### Modified

| Path                                            | Change                                                                                                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/discord/streaming.ts`                      | DEFAULT_EDIT_INTERVAL_MS 1500 -> 750; `isDiscordRateLimitError` export; extended ProgressiveEditorOptions; mutable editIntervalMs + backoff state; first_visible_token span emission on first editFn; `handleEditError` method with single-WARN-per-turn |
| `src/discord/bridge.ts`                         | streamAndPostResponse reads `agentConfig.perf?.streaming` + threads `editIntervalMs + maxLength + turn + log + agent + turnId` into ProgressiveMessageEditor constructor                                   |
| `src/discord/__tests__/bridge.test.ts`          | New `streamAndPostResponse streaming cadence wire (Phase 54)` describe block with 2 integration tests (editIntervalMs wiring + first_visible_token span emission)                                          |
| `src/benchmarks/types.ts`                       | `rate_limit_errors: z.number().int().nonnegative().optional()` appended to benchReportSchema                                                                                                                |
| `src/benchmarks/runner.ts`                      | `BACKWARD_COMPAT_BENCH_SEGMENTS` const (4 names); per-prompt-loop accumulator for `res.rate_limit_errors`; `overall_percentiles` mapped from 4-segment list instead of 6-segment CANONICAL_SEGMENTS; report carries `rate_limit_errors: totalRateLimitErrors` |
| `src/benchmarks/baseline.ts`                    | Removed `CANONICAL_SEGMENTS` import; new `BENCH_DIFF_SEGMENTS` const (4 names); `formatDiffTable` iterates `BENCH_DIFF_SEGMENTS` instead of `CANONICAL_SEGMENTS`; fixes 2 pre-existing tsc errors + 1 test failure |
| `src/benchmarks/__tests__/types.test.ts`        | 3 Phase 54 tests: parses rate_limit_errors: 0, parses without (backward compat), rejects -1                                                                                                                 |
| `src/benchmarks/__tests__/runner.test.ts`       | 4 Phase 54 tests: rate_limit_errors default 0, sums across prompts, 4-segment overall filter, 6-segment per-prompt preservation                                                                             |
| `src/cli/commands/bench.ts`                     | `--check-regression` gains leading rate_limit_errors > 0 hard-fail with CONTEXT-verbatim message; fires BEFORE p95 delta check + BEFORE baseline-required check                                             |
| `src/cli/commands/bench.test.ts`                | 3 Phase 54 tests: exit 0 on clean, exit 1 on > 0, error text contains "Streaming cadence triggered" + "Discord rate-limit" + "editIntervalMs"                                                               |
| `src/manager/daemon.ts`                         | `isDiscordRateLimitError` imported from src/discord/streaming.js; `bench-run-prompt` response extended with `rate_limit_errors: number` (0 today — forward-compat hook)                                     |

## Exact Line Numbers

| What                                                                      | File + Line                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------ |
| `DEFAULT_EDIT_INTERVAL_MS = 750` declaration                              | `src/discord/streaming.ts:66`                          |
| `export function isDiscordRateLimitError`                                 | `src/discord/streaming.ts:57`                          |
| first_visible_token span `startSpan` call                                 | `src/discord/streaming.ts:124`                         |
| `handleEditError` method declaration                                      | `src/discord/streaming.ts:155`                         |
| `agentConfig.perf?.streaming` read in bridge.ts                           | `src/discord/bridge.ts:500-501`                        |
| `editIntervalMs: streamingCfg?.editIntervalMs` threading into editor     | `src/discord/bridge.ts:512`                            |
| `turn,` threading into editor                                             | `src/discord/bridge.ts:514`                            |
| benchReportSchema `rate_limit_errors` field                               | `src/benchmarks/types.ts:76-83`                        |
| runner.ts `BACKWARD_COMPAT_BENCH_SEGMENTS` declaration                    | `src/benchmarks/runner.ts:65-76`                       |
| runner.ts `totalRateLimitErrors` accumulator                              | `src/benchmarks/runner.ts:181-183`                     |
| runner.ts `overall_percentiles` 4-segment filter                          | `src/benchmarks/runner.ts:223`                         |
| runner.ts report `rate_limit_errors` field                                | `src/benchmarks/runner.ts:267`                         |
| bench.ts `--check-regression` rate-limit hard-fail                        | `src/cli/commands/bench.ts:283-293`                    |
| `"Streaming cadence triggered"` error message text                        | `src/cli/commands/bench.ts:285`                        |
| baseline.ts `BENCH_DIFF_SEGMENTS` declaration                             | `src/benchmarks/baseline.ts:34-45`                     |
| baseline.ts `formatDiffTable` iterator substitution                       | `src/benchmarks/baseline.ts:132`                       |
| daemon.ts `isDiscordRateLimitError` import                                | `src/manager/daemon.ts:84`                             |
| daemon.ts `bench-run-prompt` `rate_limit_errors` field in response        | `src/manager/daemon.ts:1353, 1369`                     |

## Exact ProgressiveMessageEditor Diff Summary

**Constructor signature changes:**

```typescript
// BEFORE (pre-plan):
editIntervalMs: number;  // readonly + default 1500
maxLength: number;       // readonly + default 2000

// AFTER (Phase 54 Plan 03):
editIntervalMs: number;  // MUTABLE (doubles on rate-limit)
readonly maxLength: number;
readonly turn: Turn | undefined;
readonly log: Logger | undefined;
readonly agent: string | undefined;
readonly turnId: string | undefined;
firstVisibleTokenEmitted: boolean;
rateLimitWarnEmitted: boolean;
// Default const: DEFAULT_EDIT_INTERVAL_MS = 750 (was 1500)
```

**update() behavior changes:**

```typescript
// First-chunk path: additionally emit first_visible_token span (once per editor)
if (!this.firstVisibleTokenEmitted) {
  this.firstVisibleTokenEmitted = true;
  try {
    const span = this.turn?.startSpan("first_visible_token", {});
    try { span?.end(); } catch { /* non-fatal */ }
  } catch { /* non-fatal */ }
}
// Both first + subsequent edits: .catch(handleEditError)
void this.editFn(text).catch((err) => this.handleEditError(err));
```

**New handleEditError method:**

```typescript
private handleEditError(err: unknown): void {
  if (!isDiscordRateLimitError(err)) return;  // Silent swallow for non-RL
  const prev = this.editIntervalMs;
  this.editIntervalMs = prev * 2;  // DOUBLE for rest of editor lifetime
  if (!this.rateLimitWarnEmitted) {
    this.rateLimitWarnEmitted = true;
    this.log?.warn(
      { agent, turnId, original_ms: prev, backoff_ms: this.editIntervalMs, error },
      "Discord rate-limit detected — doubling editIntervalMs for rest of turn",
    );
  }
}
```

## Exact benchReportSchema Diff

```diff
 export const benchReportSchema = z.object({
   run_id: z.string().min(1),
   started_at: z.iso.datetime(),
   git_sha: z.string().min(1),
   node_version: z.string().min(1),
   prompt_results: z.array(promptResultSchema),
   overall_percentiles: z.array(percentileRowSchema),
   response_lengths: z.record(z.string(), z.number()).optional(),
+  /**
+   * Phase 54 Plan 03 — count of Discord rate-limit errors observed during
+   * this bench run. A non-zero value hard-fails `--check-regression`
+   * because the tightened streaming cadence must never trigger rate-limits
+   * in the bench matrix. See CONTEXT decision "Rate-limit regression
+   * guard". Absent in pre-Phase-54 reports for backward compat.
+   */
+  rate_limit_errors: z.number().int().nonnegative().optional(),
 });
```

## overall_percentiles Remains 4-Segment (Backward Compat)

Verified: the runner writes `overall_percentiles` with exactly the 4 Phase 51 canonical segments (end_to_end, first_token, context_assemble, tool_call). The 2 new Phase 54 segments (first_visible_token, typing_indicator) are NOT included in this aggregate — they ARE included in per-prompt `promptResults.percentiles` verbatim from the latency IPC response.

Test 22 (Phase 54) asserts the 4-segment filter explicitly; Test 23 asserts the 6-segment preservation in per-prompt rows.

This matches Plan 54-01's documented decision that `src/benchmarks/types.ts` `segmentEnum` is deliberately held at 4 names so committed `baseline.json` files keep parsing under `baselineSchema`.

## Zero New IPC Methods (Phase 50 Regression Lesson)

```bash
git diff HEAD~4 -- src/ipc/protocol.ts  # empty
grep -c "IPC_METHODS\|IpcMethod" src/discord/streaming.ts src/discord/bridge.ts  # 0, 0
grep -c "rate_limit_errors" src/ipc/protocol.ts  # 0
```

The `bench-run-prompt` IPC method's RESPONSE shape gained a `rate_limit_errors` field (the method itself and its PARAMS are unchanged). The `latency` IPC method is unchanged. No new methods added to `IPC_METHODS` array.

## Test Counts

| Test File                                           | Pre-plan | New in 54-03 | Total | Status |
| --------------------------------------------------- | -------- | ------------ | ----- | ------ |
| `src/discord/__tests__/streaming.test.ts`           | 0 (new)  | 17           | 17    | GREEN  |
| `src/discord/__tests__/bridge.test.ts`              | 14       | 2            | 16    | GREEN  |
| `src/benchmarks/__tests__/types.test.ts`            | 7        | 3            | 10    | GREEN  |
| `src/benchmarks/__tests__/runner.test.ts`           | 7        | 4            | 11    | GREEN  |
| `src/cli/commands/bench.test.ts`                    | 15       | 3            | 18    | GREEN  |
| **Plan 54-03 new tests**                            | —        | **29**       | —     | **29 / 29 GREEN** |
| `src/discord/ + src/benchmarks/ + src/cli/commands/bench.test.ts` | —        | —            | **2087** | **2087 / 2087 GREEN** |

## Acceptance Criteria — Verification

### Task 1

| Criterion                                                                  | Target | Actual | Status |
| -------------------------------------------------------------------------- | ------ | ------ | ------ |
| `grep -c "first_visible_token" src/discord/streaming.ts`                   | ≥ 1    | 4      | PASS   |
| `grep -c "isDiscordRateLimitError" src/discord/streaming.ts`               | 2      | 2      | PASS   |
| `grep "DEFAULT_EDIT_INTERVAL_MS" src/discord/streaming.ts \| grep -c "750"` | 1      | 1      | PASS   |
| `grep -c "1500" src/discord/streaming.ts`                                  | 0      | 0      | PASS   |
| `grep -c "handleEditError" src/discord/streaming.ts`                       | 2+     | 3      | PASS   |
| `grep -cE "perf\\?\\.streaming" src/discord/bridge.ts`                     | 1+     | 1      | PASS   |
| `grep -c "editIntervalMs" src/discord/bridge.ts`                           | 1+     | 2      | PASS   |
| `grep -c "first_visible_token" src/discord/bridge.ts`                      | 0      | 0      | PASS   |
| `grep -c "IPC_METHODS\|IpcMethod" src/discord/{streaming,bridge}.ts`       | 0 new  | 0, 0   | PASS   |
| vitest `src/discord/` all GREEN incl. 12+ new                              | GREEN  | 2016 / 2016 GREEN | PASS |

### Task 2

| Criterion                                                                     | Target | Actual | Status |
| ----------------------------------------------------------------------------- | ------ | ------ | ------ |
| `grep -c "rate_limit_errors" src/benchmarks/types.ts`                         | ≥ 1    | 1      | PASS   |
| `grep -c "rate_limit_errors" src/benchmarks/runner.ts`                        | 2+     | 4      | PASS   |
| `grep -c "rate_limit_errors" src/cli/commands/bench.ts`                       | ≥ 1    | 2      | PASS   |
| `grep -c "BACKWARD_COMPAT_BENCH_SEGMENTS" src/benchmarks/runner.ts`           | ≥ 1    | 3      | PASS   |
| `grep "Streaming cadence triggered" src/cli/commands/bench.ts`                | 1+     | 1      | PASS   |
| `grep -c "isDiscordRateLimitError" src/manager/daemon.ts`                     | ≥ 1    | 3      | PASS   |
| `grep -c "first_visible_token\|typing_indicator" src/benchmarks/types.ts`     | 0      | 0      | PASS   |
| `git diff -- src/ipc/protocol.ts` unchanged                                   | empty  | empty  | PASS   |
| vitest bench + bench.test.ts all GREEN incl. 10 new                           | GREEN  | 41 / 41 GREEN | PASS |

All 19 acceptance criteria met.

## Decisions Made

- **`DEFAULT_EDIT_INTERVAL_MS = 750` top-level const.** No mid-file comment mentioning `1500`. Keeps `grep -c "1500"` at 0 per acceptance criterion, preventing accidental documentation drift if someone later re-tightens the default.
- **`editIntervalMs` mutable, backoff state per-editor-instance.** Fresh editor per turn means no cross-turn state leak; doubling resets naturally on the next Discord message.
- **`isDiscordRateLimitError` as exported module-level function.** Reused by `src/manager/daemon.ts` bench-run-prompt handler without circular-import risk.
- **first_visible_token span ONLY in streaming.ts, not bridge.ts.** `grep -c "first_visible_token" src/discord/bridge.ts` returns 0. bridge.ts just passes the Turn through; the span emission is owned by the editor because the first `editFn` call IS the first visible moment (bridge doesn't know what "first visible" means).
- **first_visible_token span opened + closed synchronously.** Duration captures scheduling cost only, not network round-trip. Matches Plan 54-02 typing_indicator pattern.
- **Non-rate-limit rejections silently swallowed.** Preserves pre-plan non-fatal edit-failure behavior. Only `isDiscordRateLimitError` classified errors trigger the doubling + WARN.
- **Single pino.WARN per editor instance via `rateLimitWarnEmitted` flag.** Subsequent rate-limit hits still double the interval but stay silent in the log stream. Prevents log spam while preserving observability of the first hit.
- **`rate_limit_errors` field is OPTIONAL on benchReportSchema.** Pre-Phase-54 reports + baselines parse cleanly. `--check-regression` uses `?? 0` fallback.
- **Hard-fail fires BEFORE p95 delta check + BEFORE baseline-required check.** Non-zero rate-limit count is an absolute failure, independent of baseline presence. Regression even without a baseline means something is broken.
- **`BACKWARD_COMPAT_BENCH_SEGMENTS` hardcoded 4-name const in runner.ts.** Makes the divergence from `CANONICAL_SEGMENTS` explicit + grep-able. Documented at the declaration site.
- **baseline.ts formatDiffTable aligned to same 4-segment list (`BENCH_DIFF_SEGMENTS`).** Fixes 2 pre-existing tsc errors + 1 pre-existing test failure from Phase 54-01's CANONICAL_SEGMENTS expansion. The bench universe (report + baseline + diff rendering) now consistently uses 4 segments; the runtime trace-store universe uses 6. This was an in-scope Rule 1 fix (existing bug directly adjacent to the changes this plan was making — per the plan's acceptance criteria about bench 4-segment backward-compat).
- **daemon.ts bench-run-prompt forward-compat rate_limit_errors hook.** Returns 0 today (bench agents have no Discord binding) but the wire is ready. `isDiscordRateLimitError` is imported and used in the error classification branch for symmetry.
- **Zero new IPC methods.** `src/ipc/protocol.ts` unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing baseline.ts formatDiffTable 4-segment bug + 2 tsc errors**
- **Found during:** Task 2 GREEN phase — running `npx vitest run src/discord/ src/benchmarks/ src/cli/commands/bench.test.ts` revealed 1 failing test in `src/benchmarks/__tests__/baseline.test.ts` ("returns \"(no baseline yet)\" for all segments when baseline is null"), and `npx tsc --noEmit` showed 2 errors in `src/benchmarks/baseline.ts:124-125`.
- **Issue:** Phase 54-01 expanded `CANONICAL_SEGMENTS` from 4 to 6 names, which broke `src/benchmarks/baseline.ts formatDiffTable` because the function iterates `CANONICAL_SEGMENTS.map(...)` against the 4-name `segmentEnum`-constrained baseline. Result: type errors (CanonicalSegment not assignable to 4-name enum) + 6-row diff table output (test expected 4).
- **Fix:** Added `BENCH_DIFF_SEGMENTS` const to baseline.ts (same 4 names as runner.ts's `BACKWARD_COMPAT_BENCH_SEGMENTS`), replaced `CANONICAL_SEGMENTS.map(...)` with `BENCH_DIFF_SEGMENTS.map(...)`, removed the now-unused `CANONICAL_SEGMENTS` import. This aligns with Plan 54-03's explicit strategy of filtering bench output to the 4-segment shape.
- **Files modified:** `src/benchmarks/baseline.ts`
- **Commit:** `c69ac85` (bundled with Task 2 GREEN since the fix is part of the same 4-segment alignment strategy)
- **In-scope rationale:** The plan's acceptance criterion `grep -c "BACKWARD_COMPAT_BENCH_SEGMENTS\|end_to_end.*first_token.*context_assemble.*tool_call" src/benchmarks/runner.ts` directly mandates the 4-segment backward-compat filter pattern at the runner boundary. Extending the same pattern to baseline.ts's diff renderer keeps the bench universe (report + baseline + diff rendering) consistently 4-segment. Plan 54-02 SUMMARY flagged the 2 tsc errors in baseline.ts as pre-existing — this plan is the natural place to resolve them since we're already applying the same filter strategy one level down.

No other deviations. Plan executed exactly as written otherwise.

## Authentication Gates

None — Plan 54-03 is library-level code with no network calls during test execution (all Discord / bench IPC calls mocked).

## Issues Encountered

- **Pre-existing tsc error in `src/manager/daemon.ts:1708` (costs handler).** Unrelated to this plan — documented in prior phase deferred-items.md files from Phase 51-53. Verified via `grep` filter on tsc output: the only tsc error in any Plan 54-03-modified file is in daemon.ts line 1708 which is ~350 lines away from my bench-run-prompt handler changes.
- **1 pre-existing test failure + 2 pre-existing tsc errors in `src/benchmarks/baseline.ts` introduced by Phase 54-01 CANONICAL_SEGMENTS expansion.** FIXED as a Rule 1 deviation (see above). Documented in the deviation section.

## User Setup Required

None — Plan 54-03 is library-level. The new `perf.streaming.editIntervalMs` / `maxLength` config fields are fully optional (all existing configs continue working unchanged at 750ms default). The rate-limit backoff + first_visible_token span are transparent runtime enhancements. The bench regression gate hard-fails only on non-zero rate_limit_errors, which means pre-existing bench runs (which all show 0 today — bench agents have no Discord binding) continue to pass.

## Next Phase Readiness

- **Plan 54-04 can begin.** The runtime trace-store now has real producers for both `typing_indicator` (from Plan 54-02) AND `first_visible_token` (from this plan). Plan 54-04's job is to surface them in the CLI latency command + dashboard (First Token headline card above the percentile table + 2 new rows in the latency segments table).
- **Per-agent editIntervalMs override ready.** Any operator can now add `perf.streaming.editIntervalMs: 900` (or wider) to an agent config and the next turn picks it up via the existing hot-reload path. The 300ms floor enforced by Zod (Plan 54-01) prevents accidentally-unsafe cadences.
- **Bench regression gate is LIVE.** Next bench run will emit `rate_limit_errors: 0` on the report (forward-compat hook); if a future cadence change causes Discord rate limits, `--check-regression` hard-fails before the p95 delta check.
- **Phase 50/51/52/53/54-01/54-02 regression check passed.** All 2087 tests in scope GREEN (220 test files). The 4-segment backward-compat filter in runner.ts + baseline.ts preserves `.planning/benchmarks/baseline.json` parseability.
- **Forward-compat hook in daemon.ts bench-run-prompt.** If a future phase wires the bench harness through the Discord edit pipeline (e.g., a "bench-with-discord" mode), the rate_limit_errors counter is already on the IPC response shape — producers just need to start populating it.
- **No blockers identified.**

## Known Stubs

**None.** All code paths are wired end-to-end within Plan 54-03's scope:

- `DEFAULT_EDIT_INTERVAL_MS = 750` is consumed by the editor's constructor fallback.
- Per-agent `perf.streaming.editIntervalMs` is threaded from `sessionManager.getAgentConfig` into the editor.
- `first_visible_token` span has a real producer (this plan) and the Phase 54-01-registered canonical segment is now populated by real traffic.
- `isDiscordRateLimitError` has two consumers (streaming.ts editor + daemon.ts bench-run-prompt).
- `rate_limit_errors` flows end-to-end (daemon response -> runner accumulator -> BenchReport field -> `--check-regression` guard).
- 4-segment backward-compat filter applied at the runner boundary AND baseline.ts diff renderer for consistency.

The ONE forward-compat hook (daemon.ts `rate_limit_errors: 0` in bench-run-prompt response) is documented in JSDoc as intentional — bench-agent has no Discord binding today so no producer exists, but the consumer (bench runner + regression gate) is ready. This is not a stub in the "renders empty" sense; it's a 0-valued shape field ready to be populated.

## Self-Check: PASSED

All 11 files carry the expected changes (verified via grep counts + test results):

- `src/discord/streaming.ts` — VERIFIED
  - `DEFAULT_EDIT_INTERVAL_MS = 750` on line 66
  - `export function isDiscordRateLimitError` on line 57
  - `first_visible_token` on 4 lines (11, 31, 117, 124)
  - `1500` on 0 lines
  - `handleEditError` on 3 lines (153, 155, 192) — declaration + 2 calls
- `src/discord/bridge.ts` — VERIFIED
  - `perf?.streaming` on 1 line (500-501)
  - `editIntervalMs` on 2 lines (498, 512)
  - `first_visible_token` on 0 lines (span emission lives in streaming.ts only per plan decision)
- `src/discord/__tests__/streaming.test.ts` — VERIFIED — NEW file; 17 tests GREEN
- `src/discord/__tests__/bridge.test.ts` — VERIFIED — 2 new Phase 54 tests added; 16 total GREEN
- `src/benchmarks/types.ts` — VERIFIED
  - `rate_limit_errors: z.number().int().nonnegative().optional()` on line 83
- `src/benchmarks/runner.ts` — VERIFIED
  - `BACKWARD_COMPAT_BENCH_SEGMENTS` on 3 lines (65, 76, 223)
  - `rate_limit_errors` on 4 lines (178, 181, 182, 267)
- `src/benchmarks/baseline.ts` — VERIFIED
  - `BENCH_DIFF_SEGMENTS` declared + used; `CANONICAL_SEGMENTS` import removed
- `src/benchmarks/__tests__/types.test.ts` — VERIFIED — 3 new Phase 54 tests GREEN
- `src/benchmarks/__tests__/runner.test.ts` — VERIFIED — 4 new Phase 54 tests GREEN
- `src/cli/commands/bench.ts` — VERIFIED
  - `"Streaming cadence triggered"` error text on line 285
  - `rate_limit_errors` on 2 lines
- `src/cli/commands/bench.test.ts` — VERIFIED — 3 new Phase 54 tests GREEN
- `src/manager/daemon.ts` — VERIFIED
  - `isDiscordRateLimitError` imported at line 84
  - `rate_limit_errors` in response shape at line 1353 + 1369
  - 3 occurrences total (import + 2 branches)

All four task commits exist in `git log --oneline`:

- `45d40db` FOUND (Task 1 RED)
- `214fe90` FOUND (Task 1 GREEN)
- `a7988b8` FOUND (Task 2 RED)
- `c69ac85` FOUND (Task 2 GREEN)

All 29 new Plan 54-03 tests GREEN. `npx vitest run src/discord/ src/benchmarks/ src/cli/commands/bench.test.ts` exits 0 with 2087 / 2087 tests passing (includes all pre-existing Phase 50/51/52/53/54-01/54-02 tests — no regressions).

`npx tsc --noEmit` shows ZERO new tsc errors in any Plan 54-03-modified file. The 2 previously-pre-existing errors in `src/benchmarks/baseline.ts` from Phase 54-01 are now FIXED as part of this plan's Rule 1 deviation. The 1 pre-existing error in `src/manager/daemon.ts:1708` (costs handler, unrelated to bench-run-prompt changes) is out-of-scope — documented in prior deferred-items.md files.

IPC protocol verification: `git diff HEAD~4 -- src/ipc/protocol.ts` is empty. `grep -c "IPC_METHODS\|IpcMethod" src/discord/streaming.ts src/discord/bridge.ts` returns 0 + 0. Zero new IPC methods introduced (per Phase 50 regression lesson).

Bench enum divergence preserved: `grep -c "first_visible_token\|typing_indicator" src/benchmarks/types.ts` returns 0 — bench `segmentEnum` intentionally untouched. Runner filter (`BACKWARD_COMPAT_BENCH_SEGMENTS`) and diff renderer filter (`BENCH_DIFF_SEGMENTS`) keep the 4-segment bench baseline universe alive.

---
*Phase: 54-streaming-typing-indicator*
*Plan: 03*
*Completed: 2026-04-14*
