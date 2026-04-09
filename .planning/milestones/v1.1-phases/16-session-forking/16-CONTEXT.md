# Phase 16: Session Forking - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase adds the ability to fork an agent's context into a new session. The new session inherits conversation history up to the fork point. Useful for subagent work where you want a branch of the current conversation. Adds `forkSession(agentName)` to SessionManager and an IPC method for CLI/programmatic access.

</domain>

<decisions>
## Implementation Decisions

### Fork Mechanics
- **D-01:** `forkSession(agentName, opts?)` on SessionManager creates a new session from the current agent's session state
- **D-02:** The forked session gets a unique name: `{agent}-fork-{nanoid(6)}`
- **D-03:** Fork preserves the conversation history up to the fork point via SDK's session resume/fork capability
- **D-04:** Fork options include optional system prompt override and model override

### Session Lifecycle
- **D-05:** Forked sessions are tracked in the registry alongside regular sessions
- **D-06:** Forked sessions have a `parentSession` field linking back to the originating agent
- **D-07:** Forked sessions can be stopped independently without affecting the parent
- **D-08:** Forked sessions do NOT inherit the parent's Discord channel bindings (they are headless)

### IPC Integration
- **D-09:** New IPC method `fork-session` with params: `name` (agent to fork), optional `systemPrompt`, optional `model`
- **D-10:** Returns the forked session name and session ID

### Claude's Discretion
- Whether forked sessions should have a TTL/auto-cleanup
- Memory inheritance strategy for forked sessions
- How to handle fork of a fork (nesting)

</decisions>

<canonical_refs>
## Canonical References
- `src/manager/session-manager.ts` -- Session lifecycle (add forkSession)
- `src/manager/session-adapter.ts` -- SessionAdapter and SessionHandle
- `src/manager/types.ts` -- RegistryEntry, AgentSessionConfig
- `src/ipc/protocol.ts` -- IPC methods
- `src/manager/daemon.ts` -- IPC routing
</canonical_refs>

<code_context>
## Reusable Assets
- SessionManager.startAgent() pattern for creating new sessions
- Registry entry creation and update patterns
- IPC method routing in daemon.ts routeMethod
- Thread session naming convention pattern
</code_context>

<specifics>
## Specific Ideas
- `clawcode fork <agent>` CLI command
</specifics>

<deferred>
## Deferred Ideas
None
</deferred>

---
*Phase: 16-session-forking*
