---
phase: 66-session-boundary-summarization
plan: 03
subsystem: memory
tags: [session-manager, haiku, sdk-query, abort-controller, summarization, lifecycle, tdd]

# Dependency graph
requires:
  - phase: 66-02
    provides: summarizeSession pipeline (pure, dep-injected) + SummarizeFn type
  - phase: 66-01
    provides: MemoryEntry.sourceTurnIds column + CreateMemoryInput.sourceTurnIds
  - phase: 65
    provides: ConversationStore lifecycle wiring in SessionManager (startSession / endSession / crashSession)
provides:
  - summarizeWithHaiku — production SummarizeFn wrapping sdk.query with Haiku model, settingSources=[], AbortController
  - SessionManager.summarizeSessionIfPossible — private lifecycle helper assembling deps + calling summarizeSession
  - stopAgent summarize hook (awaited, BEFORE cleanupMemory)
  - onError crash handler summarize hook (fire-and-forget, BEFORE recovery.handleCrash)
  - SessionManagerOptions.summarizeFn — test-only injection hook
affects: [phase-67-resume-auto-inject, phase-68-conversation-search]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Separate SDK cache per module (summarize-with-haiku.ts has its own cachedSdk, mirroring session-adapter.ts::loadSdk). Avoids circular deps and enables independent test mocking via _resetSdkCacheForTests."
    - "Signal-forwarding AbortController: caller-provided AbortSignal piped into a fresh AbortController that the SDK accepts. Handles pre-aborted signals by synchronously aborting the internal controller."
    - "Lifecycle-specific invocation policy: stopAgent awaits (bounded by 10s internal timeout), onError fire-and-forgets (never delay crash recovery). Same helper method; caller decides the policy."
    - "Per-test unique workspace (mkdtemp) + explicit memStore.close() on crash-path cleanup prevents ENOTEMPTY rmdir races from open SQLite handles."

key-files:
  created:
    - src/manager/summarize-with-haiku.ts
    - src/manager/__tests__/summarize-with-haiku.test.ts
  modified:
    - src/manager/session-manager.ts
    - src/manager/__tests__/session-manager.test.ts

key-decisions:
  - "summarizeWithHaiku lives in src/manager/ (not src/memory/) — it is the production binding between SessionManager and the SDK, so it belongs with the adapter layer. src/memory/session-summarizer.ts stays pure and SDK-free."
  - "stopAgent awaits summarization; onError fires fire-and-forget. The internal 10s timeout inside summarizeSession makes the awaited path bounded; the detached pattern on crash prevents restart delay."
  - "summarizeFn field on SessionManagerOptions provides test-only injection without coupling production to test doubles. Default falls back to summarizeWithHaiku."
  - "summarizeSessionIfPossible swallows all errors and logs warn — summarize failures NEVER propagate to stopAgent or onError. summarize is observability, not correctness."
  - "Crash-path summarize invocation is placed BEFORE recovery.handleCrash so summarize starts even if recovery synchronously removes the agent from session maps. handleCrash runs synchronously (returns immediately with _lastCrashPromise stored), so placement after would still work — but before makes the ordering intent explicit."
  - "Test harness: per-test tmpdir workspace (via mkdtemp) isolates each test's memories.db. beforeAll warmup of EmbeddingService pre-loads the ONNX model once so subsequent tests don't cold-start (~5s savings)."
  - "Crash-path test uses a hung summarize Promise (externally-released via releaseSummarize) to prove state transitions are synchronous. _lastCrashPromise resolves BEFORE the detached summarize does — exactly the non-blocking invariant we want."

patterns-established:
  - "Deviation Rule 3 fix — explicit DB cleanup after crash tests: Crash recovery does NOT call cleanupMemory (only stopAgent does), so tests that simulate crash and then rm the workspace dir must manually call manager.getMemoryStore(name)?.close() to release the better-sqlite3 file handle. Otherwise rm fires ENOTEMPTY on the SQLite *.db-journal sidecar."
  - "EmbeddingService warmup in beforeAll: Integration tests that go through the real AgentMemoryManager must pre-warm the embedder once per file to avoid paying ~3-5s cold-start inside a 5s test timeout. The @huggingface/transformers pipeline cache is module-global so the warmup applies to every EmbeddingService instance in the test run."

requirements-completed: [SESS-01, SESS-04]

# Metrics
duration: ~48min
completed: 2026-04-18
---

# Phase 66 Plan 03: SessionManager Summarization Wiring Summary

**summarizeWithHaiku helper + SessionManager lifecycle hooks (stopAgent awaited, onError fire-and-forget) complete the session-boundary summarization pipeline end-to-end.**

## Performance

- **Duration:** ~48 min
- **Started:** 2026-04-18T14:43:00Z (approx, first RED commit)
- **Completed:** 2026-04-18T15:31:00Z
- **Tasks:** 2 (both TDD: 4 commits total — 2 RED, 2 GREEN)
- **Files modified:** 2 source + 2 test (4 total)

## Accomplishments

- **summarizeWithHaiku** (src/manager/summarize-with-haiku.ts) — 97 lines, 6 unit tests with vi.mock on the SDK. Wraps `sdk.query()` with `model: claude-haiku-4-5`, `allowDangerouslySkipPermissions: true`, `settingSources: []`, and a signal-forwarding AbortController. Returns the result text from the first successful result message, empty string otherwise.
- **SessionManager.summarizeSessionIfPossible** — private helper that assembles deps (memoryStore + conversationStore from AgentMemoryManager, embedder singleton, summarizeFn, logger) and calls `summarizeSession` with correct agentName+sessionId input. Non-fatal on any failure; logs warn; never throws.
- **stopAgent wiring** — summarize invocation awaited BEFORE cleanupMemory, wrapped in try/catch. The internal 10s timeout in summarizeSession bounds this path.
- **onError wiring** — summarize invocation fires `void summarizeSessionIfPossible(...).catch(logWarn)` AFTER `crashSession()` and BEFORE `recovery.handleCrash()`. Detached so crash recovery is never blocked.
- **SessionManagerOptions.summarizeFn** — test-only injection point that defaults to `summarizeWithHaiku`. Enables integration tests to swap the LLM call without touching the rest of the pipeline.
- **3 new integration tests** — stop-path (>=3 turns → summarize + memory insert), skip-path (<3 turns → summarize NOT called), crash-path (fire-and-forget with hung promise proving state transitions are synchronous).

## Task Commits

TDD execution, 2 commits per task:

1. **Task 1 RED: failing SDK-mocked tests for summarizeWithHaiku** — `0c42ac5` (test)
2. **Task 1 GREEN: implement summarizeWithHaiku** — `78df2d0` (feat)
3. **Task 2 RED: failing integration tests for lifecycle wiring** — `9f2ec05` (test)
4. **Task 2 GREEN: wire summarizeSession into SessionManager** — `63d3336` (feat)

## Files Created/Modified

- `src/manager/summarize-with-haiku.ts` — production SummarizeFn wrapping sdk.query with Haiku model, settingSources=[], AbortController piping. 97 lines.
- `src/manager/__tests__/summarize-with-haiku.test.ts` — 6 unit tests mocking @anthropic-ai/claude-agent-sdk via vi.mock. Covers happy path, SDK option correctness, signal forwarding (runtime + pre-aborted), empty-stream fallback, non-success subtype filtering. 147 lines.
- `src/manager/session-manager.ts` — added `SummarizeFn` import + `summarizeWithHaiku` import, added `summarizeFn` field to SessionManagerOptions with default fallback, added `summarizeSessionIfPossible` private method, wired into stopAgent (awaited) and onError (fire-and-forget). ~90 lines added.
- `src/manager/__tests__/session-manager.test.ts` — added Phase 66 describe block with 3 integration tests + beforeAll embedder warmup. ~210 lines added.

## Decisions Made

All major decisions are documented in the `key-decisions` frontmatter above. Highlights:

1. **Location of summarizeWithHaiku:** `src/manager/` not `src/memory/` — it's the production binding between SessionManager and the SDK.
2. **Lifecycle invocation policy:** stop = awaited (bounded by internal 10s), crash = fire-and-forget (never delay restart).
3. **Test-only injection via `summarizeFn` option:** avoids coupling production to test doubles; defaults to `summarizeWithHaiku`.
4. **Crash-path test pattern:** hung promise released via `releaseSummarize()` proves `crashSession` transitions state synchronously while summarize is still pending.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Integration test flakes because crash-path leaves open SQLite handles**
- **Found during:** Task 2 (crash-path integration test)
- **Issue:** `MockSessionHandle.simulateCrash()` triggers onError → crashSession + void summarize. `recovery.handleCrash` removes the agent from `sessions` Map but does NOT call `cleanupMemory`. The test's `rm(tmpDir, { recursive: true })` then races the still-open `memories.db` file handle and trips `ENOTEMPTY` on the SQLite `*.db-journal` sibling.
- **Fix:** Added explicit `manager.getMemoryStore("crash-summarize")?.close()` at the end of the crash-path test, plus a 100ms `setTimeout` settle window and a `try/catch` around `rm` in the Phase 66 describe block's afterEach.
- **Files modified:** src/manager/__tests__/session-manager.test.ts
- **Verification:** Crash test passes in isolation (46s), passes in full session-manager.test.ts run (23/23), and no longer leaks into sibling tests.
- **Committed in:** 63d3336 (Task 2 GREEN)

**2. [Rule 3 - Blocking] First-test embedder cold-start exceeds default 5s timeout**
- **Found during:** Task 2 (first stop-path integration test)
- **Issue:** The real `AgentMemoryManager.embedder` (EmbeddingService) dynamically imports `@huggingface/transformers` and loads the all-MiniLM-L6-v2 ONNX model (~23MB cached locally) on first embed. This takes 3-5 seconds, which pushes the first summarize test past the vitest default 5s timeout and triggers `ENOTEMPTY` cascade failures.
- **Fix:** Added `beforeAll` hook that warms up a standalone EmbeddingService before the Phase 66 describe block runs. The @huggingface/transformers pipeline cache is module-global, so subsequent per-test `EmbeddingService` instances constructed by `AgentMemoryManager.initMemory()` reuse the already-loaded pipeline. Also added explicit 30s test timeouts on all three Phase 66 integration tests.
- **Files modified:** src/manager/__tests__/session-manager.test.ts
- **Verification:** All 3 Phase 66 tests pass in isolation (~46s total including the one-time warmup). First test no longer races cold-start.
- **Committed in:** 63d3336 (Task 2 GREEN)

**3. [Rule 1 - Bug] Test `signal forwarding` hangs because listener attaches after caller aborts**
- **Found during:** Task 1 (summarizeWithHaiku abort-signal test)
- **Issue:** The original test aborted `outerController` synchronously after starting summarizeWithHaiku. But summarizeWithHaiku awaits `loadSdk()` before attaching the abort listener. When control returns to the test, abort fires, but the listener isn't yet attached — so the internal controller never receives the abort. Inside the mock generator, `signal.addEventListener("abort", resolve)` waits forever because the signal was already aborted (listeners added after abort don't fire).
- **Fix:** (a) In summarizeWithHaiku: check `opts.signal.aborted` after attaching the listener and immediately abort the internal controller if so (this handles the race). (b) In the test: flush two microtasks (`await Promise.resolve()` x2) between starting the call and calling `abort()`, so the listener is in place. Also make the mock generator early-return if the signal is already aborted.
- **Files modified:** src/manager/summarize-with-haiku.ts (pre-aborted handling), src/manager/__tests__/summarize-with-haiku.test.ts (microtask flush + early-return guard)
- **Verification:** All 6 unit tests pass, including the separate pre-aborted-at-start test.
- **Committed in:** 78df2d0 (Task 1 GREEN)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bugs, 1 Rule 3 blocking)
**Impact on plan:** All three fixes were correctness-preserving test-harness bugs discovered during TDD. No scope creep, no plan structure changes. The lifecycle wiring and SDK options match the plan exactly.

## Issues Encountered

- **Full test suite shows 40+ pre-existing failures** across files I didn't touch (triggers.test.ts, trace-store-origin.test.ts, session-memory-warmup.test.ts, phase59-e2e.test.ts, etc.) plus one flaky restart test in session-manager.test.ts (`restartAgent > stops then starts the agent, incrementing restartCount`). Verified pre-existing by stashing my changes and re-running: triggers.test.ts has 6 failing before my changes, and the restart test fails on stashed master too. These are NOT regressions from this plan.
- **Per-test-file run of session-manager.test.ts: 23/23 pass in isolation.** Full suite run hits one cross-test flake in the restart test (unrelated to my new tests — same failure exists on master without my changes).

## User Setup Required

None — no external service configuration required. The summarizer uses OAuth-subscription auth via the already-configured Claude Agent SDK; `ANTHROPIC_API_KEY` is stripped at spawn time (see session-adapter.ts::buildCleanEnv).

## Next Phase Readiness

- **Phase 66 complete end-to-end.** SESS-01 (session-end summarization) and SESS-04 (summaries as MemoryEntries) are wired end-to-end: session end/crash triggers Haiku summarization, summary stored as MemoryEntry with `source="conversation"`, `tags: ["session-summary", "session:${id}"]`, and `sourceTurnIds` populated from turns.
- **Ready for Phase 67** (Resume Auto-Injection, SESS-02/SESS-03): session summaries are now queryable as standard MemoryEntries with the `session-summary` tag. Phase 67's context assembler can query these via `memoryStore.findByTag("session-summary")` plus the per-session tag for the latest N summaries.
- **Manual UAT deferred to post-exec:** Start `test-agent`, send 3+ Discord messages, stop the agent, then `sqlite3 ~/.clawcode/agents/test-agent/memory/memories.db "SELECT id, tags, source FROM memories WHERE tags LIKE '%session-summary%'"` — should show one row with tags containing "session-summary" and "session:{id}". This validates the Haiku quality that unit/integration tests cannot (real LLM output).

---
*Phase: 66-session-boundary-summarization*
*Plan: 03*
*Completed: 2026-04-18*

## Self-Check: PASSED

- FOUND: src/manager/summarize-with-haiku.ts
- FOUND: src/manager/__tests__/summarize-with-haiku.test.ts
- FOUND: src/manager/session-manager.ts (modified)
- FOUND: src/manager/__tests__/session-manager.test.ts (modified)
- FOUND: .planning/phases/66-session-boundary-summarization/66-03-SUMMARY.md
- FOUND: commit 0c42ac5 (Task 1 RED)
- FOUND: commit 78df2d0 (Task 1 GREEN)
- FOUND: commit 9f2ec05 (Task 2 RED)
- FOUND: commit 63d3336 (Task 2 GREEN)
