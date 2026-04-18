---
phase: 67-resume-auto-injection
plan: 01
subsystem: memory

tags: [typescript, zod, vitest, conversation-brief, session-summary, context-assembly, tdd]

# Dependency graph
requires:
  - phase: 66-session-summarization
    provides: session summaries written to MemoryStore as source="conversation" MemoryEntries tagged ["session-summary", "session:{id}"]
  - phase: 64-conversation-schema
    provides: ConversationStore.listRecentSessions(agentName, limit) — ordered by started_at DESC, rowid DESC
  - phase: 53-context-assembly
    provides: countTokens() from src/performance/token-count.ts — canonical BPE token counter
provides:
  - "src/memory/conversation-brief.ts — pure DI helper `assembleConversationBrief` that renders last-N session summaries as markdown with gap-skip and accumulate budget"
  - "src/memory/conversation-brief.types.ts — AssembleBriefInput/Deps/Config/Result discriminated-union contracts"
  - "Named export constants: DEFAULT_RESUME_SESSION_COUNT=3, DEFAULT_RESUME_GAP_THRESHOLD_HOURS=4, DEFAULT_CONVERSATION_CONTEXT_BUDGET=2000, MIN_CONVERSATION_CONTEXT_BUDGET=500"
  - "conversationConfigSchema extended with resumeSessionCount (int, min 1, max 10, default 3), resumeGapThresholdHours (number, min 0, default 4), conversationContextBudget (int, min 500, default 2000)"
  - "ResolvedAgentConfig.memory.conversation branch extended with the three new fields"
affects: [67-02, phase-67-assembler-wiring, session-config, context-assembler]

# Tech tracking
tech-stack:
  added: []   # zero new npm deps per v1.9 commitment
  patterns:
    - "Pure DI helper with injected `now: number` for deterministic gap tests — no Date.now() monkey-patching"
    - "Accumulate budget strategy: add whole summaries until next would overflow; never half-truncate mid-summary"
    - "Discriminated-union result type (skipped:true|false) — caller branches on skipped before reading brief"
    - "Gap short-circuit BEFORE any MemoryStore read — verified with findByTag spy in test suite"
    - "Stable heading (`## Recent Sessions`) for prompt-cache stability turn-to-turn"
    - "Tag-only filter (`findByTag(\"session-summary\")`) — never `source === \"conversation\"` (Pitfall 6)"

key-files:
  created:
    - src/memory/conversation-brief.ts
    - src/memory/conversation-brief.types.ts
    - src/memory/__tests__/conversation-brief.test.ts
  modified:
    - src/memory/schema.ts
    - src/shared/types.ts
    - src/config/__tests__/schema.test.ts

key-decisions:
  - "Config placement Option A (conversation branch) over Option B (split): extended conversationConfigSchema rather than memoryAssemblyBudgets — respects v1.9 locked decision that conversation_context uses a dedicated budget"
  - "Accumulate strategy over hard-truncate for budget enforcement — dropping whole summaries is more honest than half-slicing bodies"
  - "Single over-budget summary still accepted (not silently dropped to empty string) — operator can tune budget upward, observability preserved via log.warn"
  - "Reused LoggerLike type from context-summary.ts (warn required) rather than defining a local optional-warn variant — matches pino-style production logger shape"
  - "Clock-skew clamp `Math.max(0, now - past)` on gap math — Pitfall 7 safe-default"

patterns-established:
  - "Phase 67 helper pattern: stores + config + log + `now` injected; returns frozen discriminated-union — Plan 02 assembler will call this with Date.now() in production"
  - "Test fixture seeding via raw UPDATE after real insert: lets tests control created_at/started_at/ended_at deterministically without bypassing the store's schema"

requirements-completed: [SESS-02, SESS-03]

# Metrics
duration: 9min
completed: 2026-04-18
---

# Phase 67 Plan 01: Resume Auto-Injection — Conversation Brief Helper Summary

**Pure `assembleConversationBrief(input, deps)` helper renders last-N session-summary MemoryEntries as markdown under a stable `## Recent Sessions` heading, with 4-hour gap-skip short-circuit and accumulate-strategy budget enforcement — all behaviour covered by 11 unit tests with deterministic `now: number` injection.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-18T16:26:50Z (first vitest RED run)
- **Completed:** 2026-04-18T16:35:57Z
- **Tasks:** 3
- **Files created:** 3
- **Files modified:** 3

## Accomplishments
- Delivered `assembleConversationBrief` pure helper with discriminated-union result (`skipped:true` with reason `"gap"` | `skipped:false` with rendered brief, sessionCount, tokens, truncated).
- Gap-skip short-circuits MemoryStore reads — verified by `findByTag` spy in test 67-01-05 (call count === 0 when gap < threshold).
- Accumulate budget strategy proven in test 67-01-04: three 1500-token summaries + 2000-token budget yields `sessionCount === 1` with `truncated: false`.
- Extended `conversationConfigSchema` with three new Phase 67 knobs (resumeSessionCount/resumeGapThresholdHours/conversationContextBudget) plus matching branch on `ResolvedAgentConfig.memory.conversation`.
- Five new schema tests (two plan-mandated floors + defaults sanity + ceiling + zero-gap acceptance) all GREEN.
- 13/13 plan-mandated tests GREEN; no regressions introduced (no tsc errors on any file I modified).

## Task Commits

Each task committed atomically via TDD cycle:

1. **Task 1: Failing tests + types** — `d7d5ccd` (test)
   - Creates `conversation-brief.types.ts` (discriminated-union contracts) and 11 red tests
   - RED confirmed: `Error: Cannot find module '../conversation-brief.js'`

2. **Task 2: Helper implementation** — `66aca5e` (feat)
   - Creates `conversation-brief.ts` (~215 lines, JSDoc-rich)
   - GREEN: `Test Files 1 passed (1), Tests 11 passed (11)`

3. **Task 3: Schema + ResolvedAgentConfig + schema tests** — `2c4902f` (feat)
   - Extends `conversationConfigSchema` with three fields
   - Extends `ResolvedAgentConfig.memory` with `conversation?` branch
   - Adds 5 tests under `conversationConfigSchema (Phase 67)` describe block
   - GREEN: `Test Files 2 passed (2), Tests 57 passed (57)`

## Files Created/Modified

- **`src/memory/conversation-brief.ts`** (created) — `assembleConversationBrief` + `renderBrief` + `formatRelativeTime`; exports four DEFAULT_* constants + MIN_CONVERSATION_CONTEXT_BUDGET.
- **`src/memory/conversation-brief.types.ts`** (created) — `AssembleBriefInput`, `AssembleBriefConfig`, `AssembleBriefDeps`, `AssembleBriefResult` (discriminated union).
- **`src/memory/__tests__/conversation-brief.test.ts`** (created) — 11 tests with exact plan-spec titles for `-t` flag matching.
- **`src/memory/schema.ts`** (modified) — three new fields on `conversationConfigSchema`.
- **`src/shared/types.ts`** (modified) — new `memory.conversation?` branch on `ResolvedAgentConfig`.
- **`src/config/__tests__/schema.test.ts`** (modified) — new `conversationConfigSchema (Phase 67)` describe block (5 tests).
- **`.planning/phases/67-resume-auto-injection/deferred-items.md`** (created) — logs pre-existing tsc + vitest failures out-of-scope for Plan 01.

## Public API Exports (for Plan 02 wiring)

```typescript
// from src/memory/conversation-brief.ts
export function assembleConversationBrief(
  input: AssembleBriefInput,
  deps: AssembleBriefDeps,
): AssembleBriefResult;

export const DEFAULT_RESUME_SESSION_COUNT = 3;
export const DEFAULT_RESUME_GAP_THRESHOLD_HOURS = 4;
export const DEFAULT_CONVERSATION_CONTEXT_BUDGET = 2000;
export const MIN_CONVERSATION_CONTEXT_BUDGET = 500;

// from src/memory/conversation-brief.types.ts
export type AssembleBriefInput = {
  readonly agentName: string;
  readonly now: number;   // epoch ms — pass Date.now() in production
};
export type AssembleBriefConfig = {
  readonly sessionCount: number;
  readonly gapThresholdHours: number;
  readonly budgetTokens: number;
};
export type AssembleBriefDeps = {
  readonly conversationStore: ConversationStore;
  readonly memoryStore: MemoryStore;
  readonly config: AssembleBriefConfig;
  readonly log?: LoggerLike;
};
export type AssembleBriefResult =
  | { readonly skipped: false; readonly brief: string; readonly sessionCount: number; readonly tokens: number; readonly truncated: boolean }
  | { readonly skipped: true; readonly reason: "gap" };
```

## Hand-off notes for Plan 02

Plan 02 (`67-02-PLAN.md`) wires this helper into `buildSessionConfig`:

1. Read resolved config: `agentConfig.memory.conversation?.resumeSessionCount ?? DEFAULT_RESUME_SESSION_COUNT` (and the other two knobs similarly).
2. Call `assembleConversationBrief({ agentName, now: Date.now() }, { conversationStore, memoryStore, config, log })`.
3. Branch on `result.skipped`:
   - `true` → omit `conversationContext` source entirely
   - `false` with empty `brief` → also omit (`if (result.brief) { … }` guard)
   - `false` with non-empty `brief` → pass to `assembleContext` as a new `ContextSources.conversationContext` field; land in the MUTABLE SUFFIX after `resumeSummary` (Pattern 2 in 67-RESEARCH).
4. Extend `SECTION_NAMES` in both `src/manager/context-assembler.ts` and `src/performance/context-audit.ts` with `"conversation_context"` (blast-radius edit — see Pitfall 5).
5. Extend `SectionTokenCounts` + `DEFAULT_PHASE53_BUDGETS` if going with Option B (this plan chose Option A, so budget stays on `memory.conversation.conversationContextBudget` — the new section still needs a count entry for audit visibility but no separate assembler budget).

## Decisions Made

See the **key-decisions** frontmatter list — five substantive choices, all aligned with CONTEXT.md and RESEARCH.md locked guidance:

- **Config placement Option A** (extend `conversationConfigSchema`) — respects v1.9 locked "dedicated budget, not shared with resume_summary" decision.
- **Accumulate strategy** over hard-truncate — dropping whole summaries keeps bodies coherent.
- **Over-budget single-summary passthrough** — logged via `log.warn` so observable; better than silently returning `""`.
- **Reuse `LoggerLike` from `context-summary.ts`** (`warn` required) — zero-duplication, matches pino's `.warn(obj, msg)` shape.
- **Clock-skew clamp** on gap math — Pitfall 7 safe-default.

## Deviations from Plan

None — plan executed exactly as written with one minor test-fixture correction:

### Test-fixture seed helper

The plan's Task-1 test scaffold used `convStore.getDatabase()`, but `ConversationStore` does NOT expose a `getDatabase()` method (only `MemoryStore` does). Since both stores share the same better-sqlite3 connection (the constructor takes the DB from `memStore.getDatabase()`), I seeded session rows via `memStore.getDatabase().prepare(…)` — functionally identical and matches the fixture pattern in `conversation-store.test.ts`. This is a plan-copy-error fix, not a Rule-1/2/3 auto-fix.

---

**Total deviations:** 0 auto-fixes (1 plan-scaffold typo corrected during test authoring — noted above)
**Impact on plan:** None — all success criteria hit, all 13 plan-mandated tests GREEN.

## Issues Encountered

- Pre-existing `tsc --noEmit` errors in unrelated files (task-manager, daemon, session-adapter, usage/budget, various test fixtures) — documented in `deferred-items.md` and confirmed zero errors in files I modified.
- Pre-existing flaky suite `src/memory/__tests__/graph-search.test.ts` (hook timeout on `beforeEach` temp-dir setup) — reproduces in isolation, so not caused by Phase 67 work. Also logged in `deferred-items.md`.

## User Setup Required

None — no external service configuration needed. All work is internal TypeScript + SQLite.

## Next Phase Readiness

- Plan 02 can now wire `assembleConversationBrief` into `buildSessionConfig` using the typed `ResolvedAgentConfig.memory.conversation` branch.
- The three DEFAULT_* constants let Plan 02 gracefully handle configs without a `memory.conversation` block (falling back to defaults).
- Test infrastructure (in-memory MemoryStore + ConversationStore fixtures, deterministic `T` injection) is ready for Plan 02's integration tests.

## Self-Check: PASSED

- [x] `src/memory/conversation-brief.ts` exists (215 lines)
- [x] `src/memory/conversation-brief.types.ts` exists
- [x] `src/memory/__tests__/conversation-brief.test.ts` exists (11 it-blocks with exact plan titles)
- [x] `src/memory/schema.ts` has resumeSessionCount, resumeGapThresholdHours, conversationContextBudget
- [x] `src/shared/types.ts` has `conversation?` branch on `memory`
- [x] `src/config/__tests__/schema.test.ts` has "resumeSessionCount floor" + "conversationContextBudget floor" tests
- [x] Commit `d7d5ccd` (test) — verified via `git log`
- [x] Commit `66aca5e` (feat, helper) — verified via `git log`
- [x] Commit `2c4902f` (feat, schema) — verified via `git log`
- [x] `npx vitest run src/memory/__tests__/conversation-brief.test.ts src/config/__tests__/schema.test.ts` exits 0 (57/57 passed, 13 mandated)
- [x] Zero tsc errors introduced in files modified by this plan

---
*Phase: 67-resume-auto-injection*
*Plan: 01*
*Completed: 2026-04-18*
