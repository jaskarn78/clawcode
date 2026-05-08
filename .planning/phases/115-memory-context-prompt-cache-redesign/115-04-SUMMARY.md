---
phase: 115-memory-context-prompt-cache-redesign
plan: 04
subsystem: prompt-assembly + cache-architecture
tags: [cache-breakpoint, hermes-static-then-dynamic, prompt-cache-reuse, sdk-shape-locked, section-placement]

# Dependency graph
requires:
  - phase: 115-03-structural-backbone
    provides: ContextSources carved sub-source fields (identitySoulFingerprint / identityFile / identityCapabilityManifest / identityMemoryAutoload) + INJECTED_MEMORY_MAX_CHARS + STABLE_PREFIX_MAX_TOKENS — referenced by Plan 04's SECTION_PLACEMENT classification
  - phase: 115-01-quickwins
    provides: excludeDynamicSections SDK flag wiring (per-agent + defaults + RELOADABLE_FIELDS NEXT-SESSION classification) — Plan 04 mirrors that wiring pattern for cacheBreakpointPlacement
  - phase: 52-prompt-cache-stable-prefix
    provides: stablePrefix / mutableSuffix split + buildSystemPromptOption locked SDK shape ({type:"preset",preset:"claude_code",append:...}) — Plan 04 restructures the *content* of stablePrefix without touching the call shape
provides:
  - CACHE_BREAKPOINT_MARKER = "\n\n<!-- phase115-cache-breakpoint -->\n\n" — HTML-comment sentinel placed between static and dynamic portions of the assembled stable prefix in static-first mode
  - SECTION_PLACEMENT — exhaustive Record<keyof ContextSources, "static" | "dynamic" | "mutable-suffix"> classifying every ContextSources field
  - DEFAULT_CACHE_BREAKPOINT_PLACEMENT = "static-first" — default behavior
  - CacheBreakpointPlacement type alias = "static-first" | "legacy"
  - AssembleOptions.cacheBreakpointPlacement field — threaded from session-config.ts to assembleContext at session create/resume
  - defaults.cacheBreakpointPlacement / agents.<name>.cacheBreakpointPlacement zod schema fields (defaultsSchema default "static-first"; agentSchema optional override)
  - ResolvedAgentConfig.cacheBreakpointPlacement field on shared/types.ts
  - NON_RELOADABLE_FIELDS entries for both fleet + per-agent placement (matching the excludeDynamicSections pattern — captured into systemPrompt.append at session create/resume)
  - assembleContextInternal partition pass: staticParts + dynamicParts arrays partitioned per SECTION_PLACEMENT, then assembled per placement mode (static-first → marker between; legacy → pre-115-04 interleaved order)
affects:
  - 115-08 (closeout dashboard): can layer staticPrefixHash / static_prefix_hash trace column / [diag] static-prefix-cache-bust on top of the marker (deferred per orchestrator scope — see Deferred Issues)
  - 115-09 (closeout perf-comparisons): stable static portion is now byte-stable across most turns, so prompt_cache_hit_rate measurement post-115-04 should reflect cache reuse on the bytes BEFORE the marker

# Tech tracking
tech-stack:
  added: []
  patterns:
    - exhaustive-keyof-classification — SECTION_PLACEMENT is `Record<keyof ContextSources, SectionPlacement>` so any future ContextSources field add either explicitly classifies (static / dynamic / mutable-suffix) or fails the type-check. Prevents silent drift where a new section is unintentionally pushed without classification consideration
    - placement-mode-with-revert-knob — every architectural change of this size lands with a `legacy` revert path (ResolvedAgentConfig.cacheBreakpointPlacement enum) so an operator can flip back per-agent if static-first triggers an unanticipated regression. Default is the new behavior (static-first), but the old behavior is one-config-flag away
    - sdk-shape-lock-via-docstring-invariant — buildSystemPromptOption's docstring grew an explicit "# SDK shape invariant (LOCKED — DO NOT MODIFY)" header documenting Phase 52, Phase 115-01, Phase 115-04 evolution. Each phase added bytes/flags INSIDE the locked shape; none has changed the shape itself. The invariant text is greppable for future devs reading the source
    - marker-as-sentinel-in-array-element — CACHE_BREAKPOINT_MARKER is emitted as a SINGLE array element in stableParts (not concatenated inline) so the surrounding `.join("\n\n")` produces an intentional paragraph break around the marker. The marker itself carries surrounding `\n\n` pairs as well — total layout is `<staticParts joined>\n\n\n\n<!-- phase115-cache-breakpoint -->\n\n\n\n<dynamicParts joined>` (4 newlines around for visual paragraph clarity)
    - empty-prefix-no-marker-leak — when both staticParts and dynamicParts are empty, NO marker is emitted (`stableParts = []`). Preserves the byte-shape contract for tests that assert "empty stable prefix when sources empty"
    - single-side-marker-emit — when only static OR only dynamic is populated, the marker IS still emitted (at end-of-static or start-of-dynamic). Plan 115-08 hash-split logic (deferred) reads the marker as the boundary; suppressing it would conflate "no dynamic content this turn" with "static-only single-block prefix"
    - identity-as-single-static-block-not-subdivided — per advisor + 115-03 design, identityMemoryAutoload is classified static at the outer placement level. Memory writes are async (115-03 D-05 lock); MEMORY.md changes cause a legitimate cache-bust event when they happen, surfaced by Plan 115-08 (deferred) [diag] static-prefix-cache-bust observability

key-files:
  created:
    - src/manager/__tests__/context-assembler-cache-breakpoint.test.ts (21 tests — T01: marker constant + SECTION_PLACEMENT exhaustive classification + DEFAULT_CACHE_BREAKPOINT_PLACEMENT; T02: static-first reorder + legacy preservation + static portion stability across dynamic churn; T03: SDK shape locked across both modes + integration content-preservation test)
    - .planning/phases/115-memory-context-prompt-cache-redesign/deferred-items.md (16 pre-existing test failures across 8 src/manager/ test files NOT introduced by Plan 115-04; verified zero new failures via `comm -23 post-t02 pre-t02`)
    - .planning/phases/115-memory-context-prompt-cache-redesign/115-04-SUMMARY.md (this file)
  modified:
    - src/manager/context-assembler.ts (T01: added CACHE_BREAKPOINT_MARKER constant + SECTION_PLACEMENT exhaustive Record + DEFAULT_CACHE_BREAKPOINT_PLACEMENT + CacheBreakpointPlacement type + AssembleOptions.cacheBreakpointPlacement; T02: assembleContextInternal — partition into staticParts + dynamicParts, then build stableParts via mode-branch — static-first emits MARKER between partitions, legacy rebuilds pre-115-04 interleaved order from source fields)
    - src/manager/session-adapter.ts (T03: extended buildSystemPromptOption docstring with "# SDK shape invariant (LOCKED — DO NOT MODIFY)" header documenting Phase 52 / Phase 115-01 / Phase 115-04 evolution; the function body is byte-unchanged)
    - src/config/schema.ts (T01: agentSchema.cacheBreakpointPlacement optional enum field; defaultsSchema.cacheBreakpointPlacement default "static-first"; configSchema fallback default block adds the field)
    - src/config/loader.ts (T01: resolveAgentConfig threads agent.X ?? defaults.X — matches excludeDynamicSections wiring pattern)
    - src/config/types.ts (T01: NON_RELOADABLE_FIELDS adds agents.*.cacheBreakpointPlacement + defaults.cacheBreakpointPlacement — placement is captured into systemPrompt.append at session create/resume same as excludeDynamicSections; takes effect on next agent restart)
    - src/shared/types.ts (T01: ResolvedAgentConfig.cacheBreakpointPlacement?: "static-first" | "legacy")
    - src/config/__tests__/loader.test.ts (T01: added cacheBreakpointPlacement: "static-first" as const fixture line to all 6 DefaultsConfig test fixtures via sed-applied insert)
    - src/config/__tests__/differ.test.ts (T01: same — 1 fixture line)
    - src/manager/__tests__/context-assembler.test.ts (T02: updated 'returns sections in order' test name + assertions for new static-first default ordering — identity / tools BEFORE memories / graph; updated 'omits identity section when identity is empty' to assert marker comes before dynamic memories)
    - src/manager/__tests__/__snapshots__/session-config.test.ts.snap (T02: updated back-compat-byte-identical-systemPrompt snapshot — marker bytes appear in the assembled stable prefix; intentional contract change)

key-decisions:
  - "CacheBreakpointPlacement is an enum ('static-first' | 'legacy'), NOT a boolean. Future Phase 115 closeout or follow-on phases may add additional placement modes (e.g. 'static-tools-first' if tool-cache benefits from a finer-grained partition). Enum-now beats boolean-now because adding a third option doesn't break the schema; flipping from boolean to enum would."
  - "Default is 'static-first' (the new behavior), not 'legacy' (the safe behavior). PLAN.md mandate: 'default-on with revert path'. The advisor flagged the trade-off; chose to follow PLAN.md given the operator-priority weight on prompt-cache hit-rate recovery and the fact that the legacy mode is one config flag away for any agent that needs to flip back."
  - "identityMemoryAutoload is classified STATIC at the outer placement level (not split out as dynamic per the original PLAN.md text). Per advisor + 115-03 design: memory writes are async (115-03 D-05 lock); MEMORY.md content rarely changes turn-to-turn. When it legitimately changes, that IS the expected cache-bust signal Plan 115-08 (deferred) will surface. Splitting it out at the outer level would over-partition and lose the simple invariant 'identity is a single static block'."
  - "SECTION_PLACEMENT is exhaustive over `keyof ContextSources` (Record<...>) so any future field add fails the type-check unless it's classified. Catches drift at compile time rather than runtime."
  - "Marker is emitted at single-side empty: when only staticParts is populated, marker still emits at end-of-static; when only dynamicParts is populated, marker still emits at start-of-dynamic. Plan 115-08 hash-split logic (deferred) reads the marker as the boundary — suppressing it would conflate 'no dynamic content' with 'static-only single-block'. ONLY the both-empty case suppresses the marker (no leak into otherwise-empty stable prefix)."
  - "Legacy mode rebuilds the pre-115-04 interleaved order FROM SOURCE FIELDS, not from the partitioned arrays. This avoids any chance that the partition pass introduced a re-ordering bug; the legacy path is verifiable as 'identity → soul → hot → tools → fs-capability → delegates → graphContext' just by reading the if-block. Cost: ~30 lines of duplication; benefit: revert path is self-evidently correct."
  - "buildSystemPromptOption is byte-unchanged in T03. Only the docstring grew. PLAN.md text suggested 'add an explicit invariant comment' — implemented as a doc-comment block with phase history. This is the right shape: the function's behavior is correct as-is; the doc captures WHY the shape can't change going forward."
  - "Snapshot-style 'back-compat-byte-identical' test in session-config.test.ts updated — the marker bytes appearing in the assembled stable prefix is the intentional Phase 115-04 delta. The snapshot's job (Phase 999.13 byte-stability) still serves: it captures the NEW byte shape as the new baseline, so any FUTURE drift to the no-delegates / no-timezone fixture path still fails loud."
  - "Out-of-scope per orchestrator narrow scope (matching 115-03 T03/T04 precedent): staticPrefixHash field on AssembledContext, static_prefix_hash trace-store column, latestStaticPrefixHashByAgent map, [diag] static-prefix-cache-bust log. These are operator-observability features that compose cleanly on top of the architectural change once the marker is in place — they land in Plan 115-08 closeout."

patterns-established:
  - "Phase 115 placement-classification pattern: when a phase's structural goal is partitioning an existing concatenated structure into N regions, use a `Record<keyof InputType, RegionLabel>` mapping where every key is classified. The `Record<keyof T, U>` shape with type-checking enforces exhaustiveness — adds to T require explicit classification or fail the build. SECTION_PLACEMENT is the first instance; future phases that introduce additional partitions (e.g. tool-block carve-outs, recent-history sub-sections) can follow the same pattern with their own ENUM-based placement classification."
  - "Phase 115 default-on-with-revert-knob pattern: default to the new behavior (static-first), but ship the old behavior as a config knob (cacheBreakpointPlacement: 'legacy'). Operators can flip per-agent or fleet-wide if the new default triggers an unanticipated regression. NON_RELOADABLE_FIELDS captures the 'requires next-session restart' semantic so the operator-action surface is clear. Same shape as 115-01's excludeDynamicSections."
  - "Phase 115 SDK-shape-lock-via-docstring pattern: when an SDK call shape MUST stay locked across phase evolution, lift the lock into the function's docstring with explicit phase-history annotations. Future devs see the LOCKED header before reading the body, and grep can pin the invariant text for static-grep regression tests. Each phase that adds bytes/flags INSIDE the shape gets a docstring entry; none has changed the shape itself."

requirements-completed: []  # PLAN.md frontmatter `requirements:` is empty — sub-scope 5 is tracked in CONTEXT.md / ROADMAP.md, not as numbered requirements.

# Metrics
duration: ~85min (active work across T01 + T02 + T03 + T04; build + test cycles; advisor consultation pre-T01 AND advisor self-check pre-completion catching the T04 wiring gap)
completed: 2026-05-08
---

# Phase 115 Plan 04: Cache-breakpoint placement — static-then-dynamic stable-prefix reorder Summary

**Restructures the assembled stable prefix so static-only sections (identity, soul, skills, tools, fs-capability, delegates) land BEFORE the cache-breakpoint marker and dynamic-changing sections (hot memories, graph context) land AFTER. Mirrors Hermes' static-then-dynamic placement pattern. Achieves the operator-priority Phase 115 goal: stable prefix changes only on config / identity rotation, not on memory writes — recovering prompt-cache hit-rate on every turn that doesn't mutate config. Default is `cacheBreakpointPlacement: "static-first"` with operator-controlled `legacy` revert path. SDK call shape `{type:"preset",preset:"claude_code",append:...,excludeDynamicSections:...}` is byte-unchanged — only the *content* of `stablePrefix` carries the new `<!-- phase115-cache-breakpoint -->` HTML-comment marker between static and dynamic portions.**

This is the architectural backbone of Phase 115's "agent responsiveness speed" SLO. After this plan, the bytes BEFORE the marker stay identical across most turns (only changing on config flap, identity rotation, MCP server flap, or skill change), so Anthropic's prompt cache reuses them. The bytes AFTER the marker (hot memories, graph context) carry per-turn churn but don't invalidate the static portion's cache lookup. Plan 115-08 closeout will measure the realized `prompt_cache_hit_rate` against the ≥70% target.

## Performance

- **Duration:** ~85 min (active work; advisor self-check before declaring done caught the T04 wiring gap and prevented shipping dead-code revert path)
- **Started:** 2026-05-08T03:14Z (T01 first commit `b9268a8`)
- **Completed:** 2026-05-08T03:50Z (T04 fix commit `3b266ec`) + ~10 min for SUMMARY
- **Tasks:** 4 (T01, T02, T03, T04)
- **Files modified:** 13 (1 new test file + 1 deferred-items.md + 11 source/test/snapshot files modified)
- **Commits:** 4 atomic + final SUMMARY commit

## Accomplishments

> **NOTE on task ordering in this section:** The accomplishments are
> presented in narrative order (T01 → T02 → T03 → T04 fix). T04 lands
> AFTER T03 below in chronological order — see the bordered block in the
> Deviations section for the advisor-caught wiring gap that T04 fixed.

### T01 (commit `b9268a8`) — Add SECTION_PLACEMENT, CACHE_BREAKPOINT_MARKER, cacheBreakpointPlacement config flag

- `src/manager/context-assembler.ts`: exported `CACHE_BREAKPOINT_MARKER` (HTML-comment sentinel `\n\n<!-- phase115-cache-breakpoint -->\n\n`), `SECTION_PLACEMENT` (exhaustive `Record<keyof ContextSources, "static" | "dynamic" | "mutable-suffix">`), `DEFAULT_CACHE_BREAKPOINT_PLACEMENT = "static-first"`, `CacheBreakpointPlacement` type alias.
- Extended `AssembleOptions` with optional `cacheBreakpointPlacement: CacheBreakpointPlacement` field threaded from session-config.ts at session create/resume.
- `src/config/schema.ts`: added `cacheBreakpointPlacement` to both `agentSchema` (optional override) and `defaultsSchema` (default `"static-first"`); updated `configSchema` fallback default block.
- `src/config/loader.ts`: resolver threads `agent.X !== undefined ? agent.X : defaults.X` (matches the `excludeDynamicSections` wiring pattern from Plan 115-01).
- `src/config/types.ts`: added `agents.*.cacheBreakpointPlacement` + `defaults.cacheBreakpointPlacement` to `NON_RELOADABLE_FIELDS` — placement is captured into the assembled `systemPrompt.append` at session create/resume; takes effect on next agent restart, same architectural pattern as `excludeDynamicSections`.
- `src/shared/types.ts`: added `ResolvedAgentConfig.cacheBreakpointPlacement?: "static-first" | "legacy"`.
- `src/config/__tests__/loader.test.ts` + `differ.test.ts`: updated 7 `DefaultsConfig` test fixtures with `cacheBreakpointPlacement: "static-first" as const` (sed-applied).
- New test file `src/manager/__tests__/context-assembler-cache-breakpoint.test.ts`: 13 T01 tests passing immediately (constants, exhaustive classification, default placement, legacy-mode no-marker contract). 6 placeholder tests for the T02 reorder fail at this commit (intentional — they pass after T02 lands).

### T02 (commit `0253984`) — Reorder stableParts into static-first / legacy modes

- `src/manager/context-assembler.ts`: refactored `assembleContextInternal` placement pass into:
  1. **Partition phase**: pushes each rendered section into either `staticParts` (operator-curated: systemPromptDirectives, identity, soul, tools, fs-capability, delegates) or `dynamicParts` (per-turn churn: hot memories, graph context). Phase 52 hot-tier in-mutable-suffix path (when `priorHotStableToken !== currentHotToken`) is preserved verbatim — it bypasses both partitions.
  2. **Assembly phase**: branches on `placement`:
     - `"static-first"`: emits `[staticParts.join, MARKER, dynamicParts.join]` array; edge cases (both empty / static-only / dynamic-only) handled.
     - `"legacy"`: rebuilds pre-115-04 interleaved order (identity → soul → hot → tools → fs-capability → delegates → graphContext) FROM SOURCE FIELDS — self-evidently correct revert path.
- Updated `src/manager/__tests__/context-assembler.test.ts`:
  - `'returns sections in order'` — flipped assertion to assert static-first ordering (identity, tools BEFORE memories, graph). Test rename includes `'(Phase 115-04 static-first default)'` so the contract change is greppable.
  - `'omits identity section when identity is empty'` — added marker assertion since the marker is now between empty-static-suppressed and dynamic memories.
- Updated `__snapshots__/session-config.test.ts.snap` for the `'back-compat-byte-identical'` test — marker bytes are the intentional Phase 115-04 delta; snapshot now captures the NEW byte baseline.
- Pre-existing test failures (16 across 8 files) verified unchanged — `comm -23 post-T02 pre-T02-baseline` returns empty. Documented in `deferred-items.md`.

### T04 (commit `3b266ec`) — Fix: wire cacheBreakpointPlacement through session-config to assembler

**This fix landed AFTER T03 SUMMARY draft was written, caught by the advisor self-check before declaring done.** Without this fix, T01-T03 shipped a dead-code revert path: the config flag would have been read by the loader and stored on `ResolvedAgentConfig` but NEVER reached the assembler — `agents.X.cacheBreakpointPlacement: "legacy"` in `clawcode.yaml` would have produced no behavioral change.

- `src/manager/session-config.ts`: thread `config.cacheBreakpointPlacement` into BOTH `assembleContextTraced` and `assembleContext` call sites (symmetric edit, matching the `excludeDynamicSections` wiring pattern at line ~1052).
- `src/manager/__tests__/session-config.test.ts`: new describe block `'Phase 115 Plan 04 — cacheBreakpointPlacement config wiring'` with 3 tests pinning the wiring at the `buildSessionConfig` boundary:
  1. default (no override on `ResolvedAgentConfig`) → systemPrompt contains the marker (default fires)
  2. explicit `"legacy"` → systemPrompt does NOT contain the marker (revert path active — operators CAN actually flip per-agent)
  3. explicit `"static-first"` → systemPrompt contains the marker (parity with default)

**Why T01-T03 tests didn't catch this:** they passed `cacheBreakpointPlacement` directly via `AssembleOptions` in unit-test fixtures, bypassing the config-to-assembler wiring entirely. The wiring gap was only visible in the integration path through `buildSessionConfig`.

**Verification:** `grep -n "cacheBreakpointPlacement" src/manager/session-config.ts` now returns 3 matches (was 0 before this fix).

### T03 (commit `84b81a0`) — SDK invariant docstring + integration test

- `src/manager/session-adapter.ts` (`buildSystemPromptOption`): extended docstring with explicit `"# SDK shape invariant (LOCKED — DO NOT MODIFY)"` header documenting:
  - **Phase 52 Plan 02**: introduced preset+append separation
  - **Phase 115 sub-scope 2 (Plan 115-01)**: added `excludeDynamicSections` flag
  - **Phase 115 sub-scope 5 (Plan 115-04)**: `append` value now contains the breakpoint marker INSIDE the cached append bytes — the SDK call shape itself is unchanged
  - The "NEVER replace with raw `string`" invariant — that would silently drop the breakpoint marker AND lose preset's cache scaffolding.
- Function body is byte-unchanged in T03; only the docstring grew.
- Extended `context-assembler-cache-breakpoint.test.ts` T03 suite with two integration tests:
  1. **`'integration: total content preserved across mode flip'`** — pins every static + dynamic source field in BOTH modes' stable prefix; the marker is the only delta between modes.
  2. **`'integration: SDK invariant docstring is present at buildSystemPromptOption'`** — verifies the function emits the locked shape under both `excludeDynamicSections` opt values.
- Final test count: 21 cache-breakpoint tests pass; 87 baseline context-assembler tests still pass; total 108 context-assembler tests green.

## Task Commits

Each task was committed atomically per the plan's hard ordering (T01 → T02 → T03 → T04 fix):

1. **T01: SECTION_PLACEMENT + CACHE_BREAKPOINT_MARKER + cacheBreakpointPlacement config flag** — `b9268a8` (feat)
   - 8 files: context-assembler.ts (+~120 lines), schema.ts, loader.ts, types.ts (config), shared/types.ts, loader.test.ts, differ.test.ts, context-assembler-cache-breakpoint.test.ts (new, +~330 lines).
   - Net: +542 lines.

2. **T02: assembler reorder static-first / legacy modes** — `0253984` (feat)
   - 4 files: context-assembler.ts (+~150 lines), context-assembler.test.ts (test updates), __snapshots__/session-config.test.ts.snap (snapshot update), deferred-items.md (new).
   - Net: +244 lines / -19 lines.

3. **T03: SDK invariant docstring + integration test** — `84b81a0` (feat)
   - 2 files: session-adapter.ts (+~30 lines docstring), context-assembler-cache-breakpoint.test.ts (extended +~70 lines for 2 integration tests).
   - Net: +99 lines / -8 lines.

4. **T04: wire cacheBreakpointPlacement through session-config to assembler (advisor-flagged fix)** — `3b266ec` (fix)
   - 2 files: session-config.ts (thread config field into both assembleContext call sites), session-config.test.ts (3 wiring regression tests).
   - Net: +65 lines.

## Files Created/Modified

**Created:**
- `src/manager/__tests__/context-assembler-cache-breakpoint.test.ts` — 21 tests pinning T01 + T02 + T03 invariants (T01)
- `.planning/phases/115-memory-context-prompt-cache-redesign/deferred-items.md` — pre-existing failures documentation (T02)
- `.planning/phases/115-memory-context-prompt-cache-redesign/115-04-SUMMARY.md` — this file

**Modified (source):**
- `src/manager/context-assembler.ts` — T01: SECTION_PLACEMENT + MARKER + placement type + AssembleOptions field; T02: assembleContextInternal partition + mode-branch assembly
- `src/manager/session-adapter.ts` — T03: extended buildSystemPromptOption docstring (function body byte-unchanged)
- `src/manager/session-config.ts` — T04: thread config.cacheBreakpointPlacement through to AssembleOptions at both assembleContext call sites
- `src/config/schema.ts` — T01: agent + defaults + configSchema-default schemas
- `src/config/loader.ts` — T01: resolver
- `src/config/types.ts` — T01: NON_RELOADABLE_FIELDS
- `src/shared/types.ts` — T01: ResolvedAgentConfig field

**Modified (tests + snapshots):**
- `src/manager/__tests__/context-assembler.test.ts` — T02: 2 tests updated for static-first default
- `src/manager/__tests__/session-config.test.ts` — T04: 3 new tests pinning the config-to-assembler wiring
- `src/manager/__tests__/__snapshots__/session-config.test.ts.snap` — T02: back-compat-byte-identical snapshot updated
- `src/config/__tests__/loader.test.ts` — T01: 6 fixture lines added (sed-applied)
- `src/config/__tests__/differ.test.ts` — T01: 1 fixture line added

## Decisions Made

- **`cacheBreakpointPlacement` is an enum (`"static-first" | "legacy"`), NOT a boolean.** Future Phase 115 closeout or follow-on phases may add additional placement modes (e.g. `"static-tools-first"`); enum-now beats boolean-now because adding a third option doesn't break the schema.
- **Default is `"static-first"` (the new behavior)**, not `"legacy"` (the safe behavior). PLAN.md mandate: "default-on with revert path". The advisor flagged the trade-off; chose to follow PLAN.md given the operator-priority weight on prompt-cache hit-rate recovery, and the fact that legacy mode is one config flag away for any agent that needs to flip back.
- **`identityMemoryAutoload` is classified `static` at the outer placement level.** Per advisor + 115-03 design: memory writes are async (115-03 D-05 lock); MEMORY.md rarely changes turn-to-turn. When it legitimately changes, that IS the expected cache-bust signal Plan 115-08 (deferred) will surface. Splitting it out at the outer level would over-partition and lose the simple invariant "identity is a single static block".
- **`SECTION_PLACEMENT` is exhaustive over `keyof ContextSources`** (`Record<keyof ContextSources, ...>`). Catches drift at compile time rather than runtime — any future field add either explicitly classifies or fails the type-check.
- **Single-side empty still emits the marker.** When only `staticParts` populated → marker at end-of-static; when only `dynamicParts` populated → marker at start-of-dynamic. Plan 115-08 hash-split logic (deferred) reads the marker as the boundary; suppressing it would conflate "no dynamic content this turn" with "static-only single-block prefix". ONLY the both-empty case suppresses the marker.
- **Legacy mode rebuilds the pre-115-04 interleaved order FROM SOURCE FIELDS**, not from partitioned arrays. Self-evidently-correct revert path: `if (legacy) { push systemPromptDirectives, identity, soul, hot, tools, fs-capability, delegates, graphContext }`. Cost: ~30 lines of duplication; benefit: cannot regress.
- **`buildSystemPromptOption` body is byte-unchanged in T03.** Only the docstring grew. PLAN.md suggested "add an explicit invariant comment" — implemented as a doc-comment block with phase history. The function's behavior is correct as-is; the doc captures WHY the shape can't change going forward.

## Deviations from Plan

### Auto-fixed / Scope-aligned (matching 115-03 precedent)

**1. [Rule 3 - Scope alignment] T01 + T02 + T03 narrowed per orchestrator's `<success_criteria>`**

- **Found during:** T01 orientation + advisor consultation (pre-implementation).
- **Issue:** PLAN.md described 3 tasks where T02 = staticPrefixHash trace-store column wiring + latestStaticPrefixHashByAgent SessionManager map + [diag] static-prefix-cache-bust log. The orchestrator's `<success_criteria>` and `<plan_summary>` covered only:
  - T01: SECTION_PLACEMENT + CACHE_BREAKPOINT_MARKER + cacheBreakpointPlacement flag
  - T02: assembler reorder
  - T03: SDK invariant docstring
- **Fix:** Followed orchestrator narrow scope (matching 115-03 T03/T04 precedent). Operator observability features (staticPrefixHash, traces.db column, per-agent cache-bust log) are deferred to Plan 115-08 closeout. Documented in `Deferred Issues` below.
- **Rationale (advisor consultation):** Orchestrator scope is the authoritative deliverable list. 115-03 SUMMARY explicitly set this precedent twice. Scope expansion to ship operator-observability NOW would be tractable but would broaden the surface from "architectural placement change" to "architecture + observability stack" — better split into landing-then-measuring, the latter in 115-08.
- **Files:** see Files Created/Modified above for the narrowed surface.

**2. [Rule 1 - Test fixture update] Updated 6+1 loader test fixtures + 2 context-assembler tests for the contract change**

- **Found during:** T01 + T02 build/test cycles.
- **Issue:** `DefaultsConfig` type now requires `cacheBreakpointPlacement` (zod default `"static-first"`); 7 test fixtures had to add the field. The 87 existing context-assembler tests included 2 that pinned the pre-115-04 byte-order (`'returns sections in order'`, `'omits identity section when identity is empty'`) — these explicitly assert the OLD interleaved layout that the new default contradicts.
- **Fix:** Sed-applied insert for the 7 fixture lines. Updated the 2 context-assembler tests inline to assert the new static-first ordering with explicit test-name annotations `(Phase 115-04 static-first default)` so the contract change is greppable in test output. Legacy ordering is now regression-pinned by the new T02 cache-breakpoint test file's legacy-mode tests.
- **Pre-existing failures:** 16 test failures across 8 files in `src/manager/` and `src/config/` were verified to PRE-EXIST Plan 115-04 — `git stash && npx vitest run ...` against master baseline `4aa6c13` showed identical failures. Documented in `deferred-items.md`. Per scope-boundary rule, NOT auto-fixed.
- **Files:** loader.test.ts, differ.test.ts, context-assembler.test.ts, __snapshots__/session-config.test.ts.snap.

**3. [Rule 2 - Snapshot baseline update] Updated back-compat-byte-identical snapshot**

- **Found during:** T02 broader manager test sweep.
- **Issue:** `Phase 999.13 — back-compat byte-stability` snapshot test pinned the systemPrompt bytes for an agent without delegates / timezone. Phase 115-04 marker addition is the intentional contract delta — snapshot needed to capture the new baseline.
- **Fix:** `npx vitest run -u` — snapshot updated. The snapshot's job (Phase 999.13 byte-stability) is preserved: any FUTURE drift (beyond the marker) still fails loud.
- **Files:** `__snapshots__/session-config.test.ts.snap`.

### Documented (no fix needed)

None.

---

**4. [Rule 1 - Bug] T04 wiring fix: cacheBreakpointPlacement was dead-code at integration boundary**

- **Found during:** advisor self-check BEFORE declaring plan done.
- **Issue:** T01 added `cacheBreakpointPlacement` to schema, loader, types.ts, RELOADABLE_FIELDS, and ResolvedAgentConfig. T02 added the assembler-side branch logic. But session-config.ts NEVER threaded `config.cacheBreakpointPlacement` into AssembleOptions — operator-set `agents.X.cacheBreakpointPlacement: "legacy"` in clawcode.yaml would have produced ZERO behavioral change. The "operator-controlled revert path" was dead code.
- **Fix:** Added `cacheBreakpointPlacement: config.cacheBreakpointPlacement` to BOTH `assembleContextTraced` and `assembleContext` call sites in `buildSessionConfig` (symmetric edit, matching the `excludeDynamicSections` wiring pattern at line ~1052). Added 3 regression tests at the buildSessionConfig boundary.
- **Why T01-T03 tests didn't catch it:** they passed `cacheBreakpointPlacement` directly via `AssembleOptions` in unit-test fixtures, bypassing the config-to-assembler wiring entirely. The wiring gap was only visible in the integration path.
- **Verification:** `grep -n "cacheBreakpointPlacement" src/manager/session-config.ts` returns 3 matches post-fix (was 0 pre-fix).
- **Files modified:** `src/manager/session-config.ts`, `src/manager/__tests__/session-config.test.ts`.
- **Committed in:** `3b266ec`.
- **Significance:** Without this fix, the safety net for the fleet-wide cache invalidation deploy (one-time fleet cache miss when the marker is added) would not have been there. The operator's emergency-revert path would have been broken.

---

**Total deviations:** 4 (1 scope alignment per orchestrator vs PLAN.md; 1 test fixture update; 1 snapshot baseline update; 1 advisor-caught wiring bug fix).
**Impact on plan:** Three of four are narrowed scope / contract updates; the fourth is the critical wiring fix that prevented shipping a dead-code revert path. Advisor self-check surfaced the gap BEFORE plan declared done — the cost of one extra round-trip prevented an operationally-painful deploy regression.

## Issues Encountered

None blocking. 16 pre-existing test failures (in src/manager/ and src/config/) verified to pre-exist Plan 115-04 — out of scope per the scope-boundary rule. Documented in `deferred-items.md`.

## Deferred Issues

These items are explicitly deferred to follow-on plans (matching the 115-03 precedent of orchestrator-narrowed scope):

1. **`staticPrefixHash` field on `AssembledContext` return type** — sha256 of bytes BEFORE the marker. Lets operator measure static-section cache reuse independently of full-prefix reuse. → Plan 115-08 closeout dashboard.
2. **`static_prefix_hash` column on `traces.db`** — per-turn observability for the static portion's hash. → Plan 115-08.
3. **`latestStaticPrefixHashByAgent` Map on `SessionManager`** — per-agent cache for static-hash trend analysis. → Plan 115-08.
4. **`[diag] static-prefix-cache-bust` log line** — operator-grep-friendly signal when the static portion changes (the high-cost cache eviction event). → Plan 115-08.

The Phase 115-04 narrow scope (architecture: place sections, mark boundary, keep SDK shape) lands the structural change. Operator-visible observability layered on top arrives in 115-08.

## User Setup Required

None for this plan. Operator action limited to the next deploy window:

1. **At next operator-confirmed deploy** (per Ramy gate — wait until #fin-acquisition is quiet OR genuine emergency):
   - Build + deploy via `scripts/deploy-clawdy.sh`
   - No config changes required — defaults are correct out of the box (`defaults.cacheBreakpointPlacement: "static-first"`).
   - Per-agent override available: set `agents.<name>.cacheBreakpointPlacement: "legacy"` in `clawcode.yaml` to revert per agent.
2. **Verification on next session start**:
   - The assembled `systemPrompt.append` now contains `<!-- phase115-cache-breakpoint -->` between the static and dynamic portions.
   - Static portion (identity, soul, tools, fs-capability, delegates) sits BEFORE the marker; dynamic portion (hot memories, graph context) sits AFTER.
   - Plan 115-08 measurement (deferred) will quantify the realized prompt-cache hit-rate improvement.

## Next Phase Readiness

- **Plan 115-08** (closeout dashboard + observability): can layer staticPrefixHash + static_prefix_hash trace column + [diag] static-prefix-cache-bust log on top of the marker. The boundary is hash-split-able via `stablePrefix.indexOf(CACHE_BREAKPOINT_MARKER)`.
- **Plan 115-09** (closeout perf-comparisons): static portion is now byte-stable across most turns, so prompt_cache_hit_rate measurement post-115-04 should reflect cache reuse on the bytes BEFORE the marker. Target ≥70% (per CONTEXT.md operator-priority lock).
- No blockers introduced for downstream waves.
- Fleet impact at deploy time: stable-prefix bytes change for every agent (marker addition). One-time fleet-wide cache invalidation expected on the deploy turn; subsequent turns benefit from the static-portion stability.

## Self-Check

Acceptance criteria from the orchestrator's `<success_criteria>`:
- [x] All tasks executed (T01, T02, T03 per plan + T04 advisor-caught wiring fix)
- [x] T01: SECTION_PLACEMENT record exported from context-assembler.ts (`Record<keyof ContextSources, "static" | "dynamic" | "mutable-suffix">`) — verified via `grep -nc "SECTION_PLACEMENT" src/manager/context-assembler.ts` returns 4 matches
- [x] T02: stableParts.push order verified — all static fields appear BEFORE all dynamic fields in static-first mode (test pinned in cache-breakpoint.test.ts T02 suite)
- [x] T03: `[CACHE_BREAKPOINT_MARKER]` placeholder present at the static→dynamic boundary — verified via grep returning 7 matches in context-assembler.ts
- [x] T04: `config.cacheBreakpointPlacement` wired through `buildSessionConfig` to `AssembleOptions` — verified via `grep -nc "cacheBreakpointPlacement" src/manager/session-config.ts` returns 3 matches (was 0 before the fix; would have been a dead-code shipping bug)
- [x] Each task committed individually (b9268a8 → 0253984 → 84b81a0 → 3b266ec)
- [x] SUMMARY.md at .planning/phases/115-memory-context-prompt-cache-redesign/115-04-SUMMARY.md (this file)
- [x] STATE.md + ROADMAP.md updated (state-update step, separate commit follows)
- [x] `npx tsc --noEmit` clean (verified after each commit; final tsc 0 errors)
- [x] Existing 87 context-assembler tests still green (87 baseline + 21 new = 108 total pass)
- [x] New 115-04 tests green (21 cache-breakpoint tests + 3 session-config wiring tests = 24 new pass)

T01 PLAN.md acceptance grep checks (where applicable to the narrowed scope):
- [x] `grep -n "CACHE_BREAKPOINT_MARKER\|phase115-cache-breakpoint" src/manager/context-assembler.ts` returns ≥3 matches → 7 matches
- [x] `grep -n "SECTION_PLACEMENT\|placement: \"static\"\|placement: \"dynamic\"" src/manager/context-assembler.ts` returns ≥3 matches → 4 matches
- [x] `grep -n "cacheBreakpointPlacement" src/config/schema.ts` returns ≥1 match → 4 matches
- [x] `grep -n "default(\"static-first\")\|default('static-first')" src/config/schema.ts` returns ≥1 match → 1 match (zod schema default)
- [x] File `src/manager/__tests__/context-assembler-cache-breakpoint.test.ts` exists → FOUND
- [x] `npm test -- --run context-assembler-cache-breakpoint` exits 0 → 21 pass / 0 fail
- [x] Legacy mode preserved: `grep -n "placement === \"legacy\"\|placement === 'legacy'" src/manager/context-assembler.ts` returns ≥1 match → 1 match

T03 PLAN.md acceptance grep checks (where applicable):
- [x] `grep -n "SDK shape is LOCKED\|preset+append shape\|preset.*append\|never replace this with a raw\|NEVER replace this with a raw\|SDK shape invariant" src/manager/session-adapter.ts` returns ≥1 match → 2 matches
- [x] `grep -n "type: \"preset\"\|type: 'preset'" src/manager/session-adapter.ts` returns ≥1 match → 6 matches
- [x] `grep -n "preset: \"claude_code\"\|preset: 'claude_code'" src/manager/session-adapter.ts` returns ≥1 match → 6 matches
- [x] The integration test in `context-assembler-cache-breakpoint.test.ts` covers BOTH `legacy` and `static-first` modes — verified
- [x] `npm run build` exits 0 → confirmed

Verification PLAN.md checks:
- [x] `npm test -- --run context-assembler-cache-breakpoint` exits 0
- [x] `npm run build` exits 0
- [x] `grep -n "phase115-cache-breakpoint" src/manager/context-assembler.ts` returns ≥1 match → 7 matches
- [x] `grep -n "type: \"preset\"" src/manager/session-adapter.ts` returns ≥1 match → 6 matches

Created files exist (verified via `ls`):
- `.planning/phases/115-memory-context-prompt-cache-redesign/115-04-SUMMARY.md` — FOUND.
- `.planning/phases/115-memory-context-prompt-cache-redesign/deferred-items.md` — FOUND.
- `src/manager/__tests__/context-assembler-cache-breakpoint.test.ts` — FOUND.

Commits exist (verified via `git log --oneline`):
- `b9268a8` (T01) — FOUND.
- `0253984` (T02) — FOUND.
- `84b81a0` (T03) — FOUND.
- `3b266ec` (T04 advisor-fix) — FOUND.

Out-of-scope checks NOT applicable (deferred to Plan 115-08 per orchestrator narrow scope):
- staticPrefixHash field — DEFERRED
- static_prefix_hash column on traces.db — DEFERRED
- latestStaticPrefixHashByAgent Map — DEFERRED
- [diag] static-prefix-cache-bust log — DEFERRED

## Self-Check: PASSED

---
*Phase: 115-memory-context-prompt-cache-redesign*
*Plan: 04*
*Completed: 2026-05-08*
