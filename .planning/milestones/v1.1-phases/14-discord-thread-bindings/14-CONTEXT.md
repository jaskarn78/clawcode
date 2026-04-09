# Phase 14: Discord Thread Bindings - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase adds automatic Discord thread-to-agent session binding. When a thread is created in a bound channel, ClawCode spawns a dedicated agent session for that thread. Messages in the thread route to its bound session. Thread sessions have their own context, independent from the parent channel's agent.

</domain>

<decisions>
## Implementation Decisions

### Thread Detection
- **D-01:** Listen for `threadCreate` events via the discord.js client in the bridge
- **D-02:** Only auto-spawn for threads in channels that are bound to an agent
- **D-03:** Thread binding stored in a `thread-bindings.json` registry (similar to OpenClaw's pattern)

### Session Management  
- **D-04:** Each thread gets a new agent SDK session with the parent agent's config (model, soul, identity)
- **D-05:** Thread session system prompt includes thread context (thread name, parent channel, parent agent)
- **D-06:** Thread sessions managed by SessionManager alongside regular agent sessions (name: `{agent}-thread-{threadId}`)
- **D-07:** Thread sessions have an idle timeout (configurable, default 24h) — auto-close after inactivity

### Message Routing
- **D-08:** Messages in threads route to the thread's bound session, not the parent channel agent
- **D-09:** Bridge checks thread bindings BEFORE channel bindings in routing priority
- **D-10:** Thread binding registry tracks: threadId, parentChannelId, agentName, sessionName, createdAt, lastActivity

### Cleanup
- **D-11:** Idle thread sessions cleaned up by heartbeat check
- **D-12:** Thread binding removed from registry when session closes
- **D-13:** Configurable max concurrent thread sessions per agent (default: 10)

### Claude's Discretion
- Thread session naming convention details
- How to handle thread archive/unarchive events
- Whether to pass parent conversation context to thread session

</decisions>

<canonical_refs>
## Canonical References
- `src/discord/bridge.ts` — Message routing (extend for threads)
- `src/manager/session-manager.ts` — Session management (extend for thread sessions)
- `src/manager/daemon.ts` — Daemon lifecycle
- `src/manager/registry.ts` — Registry pattern (reference for thread bindings)
- `~/.openclaw/discord/thread-bindings.json` — OpenClaw reference format
</canonical_refs>

<code_context>
## Reusable Assets
- discord.js threadCreate event handling
- SessionManager.startAgent() pattern for spawning thread sessions
- Registry atomic write pattern for thread bindings
- Heartbeat check pattern for idle cleanup
</code_context>

<specifics>
## Specific Ideas
- `clawcode threads` CLI to show active thread bindings
</specifics>

<deferred>
## Deferred Ideas
None
</deferred>

---
*Phase: 14-discord-thread-bindings*
