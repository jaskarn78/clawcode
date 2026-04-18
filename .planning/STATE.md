---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: v1.9 milestone complete
stopped_at: Completed quick task 260418-sux — list_schedules field fix + registry ghost-entry reconciliation
last_updated: "2026-04-18T21:02:59.314Z"
last_activity: 2026-04-18
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-18)

**Core value:** Persistent, intelligent AI agents that each maintain their own identity, memory, and workspace -- communicating naturally through Discord channels without manual orchestration overhead.
**Current focus:** Planning next milestone (v1.10 or v2.0)

## Current Position

Milestone: v1.9 shipped 2026-04-18
Next: run `/gsd:new-milestone` to scope the next version

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
- [Phase 67]: [Phase 67-02]: Atomic single-commit for Task 1 — extended SECTION_NAMES + SectionName + SectionTokenCounts + buckets + ContextSources + mutable-suffix push + sectionTokens construction together so tsc never goes red between intermediate steps (Pitfall 5 SECTION_NAMES blast radius).
- [Phase 67]: [Phase 67-02]: Brief placement LAST in mutable-suffix order (after resumeSum) — background context trails concrete resume recap so the model's reasoning sees the nearest-term signal first. CONTEXT.md locked this; tests assert positional ordering survives.
- [Phase 67]: [Phase 67-02]: Graceful-degradation via conjunction guard (convStore && memStore) — either absent → helper path skipped entirely, no throw. Tolerates legacy startup, test harnesses, and partial bootstrap. SessionManager wiring follow-up still required to actually populate conversationStores/memoryStores Maps in production.
- [Phase 67]: [Phase 67-03]: Closed runtime gap via two-line configDeps extension (conversationStores + memoryStores threaded from AgentMemoryManager). Phase 67 read-path now LIVE end-to-end — SESS-02/SESS-03 active in production.
- [Phase 67]: [Phase 67-03]: Forward-wrapping vi.mock pattern — vi.fn(actual.buildSessionConfig) via importOriginal keeps existing 23 session-manager tests on real impl while capturing deps for new assertion. Generalizable pattern for ESM mock-with-forwarding.
- [Phase 68]: [Phase 68-01]: External-content FTS5 (content='conversation_turns') + AI/AD/AU triggers + sqlite_master-gated backfill — zero writes to recordTurn path; triggers inside SQLite transaction boundary make cross-table sync bulletproof
- [Phase 68]: [Phase 68-01]: Phrase-quote escape strategy for FTS5 — escapeFtsQuery() wraps entire trimmed input and doubles embedded quotes; empty/whitespace returns double-quote pair which matches nothing safely (Pitfall 1 mitigation)
- [Phase 68]: [Phase 68-01]: BM25 sign inversion via 1/(1+|bm25|) in conversation-search.ts before combining with decay — keeps combinedScore positive [0,1] so memory and turn results sort consistently (Pitfall 3)
- [Phase 68]: [Phase 68-01]: MVP memory path uses case-insensitive substring match (listRecent(200) + filter) rather than SemanticSearch KNN — keeps helper-layer unit tests deterministic without embedder warmup; 68-02 can swap to KNN at the MCP/IPC wiring layer where embedder is already in scope
- [Phase 68]: [Phase 68-01]: scope='all' dedup prefers session-summary over raw-turn for same sessionId — distilled summary carries more signal per token than verbose turns; raw turns survive only when no matching summary exists (Pitfall 4)
- [Phase 68]: [Phase 68-02]: Extract IPC handler body to memory-lookup-handler.ts — single source of truth shared between daemon.ts production and integration tests eliminates the duplicated-reimplementation-drift risk; learned from 67-VERIFICATION configDeps gap
- [Phase 68]: [Phase 68-02]: Zod limit.max tightened 20→10 as a breaking schema change (MAX_RESULTS_PER_PAGE hard cap) — no in-tree caller exceeds limit=10; IPC layer still clamps as defense-in-depth for non-MCP callers
- [Phase 68]: [Phase 68-02]: Explicit scope='memories' && page=0 routes to legacy GraphSearch branch (preserves byte-for-byte pre-v1.9 response shape including linked_from); searchByScope engages only on scope='conversations'|'all' OR page>0
- [Phase 68]: [Phase 68-02]: Per-Turn cache key widened to {query, limit, scope, page} preventing cross-scope cache bleed — a first scope='memories' call no longer serves stale data to a later scope='all' request in the same Turn
- [Phase 68]: [Phase 68-03]: Closed RETR-03 warning gap — retrievalHalfLifeDays threaded from ResolvedAgentConfig.memory.conversation through daemon IPC case → invokeMemoryLookup → searchByScope.halfLifeDays. 4-file surgical diff, no refactor. TDD regression test pinned importance=1.0 to bypass MemoryStore.insert calculateImportance fallback (store.ts:148) and keep decay-delta math above floating-point noise.
- [Phase 68.1]: [Phase 68.1-01]: Thread isTrustedChannel from DiscordBridge through CaptureInput into both recordTurn calls — capture call site passes isTrustedChannel: true (trusted-by-construction, ACL gate at checkChannelAccess line 441 already early-returns untrusted). CONV-01/SEC-01/RETR-02 now honest end-to-end.
- [Phase 68.1]: [Phase 68.1-01]: Integration test uses real MemoryStore(':memory:') + ConversationStore — exercises the conversation_turns_fts virtual table AI/AD/AU triggers end-to-end (no mocking). Negative test pins SEC-01 default trust filter (untrusted excluded unless includeUntrustedChannels: true) as a regression.
- [Phase quick/260418-sux]: reconcileRegistry routes empty-parent names (e.g. '-sub-foo') to orphaned-subagent/orphaned-thread via explicit parent.length>0 guard; returns input by reference when pruned.length===0 so clean boots skip writeRegistry entirely

### Roadmap Evolution

- 2026-04-18: Milestone v1.9 Persistent Conversation Memory started -- 12 requirements defined
- 2026-04-18: v1.9 roadmap created -- 5 phases (64-68), 12 requirements mapped 1:1
- 2026-04-18: Phase 68.1 inserted after Phase 68: Close isTrustedChannel provenance wiring gap (URGENT — surfaced by v1.9 milestone audit; blocks CONV-01/SEC-01/RETR-02 in production)

### Pending Todos

None yet.

### Blockers/Concerns

- Haiku empirical viability unknown for session-boundary summarization quality -- validate with real conversation samples in Phase 66
- Context assembly ceiling (default 8000 tokens from Phase 52) may be too low once conversation_context section is added -- verify with clawcode context-audit after Phase 67
- 12 of 15 v1.1 phases missing formal VERIFICATION.md artifacts (docs only) -- legacy carry-over

## Session Continuity

Last activity: 2026-04-18
Stopped at: Completed quick task 260418-sux — list_schedules field fix + registry ghost-entry reconciliation
Resume file: None
