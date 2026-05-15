# Phase 136: LlmRuntimeService Seam + AnthropicAgentSdk Backend Extraction — Context

**Gathered:** 2026-05-15
**Status:** Ready for planning
**Mode:** Auto-generated from BACKLOG.md (anchor: 999.62 research synthesis). v3.1 Wave 1 — hard-deadline track for 2026-06-15 Anthropic Agent SDK credit policy.

<canonical_refs>
## Canonical References

| Ref | Why | Path |
|-----|-----|------|
| BACKLOG.md (anchor research) | 999.62 — 5-wave roadmap + concurrent-session probe + provider-decoupling research | `.planning/phases/136-llm-runtime-multi-backend/BACKLOG.md` |
| Anthropic Agent SDK credit policy (2026-05-14) | The trigger — Agent SDK splits off subscription pool at $200/mo cap from 2026-06-15 | https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan |
| Phase 117 advisor-backend pattern | The architectural template being mirrored — `AdvisorService` seam with `native`/`fork`/`portable-fork` backends + per-agent config-flippable rollback | `src/advisor/` + CLAUDE.md §"Advisor pattern (Phase 117)" |
| Phase 117 SUMMARY | Reference implementation — what "seam scaffold" looks like end-to-end | `.planning/phases/117-claude-code-advisor-pattern-multi-backend-scaffold-anthropic/117-SUMMARY.md` |
| Current SDK invocation site | Where Agent SDK is consumed today | `src/manager/session-adapter.ts` + `src/manager/persistent-session-handle.ts` (both reference `@anthropic-ai/claude-agent-sdk`) |
| ResolvedAgentConfig | Per-agent config shape that backend selector slots into | `src/shared/types.ts` |
| feedback_silent_path_bifurcation.md | Anti-pattern — seam must replace ALL Agent SDK call sites in one chokepoint | memory |
| feedback_ramy_active_no_deploy.md | Deploy hold continues | memory |
| feedback_no_auto_deploy.md | Deploy gate | memory |
| v3.1 ROADMAP | Phase 136 context within the broader milestone | `.planning/milestones/v3.1-ROADMAP.md` |
</canonical_refs>

<domain>
## Phase Boundary

Introduce a provider-neutral `LlmRuntimeService` seam at `src/llm-runtime/`. Extract every current Agent SDK call into an `AnthropicAgentSdkBackend` implementation behind the seam. **Zero behavior change for the current deploy** — this is pure scaffolding for Phases 137 (AnthropicApiKey backend), 138 (failover), 140 (interactive Claude Code CLI), 141 (OpenAI Codex), 142 (OpenRouter).

The pattern mirrors Phase 117's `AdvisorService` 1:1:
- Interface at `src/llm-runtime/llm-runtime-service.ts` defining the operations the runtime exposes.
- Backends at `src/llm-runtime/backends/*.ts` — initially only `anthropic-agent-sdk.ts` (the current behavior).
- Per-agent config flag `agent.llmRuntime.backend` cascading over `defaults.llmRuntime.backend`.
- Schema accepts only `"anthropic-agent-sdk"` value at this wave. Phase 137 widens the union.

**In scope:**
- Define `LlmRuntimeService` TypeScript interface covering the surface ClawCode actually uses (query/stream, abort, model selection, tool registration, advisor hand-off, rate-limit-event forwarding, fork session, etc).
- Extract every current `@anthropic-ai/claude-agent-sdk` call site into the `AnthropicAgentSdkBackend` class.
- Replace direct SDK calls in production code with `llmRuntime.<method>()` calls — single chokepoint per `feedback_silent_path_bifurcation`.
- Per-agent `llmRuntime: { backend: "anthropic-agent-sdk" }` schema in `clawcode.yaml` (Zod). Defaults to `anthropic-agent-sdk` when omitted (back-compat).
- Existing test suite passes unchanged. Adding NEW seam-level tests is allowed; rewriting existing tests is in scope only when their imports of the SDK need redirection to the seam.

**Out of scope (deferred to later v3.1 phases):**
- AnthropicApiKey backend (Phase 137).
- Per-agent backend SELECTION (Phase 137 widens the Zod union to accept multiple values).
- Credit telemetry + failover (Phase 138).
- Interactive Claude Code CLI backend (Phase 140, probe-gated on Phase 139).
- OpenAI Codex / OpenRouter backends (Phases 141 / 142).
- Tool-use schema translator (Phase 141).
- AdvisorService integration changes — Phase 117's seam stays as-is; Phase 136 just makes sure the executor's runtime is pluggable underneath it.

</domain>

<decisions>
## Implementation Decisions

### Package location + shape

- **D-01:** **`src/llm-runtime/` package**, mirroring `src/advisor/` from Phase 117. Files:
  ```
  src/llm-runtime/
    llm-runtime-service.ts          # interface + default factory
    backends/
      anthropic-agent-sdk.ts        # current behavior, extracted verbatim
      portable-fork.ts              # SCAFFOLD ONLY (throws documented deferred error per Phase 117 precedent)
    index.ts                        # barrel export
    __tests__/
      llm-runtime-service.test.ts   # interface conformance test
      anthropic-agent-sdk.test.ts   # backend behavior pinning
  ```
- **D-01a:** **`portable-fork.ts` scaffold** mirrors Phase 117's same-named scaffold — exports a class whose `query()` throws `new Error("portable-fork backend deferred — see Phase 14X")`. Not selectable in config (Zod schema rejects the value). Documents the future extension point.

### Interface shape (what to extract)

- **D-02:** **Interface surface** defined by the operations ClawCode actually uses today. Plan-research surveys `src/manager/session-adapter.ts` + `src/manager/persistent-session-handle.ts` + any other `@anthropic-ai/claude-agent-sdk` importer to enumerate the call sites. The interface MUST cover:
  - `query(options)` — the main streaming call site
  - `forkSession(...)` — Phase 117 + Phase 124 hot-swap use this
  - `abortSignal` plumbing — Phase 127 stream-stall trip + Phase 124 mid-turn cancel
  - `partial-message streaming` events (`stream_event`, `content_block_delta`)
  - `rate_limit_event` forwarding — Phase 999.4 + Phase 128 consume these
  - Tool / MCP server registration shape — `mcpServers`, `disallowedTools`, `alwaysLoad` (Phase 999.54)
  - Model selection — currently a string passed to `query.setModel(...)` (Phase 117 advisor + Phase 999.X model-picker)
  - Session-control IPC (effort / permissionMode / maxThinkingTokens — Phase 999.31)
- **D-02a:** **Interface is provider-neutral** — names operations functionally ("query", "abortQuery", "forkSession") not in Anthropic-specific terms ("createMessage"). Phase 141 (Codex) and Phase 142 (OpenRouter) can implement it without naming-impedance.

### Backend selection at the seam

- **D-03:** **Factory at `src/llm-runtime/llm-runtime-service.ts`** returns the configured backend per agent:
  ```ts
  function createLlmRuntimeService(config: ResolvedAgentConfig, deps: LlmRuntimeDeps): LlmRuntimeService {
    switch (config.llmRuntime.backend) {
      case "anthropic-agent-sdk": return new AnthropicAgentSdkBackend(config, deps);
      // case "anthropic-api-key": return new AnthropicApiKeyBackend(config, deps); // Phase 137
      // case "claude-code-interactive": return new ClaudeCodeInteractiveBackend(...); // Phase 140
      default: throw new Error(`Unknown llmRuntime.backend: ${config.llmRuntime.backend}`);
    }
  }
  ```
- **D-03a:** **Construction site:** wherever the daemon currently constructs `SessionConfigDeps` / `session-adapter` / `persistent-session-handle`. ONE factory call per agent per session. Per `feedback_silent_path_bifurcation`: NO direct `@anthropic-ai/claude-agent-sdk` imports outside `src/llm-runtime/backends/anthropic-agent-sdk.ts` after this phase.

### Config schema (the locked default at this wave)

- **D-04:** **Per-agent schema (Zod):**
  ```ts
  llmRuntime: z.object({
    backend: z.enum(["anthropic-agent-sdk"]).default("anthropic-agent-sdk"),
  }).optional(),
  ```
  Default fallback at resolver — agents without `llmRuntime` block get `{ backend: "anthropic-agent-sdk" }`. The enum widens in Phase 137 to add `"anthropic-api-key"`.
- **D-04a:** **No `defaults.llmRuntime` baseline at this wave** — every agent uses the same backend. Phase 137 adds operator-facing per-agent overrides.

### Behavior change: ZERO

- **D-05:** **Zero behavior change.** Existing test suite passes unchanged. `npx vitest run` produces the same green/red as pre-phase. Phase 117's "scaffold first, no behavior change" approach is the proven precedent.
- **D-05a:** **Regression test:** add a static-grep CI check that asserts `grep -rn "@anthropic-ai/claude-agent-sdk" src/` returns matches ONLY in `src/llm-runtime/backends/anthropic-agent-sdk.ts` (and its tests). If any other file imports the SDK directly, the test fails. Prevents seam bypass.

### Per-call-site migration (the actual work)

- **D-06:** **Each Agent SDK call site is moved** from `session-adapter.ts` / `persistent-session-handle.ts` / etc. into `AnthropicAgentSdkBackend`'s methods. The caller now invokes `llmRuntime.<method>` instead of the SDK directly. Plan 01's tasks enumerate every call site individually (typically 1 task per call site cluster).

### Telemetry (operator-visible scaffold landed)

- **D-07:** **Structured log emission at seam construction** — `console.info("phase136-llm-runtime", JSON.stringify({agent, backend, model}))` matching Phase 999.54 / Phase 127 / Phase 128 precedent. Operator greps `journalctl -u clawcode -g phase136-llm-runtime` to confirm every agent picks up the seam.

### Reloadable

- **D-08:** **NON-reloadable.** Backend selection is a session-boot baseOptions field — captured at `query()` start, not per-turn. Same architectural pattern as Phase 999.54 alwaysLoad + Phase 117 advisor.backend. Document in `NON_RELOADABLE_FIELDS` set.

### Claude's Discretion

- File names: `llm-runtime-service.ts` / `anthropic-agent-sdk.ts` per Phase 117 idiom.
- Interface naming: provider-neutral verbs (D-02a).
- Test pattern: Phase 117's `AnthropicSdkAdvisor` tests (`src/advisor/backends/__tests__/anthropic-sdk.test.ts`) are the closest precedent — extend pattern.
- Migration path for prior phases that imported the SDK directly: their imports update to import from `src/llm-runtime/` instead. NOT a breaking change for those phases — same TypeScript surface, different package.

</decisions>

<code_context>
## Existing Code Insights

- **Phase 117 advisor-backend seam is the EXACT template** — read `src/advisor/{advisor-service,types}.ts` for the seam shape, `src/advisor/backends/anthropic-sdk.ts` for the backend implementation, `src/advisor/backends/legacy-fork.ts` for the multi-backend pattern. Mirror these idioms 1:1 — operators already understand them.
- **Phase 117 added `agent.advisor.backend` config field** — Phase 136 adds `agent.llmRuntime.backend` parallel. Same Zod cascade, same NON_RELOADABLE_FIELDS classification.
- **`session-adapter.ts` is the primary SDK consumer** (~2000 lines) — it's where the bulk of the migration lands. Plan-research enumerates every `import * from "@anthropic-ai/claude-agent-sdk"` call site.
- **`persistent-session-handle.ts`** also imports the SDK (Phase 124 hot-swap + Phase 127 stream-stall). Both phases shipped recently — confirm the seam covers the new code paths.
- **Phase 117 `AdvisorService` already handles advisor calls via its own seam** — Phase 136 doesn't touch advisor wiring. The executor's primary runtime (the seam Phase 136 introduces) is independent from the advisor's runtime.
- **`forkSession`** is used by Phase 117 (advisor fork) AND Phase 124 (compaction live hot-swap). The interface must cover both call patterns.

</code_context>

<specifics>
## Specific Ideas

- **Phase 117 mirror precision:** `src/advisor/` has `advisor-service.ts`, `types.ts`, `backends/anthropic-sdk.ts`, `backends/legacy-fork.ts`. Phase 136 produces `src/llm-runtime/llm-runtime-service.ts`, `types.ts`, `backends/anthropic-agent-sdk.ts`. (No `legacy-fork` — there's no fork-orchestration to fall back to for the primary executor runtime; that's what `portable-fork.ts` scaffold is for in Phases 140+.)
- **Interface name:** `LlmRuntimeService` (NOT `LlmService` — too generic; NOT `ExecutorRuntime` — overloaded with cron executor; NOT `AgentRuntime` — confused with `ResolvedAgentConfig`). Matches `AdvisorService` cadence.
- **Log key:** `phase136-llm-runtime` matching precedent.
- **Static-grep CI check** is the long-term anti-bypass sentinel.

</specifics>

<deferred>
## Deferred Ideas

- **Per-agent backend SELECTION** — Phase 137. v3.1 hard-deadline track.
- **Credit telemetry + failover** — Phase 138.
- **Interactive Claude Code CLI backend** — Phase 140, probe-gated by Phase 139.
- **OpenAI Codex / OpenRouter backends** — Phases 141 / 142.
- **Tool-use schema translator** — Phase 141 owns.
- **Local model backends (Ollama, llama.cpp)** — v3.x.

</deferred>

<scope_creep_guardrail>
## Scope Guardrail

Phase 136 scope:
- **YES:** Seam interface + AnthropicAgentSdkBackend + scaffold portable-fork + per-agent llmRuntime.backend config (single-value enum) + static-grep regression test.
- **NO:** Any additional backend implementation, any operator-facing failover, any credit telemetry, any prompt-cache changes (Phase 115 owns), any cost-tracking changes (Phase 128 just shipped).

Reject "while we're at it, add Codex" — Phase 141. "While we're at it, add credit alerts" — Phase 138.

</scope_creep_guardrail>
