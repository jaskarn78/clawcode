---
phase: 61-additional-trigger-sources
plan: 03
subsystem: triggers
tags: [daemon-wiring, mysql2, webhook, inbox, calendar, trigger-engine, reconciler, heartbeat]

requires:
  - phase: 61-additional-trigger-sources-01
    provides: MysqlSource, WebhookSource, config schemas, webhook handler, dashboard route
  - phase: 61-additional-trigger-sources-02
    provides: InboxSource, CalendarSource adapters
  - phase: 60-trigger-engine-foundation
    provides: TriggerEngine, TriggerSource interface, SchedulerSource, registerSource, ingest pipeline
provides:
  - All 4 Phase 61 trigger sources registered with TriggerEngine on daemon boot
  - mysql2 pool lifecycle (creation and graceful shutdown)
  - Webhook handler injection into dashboard server via WebhookSource.handleHttp
  - Heartbeat inbox check reconciler/fallback mode when InboxSource active
affects: [62-policy-dsl-hot-reload, 63-observability]

tech-stack:
  added: [mysql2 pool wiring]
  patterns: [daemon-level resource pooling, reconciler fallback pattern, dynamic import for module flag toggling]

key-files:
  created: []
  modified:
    - src/manager/daemon.ts
    - src/heartbeat/checks/inbox.ts

key-decisions:
  - "mysql2 pool created only when mysql trigger sources configured (environment-guarded with MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE)"
  - "Webhook handler routes through WebhookSource.handleHttp for stable idempotency keys (SHA-256 of raw body or X-Webhook-ID header)"
  - "Heartbeat inbox check uses 120s staleness threshold in reconciler mode (2x default heartbeat interval)"
  - "setInboxSourceActive uses dynamic import to avoid circular dependency between daemon.ts and heartbeat check module"

patterns-established:
  - "Reconciler fallback pattern: module-level flag + exported setter demotes heartbeat check to stale-message-only processing"
  - "Conditional resource creation: mysql pool only created if mysql configs present AND env vars set"

requirements-completed: [TRIG-02, TRIG-03, TRIG-04, TRIG-05]

duration: 28min
completed: 2026-04-17
---

# Phase 61 Plan 03: Daemon Wiring Summary

**All 4 trigger sources (MySQL, webhook, inbox, calendar) registered with TriggerEngine in daemon boot, mysql2 pool with graceful shutdown, webhook routed through WebhookSource.handleHttp, heartbeat inbox demoted to reconciler fallback**

## Performance

- **Duration:** 28 min
- **Started:** 2026-04-17T17:19:23Z
- **Completed:** 2026-04-17T17:47:41Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- All 4 trigger source types (MysqlSource, WebhookSource, InboxSource, CalendarSource) registered with TriggerEngine during daemon boot sequence
- mysql2 connection pool created as daemon-level resource (pool size 2), shared across MysqlSource instances, gracefully closed on shutdown
- Webhook handler injected into dashboard server config, routing through WebhookSource.handleHttp for stable idempotency keys
- Heartbeat inbox check demoted to reconciler/fallback mode with 120s staleness threshold when InboxSource is the primary delivery path

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire all 4 trigger sources into daemon boot + mysql2 pool lifecycle + webhook handler injection** - `4120297` (feat)
2. **Task 2: Demote heartbeat inbox check to reconciler/fallback when InboxSource is active** - `fa2e79e` (feat)

## Files Created/Modified
- `src/manager/daemon.ts` - Added imports for 4 trigger sources + createWebhookHandler, mysql2 pool creation/shutdown, source registration with TriggerEngine, webhook handler injection into dashboard, setInboxSourceActive call
- `src/heartbeat/checks/inbox.ts` - Added reconciler mode with setInboxSourceActive flag, 120s staleness filter, mode-aware status messages

## Decisions Made
- mysql2 pool guarded by environment variables (MYSQL_HOST, MYSQL_USER, MYSQL_DATABASE) with a warning log when config exists but env vars are missing
- Webhook handler routed through WebhookSource.handleHttp (not inline closure) to preserve stable idempotency key contract
- Reconciler threshold set to 120s (2x default heartbeat interval of 60s) so stale messages not picked up by chokidar get delivered
- Dynamic import used for setInboxSourceActive to avoid hoisting the heartbeat check module into daemon.ts's import graph

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all code paths are fully wired.

## Next Phase Readiness
- Phase 61 complete: all 4 trigger source types fully wired into daemon lifecycle
- Phase 62 (Policy DSL + hot-reload + dry-run) can proceed
- Phase 63 (Observability) can proceed

## Self-Check: PASSED

- src/manager/daemon.ts: FOUND
- src/heartbeat/checks/inbox.ts: FOUND
- 61-03-SUMMARY.md: FOUND
- Commit 4120297: FOUND
- Commit fa2e79e: FOUND

---
*Phase: 61-additional-trigger-sources*
*Completed: 2026-04-17*
