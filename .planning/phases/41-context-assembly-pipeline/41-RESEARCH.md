# Phase 41: Context Assembly Pipeline - Research

**Researched:** 2026-04-10
**Domain:** System prompt composition with per-source token budgets
**Confidence:** HIGH

## Summary

This phase extracts the ad-hoc system prompt assembly logic from `buildSessionConfig()` (lines 62-204 in `src/manager/session-config.ts`) into a deterministic pure function `assembleContext()`. The new module applies configurable per-source token budgets so no single context source can starve others, and the total assembled prompt stays under a defined ceiling.

The implementation is straightforward: no new dependencies needed, no external tools, no complex algorithms. It is a refactor of existing string concatenation into a structured pipeline with budget enforcement using character-count-based token estimation (chars / 4).

**Primary recommendation:** Create `src/manager/context-assembler.ts` as a pure function that receives pre-fetched context sources and budget config, independently truncates each source to its budget, and returns the concatenated result. Refactor `buildSessionConfig()` to delegate to it.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Default per-source token budgets: Identity fingerprint: 1000 tokens, Hot memories: 3000 tokens (top 3), Tool definitions: 2000 tokens, Graph context: 2000 tokens. Total ceiling: ~8000 tokens
- Each source independently truncated to its budget. Slack is NOT redistributed (deterministic)
- Per-agent configurable via `contextBudgets` field in clawcode.yaml agent config. Falls back to defaults
- Sequential pipeline: identity -> hot memories -> tool definitions -> graph context (if any) -> Discord bindings -> context summary
- New `src/manager/context-assembler.ts` module with pure function: `assembleContext(config, deps, budgets) -> string`
- `buildSessionConfig` function signature stays the same for backward compatibility
- Token estimation: character count / 4 (no tokenizer dependency)
- Section headers use markdown `## ` headings
- Discord bindings and context summary are pass-through (no budget, always included as-is)

### Claude's Discretion
- Internal implementation details of the assembler (helper functions, truncation strategy)
- Test structure and fixture design
- How to handle edge cases (empty sources, sources shorter than budget)

### Deferred Ideas (OUT OF SCOPE)
- Dynamic budget reallocation based on conversation phase
- Token-accurate counting via a tokenizer library
- Budget optimization recommendations
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LOAD-03 | Context assembly pipeline composes identity, memories, graph results, and tools with per-source token budgets | Core deliverable. Assembler function applies independent budgets per source, concatenates with section headers, enforces total ceiling. Backward-compatible refactor of buildSessionConfig. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 4.3.6 | Schema validation for contextBudgets config | Already in project, used for all config schemas |

### Supporting
No new dependencies needed. This phase uses only existing project libraries.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| chars/4 estimation | tiktoken / gpt-tokenizer | Accurate but adds ~2MB dependency for minimal gain at this scale |
| Fixed budgets (no redistribution) | Dynamic slack redistribution | More efficient but non-deterministic, harder to debug |

## Architecture Patterns

### Recommended Project Structure
```
src/manager/
├── context-assembler.ts       # NEW: Pure assembleContext() function
├── session-config.ts          # MODIFIED: Delegates to assembleContext()
└── types.ts                   # MODIFIED: Add ContextBudgets type if needed here
src/config/
├── schema.ts                  # MODIFIED: Add contextBudgetsSchema
src/shared/
└── types.ts                   # MODIFIED: Add contextBudgets to ResolvedAgentConfig
```

### Pattern 1: Pure Context Assembly Function

**What:** A stateless function that receives all pre-fetched data and budget config, returns a composed string.

**When to use:** Always -- this IS the core deliverable.

**Example:**
```typescript
// src/manager/context-assembler.ts

export type ContextBudgets = {
  readonly identity: number;   // token budget (default 1000)
  readonly hotMemories: number; // token budget (default 3000)
  readonly toolDefinitions: number; // token budget (default 2000)
  readonly graphContext: number; // token budget (default 2000)
};

export const DEFAULT_BUDGETS: ContextBudgets = Object.freeze({
  identity: 1000,
  hotMemories: 3000,
  toolDefinitions: 2000,
  graphContext: 2000,
});

export type ContextSources = {
  readonly identity: string;      // formatted fingerprint
  readonly hotMemories: string;   // formatted memory bullets
  readonly toolDefinitions: string; // skill + MCP tool descriptions
  readonly graphContext: string;   // graph-expanded results (may be empty)
  readonly discordBindings: string; // pass-through, no budget
  readonly contextSummary: string;  // pass-through, no budget
};

/** Estimate tokens from character count. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Truncate text to fit within a token budget. */
function truncateTobudget(text: string, tokenBudget: number): string {
  const maxChars = tokenBudget * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + "...";
}

/**
 * Assemble context from sources with per-source token budgets.
 * Returns a composed system prompt string.
 */
export function assembleContext(
  sources: ContextSources,
  budgets: ContextBudgets = DEFAULT_BUDGETS,
): string {
  const sections: string[] = [];

  // Budgeted sources (order matters per CONTEXT.md)
  if (sources.identity) {
    sections.push(truncateTobudget(sources.identity, budgets.identity));
  }
  if (sources.hotMemories) {
    sections.push("## Key Memories\n\n" + truncateTobudget(sources.hotMemories, budgets.hotMemories));
  }
  if (sources.toolDefinitions) {
    sections.push("## Available Tools\n\n" + truncateTobudget(sources.toolDefinitions, budgets.toolDefinitions));
  }
  if (sources.graphContext) {
    sections.push("## Related Context\n\n" + truncateTobudget(sources.graphContext, budgets.graphContext));
  }

  // Pass-through sources (no budget, always included)
  if (sources.discordBindings) {
    sections.push(sources.discordBindings);
  }
  if (sources.contextSummary) {
    sections.push(sources.contextSummary);
  }

  return sections.join("\n\n");
}
```

### Pattern 2: Schema Extension for contextBudgets

**What:** Add optional `contextBudgets` field to the agent config schema.

**Example:**
```typescript
// Addition to src/config/schema.ts
export const contextBudgetsSchema = z.object({
  identity: z.number().int().positive().default(1000),
  hotMemories: z.number().int().positive().default(3000),
  toolDefinitions: z.number().int().positive().default(2000),
  graphContext: z.number().int().positive().default(2000),
});

// In agentSchema:
contextBudgets: contextBudgetsSchema.optional(),
```

### Pattern 3: Backward-Compatible Refactor of buildSessionConfig

**What:** The existing function continues to work identically. Its internals delegate to `assembleContext()`.

**Key insight:** `buildSessionConfig` currently reads SOUL.md, calls `extractFingerprint`, fetches hot memories, etc. After refactor, it still does all that data-fetching, but passes the results into `assembleContext()` for composition. The data-fetching stays in `buildSessionConfig`; the composition logic moves to `assembleContext`.

### Anti-Patterns to Avoid
- **Mutating the system prompt string in-place across multiple functions:** Keep a single `assembleContext` call that produces the final string.
- **Coupling budget logic to data fetching:** The assembler must not import TierManager or read files. It receives strings.
- **Redistributing slack tokens:** Per CONTEXT.md, unused budget is NOT redistributed. Keep it deterministic.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | Actual tokenizer | chars / 4 approximation | Per user decision. Close enough for budget enforcement without dependency |
| Config validation | Manual parsing | zod schema (already in project) | Consistent with all other config fields |

## Common Pitfalls

### Pitfall 1: Section Header Counted Against Budget
**What goes wrong:** The `## Key Memories` header eats into the memory token budget, reducing actual memory content allowed.
**Why it happens:** Developers include headers inside the truncation boundary.
**How to avoid:** Add section headers OUTSIDE the truncateTobudget call. Only the content itself is subject to budget.
**Warning signs:** Tests show slightly less content than expected in budget-constrained sections.

### Pitfall 2: Truncating Mid-Word or Mid-Line for Memories
**What goes wrong:** A memory bullet gets cut in half: `- User prefers TypeSc...`
**Why it happens:** Character-level truncation doesn't respect semantic boundaries.
**How to avoid:** For memories (bullet list), truncate at line boundaries. Drop entire bullets that would exceed budget rather than cutting mid-bullet.
**Warning signs:** Garbled memory entries in system prompt.

### Pitfall 3: Breaking buildSessionConfig's Bootstrap Path
**What goes wrong:** The bootstrap flow (lines 34-59) is accidentally affected by the refactor.
**Why it happens:** Developer refactors too aggressively without preserving the early-return for bootstrap.
**How to avoid:** The bootstrap path is completely separate -- it returns early before any normal assembly. Leave it untouched.
**Warning signs:** Bootstrap agents getting budgeted prompts instead of walkthrough prompts.

### Pitfall 4: ResolvedAgentConfig Type Not Updated
**What goes wrong:** `contextBudgets` field exists in YAML config and zod schema but not in `ResolvedAgentConfig` type.
**Why it happens:** Three separate files need updating (schema.ts, types.ts, config resolver).
**How to avoid:** Update all three in the same task. The config resolver that merges defaults must pass `contextBudgets` through.
**Warning signs:** TypeScript compilation errors or `contextBudgets` always `undefined`.

### Pitfall 5: v1.5 Prompt Larger Than v1.4
**What goes wrong:** Success criterion 3 fails -- the new prompt is BIGGER because section headers and formatting add overhead.
**Why it happens:** Adding `## ` headers, newlines between sections, etc.
**How to avoid:** The existing `buildSessionConfig` already has headers (`## Key Memories`, `## Available Skills`, etc.). The new assembler should use the same headers, not additional ones. Compare output sizes in tests.
**Warning signs:** A test comparing old vs new output shows the new version is longer.

## Code Examples

### Current buildSessionConfig Flow (What Gets Refactored)
```typescript
// Current: ~145 lines of ad-hoc string concatenation
// After: data-fetch stays here, composition delegates to assembleContext()
export async function buildSessionConfig(
  config: ResolvedAgentConfig,
  deps: SessionConfigDeps,
  contextSummary?: string,
  bootstrapStatus?: BootstrapStatus,
): Promise<AgentSessionConfig> {
  // Bootstrap early-return stays unchanged
  if (bootstrapStatus === "needed") { /* ... unchanged ... */ }

  // Fetch all context sources (this stays)
  const identityStr = await fetchIdentitySource(config);
  const memoriesStr = formatHotMemories(deps.tierManagers.get(config.name));
  const toolsStr = formatToolDefinitions(config, deps);
  const graphStr = ""; // graph context when available
  const discordStr = formatDiscordBindings(config);
  const summaryStr = await fetchContextSummary(config, contextSummary);

  // NEW: Delegate composition to assembler
  const budgets = config.contextBudgets ?? DEFAULT_BUDGETS;
  const systemPrompt = assembleContext(
    { identity: identityStr, hotMemories: memoriesStr, toolDefinitions: toolsStr, graphContext: graphStr, discordBindings: discordStr, contextSummary: summaryStr },
    budgets,
  );

  return { name: config.name, model: config.model, workspace: config.workspace, systemPrompt: systemPrompt.trim(), channels: config.channels ?? [], contextSummary, mcpServers: config.mcpServers ?? [] };
}
```

### Token Estimation Utility
```typescript
/** Estimate token count from text. Approximation: 1 token ~ 4 characters. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Check if assembled context exceeds total ceiling. */
export function exceedsCeiling(assembled: string, ceiling: number = 8000): boolean {
  return estimateTokens(assembled) > ceiling;
}
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (latest) |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run src/manager/__tests__/context-assembler.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LOAD-03a | assembleContext applies per-source budgets independently | unit | `npx vitest run src/manager/__tests__/context-assembler.test.ts -t "truncates"` | Wave 0 |
| LOAD-03b | No source exceeds its budget (total stays under ceiling) | unit | `npx vitest run src/manager/__tests__/context-assembler.test.ts -t "ceiling"` | Wave 0 |
| LOAD-03c | v1.5 prompt size <= v1.4 prompt size for equivalent agent | unit | `npx vitest run src/manager/__tests__/context-assembler.test.ts -t "size comparison"` | Wave 0 |
| LOAD-03d | buildSessionConfig backward compatibility (same signature, same output shape) | unit | `npx vitest run src/manager/__tests__/session-config.test.ts` | Wave 0 |
| LOAD-03e | contextBudgets schema validates correctly | unit | `npx vitest run src/config/__tests__/schema.test.ts -t "contextBudgets"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/manager/__tests__/context-assembler.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before verification

### Wave 0 Gaps
- [ ] `src/manager/__tests__/context-assembler.test.ts` -- covers LOAD-03a, LOAD-03b, LOAD-03c
- [ ] `src/manager/__tests__/session-config.test.ts` -- covers LOAD-03d (may already exist partially)
- [ ] `src/config/__tests__/schema.test.ts` -- covers LOAD-03e (extend existing)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ad-hoc string concat in buildSessionConfig | Structured assembly with budgets | Phase 41 (this phase) | Predictable, testable prompt composition |
| No budget enforcement | Per-source token budgets | Phase 41 | Prevents context window waste |
| Full SOUL.md in prompt | Fingerprint (~300 tokens) | Phase 37 | Already implemented, assembler receives formatted fingerprint |

## Open Questions

1. **Admin agent sections (managed agents table, subagent config)**
   - What we know: These sections exist in current buildSessionConfig (lines 176-197)
   - What's unclear: Should they be budgeted sources or pass-through like Discord bindings?
   - Recommendation: Treat as part of "tool definitions" budget since they're operational context, not identity/memory.

2. **Graph context source availability**
   - What we know: GraphSearch exists from Phase 38, but it's currently only used by the memory_lookup tool, not by system prompt assembly
   - What's unclear: Whether graph results should be pre-fetched for the system prompt or only available on-demand via memory_lookup
   - Recommendation: Include the graph context slot in the pipeline but leave it empty string for now. The architecture supports it when needed.

## Sources

### Primary (HIGH confidence)
- `src/manager/session-config.ts` -- Current implementation (209 lines), direct code inspection
- `src/config/schema.ts` -- Agent schema with all existing fields
- `src/shared/types.ts` -- ResolvedAgentConfig type definition
- `src/memory/fingerprint.ts` -- extractFingerprint/formatFingerprint API
- `src/memory/tier-manager.ts` -- getHotMemories() returns readonly MemoryEntry[]

### Secondary (MEDIUM confidence)
- Phase 41 CONTEXT.md -- User decisions on budgets and architecture

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, purely internal refactor
- Architecture: HIGH -- decisions are locked, pattern is simple pure-function composition
- Pitfalls: HIGH -- based on direct code inspection of the refactor target

**Research date:** 2026-04-10
**Valid until:** 2026-05-10 (stable -- internal refactor, no external dependencies)
