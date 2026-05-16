---
phase: 103-clawcode-status-rich-telemetry-usage-panel-operator-observability
plan: 01
subsystem: observability
tags: [discord-slash, status-render, usage-tracker, compaction-counter, heartbeat-zone, session-manager]

# Dependency graph
requires:
  - phase: 93
    provides: 9-line OpenClaw-parity status block scaffold (status-render.ts buildStatusData/renderStatus + R-01..R-08 tests)
  - phase: 73
    provides: SessionHandle.hasActiveTurn() (depth-1 SerialTurnQueue inFlight slot)
  - phase: 50
    provides: UsageTracker (tokens_in/tokens_out/event_count session aggregate + per-session DB)
provides:
  - SessionManager.getCompactionCountForAgent (in-memory per-agent counter)
  - SessionManager.compactForAgent (canonical CompactionManager.compact wrapper, bumps counter on resolve only)
  - SessionManager.getContextFillPercentageForAgent (HeartbeatRunner zone read)
  - SessionManager.getActivationAtForAgent (in-memory mirror of registry.startedAt)
  - SessionManager.setHeartbeatRunner (DI setter, mirrors setWebhookManager pattern)
  - status-render.ts wiring 8 live fields + dropping 3 OpenClaw-only fields
  - effortToReasoningLabel helper (7-tier effort → human-friendly reasoning label)
  - Compaction counter contract: bumps ONLY on resolve, never on rejection (Pitfall 3)
affects: [103-02, 103-03, future Usage panel, /clawcode-status verification gates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DI setter pattern (setHeartbeatRunner) for post-construction injection of cross-cutting runners"
    - "In-memory mirror of registry write (activationAtByAgent) — sync accessor for status renders without async readRegistry per call"
    - "Canonical wrapper for side-effect-bearing calls (compactForAgent wraps CompactionManager.compact so the counter is the single source of truth)"
    - "tryRead<T>(fn, fallback) defensive accessor closure preserved across all 8 SessionManager Pick'd reads — no thrown error can collapse the 9-line render"

key-files:
  created:
    - src/manager/__tests__/compaction-counter.test.ts
  modified:
    - src/manager/session-manager.ts
    - src/manager/daemon.ts
    - src/discord/status-render.ts
    - src/discord/__tests__/status-render.test.ts

key-decisions:
  - "Compaction counter is in-memory only (Open Q4) — resets on daemon restart; informational, not persistence-worthy"
  - "Counter bumps ONLY on CompactionManager.compact() resolve (Pitfall 3) — rejection leaves count unchanged, so 'Compactions: N' reflects SUCCESSFUL flushes only"
  - "compactForAgent is the canonical entry point — verified by grep closure (only 2 production references to .compact( remain: definition site + wrapper)"
  - "HeartbeatRunner injected via setHeartbeatRunner DI setter rather than constructor argument — matches existing setWebhookManager / setMemoryScanner / setBotDirectSender patterns and avoids changing SessionManagerOptions"
  - "Activation timestamp mirrored in-memory via activationAtByAgent Map at startAgent — registry remains source of truth for restart recovery, but synchronous status renders don't await readRegistry per request"
  - "Reasoning label is derived from effort tier in render, not stored as a separate field (effort and reasoning are semantically equivalent in ClawCode; OpenClaw split is preserved in line layout for parity)"
  - "lastActivityAt sourced from UsageTracker DB MAX(timestamp) — pure SQL read in render path; alternative would be adding tracker.getLastEventTimestamp accessor (deferred to future phase if observability needs grow)"

patterns-established:
  - "In-memory state mirror for sync status accessors: when registry holds the truth but is async, daemon writes BOTH places at the same call site so accessors stay sync (activationAtByAgent + this.registryPath in startAgent)"
  - "Canonical wrapper for counted operations: caller-side counters get bypassed too easily; wrapping the operation in SessionManager (compactForAgent) means the counter is part of the contract, not a callsite obligation"

requirements-completed: [OBS-01, OBS-02, OBS-03]

# Metrics
duration: ~25min
completed: 2026-04-29
---

# Phase 103 Plan 01: /clawcode-status Live Wiring + Compaction Counter Summary

**Wired 8 hardcoded `n/a` placeholders to live telemetry, dropped 3 OpenClaw-only fields, and added an in-memory compaction counter so `/clawcode-status` finally answers "what is this agent doing right now?"**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-29T14:13:00Z
- **Completed:** 2026-04-29T14:33:00Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- 8 fields newly wired live: Compactions, Context %, Tokens (in/out), Activation, Queue, Reasoning label, Permissions live read, Session "updated <ago>" (lastActivityAt)
- 3 OpenClaw-only fields dropped: Fast / Elevated / Harness — substring grep gates pin the absence
- Per-agent compaction counter mirror with strict resolve-only semantics (Pitfall 3 — rejection cannot inflate the count)
- `compactForAgent` established as the canonical entry point — closure check pins zero direct `CompactionManager.compact()` callers in production code
- HeartbeatRunner injected into SessionManager via DI setter so the renderer can read context-zone fillPercentage synchronously

## Task Commits

Each task was committed atomically following TDD discipline:

1. **Task 1 RED: compaction-counter test** — `e2b790c` (test) — 5 failing tests pin the counter contract
2. **Task 1 GREEN: counter mirror + 4 accessors** — `a053712` (feat) — SessionManager exposes getCompactionCountForAgent / compactForAgent / getContextFillPercentageForAgent / getActivationAtForAgent + setHeartbeatRunner DI
3. **Task 1 wiring: daemon HeartbeatRunner injection** — `4fcd459` (feat) — production hookup so getContextFillPercentageForAgent isn't always undefined
4. **Task 2 RED: status-render OBS-01/02/03 tests** — `aa064f0` (test) — 12 new tests + reshaped R-01..R-08 fail against Phase 93 implementation
5. **Task 2 GREEN: status-render wiring** — `cea7607` (feat) — 8 live fields wired, 3 OpenClaw fields dropped, effortToReasoningLabel helper, lastActivityAt sourced from UsageTracker DB
6. **Task 2 cleanup: substring scrub** — `70e4363` (chore) — drop OpenClaw substrings from doc comments so file-level grep gate passes

## Files Created/Modified

- `src/manager/__tests__/compaction-counter.test.ts` (created) — 5 tests pinning counter contract: 0 baseline / +1 on resolve / +2 across two compactions / 0 after rejection / per-agent isolation
- `src/manager/session-manager.ts` (modified) — added `compactionCounts: Map<string, number>`, `activationAtByAgent: Map<string, number>`, `heartbeatRunner` private field; added `setHeartbeatRunner` DI setter; added 4 accessors near existing `getCompactionManager` (line 1640 region); mirrored `startedAt` write in startAgent and clear-on-stop in stopAgent
- `src/manager/daemon.ts` (modified) — single line wiring `manager.setHeartbeatRunner(heartbeatRunner)` after the runner starts
- `src/discord/status-render.ts` (modified) — extended StatusData with 5 new readonly fields; widened BuildStatusDataInput Pick to 8 SessionManager methods; added effortToReasoningLabel helper; rewrote renderStatus body to wire all 8 live fields and drop the 3 OpenClaw-only ones
- `src/discord/__tests__/status-render.test.ts` (modified) — extended R-01..R-08 to match new line shape; added makeInput stub helper; added "/clawcode-status — Phase 103 OBS-01/02/03 wiring" describe block (12 tests)

## Verification

```
$ npx vitest run src/discord/__tests__/status-render.test.ts \
                src/manager/__tests__/compaction-counter.test.ts \
                src/manager/__tests__/session-manager.test.ts
 Test Files  3 passed (3)
      Tests  79 passed (79)
```

- 20 status-render tests (8 reshaped R-01..R-08 + 12 new OBS)
- 5 compaction-counter tests
- 54 session-manager regression tests (all still pass)

Substring closure checks:

- `grep -F 'Fast:' src/discord/status-render.ts` → 0 hits
- `grep -F 'Elevated:' src/discord/status-render.ts` → 0 hits
- `grep -F 'Harness:' src/discord/status-render.ts` → 0 hits
- `grep -rEn '\b(compact)\(' src/ --include="*.ts"` (excluding tests) → exactly 2 production hits: `compaction.ts:84` (definition) + `session-manager.ts:1739` (the wrapper)

TypeScript: `npx tsc --noEmit` reports 107 errors, all pre-existing in unrelated files (triggers/engine.test.ts, usage/budget.ts, usage/__tests__/daily-summary.test.ts, manager/__tests__/session-manager.test.ts WarmPathResult mismatches). Compared against pre-change baseline (118 errors), my changes REDUCE the error count by 11 by transitively fixing some types — zero new errors introduced.

## Deviations from Plan

### [Rule 3 - Blocking] HeartbeatRunner is not a SessionManager constructor dep

**Found during:** Task 1 Step 2 (adding `getContextFillPercentageForAgent`)

**Issue:** Plan assumed `this.heartbeatRunner` was already a private field of SessionManager. Reality: the HeartbeatRunner is constructed in `daemon.ts:2274`, AFTER SessionManager (constructed at ~`daemon.ts:1014`). SessionManager has no constructor argument or field for it.

**Fix:** Added a private `heartbeatRunner: HeartbeatRunner | undefined` field initialized to `undefined`, plus a `setHeartbeatRunner(runner)` DI setter mirroring the existing `setWebhookManager` / `setMemoryScanner` / `setBotDirectSender` patterns. Wired in `daemon.ts` right after the runner starts and ThreadManager is set up (line 2326). The accessor returns `undefined` gracefully when the runner isn't injected (tests / minimal fixtures).

**Files modified:** `src/manager/session-manager.ts`, `src/manager/daemon.ts`

**Commit:** `a053712` (SessionManager) + `4fcd459` (daemon)

### [Rule 3 - Blocking] No `registryCache` field — registry reads are async via `readRegistry(this.registryPath)`

**Found during:** Task 1 Step 2 (adding `getActivationAtForAgent`)

**Issue:** Plan assumed `this.registryCache.entries.find(...)` for sync registry access. Reality: SessionManager doesn't cache the registry; every read is `await readRegistry(this.registryPath)`. Status renders happen on every `/clawcode-status` invocation — making the renderer awaitable would cascade async through the whole render path.

**Fix:** Added an in-memory `activationAtByAgent: Map<string, number>` mirror. The `startAgent` warm-path completion writes to BOTH the registry (existing behavior) AND the mirror at the same call site. The mirror is cleared in `stopAgent` alongside other per-agent state. Registry remains the source of truth for restart recovery; the mirror is purely a sync accessor for renders. This matches the pattern already used by `compactionCounts` (in-memory, restart-resets, informational).

**Files modified:** `src/manager/session-manager.ts`

**Commit:** `a053712`

### [Rule 1 - Bug] R-01 baseline test needed reshape, not just extension

**Found during:** Task 2 RED iteration

**Issue:** Plan said "do NOT modify existing R-01..R-07 — they must continue to pass". But the EXISTING R-01..R-07 assert exact line-by-line strings that include the OpenClaw-only substrings ("Fast: n/a", "Harness: n/a", etc.) which OBS-03 explicitly removes. They MUST be updated.

**Fix:** Reshaped R-01..R-08 to assert the new line layout while preserving the same defensive-read invariants. Concretely:
- R-01 line 3 changed from `📚 Context: unknown · 🧹 Compactions: n/a` to `📚 Context: unknown · 🧹 Compactions: 0` (live count, not placeholder)
- R-01 line 7 changed from the long OpenClaw-style string to `⚙️ Runtime: SDK session · Think: medium · Reasoning: medium effort · Permissions: default`
- R-01 line 8 changed from `bound-channel · 🪢 Queue: n/a` to `unknown · 🪢 Queue: idle`
- R-02 extended to also assert Queue '1 in-flight' when hasActiveTurn=true
- R-08 extended to assert defensive defaults for the 4 new throwing accessors

**Files modified:** `src/discord/__tests__/status-render.test.ts`

**Commit:** `aa064f0`

### [Rule 1 - Bug] Acceptance criteria substring grep includes doc comments

**Found during:** Final verification

**Issue:** The acceptance criteria say `! grep -F 'Fast:' src/discord/status-render.ts`. After GREEN, the file output didn't contain `Fast:` but a doc comment did (`"DOES NOT emit Fast:/Elevated:/Harness:"` referencing the test names).

**Fix:** Reworded the doc comment to "the OpenClaw-only-substring drop tests in __tests__/" so the literal grep gate passes.

**Files modified:** `src/discord/status-render.ts`

**Commit:** `70e4363`

## Test Coverage Delta

- compaction-counter.test.ts: +5 tests (new file)
- status-render.test.ts: 8 reshaped + 12 new = 20 tests total (was 8)
- Net new test count: +17 tests

## Known Stubs

None. All 8 fields wired live with real accessors. The only `n/a` remaining is `Fallbacks: n/a`, which is documented as intentional in Research §11 (no current source) — slated for a future phase when fallback policy lands.

## Self-Check: PASSED

Verified:
- `[ -f src/manager/__tests__/compaction-counter.test.ts ]` → FOUND
- `git log --oneline | grep -q e2b790c` → FOUND (RED test commit)
- `git log --oneline | grep -q a053712` → FOUND (GREEN counter commit)
- `git log --oneline | grep -q 4fcd459` → FOUND (daemon wiring commit)
- `git log --oneline | grep -q aa064f0` → FOUND (RED status-render commit)
- `git log --oneline | grep -q cea7607` → FOUND (GREEN status-render commit)
- `git log --oneline | grep -q 70e4363` → FOUND (substring scrub commit)
- 79/79 tests pass across the 3 specified suites
- Zero `Fast:` / `Elevated:` / `Harness:` substrings in `src/discord/status-render.ts`
- 7 `getCompactionCountForAgent | effortToReasoningLabel` references in `src/discord/status-render.ts` (Pick + tryRead + render usage)
