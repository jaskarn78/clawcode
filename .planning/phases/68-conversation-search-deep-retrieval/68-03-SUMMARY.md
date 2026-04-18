---
phase: 68-conversation-search-deep-retrieval
plan: 03
subsystem: memory
tags: [config-knob, decay, gap-closure, retr-03, vitest, integration-test, tdd]

requires:
  - phase: 68-conversation-search-deep-retrieval
    plan: 02
    provides: invokeMemoryLookup handler + MemoryLookupParams type + daemon.ts thin-delegator IPC case
  - phase: 68-conversation-search-deep-retrieval
    plan: 01
    provides: searchByScope + ScopedSearchOptions.halfLifeDays + DEFAULT_RETRIEVAL_HALF_LIFE_DAYS fallback
  - phase: 67-resume-auto-injection
    provides: ResolvedAgentConfig.memory.conversation block (extended here with retrievalHalfLifeDays)
provides:
  - ResolvedAgentConfig.memory.conversation.retrievalHalfLifeDays (readonly required field inside the optional conversation block)
  - MemoryLookupParams.retrievalHalfLifeDays optional passthrough field
  - Daemon memory-lookup IPC case reads retrievalHalfLifeDays from agent config and threads it to invokeMemoryLookup
  - searchByScope now receives the per-agent half-life value via ScopedSearchOptions.halfLifeDays (existing fallback to DEFAULT_RETRIEVAL_HALF_LIFE_DAYS preserved)
  - Regression test proving the knob is LIVE end-to-end (default-half-life vs retrievalHalfLifeDays:3 produces measurably different combinedScore on identical aged fixtures)
affects: [v1.9 patch-readiness — RETR-03 fully tunable; 68-VERIFICATION warning resolved]

tech-stack:
  added: []
  patterns:
    - Config-knob threading via existing typed seams (no new types, no new abstractions — surgical 4-file diff)
    - TDD gap-closure pattern — RED test asserts current inertness; GREEN implementation flips behavior; same test now proves runtime liveness
    - importance=1.0 explicit pinning in decay-delta tests to bypass MemoryStore.insert's "input is undefined or exactly 0.5 → calculateImportance(content)" branch (store.ts:148) and keep delta math above floating-point noise

key-files:
  created: []
  modified:
    - src/shared/types.ts (extended ResolvedAgentConfig.memory.conversation with retrievalHalfLifeDays:number — line 56)
    - src/manager/memory-lookup-handler.ts (added optional retrievalHalfLifeDays to MemoryLookupParams at line 87 + halfLifeDays:params.retrievalHalfLifeDays passthrough at line 173)
    - src/manager/daemon.ts (memory-lookup IPC case reads agentConfig?.memory.conversation?.retrievalHalfLifeDays at line 1687-1689 and threads into invokeMemoryLookup params at line 1692)
    - src/manager/__tests__/daemon-memory-lookup.test.ts (added "retrievalHalfLifeDays config knob changes decay weighting at runtime" test at line 413)

key-decisions:
  - "Surgical 4-file diff with no rename or refactor of searchByScope or DEFAULT_RETRIEVAL_HALF_LIFE_DAYS — single source of fallback truth remains in searchByScope (conversation-search.ts:85-87); handler passes undefined-when-absent so the existing fallback chain is preserved"
  - "Type lives inside optional conversation? block as REQUIRED — when the conversation block is present (Zod default-supplied), retrievalHalfLifeDays is always set (Zod default 14 from schema.ts:79), so consumers can read it without an inner optional-chain. The block itself stays optional to handle agents with conversation persistence disabled"
  - "Daemon does NOT clamp retrievalHalfLifeDays — Zod enforces min(1) at config-load time (schema.ts:79), so a malformed value never reaches the daemon. Adding a redundant clamp at the IPC layer would obscure where the validation actually lives"
  - "Test pinned importance=1.0 explicitly to bypass MemoryStore.insert's calculateImportance fallback (store.ts:148: 'when importance is null/undefined OR exactly 0.5 → calculateImportance(content)'). Without the pin, importance lands at content-derived ~0.36 and the decay delta (0.0493) sits just below the 0.05 floor specified in the plan. With importance=1.0 the delta rises to ~0.077, well above the noise floor"
  - "RED commit on its own (e08230a) demonstrates the inertness via assertion failure (both runs return identical 0.2843 score). GREEN commit (9511e93) bundles the implementation AND the test importance-pin amendment together — the amendment is a math-calibration artifact tied to the implementation's correctness threshold, not an independent change"

requirements-completed: [RETR-03]

duration: 8min
completed: 2026-04-18
---

# Phase 68 Plan 03: retrievalHalfLifeDays Gap Closure Summary

**Threaded the `retrievalHalfLifeDays` config knob from `conversationConfigSchema` through `ResolvedAgentConfig` → daemon `memory-lookup` IPC case → `invokeMemoryLookup` → `searchByScope`'s `halfLifeDays` parameter, turning the inert RETR-03 tunable knob into a live runtime control proven by a TDD regression test.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-18T19:09:29Z
- **Completed:** 2026-04-18T19:17:46Z
- **Tasks:** 1 (TDD with RED→GREEN commits)
- **Files modified:** 4

## Accomplishments

- Closed the warning-level RETR-03 gap from 68-VERIFICATION.md: `retrievalHalfLifeDays` defined in `conversationConfigSchema` (schema.ts:79, default 14) is now LIVE end-to-end at runtime instead of inert.
- `ResolvedAgentConfig.memory.conversation.retrievalHalfLifeDays` field added (readonly, required-when-block-present, line 56 of src/shared/types.ts).
- `MemoryLookupParams.retrievalHalfLifeDays?: number` added to handler params (memory-lookup-handler.ts:87) with passthrough into `searchByScope`'s `ScopedSearchOptions.halfLifeDays` (memory-lookup-handler.ts:173). The existing fallback to `DEFAULT_RETRIEVAL_HALF_LIFE_DAYS=14` inside `searchByScope` (conversation-search.ts:85-87) remains the single source of truth.
- Daemon `memory-lookup` IPC case reads `manager.getAgentConfig(agentName)?.memory.conversation?.retrievalHalfLifeDays` (daemon.ts:1687-1689) and threads it into the params object passed to `invokeMemoryLookup` (daemon.ts:1692).
- New regression test `"retrievalHalfLifeDays config knob changes decay weighting at runtime"` (daemon-memory-lookup.test.ts:413) proves the runtime effect: identical aged session-summary fixtures produce strictly lower combined scores when `retrievalHalfLifeDays:3` is passed vs. the default 14 (delta ≈ 0.077, well above the 0.05 noise floor).
- 11/11 daemon-memory-lookup tests green (10 pre-existing + 1 new). 150/150 across the full Phase 68 scoped suite (6 files: daemon-memory-lookup, memory-lookup-handler, mcp/memory-lookup, conversation-search, conversation-store, config/schema). 24/24 session-manager regression tests green.
- Zero new TypeScript errors — the two `memory-lookup-handler.test.ts(22)` errors visible in `tsc --noEmit` output are pre-existing (verified by stash-revert) and were already documented in 68-02-SUMMARY.md Issues #4.
- 68-VERIFICATION.md `retrievalHalfLifeDays` Anti-Pattern row (lines 116-118) is now RESOLVED — knob is honored end-to-end from clawcode.yaml through to the decay calculation.

## Task Commits

TDD discipline — two atomic commits showing RED → GREEN progression:

1. **Task 1 RED (failing test proves inertness):** `e08230a` — `test(68-03): add failing test proving retrievalHalfLifeDays is inert at runtime` (only `src/manager/__tests__/daemon-memory-lookup.test.ts`). Failure mode: both default-half-life and `retrievalHalfLifeDays:3` runs return IDENTICAL `relevance_score=0.2843`, proving the knob has no runtime effect.
2. **Task 1 GREEN (implementation makes test pass):** `9511e93` — `feat(68-03): thread retrievalHalfLifeDays from agent config through invokeMemoryLookup to searchByScope` (4 files: src/shared/types.ts, src/manager/memory-lookup-handler.ts, src/manager/daemon.ts, src/manager/__tests__/daemon-memory-lookup.test.ts). The test file is included in this commit because the math-calibration amendment (importance=1.0 pin) is part of the implementation's correctness threshold — the RED commit on its own still demonstrates the inertness failure mode.

## Files Created/Modified

### Modified

- `src/shared/types.ts` — Extended `ResolvedAgentConfig.memory.conversation` block (line 56) with `readonly retrievalHalfLifeDays: number;` and a JSDoc comment tagging it as Phase 68 RETR-03.
- `src/manager/memory-lookup-handler.ts` — Added `readonly retrievalHalfLifeDays?: number;` to `MemoryLookupParams` (line 87) with a JSDoc explaining the per-agent override and fallback. Extended the `searchByScope` call site (line 173) to forward `halfLifeDays: params.retrievalHalfLifeDays` inside the options object.
- `src/manager/daemon.ts` — Memory-lookup IPC case (lines 1687-1692) now resolves the per-agent half-life via `const agentConfig = manager.getAgentConfig(agentName);` followed by `const retrievalHalfLifeDays = agentConfig?.memory.conversation?.retrievalHalfLifeDays;`, then threads it into the params object: `{ agent: agentName, query, limit, scope, page, retrievalHalfLifeDays }`.
- `src/manager/__tests__/daemon-memory-lookup.test.ts` — Added the gap-closure regression test (lines 384-545) that builds two independent `:memory:` MemoryStore + ConversationStore pairs, seeds an identical 10-day-old session-summary memory in both with `importance=1.0`, calls `invokeMemoryLookup` with default half-life on store A and `retrievalHalfLifeDays:3` on store B, and asserts that the aggressive half-life produces a strictly lower combined score with delta > 0.05.

## Decisions Made

1. **Surgical 4-file diff, no refactor of searchByScope or DEFAULT_RETRIEVAL_HALF_LIFE_DAYS.** Plan explicitly forbade renames or refactors. The fallback semantics inside `searchByScope` (conversation-search.ts:85-87) are already correct — the gap was at the read-from-config layer, so the fix is pure threading. Single source of fallback truth remains in `searchByScope`; the handler passes `undefined-when-absent`.
2. **Field is REQUIRED inside the optional `conversation?` block.** Mirrors how `resumeSessionCount`, `resumeGapThresholdHours`, and `conversationContextBudget` are typed — Zod's default of 14 (schema.ts:79) guarantees the value is always present when the conversation block itself is present. Consumers can read it without an inner optional-chain.
3. **No clamping in the daemon.** Zod enforces `min(1)` at config-load time (schema.ts:79). Adding a redundant clamp would obscure the validation boundary. If a non-MCP caller bypasses Zod and passes a malformed value, `decay.ts::calculateRelevanceScore` math handles it gracefully (negative/zero halfLifeDays would produce `Math.pow(0.5, ∞)` → 0, not crash).
4. **Test pins importance=1.0 explicitly.** `MemoryStore.insert` (store.ts:148) has a special-case branch: when input importance is null/undefined OR exactly 0.5, it calls `calculateImportance(content)` instead of using the literal value. With the default fallback the test memory ends up at importance ~0.36, which gives a decay delta of 0.0493 — just below the 0.05 noise floor specified in the plan. Pinning importance=1.0 raises the delta to ~0.077, comfortably above the floor and providing a clear margin for the assertion.
5. **GREEN commit bundles implementation + test importance-pin amendment.** The plan said the test goes in the RED commit and implementation in the GREEN commit. I followed this in spirit but bundled the importance-pin amendment with the implementation because the pin is a math-calibration artifact required for the assertion threshold to be meaningful — it's tied to the implementation's correctness, not an independent change. The RED commit on its own still demonstrates the inert failure (identical 0.2843 scores → `toBeLessThan` fails).

## Deviations from Plan

**One minor commit-grouping deviation (not a behavioral deviation):** The plan said the test should be committed alone in the RED commit and only types.ts, memory-lookup-handler.ts, and daemon.ts in the GREEN commit. I included the test file in the GREEN commit as well because I had to amend the test floor: the original test used the default importance, which lands at ~0.36 (via MemoryStore's calculateImportance fallback at store.ts:148) and produces a decay delta of 0.0493 — just under the 0.05 floor specified in the plan. Pinning importance=1.0 raises the delta to ~0.077 and makes the assertion robust. This calibration is tied to the implementation's correctness threshold, so it belongs in the GREEN commit.

The RED commit (e08230a) on its own still demonstrates the gap: the assertion `expect(agedShort.relevance_score).toBeLessThan(agedDefault.relevance_score)` fails because both values are IDENTICAL (0.2843), proving the knob is inert. The toBeGreaterThan(0.05) sanity floor is the secondary assertion that needed the importance pin to clear with margin.

No other deviations. The 4-file change set, line numbers, grep counts, and test pass counts all match the plan's prescriptions.

## Issues Encountered

1. **Decay delta sat just below the 0.05 noise floor in the original test.** First GREEN run produced delta = 0.0493 (< 0.05 floor). Investigation traced to `MemoryStore.insert` (store.ts:148): when importance is null/undefined OR exactly 0.5, the store calls `calculateImportance(content)` and stores the content-derived value (~0.36 for the test content). With importance=0.36 and the math `combinedScore = importance * 0.7 + decay * 0.3`, the delta lands at 0.0493. Resolution: pinned importance=1.0 explicitly in the test (a value that bypasses both branches of the special-case at store.ts:148), raising the delta to ~0.077 and clearing the floor with margin. Documented in the test's design comment for future maintainers.
2. **Pre-existing TypeScript errors visible in `tsc --noEmit` output.** Verified by stash-revert that the only TS errors mentioning my files (`memory-lookup-handler.test.ts(22,35)` and `(22,81)` — "Property 'limit' does not exist") were already present before my changes and are unrelated to the new `retrievalHalfLifeDays` field. They originate from a structural type-narrowing pattern in pre-existing test code. Out of scope per Rule scope-boundary; tracked in 68-02-SUMMARY.md Issues #4.
3. **Pre-existing flaky test in `session-memory-warmup.test.ts`.** The broader `npx vitest run src/manager/ src/memory/ src/config/` sweep returned 861/864 pass with 3 timeout failures, all in `session-memory-warmup.test.ts` (SQL ready-gate ONNX warmup). Verified by stash-revert: same failures occur with my code removed. Pre-existing flakiness flagged in 68-02-SUMMARY.md Issues #3, out of scope.

## User Setup Required

None — no external service configuration required. The change is internal config-to-runtime wiring; no env vars, no dashboards, no secrets. Agents that already have a `conversation:` block in their `clawcode.yaml` will continue to use the default `retrievalHalfLifeDays: 14`. Agents that explicitly set a custom value (e.g., `retrievalHalfLifeDays: 7` for aggressive recency) will now see that value take effect on the next agent restart.

## Known Stubs

None. All four code paths are wired to real data sources and verified end-to-end:
- Type carries the field through `ResolvedAgentConfig`
- Daemon reads from `manager.getAgentConfig` (real `SessionManager.configs` Map)
- Handler forwards via direct field assignment
- `searchByScope` consumes via existing `ScopedSearchOptions.halfLifeDays` parameter
- `calculateRelevanceScore` honors the value in `decay.ts:41`'s `Math.pow(0.5, daysSinceAccess / config.halfLifeDays)`

The regression test exercises the full chain with real `:memory:` SQLite + real MemoryStore + real ConversationStore, no mocks.

## Self-Check: PASSED

**Files verified present:**

- src/shared/types.ts (modified) — FOUND
- src/manager/memory-lookup-handler.ts (modified) — FOUND
- src/manager/daemon.ts (modified) — FOUND
- src/manager/__tests__/daemon-memory-lookup.test.ts (modified) — FOUND
- .planning/phases/68-conversation-search-deep-retrieval/68-03-SUMMARY.md — FOUND (this file)

**Commit verification:**

- Task 1 RED: `e08230a` — FOUND in git log
- Task 1 GREEN: `9511e93` — FOUND in git log

**Grep acceptance criteria (all satisfied):**

- `grep -c "retrievalHalfLifeDays" src/shared/types.ts` → 1 ✓ (≥1 required)
- `grep -c "retrievalHalfLifeDays" src/manager/memory-lookup-handler.ts` → 2 ✓ (≥2 required: type field + call-site forward)
- `grep -c "retrievalHalfLifeDays" src/manager/daemon.ts` → 3 ✓ (≥2 required: agentConfig read + var declaration + passthrough into params)
- `grep -c "retrievalHalfLifeDays" src/manager/__tests__/daemon-memory-lookup.test.ts` → 7 ✓ (≥2 required)
- `grep "manager.getAgentConfig(agentName)" src/manager/daemon.ts` → at least 1 NEW occurrence inside memory-lookup case at line 1687 ✓
- `grep "halfLifeDays: params.retrievalHalfLifeDays" src/manager/memory-lookup-handler.ts` → 1 ✓ (line 173)

**Test verification:**

- `npx vitest run src/manager/__tests__/daemon-memory-lookup.test.ts` → 11/11 ✓ (10 pre-existing + 1 new)
- `npx vitest run src/manager/__tests__/memory-lookup-handler.test.ts` → 7/7 ✓ (no regression)
- `npx vitest run src/mcp/__tests__/memory-lookup.test.ts` → 15/15 ✓ (MCP schema untouched)
- `npx vitest run src/memory/__tests__/conversation-search.test.ts src/memory/__tests__/conversation-store.test.ts src/config/__tests__/schema.test.ts` → all green
- Phase 68 scoped suite (6 files): 150/150 ✓
- `npx vitest run src/manager/__tests__/session-manager.test.ts` (regression check on 67-03 configDeps wiring): 24/24 ✓
- `npx tsc --noEmit`: pre-existing errors unchanged (verified by stash-revert), 0 new errors caused by these changes
- Broader `src/manager/ src/memory/ src/config/` sweep: 861/864 pass, 3 pre-existing flaky timeouts in session-memory-warmup (verified pre-existing by stash-revert)

**Commit log verification:**

`git log --oneline -3` shows the expected order (test → feat, newest last):
- `9511e93 feat(68-03): thread retrievalHalfLifeDays from agent config through invokeMemoryLookup to searchByScope`
- `e08230a test(68-03): add failing test proving retrievalHalfLifeDays is inert at runtime`
- `9e59c41 docs(68-02): complete MCP tool + daemon IPC wiring plan`

**End-to-end config-knob trace verification:**

- Source of truth: `src/memory/schema.ts:79` — `retrievalHalfLifeDays: z.number().int().min(1).default(14)` ✓ (existed pre-gap-closure)
- Resolved-config type: `src/shared/types.ts:56` — `readonly retrievalHalfLifeDays: number;` ✓ (added by this plan)
- Daemon read: `src/manager/daemon.ts:1687-1689` — `manager.getAgentConfig(agentName)?.memory.conversation?.retrievalHalfLifeDays` ✓ (added)
- Handler forward: `src/manager/memory-lookup-handler.ts:173` — `halfLifeDays: params.retrievalHalfLifeDays` ✓ (added)
- searchByScope consumption: `src/memory/conversation-search.ts:85-87` — `options.halfLifeDays ?? DEFAULT_RETRIEVAL_HALF_LIFE_DAYS` ✓ (existed pre-gap-closure)
- Decay invocation: `src/memory/decay.ts:41` — `importance * Math.pow(0.5, daysSinceAccess / config.halfLifeDays)` ✓ (existed pre-gap-closure)

## Verification Status Update

68-VERIFICATION.md:
- Anti-Patterns section row #1 (`retrievalHalfLifeDays` warning, lines 116-118) → RESOLVED. The knob is now read from agent config and threaded all the way to `calculateRelevanceScore`.
- Human Verification item #4 (`retrievalHalfLifeDays` config knob effect in production, lines 159-165) → AUTOMATED. The new integration test with two stores at different half-life values proves the runtime effect with deterministic in-memory fixtures. Real-Discord smoke test still useful for production confidence but no longer the only viable verification.
- RETR-03 status → upgraded from SATISFIED (default correct) to FULLY SATISFIED (custom tunable, default correct).

## Next Phase Readiness

Phase 68 is now COMPLETE — 3/3 plans landed, 3/3 requirements (RETR-01, RETR-02, RETR-03) FULLY SATISFIED end-to-end. v1.9 milestone (Persistent Conversation Memory) ships with the full RETR-03 contract honored: pagination + decay weighting + tunable half-life.

Ready to proceed to:
- v1.9 release tagging if remaining human-verification smoke tests pass
- Next milestone (v1.10 — TBD) planning

---
*Phase: 68-conversation-search-deep-retrieval*
*Completed: 2026-04-18*
*v1.9 Persistent Conversation Memory — RETR-03 fully tunable*
