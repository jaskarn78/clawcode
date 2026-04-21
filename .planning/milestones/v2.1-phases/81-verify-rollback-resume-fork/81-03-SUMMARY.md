---
phase: 81-verify-rollback-resume-fork
plan: 03
subsystem: testing
tags: [fork, escalation, opus, cost-visibility, usage-tracker, regression, migrated-agents, parameterized-tests, vitest, typescript]

requires:
  - phase: v1.5-fork-session-branch
    provides: buildForkName + buildForkConfig + SessionManager.forkSession
  - phase: v2.0-usage-tracking
    provides: UsageTracker.record + getCostsByAgentModel + formatCostsTable
  - phase: 78-config-mapping-yaml-writer
    provides: DEFAULT_MODEL_MAP (haiku/sonnet/opus family collapse for post-migration configs)

provides:
  - src/manager/__tests__/fork-migrated-agent.test.ts — FORK-01 regression pin (32 tests)
  - src/manager/__tests__/fork-cost-visibility.test.ts — FORK-02 regression pin (11 tests)
  - Parameterized fork-to-Opus coverage across 4 primary OpenClaw model families (Haiku, Sonnet, MiniMax, Gemini)
  - buildForkConfig contract pin — model override, fork name, channels:[], soul injection, memoryPath preservation
  - EscalationMonitor.escalate contract pin — forkSession({modelOverride:'opus'}) regardless of parent primary
  - escalationBudget:undefined invariant for migrated agents (FORK-02 no-ceiling precondition)
  - UsageTracker cost-visibility contract pin — fork rows carry literal <parent>-fork-<id> agent name, not parent
  - formatCostsTable rendering contract pin — both parent + fork rows + TOTAL row visible
  - Static-grep invariant that UsageTracker.record has no budget-gate integration

affects:
  - Phase 82 (pilot + cutover) — runbook references FORK-01/FORK-02 regression suite as "fork health" pre-check
  - Future fork / escalation refactors — these 43 tests fail loudly on any buildForkConfig / UsageTracker.record contract drift

tech-stack:
  added: []  # zero new npm deps
  patterns:
    - "Parameterized-over-4-models describe block: for-loop over PRIMARY_MODELS array emits describe+it tests per family; labels preserve source-family name (MiniMax, Gemini) even when post-migration model collapses to a typed enum value"
    - "Regression-test seam choice: EscalationMonitor.escalate over raw SessionManager (Option B) — the only production caller of forkSession with a model override; <20 LOC fixture vs SessionManager's Discord+chokidar+sqlite+Agent-SDK dependency tree"
    - "Static-grep invariants baked into test assertions: readFileSync('src/usage/tracker.ts') + expect().not.toMatch(/BudgetExceededError/) pins no-budget-ceiling contract against future refactors that might add budget checks to record()"
    - "Fork-name literal assertions (expect(agent).toBe('migrated-haiku-fork-abc123'), NOT collapsed to parent) — the `clawcode costs --agent <fork-name>` UX contract"

key-files:
  created:
    - src/manager/__tests__/fork-migrated-agent.test.ts
    - src/manager/__tests__/fork-cost-visibility.test.ts
  modified:
    - .planning/phases/81-verify-rollback-resume-fork/deferred-items.md

key-decisions:
  - "PRIMARY_MODELS parameterization uses resolved enum values (haiku/sonnet) for ResolvedAgentConfig fixtures because Phase 78 DEFAULT_MODEL_MAP collapses MiniMax/Gemini sources to typed Claude enum values at migration commit — the runtime model field is always 'sonnet' | 'opus' | 'haiku'. Labels preserve source-family names (MiniMax, Gemini) so acceptance-criteria greps over those strings resolve."
  - "EscalationMonitor over raw SessionManager for fork-escalation propagation tests (Option B in plan) — SessionManager requires Discord client + chokidar watchers + Agent SDK handles + sqlite pools to instantiate, exceeding the 20-LOC fixture threshold; EscalationMonitor.escalate is the ONLY production caller of forkSession with a model override, so this seam pins the full fork-to-Opus contract."
  - "Cost-visibility test records model strings directly (claude-haiku-4-5, minimax-m2, gemini-2.5-flash, claude-opus-4-7) because UsageEvent.model is typed `string` (not an enum) — mirrors the production path where the SDK emits pinned model IDs via resolveModelId()."
  - "Static-grep regression for no-budget-ceiling: readFileSync('src/usage/tracker.ts') + expect().not.toMatch(/BudgetExceededError/) pins the invariant that UsageTracker.record has no budget-gate integration; budget enforcement lives in EscalationMonitor.escalate and only arms when budgetOptions is explicitly passed (migrated agents have escalationBudget:undefined → no budgetConfigs → gate never fires)."
  - "Phase 74 alternate-contract pin: v1.5 persistent-fork rows NEVER carry 'openclaw:<slug>' agent shape — that belongs to Phase 74's transient-routing OpenAI-compatible endpoint, a different code path. Pinned so a future refactor doesn't silently collapse fork rows into the Phase 74 shape."

patterns-established:
  - "Parameterized regression over 4-family fleet: PRIMARY_MODELS=[{label,resolvedModel,sourceId}] array + describe/for-loop — one suite per family per buildForkConfig property. Used in both fork-migrated-agent.test.ts (6 props × 4 families = 24 tests) and fork-cost-visibility.test.ts (1 parent+fork fleet test × 4 families = 4 tests)."
  - "TDD RED-phase-is-GREEN for regression pins: the tests target EXISTING production code that already works; RED is conceptual (would fail against a drifted implementation). First `vitest run` on each new file returned all green, confirming the contract is already honored and now pinned."
  - "Literal fork-name invariants: expect(forkRow.agent).toBe('migrated-haiku-fork-abc123') + .not.toBe('migrated-haiku') — two-sided assertion pins both positive (carries literal) and negative (never collapses)."
  - "CLAUDE.md enforcement: followed /gsd:execute-phase workflow; regression-only plan touched only two new test files (zero production-code diff); conventional-commits test/81-03 scope on both commits; --no-verify flag respected per orchestrator instruction."

requirements-completed: [FORK-01, FORK-02]

# Metrics
duration: 21min
completed: 2026-04-21
---

# Phase 81 Plan 03: Fork-to-Opus Regression Pin Summary

**FORK-01 + FORK-02 regression suite — 43 tests across 2 files pin the v1.5 fork-to-Opus escalation path + UsageTracker cost visibility for migrated agents regardless of primary model (Haiku, Sonnet, MiniMax, Gemini), with no budget ceiling.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-04-20T23:58:46Z
- **Completed:** 2026-04-21T00:20:00Z
- **Tasks:** 2
- **Files created:** 2
- **Files modified:** 1 (deferred-items.md — Plan 03 audit note)

## Accomplishments

- **FORK-01 regression pinned:** `buildForkConfig` + `EscalationMonitor.escalate` + fork-name / soul injection / memoryPath / channels / schedules / slashCommands contracts all pinned across 4 primary model families. A future refactor that breaks `modelOverride:"opus"` propagation for ANY primary fails loudly with a named test.
- **FORK-02 regression pinned:** `UsageTracker.getCostsByAgentModel` returns fork rows with the literal `<parent>-fork-<id>` agent name (never collapsed to parent), opus-prefix model visible, non-zero cost. `formatCostsTable` renders both parent + fork rows + TOTAL. Static-grep invariant pins no budget-gate integration in tracker.ts.
- **No-budget-ceiling invariant pinned 3 ways:** (1) `escalationBudget:undefined` on both parent and fork configs for all 4 families; (2) `EscalationMonitor` constructed without `budgetOptions` skips the canEscalate gate entirely; (3) static grep on `src/usage/tracker.ts` confirms zero `BudgetExceededError` / `canEscalate` references.
- **Zero production-code changes:** `git diff HEAD~2 HEAD --name-only` returns only the two new `__tests__/` files — `src/manager/fork.ts`, `src/manager/escalation.ts`, `src/manager/session-manager.ts`, `src/usage/tracker.ts`, `src/cli/commands/costs.ts` all byte-identical across Plan 03.
- **Zero new npm deps:** reused existing `vitest` + `better-sqlite3` + `nanoid` (via `UsageTracker.record` path).

## Task Commits

Each task was committed atomically:

1. **Task 1: FORK-01 regression — parameterized fork-to-Opus across 4 primary models** — `4815a0a` (test)
2. **Task 2: FORK-02 regression — cost visibility for fork-to-Opus turns** — `a2a8848` (test)

Both commits under `test(81-03)` scope per conventional-commits + CLAUDE.md. Plan-metadata commit follows this summary.

## Files Created/Modified

- **`src/manager/__tests__/fork-migrated-agent.test.ts`** (created, 275 LOC, 32 tests) — FORK-01 regression: `buildForkConfig` + `buildForkName` + `EscalationMonitor.escalate` parameterized over Haiku/Sonnet/MiniMax/Gemini. 6 properties × 4 families = 24 per-family tests; plus 2 `buildForkName` tests, 4 `EscalationMonitor` propagation tests (one per family), 1 no-budget-options test, 1 trace-metadata regression test = 32 total.
- **`src/manager/__tests__/fork-cost-visibility.test.ts`** (created, 346 LOC, 11 tests) — FORK-02 regression: `UsageTracker.getCostsByAgentModel` + `formatCostsTable` + static-grep no-budget-ceiling + Phase 74 alternate-contract pin. Parameterized across 4 families + full-fleet rendering test.
- **`.planning/phases/81-verify-rollback-resume-fork/deferred-items.md`** (modified) — appended Plan 03 audit note documenting that all 11 full-suite failures are pre-existing in unrelated files.

## Decisions Made

See `key-decisions` in frontmatter above. Top 3:

1. **Parameterization uses post-migration enum values** (haiku/sonnet) in `ResolvedAgentConfig` fixtures; labels preserve source-family names (MiniMax, Gemini) for acceptance-criteria grep resolution. Post-migration config always carries one of `"sonnet" | "opus" | "haiku"` — MiniMax/Gemini collapse via `DEFAULT_MODEL_MAP` at migration commit.
2. **EscalationMonitor over raw SessionManager** (Option B from plan) — <20 LOC fixture vs SessionManager's Discord+chokidar+Agent-SDK dependency tree. EscalationMonitor is the ONLY production caller of `forkSession` with a model override, so this seam pins the full contract.
3. **Static-grep regression for no-budget-ceiling** — `readFileSync('src/usage/tracker.ts') + .not.toMatch(/BudgetExceededError/)` pins the invariant that UsageTracker.record has no budget-gate integration, catching drift if a future refactor adds budget checks into tracker.ts.

## Deviations from Plan

### Parameterization scope adjustment

**1. [Rule 3 — Blocking] Primary-model parameterization uses ResolvedAgentConfig enum values, not source-model literal strings**

- **Found during:** Task 1 (writing `makeMigratedAgentConfig` helper)
- **Issue:** Plan suggested parameterizing `ResolvedAgentConfig.model` across `"claude-haiku-4-5"`, `"claude-sonnet-4-6"`, `"minimax-m2"`, `"gemini-2.5-flash"`. But `src/config/schema.ts:modelSchema` is `z.enum(["sonnet", "opus", "haiku"])` — arbitrary strings fail type check. Plan critical-constraint line 55 acknowledges this ambiguity: "Use whichever names the existing ResolvedAgentConfig.model field accepts."
- **Fix:** Parameterized `PRIMARY_MODELS = [{label, resolvedModel, sourceId}]` where `resolvedModel` ∈ `"sonnet" | "haiku"` (the post-migration enum values per `DEFAULT_MODEL_MAP`) and `sourceId` carries the original source-family string (e.g., `"minimax/abab6.5"`, `"gemini-2.5-flash"`). Test labels and describe blocks render the source-family name. For `UsageEvent.model` (typed `string`, not enum), the cost-visibility test records full model ids (`claude-haiku-4-5`, `minimax-m2`, `gemini-2.5-flash`, `claude-opus-4-7`) directly.
- **Files modified:** src/manager/__tests__/fork-migrated-agent.test.ts, src/manager/__tests__/fork-cost-visibility.test.ts
- **Verification:** `npx tsc --noEmit | grep fork-(migrated-agent|cost-visibility)` — 0 errors; both test files pass in isolation (32+11=43 tests green); acceptance-criteria greps over `minimax` / `gemini` / `claude-haiku` / `claude-sonnet` all resolve.
- **Committed in:** 4815a0a (Task 1) + a2a8848 (Task 2)

---

**Total deviations:** 1 adjustment (Rule 3 — blocking type constraint). Zero other deviations; regression-only plan executed as written.
**Impact on plan:** Minimal — preserves the spirit of the 4-family parameterization (labels, describe blocks, grep-resolvable strings in test bodies) while respecting the existing `ResolvedAgentConfig.model` enum. Intent of FORK-01 (fork-to-Opus works regardless of primary) fully tested.

## Issues Encountered

- **Full-suite has 11 pre-existing failures in unrelated files.** None reference `fork.ts` / `tracker.ts` / `costs.ts` / the two new Plan 03 files. Documented in `.planning/phases/81-verify-rollback-resume-fork/deferred-items.md` (Plan 03 audit section). Out of scope per SCOPE BOUNDARY rule.
- **`formatCostsTable` rendering test initially verified `$0.0010`/`$0.0500` strings** — confirmed by manual read of `src/cli/commands/costs.ts:33`, which formats `cost_usd` with `.toFixed(4)`. Test passed on first run.

## User Setup Required

None — regression-only plan, no external services, no env vars, no runtime changes.

## Next Phase Readiness

- **Phase 82 (pilot + cutover) unblocked.** The FORK-01 + FORK-02 regression suite is now part of the "fork health" pre-check runbook: before any pilot agent cutover, `npx vitest run src/manager/__tests__/fork-migrated-agent.test.ts src/manager/__tests__/fork-cost-visibility.test.ts` must be green. Any red means fork-escalation for migrated agents has drifted and cutover should halt.
- **Milestone v2.1 requirements ledger:** MIGR-03 (Plan 02), MIGR-04 (Plan 01 + 02), MIGR-05 (Plan 01 + 02), FORK-01 (Plan 03 Task 1), FORK-02 (Plan 03 Task 2) — all 5 Phase 81 requirements closed. Phase 82 (OPS-01, OPS-02) is the only remaining phase in v2.1.

## Self-Check

Files verified:

- FOUND: src/manager/__tests__/fork-migrated-agent.test.ts
- FOUND: src/manager/__tests__/fork-cost-visibility.test.ts

Commits verified:

- FOUND: 4815a0a (FORK-01 regression)
- FOUND: a2a8848 (FORK-02 regression)

Tests verified:

- 32/32 pass in fork-migrated-agent.test.ts
- 11/11 pass in fork-cost-visibility.test.ts
- Total: 43/43 (Plan 03 contribution)

Production code invariants verified:

- `git diff HEAD~2 HEAD src/manager/fork.ts src/manager/escalation.ts src/manager/session-manager.ts src/usage/tracker.ts src/cli/commands/costs.ts` — empty (regression-only preserved)
- `npx tsc --noEmit | grep fork-(migrated-agent|cost-visibility)` — 0 errors

---

*Phase: 81-verify-rollback-resume-fork*
*Completed: 2026-04-21*
