# Phase 41: Context Assembly Pipeline - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Identity, memories, graph results, and tools are composed into context with explicit per-source token budgets. This phase creates a structured context assembly pipeline that replaces the ad-hoc assembly in `buildSessionConfig`, organizing all context sources with configurable budgets that prevent any single source from starving others.

</domain>

<decisions>
## Implementation Decisions

### Budget Allocation
- Default per-source token budgets: Identity fingerprint: 1000 tokens, Hot memories: 3000 tokens (top 3), Tool definitions: 2000 tokens, Graph context: 2000 tokens. Total ceiling: ~8000 tokens
- Each source is independently truncated to its budget. If a source is under budget, the slack is NOT redistributed — keeps the system deterministic
- Per-agent configurable via `contextBudgets` field in clawcode.yaml agent config. Falls back to defaults when not specified
- Still significantly structured compared to v1.4 approach which had no budgets

### Pipeline Architecture
- Sequential pipeline — each source assembled independently, concatenated with section headers. Order: identity → hot memories → tool definitions → graph context (if any) → Discord bindings → context summary
- New `src/manager/context-assembler.ts` module — replaces the body of `buildSessionConfig`. Pure function: `assembleContext(config, deps, budgets) → string`
- `buildSessionConfig` function signature stays the same for backward compatibility — just the internals are restructured to delegate to `assembleContext()`
- Per Anthropic's managed agents "context engineering" pattern: transforms in the harness before reaching Claude's context window

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/manager/session-config.ts` — `buildSessionConfig()` with current ad-hoc assembly (lines 60-204); refactor target
- `src/memory/fingerprint.ts` — `extractFingerprint()`, `formatFingerprint()` from Phase 37
- `src/memory/tier-manager.ts` — `getHotMemories()` returns hot-tier entries
- `src/memory/graph-search.ts` — `GraphSearch` for graph-enriched results from Phase 38
- `src/config/schema.ts` — agent config schema; add `contextBudgets` field
- `src/memory/compaction.ts` — `CharacterCountFillProvider` for context fill tracking

### Established Patterns
- Pure functions preferred for testability
- `Object.freeze()` on all returned objects
- Constructor injection for dependencies
- ESM with `.js` extensions, `node:` prefix for Node built-ins

### Integration Points
- `src/manager/context-assembler.ts` — new module with `assembleContext()` pure function
- `src/manager/session-config.ts` — refactor `buildSessionConfig()` to delegate to assembler
- `src/config/schema.ts` — add `contextBudgets` schema
- `src/shared/types.ts` — add `ContextBudgets` type to `ResolvedAgentConfig`

</code_context>

<specifics>
## Specific Ideas

- Token estimation: use character count / 4 as rough token estimate (standard approximation). No need for a tokenizer dependency
- The assembler should be a pure function with no side effects — easy to test with deterministic inputs
- Section headers in the assembled context should be markdown `## ` headings for Claude readability
- Discord bindings and context summary sections are pass-through (no budget, always included as-is)

</specifics>

<deferred>
## Deferred Ideas

- Dynamic budget reallocation based on conversation phase (early = more identity, mid = more memories) — too complex for v1.5
- Token-accurate counting via a tokenizer library — character/4 is good enough
- Budget optimization recommendations ("your identity section only uses 200/1000 tokens, consider reducing")

</deferred>
