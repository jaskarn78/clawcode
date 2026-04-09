---
created: 2026-04-09T16:36:31.918Z
title: Bypass SDK unstable_v2 limitations for MCP and channels
area: agent-session
files:
  - src/manager/session-adapter.ts:137-161
  - node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs
---

## Problem

The SDK's `unstable_v2_createSession` hardcodes three critical options to empty/disabled:
- `settingSources: []` -- agent sessions can't load workspace `.claude/settings.json` (no MCP servers like 1Password)
- `mcpServers: {}` -- can't pass MCP server configs directly
- No `channels` pass-through -- agent sessions can't use Discord plugin channels

This means agents have no access to MCP tools configured in their workspace, and can't use the Discord MCP plugin directly for replies.

**Current workarounds:**
- Discord bridge handles message responses (sendToAgent + bridge posts reply)
- 1Password: op CLI via Bash (instructions in SOUL.md)

## Solution

Two approaches (evaluate when SDK matures):

1. **Spawn claude CLI directly via execa** -- bypass the SDK entirely for session creation. Use `execa` to run `claude --output-format stream-json --input-format stream-json --setting-sources=project --channels plugin:discord@claude-plugins-official --permission-mode bypassPermissions` with proper cwd. Parse the JSON stream protocol directly. This gives full control over all CLI flags.

2. **Use SDK's full query-based API** -- the non-unstable `query()` function in the SDK does pass `mcpServers`, `settingSources`, and `channels` through to the process spawner. Would require refactoring `SdkSessionAdapter` to use the query API instead of `unstable_v2`.

Option 1 is more work but gives complete control. Option 2 depends on the SDK's query API being stable enough. Evaluate when `@anthropic-ai/claude-agent-sdk` reaches 1.0 or the unstable API adds these options.
