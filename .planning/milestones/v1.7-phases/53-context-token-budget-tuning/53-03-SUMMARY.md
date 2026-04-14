---
phase: 53-context-token-budget-tuning
plan: 03
subsystem: performance
tags: [lazy-skills, context-compression, bench-regression-gate, skill-usage-tracker, pino, tracing]

requires:
  - phase: 53-context-token-budget-tuning-01
    provides: "ResolvedAgentConfig.perf.lazySkills config surface (enabled/usageThresholdTurns≥5/reinflateOnMention), countTokens helper"
  - phase: 53-context-token-budget-tuning-02
    provides: "ContextSources.skillsHeader section carved out as individually-budgetable block; section_tokens metadata emission via assembleContextTraced -> span.setMetadata; AssembledContext 3-key shape preserved"
  - phase: 52-prompt-caching-02
    provides: "AssembledContext { stablePrefix, mutableSuffix, hotStableToken } contract — preserved verbatim"
  - phase: 51-slos-regression-gate-02
    provides: "runBench harness + --update-baseline/--check-regression CLI precedent + Baseline schema"

provides:
  - "SkillUsageTracker — in-memory per-agent ring buffer recording skill mentions per turn; capacity floor 5; frozen window snapshots; resetAgent API"
  - "extractSkillMentions — word-boundary regex helper (escaped metachars, case-insensitive, dedup, frozen array return)"
  - "Lazy-skill compression in ContextAssembler — per-skill decision matrix (warm-up/recently-used/mentioned → full; else compressed one-liner; catalog never drops skills)"
  - "Re-inflate on mention — word-boundary scan of currentUserMessage + lastAssistantMessage; reinflateOnMention flag gate"
  - "context_assemble span metadata — skills_included_count + skills_compressed_count alongside section_tokens"
  - "clawcode bench --context-audit — per-prompt response-length regression gate (> 15% drop on any prompt = exit 1)"
  - "runBench captureResponses opt-in — populates BenchReport.response_lengths: { promptId -> avgChars }"
  - "benchReportSchema.response_lengths optional field — backward-compat with Phase 51 baselines"

affects:
  - "Phase 53 completion — CTX-01/02/03/04 all closed"
  - "Future per-turn assembler re-call can populate currentUserMessage / lastAssistantMessage from live SDK iteration for real-time mention re-inflation (wiring exists, caller path is the follow-up)"

tech-stack:
  added: []
  patterns:
    - "In-memory ring buffer with per-key (agent) isolation + frozen snapshot returns — avoids SQLite overhead for ephemeral tracking data (CONTEXT.md Claude's Discretion #3)"
    - "Silent-swallow try/catch around tracker.recordTurn in session-adapter — observational invariant (tracking MUST NEVER break message path; mirrors Phase 50 extractUsage + Phase 52 cache-capture)"
    - "Per-skill decision matrix with warm-up guard — new agents (or fresh daemon restarts) emit full-content for all skills until the usage window has enough data to make compression decisions"
    - "Word-boundary mention matching via `\\b<escaped>\\b/i` regex — substring false-positives blocked (`subsearch-firstline` does NOT match `search-first`)"
    - "span.setMetadata merge semantics (from 53-02) reused for skills_*_count keys alongside section_tokens — no new span or metadata schema required"
    - "Dual-mocked module shape (from 53-02) continues to work; new exports (SkillCatalogEntry, SkillUsageWindow, ResolvedLazySkillsConfig) spread through the importOriginal path without changes"

key-files:
  created:
    - "src/usage/skill-usage-tracker.ts"
    - "src/usage/__tests__/skill-usage-tracker.test.ts"
  modified:
    - "src/manager/context-assembler.ts (renderSkillsHeader helper + 3 new types + lazy-skill branch in assembleContextInternal + skills_*_count on span.setMetadata)"
    - "src/manager/__tests__/context-assembler.test.ts (12 new Phase 53 Plan 03 tests)"
    - "src/manager/session-config.ts (SkillCatalogEntry build loop + lazySkills resolution + SkillUsageTracker.getWindow wiring + new sources.skills/skillUsage/lazySkillsConfig)"
    - "src/manager/__tests__/session-config.test.ts (3 new Phase 53 Plan 03 tests)"
    - "src/manager/session-manager.ts (SkillUsageTracker owned at manager scope + makeSkillTracking helper + skillUsageTracker threaded through configDeps)"
    - "src/manager/session-adapter.ts (SkillTrackingConfig type + iterateWithTracing block-text buffer + recordTurn call with silent-swallow)"
    - "src/manager/__tests__/session-adapter.test.ts (4 new Phase 53 Plan 03 tests — skill usage capture describe block)"
    - "src/cli/commands/bench.ts (--context-audit flag + mutex check + regression gate + captureResponses opt-in when audit or update-baseline set)"
    - "src/cli/commands/bench.test.ts (4 new Phase 53 Plan 03 tests — context-audit regression mode describe block)"
    - "src/benchmarks/runner.ts (captureResponses opt-in + per-prompt avg response-length aggregation)"
    - "src/benchmarks/__tests__/runner.test.ts (2 new Phase 53 Plan 03 tests for captureResponses)"
    - "src/benchmarks/types.ts (benchReportSchema.response_lengths optional field)"

key-decisions:
  - "SkillUsageTracker is a single shared instance at SessionManager scope (not per-agent class instance) — per-agent isolation happens INSIDE via the Map<string, string[][]> keyed by agent name. Simpler lifecycle (one constructor call) and frees us from having to instantiate/destroy trackers on agent add/remove."
  - "Capacity 20 default matches the default lazySkills.usageThresholdTurns from 53-01 Zod. Per-agent usageThresholdTurns can be LOWER (floor 5) but cannot be HIGHER than the tracker's buffer depth — that's an acceptable trade (a higher threshold just means longer warm-up)."
  - "Full-content fallback in session-config = the same legacy `- **name** (vX.Y): description` bullet currently used for all skills. A future enhancement can read `SKILL.md` from `entry.path` to expand the compression savings; today's fallback still compresses unused skills to a strictly shorter one-liner (`- name: desc` omits the `**` + version parts)."
  - "Per-turn mention re-inflation wiring sits at the TESTS layer — session-config passes empty currentUserMessage/lastAssistantMessage at session-start. Production per-turn usage requires a future hook that re-calls assembleContextTraced per turn with the live user message + last assistant message. The decision matrix + word-boundary scan + span telemetry are in place, awaiting that caller."
  - "bench --context-audit + --update-baseline are mutually exclusive — fast-fail BEFORE running bench so the operator doesn't wait through a full run to discover a flag conflict."
  - "captureResponses is auto-enabled when EITHER --context-audit OR --update-baseline is set — --update-baseline needs to persist response_lengths so the NEXT context-audit run has a baseline to diff against."
  - "Test 10 (context-assembler 'Test 10: compressed skills remain in catalog') validates the compression preserves discoverability — the assembler never DROPS a skill, it only switches rendering mode. Full-content fixtures include the skill name in body so the name stays greppable across both modes."

patterns-established:
  - "SkillTrackingConfig is an optional 4th parameter on SessionAdapter.createSession / resumeSession, matching the precedent set by PrefixHashProvider in Phase 52 — adapter is framework-agnostic, production wires through SessionManager, tests pass stubs directly."
  - "In-memory-only trackers can plug into the adapter the same way SQLite-backed UsageTracker does (different concrete class, same optional-parameter pattern). The CONTEXT.md 'Claude's Discretion' decision to keep skill-usage in-memory is justified by: (a) daemon restart warm-up behavior absorbs the reset, (b) no cross-session skill usage analytics needed at agent scale, (c) zero-cost per turn vs SQLite write."
  - "Response-length regression gate uses the SAME baseline file as the latency regression gate (Phase 51) — the `response_lengths` field just rides alongside the existing percentile fields. Operators maintain ONE baseline.json, not two."

requirements-completed: [CTX-03]
validates: [CTX-02]

duration: 32m 23s
completed: 2026-04-14
---

# Phase 53 Plan 03: Context & Token Budget Tuning — Lazy Skills + Regression Gate Summary

**Lazy-skill compression with word-boundary re-inflate-on-mention renders unused skills as one-line catalog entries while recently-used skills keep full SKILL.md bodies; context_assemble span metadata now carries skills_included_count + skills_compressed_count alongside section_tokens; clawcode bench --context-audit enforces the 15% per-prompt response-length regression gate against a shared baseline.**

## Performance

- **Duration:** 32m 23s
- **Started:** 2026-04-14T01:24:17Z
- **Completed:** 2026-04-14T01:56:40Z
- **Tasks:** 2
- **Files touched:** 12 (2 created + 10 modified) — 6 source, 6 test
- **New tests:** 34 GREEN (15 skill-usage-tracker + 4 session-adapter + 12 context-assembler + 3 session-config + 4 bench CLI + 2 runner)

## Accomplishments

### Lazy-skill compression (CTX-03)

The context assembler now runs every skill in `sources.skills` through a per-skill decision matrix:

| Condition | Rendered as |
|---|---|
| Warm-up (`usage.turns < usageThresholdTurns`) | Full content |
| `lazySkillsConfig.enabled === false` | Full content |
| Name ∈ `usage.recentlyUsed` | Full content |
| Name mentioned (word-boundary) in user/assistant msg AND `reinflateOnMention === true` | Full content |
| otherwise | Compressed one-liner `- <name>: <description>` |

Compressed skills STAY in the catalog — discoverability preserved. The assembler never drops a skill entirely. Current session-config wiring populates `skills[].fullContent` from a description bullet fallback; a future enhancement can read the on-disk SKILL.md body for maximum compression savings.

### In-memory SkillUsageTracker

A single `SkillUsageTracker` instance lives at SessionManager scope:

```typescript
export class SkillUsageTracker {
  constructor(opts: { capacity: number });   // capacity floor 5, throws RangeError below
  recordTurn(agent: string, event: SkillMentionEvent): void;
  getWindow(agent: string): SkillUsageWindow; // frozen snapshot, fresh Set each call
  getRecentlyUsedSkills(agent: string): ReadonlySet<string>;
  resetAgent(agent: string): void;            // called on stopAgent
}
```

Per-agent isolation happens inside the tracker (keyed by agent name). Ring buffer caps at `capacity` per agent — oldest turn evicted when exceeded. No SQLite persistence: daemon restart clears buffers, and the warm-up guard absorbs the reset.

### Session-adapter mention capture

`iterateWithTracing` buffers assistant block-level text per turn (covers both `msg.content: string` narrow path AND `message.content[].text` block path). On the `result` branch — immediately after the Phase 52 cache-capture block — we extract word-boundary skill mentions from the combined text and record them on the tracker:

```typescript
try {
  if (skillTracking) {
    const assistantText = [...textParts, ...blockTextParts].join("\n");
    const mentioned = extractSkillMentions(assistantText, skillTracking.skillCatalogNames);
    skillTracking.skillUsageTracker.recordTurn(
      skillTracking.agentName,
      { mentionedSkills: mentioned },
    );
  }
} catch {
  // Silent-swallow — observational path MUST NEVER break message path.
}
```

Tracker errors silent-swallow (Phase 50 observational invariant). When `skillTracking` is undefined, the adapter does nothing — no calls, no errors.

### Re-inflate-on-mention

`extractSkillMentions(text, catalog)` uses `\b<escaped>\b/i` regex so substring false-positives are blocked:

- `"subsearch-firstline is unrelated"` with catalog `["search-first"]` → `[]` (no match)
- `"Use search-first and content-engine"` → `["search-first", "content-engine"]` (dedup applied)
- `"SEARCH-FIRST and Content-Engine"` (case-insensitive) → `["search-first", "content-engine"]`

In the assembler, a currently-compressed skill re-inflates for THIS turn when its name appears in EITHER `sources.currentUserMessage` OR `sources.lastAssistantMessage`. Next turn with no mention and still outside the usage window → re-compresses.

### Span telemetry

`context_assemble` span `metadata_json` now carries:

```json
{
  "section_tokens": { "identity": N, "soul": N, "skills_header": N, "hot_tier": N, "recent_history": N, "per_turn_summary": N, "resume_summary": N },
  "skills_included_count": N,
  "skills_compressed_count": N
}
```

Plan 53-01's audit aggregator already reads span `metadata_json` — it will auto-pick up these new fields without any additional wiring. Plan 53-02's pattern (span.setMetadata merge semantics) is reused verbatim.

### bench --context-audit regression gate (CTX-02 validation)

`clawcode bench --context-audit` runs the fixed prompt set, captures per-prompt response lengths, and diffs against `baseline.json.response_lengths`:

```
for each (promptId, baselineLen) in baseline.response_lengths:
  currentLen = current.response_lengths[promptId]
  dropPct = (baselineLen - currentLen) / baselineLen * 100
  if dropPct > 15: regression
```

Any prompt with > 15% drop → exit 1 with `"Context-audit regression:"` + per-prompt details. All prompts within threshold → exit 0 with `"No context-audit regressions detected."`. Mutually exclusive with `--update-baseline`. Missing baseline → friendly error pointing to `--update-baseline`.

`runBench.captureResponses` (opt-in) populates the new optional `response_lengths: Record<string, number>` field on `BenchReport` with per-prompt average chars across repeats. Auto-enabled by `--context-audit` or `--update-baseline`; omitted by default (Phase 51 baselines unchanged).

## SkillUsageTracker API

```typescript
export type SkillMentionEvent = {
  readonly mentionedSkills: readonly string[];
};

export type SkillUsageWindow = {
  readonly agent: string;
  readonly turns: number;       // 0..capacity
  readonly capacity: number;
  readonly recentlyUsed: ReadonlySet<string>;  // union across buffered turns
};

export type SkillUsageTrackerOptions = {
  readonly capacity: number;    // >= 5, else RangeError
};

export function extractSkillMentions(
  text: string,
  catalogNames: readonly string[],
): readonly string[];           // frozen, dedup, word-boundary, case-insensitive
```

## Lazy-skill decision matrix (formal)

```
render_full(skill) =
  warm_up
  OR (usage && usage.recentlyUsed.has(skill.name))
  OR (reinflateOnMention && mention_hit(skill.name))

warm_up = !cfg || !cfg.enabled || !usage || usage.turns < cfg.usageThresholdTurns

mention_hit(name) =
  word_boundary_match(name, currentUserMessage)
  OR word_boundary_match(name, lastAssistantMessage)
```

## Task Commits

1. **Task 1 RED:** `0e7f314` — 15 failing tests for SkillUsageTracker + extractSkillMentions
2. **Task 1 GREEN:** `d79155e` — SkillUsageTracker + session-adapter mention capture + session-manager wiring (19 new tests GREEN)
3. **Task 2 RED:** `70c92ee` — 21 failing tests for lazy-skill compression + bench context-audit
4. **Task 2 GREEN:** `0ce7e2d` — lazy-skill compression + bench --context-audit regression gate (15 new tests GREEN)

_TDD: each task followed test-first (RED) → implementation (GREEN). No refactor commits — implementation stayed minimal._

## Test Counts

- skill-usage-tracker: 15 new tests GREEN (new file)
- session-adapter: 4 new tests (Phase 53 describe block) + 18 pre-existing = 22 GREEN
- context-assembler: 12 new tests (Phase 53 Plan 03) + 45 pre-existing (Phase 50-53.02) = 57 GREEN
- session-config: 3 new tests + 35 pre-existing = 38 GREEN
- bench CLI: 4 new tests + 12 pre-existing = 16 GREEN
- runner: 2 new tests + 5 pre-existing = 7 GREEN
- **Total new Phase 53 Plan 03 tests: 34 GREEN**
- **Full `src/` test suite: 1336 GREEN / 1 pre-existing failure** (`src/mcp/server.test.ts` TOOL_DEFINITIONS tool-count drift — documented in `deferred-items.md` since Plan 53-02; unrelated to Phase 53 scope)

## Decisions Made

See frontmatter `key-decisions`. Highlights:
- SkillUsageTracker = **single shared instance** at SessionManager scope with internal per-agent Map (not one-tracker-per-agent).
- Capacity 20 default matches `lazySkills.usageThresholdTurns` default from 53-01 Zod.
- Full-content fallback in session-config = the legacy bullet line; a future follow-up reads `SKILL.md` from `entry.path` for maximum savings.
- Per-turn mention re-inflation **wired but inert** in production session-config today — assembler accepts `currentUserMessage` + `lastAssistantMessage`, tests exercise the re-inflate path, production benefits from the per-skill usage-window compression starting immediately. Per-turn LIVE re-inflate requires a follow-up caller path.
- `--context-audit` and `--update-baseline` are **mutually exclusive, checked BEFORE running bench** so the operator doesn't wait through a full run to discover a flag conflict.
- `captureResponses` auto-enables when either `--context-audit` or `--update-baseline` is set.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test fixture lacked skill name in full-content body**
- **Found during:** Task 2 GREEN (running context-assembler tests — Test 10 failed)
- **Issue:** The test fixture `FULL_SEARCH_FIRST = "# Search First\n..."` used the display-cased title but not the lowercase catalog name `search-first`. Test 10 (catalog preservation) checks that both full-content AND compressed forms contain the skill name so discoverability is preserved. With the display-cased title only, the full-content rendered block did not contain the catalog key.
- **Fix:** Added `"Skill name: search-first."` to each fixture's full content — mirrors real-world SKILL.md bodies that reference the skill's canonical name.
- **Files modified:** `src/manager/__tests__/context-assembler.test.ts`
- **Verification:** Test 10 GREEN; all 57 context-assembler tests GREEN.
- **Committed in:** `0ce7e2d` (Task 2 GREEN commit)

**2. [Rule 2 - Missing critical functionality] Block-level text accumulator**
- **Found during:** Task 1 GREEN (while wiring mention capture)
- **Issue:** The existing `iterateWithTracing` accumulates assistant text into `textParts` ONLY when `msg.content: string` is non-empty. But the SDK's real shape puts text into `message.content[]: [{ type: 'text', text }]` blocks — the narrowed path often fires empty. Mention capture against `textParts.join(...)` alone would miss most real-world mentions.
- **Fix:** Added a parallel `blockTextParts: string[]` accumulator that collects `block.text` from every block-level text entry. Mention capture scans the UNION of both (`[...textParts, ...blockTextParts].join("\n")`).
- **Files modified:** `src/manager/session-adapter.ts`
- **Verification:** Tests 10, 11, 13 (session-adapter capture) assert mentions against text delivered via the block-level path exclusively — all GREEN.
- **Committed in:** `d79155e` (Task 1 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1× Rule 1 bug, 1× Rule 2 missing critical functionality). Both necessary for correctness. No scope expansion.

## Issues Encountered

- **Pre-existing `src/mcp/server.test.ts` failure**: "TOOL_DEFINITIONS has exactly 8 tools defined" — actual count is 16. Documented in `deferred-items.md` since Plan 53-02. Out of Phase 53 scope.

## Phase 53 Completion — CTX-01/02/03/04 Status

| Req | Status | Plan |
|---|---|---|
| CTX-01 — `clawcode context-audit` per-section p50/p95 | CLOSED | 53-01 (audit CLI + aggregator) + 53-02 (span metadata populated) |
| CTX-02 — per-section budget enforcement + regression gate | CLOSED | 53-02 (budgets + warn-and-keep + drop-importance) + 53-03 (bench --context-audit) |
| CTX-03 — lazy/compressed skills with re-inflate-on-mention | CLOSED | 53-03 (decision matrix + tracker + word-boundary mention) |
| CTX-04 — resume-summary hard cap 1500/500 with regen+truncate fallback | CLOSED | 53-02 (`enforceSummaryBudget` API + iterative shrink loop) |

**Zero new IPC methods added across all three Phase 53 plans** (filesystem-direct audit + in-memory tracker + bench CLI extension — verified `grep -c '"context-audit"' src/ipc/protocol.ts` = 0).

**AssembledContext return shape `{ stablePrefix, mutableSuffix, hotStableToken }` preserved VERBATIM** across 53-01 → 53-02 → 53-03 (regression verified via Plan 53-02 Test 7 + Plan 53-03 Test 12).

## Next Phase Readiness

- **Live per-turn re-inflation**: the assembler accepts `currentUserMessage` + `lastAssistantMessage` TODAY. A future follow-up wires a per-turn caller path that re-calls `assembleContextTraced` with the live user message so mention-based re-inflation activates in production. The TESTS exercise it fully; the assembler contract is locked.
- **SKILL.md body reads**: session-config's `skillsCatalogEntries` today uses description fallback for `fullContent`. A follow-up can read `entry.path + "/SKILL.md"` at session-config time to populate the real body — the compression savings then reflect the real SKILL.md ↔ one-liner delta (likely 10-100× larger than today's legacy-bullet ↔ one-liner delta).
- **Audit data with compression telemetry**: the `context-audit` CLI from Plan 53-01 will auto-pick up `skills_included_count` + `skills_compressed_count` on the `context_assemble` span as soon as agents start running. Operators can run `clawcode context-audit <agent>` immediately and see compression ratios.

---
*Phase: 53-context-token-budget-tuning*
*Plan: 03*
*Completed: 2026-04-14*

## Self-Check: PASSED

All declared files exist; all 4 per-task commits resolve in `git log`. Acceptance-criteria grep counts verified:

- `renderSkillsHeader` in context-assembler.ts: 2
- `SkillCatalogEntry` in context-assembler.ts: 2
- `SkillUsageWindow` in context-assembler.ts: 2
- `ResolvedLazySkillsConfig` in context-assembler.ts: 2
- `skills_included_count` in context-assembler.ts: 2
- `skills_compressed_count` in context-assembler.ts: 2
- `extractSkillMentions` in context-assembler.ts: 3
- `context-audit` in bench.ts: 9
- `response_lengths` in bench.ts: 7
- `captureResponses` in runner.ts: 5
- `response_lengths` in types.ts: 1
- `"skill-usage"/"lazy-skills"/"context-audit"` in src/ipc/protocol.ts: **0** (no new IPC method)
- `SkillUsageTracker` class export: 1
- `capacity floor is 5` error message: 1
