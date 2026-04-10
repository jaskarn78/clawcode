# Phase 35: Resolve OpenClaw Coexistence Conflicts - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Resolve HIGH-risk coexistence conflicts between ClawCode and OpenClaw so both systems can run safely on the same machine without silent failures, duplicate responses, or config corruption. Fixes: Discord token fallback, slash command namespace, dashboard port binding, env var interpolation in config, and duplicate skill installation call.

</domain>

<decisions>
## Implementation Decisions

### Discord Token & Bridge Safety
- Hard fail if `op read` fails for Discord bot token — never fall back to shared Claude Code plugin token. This prevents dual-consumer conflicts where both systems receive every Discord message.
- Remove the fallback `Client` creation in `SlashCommandHandler` — if the bridge failed to start, slash commands should also be unavailable (prevents duplicate gateway connections).
- Bind dashboard HTTP server to `127.0.0.1` explicitly and make it non-fatal — if port 3100 is taken, log a warning and skip dashboard. The daemon should run fine without it.
- Keep current `buildCleanEnv()` approach for stripping `ANTHROPIC_API_KEY` — already working correctly.

### Environment & Config Safety
- Add env var resolution in config loader for `${VAR_NAME}` patterns — currently YAML single-quoted `'${OPENAI_API_KEY}'` passes the literal string to MCP servers instead of the resolved value.
- Deduplicate `installWorkspaceSkills` call in daemon startup — currently called twice for no reason.
- Prefix all ClawCode slash commands with `clawcode-` (e.g., `clawcode-status` instead of `status`) to avoid overwriting OpenClaw's registered commands when sharing a bot.

### Claude's Discretion
- Implementation details for env var resolution (regex pattern, error handling for missing vars)
- Whether to add integration tests for the token resolution failure path
- Error message wording and log levels

</decisions>

<code_context>
## Existing Code Insights

### Key Files to Modify
- `src/manager/daemon.ts` — Token resolution (lines 305-333), duplicate skill install (lines 148-149, 169), dashboard server startup
- `src/discord/slash-commands.ts` — Slash command registration (line 169), fallback client creation (lines 85-100)
- `src/config/loader.ts` — Env var interpolation for `${VAR_NAME}` patterns
- `src/dashboard/server.ts` — Port binding and error handling

### Established Patterns
- `buildCleanEnv()` in session-adapter.ts already strips env vars — follow same pattern
- Error handling uses pino logger throughout
- Config validation uses zod schemas

### Integration Points
- Dashboard server start is called from `startDaemon()` — needs to become non-fatal
- Slash command handler is instantiated by daemon with bridge's Discord client
- Config loader is used by both daemon and CLI commands

</code_context>

<specifics>
## Specific Ideas

- CONCERNS.md section 1 has the full analysis of all 10 coexistence conflicts — use as reference
- The debug doc `.planning/debug/invalid-api-key-clawcode.md` shows the env var issue was already root-caused and partially fixed

</specifics>

<deferred>
## Deferred Ideas

- Resource contention / max concurrent agent limits — needs profiling data
- Thread bindings cross-system awareness — low risk, separate state files
- MCP server deduplication across systems — stateless servers are fine with duplicates
- PID file stale process detection — low risk

</deferred>
