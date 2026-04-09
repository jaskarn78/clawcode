# Phase 3: Discord Integration - Research

**Researched:** 2026-04-09
**Domain:** Discord channel-to-agent message routing with centralized rate limiting
**Confidence:** HIGH

## Summary

Phase 3 connects Discord channels to agent sessions. The architecture is straightforward: each Claude Code SDK session already has the Discord MCP plugin (`plugin:discord:discord`) which handles the actual Discord WebSocket connection, message delivery, and reply tools. ClawCode's job is purely routing -- ensuring the right agent session is bound to the right Discord channel(s) via config, and preventing all agents from collectively exceeding Discord's shared bot token rate limits.

The main technical challenges are: (1) building a channel routing table from config that maps channel IDs to agent names and enforcing it at startup, (2) implementing a centralized token bucket rate limiter that all agent sessions share since they use one bot token, and (3) extending the IPC protocol to expose routing status for CLI introspection. The Discord plugin itself handles all the heavy lifting (WebSocket, message formatting, replies). We do NOT build a Discord.js bot.

**Primary recommendation:** Build three standalone modules -- `src/discord/router.ts` (routing table), `src/discord/rate-limiter.ts` (token bucket), and extend the daemon/session-manager to wire them together at startup.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Each agent's Claude Code SDK session already has access to the Discord plugin via MCP tools (reply, fetch_messages, react, etc.)
- D-02: The manager configures each agent session with its allowed channel IDs from clawcode.yaml
- D-03: Channel binding is enforced at the agent level -- agents only process messages from their bound channels
- D-04: The existing Discord plugin (`plugin:discord:discord`) handles the actual Discord WebSocket connection and message delivery
- D-05: Messages arrive via the Discord plugin to the Claude Code session. The manager's role is ensuring the RIGHT session is bound to the RIGHT channel
- D-06: Channel-to-agent mapping is read from clawcode.yaml config on daemon startup
- D-07: If a message arrives in a channel with no agent binding, it is ignored (not routed to any agent)
- D-08: Multiple channels can map to a single agent (one agent can handle multiple channels)
- D-09: Centralized token bucket rate limiter since all agents share one Discord bot token
- D-10: Rate limit: 50 requests per second (Discord's global rate limit per bot token)
- D-11: Rate limiter state stored in a shared JSON file or in-memory within the daemon process
- D-12: Agents that hit the rate limit queue their responses rather than dropping them
- D-13: Per-channel rate limits also respected (5 messages per 5 seconds per channel)
- D-14: Agent sessions use the Discord plugin's `reply` MCP tool natively -- no custom response delivery
- D-15: Responses are delivered to the same channel the message came from (handled by the plugin's chat_id parameter)

### Claude's Discretion
- Token bucket implementation details (sliding window vs fixed window)
- Queue overflow behavior (max queue depth before dropping)
- Logging format for message routing events
- Error handling for Discord API failures (retry, backoff, etc.)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DISC-01 | Config maps Discord channel IDs to agent IDs for message routing | Config schema already has `channels: string[]` per agent. Router module builds a reverse lookup map (channelId -> agentName). Validated at startup. |
| DISC-02 | Incoming Discord messages route to the correct agent based on channel binding | Discord plugin delivers messages to the agent session. The manager ensures each session is configured with its allowed channels from config. Routing is implicit: the plugin only delivers to sessions that are listening on a channel. |
| DISC-03 | Agent responses are delivered back to the originating Discord channel | Handled natively by the Discord plugin's `reply` MCP tool -- agent passes `chat_id` back. No custom delivery needed (D-14, D-15). |
| DISC-04 | Centralized rate limiter prevents exceeding Discord's per-token rate limits across all agents | Token bucket rate limiter module in daemon process. Global bucket (50 req/s) + per-channel buckets (5 msg/5s). Queue when exhausted (D-12). |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 4.3.6 | Schema validation for routing table and rate limiter config | Already in project, standard for all validation |
| pino | 9.x | Structured logging for routing events | Already in project, low overhead for high-frequency message routing |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| nanoid | 5.x | Request IDs for rate limiter tracking | Already in project, used for unique identifiers |

### No New Dependencies Required

This phase requires ZERO new npm dependencies. Everything is built with:
- Node.js built-in `setTimeout`/`setInterval` for token bucket refill
- Existing Zod for schema validation
- Existing Pino for logging
- The Discord plugin is already available to Claude Code sessions via MCP

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom token bucket | `rate-limiter-flexible` npm package | Overkill -- we need a simple in-process rate limiter, not a Redis-backed distributed one. Custom is ~50 lines. |
| In-memory rate limiter | Redis-backed limiter | Only needed for multi-process. All agents run in the same daemon process via SDK sessions, so in-memory is correct. |
| discord.js for routing | Plugin-only approach | discord.js would duplicate what the plugin already does. NOT needed for this phase (D-04). |

## Architecture Patterns

### Recommended Project Structure
```
src/
  discord/
    router.ts           # Channel routing table: channelId -> agentName
    rate-limiter.ts      # Token bucket rate limiter (global + per-channel)
    types.ts             # RoutingTable, RateLimiterConfig types
    __tests__/
      router.test.ts
      rate-limiter.test.ts
```

### Pattern 1: Channel Routing Table (Immutable Lookup)
**What:** A readonly `Map<string, string>` mapping Discord channel IDs to agent names, built from config at startup.
**When to use:** At daemon boot, after config is loaded and before agents start.
**Example:**
```typescript
// Source: derived from existing config schema + CONTEXT.md D-06
import type { ResolvedAgentConfig } from "../shared/types.js";

export type RoutingTable = {
  readonly channelToAgent: ReadonlyMap<string, string>;
  readonly agentToChannels: ReadonlyMap<string, readonly string[]>;
};

export function buildRoutingTable(
  configs: readonly ResolvedAgentConfig[],
): RoutingTable {
  const channelToAgent = new Map<string, string>();
  const agentToChannels = new Map<string, string[]>();

  for (const config of configs) {
    const channels: string[] = [];
    for (const channelId of config.channels) {
      if (channelToAgent.has(channelId)) {
        throw new Error(
          `Channel ${channelId} is bound to both '${channelToAgent.get(channelId)}' and '${config.name}'`
        );
      }
      channelToAgent.set(channelId, config.name);
      channels.push(channelId);
    }
    agentToChannels.set(config.name, channels);
  }

  return { channelToAgent, agentToChannels };
}
```

### Pattern 2: Token Bucket Rate Limiter (In-Process)
**What:** A centralized rate limiter with two tiers -- a global bucket (50 tokens/second) and per-channel buckets (5 tokens per 5 seconds). All agent sessions share the same limiter instance in the daemon process.
**When to use:** Wrap around any Discord API call (primarily reply). Since agents use the Discord plugin's MCP tools, the rate limiter must intercept or gate outbound messages.
**Implementation recommendation:** Use a **sliding window** approach (refill tokens based on elapsed time since last check) rather than fixed-window intervals. This avoids burst spikes at window boundaries.

```typescript
// Source: standard token bucket algorithm
export type TokenBucketConfig = {
  readonly capacity: number;      // max tokens (burst size)
  readonly refillRate: number;     // tokens added per second
};

export type TokenBucket = {
  readonly tokens: number;
  readonly lastRefillAt: number;
};

export function createBucket(config: TokenBucketConfig): TokenBucket {
  return {
    tokens: config.capacity,
    lastRefillAt: Date.now(),
  };
}

export function tryConsume(
  bucket: TokenBucket,
  config: TokenBucketConfig,
): { readonly allowed: boolean; readonly bucket: TokenBucket; readonly retryAfterMs: number } {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefillAt) / 1000;
  const refilled = Math.min(
    config.capacity,
    bucket.tokens + elapsed * config.refillRate,
  );

  if (refilled >= 1) {
    return {
      allowed: true,
      bucket: { tokens: refilled - 1, lastRefillAt: now },
      retryAfterMs: 0,
    };
  }

  const waitMs = ((1 - refilled) / config.refillRate) * 1000;
  return {
    allowed: false,
    bucket: { tokens: refilled, lastRefillAt: now },
    retryAfterMs: Math.ceil(waitMs),
  };
}
```

### Pattern 3: Rate-Limited Queue
**What:** When a message hits the rate limit, it enters a FIFO queue. A drain loop processes queued messages as tokens become available (D-12).
**When to use:** For any rate-limited outbound Discord message.
**Key design:** Max queue depth prevents unbounded memory growth. Recommendation: 100 messages per channel, 1000 global. Beyond that, drop oldest.

### Pattern 4: Daemon Integration Point
**What:** The daemon creates the rate limiter and routing table at startup, then passes them to the session manager or makes them available for IPC queries.
**When to use:** In `startDaemon()` after config is loaded.

```typescript
// In daemon.ts startDaemon():
// After step 5 (resolve agents):
const routingTable = buildRoutingTable(resolvedAgents);
log.info({ routes: routingTable.channelToAgent.size }, "routing table built");

// Create rate limiter
const rateLimiter = createRateLimiter({
  global: { capacity: 50, refillRate: 50 },
  perChannel: { capacity: 5, refillRate: 1 }, // 5 tokens, 1/s refill = 5 per 5s
});
```

### Anti-Patterns to Avoid
- **Building a Discord.js bot:** The Discord plugin already handles the connection. Do NOT create a second Discord client (D-04, Anti-Pattern 5 from ARCHITECTURE.md).
- **Per-agent rate limiters:** All agents share one bot token, so rate limiting MUST be centralized (D-09, Pitfall 6).
- **Hardcoding rate limits:** Discord says "rate limits should not be hard coded." However, for this phase, the 50 req/s global and 5/5s per-channel are reasonable defaults. Make them configurable but start with these.
- **Mutating routing table after startup:** The routing table should be immutable. Config changes require daemon restart.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Discord WebSocket connection | Custom WebSocket client | Discord MCP plugin (`plugin:discord:discord`) | Plugin handles auth, heartbeat, reconnection, message formatting. Building this is months of work. |
| Discord message delivery | Custom HTTP client to Discord API | Plugin's `reply` MCP tool | Plugin handles rate limit headers, retry, formatting. Agent just calls reply(chat_id, text). |
| Distributed rate limiting | Redis-backed multi-process limiter | In-memory token bucket in daemon | All sessions run in one process. No distributed coordination needed. |
| Channel ID validation | Custom Discord API calls to verify channel exists | Config validation + startup error | If a channel ID in config is invalid, the plugin will error when the agent tries to use it. Fail loudly on first use. |

**Key insight:** The Discord plugin does 95% of the work. This phase is about routing (which session handles which channel) and rate limiting (preventing the shared bot token from being exhausted). The actual Discord communication is already solved.

## Common Pitfalls

### Pitfall 1: Duplicate Channel Bindings
**What goes wrong:** Two agents are configured with the same channel ID. Both try to respond to messages in that channel, causing duplicate or conflicting responses.
**Why it happens:** Config validation doesn't check for uniqueness across agents.
**How to avoid:** Validate at routing table build time. `buildRoutingTable()` must throw if any channel ID appears in more than one agent's config. This is a startup-time check.
**Warning signs:** Two responses appearing for one message in a Discord channel.

### Pitfall 2: Rate Limiter Not Actually Gating Plugin Calls
**What goes wrong:** The rate limiter exists but the Discord plugin MCP tools bypass it entirely because they're invoked by the Claude Code session, not by the daemon.
**Why it happens:** The Discord plugin runs inside each agent's Claude Code session. The daemon doesn't intercept individual MCP tool calls.
**How to avoid:** This is the key architectural question. Two approaches:
1. **System prompt instruction:** Tell each agent in its system prompt to respect rate limits. Unreliable -- LLMs don't reliably follow rate limit instructions.
2. **Pre-send gate via session hook:** If the SDK provides a PreToolUse hook, intercept Discord `reply` calls and check the rate limiter before allowing. This is the preferred approach if the SDK supports it.
3. **Accept plugin-level rate limiting:** The Discord plugin itself likely handles Discord's 429 responses with retry. The centralized rate limiter may be a proactive optimization rather than a strict gate.
**Warning signs:** 429 errors in Discord API responses despite rate limiter showing tokens available.

### Pitfall 3: Channel IDs as Numbers in YAML
**What goes wrong:** YAML parses large numeric channel IDs (like `1234567890123456789`) as JavaScript numbers, which lose precision beyond 2^53.
**Why it happens:** YAML auto-coerces unquoted numbers. Discord channel IDs are snowflakes (64-bit integers) that exceed JavaScript's safe integer range.
**How to avoid:** Already handled -- the config schema uses `z.string()` for channel IDs, and the PITFALLS.md notes this. YAML values must be quoted: `channels: ["1234567890123456789"]`.
**Warning signs:** Channel routing silently fails because the parsed channel ID doesn't match the actual Discord channel ID.

### Pitfall 4: Agent With No Channels
**What goes wrong:** An agent is configured with an empty `channels: []` array. It starts successfully but never receives Discord messages and serves no purpose.
**Why it happens:** The channels field defaults to `[]` in the schema.
**How to avoid:** This may be intentional (an agent that only works via IPC or CLI, not Discord). Log a warning but don't error. The routing table simply won't include it.
**Warning signs:** Agent running but never responding to anything.

### Pitfall 5: Queue Memory Growth Under Sustained Load
**What goes wrong:** The rate limiter queues messages when tokens are exhausted, but under sustained high load, the queue grows unbounded, consuming daemon memory.
**Why it happens:** No max queue depth configured.
**How to avoid:** Set a max queue depth (100 per channel, 1000 global). When exceeded, drop the oldest queued messages and log a warning. This is a discretion area per CONTEXT.md.
**Warning signs:** Daemon memory usage climbing steadily during peak Discord activity.

## Code Examples

### Building Routing Table from Config
```typescript
// Source: derived from src/config/schema.ts channels field + CONTEXT.md D-06
import type { ResolvedAgentConfig } from "../shared/types.js";

export type RoutingTable = {
  readonly channelToAgent: ReadonlyMap<string, string>;
  readonly agentToChannels: ReadonlyMap<string, readonly string[]>;
};

export function buildRoutingTable(
  configs: readonly ResolvedAgentConfig[],
): RoutingTable {
  const channelToAgent = new Map<string, string>();
  const agentToChannels = new Map<string, string[]>();

  for (const config of configs) {
    const agentChannels: string[] = [];
    for (const channelId of config.channels) {
      const existing = channelToAgent.get(channelId);
      if (existing !== undefined) {
        throw new Error(
          `Channel '${channelId}' is bound to both '${existing}' and '${config.name}'. ` +
          `Each channel can only be bound to one agent.`
        );
      }
      channelToAgent.set(channelId, config.name);
      agentChannels.push(channelId);
    }
    if (agentChannels.length > 0) {
      agentToChannels.set(config.name, agentChannels);
    }
  }

  return { channelToAgent, agentToChannels };
}
```

### Token Bucket Rate Limiter with Per-Channel Support
```typescript
// Source: standard token bucket algorithm adapted for Discord rate limits
export type RateLimiterConfig = {
  readonly global: { readonly capacity: number; readonly refillRate: number };
  readonly perChannel: { readonly capacity: number; readonly refillRate: number };
  readonly maxQueueDepth: number;
};

export const DEFAULT_RATE_LIMITER_CONFIG: RateLimiterConfig = {
  global: { capacity: 50, refillRate: 50 },         // 50 req/s
  perChannel: { capacity: 5, refillRate: 1 },        // 5 per 5s (1/s refill)
  maxQueueDepth: 100,
} as const;
```

### IPC Routes Extension
```typescript
// Extending IPC_METHODS in protocol.ts:
export const IPC_METHODS = [
  "start",
  "stop",
  "restart",
  "start-all",
  "status",
  "routes",          // New: return routing table
  "rate-limit-status", // New: return rate limiter state
] as const;
```

### Extending AgentSessionConfig for Channel Binding
```typescript
// In types.ts, extend AgentSessionConfig:
export type AgentSessionConfig = {
  readonly name: string;
  readonly model: "sonnet" | "opus" | "haiku";
  readonly workspace: string;
  readonly systemPrompt: string;
  readonly channels: readonly string[];  // New: bound channel IDs
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Build custom Discord.js bot | Use Claude Code Discord plugin | 2025 (plugin release) | Eliminates 90% of Discord integration code |
| Per-agent rate limiters | Centralized per-token rate limiter | Standard practice | Prevents shared-token exhaustion |
| Hardcoded rate limits | Parse X-RateLimit headers dynamically | Discord best practice | Adapts to Discord's changing limits |

## Open Questions

1. **How does the Discord plugin actually receive and route messages?**
   - What we know: The plugin delivers messages as `<channel>` tags with chat_id, message_id, user, ts attributes. Agents reply via the `reply` MCP tool.
   - What's unclear: Does the daemon need to explicitly configure which channels each agent session listens on? Or does the plugin deliver all messages to all sessions and each session filters by its bound channels?
   - Recommendation: The system prompt should include the agent's bound channel IDs. The plugin likely delivers messages from all channels it has access to. The agent must be instructed to only respond to messages from its bound channels. This is a soft enforcement (LLM-based) rather than hard enforcement (code-based).

2. **Can the rate limiter actually intercept Discord plugin MCP tool calls?**
   - What we know: The Claude Agent SDK may provide PreToolUse hooks for intercepting tool calls before they execute.
   - What's unclear: Whether PreToolUse hooks work for plugin-provided MCP tools (not just built-in tools).
   - Recommendation: Implement the rate limiter as a standalone module. If PreToolUse hooks work for plugins, use them. If not, rely on the Discord plugin's own 429 handling as the backstop, and use the rate limiter proactively via system prompt guidance ("check rate limit before replying"). Document this as a known limitation.

3. **Per-channel rate limit specifics**
   - What we know: Discord docs say per-route limits exist but explicitly say "rate limits should not be hard coded." The 5 messages per 5 seconds per channel is from community observation, not official docs.
   - What's unclear: The exact per-channel message sending limit from Discord's official API.
   - Recommendation: Use 5/5s as the default but make it configurable. Parse X-RateLimit headers if the plugin exposes them. The rate limiter should be conservative -- it's better to be slightly slow than to hit 429s.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.3 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose src/discord/` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DISC-01 | Config maps channel IDs to agent names; duplicate detection | unit | `npx vitest run src/discord/__tests__/router.test.ts -x` | No -- Wave 0 |
| DISC-02 | Routing table correctly resolves channelId to agentName | unit | `npx vitest run src/discord/__tests__/router.test.ts -x` | No -- Wave 0 |
| DISC-03 | Agent response delivery via plugin reply tool | manual-only | N/A (plugin integration, not testable in isolation) | N/A |
| DISC-04 | Rate limiter: global 50/s + per-channel 5/5s + queue behavior | unit | `npx vitest run src/discord/__tests__/rate-limiter.test.ts -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/discord/ --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/discord/__tests__/router.test.ts` -- covers DISC-01, DISC-02 (routing table construction, duplicate detection, empty channels, multi-channel-per-agent)
- [ ] `src/discord/__tests__/rate-limiter.test.ts` -- covers DISC-04 (token consumption, refill timing, per-channel buckets, queue overflow, concurrent requests)

## Sources

### Primary (HIGH confidence)
- [Discord Rate Limits Documentation](https://docs.discord.com/developers/topics/rate-limits) - Global 50 req/s per bot token, per-route limits, header-based dynamic limiting
- Project codebase -- `src/config/schema.ts`, `src/manager/session-manager.ts`, `src/manager/daemon.ts`, `src/manager/types.ts`, `src/ipc/protocol.ts`
- `.planning/research/PITFALLS.md` -- Pitfall 6 (Discord rate limit exhaustion)
- `.planning/research/ARCHITECTURE.md` -- Pattern 5 (Discord plugin delegation)

### Secondary (MEDIUM confidence)
- [Discord Bot Rate Limiting Guide 2026](https://space-node.net/blog/discord-bot-rate-limiting-guide-2026) - Per-channel community-observed limits
- [Handling Rate Limits at Scale (Xenon Bot)](https://blog.xenon.bot/handling-rate-limits-at-scale-fb7b453cb235) - Token bucket patterns for Discord bots
- [Token Bucket Rate Limiting in Node.js](https://oneuptime.com/blog/post/2026-01-25-token-bucket-rate-limiting-nodejs/view) - Implementation patterns

### Tertiary (LOW confidence)
- Per-channel 5 messages per 5 seconds limit -- community-reported, not in official Discord docs. Treat as conservative default, make configurable.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new deps needed, all existing libraries
- Architecture: HIGH - routing table is trivial, token bucket is well-understood algorithm, integration points clearly identified in existing code
- Pitfalls: MEDIUM - the key unknown is whether the rate limiter can actually intercept Discord plugin MCP calls (Open Question 2). Fallback is plugin's own 429 handling.

**Research date:** 2026-04-09
**Valid until:** 2026-05-09 (30 days -- stable domain, Discord rate limits rarely change)
