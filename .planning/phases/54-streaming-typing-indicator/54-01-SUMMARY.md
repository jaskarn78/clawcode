---
phase: 54-streaming-typing-indicator
plan: 01
subsystem: performance
tags: [zod, slos, streaming, typing-indicator, first-token, canonical-segments, trace-store]

# Dependency graph
requires:
  - phase: 50-01
    provides: CANONICAL_SEGMENTS, PercentileRow, PERCENTILE_SQL, TraceStore.getPercentiles
  - phase: 51-01
    provides: DEFAULT_SLOS + SloEntry shape + mergeSloOverrides + sloOverrideSchema pattern
  - phase: 52-01
    provides: CacheHitRateStatus + types.ts re-export pattern (avoided circular import)
  - phase: 53-01
    provides: lazySkillsSchema.min(5) floor pattern mirrored by streamingConfigSchema editIntervalMs.min(300)
provides:
  - streamingConfigSchema Zod export (editIntervalMs.min(300) + maxLength 1..2000, both optional)
  - StreamingConfig inferred type (re-usable in consumers)
  - ResolvedAgentConfig.perf.streaming? inline-literal TS mirror on src/shared/types.ts
  - typing_indicator SLO entry in DEFAULT_SLOS (5th entry, p95 500ms, observational initially)
  - CanonicalSegment union expanded from 4 to 6 names
  - CANONICAL_SEGMENTS frozen array expanded from 4 to 6 in canonical order
  - TraceStore.getFirstTokenPercentiles(agent, sinceIso) convenience wrapper
affects: [54-02, 54-03, 54-04]

# Tech tracking
tech-stack:
  added: []  # No new runtime dependencies
  patterns:
    - "Per-agent perf Zod override field mirrors Phase 51 slos + Phase 53 lazySkills patterns (floor via .min(N) at Zod; default value applied at consumer, not schema)"
    - "CanonicalSegment union + CANONICAL_SEGMENTS array stay in lock-step (single source of truth for 6-segment display order)"
    - "Bench segmentEnum intentionally diverges from CANONICAL_SEGMENTS — bench baselines remain on 4-name Phase 51 shape for backward compat with committed baseline.json"
    - "getFirstTokenPercentiles composes over getPercentiles rather than duplicating SQL — no new prepared statement, no index tuning needed"
    - "Observational SLO framing — typing_indicator 500ms p95 documented as observational initially so operators observe real p95 before treating breach as a hard gate (Phase 54 CONTEXT D-03)"

key-files:
  created: []
  modified:
    - src/config/schema.ts
    - src/shared/types.ts
    - src/config/__tests__/schema.test.ts
    - src/performance/types.ts
    - src/performance/slos.ts
    - src/performance/trace-store.ts
    - src/performance/__tests__/slos.test.ts
    - src/performance/__tests__/trace-store.test.ts

key-decisions:
  - "Phase 54 Plan 01 — streamingConfigSchema declared AFTER resumeSummaryBudgetSchema (~schema.ts line 234) to keep all Phase 53/54 perf extensions grouped together; added to BOTH agentSchema.perf AND defaultsSchema.perf alongside existing 5 fields (no field collision)"
  - "Phase 54 Plan 01 — editIntervalMs floor enforced at Zod layer via .min(300) mirroring Phase 53's lazySkills.usageThresholdTurns.min(5) pattern; 750ms default is a consumer-side decision (Plan 54-03 ProgressiveMessageEditor), NOT a Zod default — keeps the parse shape minimal"
  - "Phase 54 Plan 01 — maxLength bounded at Zod layer (min 1, max 2000) because Discord's 2000-char message limit is a hard protocol constraint; rejecting >2000 at config-load prevents runtime surprises"
  - "Phase 54 Plan 01 — ResolvedAgentConfig.perf.streaming? uses inline literal shape (no cross-module import) preserving the Phase 51 low-dep boundary on src/shared/types.ts"
  - "Phase 54 Plan 01 — CanonicalSegment expanded in canonical display order: end_to_end, first_token, first_visible_token, context_assemble, tool_call, typing_indicator — matches CONTEXT Specifics #1 verbatim; the 2 new segments are appended in their logical position relative to existing neighbors (first_visible_token after first_token; typing_indicator after tool_call)"
  - "Phase 54 Plan 01 — first_visible_token has NO default SLO entry (only 5 of 6 canonical segments have default SLOs). Rationale: first_visible_token is the debug/support metric (delta vs first_token captures Discord plumbing overhead), not a headline. If operators want to SLO it, they can add an override via perf.slos."
  - "Phase 54 Plan 01 — typing_indicator SLO is observational initially per CONTEXT D-03. SUMMARY documents this so operators observe p95 for the first week before treating breach as a hard gate. The SLO is in DEFAULT_SLOS so the dashboard renders a status color, but operators should treat red as 'observe, not remediate' during bring-up."
  - "Phase 54 Plan 01 — getFirstTokenPercentiles composes getPercentiles + Array.find rather than issuing a second prepared query. Rationale: (1) getPercentiles already runs 6 point queries (one per segment) so the work is already done; (2) no new prepared statement means no schema-level change; (3) the empty-window branch returns a frozen count=0 no-data row so Plan 54-04 CLI/dashboard callers can render 'no_data' without a null-check ladder."
  - "Phase 54 Plan 01 — src/benchmarks/types.ts segmentEnum DELIBERATELY NOT TOUCHED. Bench reports and baselines stay on the 4-name Phase 51 shape for backward compat with the committed baseline.json. Plan 54-03 will explicitly filter the bench runner's overall_percentiles back to those 4 names (so Zod parse succeeds on existing baselines)."
  - "Phase 54 Plan 01 — Zero new IPC methods. Per Phase 50 regression lesson, any new IPC method must be added to BOTH src/ipc/protocol.ts IPC_METHODS AND src/ipc/__tests__/protocol.test.ts. This plan extends existing types + adds a TraceStore method, but introduces no new IPC surface — verified by grep."

patterns-established:
  - "Pattern: Floor-at-Zod-layer + default-at-consumer — perf overrides enforce safety floors at parse time (editIntervalMs.min(300)) but leave the default value (750ms) to the consumer, keeping the schema shape minimal and the default collocated with the code that actually uses it"
  - "Pattern: Two-segment canonical expansion with selective SLO coverage — when adding canonical segments, not all need default SLO entries; debug/support metrics (like first_visible_token) can live in CANONICAL_SEGMENTS without a default SLO row, and operators can opt into SLO coverage via perf.slos overrides"
  - "Pattern: Bench-enum / trace-enum intentional divergence — when a canonical segment list expands, benchmarks enum can stay on the prior shape to preserve committed baseline compat; document the intentional divergence + filter at the bench runner boundary"
  - "Pattern: Observational SLO framing for aggressive budgets — document in SUMMARY + CONTEXT that a new aggressive SLO is observational initially; dashboard still renders color but operators treat breach as 'observe, not remediate' during bring-up"
  - "Pattern: Compose convenience queries — getFirstTokenPercentiles wraps getPercentiles instead of duplicating SQL; the empty-window branch returns a frozen canonical no-data row so callers render consistently"

requirements-completed: []  # STREAM-01/STREAM-03 are foundation-only here; full closure ships with 54-02 (bridge typing wire) + 54-03 (cadence wire) + 54-04 (CLI/dashboard headline)

# Metrics
duration: 4m 33s
completed: 2026-04-14
---

# Phase 54 Plan 01: perf.streaming Zod + typing_indicator SLO + CANONICAL_SEGMENTS x6 + getFirstTokenPercentiles Summary

**Wave 1 pure-data foundation for Phase 54 — streamingConfigSchema with 300ms editIntervalMs floor wired into both agentSchema.perf and defaultsSchema.perf, ResolvedAgentConfig.perf.streaming? inline-literal TS mirror, DEFAULT_SLOS gains typing_indicator p95 500ms (observational), CanonicalSegment expanded to 6 names in canonical order, TraceStore.getFirstTokenPercentiles convenience wrapper with empty-window no-data row.**

## Performance

- **Duration:** ~4 min 33 sec
- **Started:** 2026-04-14T03:00:30Z
- **Completed:** 2026-04-14T03:05:03Z
- **Tasks:** 2 (both `auto` + `tdd`, no checkpoints)
- **Files modified:** 8 (0 created + 8 edited)

## Accomplishments

- **streamingConfigSchema exported + wired into both perf schemas.** New Zod schema at `src/config/schema.ts` (declared immediately after `resumeSummaryBudgetSchema`) with `editIntervalMs: z.number().int().min(300).optional()` and `maxLength: z.number().int().min(1).max(2000).optional()`. Inserted as `streaming: streamingConfigSchema.optional()` on BOTH `agentSchema.perf` (alongside slos/memoryAssemblyBudgets/lazySkills/resumeSummaryBudget) AND `defaultsSchema.perf` (fleet-wide default path).
- **300ms editIntervalMs floor enforced via Zod.** Direct mirror of Phase 53's `lazySkillsSchema.usageThresholdTurns.min(5)` floor pattern. Attempts to set `editIntervalMs: 299` or `editIntervalMs: 100` are rejected with a Zod issue mentioning `300` — verified by tests.
- **ResolvedAgentConfig.perf.streaming? inline-literal TS mirror.** Extended the `readonly perf?.streaming?` block at `src/shared/types.ts` line ~135 with `{ readonly editIntervalMs?: number; readonly maxLength?: number }`. No cross-module import — low-dep boundary on `src/shared/types.ts` preserved (Phase 51 pattern).
- **DEFAULT_SLOS gains typing_indicator entry.** Appended `{ segment: "typing_indicator", metric: "p95", thresholdMs: 500 }` as the 5th frozen entry in `src/performance/slos.ts`. Inline JSDoc documents the observational-initially framing per CONTEXT D-03. The `first_visible_token` canonical segment intentionally has NO default SLO row (debug/support metric, delta-only).
- **CanonicalSegment + CANONICAL_SEGMENTS expanded to 6.** Replaced the 4-name union + frozen array with the exact canonical order from CONTEXT Specifics #1: `end_to_end, first_token, first_visible_token, context_assemble, tool_call, typing_indicator`. `TraceStore.getPercentiles` now returns 6 rows (empty-window rows stay count=0 / null p-values).
- **TraceStore.getFirstTokenPercentiles convenience wrapper.** Wraps `getPercentiles` + `Array.find` to return a single frozen `PercentileRow` for the `first_token` segment. Empty-window returns a frozen `{ segment: "first_token", p50: null, p95: null, p99: null, count: 0 }` so Plan 54-04 CLI + dashboard headline-card callers can render "no_data" without a null-check ladder.
- **Bench segmentEnum deliberately NOT touched.** Verified via `grep -c "first_visible_token\|typing_indicator" src/benchmarks/types.ts` returns 0. Bench reports and baselines stay on the 4-name Phase 51 shape for backward compat with the committed baseline.json. Plan 54-03 will explicitly filter the bench runner's `overall_percentiles` to those 4 names.
- **Zero new IPC methods.** Verified via `grep "IPC_METHODS" src/ipc/protocol.ts | grep -c "typing_indicator\|first_visible_token\|first_token_headline"` returns 0. Per Phase 50 regression lesson — this plan extends existing types + adds a TraceStore method, but introduces no new IPC surface.

## Task Commits

Each task was committed atomically:

1. **Task 1: perf.streaming Zod + TS mirror + 300ms floor validation** — `9902418` (feat)
   - `src/config/schema.ts` — `streamingConfigSchema` + `StreamingConfig` type declared after `resumeSummaryBudgetSchema`; `streaming: streamingConfigSchema.optional()` appended to BOTH `agentSchema.perf` AND `defaultsSchema.perf`
   - `src/shared/types.ts` — `ResolvedAgentConfig.perf.streaming?` inline literal (`readonly editIntervalMs?: number; readonly maxLength?: number`) appended after `resumeSummaryBudget`
   - `src/config/__tests__/schema.test.ts` — new `streamingConfigSchema (Phase 54)` describe block with 9 tests (floor 300 / reject 299 / negative / zero / maxLength 2000 / empty {} / agent-path / agent-path floor propagation / defaults-path)
   - Test count delta: +9 tests (356 total in scoped suite)
2. **Task 2: typing_indicator SLO + 6-segment canonical list + getFirstTokenPercentiles wrapper** — `fd7f2da` (feat)
   - `src/performance/types.ts` — `CanonicalSegment` union and `CANONICAL_SEGMENTS` frozen array expanded from 4 to 6 names in canonical order with JSDoc documenting Phase 54 additions + bench segmentEnum divergence
   - `src/performance/slos.ts` — `DEFAULT_SLOS` gains 5th frozen entry `{ segment: "typing_indicator", metric: "p95", thresholdMs: 500 }` with JSDoc documenting observational-initially framing + no default SLO on first_visible_token rationale
   - `src/performance/trace-store.ts` — new `getFirstTokenPercentiles(agent, sinceIso)` method composes `getPercentiles` + `Array.find`; empty-window branch returns frozen `{ segment: "first_token", p50: null, p95: null, p99: null, count: 0 }`
   - `src/performance/__tests__/slos.test.ts` — DEFAULT_SLOS length assertion updated 4 → 5, typing_indicator verification added; mergeSloOverrides replace/append assertions updated (4 → 5, 5 → 6); new `Phase 54: CANONICAL_SEGMENTS + typing_indicator SLO integration` describe block with 3 tests (6-segment order, evaluateSloStatus for typing_indicator, mergeSloOverrides replace for typing_indicator)
   - `src/performance/__tests__/trace-store.test.ts` — new `getPercentiles returns 6 rows` test, new `getFirstTokenPercentiles returns the first_token row when data exists` test (20 synthetic turns), new `getFirstTokenPercentiles returns a count=0 / null-p-value row when window is empty` test (with `Object.isFrozen` assertion)
   - Test count delta: +6 tests (Phase 54 dedicated) + 3 assertion updates (existing tests)

**Plan metadata:** _(final `docs` commit below after STATE + ROADMAP + REQUIREMENTS update)_

## Files Created/Modified

### Modified

| Path                                          | Change                                                                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config/schema.ts`                        | Added `streamingConfigSchema` + `StreamingConfig` type after `resumeSummaryBudgetSchema`; `streaming: streamingConfigSchema.optional()` on BOTH `agentSchema.perf` AND `defaultsSchema.perf` |
| `src/shared/types.ts`                         | Extended `ResolvedAgentConfig.perf` inline literal with `readonly streaming?: { readonly editIntervalMs?: number; readonly maxLength?: number }` after `resumeSummaryBudget`               |
| `src/config/__tests__/schema.test.ts`         | Imports `streamingConfigSchema`; appended `streamingConfigSchema (Phase 54)` describe block with 9 tests                                                        |
| `src/performance/types.ts`                    | `CanonicalSegment` union + `CANONICAL_SEGMENTS` array expanded from 4 to 6 names; JSDoc documents Phase 54 additions + bench divergence                         |
| `src/performance/slos.ts`                     | `DEFAULT_SLOS` gains 5th frozen entry `{ segment: "typing_indicator", metric: "p95", thresholdMs: 500 }`; JSDoc documents observational framing                 |
| `src/performance/trace-store.ts`              | New `getFirstTokenPercentiles(agent, sinceIso)` method after `getPercentiles`; updates JSDoc on `getPercentiles` to reflect 6-row (was 4-row) return shape      |
| `src/performance/__tests__/slos.test.ts`      | DEFAULT_SLOS length assertion 4 → 5, typing_indicator verification; mergeSloOverrides (4 → 5, 5 → 6); new Phase 54 describe block with 3 tests                  |
| `src/performance/__tests__/trace-store.test.ts` | New `getPercentiles returns 6 rows`, `getFirstTokenPercentiles data-present`, `getFirstTokenPercentiles empty-window` tests                                     |

## Key Public API

```typescript
// src/config/schema.ts (NEW exports)
export const streamingConfigSchema: z.ZodObject<{
  editIntervalMs: z.ZodOptional<z.ZodNumber>;  // .int().min(300)
  maxLength: z.ZodOptional<z.ZodNumber>;       // .int().min(1).max(2000)
}>;
export type StreamingConfig = z.infer<typeof streamingConfigSchema>;

// Both agentSchema.perf AND defaultsSchema.perf now accept:
//   { traceRetentionDays?, slos?, memoryAssemblyBudgets?, lazySkills?,
//     resumeSummaryBudget?, streaming? }

// src/shared/types.ts (EXTENDED)
type ResolvedAgentConfig = {
  // ...
  readonly perf?: {
    // ... existing fields ...
    readonly streaming?: {
      readonly editIntervalMs?: number;
      readonly maxLength?: number;
    };
  };
};

// src/performance/types.ts (EXPANDED)
export type CanonicalSegment =
  | "end_to_end"
  | "first_token"
  | "first_visible_token"   // Phase 54: Discord-plumbing view of first_token
  | "context_assemble"
  | "tool_call"
  | "typing_indicator";     // Phase 54: handleMessage entry -> sendTyping() call
export const CANONICAL_SEGMENTS: readonly CanonicalSegment[];  // 6 entries, frozen

// src/performance/slos.ts (EXPANDED)
// DEFAULT_SLOS now has 5 entries (typing_indicator p95 500ms appended, observational initially)

// src/performance/trace-store.ts (NEW method)
class TraceStore {
  // ... existing methods ...
  getFirstTokenPercentiles(agent: string, sinceIso: string): PercentileRow;
  //   Returns the first_token row from getPercentiles, or a frozen
  //   count=0 / null-p-value no-data row when the window is empty.
}
```

## Exact streamingConfigSchema Shape

```typescript
export const streamingConfigSchema = z.object({
  editIntervalMs: z.number().int().min(300).optional(),  // 300ms hard floor
  maxLength: z.number().int().min(1).max(2000).optional(), // Discord char limit
});
```

Inserted at `src/config/schema.ts` immediately after `resumeSummaryBudgetSchema` (line ~234). Wired into both perf blocks:

- **agentSchema.perf** (originally line 271-279 — 5 fields; now 6 fields including `streaming`)
- **defaultsSchema.perf** (originally line 310-318 — 5 fields; now 6 fields including `streaming`)

Both perf blocks are structurally identical (same 6 fields in the same order).

## Exact CANONICAL_SEGMENTS Expansion

**Before (Phase 51):** 4 entries — `end_to_end, first_token, context_assemble, tool_call`.

**After (Phase 54):** 6 entries in exact canonical order per CONTEXT Specifics #1:

```typescript
export const CANONICAL_SEGMENTS: readonly CanonicalSegment[] = Object.freeze([
  "end_to_end",
  "first_token",
  "first_visible_token",   // Phase 54 addition — after first_token (logical neighbor)
  "context_assemble",
  "tool_call",
  "typing_indicator",      // Phase 54 addition — last (fired before everything else, but displayed last)
]);
```

`TraceStore.getPercentiles` now returns 6 rows (previously 4). Empty-window rows stay `{count: 0, p50: null, p95: null, p99: null}` (shape preserved).

## Bench Enum Divergence (Intentional)

`src/benchmarks/types.ts` (lines 28-33) `segmentEnum` stays on the 4-name Phase 51 shape:

```typescript
const segmentEnum = z.enum(["end_to_end", "first_token", "context_assemble", "tool_call"]);
```

Verified via `grep -c "first_visible_token\|typing_indicator" src/benchmarks/types.ts` returns 0.

**Why:** Committed `baseline.json` fixtures are parsed by `benchReportSchema` / `baselineSchema` which use `segmentEnum`. Adding 2 new names would break Zod validation of existing baselines. Plan 54-03 will:
1. Filter the bench runner's `overall_percentiles` output to the 4 original names (the aggregate row).
2. Keep the 6-name shape on the dashboard + CLI (which use `CANONICAL_SEGMENTS` directly, not `segmentEnum`).

This is the explicit backward-compat boundary — the bench enum is a separate concept from the runtime trace-store canonical list.

## Observational typing_indicator SLO Framing

Per CONTEXT D-03 the 500ms p95 SLO for `typing_indicator` is **observational initially**. Operators should:

- Observe the p95 for the first week of real traffic.
- NOT treat breach as a hard gate during bring-up.
- Accept that cold-start / low-volume windows may show `no_data` or anomalous p95 values.

The SLO is still in `DEFAULT_SLOS` so the dashboard renders a color (breach = red, healthy = green), but the emotional framing for operators during Phase 54 rollout is "observe, don't remediate".

## IPC Protocol Verification

Per Phase 50 regression lesson, verified no new IPC methods were introduced:

```bash
grep "IPC_METHODS" src/ipc/protocol.ts | grep -c "typing_indicator\|first_visible_token\|first_token_headline"
# Returns: 0
```

Plan 54-01 extends existing types + adds a `TraceStore` method, but the IPC surface is unchanged. Plan 54-04 (dashboard / CLI headline card) will surface the first-token data via the existing `latency` IPC method response (augmented with a `first_token_headline` object on the existing payload — no new method needed).

## Test Counts

| Test File                                         | Pre-existing | New in Plan 54-01 | Total | Status |
| ------------------------------------------------- | ------------ | ----------------- | ----- | ------ |
| `src/config/__tests__/schema.test.ts`             | 41           | 9                 | 50    | GREEN  |
| `src/performance/__tests__/slos.test.ts`          | 12           | 3 new + 3 updated | 15    | GREEN  |
| `src/performance/__tests__/trace-store.test.ts`   | 14           | 3                 | 17    | GREEN  |
| **Plan 54-01 new tests**                          | —            | **15**            | —     | **15 / 15 GREEN** |
| `src/performance/ + src/config/` (in-scope verify) | —            | —                 | **1241** | **1241 / 1241 GREEN** |

## Decisions Made

- **streamingConfigSchema declared after `resumeSummaryBudgetSchema`.** Keeps the Phase 53 + 54 perf extensions grouped together near the top of `schema.ts` (after the older `agentSchema` dependencies like `effortSchema` / `sloOverrideSchema`, before `agentSchema` itself). Consistent with how `lazySkillsSchema` and `resumeSummaryBudgetSchema` were added in Phase 53.
- **editIntervalMs floor at Zod via `.min(300)` (not a default).** Mirrors Phase 53's `lazySkillsSchema.usageThresholdTurns.min(5)` pattern. The 750ms DEFAULT is a consumer-side decision that lives in `src/discord/streaming.ts` `ProgressiveMessageEditor` (Plan 54-03), NOT in the Zod layer. Separating floor (safety) from default (behavior) keeps the schema shape minimal and puts the default value next to the code that applies it.
- **maxLength bounded (min 1, max 2000) at Zod.** Discord's 2000-char message limit is a hard protocol constraint. Rejecting values >2000 at config-load time prevents runtime surprises. Min 1 prevents nonsensical `maxLength: 0` configs.
- **`ResolvedAgentConfig.perf.streaming?` inline literal (no cross-module import).** Consistent with Phase 51's low-dep boundary on `src/shared/types.ts`. The Zod schema is authoritative; the TS type declares the same shape with duplication.
- **CanonicalSegment expanded in canonical display order, not alphabetical.** `first_visible_token` sits after `first_token` (logical neighbor); `typing_indicator` sits last (displayed last on the table, even though chronologically it fires first). Matches CONTEXT Specifics #1 verbatim.
- **`first_visible_token` has NO default SLO row.** Rationale: (a) it is the debug/support metric — delta vs `first_token` captures Discord plumbing overhead, not a headline budget; (b) operators can add an override via `perf.slos` if they want to SLO it in the future; (c) keeps the default list at 5 entries (one per headline segment + tool_call aggregate).
- **typing_indicator SLO is observational initially.** Documented in this SUMMARY + CONTEXT D-03. The SLO is in `DEFAULT_SLOS` so the dashboard renders a status color, but operators should treat breach as "observe, not remediate" during Phase 54 rollout. Once real traffic data exists for a week, the SLO can be upgraded to a hard gate (e.g., in Phase 55+ as confidence grows).
- **`getFirstTokenPercentiles` composes `getPercentiles` + `Array.find`.** Rationale: (1) no new prepared statement — lower schema+prepared-statement overhead; (2) the empty-window branch returns a frozen canonical no-data row so Plan 54-04 CLI + dashboard callers render consistently; (3) minor perf cost (6 queries instead of 1) is negligible at agent scale and keeps the one-source-of-truth invariant for percentile logic.
- **Bench `segmentEnum` NOT touched.** The committed `.planning/benchmarks/baselines/baseline.json` file would fail Zod parse if the enum expanded. Plan 54-03 will filter the bench runner's aggregate `overall_percentiles` back to 4 names at the runner boundary — the bench enum becomes a filter boundary rather than a direct mirror of `CANONICAL_SEGMENTS`. This is a planned architectural divergence, not an oversight.
- **Zero new IPC methods.** Plan 54-04 will augment the existing `latency` IPC response with a `first_token_headline` object (or derive it client-side from the existing segments array). No `typing_indicator_headline` method, no `first_token_percentile` method, no schema change to `IPC_METHODS`. Verified by grep per Phase 50 regression lesson.

## Deviations from Plan

None — plan executed exactly as written. All 15 new tests passed on first GREEN run; no auto-fix cycles needed. The 3 existing-test updates (mergeSloOverrides length assertions 4 → 5 and 5 → 6; DEFAULT_SLOS length assertion 4 → 5) were explicitly called out in the plan's `<action>` block and applied accordingly.

### Auto-fixed Issues

None.

## Authentication Gates

None — Plan 54-01 is library-level code with no network calls, no daemon interaction, no Discord, no external services.

## Issues Encountered

- **Pre-existing tsc errors in unrelated files.** The global `npx tsc --noEmit` run reports ~12 errors across `src/cli/commands/__tests__/latency.test.ts`, `src/manager/__tests__/agent-provisioner.test.ts`, `src/manager/__tests__/memory-lookup-handler.test.ts`, `src/manager/daemon.ts`, `src/manager/session-adapter.ts`, `src/memory/__tests__/graph.test.ts`, `src/usage/__tests__/daily-summary.test.ts`, and `src/usage/budget.ts`. These are pre-existing (documented in prior phase deferred-items.md files from Phase 51-53) and unrelated to Plan 54-01. Verified via `grep -E "src/performance/|src/config/|src/shared/"` filter on the tsc output returns no matches — zero errors in any Plan 54-01-modified file.
- **No other issues during execution.**

## User Setup Required

None — Plan 54-01 is library-level. The new schema fields are opt-in (all optional) and the canonical segment expansion is backward-compatible (existing traces.db files stay queryable, with new segments returning count=0 rows until Plan 54-02/03 wires the spans).

## Next Phase Readiness

- **Plan 54-02 can begin.** The `typing_indicator` canonical segment is recognized by `TraceStore.getPercentiles` so spans recorded with `name: "typing_indicator"` will be aggregated into the percentile table. Plan 54-02's job is to relocate the typing fire from `streamAndPostResponse` to `DiscordBridge.handleMessage` and wrap a new span around it.
- **Plan 54-03 can begin.** `streamingConfigSchema` + `StreamingConfig` type + `ResolvedAgentConfig.perf.streaming?` are importable. Plan 54-03's job is to wire `ProgressiveMessageEditor` to accept `editIntervalMs` from the agent's `perf.streaming.editIntervalMs` (defaulting to 750ms when unset) and implement rate-limit backoff. It can also emit `first_visible_token` spans from the first `editFn` call.
- **Plan 54-04 can begin.** `TraceStore.getFirstTokenPercentiles` is importable and returns both data-present and no-data rows. Plan 54-04's job is to render the First Token headline card in the CLI + dashboard using this wrapper (no additional plumbing needed).
- **Bench runner divergence documented.** Plan 54-03 will need to filter the bench aggregate `overall_percentiles` back to the 4 Phase 51 names before parsing with `benchReportSchema`. This is called out in SUMMARY under "Bench Enum Divergence (Intentional)" and CONTEXT.md.
- **Phase 50/51/52/53 regression check passed.** All pre-existing tests still GREEN. `CANONICAL_SEGMENTS` expansion did not break any existing callers (they iterate the array generically). `DEFAULT_SLOS` expansion did not break `mergeSloOverrides` (the existing `replace-on-match, append-on-divergence` semantics work identically with 5 defaults as with 4). Bench `segmentEnum` is untouched so all bench tests pass.

## Known Stubs

**None.** All code paths are wired end-to-end within the Phase 54-01 foundation scope:

- `streamingConfigSchema` values are NOT YET consumed anywhere (Plan 54-03 will wire them into `ProgressiveMessageEditor`). This is intentional and planned — the schema is a foundation for Plan 54-03.
- `typing_indicator` segment has NO producer yet (Plan 54-02 will add the span in `DiscordBridge.handleMessage`). The percentile table will show `count=0` for `typing_indicator` until Plan 54-02 lands. Intentional and planned.
- `first_visible_token` segment has NO producer yet (Plan 54-03 will add the span in `ProgressiveMessageEditor.first editFn call`). Same pattern as `typing_indicator`. Intentional and planned.
- `getFirstTokenPercentiles` returns the correct no-data row shape when the window has no `first_token` spans. Plan 54-04 CLI + dashboard callers will render "no_data" correctly.

**Explicit statement:** The `streaming` config is foundation only — consumers (Plan 54-03 `ProgressiveMessageEditor`) wire it up in Wave 2. The `typing_indicator` and `first_visible_token` canonical segments are declared but have no producers — producers are added by Plans 54-02 and 54-03 respectively.

## Self-Check: PASSED

All 8 modified files carry the expected changes (verified via grep counts):

- `src/config/schema.ts` — `streamingConfigSchema` (4 occurrences: declaration + type inference + 2 perf-block uses), `streaming: streamingConfigSchema.optional()` (2 occurrences, once per perf block), `min(300)` (1 occurrence, the editIntervalMs floor) — VERIFIED
- `src/shared/types.ts` — `streaming?` (1 occurrence), `editIntervalMs` (1 occurrence), zero new imports — VERIFIED
- `src/config/__tests__/schema.test.ts` — `streamingConfigSchema (Phase 54)` describe block with 9 tests — VERIFIED by `vitest run` showing 9 new tests GREEN
- `src/performance/types.ts` — `first_visible_token` (3 occurrences: union + array + JSDoc), `typing_indicator` (3 occurrences: union + array + JSDoc) — VERIFIED
- `src/performance/slos.ts` — `typing_indicator` (3 occurrences: DEFAULT_SLOS entry + JSDoc + JSDoc detail), `thresholdMs: 500` (1 occurrence), 5-entry DEFAULT_SLOS — VERIFIED
- `src/performance/trace-store.ts` — `getFirstTokenPercentiles` (1 occurrence, the method declaration) — VERIFIED
- `src/performance/__tests__/slos.test.ts` — DEFAULT_SLOS length 5, mergeSloOverrides replace 5 + append 6, new Phase 54 describe block with 3 tests — VERIFIED
- `src/performance/__tests__/trace-store.test.ts` — `getPercentiles returns 6 rows`, `getFirstTokenPercentiles data-present`, `getFirstTokenPercentiles empty-window` — VERIFIED

Both task commits exist in `git log --oneline`:

- `9902418` FOUND (Task 1: perf.streaming Zod + TS mirror + 300ms floor)
- `fd7f2da` FOUND (Task 2: typing_indicator SLO + 6-segment canonical + getFirstTokenPercentiles)

All 15 new Plan 54-01 tests GREEN. `npx vitest run src/performance/ src/config/` exits 0 with 1241 / 1241 tests passing (includes all pre-existing Phase 50/51/52/53 tests — no regressions).

IPC protocol verification: `grep "IPC_METHODS" src/ipc/protocol.ts | grep -c "typing_indicator|first_visible_token|first_token_headline"` returns 0 — zero new IPC methods introduced (per Phase 50 regression lesson).

Bench enum divergence verification: `grep -c "first_visible_token\|typing_indicator" src/benchmarks/types.ts` returns 0 — bench `segmentEnum` intentionally NOT touched (preserves baseline.json backward compat).

`npx tsc --noEmit` shows ZERO errors in any Plan 54-01-modified file — confirmed via grep filter on `src/performance/|src/config/|src/shared/`. Pre-existing errors in other files (`src/cli/commands/__tests__/latency.test.ts`, `src/manager/__tests__/*`, `src/manager/daemon.ts`, `src/manager/session-adapter.ts`, `src/memory/__tests__/graph.test.ts`, `src/usage/__tests__/daily-summary.test.ts`, `src/usage/budget.ts`) are documented in prior phase deferred-items.md files and are out-of-scope per the executor scope-boundary rule.

---
*Phase: 54-streaming-typing-indicator*
*Plan: 01*
*Completed: 2026-04-14*
