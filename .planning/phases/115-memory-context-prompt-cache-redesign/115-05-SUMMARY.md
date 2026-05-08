---
phase: 115-memory-context-prompt-cache-redesign
plan: 05
subsystem: memory + dreaming-consolidation + observability
tags: [lazy-load-memory-tools, dreaming-d10-hybrid, priority-pass-trigger, lazy-recall-counter, mcp-tools, veto-store, discord-summary, memory-edit-jail, agent-curated-archive]

# Dependency graph
requires:
  - phase: 115-03-structural-backbone
    provides: INJECTED_MEMORY_MAX_CHARS hard cap + tier1-truncation event firing in session-config.ts (recordTier1TruncationEvent invocation site, optional method via duck-typing guard); enforceDropLowestImportance — sets up the truncation-event count that Plan 115-05 T03 consumes
  - phase: 115-00-foundation
    provides: traces.db column slots opened (lazy_recall_call_count + tier1_inject_chars + tool_cache_hit_rate + tool_cache_size_mb + prompt_bloat_warnings_24h + tier1_budget_pct) — Plan 115-05 T04 ships the lazy_recall_call_count writer
  - phase: 95-memory-dreaming-autonomous-reflection-and-consolidation
    provides: Phase 95 D-04 dreaming primitive (runDreamPass, applyDreamResult, dreamResultSchema with newWikilinks/promotionCandidates/themedReflection/suggestedConsolidations); registerDreamCron pure-DI cron; Phase 95 D-04 surfacing-only invariant — Plan 115-05 T02 EXTENDS (does not override) the D-04 narrowness with the new D-10 5-row policy as a sister entry point
  - phase: 90-clawhub-marketplace-fin-acquisition-memory-prep
    provides: per-agent memory_chunks isolation lock — Plan 115-05 preserves it across all 4 lazy-load tools + the VetoStore + the truncation-event store
provides:
  - clawcode_memory_search MCP tool (T01 — committed in prior worktree as 53c2892) — agent-callable per-agent FTS5+vec hybrid retrieval with 500-char snippet cap
  - clawcode_memory_recall MCP tool (T01) — full-body fetch by memoryId with memories→memory_chunks fallback
  - clawcode_memory_edit MCP tool (T01) — Anthropic memory_20250818 contract (view/create/append/str_replace) JAILED to <memoryRoot> via zod enum + relative() check + lstat() symlink refusal
  - clawcode_memory_archive MCP tool (T01) — agent-curated chunk → MEMORY.md/USER.md promotion that bypasses D-10 review window per CONTEXT.md D-11
  - applyDreamResultD10 — Phase 115 D-10 hybrid 5-row policy applier (sister entry to Phase 95 D-04 applyDreamResult, both preserved)
  - isMutating(c) helper — Row-3 detector (action=edit/merge OR targetMode=overwrite)
  - D10_AUTO_APPLY_PRIORITY_FLOOR = 80 (Row 2 score threshold per CONTEXT.md D-10 verbatim)
  - D10_VETO_WINDOW_MS = 30 * 60 * 1000 (Row 2 + Row 5 veto window per CONTEXT.md D-10 + D-11)
  - dream-veto-store.ts createDreamVetoStore() — JSONL persistence at ~/.clawcode/manager/dream-veto-pending.jsonl (mirrors consolidation-run-log.ts pattern); scheduleAutoApply / vetoRun / tick / list with status transitions pending→applied/vetoed/expired
  - dream-discord-summary.ts buildPromotionSummary() — D-11 verbatim format with [auto-apply in 30m] / [veto-required] / "react with ❌, or `clawcode-memory-veto <run_id>`. Approve all: ✅."; truncates to DISCORD_EMBED_BUDGET_CHARS (6000) with veto footer preserved
  - dreamResultSchema extended — optional action (add|edit|merge) + targetMode (append|overwrite) for Row-3 detection (legacy LLM output treated as additive)
  - shouldFirePriorityPass(agent, counter, log, now) — D-05 trigger gate; returns true on 2+ events in PRIORITY_WINDOW_MS (24h); emits "[diag] priority-dream-pass-trigger" warn line
  - PRIORITY_THRESHOLD = 2, PRIORITY_IDLE_MINUTES = 5, PRIORITY_WINDOW_MS = 24h (CONTEXT.md D-05 verbatim)
  - DreamCronDeps extended with optional truncationEventCounter + applyDreamResultPriority deps; registerDreamCron tick consults the counter and shortens idle threshold + propagates isPriorityPass when wired
  - tier1_truncation_events SQLite table (agent TEXT, event_at INTEGER, dropped_chars INTEGER) + idx_tier1_truncation_events_agent_time index
  - TraceStore.recordTier1TruncationEvent(agent, droppedChars=0) + TraceStore.countTier1TruncationEventsSince(agent, sinceMs)
  - TraceCollector.recordTier1TruncationEvent + TraceCollector.countTruncationEventsSince — fail-safe wrappers (observability never blocks parent path)
  - TraceCollector.recordLazyRecallCall(agent, tool) — increments active-Turn lazy_recall_call_count or per-agent rolling counter (drained at next end())
  - Turn.bumpLazyRecallCount(tool) — DI escape hatch + structured debug log
  - traces.db lazy_recall_call_count column wired into writeTurn (14th positional arg; producer-optional for legacy callers)
  - clawcode dream <agent> --priority CLI flag — operator force-priority pass
affects:
  - 115-09 (closeout dashboard + perf comparison): consumes lazy_recall_call_count column to surface the "are agents actually using the lazy-load tools?" rate; consumes tier1_truncation_events to surface the priority-dream-pass trigger frequency
  - 115-08 (closeout): Discord-summary post hook lands here (best-effort post-fn parameter — Plan 115-05 ships the summary builder + applier integration but the daemon-edge wiring to the agent's actual Discord channel is done at the operator-confirmed deploy window, gated by the Ramy + no-auto-deploy memories)
  - Phase 95 dreaming runtime: registerDreamCron now optionally priority-aware; legacy callers (no truncationEventCounter dep wired) keep Phase 95 D-04 behavior verbatim
  - Phase 90 isolation invariant: still holds — each per-agent traces.db has its own tier1_truncation_events and writes are scoped via the existing per-agent TraceCollector
  - session-config.ts (115-03 T02 callsite): the optional recordTier1TruncationEvent method now exists on the TraceCollector — the 115-03 typeof guard + try/catch becomes the active path

# Tech tracking
tech-stack:
  added: []
  patterns:
    - sister-entry-point-with-shared-imports — applyDreamResultD10 lives alongside the legacy applyDreamResult in dream-auto-apply.ts; both share the DreamPassOutcome union, both call applyAutoLinks for Row 1, but the new entry point takes a richer ApplyDreamD10Args (vetoStore, isPriorityPass, postDiscordSummary, nanoid, now) and returns ApplyDreamD10Outcome with autoApplyScheduled / operatorRequiredCount / runId / isPriorityPass fields. Phase 95 production wiring keeps using applyDreamResult; new dream-cron tick wiring uses applyDreamResultPriority dep (which wraps applyDreamResultD10). Adding a new D-10 row tomorrow only touches the D10 code path; the D-04 baseline tests stay green.
    - additive-optional-schema-extension — dreamResultSchema gained optional action + targetMode without breaking existing LLM responses (the dreaming model can still emit the legacy 4-field shape; isMutating() treats absence as additive). Mirrors Phase 83/86/88/90/92/94/95 additive-optional schema blueprint.
    - jsonl-status-transition-persistence — dream-veto-store.ts mirrors consolidation-run-log.ts: append-only JSONL where each row carries the latest known status; readers reduce by runId to compute the current state. Survives partial-write crashes (malformed lines skipped). Test fixture pins the deadline-expired apply path AND the veto-during-window cancel path.
    - per-agent-rolling-counter-with-active-turn-fold — TraceCollector.recordLazyRecallCall checks the active-Turn slot first; on miss, accumulates in pendingLazyRecallByAgent map drained at next Turn.end(). Eliminates the "tool fired outside a turn loop" data loss without forcing every callsite to know whether a turn is active. Active-Turn registry single-slot per agent (Phase 50 invariant — at most one Turn per agent at a time).
    - typeof-method-guard-for-optional-trace-collector-fields — daemon.ts T04 increments via `tcSearch && typeof tcSearch.recordLazyRecallCall === "function"` guard. Mirrors the session-config.ts T03 callsite for recordTier1TruncationEvent. Pattern: when a producer ships its writer ahead of the call site (or vice-versa), defensively guard so cross-plan ordering doesn't break the build OR the runtime.
    - 5-row-policy-as-locked-test-spec — dream-auto-apply-d10-policy.test.ts has a describe block per D-10 row with row numbers in the names ("Row 1 — newWikilinks always auto-apply", "Row 2 — additive promotionCandidates ≥ 80 auto-apply with veto window", etc.). Future readers grep for "Row 3" to find every test that pins mutating-routing-to-operator-required. Also locks D10_AUTO_APPLY_PRIORITY_FLOOR + D10_VETO_WINDOW_MS + PRIORITY_THRESHOLD + PRIORITY_IDLE_MINUTES + PRIORITY_WINDOW_MS as constants under test ("CONTEXT.md D-XX verbatim" assertion text).

key-files:
  created:
    - src/manager/dream-veto-store.ts (T02 — VetoStore interface + createDreamVetoStore JSONL impl; ScheduledApply type; VetoStorePromotion type; VetoStoreRow type with status union pending|applied|vetoed|expired)
    - src/manager/dream-discord-summary.ts (T02 — buildPromotionSummary + buildPromotionSummaryFromDream; DISCORD_EMBED_BUDGET_CHARS = 6000; D-11 verbatim format; truncation-with-footer-preserved)
    - src/manager/__tests__/dream-auto-apply-d10-policy.test.ts (T02 — 5 describe blocks one per D-10 row + VetoStore lifecycle + D-11 summary contract + isMutating helper + constants pin; 25 tests including legacy non-completed-outcome short-circuit)
    - src/manager/__tests__/dream-cron-priority-trigger.test.ts (T03 — shouldFirePriorityPass 6 scenarios + registerDreamCron 5 priority-pass integration tests + 3 constant pins; 14 tests)
    - src/performance/__tests__/trace-store-tier1-truncation.test.ts (T03 — empty / single-row / windowed-since / per-agent-isolation / droppedChars-default / persistence-across-reopen; 7 tests)
    - src/performance/__tests__/trace-collector-lazy-recall.test.ts (T04 — single-call / 4-distinct-tools / no-call-NULL-legacy / out-of-turn-rolling-drain / rolling-cleared / per-agent-isolation / post-end-noop / Turn.bumpLazyRecallCount-direct; 8 tests)
    - .planning/phases/115-memory-context-prompt-cache-redesign/115-05-SUMMARY.md (this file)
  modified:
    - src/manager/dream-pass.ts (T02 — dreamResultSchema.promotionCandidates extended with optional action + targetMode for Row-3 detection; legacy schema treated as additive by isMutating)
    - src/manager/dream-auto-apply.ts (T02 — added applyDreamResultD10 D-10 hybrid 5-row policy applier; isMutating helper; D10_AUTO_APPLY_PRIORITY_FLOOR + D10_VETO_WINDOW_MS constants; toVetoPromotion + toSummaryRow helpers; legacy applyDreamResult preserved byte-identical)
    - src/manager/dream-cron.ts (T03 — shouldFirePriorityPass + PRIORITY_THRESHOLD + PRIORITY_IDLE_MINUTES + PRIORITY_WINDOW_MS exports; TruncationEventCounter interface; DreamCronDeps extended with optional truncationEventCounter + applyDreamResultPriority; registerDreamCron tick now consults counter, shortens idleMinutes to 5 on priority, propagates isPriorityPass to applyDreamResultPriority dep)
    - src/cli/commands/dream.ts (T03 — RunDreamActionArgs extended with priority?: boolean; --priority flag added to commander Option chain; threaded through IPC params)
    - src/performance/trace-store.ts (T03 + T04 — added tier1_truncation_events table + idx_tier1_truncation_events_agent_time index in initSchema; insertTier1TruncationEvent + countTier1TruncationEventsSince prepared statements; recordTier1TruncationEvent + countTier1TruncationEventsSince public methods. T04: insertTrace prepared statement extended to 14-arg with lazy_recall_call_count column; writeTurn passes t.lazyRecallCallCount ?? null)
    - src/performance/trace-collector.ts (T03 + T04 — added recordTier1TruncationEvent + countTruncationEventsSince fail-safe wrappers; T04: added recordLazyRecallCall + drainPendingLazyRecallCount + registerActiveTurn + unregisterActiveTurn + pendingLazyRecallByAgent map + activeTurns map; Turn extended with bumpLazyRecallCount + collector back-reference; Turn constructor takes optional collector arg; Turn.end drains rolling counter + unregisters; Turn.end conditionally spreads lazyRecallCallCount into TurnRecord when non-zero — preserves NULL on legacy turns)
    - src/manager/daemon.ts (T04 — TraceCollector type imported; 4 IPC handlers — clawcode-memory-search/-recall/-edit/-archive — call manager.getTraceCollector(agentName)?.recordLazyRecallCall at handler entry with typeof guard mirroring 115-03 pattern)

key-decisions:
  - "applyDreamResultD10 is a SISTER entry point to the legacy applyDreamResult, NOT a replacement. Phase 95 D-04 had a hard-pinned static-grep regression rule (surfacing-only invariant) that any change to applyDreamResult would have broken. Adding a sister applier preserves the D-04 baseline tests verbatim while letting Plan 115-05 ship the D-10 5-row policy. Future Phase 115-09 closeout decides whether to deprecate the legacy entry point or keep both."
  - "VetoStore is JSONL-persisted (~/.clawcode/manager/dream-veto-pending.jsonl), NOT a per-agent SQLite table. Mirrors consolidation-run-log.ts pattern — a single fleet-wide log scoped per-row by agentName. Operators can `cat` the file for forensics; partial-write crashes only lose the partial line, not the whole log. Per-agent SQLite was rejected because the cron sweep is fleet-wide and a single JSONL is simpler to operate / observe than 11 separate SQLite tables."
  - "Discord summary post is dependency-injected (postDiscordSummary?: (text) => Promise<void>) — applyDreamResultD10 takes the function as an arg rather than wiring directly to discord.js. This matches Phase 95 daemon-edge-wiring-after-pure-DI pattern: the pure-DI applier stays testable in isolation, and the daemon edge (operator-confirmed deploy window) supplies the actual Discord post fn that resolves the agent's channel."
  - "isMutating returns false for legacy LLM output (no action / no targetMode) — interpreted as additive (Row-2 path). Forces the LLM to be EXPLICIT when it wants to mutate. Avoids the failure mode where an old prompt template emits 'edit me' rationale text without setting action/targetMode and the applier silently routes through Row-3."
  - "shouldFirePriorityPass returns false on counter throw (fail-safe). The TraceCollector wrapper itself logs warn and returns 0; the gate then sees 0 events and stays in normal cadence. This means an observability-DB outage doesn't accidentally trip priority pass for every agent on every tick — desirable. Trade-off: a real-but-DB-broken truncation pattern would silently miss priority pass scheduling, but that's already a degraded-state failure mode."
  - "registerDreamCron tick switches idleMinutes (the threshold passed to isAgentIdle), NOT the cron firing cadence. The cron pattern stays `*/${dream.idleMinutes}` — for a 30-min agent, the cron still ticks every 30 min. When priority fires, the next tick's idle gate accepts agents that have been idle ≥ 5 min instead of ≥ 30 min. This means a priority pass could fire on the very next normal cron tick (up to 30 min after the trigger event), which the spec accepts. Changing the cron firing cadence would have been a much larger surgery than plan T03 implied — kept the change surface narrow."
  - "lazy_recall_call_count uses a conditional spread (only attached when non-zero) so legacy turns that never invoked a clawcode_memory_* tool keep landing NULL on the column. Mirrors the cache-telemetry-snapshot conditional spread above it. Preserves the writer-optional contract Phase 115-00-T02 documented when it opened the column slot."
  - "Active-Turn registry is single-slot per agent (Map<agent, Turn>). Phase 50 invariant: at most one Turn per agent at a time. If a caller violated this (started a 2nd Turn for the same agent before the 1st ended), the 2nd registration would silently overwrite. Acceptable because Phase 50 already pins the invariant elsewhere — adding a defensive check here would conflate two concerns."
  - "Turn carries an optional collector back-reference (constructor 6th arg) so legacy bench-harness Turns instantiated directly via `new Turn(...)` keep working without a collector wired. Production startTurn always supplies the collector. The drainPendingLazyRecallCount + unregisterActiveTurn calls in Turn.end() are guarded by `if (this.collector)`."
  - "applyDreamResultD10 logs warn-not-error on Discord-post-failure (best-effort) but logs error-then-fails on scheduleAutoApply-failure (data-integrity). Discord summary loss is recoverable (operator can re-run + see veto-store state); auto-apply scheduling loss would mean the eligible candidates silently drop on the floor."
  - "Out of scope per orchestrator narrow-scope rule + Ramy gate per CONTEXT.md: daemon-edge wiring of applyDreamResultD10 + dream-cron's truncationEventCounter dep + the agent's actual Discord channel post fn. These compose cleanly on top of Plan 115-05's pure-DI primitives once the operator-confirmed deploy window opens. Plan 115-09 closeout owns the wiring + the dashboard surface that reads tier1_truncation_events / lazy_recall_call_count."

patterns-established:
  - "Phase 115 sister-applier-not-replacement pattern: when a phase EXTENDS a prior phase's pinned invariant (Phase 95 D-04 surfacing-only) instead of OVERRIDING it, ship a sister entry point alongside the legacy one. Both share imports + helper modules + DreamPassOutcome union. Production callers that opt into the new behavior switch to the sister; legacy callers + legacy tests stay on the original. Avoids the 'replace-everywhere churn' that breaks pinned regression rules."
  - "Phase 115 DI-Discord-post pattern: any dream-pass / cron / consolidation primitive that needs to post to a Discord channel takes the post fn as a DI arg rather than importing discord.js directly. Production daemon-edge resolves the agent's channel and supplies the bound post fn; tests pass vi.fn(). Mirrors Phase 84/91/94 idiom but applied to Discord-side observability."
  - "Phase 115 fail-safe-counter-on-DB-outage pattern: any new TraceCollector method that returns a count (countTruncationEventsSince) returns 0 on store throw + logs warn. Callers that gate on count thresholds (shouldFirePriorityPass) thus stay in safe-cadence on observability-DB outage rather than tripping unintended behavior."

requirements-completed: []  # PLAN.md frontmatter `requirements:` is empty — sub-scopes 7 + 8 are tracked in CONTEXT.md / ROADMAP.md, not as numbered requirements.

# Metrics
duration: ~40min for T02 + T03 + T04 (T01 was already committed pre-handoff as 53c2892); each task wrote tests, ran focused vitest, committed atomically; advisor consultation pre-T02 to reconcile prompt-summary numbering vs PLAN.md numbering (advisor confirmed PLAN.md numbering authoritative + flagged the dreamResultSchema action/targetMode gap which informed the schema-extension decision)
completed: 2026-05-08
---

# Phase 115 Plan 05: Lazy-load memory tools + Phase 95 dreaming as Tier 1 consolidation engine — Summary

**Lands the agent-facing surface that converts the model from "always-injected memory" to "tool-mediated lazy recall" (4 new MCP tools — T01) AND rewires Phase 95 dreaming as the active Tier 1 consolidation engine using the locked D-10 5-row hybrid policy (T02). Adds the D-05 priority dream-pass trigger that fires when tier-1 MEMORY.md truncation hits 2-in-24h for an agent (T03), and ships the lazy_recall_call_count writer that surfaces "are agents actually using the new tools?" on the dashboard (T04). Eliminates the "Apr 26 was last solid memory" failure mode — old context is always one tool-call away.**

This plan is the LAST critical-path Wave-2 plan before the Wave-3 closeout (115-08 + 115-09). It pairs the agent-facing surface (4 lazy-load MCP tools, all already wired into MCP server.ts + daemon.ts IPC + capability-manifest in T01) with the consolidation engine that prevents tier-1 from drifting unbounded. The D-10 5-row policy + D-05 priority trigger together produce the closed-loop behavior CONTEXT.md mandated: agents call `clawcode_memory_search` for old context (T01); the dream-pass surfaces eligible promotion candidates (T02 Row 2 + Row 5); when MEMORY.md exceeds the 16K-char cap twice in 24h, a priority pass schedules within 5 min instead of 30 (T03); the dashboard shows whether the new tool surface is being used (T04 — lazy_recall_call_count).

## Performance

- **Duration:** ~40 min for T02 + T03 + T04. T01 was committed in a prior worktree as `53c2892` before handoff.
- **Started:** 2026-05-08T05:17:33Z (T02 first read passes after pre-flight verification of T01 commit)
- **Completed:** 2026-05-08T05:57:51Z (T04 commit `64193a3`) + ~10 min for SUMMARY
- **Tasks:** 4 (T01, T02, T03, T04). T01 already committed; T02–T04 executed atomically here.
- **Commits:** 4 atomic per-task commits + this final SUMMARY commit

## Accomplishments

### T01 (commit `53c2892`, prior worktree) — Lazy-load memory tools (4 new MCP tools)

Already committed before handoff. Verified during pre-flight:

- `src/memory/tools/clawcode-memory-search.ts` — pure-DI search tool over per-agent MemoryStore via Phase 90 hybrid-RRF retrieval; 500-char snippet cap; agentName from session/auth context never input
- `src/memory/tools/clawcode-memory-recall.ts` — full-body fetch with memories→memory_chunks fallback; getById bumps access_count + accessed_at
- `src/memory/tools/clawcode-memory-edit.ts` — Anthropic memory_20250818 contract (view/create/append/str_replace) JAILED to <memoryRoot> via z.enum(["MEMORY.md","USER.md"]) + relative() check + lstat() symlink refusal; security log lines memory-edit-jail-escape / memory-edit-symlink-blocked
- `src/memory/tools/clawcode-memory-archive.ts` — agent-curated chunk → MEMORY.md/USER.md promotion via clawcodeMemoryEdit append mode; bypasses D-10 review window per CONTEXT.md D-11
- 4 MCP server registrations in `src/mcp/server.ts` (TOOL_DEFINITIONS clawcode_memory_search/_recall/_edit/_archive)
- 4 IPC handlers in `src/manager/daemon.ts` lines 7755-7875 (clawcode-memory-search/-recall/-edit/-archive — agent resolved via validateStringParam(params, "agent"))
- `src/manager/capability-manifest.ts` line 218-225 — Memory protocol prose teaching the agent the lazy-load protocol
- 4 test files under `src/memory/__tests__/clawcode-memory-{search,recall,edit,archive}-tool.test.ts`

### T02 (commit `07d3762`) — D-10 hybrid 5-row dream-pass policy

Extended Phase 95 D-04 dream-auto-apply with the Phase 115 D-10 hybrid policy verbatim from CONTEXT.md:

| Row | Trigger | Action |
|---|---|---|
| 1 | newWikilinks | auto-apply (D-04 unchanged) |
| 2 | promotionCandidates additive ≥80 | auto-apply with 30-min Discord veto window |
| 3 | promotionCandidates mutating (action=edit/merge OR targetMode=overwrite) | operator-required (NO auto-apply) |
| 4 | suggestedConsolidations | operator-required (D-04 unchanged) |
| 5 | priority pass (D-05 trigger) | ALL promotion ALLOWED to mutate; auto-apply with 30-min veto |

- `src/manager/dream-pass.ts` — `dreamResultSchema.promotionCandidates` gained optional `action` (`add`|`edit`|`merge`) + `targetMode` (`append`|`overwrite`) for Row-3 detection. Legacy LLM responses without these fields treated as additive (Row 2 default).
- `src/manager/dream-auto-apply.ts` — added `applyDreamResultD10` sister entry point, `isMutating(c)` helper, `D10_AUTO_APPLY_PRIORITY_FLOOR = 80`, `D10_VETO_WINDOW_MS = 30 * 60 * 1000`, `toVetoPromotion`, `toSummaryRow` helpers. Legacy `applyDreamResult` preserved byte-identical so Phase 95 tests + production callers stay green.
- `src/manager/dream-veto-store.ts` (NEW) — JSONL persistence at `~/.clawcode/manager/dream-veto-pending.jsonl` (mirrors consolidation-run-log.ts pattern). `VetoStore` interface with `scheduleAutoApply` / `vetoRun` / `tick` / `list`. Status transitions pending → applied / vetoed / expired. Idempotent veto. Tick callback returning `{ok:false, error}` routes to `expired` with error captured. `latestByRunId` reduce gives current state.
- `src/manager/dream-discord-summary.ts` (NEW) — `buildPromotionSummary` per CONTEXT.md D-11 verbatim format. Truncates to `DISCORD_EMBED_BUDGET_CHARS = 6000` with veto footer always preserved. Sections: ADD/EDIT/MERGE verbs based on action; (priorityScore=N); [auto-apply in 30m] for eligible; [veto-required] for operator-required.
- `src/manager/__tests__/dream-auto-apply-d10-policy.test.ts` (NEW) — 25 tests across 7 describe blocks: 5 policy rows (each with row number in test names) + VetoStore lifecycle + D-11 summary contract + isMutating helper + D-10 constants pin + non-completed-outcome short-circuit.

**Test verification:** `npx vitest run dream-auto-apply-d10-policy + dream-auto-apply + dream-pass + dream-pass-json-recovery` — 47 tests across 4 files green (25 new + 22 existing baseline).

### T03 (commit `2241cd2`) — D-05 priority dream-pass trigger (2-in-24h tier-1 truncation)

Landed the D-05 priority dream-pass scheduler. When tier-1 MEMORY.md truncation fires twice within 24h for the same agent, dream-cron consults the truncation-event counter and shortens the idle threshold from `dream.idleMinutes` to `PRIORITY_IDLE_MINUTES = 5` minutes (CONTEXT.md D-05 verbatim). The priority signal threads through to `applyDreamResultD10` (D-10 Row 5 — mutating promotion allowed).

- `src/performance/trace-store.ts` — new `tier1_truncation_events` table (`agent TEXT, event_at INTEGER, dropped_chars INTEGER`) with `idx_tier1_truncation_events_agent_time` index (idempotent CREATE IF NOT EXISTS in initSchema). New `insertTier1TruncationEvent` + `countTier1TruncationEventsSince` prepared statements. Public methods `recordTier1TruncationEvent(agent, droppedChars=0)` + `countTier1TruncationEventsSince(agent, sinceMs)`.
- `src/performance/trace-collector.ts` — `recordTier1TruncationEvent` + `countTruncationEventsSince` fail-safe wrappers (try/catch, return 0 on error, never block parent path). The `session-config.ts` line 463-470 callsite (115-03 T02 added the optional duck-typed invocation) now lights up.
- `src/manager/dream-cron.ts` — exported `PRIORITY_THRESHOLD = 2`, `PRIORITY_IDLE_MINUTES = 5`, `PRIORITY_WINDOW_MS = 24 * 60 * 60 * 1000`. New `TruncationEventCounter` interface. New `shouldFirePriorityPass(agent, counter, log, now)` gate — returns true when counter ≥ 2; emits `[diag] priority-dream-pass-trigger agent=X events=N threshold=2` warn. Try/catch on counter throw → returns false (fail-safe).
- `DreamCronDeps` extended with optional `truncationEventCounter` + optional `applyDreamResultPriority` (new sig: `(agent, outcome, isPriorityPass) => Promise<DreamApplyOutcome>`). When wired, each tick consults `shouldFirePriorityPass`, shortens `idleMinutes` to 5 on priority firing, calls `applyDreamResultPriority(agent, outcome, isPriority)` instead of legacy `applyDreamResult`. Omitting both deps preserves Phase 95 D-04 behavior verbatim.
- `src/cli/commands/dream.ts` — `RunDreamActionArgs` extended with `priority?: boolean`; `--priority` flag added to commander Option chain ("Phase 115 D-05 — force-priority pass: mutating promotion allowed, priorityScore floor overridden..."); threaded through IPC params.
- `src/manager/__tests__/dream-cron-priority-trigger.test.ts` (NEW) — 14 tests: shouldFirePriorityPass with 0/1/2/3+/24h-windowing/counter-throw scenarios; registerDreamCron with no-counter / counter=0 / counter=2 / priority-applier-true / non-priority-applier-false integration tests; 3 constant value pins.
- `src/performance/__tests__/trace-store-tier1-truncation.test.ts` (NEW) — 7 tests: empty / single-row / windowed-since / per-agent-isolation / droppedChars-default / multi-event / persistence-across-reopen.

**Test verification:** `npx vitest run dream-cron-priority-trigger + dream-cron + trace-store-tier1-truncation + trace-store` — 51 tests across 4 files green.

### T04 (commit `64193a3`) — lazy_recall_call_count writer

Landed the per-turn lazy_recall_call_count writer (column slot opened by 115-00-T02). Surfaces on the dashboard whether agents are *actually using* the four lazy-load tools. Plan 115-09 closeout reports on the rate.

- `src/performance/trace-collector.ts`:
  - `recordLazyRecallCall(agent, tool)` — increments active-Turn counter when one exists, otherwise lands in per-agent rolling counter `pendingLazyRecallByAgent` map that the next ended turn drains. Failure-isolated try/catch.
  - Active-Turn registry: `registerActiveTurn` / `unregisterActiveTurn` with `activeTurns` map (single Turn slot per agent — Phase 50 invariant).
  - `Turn.bumpLazyRecallCount(tool)` — DI escape hatch + structured debug log line `[trace] lazy_recall_call_count incremented`.
  - Turn carries optional collector back-reference (6th constructor arg). `Turn.end()` drains pending count from collector + spreads `lazyRecallCallCount` into `TurnRecord` ONLY when non-zero (preserves NULL on legacy turns) + unregisters from active turns.
- `src/performance/trace-store.ts`:
  - `writeTurn` extended with 14th positional arg: `t.lazyRecallCallCount ?? null`.
  - `insertTrace` prepared statement extended with `lazy_recall_call_count` column.
  - Producer-optional contract preserved — Phase 50/52 callers pass NULL.
- `src/manager/daemon.ts`:
  - 4 IPC handlers (`clawcode-memory-search` / `-recall` / `-edit` / `-archive`) call `manager.getTraceCollector(agentName)?.recordLazyRecallCall` at handler entry. Increment FIRST so observability records even on later handler throw.
  - `typeof tcSearch.recordLazyRecallCall === "function"` guard mirrors session-config.ts T03 defensive pattern (handles cross-plan ordering / legacy daemons).
  - `TraceCollector` type imported.
- `src/performance/__tests__/trace-collector-lazy-recall.test.ts` (NEW) — 8 tests: single-call / 4-distinct-tools / no-call-NULL-legacy / out-of-turn-rolling-drain / rolling-cleared-after-drain / per-agent-isolation / post-end-noop / Turn.bumpLazyRecallCount-direct.

**Test verification:** `npx vitest run trace-collector-lazy-recall + trace-collector + trace-store + trace-store-115-columns + trace-store-tier1-truncation + dream-cron + dream-cron-priority-trigger + dream-auto-apply + dream-auto-apply-d10-policy + clawcode-memory-search-tool + clawcode-memory-edit-tool` — 121 tests across 11 files green.

## Task Commits

Each task was committed atomically per the orchestrator commit cadence:

1. **T01: lazy-load memory tools (4 new MCP tools)** — `53c2892` (feat) [committed pre-handoff]
2. **T02: D-10 hybrid 5-row dream-pass policy** — `07d3762` (feat)
   - 5 files: dream-pass.ts (schema extension), dream-auto-apply.ts (sister applier), dream-veto-store.ts (NEW), dream-discord-summary.ts (NEW), dream-auto-apply-d10-policy.test.ts (NEW)
   - Net: +1395 lines / -5 lines
3. **T03: D-05 priority dream-pass trigger (2-in-24h tier-1 truncation)** — `2241cd2` (feat)
   - 6 files: trace-store.ts (table+methods), trace-collector.ts (wrappers), dream-cron.ts (gate+integration), dream.ts (CLI flag), dream-cron-priority-trigger.test.ts (NEW), trace-store-tier1-truncation.test.ts (NEW)
   - Net: +646 lines / -3 lines
4. **T04: lazy_recall_call_count writer** — `64193a3` (feat)
   - 4 files: trace-collector.ts (record+drain+registry), trace-store.ts (column wire), daemon.ts (4 handler call sites + import), trace-collector-lazy-recall.test.ts (NEW)
   - Net: +367 lines / -3 lines

## Deviations from Plan

**Plan numbering reconciliation (orchestrator handoff prompt vs PLAN.md):**

The orchestrator's prompt summary listed "T02: Wire 4 memory tools into MCP" / "T03: Extend dream-auto-apply.ts" / "T04: Wire D-05 priority trigger" — but PLAN.md's actual numbering is:
- T01: Create the 4 MCP tools + register in server.ts + wire IPC handlers + capability prose (already committed pre-handoff as 53c2892)
- T02: Extend dream-auto-apply.ts for D-10 5-row policy + VetoStore + Discord summary
- T03: D-05 priority dream-pass scheduler (tier1_truncation_events + shouldFirePriorityPass)
- T04: lazy_recall_call_count writer

**Resolution:** Executed by PLAN.md numbering (advisor concurred). The prompt's success-criteria block omitted T04 but the plan + the success criteria's "SUMMARY.md ... covers all 4 tasks T01-T04" line confirms T04 is in scope. All 4 plan tasks delivered.

**Rule 1/2/3 inline fixes (none required):**

Each task landed cleanly without auto-fix deviations. The most significant judgment call (extending `dreamResultSchema` with optional `action` + `targetMode`) was a deliberate Plan-T02 design decision, NOT an inline bug fix — flagged in advance and tracked via the additive-optional-schema-extension pattern entry in tech-stack.

**Out-of-scope discoveries (deferred, NOT auto-fixed):**

Pre-existing test failures observed during the full-suite test run:
- `src/migration/__tests__/verifier.test.ts` (2 tests) — Phase 81 verifier expects MEMORY.md / CLAUDE.md / USER.md / TOOLS.md present; fixture only ships `agent.yaml` and `SOUL.md`, so the assertion of "6 files present" never held. Not introduced by Plan 115-05.
- `src/migration/__tests__/memory-translator.test.ts` (1 test) — Phase 80 memory-translator regex match expected 1 `store.insert(` call but found 2. Not introduced by Plan 115-05.
- `src/cli/commands/__tests__/migrate-openclaw-complete.test.ts` (1 test) — Phase 82 SC-3 happy path test timed out at 5000ms. Not introduced by Plan 115-05.

These failures touch `src/migration/*` and `src/cli/commands/migrate-openclaw-*`, which are entirely outside the Plan 115-05 surface (memory tools, dream auto-apply, dream cron, trace collector, trace store, daemon IPC handlers). Per the orchestrator's scope-boundary rule, logged here as deferred — NOT auto-fixed.

## Verification

- All 4 task commits exist on master (`53c2892`, `07d3762`, `2241cd2`, `64193a3`).
- `npx tsc --noEmit` clean.
- `npx vitest run` for the 11 directly-related test files: 121 tests green (10 trace-collector / trace-store + 1 trace-store-tier1-truncation + 1 trace-store-115-columns + 1 dream-cron + 1 dream-cron-priority-trigger + 1 dream-auto-apply + 1 dream-auto-apply-d10-policy + 1 dream-pass + 1 dream-pass-json-recovery + 1 clawcode-memory-* + 1 trace-collector-lazy-recall + 1 trace-collector-origin + 1 trace-store-origin + 1 trace-store-persistence).
- T02 grep acceptance: `isPriorityPass|priority pass|D-05` = 14 matches (≥3); `priorityScore.*>=.*80|D10_AUTO_APPLY_PRIORITY_FLOOR` = 3 matches (≥1); `isMutating|action === "edit"|action === "merge"` = 5 matches (≥1); `operator-required|operatorRequired|operatorOnly` = 16 matches (≥2). dream-veto-store.ts + dream-discord-summary.ts files exist; D-11 contract grep `auto-apply in 30m|veto-required|Approve all: ✅|react with ❌` = 11 matches (≥3).
- T03 grep acceptance: `tier1_truncation_events|recordTier1TruncationEvent|countTier1TruncationEventsSince` = 13 matches in trace-store.ts (≥3); `shouldFirePriorityPass|priority-dream-pass-trigger` = 4 matches in dream-cron.ts (≥2); `isPriorityPass` = 2 matches in dream-cron.ts (≥1); `PRIORITY_THRESHOLD = 2|24 \\* 60 \\* 60 \\* 1000` = 2 matches (≥2); `5 \\* 60 \\* 1000|PRIORITY_IDLE_MINUTES = 5` = 1 match (≥1); `--priority|priority?: boolean` = 3 matches in dream.ts (≥1).
- T04 grep acceptance: `recordLazyRecallCall|lazy_recall_call_count|lazyRecallCallCount` = 9 matches in trace-store.ts (≥2); `recordLazyRecallCall` = 12 matches in daemon.ts (≥4 — one increment + one type assertion + one method-name string per handler).

## Self-Check: PASSED

All claimed files exist:
- `src/memory/tools/clawcode-memory-{search,recall,edit,archive}.ts` — FOUND (T01)
- `src/manager/dream-veto-store.ts` — FOUND (T02 new)
- `src/manager/dream-discord-summary.ts` — FOUND (T02 new)
- `src/manager/__tests__/dream-auto-apply-d10-policy.test.ts` — FOUND (T02 new)
- `src/manager/__tests__/dream-cron-priority-trigger.test.ts` — FOUND (T03 new)
- `src/performance/__tests__/trace-store-tier1-truncation.test.ts` — FOUND (T03 new)
- `src/performance/__tests__/trace-collector-lazy-recall.test.ts` — FOUND (T04 new)

All claimed commits exist on master:
- `53c2892` (T01) — FOUND
- `07d3762` (T02) — FOUND
- `2241cd2` (T03) — FOUND
- `64193a3` (T04) — FOUND
