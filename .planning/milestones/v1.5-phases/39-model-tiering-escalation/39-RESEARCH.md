# Phase 39: Model Tiering & Escalation - Research

**Researched:** 2026-04-10
**Domain:** Claude Agent SDK model routing, session forking, MCP tool integration, Discord slash commands
**Confidence:** HIGH

## Summary

This phase changes the default agent model from sonnet to haiku, adds fork-based escalation when haiku fails, introduces an `ask_advisor` MCP tool for one-shot opus consultations, and adds a `/model` slash command for operators. All four pillars build on well-established codebase patterns: schema defaults, session forking, MCP tool registration, and slash command definitions.

The implementation is almost entirely additive. The default model change is a two-line edit to `src/config/schema.ts`. Escalation is a new `src/manager/escalation.ts` module that monitors agent responses and forks sessions via `SessionManager.forkSession()` with a model override. The advisor tool is a new MCP tool that calls the SDK's `query()` API for a one-shot opus session. The `/model` command follows the existing `SlashCommandDef` pattern with a new IPC handler.

**Primary recommendation:** Implement in order: TIER-01 (default change) -> TIER-02 (escalation module) -> TIER-03 (advisor tool) -> TIER-05 (slash command). Each builds on the previous, and TIER-01 is trivially verifiable before progressing.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Error-rate trigger: 3+ consecutive tool errors or "I can't" responses escalate haiku to sonnet. Keyword trigger for explicit "this needs opus" in operator message
- Fork-based escalation: spawn new session with target model via forkSession, feed context summary, handle task, return result to haiku session. Ephemeral escalated session = automatic de-escalation
- Escalation logic in new `src/manager/escalation.ts` module
- MCP tool `ask_advisor`: agent calls with question, daemon spawns short-lived opus session via `sdk.query()` (one-shot, not fork), returns answer
- Advisor gets: question text + agent's recent memory context (top 5 relevant memories via SemanticSearch). Not full conversation history
- Response format: plain text, limited to 2000 chars. Per-agent daily budget tracked in SQLite. Default 10 advisor calls/day
- Slash command: `/model <agent> <model>` sets default model. Does NOT require restart. ACL check via existing SECURITY.md allowlist
- Default model change: `modelSchema.default("sonnet")` -> `modelSchema.default("haiku")` and `model: "sonnet" as const` -> `model: "haiku" as const`

### Claude's Discretion
- None specified (all implementation details were locked in CONTEXT.md)

### Deferred Ideas (OUT OF SCOPE)
- Per-agent escalation budgets with Discord alerts (Phase 40, TIER-04)
- Complexity heuristic (message length, tool chain depth) as additional trigger
- Event streaming/replay for escalation sessions
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TIER-01 | Default agent model is haiku instead of sonnet | Two-line edit in `src/config/schema.ts`: `defaultsSchema` and `configSchema` defaults. Pattern verified in existing code. |
| TIER-02 | Agent can escalate to a more capable model when task complexity exceeds haiku's capability | `SessionManager.forkSession()` already supports `modelOverride` in `ForkOptions`. New `escalation.ts` module monitors responses, triggers fork with sonnet/opus model. |
| TIER-03 | Agent can call opus as an advisor tool for hard decisions without switching sessions | New MCP tool `ask_advisor` calling SDK `query()` one-shot with opus model. IPC handler pattern from `memory-lookup`. Budget tracking via new SQLite table in UsageTracker. |
| TIER-05 | Discord slash command allows operator to set/change default model for an agent | `SlashCommandDef` pattern from `slash-types.ts`. New IPC handler `set-model` updates in-memory config. |
</phase_requirements>

## Architecture Patterns

### Recommended Project Structure (new files)
```
src/
  manager/
    escalation.ts          # NEW: EscalationMonitor class
    escalation.test.ts     # NEW: unit tests
  mcp/
    server.ts              # MODIFY: add ask_advisor tool
  usage/
    advisor-budget.ts      # NEW: AdvisorBudget class (SQLite-backed daily budget)
    advisor-budget.test.ts # NEW: unit tests
  discord/
    slash-types.ts         # MODIFY: add /model command to DEFAULT_SLASH_COMMANDS
  config/
    schema.ts              # MODIFY: default "sonnet" -> "haiku"
  manager/
    daemon.ts              # MODIFY: add ask-advisor and set-model IPC handlers
```

### Pattern 1: Fork-Based Escalation (TIER-02)

**What:** When haiku produces 3+ consecutive errors or "I can't" responses, fork the session with a model override to sonnet. The forked session is ephemeral -- it handles the complex task then closes. The original haiku session continues.

**When to use:** Response monitoring detects haiku capability limit.

**How it works with existing code:**

The `SessionManager.forkSession()` method already accepts `ForkOptions` with `modelOverride`. The fork builds a new `ResolvedAgentConfig` via `buildForkConfig()` which sets `model: options?.modelOverride ?? parentConfig.model`. The forked session starts with `startAgent()`, runs independently, and is stopped after task completion.

The new `EscalationMonitor` class:
1. Wraps `sendAndCollect` / `streamFromAgent` calls
2. Tracks consecutive error count per agent
3. When threshold (3) is reached, calls `forkSession` with model override
4. Sends the failed message to the forked session
5. Returns the forked session's response to the caller
6. Stops the forked session after response

**Key detail:** The fork is headless (no Discord channels). The daemon routes the response back through the original agent's channel. The escalation module must sit between the daemon's message routing and the session manager.

### Pattern 2: One-Shot Advisor Query (TIER-03)

**What:** MCP tool `ask_advisor` spawns a short-lived opus query for a specific question. Unlike fork-based escalation, this does NOT fork the session -- it creates a standalone one-shot query.

**How it works:**

1. Agent calls `ask_advisor` MCP tool with a question string
2. MCP tool sends IPC request `ask-advisor` to daemon
3. Daemon handler:
   a. Checks per-agent daily budget (SQLite table)
   b. Retrieves top 5 relevant memories via SemanticSearch for context
   c. Calls `sdk.query()` with model "opus", a system prompt including agent name + memories, and the question as prompt
   d. Collects result text, truncates to 2000 chars
   e. Decrements budget counter
   f. Returns result to MCP tool
4. MCP tool returns the answer as tool result to the agent

**Budget tracking:** New `advisor_budget` table in the agent's usage DB:
```sql
CREATE TABLE advisor_budget (
  agent TEXT NOT NULL,
  date TEXT NOT NULL,    -- YYYY-MM-DD
  calls_used INTEGER NOT NULL DEFAULT 0,
  max_calls INTEGER NOT NULL DEFAULT 10,
  PRIMARY KEY (agent, date)
);
```

### Pattern 3: Runtime Model Override (TIER-05)

**What:** `/model <agent> <model>` slash command updates the agent's model in memory. Takes effect on next session resume/restart -- does NOT interrupt the running session.

**How it works:**

1. Slash command sends IPC request `set-model` with agent name and target model
2. Daemon handler validates model string against `modelSchema` (zod enum)
3. Updates the in-memory `ResolvedAgentConfig` for the agent (create new frozen object, replace in configs map)
4. Returns old model and new model for Discord embed response
5. The `SessionManager.configs` map is updated; next `startAgent()` or session resume picks up the new model

**Important:** The `configs` Map in `SessionManager` is private. The daemon needs to either:
- Add a `setAgentModel(name, model)` method to SessionManager
- Or update the config at the daemon level (where `resolvedAgents` lives) and have SessionManager read from there

The cleaner approach is adding `updateAgentConfig(name, partial)` to SessionManager, which creates a new frozen config object with the model override.

### Anti-Patterns to Avoid
- **Mid-session model switch:** The SDK does not support changing the model of a running session. Always fork or create a new session.
- **Permanent model drift:** Escalated sessions must be ephemeral. Never update the agent's base config when escalating -- only when operator explicitly uses `/model`.
- **Advisor as fork:** The advisor is a one-shot `query()`, NOT a `forkSession()`. Forking carries context overhead; the advisor should be lightweight.
- **Shared budget state:** Advisor budget is per-agent, stored in each agent's own usage SQLite DB. Not a shared resource.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session forking with model override | Custom process spawning | `SessionManager.forkSession()` with `ForkOptions.modelOverride` | Already handles naming, config inheritance, lifecycle |
| One-shot model query | Persistent session management | `sdk.query()` directly | SDK handles single-turn queries efficiently; no session state needed |
| Zod model validation | Manual string checks | `modelSchema.safeParse(model)` | Already defined, handles the 3-value enum |
| Slash command registration | Manual Discord API calls | `SlashCommandDef` + `SlashCommandHandler` | Existing infrastructure handles registration, routing, response |
| Daily budget reset | Manual date tracking | `PRIMARY KEY (agent, date)` in SQLite | INSERT OR REPLACE with today's date auto-creates new daily row |

## Common Pitfalls

### Pitfall 1: Config Mutation
**What goes wrong:** Updating model on a running agent's config mutates the existing frozen object.
**Why it happens:** `ResolvedAgentConfig` fields are `readonly`. Attempting to modify in-place throws in strict mode.
**How to avoid:** Always create a new config object: `{ ...existingConfig, model: newModel }`. Freeze the result.
**Warning signs:** TypeScript compilation errors on readonly assignment.

### Pitfall 2: Escalation Feedback Loop
**What goes wrong:** Escalated session also triggers error-rate monitoring, causing cascade escalation (sonnet -> opus -> opus -> ...).
**Why it happens:** If the escalation monitor wraps ALL sessions including forks.
**How to avoid:** The `EscalationMonitor` must skip fork sessions. Use `buildForkName()` naming convention (contains `-fork-`) to detect forks and bypass monitoring.
**Warning signs:** Multiple fork sessions spawning for the same agent.

### Pitfall 3: Advisor Budget Not Resetting Daily
**What goes wrong:** Budget accumulates across days, agent runs out permanently.
**Why it happens:** Using a single row per agent instead of per-agent-per-date.
**How to avoid:** Use `(agent, date)` composite primary key. Each day gets a fresh row. Query today's date to check budget.
**Warning signs:** Budget exhaustion that persists across midnight.

### Pitfall 4: SDK query() Model Parameter Format
**What goes wrong:** Passing wrong model string to SDK query(). The SDK expects model identifiers like `"claude-sonnet-4-20250514"` or shorthand like `"sonnet"`.
**Why it happens:** Confusion between display names and SDK model identifiers.
**How to avoid:** The existing `SdkSessionAdapter.createSession()` passes `config.model` directly to `baseOptions.model`. The SDK accepts shorthand: `"sonnet"`, `"opus"`, `"haiku"`. Verified in `sdk-types.ts` where `SdkQueryOptions.model` is typed as `string`.
**Warning signs:** SDK error "unknown model" on query.

### Pitfall 5: Orphaned Fork Sessions
**What goes wrong:** Escalated fork session never gets stopped if the original message handler throws or the daemon crashes.
**Why it happens:** Fork lifecycle not properly wrapped in try/finally.
**How to avoid:** Always wrap fork usage in try/finally that calls `stopAgent(forkName)`. Register an `onEnd` callback on the fork handle as a safety net.
**Warning signs:** Accumulating fork sessions visible in `registry.json`.

### Pitfall 6: Concurrent Escalation Races
**What goes wrong:** Two messages arrive simultaneously while agent is in error state, both trigger escalation, two forks spawn.
**Why it happens:** Escalation check is not atomic with fork creation.
**How to avoid:** Use a per-agent escalation lock (simple boolean flag). If escalation is in progress, queue the second message or route it to the existing fork.
**Warning signs:** Multiple forks with same parent agent in registry.

## Code Examples

### TIER-01: Default Model Change
```typescript
// src/config/schema.ts — two changes:

// 1. In defaultsSchema:
export const defaultsSchema = z.object({
  model: modelSchema.default("haiku"),  // was "sonnet"
  // ... rest unchanged
});

// 2. In configSchema defaults object:
defaults: defaultsSchema.default(() => ({
  model: "haiku" as const,  // was "sonnet" as const
  // ... rest unchanged
})),
```

### TIER-02: Escalation Monitor Structure
```typescript
// src/manager/escalation.ts
export type EscalationConfig = {
  readonly errorThreshold: number;       // default: 3
  readonly escalationModel: "sonnet" | "opus";  // default: "sonnet"
  readonly keywordTriggers: readonly string[];   // e.g., ["this needs opus"]
};

export class EscalationMonitor {
  private readonly errorCounts: Map<string, number> = new Map();
  private readonly escalating: Set<string> = new Set();  // lock per agent

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly config: EscalationConfig,
  ) {}

  /** Check if a response indicates haiku failure */
  shouldEscalate(agentName: string, response: string, isError: boolean): boolean {
    // Skip fork sessions
    if (agentName.includes("-fork-")) return false;
    // Skip if already escalating
    if (this.escalating.has(agentName)) return false;
    // ... error count logic
  }

  /** Fork session with escalated model, send message, return response, cleanup */
  async escalate(agentName: string, message: string): Promise<string> {
    this.escalating.add(agentName);
    try {
      const fork = await this.sessionManager.forkSession(agentName, {
        modelOverride: this.config.escalationModel,
      });
      const response = await this.sessionManager.sendToAgent(fork.forkName, message);
      await this.sessionManager.stopAgent(fork.forkName);
      this.resetErrorCount(agentName);
      return response;
    } finally {
      this.escalating.delete(agentName);
    }
  }
}
```

### TIER-03: Advisor MCP Tool
```typescript
// In src/mcp/server.ts — add to createMcpServer():
server.tool(
  "ask_advisor",
  "Ask opus for advice on a complex decision without switching sessions",
  {
    question: z.string().describe("The question to ask the advisor"),
    agent: z.string().describe("Your agent name"),
  },
  async ({ question, agent }) => {
    const result = await sendIpcRequest(SOCKET_PATH, "ask-advisor", {
      agent,
      question,
    }) as { answer: string; budget_remaining: number };

    return {
      content: [{
        type: "text" as const,
        text: `${result.answer}\n\n[Advisor budget remaining: ${result.budget_remaining}/day]`,
      }],
    };
  },
);
```

### TIER-03: Advisor IPC Handler
```typescript
// In daemon.ts routeMethod():
case "ask-advisor": {
  const agentName = validateStringParam(params, "agent");
  const question = validateStringParam(params, "question");

  // Check budget
  const budget = getAdvisorBudget(agentName);
  if (budget.calls_used >= budget.max_calls) {
    throw new ManagerError(`Advisor budget exhausted for '${agentName}' (${budget.max_calls}/day)`);
  }

  // Get memory context
  const store = manager.getMemoryStore(agentName);
  const embedder = manager.getEmbedder();
  const queryEmbedding = await embedder.embed(question);
  const search = new SemanticSearch(store.db);
  const memories = search.search(queryEmbedding, 5);

  const memoryContext = memories
    .map((m) => `- ${m.content}`)
    .join("\n");

  // One-shot opus query
  const sdk = await loadSdk();
  const query = sdk.query({
    prompt: question,
    options: {
      model: "opus",
      systemPrompt: `You are an advisor to agent "${agentName}". Provide concise, actionable guidance.\n\nRelevant context from agent's memory:\n${memoryContext}`,
    },
  });

  let answer = "";
  for await (const msg of query) {
    if (msg.type === "result" && "result" in msg && typeof msg.result === "string") {
      answer = msg.result;
      break;
    }
  }

  // Truncate and record
  answer = answer.slice(0, 2000);
  incrementAdvisorBudget(agentName);

  return { answer, budget_remaining: budget.max_calls - budget.calls_used - 1 };
}
```

### TIER-05: Model Slash Command
```typescript
// In src/discord/slash-types.ts — add to DEFAULT_SLASH_COMMANDS:
{
  name: "clawcode-model",
  description: "Set the default model for an agent",
  claudeCommand: "Set my model to {model}",
  options: [
    {
      name: "model",
      type: 3,  // STRING
      description: "Model to use (haiku, sonnet, opus)",
      required: true,
    },
  ],
}
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (latest) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TIER-01 | Default model changes from sonnet to haiku | unit | `npx vitest run src/config/__tests__/schema.test.ts -x` | Exists (modify) |
| TIER-02 | Escalation triggers on 3+ errors, forks with model override | unit | `npx vitest run src/manager/escalation.test.ts -x` | Wave 0 |
| TIER-02 | Fork cleanup after escalation completes | unit | `npx vitest run src/manager/escalation.test.ts -x` | Wave 0 |
| TIER-02 | Skip monitoring for fork sessions | unit | `npx vitest run src/manager/escalation.test.ts -x` | Wave 0 |
| TIER-03 | ask_advisor MCP tool returns opus answer | unit | `npx vitest run src/mcp/server.test.ts -x` | Exists (modify) |
| TIER-03 | Advisor budget enforcement (daily limit) | unit | `npx vitest run src/usage/advisor-budget.test.ts -x` | Wave 0 |
| TIER-03 | Advisor includes memory context | unit | `npx vitest run src/usage/advisor-budget.test.ts -x` | Wave 0 |
| TIER-05 | /model command updates agent config | unit | `npx vitest run src/discord/__tests__/slash-types.test.ts -x` | Exists (modify) |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/manager/escalation.test.ts` -- covers TIER-02 (escalation monitor, fork lifecycle, error counting, skip-forks logic, concurrency lock)
- [ ] `src/usage/advisor-budget.test.ts` -- covers TIER-03 (daily budget reset, increment, exhaustion, per-agent isolation)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Static model per agent | Dynamic model escalation via fork | This phase | Cost savings from haiku default, capability preservation via escalation |
| No advisor capability | One-shot opus consultation | This phase | Agents can get help without abandoning their session |
| No runtime model control | `/model` slash command | This phase | Operator can tune model per agent without config file edits |

## Open Questions

1. **SDK `query()` with opus model from daemon context**
   - What we know: The SDK `query()` accepts `model: "opus"` in options. The existing `SdkSessionAdapter` uses it for session creation.
   - What's unclear: Whether calling `sdk.query()` from the daemon process (not from within an agent session) requires any special authentication or setup. The daemon already imports the SDK for session management.
   - Recommendation: Test with a simple one-shot opus query in development before wiring up the full advisor handler. LOW risk -- the SDK is designed for exactly this.

2. **Error detection heuristics**
   - What we know: CONTEXT.md specifies "3+ consecutive tool errors or 'I can't' responses"
   - What's unclear: Exact string matching for "I can't" -- should it be case-insensitive regex? What about "I'm unable to", "I don't have the capability"?
   - Recommendation: Start with simple includes check for a few common phrases. Use a configurable array of trigger phrases. Can be refined empirically.

## Project Constraints (from CLAUDE.md)

- **Immutability:** All config updates must create new frozen objects, never mutate existing ones
- **File organization:** New modules should be small, focused (200-400 lines). `escalation.ts` and `advisor-budget.ts` should each be self-contained
- **Error handling:** All IPC handlers must handle errors explicitly. Advisor budget exhaustion returns a clear error message, not a silent failure
- **Security:** Advisor budget prevents runaway opus costs. `/model` command checks ACL via existing allowlist
- **No hardcoded secrets:** SDK auth uses existing OAuth flow, no new keys needed
- **Input validation:** `/model` command validates model string via zod schema before processing

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/config/schema.ts` -- verified `modelSchema`, `defaultsSchema`, `configSchema` default values
- Codebase analysis: `src/manager/fork.ts` -- verified `ForkOptions.modelOverride`, `buildForkConfig()` implementation
- Codebase analysis: `src/manager/session-adapter.ts` -- verified SDK `query()` usage pattern, `SdkQueryOptions.model`
- Codebase analysis: `src/mcp/server.ts` -- verified MCP tool registration pattern with IPC delegation
- Codebase analysis: `src/discord/slash-types.ts` -- verified `SlashCommandDef` type, `DEFAULT_SLASH_COMMANDS` array
- Codebase analysis: `src/usage/tracker.ts` -- verified SQLite usage pattern for budget tracking
- Codebase analysis: `src/manager/daemon.ts` -- verified IPC `routeMethod()` pattern, `memory-lookup` as reference handler
- Codebase analysis: `src/manager/sdk-types.ts` -- verified SDK version 0.2.97, `SdkModule.query()` signature

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions: All implementation specifics were locked by user discussion

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, all patterns exist in codebase
- Architecture: HIGH - fork-based escalation uses existing `forkSession()`, advisor uses existing SDK `query()`
- Pitfalls: HIGH - identified from direct code analysis of session lifecycle and config immutability patterns

**Research date:** 2026-04-10
**Valid until:** 2026-05-10 (stable -- no external dependency changes)
