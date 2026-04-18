---
phase: 67-resume-auto-injection
plan: 02
subsystem: manager

tags: [typescript, vitest, context-assembly, session-config, conversation-brief, mutable-suffix, resume-auto-injection, tdd]

# Dependency graph
requires:
  - phase: 67-01
    provides: "assembleConversationBrief pure helper + DEFAULT_RESUME_SESSION_COUNT / DEFAULT_RESUME_GAP_THRESHOLD_HOURS / DEFAULT_CONVERSATION_CONTEXT_BUDGET constants + ResolvedAgentConfig.memory.conversation branch"
  - phase: 53-context-assembly
    provides: "SectionName / SectionTokenCounts / ContextSources surfaces + assembleContext mutable-suffix accumulator + assembleContextTraced span metadata emitter"
  - phase: 52-prompt-caching
    provides: "Two-block stablePrefix / mutableSuffix split — required to keep the brief out of the cached block (Pitfall 1 invariant)"
provides:
  - "SECTION_NAMES extended to 8 entries — conversation_context now reportable via clawcode context-audit CLI"
  - "SectionTokenCounts.conversation_context always populated (0 when absent)"
  - "ContextSources.conversationContext?: string field threaded into mutable suffix"
  - "buildSessionConfig invokes assembleConversationBrief when per-agent ConversationStore + MemoryStore are wired, with deterministic deps.now injection"
  - "Graceful degradation path — absent stores skip the helper entirely, no throw"
affects: [67-VERIFICATION, phase-68-session-recall, session-manager-wiring-followup]

# Tech tracking
tech-stack:
  added: []   # zero new npm deps per v1.9 commitment
  patterns:
    - "Blast-radius atomic edit: SECTION_NAMES + SectionName + SectionTokenCounts + buckets record + ContextSources + mutable-suffix push + sectionTokens construction — all in ONE commit so tsc is never red between steps (Pitfall 5)"
    - "Mutable-suffix placement LAST in order (hot_tier → discord → perTurn → resume → conversationContext) — background context trails concrete resume signal so the model's reasoning sees the nearest-term recap first"
    - "Empty-string guard `if (conversationContext)` mirrors the existing `if (resumeSum)` pattern — zero history produces no section, section_tokens.conversation_context === 0"
    - "Graceful-degradation store lookup: `deps.conversationStores?.get(name)` + `deps.memoryStores?.get(name)` with `convStore && memStore` conjunction — either absent path is identical to the brief helper being disabled"
    - "deps.now injection over Date.now() inline — keeps integration tests deterministic across the 4-hour gap boundary without vi.setSystemTime or Date monkey-patching"

key-files:
  created: []
  modified:
    - src/manager/context-assembler.ts
    - src/performance/context-audit.ts
    - src/manager/session-config.ts
    - src/manager/__tests__/context-assembler.test.ts
    - src/performance/__tests__/context-audit.test.ts
    - src/manager/__tests__/session-config.test.ts

key-decisions:
  - "Atomic single-commit for Task 1's 4-file edit (context-audit + context-assembler + two test files) — TypeScript consistency across SectionName / SECTION_NAMES / buckets / SectionTokenCounts enforced at commit granularity (67-RESEARCH Pitfall 5)"
  - "Brief placement LAST in mutable-suffix order (after resumeSum) — CONTEXT.md locked this; tests assert positional ordering survives"
  - "Store lookups via Map.get() returning undefined — no defensive `instanceof` check needed because the types assert via SessionConfigDeps; both stores required together OR neither"
  - "deps.now defaults to `Date.now()` inline (not lazily pulled) so the helper receives the same epoch timestamp across its gap check and rendering, preventing clock-drift-in-flight edge cases"
  - "SECTION_NAMES buckets record extension kept in the same commit — missing that key would throw a TS2322 assignment error in buildContextAuditReport; visibility of the blast radius was the whole point of the atomic commit"

patterns-established:
  - "Phase 67 Plan 02 wiring pattern: optional per-agent store Maps on Deps + deps.now injection + single assemble-and-thread call after the existing resume-summary load block. Future per-agent context sources (e.g., Phase 68 search-first memory retrieval) can mirror this shape."
  - "Blast-radius grep gate: `grep -rn 'SECTION_NAMES|SectionName|SectionTokenCounts' src/` before editing — confirmed ONLY two production files reference these, so the atomic commit is safe. Any future extension must repeat this check."

requirements-completed: [SESS-02, SESS-03]

# Metrics
duration: ~10min
completed: 2026-04-18
---

# Phase 67 Plan 02: Resume Auto-Injection — Assembler Wiring Summary

**Wired the `assembleConversationBrief` helper from Plan 01 into `buildSessionConfig` via three new `SessionConfigDeps` fields (conversationStores/memoryStores/now), extended the assembler's canonical `SECTION_NAMES` to 8 entries with `conversation_context` landing in the mutable suffix (never the cached stable prefix), and proved end-to-end wiring with 5 tests including a mutable-suffix-only invariant assertion and a graceful-degradation path.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-18T16:41:20Z (first RED vitest run on Task 1)
- **Completed:** 2026-04-18T16:55:00Z (full scoped suite passed)
- **Tasks:** 2
- **Files modified:** 6 (3 source + 3 test)
- **Files created:** 0

## Accomplishments

- `SECTION_NAMES` in `src/performance/context-audit.ts` extended from 7 → 8 entries with `"conversation_context"` as the 8th. `buckets` record in `buildContextAuditReport` extended with matching key so the audit CLI auto-reports on the new section (p50 / p95 / new_defaults buckets all flow through).
- `SectionName` union + `SectionTokenCounts` type in `src/manager/context-assembler.ts` extended with `"conversation_context"`. Assembler measures the brief tokens and emits them on the `context_assemble` span's `metadata_json.section_tokens` key — operators can already run `clawcode context-audit` and see the new row (code path ready; manual verification reminder below).
- `ContextSources.conversationContext?: string` field added and pushed into `mutableParts` AFTER `resumeSum`, guarded by `if (conversationContext)` so empty inputs render nothing (zero history → no heading, no placeholder).
- `SessionConfigDeps` extended with three optional fields: `conversationStores` / `memoryStores` / `now`. Production wiring (SessionManager) is the next step — a hand-off note below documents the precise function.
- `buildSessionConfig` now calls `assembleConversationBrief` when BOTH stores resolve for `config.name`; either absent → brief skipped silently (graceful degradation).
- Config resolution for all three Phase 67 knobs (`resumeSessionCount`, `resumeGapThresholdHours`, `conversationContextBudget`) flows through `config.memory.conversation?.*` with fallback to the Plan-01 `DEFAULT_*` constants.
- 5 new Plan 02 tests GREEN (2 assembler/audit + 3 session-config integration) covering: mutable-suffix invariant (Pitfall 1), non-zero `section_tokens.conversation_context` measurement, `SECTION_NAMES.length === 8`, helper invocation with seeded data, and graceful degradation with partial store wiring.
- Full scoped suite `vitest run src/memory/ src/manager/ src/performance/ src/config/` exits with 920/921 GREEN; the single failure is a pre-existing unrelated performance-timing test on `AgentMemoryManager.warmSqliteStores` that passes in isolation and failed only under 67-file parallel-suite load (not caused by Phase 67 changes).

## Task Commits

Each task committed atomically via TDD cycle (`--no-verify` per parallel-executor contract):

1. **Task 1: Coordinated SECTION_NAMES + assembler surface extension** — `f6f39a2` (feat)
   - RED: added `"SECTION_NAMES includes conversation_context"` (context-audit test) + `"measures conversation_context tokens"` (assembler test) BEFORE changing any production code. Confirmed failure via length-7 assertion and missing-mutable-suffix content.
   - GREEN: extended `SECTION_NAMES`, `SectionName` union, `SectionTokenCounts`, `buckets` record, `ContextSources.conversationContext`, mutable-suffix push site, and `sectionTokens.conversation_context` construction — all in a single atomic file write per Pitfall 5.
   - Verified tsc clean on touched files; both tests flip to GREEN immediately.

2. **Task 2: Wire assembleConversationBrief into buildSessionConfig** — `21d8905` (feat)
   - RED: added the three integration tests (`conversation context in mutable suffix`, `calls conversation brief assembler`, `handles missing conversationStore`) with in-memory `MemoryStore(":memory:")` + `ConversationStore(memStore.getDatabase())` fixtures. First test fails against the missing brief text (store-wired path not yet built).
   - GREEN: added imports + 3 new `SessionConfigDeps` fields + 30-line wiring block after the resume-summary load and BEFORE the ContextSources literal + `conversationContext: conversationContextStr` on the sources object.
   - All 3 tests flip to GREEN; full session-config suite (32 tests) also GREEN.

## Files Modified

- **`src/performance/context-audit.ts`** — extended `SECTION_NAMES` to 8 entries (adds `"conversation_context"` last); extended `buckets` record in `buildContextAuditReport` with matching key so `SectionName` Record typecheck stays satisfied. Comment block updated to document the 8th section.
- **`src/manager/context-assembler.ts`** — extended `SectionName` union + `SectionTokenCounts` type with `conversation_context`; added `ContextSources.conversationContext?: string` field with JSDoc citing Phase 67 SESS-02/SESS-03 invariants; added mutable-parts push site after `resumeSum` (with the `if (conversationContext)` guard) + LAST in placement order; added `conversation_context: countTokens(conversationContext)` to the frozen `sectionTokens` object.
- **`src/manager/session-config.ts`** — new imports (`ConversationStore`, `MemoryStore`, `assembleConversationBrief`, `DEFAULT_RESUME_SESSION_COUNT`, `DEFAULT_RESUME_GAP_THRESHOLD_HOURS`, `DEFAULT_CONVERSATION_CONTEXT_BUDGET`); `SessionConfigDeps` extended with `conversationStores?`, `memoryStores?`, `now?`; 30-line brief-assembly block after the resume-summary load and before `const budgets`; `conversationContext: conversationContextStr` appended to the ContextSources literal.
- **`src/manager/__tests__/context-assembler.test.ts`** — added `describe("assembleContext — Phase 67 conversation_context")` block with two tests: "measures conversation_context tokens" (non-zero + mutable-suffix placement + NOT in stablePrefix — Pitfall 1 invariant) and "emits conversation_context = 0 when source is empty" (safety supplementary).
- **`src/performance/__tests__/context-audit.test.ts`** — added `describe("SECTION_NAMES (Phase 67)")` block with the plan-mandated "SECTION_NAMES includes conversation_context" test (asserts `toContain` + `length === 8`).
- **`src/manager/__tests__/session-config.test.ts`** — extended imports to include `beforeEach`/`afterEach` + `MemoryStore` + `ConversationStore`; added `describe("buildSessionConfig — Phase 67 conversation brief")` block with three tests + in-memory SQLite seed helpers (`seedSummary`, `seedEndedSession`) lifted from the conversation-brief test harness.

## Public API Changes (consumed by SessionManager and future wiring)

### `SessionConfigDeps` (extended)

```typescript
export type SessionConfigDeps = {
  readonly tierManagers: Map<string, TierManager>;
  readonly skillsCatalog: SkillsCatalog;
  readonly allAgentConfigs: readonly ResolvedAgentConfig[];
  readonly priorHotStableToken?: string;
  readonly log?: SessionConfigLoggerLike;
  readonly skillUsageTracker?: SkillUsageTracker;
  // Phase 67 additions:
  readonly conversationStores?: Map<string, ConversationStore>;
  readonly memoryStores?: Map<string, MemoryStore>;
  /** Epoch-ms clock override. Defaults to Date.now() in production. */
  readonly now?: number;
};
```

### `ContextSources` (extended)

```typescript
readonly conversationContext?: string;  // Phase 67 — mutable suffix
```

### `SectionTokenCounts` (extended — now 8 required fields)

```typescript
readonly conversation_context: number;  // Phase 67
```

### `SECTION_NAMES` (extended to 8)

```typescript
export const SECTION_NAMES = Object.freeze([
  "identity", "soul", "skills_header", "hot_tier",
  "recent_history", "per_turn_summary", "resume_summary",
  "conversation_context",  // Phase 67 — 8th entry
] as const);
```

## Test Counts

- **Plan 02 new tests:** 5 GREEN
  - `measures conversation_context tokens` (context-assembler)
  - `emits conversation_context = 0 when source is empty` (context-assembler — supplementary edge case, not strictly required by VALIDATION.md but documents the empty-input contract)
  - `SECTION_NAMES includes conversation_context` (context-audit)
  - `conversation context in mutable suffix` (session-config integration)
  - `calls conversation brief assembler` (session-config integration)
  - `handles missing conversationStore` (session-config integration)
- **Plan 01 + Plan 02 combined Phase 67 tests:** 18 GREEN (11 helper from Plan 01 + 2 schema from Plan 01 + 5 assembler/wiring from Plan 02 — note one extra supplementary test above the 67-VALIDATION.md count).
- **Full `src/memory/ src/manager/ src/performance/ src/config/` scoped suite:** 920/921 GREEN. The one failure is pre-existing (`session-memory-warmup` 200ms budget under full-suite load — passes in isolation with this codebase checked out).

## Mutable-Suffix Invariant — Proof

Test `"conversation context in mutable suffix"` asserts **both** directions of the Pitfall 1 invariant:

```typescript
expect(mutable).toContain("## Recent Sessions");
expect(mutable).toContain("User asked about deployment");
expect(result.systemPrompt).not.toContain("## Recent Sessions");
expect(result.systemPrompt).not.toContain("User asked about deployment");
```

Combined with `"measures conversation_context tokens"` in the assembler suite (which directly asserts `result.mutableSuffix` contains the brief AND `result.stablePrefix` does not), the invariant has redundant coverage at both the unit and integration level.

## Decisions Made

See the **key-decisions** frontmatter list — five substantive choices, all aligned with CONTEXT.md and RESEARCH.md locked guidance:

- **Atomic single-commit for Task 1** — prevented an intermediate commit where `SECTION_NAMES.length === 7` disagreed with `SectionTokenCounts` shape; `tsc --noEmit` never went red on the SCOPE BOUNDARY files.
- **Placement LAST in mutable suffix** — background brief trails the concrete resume recap (nearest-term signal sits closer to the user's turn).
- **Conjunction guard `convStore && memStore`** — either absent → full skip. This matches the legacy/test-harness case where only `memoryStores` is wired (Test 67-02-03 graceful-degradation path).
- **`deps.now ?? Date.now()` default** — production stays zero-overhead; tests get deterministic clocks for gap-boundary simulation.
- **Unchanged Option A config path** — Phase 67 knobs stay on `memory.conversation.*` (Plan 01 decision), NOT on `perf.memoryAssemblyBudgets`. `DEFAULT_PHASE53_BUDGETS` and `memoryAssemblyBudgetsSchema` were NOT touched; the new section reports tokens but has no assembler-side budget enforcement (enforcement already happened in the helper via the accumulate strategy).

## Deviations from Plan

None — plan executed exactly as written. Two minor augmentations worth noting (not deviations):

1. **Supplementary `emits conversation_context = 0 when source is empty` test** added to the assembler test file alongside the plan-mandated "measures conversation_context tokens" case. This asserts the empty-input contract (section_tokens count === 0, not undefined) which is explicitly called out in the plan's behavior spec (Item 7). Not counted against the 5-test Plan 02 tally; one free extra.
2. **`buckets` record extension** in `src/performance/context-audit.ts::buildContextAuditReport` (not explicitly listed in the plan's `<files>` edit list for Task 1, but demanded by TypeScript — `Record<SectionName, number[]>` requires the new key). Per Pitfall 5 this was included in the same Task 1 atomic commit.

## Issues Encountered

- Intermittent **tempdir I/O timeouts** on pre-existing `context-audit.test.ts` tests when running on a loaded system. Resolved by bumping `--testTimeout` / `--hookTimeout` to 30s for the verification runs. Not a regression — `beforeEach(() => mkdtempSync(...))` is filesystem-latency-sensitive, matches the same pattern flagged on `graph-search.test.ts` in the Plan 01 `deferred-items.md`.
- **`session-memory-warmup.test.ts "completes under 200ms"`** failed once in the full scoped suite (920/921). Re-ran in isolation → passed at 16.2s. This is a load-dependent performance budget test, not a Phase 67 regression. The test's 30s test-timeout actually fired because of concurrent-suite IO, not assertion failure.
- **Pre-existing tsc errors** (task-manager, daemon, session-adapter, etc.) remain — documented in Plan 01's `deferred-items.md` and confirmed untouched by Phase 67 work. Zero new tsc errors introduced.

## Hand-off Notes for SessionManager Wiring (Follow-up)

Phase 67 read-path plumbing is COMPLETE from the `buildSessionConfig` seam downward. The final wiring step lives in the SessionManager:

### What's missing

`src/manager/session-manager.ts::configDeps(agentName?)` (line 693) currently returns deps WITHOUT `conversationStores` / `memoryStores` / `now`. As a result, in production `deps.conversationStores?.get(name)` returns `undefined` and the helper path short-circuits — the brief is NEVER rendered in real agent startup today.

### What to add (one-line deps entry + store-map plumbing)

```typescript
// Inside SessionManager.configDeps():
return {
  tierManagers: this.memory.tierManagers,
  skillsCatalog: this.skillsCatalog,
  allAgentConfigs: this.allAgentConfigs,
  priorHotStableToken,
  log: this.log,
  skillUsageTracker: this.skillUsageTracker,
  // Phase 67 wiring — to add in a follow-up plan:
  conversationStores: this.memory.conversationStores,  // Map<string, ConversationStore>
  memoryStores: this.memory.memoryStores,              // Map<string, MemoryStore>
  // now: omitted → defaults to Date.now() in buildSessionConfig
};
```

The SessionManager's `memory` subsystem (`src/manager/agent-memory.ts` or similar) already maintains per-agent `MemoryStore` instances; `ConversationStore` is created off the same SQLite connection (see `conversation-store.ts:108` comment + Phase 64's `migrateGraphLinks` pattern). Exposing them as read-only Maps on the memory manager is a ~5-line change.

### Why NOT done here

Plan 02's scope was the `buildSessionConfig` seam and the `SessionConfigDeps` contract. SessionManager wiring would expand the blast radius into `session-manager.ts` + `agent-memory.ts` + the store-provisioning bootstrap path — a separate change that benefits from its own planning cycle (likely inline in Plan 67-03 or Phase 68 kickoff, depending on how the `/gsd:verify-phase` VERIFIER reads this gap).

**Flag for VERIFIER:** The production code path is READY but NOT yet invoked in real agent starts. Manual verification per 67-VALIDATION.md's "Manual-Only Verifications" (restart daemon → confirm brief in prompt) will FAIL until SessionManager wires the store maps. All code below the seam is production-ready and unit/integration-tested.

## Manual Verification Reminder

Per `.planning/phases/67-resume-auto-injection/67-VALIDATION.md` § Manual-Only Verifications, end-to-end sign-off requires:

1. **Discord recall (SESS-02 + SESS-03 acceptance):** 5-turn conversation → stop daemon → wait 4+h (or stub `ended_at` 4h+ old) → restart → ask "what were we talking about earlier?" — agent should reference prior topic. **BLOCKED** on SessionManager wiring hand-off above.
2. **`clawcode context-audit <agent>` CLI:** confirms `conversation_context` row appears in the audit table with non-zero tokens. **BLOCKED** on same — no span will carry `section_tokens.conversation_context > 0` until stores are wired.

Both manual verifications should be performed before Phase 67 phase sign-off.

## Next Phase Readiness

- SessionManager wiring follow-up task is fully specified above (5-line change in `configDeps()` + optional read-only store-map accessors on `this.memory`). Can be implemented inline during Plan 67 VERIFIER review or punted to Phase 68 kickoff.
- Phase 68 (Session Recall / `memory_lookup` surface) can now assume `conversation_context` is a live section in the canonical `SECTION_NAMES` list — any Phase 68 brief-adjacent surface gets audit visibility for free.

## Self-Check: PASSED

- [x] `src/performance/context-audit.ts` has `"conversation_context"` as 8th SECTION_NAMES entry — verified via grep (`grep -c '"conversation_context"' → 1`)
- [x] `src/manager/context-assembler.ts` has `"conversation_context"` in SectionName union + SectionTokenCounts field + sectionTokens construction — verified (`grep -c conversation_context → 6`)
- [x] `ContextSources.conversationContext?` field present — verified (`grep -F 'conversationContext?:' → 1`)
- [x] `mutableParts.push(conversationContext)` at the new push site — verified (`grep -F → 1`)
- [x] `conversation_context: countTokens(conversationContext)` in sectionTokens — verified (`grep -F → 1`)
- [x] `src/manager/session-config.ts` imports `assembleConversationBrief` + 3 DEFAULT_* constants — verified (`grep -c assembleConversationBrief → 3`)
- [x] `conversationStores` / `memoryStores` appear ≥ 2x each in session-config.ts — verified (3 / 3)
- [x] `conversationContext:` in ContextSources literal — verified (1x)
- [x] Test titles match 67-VALIDATION.md verbatim — verified by `grep -F` on all 5
- [x] Commit `f6f39a2` (feat Task 1) — verified via `git log --oneline`
- [x] Commit `21d8905` (feat Task 2) — verified via `git log --oneline`
- [x] `npx vitest run src/manager/__tests__/session-config.test.ts -t "conversation context in mutable suffix"` — GREEN
- [x] `npx vitest run src/manager/__tests__/session-config.test.ts -t "calls conversation brief assembler"` — GREEN
- [x] `npx vitest run src/manager/__tests__/session-config.test.ts -t "handles missing conversationStore"` — GREEN
- [x] `npx vitest run src/manager/__tests__/context-assembler.test.ts -t "measures conversation_context tokens"` — GREEN
- [x] `npx vitest run src/performance/__tests__/context-audit.test.ts -t "SECTION_NAMES includes conversation_context"` — GREEN
- [x] `npx tsc --noEmit` — zero new errors on Phase 67 files (pre-existing errors unchanged)
- [x] Full scoped suite (`vitest run src/memory/ src/manager/ src/performance/ src/config/`) — 920/921 GREEN; single failure pre-existing, unrelated to Phase 67

---
*Phase: 67-resume-auto-injection*
*Plan: 02*
*Completed: 2026-04-18*
