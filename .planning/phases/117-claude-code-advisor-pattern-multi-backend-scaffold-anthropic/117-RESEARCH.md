# Phase 117: Claude Code Advisor Pattern — Multi-Backend Scaffold — Research

**Researched:** 2026-05-13
**Domain:** Anthropic API `advisor_20260301` beta + Claude Agent SDK 0.2.132 `advisorModel` integration; ClawCode multi-backend abstraction
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Architecture:**
- Three backend slots, two working: `AnthropicSdkAdvisor` (native, default), `LegacyForkAdvisor` (rollback, gated by `advisor.backend: fork`), `PortableForkAdvisor` (scaffold stub for Phase 118).
- Provider-neutral interface at `src/advisor/` and `src/llm/`. Call sites talk to `AdvisorService`, not the SDK directly. Future non-Anthropic providers slot into `src/llm/` without touching advisor code.
- Feature flag for rollback — same pattern as Phase 110 `defaults.shimRuntime`. Default `backend: native`; operators flip any one agent to `fork` via `clawcode reload` without a redeploy.

**Preserved contracts:**
- `ask_advisor` MCP tool name and `{question, agent}` schema (`src/mcp/server.ts:925`) — unchanged. (Note: native-backend agents drop registration of this tool — see Gate 2 resolution.)
- `ask-advisor` IPC method name (`src/ipc/protocol.ts:168`) — unchanged; handler body re-points at `AdvisorService`.
- `AdvisorBudget` per-agent daily cap, default 10/day (`src/usage/advisor-budget.ts`) — unchanged.
- `ADVISOR_RESPONSE_MAX_LENGTH = 2000` — truncation applied in `AdvisorService` (both backends).
- Non-idempotent / never-cache flag for `ask_advisor` (`src/config/schema.ts:738`, `src/config/loader.ts:294`) — stays.

**File layout:**
```
src/advisor/
  types.ts, service.ts, registry.ts, prompts.ts, index.ts
  backends/{types,anthropic-sdk,legacy-fork,portable-fork}.ts
  __tests__/

src/llm/
  provider.ts (interface only)
  README.md

src/usage/
  advisor-budget.ts (existing — unchanged)
  verbose-state.ts (NEW — Plan 117-11; SQLite-backed verbose_channels table)
```

**Discord visibility:**
- 💭 reaction on the triggering user message via `src/discord/reactions.ts`.
- Footer `— consulted advisor (Opus) before responding` appended to assistant response delivery.
- `advisor:invoked` event emitted from `src/manager/session-adapter.ts` and consumed by `src/discord/bridge.ts`.
- Must fire BEFORE delivery so footer + reaction land atomically.
- NO new threads — in-band only.

**`/verbose` toggle (Plan 117-11):**
- Operator Discord slash command `/verbose on|off|status` per channel.
- State stored in SQLite via new `src/usage/verbose-state.ts` (table `verbose_channels(channel_id PK, level, updated_at)`).
- Levels: `normal` (default — 💭 + footer) and `verbose` (inline Q+A block).
- When advisor fires AND channel level is `verbose`, append a fenced block.

### Claude's Discretion
- Exact wording of the timing-prompt block injected into agent system prompts (Plan 117-08). Use the docs-recommended block from `/home/jjagpal/.claude/CLAUDE.md`'s advisor section as canonical text.
- Internal directory structure of `src/advisor/__tests__/` (flat — matches surrounding codebase: `src/manager/__tests__/`, `src/config/__tests__/` are flat).
- Whether `verbose_channels` table lives in the existing manager SQLite db or a new file — recommend a new file `manager/verbose-state.db` to match AdvisorBudget's own-file precedent (Pattern Reference §4).
- Footer wording — `— consulted advisor (Opus) before responding` is the strong default; minor tweaks fine.

### Deferred Ideas (OUT OF SCOPE for Phase 117)
- Full `PortableForkAdvisor` implementation — Phase 118.
- Non-Anthropic providers (OpenAI, Bedrock, Vertex, Ollama) — Phase 119+.
- Removal of fork-based code — Phase 118 or 119, ≥1 week post-`native` rollout.
- Advisor metrics dashboard.
- `/verbose` per-agent override (vs per-channel).
- Production deployment (operator-gated; this phase ships source only).
</user_constraints>

<phase_requirements>
## Phase Requirements

Per ROADMAP.md Phase 117 plan list — each `117-XX` plan corresponds to one row. Research findings used by each plan are mapped here.

| Plan ID | Description | Research Support |
|---------|-------------|------------------|
| 117-01 | `src/llm/provider.ts` interface + README | §3 (file map: `src/llm/provider.ts`) |
| 117-02 | `AdvisorService` core, registry, prompts, interfaces | §4.1 (advisor-budget pattern reference for service), §3 (file map: `src/advisor/{service,registry,prompts,types}.ts`) |
| 117-03 | Extract `forkAdvisorConsult()`, wrap as `LegacyForkAdvisor` | §3 (`src/manager/daemon.ts:9805–9866` to extract), §5 (legacy-fork test mocks) |
| 117-04 | `AnthropicSdkAdvisor` + `session-config.ts` `advisorModel` wiring + budget observer | §2.1 (Gate 1 — SDK stream surface), §3 (session-config.ts:1020–1066, session-adapter.ts:1434), §6 pitfall 3 (`advisorModel: undefined` vs omit) |
| 117-05 | `PortableForkAdvisor` scaffold | §3 (file map: `src/advisor/backends/portable-fork.ts`) |
| 117-06 | Config schema (`advisor` block) + loader + defaults | §3 (`src/config/schema.ts:1478` defaultsSchema, `:1218` agent override; `loader.ts:393` resolution pattern) |
| 117-07 | Re-point IPC handler; conditional MCP tool registration | §2.2 (Gate 2 — drop MCP for native), §3 (`src/mcp/server.ts:91`, `:925`) |
| 117-08 | Agent awareness: timing prompt + capability manifest entry | §3 (`src/manager/capability-manifest.ts:54`, `session-config.ts:390`) |
| 117-09 | Discord visibility: 💭 + footer via `advisor:invoked` event | §2.3 (Gate 3 — emit site), §3 (`bridge.ts:740`), §4.6 (reactions helper) |
| 117-10 | Migration cleanup: CLAUDE.md, clawcode.example.yaml, CHANGELOG.md, SUMMARY.md | §3 (docs files) |
| 117-11 | `/verbose` operator Discord slash command | §3 (`slash-types.ts:532` CONTROL_COMMANDS), §4.4 (verbose-state pattern) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Deploy:** `scripts/deploy-clawdy.sh` — never copy bytes ad-hoc. Don't redeploy without explicit "deploy" / "ship it" in same turn. `feedback_no_auto_deploy` and `feedback_ramy_active_no_deploy` still apply.
- **Shim runtime precedent:** Phase 110 Stage 0b feature-flag pattern (`defaults.shimRuntime.{search,image,browser}: "static"`) is the reference for `defaults.advisor.backend`. Loader resolution at `loader.ts:393`: `agent.X?.field ?? defaults.X?.field ?? hardcodedDefault`.
- **Silent path bifurcation warning** (`feedback_silent_path_bifurcation`): before adding code on a path, verify production executes it. Specifically for 117-09: there are THREE delivery exit points in `bridge.ts` (lines 745, 747, 749) — the footer must be applied at a single upstream point.
- **GSD workflow:** Start work through `/gsd-execute-phase` for planned work. No direct edits outside a GSD command.
- **Coding style** (global rules): immutability; many small files (200-400 lines typical, 800 max); validate at boundaries; vitest for tests; ESM-only.

## Executive Summary

Phase 117 brings the Anthropic API `advisor_20260301` beta into ClawCode by replacing the fork-based `ask_advisor` (`daemon.ts:9805-9866` — opus fork + `dispatchTurn` + fork kill) with the Claude Agent SDK's `advisorModel?: string` option (declared at `sdk.d.ts:4930`, runtime-bundled in the SDK's `claude` CLI binary). The SDK binary auto-injects the `advisor-tool-2026-03-01` beta header and the `advisor_20260301` server tool when `advisorModel` is set — **no manual header work is needed** (verified by `strings` on `node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude` finding all four tokens `advisor-tool-2026-03-01`, `advisorModel`, `advisor_20260301`, `advisor_message`).

Three backend slots, two working: `AnthropicSdkAdvisor` (native, default), `LegacyForkAdvisor` (extracted from `daemon.ts:9805` — operator rollback lever), `PortableForkAdvisor` (stub for Phase 118). All call sites talk to a provider-neutral `AdvisorService` interface; the `src/llm/CompletionProvider` interface seeds future non-Anthropic providers without an implementation in this phase.

**Pre-execution gates all resolved in §2.** Gate 1: advisor events surface via `SDKAssistantMessage.message.content[]` (`server_tool_use` blocks with `name: "advisor"`) AND `SDKResultMessage.usage.iterations[]` (entries with `type: "advisor_message"`) — both paths viable. Gate 2: drop MCP `ask_advisor` registration for native-backend agents (recommended; matches Claude Code's autonomous-call UX). Gate 3: emit `advisor:invoked` on the per-assistant-message stream handler at `session-adapter.ts:1434`, which fires before `editor.flush()` resolves in `bridge.ts:738` — footer/reaction land atomically without needing a post-delivery edit fallback.

**Primary recommendation:** Implement plans in the order 117-01 (cheapest, untyped seam) → 117-02 (service core) → 117-03 (legacy backend extract — reduces risk) → 117-06 (config schema — gates 04/07) → 117-04 (native backend with budget observer) → 117-05 (portable scaffold) → 117-07 (IPC + MCP gating) → 117-08 (agent awareness) → 117-09 (Discord visibility) → 117-11 (/verbose slash) → 117-10 (docs cleanup). 117-06 must land before 117-04 and 117-07 because they read `agent.advisor.backend` to resolve dispatch.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Advisor sub-inference (LLM call) | Anthropic API (server-side) | — | The `advisor_20260301` server tool runs as a sub-inference inside the executor's API request; client only sees iteration usage + result blocks. The native backend literally does not call the model itself for advice. |
| Backend dispatch (native vs fork) | ClawCode daemon (manager) | — | `AdvisorService.ask()` resolves backend from config; runs in the manager process. |
| Per-agent daily budget enforcement | ClawCode manager (better-sqlite3 file) | — | Native `max_uses` is per-API-request only; the per-day client cap must remain client-side at `~/.clawcode/manager/advisor-budget.db`. |
| Budget observer / `advisor_message` counting | ClawCode manager (session-adapter stream handler) | — | Runs in the SDK message-iteration callback; tier owns it because the SDK stream is daemon-internal. |
| 💭 reaction + footer + /verbose block | Discord bridge (manager-spawned client) | — | Discord bot manager-side; bridge.ts owns delivery. |
| `/verbose` channel-level state | ClawCode manager (better-sqlite3 file `manager/verbose-state.db`) | — | Channel-scoped, multi-agent; same isolation as AdvisorBudget. |
| Slash command registration | ClawCode manager → Discord REST | — | `CONTROL_COMMANDS` array in `slash-types.ts:532` is the global registration set; per-channel binding enforced at dispatch time. |
| Agent timing-prompt awareness | ClawCode manager (system-prompt assembly) | — | Injected into the cached stable prefix at `session-config.ts:390` (alongside capability manifest). |

## §1. Standard Stack

### Core (verified at this site)
| Library | Version | Purpose | Verified |
|---------|---------|---------|----------|
| @anthropic-ai/claude-agent-sdk | 0.2.132 | Exposes `advisorModel?: string` option (sdk.d.ts:4930). Bundled CLI binary handles beta header injection. | [VERIFIED: `node_modules/@anthropic-ai/claude-agent-sdk/package.json` version, `sdk.d.ts:4930` declaration, `strings` on bundled binary] |
| @anthropic-ai/sdk | (transitive) | Provides the underlying `BetaMessage`, `BetaUsage`, `BetaIterationsUsage`, `BetaAdvisorMessageIterationUsage`, `BetaServerToolUseBlock`, `BetaAdvisorToolResultBlock` type definitions. Imported by the Agent SDK at `sdk.d.ts:1-3`. | [VERIFIED: `node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts`] |
| better-sqlite3 | 12.x | SQLite for `verbose_channels` table (Plan 117-11). Pattern reference: `src/usage/advisor-budget.ts`. | [VERIFIED: in use across codebase, including `advisor-budget.ts:1`] |
| zod | 4.x | Schema validation for new `advisor` config block (Plan 117-06). | [VERIFIED: in use in `src/config/schema.ts`] |
| vitest | (current) | Test framework. | [VERIFIED: `src/usage/advisor-budget.test.ts:1`] |

### Supporting
| Library | Purpose |
|---------|---------|
| discord.js 14.x | Already wired in `src/discord/bridge.ts`; reaction add via `message.react("💭")` (Discord.js Message API) for Plan 117-09. |

### Alternatives Considered
| Instead of | Could Use | Why Not (for 117) |
|------------|-----------|-------------------|
| `advisorModel?` SDK option | Direct `@anthropic-ai/sdk@^0.95.1` advisor API call | Would require extracting agent transcript from SDK-owned session state — that's Phase 118's `PortableForkAdvisor` problem. Native SDK option is zero-extra-context-cost. |
| In-process `advisor:invoked` Node EventEmitter | Filesystem inbox + chokidar | Already in same process (manager owns both session-adapter and Discord bridge); EventEmitter is the idiomatic choice and matches existing patterns (e.g., session-adapter already invokes callbacks like `onAssistantText` synchronously). |
| Composite SQLite db | Separate `verbose-state.db` file | Matches `AdvisorBudget`'s own-file precedent (`manager/advisor-budget.db`) — true isolation, simple backup, no WAL contention with the main fleet metadata db. |

**Installation:** No new dependencies. All required packages already in `package.json`. Verify with:
```bash
node -e "console.log(require('@anthropic-ai/claude-agent-sdk/package.json').version)"
# expect: 0.2.132
```

## §2. Pre-Execution Gate Resolutions

### Gate 1: SDK stream surface for advisor events — RESOLVED

**Question:** How does the Claude Agent SDK 0.2.132 surface advisor invocations in `SdkStreamMessage`? Where can the budget observer parse them?

**Finding:** The agent SDK does NOT redeclare advisor types in its own `sdk.d.ts` — it imports `BetaMessage`, `BetaUsage`, and downstream beta types from `@anthropic-ai/sdk` (see `sdk.d.ts:1-3`):
```typescript
// node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1-3
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs';
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs';
import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs';
```

**Two parse sites are available**, both reachable from the existing session-adapter stream loop:

**Parse site A (PREFERRED): per-assistant-message content blocks** — surfaces ADVISOR INVOCATION as soon as the executor emits the `server_tool_use` block, well BEFORE the terminal `result` event. This is what enables Gate 3 (atomic footer/reaction delivery).

From `sdk.d.ts:2350`:
```typescript
export declare type SDKAssistantMessage = {
    type: 'assistant';
    message: BetaMessage;            // ← .content[] is the parse target
    parent_tool_use_id: string | null;
    error?: SDKAssistantMessageError;
    uuid: UUID;
    session_id: string;
};
```

From `@anthropic-ai/sdk/resources/beta/messages/messages.d.ts:811` — `BetaMessage.content` is `BetaContentBlock[]`, which includes `BetaServerToolUseBlock`:
```typescript
// messages.d.ts:1498
export interface BetaServerToolUseBlock {
    id: string;
    input: { [key: string]: unknown };
    name: 'advisor' | 'web_search' | 'web_fetch' | 'code_execution' | ...;
    type: 'server_tool_use';
    caller?: BetaDirectCaller | BetaServerToolCaller | BetaServerToolCaller20260120;
}
// messages.d.ts:183
export interface BetaAdvisorToolResultBlock {
    content: BetaAdvisorToolResultError | BetaAdvisorResultBlock | BetaAdvisorRedactedResultBlock;
    tool_use_id: string;
    type: 'advisor_tool_result';
}
```

**Parse site B (corroborating, post-turn): `SDKResultMessage.usage.iterations[]`** — counts every advisor iteration that occurred during the turn. Most precise count, but only available AT TERMINAL.

From `sdk.d.ts:3155` and `:3168`:
```typescript
export declare type SDKResultMessage = SDKResultSuccess | SDKResultError;
export declare type SDKResultSuccess = {
    type: 'result';
    subtype: 'success';
    // ...
    usage: NonNullableUsage;        // ← NonNullableUsage = NonNullable<BetaUsage[K]>
    // ...
};
// sdk.d.ts:1110
export declare type NonNullableUsage = {
    [K in keyof BetaUsage]: NonNullable<BetaUsage[K]>;
};
```

From `@anthropic-ai/sdk/resources/beta/messages/messages.d.ts:1256` (`BetaUsage`):
```typescript
iterations: BetaIterationsUsage | null;
// where BetaIterationsUsage = Array<BetaMessageIterationUsage | BetaCompactionIterationUsage | BetaAdvisorMessageIterationUsage>
// messages.d.ts:89
export interface BetaAdvisorMessageIterationUsage {
    cache_creation: BetaCacheCreation | null;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    input_tokens: number;
    model: MessagesAPI.Model;
    output_tokens: number;
    type: 'advisor_message';                   // ← the discriminant we filter on
}
```

**Recommended parse strategy for `session-adapter.ts` budget observer (Plan 117-04):**

1. **Inside the existing `msg.type === "assistant"` branch** (`session-adapter.ts:1434`), in the `for (const raw of contentBlocks)` loop (`:1488`), detect:
   - `block.type === "server_tool_use"` AND `block.name === "advisor"` → emit `advisor:invoked` event AND increment a per-turn `advisorCallCount` local var (resets per turn).
2. **At terminal `result`** (extend `extractUsage` at `session-adapter.ts:1164`), read `msg.usage.iterations` if non-null, filter `entry => entry.type === "advisor_message"`, take `length` — this is the GROUND TRUTH count. If it differs from the per-block tally, prefer the iteration count.
3. Call `advisorBudget.recordCall(agent)` once per iteration (count from step 2).

Source-level excerpt — `session-adapter.ts:1488-1523` (proven extension point):
```typescript
for (const raw of contentBlocks) {
  const block = raw as { type?: string; name?: string; id?: string; text?: string };
  if (block.type === "text" && !firstTokenEnded) {
    firstToken?.end();
    firstTokenEnded = true;
  }
  if (block.type === "text" && typeof block.text === "string") {
    blockTextParts.push(block.text);
  }
  if (block.type === "tool_use" && block.id && block.name) {
    // ... existing tool_call.<name> span emission ...
  }
  // ← NEW for Plan 117-04: server_tool_use advisor detection
  // if (block.type === "server_tool_use" && block.name === "advisor") {
  //   advisorObserver?.onAdvisorBlock({ agent, turn, blockId: block.id });
  // }
}
```

**Confidence:** HIGH. All four advisor tokens (`advisor-tool-2026-03-01`, `advisorModel`, `advisor_20260301`, `advisor_message`) verified present in the SDK's bundled `claude` binary at `node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude`. Beta header injection is server-side, transparent to ClawCode.

### Gate 2: MCP `ask_advisor` registration policy for native-backend agents — RESOLVED

**Question:** Should native-backend agents keep registering the MCP `ask_advisor` tool, or drop it?

**Recommendation: DROP `ask_advisor` MCP registration for native-backend agents** (the plan's path (a)).

**Reasoning:**

1. **Native SDK design.** With `advisorModel` set, the executor's API request carries the `advisor_20260301` server tool. The executor decides autonomously when to call `advisor()` — same UX as Claude Code's native pattern (`~/.claude/CLAUDE.md`'s "Advisor Tool" section is precisely this: the model self-invokes on hard decisions). Re-routing operator-initiated `ask_advisor` MCP calls through the SDK to force an in-session advisor invocation is technically possible but adds complexity (a synthetic user-text injection through the input channel) and degrades the model's strategic timing.

2. **Operator-visible difference is acceptable.** Current state: operator (or another tool) calls `ask_advisor` → fork → opus → answer. New state for native: the agent calls `advisor()` itself when its reasoning indicates value. The agent already has the question loaded as context — it doesn't need an external trigger. For fork-backend agents, the MCP tool keeps working as today (operator rollback path preserved).

3. **No regression.** Operators currently cannot force advisor consultation via Discord (no `/advise` command exists). The MCP tool is only callable from inside an agent's tool loop — which means it was always agent-self-triggered. Dropping the MCP registration for native agents removes a redundant trigger surface, not a primary one.

4. **Implementation simplicity.** Conditional registration in `src/mcp/server.ts:925` based on `resolveAdvisorBackend(agent) === "fork"`. The `ask-advisor` IPC method at `protocol.ts:168` stays — handler at `daemon.ts:9805` now dispatches through `AdvisorService.ask()` regardless of backend, so even native-backend tests calling the IPC directly still work.

**Source-level excerpt — `src/mcp/server.ts:925-952` (the conditional gate point):**
```typescript
// src/mcp/server.ts — current registration (unconditional)
  // Tool: ask_advisor
  server.tool(
    "ask_advisor",
    "Ask opus for advice on a complex decision without switching sessions",
    {
      question: z.string().describe("The question or decision you need advice on"),
      agent: z.string().describe("Your agent name (pass your own name)"),
    },
    async ({ question, agent }) => {
      // ... sendIpcRequest(SOCKET_PATH, "ask-advisor", {...})
    },
  );

// Plan 117-07 transformation — wrap in a conditional:
//   const backend = resolveAdvisorBackend(agentName, config); // "native" | "fork"
//   if (backend === "fork") { server.tool("ask_advisor", ...); }
```

**Path of resolution.** The MCP server is spawned per-agent (separate process per agent in the ClawCode topology). `resolveAdvisorBackend` reads the resolved-agent-config from the env injected at spawn time. If the operator flips `advisor.backend: fork` on an agent and reloads, the agent's MCP server respawns and re-evaluates registration.

**Documented as accepted tradeoff (not a regression):** the native pattern is "executor decides." If operators later want a `/advise <question>` Discord slash command to force-trigger advisor on a native agent, that's a Phase 118+ enhancement — not part of 117 scope.

**Confidence:** HIGH. Recommendation aligns with the plan's authoritative source and Claude Code's upstream UX.

### Gate 3: `advisor:invoked` event emit timing — RESOLVED

**Question:** Where in `session-adapter.ts` does the budget observer emit `advisor:invoked` such that the Discord bridge can append footer + reaction in the SAME delivery as the assistant response — without resorting to a post-delivery edit?

**Finding:** The event MUST fire on the per-assistant-message handler at `session-adapter.ts:1434`, NOT at the terminal `result` event. Here's why this works:

**Delivery pipeline (verified by reading `bridge.ts:670-754`):**
```
discord message arrives → bridge.handleMessage()
  → editor = new ProgressiveMessageEditor({ editFn: (txt) => messageRef.current.edit(txt), ... })
  → response = await turnDispatcher.dispatchStream(origin, agent, msg, (chunk) => editor.update(chunk), ...)
     ↑ this awaits the FULL turn including ALL assistant messages and the terminal result
     ↑ inside dispatchStream, session-adapter.ts:1434 fires on EACH assistant message synchronously
  → editor.flush()  ← line 738
  → if (response.length > 2000) { messageRef.current.delete(); sendResponse(message, response); }      ← line 745
    else if (messageRef.current) { messageRef.current.edit(response); }                                  ← line 747
    else { sendResponse(message, response); }                                                            ← line 749
```

**Why `session-adapter.ts:1434` is the right emit site:**

- It fires DURING the stream, on every assistant message — well BEFORE `dispatchStream` resolves, well BEFORE line 738's `editor.flush()`, well BEFORE the three delivery exits at 745/747/749.
- The event handler can mutate a closure variable (`let didConsultAdvisor = false`) owned by the bridge's call site BEFORE `response` is finalized.
- The footer is appended to `response` between lines 740 and 741, so all THREE delivery exits naturally see the augmented text. Single point of injection.

**Implementation sketch for Plan 117-09 (the closure-variable approach):**

```typescript
// src/discord/bridge.ts — around line 715, BEFORE dispatchStream
let didConsultAdvisor = false;
const advisorListener = (event: AdvisorInvokedEvent) => {
  if (event.agent === sessionName && event.turnId === message.id) {
    didConsultAdvisor = true;
    // Fire the 💭 reaction immediately — async, fire-and-forget; ignore errors
    void message.react("💭").catch(() => {});
  }
};
this.sessionManager.advisorEvents.on("advisor:invoked", advisorListener);
try {
  response = await this.turnDispatcher.dispatchStream(...);
} finally {
  this.sessionManager.advisorEvents.off("advisor:invoked", advisorListener);
}

// AFTER line 740 (response trim check) but BEFORE lines 741/745/747/749:
if (didConsultAdvisor && response && response.trim().length > 0) {
  const level = this.verboseState?.getLevel(message.channelId) ?? "normal";
  if (level === "verbose" && lastAdvisorQA) {
    response += "\n\n```\n> 💭 advisor consulted:\n> Q: " + lastAdvisorQA.q + "\n> A: " + lastAdvisorQA.a.slice(0, 500) + "\n```";
  } else {
    response += "\n\n*— consulted advisor (Opus) before responding*";
  }
}
```

**Emit site in `session-adapter.ts:1434` (Plan 117-04):**

```typescript
// Inside the contentBlocks loop at session-adapter.ts:1488
for (const raw of contentBlocks) {
  const block = raw as { type?: string; name?: string; id?: string; input?: unknown };
  // ... existing text + tool_use handling ...
  if (block.type === "server_tool_use" && block.name === "advisor" && block.id) {
    // Emit on the advisor server-tool-use block — fires BEFORE the assistant's
    // text content is fully streamed to Discord (the streaming.update() loop
    // does throttle, but the event fires synchronously here, ahead of the next
    // editor flush by tens to hundreds of ms — comfortable margin).
    try {
      advisorEvents.emit("advisor:invoked", {
        agent: agentName,
        turnId,
        questionPreview: typeof (block.input as { question?: unknown })?.question === "string"
          ? String((block.input as { question?: string }).question).slice(0, 200)
          : undefined,
      });
    } catch {
      // Observational only — never break the message path.
    }
  }
}
```

**Why we don't need a post-delivery edit fallback:** the plan worried that if iterations were only exposed at `result`, the footer would have to be applied via `messageRef.current.edit(response + footer)` AFTER delivery, leaving a brief window with the bare response. Because `server_tool_use` blocks are visible on per-assistant-message events (verified in §2.1), this fallback is unnecessary. Atomic footer/reaction delivery is the design.

**Confidence:** HIGH. Verified by reading `bridge.ts:670-754` end-to-end and the existing `session-adapter.ts` content-block scan pattern (it already inspects `block.type === "tool_use"` for span emission, so adding a `server_tool_use` branch is the same pattern).

## §3. File-by-File Integration Map

Every file in the LOCKED file layout, plus every file touched per the canonical_refs section of CONTEXT.md. For each: current state + proposed change + plan(s) that touch it.

| File | Current State | Proposed Change | Plan(s) |
|------|---------------|------------------|---------|
| `src/llm/provider.ts` | Does not exist | NEW. Declares `CompletionProvider` interface only. No implementations. | 117-01 |
| `src/llm/README.md` | Does not exist | NEW. Documents the seam: "Future non-Anthropic providers slot here. First consumer: Phase 118 `PortableForkAdvisor`." | 117-01 |
| `src/advisor/types.ts` | Does not exist | NEW. Declares `BackendId`, `AdvisorRequest`, `AdvisorResponse`, `AdvisorService`. | 117-02 |
| `src/advisor/backends/types.ts` | Does not exist | NEW. Declares `AdvisorBackend` interface. | 117-02 |
| `src/advisor/service.ts` | Does not exist | NEW. `class DefaultAdvisorService implements AdvisorService` — calls `budget.canCall`, dispatches to backend via registry, truncates to `ADVISOR_RESPONSE_MAX_LENGTH`, calls `budget.recordCall`. | 117-02 |
| `src/advisor/registry.ts` | Does not exist | NEW. `resolveBackend(agentName, config): BackendId` — reads `agent.advisor?.backend ?? defaults.advisor?.backend ?? "native"`. Returns `AdvisorBackend` instance from a Map<BackendId, AdvisorBackend>. | 117-02 |
| `src/advisor/prompts.ts` | Does not exist | NEW. Ports `buildAdvisorSystemPrompt` from `daemon.ts:9836`. Adds `buildAgentAwarenessBlock()` for Plan 117-08 (timing-prompt + ClawCode addendum). | 117-02, 117-08 |
| `src/advisor/index.ts` | Does not exist | NEW. Public re-exports: `AdvisorService`, `createAdvisorService(deps)`, `BackendId`. | 117-02 |
| `src/advisor/backends/anthropic-sdk.ts` | Does not exist | NEW. `class AnthropicSdkAdvisor implements AdvisorBackend`. The `consult()` method is largely a no-op for native — the SDK runs the advisor in-request once `advisorModel` is set in Options. Budget tracking observed by `session-adapter.ts` budget observer (see Plan 117-04). | 117-04 |
| `src/advisor/backends/legacy-fork.ts` | Does not exist | NEW. `class LegacyForkAdvisor implements AdvisorBackend`. Wraps the extracted `forkAdvisorConsult(manager, args)` function (Plan 117-03). | 117-03 |
| `src/advisor/backends/portable-fork.ts` | Does not exist | NEW SCAFFOLD. `class PortableForkAdvisor implements AdvisorBackend` whose `consult()` throws `Error("PortableForkAdvisor not implemented — see Phase 118")`. Header doc-comment documents Phase 118 follow-up scope (transcript extraction + `CompletionProvider`-based call). | 117-05 |
| `src/advisor/__tests__/` | Does not exist | NEW. Flat directory (matches `src/config/__tests__/` and `src/manager/__tests__/` precedent). Files: `service.test.ts`, `registry.test.ts`, `prompts.test.ts`, `backends/legacy-fork.test.ts`, `backends/anthropic-sdk.test.ts`, `backends/portable-fork.test.ts`. (See §5 for test patterns.) | 117-02..117-05 |
| `src/usage/advisor-budget.ts` | EXISTS, 92 lines, SQLite-backed daily cap | UNCHANGED. The `recordCall(agent)` and `canCall(agent)` methods are reused as-is. | (read-only) |
| `src/usage/verbose-state.ts` | Does not exist | NEW. SQLite-backed channel-level state for `/verbose`. Pattern reference: `advisor-budget.ts`. Methods: `getLevel(channelId)`, `setLevel(channelId, level)`, `getStatus(channelId)`. Backing file: `~/.clawcode/manager/verbose-state.db`. | 117-11 |
| `src/manager/daemon.ts:9805-9866` | EXISTS — the `"ask-advisor"` IPC handler with fork logic inline | EXTRACT lines 9810-9865 into `forkAdvisorConsult(manager, args)` (Plan 117-03). Re-point the IPC handler to call `advisorService.ask({agent, question})` regardless of backend (Plan 117-07). | 117-03, 117-07 |
| `src/manager/session-config.ts:1022` | EXISTS — SDK Options object construction returned at line 1020-1066 | ADD `advisorModel: resolveAdvisorModel(config)` to the returned object via spread-conditional (same idiom as the existing settingSources/gsd/debug spreads at :1038-1057). When budget exhausted today, omit the field entirely. | 117-04, 117-06 |
| `src/manager/session-config.ts:390` | EXISTS — `buildCapabilityManifest(config)` call site for capability manifest injection | UNCHANGED structurally. The advisor timing-prompt block is added INSIDE `buildCapabilityManifest` (manifest grows by ~10 lines) OR appended at this site after `capabilityManifest` if Claude's discretion picks the latter (recommended: inside the manifest function — simpler test boundary). | 117-08 |
| `src/manager/session-adapter.ts:1434` | EXISTS — per-assistant-message handler that scans `contentBlocks` for text + tool_use blocks | ADD a new branch inside the `for (const raw of contentBlocks)` loop at line 1488: detect `block.type === "server_tool_use" && block.name === "advisor"`. Emit `advisor:invoked` event. Increment per-turn advisor counter. | 117-04, 117-09 |
| `src/manager/session-adapter.ts:1164` | EXISTS — `extractUsage` fires on `result` events | EXTEND to read `msg.usage.iterations`, filter `entry.type === "advisor_message"`, call `advisorBudget.recordCall(agent)` once per iteration. This is the ground-truth count; the per-block tally in :1488 is the early-fire signal for Discord visibility. | 117-04 |
| `src/manager/capability-manifest.ts:54` | EXISTS — `buildCapabilityManifest(config)` returns a markdown block listing enabled features | INJECT a new bullet/section AFTER the existing bullets and BEFORE the "Memory protocol" prose block (line 224): `## Advisor protocol` + `### When to consult the advisor` (canonical timing-prompt text from `~/.claude/CLAUDE.md`'s Advisor Tool section). Gated on `resolveAdvisorBackend(config) !== undefined` (always true post-117-06 since `defaults.advisor.backend: native` is the new default — but the gate exists for future operators who explicitly disable advisor). | 117-08 |
| `src/manager/capability-probes.ts` | EXISTS — MCP server liveness probes (NOT a capability declaration registry) | NO CHANGE. The plan/context referenced this file but the file is for MCP probe registration, not feature capability declaration. Feature capability declaration lives in `capability-manifest.ts` (above). **Documentation correction: the canonical reference to `capability-probes.ts` in CONTEXT.md line 111 is misdirected — that file is unrelated to feature awareness.** | (none — clarification only) |
| `src/manager/context-assembler.ts` | EXISTS — assembles system prompt; renders `identityCapabilityManifest` at line 747-748 | NO CHANGE. Receives the augmented `identityCapabilityManifest` string verbatim from `session-config.ts:390-393` (post-117-08); the assembler is downstream of the injection. | (none — downstream of 117-08) |
| `src/mcp/server.ts:91` (tool def) | EXISTS — `ask_advisor: { description, ipcMethod }` entry in the tool-defs object | NO CHANGE to the entry shape — description, ipcMethod stay. | (none) |
| `src/mcp/server.ts:925-952` | EXISTS — `server.tool("ask_advisor", ...)` registration | WRAP in conditional: `if (resolveAdvisorBackend(agentName) === "fork") { server.tool(...); }`. Native-backend agents skip registration entirely. | 117-07 |
| `src/ipc/protocol.ts:168` | EXISTS — `"ask-advisor"` IPC method name in METHODS array | UNCHANGED. Method name preserved; handler dispatch changes. | (none) |
| `src/config/schema.ts:1478` (`defaultsSchema`) | EXISTS — fleet-wide defaults zod schema | ADD `advisor` block (optional): `{ backend: z.enum(["native","fork"]).default("native"), model: z.string().default("opus"), maxUsesPerRequest: z.number().int().min(1).max(10).default(3), caching: z.object({ enabled: z.boolean().default(true), ttl: z.enum(["5m","1h"]).default("5m") }).optional() }`. Reject `"portable-fork"` explicitly (enum exclusion). | 117-06 |
| `src/config/schema.ts:1218+` (agent config schema) | EXISTS — per-agent override schema (e.g., `shimRuntime` at :1243) | ADD per-agent `advisor` override (optional, all fields optional, same shape as defaults). Pattern matches `shimRuntime` at :1243-1249. | 117-06 |
| `src/config/schema.ts:738` (non-idempotent flag for ask_advisor) | EXISTS — `ask_advisor` listed as non-cacheable | UNCHANGED. | (none) |
| `src/config/loader.ts:294` | EXISTS — non-idempotent caching note for ask_advisor | UNCHANGED. | (none) |
| `src/config/loader.ts:393` (`resolveRuntime` fall-through pattern) | EXISTS — `agent.X?.[type] ?? defaults.X?.[type] ?? "node"` | ADD parallel `resolveAdvisorBackend(agent, defaults) = agent.advisor?.backend ?? defaults.advisor?.backend ?? "native"` and similar resolvers for `model`, `maxUsesPerRequest`, `caching`. | 117-06 |
| `src/discord/reactions.ts` | EXISTS, 32 lines — defines `ReactionEvent` type + `formatReactionEvent` for INBOUND reactions only | EXTEND. The plan's claim "reaction sender helper if missing" is correct — there is NO helper for ADDING reactions in this file. Plan 117-09 adds `export async function addReaction(message: Message, emoji: string): Promise<void>` calling `message.react(emoji)` (discord.js Message API). Single-line implementation with try/catch wrapper. | 117-09 |
| `src/discord/bridge.ts:715-754` | EXISTS — main message handler with `dispatchStream` + footer/finalization | INSTRUMENT (a) register `advisor:invoked` listener BEFORE `dispatchStream` (line 715), (b) on event: set `didConsultAdvisor = true` + call `addReaction(message, "💭")`, (c) AFTER `dispatchStream` resolves (line 738 area) BEFORE the three delivery exits (lines 745/747/749): augment `response` with footer or verbose block based on `didConsultAdvisor` + verbose-state lookup. SINGLE injection point — silent path bifurcation prevented. | 117-09, 117-11 |
| `src/discord/bridge.ts:1071-1128` (`sendResponse` + `sendDirect`) | EXISTS | NO CHANGE — augmentation happens upstream so all delivery branches inherit the augmented `response` string. | (none) |
| `src/discord/streaming.ts` | EXISTS — `ProgressiveMessageEditor` for chunked Discord edits | NO CHANGE — editor mutates the typing-indicator message in-place via `editFn`. The final edit/send carries the augmented `response`. | (none) |
| `src/discord/slash-types.ts:532` (`CONTROL_COMMANDS`) | EXISTS — global control-command list | ADD `clawcode-verbose` entry (subcommands: `on`, `off`, `status`). All control commands are registered globally per `slash-commands.ts:1124-1130` (not per-agent), so the global registration path applies. | 117-11 |
| `src/discord/slash-commands.ts:1461-1465` (control dispatch) | EXISTS — `handleControlCommand` branch | EXTEND `handleControlCommand` to recognize `clawcode-verbose` with subcommand routing. State persistence via new `VerboseState` (see verbose-state.ts row above). Reply with ephemeral `MessageBuilder`. | 117-11 |
| `src/manager/escalation.ts` | EXISTS — error-escalation logic with fork-to-opus pattern | NO CHANGE. Separate cost/effort concern explicitly out of scope (CONTEXT.md). | (none) |
| `clawcode.example.yaml` | EXISTS — example config | ADD `defaults.advisor: { backend: native, model: opus, maxUsesPerRequest: 3, caching: { enabled: true, ttl: 5m } }` block as commented-out example. Also document per-agent override. | 117-10 |
| `CLAUDE.md` (project) | EXISTS | ADD "Advisor pattern" section documenting backend resolution, rollback procedure (`agent.advisor.backend: fork` + `clawcode reload`), `/verbose` slash command. | 117-10 |
| `CHANGELOG.md` | EXISTS (presumably) | ADD entry for Phase 117 — multi-backend advisor scaffold + Discord visibility + /verbose. | 117-10 |
| `.planning/phases/117-*/SUMMARY.md` | Does not exist yet | NEW (Plan 117-10 close-out). | 117-10 |

## §4. Pattern References

### §4.1 SQLite-backed channel state (`src/usage/verbose-state.ts` — Plan 117-11)

Reference: `src/usage/advisor-budget.ts` (92 lines, end-to-end verified). The new `VerboseState` class MUST follow this shape exactly:

```typescript
// src/usage/verbose-state.ts (NEW — Plan 117-11)
import type { Database as DatabaseType, Statement } from "better-sqlite3";

export type VerboseLevel = "normal" | "verbose";
export type VerboseStatus = {
  readonly channelId: string;
  readonly level: VerboseLevel;
  readonly updatedAt: string; // ISO 8601
};

type Statements = {
  readonly getRow: Statement;
  readonly upsert: Statement;
};

type Row = {
  readonly channel_id: string;
  readonly level: string;
  readonly updated_at: string;
};

export class VerboseState {
  private readonly stmts: Statements;

  constructor(db: DatabaseType) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS verbose_channels (
        channel_id TEXT PRIMARY KEY,
        level TEXT NOT NULL DEFAULT 'normal',
        updated_at TEXT NOT NULL
      );
    `);
    this.stmts = {
      getRow: db.prepare(
        "SELECT channel_id, level, updated_at FROM verbose_channels WHERE channel_id = ?",
      ),
      upsert: db.prepare(`
        INSERT INTO verbose_channels (channel_id, level, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT (channel_id) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at
      `),
    };
  }

  getLevel(channelId: string): VerboseLevel {
    const row = this.stmts.getRow.get(channelId) as Row | undefined;
    if (!row) return "normal";
    return row.level === "verbose" ? "verbose" : "normal";
  }

  setLevel(channelId: string, level: VerboseLevel): void {
    this.stmts.upsert.run(channelId, level, new Date().toISOString());
  }

  getStatus(channelId: string): VerboseStatus {
    const row = this.stmts.getRow.get(channelId) as Row | undefined;
    if (!row) {
      return { channelId, level: "normal", updatedAt: "(never set — using default)" };
    }
    return {
      channelId: row.channel_id,
      level: row.level === "verbose" ? "verbose" : "normal",
      updatedAt: row.updated_at,
    };
  }
}
```

**Backing file:** `~/.clawcode/manager/verbose-state.db` — match `AdvisorBudget`'s own-file precedent (`manager/advisor-budget.db`). Daemon boot constructs the `Database` instance, passes it to `new VerboseState(db)`, wires the resulting instance into the Discord bridge constructor.

### §4.2 Slash command registration — `/verbose` (Plan 117-11)

**Decision: GLOBAL registration in `CONTROL_COMMANDS`** (not per-agent in `clawcode.yaml`).

Reasoning verified from `src/discord/slash-commands.ts:1124-1130`:

```typescript
// src/discord/slash-commands.ts:1124-1130 — global control-command merge
      // Add control commands (daemon-direct, not agent-routed)
      for (const cmd of CONTROL_COMMANDS) {
        if (!seenNames.has(cmd.name)) {
          seenNames.add(cmd.name);
          allCommands.push(cmd);
        }
      }
```

All entries in `CONTROL_COMMANDS` are registered to every guild and dispatch through `handleControlCommand`. This is the right home for `/verbose` because:

1. **Operator-level command, not agent-specific.** `/verbose` toggles channel-level visibility — orthogonal to agent identity. Per-agent registration would require declaring it in every agent's yaml, multiplying source-of-truth.
2. **Matches existing pattern.** `/clawcode-tools`, `/clawcode-fleet`, `/clawcode-dream` are all global control commands.
3. **No yaml churn.** Operators do not need to opt-in agent-by-agent.

**Entry to add at `src/discord/slash-types.ts:532+` (CONTROL_COMMANDS):**

```typescript
// (subcommand approach — three sub-routes under one top-level command, type=1 SUB_COMMAND)
{
  name: "clawcode-verbose",
  description: "Toggle inline advisor visibility for this channel (on | off | status)",
  claudeCommand: "",
  control: true,
  ipcMethod: "set-verbose-level", // NEW IPC method — daemon-side handler routes to VerboseState
  options: [
    {
      name: "level",
      type: 3, // STRING
      description: "verbose level for this channel",
      required: true,
      choices: [
        { name: "on (inline advisor Q+A)", value: "on" },
        { name: "off (footer + reaction only)", value: "off" },
        { name: "status (report current setting)", value: "status" },
      ],
    },
  ],
  defaultMemberPermissions: "0", // hide from non-admin per the Phase 100 pattern (CONTEXT.md note: operator-level)
},
```

Note: the existing CONTROL_COMMANDS dispatch already accepts `ipcMethod: "<name>"` and routes via `sendIpcRequest`. The new IPC method `set-verbose-level` handler lives in `daemon.ts`'s IPC switch (next to `ask-advisor`).

### §4.3 Capability manifest entry for `advisor` (Plan 117-08)

Reference: `src/manager/capability-manifest.ts:54-232` (end-to-end verified). The function appends bullets in order, then conditionally appends a "Memory protocol" prose block. We add:

1. **A bullet inside the bullets list** — slotted between bullet 6 (GSD) and bullet 7 (File access), e.g., position ~134 in the existing file:
```typescript
  // ---- 6.5. Advisor (Phase 117) ----
  // Always rendered when advisor is enabled (which is the new fleet default).
  // Gate on resolveAdvisorBackend(config) so future agents that explicitly
  // disable advisor (e.g., low-stakes test agents) don't carry the bullet.
  const advisorBackend = config.advisor?.backend ?? "native"; // (post-117-06 schema)
  if (advisorBackend === "native" || advisorBackend === "fork") {
    bullets.push(
      `- **Advisor (Opus)**: \`advisor()\` server-tool available for hard decisions${advisorBackend === "fork" ? " (legacy fork backend — operator rollback path)" : ""}. Budget: ${config.advisor?.budget?.dailyMax ?? 10} calls/day per agent. Consultations are visible in Discord (💭 reaction + footer).`,
    );
  }
```

2. **A prose protocol block** after the "Memory protocol" block (line ~225), e.g.:
```typescript
  const advisorProtocol =
    "\n## Advisor protocol (Phase 117)\n\n" +
    "Call advisor BEFORE substantive work — before writing, before committing to an interpretation, before building on an assumption. " +
    "If a task requires orientation first (finding files, fetching a source, seeing what's there), do that, then call advisor. " +
    "Orientation is not substantive work. Writing, editing, and declaring an answer are.\n\n" +
    "Also call advisor: when you believe the task is complete; when stuck (errors recurring, approach not converging); when considering a change of approach. " +
    "Give advice serious weight — but if an empirical step fails or primary-source evidence contradicts a specific claim, adapt.\n\n" +
    "Advisor consultations are visible in your Discord channel: a 💭 reaction on the triggering message and a `— consulted advisor (Opus) before responding` footer on your reply. " +
    "For tasks that need operator-watchable execution (multi-step exploration, code review, long research), use the `spawn_subagent_thread` skill instead — that creates a visible sidebar thread.\n";

  return header + bullets.join("\n") + memoryProtocol + advisorProtocol;
```

The canonical timing-prompt wording above is adapted from `~/.claude/CLAUDE.md`'s "Advisor Tool" section (the operator's instruction set, which is the source of truth per CONTEXT.md's Claude's Discretion note).

### §4.4 Context assembler injection point (Plan 117-08)

**No change to `context-assembler.ts` itself.** The capability manifest is injected into the system prompt at `src/manager/session-config.ts:390-393`:

```typescript
// src/manager/session-config.ts:382-393 — current injection point
  // Phase 100 follow-up — capability manifest (after identity, before
  // MEMORY.md auto-load and MCP block). Sits in the cached stable prefix
  // so the LLM has its enabled-feature list in context every turn
  // without paying re-render cost.
  const capabilityManifest = buildCapabilityManifest(config);
  if (capabilityManifest.length > 0) {
    identityCapabilityManifest += "\n" + capabilityManifest;
  }
```

The augmented manifest (with advisor protocol added inside `buildCapabilityManifest`) flows through `identityCapabilityManifest` → `composeCarvedIdentity(sources)` at `context-assembler.ts:747-748`:

```typescript
// src/manager/context-assembler.ts:741-756 — assembler consumes the manifest verbatim
function composeCarvedIdentity(sources: ContextSources): string {
  const parts: string[] = [];
  const soulFp = sources.identitySoulFingerprint ?? "";
  if (soulFp) parts.push(soulFp + "\n");
  const idFile = sources.identityFile ?? "";
  if (idFile) parts.push(idFile);
  const capManifest = sources.identityCapabilityManifest ?? "";
  if (capManifest) parts.push(capManifest);            // ← rendered here, unchanged
  const memoryAutoload = sources.identityMemoryAutoload ?? "";
  if (memoryAutoload) {
    parts.push("\n## Long-term memory (MEMORY.md)\n\n" + memoryAutoload + "\n");
  }
  return parts.join("");
}
```

**Result:** the advisor protocol block sits in the cached stable prefix and pays prompt cost ONCE per session boot, not per turn. Matches the existing Memory protocol cost profile.

### §4.5 Discord bridge augmentation (Plan 117-09 + 117-11)

The bridge delivery flow at `src/discord/bridge.ts:715-754` — exact code in §2.3 above. Critical bifurcation note (re: `feedback_silent_path_bifurcation`):

**THREE delivery exits at lines 745, 747, 749:**
- 745: `sendResponse(message, response, sessionName)` when `response.length > 2000` AND `messageRef.current` exists (deletes the typing indicator first)
- 747: `messageRef.current.edit(response)` when `response.length ≤ 2000` AND `messageRef.current` exists (in-place edit of the typing indicator)
- 749: `sendResponse(message, response, sessionName)` when `messageRef.current` does NOT exist (fallback)

**Plus** in-flight streaming via `editor.update(accumulated)` (line 723) → `editor.flush()` (line 738). The flush forces the editor to write the FINAL `accumulated` value before line 740's `response` evaluation.

**Augmentation strategy (Plan 117-09):** mutate the `response` string variable AT LINE 739 (between the `editor.flush()` and the `if (response && response.trim().length > 0)` at line 740). Because `response` is a `let`-bound local that all three exits read, augmenting once propagates to all paths.

```typescript
// src/discord/bridge.ts — PROPOSED MUTATION POINT around line 739
      clearInterval(typingInterval);
      typingInterval = undefined;
      await editor.flush();

      // (NEW Plan 117-09 / 117-11) — augment response with advisor visibility
      if (didConsultAdvisor && response && response.trim().length > 0) {
        const level = this.verboseState?.getLevel(channelId) ?? "normal";
        if (level === "verbose" && lastAdvisorContext) {
          response = `${response}\n\n\`\`\`\n💭 advisor consulted\nQ: ${lastAdvisorContext.questionPreview ?? "(autonomous)"}\nA: ${(lastAdvisorContext.answer ?? "").slice(0, 500)}\n\`\`\``;
        } else {
          response = `${response}\n\n*— consulted advisor (Opus) before responding*`;
        }
      }

      if (response && response.trim().length > 0) {
        // ... existing lines 741-754 unchanged — three exits all see the augmented response ...
      }
```

Note on streaming: the partial chunks delivered by `editor.update()` during streaming do NOT carry the footer — only the final pre-`sendResponse`/`edit` write does. This is correct: the footer reflects a turn-level fact (advisor was consulted at some point), not a chunk-level one. If the operator briefly sees the bare response during streaming, the final flush replaces it with the footer-augmented version inside the editor's serialization lock (`streaming.ts:113` — the `inFlight` chain).

### §4.6 Reactions helper (Plan 117-09)

`src/discord/reactions.ts` currently has NO add-reaction helper — only `formatReactionEvent` for INBOUND reactions. Plan 117-09 adds:

```typescript
// src/discord/reactions.ts — ADD
import type { Message } from "discord.js";

/**
 * Add a reaction to a Discord message. Failures are logged but never thrown
 * (matches the codebase's "observational hooks must not break the message path"
 * invariant — see session-adapter.ts:1422 try/catch precedent).
 */
export async function addReaction(message: Message, emoji: string): Promise<void> {
  try {
    await message.react(emoji);
  } catch {
    // Non-fatal: the reaction is decorative; delivery is what matters.
  }
}
```

The discord.js Message API: `message.react(unicodeOrCustomEmoji: string | EmojiResolvable): Promise<MessageReaction>`. Unicode `"💭"` is a `string`-typed valid input. [CITED: discord.js v14 Message documentation https://discord.js.org/docs/packages/discord.js/14.x/Message:Class#react]

## §5. Test Strategy Per Plan

### Test framework
| Property | Value |
|----------|-------|
| Framework | vitest |
| Quick run command | `npm test -- src/advisor/` |
| Full suite command | `npm test` |
| Pattern reference | `src/usage/advisor-budget.test.ts` (in-memory `Database(":memory:")`); `src/manager/escalation.test.ts` (mock SessionManager with `vi.fn()`) |

### Plan 117-01 — `src/llm/provider.ts`
- **Test type:** typecheck only.
- **Verify command:** `npm run build` (TypeScript compile-time check).
- **Wave 0 gaps:** none.

### Plan 117-02 — `AdvisorService`, registry, prompts
- **Files:** `src/advisor/__tests__/service.test.ts`, `registry.test.ts`, `prompts.test.ts`.
- **Mocks:** in-memory `better-sqlite3` for `AdvisorBudget`; mock `AdvisorBackend` via `{ id: "fork", consult: vi.fn().mockResolvedValue({ answer: "X" }) }`.
- **Cases:**
  - `service.test.ts` — budget exhaustion throws (`budget.canCall === false`); truncation at 2000 chars (string of 2500 ASCII); backend dispatch (mock both backends, assert correct one called); `recordCall` fires on success only.
  - `registry.test.ts` — default backend honored when no override; per-agent override resolves; `"portable-fork"` rejected by registry (returns "not selectable" error or falls back to default).
  - `prompts.test.ts` — `buildAdvisorSystemPrompt(agent, memoryContext)` snapshot (parity test before/after extraction from daemon.ts).

### Plan 117-03 — `forkAdvisorConsult()` extraction + `LegacyForkAdvisor`
- **Files:** `src/advisor/backends/__tests__/legacy-fork.test.ts`.
- **Mocks:** mock `SessionManager` per the `escalation.test.ts` pattern at lines 6-16:
  ```typescript
  const mockManager = {
    forkSession: vi.fn().mockResolvedValue({ forkName: "agent-fork-abc", parentAgent: "agent", sessionId: "sess-1" }),
    dispatchTurn: vi.fn().mockResolvedValue("advice text"),
    stopAgent: vi.fn().mockResolvedValue(undefined),
    getMemoryStore: vi.fn().mockReturnValue(null),
    getEmbedder: vi.fn(),
  } as unknown as SessionManager;
  ```
- **Cases:** parity test — extracted `forkAdvisorConsult(mockManager, {agent, question, systemPrompt, advisorModel: "opus"})` returns same `{ answer }` as the existing daemon handler would; `forkSession`/`dispatchTurn`/`stopAgent` called with identical args.
- **Regression risk:** the existing `daemon.ts:9810-9866` body has a `try/finally` that ALWAYS calls `stopAgent` — the extraction must preserve this. Add an explicit case: `dispatchTurn` throws → `stopAgent` still called.

### Plan 117-04 — `AnthropicSdkAdvisor` + budget observer
- **Files:** `src/advisor/backends/__tests__/anthropic-sdk.test.ts`, `src/manager/__tests__/session-adapter-advisor-observer.test.ts`.
- **Mocks:** mocked `SdkStreamMessage` sequence. **REQUIRED FIXTURE** (Plan 117-04):

```typescript
// fixture: representative SdkStreamMessage stream with an advisor invocation
const mockStream: SdkStreamMessage[] = [
  {
    type: "assistant",
    parent_tool_use_id: null,
    uuid: "msg-1",
    session_id: "sess-1",
    message: {
      // BetaMessage shape — see @anthropic-ai/sdk messages.d.ts
      id: "m_01",
      type: "message",
      role: "assistant",
      content: [
        { type: "text", text: "Let me think about this." },
        {
          type: "server_tool_use",       // ← the advisor invocation signal
          id: "su_01",
          name: "advisor",
          input: { question: "Should I refactor this module first?" },
        },
        {
          type: "advisor_tool_result",   // ← advisor returned in same assistant message
          tool_use_id: "su_01",
          content: { type: "advisor_result", text: "Refactor first — the API surface change is small." },
        },
        { type: "text", text: "Per the advisor, I'll refactor first." },
      ],
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { /* per-message usage shape */ },
    },
  } as unknown as SdkStreamMessage,
  {
    type: "result",
    subtype: "success",
    duration_ms: 12000,
    duration_api_ms: 11500,
    is_error: false,
    num_turns: 1,
    result: "Per the advisor, I'll refactor first.",
    stop_reason: "end_turn",
    total_cost_usd: 0.42,
    usage: {
      input_tokens: 1500,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 /* etc. */ },
      iterations: [
        { type: "message", input_tokens: 1500, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null },
        {
          type: "advisor_message",                                // ← what the budget observer counts
          model: "claude-opus-4-1-20250805",
          input_tokens: 800,
          output_tokens: 100,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation: null,
        },
        { type: "message", input_tokens: 1700, output_tokens: 150, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null },
      ],
    },
    modelUsage: { /* per-model breakdown */ },
    permission_denials: [],
    errors: [],
    uuid: "result-1",
    session_id: "sess-1",
  } as unknown as SdkStreamMessage,
];
```

- **Cases:**
  - Iteration parser: filter `iterations.filter(e => e.type === "advisor_message")` → length 1 → `recordCall` fires once.
  - Two advisor iterations in one turn → `recordCall` fires twice.
  - `iterations: null` → no calls recorded (graceful degradation).
  - Server-tool-use block scanner: a `server_tool_use` with `name === "advisor"` triggers `advisor:invoked` event emit; non-advisor server tools (`web_search`) do NOT.
  - Budget exhausted: `AdvisorBudget.canCall` returns false → on next session reload, `Options.advisorModel` is omitted via spread-conditional.

### Plan 117-05 — `PortableForkAdvisor` scaffold
- **File:** `src/advisor/backends/__tests__/portable-fork.test.ts`.
- **Case:** `await expect(portable.consult({agent, question, systemPrompt, advisorModel: "opus"})).rejects.toThrow(/PortableForkAdvisor not implemented/i);`

### Plan 117-06 — Config schema + loader
- **Files:** `src/config/__tests__/schema-advisor.test.ts`, `src/config/__tests__/loader-advisor.test.ts`.
- **Cases:**
  - Schema accepts `defaults.advisor.backend: "native"`; accepts `"fork"`; REJECTS `"portable-fork"`.
  - Per-agent override at `agents[0].advisor.backend: "fork"` overrides defaults.
  - Loader resolution: `resolveAdvisorBackend(agent, defaults)` returns per-agent value when set, else defaults, else `"native"`.
  - YAML round-trip: write a config with advisor block, read back, deep-equal.

### Plan 117-07 — IPC handler re-point + MCP conditional registration
- **Files:** `src/manager/__tests__/daemon-ask-advisor-dispatch.test.ts`, extend `src/mcp/server.test.ts`.
- **Cases:**
  - IPC `ask-advisor` for a native-backend agent → `advisorService.ask({agent, question})` called → returns `{answer, budget_remaining}` with backend === "native".
  - IPC `ask-advisor` for a fork-backend agent → same call → returns `{answer, budget_remaining}` with backend === "fork".
  - MCP `ask_advisor` tool: when `resolveAdvisorBackend === "native"`, `server.tool` is NOT called; when `=== "fork"`, `server.tool` IS called.

### Plan 117-08 — Agent awareness
- **Files:** extend `src/manager/__tests__/capability-manifest.test.ts`.
- **Cases:**
  - Snapshot test: `buildCapabilityManifest(configWithAdvisorNative)` includes the "Advisor protocol" section.
  - Snapshot test: `buildCapabilityManifest(configWithAdvisorDisabled)` does NOT include the section. (Note: in 117-scope, advisor is always enabled by default — this test guards against future operator-disable flag.)

### Plan 117-09 — Discord visibility
- **Files:** `src/discord/__tests__/bridge-advisor-footer.test.ts`.
- **Mocks:** mock `turnDispatcher.dispatchStream` to invoke a passed `onChunk` AND emit `advisor:invoked` synchronously via an injected EventEmitter; mock `Message` with `react: vi.fn().mockResolvedValue(undefined)`.
- **Cases:**
  - Turn that triggers advisor → reaction added; footer appended.
  - Turn that does NOT trigger advisor → no reaction; no footer.
  - Long response (>2000 chars) → footer appended; `sendResponse` path used (delete + send).
  - Verbose mode ON (channel level "verbose") → Q+A block appended instead of footer.

### Plan 117-10 — Docs cleanup
- **Files:** none.
- **Verify:** manual smoke per CONTEXT.md verification anchors:
  - `test-agent` autoStart=false; bring up manually.
  - Channel `1491623782807244880`: test advisor trigger; observe 💭 + footer.
  - Flip `agents[test-agent].advisor.backend: fork`, `clawcode reload`, repeat — confirm `forkSession` log returns + visibility still works.

### Plan 117-11 — `/verbose` slash command
- **Files:** `src/usage/__tests__/verbose-state.test.ts`, `src/discord/__tests__/slash-verbose-command.test.ts`.
- **Cases:**
  - `verbose-state.test.ts` (pattern: `advisor-budget.test.ts`): in-memory DB; `getLevel(channelId)` default `"normal"`; `setLevel(channelId, "verbose")`; round-trip; per-channel isolation; `getStatus` returns timestamps.
  - `slash-verbose-command.test.ts`: dispatch `/clawcode-verbose level:on` → IPC `set-verbose-level` called; reply ephemeral "verbose ON for this channel"; `getLevel` returns `"verbose"` after.

### Phase Requirements → Test Map (Nyquist)

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| 117-01 | LLM provider interface compiles | typecheck | `npm run build` | ❌ Wave 0 |
| 117-02 | Service budget + truncation + dispatch | unit | `npm test -- src/advisor/__tests__/service.test.ts` | ❌ Wave 0 |
| 117-02 | Registry resolves per-agent / defaults | unit | `npm test -- src/advisor/__tests__/registry.test.ts` | ❌ Wave 0 |
| 117-03 | Legacy fork backend behavioral parity | unit | `npm test -- src/advisor/backends/__tests__/legacy-fork.test.ts` | ❌ Wave 0 |
| 117-04 | Iterations parser + advisor:invoked emit | unit | `npm test -- src/advisor/backends/__tests__/anthropic-sdk.test.ts` | ❌ Wave 0 |
| 117-04 | Session-adapter observer hook | unit | `npm test -- src/manager/__tests__/session-adapter-advisor-observer.test.ts` | ❌ Wave 0 |
| 117-05 | Portable-fork throws documented error | unit | `npm test -- src/advisor/backends/__tests__/portable-fork.test.ts` | ❌ Wave 0 |
| 117-06 | Schema accepts native/fork; rejects portable-fork | unit | `npm test -- src/config/__tests__/schema-advisor.test.ts` | ❌ Wave 0 |
| 117-06 | Loader fall-through | unit | `npm test -- src/config/__tests__/loader-advisor.test.ts` | ❌ Wave 0 |
| 117-07 | IPC dispatch + MCP conditional | unit | `npm test -- src/manager/__tests__/daemon-ask-advisor-dispatch.test.ts` | ❌ Wave 0 |
| 117-08 | Capability manifest includes advisor block | unit/snapshot | `npm test -- src/manager/__tests__/capability-manifest.test.ts` | ✅ extend existing |
| 117-09 | Discord footer + reaction | unit | `npm test -- src/discord/__tests__/bridge-advisor-footer.test.ts` | ❌ Wave 0 |
| 117-10 | (docs) | manual | smoke on `test-agent` channel `1491623782807244880` | n/a |
| 117-11 | /verbose state CRUD | unit | `npm test -- src/usage/__tests__/verbose-state.test.ts` | ❌ Wave 0 |
| 117-11 | /verbose slash dispatch | unit | `npm test -- src/discord/__tests__/slash-verbose-command.test.ts` | ❌ Wave 0 |

**Sampling rate:**
- **Per task commit:** `npm test -- <related test file>`
- **Per wave merge:** `npm test -- src/advisor/ src/usage/ src/discord/ src/config/ src/manager/`
- **Phase gate:** `npm test` (full suite) green before `/gsd-verify-work`

**Wave 0 gaps:** all listed test files are NEW except `capability-manifest.test.ts` (extend existing).

## §6. Pitfalls + Mitigations

### Pitfall 1: Silent path bifurcation in Discord delivery (Plan 117-09)
**What goes wrong:** Augmenting `response` at one of the three delivery exits (745/747/749) misses the other two — operators see footer on long responses but not short ones (or vice versa). Reproduces the `feedback_silent_path_bifurcation` failure mode.
**Why it happens:** `sendResponse` and `messageRef.current.edit` and the second `sendResponse` are three separate call sites that all consume the same `response` local.
**How to avoid:** Mutate `response` at LINE 739 — between `editor.flush()` and the `if (response && response.trim().length > 0)` check at line 740. Single mutation, all three exits see it. Verify with a unit test that exercises ALL THREE delivery paths.
**Warning signs:** Multiple `response` mutations in different branches; conditional footer logic inside `sendResponse` itself.

### Pitfall 2: Beta header injection misunderstanding
**What goes wrong:** Implementer assumes ClawCode must manually inject `advisor-tool-2026-03-01` header on every SDK call.
**Why it doesn't happen:** Confirmed via `strings` on the bundled `claude` binary at `node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude` — all four tokens `advisor-tool-2026-03-01`, `advisorModel`, `advisor_20260301`, `advisor_message` are present. The SDK CLI handles beta header negotiation server-side when `advisorModel` is set in Options. Verified at `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` has ZERO occurrences of `advisor` (the runtime JS is a thin wrapper that forwards to the bundled binary).
**Mitigation:** Document this in Plan 117-04 implementation notes. Add a sanity-test that `Options.advisorModel = "opus"` is sufficient — no `betas: [...]` array needs to be passed.

### Pitfall 3: `advisorModel: undefined` vs field omission for budget-exhausted state
**What goes wrong:** When `AdvisorBudget.canCall(agent) === false`, the implementer sets `advisorModel: undefined`. TypeScript's structural type system treats `{advisorModel: undefined}` and `{}` (omission) as different shapes; the SDK's runtime forwarding may treat them differently (one may pass an explicit `null` to the CLI, the other passes nothing).
**Why it happens:** The existing session-config.ts pattern at lines 1038-1057 uses SPREAD-CONDITIONAL idiom (`...(config.settingSources ? { settingSources: config.settingSources } : {})`) precisely for this reason — preserves byte-stable equality and avoids implicit-undefined surprises.
**Mitigation:** Use spread-conditional for `advisorModel` (Plan 117-04):
```typescript
// src/manager/session-config.ts:1020-1066 modification
return {
  name: config.name,
  // ... existing fields ...
  ...(shouldEnableAdvisor(config, advisorBudget) ? { advisorModel: resolveAdvisorModel(config) } : {}),
};
```
Where `shouldEnableAdvisor` checks `(a) advisor.backend === "native"`, `(b) AdvisorBudget.canCall(agent) === true`. Test both branches.

### Pitfall 4: Native `max_uses` per-request vs `AdvisorBudget` per-day — both must coexist
**What goes wrong:** Implementer assumes `max_uses: 3` in the advisor tool definition replaces the client-side per-day cap and removes `AdvisorBudget` calls.
**Why it doesn't:** `max_uses` is a PER-API-REQUEST cap (single turn). `AdvisorBudget` is a PER-AGENT-PER-DAY cap. Different scopes — they multiply, not substitute. A single turn calling advisor 3× still costs 3 budget calls toward the daily 10/day cap.
**Mitigation:** Document this explicitly in `AdvisorService.ask()` JSDoc. Test: a single mocked turn with 3 advisor iterations → `recordCall` fires 3 times.

### Pitfall 5: `capability-probes.ts` referenced in CONTEXT.md, but it's the WRONG file
**What goes wrong:** Implementer reads CONTEXT.md line 111 ("`src/manager/capability-manifest.ts`, `src/manager/capability-probes.ts` — capability declaration") and adds advisor logic to `capability-probes.ts`.
**Why it happens:** `capability-probes.ts` looks like the right name. It is NOT — it's the MCP server liveness probe registry (browser → browser_snapshot, 1password → vaults_list, etc.). Has nothing to do with feature awareness.
**Mitigation:** Plan 117-08 implementation notes should explicitly say: "ONLY `capability-manifest.ts` changes. `capability-probes.ts` is unrelated; do not modify." This research correction is documented in §3 file map.

### Pitfall 6: Test-agent `autoStart: false` means manual bring-up for verification
**What goes wrong:** Smoke test in Plan 117-10 fails because operator forgot `test-agent` doesn't auto-start.
**Mitigation:** Plan 117-10 verification steps must include: `clawcode start test-agent` as step 0. CONTEXT.md verification anchors already document this.

### Pitfall 7: ProgressiveMessageEditor's in-flight serialization can swallow late `advisor:invoked` mutations
**What goes wrong:** The augmentation logic in §4.5 mutates `response` AFTER `editor.flush()` — but if a late assistant message arrives carrying an advisor invocation AFTER flush() but BEFORE response is read at line 740, the editor doesn't re-flush.
**Why it doesn't actually happen:** `dispatchStream` does not return until the FULL turn (all assistant messages + terminal result) is processed. By the time line 738 (`editor.flush()`) and line 739 (proposed mutation) execute, all `advisor:invoked` events for this turn have already fired through the stream-iteration handler. The closure variable `didConsultAdvisor` is set before line 738 returns.
**Mitigation:** Add a guard: assert that `dispatchStream` has resolved before checking `didConsultAdvisor`. Documented in Plan 117-09 implementation notes.

## §7. Open Questions for the Planner

1. **`AdvisorService.ask()` shape for native agents — does the operator-callable IPC return immediately, or wait for the agent's next advisor invocation?**
   - The plan envisions both backends having a synchronous `ask()` returning `{answer, budgetRemaining}`. For `fork`-backend this is natural (the fork synchronously dispatches). For `native`-backend, the executor decides WHEN to call advisor — the IPC handler would have to either (a) inject a synthetic user message asking the agent to consult advisor and wait for the next turn's `advisor_tool_result`, or (b) return immediately with a deferred-result placeholder.
   - **Research-supported answer (Gate 2 §2.2):** the recommended path drops MCP `ask_advisor` registration for native agents entirely — the IPC method exists but is no longer called by any agent's tool loop for native backends. So `AdvisorService.ask()` for native is effectively dead code in the agent-callable path; it still exists for the legacy/fork backend.
   - **Open for planner:** should `AdvisorService.ask()` even support native? Option A: native backend's `consult()` throws "use the in-session advisor tool" (matching `PortableForkAdvisor` stub's pattern). Option B: native backend's `consult()` returns a stub `{answer: "advisor is in-session; use it via your tool loop", budgetRemaining: budget.getRemaining(agent), backend: "native"}` — non-throwing but unhelpful. Recommend Option A (clearer error).

2. **Verbose-state.db location: shared with advisor-budget.db or separate file?**
   - The plan's Claude's Discretion (CONTEXT.md line 87) says "match existing pattern (AdvisorBudget uses its own file)." Recommend: separate file `~/.clawcode/manager/verbose-state.db`. Confirmed in §4.1. No further question for the planner — just a sanity check.

3. **Should `/verbose` be admin-only via `defaultMemberPermissions: "0"`?**
   - Existing precedent for admin commands (Phase 100): yes. For `/verbose`, an operator visibility control, also yes. Recommend Plan 117-11 sets `defaultMemberPermissions: "0"`.
   - **Open for planner:** confirm with operator-level expectation. The plan's spec says "operator Discord slash command" implying admin scope, but Discord's `default_member_permissions` plus per-channel-binding gate is defense in depth.

4. **What happens on agent-startup race between budget exhaustion and a still-running turn?**
   - If a session is mid-turn and the budget hits 0, the SDK request is already in flight with `advisorModel` set. Subsequent advisor calls within that request will still happen (server-side `max_uses` is the only cap there). After the turn completes, the budget observer records all iterations and may push the count over 10 retroactively.
   - **Plan 117-04 should document this:** the daily cap is best-effort; `max_uses` per request is hard cap; exceeding 10/day by ≤`max_uses` is acceptable. Implementation note for the planner.

5. **`Options.advisorModel: "opus"` — exact value passed?**
   - The plan says `model: opus` in the config block. The SDK's `advisorModel?: string` accepts any model alias the CLI understands. Common ClawCode shorthand is `"opus"` / `"sonnet"` / `"haiku"` (model-resolver normalizes). Should `resolveAdvisorModel(config)` pass `"opus"` raw, or normalize to the full `"claude-opus-4-1-20250805"` etc.?
   - **Recommended:** pass through `config.advisor?.model ?? defaults.advisor?.model ?? "opus"` raw. The bundled CLI does its own resolution. Mirror behavior of how `model:` / `subagentModel:` are passed today (verify pattern at `session-config.ts:1022` line — it passes `config.model` raw).

## §8. Sources

### Primary (HIGH confidence — verified at this site)
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:4930` — `advisorModel?: string` Option declaration.
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1-3` — Beta type imports from `@anthropic-ai/sdk`.
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2350` — `SDKAssistantMessage` shape.
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:3155-3178` — `SDKResultMessage` shape including `usage: NonNullableUsage`.
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1110-1112` — `NonNullableUsage = NonNullable<BetaUsage[K]>`.
- `node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts:89-120` — `BetaAdvisorMessageIterationUsage`.
- `node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts:144-182` — `BetaAdvisorTool20260301`.
- `node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts:183-204` — `BetaAdvisorToolResultBlock` + error types.
- `node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts:915` — `BetaIterationsUsage` union type.
- `node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts:1256` — `BetaUsage.iterations` field.
- `node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts:1498` — `BetaServerToolUseBlock` with `name: 'advisor' | ...`.
- `node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude` — `strings` confirms `advisor-tool-2026-03-01`, `advisorModel`, `advisor_20260301`, `advisor_message` all present.
- `src/manager/daemon.ts:9805-9866` — current fork-based ask-advisor IPC handler (to be extracted).
- `src/manager/session-config.ts:1020-1066` — SDK Options construction site (advisorModel wiring target).
- `src/manager/session-config.ts:382-393` — capability manifest injection into stable prefix.
- `src/manager/session-adapter.ts:1434-1535` — per-assistant-message handler with contentBlocks scan (advisor observer extension point).
- `src/manager/session-adapter.ts:1164-1189` — `extractUsage` at terminal result (iterations parser extension point).
- `src/manager/capability-manifest.ts:54-232` — feature-awareness manifest builder.
- `src/manager/context-assembler.ts:741-756` — `composeCarvedIdentity` renders the manifest verbatim.
- `src/usage/advisor-budget.ts:1-92` — SQLite pattern reference for new `verbose-state.ts`.
- `src/usage/advisor-budget.test.ts:1-95` — vitest in-memory DB test pattern.
- `src/manager/escalation.test.ts:1-115` — `vi.fn()` mock pattern for `SessionManager.{forkSession, dispatchTurn, stopAgent}`.
- `src/discord/bridge.ts:670-754` — message handler with three delivery exits (footer mutation point at line 739).
- `src/discord/bridge.ts:1071-1128` — `sendResponse` + `sendDirect` (downstream of mutation; unchanged).
- `src/discord/streaming.ts:1-277` — `ProgressiveMessageEditor` (preserves serialized in-flight chain; flush() forces final state).
- `src/discord/reactions.ts:1-32` — currently only inbound formatting; needs new `addReaction` export.
- `src/discord/slash-types.ts:532-681` — `CONTROL_COMMANDS` (global registration target for /verbose).
- `src/discord/slash-commands.ts:1124-1130` — CONTROL_COMMANDS merge into the global registration body.
- `src/discord/slash-commands.ts:1461-1465` — `handleControlCommand` dispatch site.
- `src/mcp/server.ts:91-94`, `:925-952` — `ask_advisor` tool def + handler.
- `src/config/schema.ts:1218-1249` — per-agent `shimRuntime` override (pattern reference).
- `src/config/schema.ts:1821-1827` — fleet-wide `shimRuntime` defaults (pattern reference).
- `src/config/loader.ts:386-393` — `resolveRuntime` fall-through resolver (pattern reference for `resolveAdvisorBackend`).
- `src/ipc/protocol.ts:168` — `"ask-advisor"` IPC method name.
- `node_modules/@anthropic-ai/claude-agent-sdk/package.json` — version 0.2.132.

### Secondary (MEDIUM confidence — referenced but not deep-read)
- `.planning/ROADMAP.md:1930-1979` — Phase 117 roadmap entry confirming plan order + gates.
- `/home/jjagpal/.claude/plans/eventual-questing-tiger.md` — approved plan (authoritative source for architecture).
- `.planning/phases/117-claude-code-advisor-pattern-multi-backend-scaffold-anthropic/117-CONTEXT.md` — phase scope, locked decisions, file layout.
- discord.js v14 `Message.react()` API — referenced for the new `addReaction` helper. [CITED: discord.js docs]

### Tertiary (none — every claim above is verified from source files or external authoritative docs)

## §9. Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Bundled `claude` binary at `node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude` is the runtime that handles `advisorModel` and beta header injection. | §1, §2.1, §6 Pitfall 2 | LOW. Verified via `strings` finding all four advisor tokens. Risk realization would manifest as "advisor never fires server-side"; mitigation = manual `betas: ["advisor-tool-2026-03-01"]` injection through SDK Options (not currently typed but the SDK may accept it via passthrough). |
| A2 | `dispatchStream` does not return until ALL assistant messages of the turn have been processed. | §4.5, §6 Pitfall 7 | MEDIUM. Verified by reading `session-adapter.ts:1432-1535` — the `for await (const msg of q)` loop iterates the full stream. If a NEW stream behavior in some SDK upgrade decouples partial-result delivery from stream completion, the closure-variable approach for `didConsultAdvisor` could miss late events. Mitigation: a post-flush re-check via `iterationCount > 0` from terminal result. |
| A3 | discord.js v14's `Message.react(emoji)` accepts Unicode strings like `"💭"` directly. | §4.6 | LOW. Standard discord.js API. Mitigation: wrap in try/catch (already specified). |
| A4 | `verbose-state.db` should live in its own file at `~/.clawcode/manager/verbose-state.db` rather than co-locate with `advisor-budget.db`. | §4.1, §7 Q2 | LOW. Matches the `AdvisorBudget` precedent (separate file). Alternative — co-locate in `manager/state.db` — works equally well; small refactor cost if reversed later. |
| A5 | `Options.advisorModel: undefined` vs spread-conditional omission may have subtle CLI passthrough differences. | §6 Pitfall 3 | MEDIUM. Not empirically tested at this site — recommendation is to use spread-conditional defensively (the pattern the codebase already adopts for settingSources/gsd/debug). If runtime treats undefined and omission identically, the spread-conditional is harmless overhead. |
| A6 | The `BetaIterationsUsage` field is populated on EVERY advisor-bearing response by the CLI binary (not just some). | §2.1 Gate 1 | MEDIUM. Type signature is `BetaIterationsUsage | null` — `null` is possible. Mitigation: the per-block scanner in `session-adapter.ts:1488` is the primary signal; the iteration parser is a corroborating ground-truth. If iterations is null, fall back to the per-block count (with reduced precision — server-tool-use blocks are visible, but separate-iteration counts aren't). |
| A7 | The recommended timing-prompt text in `/home/jjagpal/.claude/CLAUDE.md`'s Advisor Tool section is the canonical Anthropic-documented wording. | §4.3, Plan 117-08 | LOW. Per CONTEXT.md Claude's Discretion. If Anthropic publishes a different canonical wording later, easy one-string update. |

## §10. Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | All TS code | ✓ (project uses Node 22 LTS) | per package.json engines | — |
| @anthropic-ai/claude-agent-sdk | `AnthropicSdkAdvisor` | ✓ | 0.2.132 | — |
| @anthropic-ai/sdk (transitive) | type imports | ✓ | (transitive of claude-agent-sdk) | — |
| Bundled `claude` CLI binary | Native advisor server-tool injection | ✓ | shipped with SDK 0.2.132 | none — required for native backend |
| better-sqlite3 | `verbose-state.ts`, `advisor-budget.ts` | ✓ | (in use) | — |
| zod | config schema extensions | ✓ | (in use) | — |
| vitest | test framework | ✓ | (in use) | — |
| discord.js | reaction helper | ✓ | 14.x | — |
| Anthropic API access for `advisor_20260301` beta | end-to-end smoke on `test-agent` | ? | requires `advisor-tool-2026-03-01` beta access on the API key in use | If the API key lacks beta access: native path 400s; `LegacyForkAdvisor` (default operator rollback) still works as today. |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** Anthropic `advisor_20260301` beta access — if missing on the deployed API key, `fork` backend remains operational. Plan 117-10 smoke-test should verify beta access on the production key before flipping `defaults.advisor.backend: native` fleet-wide.

## §11. Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (in use across codebase) |
| Config file | (project root) `vitest.config.ts` or similar — confirmed by presence of co-located `*.test.ts` files |
| Quick run command | `npm test -- src/advisor/` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map (full table in §5)
See §5 "Test Strategy Per Plan" — 15 distinct test files, 13 new + 2 extending existing.

### Sampling Rate
- **Per task commit:** `npm test -- <related file>` (each plan commits with its own focused test run, ≤ 5 seconds).
- **Per wave merge:** `npm test -- src/advisor/ src/usage/ src/discord/ src/config/ src/manager/` (targeted regions only).
- **Phase gate:** `npm test` (full suite green before `/gsd-verify-work`).

### Wave 0 Gaps
- [ ] `src/advisor/__tests__/service.test.ts` — covers 117-02 budget + truncation + dispatch
- [ ] `src/advisor/__tests__/registry.test.ts` — covers 117-02 / 117-06 backend resolution
- [ ] `src/advisor/__tests__/prompts.test.ts` — covers 117-02 prompt builder
- [ ] `src/advisor/backends/__tests__/legacy-fork.test.ts` — covers 117-03 extraction parity
- [ ] `src/advisor/backends/__tests__/anthropic-sdk.test.ts` — covers 117-04 iterations parser + emit
- [ ] `src/advisor/backends/__tests__/portable-fork.test.ts` — covers 117-05 stub throws
- [ ] `src/config/__tests__/schema-advisor.test.ts` — covers 117-06 schema validation
- [ ] `src/config/__tests__/loader-advisor.test.ts` — covers 117-06 fall-through resolver
- [ ] `src/manager/__tests__/daemon-ask-advisor-dispatch.test.ts` — covers 117-07 IPC dispatch
- [ ] `src/manager/__tests__/session-adapter-advisor-observer.test.ts` — covers 117-04 observer hook
- [ ] (extend) `src/manager/__tests__/capability-manifest.test.ts` — covers 117-08 awareness block
- [ ] `src/discord/__tests__/bridge-advisor-footer.test.ts` — covers 117-09 footer + reaction
- [ ] `src/usage/__tests__/verbose-state.test.ts` — covers 117-11 verbose state CRUD
- [ ] `src/discord/__tests__/slash-verbose-command.test.ts` — covers 117-11 slash dispatch

## §12. Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Discord bot token (env var, in use); 1Password for SOPS keys (existing) — no new auth surface this phase. |
| V3 Session Management | yes | Per-agent SDK sessions, isolation preserved. No cross-session leak. |
| V4 Access Control | yes | `/verbose` slash command admin-gated via `defaultMemberPermissions: "0"` (Phase 100 pattern). |
| V5 Input Validation | yes | `zod` schema validation at `src/config/schema.ts` for new `advisor` block (Plan 117-06). Reject `"portable-fork"` value. |
| V6 Cryptography | no | No new crypto. Anthropic API TLS handled by SDK; no client-side cryptography added. |

### Known Threat Patterns for {ClawCode + Anthropic SDK + Discord}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Operator can set `defaults.advisor.model` to an unbudgeted model (e.g., higher-cost model) | Tampering / DoS | Zod enum constraint — restrict to known model aliases OR enforce a per-fleet cost cap via existing `AdvisorBudget`. (Out of 117 scope; current free-string default matches existing `model:` field pattern.) |
| Maliciously crafted Discord message triggers excessive advisor consultations | DoS | `AdvisorBudget` daily 10/day cap (unchanged). `max_uses: 3` per-request cap. Both client-side. |
| Verbose Q+A block exposes user PII in channel | Information Disclosure | Question text is truncated to 200 chars in event; answer truncated to 500 chars in verbose block. Footer-mode shows neither. Operator opt-in via `/verbose on` — channel-scoped, admin-gated. |
| Cross-channel verbose state leak | Tampering | `verbose_channels(channel_id PK)` — primary key isolation. `getLevel(channelId)` is channel-scoped. |
| Beta API access revocation mid-deploy | Availability | Operator rollback via `agent.advisor.backend: fork` + `clawcode reload`. Same idiom as Phase 110 `shimRuntime`. |

## §13. Corrections & Late Findings (post-docs review)

Findings from the official advisor-tool documentation (https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool, fetched 2026-05-13). These SUPERSEDE the corresponding code sketches above where they conflict. The Gate resolutions (§2.1, §2.2, §2.3) and the file map (§3) remain correct; the changes here are about INPUT/OUTPUT block shapes and the verbose-mode display.

### §13.1 `server_tool_use.input` is ALWAYS empty `{}`

**Source:** Anthropic docs verbatim:
> "The executor emits a `server_tool_use` block with `name: "advisor"` and an **empty `input`**. The executor signals timing; the server supplies context."
>
> "The `server_tool_use.input` is always empty. The server constructs the advisor's view from the full transcript automatically; nothing the executor puts in `input` reaches the advisor."

**Impact on §2.3 emit-site code sketch:** the `questionPreview` field is INCORRECT — `block.input` carries no question. The advisor sees the full transcript server-side; the executor literally signals "now consult."

**Corrected emit-site (replaces §2.3 sketch starting line 360):**

```typescript
// CORRECTED — src/manager/session-adapter.ts:1488 (inside contentBlocks loop)
if (block.type === "server_tool_use" && block.name === "advisor" && block.id) {
  // server_tool_use.input is always empty per docs; nothing to extract.
  // The advisor sees the full transcript server-side.
  try {
    advisorEvents.emit("advisor:invoked", {
      agent: agentName,
      turnId,
      toolUseId: block.id, // for correlating to the subsequent advisor_tool_result block
    });
  } catch {
    // Observational only — never break the message path.
  }
}
```

### §13.2 Verbose-mode `/verbose on` displays ADVICE, not a Q+A pair

**Impact on §4.5 verbose block:** since the executor doesn't pass a question, the "Q: ..." line in the verbose block has nothing to display. The advisor's full conversational context replaces any concept of an explicit question. Re-shape the block:

**Corrected verbose-mode display (replaces §4.5 mutation around line 351):**

```typescript
// CORRECTED — src/discord/bridge.ts mutation point
if (didConsultAdvisor && response && response.trim().length > 0) {
  const level = this.verboseState?.getLevel(channelId) ?? "normal";
  if (level === "verbose" && lastAdvisorResult) {
    // Display the advisor's plaintext advice only; there is no "question" from
    // the executor — the advisor sees the full transcript server-side.
    response = `${response}\n\n\`\`\`\n💭 advisor consulted (Opus)\n${lastAdvisorResult.text.slice(0, 500)}${lastAdvisorResult.text.length > 500 ? "…" : ""}\n\`\`\``;
  } else {
    response = `${response}\n\n*— consulted advisor (Opus) before responding*`;
  }
}
```

Where `lastAdvisorResult` is populated by a second event `advisor:resulted` carrying the parsed `advisor_tool_result.content` (see §13.3).

### §13.3 `advisor_tool_result` arrival timing — confirmed same-message

**Source:** Anthropic docs verbatim (response-structure example) shows the `server_tool_use` and `advisor_tool_result` blocks both inside the SAME assistant message's `content[]`, surrounded by text blocks before and after. Confirms the §5 Plan 117-04 fixture shape.

**Plan 117-04 implementation MUST scan for BOTH block types within the same message handler iteration:**

```typescript
// CORRECTED — src/manager/session-adapter.ts:1488 (extended)
let pendingAdvisorToolUseId: string | null = null;
for (const raw of contentBlocks) {
  const block = raw as {
    type?: string;
    name?: string;
    id?: string;
    tool_use_id?: string;
    content?: unknown;
  };
  // ... existing text + tool_use handling ...
  if (block.type === "server_tool_use" && block.name === "advisor" && block.id) {
    pendingAdvisorToolUseId = block.id;
    advisorEvents.emit("advisor:invoked", { agent: agentName, turnId, toolUseId: block.id });
  }
  if (block.type === "advisor_tool_result" && block.tool_use_id === pendingAdvisorToolUseId) {
    const content = block.content as
      | { type: "advisor_result"; text: string }
      | { type: "advisor_redacted_result"; encrypted_content: string }
      | { type: "advisor_tool_result_error"; error_code: string };
    advisorEvents.emit("advisor:resulted", {
      agent: agentName,
      turnId,
      toolUseId: pendingAdvisorToolUseId,
      kind: content.type, // "advisor_result" | "advisor_redacted_result" | "advisor_tool_result_error"
      text: content.type === "advisor_result" ? content.text : undefined,
      errorCode: content.type === "advisor_tool_result_error" ? content.error_code : undefined,
    });
    pendingAdvisorToolUseId = null;
  }
}
```

**Two events, not one:** `advisor:invoked` (fires reaction immediately, no answer yet) + `advisor:resulted` (populates `lastAdvisorResult` for verbose-mode display). The bridge listens to both; the footer/reaction depends only on `:invoked`, the verbose Q+A block depends on `:resulted`.

### §13.4 `advisor_tool_result.content` variants — handle ALL three

**Source:** Anthropic docs "Result variants" table:

| Variant | Fields | Returned when |
|---------|--------|---------------|
| `advisor_result` | `text` | Plaintext advice (Claude Opus 4.7). |
| `advisor_redacted_result` | `encrypted_content` | Encrypted output. Opaque blob — DO NOT inspect. |
| `advisor_tool_result_error` | `error_code` | Failure modes: `max_uses_exceeded`, `too_many_requests`, `overloaded`, `prompt_too_long`, `execution_time_exceeded`, `unavailable`. |

**Behavior matrix for the Discord visibility code:**

| Result variant | 💭 reaction | Footer | Verbose Q+A block |
|---------------|-------------|--------|---------------------|
| `advisor_result` | yes | yes | yes (show `text` truncated to 500) |
| `advisor_redacted_result` | yes | yes | NO — display fallback footer instead ("encrypted advice — see API key access policy") |
| `advisor_tool_result_error` | yes (advisor was attempted) | NO — replace footer with `*— advisor unavailable (<error_code>)*` | NO |

Implementation note for Plan 117-09: branch the verbose-block code on `lastAdvisorResult.kind`. Document explicitly that `advisor_redacted_result` cannot be displayed plaintext.

### §13.5 Budget exhaustion: removing `advisorModel` is NOT enough

**Source:** Anthropic docs verbatim:
> "To limit advisor calls across a conversation, count them client-side. When you reach your ceiling, remove the advisor tool from your `tools` array **and** strip all `advisor_tool_result` blocks from your message history to avoid a `400 invalid_request_error`."

**Impact on §6 Pitfall 3 and Plan 117-04:** when `AdvisorBudget.canCall === false`, simply omitting `advisorModel` from Options on the next session reload is **necessary but NOT sufficient**. The SDK-owned message history still contains prior `advisor_tool_result` blocks (from earlier-today turns). If the SDK passes that history back to the API with no `advisor` tool defined, the API returns 400.

**Two possible mitigations for Plan 117-04:**
- **A (recommended for this phase, simpler):** when budget is exhausted, KEEP `advisorModel` set but PASS `max_uses: 0` via the advisor tool definition. The executor will get `error_code: "max_uses_exceeded"` on its first attempt and continue without advice — no history scrubbing needed.
- **B (more thorough, costlier):** intercept the SDK's outbound request, strip `advisor_tool_result` blocks from history. Requires SDK internals access ClawCode doesn't currently have.

**Open question for the planner (escalated from §7):** the SDK's `advisorModel` option may not expose `max_uses` directly — it sets the model but the tool-definition fields may be opaque. If `max_uses` isn't exposable through the SDK Options surface, fall back to mitigation B OR accept the daily-cap-soft-limit risk (the cap can be exceeded by ≤ `max_uses` per request per the existing soft-cap acceptance in §7 Q4).

### §13.6 Streaming: `usage.iterations` arrives via `message_delta`

**Source:** Anthropic docs verbatim:
> "A `message_delta` event follows with the updated `usage.iterations` array reflecting the advisor's token counts."

**Impact on §2.1 Gate 1 parse strategy:** the per-block scan at `session-adapter.ts:1488` catches the `server_tool_use` block in real time (during assistant-message streaming). The `usage.iterations` array is updated by a `message_delta` event AFTER the advisor sub-inference completes — but BEFORE the terminal `result` event.

For ClawCode's purposes: the existing `extractUsage` at `session-adapter.ts:1164` (which fires only on `result`) is the ground-truth iteration counter. The per-block scan is the EARLY signal for Discord visibility. The two layers coexist as designed.

### §13.7 Advisor model alias

**Source:** Anthropic docs valid-pair table lists `claude-opus-4-7` as the advisor model for all current executor pairs.

**Impact on §7 Q5 (advisor model alias):** the default `advisor.model` field should accept `"opus"` for ClawCode-internal consistency BUT the resolved value passed to the SDK as `advisorModel` should be `"claude-opus-4-7"` (or whatever the operator overrides to). Add a thin alias resolver in `src/advisor/prompts.ts` or `registry.ts`:

```typescript
// src/advisor/registry.ts (or model-resolver.ts)
const ADVISOR_MODEL_ALIASES: Record<string, string> = {
  opus: "claude-opus-4-7",
  "claude-opus-4-7": "claude-opus-4-7",
};
export function resolveAdvisorModel(rawModel: string): string {
  return ADVISOR_MODEL_ALIASES[rawModel] ?? rawModel;
}
```

Verify against ClawCode's existing `model-resolver.ts` — there may be a fleet-wide alias map already that can be reused.

### §13.8 `clear_tool_uses` context-management incompatibility

**Source:** Anthropic docs "Combining with other tools" table:
> "`clear_tool_uses` is not fully compatible with advisor tool blocks. With `clear_thinking`, see the earlier caching warning."

**Impact:** if any ClawCode agent enables `clear_tool_uses` context management, the advisor history may be malformed. Not a current concern (no agent uses this), but Plan 117-10 documentation should flag it for future operators.

### §13.9 Standalone runner path bypasses advisor visibility

**Finding:** `src/discord/bridge.ts:727-733` has a v1.7 fallback path that bypasses `turnDispatcher`:

```typescript
} else {
  // v1.7 fallback — preserves standalone runner (src/cli/commands/run.ts)
  response = await this.sessionManager.streamFromAgent(
    sessionName, formattedMessage, (accumulated) => editor!.update(accumulated), turn,
  );
}
```

`streamFromAgent` does NOT go through `dispatchStream` → `session-adapter.iterateWithTracing` with the advisor observer hook the same way. The `advisor:invoked` event chain assumes the dispatcher path.

**Impact on Plan 117-09:** the standalone CLI runner (`src/cli/commands/run.ts`) won't fire `advisor:invoked` events. The Discord bridge code that listens for the event still works — it just never sees the event, so `didConsultAdvisor` stays `false` and no footer/reaction is added.

**Acceptance:** the standalone runner is a developer-test path; it does NOT use Discord; visibility is moot. No action required for 117 scope. Documented here so the planner doesn't accidentally treat this as a regression.

### §13.10 `advisorEvents` EventEmitter ownership

**Finding (advisor review gap):** the code sketches reference `this.sessionManager.advisorEvents` but the file map (§3) didn't declare where this lives.

**Decision:** add a public property on `SessionManager`:

```typescript
// src/manager/session-manager.ts (NEW property)
public readonly advisorEvents: EventEmitter = new EventEmitter();
```

`SessionManager` already owns `session-adapter.iterateWithTracing` (session-adapter.ts modules are SessionManager helpers per the codebase structure). The Discord bridge receives `SessionManager` via constructor injection, so `this.sessionManager.advisorEvents` is reachable.

Type-safety: declare the event shape in `src/advisor/types.ts`:
```typescript
export type AdvisorInvokedEvent = { readonly agent: string; readonly turnId: string; readonly toolUseId: string };
export type AdvisorResultedEvent = {
  readonly agent: string;
  readonly turnId: string;
  readonly toolUseId: string;
  readonly kind: "advisor_result" | "advisor_redacted_result" | "advisor_tool_result_error";
  readonly text?: string;
  readonly errorCode?: string;
};
```

### §13.11 Open Question 1 resolution: AdvisorService.ask() for native — Option A locked

Per advisor reviewer feedback: commit to Option A. The recommendation:

**`AnthropicSdkAdvisor.consult()` throws** `Error("AnthropicSdkAdvisor.consult() not callable — advisor runs in-request via Options.advisorModel; the executor decides timing autonomously. To force a synchronous fork-based call, set agent.advisor.backend: fork.")`.

The `ask-advisor` IPC method handler at `daemon.ts:9805` resolves the backend FIRST; if native, it returns an explanatory `{ answer: "Advisor runs in-session for native-backend agents — your agent will consult automatically on its next hard decision.", budget_remaining, backend: "native" }` rather than throwing through to the IPC client. This preserves IPC liveness while making the no-op nature explicit.

The MCP `ask_advisor` tool is unregistered for native agents (Gate 2 / Plan 117-07). The IPC method is therefore only callable by fork-backend agents in practice — but the daemon handler still handles the native case defensively in case of stale agent state.

### §13.12 Additional Assumptions Log entries

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A8 | `BetaServerToolUseBlock.input` for `name === "advisor"` is always empty `{}`. | §13.1 | LOW. Confirmed by Anthropic docs verbatim. |
| A9 | `server_tool_use` and `advisor_tool_result` blocks arrive in the SAME assistant message's `content[]` (not split across messages). | §13.3, §5 fixture | LOW. Confirmed by Anthropic docs "Response structure" example. Mitigation if wrong: `pendingAdvisorToolUseId` is a turn-scoped accumulator — naturally survives multi-message arrival, just delays `:resulted` until later. |
| A10 | When budget is exhausted, mitigation A (set `max_uses: 0` in advisor tool def) is preferable to mitigation B (history scrubbing). | §13.5 | MEDIUM. Depends on whether SDK Options exposes `max_uses`. If `advisorModel` is the only Option, fall back to omitting `advisorModel` and accept that downstream sessions may face 400 errors if prior advisor_tool_result blocks remain in history. Workaround: clear conversation on budget hit (next reload). |
| A11 | `claude-opus-4-7` is the canonical advisor model alias. | §13.7 | LOW. Confirmed by Anthropic docs valid-pair table. Aliases are tested per-deployment. |
| A12 | `EventEmitter` overhead is acceptable for the advisor:invoked / advisor:resulted event pair. | §13.10 | LOW. Same Node.js EventEmitter pattern used elsewhere in the codebase (search for `EventEmitter` imports). |
| A13 | The `lastAdvisorResult` closure variable in the Discord bridge is correctly cleared at turn end (no leak across turns within the same channel). | §13.2, §13.10 | LOW. The closure is scoped to the bridge's per-message handler invocation — naturally garbage-collected at message completion. Plan 117-09 verification: a unit test that runs two consecutive turns and asserts the second turn's footer reflects only the second turn's advisor result. |

### §13.13 Additional Pitfall

#### Pitfall 8: Standalone-runner advisor silence is acceptable, not a regression

Per §13.9 — the `src/cli/commands/run.ts` path bypasses `dispatchStream`. No Discord delivery; no advisor footer expected. Document in Plan 117-09 implementation notes so future operators / planner agents don't read the absence of footer in standalone-mode test runs as a bug.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified at this site; no external dependencies added.
- Architecture (Gates 1/2/3): HIGH — every Gate resolution verified from source files; the per-assistant-message emit site (Gate 3) is the existing tool_use scan branch — proven extension pattern.
- Pitfalls: HIGH — silent-path bifurcation pinned to line numbers; advisorModel undefined-vs-omission addressed via existing codebase idiom.
- File-by-file map: HIGH — every file row verified by direct read or grep.

**Research date:** 2026-05-13
**Valid until:** 2026-06-13 (30 days — Anthropic beta surface is currently stable but `advisor_20260301` is a 2026-03-01 beta; an API revision could ship in this window).
