# Phase 34: Standalone Agent Runner - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Build `src/agent/runner.ts` (AgentRunner) and `clawcode run <agent>` CLI command.
AgentRunner starts a single named agent: SDK session + DiscordBridge + crash recovery.
No full daemon (no IPC socket, no registry, no heartbeat, no config watcher).
Ideal for running one agent in foreground for development or single-agent deployments.

</domain>

<decisions>
## Implementation Decisions

### AgentRunner design
- Single class `AgentRunner` with `start()`, `stop()`, `onCrash` callback
- Uses existing `SdkSessionAdapter.createSession()` for session
- Uses existing `DiscordBridge` with single-agent routing table
- Exponential backoff for crash recovery (max 3 attempts, then stop)
- Emits log events for each lifecycle transition

### CLI command
- `clawcode run <agent>` — loads config, resolves agent, starts AgentRunner
- `--foreground` is implicit (run command blocks until Ctrl+C)
- SIGINT/SIGTERM triggers graceful `runner.stop()`
- Prints agent name, channel IDs, model on start

### Not in scope
- Multiple agents (that's what start-all is for)
- IPC socket (daemon only)
- Dashboard integration
- Config hot-reload

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/manager/session-adapter.ts` — SdkSessionAdapter, SessionHandle
- `src/discord/bridge.ts` — DiscordBridge, loadBotToken
- `src/discord/types.ts` — RoutingTable type
- `src/manager/backoff.ts` — BackoffConfig, DEFAULT_BACKOFF_CONFIG
- `src/config/loader.ts` — loadConfig, resolveAllAgents
- `src/manager/session-config.ts` — buildSessionConfig

### Established Patterns
- daemon.ts builds routingTable from buildRoutingTable(resolvedAgents)
- SdkSessionAdapter.createSession(sessionConfig, usageCallback)
- DiscordBridge.start() / stop()

### Integration Points
- `src/cli/index.ts` — register `clawcode run <agent>` command
- `src/cli/commands/run.ts` — new file for CLI command

</code_context>

<specifics>
## Specific Ideas

- On crash: wait backoff delay, recreate SDK session (same agent config), reconnect
- Bridge stays running across crashes (no need to reconnect Discord)
- Runner outputs a startup summary: agent name, model, channels, workspace

</specifics>

<deferred>
## Deferred Ideas

- `--watch` flag for config hot-reload in runner mode

</deferred>
