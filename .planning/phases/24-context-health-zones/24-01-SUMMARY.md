---
phase: 24-context-health-zones
plan: 01
subsystem: heartbeat
tags: [context-zones, health-monitoring, heartbeat, zod, zone-classification]

requires:
  - phase: 08-heartbeat-framework
    provides: heartbeat check infrastructure, CheckModule interface, context-fill check

provides:
  - 4-zone context classification (green/yellow/orange/red)
  - Zone transition tracking with auto-snapshot callback
  - Configurable zone thresholds in heartbeat config schema
  - Zone metadata in heartbeat check output

affects: [24-02, heartbeat, compaction, agent-lifecycle]

tech-stack:
  added: []
  patterns: [zone-severity-comparison, transition-callback-pattern, threshold-fallback]

key-files:
  created:
    - src/heartbeat/context-zones.ts
    - src/heartbeat/__tests__/context-zones.test.ts
  modified:
    - src/config/schema.ts
    - src/heartbeat/checks/context-fill.ts
    - src/heartbeat/__tests__/context-fill.test.ts
    - src/heartbeat/types.ts
    - src/shared/types.ts

key-decisions:
  - "Zone thresholds optional in HeartbeatConfig type (backward compat) with fallback to DEFAULT_ZONE_THRESHOLDS"
  - "Snapshot callback only fires on upward transitions (not downward) to avoid redundant snapshots"

patterns-established:
  - "Zone severity comparison via ZONE_SEVERITY record for numeric ordering"
  - "Threshold fallback pattern: config.contextFill.zoneThresholds ?? DEFAULT_ZONE_THRESHOLDS"

requirements-completed: [CTXH-01, CTXH-03]

duration: 4min
completed: 2026-04-09
---

# Phase 24 Plan 01: Context Health Zone Engine Summary

**4-zone context classification (green/yellow/orange/red) with configurable thresholds, transition tracking, and auto-snapshot on upward entry to yellow+**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-09T19:44:44Z
- **Completed:** 2026-04-09T19:48:47Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Pure function `classifyZone` maps fill percentage to 4 zones with configurable thresholds (default: green 0-50%, yellow 50-70%, orange 70-85%, red 85%+)
- `ContextZoneTracker` class detects zone transitions and triggers snapshot callback on upward entry to yellow or higher
- Config schema extended with `zoneThresholds` alongside existing warning/critical thresholds for backward compatibility
- Heartbeat context-fill check outputs zone name in message (`Context fill: 72% [orange]`) and metadata

## Task Commits

Each task was committed atomically:

1. **Task 1: Zone types, classifier, transition tracker with auto-snapshot** - `2a10259` (feat)
2. **Task 2: Update config schema and heartbeat check for 4-zone classification** - `7cf3e11` (feat)

## Files Created/Modified
- `src/heartbeat/context-zones.ts` - Zone classifier, transition tracker, snapshot callback, types and constants
- `src/heartbeat/__tests__/context-zones.test.ts` - 22 tests for classification and transitions
- `src/config/schema.ts` - Added zoneThresholds to heartbeat contextFill config
- `src/heartbeat/checks/context-fill.ts` - Updated to use 4-zone classification with zone in metadata
- `src/heartbeat/__tests__/context-fill.test.ts` - 11 updated tests for zone-based output
- `src/heartbeat/types.ts` - Added optional zoneThresholds to HeartbeatConfig
- `src/shared/types.ts` - Added optional zoneThresholds to ResolvedAgentConfig

## Decisions Made
- Zone thresholds are optional in the HeartbeatConfig type with runtime fallback to DEFAULT_ZONE_THRESHOLDS, maintaining backward compatibility with existing configs that only have warningThreshold/criticalThreshold
- Snapshot callback only fires on upward transitions (new severity > old severity) to avoid redundant snapshots when context pressure decreases

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Zone classifier and tracker are ready for Plan 02 to wire into heartbeat runner with auto-snapshot persistence
- ContextZoneTracker.onSnapshot callback is the integration point for saving context snapshots to agent memory

---
*Phase: 24-context-health-zones*
*Completed: 2026-04-09*
