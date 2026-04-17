---
phase: 63-observability-surfaces
plan: 03
subsystem: cli
tags: [sqlite, box-drawing, causation-chain, trace-walker, tree-formatter, turn-origin]

requires:
  - phase: 63-01
    provides: "formatTokenCount, formatDuration exported from triggers.ts; CLI registration pattern"
  - phase: 57-turndispatcher-foundation
    provides: "TurnOrigin + TurnOriginSchema with source.kind/source.id fields"
  - phase: 58-task-store-state-machine
    provides: "tasks.db schema with causation_id, parent_task_id, depth, chain_token_cost"
  - phase: 60-trigger-engine
    provides: "causationId on TurnOrigin, trigger source.kind/source.id"
provides:
  - "clawcode trace <causation_id> CLI command for cross-agent chain walking"
  - "walkCausationChain: unified query across tasks.db + per-agent traces.db"
  - "formatChainTree: box-drawing tree renderer with ANSI colors"
  - "formatChainJson: structured JSON output of chain tree"
  - "discoverAgentTracesDbs: agent workspace scanner for traces.db files"
  - "OBS-04: trigger_id/task_id extraction from TurnOrigin.source"
  - "OBS-05: cumulative chain_token_cost at root level"
affects: [dashboard, observability]

tech-stack:
  added: []
  patterns:
    - "Cross-DB chain walking: read-only tasks.db + glob per-agent traces.db pattern"
    - "TurnOrigin.source.kind dispatch for trigger_id vs task_id extraction"
    - "Mutable internal tree build with freeze-on-return for immutable output"

key-files:
  created:
    - src/cli/commands/trace.ts
    - src/cli/commands/__tests__/trace.test.ts
  modified:
    - src/cli/index.ts

key-decisions:
  - "Cross-DB chain stitching: tasks.db for task rows + per-agent traces.db for turn rows, linked via causation_id LIKE query and parent_task_id/parentTurnId references"
  - "OBS-04 extraction: TurnOrigin.source.kind=trigger yields triggerId from source.id, kind=task yields taskId -- no new write-side columns needed"
  - "Mutable MutableChainNode for internal tree building, frozen to ChainNode on return -- keeps tree construction simple while honoring project immutability convention"

patterns-established:
  - "Cross-agent trace walking: discoverAgentTracesDbs + per-db LIKE query pattern"
  - "Box-drawing tree renderer with recursive prefix/connector management"

requirements-completed: [OBS-04, OBS-05]

duration: 5min
completed: 2026-04-17
---

# Phase 63 Plan 03: Trace Chain Walker Summary

**Cross-agent causation chain walker with box-drawing tree output, trigger_id/task_id extraction from TurnOrigin.source, and cumulative token cost visibility**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-17T19:39:01Z
- **Completed:** 2026-04-17T19:44:10Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- `clawcode trace <causation_id>` walks tasks.db + per-agent traces.db and renders a unified chain tree
- OBS-04: trigger_id extracted from TurnOrigin.source.id (kind=trigger), task_id from source.id (kind=task) -- zero write-side changes
- OBS-05: cumulative chain_token_cost summed across all task nodes, displayed at root level
- Cross-agent stitching via parent_task_id + TurnOrigin.parentTurnId + causationId LIKE query
- Box-drawing tree with ANSI color-coded status (green/red/yellow), truncated IDs, duration, token cost
- --json flag outputs full structured tree as JSON
- 15 tests covering discovery, chain walk, trigger/task ID extraction, empty results, missing DB, tree format, JSON output

## Task Commits

Each task was committed atomically:

1. **Task 1: Create clawcode trace command (TDD RED)** - `4c76c96` (test)
2. **Task 1: Create clawcode trace command (TDD GREEN)** - `5fc0e46` (feat)
3. **Task 2: Register trace command in CLI entry point** - `3b6ba55` (feat)

## Files Created/Modified
- `src/cli/commands/trace.ts` - Chain walker, tree formatter, CLI command registration (~380 lines)
- `src/cli/commands/__tests__/trace.test.ts` - 15 tests for discovery, chain walk, formatting
- `src/cli/index.ts` - Added registerTraceCommand import and registration call

## Decisions Made
- Cross-DB chain stitching uses tasks.db for task rows + per-agent traces.db for turn rows, linked via causation_id LIKE query on turn_origin JSON blob and parent_task_id/parentTurnId references for tree nesting
- OBS-04 trigger/task ID extraction reads TurnOrigin.source.kind to dispatch: "trigger" yields triggerId from source.id, "task" yields taskId from source.id -- no new columns or write-side work required
- Internal tree construction uses mutable MutableChainNode objects during build, then freezes to readonly ChainNode on return, matching the project's immutability convention while keeping tree assembly simple

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all data paths are wired to real SQLite queries.

## Next Phase Readiness
- Phase 63 (Observability Surfaces) is now complete with all 3 plans shipped
- All OBS requirements (OBS-01 through OBS-05) are satisfied
- v1.8 milestone ready for final verification

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 63-observability-surfaces*
*Completed: 2026-04-17*
