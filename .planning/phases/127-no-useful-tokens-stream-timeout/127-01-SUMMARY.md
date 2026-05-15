---
phase: 127-no-useful-tokens-stream-timeout
plan: 01
subsystem: infra
tags: [stream-stall, supervisor, sdk-iteration, telemetry, phase-127, abortcontroller]

requires:
  - phase: 117-claude-code-advisor-pattern-multi-backend-scaffold-anthropic
    provides: AdvisorService surface — Plan 01 reserves the per-model Opus override slot for advisor consults pending D-07 follow-up.
  - phase: 999.54-mcp-skill-load-fanout-budget-aware-conditional-loading
    provides: phase999.54-resolver structured-log precedent (single-line per-agent JSON via console.info). Phase 127 mirrors this for `phase127-resolver`.
  - phase: 73-persistent-session-handle-and-serial-turn-queue
    provides: createPersistentSessionHandle — the production SDK iteration loop the tracker hooks into.
provides:
  - Per-agent `streamStallTimeoutMs` schema field + per-model overrides via `defaults.modelOverrides`.
  - `ResolvedAgentConfig.streamStallTimeoutMs` populated by loader cascade with `phase127-resolver` log emission.
  - `src/manager/stream-stall-tracker.ts` — chokepoint module exposing `createStreamStallTracker({thresholdMs, onStall, ...})`.
  - Production wiring in `persistent-session-handle.ts iterateUntilResult` — per-turn tracker construction, `markUsefulToken()` on text_delta + input_json_delta, AbortController via existing fireInterruptOnce() path, T-127-04 cleanup in both success and catch paths.
  - Predicate update at the same chokepoint to recognize tool-use partial_json as useful tokens (closes false-stall on tool-heavy turns).
  - RELOADABLE_FIELDS classification — yaml edits apply within Math.min(threshold/4, 30000)ms without daemon restart.
  - Synthetic-stream test fixture (STALL-01..03) + cleanup tests (T-127-04 mitigation).
affects: [phase 127 plan 02, phase 127 plan 03, phase 137 anthropic-api-key failover, phase 138 provider failover orchestration]

tech-stack:
  added: []
  patterns:
    - "Chokepoint module pattern: tracker factory imported by both prod call site (persistent-session-handle.ts) and test path (wrapSdkQuery in session-adapter.ts) per feedback_silent_path_bifurcation.md."
    - "Schema cascade pattern: agent → defaults.modelOverrides[model] → defaults.field → hardcoded fallback (4 tiers vs. existing 2-tier patterns)."
    - "Adapter-only options bag pattern: `AdapterBaseOptions = SdkQueryOptions & {mutableSuffix, streamStallTimeoutMs, onStreamStall}` exported from session-adapter.ts; stripped before forwarding to sdk.query."

key-files:
  created:
    - "src/manager/stream-stall-tracker.ts (180 lines — tracker factory + types)"
    - "src/manager/__tests__/session-adapter-stream-stall.test.ts (291 lines — 6 tests)"
  modified:
    - "src/config/schema.ts (+45 — per-agent + defaults + modelOverrides schema)"
    - "src/shared/types.ts (+22 — ResolvedAgentConfig.streamStallTimeoutMs)"
    - "src/config/loader.ts (+47 — cascade resolver + phase127-resolver log)"
    - "src/config/types.ts (+15 — RELOADABLE_FIELDS entries)"
    - "src/manager/persistent-session-handle.ts (+170 — tracker wiring + extended predicate + cleanup)"
    - "src/manager/session-adapter.ts (+85 — AdapterBaseOptions type + propagation through createSession/resumeSession/wrapSdkQuery)"
    - "src/manager/session-config.ts (+9 — propagate ResolvedAgentConfig.streamStallTimeoutMs into AgentSessionConfig)"
    - "src/manager/types.ts (+38 — AgentSessionConfig.streamStallTimeoutMs + onStreamStall fields)"

key-decisions:
  - "Tracker module is a standalone factory (not inline in two call sites) — single import, single test target. Per feedback_silent_path_bifurcation.md the alternative (inline tracker state in BOTH call sites) is exactly the bifurcation anti-pattern."
  - "Plan-listed file `src/manager/session-adapter.ts` was only the test-only `wrapSdkQuery` path; production routes through `persistent-session-handle.ts:iterateUntilResult`. Wiring only the test path would have shipped a no-op in production. Added persistent-session-handle.ts to scope as Rule 3 (blocking fix)."
  - "`streamStallTimeoutMs` optional on `ResolvedAgentConfig` (matches `memoryRetrievalTokenBudget?: number` precedent) — back-compat with ~25 test factories. Loader always populates; consumers default to 180_000ms."
  - "`defaults.streamStallTimeoutMs` uses `.default(180_000).optional()` combo (same as preDeploySnapshotMaxAgeHours / heartbeatInboxTimeoutMs precedent) so existing DefaultsConfig test factories compile unchanged."
  - "Tracker `onStall` does NOT own the AbortController — caller (persistent-session-handle) invokes `fireInterruptOnce()` so the existing q.interrupt() + 2s deadline race wires up for free."
  - "Daemon-side wiring (Discord notification + session-log persistence) deferred to Plan 02 — the `onStreamStall` callback hook is declared at the AgentSessionConfig boundary; production already emits `phase127-stream-stall` log + aborts even without Plan 02 wiring."
  - "D-07 (advisor-pause integration) deferred — handled in this plan via per-model Opus override (operator can set 300_000ms cushion). Clock-pause integration with AdvisorService deferred to follow-up if operator pain emerges."

patterns-established:
  - "Chokepoint module + single import: src/manager/stream-stall-tracker.ts becomes the template for future SDK iteration-loop supervisor extensions (e.g., per-MCP-server stall tracking deferred to a separate phase)."
  - "AdapterBaseOptions intersection type: replaces 8+ inline `& { readonly mutableSuffix?: string }` site-by-site widenings with a single exported alias — future adapter-only fields slot in without touching every call site."

requirements-completed: [D-01, D-02, D-03, D-04, D-04a, D-05, D-06, D-08, D-10]

duration: 35min
completed: 2026-05-15
---

# Phase 127 Plan 01: No-Useful-Tokens Stream Timeout — Schema + Tracker + Synthetic Tests

**Per-turn stream-stall supervisor with single-chokepoint tracker module: aborts the in-flight SDK turn when no useful content tokens (text_delta or input_json_delta.partial_json) arrive within a per-agent / per-model configurable threshold; closes the 2026-05-14 fin-acquisition 16-min stall pattern.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-05-15T14:11:05Z
- **Completed:** 2026-05-15T14:46:24Z
- **Tasks:** 5 (T-01..T-05)
- **Files modified:** 8 production, 2 created

## Accomplishments

- Per-agent + per-model `streamStallTimeoutMs` schema with operator-tunable defaults (180_000ms baseline, Opus 300_000ms / Haiku 90_000ms recommended via per-model overrides).
- Loader resolver cascade with `phase127-resolver` structured log emission per agent (grep-friendly diagnosis).
- `src/manager/stream-stall-tracker.ts` chokepoint factory used by both the production `persistent-session-handle.ts iterateUntilResult` loop AND the test-only `wrapSdkQuery` path. Single import, single test surface — per `feedback_silent_path_bifurcation.md`.
- Production iteration loop now resets the tracker on text_delta AND input_json_delta.partial_json (the latter previously not recognized — tool-heavy turns would have false-stalled at the proposed threshold). Trips fire `phase127-stream-stall` log + AbortController via existing `fireInterruptOnce()` + 2s deadline race.
- T-127-04 mitigation: tracker stops in BOTH success path AND catch path AND finally block — defense-in-depth against setInterval leaks on any iteration exit.
- 6 synthetic-stream tests (3 STALL cases + 3 cleanup-invariant cases) all green; npx tsc --noEmit clean.

## Task Commits

1. **T-01: Schema + type cascade** — `3db91d5` (feat)
2. **T-02: Loader resolver cascade + phase127-resolver log** — `fd60504` (feat)
3. **T-05: RELOADABLE_FIELDS classification** — `351e572` (feat)
4. **T-03: Tracker module + production wiring** — `94b48eb` (feat)
5. **T-04: Synthetic stream tests** — `f310de3` (test)

Plan metadata commit: pending — created with this SUMMARY.

## Files Created/Modified

### Created
- `src/manager/stream-stall-tracker.ts` — Tracker factory module. `createStreamStallTracker({thresholdMs, onStall, getNow?, checkIntervalMs?})` returns `{markUsefulToken, stop, getLastUsefulTokenAgeMs}`. First-trip-wins semantics, idempotent stop, defensive boolean guards.
- `src/manager/__tests__/session-adapter-stream-stall.test.ts` — 6 tests covering STALL-01..03 + cleanup invariants. Uses `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` for deterministic interval-tick simulation; threshold=1000ms / checkInterval=100ms fixtures keep test runtime <250ms.

### Modified
- `src/config/schema.ts` — Per-agent `streamStallTimeoutMs` (min 30_000, max 1_800_000, optional). `defaults.streamStallTimeoutMs` (.default(180_000).optional() combo for DefaultsConfig back-compat). `defaults.modelOverrides` record keyed by `"haiku"|"sonnet"|"opus"`. configSchema default literal mirror at line 2298+.
- `src/shared/types.ts` — `ResolvedAgentConfig.streamStallTimeoutMs?: number` (optional for test-factory back-compat; loader always populates).
- `src/config/loader.ts` — Cascade resolver: `agent.streamStallTimeoutMs ?? defaults.modelOverrides[resolved.model].streamStallTimeoutMs ?? defaults.streamStallTimeoutMs ?? 180_000`. Emits `console.info("phase127-resolver", JSON.stringify({agent, threshold, sourcedFrom}))` per agent at resolve time (sourcedFrom ∈ {"agent", `modelOverrides.${model}`, "default"}).
- `src/config/types.ts` — `agents.*.streamStallTimeoutMs`, `defaults.streamStallTimeoutMs`, `defaults.modelOverrides` added to RELOADABLE_FIELDS doc-of-intent set.
- `src/manager/persistent-session-handle.ts` — Per-turn `createStreamStallTracker` in `iterateUntilResult` reads threshold from closure-captured baseOptions. Existing stream_event handler at line 858+ extended: predicate now covers both `text_delta.text` AND `input_json_delta.partial_json`. On trip: emit `phase127-stream-stall` log → invoke optional `onStreamStallOption` → `fireInterruptOnce()`. Cleanup wired in BOTH success (`return resMsg.result`), catch, and finally paths.
- `src/manager/session-adapter.ts` — New exported `AdapterBaseOptions = SdkQueryOptions & {mutableSuffix?, streamStallTimeoutMs?, onStreamStall?}` replaces 8 inline intersection types. `stripHandleOnlyFields` strips all three adapter-only fields. `createSession` + `resumeSession` mirror-thread the new fields into baseOptions (Rule 3 symmetric-edits). `wrapSdkQuery` stream_event predicate extended for parity with production.
- `src/manager/session-config.ts` — Propagates `ResolvedAgentConfig.streamStallTimeoutMs` → `AgentSessionConfig.streamStallTimeoutMs` via spread-conditional pattern (byte-stable equality when undefined).
- `src/manager/types.ts` — `AgentSessionConfig` extended with optional `streamStallTimeoutMs?: number` + `onStreamStall?: (payload) => void` fields. JSDoc references Plan 02 for daemon-side wiring of the callback.

## Decisions Made

See `key-decisions` in frontmatter. Most consequential: **plan listed only `src/manager/session-adapter.ts` as the production target, but inspection (line 1517 comment) revealed that file's `iterateWithTracing` is the test-only path; production routes through `persistent-session-handle.ts:iterateUntilResult`.** Wiring only the test path would have shipped a no-op in production — exact reproduction of `feedback_silent_path_bifurcation.md`. Surfaced and documented as a Rule 3 deviation (blocking fix). Both call sites now import the SAME tracker module so future maintenance changes one file, not two.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Wired the production iteration loop in persistent-session-handle.ts, not just session-adapter.ts**
- **Found during:** Pre-T-03 codebase orientation
- **Issue:** Plan's `files_modified` listed `src/manager/session-adapter.ts` only. That file's `iterateWithTracing` function is **test-only** — the file itself (line 1517) explicitly says `No production caller reaches wrapSdkQuery`. Production routes through `createPersistentSessionHandle` in `persistent-session-handle.ts:iterateUntilResult`. Implementing the tracker only in session-adapter.ts would have been a silent no-op in production — exact reproduction of the `feedback_silent_path_bifurcation.md` anti-pattern the plan's own D-03 invokes.
- **Fix:** Extracted the tracker into a new chokepoint module (`src/manager/stream-stall-tracker.ts`). Both `persistent-session-handle.ts:iterateUntilResult` (production) and `session-adapter.ts:wrapSdkQuery` (test-only — predicate update only, tracker not wired since no production caller reaches it) import the same factory. Single chokepoint, single test target.
- **Files modified (added beyond plan scope):** `src/manager/persistent-session-handle.ts`, `src/manager/session-config.ts`, `src/manager/types.ts`.
- **Verification:** All 6 synthetic-stream tests green; persistent-session-handle.test.ts still green (no regressions).
- **Committed in:** `94b48eb` (T-03)

**2. [Rule 2 — Missing Critical] Extended useful-token predicate to recognize input_json_delta.partial_json**
- **Found during:** T-03 wiring
- **Issue:** The existing stream_event handler at line 858 recognized only `text_delta.text`. Per CONTEXT.md D-02, tool-use streams emit `input_json_delta.partial_json` (not text_delta). Without this widening, an agent dictating a long tool-use parameter would have false-stalled at the proposed threshold — exactly the scenario D-02 names as critical to avoid.
- **Fix:** Widened the predicate at both production and test-path call sites. Only the production path marks the tracker; the test path mirrors the predicate so test fixtures see consistent useful-token semantics.
- **Files modified:** `src/manager/persistent-session-handle.ts`, `src/manager/session-adapter.ts`.
- **Verification:** STALL-03 test (input_json_delta resets tracker, no trip across threshold * 3) green.
- **Committed in:** `94b48eb` (T-03)

**3. [Rule 1 — Bug] DefaultsConfig schema field needed `.default(180_000).optional()` combo**
- **Found during:** T-01 tsc check
- **Issue:** Adding `defaults.streamStallTimeoutMs: z.number().default(180_000)` made `z.infer<typeof defaultsSchema>.streamStallTimeoutMs` a required `number`, which broke 7 test factories that build `DefaultsConfig` literals manually. The plan acknowledged factories would need updates but ~25+ files in the broader test suite still had this pattern.
- **Fix:** Used `.default(180_000).optional()` combo (precedent: `preDeploySnapshotMaxAgeHours` and `heartbeatInboxTimeoutMs` in defaultsSchema). This makes the parse-time default still 180_000 while the inferred type is `number | undefined` — back-compat for factories, loader cascade handles the runtime fallback. Adds a defensive `?? 180_000` to the cascade.
- **Files modified:** `src/config/schema.ts`, `src/config/loader.ts`.
- **Verification:** tsc clean across the whole codebase.
- **Committed in:** `3db91d5` (T-01) + `fd60504` (T-02)

---

**Total deviations:** 3 auto-fixed (1 blocking, 1 missing critical, 1 bug)
**Impact on plan:** All three deviations preserve the plan's intent (single chokepoint, no false-stalls, schema cascade); none introduce scope creep beyond Phase 127's bounds (no provider failover, no MCP-tool stall tracking, no auto-tuning). Deviation #1 is structurally important: the plan's anchor (line 1913 in session-adapter.ts) was based on a stale read of the call chain.

## Issues Encountered

**Pre-existing manager test-suite flakiness** — The broader vitest run on `src/manager/__tests__/` reports ~30 failures across 14 files. These reproduce on the master baseline (verified by checkout/reset to HEAD~4 before the Phase 127 commits) and are unrelated to my changes:

- `daemon-openai.test.ts` (7 failures): `handle.enabled: false` returned even when config has `enabled: true` — vi.mock pollution across the file.
- `clawcode-yaml-phase100.test.ts`, `schema.test.ts PR11` (2 failures): tests read `process.cwd()/clawcode.yaml` which doesn't exist in this dev workspace.
- `dream-prompt-builder.test.ts`, `session-config.test.ts`, `bootstrap-integration.test.ts`, `session-memory-warmup.test.ts`, `warm-path-mcp-gate.test.ts`, etc. — various timing-sensitive tests with tmpdir cleanup ENOTEMPTY errors and timeouts under parallel-pool load.

**Targeted verification approach** confirms no regressions from Phase 127:
- `loader.test.ts` — 137/137 pass in isolation.
- `persistent-session-handle.test.ts` — green in isolation (19 tests).
- `session-adapter-stream-stall.test.ts` — 6/6 pass.
- `schema.test.ts` — 194/195 pass (1 failure is the pre-existing missing-yaml).
- `differ.test.ts` — all pass.
- `npx tsc --noEmit` — clean.

These flaky tests are tracked in `deferred-items.md` of related phases; addressing them is out of scope for Phase 127 (which is a supervisor extension, not a test-suite stabilization).

## TDD Gate Compliance

T-03 was marked `tdd="true"` in the plan. Strictly speaking the gate-sequence should have been `test(...)` (T-04 RED) → `feat(...)` (T-03 GREEN). The tracker module + tests were developed together in this session; the commit ordering ended up:
- `94b48eb feat(127-01-T03): stream-stall tracker + AbortController trip behavior` (factory + production wiring + test-mode tests already passing)
- `f310de3 test(127-01-T04): synthetic stream-stall fixture` (the 6-test file)

The tracker module was written with the tests in mind (test-first thinking) and verified green before commit; the commit-level split puts feat before test which doesn't reflect the gate flow precisely. The test code did exist locally and pass before the feat commit (verified via the green run before the commit); only the commit boundary moved the test file forward by one commit. Documenting as a minor gate-sequence deviation rather than refusing to commit retroactively.

## Self-Check

### Acceptance criteria from plan body
- [x] `grep -c streamStallTimeoutMs src/config/schema.ts` ≥ 3 → **12** (per-agent + defaults + modelOverrides + comments)
- [x] `grep -c streamStallTimeoutMs src/config/loader.ts` ≥ 1 → **multiple** (cascade + resolver)
- [x] `grep -c phase127-resolver src/config/loader.ts` → 1 emission (+ 3 in comments)
- [x] `grep -c phase127-stream-stall src/manager/persistent-session-handle.ts` → 1 emission (+ 2 in comments)
- [x] `grep -c streamStallTimeoutMs` across schema/types/loader/adapter/tests ≥ 5 → **30+**
- [x] `npx tsc --noEmit` clean
- [x] `npx vitest run src/manager/__tests__/session-adapter-stream-stall.test.ts` — 6/6 green

### File existence
- [x] `src/manager/stream-stall-tracker.ts` — FOUND
- [x] `src/manager/__tests__/session-adapter-stream-stall.test.ts` — FOUND
- [x] `.planning/phases/127-no-useful-tokens-stream-timeout/127-01-SUMMARY.md` — THIS FILE

### Commit existence (git log)
- [x] `3db91d5` — feat(127-01-T01) FOUND
- [x] `fd60504` — feat(127-01-T02) FOUND
- [x] `351e572` — feat(127-01-T05) FOUND
- [x] `94b48eb` — feat(127-01-T03) FOUND
- [x] `f310de3` — test(127-01-T04) FOUND

## Self-Check: PASSED

## Threat Flags

None. The new surface (stream-stall supervisor) is internal-only — no network endpoints, no new auth paths, no file access patterns, no schema changes at trust boundaries. The optional `onStreamStall` callback is consumed only by daemon-side wiring (Plan 02), which is the only legitimate caller.

## User Setup Required

None — Phase 127 Plan 01 ships local code only. Production deploy gated on Ramy-quiet window per `feedback_ramy_active_no_deploy.md`. Operators can dial per-model thresholds in clawcode.yaml when Plan 02 lands the Discord notification wiring.

## Next Phase Readiness

- **Plan 02 (daemon-side wiring):** Ready to dispatch. The `onStreamStall` callback hook is declared at the AgentSessionConfig boundary; Plan 02 wires Discord webhook notification + session-log row persistence (Phase 124/125 compaction extractor reads it). The production wiring in this plan already emits `phase127-stream-stall` log + aborts via fireInterruptOnce() so the protective behavior is live even before Plan 02.
- **Plan 03 (operator-gated production verification):** Holds for Ramy-quiet window. Plan 03 confirms the schema cascade in production yaml + observes a real-world stall scenario.

---
*Phase: 127-no-useful-tokens-stream-timeout*
*Completed: 2026-05-15*
