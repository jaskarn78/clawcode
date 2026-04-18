# Phase 67: Resume Auto-Injection - Research

**Researched:** 2026-04-18
**Domain:** Context-assembly pipeline extension, session-gap detection, MemoryStore tag retrieval
**Confidence:** HIGH

## Summary

Phase 67 adds a **dedicated `conversation_context` section** to `buildSessionConfig` → `assembleContext` that renders the last N session summaries (stored by Phase 66 as `source="conversation"` MemoryEntries tagged `["session-summary", "session:{id}"]`) as a markdown brief, subject to a 4-hour gap-skip check. The brief lands in the **mutable suffix** of the assembler output so it never invalidates the cached stable prefix (Phase 52 `stable_token` logic already handles this placement pattern for `discordBindings` / `resumeSummary`).

Every piece of required infrastructure exists: (1) `ConversationStore.listRecentSessions(agentName, limit)` returns sessions ordered by `started_at DESC` with `startedAt`/`endedAt` timestamps suitable for the 4-hour gap check; (2) `MemoryStore.findByTag(tag)` provides tag-scoped retrieval via `json_each` (src/memory/store.ts:440); (3) `context-assembler.ts` already exposes `SectionName` + `SectionTokenCounts` as the canonical extension point; (4) `context-summary.ts::enforceSummaryBudget` provides the exact pre-enforcement pattern to mirror for the brief's passthrough budget strategy. The Zod schema surface (`conversationConfigSchema` in `src/memory/schema.ts:65-69`) already exists but currently only has `enabled` + `turnRetentionDays` — it needs three new fields plus a resolved type in `ResolvedAgentConfig`.

The single non-trivial edit is extending the canonical `SECTION_NAMES` in `src/performance/context-audit.ts:27-35` (currently 7 frozen section names) to include `"conversation_context"`. This is a blast-radius event: `SectionTokenCounts`, `MemoryAssemblyBudgetsSchema` (`src/config/schema.ts:195-203`), `buildContextAuditReport` buckets, the `recommendations.new_defaults` map, and every test fixture asserting section_tokens shape all touch this list. Count: 8 call sites.

**Primary recommendation:** Build a pure helper `assembleConversationBrief(agentName, memoryStore, conversationStore, opts)` in a new `src/memory/conversation-brief.ts` that handles (a) listing recent sessions, (b) gap check against `now - lastEndedAt`, (c) tag-fetching summary MemoryEntries, (d) rendering markdown, (e) pre-enforcement budget via `enforceSummaryBudget`-style helper. Call this from `buildSessionConfig` with `now = Date.now()` injected so tests can simulate gaps deterministically. Thread the rendered string via a new `ContextSources.conversationContext` field into the mutable suffix. Extend `SECTION_NAMES` once across 4 files in a coordinated edit.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

All implementation choices are at Claude's discretion — infrastructure phase. Key research guidance locked in STATE.md decisions and CONTEXT.md Specifics/Decisions:

- Auto-inject uses a **dedicated `conversation_context` budget** (default 2000-3000 tokens, configurable via `conversation.conversationContextBudget` or `perf.memoryAssemblyBudgets.conversation_context`) — does **NOT** share the `resume_summary` budget introduced in Phase 52/53
- Injection lands in the **mutable suffix** of the context-assembler output (same block as `discordBindings` and `contextSummary`) so it never invalidates the cached stable prefix
- Gap threshold default **4 hours**, configurable (e.g. `conversation.resumeGapThresholdHours`) — on restart, if time-since-last-session-end < threshold, skip injection entirely (SESS-03)
- Recent session count default **3**, configurable via `conversation.resumeSessionCount` (SESS-02)
- Source data: query MemoryStore for entries with `source === "conversation"` and tag `"session-summary"`, ordered by `createdAt DESC`, limit N — reuses standard MemoryStore APIs
- Zero history → produce empty string (not an empty heading or placeholder)
- New context-assembler `SectionName` addition: `"conversation_context"` — added to `SECTION_NAMES` in both `context-assembler.ts` and `performance/context-audit.ts`
- Budget strategy: `passthrough` (measured, not auto-truncated) — budget enforcement happens BEFORE the string is handed to the assembler
- Integration point: `buildSessionConfig` in `src/manager/session-config.ts`
- Schema additions flow through `src/config/schema.ts` (Zod) + `src/shared/types.ts` → `ResolvedAgentConfig.conversation` branch

### Claude's Discretion

Everything — infrastructure phase, no user-specific locks beyond the decisions above.

### Deferred Ideas (OUT OF SCOPE)

- Cross-agent conversation handoff context (ADV-03 in REQUIREMENTS.md) — out of scope for v1.9
- Proactive mid-turn conversation surfacing (ADV-02) — out of scope
- Topic threading across sessions (ADV-01) — out of scope; session summaries provide sufficient grouping
- Deep on-demand search (RETR-01/02/03) — belongs to Phase 68, not 67
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SESS-02 | On agent resume, a structured context brief from the last N recent session summaries is automatically injected into the agent's prompt via a dedicated `conversation_context` budget section (2000-3000 tokens) | `MemoryStore.findByTag("session-summary")` (store.ts:440) + sorting by `createdAt DESC` + limit N; markdown render + pre-enforcement against new budget; new `ContextSources.conversationContext` field threaded into mutable suffix; new `SectionName` + `SectionTokenCounts` member for audit visibility |
| SESS-03 | Auto-injection is skipped when the session gap is short (< 4 hours configurable) to avoid redundant context when the agent was only briefly restarted | `ConversationStore.listRecentSessions(agentName, 1)` returns the most-recent session with `endedAt`; compute `Date.now() - new Date(endedAt).getTime() < gapThresholdHours * 3_600_000` → return empty string; handle `endedAt === null` (session was active — crash case) by using `startedAt` or `never injected` behavior (see Open Question 2) |
</phase_requirements>

## Standard Stack

### Core (Existing — Zero New Dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.8.0 | Tag-scoped MemoryEntry lookup via `findByTag`; session listing via `listRecentSessions` | Same connection serving MemoryStore + ConversationStore; no new DB handles |
| zod | ^4.3.6 | Extend `conversationConfigSchema` with 3 new fields | Mirrors exact precedent in `src/memory/schema.ts:65-69` + `memoryAssemblyBudgetsSchema` pattern |
| pino | ^9 | Warn on budget overflow + gap-skip observability | Already used by `enforceSummaryBudget` + `buildSessionConfig` via `SessionConfigLoggerLike` |
| date-fns | ^4.1.0 | (Optional) Gap calculation | `Date.now() - new Date(endedAt).getTime()` is simpler — prefer vanilla over pulling date-fns |
| vitest | ^4.1.3 | Unit tests for brief assembly, gap check, budget enforcement, wiring | Already configured |

### Supporting (Existing)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @anthropic-ai/tokenizer | ^0.0.4 | Pre-enforcement budget token count via `countTokens()` | Already wrapped in `src/performance/token-count.ts`; imported by `context-summary.ts` + `context-assembler.ts` |
| nanoid | ^5.1.7 | (Not needed) | No new IDs generated in this phase — brief is stateless |

### Alternatives Considered

| Recommended | Alternative | Tradeoff |
|-------------|-------------|----------|
| MemoryStore.findByTag("session-summary") + sort by `createdAt` in JS | `ConversationStore.listRecentSessions(name, N)` → JOIN to memories via `summary_memory_id` FK | **Prefer findByTag.** (a) ConversationStore doesn't need to know anything about MemoryStore (preserves its single-purpose design); (b) findByTag returns the summary content directly so we avoid a second DB hop; (c) SESS-04 integration is the whole point — treating summaries as standard MemoryEntries. Use ConversationStore ONLY for the gap-check timestamp. |
| Pre-enforcement budget (mirror `enforceSummaryBudget`) | Assembler-side `warn-and-keep` strategy | **Prefer pre-enforcement.** (a) Budget enforcement happens on the *rendered* brief string (caller concern), not on individual sections; (b) the assembler's `passthrough` strategy just measures — no auto-truncation would fire anyway; (c) enables an observable `truncated: true` return signal analogous to `EnforceSummaryBudgetResult`. |
| Inject `now: number` into `buildSessionConfig`/brief helper | Read `Date.now()` inline | **Inject** — the gap-check test cases need deterministic time. Same pattern used in `relevance.ts`, `decay.ts` tests. |
| Mutable suffix placement after `resumeSummary` | Stable prefix | **Mutable suffix is locked.** Per CONTEXT.md Decisions and STATE.md: injection lands in mutable suffix so brief changes turn-to-turn don't invalidate the cached stable prefix (Phase 52 `stable_token` invariants). |
| New `SectionName` `"conversation_context"` in canonical list | Fold counts into existing `resume_summary` | **New SectionName is locked** per CONTEXT.md. Merging would hide brief growth inside the resume-summary metric and break the audit CLI recommendation engine (`new_defaults[section] = ceil(p95 * 1.2)`). |

**Installation:** None — zero new npm dependencies per v1.9 commitment.

**Version verification:** All deps verified in `package.json` at the repo root (lines identified above). No registry lookups needed.

## Architecture Patterns

### Recommended Module Layout

```
src/memory/
├── conversation-brief.ts           # NEW — pure helpers: assembleConversationBrief,
│                                   #       buildBriefMarkdown, checkGapSkip,
│                                   #       enforceConversationContextBudget
├── conversation-brief.types.ts     # NEW — AssembleBriefInput, AssembleBriefDeps,
│                                   #       AssembleBriefResult (discriminated union)
├── schema.ts                       # MODIFIED — extend conversationConfigSchema with
│                                   #            resumeSessionCount, resumeGapThresholdHours,
│                                   #            conversationContextBudget
└── __tests__/
    └── conversation-brief.test.ts  # NEW — pure helpers + wiring

src/manager/
├── session-config.ts               # MODIFIED — call assembleConversationBrief, thread
│                                   #            conversationContext source into assembler,
│                                   #            pass now for gap check
├── context-assembler.ts            # MODIFIED — extend ContextSources with
│                                   #            conversationContext?, add
│                                   #            SectionName "conversation_context",
│                                   #            extend SectionTokenCounts + DEFAULTS,
│                                   #            emit conversation_context in mutable suffix
└── __tests__/
    └── session-config.test.ts      # MODIFIED — add brief-injection + gap-skip cases

src/performance/
├── context-audit.ts                # MODIFIED — extend SECTION_NAMES const + buckets
│                                   #            record shape
└── __tests__/context-audit.test.ts # MODIFIED — 8th section in assertions

src/config/
└── schema.ts                       # MODIFIED — extend memoryAssemblyBudgetsSchema with
                                    #            conversation_context OR add
                                    #            conversation.* knobs (see Decision below)

src/shared/
└── types.ts                        # MODIFIED — add ResolvedAgentConfig.memory.conversation
                                    #            branch (resumeSessionCount,
                                    #            resumeGapThresholdHours,
                                    #            conversationContextBudget)
```

### Decision: Config Placement

Two viable locations for the new knobs:

| Option | Path | Fits |
|--------|------|------|
| A (recommended) | `memory.conversation.{resumeSessionCount, resumeGapThresholdHours, conversationContextBudget}` | Extends the existing `conversationConfigSchema` (already has `enabled`, `turnRetentionDays`). Domain-cohesive. Single branch for all v1.9 conversation knobs. |
| B | `perf.memoryAssemblyBudgets.conversation_context` + `conversation.{resumeSessionCount, resumeGapThresholdHours}` at root | Splits budget knob from behavior knobs. Aligns budget with the 7 existing per-section budgets. |

**Recommendation: Option A.** (1) v1.9's locked decision is "Auto-inject uses a *dedicated* budget — does not share resume_summary budget." Keeping it OUT of `memoryAssemblyBudgets` respects that dedication literally. (2) `conversationConfigSchema` is the natural home — `turnRetentionDays` and `enabled` already live there. (3) Single config surface per domain simplifies the `resolveAgentConfig` merge and the `ResolvedAgentConfig` shape. The assembler still gets the budget through `sources.conversationContextBudget` or similar plumbing. Planner can override if they prefer Option B on stylistic grounds.

### Pattern 1: Pure Brief Assembler (mirror `context-summary.ts`)

**What:** A pure function that takes deps + input, returns a frozen result with `{ brief: string, truncated: boolean, skipped: false | "gap" | "empty" }`. No side effects. Injected stores + `now` for determinism.

**Why:** Testing gap logic requires deterministic time. Testing budget overflow requires deterministic content. `enforceSummaryBudget` is the exact precedent — pure function, injected deps, frozen return.

**Shape:**
```typescript
// src/memory/conversation-brief.ts

export const DEFAULT_RESUME_SESSION_COUNT = 3;
export const DEFAULT_RESUME_GAP_THRESHOLD_HOURS = 4;
export const DEFAULT_CONVERSATION_CONTEXT_BUDGET = 2000;
export const MIN_CONVERSATION_CONTEXT_BUDGET = 500;

export type AssembleBriefInput = {
  readonly agentName: string;
  /** Epoch milliseconds — injected for deterministic gap tests. Default Date.now(). */
  readonly now: number;
};

export type AssembleBriefDeps = {
  readonly conversationStore: ConversationStore;
  readonly memoryStore: MemoryStore;
  readonly config: {
    readonly sessionCount: number;        // default 3
    readonly gapThresholdHours: number;   // default 4
    readonly budgetTokens: number;        // default 2000
  };
  readonly log?: LoggerLike;
};

export type AssembleBriefResult =
  | {
      readonly skipped: false;
      readonly brief: string;
      readonly sessionCount: number;
      readonly tokens: number;
      readonly truncated: boolean;
    }
  | {
      readonly skipped: true;
      readonly reason: "gap" | "empty";
    };
```

### Pattern 2: Assembler Extension (Mutable-Suffix Placement)

**What:** Extend `ContextSources` with `conversationContext?: string`. The assembler measures it for `SectionTokenCounts.conversation_context` and emits it into the mutable suffix alongside `discordBindings` / `perTurnSummary` / `resumeSummary`.

**Empty-string handling:** When the source string is `""` or `undefined`, the section_tokens count is 0 and nothing is rendered (mirrors the existing `if (resumeSum)` guard at `context-assembler.ts:719`). No empty heading, no placeholder — preserves the "zero history → produce empty string" contract.

**Placement order in mutable suffix** (recommended — least disruptive to prompt-caching invariants):
```
1. hot-tier (when composition just changed — existing behavior)
2. discordBindings
3. perTurnSummary
4. resumeSummary
5. conversationContext   ← NEW, last so it's the most-distant from the user turn
```

**Why last:** The brief is a "background context" signal, whereas `resumeSummary` is a tighter "what you were doing" signal. Rendering the brief after resumeSummary means the most-concrete context sits closest to the model's reasoning.

**Code sketch:**
```typescript
// context-assembler.ts assembleContextInternal

const conversationContext = sources.conversationContext ?? "";

// ... existing mutable parts ...
if (resumeSum) mutableParts.push(resumeSum);
if (conversationContext) mutableParts.push(conversationContext);

const sectionTokens: SectionTokenCounts = Object.freeze({
  // ... existing 7 sections ...
  conversation_context: countTokens(conversationContext),
});
```

### Pattern 3: Tag-Scoped MemoryStore Retrieval (Phase 66 Integration)

**What:** Use `memoryStore.findByTag("session-summary")` (src/memory/store.ts:440) to fetch ALL session summaries, then sort by `createdAt` DESC in JS and take first N.

**Rationale:** The `findByTag` surface uses `json_each(m.tags)` which is O(n memories with the tag) — fine at agent scale (tens of summaries, not tens of thousands). For N=3 this is negligible; if we ever grow to thousands of summaries, add a more precise query.

**Code sketch:**
```typescript
const allSummaries = deps.memoryStore.findByTag("session-summary");
const recentSummaries = [...allSummaries]
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))   // ISO 8601 lex-sortable DESC
  .slice(0, deps.config.sessionCount);
```

**Why not `source === "conversation"` filter:** The `"session-summary"` tag is more specific — other `source="conversation"` memories (from Phase 68 fact extraction, consolidation, etc.) will also exist. The tag filter guarantees we get ONLY session summary rows.

### Pattern 4: Gap Detection via ConversationStore

**What:** Query the MOST RECENT session via `conversationStore.listRecentSessions(agentName, 1)`. Use `session.endedAt` (or `startedAt` if null) for the gap computation.

**Code sketch:**
```typescript
function checkGapSkip(
  conversationStore: ConversationStore,
  agentName: string,
  now: number,
  gapThresholdHours: number,
): { skip: boolean; lastEndedAt: string | null } {
  const recent = conversationStore.listRecentSessions(agentName, 1);
  if (recent.length === 0) {
    // No prior sessions — first run ever. Don't skip; brief will be empty anyway.
    return { skip: false, lastEndedAt: null };
  }
  const last = recent[0]!;
  // endedAt is null for sessions still in 'active' state — shouldn't happen at
  // startup (the previous process's session would have been crashed/ended on
  // daemon start), but guard defensively: fall back to startedAt.
  const lastTimestamp = last.endedAt ?? last.startedAt;
  const gapMs = now - new Date(lastTimestamp).getTime();
  const thresholdMs = gapThresholdHours * 3_600_000;
  return {
    skip: gapMs < thresholdMs,
    lastEndedAt: lastTimestamp,
  };
}
```

**Edge case:** `listRecentSessions` returns sessions ordered `started_at DESC, rowid DESC` (see `conversation-store.ts:360`). The most recent row is the one we care about. If the row is status="active" (previous process didn't cleanly shut down), the code above falls back to `startedAt` — acceptable because an in-progress session whose start was < 4h ago is still a "fresh context" from the user's perspective.

### Pattern 5: Brief Markdown Structure (Stable Heading)

Per CONTEXT.md Specifics: "The brief structure should be markdown-rendered with a stable heading (so prompt-cache remains stable turn-to-turn when the brief is unchanged) but the heading is omitted when the body is empty."

**Shape:**
```markdown
## Recent Sessions

### Session from 2026-04-18 (4 hours ago)
{summary body 1}

### Session from 2026-04-17 (27 hours ago)
{summary body 2}

### Session from 2026-04-16 (2 days ago)
{summary body 3}
```

**Guards:**
- Empty array → return `""` (no heading, no placeholder)
- Timestamps formatted as relative ("4 hours ago", "2 days ago") via a tiny formatter — no date-fns dependency, just `Math.floor(diffMs / 3_600_000)` + pluralization
- Session body is the MemoryEntry.content verbatim (already markdown from Phase 66)

### Anti-Patterns to Avoid

- **Injecting into stable prefix:** Breaks Phase 52 prompt-cache invariants. The brief changes turn-to-turn (when new summaries land between sessions). MUST go in mutable suffix.
- **Empty heading when zero history:** Violates "zero history → empty string" CONTEXT decision. If `recentSummaries.length === 0`, return `""` NOT `"## Recent Sessions\n(none)"`.
- **Sharing the `resume_summary` budget:** Violates dedicated-budget CONTEXT decision. `conversationContextBudget` must be a separate knob with its own default and its own section_tokens entry.
- **Using `session.turnCount` or any eventually-consistent field:** Same pitfall as Phase 66 (fire-and-forget recordTurn from Phase 65 means turn_count lags). Read timestamps only — those are set atomically in `startSession`/`endSession`.
- **Reading `Date.now()` inline in the helper:** Breaks gap-skip tests. Inject `now` so tests can simulate sessions from T-3h (skip) vs T-5h (inject).
- **Forgetting to extend `SECTION_NAMES` in context-audit.ts:** The `buildContextAuditReport` function iterates `SECTION_NAMES` to build buckets (line 151-159) and the `recommendations.new_defaults` map (line 200-205). Missing the name means no `p50/p95` row, no budget recommendation, and test assertions expecting 7 sections will fail.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tag-scoped MemoryEntry lookup | Custom SQL with JSON_EXTRACT | `memoryStore.findByTag("session-summary")` | Already exists at store.ts:440; returns frozen MemoryEntry[] |
| Sort-by-timestamp | Custom comparator module | `arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt))` | ISO 8601 is lex-sortable; one line |
| Token counting | chars/4 heuristic | `countTokens(text)` from `src/performance/token-count.ts` | Deterministic BPE wrapper; already imported everywhere |
| Budget overflow truncation | Custom word-boundary slice | Lift the hard-truncate logic from `enforceSummaryBudget` (context-summary.ts:239-266) | Battle-tested, handles tokenizer overshoot, 16-iteration bounded loop |
| Session listing | Custom SQL | `conversationStore.listRecentSessions(agentName, limit)` | Already returns frozen array ordered DESC |
| Gap calculation | date-fns | Vanilla `Date.now() - new Date(iso).getTime()` | Zero-dep one-liner; everything is UTC ISO 8601 |
| Markdown rendering | Handlebars / mustache | Plain template literals | Established pattern in `consolidation.ts`, `session-summarizer.ts` |
| Config resolution | Custom merge | `resolveAgentConfig` in `src/config/loader.ts` (already handles the schema-to-ResolvedAgentConfig translation) | One place to add the new branch, automatic defaults |

**Key insight:** This phase is plumbing. The hard work was done in Phase 64 (schema), Phase 65 (capture), Phase 66 (summarization). Phase 67 wires three existing subsystems together through a pure helper and a tiny extension of the assembler surface. Estimated size: `conversation-brief.ts` at ~150 lines + 80-line test file + 5-line diffs in 6 other files.

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — new section is pure read-path from existing tables (`memories` + `conversation_sessions`). No new rows written, no new tables. | none |
| Live service config | None — no external service integration. | none |
| OS-registered state | None — no new processes, no systemd changes. | none |
| Secrets/env vars | None — no new secrets or env var names. | none |
| Build artifacts / installed packages | None — zero new npm dependencies per v1.9 commitment. | none |

**Greenfield-style addition** — no rename/refactor/migration. The only "state change" is the extended `SECTION_NAMES` constant; existing `traces.db` rows with 7-section `section_tokens` metadata remain valid (the audit aggregator tolerates missing section keys by returning `p50: null, p95: null, count: 0` for them — verified at context-audit.ts:190-198).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| better-sqlite3 | MemoryStore.findByTag, ConversationStore.listRecentSessions | ✓ | ^12.8.0 | — |
| zod | Schema extension | ✓ | ^4.3.6 | — |
| pino | Logging gap-skip + budget overflow | ✓ | ^9 | — |
| Node.js 22 LTS | Runtime | Env-dependent | — | — |
| @huggingface/transformers | (Not needed — brief doesn't embed anything; summaries are already embedded) | ✓ | ^4.0.1 | — |
| @anthropic-ai/claude-agent-sdk | (Not needed — no LLM call in this phase) | ✓ | ^0.2.97 | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None — all pre-existing.

## Common Pitfalls

### Pitfall 1: Stable Prefix Invalidation via Brief Placement

**What goes wrong:** If the brief goes into the stable prefix (or if `conversationContext` is somehow folded into `identity` / `toolDefinitions`), every session start with a new summary in the last N invalidates the SDK's prompt cache.

**Why it happens:** Reviewers see the word "context" and default-place it near the identity/skills block. Mutable-suffix placement is explicitly unusual.

**How to avoid:** Add a code comment at the `mutableParts.push(conversationContext)` site citing Phase 52 + this phase's CONTEXT decision. Add a test that verifies the brief text appears in `mutableSuffix`, NOT in `stablePrefix`. Enforce it at review time.

**Warning signs:** Turn-1 prompt cache hit ratio drops on subsequent starts. New `cache_eviction_expected=true` span metadata rows start appearing after Phase 67 ships.

### Pitfall 2: Gap Check with No Prior Session

**What goes wrong:** First-ever agent run → `listRecentSessions(name, 1)` returns `[]`. If the gap helper naively indexes `[0]!`, it throws. If it returns `{ skip: true }`, the brief never renders even when summaries somehow exist (they don't — this is first run — but the logic must be principled).

**Why it happens:** Rushing the empty-array case.

**How to avoid:** Explicitly branch on `recent.length === 0`:
- No prior session → `skip: false` (proceed to brief rendering, which will find zero summaries and return `""`)
- Prior session with timestamp < threshold → `skip: true`
- Prior session with timestamp >= threshold → `skip: false`

Return structured info (`{ skip, lastEndedAt }`) so the caller can log WHY it skipped.

**Warning signs:** `TypeError: Cannot read property 'endedAt' of undefined` on first agent start.

### Pitfall 3: In-Progress Summarization Race on Restart

**What goes wrong:** Phase 66's `handle.onError` path fires summarization as fire-and-forget (`void summarizeSessionIfPossible(...).catch(...)`). If the daemon crashes during summarization, the previous session is `ended`/`crashed` but NOT yet `summarized` — the memory row might not exist. On restart, `buildSessionConfig` runs before Phase 66's summarization of the NEXT session finishes, so the brief shows `N - 1` summaries (missing the most recent).

**Why it happens:** The two subsystems (Phase 66 summarizer + Phase 67 brief assembler) are eventually-consistent. Not a bug, but a surprising UX if the user restarted expecting "yesterday's session" in the brief.

**How to avoid:** Document the behavior: "the brief reflects sessions that completed summarization, not sessions that merely ended." Add a fallback: if `listRecentSessions` returns a session with status `ended` or `crashed` (not yet `summarized`), we know a summary is probably pending — log an info-level message but don't block or synthesize. Operators seeing the gap can run a follow-up resummarization CLI (future phase).

**Warning signs:** Users say "I just had a conversation 5 hours ago — why doesn't the agent remember?" while the DB shows the session as `ended`/`crashed` with `summary_memory_id IS NULL`.

### Pitfall 4: Oversized Summary Content Exceeds Budget

**What goes wrong:** A real Haiku summary can come in at 300-500 tokens. Three of them = ~1500 tokens for content alone + headers. If one session has a `raw-fallback` summary (Phase 66's deterministic dump), that single summary can be 10K+ tokens from a long conversation. Three of those exceed the 2000-token budget by 5x.

**Why it happens:** No per-summary budget — only a total-brief budget. One outlier summary dominates.

**How to avoid:** Pre-enforcement truncates the RENDERED brief string (not per-summary) so the oldest summaries get dropped first. Rendering order matters: most-recent summary first. Pseudo:
```typescript
function enforceConversationContextBudget(brief: string, budgetTokens: number):
  { brief: string; truncated: boolean }
```
Lift the truncation loop from `enforceSummaryBudget` (word-boundary slice + bounded iteration). Emit a pino WARN with `{ agent, beforeTokens, afterTokens, budgetTokens }` when truncation fires. Specifics #4 in CONTEXT.md explicitly calls this out: "Budget enforcement happens on the **rendered brief string** (not per-summary) so the last N summaries can overflow naturally and the enforcer trims the oldest first."

**Alternative (cleaner):** Build the brief by iteratively accumulating summaries while staying under budget. Stop when the next summary would exceed budget. No truncation needed — zero partial summaries.

**Recommendation:** Iterative accumulation is cleaner and more honest — "we showed you 2 summaries because the 3rd would exceed budget" is better than "we showed you 3 summaries with the oldest half-truncated." Plan the helper so it accepts an option: `{ strategy: "accumulate" | "hard-truncate" }` defaulting to `accumulate`.

**Warning signs:** Prompt shows "... [truncated]" inside the conversation brief. Agent references a half-sentence from 3 days ago.

### Pitfall 5: `SECTION_NAMES` Blast Radius

**What goes wrong:** Extending `SECTION_NAMES` in `src/performance/context-audit.ts` but forgetting to update: (a) the `SectionName` union type in `src/manager/context-assembler.ts` (duplicated inline per the comment at line 186-189), (b) `SectionTokenCounts` shape, (c) `DEFAULT_PHASE53_BUDGETS` (if we add a default budget — Option A config placement avoids this), (d) `memoryAssemblyBudgetsSchema` in `src/config/schema.ts:195-203`, (e) test fixtures asserting exact section lists.

**Why it happens:** The constant is duplicated in two files for import-cycle reasons. Easy to update one and miss the other.

**How to avoid:** Coordinated edit in a single atomic task:
1. `src/performance/context-audit.ts:27` — extend const array (and the `buckets` record shape at 151-159)
2. `src/manager/context-assembler.ts:187-194` — extend `SectionName` union + `SectionTokenCounts` type + `DEFAULT_PHASE53_BUDGETS` (Option B only)
3. `src/config/schema.ts:195-203` — extend `memoryAssemblyBudgetsSchema` if Option B
4. `src/shared/types.ts:122-130` — extend `perf.memoryAssemblyBudgets` resolved type if Option B
5. Audit test `src/performance/__tests__/context-audit.test.ts` (if exists) — update section count assertions

Pre-flight grep: `grep -rn "SECTION_NAMES\|SectionName\|SectionTokenCounts" src/` before editing to find all call sites.

**Warning signs:** TypeScript compile error on `SectionName` assignability. Runtime error on `buckets[section]` indexing.

### Pitfall 6: Tag-Search Collision with Fact Memories (Future Phase 68+)

**What goes wrong:** Phase 68's `memory_lookup` might introduce new `source="conversation"` memories tagged differently (e.g., "user-preference", "decision"). `findByTag("session-summary")` is unambiguous, but `findByTag` uses an exact match so no risk today. BUT a planner might be tempted to use `source === "conversation"` as the filter instead — that would match ALL conversation-derived memories, polluting the brief.

**How to avoid:** Only use the `"session-summary"` tag. Don't filter by `source` alone. Add a test that verifies a non-summary `source="conversation"` memory does NOT appear in the brief.

**Warning signs:** Brief shows "user likes terse responses" as a top-line entry — that's a fact, not a session summary.

### Pitfall 7: Clock Skew Between `Date.now()` Sources

**What goes wrong:** `session.endedAt` is produced by the PREVIOUS daemon process at its `Date.now()`. `now` at session start is produced by the CURRENT daemon process. If the system clock jumped backward (NTP correction), `now - endedAt` could be negative → `skip: false` (OK) or zero (OK). If the clock jumped forward, gap looks longer than reality → `skip: false` when it should be `skip: true`. Benign in both directions.

**How to avoid:** Clamp gap to `Math.max(0, now - endedAt)` out of paranoia. Don't over-engineer — both drift directions result in safe defaults (either inject when we shouldn't have, or don't inject when we could have — both are survivable).

**Warning signs:** Tests that use `vi.setSystemTime()` and go backward in time produce negative gap values.

## Code Examples

Verified patterns from existing source files:

### MemoryStore tag lookup

```typescript
// Source: src/memory/store.ts:440-459
findByTag(tag: string): readonly MemoryEntry[] {
  try {
    const rows = this.db.prepare(`
      SELECT m.id, m.content, m.source, m.importance, m.access_count,
             m.tags, m.created_at, m.updated_at, m.accessed_at, m.tier,
             m.source_turn_ids
      FROM memories m, json_each(m.tags) AS t
      WHERE t.value = ?
    `).all(tag) as MemoryRow[];
    return Object.freeze(rows.map(rowToEntry));
  } catch (error) {
    /* ... */
  }
}
```

### ConversationStore recent session query

```typescript
// Source: src/memory/conversation-store.ts:223-229 + :359-366
listRecentSessions(agentName: string, limit: number): readonly ConversationSession[] {
  const rows = this.stmts.listSessions.all(agentName, limit) as SessionRow[];
  return Object.freeze(rows.map(rowToSession));
}
// Prepared statement:
listSessions: this.db.prepare(`
  SELECT id, agent_name, started_at, ended_at, turn_count,
         total_tokens, summary_memory_id, status
  FROM conversation_sessions
  WHERE agent_name = ?
  ORDER BY started_at DESC, rowid DESC
  LIMIT ?
`),
```

### buildSessionConfig integration point

```typescript
// Source: src/manager/session-config.ts:265-289 (after context-summary load, before assembleContext)
// Existing:
let contextSummaryStr = "";
const loadedSummary =
  contextSummary ??
  (await loadLatestSummary(join(config.workspace, "memory")));
if (loadedSummary) {
  const resumeBudget =
    config.perf?.resumeSummaryBudget ?? DEFAULT_RESUME_SUMMARY_BUDGET;
  const enforced = await enforceSummaryBudget({ /* ... */ });
  contextSummaryStr = `## Context Summary (from previous session)\n${enforced.summary}`;
}

// Phase 67 ADDITION — assemble conversation brief AFTER resume-summary load
let conversationContextStr = "";
const convStore = deps.conversationStore;     // NEW dep (see below)
const memStore = deps.memoryStore;            // NEW dep (see below)
if (convStore && memStore) {
  const briefResult = await assembleConversationBrief(
    { agentName: config.name, now: deps.now ?? Date.now() },
    {
      conversationStore: convStore,
      memoryStore: memStore,
      config: {
        sessionCount:
          config.memory.conversation?.resumeSessionCount ??
          DEFAULT_RESUME_SESSION_COUNT,
        gapThresholdHours:
          config.memory.conversation?.resumeGapThresholdHours ??
          DEFAULT_RESUME_GAP_THRESHOLD_HOURS,
        budgetTokens:
          config.memory.conversation?.conversationContextBudget ??
          DEFAULT_CONVERSATION_CONTEXT_BUDGET,
      },
      log: deps.log,
    },
  );
  if (!briefResult.skipped) {
    conversationContextStr = briefResult.brief;  // already budget-enforced
  }
}

// In the ContextSources literal:
const sources: ContextSources = {
  /* ... existing fields ... */
  conversationContext: conversationContextStr,  // NEW — mutable suffix
};
```

### Assembler extension (mutable-suffix placement)

```typescript
// Source: src/manager/context-assembler.ts:713-731 (mutable parts accumulation)
// Existing:
if (perTurn) mutableParts.push(perTurn);
if (resumeSum) mutableParts.push(resumeSum);

// Phase 67 ADDITION:
const conversationContext = sources.conversationContext ?? "";
if (conversationContext) mutableParts.push(conversationContext);

// Section tokens:
const sectionTokens: SectionTokenCounts = Object.freeze({
  identity: countTokens(identityOut),
  soul: countTokens(soulOut),
  skills_header: countTokens(skillsOut),
  hot_tier: countTokens(hotInput.rendered),
  recent_history: countTokens(recentHistoryText),
  per_turn_summary: countTokens(perTurn),
  resume_summary: countTokens(resumeSum),
  conversation_context: countTokens(conversationContext),  // NEW
});
```

### Zod schema extension (Option A — in conversationConfigSchema)

```typescript
// Source: src/memory/schema.ts:65-69 — CURRENT:
export const conversationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  turnRetentionDays: z.number().int().min(7).default(90),
});

// PROPOSED:
export const conversationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  turnRetentionDays: z.number().int().min(7).default(90),
  // Phase 67 — SESS-02
  resumeSessionCount: z.number().int().min(1).max(10).default(3),
  // Phase 67 — SESS-03
  resumeGapThresholdHours: z.number().min(0).default(4),  // 0 = always inject; no hard ceiling
  // Phase 67 — dedicated budget (separate from perf.memoryAssemblyBudgets.resume_summary)
  conversationContextBudget: z.number().int().min(500).default(2000),
});
```

### ResolvedAgentConfig extension

```typescript
// Source: src/shared/types.ts:14-40 — memory branch
// Extend the conversation sub-type (currently the type doesn't have a conversation branch at all):
readonly memory: {
  /* existing fields */
  readonly conversation?: {
    readonly enabled: boolean;
    readonly turnRetentionDays: number;
    readonly resumeSessionCount: number;
    readonly resumeGapThresholdHours: number;
    readonly conversationContextBudget: number;
  };
};
```

### Session-summary retrieval (new helper)

```typescript
// src/memory/conversation-brief.ts (NEW)
function fetchRecentSummaries(
  memoryStore: MemoryStore,
  limit: number,
): readonly MemoryEntry[] {
  const all = memoryStore.findByTag("session-summary");
  // ISO 8601 strings are lexicographically DESC-sortable
  const sorted = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return Object.freeze(sorted.slice(0, limit));
}
```

### Markdown rendering with relative timestamps

```typescript
function formatRelativeTime(fromIso: string, now: number): string {
  const diffMs = Math.max(0, now - new Date(fromIso).getTime());
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function buildBriefMarkdown(
  summaries: readonly MemoryEntry[],
  now: number,
): string {
  if (summaries.length === 0) return "";
  const sections = summaries.map((mem) => {
    const when = formatRelativeTime(mem.createdAt, now);
    const date = mem.createdAt.slice(0, 10);
    return `### Session from ${date} (${when})\n${mem.content}`;
  });
  return `## Recent Sessions\n\n${sections.join("\n\n")}`;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Agents wake up with zero recall of prior conversations | Auto-inject brief of last N session summaries with gap-skip | v1.9 Phase 67 (this phase) | User no longer has to repeat context after agent restart |
| Single-budget resume-summary only | Dedicated conversation_context budget alongside resume_summary | v1.9 Phase 67 | Brief growth doesn't compete with resume-summary budget |
| No section_tokens entry for conversation context | Canonical SECTION_NAMES extended to 8 entries | v1.9 Phase 67 | Audit CLI tracks brief size; tune threshold via `clawcode context-audit` |
| In-process `Date.now()` inline | Injected `now: number` in session-config deps | v1.9 Phase 67 (new helper) | Gap-skip logic becomes unit-testable with deterministic timestamps |
| Summaries are written via Phase 66 but no consumer reads them | Phase 67 reads via tag-scoped findByTag | v1.9 Phase 67 | Completes the session-memory loop (write + read) |

**Deprecated/outdated:**
- Do NOT route session-summary retrieval through ConversationStore's `summary_memory_id` JOIN. The MemoryStore.findByTag path is the canonical one per SESS-04 ("summaries are standard MemoryEntries"). The FK exists for future operations (resummarization, deletion cascade) but is not the read-side path.

## Open Questions

1. **Should the gap check fire when the previous session is status=`active`?**
   - What we know: On clean daemon stop, previous session transitions to `ended`. On crash, to `crashed`. An `active` row at startup means the previous daemon process died so hard it didn't even get the crash handler to run.
   - What's unclear: Is an `active` previous session with `endedAt === null` a short-gap ("process died 30 seconds ago, we're restarting") or a long-gap ("process died 3 days ago, just now starting daemon again") case?
   - Recommendation: Use `session.startedAt` as the fallback timestamp (Pattern 4 above). This treats the session start as the baseline — an `active` session that started 3h ago is still within the gap window; one that started 5h ago is not. Log a WARN if we encounter an `active` row at startup so operators know the previous process didn't clean up.

2. **Should we eagerly await a pending Phase 66 summarization during `buildSessionConfig`?**
   - What we know: Phase 66's `handle.onError` crash-path summarization is fire-and-forget. If the daemon restarts quickly after a crash, `buildSessionConfig` could run BEFORE the previous session's summary is written.
   - What's unclear: Add a synchronous `awaitPendingSummarization(prevSessionId)` hook in `startAgent` before `buildSessionConfig` fires? Or accept the eventual consistency (the brief shows N-1 summaries on fast restarts, N on slower ones)?
   - Recommendation: **Accept eventual consistency for v1.9.** The user-facing impact is minimal (the most-recent summary just missing) and adding awaits risks stalling agent startup behind a 10s LLM call. If it becomes a real problem, add the hook in v1.10. Document the behavior.

3. **Should the brief budget default be 2000 or 3000 tokens?**
   - What we know: CONTEXT.md says "2000-3000 tokens" — range, not a specific value. Three typical Haiku summaries at ~500 tokens each = 1500 tokens + headers + whitespace = ~1800 tokens. A single raw-fallback can blow through 3000 easily.
   - What's unclear: Which end of the range?
   - Recommendation: **2000 default** with operator tuning via `clawcode context-audit`. Err on the side of smaller because (a) STATE.md calls out "Context assembly ceiling (default 8000 tokens from Phase 52) may be too low once conversation_context section is added — verify with clawcode context-audit after Phase 67"; (b) the iterative-accumulate strategy (Pitfall 4) gracefully shows 2 summaries when 3 would overflow. Let operators bump to 3000 if they want more history.

4. **Should the brief heading be "## Recent Sessions" or "## Prior Conversations" or something else?**
   - What we know: CONTEXT.md Specifics #3 says "markdown-rendered with a stable heading" but doesn't specify wording.
   - Recommendation: **"## Recent Sessions"** — matches the STATE.md phase name ("Persistent Conversation Memory") register. Tests should assert on the literal heading so future wording changes are intentional.

5. **Should the brief include session metadata (turn count, duration) or just the summary content?**
   - What we know: Summary content is already markdown with structured categories (User Preferences / Decisions / Open Threads / Commitments) from Phase 66.
   - Recommendation: **Just content + relative-time header.** Adding turn count or duration inflates token cost and doesn't help the agent reason ("this session had 12 turns" is noise). Keep it lean. If operators want metadata, add a `clawcode sessions list` CLI in a follow-up.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.3 |
| Config file | `vitest.config.ts` at repo root |
| Quick run command | `npx vitest run src/memory/__tests__/conversation-brief.test.ts --reporter=verbose` |
| Full suite command | `npm test` (→ `vitest run --reporter=verbose`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SESS-02 | Brief rendered from N most-recent session-summary memories (default 3) | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "renders last N summaries"` | ❌ Wave 0 |
| SESS-02 | Brief is markdown with `## Recent Sessions` heading + per-session subheaders | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "renders markdown structure"` | ❌ Wave 0 |
| SESS-02 | Brief respects `resumeSessionCount` config override | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "respects sessionCount config"` | ❌ Wave 0 |
| SESS-02 | Brief injection lands in `mutableSuffix` NOT `stablePrefix` | integration | `npx vitest run src/manager/__tests__/session-config.test.ts -t "conversation context in mutable suffix"` | ❌ Wave 0 |
| SESS-02 | Budget enforcement: oversize brief is truncated / accumulate stops at budget | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "enforces conversation_context budget"` | ❌ Wave 0 |
| SESS-02 | New `SectionName` `conversation_context` populated in `SectionTokenCounts` | unit | `npx vitest run src/manager/__tests__/context-assembler.test.ts -t "measures conversation_context tokens"` | ❌ Wave 0 |
| SESS-03 | Gap < 4h skips brief injection (returns empty string) | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "skips when gap under threshold"` | ❌ Wave 0 |
| SESS-03 | Gap >= 4h renders brief | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "injects when gap over threshold"` | ❌ Wave 0 |
| SESS-03 | Custom `resumeGapThresholdHours` overrides default | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "respects gap threshold config"` | ❌ Wave 0 |
| edge | Zero prior sessions → empty brief, no heading | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "zero history produces empty string"` | ❌ Wave 0 |
| edge | Active previous session (endedAt null) → uses startedAt for gap | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "falls back to startedAt for active session"` | ❌ Wave 0 |
| edge | Session summaries exist but all older than 30 days → still rendered (decay is a separate concern) | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "renders old summaries without decay filter"` | ❌ Wave 0 |
| edge | Tag collision: non-summary `source=conversation` memories NOT in brief | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "filters by session-summary tag only"` | ❌ Wave 0 |
| config | Zod schema rejects `resumeSessionCount < 1` | unit | `npx vitest run src/config/__tests__/schema.test.ts -t "resumeSessionCount floor"` | ❌ Wave 0 (extend existing) |
| config | Zod schema rejects `conversationContextBudget < 500` | unit | `npx vitest run src/config/__tests__/schema.test.ts -t "conversationContextBudget floor"` | ❌ Wave 0 (extend existing) |
| wiring | `buildSessionConfig` calls brief assembler when stores present | integration | `npx vitest run src/manager/__tests__/session-config.test.ts -t "calls conversation brief assembler"` | ❌ Wave 0 |
| wiring | `buildSessionConfig` tolerates absent ConversationStore (graceful degradation) | integration | `npx vitest run src/manager/__tests__/session-config.test.ts -t "handles missing conversationStore"` | ❌ Wave 0 |
| audit | `SECTION_NAMES` has 8 entries including `conversation_context` | unit | `npx vitest run src/performance/__tests__/context-audit.test.ts -t "SECTION_NAMES includes conversation_context"` | ❌ Wave 0 (extend existing) |

### Sampling Rate

- **Per task commit:** `npx vitest run src/memory/__tests__/conversation-brief.test.ts src/manager/__tests__/session-config.test.ts src/manager/__tests__/context-assembler.test.ts --reporter=verbose`
- **Per wave merge:** `npx vitest run src/memory/ src/manager/ src/performance/ src/config/ --reporter=verbose`
- **Phase gate:** `npm test` — full suite green before `/gsd:verify-work`

### Critical Test Scenarios

**Happy Path (SESS-02):**
- Given: MemoryStore with 5 `source="conversation"` memories tagged `["session-summary", "session:{id}"]`, various `createdAt` timestamps spanning 30 days. Most-recent session endedAt 5 hours ago (> 4h threshold).
- When: `assembleConversationBrief({ agentName, now: T }, deps)` is invoked
- Then: (a) `skipped: false`; (b) `sessionCount === 3` (default); (c) brief string starts with `## Recent Sessions\n\n`; (d) contains 3 `### Session from YYYY-MM-DD (...)` subheaders; (e) subheaders in DESC chronological order (newest first); (f) summary content appears verbatim under each subheader.

**Gap Skip (SESS-03):**
- Given: ConversationStore with one session `endedAt` at T - 2 hours (within 4h threshold); MemoryStore with existing summaries (would render if not skipped).
- When: `assembleConversationBrief({ agentName, now: T }, deps)` is invoked
- Then: (a) `skipped: true`; (b) `reason === "gap"`; (c) ZERO reads against `memoryStore.findByTag` (assert spy.calls.length === 0) — performance: gap check short-circuits.

**Gap Honor (SESS-03):**
- Given: ConversationStore with one session `endedAt` at T - 5 hours (> 4h threshold); MemoryStore with existing summaries.
- When: `assembleConversationBrief({ agentName, now: T }, deps)` is invoked
- Then: (a) `skipped: false`; (b) brief non-empty; (c) findByTag called exactly once.

**Zero History:**
- Given: fresh MemoryStore (no summaries), fresh ConversationStore (no sessions).
- When: `assembleConversationBrief(...)` is invoked
- Then: (a) `skipped: false` (no skip, we just have nothing to render); (b) brief === `""` (empty string, NOT an empty-heading placeholder); (c) `sessionCount === 0`; (d) downstream `buildSessionConfig` assembler receives empty `conversationContext` and emits no section in the output.

**Custom Config Overrides:**
- Given: `conversation.resumeSessionCount: 5` + `conversation.resumeGapThresholdHours: 1` in config.
- When: `buildSessionConfig` with 6 existing summaries and last session endedAt 2h ago.
- Then: (a) brief rendered (2h > 1h threshold); (b) exactly 5 summaries in brief (not 3, not 6).

**Budget Truncation / Accumulate:**
- Given: 3 summaries each ~1500 tokens (total ~4500 tokens); budget 2000.
- When: `assembleConversationBrief(...)`
- Then (accumulate strategy): (a) `sessionCount === 1` (only the most-recent fits); (b) brief tokens < 2000; (c) `truncated: false` (we dropped older, didn't slice in half).

**Mutable-Suffix Placement Invariant (SESS-02 critical):**
- Given: `buildSessionConfig` runs with a non-empty conversation brief.
- When: the assembled result is returned.
- Then: (a) brief text appears in `result.mutableSuffix`; (b) brief text does NOT appear in `result.systemPrompt` (which equals `stablePrefix`); (c) hot-tier placement unchanged (`hotStableToken` matches prior-token logic unaffected).

**Tag Collision Immunity:**
- Given: MemoryStore with:
  - 3 memories tagged `["session-summary", "session:A"]`
  - 2 memories tagged `["fact", "user-preference"]` (source=conversation, no session-summary tag)
  - 1 memory tagged `["session-summary", "session:B", "raw-fallback"]`
- When: `assembleConversationBrief(...)` with sessionCount=10
- Then: brief contains exactly 4 summaries (the session-summary-tagged rows, including raw-fallback); the 2 fact memories DO NOT appear.

**Empty Summary Content Defence:**
- Given: a MemoryEntry with `content: ""` but proper tags (shouldn't happen but be defensive).
- When: brief renders
- Then: empty subheader is either omitted OR included with empty body — NOT thrown error. Recommend: skip entries with `content.trim().length === 0` silently.

**Clock Skew (Pitfall 7):**
- Given: session endedAt at T + 1 hour (future, shouldn't happen but NTP skew).
- When: gap check runs at T.
- Then: gap clamped to 0 → `skip: true` (within 4h of "now"). No throw, no NaN.

### Mock / Stub Strategy

**Real stores (in-memory SQLite) per summarizer pattern:**
```typescript
beforeEach(() => {
  memStore = new MemoryStore(":memory:", { enabled: false, similarityThreshold: 0.85 });
  convStore = new ConversationStore(memStore.getDatabase());
});
afterEach(() => memStore?.close());
```

**Summary seeding helper (lift from `session-summarizer.test.ts`):**
```typescript
function seedSummary(
  memStore: MemoryStore,
  sessionId: string,
  content: string,
  createdAt: string,
): MemoryEntry {
  const entry = memStore.insert(
    {
      content,
      source: "conversation",
      importance: 0.78,
      tags: ["session-summary", `session:${sessionId}`],
      skipDedup: true,
    },
    new Float32Array(384).fill(0.1),
  );
  // Override createdAt for deterministic ordering
  memStore.getDatabase()
    .prepare("UPDATE memories SET created_at = ? WHERE id = ?")
    .run(createdAt, entry.id);
  return entry;
}
```

**Session seeding helper:**
```typescript
function seedEndedSession(
  convStore: ConversationStore,
  agentName: string,
  startedAt: string,
  endedAt: string,
): string {
  const session = convStore.startSession(agentName);
  // Override timestamps
  convStore.getDatabase()
    .prepare("UPDATE conversation_sessions SET started_at = ?, ended_at = ?, status = 'ended' WHERE id = ?")
    .run(startedAt, endedAt, session.id);
  return session.id;
}
```

**Deterministic `now` injection:**
```typescript
const T = new Date("2026-04-18T12:00:00Z").getTime();
const result = await assembleConversationBrief(
  { agentName: "test", now: T },
  { conversationStore, memoryStore, config, log: silentLog() },
);
```

**Silent pino logger (lift from `session-summarizer.test.ts:36-38`):**
```typescript
function silentLog() { return pino({ level: "silent" }); }
```

**`buildSessionConfig` integration pattern** — extend existing `makeDeps()` helper in `src/manager/__tests__/session-config.test.ts:62-69`:
```typescript
function makeDeps(overrides: Partial<SessionConfigDeps> = {}): SessionConfigDeps {
  return {
    tierManagers: new Map(),
    skillsCatalog: new Map(),
    allAgentConfigs: [],
    // Phase 67 ADDITIONS:
    memoryStores: new Map(),           // or plumb differently depending on wiring
    conversationStores: new Map(),
    now: new Date("2026-04-18T12:00:00Z").getTime(),
    ...overrides,
  };
}
```

### Wave 0 Gaps

- [ ] `src/memory/__tests__/conversation-brief.test.ts` — NEW file; covers pure helper (render, gap, budget enforcement, tag filter, edge cases)
- [ ] `src/memory/conversation-brief.ts` + `conversation-brief.types.ts` — NEW source
- [ ] `src/manager/__tests__/session-config.test.ts` — EXTEND with brief-injection tests (mutable-suffix placement, gap skip, zero-history); existing file at `src/manager/__tests__/session-config.test.ts` already has `makeDeps()` pattern to extend
- [ ] `src/manager/__tests__/context-assembler.test.ts` — EXTEND with `conversation_context` section_tokens assertions; may need new file if it doesn't exist — grep first: `ls src/manager/__tests__/ | grep context-assembler`
- [ ] `src/performance/__tests__/context-audit.test.ts` — EXTEND with 8-entry `SECTION_NAMES` assertion; the audit aggregator's buckets record shape test must be updated
- [ ] `src/config/__tests__/schema.test.ts` — EXTEND with floor/ceiling validation for new `conversation.*` fields (if tests exist; otherwise create)
- [ ] No new framework install — vitest ^4.1.3 already configured. No fixtures needed beyond the in-memory SQLite pattern already proven in Phase 66 tests.

## Project Constraints (from CLAUDE.md)

- **Identity injection:** Every session should load `clawcode.yaml` for `test-agent` identity ("Clawdy, competent, dry wit, never sycophantic"). Not relevant to Phase 67's infrastructure work.
- **GSD workflow enforcement:** All edits must go through `/gsd:execute-phase`. No direct edits outside GSD.
- **Coding style (~/.claude/rules/coding-style.md):**
  - **Immutability:** Every returned object from `assembleConversationBrief` MUST use `Object.freeze()`. Arrays inside results MUST be `Object.freeze([...arr])`. Matches existing `ConversationStore`/`MemoryStore` patterns.
  - **Small files:** `conversation-brief.ts` should stay under 400 lines. Split helpers into the `.types.ts` module.
  - **Error handling:** Budget overflow must log via `deps.log?.warn(...)` — never swallow. Gap-skip must return structured `{ skipped: true, reason: "gap" }` — no implicit empty strings.
  - **Input validation:** Validate `config.sessionCount >= 1`, `config.budgetTokens >= MIN_CONVERSATION_CONTEXT_BUDGET` at the Zod schema layer (handled by Zod) AND runtime-guard in the helper (matches `enforceSummaryBudget` backstop pattern).
- **Security (~/.claude/rules/security.md):**
  - No hardcoded secrets (this phase has none — pure read from local SQLite).
  - Never log brief *content* — only `{ agent, beforeTokens, afterTokens, sessionCount, truncated }` metadata. Summary content from Discord users is in scope for memory poisoning (SEC-01/02 governed the capture path; the brief renders what's already stored) — still, don't echo it to pino.
  - Input validation: `agentName` is already the registered agent name (not user input); no extra sanitization needed. Session IDs are nanoids — safe.
- **Git workflow:** feat-prefixed commits per atomic task (`feat(67-01)`, `feat(67-02)`), standard `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- **File organization:** Per-domain placement (brief helper in `src/memory/`, wiring in `src/manager/`), many small files over few large files.

## Sources

### Primary (HIGH confidence)

- `src/manager/context-assembler.ts` (832 lines) — full ContextSources / AssembleOptions / SectionName / SectionTokenCounts / DEFAULT_PHASE53_BUDGETS surface; confirmed mutable-suffix accumulation at lines 713-731; confirmed `passthrough` strategy for summary-like sections
- `src/manager/session-config.ts` (389 lines) — full buildSessionConfig pipeline; confirmed integration point at lines 272-288 (resume summary load); deps shape at lines 53-65; already has `log?: SessionConfigLoggerLike` precedent
- `src/memory/conversation-store.ts` (407 lines) — full API surface: `listRecentSessions(agentName, limit)` at lines 223-229, prepared statement at 359-366; `getSession(id)` available
- `src/memory/store.ts` (~800 lines) — `findByTag(tag)` at lines 440-459 (exact match, uses `json_each`); `insertMemory` at 718-720 with sourceTurnIds column (Phase 66 complete)
- `src/memory/context-summary.ts` (286 lines) — `enforceSummaryBudget` at lines 194-285; DEFAULT_RESUME_SUMMARY_BUDGET / MIN_RESUME_SUMMARY_BUDGET constants; `SummaryRegenerator` type; `LoggerLike` interface; word-boundary truncation loop with bounded iteration
- `src/memory/session-summarizer.ts` (318 lines) — Phase 66 output: `summarizeSession` writes MemoryEntry with `source="conversation"`, tags `["session-summary", "session:{id}"]` (optionally `"raw-fallback"`), `importance=0.78`, `sourceTurnIds`. Phase 67 reads these.
- `src/memory/schema.ts` (126 lines) — `conversationConfigSchema` at lines 65-69 ready for extension; `memoryConfigSchema` at 72-101 includes `conversation` branch
- `src/config/schema.ts` (554 lines) — `memoryAssemblyBudgetsSchema` at 195-203; Zod v4 patterns; precedent for `resumeSummaryBudgetSchema` with floor at 234
- `src/shared/types.ts` (171 lines) — `ResolvedAgentConfig.memory` shape at lines 14-40; `perf.memoryAssemblyBudgets` at 122-130; readonly conventions
- `src/performance/context-audit.ts` (232 lines) — canonical SECTION_NAMES at 27-35; `buildContextAuditReport` at 123-228; buckets shape at 151-159; `new_defaults` map at 200-205
- `src/memory/conversation-types.ts` (71 lines) — ConversationSession type (id, agentName, startedAt, endedAt, status, turnCount, etc.)
- `src/memory/types.ts` — CreateMemoryInput has `skipDedup` and `sourceTurnIds` (Phase 66 complete); MemoryEntry has `tags: readonly string[]` and `createdAt: string`
- `src/manager/session-manager.ts` (793 lines) — Phase 66 lifecycle wiring at 290-313 (crash) and 479-541 (stop); `activeConversationSessionIds` map; `memory.memoryStores` / `memory.conversationStores` maps; `configDeps()` pattern at 687-711
- `src/manager/__tests__/session-config.test.ts` — existing `makeConfig`/`makeDeps` patterns (lines 27-69); vi.mock approach for `loadLatestSummary`; precedent for extending deps
- `src/manager/__tests__/session-manager.test.ts` — Phase 66 integration test patterns at lines 580-780; `getConversationStore()` accessor; seedTurns/releaseSummarize patterns
- `src/memory/__tests__/session-summarizer.test.ts` — in-memory SQLite test harness, `silentLog()`, mock embedder, fixture builders
- `package.json` — all versions confirmed (vitest ^4.1.3, zod ^4.3.6, better-sqlite3 ^12.8.0, pino ^9, nanoid ^5.1.7, date-fns ^4.1.0)
- `.planning/phases/66-session-boundary-summarization/66-RESEARCH.md` — predecessor research (SESS-01, SESS-04 done); confirms summaries are in-DB via Phase 66-02 plan
- `.planning/phases/64-conversationstore-schema-foundation/64-RESEARCH.md` — schema foundation; listRecentSessions API shape; session status state machine

### Secondary (HIGH confidence — project state)

- `.planning/STATE.md` — v1.9 decisions: "Auto-inject uses dedicated conversation_context budget (2000-3000 tokens) in mutable suffix — does NOT share resume_summary budget"
- `.planning/ROADMAP.md` — Phase 67 goal and success criteria (lines 170-183); requirements SESS-02, SESS-03 mapped
- `.planning/REQUIREMENTS.md` — v1.9 requirement text (lines 24-25 for SESS-02, SESS-03)
- `.planning/phases/67-resume-auto-injection/67-CONTEXT.md` — all locked decisions documented

### Tertiary (LOW confidence)

- None — this research relies entirely on verified in-repo source code and prior phase artifacts.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies; all libraries verified in `package.json`
- Architecture: HIGH — direct extension of existing assembler + existing pre-enforcement pattern from context-summary; no architectural novelty
- Pitfalls: HIGH — pitfalls 1 (mutable-suffix), 2 (empty prior), 3 (pending-summarization race), 5 (SECTION_NAMES blast radius) are verified by reading source; pitfall 4 (oversized content) is directly analogous to enforceSummaryBudget's existing logic; pitfall 6 (tag collision) is a proactive guard; pitfall 7 (clock skew) is defensive
- Validation: HIGH — test patterns borrowed from session-summarizer.test.ts and session-config.test.ts, both currently green

**Research date:** 2026-04-18
**Valid until:** 2026-05-18 (30 days — stable domain, all primary sources in-repo)

## RESEARCH COMPLETE

**Phase:** 67 - Resume Auto-Injection
**Confidence:** HIGH

### Key Findings

- **Zero architectural novelty.** Extending `ContextSources` + `SectionTokenCounts` by one field each and adding a pure helper that reads from two existing stores. Phase 66 already stores summaries in the exact shape Phase 67 needs to read.
- **Mutable-suffix placement is a one-line change** at `context-assembler.ts:713-731` guarded by a CONTEXT-locked decision. Test must enforce it.
- **`SECTION_NAMES` blast radius is real but bounded** — 4 coordinated files (context-audit.ts, context-assembler.ts, config/schema.ts, shared/types.ts) plus 1 test file. Do it in a single atomic commit.
- **Budget strategy should be accumulate, not truncate.** Stop adding summaries when the next would exceed budget — cleaner UX than half-sliced summaries. Pre-enforcement in the helper, `passthrough` strategy at the assembler (measured only).
- **Gap check depends on ConversationStore, not MemoryStore.** Uses `listRecentSessions(name, 1).endedAt` (or `.startedAt` fallback for `active` rows). Inject `now: number` into the helper for deterministic tests.
- **Config surface lives on `memory.conversation.*`** (Option A), extending the existing `conversationConfigSchema`. Three new fields: `resumeSessionCount`, `resumeGapThresholdHours`, `conversationContextBudget`. Resolved type added to `ResolvedAgentConfig.memory.conversation`.
- **Validation is vitest-native** — reuses the in-memory SQLite + silent-pino + fixture pattern proven in Phase 66 tests. No new fixtures or test infrastructure needed.

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | Zero new deps; all verified in package.json |
| Architecture | HIGH | Direct extension of assembler; precedent from Phase 52/53/66 |
| Pitfalls | HIGH | Every pitfall traced to exact source lines |
| Validation | HIGH | Test harness pattern already working (Phase 66 green) |
| Config surface | MEDIUM | Option A vs B trade-off is judgment; recommending A with rationale |

### Open Questions (Planner Must Address)

1. Option A vs Option B config placement (defaults to A per recommendation; plan can override)
2. Accumulate vs hard-truncate budget strategy (defaults to accumulate per Pitfall 4; plan can offer both via `strategy` field)
3. Default budget: 2000 vs 3000 tokens (defaults to 2000 per Open Question 3)
4. Brief heading text ("## Recent Sessions" recommended)
5. Whether to await pending Phase 66 summarization at restart (defaults to NO — accept eventual consistency for v1.9)

### Ready for Planning

Research complete. Planner can now create PLAN.md files. Recommend 2 plans:
- **67-01**: Schema + types + new helper module + unit tests (conversation-brief.ts, conversation-brief.types.ts, schema extensions, ResolvedAgentConfig)
- **67-02**: Assembler wiring (SECTION_NAMES + ContextSources + buildSessionConfig integration) + integration tests

Alternatively as a single plan if the planner deems the work coherent enough to ship atomically.
