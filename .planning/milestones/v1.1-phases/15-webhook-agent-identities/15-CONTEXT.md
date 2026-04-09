# Phase 15: Webhook Agent Identities - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase gives each agent its own Discord webhook so it posts with a unique avatar and display name instead of all using "Clawdy Code". Config in clawcode.yaml supports webhookUrl per agent or auto-creation. Bridge sends responses via webhook instead of bot reply.

</domain>

<decisions>
## Implementation Decisions

### Webhook Configuration
- **D-01:** Each agent can have a `webhook` config block with `url`, `displayName`, and `avatarUrl` fields
- **D-02:** If `webhookUrl` is provided per agent in clawcode.yaml, use it directly
- **D-03:** If no webhook URL is provided but displayName/avatarUrl are set, auto-create a webhook in the agent's bound channel(s) on startup
- **D-04:** Webhook config is optional -- agents without webhook config continue using the bot identity

### Webhook Management
- **D-05:** WebhookManager class handles creation, caching, and sending via webhooks
- **D-06:** Webhook identity includes displayName (required) and avatarUrl (optional)
- **D-07:** Auto-created webhooks are stored in a persistent `webhook-registry.json` for reuse across restarts
- **D-08:** Webhook URLs are validated at daemon startup and logged as warnings if invalid

### Message Sending
- **D-09:** When an agent has a webhook identity, the bridge sends responses via the webhook execute endpoint instead of bot reply
- **D-10:** Webhook messages support the same message splitting (2000 char limit) as bot messages
- **D-11:** Webhook sending is fire-and-forget from the bridge perspective (agent still uses its own Discord plugin for primary interaction)

### Claude's Discretion
- How to handle webhook rate limits
- Whether to include webhook identity in agent system prompt
- Error handling for webhook creation failures

</decisions>

<canonical_refs>
## Canonical References
- `src/discord/bridge.ts` -- Message routing and response sending
- `src/discord/types.ts` -- Discord type definitions
- `src/config/schema.ts` -- Config schema (extend for webhook)
- `src/shared/types.ts` -- ResolvedAgentConfig (extend for webhook)
- `src/config/loader.ts` -- Config resolution
- `src/manager/daemon.ts` -- Daemon lifecycle (initialize webhook manager)
</canonical_refs>

<code_context>
## Reusable Assets
- discord.js WebhookClient for sending via webhook URL
- Config schema extension pattern from threads/heartbeat/memory
- Registry atomic write pattern for webhook-registry.json
- Bridge sendResponse pattern for webhook message delivery
</code_context>

<specifics>
## Specific Ideas
- `clawcode webhooks` CLI to show configured webhook identities
</specifics>

<deferred>
## Deferred Ideas
None
</deferred>

---
*Phase: 15-webhook-agent-identities*
