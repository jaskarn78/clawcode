# Phase 5: Heartbeat & Monitoring - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the extensible heartbeat framework with context fill monitoring as the first built-in check. After this phase, each agent is periodically health-checked, context fill is monitored with threshold warnings, and new checks can be added by dropping a module into a plugin directory. No auto-remediation, no alerting integrations — just the check framework and first check.

</domain>

<decisions>
## Implementation Decisions

### Check Plugin Architecture
- **D-01:** Directory-based discovery — checks are `.ts` modules in `src/heartbeat/checks/` directory
- **D-02:** Each check module exports a standard interface: `{ name: string, interval?: number, execute: (context: CheckContext) => Promise<CheckResult> }`
- **D-03:** CheckResult has status (healthy/warning/critical), message, optional metadata object
- **D-04:** CheckContext provides access to agent name, session manager, memory store, registry — whatever the check needs
- **D-05:** Checks discovered at heartbeat startup by scanning the checks directory

### Execution Model
- **D-06:** Sequential check execution within each heartbeat tick (no parallel check running)
- **D-07:** Each check has a timeout (configurable, default 10s) — if exceeded, result is "critical" with timeout message
- **D-08:** Check results logged to agent workspace `memory/heartbeat.log` (append-only)
- **D-09:** Critical results logged as warnings. No automatic remediation — checks report, don't fix
- **D-10:** Heartbeat results queryable via IPC (`heartbeat-status` method)

### Interval & Config
- **D-11:** Global default heartbeat interval in clawcode.yaml (default: 60 seconds)
- **D-12:** Per-check interval override possible (e.g., context fill every 30s, others every 5min)
- **D-13:** Heartbeat can be disabled per-agent in config (`heartbeat: false`)

### Context Fill Check (Built-in)
- **D-14:** First built-in check: `context-fill.ts` — monitors agent session context fill percentage
- **D-15:** Warning at 60% fill, critical at 75% fill (configurable thresholds)
- **D-16:** Uses the same CharacterCountFillProvider from Phase 4's compaction system
- **D-17:** When critical, logs recommendation to compact but does NOT auto-trigger compaction

### Claude's Discretion
- Log format details (structured JSON vs plain text)
- Check discovery implementation (glob vs readdir)
- IPC heartbeat-status response format
- Whether to include a `clawcode health` CLI command (nice to have)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Codebase
- `src/manager/session-manager.ts` — SessionManager (extend with heartbeat integration)
- `src/manager/daemon.ts` — Daemon (start heartbeat on startup)
- `src/manager/types.ts` — AgentSessionConfig (extend with heartbeat settings)
- `src/memory/compaction.ts` — CharacterCountFillProvider (reuse for context fill check)
- `src/config/schema.ts` — Config schema (extend with heartbeat settings)
- `src/ipc/protocol.ts` — IPC protocol (extend with heartbeat-status)

### Research
- `.planning/research/PITFALLS.md` — Context window amnesia, heartbeat monitoring
- `.planning/research/FEATURES.md` — Extensible heartbeat as differentiator

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/memory/compaction.ts`: `CharacterCountFillProvider` — reuse for context fill check
- `src/manager/session-manager.ts`: Per-agent session access — heartbeat needs to query sessions
- `src/ipc/protocol.ts`: IPC methods pattern — extend with heartbeat-status
- `src/manager/registry.ts`: Registry read — heartbeat can check agent status

### Established Patterns
- Zod schema for config extensions
- IPC method handlers in daemon.ts
- CLI command registration pattern
- Immutable data patterns throughout

### Integration Points
- Daemon: start heartbeat runner after all agents booted
- SessionManager: expose session state for context fill check
- Config: add heartbeat settings (interval, per-agent enable/disable)
- IPC: add heartbeat-status method

</code_context>

<specifics>
## Specific Ideas

- Heartbeat runner should be a standalone class that can be tested independently
- Consider adding a `clawcode health` CLI command showing latest heartbeat results for all agents
- Log file rotation for heartbeat.log (or just keep it bounded by daily rotation)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-heartbeat-monitoring*
*Context gathered: 2026-04-09*
