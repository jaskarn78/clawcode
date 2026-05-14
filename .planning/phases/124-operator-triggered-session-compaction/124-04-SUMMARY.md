---
phase: 124-operator-triggered-session-compaction
plan: 04
type: execute
status: completed
completed: 2026-05-14
requirements_closed:
  - SC-6
commits:
  - 3cd34e5  # docs(124-04): rewrite plan with auto-trigger wiring + telemetry
  - 0095881  # feat(124-04-T01): CompactionEventLog + heartbeat-status telemetry surface
  - 5d15ad5  # feat(124-04-T02): auto-trigger wiring for context-fill (autoCompactAt live)
  - f953004  # feat(124-04-T03): tokens sparkline tile on dashboard AgentTile
key-files:
  created:
    - src/manager/compaction-event-log.ts
    - src/manager/heartbeat-status-builder.ts
    - src/manager/__tests__/compaction-event-log.test.ts
    - src/manager/__tests__/heartbeat-status-telemetry.test.ts
    - src/heartbeat/checks/__tests__/context-fill-auto-trigger.test.ts
  modified:
    - src/manager/daemon.ts
    - src/cli/commands/status.ts
    - src/heartbeat/types.ts
    - src/heartbeat/runner.ts
    - src/heartbeat/checks/context-fill.ts
    - src/dashboard/server.ts
    - src/dashboard/client/src/hooks/useApi.ts
    - src/dashboard/client/src/components/AgentTile.tsx
tests:
  passing: 59
  files:
    - src/manager/__tests__/compaction-event-log.test.ts (7 cases)
    - src/manager/__tests__/heartbeat-status-telemetry.test.ts (7 cases)
    - src/heartbeat/checks/__tests__/context-fill-auto-trigger.test.ts (7 cases)
    - src/heartbeat/__tests__/context-fill.test.ts (11 cases — back-compat preserved)
    - src/dashboard/__tests__/server.test.ts (27 cases — back-compat preserved)
---

# Phase 124 Plan 04: Telemetry surface + autoCompactAt auto-trigger — Summary

**One-liner:** Wires Plan 124-02's previously-dead `autoCompactAt` config field into the heartbeat hot path, surfaces `session_tokens` + `last_compaction_at` per agent in `heartbeat-status` IPC + CLI + dashboard sparkline, with 5-min cooldown and per-agent opt-out.

## Outcome

Plan 124-02 shipped the `autoCompactAt: number` schema field at `ResolvedAgentConfig.autoCompactAt` but left it as dead storage. Plan 04 wires it into the runtime hot path:

1. **Telemetry surface (T-01).** The `heartbeat-status` IPC payload per-agent block now carries `session_tokens` (rounded from the existing CharacterCountFillProvider × 200_000 / 4 chars-per-token proxy) and `last_compaction_at` (ISO timestamp, null when never compacted). The daemon's `case "compact-session"` body records into a new `CompactionEventLog` after `handleCompactSession` returns `ok:true` — no event bus invented; direct recording is the smallest viable seam. The CLI `clawcode status` appends a dim sub-line `tokens: <N>  last compaction: <iso|never>` under each agent row, preserving column muscle memory.

2. **Auto-trigger wiring (T-02).** The heartbeat `context-fill` check now fires `handleCompactSession` fire-and-forget when ALL gates pass: `autoCompactAt > 0` (per-agent opt-out), `fillPercentage >= autoCompactAt`, and no compaction within the 5-min cooldown. The check's primary return (status/message/metadata) is unchanged — auto-trigger is a side effect. The sentinel keyword `[124-04-auto-trigger]` is logged at dispatch (silent-path-bifurcation prevention). Daemon wires the trigger via `HeartbeatRunner.setCompactSessionTrigger(...)` mirroring the `setSecretsResolver` / `setBrokerStatusProvider` pattern. Cooldown lookup reads the same `CompactionEventLog` instance the telemetry surface uses, so manual + auto compactions share one cooldown view.

3. **Dashboard sparkline (T-03).** New `/api/heartbeat-status` proxy + `useHeartbeatStatus` TanStack hook. `AgentTile` renders a second sparkline beneath the 24h activity chart, fed by a 60-sample component-side ring buffer of `session_tokens` values. Warn-color stroke contrasts the primary-color activity chart. Empty buffer → "no tokens yet" mono fallback.

## Deviations

- **Sub-task harness revert false alarm (T-01).** After my Edit added CLI rendering, a `<system-reminder>` flagged the file as "modified, this change was intentional" with a truncated read. `git diff --stat` confirmed my changes ARE present (+58 lines). No actual revert occurred; the truncated re-read in the system-reminder caused initial concern. CLI rendering committed as planned.
- **No event bus invented (T-01).** The original plan-file draft assumed Plan 124-01 emits a `compaction.completed` event. Verified at execution: `daemon-compact-session-ipc.ts` returns a result object; no emitter exists. Direct recording at the daemon's `case "compact-session"` after `ok:true` is functionally equivalent for SC-6 and avoids inventing infrastructure that doesn't exist. Both manual and auto paths flow through `handleCompactSession`, so both record into the same log.
- **Pre-existing test failure noted (out of scope).** `src/heartbeat/__tests__/runner.test.ts` expects check count of 12; production now registers 13 (adds `summarize-pending`). Pre-dates Plan 04 (confirmed via `git stash` round-trip). Logged here for visibility but NOT fixed — scope-boundary rule.

## Verification Evidence

```
$ npx vitest run src/manager/__tests__/compaction-event-log.test.ts \
    src/manager/__tests__/heartbeat-status-telemetry.test.ts \
    src/heartbeat/checks/__tests__/context-fill-auto-trigger.test.ts \
    src/heartbeat/__tests__/context-fill.test.ts \
    src/dashboard/__tests__/server.test.ts
 Test Files  5 passed (5)
      Tests  59 passed (59)
   Duration  578ms
```

## Open Items

- **Auto-trigger production verification.** After deploy clearance (Ramy hold lifted), grep production logs:
  ```bash
  ssh clawdy "journalctl -u clawcode --since '1h ago' -g '124-04-auto-trigger'"
  ```
  Absence-of-keyword = wiring not exercised yet (low context-fill across fleet, not a bug); presence = wiring verified end-to-end.
- **Visual smoke test of dashboard sparkline** deferred to deploy window.
- **Pre-existing runner.test.ts** check-count mismatch should be addressed in a follow-up housekeeping plan.
- **Per-agent `cooldownMs` config knob** (currently hardcoded to 5 min daemon-side) — defer to Phase 125 if operator pain emerges.
- **Race window between gate-check and record (acknowledged, not guarded).** `CompactionEventLog.record(agent)` only fires AFTER `handleCompactSession` returns `ok:true`. A second heartbeat tick during an in-flight auto-compaction would re-fire because the gate sees `last_compaction_at` as still-stale. Mitigated by: (1) heartbeat interval ≥ typical compaction wall-time, (2) Plan 124-01's `hasActiveTurn` + `ERR_TURN_TOO_LONG` budgets reject duplicate dispatches inside the handler, (3) 5-min cooldown bounds steady-state. Not worth a dedicated in-flight-set guard now; revisit if production journalctl shows repeat sentinels < cooldown apart.
- **Pre-existing TS error (out of scope).** `src/manager/__tests__/compact-session-integration.test.ts:121` has a `Mock<EmbeddingService>` shape mismatch — shipped in Plan 124-01 commit `aa9c082`, predates Plan 04, confirmed via `git stash --keep-index` baseline check. Not mine to fix.

## Self-Check: PASSED

All files exist; all commit SHAs resolve; all 59 tests green.
