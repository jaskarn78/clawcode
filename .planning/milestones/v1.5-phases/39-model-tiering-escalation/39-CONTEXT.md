# Phase 39: Model Tiering & Escalation - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Agents run on haiku by default and escalate to more capable models when tasks demand it. This phase changes the default model from sonnet to haiku, adds fork-based escalation for complex tasks, introduces an `ask_advisor` MCP tool for one-shot opus consultations, and provides a Discord `/model` slash command for operators to change agent models.

</domain>

<decisions>
## Implementation Decisions

### Escalation Triggers
- Error-rate trigger — if haiku produces 3+ consecutive tool errors or "I can't" responses, escalate to sonnet. Plus keyword trigger for explicit "this needs opus" in operator message
- Fork-based escalation — spawn a new session with the target model via `forkSession`, feed it context summary, handle the complex task, return result to haiku session. Per Anthropic's managed agents pattern: "stateless harness swapping"
- Automatic de-escalation — the forked escalated session is ephemeral. Once it completes, the original haiku session continues. No permanent model drift
- Escalation logic lives in a new `src/manager/escalation.ts` module — monitors agent responses, decides when to escalate, manages the fork lifecycle

### Advisor Tool (TIER-03)
- MCP tool `ask_advisor` — agent calls it with a question, daemon spawns a short-lived opus session via `sdk.query()` (one-shot, not fork), returns the answer
- Advisor gets: the question text + agent's recent memory context (top 5 relevant memories via SemanticSearch). Not the full conversation history
- Response format: plain text answer, limited to 2000 chars. Agent receives it as the tool result
- Per-agent daily budget tracked in SQLite. Default 10 advisor calls/day. Configurable per agent. Excess calls return error with "budget exhausted"

### Operator Controls (TIER-05)
- Slash command: `/model <agent> <model>` — e.g., `/model test-agent opus`. Sets the agent's default model
- Model change does NOT require restart — updates config in memory, takes effect on next session resume/restart
- Any user in the agent's bound channel can use the command (ACL check via existing SECURITY.md allowlist)
- Discord embed reply showing: agent name, old model, new model, "takes effect on next session"

### Default Model Change (TIER-01)
- Change `modelSchema.default("sonnet")` to `modelSchema.default("haiku")` in `src/config/schema.ts`
- Change `model: "sonnet" as const` to `model: "haiku" as const` in defaults

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/config/schema.ts` — `modelSchema` with `z.enum(["sonnet", "opus", "haiku"])`, default currently `"sonnet"`
- `src/manager/session-adapter.ts` — `SdkSessionAdapter` with `createSession()` and session management
- `src/manager/session-manager.ts` — `SessionManager` with `startAgent()`, `sendToAgent()`, `forkAgent()`
- `src/manager/fork.ts` — `buildForkName()`, `buildForkConfig()` for session forking
- `src/discord/slash-commands.ts` — `SlashCommandHandler` for registering and dispatching slash commands
- `src/discord/slash-types.ts` — `DEFAULT_SLASH_COMMANDS` array, `SlashCommandDef` type
- `src/mcp/server.ts` — MCP server with existing tools (memory_lookup, agent_status, etc.)
- `src/usage/tracker.ts` — `UsageTracker` for per-session token/cost tracking
- `src/memory/search.ts` — `SemanticSearch` for advisor context retrieval

### Established Patterns
- Slash commands follow `SlashCommandDef` pattern with `name`, `description`, `options`, `handler`
- MCP tools follow `createMcpServer()` pattern
- IPC handlers added as cases in `daemon.ts` `routeMethod()`
- All domain objects frozen, readonly types, constructor injection

### Integration Points
- `src/config/schema.ts` — change default model to haiku (TIER-01)
- `src/manager/escalation.ts` — new module for escalation logic (TIER-02)
- `src/mcp/server.ts` — add `ask_advisor` tool (TIER-03)
- `src/manager/daemon.ts` — add `ask-advisor` and `set-model` IPC handlers
- `src/discord/slash-types.ts` — add `/model` command definition (TIER-05)
- `src/usage/tracker.ts` — add advisor budget tracking

</code_context>

<specifics>
## Specific Ideas

- The fork-based escalation aligns with Anthropic's managed agents architecture: treat harnesses as stateless cattle that can be swapped between models
- Advisor budget is separate from the escalation budget in Phase 40 — advisor is per-agent daily, escalation budgets are per-agent weekly with Discord alerts
- The `ask_advisor` tool should include the agent's name in the one-shot query so opus can provide agent-appropriate advice

</specifics>

<deferred>
## Deferred Ideas

- Per-agent escalation budgets with Discord alerts (Phase 40, TIER-04)
- Complexity heuristic (message length, tool chain depth) as additional trigger — start with error-rate + keyword, add heuristics based on empirical data
- Event streaming/replay for escalation sessions — deferred per managed agents review

</deferred>
