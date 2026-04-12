# Phase 46: Scheduled memory consolidation - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning
**Mode:** Infrastructure phase — discuss skipped

<domain>
## Phase Boundary

Memory consolidation (daily→weekly→monthly digest rollups) becomes a configurable cron-scheduled task per agent instead of a fixed 24h heartbeat check. Operators can set custom consolidation schedules in clawcode.yaml. The heartbeat check is replaced by a TaskScheduler entry.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Migrate consolidation from heartbeat check to TaskScheduler cron entry. Add `consolidation.schedule` config field (cron expression) to per-agent config. Default to `0 3 * * *` (daily at 3am). Keep the consolidation pipeline (`runConsolidation`) unchanged — only the trigger mechanism changes.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/memory/consolidation.ts` — full pipeline: daily→weekly→monthly rollup with LLM summarization
- `src/heartbeat/checks/consolidation.ts` — current trigger (heartbeat, 24h interval, per-agent lock)
- `src/scheduler/scheduler.ts` — TaskScheduler with cron-based execution via croner
- `src/config/schema.ts` — zod schema for agent config including memory.consolidation

### Established Patterns
- TaskScheduler.addAgent() accepts ScheduleEntry[] with cron expressions
- Per-agent lock pattern (Set<string>) prevents concurrent consolidation
- consolidationConfig from agent's memory config: enabled, weeklyThreshold, monthlyThreshold

### Integration Points
- Add consolidation schedule to ScheduleEntry[] during agent registration
- Remove or disable the heartbeat consolidation check
- Config schema: add `consolidation.schedule` cron field to memory config

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
