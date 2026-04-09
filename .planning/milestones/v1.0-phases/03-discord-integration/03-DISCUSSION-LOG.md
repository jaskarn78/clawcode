# Phase 3: Discord Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.

**Date:** 2026-04-09
**Phase:** 03-discord-integration
**Areas discussed:** Discord plugin integration, Message routing, Rate limiting, Response delivery
**Mode:** Auto (all areas auto-selected, recommended defaults chosen)

---

## Discord Plugin Integration

| Option | Description | Selected |
|--------|-------------|----------|
| Leverage existing Discord MCP plugin | Each agent session gets Discord plugin access, manager configures channel bindings | x |
| Custom Discord bot integration | Build separate Discord.js bot that routes to agents | |
| Webhook-based routing | Use Discord webhooks per agent | |

**User's choice:** [auto] Leverage existing Discord MCP plugin (recommended)

---

## Message Routing

| Option | Description | Selected |
|--------|-------------|----------|
| Config-driven channel binding | clawcode.yaml defines which channels map to which agent | x |
| Dynamic routing rules | Runtime-configurable routing with patterns/regex | |
| Topic-based routing | Route based on message content/keywords | |

**User's choice:** [auto] Config-driven channel binding (recommended)

---

## Rate Limiting

| Option | Description | Selected |
|--------|-------------|----------|
| Centralized token bucket | Shared limiter, 50 req/s + per-channel limits, queue overflow | x |
| Per-agent independent limits | Each agent manages its own rate limiting | |
| No rate limiting | Rely on Discord API error handling | |

**User's choice:** [auto] Centralized token bucket (recommended)

---

## Response Delivery

| Option | Description | Selected |
|--------|-------------|----------|
| Native Discord plugin reply | Agent sessions use MCP reply tool directly | x |
| Proxy through daemon | All responses go through daemon for rate limiting | |
| Custom webhook delivery | Use per-agent webhooks for distinct avatars | |

**User's choice:** [auto] Native Discord plugin reply (recommended)

---

## Claude's Discretion

- Token bucket implementation details
- Queue overflow behavior
- Logging format for routing events
- Discord API failure handling

## Deferred Ideas

None
