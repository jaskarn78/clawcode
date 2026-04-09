---
phase: 05-heartbeat-monitoring
plan: 01
subsystem: heartbeat
tags: [heartbeat, health-checks, ndjson, context-fill, zod, setInterval]

requires:
  - phase: 04-memory-system
    provides: CompactionManager, CharacterCountFillProvider, MemoryStore
  - phase: 02-agent-lifecycle
    provides: SessionManager, Registry types

provides:
  - HeartbeatRunner class with sequential check execution and timeout
  - Check discovery system loading modules from directory
  - Context-fill built-in check with threshold-based status
  - HeartbeatConfig schema integrated into global and per-agent config
  - NDJSON heartbeat.log per agent workspace
  - Heartbeat types (CheckStatus, CheckResult, CheckContext, CheckModule)

affects: [05-02, daemon-wiring, ipc-query]

tech-stack:
  added: []
  patterns: [directory-based plugin discovery, Promise.race timeout, NDJSON file logging, per-check interval override]

key-files:
  created:
    - src/heartbeat/types.ts
    - src/heartbeat/discovery.ts
    - src/heartbeat/runner.ts
    - src/heartbeat/checks/context-fill.ts
    - src/heartbeat/__tests__/runner.test.ts
    - src/heartbeat/__tests__/discovery.test.ts
    - src/heartbeat/__tests__/context-fill.test.ts
  modified:
    - src/config/schema.ts
    - src/config/loader.ts
    - src/shared/types.ts
    - src/memory/compaction.ts
    - src/manager/session-manager.ts

key-decisions:
  - "Context fill provider stored as per-agent Map in SessionManager alongside compaction managers"
  - "HeartbeatRunner accepts agent configs via setAgentConfigs for workspace path lookup"
  - "Per-agent heartbeat disable via boolean on agentSchema, global config on defaultsSchema"

patterns-established:
  - "Directory-based check discovery: scan dir, dynamic import, validate default export shape"
  - "Promise.race for check timeout producing critical result"
  - "NDJSON append logging to per-agent workspace memory directory"

requirements-completed: [HRTB-01, HRTB-02, HRTB-03]

duration: 5min
completed: 2026-04-09
---

# Phase 5 Plan 1: Heartbeat Framework Core Summary

**Extensible heartbeat engine with directory-based check discovery, sequential runner with Promise.race timeout, NDJSON logging, and context-fill built-in check**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-09T01:36:17Z
- **Completed:** 2026-04-09T01:41:18Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Built complete heartbeat framework: types, discovery, runner, and context-fill check
- Integrated heartbeat config into Zod schema with global defaults and per-agent disable
- Added CharacterCountFillProvider storage in SessionManager for live context fill monitoring
- Full test coverage: 22 heartbeat tests + 210 total suite tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Heartbeat types, config schema, and CompactionManager accessor** - `1b82124` (feat)
2. **Task 2: Discovery, runner, and context-fill check with full tests** - `c20a893` (feat)

## Files Created/Modified
- `src/heartbeat/types.ts` - CheckStatus, CheckResult, CheckContext, CheckModule, HeartbeatConfig, HeartbeatLogEntry types
- `src/heartbeat/discovery.ts` - Directory-based check module discovery with validation
- `src/heartbeat/runner.ts` - HeartbeatRunner with sequential execution, timeout, NDJSON logging
- `src/heartbeat/checks/context-fill.ts` - Built-in context fill percentage check
- `src/heartbeat/__tests__/runner.test.ts` - 7 runner tests (tick, interval skip, timeout, start/stop, results, warn logging, NDJSON)
- `src/heartbeat/__tests__/discovery.test.ts` - 7 discovery tests (valid modules, .test.ts filter, invalid exports, empty dir)
- `src/heartbeat/__tests__/context-fill.test.ts` - 8 context-fill tests (healthy/warning/critical thresholds, no provider, metadata)
- `src/config/schema.ts` - Added heartbeatConfigSchema, heartbeat field on agentSchema and defaultsSchema
- `src/config/loader.ts` - Added heartbeat resolution in resolveAgentConfig
- `src/shared/types.ts` - Extended ResolvedAgentConfig with heartbeat field
- `src/memory/compaction.ts` - Added getThreshold() getter to CompactionManager
- `src/manager/session-manager.ts` - Added contextFillProviders map and getContextFillProvider accessor

## Decisions Made
- Context fill provider stored as per-agent Map in SessionManager alongside compaction managers
- HeartbeatRunner accepts agent configs via setAgentConfigs for workspace path lookup
- Per-agent heartbeat disable via boolean on agentSchema, global config on defaultsSchema

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- HeartbeatRunner ready to be wired into daemon startup (Plan 02)
- IPC query endpoint for getLatestResults ready for integration
- Context-fill check operational once agents start with memory system

---
*Phase: 05-heartbeat-monitoring*
*Completed: 2026-04-09*
