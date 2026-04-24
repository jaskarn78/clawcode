---
status: awaiting_human_verify
trigger: "Investigate why ClawCode agents don't remember conversations from prior sessions. The v1.9 milestone shipped session-boundary summarization + resume auto-injection; in production on clawdy, appears broken."
created: 2026-04-19T13:00:00Z
updated: 2026-04-19T14:05:00Z
---

## Current Focus

hypothesis: (CONFIRMED) SessionManager.startAgent calls convStore.startSession(name) at line 237 BEFORE buildSessionConfig at line 252. assembleConversationBrief then calls listRecentSessions(agent, 1), which returns the brand-new ACTIVE session (ORDER BY started_at DESC). That session has endedAt=null and startedAt=now, so the gap check (gapMs = now - (endedAt ?? startedAt)) is ~0ms. With default gapThresholdHours=4h, every fresh startup evaluates gapMs < thresholdMs → returns { skipped: true, reason: "gap" }. Conversation context is NEVER injected. Agents "forget" because the brief is always gap-skipped.
test: empirical query against prod DB on clawdy + trace of session-manager.ts:237-252 + conversation-brief.ts:84-102
expecting: prod DB shows ACTIVE session with startedAt = most-recent timestamp (confirming the gap-skip fires on every startup)
next_action: design fix — filter active session out of gap check, or thread currentSessionId through buildSessionConfig

## Symptoms

expected:
  - At session end/crash: Haiku-generated summary persisted as MemoryEntry; session row's summarized_at FK set.
  - At new session: system prompt contains conversation_context budget section with brief of N most recent prior sessions.
  - User-facing: new session recalls prior conversation content.

actual:
  - Agents act like each new session is fresh — no recall.
  - Log lines 2026-04-19 12:42:39 UTC on clawdy (admin-clawdy, session Mk4GFrRVSZ6uxLm5yAQ5B):
    - summarize timeout after 10000ms -> raw-turn fallback
    - markSummarized failed after insert — memory row present but session FK not set — 'Cannot mark session ... as summarized: not found or not in ended/crashed status'

errors:
  - summarize timeout after 10000ms
  - Cannot mark session '<id>' as summarized: not found or not in 'ended'/'crashed' status

reproduction:
  - Two-call OpenAI endpoint repro (separate bearer keys, cross-session recall) OR Discord restart.

started: v1.9 shipped 2026-04-18 — bug has been present since 67-02 wiring landed (never worked end-to-end).

## Eliminated

- hypothesis: markSummarized FK not being set is the root cause of no recall
  evidence: conversation-brief.ts:108 uses memoryStore.findByTag("session-summary") which does NOT join conversation_sessions at all. FK state is irrelevant to retrieval. Prod DB shows 4 summary memories exist AND 3 sessions are in 'summarized' status with FK set — summaries exist and are retrievable, yet agents still forget.
  timestamp: 2026-04-19T13:40:00Z

- hypothesis: summarize timeout (10s) means most summaries fail
  evidence: Prod DB shows 3 sessions with status=summarized and only one timeout in logs. Summarize pipeline has a raw-turn fallback that still inserts a MemoryEntry even on timeout. Timeouts ARE happening but aren't causing empty summaries. This is a secondary issue for quality, not the recall blocker.
  timestamp: 2026-04-19T13:40:00Z

## Evidence

- timestamp: 2026-04-19T13:00:00Z
  checked: .planning/phases/ and git log for v1.9
  found: Phases 64-68+68.1 archived to .planning/milestones/v1.9-phases/ (commit ea4f15a).
  implication: Docs exist under milestones dir.

- timestamp: 2026-04-19T13:15:00Z
  checked: src/manager/session-manager.ts lines 220-260
  found: startAgent ordering: (1) memory.initMemory; (2) convStore.startSession(name) at L237 creates new ACTIVE row with startedAt=now and activeConversationSessionIds.set; (3) storeSoulMemory; (4) buildSessionConfig(config, this.configDeps(name), ...) at L252.
  implication: By the time buildSessionConfig runs, there is ALREADY a fresh active session row for this agent, and it has the most-recent startedAt in the database.

- timestamp: 2026-04-19T13:22:00Z
  checked: src/memory/conversation-brief.ts lines 74-102 (assembleConversationBrief gap-check)
  found: The helper calls conversationStore.listRecentSessions(agentName, 1). conversation-store.ts:256-258 SQL is 'ORDER BY started_at DESC, rowid DESC LIMIT ?' with NO status filter. So it returns the just-created active session with endedAt=null. Gap math: lastTsIso = last.endedAt ?? last.startedAt → startedAt (just-now). gapMs = Math.max(0, now - startedAt) → ~0ms. if (gapMs < thresholdMs) returns { skipped: true, reason: "gap" } → brief is empty for the entire session.
  implication: Every fresh daemon start → every session begins with an empty conversation_context. Agents cannot recall anything from prior sessions, regardless of how perfect Phase 66 summarization is.

- timestamp: 2026-04-19T13:25:00Z
  checked: src/manager/session-config.ts lines 330-356 (conversation brief wiring)
  found: buildSessionConfig has no knowledge of the current session id. It does not pass any "exclude this session id" hint to assembleConversationBrief. Only convStore + memStore + agentName + now + config.
  implication: Fix must either (a) pass currentSessionId into the brief helper, or (b) have the brief filter out active sessions internally, or (c) query listRecentSessions with a status filter (e.g., only ended/crashed/summarized).

- timestamp: 2026-04-19T13:30:00Z
  checked: src/memory/__tests__/conversation-brief.test.ts
  found: All 11 tests manually backdate session rows via raw UPDATE SQL (seedEndedSession, seedActiveSession). No test exercises the production ordering where startSession runs immediately before assembleConversationBrief. The "falls back to startedAt for active session" test backdates startedAt 5h ago — a crash-recovery scenario, NOT clean startup.
  implication: Tests miss production reality. Need a new integration-style test that calls startSession() then assembleConversationBrief() in the same flow to guard the regression.

- timestamp: 2026-04-19T13:30:00Z
  checked: .planning/milestones/v1.9-phases/67-resume-auto-injection/67-RESEARCH.md
  found: Lines 651-655 explicitly pose this exact open question ("Should the gap check fire when the previous session is status='active'?") and recommend "use session.startedAt as the fallback timestamp." The recommendation assumes 'active session at startup' means 'previous daemon died without a crash handler' — it did NOT contemplate that SessionManager itself creates an active session BEFORE buildSessionConfig runs. The clean-startup path was blind-spotted.
  implication: This is a design gap in Phase 67 RESEARCH carried through into Plan 01 + Plan 02. Not a pure coding mistake — a missed production invariant.

- timestamp: 2026-04-19T13:40:00Z
  checked: empirical query against /home/clawcode/.clawcode/agents/admin-clawdy/memory/memories.db on clawdy (via ssh + better-sqlite3)
  found: Session counts by status: active=2, ended=1, summarized=3. session-summary MemoryEntry count=4. Most recent session (lH1xppSjiFtdt6fVTyrz8, active, started 13:41:46Z) has endedAt=null. Three summarized sessions have fk_set=1 (FK correctly populated for the happy path). One orphan active (pDmv25u6tugaHoguvbtKw, 0 turns) from a prior crash that never cleaned up. One ended (Z1MiBUfIGgnCii_1c58Xv, 2 turns, fk_set=0) → correctly skipped by min-turns guard.
  implication: CONFIRMED. Summaries exist in the retrieval path. The only reason they don't appear in the agent's context is the gap-skip against the always-fresh active session.

- timestamp: 2026-04-19T13:42:00Z
  checked: src/manager/session-manager.ts crash + stop paths (lines 290-315, 478-506)
  found: Crash path calls crashSession(id) THEN fires summarizeSessionIfPossible (fire-and-forget). Stop path calls endSession(id) THEN awaits summarizeSessionIfPossible. If crash + stop race, both callers may read session.status=ended/crashed (step 2 allows), proceed, first wins markSummarized (status -> summarized), second reads session.status in step 2 before first commits, finds it non-summarized, runs to the end, tries markSummarized, SQL update where status IN ('ended','crashed') fails (status is 'summarized' now) → error logged. This is a secondary race-condition logging-noise bug — memory row still exists, FK is set by the winning path. Non-fatal; unrelated to recall.
  implication: The markSummarized warn logs are real but they are not the cause of no recall. Fix is optional cleanup (idempotent markSummarized) — can be deferred.

## Resolution

root_cause: |
  Two independent bugs. Only #1 explains the "agents forget" symptom:

  1. (PRIMARY — explains missing recall)
     In src/manager/session-manager.ts::startAgent, ConversationStore.startSession is called at line 237 BEFORE buildSessionConfig is called at line 252. buildSessionConfig invokes assembleConversationBrief, which calls listRecentSessions(agent, 1) and gets the brand-new active session row (ORDER BY started_at DESC — no status filter). The session's endedAt is null, so gap math falls back to startedAt = now → gapMs ~= 0 < 4h threshold → brief returns { skipped: true, reason: "gap" } on EVERY clean startup. conversation_context is always empty. Agents cannot recall anything from prior sessions.

  2. (SECONDARY — log noise, not a recall blocker)
     In src/memory/conversation-store.ts::markSummarized, a race between the crash-path fire-and-forget summarize and the stop-path awaited summarize can have both callers pass the idempotency check (step 2 reads session.status=ended|crashed before either writes) and both run to insert+markSummarized. The loser emits "markSummarized failed: not found or not in 'ended'/'crashed' status" because status is now 'summarized'. Memory row is still present, FK is set by the winner — but the noisy warn is misleading.

fix: |
  Primary fix (P1 — restores recall):
    Filter out the currently-active session from the gap-check in assembleConversationBrief. Query listRecentSessions with an "exclude status='active'" (or more precisely: consider only rows with status IN ('ended','crashed','summarized')) so the gap is measured against the MOST RECENT TERMINATED session — which is the actual prior-session endpoint from the user's perspective.

    Rationale: SESS-03 contract is "skip inject when the previous session ended less than N hours ago." The previous session is by definition terminated. An active row is EITHER (a) the current session we just spun up (clean path — ignore it), or (b) an orphan from a hard crash (rare — operator can inspect; treating it as non-terminated is correct because we don't know when it truly ended). In case (b), falling through to "no prior terminated session" and injecting is MORE correct than current behavior (gap-skip everything forever).

    Implementation: add a ConversationStore.listRecentTerminatedSessions(agent, limit) method (or a status filter param to listRecentSessions) that returns sessions with status IN ('ended','crashed','summarized'). Use it from assembleConversationBrief. Preserves all existing test invariants (those tests all seed ended sessions — they remain valid). Add a NEW regression test: call convStore.startSession then immediately assembleConversationBrief and assert brief is rendered (not gap-skipped) when a prior terminated session exists.

  Secondary fix (P2 — log-noise cleanup, optional):
    Make markSummarized idempotent: if session.status='summarized' AND summary_memory_id matches OR the request is a no-op update, treat as success. Alternatively: expand the WHERE clause to "status IN ('ended','crashed','summarized')" so repeated calls from races don't emit the misleading error. Either approach removes the log warn without changing data integrity (the winning path already persisted the row).

  Deferred (observability only):
    Reaper for orphan active rows (like pDmv25u6tugaHoguvbtKw) — transition to 'crashed' at daemon boot for any active row from an agent that isn't currently owned by the starting session. Out of scope for this debug — separate quick task.

verification: |
  - npx vitest run src/memory/__tests__/conversation-brief.test.ts src/memory/__tests__/conversation-store.test.ts src/memory/__tests__/session-summarizer.test.ts → 95/95 passed (+8 new regression tests)
  - npx vitest run src/memory/ src/manager/__tests__/session-config.test.ts src/manager/__tests__/session-manager.test.ts → 437/437 passed
  - npx tsc --noEmit on touched files → 0 errors
  - New regression test: "ignores the current active session when measuring gap — terminated-only" directly exercises the production ordering bug (seedEndedSession 5h ago + seedActiveSession 1s ago → brief MUST render). Would FAIL against the unfixed code.
  - New regression test: "markSummarized is idempotent when called twice on the same session" exercises the crash/stop race — both callers return the winner's summaryMemoryId without throwing.
  - Still pending (human-verify): deploy to clawdy + reproduce the original repro (send-and-remember across session boundary) to confirm end-to-end recall.

files_changed:
  - src/memory/conversation-store.ts   (add listRecentTerminatedSessions; make markSummarized idempotent on 'summarized' status)
  - src/memory/conversation-brief.ts    (switch gap-check from listRecentSessions to listRecentTerminatedSessions; updated JSDoc)
  - src/memory/__tests__/conversation-store.test.ts  (+5 tests: 4 for listRecentTerminatedSessions, 1 for markSummarized idempotency)
  - src/memory/__tests__/conversation-brief.test.ts  (+3 regression tests under "regression: agents-forget-across-sessions (production ordering)")
