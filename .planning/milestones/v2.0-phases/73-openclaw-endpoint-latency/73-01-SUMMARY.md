---
phase: 73-openclaw-endpoint-latency
plan: 01
subsystem: manager
tags: [latency, session-adapter, sdk, persistent-subprocess, streaming-input]
requirements: [LAT-01]
dependency_graph:
  requires:
    - "@anthropic-ai/claude-agent-sdk 0.2.97 (streaming input mode: query({ prompt: AsyncIterable<SDKUserMessage> }))"
    - "src/manager/sdk-types.ts — SdkModule / SdkQuery / SdkUserMessage / SdkStreamMessage"
    - "src/manager/session-adapter.ts — SessionHandle + SendOptions + PrefixHashProvider + SkillTrackingConfig contracts"
    - "src/manager/session-recovery.ts — SessionRecoveryManager.handleCrash wiring path"
  provides:
    - "createPersistentSessionHandle — the production SessionHandle factory backing SdkSessionAdapter"
    - "SerialTurnQueue — depth-1 mutex primitive for enforcing one-in-flight-one-queued per agent"
    - "AsyncPushQueue<T> — pushable AsyncIterable primitive for feeding SDK streaming input"
    - "QUEUE_FULL_ERROR_MESSAGE — exact string 'QUEUE_FULL' (Plan 73-03 maps to HTTP 429)"
  affects:
    - "SdkSessionAdapter.createSession + resumeSession — now route through createPersistentSessionHandle"
    - "SessionManager.startAgent / resumeSession — unchanged call sites (SessionHandle surface byte-identical)"
    - "TurnDispatcher.dispatch / dispatchStream — unchanged (calls handle.sendAndStream as before)"
    - "OpenAiSessionDriver.dispatch — unchanged (talks to TurnDispatcher)"
tech-stack:
  added: []  # zero new dependencies per plan constraints
  patterns:
    - "Persistent generator via sdk.query({ prompt: asyncIterable })"
    - "Depth-1 serial turn queue (bounded-queue pattern mirroring src/openai/driver.ts)"
    - "Abort race against 2s interrupt deadline (Pitfall 3 guard from 73-RESEARCH.md)"
    - "Shared driverIter across turns — iterate-until-result boundary preserves next turn's messages"
key-files:
  created:
    - "src/manager/persistent-session-queue.ts (119 LOC)"
    - "src/manager/persistent-session-handle.ts (555 LOC)"
    - "src/manager/__tests__/persistent-session-queue.test.ts (204 LOC, 11 tests)"
    - "src/manager/__tests__/persistent-session-handle.test.ts (396 LOC, 8 tests)"
    - "src/manager/__tests__/persistent-session-recovery.test.ts (213 LOC, 2 tests)"
  modified:
    - "src/manager/session-adapter.ts — createSession + resumeSession rewired; wrapSdkQuery marked @deprecated (retained for createTracedSessionHandle back-compat)"
decisions:
  - "iterateWithTracing NOT extracted — duplicated in persistent-session-handle.ts with the driverIter.next() iteration shape instead. Rationale: extracting required rewriting wrapSdkQuery's `for await (const msg of q)` loop to `driverIter.next()` too, risking regression on the 25+ existing tracing tests. Duplication is ~200 LOC of well-contained tracing logic; acceptable trade for test-suite stability."
  - "wrapSdkQuery kept (not deleted) as backing factory for createTracedSessionHandle — a test-only export used by 30+ tests in session-adapter.test.ts + cache-eviction.test.ts. Plan's constraint was 'removed OR gated behind a fallback that no production code path takes' — wrapSdkQuery is now unreachable from SdkSessionAdapter, satisfying the latter option."
  - "QUEUE_FULL_ERROR_MESSAGE = 'QUEUE_FULL' exact string — Plan 73-03 will wire the server to map this message to HTTP 429 Retry-After: 1."
  - "INTERRUPT_DEADLINE_MS = 2000 (2s) — conservative value from 73-RESEARCH §Pitfall 3. Future tuning may lower this once we measure real abort paths."
  - "SdkUserMessage cast: local SdkUserMessage type ({type,content}) is narrower than the real SDK's shape ({type,message,parent_tool_use_id}). The richer shape is constructed at buildUserMessage() and cast via `as unknown as SdkUserMessage` — the SDK accepts the extra fields at runtime."
metrics:
  duration_minutes: 15
  tasks_completed: 3
  commits: 3
  new_tests: 21
  new_loc: 1487  # all new files (queue + handle + 3 test files)
  completed_date: 2026-04-19
---

# Phase 73 Plan 01: Persistent per-agent SDK subprocess — Summary

> Replaced the per-turn `sdk.query()` spawn with ONE long-lived
> `sdk.query({ prompt: asyncIterable })` per agent lifetime via streaming
> input mode — eliminates the ~5s per-turn CLI-subprocess-spawn + session-
> resume-from-disk that dominated TTFB on warm agents.

## What Was Built

### New files

- **`src/manager/persistent-session-queue.ts`** (119 LOC, ≤120 LOC target)
  - `AsyncPushQueue<T>` — pushable `AsyncIterable<T>` with FIFO backlog, single
    waiter, and `end()` sentinel. Feeds `SDKUserMessage` values into
    `sdk.query({ prompt: ... })`.
  - `SerialTurnQueue` — depth-1 mutex with `run<T>(fn): Promise<T>` API. Third
    concurrent call throws `Error("QUEUE_FULL")`. Waiter path swallows
    in-flight rejection so a failed turn does not cascade into the queued one.
  - `QUEUE_FULL_ERROR_MESSAGE` — exact string `"QUEUE_FULL"` for Plan 73-03's
    429 mapping.

- **`src/manager/persistent-session-handle.ts`** (555 LOC, ≤350 LOC target
  exceeded because `iterateWithTracing` was duplicated instead of extracted;
  trade documented under Decisions below)
  - Single exported function `createPersistentSessionHandle(sdk, baseOptions,
    initialSessionId, usageCallback?, prefixHashProvider?, skillTracking?)`.
  - Invariant (enforced by test): exactly ONE `sdk.query()` call per handle
    lifetime regardless of turn count.
  - `driverIter` captured once at handle creation; each `iterateUntilResult`
    consumes from it until the turn-terminating `result` message, leaving
    the next turn's messages on the iterator.
  - Abort path: fires `q.interrupt()` fire-and-forget, then races
    `Promise.race([driverIter.next(), 2s deadline])`. First to fire ends the
    turn handler with `AbortError`; queue slot released via
    `turnQueue.run`'s `finally`.
  - Full tracing parity with `session-adapter.ts:iterateWithTracing`:
    `end_to_end`, `first_token`, `tool_call.<name>` spans with subagent
    filter, cache-hit-delta enrichment, cache-telemetry `recordCacheUsage`,
    prefixHashProvider wiring, skill-mention capture — all preserved per turn.

### New tests

- **`persistent-session-queue.test.ts`** (204 LOC, 11 tests)
  - AsyncPushQueue: FIFO drain, late push resolves waiter, end-after-items
    drains then done, end-while-waiting resolves with done, push-after-end
    dropped.
  - SerialTurnQueue: single-run, serial ordering preserved, third call
    throws QUEUE_FULL, exact message constant, fn-throw releases slot,
    queued turn proceeds after inFlight rejects.

- **`persistent-session-handle.test.ts`** (396 LOC, 8 tests)
  - 5 sendAndStream → exactly 1 `sdk.query()` invocation (core invariant).
  - SessionHandle surface byte-identical (9 fields present).
  - Message ordering preserved under rapid sendAndStream.
  - 3rd concurrent send rejects with QUEUE_FULL.
  - Abort mid-turn calls interrupt() within 2.5s and rejects AbortError.
  - Generator throw → onError fires + in-flight send rejects.
  - sdk.query options include resume + includePartialMessages + AsyncIterable prompt.
  - close() is idempotent; subsequent sends reject with "closed".

- **`persistent-session-recovery.test.ts`** (213 LOC, 2 tests)
  - Integration: simulated crash → `SessionRecoveryManager.handleCrash` fires
    → registry goes to `crashed` → scheduled restart → adapter.resumeSession
    yields fresh handle → sendAndStream on fresh handle resolves.
  - In-flight send during crash rejects with session-closed error.

### Modified files

- **`src/manager/session-adapter.ts`** (1056 → 1065 LOC)
  - `import { createPersistentSessionHandle }` added.
  - `SdkSessionAdapter.createSession`: after `drainInitialQuery` establishes
    the session_id, returns `createPersistentSessionHandle(...)` (no longer
    `wrapSdkQuery`).
  - `SdkSessionAdapter.resumeSession`: directly returns
    `createPersistentSessionHandle(...)` (no longer `wrapSdkQuery`).
  - `wrapSdkQuery` docstring updated to `@deprecated` with back-compat notes
    — retained only as backing factory for `createTracedSessionHandle`
    (test-only export). NO production code path reaches it.
  - `SdkSessionAdapter` class docstring updated to describe the Phase 73 shape.

## Test Coverage Delta

| File | New tests | Total | Assertion target |
|------|-----------|-------|------------------|
| persistent-session-queue.test.ts | 11 | 11 | Queue primitives: serial + full + drain + release |
| persistent-session-handle.test.ts | 8 | 8 | N-turns/1-query, surface, ordering, abort, crash, close |
| persistent-session-recovery.test.ts | 2 | 2 | Recovery wiring integration + in-flight crash |
| **Plan 73-01 total** | **21** | — | — |
| session-adapter.test.ts (back-compat) | 0 | 30 | All existing green — wrapSdkQuery path untouched for createTracedSessionHandle |
| session-manager.test.ts (back-compat) | 0 | 25 | All existing green — SessionHandle surface byte-identical |
| Discord tests (src/discord/) | 0 | 214 | All green — unchanged |
| OpenAI tests (src/openai/) | 0 | 164 | All green — unchanged |

**Full suite:** 2990 green / 7 pre-existing failures (all in
`daemon-openai.test.ts` — startup-mocking tests unrelated to Phase 73;
confirmed pre-existing via `git stash` probe before task execution).

**tsc --noEmit:** 45 errors (baseline unchanged — zero new errors from
Phase 73 code).

## Key Decisions

### 1. iterateWithTracing was DUPLICATED, not extracted

**Decision:** The 200 LOC of tracing + cache telemetry + skill tracking logic
from `session-adapter.ts:iterateWithTracing` was reimplemented inside
`persistent-session-handle.ts:iterateUntilResult` rather than refactored into
a shared helper.

**Why:** Extracting to a shared helper (`iterateOneTurnFromQuery(driverIter,
...)`) would require rewriting `wrapSdkQuery`'s `for await (const msg of q)`
loop to `driverIter.next()` semantics too — risking regression on the 25+
tests in `session-adapter.test.ts` that exercise tracing, cache telemetry,
skill mentions, and mutableSuffix on `createTracedSessionHandle` (which
backs onto `wrapSdkQuery`).

**Trade:** Duplicated ~200 LOC. Tests for both paths kept green.

**Follow-up:** When `createTracedSessionHandle` is retired (out of scope for
Phase 73), extract the helper and remove `wrapSdkQuery` entirely.

### 2. wrapSdkQuery retained

**Decision:** `wrapSdkQuery` marked `@deprecated` but kept; no call sites in
`SdkSessionAdapter`. Still used internally by `createTracedSessionHandle`
(test-only export).

**Why:** Plan 73-01's constraint was "removed OR gated behind a fallback
that no production code path takes." Current state matches the latter:
production `SdkSessionAdapter.createSession` + `resumeSession` route through
`createPersistentSessionHandle`; the legacy factory is unreachable from
`SessionManager.startAgent` / `resumeSession`.

### 3. QUEUE_FULL as exact string constant

`QUEUE_FULL_ERROR_MESSAGE = "QUEUE_FULL"` exported so Plan 73-03's server
wiring can `if (err.message === QUEUE_FULL_ERROR_MESSAGE)` → map to HTTP
429 with `Retry-After: 1`.

### 4. Interrupt deadline = 2 seconds

`INTERRUPT_DEADLINE_MS = 2000` chosen per 73-RESEARCH.md Pitfall 3 — some
SDK abort paths don't emit `result`. After `q.interrupt()`, 2s is long
enough for clean emission on success paths but short enough to reject
hung turns responsively.

## Integration Points for Subsequent Plans

### Plan 73-02 (conversation-brief cache)

- The cache lives at `src/manager/conversation-brief-cache.ts` (new file).
- Wired in `src/manager/session-config.ts:buildSessionConfig` BEFORE
  `assembleConversationBrief` is called.
- Invalidation key: sha256 over sorted terminated-session-id list (matches
  `src/manager/context-assembler.ts:computePrefixHash` shape).
- Hook points on `SessionManager.stopAgent` / crash path already `.delete()`
  the agent's `activeConversationSessionId` — cache invalidation piggybacks.
- No change needed in `persistent-session-handle.ts` — the cache is
  consumed before the handle is constructed, so the handle sees the
  cached brief transparently.

### Plan 73-03 (TTFB + total_turn_ms span + E2E smoke)

- `openai.chat_completion` span opens at driver entry (`src/openai/driver.ts:
  runDispatch`) — metadata: `ttfb_ms`, `total_turn_ms`, `stream: boolean`,
  `xRequestId`, `tools: number`.
- TTFB = first `content_block_delta.text_delta` timestamp − driver entry.
- The driver's existing `onChunk` callback (`accumulated: string`) is where
  TTFB fires; first invocation stamps the span.
- QUEUE_FULL wiring: driver catches `err.message === "QUEUE_FULL"` →
  emits HTTP 429 with `Retry-After: 1`.
- E2E smoke: `curl /v1/chat/completions` twice against a warm agent; assert
  Turn 2 TTFB < 2s.

## Deviations

Two minor deviations from the plan, both documented under Decisions above:

1. **[Rule 2 — Auto-add missing critical functionality]** The plan expected
   wrapSdkQuery to be deletable. Discovered during implementation that
   `createTracedSessionHandle` (a test-only export) depends on it, backing
   30+ tests. Kept `wrapSdkQuery` with `@deprecated` + back-compat note
   rather than deleting. This matches the plan's OR branch ("gated behind a
   fallback that no production code path takes").

2. **[Rule 2 — Auto-add missing critical functionality]** The plan's
   `persistent-session-handle.ts` LOC target was 350. Final file is 555 LOC
   because `iterateWithTracing` was duplicated rather than extracted (see
   Decision 1). Tracing fidelity + test-suite stability were prioritized
   over line count; the extra LOC is concentrated in tracing branches that
   mirror `session-adapter.ts:iterateWithTracing` 1:1.

No architectural changes, no new dependencies, no SessionHandle surface
drift.

## Deferred / Out of Scope

- **`setModel` / `setMaxThinkingTokens` wiring** — explicitly deferred per
  73-RESEARCH.md §"Don't hand-roll". A future `reasoning_effort` phase will
  wire these through `Query.setMaxThinkingTokens(...)` on the persistent
  generator. Today `setEffort(level)` on the handle just stores the new
  value — no SDK call.

- **iterateWithTracing extraction** — deferred to whenever
  `createTracedSessionHandle` is retired; the refactor is non-trivial and
  risked destabilizing 30+ tracing tests on the per-turn path.

- **QUEUE_FULL → 429 mapping** — wiring lives in Plan 73-03 (driver change).
  Plan 73-01 exports the constant; Plan 73-03 consumes it.

- **Plan 73 Plans 02 + 03** — not started this pass.

## Self-Check: PASSED

- `src/manager/persistent-session-queue.ts` FOUND (119 LOC)
- `src/manager/persistent-session-handle.ts` FOUND (555 LOC)
- `src/manager/__tests__/persistent-session-queue.test.ts` FOUND (11 tests green)
- `src/manager/__tests__/persistent-session-handle.test.ts` FOUND (8 tests green)
- `src/manager/__tests__/persistent-session-recovery.test.ts` FOUND (2 tests green)
- `src/manager/session-adapter.ts` modified — `createPersistentSessionHandle`
  used in both `createSession` and `resumeSession` (5 occurrences including
  imports/docs; 2 actual invocations)
- Commits in `git log`:
  - `59c4111` feat(73-01): SerialTurnQueue + AsyncPushQueue primitives
  - `a34d6a9` feat(73-01): persistent per-agent SessionHandle via sdk.query(asyncIterable)
  - `5ab08d1` feat(73-01): route SdkSessionAdapter through persistent session handle
- `npm run build`: ESM dist/cli/index.js built in 200ms (success)
- `npx tsc --noEmit`: 45 errors (baseline unchanged — zero new)
- `npx vitest run src/manager/`: 455 pass + 7 pre-existing daemon-openai failures
- `npx vitest run src/discord/`: 214 pass
- `npx vitest run src/openai/`: 164 pass
- Full suite `npx vitest run`: 2990 pass / 7 pre-existing failures
