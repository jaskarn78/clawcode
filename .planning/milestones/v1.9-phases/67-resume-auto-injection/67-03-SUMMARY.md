---
phase: 67-resume-auto-injection
plan: 03
subsystem: manager

tags: [typescript, vitest, session-manager, configDeps, conversation-brief, resume-auto-injection, gap-closure, tdd]

# Dependency graph
requires:
  - phase: 67-01
    provides: "assembleConversationBrief pure helper + DEFAULT_* constants + ResolvedAgentConfig.memory.conversation branch"
  - phase: 67-02
    provides: "SessionConfigDeps.conversationStores? / memoryStores? / now? fields + buildSessionConfig graceful-degradation wiring"
  - phase: 66-session-boundary-summarization
    provides: "summarizeSession writes session-summary MemoryEntries on stop/crash — the data source for the Phase 67 read-path"
provides:
  - "SessionManager.configDeps() return object now includes conversationStores + memoryStores (Map references owned by AgentMemoryManager)"
  - "Phase 67 read-path is LIVE at runtime — deps.conversationStores?.get(name) returns a populated ConversationStore for every started agent"
  - "assembleConversationBrief fires end-to-end inside buildSessionConfig on every real startAgent call"
  - "conversation_context mutable-suffix section renders in production when session-summary MemoryEntries exist + gap exceeds threshold"
affects: [67-VERIFICATION re-verification, phase-68-session-recall, milestone-v1.9-sign-off]

# Tech tracking
tech-stack:
  added: []   # zero new npm deps
  patterns:
    - "Forward-wrapping vi.mock pattern: wrap a module export with vi.fn that delegates to the real impl via importOriginal; existing tests keep real behavior while a single new test inspects mock.calls for deps threading"
    - "Private-method inspection via `(manager as any).memory` — keeps SessionManager's field encapsulation intact at the type level while letting tests assert Map-reference equality against the internal AgentMemoryManager"
    - "Reference-equality assertion (expect(x).toBe(y)) on Map instances — proves configDeps passes the reference, not a defensive copy or wrap, guaranteeing future store mutations flow through without rebuild"

key-files:
  created: []
  modified:
    - src/manager/session-manager.ts
    - src/manager/__tests__/session-manager.test.ts

key-decisions:
  - "Forwarding vi.mock factory via importOriginal — vi.fn(actual.buildSessionConfig) keeps existing 23 session-manager tests on real impl while capturing deps for the new assertion. Cleaner than vi.doMock or scoped spyOn for ESM."
  - "Omit `now:` field from configDeps — buildSessionConfig defaults to Date.now() in production; tests inject deps.now directly when they need deterministic gap-boundary simulation. Matches 67-02-SUMMARY.md hand-off guidance."
  - "Private-field access via (manager as any).memory — justified single-use escape hatch for reference-equality assertions; no breaking API change needed to expose the memory manager publicly."

patterns-established:
  - "Gap-closure TDD pattern: land the failing test (RED) → atomic two-line production fix (GREEN) → full-suite regression → document in SUMMARY. Works for any tight-scope seam-level wiring bug found in VERIFICATION."
  - "ESM module wrapping with real-impl forwarding: `vi.mock(path, async () => ({ ...actual, fn: vi.fn(actual.fn) }))` — generalizable pattern for capturing integration-level call args without sacrificing existing test fidelity."

requirements-completed: [SESS-02, SESS-03]

# Metrics
duration: ~8min
completed: 2026-04-18
---

# Phase 67 Plan 03: Resume Auto-Injection — configDeps Gap-Closure Summary

**Closed the single runtime gap blocking SESS-02 and SESS-03 by threading `conversationStores` + `memoryStores` through `SessionManager.configDeps()` — a surgical two-line addition that activates the entire Phase 67 read-path at runtime.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-18T17:30:18Z
- **Completed:** 2026-04-18T17:38:00Z (approx — RED + GREEN + full regression verification)
- **Tasks:** 1 (TDD — RED commit + GREEN commit)
- **Files modified:** 2 (1 source + 1 test)

## Accomplishments

- `src/manager/session-manager.ts::configDeps()` return object extended with two new fields referenced directly from `this.memory`:
  - `conversationStores: this.memory.conversationStores`
  - `memoryStores: this.memory.memoryStores`
- `now:` intentionally omitted — `buildSessionConfig` defaults to `Date.now()` for production, and tests inject it explicitly when needed.
- New integration test `configDeps passes conversationStores and memoryStores` added to `src/manager/__tests__/session-manager.test.ts` under a new `describe("configDeps wiring — Phase 67 gap-closure")` block.
- Test uses a forward-wrapping `vi.mock("../session-config.js", …)` factory: `buildSessionConfig: vi.fn(actual.buildSessionConfig)` — the mock captures call args while forwarding to the real implementation, so all 23 pre-existing session-manager tests keep their real behavior (verified GREEN).
- Test asserts six invariants on the deps argument captured at `startAgent` time:
  1. `deps.conversationStores` is a `Map` instance
  2. `deps.memoryStores` is a `Map` instance
  3. `deps.conversationStores === (manager as any).memory.conversationStores` (reference equality — no defensive copy)
  4. `deps.memoryStores === (manager as any).memory.memoryStores` (reference equality)
  5. `deps.conversationStores.get(agentName)` is truthy (populated for started agent)
  6. `deps.memoryStores.get(agentName)` is truthy (populated for started agent)
- Phase 67 read-path is now live end-to-end in production: `deps.conversationStores?.get(name)` returns a populated `ConversationStore`, `assembleConversationBrief` runs inside `buildSessionConfig`, and the `conversation_context` mutable-suffix section fires when session-summary MemoryEntries exist + the gap exceeds the configured threshold.

## Exact Change (src/manager/session-manager.ts)

```typescript
// Inside configDeps() return object — AFTER skillUsageTracker, BEFORE closing brace:
// Phase 67 gap-closure — thread per-agent ConversationStore + MemoryStore
// Maps so buildSessionConfig can invoke assembleConversationBrief.
// `now` is intentionally omitted — buildSessionConfig defaults to Date.now().
conversationStores: this.memory.conversationStores,
memoryStores: this.memory.memoryStores,
```

Existing six fields (`tierManagers`, `skillsCatalog`, `allAgentConfigs`, `priorHotStableToken`, `log`, `skillUsageTracker`) unchanged — confirmed via `git diff` showing additions only.

## Task Commits

1. **Task 1 RED: add failing test for configDeps threading** — `96ea27d` (test)
   - Wrapped `buildSessionConfig` via module-scope `vi.mock` factory with `importOriginal` forwarding.
   - Added `import { buildSessionConfig as _buildSessionConfigForMock }` + `vi.mocked(...)` at module scope mirroring the existing `runWarmPathCheck` pattern (line 367-379).
   - New `describe("configDeps wiring — Phase 67 gap-closure")` block at end of file with test-local `beforeEach` that calls `mockedBuildSessionConfig.mockClear()` (not `mockReset`, which would wipe the forwarding impl).
   - Confirmed RED: `AssertionError: expected undefined to be an instance of Map` on `deps.conversationStores` (line 874) — matches the gap description in `67-VERIFICATION.md` exactly.

2. **Task 1 GREEN: thread conversationStores and memoryStores through configDeps** — `e3e60bb` (feat)
   - Added the two-field extension inside `configDeps()` return object with explanatory comment block.
   - Confirmed GREEN: new test passes; full `session-manager.test.ts` file (24 tests) GREEN; `session-config.test.ts` (32 tests) GREEN; zero new `tsc --noEmit` errors on either touched file.

**Plan metadata commit:** forthcoming — created via final `commit-to-subrepo`/plain `git commit` alongside STATE.md + ROADMAP.md updates.

## Files Created/Modified

- `src/manager/session-manager.ts` — `configDeps()` extended with two new fields (`conversationStores` + `memoryStores`) threaded directly from `this.memory`. Strict addition — existing six fields untouched, method signature unchanged.
- `src/manager/__tests__/session-manager.test.ts` — added module-scope `vi.mock("../session-config.js", …)` factory + `mockedBuildSessionConfig` alias + new `describe("configDeps wiring — Phase 67 gap-closure")` block with the integration test.

## Grep Verification

```
$ grep -c "conversationStores: this.memory.conversationStores" src/manager/session-manager.ts
1
$ grep -c "memoryStores: this.memory.memoryStores" src/manager/session-manager.ts
1
$ grep -n "configDeps passes conversationStores and memoryStores" src/manager/__tests__/session-manager.test.ts
858:  it("configDeps passes conversationStores and memoryStores", async () => {
$ grep -n "now:" src/manager/session-manager.ts
(no matches — `now:` correctly omitted from configDeps body)
```

## Decisions Made

- **Forwarding `vi.mock` factory over scoped `vi.doMock` / `vi.spyOn`** — wrapping `buildSessionConfig` at module scope with `vi.fn(actual.buildSessionConfig)` means EVERY pre-existing session-manager test keeps calling the real implementation through the mock. Verified by running the full `session-manager.test.ts` file (24 tests) GREEN after the change. Cleaner than test-local mocking strategies for ESM, which fight hoisting.
- **Omit `now:` from configDeps** — kept in lockstep with 67-02-SUMMARY.md hand-off: production uses `Date.now()`; integration tests inject `deps.now` directly in their own test scaffolding when they need a deterministic gap boundary. Keeps configDeps terse and production-path zero-overhead.
- **Reference-equality assertions via `(manager as any).memory`** — the test asserts `deps.conversationStores === memoryMgr.conversationStores` using the TypeScript `as any` escape hatch on the private `memory` field. This is a single-use test-only access that proves the Map reference is threaded directly without wrapping, without requiring a new public SessionManager method. Future production reads through `deps.conversationStores.set(...)` or `deps.conversationStores.get(...)` will see the live Map, which is the invariant that matters.

## Deviations from Plan

None — plan executed exactly as written.

One minor note: the plan's `<action>` step 1 suggested either `vi.mock(module)` OR `vi.spyOn`. I chose the `vi.mock` path with `importOriginal`-style forwarding (spread `…actual` + `vi.fn(actual.buildSessionConfig)`) so existing tests keep real behavior unchanged — this is explicitly what the plan anticipated as the "safer" pattern. All 24 session-manager tests + 32 session-config tests GREEN after the change, confirming zero contamination.

## Issues Encountered

- **Pre-existing load-dependent test failures under full `src/manager/` parallel suite** (NOT caused by Phase 67-03):
  - `session-memory-warmup.test.ts "completes under 200ms with empty tables"` — documented in 67-02-SUMMARY.md. Passes in isolation.
  - `session-memory-warmup.test.ts "propagates SQL errors with a useful message"` — same load-dependent pattern.
  - `session-manager.test.ts "restartAgent > stops then starts the agent"` — times out at 5s under parallel load; passes in isolation (7.6s in single-file run).
  - `daemon-task-store.test.ts "planting a stale running row BEFORE daemon boot"` — confirmed pre-existing via `git stash` experiment (fails in isolation both with AND without Phase 67-03 changes).

None of the failures are attributable to this plan. The change is a strict addition to `configDeps()` return object + a new isolated test; the diff shows only additions.

- **Full suite regression check:** `npx vitest run src/manager/ --reporter=default` → 356 passed / 4 failed. All 4 failures are the pre-existing issues above. Phase 67 downstream session-config suite (32 tests) GREEN; conversation-brief suite (11 tests) GREEN; Phase 66 session-boundary-summarization tests GREEN.

## Phase 67 VERIFICATION Gap — Closed

The `67-VERIFICATION.md` "NOT_WIRED" row in the Key Link Verification table (SessionManager.configDeps() → SessionConfigDeps.conversationStores via return-object field) is now LIVE at runtime:

- Before this plan: `grep -c "conversationStores" src/manager/session-manager.ts` → `0 in configDeps body — only in other methods` → FAIL
- After this plan: `grep -c "conversationStores: this.memory.conversationStores" src/manager/session-manager.ts` → `1` → PASS

The complete Phase 67 pipeline is now active in production:

1. `SessionManager.configDeps()` → threads `conversationStores` + `memoryStores` Maps ✓
2. `buildSessionConfig` → receives Maps, calls `deps.conversationStores?.get(name)` → resolves real `ConversationStore` ✓
3. `assembleConversationBrief(...)` → invoked with real stores + deps.now default ✓
4. Gap-skip logic fires when `now - lastEndedAt < threshold` (SESS-03) ✓
5. Brief renders + pushed into `mutableSuffix` (NEVER `stablePrefix` — Pitfall 1 invariant proven in 67-02 tests) ✓
6. `conversation_context` section_tokens recorded in `context_assemble` span metadata ✓
7. `clawcode context-audit <agent>` CLI auto-reports the new section via extended `SECTION_NAMES` ✓

## User Setup Required

None — no external service configuration required. The change activates an already-built code path; no new credentials, no new env vars, no new dashboards.

## Next Phase Readiness

- **SESS-02 + SESS-03 requirements** can be marked `[x]` in REQUIREMENTS.md — the production path fires end-to-end. Manual verification of the Discord recall + `clawcode context-audit` behaviors (from 67-VERIFICATION.md § Human Verification Required) is now unblocked and should be performed before milestone v1.9 sign-off.
- **Phase 67 re-verification** (`/gsd:verify-phase 67 --re-verify`): the single outstanding `NOT_WIRED` key link is closed. All 5 success-criteria truths should now verify — SC-1 and SC-2 upgrade from PARTIAL to VERIFIED. Artifacts table entry for `src/manager/session-manager.ts` flips from MISSING to VERIFIED.
- **Milestone v1.9 completion** (Persistent Conversation Memory): Phase 67 is the read-path; it now builds on Phase 66's write-path end-to-end at runtime. Phase 68 (Session Recall / `memory_lookup` surface) can assume `conversation_context` is a live section in the canonical `SECTION_NAMES` list and a live step in `buildSessionConfig`.

## Re-Verification Pointer

Run `/gsd:verify-phase 67 --re-verify` to confirm:
- `src/manager/session-manager.ts` Artifact row flips from MISSING → VERIFIED
- "session-manager.ts::configDeps() → SessionConfigDeps.conversationStores" Key Link row flips from NOT_WIRED → VERIFIED
- Truths 1 + 2 (SC-1 + SC-2) flip from PARTIAL → VERIFIED
- Overall phase score goes from 4/5 must-haves to 5/5
- Phase status flips from `gaps_found` to `verified`

## Self-Check: PASSED

- [x] `grep -c "conversationStores: this.memory.conversationStores" src/manager/session-manager.ts` → `1` (verified)
- [x] `grep -c "memoryStores: this.memory.memoryStores" src/manager/session-manager.ts` → `1` (verified)
- [x] `grep -n "configDeps passes conversationStores and memoryStores" src/manager/__tests__/session-manager.test.ts` → one match at line 858 (verified)
- [x] `grep -n "now:" src/manager/session-manager.ts` → no matches (verified — `now` correctly omitted)
- [x] `npx vitest run src/manager/__tests__/session-manager.test.ts -t "configDeps passes conversationStores and memoryStores"` → exit 0, 1 passed (verified)
- [x] `npx vitest run src/manager/__tests__/session-manager.test.ts --reporter=default` → 24 tests GREEN (verified)
- [x] `npx vitest run src/manager/__tests__/session-config.test.ts --reporter=default` → 32 tests GREEN (verified)
- [x] `npx vitest run src/memory/__tests__/conversation-brief.test.ts --reporter=default` → 11 tests GREEN (verified)
- [x] `npx tsc --noEmit 2>&1 | grep -E "session-manager\.ts|session-config\.ts"` → no matches — zero new tsc errors on touched files (verified)
- [x] `git diff src/manager/session-manager.ts` — additions only, no existing fields modified (verified)
- [x] Commit `96ea27d` (test: RED) present in `git log --oneline -5` (verified)
- [x] Commit `e3e60bb` (feat: GREEN) present in `git log --oneline -5` (verified)

---
*Phase: 67-resume-auto-injection*
*Plan: 03*
*Completed: 2026-04-18*
