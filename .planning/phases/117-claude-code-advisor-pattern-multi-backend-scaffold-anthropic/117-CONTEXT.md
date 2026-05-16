# Phase 117: Claude Code advisor pattern — Context

**Gathered:** 2026-05-13
**Status:** Ready for planning
**Source:** Approved plan `/home/jjagpal/.claude/plans/eventual-questing-tiger.md` (user-approved via ExitPlanMode 2026-05-13)

<domain>
## Phase Boundary

Bring the Anthropic API `advisor_20260301` beta pattern into ClawCode. Replace the fork-based `ask_advisor` implementation at `src/manager/daemon.ts:9805` (forks the agent's session under an Opus override, dispatches one turn, kills the fork — pays fresh-session boot cost + full-context input on every call, zero advisor-side caching) with a provider-neutral `AdvisorService` interface and three backend slots.

**Scope IN:**
- Provider-neutral `AdvisorService` + `AdvisorBackend` interface.
- `AnthropicSdkAdvisor` — COMPLETE backend using the Claude Agent SDK's `advisorModel` option (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:4930`, confirmed available in SDK 0.2.132). SDK handles beta header + server tool injection + executor timing prompt.
- `LegacyForkAdvisor` — wraps today's daemon fork logic extracted into a function. Preserves current behavior as the rollback path.
- `PortableForkAdvisor` — scaffold only (interface-conformant stub that throws documented Phase 118 error). Not selectable in config.
- `src/llm/CompletionProvider` interface — seed for future provider abstraction. No implementations.
- Config schema: `defaults.advisor.{backend,model,maxUsesPerRequest,caching}` + per-agent override. Backend values: `"native" | "fork"`.
- Agent awareness: timing-prompt block injected into agent system prompts + `advisor` entry in capability manifest.
- Discord visibility: 💭 reaction on triggering user message + `— consulted advisor (Opus) before responding` footer on assistant response. In-band only — NO new threads.
- **`/verbose` operator Discord slash command** (Plan 117-11) — per-channel `/verbose on|off|status` toggle. SQLite-backed state. When ON, advisor consultations show inline Q+A + tool-call summary block instead of just the reaction + footer.

**Scope OUT:**
- Full `PortableForkAdvisor` implementation (Phase 118).
- Any `CompletionProvider` implementation (first lands with Phase 118 consumer).
- Removal of fork-based code (deferred ≥1 week post-`native` production rollout).
- `subagent-thread` skill / `spawn_subagent_thread` IPC (untouched — separate system, visible thread spawning).
- `src/manager/escalation.ts` rewire (keeps its fork-to-Opus logic — separate cost/effort concern).
- Production deployment (operator-gated per `feedback_no_auto_deploy` + `feedback_ramy_active_no_deploy`; this phase ships source only).

</domain>

<decisions>
## Implementation Decisions

### Architecture (LOCKED)
- **Three backend slots, two working.** `AnthropicSdkAdvisor` (native, default), `LegacyForkAdvisor` (rollback, gated by `advisor.backend: fork`), `PortableForkAdvisor` (scaffold stub for Phase 118).
- **Provider-neutral interface** at `src/advisor/` and `src/llm/`. Call sites talk to `AdvisorService`, not the SDK directly. Future non-Anthropic providers slot into `src/llm/` without touching advisor code.
- **Feature flag for rollback** — same pattern as Phase 110 `defaults.shimRuntime` (`CLAUDE.md:41–49`). Default `backend: native`; operators flip any one agent to `fork` via `clawcode reload` without a redeploy.

### Preserved contracts (LOCKED)
- `ask_advisor` MCP tool name and `{question, agent}` schema (`src/mcp/server.ts:925`) — unchanged.
- `ask-advisor` IPC method name (`src/ipc/protocol.ts:168`) — unchanged; handler body re-points at `AdvisorService`.
- `AdvisorBudget` per-agent daily cap, default 10/day (`src/usage/advisor-budget.ts`) — unchanged. Native `max_uses` is per-request only; conversation/day cap must remain client-side.
- `ADVISOR_RESPONSE_MAX_LENGTH = 2000` — truncation applied in `AdvisorService` (both backends).
- Non-idempotent / never-cache flag for `ask_advisor` (`src/config/schema.ts:738`, `src/config/loader.ts:294`) — stays.

### File layout (LOCKED)
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

### Discord visibility (LOCKED)
- 💭 reaction on the triggering user message via `src/discord/reactions.ts` (helper exists).
- Footer `— consulted advisor (Opus) before responding` appended to assistant response delivery.
- Implemented via an `advisor:invoked` event emitted from `src/manager/session-adapter.ts` and consumed by `src/discord/bridge.ts`.
- Must fire BEFORE delivery so footer + reaction land atomically (pre-execution gate 3 — see below).
- NO new threads — visibility is in-band. `subagent-thread` skill is untouched and remains the operator-visible spawning path.

### /verbose toggle (Plan 117-11, LOCKED)
- Operator Discord slash command `/verbose on|off|status` per channel.
- State stored in SQLite via new `src/usage/verbose-state.ts` (table `verbose_channels(channel_id PK, level, updated_at)`).
- Levels: `"normal"` (default — 💭 reaction + footer when advisor fires) and `"verbose"` (inline advisor Q+A block + compact tool-call summary).
- When advisor fires AND channel level is `verbose`, the Discord bridge appends a fenced block:
  ```
  > 💭 advisor consulted:
  > Q: <question>
  > A: <truncated answer, 500 chars>
  ```
- `/verbose status` reports current level and last-changed timestamp.
- Registered as a Discord slash command alongside existing ones (`src/discord/slash-commands.ts`).

### Claude's Discretion
- Exact wording of the timing-prompt block injected into agent system prompts (Plan 117-08). Use the docs-recommended block (already present in `/home/jjagpal/.claude/CLAUDE.md`'s advisor section) as the canonical text, lightly adapted for ClawCode (mention that consultations are visible in Discord; reference `subagent-thread` for tasks that need operator-watchable execution).
- Internal directory structure of `src/advisor/__tests__/` (subdirectory vs flat — match whatever the surrounding codebase does in `src/manager/__tests__/` and `src/config/__tests__/`).
- Whether `verbose_channels` table lives in the existing manager SQLite db or a new file — match existing pattern (AdvisorBudget uses its own file `manager/advisor-budget.db`).
- Footer wording — `— consulted advisor (Opus) before responding` is a strong default; minor copy tweaks fine if they match ClawCode voice.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Approved plan (source of truth)
- `/home/jjagpal/.claude/plans/eventual-questing-tiger.md` — full plan document, user-approved via ExitPlanMode 2026-05-13. Contains architecture, interface definitions, task breakdown, verification strategy, pre-execution gates. Plans 117-01..117-11 derive from this.

### Existing code (what stays / what changes)
- `src/manager/daemon.ts:9805–9866` — current fork-based `ask-advisor` IPC handler. To be extracted into `forkAdvisorConsult()` in Plan 117-03 and wrapped as `LegacyForkAdvisor`.
- `src/manager/session-config.ts:1022` — where SDK Options are constructed; `advisorModel` field added here in Plan 117-04.
- `src/manager/session-adapter.ts` — SDK stream handler; budget observer + `advisor:invoked` event emit added here in Plan 117-04/09.
- `src/usage/advisor-budget.ts` — existing SQLite-backed per-agent daily cap. Reused unchanged. Pattern reference for new `src/usage/verbose-state.ts` (Plan 117-11).
- `src/mcp/server.ts:91` (tool definition) and `:925` (handler) — `ask_advisor` MCP tool. Schema unchanged; handler conditionally registered based on resolved backend (Plan 117-07).
- `src/ipc/protocol.ts:168` — `"ask-advisor"` IPC method name. Stays.
- `src/config/schema.ts:738`, `src/config/loader.ts:294` — non-idempotent / never-cache flag for `ask_advisor`. Stays.
- `src/discord/reactions.ts` — Discord reaction sender (used by 117-09).
- `src/discord/bridge.ts` — Discord delivery pipeline (consumes `advisor:invoked`).
- `src/discord/slash-commands.ts`, `src/discord/slash-types.ts` — Discord slash command registry (extend for `/verbose` in 117-11).
- `src/manager/capability-manifest.ts`, `src/manager/capability-probes.ts` — capability declaration (add `advisor` entry in 117-08).
- `src/manager/context-assembler.ts` — agent system prompt assembly (timing-prompt injection in 117-08).

### SDK + API references
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:4930` — `advisorModel?: string` option (the integration site).
- `node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts` — top-level SDK types for `advisor_20260301` server tool (for any future provider-direct path; not used in this phase).
- Anthropic docs: <https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool> — beta header `advisor-tool-2026-03-01`, response shape (`server_tool_use` + `advisor_tool_result`), `usage.iterations[]` (`type: "advisor_message"`), prompt caching semantics, recommended timing prompt.
- Anthropic blog: <https://claude.com/blog/the-advisor-strategy> — pairing rationale, cost/quality data.

### Project precedent
- Phase 110 `defaults.shimRuntime` (`CLAUDE.md:41–49`) — same feature-flag rollback pattern this phase reuses for `advisor.backend`.
- Phase 100 admin-clawdy `slashCommands` config block (`clawcode.example.yaml` — `admin-clawdy` agent definition) — pattern for slash-command registration; `/verbose` follows this.

### User memory (operator constraints)
- `feedback_no_auto_deploy` — never deploy without explicit operator authorization in same turn.
- `feedback_ramy_active_no_deploy` — Ramy in `#fin-acquisition`; hold deploys.
- `feedback_silent_path_bifurcation` — before adding telemetry/IPC/handler code, verify production actually executes that path.

</canonical_refs>

<specifics>
## Specific Ideas

### Pre-execution gates (resolve in RESEARCH.md before Plan 117-04 commits)
1. **SDK stream surface.** How does the Claude Agent SDK 0.2.132 surface advisor tool-use events in `SdkStreamMessage`? Grep `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` for `advisor_message`, `iterations`, `server_tool_use`, `advisor_tool_result`. The budget observer in Plan 117-04 needs a concrete parse site. Fallback: parse `server_tool_use` content blocks with `name === "advisor"` from the assistant content stream.
2. **MCP `ask_advisor` registration policy for native-backend agents.** Drop the tool (recommended — matches Claude Code's UX where the executor calls `advisor()` autonomously) vs keep it as a uniform IPC surface across backends. If drop: gate registration in `src/mcp/server.ts:925` on `resolveAdvisorBackend(agent) === "fork"`.
3. **`advisor:invoked` event emit site.** Must fire before Discord delivery so footer + reaction land atomically. Likely site: `session-adapter.ts` stream callback before `iterateWithTracing` resolves. Fallback: emit at terminal `result` event and append footer via post-delivery edit.

### Test fixtures
- A representative `usage.iterations[]` JSON with `type: "advisor_message"` entry (Plan 117-04 parser).
- A pre-built mocked `SdkStreamMessage` sequence including a `server_tool_use` advisor block (Plan 117-04 / 117-09).
- Sample `verbose_channels` SQLite row (Plan 117-11).

### Verification anchors
- `test-agent` workspace exists at `/home/jjagpal/.clawcode/agents/test-agent` (default `basePath: ~/.clawcode/agents`).
- `test-agent` Discord channel: `1491623782807244880`.
- `test-agent.autoStart: false` in current config — bring up manually via `clawcode start test-agent` for smoke tests.

</specifics>

<deferred>
## Deferred Ideas

- **`PortableForkAdvisor` implementation** — Phase 118. Requires transcript extraction from SDK-owned session state + a `CompletionProvider` implementation (likely `AnthropicDirectProvider` against `@anthropic-ai/sdk@^0.95.1`, bypassing the agent SDK).
- **Non-Anthropic providers** — Phase 119+. OpenAI, Bedrock, Vertex, Ollama. Each is a new file in `src/llm/`.
- **Removal of fork-based code** — Phase 118 or 119, ≥1 week post `native` production rollout without rollback.
- **Advisor metrics dashboard** — utilization, cache hit rate, cost per call. Out of scope for 117; possible follow-up.
- **`/verbose` per-agent override** (vs per-channel) — current scope is channel-level only. Per-agent override is a possible refinement if operators want it later.

</deferred>

---

*Phase: 117-claude-code-advisor-pattern-multi-backend-scaffold-anthropic*
*Context gathered: 2026-05-13 from approved plan*
