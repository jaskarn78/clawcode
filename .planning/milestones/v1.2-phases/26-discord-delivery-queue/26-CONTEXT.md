# Phase 26: Discord Delivery Queue - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

Outbound Discord messages are reliably delivered with retry logic and failure visibility.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion. Key considerations:
- Messages enqueued before delivery attempt
- Exponential backoff retry (max 3 attempts)
- Failed messages logged to persistent failed-delivery log with error context
- Queue status queryable via IPC and CLI
- OpenClaw reference: delivery-queue/ directory with failed message log exists

</decisions>

<code_context>
## Existing Code Insights

### Relevant Files
- `src/discord/bridge.ts` — current send path (sendResponse, webhook delivery)
- `src/discord/webhook-manager.ts` — WebhookManager.send()
- `src/discord/streaming.ts` — ProgressiveMessageEditor
- `src/ipc/protocol.ts` — IPC method definitions

### Established Patterns
- Pino structured logging throughout
- IPC methods for CLI queries
- Heartbeat checks for periodic operations

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond ROADMAP success criteria.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
