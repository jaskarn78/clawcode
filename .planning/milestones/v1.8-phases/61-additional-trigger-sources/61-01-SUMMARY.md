---
phase: 61-additional-trigger-sources
plan: 01
subsystem: triggers
tags: [mysql2, hmac-sha256, webhook, zod, trigger-source, polling, timingSafeEqual]

# Dependency graph
requires:
  - phase: 60-trigger-engine-foundation
    provides: TriggerEngine, TriggerSource interface, TriggerEvent schema, dedup pipeline, watermark persistence
provides:
  - MysqlSource TriggerSource adapter with committed-read confirmation
  - WebhookSource TriggerSource adapter with stable content-addressed idempotency keys
  - Webhook HTTP handler with HMAC-SHA256 verification (401/403/413)
  - Zod config schemas for all 4 Phase 61 trigger source types (mysql, webhook, inbox, calendar)
  - Dashboard /webhook/<triggerId> route
affects: [61-02-PLAN, 61-03-PLAN, 62-policy-dsl-hot-reload, daemon-wiring]

# Tech tracking
tech-stack:
  added: [mysql2@3.22.1]
  patterns: [committed-read confirmation for ROLLBACKed rows, push-driven TriggerSource (no-op start/stop), content-addressed idempotency keys via SHA-256 of raw body bytes, HMAC-SHA256 with timingSafeEqual]

key-files:
  created:
    - src/triggers/sources/mysql-source.ts
    - src/triggers/sources/webhook-source.ts
    - src/dashboard/webhook-handler.ts
    - src/config/__tests__/trigger-source-schemas.test.ts
    - src/triggers/sources/__tests__/mysql-source.test.ts
    - src/triggers/sources/__tests__/webhook-source.test.ts
  modified:
    - src/config/schema.ts
    - src/dashboard/server.ts
    - src/dashboard/types.ts
    - package.json

key-decisions:
  - "MysqlSource uses committed-read confirmation: re-queries max row to verify it wasn't ROLLBACKed before advancing watermark"
  - "WebhookSource idempotency keys: SHA-256 of raw body bytes for content-addressed dedup, or X-Webhook-ID header when present"
  - "Webhook handler buffers raw body BEFORE HMAC verification and JSON parse -- raw bytes passed through to WebhookSource for stable hash"
  - "sendJson duplicated in webhook-handler.ts rather than refactoring server.ts exports (minimal surface change)"

patterns-established:
  - "Push-driven TriggerSource pattern: start()/stop() are no-ops, no poll() method, event-driven via external callback"
  - "Per-source config schema pattern: individual Zod schemas exported from config/schema.ts, aggregated into triggerSourcesConfigSchema"
  - "Dashboard route injection pattern: optional webhookHandler callback on DashboardServerConfig, threaded to handleRequest"

requirements-completed: [TRIG-02, TRIG-03]

# Metrics
duration: 10min
completed: 2026-04-17
---

# Phase 61 Plan 01: Additional Trigger Sources Summary

**MysqlSource polling adapter with committed-read ROLLBACKed-row protection, WebhookSource with HMAC-SHA256 verification and content-addressed idempotency keys, plus Zod config schemas for all 4 trigger source types**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-17T16:52:45Z
- **Completed:** 2026-04-17T17:03:20Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments
- Zod config schemas for mysql, webhook, inbox, and calendar trigger sources with parse/reject/defaults tests (13 tests)
- MysqlSource TriggerSource adapter with committed-read confirmation preventing phantom triggers from ROLLBACKed rows, batchSize/filter support, connection-release-in-finally, and .unref()ed timer (10 tests)
- WebhookSource with handleHttp callback generating stable content-addressed idempotency keys via SHA-256 of raw body bytes, webhook HTTP handler with HMAC-SHA256 + timingSafeEqual verification, 401/403/413 rejection, and dashboard /webhook/<triggerId> route (12 tests)
- mysql2@3.22.1 installed as new dependency

## Task Commits

Each task was committed atomically:

1. **Task 1: Config schemas for all 4 trigger source types + npm install mysql2** - `0b925de` (feat)
2. **Task 2: MysqlSource TriggerSource adapter with committed-read confirmation** - `5ab5462` (feat)
3. **Task 3: WebhookSource + webhook HTTP handler with HMAC-SHA256 verification** - `c43b122` (feat)

## Files Created/Modified
- `src/config/schema.ts` - Added 4 per-source Zod schemas + triggerSourcesConfigSchema + extended triggersConfigSchema
- `src/triggers/sources/mysql-source.ts` - MysqlSource class implementing TriggerSource with committed-read confirmation
- `src/triggers/sources/webhook-source.ts` - WebhookSource class implementing TriggerSource (push-driven, no polling)
- `src/dashboard/webhook-handler.ts` - Webhook HTTP handler with HMAC-SHA256 verification and body size limits
- `src/dashboard/server.ts` - Added POST /webhook/<triggerId> route before 404 catch-all
- `src/dashboard/types.ts` - Extended DashboardServerConfig with optional webhookHandler callback
- `src/config/__tests__/trigger-source-schemas.test.ts` - 13 tests for config schemas
- `src/triggers/sources/__tests__/mysql-source.test.ts` - 10 tests for MysqlSource
- `src/triggers/sources/__tests__/webhook-source.test.ts` - 12 tests for WebhookSource + handler
- `package.json` - Added mysql2@3.22.1 dependency

## Decisions Made
- MysqlSource uses committed-read confirmation: after fetching rows > lastSeenId, it re-queries the max row ID. If the row disappeared (probable ROLLBACK), watermark stays at old value and no events are ingested. This prevents phantom triggers from in-flight transactions.
- WebhookSource generates idempotency keys from SHA-256 of raw body bytes when no X-Webhook-ID header is present. This is content-addressed: identical payloads produce identical keys across retries, enabling TriggerEngine dedup.
- The webhook handler buffers the full raw body BEFORE HMAC verification and JSON parsing. The raw bytes are passed through to WebhookSource.handleHttp so it can compute a stable SHA-256 hash without re-serializing parsed JSON (which may produce different bytes).
- sendJson helper duplicated in webhook-handler.ts (3 lines) rather than refactoring server.ts to export it -- minimal surface change for a utility function.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered
- Vitest `-x` flag (bail on first failure) not supported in v4.1.3; used `--bail 1` instead
- vi.fn() mock types required explicit cast/signature for strict TypeScript compliance; fixed with typed mock functions

## Known Stubs

None -- all data paths are wired to real implementations.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness
- MysqlSource and WebhookSource ready for daemon.ts wiring (Plan 61-02 or 61-03)
- Config schemas for inbox and calendar sources ready for Plans 61-02 and 61-03 InboxSource/CalendarSource implementations
- triggerSourcesConfigSchema ready for daemon boot parsing

## Self-Check: PASSED

All 9 created/modified files verified present on disk. All 3 task commit hashes (0b925de, 5ab5462, c43b122) verified in git log.

---
*Phase: 61-additional-trigger-sources*
*Completed: 2026-04-17*
