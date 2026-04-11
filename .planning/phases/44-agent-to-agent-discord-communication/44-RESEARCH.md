# Phase 44: Agent-to-Agent Discord Communication - Research

**Researched:** 2026-04-11
**Domain:** MCP tool + Discord webhook inter-agent messaging
**Confidence:** HIGH

## Summary

This phase adds a `send_to_agent` MCP tool that enables any agent to post a message to another agent's Discord channel via webhook. The architecture is straightforward: the MCP tool calls a new IPC method on the daemon, which (1) posts a webhook embed to the target agent's channel and (2) writes a fallback to the filesystem inbox. The receiving agent picks up the message through the existing Discord bridge `messageCreate` handler.

The critical architectural challenge is that the bridge currently drops all bot messages (`message.author.bot === true`), and webhook messages are bot messages in Discord's model. The bridge must be updated to allow webhook messages that match an agent-to-agent pattern (checking `message.webhookId` presence and matching against known agent webhook identities) while still ignoring the bot's own messages and other bot traffic.

**Primary recommendation:** Add a new `send-to-agent` IPC method in daemon.ts that uses WebhookManager to send an embed to the target agent's channel, then modify the bridge's bot-message filter to allow known agent webhook messages through.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- MCP tool `send_to_agent` posts to target agent's Discord channel via existing webhook identity system
- Messages appear in the target agent's Discord channel -- visible and auditable by operators
- Receiving agent auto-responds by processing the webhook message through normal Discord bridge routing
- No allowlist restrictions -- any agent can message any other agent in the same workspace
- Sender specifies target by agent name: `send_to_agent(to: "agent-b", message: "...")`
- Messages rendered as webhook embeds with sender name, agent badge, and content -- visually distinct from human messages
- MCP tool returns synchronous delivery confirmation: `{delivered: true, messageId: "..."}`
- Messages to offline/stopped agents are queued in filesystem inbox AND posted to Discord channel (agent picks up on restart)
- Point-to-point only -- no broadcast to all agents
- Receiving agent sees `[Agent Message from X]` context prefix to distinguish from human messages
- Complements existing filesystem inbox (Discord is primary visible path, inbox is fallback/queue)
- No conversation threading -- messages go to main channel

### Claude's Discretion
- Embed styling (colors, fields, footer text)
- Error handling strategy for webhook failures
- Whether to use delivery queue or direct webhook send

### Deferred Ideas (OUT OF SCOPE)
- Broadcast messaging (send to all agents)
- Conversation threading (auto-thread for agent-to-agent exchanges)
- Agent-to-agent allowlists
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| A2A-01 | MCP tool `send_to_agent` with `to` and `message` params | Register in src/mcp/server.ts, delegate to new IPC method |
| A2A-02 | Webhook embed delivery to target agent's Discord channel | WebhookManager.send() extended to support embeds |
| A2A-03 | Bridge routes webhook messages from known agents to receiving agent | Bridge bot-filter modified to allow agent webhook messages |
| A2A-04 | Context prefix `[Agent Message from X]` on received messages | Format in bridge handleMessage before forwarding |
| A2A-05 | Filesystem inbox fallback for all messages | Reuse existing createMessage/writeMessage from collaboration/inbox.ts |
| A2A-06 | Synchronous delivery confirmation returned to caller | IPC method returns `{delivered: true, messageId}` |
</phase_requirements>

## Standard Stack

No new dependencies. This phase uses existing libraries already in the project.

### Core (Already Installed)
| Library | Version | Purpose | Role in This Phase |
|---------|---------|---------|-------------------|
| discord.js | 14.26.2 | Discord API | WebhookClient.send() with embeds, EmbedBuilder |
| zod | 4.3.6 | Validation | MCP tool parameter schemas |
| nanoid | 5.x | ID generation | Message IDs for inbox entries |
| @modelcontextprotocol/sdk | existing | MCP server | Tool registration |

**Installation:** None required. All dependencies already present.

## Architecture Patterns

### Message Flow
```
Agent A (MCP tool) 
  -> send_to_agent(to: "agent-b", message: "...")
  -> IPC client -> daemon "send-to-agent" handler
  -> WebhookManager posts embed to Agent B's channel
  -> Also writes to Agent B's filesystem inbox
  -> Returns {delivered: true, messageId: "..."}
  -> Discord fires messageCreate for the webhook message
  -> Bridge sees message.webhookId, matches to known agent webhook
  -> Bridge formats with "[Agent Message from agent-a]" prefix
  -> Bridge forwards to Agent B's session via forwardToAgent/streamFromAgent
  -> Agent B processes and responds normally
```

### Recommended Project Structure
```
src/
├── mcp/server.ts              # Add send_to_agent tool
├── manager/daemon.ts          # Add "send-to-agent" IPC handler
├── discord/
│   ├── bridge.ts              # Modify bot-filter for agent webhooks
│   ├── webhook-manager.ts     # Add sendEmbed() method
│   └── agent-message.ts       # NEW: embed builder + message formatting
└── collaboration/inbox.ts     # Reuse existing (no changes)
```

### Pattern 1: Agent Webhook Message Detection
**What:** Distinguish agent-to-agent webhook messages from other bot messages in the bridge.
**When to use:** In bridge.ts handleMessage, before the `if (message.author.bot) return` guard.
**Example:**
```typescript
// Discord.js: webhook messages have a non-null webhookId property
// message.author.bot is true for webhooks, but message.webhookId distinguishes them
private isAgentWebhookMessage(message: Message): boolean {
  if (!message.webhookId) return false;
  // Check if the webhook URL matches any known agent webhook identity
  // WebhookManager stores agent -> WebhookIdentity mapping
  // We can match by comparing message.author.username to agent display names
  // OR by maintaining a Set<string> of known webhook IDs
  return this.webhookManager?.hasWebhookByDisplayName(message.author.username) ?? false;
}
```

### Pattern 2: Embed Format for Agent Messages
**What:** Visually distinct embed so operators can tell agent-to-agent messages from human messages.
**Example:**
```typescript
import { EmbedBuilder } from "discord.js";

function buildAgentMessageEmbed(
  senderName: string,
  senderDisplayName: string,
  content: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setAuthor({ name: `${senderDisplayName} [Agent]` })
    .setDescription(content)
    .setColor(0x5865F2) // Discord blurple -- visually distinct
    .setFooter({ text: `Agent-to-agent message from ${senderName}` })
    .setTimestamp();
}
```

### Pattern 3: Webhook Embed Sending
**What:** Extend WebhookManager to send embeds, not just text content.
**Example:**
```typescript
// WebhookClient.send() accepts MessagePayload which supports embeds
async sendEmbed(agentName: string, embed: EmbedBuilder): Promise<string> {
  const identity = this.identities.get(agentName);
  if (!identity) throw new Error(`No webhook for '${agentName}'`);
  
  const client = this.getOrCreateClient(agentName, identity.webhookUrl);
  const result = await client.send({
    embeds: [embed],
    username: identity.displayName,
    avatarURL: identity.avatarUrl ?? undefined,
  });
  
  // result.id is the Discord message ID
  return typeof result === "string" ? result : result.id;
}
```

### Anti-Patterns to Avoid
- **Sending content as plain text via webhook:** Would be indistinguishable from normal agent responses. Use embeds for visual distinction.
- **Trying to match webhooks by URL at message-receive time:** Discord messageCreate does not include the webhook URL. Match by display name or pre-register webhook IDs.
- **Bypassing the Discord bridge entirely:** Forwarding directly via IPC would lose the "visible and auditable" requirement. Messages MUST appear in Discord.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Message ID generation | Custom ID scheme | nanoid (already used) | Consistent with inbox.ts pattern |
| Embed construction | Raw JSON payloads | discord.js EmbedBuilder | Type-safe, handles validation |
| Webhook client management | Raw fetch to Discord API | WebhookManager (already exists) | Handles client pooling, message splitting |
| Filesystem queue | New queue system | collaboration/inbox.ts | Already has createMessage, writeMessage, readMessages |

## Common Pitfalls

### Pitfall 1: Bridge Drops Webhook Messages
**What goes wrong:** The bridge's `handleMessage` has `if (message.author.bot) return` as line 259. Webhook messages have `author.bot = true`, so agent-to-agent messages never reach the receiving agent.
**Why it happens:** Original design assumed all bot messages should be ignored (prevents echo loops).
**How to avoid:** Add a check BEFORE the bot filter: if `message.webhookId` is truthy AND the message matches a known agent webhook identity, allow it through. Still filter out the bot's own messages and unknown bot traffic.
**Warning signs:** Messages appear in Discord but agent never responds.

### Pitfall 2: Echo Loop Between Agents
**What goes wrong:** Agent A sends to Agent B. Agent B's response triggers another message that Agent A interprets as something to respond to, creating an infinite loop.
**Why it happens:** Agent B's response goes through the normal bridge flow, which sends back to the channel. If Agent A is also bound to that channel, it could pick it up.
**How to avoid:** This is NOT a concern because each agent has its OWN channel. Agent A posts to Agent B's channel. Agent B responds in Agent B's channel. Agent A never sees that response (different channel binding). The point-to-point design with separate channels prevents loops naturally.
**Warning signs:** Rapid back-and-forth messages in a single channel.

### Pitfall 3: Webhook Display Name Collision
**What goes wrong:** Two agents have the same display name. The bridge can't distinguish which agent sent the webhook message.
**Why it happens:** Display names are user-configured in clawcode.yaml.
**How to avoid:** Use a secondary identifier in the embed footer (agent machine name, not just display name). For webhook matching, consider storing webhook IDs at startup rather than relying on display name matching.
**Warning signs:** Messages attributed to wrong sender.

### Pitfall 4: Target Agent Has No Webhook Configured
**What goes wrong:** `send_to_agent` is called for an agent without a webhook identity. The webhook send fails.
**Why it happens:** Not all agents may have webhookUrl configured.
**How to avoid:** Check `webhookManager.hasWebhook(targetAgent)` before attempting send. Return a clear error to the MCP tool caller. The filesystem inbox write should still succeed regardless.
**Warning signs:** MCP tool returns error instead of delivery confirmation.

### Pitfall 5: Embed Content Exceeds Discord Limits
**What goes wrong:** Embed description has a 4096-char limit. Long agent messages get truncated or rejected.
**Why it happens:** Discord API enforces embed field limits.
**How to avoid:** Truncate embed description to 4096 chars. For longer messages, put the full content in the embed description with truncation and also include the full text in the `content` field (which has its own 2000-char limit). Or split into multiple embeds.
**Warning signs:** Discord API 400 errors on send.

## Code Examples

### MCP Tool Registration (src/mcp/server.ts)
```typescript
server.tool(
  "send_to_agent",
  "Send a message to another agent via their Discord channel",
  {
    to: z.string().describe("Target agent name"),
    message: z.string().describe("Message content to send"),
  },
  async ({ to, message }) => {
    try {
      const result = (await sendIpcRequest(SOCKET_PATH, "send-to-agent", {
        from: "CALLER_AGENT", // Needs to be injected -- see note below
        to,
        message,
      })) as { delivered: boolean; messageId: string };

      return {
        content: [{
          type: "text" as const,
          text: result.delivered
            ? `Message delivered to ${to} (id: ${result.messageId})`
            : `Message queued for ${to} (id: ${result.messageId})`,
        }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text" as const, text: `Failed: ${msg}` }] };
    }
  },
);
```

**Note on sender identity:** The MCP server runs per-agent, so the calling agent's name needs to be passed. Follow the pattern from `memory_lookup` and `ask_advisor` which take `agent: z.string()` as an explicit parameter. The tool should include a `from` or `agent` parameter so the sender identifies itself.

### IPC Handler (src/manager/daemon.ts)
```typescript
case "send-to-agent": {
  const from = validateStringParam(params, "from");
  const to = validateStringParam(params, "to");
  const message = validateStringParam(params, "message");

  // Validate target exists
  const targetConfig = configs.find((c) => c.name === to);
  if (!targetConfig) {
    throw new ManagerError(`Target agent '${to}' not found`);
  }

  // 1. Write to filesystem inbox (always, as fallback/record)
  const inboxDir = join(targetConfig.workspace, "inbox");
  const inboxMsg = createMessage(from, to, message, "normal");
  await writeMessage(inboxDir, inboxMsg);

  // 2. Post webhook embed to target's Discord channel
  let delivered = false;
  const targetChannels = routingTable.agentToChannels.get(to);
  if (targetChannels && targetChannels.length > 0 && webhookManager.hasWebhook(from)) {
    const embed = buildAgentMessageEmbed(from, senderDisplayName, message);
    // Send to the target agent's primary channel using the SENDER's webhook identity
    // Actually: we need to send using a webhook that posts TO the target's channel
    // This is the key design question -- see Architecture note below
  }

  return { delivered, messageId: inboxMsg.id };
}
```

### Bridge Bot-Filter Modification (src/discord/bridge.ts)
```typescript
private async handleMessage(message: Message): Promise<void> {
  // Allow agent-to-agent webhook messages through
  if (message.author.bot) {
    if (!this.isKnownAgentWebhook(message)) {
      return; // Ignore non-agent bot messages
    }
    // Agent webhook message -- continue processing with prefix
  }
  // ... rest of handler
}
```

## Architecture Decision: Webhook Posting Strategy

**Key question:** Each agent's webhook is configured to post to THAT agent's channel. For Agent A to post a message that appears in Agent B's channel, we need a webhook URL for Agent B's channel.

**Resolution:** The existing webhook system already handles this correctly. Each agent has a `webhookUrl` in their config that posts to their own channel. When Agent A wants to send to Agent B:
1. The daemon looks up Agent B's webhook identity
2. Posts the embed using Agent B's webhook URL (which posts to Agent B's channel)
3. But sets the `username` to Agent A's display name (sender identity)

Wait -- this needs refinement. The webhook URL determines WHERE the message appears (which channel). The `username` field determines the display name. So:
- Use **target agent's webhook URL** (posts to target's channel)
- Set **username** to sender agent's display name + "[Agent]" badge
- Set **avatarURL** to sender agent's avatar

This means `WebhookManager` needs a method that sends using one agent's webhook URL but with another agent's display identity. A new `sendAs(targetAgent, senderName, senderAvatar, embed)` method.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Filesystem inbox only | Discord webhook + inbox fallback | This phase | Messages visible in Discord, not just filesystem |
| send_message MCP tool (inbox only) | send_to_agent (Discord-first) | This phase | Agents can communicate visibly through Discord |

## Open Questions

1. **Sender identity in MCP tool**
   - What we know: MCP tools like `memory_lookup` require the agent to pass its own name as a parameter
   - What's unclear: Should `send_to_agent` follow same pattern (explicit `from` param)?
   - Recommendation: Yes, add explicit `from` param. Consistent with existing tools.

2. **Webhook URL per-channel**
   - What we know: Each agent's webhook URL posts to THAT agent's channel
   - What's unclear: Can a single webhook post to a different channel?
   - Answer: No. Discord webhooks are channel-bound. To post to Agent B's channel, use Agent B's webhook URL. Set `username` to identify the sender.
   - Recommendation: Use target's webhook URL with sender's display name.

3. **Auto-response behavior**
   - What we know: The bridge will forward the webhook message to the receiving agent's session
   - What's unclear: Should the response go back to Discord (visible) or somewhere else?
   - Recommendation: Normal flow -- agent responds, bridge sends response back to the agent's channel. This is already how the bridge works. The sender won't see the response unless they check the target's channel or have another mechanism.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| A2A-01 | MCP tool send_to_agent registers and delegates to IPC | unit | `npx vitest run src/mcp/__tests__/server.test.ts -t "send_to_agent"` | Wave 0 |
| A2A-02 | Webhook embed sent to target channel | unit | `npx vitest run src/discord/__tests__/agent-message.test.ts` | Wave 0 |
| A2A-03 | Bridge allows known agent webhook messages | unit | `npx vitest run src/discord/__tests__/bridge.test.ts -t "agent webhook"` | Wave 0 |
| A2A-04 | Context prefix added to forwarded message | unit | `npx vitest run src/discord/__tests__/agent-message.test.ts -t "prefix"` | Wave 0 |
| A2A-05 | Inbox fallback written for all messages | unit | `npx vitest run src/collaboration/__tests__/inbox.test.ts` | Existing |
| A2A-06 | IPC handler returns delivery confirmation | unit | `npx vitest run src/manager/__tests__/daemon.test.ts -t "send-to-agent"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before /gsd:verify-work

### Wave 0 Gaps
- [ ] `src/discord/__tests__/agent-message.test.ts` -- covers A2A-02, A2A-04 (embed building, prefix formatting)
- [ ] Bridge test additions for webhook message filtering (A2A-03)
- [ ] Daemon IPC handler test for send-to-agent (A2A-06)

## Sources

### Primary (HIGH confidence)
- Project source code: `src/mcp/server.ts`, `src/discord/bridge.ts`, `src/discord/webhook-manager.ts`, `src/collaboration/inbox.ts`, `src/manager/daemon.ts` -- all patterns verified by reading actual code
- discord.js v14 WebhookClient API: supports `send({ embeds, username, avatarURL })` -- verified from existing usage in bridge.ts (EmbedBuilder + channel.send with embeds)
- Discord API: webhook messages have `message.author.bot = true` and `message.webhookId` set -- standard Discord behavior

### Secondary (MEDIUM confidence)
- Discord embed limits: description 4096 chars, total embed 6000 chars -- from Discord API docs (well-known, stable limits)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns exist in codebase
- Architecture: HIGH -- straightforward MCP -> IPC -> webhook flow matches existing patterns
- Pitfalls: HIGH -- bot-filter issue identified directly from code reading (bridge.ts line 259)

**Research date:** 2026-04-11
**Valid until:** 2026-05-11 (stable -- no external dependency changes)
