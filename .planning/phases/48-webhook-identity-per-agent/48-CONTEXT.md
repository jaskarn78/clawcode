# Phase 48: Webhook identity per agent - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning
**Mode:** Infrastructure phase — discuss skipped

<domain>
## Phase Boundary

Auto-provision Discord webhooks for each agent's bound channel on daemon startup. The daemon uses discord.js to create webhooks programmatically, eliminating the need for operators to manually create webhook URLs and paste them into clawcode.yaml. If a webhook already exists for the channel, reuse it.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. On startup, for each agent with a bound channel and no webhookUrl in config, use discord.js Client to fetch or create a channel webhook. Store the webhook URL in the WebhookManager's identity map. Existing manual webhookUrl config takes precedence (opt-out of auto-provisioning). The bot needs the MANAGE_WEBHOOKS permission.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/discord/webhook-manager.ts` — WebhookManager with identities map, send, sendAsAgent
- `src/discord/webhook-types.ts` — WebhookIdentity, WebhookConfig types
- `src/discord/bridge.ts` — DiscordBridge with discord.js Client connected and ready
- `src/manager/daemon.ts` — startDaemon where WebhookManager is created

### Established Patterns
- WebhookManager constructed with a ReadonlyMap of identities at daemon startup
- RoutingTable maps agents to channels (agentToChannels)
- Discord bridge has a connected Client with access to guild channels

### Integration Points
- After bridge.start() (Client connected), before WebhookManager construction
- Use bridge.client to fetch channel webhooks or create new ones
- Populate webhookUrl in identity map for agents that don't have one configured

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
