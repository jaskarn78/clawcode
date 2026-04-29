---
phase: 103-clawcode-status-rich-telemetry-usage-panel-operator-observability
plan: 02
subsystem: observability
tags: [rate-limit, sdk-hook, usage-tracker, di-mirror, persistent-session-handle]

# Dependency graph
requires:
  - phase: 103
    plan: 01
    provides: SessionManager DI mirror precedent (setHeartbeatRunner, activationAtByAgent in-memory mirror) + canonical wrapper pattern (compactForAgent) — Plan 02 lifts both into the rate-limit dimension
  - phase: 96
    provides: 6th DI mirror application (FsCapabilitySnapshot) — Plan 02 is the 7th application of the same pattern
  - phase: 73
    provides: createPersistentSessionHandle + iterateUntilResult message dispatch loop (the only SDK-touching site that can hook rate_limit_event)
  - phase: 50
    provides: UsageTracker per-agent SQLite DB (one DB per agent; rate_limit_snapshots table is additive into the same DB)
provides:
  - RateLimitTracker class + RateLimitSnapshot type (src/usage/rate-limit-tracker.ts)
  - rate_limit_snapshots SQLite table (additive into UsageTracker DB)
  - SessionHandle.getRateLimitTracker / setRateLimitTracker DI mirror pair (7th application)
  - persistent-session-handle.iterateUntilResult rate_limit_event dispatch branch (line 587, BEFORE the result terminator)
  - SessionManager.getRateLimitTrackerForAgent (Plan 03 IPC consumer)
  - SessionManager per-agent tracker construction at startAgent + cleanup at stopAgent
affects: [103-03, future Plan 03 /clawcode-usage Discord slash command, /clawcode-status session/weekly bars]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "7th application of the post-construction DI mirror pattern (after McpState, FlapHistory, RecoveryAttemptHistory, SupportedCommands, ModelMirror, FsCapability) — established by Phase 85 and reused unchanged"
    - "Observational SDK message hook — try/catch + swallow, optional-chaining over the injected dependency, mirrors extractUsage at persistent-session-handle.ts:300"
    - "Best-effort capture under DI race window (Pitfall 8) — handle constructed before injection means a tiny window where rate_limit_event messages are silently dropped; documented in code comments, never throws"
    - "UPSERT-by-rateLimitType primary key — one row per type (five_hour, seven_day, seven_day_opus, seven_day_sonnet, overage), latest snapshot per type is the only stored state"
    - "Schema co-tenancy in shared per-agent DB — rate_limit_snapshots lives in the UsageTracker DB rather than a second SQLite file (one DB handle per agent stays clean)"

key-files:
  created:
    - src/usage/rate-limit-tracker.ts
    - src/usage/__tests__/rate-limit-tracker.test.ts
    - src/manager/__tests__/rate-limit-event-capture.test.ts
  modified:
    - src/usage/tracker.ts
    - src/manager/persistent-session-handle.ts
    - src/manager/session-adapter.ts
    - src/manager/session-manager.ts
    - src/openai/__tests__/template-driver-cost-attribution.test.ts
    - src/openai/__tests__/template-driver.test.ts
    - src/openai/__tests__/transient-session-cache.test.ts

key-decisions:
  - "rate_limit_snapshots table lives in the per-agent UsageTracker DB rather than a separate SQLite file — one DB handle per agent stays clean (Research §Architecture)"
  - "rateLimitType is stored as TEXT (not the SDK's 5-value union) so a future SDK release that grows the union still captures + persists the new type (Pitfall 10 closure)"
  - "surpassedThreshold typed as number|undefined (not bool) — the SDK is OPTIONAL NUMBER (Pitfall 9)"
  - "Persistence is best-effort — SQLite write failure inside record() is logged + swallowed; in-memory state remains source of truth for current process"
  - "Snapshots are Object.freeze'd individually + getAllSnapshots returns a frozen array — honors the project immutability rule and prevents external mutation of stored state"
  - "Tracker constructed conditionally on usageTracker presence in startAgent — when an agent has no UsageTracker (memoryEnabled=false fallback), the dispatch hook silently no-ops via optional-chain (Pitfall 7 graceful degradation)"
  - "Hook positioned BEFORE the result branch — although the two msg.type values are mutually exclusive, ordering documents the result-terminator path is unchanged and survives the addition"

patterns-established:
  - "Post-construction DI mirror pattern is now battle-tested at 7 applications across Phases 85, 94, 87, 86, 96, 103-01, 103-02 — the next application is 'just another setX/getX pair' with zero open questions"
  - "Observational hook pattern (try/catch + swallow + optional-chain) is canonical for any SDK-fired side-channel data — extractUsage (Phase 50), rate_limit_event (Phase 103); future SDK additions (e.g. SDKAuthStatusMessage, SDKSessionStateChangedMessage) follow the same shape"

requirements-completed: [OBS-04, OBS-05]

# Metrics
duration: ~22min
completed: 2026-04-29
---

# Phase 103 Plan 02: RateLimitTracker primitive + SDK rate_limit_event hook Summary

**Wired the SDK's previously-ignored `rate_limit_event` messages into a per-agent RateLimitTracker that persists snapshots to the existing UsageTracker SQLite DB — Plan 03 now has live rate-limit data for the /clawcode-usage panel and /clawcode-status session/weekly bars.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-04-29T14:38:00Z
- **Completed:** 2026-04-29T15:00:00Z
- **Tasks:** 2 (both TDD)
- **Files created:** 3 (RateLimitTracker + 2 test files)
- **Files modified:** 7 (tracker.ts schema extension, 3 src/manager/* DI wiring, 3 OpenAI test mocks)

## Accomplishments

- New `RateLimitTracker` primitive (src/usage/rate-limit-tracker.ts, ~135 lines): UPSERT by rateLimitType, in-memory + SQLite mirror, restart-resilient restore on construct, frozen snapshots, all 9 SDKRateLimitInfo fields preserved
- New `rate_limit_snapshots` SQLite table additive into the UsageTracker DB schema (src/usage/tracker.ts initSchema)
- SDK `rate_limit_event` dispatch hook in persistent-session-handle.iterateUntilResult at line 587 (before the result terminator), observational try/catch + swallow, optional-chained tracker injection
- 7th application of the post-construction DI mirror pattern: getRateLimitTracker / setRateLimitTracker pair on SessionHandle interface, InMemoryFakeHandle, wrapSdkQuery legacy handle, and persistent-session-handle production handle
- Per-agent tracker construction + injection in SessionManager.startAgent (after MCP state injection, sharing the agent's UsageTracker DB handle)
- Public accessor `SessionManager.getRateLimitTrackerForAgent` ready for Plan 03 IPC consumer
- Cleanup wired in stopAgent alongside other Phase 103 per-agent state (compactionCounts, activationAtByAgent)

## Hook Insertion Point (for Plan 03 reviewers)

The `rate_limit_event` dispatch branch is in `src/manager/persistent-session-handle.ts` inside `iterateUntilResult`, **immediately before** the `result` branch:

- **File:** `src/manager/persistent-session-handle.ts`
- **Line range:** 576-595 (branch comment + branch body)
- **Branch starts at:** line 587 (`if ((msg as { type?: string }).type === "rate_limit_event")`)
- **Mirror field:** `_rateLimitTracker` declared at line 263 alongside `_fsCapabilitySnapshot` (line 252)
- **Accessor pair:** `getRateLimitTracker` / `setRateLimitTracker` at lines 941-967, immediately after `setFsCapabilitySnapshot`

The plan's assumed line numbers (244-252 for `_fsCapabilitySnapshot`, 538-562 for the hook insertion, 855-886 for the accessor) had shifted by ~10-50 lines due to the Plan 01 edits (added imports + new comments), but the pattern anchors (`_fsCapabilitySnapshot` mirror, `setFsCapabilitySnapshot` accessor, the `if (msg.type === "result")` branch) were trivially findable via grep — no architectural deviation.

## SQLite Schema Added

Added to `UsageTracker.initSchema` (src/usage/tracker.ts:184-194), additive — never touches existing `usage_events` rows:

```sql
CREATE TABLE IF NOT EXISTS rate_limit_snapshots (
  rate_limit_type TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
);
```

The `rate_limit_type` PK is what gives the tracker its UPSERT semantics — two records of the same type overwrite. Payload is JSON-encoded RateLimitSnapshot (the in-memory shape) so future field additions don't require a schema migration.

The `RateLimitTracker` constructor also issues `CREATE TABLE IF NOT EXISTS` defensively so the primitive can be constructed against any better-sqlite3 DB (including `:memory:` in tests) without depending on UsageTracker having run first. Both creates are idempotent and either ordering is safe.

## 7th DI-Mirror Application (running list per STATE.md convention)

| # | Phase    | Mirror                       | Anchored at                         |
| - | -------- | ---------------------------- | ----------------------------------- |
| 1 | 85       | McpState                     | persistent-session-handle.ts        |
| 2 | 94 P02   | FlapHistory                  | persistent-session-handle.ts        |
| 3 | 94 P03   | RecoveryAttemptHistory       | persistent-session-handle.ts        |
| 4 | 87 CMD-01| SupportedCommands (cache)    | persistent-session-handle.ts        |
| 5 | 86 MODEL-03| ModelMirror                | persistent-session-handle.ts        |
| 6 | 96       | FsCapabilitySnapshot         | persistent-session-handle.ts        |
| 7 | **103-02** | **RateLimitTracker**       | **persistent-session-handle.ts**    |

The pattern is now battle-tested at 7 applications. Future applications get a paragraph of code, not a research phase.

## Task Commits

Each task was committed atomically following TDD discipline:

1. **Task 1 RED: rate-limit-tracker tests** — `25bcd17` (test) — 10 failing tests pin per-rateLimitType independence, UPSERT, freezing, Pitfall 9/10 closures, SQLite restore round-trip
2. **Task 1 GREEN: RateLimitTracker primitive + tracker.ts schema extension** — `d69e385` (feat) — class + Object.freeze + best-effort persistence + idempotent CREATE TABLE in both initSchema and tracker constructor
3. **Task 2 RED: rate-limit-event-capture tests** — `7d1cac9` (test) — 3 tests for SDK dispatch + Pitfall 8 silent-drop + result-terminator invariant; inlines buildFakeSdk helper local to the test file
4. **Task 2 GREEN: SDK hook + DI mirror + SessionManager wiring** — `f989e29` (feat) — interface widening, persistent-handle dispatch branch + accessor pair, SessionManager construction/injection/accessor/cleanup, OpenAI test mock updates to keep TS baseline at 107 errors

## Verification

```
$ npx vitest run src/usage/__tests__/rate-limit-tracker.test.ts \
                src/manager/__tests__/rate-limit-event-capture.test.ts \
                src/manager/__tests__/persistent-session-cache.test.ts \
                src/openai/__tests__/template-driver-cost-attribution.test.ts \
                src/openai/__tests__/template-driver.test.ts \
                src/openai/__tests__/transient-session-cache.test.ts
 Test Files  6 passed (6)
      Tests  61 passed (61)
```

Full sweep across `src/usage` and `src/manager`:

```
$ npx vitest run src/usage src/manager
 Test Files  6 failed | 95 passed (101)
      Tests  16 failed | 1225 passed (1241)
```

The 16 failures are **all pre-existing** (verified by `git stash` + re-run on master pre-Plan-02 → identical 16 failures across the same 6 files: daemon-openai, dream-prompt-builder, daemon-warmup-probe, restart-greeting, bootstrap-integration, session-config). None are caused by Plan 02 changes; all are out-of-scope per the SCOPE BOUNDARY rule.

Substring acceptance gates (all pass):

- `grep -F 'export class RateLimitTracker' src/usage/rate-limit-tracker.ts` → 1 hit
- `grep -c 'Object.freeze' src/usage/rate-limit-tracker.ts` → 4 (≥2 required)
- `grep -F 'ON CONFLICT(rate_limit_type)' src/usage/rate-limit-tracker.ts` → 1 hit
- `grep -F 'info.rateLimitType ?? "unknown"' src/usage/rate-limit-tracker.ts` → 1 hit (using double quotes, not single — TypeScript convention)
- `grep -F 'rate_limit_snapshots' src/usage/tracker.ts` → 1 hit (in initSchema CREATE TABLE)
- `grep -n 'rate_limit_event' src/manager/persistent-session-handle.ts` → 4 hits (3 in comments + 1 in the branch condition at line 587)
- `grep -F '_rateLimitTracker?.record(' src/manager/persistent-session-handle.ts` → 1 hit
- `grep -c 'getRateLimitTracker\|setRateLimitTracker' src/manager/session-adapter.ts` → 8 (≥4 required: interface decl pair + InMemoryFakeHandle pair + wrapSdkQuery legacy pair + 2 doc comments)
- `grep -F 'getRateLimitTrackerForAgent' src/manager/session-manager.ts` → 2 hits (doc comment + method)
- `grep -F 'new RateLimitTracker(' src/manager/session-manager.ts` → 1 hit
- `grep -F 'handle.setRateLimitTracker(' src/manager/session-manager.ts` → 1 hit

TypeScript: `npx tsc --noEmit` reports **107 errors — exactly the Plan 01 baseline.** Diffed against the pre-Plan-02 baseline: my changes introduced 3 new errors in OpenAI test mocks (Rule 3 blocking — interface widening forced mock updates) which I addressed in the GREEN commit, restoring the 107 floor. Zero net new errors.

## Deviations from Plan

### [Rule 3 — Blocking] OpenAI test mocks needed updates after SessionHandle widening

**Found during:** Task 2 GREEN — running `npx tsc --noEmit` after the interface change

**Issue:** Three OpenAI test files (template-driver-cost-attribution.test.ts, template-driver.test.ts, transient-session-cache.test.ts) construct partial SessionHandle objects manually (no harness) and TypeScript correctly flagged them as missing the new `getRateLimitTracker / setRateLimitTracker` methods. Each was already keeping pace with prior DI mirror additions (Phase 85 McpState, Phase 96 FsCapability), so adding Phase 103 was the established convention.

**Fix:** Added `getRateLimitTracker: vi.fn().mockReturnValue(undefined)` + `setRateLimitTracker: vi.fn()` to each of the 3 mock objects, alongside the existing `setFsCapabilitySnapshot` entries. This mirrors how Phase 96 added `getFsCapabilitySnapshot/setFsCapabilitySnapshot` to the same mocks.

**Files modified:** `src/openai/__tests__/template-driver-cost-attribution.test.ts`, `src/openai/__tests__/template-driver.test.ts`, `src/openai/__tests__/transient-session-cache.test.ts`

**Commit:** `f989e29` (folded into Task 2 GREEN — necessary for GREEN to compile)

### [Adaptation, not deviation] buildHandleWithFakeSdk helper inlined per plan's fallback guidance

**Plan said:** "If reproducing is heavy, prefer placing the test fixture in the same harness file as `persistent-session-cache.test.ts` and re-exporting from there. Otherwise: extract the buildHandleWithFakeSdk helper to `src/manager/__tests__/__helpers__/build-handle.ts`"

**What I did:** Inlined `buildFakeSdk` (canonical pattern from persistent-session-cache.test.ts) AND a thin `buildHandleWithFakeSdk` wrapper directly in the new `rate-limit-event-capture.test.ts`. Total helper code is ~110 lines and self-contained. Rationale: only one consumer at this point (Plan 02), so the second-or-third-consumer rule of helper extraction (DRY-on-third-call) hasn't been triggered. If Plan 03 needs the same harness, that's the time to extract.

**Commit:** `7d1cac9` (RED test commit — helper is part of the test file)

### [Adaptation, not deviation] Plan's assumed line numbers shifted post-Plan-01

**Plan said:** "_fsCapabilitySnapshot mirror around line 252; hook insertion 538-562; accessor pattern 855-886"

**Reality after Plan 01 + other recent commits:** `_fsCapabilitySnapshot` at line 252 (correct), the hook insertion site is at line 587 (was 564 — `result` branch shifted by ~25 lines due to imports + the Phase 96 mirror block), accessor pattern at lines 902-928 (`setFsCapabilitySnapshot` ends at 928, my new pair starts at 941).

**What I did:** Used grep anchors (`_fsCapabilitySnapshot`, `setFsCapabilitySnapshot`, `if (msg.type === "result")`) instead of line numbers to locate the insertion sites. No architectural deviation; line numbers in the SUMMARY now reflect post-Plan-02 reality.

## Pitfall Closure Confirmation

- **Pitfall 7 (graceful degradation when no UsageTracker):** Confirmed — startAgent block guards on `if (usageTracker)`, dispatch branch optional-chains `_rateLimitTracker?.record(...)`, accessor returns `undefined` for unknown agents. /clawcode-usage will see `undefined` and render "no data" cleanly.
- **Pitfall 8 (race window between handle construction and tracker injection):** Documented in the mirror field's doc comment AND the dispatch branch's doc comment. Race window = handle constructed at `createSession` (line 659 of session-manager.ts) → MCP state injected → tracker injected (line ~837). Messages arriving in that window are silently dropped; `?.record(...)` makes it impossible to throw.
- **Pitfall 9 (surpassedThreshold is NUMBER not bool):** Confirmed — RateLimitSnapshot type declares `surpassedThreshold: number | undefined`; test "preserves surpassedThreshold as number" asserts `typeof === "number"`.
- **Pitfall 10 (rateLimitType missing → 'unknown'):** Confirmed — `info.rateLimitType ?? "unknown"` in record(); test "missing rateLimitType stored as 'unknown'" pins the behavior; rateLimitType column type is TEXT (not the SDK's 5-value union) so future SDK additions don't drop messages.

## Test Coverage Delta

- rate-limit-tracker.test.ts: +10 tests (new file)
- rate-limit-event-capture.test.ts: +3 tests (new file)
- Net new test count: +13 tests

## Known Stubs

None. RateLimitTracker is fully wired end-to-end:
- SDK dispatches into the hook
- Hook calls into the tracker
- Tracker persists to SQLite
- SessionManager.getRateLimitTrackerForAgent exposes the tracker for Plan 03 consumers
- The accessor returns `undefined` for unknown / not-yet-started agents (Pitfall 7), which is the documented "no data" signal — not a stub.

## Self-Check: PASSED

Verified:
- `[ -f src/usage/rate-limit-tracker.ts ]` → FOUND
- `[ -f src/usage/__tests__/rate-limit-tracker.test.ts ]` → FOUND
- `[ -f src/manager/__tests__/rate-limit-event-capture.test.ts ]` → FOUND
- `git log --oneline | grep -q 25bcd17` → FOUND (Task 1 RED commit)
- `git log --oneline | grep -q d69e385` → FOUND (Task 1 GREEN commit)
- `git log --oneline | grep -q 7d1cac9` → FOUND (Task 2 RED commit)
- `git log --oneline | grep -q f989e29` → FOUND (Task 2 GREEN commit)
- 13/13 new tests pass; 0 new tsc errors (107 baseline preserved)
- All acceptance grep gates pass
