# Phase 11: Agent Collaboration - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase adds subagent spawning, async inter-agent messaging, and the admin agent. After this phase, agents can spawn subagents with model selection, send async messages to each other via file-based inboxes checked on heartbeat, and the admin agent has cross-workspace access with IPC control.

</domain>

<decisions>
## Implementation Decisions

### Subagent Spawning
- **D-01:** Agents spawn subagents via Claude Code's native Agent tool — no custom spawning
- **D-02:** Model selection (sonnet/opus/haiku) configurable per spawn via system prompt guidance
- **D-03:** Subagent spawning is a capability agents already have — this phase just ensures config supports it and documents the pattern

### Async Messaging
- **D-04:** File-based inbox per agent at `{workspace}/inbox/` directory
- **D-05:** Messages are JSON files: `{timestamp}-{from-agent}.json` with sender, content, timestamp, priority
- **D-06:** Inbox checked on heartbeat interval via a new `inbox` heartbeat check
- **D-07:** When messages found, they're delivered to the agent session via `sendToAgent()`
- **D-08:** Processed messages moved to `{workspace}/inbox/processed/`
- **D-09:** Agents send messages via IPC: `send-message` method with target agent name and content

### Admin Agent
- **D-10:** Admin agent is a regular agent with a special `admin: true` flag in clawcode.yaml
- **D-11:** Admin agent's system prompt includes list of all other agents and their workspaces
- **D-12:** Admin agent can read files in other agents' workspaces (workspace paths passed in prompt)
- **D-13:** Admin agent triggers restarts via IPC (uses same start/stop/restart as regular CLI)
- **D-14:** Only one admin agent allowed per system (validated at config load)

### Claude's Discretion
- Message priority handling (FIFO vs priority queue)
- Message TTL / expiration
- Admin agent discovery of other agents' state

</decisions>

<canonical_refs>
## Canonical References

### Existing Codebase
- `src/manager/session-manager.ts` — sendToAgent, forwardToAgent
- `src/manager/daemon.ts` — Daemon (add send-message IPC, admin validation)
- `src/heartbeat/checks/` — Drop-in check directory (add inbox check)
- `src/config/schema.ts` — Config schema (add admin flag)
- `src/ipc/protocol.ts` — IPC methods
- `src/cli/index.ts` — CLI commands

</canonical_refs>

<code_context>
## Reusable Assets
- Heartbeat check pattern for inbox monitoring
- IPC method pattern for send-message
- File-based atomic writes from registry pattern
- SessionManager.sendToAgent for message delivery

</code_context>

<specifics>
## Specific Ideas
- `clawcode send <agent> "message"` CLI command for manual messaging
- Admin agent could have a `clawcode admin` subcommand group
</specifics>

<deferred>
## Deferred Ideas
None
</deferred>

---
*Phase: 11-agent-collaboration*
*Context gathered: 2026-04-09*
