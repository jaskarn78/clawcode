---
phase: 115-memory-context-prompt-cache-redesign
plan: 01
subsystem: memory-and-prompt-caching
tags: [quick-wins, prompt-cache, memory-retrieval, tag-filter, dead-config-knob, schema, sdk-flag]

# Dependency graph
requires:
  - phase: 90-clawhub-marketplace-fin-acquisition-memory-prep
    provides: memoryRetrievalTopK / memoryRetrievalTokenBudget zod knobs (defaults schema), memoriesScored hydration loop in retrieveMemoryChunks, getMemoryForRetrieval with tags column read
  - phase: 100-claude-agent-sdk-integration
    provides: ResolvedAgentConfig.gsd / settingSources / disallowedTools threading pattern (resolver `!== undefined` precedence, spread-conditional propagation through buildSessionConfig)
  - phase: 115-00-baseline-benchmark-suite
    provides: pre-115 anchor numbers in baseline-pre-115.md (Plan 115-08/09 will compare post-quick-wins fleet measurements against these)
  - phase: 115-02-operator-side-observability
    provides: agents[*].debug.dumpBaseOptionsOnSpawn flag (already merged on master at session-adapter.ts ~line 934 — 115-01's edits coexist with this without duplication)
provides:
  - SDK systemPrompt.excludeDynamicSections=true (default-on, per-agent overridable) — improves cross-agent prompt-cache reuse on the fleet's stable prefix
  - Wired-through memoryRetrievalTokenBudget config knob (was dead in defaults since Phase 90 MEM-03, never forwarded)
  - 1500-token default per-turn <memory-context> budget (down from pre-115 hardcoded 2000)
  - excludeTags filter at hybrid-RRF retrieval — drops session-summary / mid-session / raw-fallback memories before fusion (locked default per CONTEXT.md sub-scope 4)
  - phase115-quickwin diagnostic line (createSession + resumeSession) — operator can grep daemon logs to confirm flag is reaching the SDK
  - phase115-tag-filter diagnostic line — operator-visible drop-count when filter fires
affects:
  - 115-08 (will tune the 1500-token budget if measurement shows recall regression — gate from Threat Model row 4)
  - 115-09 (closeout — re-runs benchmark to compare quick-wins delta against locked anchor numbers)

# Tech tracking
tech-stack:
  added: []  # zero new dependencies
  patterns:
    - additive-optional-on-resolved-config — three new fields on ResolvedAgentConfig kept `readonly X?: T` (optional) so the ~20 existing test factories don't need updates; loader always populates in production, consumers default to the locked Phase 115 values when reading from a hand-built test config. Matches the 115-02 `debug?` precedent.
    - default-true-with-explicit-revert — excludeDynamicSections defaults true with operator opt-out via per-agent or fleet-wide config flag. Same blueprint as Phase 90 memoryAutoLoad (default true, explicit `!== undefined` check to honor `false` overrides).
    - filter-inside-existing-hydration-loop — tag-filter for excludeTags applied where getMemoryForRetrieval already returns tags (memory-retrieval.ts:202+). Avoids redundant DB query the original plan suggested (getMemoryMetadata helper); zero N+1 risk.
    - empty-array-means-disabled — operator override `memoryRetrievalExcludeTags: []` means "explicitly disable filtering for this agent", NOT "fall back to defaults". Loader uses `!== undefined` check to honor empty-array semantics.
    - spread-conditional-on-AgentSessionConfig — followed 115-02's pattern (`debug?`) for the optional `excludeDynamicSections` field passthrough so existing AgentSessionConfig builders stay byte-identical; bootstrap-needed path also propagates.
    - console-info-for-adapter-diagnostics — session-adapter intentionally has no DI'd logger (matches existing PromptBloatLogger interface pattern at line 192 — adapter stays framework-agnostic). Daemon captures stdout into structured logs via systemd. Single-line JSON for grep + dashboard.

key-files:
  created:
    - src/manager/__tests__/session-adapter-115-exclude-dynamic.test.ts (7 tests — buildSystemPromptOption shape contract + flag forwarding)
    - src/memory/__tests__/memory-retrieval-token-budget.test.ts (6 tests — default 1500, cap, always-emit-first guard, explicit override)
    - src/memory/__tests__/memory-retrieval-tag-filter.test.ts (9 tests — default disabled, locked list, mixed-tags, untagged, empty-array opt-out, custom override, log fired/not-fired, filter independent of budget)
  modified:
    - src/config/schema.ts — defaults + agentSchema for excludeDynamicSections, memoryRetrievalTokenBudget (lowered 2000→1500), memoryRetrievalExcludeTags
    - src/config/loader.ts — thread three new fields through resolveAgentConfig with the agent.X ?? defaults.X pattern
    - src/config/types.ts — register Phase 115 fields in RELOADABLE_FIELDS (memoryRetrievalTokenBudget, memoryRetrievalExcludeTags — closure-re-read each turn) + NON_RELOADABLE_FIELDS (excludeDynamicSections — baseOptions captured at session create/resume; matches Phase 100 settingSources / gsd precedent)
    - src/shared/types.ts — three new optional fields on ResolvedAgentConfig
    - src/manager/types.ts — optional excludeDynamicSections on AgentSessionConfig
    - src/manager/session-config.ts — propagate excludeDynamicSections through both buildSessionConfig return paths (main + bootstrap-needed)
    - src/manager/session-adapter.ts — extend buildSystemPromptOption(stablePrefix, excludeDynamicSections); both call sites in createSession + resumeSession; phase115-quickwin diagnostic
    - src/manager/session-manager.ts — getMemoryRetrieverForAgent reads tokenBudget + excludeTags from config and forwards to retrieveMemoryChunks
    - src/memory/memory-retrieval.ts — RetrieveArgs extended with excludeTags / log / agent; filter inside memoriesScored loop; 2000→1500 default; phase115-tag-filter diagnostic via console.info (production-visible) AND optional log sink (test-injectable)
    - src/config/__tests__/differ.test.ts + src/config/__tests__/loader.test.ts — defaults-shape fixtures updated 2000→1500 and adding the three new fields (6 fixtures total across both files)

key-decisions:
  - "Made all three new ResolvedAgentConfig fields OPTIONAL (`readonly X?: T`) instead of required. Required fields would break ~20 existing test factories. Optional + consumer-side fallbacks preserves the production guarantee (loader always populates) while keeping test code byte-identical. Matches the 115-02 `debug?` precedent."
  - "Skipped the original plan's `getMemoryMetadata(id): { tags } | null` helper on MemoryStore — `getMemoryForRetrieval` already returns tags as part of its existing row read (store.ts:1356-1391). Filter applied inside the existing hydration loop, eliminating the N+1 risk the plan's threat-model row 3 flagged. The `getMemoryMetadata` acceptance grep is intentionally not satisfied; the must_haves table at the top of the plan only requires the `excludeTags` parameter + locked default + behavioral outcome (all hold)."
  - "Used `console.info` for the phase115-quickwin diagnostic instead of pino. Session-adapter intentionally has no DI'd logger (matches PromptBloatLogger interface pattern at line 192 — adapter stays framework-agnostic). Daemon captures stdout into structured logs via systemd. Single-line JSON for grep + dashboard ingestion."
  - "Lowered defaults.memoryRetrievalTokenBudget zod default 2000 → 1500 to align with CONTEXT.md D-02 (tighter cap leaves margin for sub-scope 1's tier-1 cap). Range constrained min(500).max(8000) so operator can opt back into 2000 explicitly per-agent. Threat-model row 4 acknowledges potential recall regression — Plan 115-08 measurement gates whether to bump back to 1750 or 2000."
  - "Locked exclusion list shipped EXACTLY as CONTEXT.md sub-scope 4: `[\"session-summary\", \"mid-session\", \"raw-fallback\"]`. Operator override is full replacement (NOT merge) — defaults.memoryRetrievalExcludeTags fully wins or fully loses to per-agent override. An empty agent array means \"explicitly disable for this agent\", not \"fall back to defaults\" (use `!== undefined` check, not `??`)."
  - "Three atomic commits, one per task, in order T01 → T02 → T03. Each task's schema/loader/types/test scope landed together so per-commit revert produces a coherent rollback (e.g., reverting T03 leaves T01+T02 functional). Each commit individually passes typecheck + new test file + targeted regression check."

patterns-established:
  - "Phase 115 quick-win plan structure: each sub-scope (2/3/4) shipped as one atomic commit with schema + loader + consumer wiring + test in lockstep. Operator can revert any single sub-scope by reverting one commit."
  - "Optional-on-ResolvedAgentConfig pattern when a new field is added but historical test factories shouldn't all need updates — consumer-side `?? default` fallback maintains correctness while preserving back-compat."
  - "Tag-filter hooked into hydration loop is the cheapest pattern for filtering by row metadata that the hydrator already fetches. No N+1, no extra DB roundtrip, no defensive `Promise.all(...).then(...)` wrapper around what was synchronous SQL anyway."

requirements-completed: []  # Plan frontmatter `requirements:` is empty — sub-scopes 2/3/4 are tracked in the phase's CONTEXT.md / ROADMAP.md, not as numbered requirements.

# Metrics
duration: ~50min (active work; T01 had a mid-task scope unwind when realized all three schema fields needed atomic-per-task split)
completed: 2026-05-08
---

# Phase 115 Plan 01: Quick wins — excludeDynamicSections + memoryRetrievalTokenBudget wire + tag-filter at hybrid-RRF Summary

**Three independent <100-line surgical changes shipped: SDK `systemPrompt.excludeDynamicSections=true` (default-on, gates per-machine dynamic sections out of cached prompt for cross-agent cache reuse); the previously-dead `memoryRetrievalTokenBudget` knob now wired through to `retrieveMemoryChunks` with default tightened 2000 → 1500; and a tag-exclusion filter at hybrid-RRF retrieval drops `session-summary`/`mid-session`/`raw-fallback` memories before they pollute the per-turn `<memory-context>` block. All three are operator-overridable per-agent or fleet-wide; default-on with explicit revert path.**

## Performance

- **Duration:** ~50 min active work (T01 had a mid-task scope unwind: my first pass added all three schema fields together; rolled back to one-task-at-a-time per the plan's atomic-commit intent)
- **Started:** 2026-05-08T01:55Z (post-context-load)
- **Completed:** 2026-05-08T02:18Z (T03 commit)
- **Tasks:** 3 (T01, T02, T03 all fully shipped)
- **Files modified:** 12 (3 new test files + 9 source / config / shared / test-fixture files)

## Accomplishments

- **`excludeDynamicSections: true` shipped (T01).** New `defaults.excludeDynamicSections` (zod default true) + per-agent `agentSchema.excludeDynamicSections` optional override. Threaded through `ResolvedAgentConfig` → `AgentSessionConfig` (optional passthrough) → `buildSystemPromptOption(stablePrefix, excludeDynamicSections)`. Both `createSession` and `resumeSession` call sites pass the resolved value (Rule 3 symmetric edit). The SDK preset shape `{type:"preset",preset:"claude_code",append:stablePrefix,excludeDynamicSections}` is preserved. `console.info("phase115-quickwin", JSON.stringify({...}))` diagnostic line lands at both call sites so first deploy can confirm the flag is reaching the SDK.
- **`memoryRetrievalTokenBudget` lit up (T02).** Pre-115 the zod knob existed in `defaultsSchema` but `SessionManager.getMemoryRetrieverForAgent` never forwarded it — the per-turn `<memory-context>` always used `retrieveMemoryChunks`'s hardcoded 2000-token default regardless of yaml config (Pain Point #1, codebase-memory-retrieval.md). Now: schema range tightened to `min(500).max(8000).default(1500)`, loader threads `agent.X ?? defaults.X` into `ResolvedAgentConfig`, the closure reads `config?.memoryRetrievalTokenBudget ?? 1500` and forwards via the new `tokenBudget` arg. `retrieveMemoryChunks` default also lowered 2000 → 1500. Operator can revert per-agent or fleet-wide.
- **Tag-filter at hybrid-RRF (T03).** New `defaults.memoryRetrievalExcludeTags` zod default `["session-summary", "mid-session", "raw-fallback"]` + per-agent override. `RetrieveArgs` extended with `excludeTags` / `log` / `agent` fields. Filter applied inside the existing `for (const m of memoriesScored)` hydration loop where `getMemoryForRetrieval` already returns tags — no extra DB query, zero N+1. Memory rows whose tags intersect `excludeTags` are dropped before time-window + token-budget passes. Production diagnostic via `console.info("phase115-tag-filter", ...)` fires unconditionally on every drop (mirrors T01's phase115-quickwin pattern; daemon captures stdout via systemd); an optional `log` sink supports DI for tests + future operator surfaces.

- **Polish fixes (post-review).** Two follow-up edits landed in commit `c3439c4` after the advisor flagged loose ends: (a) the original tag-filter diagnostic used `args.log?.debug?.(...)` with both args optional, and the production caller in `getMemoryRetrieverForAgent` passed no `log` argument — so the line never fired in production. Fixed by adding the unconditional `console.info` channel alongside the optional sink. (b) Three new schema fields weren't registered in `src/config/types.ts` reload-classification table — added entries so the config-watcher's behavior matches the JSDoc claims (memoryRetrievalTokenBudget + memoryRetrievalExcludeTags as RELOADABLE; excludeDynamicSections as NON_RELOADABLE per Phase 100 settingSources precedent).

## Task Commits

1. **T01 — `feat(115-01): set systemPrompt.excludeDynamicSections on SDK options (sub-scope 2)`** — `b948c28`
   - schema (defaults + per-agent), loader threading, ResolvedAgentConfig + AgentSessionConfig fields, session-config bootstrap + main returns, session-adapter buildSystemPromptOption + both call sites + diagnostic, 7 new tests
2. **T02 — `feat(115-01): wire memoryRetrievalTokenBudget through to retrieveMemoryChunks (sub-scope 3)`** — `27d6aa3`
   - schema 2000→1500 default + range constraint, loader threading, ResolvedAgentConfig field, getMemoryRetrieverForAgent forwards tokenBudget, memory-retrieval default 2000→1500, 6 new tests
3. **T03 — `feat(115-01): exclude session-summary/mid-session/raw-fallback memories from <memory-context> at hybrid-RRF (sub-scope 4)`** — `0aececa`
   - schema (defaults + per-agent locked tag list), loader threading with `!== undefined` check (empty-array opt-out), ResolvedAgentConfig field, retrieveMemoryChunks excludeTags/log/agent params, filter inside hydration loop, getMemoryRetrieverForAgent forwards excludeTags, 9 new tests
4. **Polish — `feat(115-01): register reload classification + ensure phase115-tag-filter fires in production`** — `c3439c4`
   - Added `console.info` diagnostic alongside the optional `log` sink (production-visible mirroring T01's phase115-quickwin pattern); registered reload classifications in `src/config/types.ts` (memoryRetrievalTokenBudget + memoryRetrievalExcludeTags as RELOADABLE; excludeDynamicSections as NON_RELOADABLE)

## Files Created/Modified

**Created (3 test files):**
- `src/manager/__tests__/session-adapter-115-exclude-dynamic.test.ts` — 7 tests
- `src/memory/__tests__/memory-retrieval-token-budget.test.ts` — 6 tests
- `src/memory/__tests__/memory-retrieval-tag-filter.test.ts` — 9 tests

**Modified (source):**
- `src/config/schema.ts` — three new fields on `defaultsSchema` + `agentSchema`; `memoryRetrievalTokenBudget` default tightened 2000 → 1500 with range
- `src/config/loader.ts` — three new resolver entries (`!== undefined` for excludeDynamicSections + memoryRetrievalExcludeTags; `??` for memoryRetrievalTokenBudget)
- `src/shared/types.ts` — three new optional fields on `ResolvedAgentConfig`
- `src/manager/types.ts` — one new optional field on `AgentSessionConfig`
- `src/manager/session-config.ts` — propagate `excludeDynamicSections` through both `buildSessionConfig` return paths
- `src/manager/session-adapter.ts` — extended `buildSystemPromptOption` signature; both call sites pass new param; diagnostic line at both call sites
- `src/manager/session-manager.ts` — `getMemoryRetrieverForAgent` reads `tokenBudget` + `excludeTags` from config and forwards
- `src/memory/memory-retrieval.ts` — RetrieveArgs extended; filter applied inside hydration loop; default tokenBudget 2000 → 1500; diagnostic log

**Modified (test fixtures):**
- `src/config/__tests__/differ.test.ts` — defaults-shape fixture (1 occurrence)
- `src/config/__tests__/loader.test.ts` — defaults-shape fixtures (6 occurrences) — all updated 2000 → 1500 and to include the three new fields

## Decisions Made

All key decisions are captured in the frontmatter `key-decisions:` block above. The five highest-impact ones:

1. **Optional-on-ResolvedAgentConfig** instead of required — preserves back-compat with ~20 test factories that build `ResolvedAgentConfig` literals; loader always populates in production, consumer-side fallbacks preserve correctness.
2. **Skipped `getMemoryMetadata` helper** — `getMemoryForRetrieval` already returns tags. Filter applied inside the existing hydration loop. Eliminates the N+1 risk the plan's threat-model row 3 flagged.
3. **`console.info` over pino** for the phase115-quickwin diagnostic — session-adapter intentionally has no DI'd logger; daemon captures stdout via systemd.
4. **Default 1500 for memoryRetrievalTokenBudget** — tighter than pre-115 2000 to leave margin for sub-scope 1's tier-1 cap; threat-model row 4 acknowledges Plan 115-08 will measure if recall regresses materially.
5. **Locked exclusion list shipped exactly as CONTEXT.md sub-scope 4** — `["session-summary", "mid-session", "raw-fallback"]`. Operator empty-array means "disabled per-agent", NOT "fall back to defaults".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug avoidance] Skipped the `getMemoryMetadata` helper from T03 step 3**

- **Found during:** T03 implementation (after orientation read of `store.ts`).
- **Issue:** The plan body added a new `getMemoryMetadata(id)` helper to `MemoryStore` (T03 step 3, lines 236-247 of the plan). But `getMemoryForRetrieval` (already in store.ts:1356-1391) ALREADY returns tags as part of its row read. Adding a second helper would be redundant + create the N+1 risk the plan's own threat-model row 3 flagged. The plan's literal code in T03 step 2 also had bugs (used `h.id` where `searchMemoriesVec` returns `{memory_id, distance}`; wrapped sync SQL in `await Promise.all` for no reason).
- **Fix:** Filter applied inside the existing `for (const m of memoriesScored)` hydration loop where tags are already in scope. Single DB read per row (the existing `getMemoryForRetrieval` call), single SQL plan, zero N+1. Diagnostic logged with the same payload the plan specified.
- **Files affected:** `src/memory/memory-retrieval.ts` (filter inside loop, NOT a new helper).
- **Verification:** All 9 T03 tests pass; existing memory-retrieval test suite still green.
- **Trade-off accepted:** the T03 acceptance grep `grep -n "getMemoryMetadata" src/memory/store.ts` is NOT satisfied. The must_haves table at the top of the plan (lines 36-42) does NOT require this helper — it only requires `excludeTags` parameter + locked default tag list + behavioral outcome, which all hold.
- **Committed in:** `0aececa` (T03).

**2. [Rule 3 - Blocking] Three new fields on ResolvedAgentConfig made optional, not required**

- **Found during:** T01 typecheck after first edit.
- **Issue:** Adding three required fields to `ResolvedAgentConfig` broke ~20 existing test factories with TS2739 "missing properties" errors (loader.test.ts had 7 occurrences, differ.test.ts 1, plus session-manager.test.ts, fork-effort-quarantine.test.ts, persistent-session-recovery.test.ts, etc.). Updating all of them would be ~30-line scope-creep across many files.
- **Fix:** Made the new fields `readonly X?: T` (optional) on `ResolvedAgentConfig`. Loader always populates them in production. Consumers (session-manager.getMemoryRetrieverForAgent, session-config.buildSessionConfig) read with `?? <Phase115_default>` so test code that builds a hand-crafted ResolvedAgentConfig literal still gets correct Phase 115 semantics. Matches the 115-02 `debug?` precedent.
- **Files affected:** `src/shared/types.ts` (kept fields optional with explicit JSDoc note that loader always populates).
- **Verification:** Full typecheck `npx tsc --noEmit` clean. Existing test factories don't need updates.
- **Documented in:** All three commits' bodies + the new fields' JSDoc.

**3. [Rule 1 - Bug] T01 mid-task scope unwind**

- **Found during:** T01 commit-staging — realized I'd added all three schema fields (excludeDynamicSections + memoryRetrievalTokenBudget + memoryRetrievalExcludeTags) in one editing pass, which would prevent the plan's atomic-per-task commit pattern.
- **Issue:** The plan asks for atomic commits per task. My first pass added all three fields to schema.ts in one edit because they cluster in the same file regions. Per-task atomicity loses meaning if a single commit lands all three.
- **Fix:** Reverted the T02 + T03 schema/loader/types/fixture changes. Committed T01 (just `excludeDynamicSections`). Re-added T02's fields in T02. Re-added T03's fields in T03. Each commit is now individually revertable.
- **Files affected:** `src/config/schema.ts`, `src/config/loader.ts`, `src/shared/types.ts`, `src/config/__tests__/differ.test.ts`, `src/config/__tests__/loader.test.ts` (across all three commits — same lines edited multiple times during the unwind).
- **Verification:** `git log --oneline -3` shows three discrete `feat(115-01)` commits, one per sub-scope.
- **Time cost:** ~10 minutes for the unwind; net zero impact on plan correctness.

### Documented (non-fix) deviations

**4. Pre-existing test failures NOT addressed**

- `src/config/__tests__/loader.test.ts:2312` (LR-RESOLVE-DEFAULT-CONST-MATCHES — expected 7 directives, received 11) — pre-existing failure, confirmed by stashing my changes and re-running. Out of scope (Phase 94 directives changed and the test wasn't updated).
- `src/memory/__tests__/conversation-brief.test.ts` (2 specs failing) — pre-existing, confirmed by stashing my changes. Out of scope.
- Logged here for traceability; future plan can address.

---

**Total deviations:** 3 auto-fixed (1 plan-design improvement, 1 test-factory back-compat shim, 1 mid-task scope unwind) + 1 documented (out-of-scope pre-existing test failures).
**Impact on plan:** Zero scope change. All three sub-scopes (2 / 3 / 4) shipped exactly as specified in CONTEXT.md / ROADMAP.md. Atomic-per-task commit invariant honored.

## Issues Encountered

- **session-adapter has no DI'd logger** — discovered when adding the diagnostic line. Existing pattern (PromptBloatLogger interface at line 192) takes loggers as DI parameters from `attachCrashHandler` where deps are in scope. The `createSession` / `resumeSession` methods don't have a logger handy. Resolution: used `console.info` with single-line JSON; daemon captures stdout via systemd. Documented in the source comment + frontmatter pattern.
- **Mid-task scope unwind on T01** — see deviation #3 above. ~10min cost; recovered cleanly.

## Deferred Issues

None — all in-scope work complete.

## User Setup Required

**No deploy this turn (per `feedback_no_auto_deploy` + `feedback_ramy_active_no_deploy`).** Ramy is in #fin-acquisition. Defer the build + deploy to the next operator-confirmed deploy window.

When deploying:
1. Run `scripts/deploy-clawdy.sh` — picks up the schema + adapter changes.
2. **Optional per-agent overrides** in `clawcode.yaml` (not required — defaults are correct):
   ```yaml
   defaults:
     # Already-set zod defaults; explicit form for documentation:
     excludeDynamicSections: true                # Phase 115 sub-scope 2
     memoryRetrievalTokenBudget: 1500            # Phase 115 sub-scope 3
     memoryRetrievalExcludeTags: ["session-summary", "mid-session", "raw-fallback"]  # Phase 115 sub-scope 4
   agents:
     - name: research
       # Example: research agent gets bigger memory budget for deep work
       memoryRetrievalTokenBudget: 2500
     - name: fin-acquisition
       # Example: enable filter by default but allow archived-pending too
       memoryRetrievalExcludeTags: ["session-summary", "mid-session", "raw-fallback", "archived-pending"]
   ```
3. **Verification at next session create/resume:** check daemon logs for `phase115-quickwin {"agent":"<name>","excludeDynamicSections":true,"action":"115-sub2-flag","flow":"create"|"resume"}` lines.
4. **Verification at next memory retrieval:** check daemon debug logs for `phase115-tag-filter dropped memories` lines correlated with agents that have polluted memory.

## Next Phase Readiness

- **Plans 115-03 through 115-09 unblocked.** None of them depend on quick-win deltas; the SDK flag, tokenBudget knob, and tag-filter all coexist with planned structural work.
- **Plan 115-08 measurement gate:** can sample memory-recall scenarios with the new 1500 budget vs Plan 115-00's anchor numbers (5,200ms first_token / 92.8% cache hit Ramy active / 32,989-char fin-acq prefix). If recall drops materially, 115-08 raises `defaults.memoryRetrievalTokenBudget` to 1750 or 2000 (per Threat Model row 4).
- **Plan 115-09 closeout** will read `phase115-quickwin` log lines from production to confirm the flag actually deployed (not just merged).
- **Production deploy unaffected today.** Ramy gate honored — no daemon restart on production this turn.

## Self-Check

Acceptance criteria from the task prompt:
- [x] All 3 tasks executed (T01 → T02 → T03)
- [x] T01: `excludeDynamicSections: true` set in `buildSystemPromptOption` (gated by config flag, default-on)
- [x] T02: `memoryRetrievalTokenBudget` forwarded from config to `retrieveMemoryChunks` (default 1500 tokens)
- [x] T03: Hybrid-RRF retrieval excludes `session-summary` / `mid-session` / `raw-fallback` tagged memories by default
- [x] Each task committed individually (3 commits — `b948c28` / `27d6aa3` / `0aececa`)
- [x] Build + tests pass: `npx tsc --noEmit` clean; new test files all green (7+6+9 = 22/22 tests); broader regression suite green except 3 pre-existing failures (1 in loader.test, 2 in conversation-brief.test) that exist on master HEAD without my changes

Created files:
- `.planning/phases/115-memory-context-prompt-cache-redesign/115-01-SUMMARY.md` — this file.
- `src/manager/__tests__/session-adapter-115-exclude-dynamic.test.ts` — FOUND.
- `src/memory/__tests__/memory-retrieval-token-budget.test.ts` — FOUND.
- `src/memory/__tests__/memory-retrieval-tag-filter.test.ts` — FOUND.

Commits exist (verified via `git log --oneline`):
- `b948c28` (T01) — FOUND.
- `27d6aa3` (T02) — FOUND.
- `0aececa` (T03) — FOUND.

Acceptance grep summary (excerpt — full results in T01/T02/T03 commit bodies):
- T01: `excludeDynamicSections` 6 in schema.ts (≥2 required), 14 in session-adapter.ts (≥3), `phase115-quickwin` 6 (≥1), `default(true)` 1 (≥1). PASS.
- T02: `memoryRetrievalTokenBudget` 4 in schema.ts (≥2), wired in session-manager.ts (≥1), `tokenBudget = 1500` 1 in memory-retrieval.ts (≥1), `default(1500)` 1 in schema.ts (≥1). PASS.
- T03: `memoryRetrievalExcludeTags` 4 in schema.ts (≥2), locked default tag list 2 (≥1), `excludeTags` 7 in memory-retrieval.ts (≥3), `excludeTags` 2 in session-manager.ts (≥1), `phase115-tag-filter` 3 in memory-retrieval.ts (≥1). PASS.
- T03 KNOWN-DEVIATION: `getMemoryMetadata` 0 in store.ts (acceptance grep would expect ≥1, but this is intentional per Deviation #1 — the must_haves table at the top of the plan does NOT require this helper).

## Self-Check: PASSED

---
*Phase: 115-memory-context-prompt-cache-redesign*
*Plan: 01*
*Completed: 2026-05-08*
