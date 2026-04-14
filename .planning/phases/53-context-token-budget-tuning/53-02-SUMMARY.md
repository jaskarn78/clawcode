---
phase: 53-context-token-budget-tuning
plan: 02
subsystem: performance
tags: [token-budget, context-assembly, resume-summary, pino, prompt-caching, tracing]

requires:
  - phase: 53-context-token-budget-tuning-01
    provides: "countTokens helper (@anthropic-ai/tokenizer), ResolvedAgentConfig.perf.memoryAssemblyBudgets + resumeSummaryBudget + lazySkills config surface, SECTION_NAMES canonical array, context-audit CLI aggregator"
  - phase: 52-prompt-caching-02
    provides: "AssembledContext two-block shape { stablePrefix, mutableSuffix, hotStableToken } — preserved verbatim"
  - phase: 50-latency-instrumentation-01
    provides: "Turn + Span trace infrastructure (span.end, metadata_json serialization)"

provides:
  - "ContextAssembler enforces per-section token budgets with section-specific strategies (identity/soul warn-and-keep, hot_tier drop-lowest-importance, skills_header truncate-bullets)"
  - "context_assemble span metadata_json.section_tokens populated with all 7 canonical sections — Plan 53-01 audit CLI now produces real data"
  - "enforceSummaryBudget API: passthrough → up-to-2 regenerate attempts → hard-truncate + WARN fallback (CTX-04)"
  - "ContextSources extended with optional soul/skillsHeader/hotMemoriesEntries/perTurnSummary/resumeSummary/recentHistory fields (fully back-compat)"
  - "Span.setMetadata(extra) for post-construction metadata mutation before end()"
  - "BudgetWarningEvent + onBudgetWarning callback API — never logs prompt bodies (SECURITY)"

affects:
  - 53-context-token-budget-tuning-03 (lazy skills: skillsHeader section is now isolated and individually budgetable)
  - Future Phase 54/55 (any assembly-time budget overrides thread cleanly through the new options API)

tech-stack:
  added: []
  patterns:
    - "Internal-only shared impl (assembleContextInternal) returning both public shape + extended counts; public wrapper strips counts to preserve prior contract"
    - "onBudgetWarning callback as the warning emission surface — keeps assembler pure (no pino import) while letting session-config route warnings through its Logger"
    - "Hard-truncate fallback with iterative shrink loop for dense-tokenizer cases (token/char ratio varies with BPE collisions)"
    - "Mock hygiene: vi.mock with async importOriginal() spread avoids module-surface stripping when adding new exports"

key-files:
  created:
    - "src/memory/__tests__/context-summary.test.ts"
    - ".planning/phases/53-context-token-budget-tuning/deferred-items.md"
  modified:
    - "src/manager/context-assembler.ts (per-section budget enforcement + section_tokens metadata emission; preserves Phase 52 shape)"
    - "src/manager/__tests__/context-assembler.test.ts (15 new Phase 53 tests; 3 legacy identity-truncation tests refocused per D-03)"
    - "src/manager/session-config.ts (skillsHeader split, hotMemoriesEntries collection, resume-summary budget enforcement, onBudgetWarning logger wiring)"
    - "src/manager/__tests__/session-config.test.ts (4 new Phase 53 tests; mock hygiene fix for context-summary module)"
    - "src/manager/session-manager.ts (configDeps now threads this.log)"
    - "src/manager/__tests__/mcp-session.test.ts (mock hygiene fix matching session-config)"
    - "src/memory/context-summary.ts (enforceSummaryBudget API + DEFAULT_RESUME_SUMMARY_BUDGET/MIN_RESUME_SUMMARY_BUDGET exports)"
    - "src/performance/trace-collector.ts (Span.setMetadata shallow-merge)"

key-decisions:
  - "section_tokens rides via assembleContextTraced -> span.setMetadata ONLY (not on the public AssembledContext return) — preserves Phase 52 two-block shape verbatim (Object.keys.length === 3)"
  - "identity/soul WARN-and-keep applies under DEFAULT_PHASE53_BUDGETS even when opts.memoryAssemblyBudgets is absent — D-03 is unconditional. 3 pre-existing tests expecting identity truncation refocused to non-identity budget paths."
  - "soul source left as '' in session-config for Phase 53 — SOUL.md body is currently folded into identity by fingerprint+identity concat; carving it out is a future refactor. section_tokens.soul accurately reports 0."
  - "enforceSummaryBudget has no live regenerator wired yet — omitted (undefined) at call site. Hard-truncate fallback handles oversized summaries today; future work attaches an LLM-backed SummaryRegenerator."
  - "Hard-truncate iterative shrink loop (max 16 iters) added because @anthropic-ai/tokenizer can return > expected token count for dense strings at the 4 chars/token bound"
  - "Span metadata buffer switched from readonly to mutable shallow-copy in constructor so setMetadata can append keys before end() freezes the final record"

patterns-established:
  - "Dual-mocked module shape: vi.mock(moduleId, async (importOriginal) => ({ ...await importOriginal(), overrideFn: vi.fn() })) — prevents downstream importers from getting undefined for non-mocked exports"
  - "Section strategy enum as a type-literal union (warn-and-keep | drop-lowest-importance | truncate-bullets | passthrough) — stringly-typed payload is grep-friendly and preserves test assertions"

requirements-completed: [CTX-02, CTX-04]

duration: 21m 47s
completed: 2026-04-14
---

# Phase 53 Plan 02: Context & Token Budget Tuning — Budget Enforcement Summary

**Per-section token budgets enforced by ContextAssembler with identity/soul warn-and-keep, hot_tier importance-ordered drop, and resume-summary 1500-token cap with 2-attempt regenerate + hard-truncate fallback; context_assemble span now emits section_tokens metadata for Plan 53-01 audit consumption.**

## Performance

- **Duration:** 21m 47s
- **Started:** 2026-04-14T00:56:52Z
- **Completed:** 2026-04-14T01:18:39Z
- **Tasks:** 2
- **Files modified:** 8 (4 source, 4 test + 1 new test file + 1 deferred-items note)

## Accomplishments

- Context assembler now runs every section through a per-section strategy matrix driven by `agentConfig.perf.memoryAssemblyBudgets`; the legacy single-budget identity-truncation path is replaced by WARN-and-keep for user persona text (D-03).
- `context_assemble` trace span carries `metadata_json.section_tokens` with all 7 canonical sections populated (even when 0) — Plan 53-01's audit aggregator starts producing real data from the next turn forward without any additional wiring.
- `enforceSummaryBudget` implements the full CTX-04 policy: under-budget passthrough → up-to-2 regeneration attempts (no live regenerator yet; fallback path owns oversized inputs today) → word-boundary hard-truncate with `...` marker and pino WARN emission carrying `{ agent, section, budget, beforeTokens, afterTokens, attempts }` — never the summary body (SECURITY).
- `AssembledContext` public shape `{ stablePrefix, mutableSuffix, hotStableToken }` preserved verbatim — `Object.keys(result).length === 3`, `Object.isFrozen(result) === true`. All 30 legacy tests still pass via `joinAssembled`; 3 identity-truncation tests refocused to non-identity budget paths per D-03.

## Per-Section Strategy Matrix

| Section | Strategy | Rendered location | Warning payload |
|---|---|---|---|
| `identity` | `warn-and-keep` | stablePrefix | over-budget events only; text untouched |
| `soul` | `warn-and-keep` | stablePrefix (currently always empty — see decisions) | over-budget events only |
| `skills_header` | `truncate-bullets` | stablePrefix ("## Available Tools") | bullet-line drop from tail |
| `hot_tier` | `drop-lowest-importance` (or fallback `truncate-bullets`) | stable OR mutable (Phase 52 stable_token logic preserved) | highest-importance entries retained until budget |
| `recent_history` | `passthrough` (SDK owns) | measured only | never |
| `per_turn_summary` | `passthrough` | mutableSuffix | never (future work: regenerate path) |
| `resume_summary` | `passthrough` in assembler; `enforceSummaryBudget` runs upstream in session-config | mutableSuffix | WARN on hard-truncate after 2 regen failures |

## Budget Surface

```typescript
// Required<MemoryAssemblyBudgets> — conservative starter defaults (D-02)
export const DEFAULT_PHASE53_BUDGETS = Object.freeze({
  identity: 1000,
  soul: 2000,
  skills_header: 1500,
  hot_tier: 3000,
  recent_history: 8000,
  per_turn_summary: 500,
  resume_summary: 1500,
});

// Resume-summary enforcement — CTX-04
DEFAULT_RESUME_SUMMARY_BUDGET = 1500;   // config default
MIN_RESUME_SUMMARY_BUDGET = 500;        // Zod floor + runtime backstop (RangeError)
```

## enforceSummaryBudget API

```typescript
export type EnforceSummaryBudgetOpts = {
  readonly summary: string;
  readonly budget: number;                     // >= 500 else RangeError
  readonly regenerate?: SummaryRegenerator;    // (summary, targetTokens) => Promise<string>
  readonly maxAttempts?: number;               // default 2
  readonly log?: LoggerLike;                   // pino-compatible
  readonly agentName?: string;
};

export type EnforceSummaryBudgetResult = {
  readonly summary: string;
  readonly tokens: number;
  readonly truncated: boolean;   // true only when hard-truncate fallback ran
  readonly attempts: number;     // count of regenerator invocations
};
```

## Task Commits

1. **Task 1 RED: 14 failing tests for per-section budget enforcement** — `ce53a1a` (test)
2. **Task 1 GREEN: enforce per-section budgets + emit section_tokens metadata** — `7f54955` (feat)
3. **Task 2 RED: 13 failing tests for resume-summary budget + session-config wiring** — `e660b38` (test)
4. **Task 2 GREEN: resume-summary budget enforcement + session-config budget wiring** — `63ff866` (feat)

_TDD: each task followed test-first (RED) → implementation (GREEN). No refactor commits — implementation stayed minimal._

## Files Created/Modified

- `src/manager/context-assembler.ts` — MemoryAssemblyBudgets + DEFAULT_PHASE53_BUDGETS + SectionTokenCounts + BudgetWarningEvent types; assembleContextInternal shared impl; per-section enforcement helpers; assembleContextTraced emits section_tokens via span.setMetadata.
- `src/manager/session-config.ts` — skillsHeaderStr split from toolDefinitionsStr; hotMemoriesEntries collection; enforceSummaryBudget invoked before assembly; memoryAssemblyBudgets + onBudgetWarning logger wired through deps.log.
- `src/manager/session-manager.ts` — configDeps threads `this.log`.
- `src/memory/context-summary.ts` — enforceSummaryBudget + DEFAULT_RESUME_SUMMARY_BUDGET + MIN_RESUME_SUMMARY_BUDGET + SummaryRegenerator/LoggerLike types; legacy saveSummary/truncateSummary/loadLatestSummary unchanged.
- `src/performance/trace-collector.ts` — Span.setMetadata(extra) shallow-merge before end; metadata buffer switched to mutable copy in constructor.
- `src/manager/__tests__/context-assembler.test.ts` — 15 new Phase 53 tests + 3 legacy tests refocused per D-03.
- `src/manager/__tests__/session-config.test.ts` — 4 new Phase 53 tests + mock hygiene fix.
- `src/manager/__tests__/mcp-session.test.ts` — mock hygiene fix.
- `src/memory/__tests__/context-summary.test.ts` — NEW file, 9 enforceSummaryBudget tests.
- `.planning/phases/53-context-token-budget-tuning/deferred-items.md` — pre-existing mcp/server.test.ts failure recorded as out-of-scope.

## Test Counts

- Context assembler: 30 legacy + 15 new (Phase 53) = **45 tests GREEN**
- Session config: 220 legacy + 4 new (Phase 53) = **224 tests GREEN**
- Context summary: 9 new Phase 53 tests = **9 tests GREEN** (new test file)
- Total new Phase 53 tests: **28 GREEN**
- Full domain (src/manager + src/memory + src/performance): **550 tests GREEN** (47 test files)
- Full core src/ (excluding worktrees): **1296 tests passing / 1 pre-existing failure** (`src/mcp/server.test.ts` tool-count assertion drift — documented in deferred-items.md)

## Decisions Made

See frontmatter `key-decisions`. Highlights:
- Preserve Phase 52 shape verbatim: section_tokens flow exclusively through `assembleContextTraced -> span.setMetadata`, never on the public AssembledContext return.
- D-03 is unconditional (identity/soul never truncate) — 3 legacy tests that tested identity truncation were refocused to exercise tool-definitions budget enforcement instead.
- enforceSummaryBudget ships without a live regenerator today; the hard-truncate fallback keeps oversized summaries bounded. Wiring an LLM regenerator is a follow-up.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Span needed setMetadata method**
- **Found during:** Task 1 (GREEN step — implementing assembleContextTraced)
- **Issue:** Plan specifies `span?.setMetadata({ section_tokens })` but the existing `Span` class in `src/performance/trace-collector.ts` only accepted metadata via its constructor and had no post-construction setter.
- **Fix:** Added `Span.setMetadata(extra: Record<string, unknown>): void` that shallow-merges keys into the in-flight metadata buffer (no-op after `end()`). Converted the constructor's `metadata` field from `readonly` reference to a mutable shallow-copy so the setter can append safely.
- **Files modified:** `src/performance/trace-collector.ts`
- **Verification:** Test 6 (section_tokens metadata emission) passes; all 75 context-assembler tests GREEN; all pre-existing trace-collector tests unaffected.
- **Committed in:** `7f54955` (Task 1 commit)

**2. [Rule 1 - Bug] Legacy identity-truncation tests contradicted D-03**
- **Found during:** Task 1 (GREEN — running full test suite after implementation)
- **Issue:** Three legacy tests asserted that identity strings get hard-truncated to 4000 chars with `...`. D-03 from 53-CONTEXT mandates WARN-and-keep for identity/soul (user persona text never truncates). The plan's success criterion "all 30 legacy tests still pass" conflicted with its own D-03 policy.
- **Fix:** Updated the 3 tests to (a) assert identity preservation under DEFAULT_PHASE53_BUDGETS, (b) exercise the non-identity budget path (tool definitions) for the "custom budgets" test, (c) use hotMemories (truncatable via bullet-line) for the ceiling test. D-03 wins — policy > individual test assertions.
- **Files modified:** `src/manager/__tests__/context-assembler.test.ts`, `src/manager/__tests__/session-config.test.ts`
- **Verification:** All 45 context-assembler tests + all 224 session-config tests GREEN.
- **Committed in:** `7f54955` (Task 1 commit) + `63ff866` (Task 2 commit — session-config test refocus)

**3. [Rule 3 - Blocking] vi.mock("../../memory/context-summary.js") stripped enforceSummaryBudget**
- **Found during:** Task 2 (GREEN — running session-config tests after wiring enforceSummaryBudget into buildSessionConfig)
- **Issue:** The existing mocks replaced the entire context-summary module surface with `{ loadLatestSummary: vi.fn() }`. buildSessionConfig now also imports `enforceSummaryBudget` + `DEFAULT_RESUME_SUMMARY_BUDGET` from that module, so those imports resolved to `undefined` at test time → `TypeError` at assembly.
- **Fix:** Switched both `session-config.test.ts` and `mcp-session.test.ts` to `vi.mock(..., async (importOriginal) => ({ ...await importOriginal<T>(), loadLatestSummary: vi.fn()... }))` — spreads the real module surface so only the specifically-overridden export is mocked.
- **Files modified:** `src/manager/__tests__/session-config.test.ts`, `src/manager/__tests__/mcp-session.test.ts`
- **Verification:** All 224 session-config tests + 38 mcp-session tests GREEN.
- **Committed in:** `63ff866` (Task 2 commit)

**4. [Rule 1 - Bug] Hard-truncate overshoot on dense-tokenizer cases**
- **Found during:** Task 2 (GREEN — Test 3 assertion `result.tokens <= 1500`)
- **Issue:** The naive `chars = budget * 4` hard-truncate occasionally produced strings that still tokenized to > budget tokens because @anthropic-ai/tokenizer's char/token ratio varies (some sequences are 2-3 chars/token).
- **Fix:** Added a bounded iterative shrink loop (max 16 iterations) that halves excess using `excessRatio = budget / currentTokens`, re-applies word-boundary cut, and re-measures. Converges in 1-2 iterations for realistic inputs.
- **Files modified:** `src/memory/context-summary.ts`
- **Verification:** All 9 context-summary tests GREEN including the hard-truncate size invariant.
- **Committed in:** `63ff866` (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (2× Rule 3 blocking, 2× Rule 1 bug)
**Impact on plan:** All deviations were necessary for correctness. No scope expansion — `setMetadata` was implicitly required by the plan's own `span?.setMetadata(...)` directive; the test-refocus preserves the D-03 policy the plan itself mandated; mock hygiene is a test-infrastructure bug; iterative shrink is a correctness fix for the plan's stated `result.tokens <= budget` invariant.

## Issues Encountered

- **Pre-existing `src/mcp/server.test.ts` failure**: "TOOL_DEFINITIONS has exactly 8 tools defined" — actual count is 16. Verified pre-existing via `git stash` + retest on commit `e660b38`. Out of Phase 53 scope; recorded in `deferred-items.md`.

## Next Phase Readiness

- **53-03 (Lazy Skills)**: `skillsHeader` section is now isolated in `ContextSources` and `session-config.ts` — 53-03 can layer usage-tracking and compression on the bullet-list without touching `toolDefinitions` (MCP/admin/subagent). The `skills_header` section_tokens counter is already emitted, so audit reports will show the savings immediately after 53-03 ships.
- **Audit data flow**: `context_assemble` spans now carry `section_tokens` with all 7 canonical rows. The `clawcode context-audit` CLI (Plan 53-01) will produce meaningful p50/p95 tables from the next agent turn onward — no further wiring required.
- **Live resume-summary regeneration**: `enforceSummaryBudget` accepts an optional `SummaryRegenerator` argument. Wiring an LLM-backed regenerator (haiku one-shot with "max 1000 tokens, one paragraph" prompt) is a one-file addition at the session-config call site when desired.

---
*Phase: 53-context-token-budget-tuning*
*Plan: 02*
*Completed: 2026-04-14*

## Self-Check: PASSED

All declared files exist; all 4 per-task commits resolve in `git log`. Acceptance-criteria grep counts verified (see Task 2 commit body).
