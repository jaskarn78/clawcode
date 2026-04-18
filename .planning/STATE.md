---
gsd_state_version: 1.0
milestone: v1.9
milestone_name: Persistent Conversation Memory
status: Ready to execute
stopped_at: Completed 67-01-PLAN.md
last_updated: "2026-04-18T16:37:45.823Z"
last_activity: 2026-04-18
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 9
  completed_plans: 8
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-18)

**Core value:** Persistent, intelligent AI agents that each maintain their own identity, memory, and workspace -- communicating naturally through Discord channels without manual orchestration overhead.
**Current focus:** Phase 67 — resume-auto-injection

## Current Position

Phase: 67 (resume-auto-injection) — EXECUTING
Plan: 2 of 2

## Performance Metrics

**Velocity:**

- Total plans completed: 63+ (v1.0-v1.8 across 9 milestones)
- Average duration: ~3.5 min
- Total execution time: ~3.7+ hours

**Recent Trend:**

- v1.8 plans: stable ~5-30min each
- Trend: Stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.9 Roadmap]: ConversationStore schema goes in existing memories.db (same WAL connection, no cross-db JOIN pain, follows migrateGraphLinks pattern)
- [v1.9 Roadmap]: Session summaries stored as standard MemoryEntries (source="conversation") -- zero new retrieval infrastructure, auto-participates in search/decay/tiers/graph
- [v1.9 Roadmap]: Raw turns do NOT get per-turn embeddings -- embed session summaries only; use FTS5 for raw turn text search (Phase 68)
- [v1.9 Roadmap]: Capture happens after Discord response posted (fire-and-forget) -- never blocks message delivery
- [v1.9 Roadmap]: Haiku for session-boundary summarization -- structured extraction prompt matters more than model size, 10x cheaper than sonnet
- [v1.9 Roadmap]: Auto-inject uses dedicated conversation_context budget (2000-3000 tokens) in mutable suffix -- does NOT share resume_summary budget
- [v1.9 Roadmap]: Instruction-pattern detection runs at capture time (Phase 65) before turns enter persistent store -- flags potential injection, does not block storage
- [v1.9 Roadmap]: Phase 65 (Capture Integration) carries SEC-02 because instruction detection is a capture-time concern, not a schema concern
- [v1.9 Roadmap]: Zero new npm dependencies -- entire milestone builds on existing stack (better-sqlite3, sqlite-vec, @huggingface/transformers, zod, etc.)
- [Phase 64]: sourceTurnIds propagated across all MemoryEntry consumers (7 source files + 5 test files) for type-safe conversation lineage tracking
- [Phase 64]: ConversationStore receives DatabaseType directly (not MemoryStore) -- follows DocumentStore pattern for domain stores that don't need MemoryStore.insert()
- [Phase 64]: Session state machine enforced via UPDATE WHERE status check + changes count validation (not read-then-write pattern)
- [Phase 65]: Instruction detector is zero-import pure function -- no dependencies, testable in isolation
- [Phase 65]: Detection result persisted as JSON string in instruction_flags TEXT column
- [Phase 65]: captureDiscordExchange wraps entire body in try/catch -- never blocks Discord message delivery
- [Phase 65]: Capture block uses nested try/catch in bridge success path so failures never block Discord delivery; ConversationStore crash runs BEFORE recovery.handleCrash to avoid restart race
- [Phase 66]: [Phase 66-01]: CreateMemoryInput.sourceTurnIds persists atomically in insert() single transaction — no follow-up UPDATE races (empty array normalized to NULL)
- [Phase 66]: [Phase 66-02]: SessionSummarizer pipeline NEVER throws — returns discriminated result union (success vs skipped-with-reason) so SessionManager failure mode is non-fatal; LLM failures fall back to raw-turn markdown tagged 'raw-fallback' while still marking the session summarized (idempotency over perfection)
- [Phase 66]: [Phase 66-02]: turns.length guard uses getTurnsForSession (actual rows), NOT session.turnCount — Pitfall 2 from 66-RESEARCH: fire-and-forget recordTurn writes from Phase 65 make turn_count eventually-consistent under load
- [Phase 66]: [Phase 66-02]: AbortController + Promise.race for LLM timeout (default 10s) — wraps injected summarize() so both cooperative-abort and hard-timeout paths work; finally-clearTimeout cleanup prevents dangling timers on fast-path success
- [Phase 66]: [Phase 66-03]: Lifecycle-specific summarize invocation policy — stopAgent awaits (bounded by internal 10s timeout), onError fires fire-and-forget. Same summarizeSessionIfPossible helper; caller decides policy. Prevents crash recovery delay while ensuring summaries complete on normal stops.
- [Phase 66]: [Phase 66-03]: summarizeWithHaiku wraps sdk.query with settingSources=[] so the summarizer runs config-free (no skills/MCP servers/workspace settings inherited). Prevents Pitfall 3 from 66-RESEARCH where summarizer accidentally runs with agent tools attached.
- [Phase 66]: [Phase 66-03]: summarizeFn is a test-only SessionManagerOptions field with production fallback to summarizeWithHaiku — keeps production coupling minimal while enabling integration tests to swap the LLM call without mocking SDK modules.
- [Phase 67]: [Phase 67-01]: Config placement Option A — extended conversationConfigSchema with resumeSessionCount/resumeGapThresholdHours/conversationContextBudget rather than splitting across memoryAssemblyBudgets. Respects v1.9 locked 'dedicated budget' decision.
- [Phase 67]: [Phase 67-01]: Accumulate budget strategy locked — helper adds whole summaries until next would overflow and drops the remainder. Never half-truncates mid-summary. Over-budget single-summary still accepted (better than silent empty-string return).
- [Phase 67]: [Phase 67-01]: Pure DI helper with injected 'now: number' — assembleConversationBrief never reads Date.now() so gap-skip tests are deterministic without vi.setSystemTime() or Date monkey-patching. Gap short-circuit happens BEFORE any MemoryStore.findByTag call (verified by spy).

### Roadmap Evolution

- 2026-04-18: Milestone v1.9 Persistent Conversation Memory started -- 12 requirements defined
- 2026-04-18: v1.9 roadmap created -- 5 phases (64-68), 12 requirements mapped 1:1

### Pending Todos

None yet.

### Blockers/Concerns

- Haiku empirical viability unknown for session-boundary summarization quality -- validate with real conversation samples in Phase 66
- Context assembly ceiling (default 8000 tokens from Phase 52) may be too low once conversation_context section is added -- verify with clawcode context-audit after Phase 67
- 12 of 15 v1.1 phases missing formal VERIFICATION.md artifacts (docs only) -- legacy carry-over

## Session Continuity

Last activity: 2026-04-18
Stopped at: Completed 67-01-PLAN.md
Resume file: None
