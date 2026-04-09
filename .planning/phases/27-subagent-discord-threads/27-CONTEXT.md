# Phase 27: Subagent Discord Threads - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped per autonomous mode)

<domain>
## Phase Boundary

Subagent conversations automatically surface in Discord as dedicated threads with proper identity.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion. Key considerations:
- When an agent spawns a subagent (via Claude Code Agent tool), auto-create a Discord thread in the parent's bound channel
- Bind the subagent session to the thread with its own webhook identity (display name + avatar)
- Route subagent messages through the thread, not the parent channel
- Clean up thread binding when subagent completes (thread remains for history)
- Integrate with existing ThreadManager (Phase 14) and WebhookManager (Phase 15)
- Use delivery queue (Phase 26) for reliable thread message delivery

</decisions>

<code_context>
## Existing Code Insights

### Relevant Files
- `src/discord/thread-manager.ts` — existing ThreadManager (thread detection, session spawning, idle cleanup)
- `src/discord/webhook-manager.ts` — WebhookManager for per-agent identities
- `src/discord/bridge.ts` — Discord message routing
- `src/discord/delivery-queue.ts` — reliable message delivery
- `src/manager/session-manager.ts` — agent session lifecycle
- `src/collaboration/inbox.ts` — inter-agent messaging

### Established Patterns
- Thread bindings persisted to thread-bindings.json
- Webhook identities configured per agent in clawcode.yaml
- Subagent model selection via config.subagentModel

</code_context>

<specifics>
## Specific Ideas

User specifically requested: "I also want the agents to be able to spawn subagents in subthreads within their discord channel"

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
