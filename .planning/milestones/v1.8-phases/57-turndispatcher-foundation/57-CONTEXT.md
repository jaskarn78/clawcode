# Phase 57: TurnDispatcher Foundation - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning
**Mode:** Infrastructure phase — discuss skipped

<domain>
## Phase Boundary

Every agent turn — Discord message, scheduler tick, future trigger, future handoff — flows through a single `TurnDispatcher` chokepoint that assigns origin-prefixed turnIds, opens caller-owned Turns, and records provenance. Net-zero user-visible behavior change: Discord users still get replies through the same pipeline, scheduler crons still fire at their expressions. The only observable outcome is that every persisted trace row in `traces.db` carries a `TurnOrigin` metadata blob (`source.kind`, `rootTurnId`, `parentTurnId`, `chain[]`) and downstream phases (58-63) can plug new sources in by calling `turnDispatcher.dispatch(...)` instead of reinventing trace/Turn/session plumbing per source.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — this is a pure infrastructure phase with no user-facing surface. The spec is already fully decided: the v1.8 roadmap and SUMMARY.md lock the architecture (single `TurnDispatcher` chokepoint, origin-prefixed turnIds, `TurnOrigin` shape with `source.kind`/`rootTurnId`/`parentTurnId`/`chain[]`). Use the existing codebase conventions: `src/manager/` for daemon-scoped coordination, Zod schemas in `schema.ts` files, atomic immutable update patterns, pino child loggers, co-located or `__tests__/`-directory tests.

### Locked Pre-Decisions (from roadmap + STATE.md)
- `TurnDispatcher` is THE single chokepoint — no second hot path for any turn source
- `TurnOrigin` shape: `{ source: { kind, id }, rootTurnId, parentTurnId, chain: [] }` — downstream phases pattern-match on `source.kind`
- TurnId format: `<sourceKind>:<nanoid>` — e.g., `scheduler:abc123`, `discord:xyz789`, `task:def456`, `trigger:ghi012`
- `DiscordBridge.handleMessage` must route through `turnDispatcher.dispatch()` instead of calling `SessionManager.streamFromAgent` directly
- `TaskScheduler` cron fires must route through `turnDispatcher.dispatch()` — no duplicated trace/Turn-lifecycle code
- Every trace row in `traces.db` carries `TurnOrigin` metadata — downstream phases rely on it

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/manager/session-manager.ts` — `streamFromAgent(agentName, message, onChunk)` is the existing pipeline into the warm path; `TurnDispatcher` wraps it, does not replace it
- `src/manager/session-adapter.ts` — `SessionHandle.sendAndStream` per-turn query pattern carries over unchanged
- `src/performance/trace-store.ts` + `src/performance/trace-collector.ts` — v1.7 trace persistence — `TurnOrigin` blob lands here
- `src/shared/logger.ts` — pino child loggers (`logger.child({ component: 'TurnDispatcher' })`)
- `src/scheduler/scheduler.ts` — existing croner-based `TaskScheduler`; current call site for agent dispatch must be migrated
- `src/discord/bridge.ts` — `DiscordBridge.handleMessage` — current call site for Discord → agent must be migrated
- `nanoid` (already in deps) — turnId generation
- `zod` (already in deps) — `TurnOrigin` Zod schema in `src/manager/` (e.g., `turn-origin.ts` + schema.ts pair)

### Established Patterns
- **Co-located schema.ts**: each feature directory owns its Zod schema (`src/ipc/protocol.ts`, `src/config/schema.ts`, `src/memory/schema.ts`)
- **Typed error classes** extending `Error` in `src/shared/errors.ts` (add `TurnDispatcherError` if needed)
- **Readonly types**: all domain types use `readonly` fields (`ResolvedAgentConfig` pattern)
- **Per-turn query pattern**: `SessionHandle.sendAndStream` opens a fresh `sdk.query({ resume: sessionId })` per turn — dispatcher must respect this
- **Daemon-scoped singletons** wired in `src/manager/daemon.ts` `startDaemon()` — `TurnDispatcher` fits here alongside `SessionManager`
- **Protocol parity**: any new IPC surface must register in `src/ipc/protocol.ts` + `protocol.test.ts` (per Phase 50 regression lesson)

### Integration Points
- `src/manager/daemon.ts` `startDaemon()` — instantiate `TurnDispatcher` and wire into `SessionManager`, `DiscordBridge`, `TaskScheduler`
- `src/discord/bridge.ts` `handleMessage` — swap direct `streamFromAgent` call for `turnDispatcher.dispatch({ source: { kind: 'discord', id: messageId }, agentName, payload })`
- `src/scheduler/scheduler.ts` — scheduled fire callback swaps direct call for `turnDispatcher.dispatch({ source: { kind: 'scheduler', id: <taskId> }, agentName, payload })`
- `src/performance/trace-collector.ts` / `trace-store.ts` — `TurnOrigin` metadata added to the trace span payload; storage layer writes it as JSON blob on the root span
- `src/manager/session-manager.ts` `streamFromAgent` — accepts an optional `origin: TurnOrigin` param passed through the `TurnDispatcher`; forwards to trace collector

</code_context>

<specifics>
## Specific Ideas

- Keep `TurnDispatcher` in `src/manager/turn-dispatcher.ts` next to `SessionManager` — same daemon-scoped coordination layer
- Pair with `src/manager/turn-origin.ts` exporting the `TurnOrigin` type + Zod schema
- `dispatch()` returns the same promise shape that `streamFromAgent` returns today — callers see no API change in behavior
- Preserve `Turn` ownership: caller of `dispatch` owns the Turn lifecycle (matches v1.7 caller-owned Turn pattern)
- Write migration tests: (a) Discord message still produces identical trace + reply pipeline; (b) scheduler tick still fires at cron with `scheduler:*`-prefixed turnId; (c) trace row has populated `TurnOrigin` blob

</specifics>

<deferred>
## Deferred Ideas

None — this phase is infrastructure-only. Downstream phases (58-63) build on top of `TurnDispatcher`.

</deferred>
