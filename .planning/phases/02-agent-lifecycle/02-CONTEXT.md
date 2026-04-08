# Phase 2: Agent Lifecycle - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers agent process lifecycle management. After this phase, a user can start/stop/restart individual agents by name, boot all agents from config, and the manager automatically detects crashes and restarts agents with exponential backoff. A PID registry tracks all running agents. No Discord routing, no memory — just process management.

</domain>

<decisions>
## Implementation Decisions

### Process Spawning
- **D-01:** Agents are spawned as Claude Code SDK sessions via `@anthropic-ai/claude-agent-sdk` using `createSession`/`resumeSession`
- **D-02:** The manager process holds all agent sessions in-process — agents are NOT separate OS processes but SDK session objects
- **D-03:** Each agent session receives its workspace path, SOUL.md content, and IDENTITY.md content as system prompt context

### Manager Architecture
- **D-04:** Manager is a long-running TypeScript daemon process (not AI) that manages all agent sessions
- **D-05:** CLI commands (`clawcode start`, `clawcode stop`, `clawcode restart`, `clawcode start-all`, `clawcode status`) communicate with the running manager
- **D-06:** Manager listens on a local socket/port for CLI commands (IPC between CLI and daemon)
- **D-07:** Manager reads `clawcode.yaml` on startup and creates sessions for all configured agents

### PID/Session Registry
- **D-08:** JSON registry file persisted to disk tracking: agent name, session ID, status (running/stopped/crashed/restarting), start time, restart count, last error
- **D-09:** Registry updated on every state change (start, stop, crash, restart)
- **D-10:** Registry survives manager restart — on startup, manager reads registry and attempts to resume or clean up stale sessions
- **D-11:** `clawcode status` reads the registry and displays a formatted table of all agents

### Crash Recovery
- **D-12:** Exponential backoff starting at 1 second, doubling on each consecutive failure, capped at 5 minutes
- **D-13:** Configurable max retries per agent (default: 10). After max retries, agent enters "failed" state and stops retrying
- **D-14:** Backoff resets to 0 after agent runs successfully for 5 minutes (configurable)
- **D-15:** On manager graceful shutdown (SIGTERM/SIGINT), all agent sessions are terminated cleanly before exit
- **D-16:** Process group management to prevent zombie processes — manager is the process group leader

### Claude's Discretion
- IPC mechanism choice (Unix socket, TCP localhost, HTTP API)
- Exact Agent SDK session configuration and options
- Log output format and destination for agent sessions
- Status display formatting

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Codebase (Phase 1 output)
- `src/config/schema.ts` — Config and AgentConfig types (Zod schema)
- `src/config/loader.ts` — loadConfig, resolveAllAgents functions
- `src/config/defaults.ts` — DEFAULT_SOUL, DEFAULT_IDENTITY_TEMPLATE, renderIdentity
- `src/shared/types.ts` — ResolvedAgentConfig type
- `src/shared/errors.ts` — Error classes to extend
- `src/cli/index.ts` — Commander CLI setup to extend with new commands

### Research
- `.planning/research/STACK.md` — Agent SDK version, Node.js runtime
- `.planning/research/ARCHITECTURE.md` — Manager is deterministic code, SDK session management
- `.planning/research/PITFALLS.md` — Zombie processes, crash recovery patterns

### OpenClaw Reference
- `~/.openclaw/openclaw.json` — Reference gateway/agent manager configuration
- `~/.openclaw/subagents/runs.json` — Reference session registry format

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/config/loader.ts`: `loadConfig()` and `resolveAllAgents()` — produces `ResolvedAgentConfig[]` ready for session spawning
- `src/cli/index.ts`: Commander CLI setup — extend with start/stop/restart/status subcommands
- `src/shared/errors.ts`: Error class pattern — extend with ManagerError, SessionError
- `src/shared/logger.ts`: Logging utility — reuse for manager logging

### Established Patterns
- Zod schema validation for config (extend for manager-specific config)
- Immutable data patterns (readonly types)
- ESM modules with TypeScript strict mode
- Commander for CLI commands

### Integration Points
- CLI extends with new subcommands (start, stop, restart, start-all, status)
- Manager imports config loader to read agent definitions
- Manager creates Agent SDK sessions using resolved agent configs

</code_context>

<specifics>
## Specific Ideas

- Manager daemon should be launchable via `clawcode start-all` or `clawcode daemon`
- Status output should show table similar to `docker ps` — name, status, uptime, restarts, model
- Consider the manager also being a Claude Code session itself (the admin agent concept from requirements)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-agent-lifecycle*
*Context gathered: 2026-04-08*
