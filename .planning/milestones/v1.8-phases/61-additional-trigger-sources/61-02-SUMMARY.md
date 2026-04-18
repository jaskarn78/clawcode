---
phase: 61-additional-trigger-sources
plan: 02
subsystem: triggers
tags: [chokidar, mcp-sdk, calendar, inbox, filesystem-watcher, google-calendar, trigger-source]

# Dependency graph
requires:
  - phase: 61-additional-trigger-sources (plan 01)
    provides: "4 per-source Zod schemas (inboxTriggerSourceSchema, calendarTriggerSourceSchema) + triggerSourcesConfigSchema"
  - phase: 60-trigger-engine-foundation
    provides: "TriggerSource interface, TriggerEngine.ingest, TriggerEvent schema, TaskStore.upsertTriggerState/getTriggerState"
provides:
  - "InboxSource TriggerSource adapter with chokidar file watcher + poll(since) replay"
  - "CalendarSource TriggerSource adapter with MCP client polling + fired-event-ID dedup"
affects: [61-additional-trigger-sources (plan 03 daemon wiring), 62-policy-dsl-hot-reload, 63-observability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "chokidar watcher with ignoreInitial:true + awaitWriteFinish for filesystem trigger sources"
    - "MCP Client + StdioClientTransport as long-lived subprocess for external tool polling"
    - "Map<string, number> serialized as tuple array in cursor_blob for lossless round-trip"
    - "_startAsync() pattern for async start() in sync TriggerSource interface"

key-files:
  created:
    - src/triggers/sources/inbox-source.ts
    - src/triggers/sources/calendar-source.ts
    - src/triggers/sources/__tests__/inbox-source.test.ts
    - src/triggers/sources/__tests__/calendar-source.test.ts
  modified: []

key-decisions:
  - "InboxSource add handler returns Promise (not void) so tests can await deterministically"
  - "CalendarSource cursor_blob uses Map entries tuple format ([eventId, endTimeMs][]) instead of Set (needs endTimeMs for retention pruning)"
  - "Push channel renewal dropped from CalendarSource scope -- google-workspace MCP server has no push API (supersedes CONTEXT.md decision)"
  - "CalendarSource exposes _startMcpClientForTest and _pollOnceForTest for deterministic test control without full start() lifecycle"

patterns-established:
  - "TriggerSource adapter with _pollOnceForTest and _startMcpClientForTest test helpers"
  - "cursor_blob serialization: JSON.stringify([...map.entries()]) / new Map(JSON.parse(blob))"

requirements-completed: [TRIG-04, TRIG-05]

# Metrics
duration: 8min
completed: 2026-04-17
---

# Phase 61 Plan 02: Inbox + Calendar Trigger Sources Summary

**InboxSource chokidar watcher for instant inbox delivery + CalendarSource MCP client poller with once-per-event dedup via fired-ID tracking in cursor_blob**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-17T17:06:58Z
- **Completed:** 2026-04-17T17:15:49Z
- **Tasks:** 2 (both TDD)
- **Files created:** 4

## Accomplishments
- InboxSource watches agent inbox directory via chokidar, fires TriggerEvent immediately on new file, moves to processed/ after successful ingest, supports poll(since) watermark replay for daemon restart
- CalendarSource polls upcoming Google Calendar events via MCP client calling calendar_list_events, fires once per event via Map<eventId, endTimeMs> tracked in cursor_blob, prunes stale IDs past eventRetentionDays, cleans up MCP transport on stop
- 26 tests passing across both sources (13 inbox + 13 calendar)
- Zero type regressions in new files

## Task Commits

Each task was committed atomically (TDD: test -> feat):

1. **Task 1: InboxSource with chokidar file watcher and poll(since) replay**
   - `6718200` (test) - Failing tests for InboxSource
   - `a6ee4bd` (feat) - InboxSource implementation, 13 tests passing

2. **Task 2: CalendarSource with MCP client polling and fired-event-ID dedup**
   - `2351b97` (test) - Failing tests for CalendarSource
   - `89cac64` (feat) - CalendarSource implementation, 13 tests passing

## Files Created/Modified
- `src/triggers/sources/inbox-source.ts` - InboxSource class: chokidar watcher, handleNewFile, poll(since) replay
- `src/triggers/sources/calendar-source.ts` - CalendarSource class: MCP client lifecycle, pollOnce, fired-ID dedup, stale pruning
- `src/triggers/sources/__tests__/inbox-source.test.ts` - 13 tests: add event flow, markProcessed, non-JSON handling, ingest failure, poll replay
- `src/triggers/sources/__tests__/calendar-source.test.ts` - 13 tests: callTool params, dedup, cursor_blob persistence, pruning, transport cleanup, MCP error handling

## Decisions Made
- **InboxSource add handler returns Promise**: The chokidar `on("add")` callback returns the handleNewFile Promise (not voided). In production chokidar ignores return values, but tests can extract and await the callback for deterministic assertion ordering.
- **cursor_blob uses Map entries tuple format**: `JSON.stringify([...firedIds.entries()])` produces `[["evt-1", endTimeMs], ...]`. Deserialized with `new Map(JSON.parse(blob))`. This preserves the endTimeMs needed for retention pruning (a Set would lose the timing data, Object.fromEntries would lose numeric precision).
- **Push channel renewal dropped**: RESEARCH.md found the google-workspace MCP server only has list/create/delete for events, no push channel API (watch/stop). Time-window polling with fired-ID dedup is the sole delivery mechanism. This supersedes the CONTEXT.md mention of push channel renewal via croner.
- **_startMcpClientForTest helper**: CalendarSource exposes a test-only method to connect the MCP client without starting the interval. This lets tests control timing deterministically via fake timers.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- **chokidar mock constructor pattern**: Initial mock using `vi.fn().mockImplementation(...)` failed with "not a constructor" for StdioClientTransport since arrow functions can't be `new`'d. Resolved by using mock classes (`class MockTransport { close = mockTransportClose }`).
- **Async callback timing in InboxSource tests**: The chokidar `on("add")` handler initially used `void this.handleNewFile(...)` which prevented tests from awaiting the promise. Fixed by returning the Promise directly from the callback.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all data flows are wired to concrete implementations or will be wired in Plan 61-03 (daemon.ts integration).

## Next Phase Readiness
- Both InboxSource and CalendarSource are ready for daemon.ts wiring in Plan 61-03
- Plan 61-03 will register these sources with TriggerEngine alongside MysqlSource and WebhookSource
- InboxSource will become the primary inbox delivery path (heartbeat inbox check becomes reconciler/fallback)

---
*Phase: 61-additional-trigger-sources*
*Completed: 2026-04-17*
