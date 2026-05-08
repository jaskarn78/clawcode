---
phase: 115-memory-context-prompt-cache-redesign
plan: 03
subsystem: memory + context-assembly
tags: [tier-1-budget, drop-lowest-importance, head-tail-truncate, hermes-phase1, tool-output-prune, type-safety, discriminated-union]

# Dependency graph
requires:
  - phase: 53-context-assembly-budgets
    provides: DEFAULT_PHASE53_BUDGETS surface + per-section enforcement skeleton (115-03 D-02 retunes the values + replaces enforceWarnAndKeep with real strategies)
  - phase: 115-00-baseline
    provides: traces.db tier1_inject_chars + tier1_truncation_event_count columns (T01's recordTier1TruncationEvent sink calls into these defensively via typeof guard)
  - phase: 115-02-observability
    provides: [diag] tier1-truncation operator-surface warn (T01 upgrades the action label and field shape; existing test file is co-extended to assert the new shape)
provides:
  - INJECTED_MEMORY_MAX_CHARS = 16_000 (D-01 hard cap on MEMORY.md auto-load body — replaces legacy 50KB byte cap on the assembly path)
  - STABLE_PREFIX_MAX_TOKENS = 8_000 (D-02 outer cap on the assembled stable prefix — emergency head-tail truncate fires when per-section enforcement still leaves total over cap)
  - ContextSources carved sub-source fields (identitySoulFingerprint / identityFile / identityCapabilityManifest / identityMemoryAutoload) — separable budgeting per D-02
  - DEFAULT_PHASE53_BUDGETS retuned to the D-02 lock (identity 4000, soul 0, hot_tier 1000, recent_history 8000)
  - enforceDropLowestImportance — priority-ordered drop for the carved identity (SOUL fingerprint never dropped; MEMORY.md drops first; capability bullet-truncates; IDENTITY.md head-tail-truncates last)
  - headTailTruncate helper — Hermes 70/20 split with `[TRUNCATED — N chars dropped]` marker
  - enforceTotalStablePrefixBudget — D-02 outer-cap fallback emitting log.error action=stable-prefix-cap-fallback when fired
  - MemoryTier1Source / MemoryTier2Source discriminated-union TypeScript types (sub-scope 11)
  - TypedMemorySource union alias (NOT named MemorySource — back-compat with pre-existing string-union)
  - ContextSources.identityMemoryAutoloadSource: MemoryTier1Source | undefined (Plan 115-04 consumption surface)
  - src/memory/tool-output-prune.ts — pruneToolOutputs(turns, options) no-LLM Hermes Phase 1 prune + pruneSavingsPct helper
  - CompactionManager.compactToolOutputs(turns, options?) — pre-compaction hook callers can invoke before any (deferred) Phase-2 LLM-driven path
affects:
  - 115-04 (lazy-load MCP tools — will read identityMemoryAutoloadSource by name; pinned field name)
  - 115-05 (cache-breakpoint placement — outer-cap enforcement landed here makes cache-stable-region size predictable)
  - 115-08 (dream-pass priority scheduler — recordTier1TruncationEvent sink wired here, defensively)
  - 115-09 (closeout — perf-comparisons can measure stable-prefix size against the new 8K cap)
  - 999.40 (folded into 115; tool-output prune is the no-LLM precursor to the deferred LLM-driven Phases 2 + 3)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - additive-back-compat-typed-source — ContextSources.identityMemoryAutoloadSource is a NEW optional field carrying typed Tier 1 metadata; the existing identityMemoryAutoload raw string field stays so the assembler render path is unchanged. Plan 115-04 will read the typed field by name without breaking 115-03 callers.
    - string-literal-discriminator-no-collision — MemoryTier1Source / MemoryTier2Source use `tier: "tier1"` / `tier: "tier2"` string-literal discriminators rather than redefining the existing `MemoryTier = "hot" | "warm" | "cold"` type. Avoids name collision with the storage tier (used widely on MemoryEntry); keeps the two concerns separate at call sites.
    - alias-rename-to-avoid-shadowing — the discriminated union is exported as `TypedMemorySource`, NOT `MemorySource`. Pre-existing `MemorySource = "conversation" | "manual" | ...` string union stays intact; both can be imported from the same file without conflict.
    - identity-priority-order-with-soul-protected — enforceDropLowestImportance ranks the four carved sub-sources by importance: SOUL fingerprint (verbatim, extractor-bounded ≤1200 chars) > IDENTITY.md > capability manifest > MEMORY.md autoload. SOUL never drops; MEMORY.md drops first.
    - hermes-70-20-head-tail-truncation — headTailTruncate keeps the first 70% + last 20% of content with a [TRUNCATED — N chars dropped] marker between. Middle 10% is dropped. Direct adoption from Hermes' context_compressor.py reference architecture (sota-synthesis.md §1.1).
    - outer-cap-emergency-fallback-with-grep-friendly-log — enforceTotalStablePrefixBudget head-tail-truncates the WHOLE assembled stable prefix when per-section budgets still leave total over 8K. Emits log.error with action=stable-prefix-cap-fallback so operators can grep for the safety-net firing in production.
    - immutable-prune-pass-through-by-reference — pruneToolOutputs returns a new array; turns that are unchanged are returned by reference (the same object), so deep-equality checks short-circuit in downstream Phase 67 conversation-brief consumers. Only mutated turns are freshly-frozen.
    - regex-fallback-with-explicit-flag — pruneToolOutputs detects tool outputs via either (a) explicit isToolOutput=true flag OR (b) <tool_use_result>...</tool_use_result> XML envelope inside content. Resets regex.lastIndex after each test (g-flag stateful regex pitfall avoided).
    - synchronous-no-LLM-pure-fn — pruneToolOutputs is a pure synchronous function (no `await`, no I/O, no dispatch). Test asserts <50ms total runtime as the no-LLM regression pin.
    - anti-thrash-as-caller-responsibility — pruneToolOutputs does NOT bake anti-thrash tracking into its signature; the caller (CompactionManager) owns thrash detection and decides whether to call. Keeps the function predictable: same input → same output.

key-files:
  created:
    - src/memory/__tests__/tier-source-types.test.ts (6 tests — Tier 1 / Tier 2 union shape + discriminator narrowing + back-compat with pre-existing aliases)
    - src/memory/tool-output-prune.ts (pruneToolOutputs + pruneSavingsPct + ToolOutputTurn type)
    - src/memory/__tests__/tool-output-prune.test.ts (13 tests — prune behavior + marker format + immutability + min-bytes floor + XML-envelope fallback + savings-pct)
    - src/manager/__tests__/context-assembler-tier1-budget.test.ts (7 tests — INJECTED_MEMORY_MAX_CHARS handling + carved sub-source assembly + truncation marker emission; T01)
    - src/manager/__tests__/context-assembler-drop-lowest.test.ts (9 tests — drop-lowest-importance ordering + outer-cap fallback + legacy compound path; T02)
    - .planning/phases/115-memory-context-prompt-cache-redesign/115-03-SUMMARY.md (this file)
  modified:
    - src/memory/types.ts (+ MemoryTier1Source / MemoryTier2Source / TypedMemorySource — sub-scope 11; T03)
    - src/manager/context-assembler.ts (massive: T01 added carved sub-source fields + INJECTED_MEMORY_MAX_CHARS + STABLE_PREFIX_MAX_TOKENS + retuned DEFAULT_PHASE53_BUDGETS; T02 replaced enforceWarnAndKeep with enforceDropLowestImportance + headTailTruncate + enforceTotalStablePrefixBudget; T03 added optional identityMemoryAutoloadSource + import MemoryTier1Source)
    - src/manager/session-config.ts (T01: build four sub-sources + 16K char head-tail truncate marker for MEMORY.md; T02: thread deps.log + agent name through to AssembleOptions for outer-cap fallback)
    - src/memory/compaction.ts (T04: import pruneToolOutputs + add CompactionManager.compactToolOutputs() pre-compaction hook + log savedPct on fire)
    - src/manager/__tests__/context-assembler.test.ts (T01 + T02: updated Test 1 / Test 2 / Test 6 / Test 11 / Test 14 — warn-and-keep → drop-lowest semantics; soul: 0 budget folded; carved-source path)
    - src/manager/__tests__/session-config-115-truncation-warn.test.ts (T01: assert new tier1-truncation action label + dream-pass-priority marker + 16K char cap)

key-decisions:
  - "INJECTED_MEMORY_MAX_CHARS = 16_000 (not Hermes' 20_000) gives 4K-char headroom under the 8K-token outer cap — Hermes ran with looser outer constraints; we run tighter for the 11-agent / 8-12 GB headroom box."
  - "STABLE_PREFIX_MAX_TOKENS = 8_000 is the *enforced* cap; 10K fleet p95 + 12K fin-acq are P1 *delivery* targets (softer goals the cap should produce in normal load). The cap is stricter than the targets to give safety margin under spike load."
  - "Identity drop ordering: SOUL fingerprint (extractor-bounded ≤1200 chars, never drops) > IDENTITY.md (head-tail truncate) > capability manifest (bullet-truncate) > MEMORY.md autoload (drops first). Preserves operator-curated identity content over machine-generated context."
  - "Soul section budget = 0 in DEFAULT_PHASE53_BUDGETS (D-02 lock). When upstream folds SOUL into identity (existing pattern in session-config.ts), the soul block is empty and contributes 0 tokens. When a future caller passes non-empty soul, it head-tail truncates per D-04 (positive overrides truncate normally; budget=0 drops content entirely)."
  - "Discriminated-union types use string-literal `tier: \"tier1\"` / `tier: \"tier2\"` discriminators in line, NOT a top-level `MemoryTier = \"tier1\" | \"tier2\"` alias. The pre-existing `MemoryTier = \"hot\" | \"warm\" | \"cold\"` storage-tier alias stays intact; both can coexist by value (storage tier on MemoryEntry rows; source tier on TypedMemorySource interfaces)."
  - "TypedMemorySource union alias deliberately NOT named MemorySource — collides with pre-existing `MemorySource = \"conversation\" | \"manual\" | ...` string union widely consumed by MemoryEntry, CreateMemoryInput, and others. Renaming would break ~50+ call sites for negative ROI; the new name is unambiguous."
  - "ContextSources.identityMemoryAutoloadSource is a NEW optional typed field; the existing identityMemoryAutoload raw string field stays so the assembler render path is unchanged. Plan 115-04 reads the typed field by name (pinned). When both are populated they MUST agree (raw === typed.content) — invariant called out in the field's docstring."
  - "pruneToolOutputs is a PURE synchronous function — no await, no I/O, no dispatch. Test asserts <50ms total runtime as the no-LLM regression pin (a real LLM call would take >50ms minimum)."
  - "pruneToolOutputs returns a new array but pass-through turns are returned by reference. Only modified turns are freshly-frozen. Optimization for downstream Phase 67 conversation-brief deep-equality checks."
  - "Anti-thrash tracking is the CALLER's responsibility (CompactionManager). pruneToolOutputs has predictable input → output behavior so it composes cleanly with whatever scheduling logic the caller uses."
  - "Phases 2 (LLM mid-summarization) and 3 (drop oldest) are explicitly DEFERRED per CONTEXT.md 'out of scope' line 32. Sub-scope 9 ships ONLY the cheap no-LLM Phase 1; deferral noted in tool-output-prune.ts docstring so future readers see the boundary."
  - "T03 simplified scope per orchestrator's plan_summary_remaining: PLAN.md described modifying session-config.ts + memory-retrieval.ts to consume MemoryTier1Source / MemoryTier2Source directly. Orchestrator scoped T03 down to JUST adding types + an optional ContextSources field. Existing identityMemoryAutoload raw string field stays; render path unchanged. Plan 115-04 owns the upstream construction site."
  - "T04 simplified scope per orchestrator's plan_summary_remaining: PLAN.md described pruneOldToolOutputs with anti-thrash baked in + a separate marker format. Orchestrator scoped T04 down to pruneToolOutputs (with anti-thrash as caller responsibility) and a different marker format ([tool output pruned: <tool> @ <ts>]). Marker format pinned by acceptance criteria."

patterns-established:
  - "Phase 115 carved-source pattern: when a single concatenated string crosses too many domains for budget enforcement, split it into typed sub-source fields on ContextSources. Each gets its own importance, its own truncation strategy, and its own per-source budget. The legacy compound field stays for back-compat. Composer (composeCarvedIdentity) renders the carved fields back into the legacy concatenation order so the stable-prefix hash is byte-compatible for unchanged content."
  - "Phase 115 outer-cap-after-per-section pattern: per-section budgets + an outer cap with emergency fallback. After all per-section enforcement, if the joined total still exceeds the outer cap, fire a single emergency head-tail truncate across the whole result with a grep-friendly log line. The fallback is structural insurance — should not normally fire, but when it does, the log makes it visible."
  - "Phase 115 string-literal-discriminator-without-alias-collision pattern: when introducing a new discriminated union into a module that already exports a string-union alias of similar name, use string-literal discriminators in the new interfaces and DO NOT redefine the existing alias. Export the new union under a non-colliding alias name (TypedMemorySource here)."
  - "Phase 115 Hermes-Phase-1-as-pre-compaction-hook pattern: ship the cheap no-LLM compaction primitive as a synchronous pure function callable inline on the response path. Anti-thrash and budget logic live in the caller. The function is composable with whatever orchestration the caller chooses."

requirements-completed: []  # PLAN.md frontmatter `requirements:` is empty — sub-scopes 1, 9, 11 are tracked in the phase's CONTEXT.md / ROADMAP.md, not as numbered requirements.

# Metrics
duration: ~95min (active work across T01 + T02 + T03 + T04; build + test cycles; advisor consultation pre-T03)
completed: 2026-05-08
---

# Phase 115 Plan 03: Structural backbone — hard tier-1 budget + Tier 1/Tier 2 formal split + no-LLM tool-output prune Summary

**Replaces the `enforceWarnAndKeep` no-op with real `drop-lowest-importance` enforcement; carves the identity stable-prefix into four typed sub-sources with separable per-source budgets; lands `INJECTED_MEMORY_MAX_CHARS = 16_000` D-01 hard cap and `STABLE_PREFIX_MAX_TOKENS = 8_000` D-02 outer cap with emergency head-tail-truncate fallback; formalizes the Tier 1 / Tier 2 split as TypeScript discriminated-union types; ships the cheap no-LLM Phase 1 of Hermes-style three-phase tool-output compression as a pre-compaction hook callable inline on the response path.**

This is the structural backbone for Phase 115. After this plan, the 33K-char `systemPrompt.append` failure mode that produced the 2026-05-07 fin-acquisition incident has its enforcement floor — per-section budgets sum well under 8K tokens, the outer cap fires an emergency truncate when they don't, and SOUL fingerprint (operator-curated identity essence) is verbatim-protected even at extreme budget pressure.

## Performance

- **Duration:** ~95 min (active work)
- **Started:** 2026-05-08T02:37Z (T01 first commit)
- **Completed:** 2026-05-08T03:01Z (T04 commit) + ~10 min for SUMMARY
- **Tasks:** 4 (T01, T02 already committed before this resumption; T03, T04 completed in this session)
- **Files modified:** 11 (5 new test files + 1 new module + 5 source files modified; this SUMMARY)
- **Lines added/removed (net):** +1361 / -71 across the 4 commits

## Accomplishments

### T01 (commit `7c1fb00`) — Carve identity into 4 sub-source fields + INJECTED_MEMORY_MAX_CHARS hard cap

- ContextSources gains four optional sub-source fields: `identitySoulFingerprint` (highest importance — never dropped), `identityFile` (mid — head-tail-truncated), `identityCapabilityManifest` (mid-low — bullet-truncated), `identityMemoryAutoload` (lowest — separately bounded by INJECTED_MEMORY_MAX_CHARS already).
- New constants exported from `context-assembler.ts`: `INJECTED_MEMORY_MAX_CHARS = 16_000` (D-01 hard cap; replaces the legacy 50KB byte cap on the assembly path) and `STABLE_PREFIX_MAX_TOKENS = 8_000` (D-02 outer cap; T02 enforces it).
- `DEFAULT_PHASE53_BUDGETS` retuned to the D-02 lock: identity 4000, soul 0 (folded), hot_tier 1000, recent_history 8000 (unchanged).
- `session-config.ts` builds the four sub-sources separately AND composes the legacy `identityStr` for back-compat. MEMORY.md auto-load now uses 16K char head-tail (70/20) truncation with marker `[TRUNCATED — N chars dropped, dream-pass priority requested]`.
- Daemon-side warn upgraded action label `memory-md-truncation` → `tier1-truncation` with `originalChars` / `capChars` / `droppedChars` / `file` fields.
- Cross-plan defensive guard for `traceCollector.recordTier1TruncationEvent` (typeof === function — method/column from 115-00, defensive sink).
- New test file `context-assembler-tier1-budget.test.ts` (7 tests). Existing 115-02 truncation-warn test updated to assert the new shape.

### T02 (commit `b93022b`) — Replace enforceWarnAndKeep with drop-lowest-importance + 8K outer cap

- Removed `enforceWarnAndKeep` no-op entirely. Added three real-enforcement helpers:
  - `headTailTruncate`: Hermes 70/20 split with `[TRUNCATED — N chars dropped]` marker between head and tail.
  - `enforceDropLowestImportance`: priority-ordered drop for the carved identity sub-sources. SOUL fingerprint verbatim-protected; MEMORY.md auto-load drops first; capability manifest bullet-truncates; IDENTITY.md head-tail-truncates last.
  - `enforceTotalStablePrefixBudget`: D-02 outer cap enforcement. After all per-section budgets, head-tail-truncates the whole 8K-token cap when still over. Emits `log.error` with `action=stable-prefix-cap-fallback`.
- Soul block also pivots to head-tail truncate (D-02 budget=0 by default — drops content entirely; positive overrides truncate normally).
- Legacy single-string `sources.identity` path (no carved fields) gets the simple head-tail truncate at the per-section budget. This BREAKS the Phase 53 "identity is preserved verbatim" contract; updated tests pin the new contract.
- `AssembleOptions` extended with optional `agentName` + `log` fields so the outer-cap fallback can emit operator-grep-friendly logs.
- New test file `context-assembler-drop-lowest.test.ts` (9 tests).
- `grep -n 'enforceWarnAndKeep' src/manager/context-assembler.ts` now returns matches only in docstring comments — function call sites are GONE.

### T03 (commit `ac0585c`) — Formal Tier 1 / Tier 2 split via discriminated-union types

- Added `MemoryTier1Source` / `MemoryTier2Source` interfaces in `src/memory/types.ts` with string-literal `tier` discriminators. Tier 1 = file-backed semantic memory (SOUL/IDENTITY/MEMORY/USER markdown files, hard-capped, always-injected); Tier 2 = chunk-backed episodic memory (memory_chunks + memories DB tables, hybrid-retrieved via tools).
- Exported `TypedMemorySource = MemoryTier1Source | MemoryTier2Source` union alias (deliberately NOT named `MemorySource` to preserve back-compat with the legacy `"conversation" | "manual" | ...` string union widely consumed by `MemoryEntry` and `CreateMemoryInput`).
- Added optional `identityMemoryAutoloadSource: MemoryTier1Source` field on `ContextSources`. Plan 115-04 will consume this field by name (pinned). The existing `identityMemoryAutoload` raw string field stays so the assembler render path is unchanged.
- New test file `src/memory/__tests__/tier-source-types.test.ts` (6 tests) pins union shape + discriminator narrowing + back-compat with pre-existing `MemorySource` / `MemoryTier` aliases.

### T04 (commit `df2bebe`) — No-LLM tool-output prune (Hermes Phase 1)

- Created `src/memory/tool-output-prune.ts` with `pruneToolOutputs(turns, options?)` that replaces tool outputs older than the most-recent N turns (default 3) with 1-line markers: `[tool output pruned: <tool_name> @ <timestamp>]`.
- Pure module: no I/O, no LLM dispatch, no async. Returns a new array; unaffected turns are returned by reference (deep-equality short-circuits in downstream Phase 67 conversation-brief consumers).
- Detects tool outputs via either (a) explicit `isToolOutput=true` flag, or (b) the `<tool_use_result>...</tool_use_result>` XML envelope inside content.
- Skips tiny outputs (<200 bytes default) to keep debug-friendly results intact; uses `<unknown>` when toolName is absent.
- Wired `CompactionManager.compactToolOutputs(turns, options?)` as the pre-compaction hook callers can invoke before any (deferred) Phase-2 LLM-driven path. Logs `savedPct` via `deps.log` when prune fires.
- Phases 2 (LLM mid-summarization) and 3 (drop oldest) explicitly DEFERRED per CONTEXT.md "out of scope" line 32; deferral noted in `tool-output-prune.ts` docstring.
- New test file `src/memory/__tests__/tool-output-prune.test.ts` (13 tests).

## Task Commits

Each task was committed atomically per the plan's hard ordering (T01 → T02 → T03 → T04):

1. **T01: carve identity sub-sources + INJECTED_MEMORY_MAX_CHARS=16K char cap** — `7c1fb00` (feat)
   - 5 files: context-assembler.ts (+149/-?), session-config.ts (+160/-?), context-assembler-tier1-budget.test.ts (+133), context-assembler.test.ts (test updates), session-config-115-truncation-warn.test.ts (test updates).
   - Net: +450 / -70 lines.

2. **T02: replace enforceWarnAndKeep with drop-lowest-importance + 8K outer cap** — `b93022b` (feat)
   - 4 files: context-assembler.ts (+359), context-assembler-drop-lowest.test.ts (+280 new), context-assembler.test.ts (test updates), session-config.ts (+27).
   - Net: +656 / -50 lines.

3. **T03: formal Tier 1 / Tier 2 split via discriminated-union types** — `ac0585c` (feat)
   - 3 files: types.ts (+95), tier-source-types.test.ts (+174 new), context-assembler.ts (+18 — optional field + import).
   - Net: +286 / -1 lines.

4. **T04: no-LLM tool-output prune (Hermes Phase 1)** — `df2bebe` (feat)
   - 3 files: tool-output-prune.ts (+173 new), tool-output-prune.test.ts (+205 new), compaction.ts (+41).
   - Net: +419 / -0 lines.

## Files Created/Modified

**Created:**
- `src/memory/__tests__/tier-source-types.test.ts` — 6 tests pinning Tier 1 / Tier 2 union shape (T03)
- `src/memory/tool-output-prune.ts` — no-LLM Hermes Phase 1 prune module (T04)
- `src/memory/__tests__/tool-output-prune.test.ts` — 13 tests for prune behavior (T04)
- `src/manager/__tests__/context-assembler-tier1-budget.test.ts` — 7 tests for carved sub-source budgeting (T01)
- `src/manager/__tests__/context-assembler-drop-lowest.test.ts` — 9 tests for drop-lowest-importance + outer-cap fallback (T02)
- `.planning/phases/115-memory-context-prompt-cache-redesign/115-03-SUMMARY.md` — this file

**Modified (source):**
- `src/memory/types.ts` — added `MemoryTier1Source` / `MemoryTier2Source` / `TypedMemorySource` (T03)
- `src/manager/context-assembler.ts` — T01: carved sub-source fields + constants + retuned defaults; T02: drop-lowest-importance + headTailTruncate + outer-cap fallback; T03: import MemoryTier1Source + optional `identityMemoryAutoloadSource`
- `src/manager/session-config.ts` — T01: build four sub-sources + 16K char head-tail truncate marker for MEMORY.md; T02: thread deps.log + agent name through to AssembleOptions
- `src/memory/compaction.ts` — T04: import pruneToolOutputs + add CompactionManager.compactToolOutputs() pre-compaction hook + log savedPct

**Modified (tests):**
- `src/manager/__tests__/context-assembler.test.ts` — T01 + T02: updated Test 1 / Test 2 / Test 6 / Test 11 / Test 14 (warn-and-keep → drop-lowest; soul: 0 budget folded; carved-source path)
- `src/manager/__tests__/session-config-115-truncation-warn.test.ts` — T01: assert new tier1-truncation action label + dream-pass-priority marker + 16K char cap

## Decisions Made

- **`INJECTED_MEMORY_MAX_CHARS = 16_000` (not Hermes' 20_000)**. 4K-char headroom under the 8K-token outer cap — Hermes ran with looser outer constraints; we run tighter for the 11-agent / 8-12 GB headroom box.
- **`STABLE_PREFIX_MAX_TOKENS = 8_000` is the *enforced* cap**. 10K fleet p95 + 12K fin-acq are P1 *delivery* targets — softer goals the cap should produce in normal load. Cap is stricter than targets to give safety margin.
- **Identity priority order**. SOUL fingerprint (extractor-bounded ≤1200 chars, never drops) > IDENTITY.md (head-tail truncate) > capability manifest (bullet-truncate) > MEMORY.md autoload (drops first). Preserves operator-curated identity content over machine-generated context.
- **Soul section budget = 0** in DEFAULT_PHASE53_BUDGETS (D-02 lock). When upstream folds SOUL into identity (existing pattern), the soul block is empty and contributes 0 tokens. Positive overrides truncate normally; budget=0 drops content entirely.
- **String-literal `tier` discriminators on the new interfaces**, NOT a top-level `MemoryTier = "tier1" | "tier2"` alias. The pre-existing `MemoryTier = "hot" | "warm" | "cold"` storage-tier alias stays intact; both can coexist.
- **`TypedMemorySource` union alias deliberately NOT named `MemorySource`**. Collides with pre-existing `MemorySource = "conversation" | "manual" | ...` string union widely consumed by `MemoryEntry`, `CreateMemoryInput`, etc. Renaming would break ~50+ call sites for negative ROI.
- **`ContextSources.identityMemoryAutoloadSource` is a NEW optional typed field**; existing `identityMemoryAutoload` raw string field stays. Plan 115-04 reads the typed field by name (pinned). When both are populated they MUST agree (raw === typed.content) — invariant called out in the field's docstring.
- **`pruneToolOutputs` is PURE synchronous** — no await, no I/O, no dispatch. Test asserts <50ms total runtime as the no-LLM regression pin.
- **Anti-thrash tracking is the CALLER's responsibility** (CompactionManager). `pruneToolOutputs` has predictable input → output behavior so it composes cleanly with whatever scheduling logic the caller uses.
- **Phases 2 + 3 of Hermes-style three-phase compression are explicitly DEFERRED** per CONTEXT.md "out of scope" line 32. Sub-scope 9 ships ONLY the cheap no-LLM Phase 1; deferral noted in `tool-output-prune.ts` docstring.

## Deviations from Plan

### Auto-fixed / Scope-aligned

**1. [Rule 3 - Scope alignment] T03 simplified per orchestrator's plan_summary_remaining**

- **Found during:** T03 orientation (reading PLAN.md vs orchestrator prompt).
- **Issue:** PLAN.md described T03 as modifying `session-config.ts` (consume `MemoryTier1Source` directly when constructing `ContextSources`) AND `memory-retrieval.ts` (return `MemoryTier2Source[]`). Orchestrator's `<plan_summary_remaining>` scoped T03 down to JUST adding the new types to `src/memory/types.ts` + adding an optional `identityMemoryAutoloadSource` field on `ContextSources`. Plan 115-04 owns the upstream construction sites.
- **Fix:** Followed orchestrator scope. Added types + optional field; existing `identityMemoryAutoload` raw string field stays; render path unchanged. Plan 115-04 will read `identityMemoryAutoloadSource` by name when constructing typed sources.
- **Files modified:** `src/memory/types.ts`, `src/manager/context-assembler.ts`, `src/memory/__tests__/tier-source-types.test.ts`.
- **Test file rename:** PLAN.md said `session-config-tier-split.test.ts`; orchestrator said `tier-source-types.test.ts`. Used orchestrator's name (the test does NOT need session-config infrastructure for the simpler scope).
- **Committed in:** `ac0585c`.

**2. [Rule 3 - Scope alignment] T04 simplified per orchestrator's plan_summary_remaining**

- **Found during:** T04 orientation.
- **Issue:** PLAN.md described `pruneOldToolOutputs(input: ToolOutputPruneInput)` with anti-thrash baked in (`lastTwoSavingsPct` argument), `maxTokenSpend` budget, `preserveTailTurns: 5` default, and a different marker format (`[tool output redacted by tier-1 compaction; <N> chars saved]`). Orchestrator's plan summary specified `pruneToolOutputs(turns, options?)` with `keepRecentN=3` default and marker `[tool output pruned: <tool_name> @ <timestamp>]`.
- **Fix:** Followed orchestrator spec. Anti-thrash moved to CALLER responsibility (CompactionManager owns thrash detection). `keepRecentN=3` default matches orchestrator. Marker format matches orchestrator's exact text.
- **Rationale (advisor consultation):** Orchestrator's prompt is the resume-time scoping that overrides the original PLAN.md. Following PLAN.md would have produced the wrong marker text and the wrong function signature for what 115-04 will consume.
- **Files modified:** `src/memory/tool-output-prune.ts`, `src/memory/compaction.ts`, `src/memory/__tests__/tool-output-prune.test.ts`.
- **Committed in:** `df2bebe`.

**3. [Rule 1 - Type collision avoided] Did NOT redefine `MemorySource` or `MemoryTier` as discriminated unions**

- **Found during:** T03 implementation (advisor consultation).
- **Issue:** PLAN.md text (`MemorySource = MemoryTier1 | MemoryTier2`) would collide with `src/memory/types.ts:7` `MemorySource = "conversation" | "manual" | "system" | "consolidation" | "episode"` and `src/memory/types.ts:19` `MemoryTier = "hot" | "warm" | "cold"`. Both pre-existing aliases are widely consumed (`MemoryEntry.source`, `MemoryEntry.tier`, `CreateMemoryInput.source`).
- **Fix:** Used string-literal discriminators inline on the new interfaces (`tier: "tier1"` / `tier: "tier2"`) and exported the union alias as `TypedMemorySource` (NOT `MemorySource`). No collision. Both old and new types coexist; callers import what they need.
- **Verification:** `npx tsc --noEmit` clean; `tier-source-types.test.ts` includes a test that imports both `MemorySource` (legacy string union) and `MemoryTier` (legacy storage tier) by name to pin they're not shadowed.
- **Committed in:** `ac0585c`.

### Documented (no fix needed)

None.

---

**Total deviations:** 3 (2 scope alignments per orchestrator vs PLAN.md; 1 type-collision avoidance).
**Impact on plan:** All deviations narrow scope per orchestrator authority; no scope creep introduced. The simpler T03/T04 land the contract surface 115-04 will consume without taking on the upstream construction work that 115-04 owns.

## Issues Encountered

None blocking. Pre-existing typecheck warning in `src/usage/budget.ts(138,27)` (TS2367) is out of scope and pre-existing on the worktree base — not introduced by this plan, will be addressed in a future plan.

## Deferred Issues

None — all in-scope work for 115-03 complete.

## User Setup Required

None for this plan. Operator action limited to the next deploy window:

1. **At next operator-confirmed deploy** (per Ramy gate — wait until #fin-acquisition is quiet OR genuine emergency):
   - Build + deploy via `scripts/deploy-clawdy.sh`
   - No config changes required — defaults are correct out of the box.
2. **Verification on next session start**:
   - `[diag] tier1-truncation` warns no longer leak the `(truncated at 50KB cap)` marker into agent prompts; instead emit daemon-side warns with `originalChars / capChars / droppedChars / file` fields.
   - When per-section budgets are hit, identity drops MEMORY.md content first (verbatim SOUL fingerprint preserved); when outer cap is hit, `[diag] stable-prefix-cap-fallback` log fires.

## Next Phase Readiness

- **Plan 115-04** (lazy-load MCP tools): can consume `ContextSources.identityMemoryAutoloadSource: MemoryTier1Source` by name. Field name pinned. Plan 115-04 will construct the typed source upstream in `session-config.ts` (where the body is read from disk).
- **Plan 115-05** (cache-breakpoint placement): outer-cap enforcement landed here makes cache-stable-region size predictable — Plan 115-05 can reason about cache-breakpoint placement against a known-bounded stable prefix.
- **Plan 115-08** (Phase 95 dreaming as Tier 1 consolidation): `recordTier1TruncationEvent` sink wired here defensively; 115-08 implements the consumer (dream-cron.ts re-schedule on truncation count reaching 2-in-24h, per D-05).
- **Plan 115-09** (closeout): perf-comparisons can measure post-115 stable-prefix size against the 8K cap; the no-LLM tool-output prune is part of the response-path optimization budget.
- No blockers introduced for downstream waves.

## Self-Check

Acceptance criteria from the orchestrator's `<success_criteria>`:
- [x] T03 committed with new MemoryTier1Source / MemoryTier2Source types in memory/types.ts (commit `ac0585c`)
- [x] T03 committed with optional `identityMemoryAutoloadSource` field on ContextSources (commit `ac0585c`)
- [x] T03 test file passes (`tier-source-types.test.ts` — 6 tests green)
- [x] T04 committed with `src/memory/tool-output-prune.ts` (no-LLM Phase 1 prune) (commit `df2bebe`)
- [x] T04 test file passes (3+ cases — 13 tests green)
- [x] T04 wires `compactToolOutputs()` method into compaction.ts (commit `df2bebe`)
- [x] SUMMARY.md created at .planning/phases/115-memory-context-prompt-cache-redesign/115-03-SUMMARY.md (this file)
- [x] STATE.md and ROADMAP.md updated (state-update step, separate commit follows)
- [x] `npx tsc --noEmit` clean (verified after both T03 and T04)
- [x] `npx vitest run src/memory/__tests__/tier-source-types.test.ts src/memory/__tests__/tool-output-prune.test.ts` green (19 tests)
- [x] Existing context-assembler tests still green (87 tests in 5 files)

Created files exist (verified via `ls`):
- `.planning/phases/115-memory-context-prompt-cache-redesign/115-03-SUMMARY.md` — FOUND.
- `src/memory/__tests__/tier-source-types.test.ts` — FOUND.
- `src/memory/tool-output-prune.ts` — FOUND.
- `src/memory/__tests__/tool-output-prune.test.ts` — FOUND.
- `src/manager/__tests__/context-assembler-tier1-budget.test.ts` — FOUND (T01 commit, before this resumption).
- `src/manager/__tests__/context-assembler-drop-lowest.test.ts` — FOUND (T02 commit, before this resumption).

Commits exist (verified via `git log --oneline`):
- `7c1fb00` (T01) — FOUND.
- `b93022b` (T02) — FOUND.
- `ac0585c` (T03) — FOUND.
- `df2bebe` (T04) — FOUND.

Acceptance grep checks all pass:
- T03: `MemoryTier1Source|MemoryTier2Source` in types.ts → 6 matches.
- T03: `tier: "tier1"|tier: "tier2"` → 2 matches.
- T03: `identityMemoryAutoloadSource` in context-assembler.ts → 3 matches.
- T04: `pruneToolOutputs` in tool-output-prune.ts → 1 match.
- T04: `compactToolOutputs` in compaction.ts → 1 match.
- T04: `[tool output pruned:` literal marker → 2 matches in tool-output-prune.ts.
- T04: `DEFERRED|Phase 2|Phase 3` in tool-output-prune.ts → 2 matches.
- No LLM-call indicators (`query|dispatch|Anthropic|claude`) in tool-output-prune.ts beyond the docstring's "no LLM dispatch" disclaimer.

## Self-Check: PASSED

---
*Phase: 115-memory-context-prompt-cache-redesign*
*Plan: 03*
*Completed: 2026-05-08*
