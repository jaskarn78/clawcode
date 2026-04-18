---
phase: 67-resume-auto-injection
verified: 2026-04-18T17:30:00Z
status: gaps_found
score: 4/5 must-haves verified (SC-1 partial — code path ready but dormant in production)
re_verification: false
gaps:
  - truth: "When an agent resumes after a session gap, the last N recent session summaries are assembled into a structured context brief and injected into the agent's prompt"
    status: partial
    reason: "The complete injection pipeline is built and unit/integration-tested, but SessionManager.configDeps() does not pass conversationStores/memoryStores/now to buildSessionConfig. At runtime, deps.conversationStores?.get(name) returns undefined for every real agent, so assembleConversationBrief is never called and the brief never fires."
    artifacts:
      - path: "src/manager/session-manager.ts"
        issue: "configDeps() method (line 693) returns tierManagers/skillsCatalog/allAgentConfigs/priorHotStableToken/log/skillUsageTracker but omits conversationStores/memoryStores/now. this.memory.conversationStores and this.memory.memoryStores already exist (AgentMemoryManager lines 30, 39) — wiring is a ~3-line addition to configDeps()."
    missing:
      - "Add conversationStores: this.memory.conversationStores and memoryStores: this.memory.memoryStores (and optionally omit now to let buildSessionConfig default to Date.now()) to the return object of SessionManager.configDeps() at src/manager/session-manager.ts line 698."
human_verification:
  - test: "End-to-end Discord recall (SESS-02 + SESS-03 acceptance)"
    expected: "After 5-turn conversation, daemon stop, 4+ hour wait (or stub ended_at to simulate gap), daemon restart, ask 'what were we talking about earlier?' — agent references the prior topic naturally."
    why_human: "Requires live daemon, real Discord channel, session-end summarization from Phase 66 producing a session-summary MemoryEntry, and SessionManager wiring gap being closed first. Cannot verify with grep or unit tests."
  - test: "clawcode context-audit <agent> CLI output after a resume with gap"
    expected: "conversation_context row appears in the audit table with token count > 0 (proving the brief was included in at least one context assembly span)."
    why_human: "Requires running daemon, real agents, and at least one buildSessionConfig call that fires the brief path. No span will carry section_tokens.conversation_context > 0 until SessionManager wiring is closed."
  - test: "gap-skip confirmation on short restart"
    expected: "Restarting agent within 4 hours produces no conversation_context section in the assembled prompt (gap-skip fires). Confirm via clawcode context-audit showing conversation_context = 0 tokens."
    why_human: "Requires live daemon with real timing; unit tests cover this with injected now but the production path is not yet live."
---

# Phase 67: Resume Auto-Injection Verification Report

**Phase Goal:** An agent waking up after a gap receives a structured context brief of recent sessions so it can naturally reference prior conversations without the user repeating themselves.
**Verified:** 2026-04-18T17:30:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (derived from Success Criteria)

| #  | Truth                                                                                                                              | Status      | Evidence                                                                                                          |
|----|------------------------------------------------------------------------------------------------------------------------------------|-------------|-------------------------------------------------------------------------------------------------------------------|
| 1  | When an agent resumes after a gap > 4h, last N session summaries are assembled into a brief and injected in the mutable suffix     | PARTIAL     | Code path built and tested in isolation, but SessionManager.configDeps() omits conversationStores/memoryStores — brief never fires at runtime |
| 2  | When session gap is shorter than threshold, auto-injection is skipped (SESS-03 gap-skip)                                           | PARTIAL     | assembleConversationBrief skips correctly (11 unit tests GREEN), but cannot fire at runtime for the same SessionManager wiring reason |
| 3  | Agent with zero conversation history starts normally — no empty heading, no placeholder                                            | VERIFIED    | assembleConversationBrief returns `{skipped:false, brief:"", sessionCount:0}` when MemoryStore has no session-summary entries; `if (conversationContext)` guard in assembler prevents empty heading from rendering |
| 4  | Brief fits within dedicated conversation_context budget (2000-3000 tokens) without starving other sections                        | VERIFIED    | Accumulate strategy proven in test 67-01-04; budget is separate from resume_summary; SectionTokenCounts.conversation_context always reported |
| 5  | SECTION_NAMES extended to 8 entries; conversation_context visible in audit CLI                                                     | VERIFIED    | context-audit.ts SECTION_NAMES has 8 entries with "conversation_context" as 8th; buckets record extended; audit report will auto-include the row |

**Score:** 3/5 truths fully verified (Truths 3, 4, 5); 2/5 partially verified (Truths 1, 2 — code path correct but dormant at runtime)

---

### Required Artifacts

| Artifact | Provided | Status | Details |
|----------|----------|--------|---------|
| `src/memory/conversation-brief.ts` | assembleConversationBrief + budget accumulator + gap check + markdown renderer | VERIFIED | 212 lines, all 5 DEFAULT_* exports present, Object.freeze on returns, findByTag("session-summary") tag-only filter, Math.max(0,now-…) clock-skew clamp |
| `src/memory/conversation-brief.types.ts` | AssembleBriefInput / AssembleBriefDeps / AssembleBriefResult discriminated union | VERIFIED | All 4 exported types present; discriminated union on `skipped` boolean |
| `src/memory/__tests__/conversation-brief.test.ts` | 11 unit tests per 67-VALIDATION.md task IDs | VERIFIED | 11 it-blocks with exact plan-spec titles; gap-skip spy (findByTag call count === 0); in-memory SQLite fixtures |
| `src/memory/schema.ts` | conversationConfigSchema extended with 3 new knobs | VERIFIED | resumeSessionCount z.number().int().min(1).max(10).default(3); resumeGapThresholdHours z.number().min(0).default(4); conversationContextBudget z.number().int().min(500).default(2000) |
| `src/shared/types.ts` | ResolvedAgentConfig.memory.conversation? branch | VERIFIED | readonly conversation?: { enabled, turnRetentionDays, resumeSessionCount, resumeGapThresholdHours, conversationContextBudget } |
| `src/manager/context-assembler.ts` | SectionName union + SectionTokenCounts + ContextSources + mutableParts push | VERIFIED | "conversation_context" in SectionName; SectionTokenCounts.conversation_context: number; ContextSources.conversationContext?: string; mutableParts.push after resumeSum with if-guard; countTokens(conversationContext) in sectionTokens |
| `src/performance/context-audit.ts` | SECTION_NAMES extended to 8 entries | VERIFIED | "conversation_context" as 8th entry; buckets record extended with matching key |
| `src/manager/session-config.ts` | buildSessionConfig calls assembleConversationBrief; SessionConfigDeps extended | VERIFIED | Imports assembleConversationBrief + 3 DEFAULT_* constants; SessionConfigDeps has conversationStores?/memoryStores?/now?; 30-line wiring block after resume-summary load; graceful degradation when either store absent |
| `src/manager/session-manager.ts` | configDeps() passes conversationStores + memoryStores to buildSessionConfig | MISSING | configDeps() at line 693 returns 6 fields but omits conversationStores/memoryStores/now — this.memory.conversationStores and this.memory.memoryStores exist on AgentMemoryManager (lines 39, 30) but are not threaded through |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `conversation-brief.ts::assembleConversationBrief` | `MemoryStore.findByTag("session-summary")` | deps.memoryStore | VERIFIED | `findByTag("session-summary")` call at line 108; spy-confirmed in test 67-01-05 |
| `conversation-brief.ts::gap check` | `ConversationStore.listRecentSessions(agentName, 1)` | deps.conversationStore | VERIFIED | `listRecentSessions(agentName, 1)` at line 84; gap math branches on result |
| `session-config.ts::buildSessionConfig` | `conversation-brief.ts::assembleConversationBrief` | import + direct call | VERIFIED | Import at line 28; call at line 334 within `if (convStore && memStore)` guard |
| `context-assembler.ts mutableParts` | `result.mutableSuffix` | mutableParts.push(conversationContext) | VERIFIED | Push at line 749; confirmed NOT in stablePrefix (Pitfall 1 invariant) |
| `session-manager.ts::configDeps()` | `session-config.ts::SessionConfigDeps.conversationStores` | return object field | NOT_WIRED | configDeps() does not include conversationStores or memoryStores — this is the runtime gap |
| `schema.ts::conversationConfigSchema` | `shared/types.ts::ResolvedAgentConfig.memory.conversation` | Zod inference + optional() | VERIFIED | `conversation: conversationConfigSchema.optional()` in memoryConfigSchema; types.ts has readonly conversation? branch |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `context-assembler.ts` | `conversationContext` | `sources.conversationContext ?? ""` | Yes — when stores wired in tests, real session-summary content flows through | FLOWING (in test harness) / STATIC (in production — always "" because SessionManager does not wire stores) |
| `session-config.ts` | `conversationContextStr` | `assembleConversationBrief(…)` result | Yes — when both stores present | DISCONNECTED at runtime (deps.conversationStores?.get(name) returns undefined in every real agent start) |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| assembleConversationBrief exports present | `grep -c "export const DEFAULT_RESUME_SESSION_COUNT" src/memory/conversation-brief.ts` | 1 | PASS |
| SECTION_NAMES has 8 entries | `grep -c '"conversation_context"' src/performance/context-audit.ts` | 1 | PASS |
| SessionConfigDeps has conversationStores field | `grep -c "conversationStores" src/manager/session-config.ts` | 3 | PASS |
| configDeps() passes conversationStores | `grep -c "conversationStores" src/manager/session-manager.ts` (within configDeps body) | 0 in configDeps body — only in other methods | FAIL |
| mutableParts push site exists | `grep -c "mutableParts.push(conversationContext)" src/manager/context-assembler.ts` | 1 | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SESS-02 | 67-01, 67-02 | Auto-inject on resume — last N session summaries assembled and injected on agent resume | PARTIAL | Full pipeline built (helper + assembler wiring + session-config integration tests GREEN); blocked at SessionManager.configDeps() which does not pass the stores. Code path is correct and deterministic; one 3-line addition unblocks it. |
| SESS-03 | 67-01, 67-02 | Adaptive injection threshold — skip when gap < 4h (default, configurable) | PARTIAL | Gap-skip logic proven in 11 unit tests with deterministic now injection; schema knob (resumeGapThresholdHours) correctly defaults to 4; same SessionManager wiring gap prevents it from firing in production. |

Note: REQUIREMENTS.md traceability table marks SESS-02 and SESS-03 as `[ ]` (not done) at lines 70-71, consistent with this verification finding that the production path is not yet live.

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `src/manager/session-manager.ts::configDeps()` | Omitted optional fields (`conversationStores`, `memoryStores`) that are present on `this.memory` but not threaded — new behavior silently degrades to no-op | BLOCKER | Prevents SESS-02/SESS-03 from firing in production; every real agent start takes the graceful-degradation path regardless of session history or gap duration |

No stub anti-patterns found in Phase 67 files. No TODO/FIXME/placeholder comments in conversation-brief.ts or session-config.ts wiring block. The `return null` / `return {}` / `return []` patterns do not appear in the new code paths. The `if (conversationContext)` guard is correct, not a stub — empty string is the legitimate zero-history output.

---

### Human Verification Required

#### 1. End-to-End Discord Recall (SESS-02 + SESS-03 acceptance)

**Test:** Run 5-turn Discord conversation with a test agent. Stop daemon. Wait 4+ hours (or manually update `ended_at` in SQLite to simulate the gap). Restart daemon. Ask agent "what were we talking about earlier?" or reference something from the earlier session.
**Expected:** Agent references the prior topic naturally without the user repeating themselves. The `## Recent Sessions` section appears in the mutableSuffix block of the assembled prompt.
**Why human:** Requires live daemon, real Discord channel, Phase 66 session-end summarization writing a session-summary MemoryEntry, and the SessionManager wiring gap closed first (see Gaps section). Cannot be verified with code analysis alone.

#### 2. clawcode context-audit CLI Confirmation

**Test:** After a resume with a gap > 4h, run `clawcode context-audit <agent>` and inspect the output table.
**Expected:** `conversation_context` row appears in the audit table with `p50 > 0` tokens (proving the brief was included in at least one context assembly span).
**Why human:** Requires at least one live buildSessionConfig call that fires the brief path and emits a context_assemble span. No span will carry `section_tokens.conversation_context > 0` until SessionManager wiring is closed.

#### 3. Gap-Skip Confirmation on Short Restart

**Test:** Restart agent within 4 hours. Inspect the assembled prompt (e.g., via trace log or context-audit).
**Expected:** No `## Recent Sessions` heading appears in mutableSuffix. `clawcode context-audit` shows `conversation_context` token count of 0 for that session.
**Why human:** Requires live daemon and real timing. Unit tests cover this with injected `now` but the production path is not yet live.

---

## Gaps Summary

**One gap blocks SESS-02 and SESS-03 delivery at runtime:**

`SessionManager.configDeps()` at `src/manager/session-manager.ts:693` does not pass `conversationStores` or `memoryStores` to `buildSessionConfig`. As a result, `deps.conversationStores?.get(name)` returns `undefined` for every real agent start, causing the entire Phase 67 path to silently short-circuit via the graceful-degradation guard.

The fix is documented in the 67-02-SUMMARY.md hand-off notes and is a 2-line addition:

```typescript
// Inside configDeps() return object:
conversationStores: this.memory.conversationStores,
memoryStores: this.memory.memoryStores,
// now: omit — defaults to Date.now() in buildSessionConfig
```

Everything below the `configDeps()` seam is fully built and integration-tested:
- `assembleConversationBrief` pure helper with accumulate-budget and gap-skip (11 unit tests GREEN)
- Schema knobs (resumeSessionCount / resumeGapThresholdHours / conversationContextBudget) with Zod validation
- `SessionConfigDeps` extended and `buildSessionConfig` wired with graceful degradation
- `ContextSources.conversationContext` threaded into the mutable suffix (NOT the stable prefix)
- `SECTION_NAMES` extended to 8 entries for audit CLI visibility
- 5 integration tests GREEN covering mutable-suffix placement invariant and graceful degradation

**Classification:** This is a deferred wiring step, explicitly flagged by the Phase 67 executor as a known gap. It is NOT a regression or design flaw — the executor correctly scoped Plan 02 to the `buildSessionConfig` seam and documented the SessionManager step as a follow-up. The phase's test coverage is honest: tests wire the stores directly into `buildSessionConfig` (bypassing `configDeps()`), which correctly exercises the code path.

**Impact on success criteria:**
- SC-1 (brief injected on resume): NOT YET SATISFIED in production — code path correct, runtime path dormant
- SC-2 (gap-skip): NOT YET SATISFIED in production — same reason
- SC-3 (zero history graceful): SATISFIED — both in tests and in production (graceful-degradation produces no empty section)

---

_Verified: 2026-04-18T17:30:00Z_
_Verifier: Claude (gsd-verifier)_
