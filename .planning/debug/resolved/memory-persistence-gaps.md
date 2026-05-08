---
status: resolved
trigger: "memory-persistence-gaps — four distinct memory persistence gaps on branch fix/memory-persistence"
created: 2026-04-20T00:00:00Z
updated: 2026-04-21T00:00:00Z
---

## Current Focus

hypothesis: All four gaps fixed with atomic commits. Typecheck clean for all touched files. Full suite pre-existing failures unchanged (16 failures in daemon-openai / bootstrap-integration / migration suites — none in files I modified).
test: Tests added + passing for each gap; full suite delta vs master branch = 0 new failures.
expecting: User end-to-end verification that the four reproduction cases documented in Symptoms now behave as expected in a real running daemon.
next_action: User verification — start daemon, reproduce Gap 1/2/3/4 scenarios, confirm fix behavior.

## Symptoms

expected:
1. Dashboard restart runs `manager.drain(15_000)` and writes session summary before exit.
2. Raw conversation turns deleted after successful summarization.
3. Periodic (default 15 min) in-session summary save timer exists, non-blocking.
4. `memory_lookup` default scope returns conversation history when default scope is empty, OR default is already `all`.

actual:
1. Dashboard restart never writes summary — suspect SIGKILL / missing handler / timeout.
2. Raw turns accumulate forever; no pruning.
3. No mid-session flush timer exists.
4. Default scope is not `all`; no automatic retry; no SOUL.md convention.

errors: None — silent data-loss / DB-growth / UX gaps.

reproduction:
- Gap 1: Start daemon, start session, add turns, restart via dashboard, inspect DB — no summary row.
- Gap 2: Complete session, wait for summarization, query raw-turn table — rows still present.
- Gap 3: Long session, `kill -9`, restart — no mid-session summary.
- Gap 4: `memory_lookup` with query matching only conversation history, empty with default; succeeds with explicit scope=all.

started: Branch created for this work. Previous quick fix 260419-q2z added drain but did not cover dashboard-restart.

## Eliminated

(none yet)

## Evidence

- timestamp: 2026-04-20
  checked: src/dashboard/server.ts:353-377
  found: Dashboard restart action goes through HTTP POST → `sendIpcRequest(socketPath, "restart", { name: agentName })`. No SIGKILL; no SIGTERM to the daemon. The daemon itself keeps running — only the agent process is restarted.
  implication: Stated Gap 1 cause ("dashboard sends SIGKILL") is WRONG. Dashboard talks to daemon via IPC, not signals.

- timestamp: 2026-04-20
  checked: src/manager/daemon.ts:1588-1608 (IPC "restart" case)
  found: IPC restart routes to `manager.restartAgent(name, config)`; falls back to `startAgent` only if stopAgent throws "not running".
  implication: The graceful path IS invoked for dashboard restart. Suspicion (2) "restart path never calls graceful shutdown" is also wrong.

- timestamp: 2026-04-20
  checked: src/manager/session-manager.ts:697-704 (restartAgent)
  found: `async restartAgent { await this.stopAgent(name); ... await this.startAgent(name, config); }`. stopAgent IS awaited before startAgent.
  implication: No parallel-execution bug; stopAgent fully completes.

- timestamp: 2026-04-20
  checked: src/manager/session-manager.ts:566-588 (stopAgent)
  found: `stopAgent` reads `convSessionId = activeConversationSessionIds.get(name)`, and if present calls `await trackSummary(summarizeSessionIfPossible(name, convSessionId))`. The summarize call is AWAITED synchronously before cleanupMemory + handle.close.
  implication: When the Map has an entry, summary IS written. Suspicion (3) "drain times out" is not applicable — we're not even in drain path for agent restart.

- timestamp: 2026-04-20
  checked: src/manager/session-manager.ts:296-305 (startAgent) vs 733-793 (reconcileRegistry)
  found: Only `startAgent` calls `convStore.startSession(name)` + `activeConversationSessionIds.set(name, convSession.id)`. `reconcileRegistry` (which resumes sessions left "running" after an unclean daemon shutdown) does NEITHER. It calls `adapter.resumeSession` then `this.sessions.set(...)` only.
  implication: REAL BUG FOUND — after daemon reboot that resumes a prior-running session, the activeConversationSessionIds Map is empty. Any subsequent stopAgent (including dashboard restart) will skip the summarize branch entirely because `convSessionId === undefined`. User-observed symptom is real but only manifests for agents whose sessions were RESUMED (not freshly started).

- timestamp: 2026-04-20
  checked: src/manager/daemon.ts:897 + 1529-1536
  found: daemon boot order is: reconcileRegistry (line 897) → signal handler registration (1518) → startAll (1531). startAll calls startAgent, which has precondition `if (this.sessions.has(name)) throw SessionError('already running')` at session-manager.ts:238. So after reconcile resumes an agent, startAll's subsequent startAgent for that same name throws and is caught, never running the startSession() call path.
  implication: Confirms: post-daemon-reboot, resumed agents have NO conversation session tracked, so stopAgent summarization is a no-op for them.

- timestamp: 2026-04-20
  checked: src/manager/__tests__/session-manager.test.ts:651-702 + 704-728
  found: Existing tests prove stopAgent DOES trigger summary when activeConversationSessionIds is populated (fresh start path). No test covers reconcileRegistry → stopAgent (the post-daemon-reboot path).
  implication: The fix needs to restore activeConversationSessionIds during reconcileRegistry OR start a fresh conversation session for resumed agents. Either way, the `convStore.startSession(name)` is missing from reconcileRegistry.

- timestamp: 2026-04-20
  checked: src/memory/session-summarizer.ts (entire file) + session-manager.ts
  found: summarizeSession at step 13 (markSummarized) + insert memory row. Zero calls to delete raw turns after successful summarization. Confirmed Gap 2.
  implication: Need to add raw-turn pruning after markSummarized succeeds.

- timestamp: 2026-04-20
  checked: src/manager (entire subtree) + src/memory (entire subtree)
  found: No setInterval / setTimeout / croner-based periodic summarization timer anywhere. Confirmed Gap 3.
  implication: Need to implement periodic in-session flush timer.

- timestamp: 2026-04-20
  checked: src/manager/memory-lookup-handler.ts:118 + src/mcp/server.ts:440
  found: `const scope = params.scope ?? "memories";` (IPC handler) and `.default("memories")` (MCP tool schema). No automatic retry/fallback to scope=all on empty default result. SOUL.md template has zero mention of memory_lookup or scope=all convention. Confirmed Gap 4.
  implication: Need user decision on fix approach (change default vs add fallback vs SOUL doc).

## Resolution

root_cause:
- Gap 1: `reconcileRegistry` never called `initMemory` or `startSession` on resumed agents, leaving `activeConversationSessionIds` empty. Any subsequent `stopAgent` skipped summarization because `convSessionId === undefined`. Additionally, `startAll` fired `startAgent` for every config after reconcile and swallowed the resulting "already running" SessionError with an error-level log on every boot.
- Gap 2: `summarizeSession` wrote the memory row and marked the session summarized, but never deleted the raw conversation_turns rows. Raw turns accumulated forever alongside summaries, so `memories.db` grew unbounded as sessions piled up.
- Gap 3: No periodic flush mechanism existed. Sessions only persisted summaries at clean shutdown boundaries (stopAgent/crash via onError). An unclean daemon exit between summaries (kill -9, OOM, power) lost everything recorded since the last boundary event.
- Gap 4: `invokeMemoryLookup` defaulted scope to `"memories"` and never retried with a wider scope. Conversation history (session summaries + raw turns) was inaccessible to agents that called memory_lookup without manually setting `scope`. SOUL.md template had no mention of the tool or its scope semantics.

fix:
- Gap 1: Extracted `attachCrashHandler(name, config, handle)` helper on SessionManager. `reconcileRegistry` now calls `initMemory` + `convStore.startSession` + sets `activeConversationSessionIds` + attaches the shared crash handler. `startAll` early-returns for agents already in `this.sessions`. Three new tests cover reconcile→memory-init, reconcile→stopAgent→summary-written, and reconcile→startAll→no-op.
- Gap 2: Added `ConversationStore.deleteTurnsForSession(sessionId): number` (prepared statement, returns rows deleted). `summarizeSession` calls it as Step 13b, only after `markSummarized` succeeded — so partial failures (insert OK, markSummarized failed) leave turns intact for operator reconcile. Delete is non-fatal; session row stays intact so resume-brief gap accounting keeps working. FTS5 stays in sync via existing `conversation_turns_ad` trigger.
- Gap 3: Added `flushSessionMidway` in src/memory/session-summarizer.ts — non-terminating variant of summarizeSession. Writes MemoryEntry tagged ["mid-session", `session:{id}`, `flush:{N}`], does NOT mark session summarized, does NOT delete turns. SessionManager owns per-agent `flushTimers` (setInterval, unref'd) + `flushSequenceByAgent` counter; `startFlushTimer(name, config)` called from startAgent and reconcileRegistry after warm-path-ready, `stopFlushTimer(name)` called from stopAgent and the crash handler. Config knob `conversation.flushIntervalMinutes` (z.number().int().min(0).default(15)); 0 disables. Test-only `flushIntervalMsOverride` on SessionManagerOptions keeps integration tests fast.
- Gap 4: `invokeMemoryLookup` now tracks `scopeIsExplicit = params.scope !== undefined`. When the legacy default-scope search (scope='memories', page=0) returns zero rows AND scope was not explicitly set by the caller, the handler falls through to the new-path scope='all' branch. Response shape flips to the paginated envelope only on the fallback path — explicit callers (scope='memories') always get the legacy shape. `DEFAULT_SOUL` + `src/templates/SOUL.md` updated with a "Memory Lookup" section describing the auto-widening default.

verification:
- Gap 1: 3/3 new tests pass; 34/34 session-manager tests pass; 60/60 daemon + registry tests pass.
- Gap 2: 4/4 new ConversationStore unit tests pass; 5/5 new summarizer integration tests pass (LLM path, short-session path, raw-turn fallback, insert-failure no-delete, embed-failure no-delete); 424/424 tests across src/manager + src/memory pass.
- Gap 3: 5/5 new schema tests pass; 7/7 new flushSessionMidway unit tests pass; 5/5 new SessionManager periodic-flush integration tests pass (basic flush:1 write, flush:1→flush:2 incrementing, disabled when interval=0, stopAgent clears timer, counter reset on restart); 270/270 tests across the affected files pass.
- Gap 4: 5/5 new invokeMemoryLookup fallback tests pass (fallback on empty default, no fallback on non-empty default, no fallback on explicit scope='memories', no fallback on page > 0, fallback when everything is empty returns paginated envelope with zero results); 1/1 new DEFAULT_SOUL convention regression test passes; 44/44 tests across workspace + bootstrap + memory-lookup files pass.

files_changed:
- src/manager/session-manager.ts (Gap 1 + Gap 3)
- src/manager/__tests__/session-manager.test.ts (Gap 1 + Gap 3)
- src/memory/conversation-store.ts (Gap 2)
- src/memory/__tests__/conversation-store.test.ts (Gap 2)
- src/memory/session-summarizer.ts (Gap 2 + Gap 3)
- src/memory/session-summarizer.types.ts (Gap 3)
- src/memory/__tests__/session-summarizer.test.ts (Gap 2 + Gap 3)
- src/memory/schema.ts (Gap 3)
- src/config/__tests__/schema.test.ts (Gap 3)
- src/manager/memory-lookup-handler.ts (Gap 4)
- src/manager/__tests__/daemon-memory-lookup.test.ts (Gap 4)
- src/templates/SOUL.md (Gap 4)
- src/config/defaults.ts (Gap 4)
- src/agent/__tests__/workspace.test.ts (Gap 4)
- src/shared/types.ts (follow-up sync for Gap 3 — hand-written ResolvedAgentConfig.memory.conversation gets flushIntervalMinutes)

commits:
- 4af0595 fix(memory): populate conversation session on reconcile resume
- 83f91a7 fix(memory): prune raw turns after session summarization
- 5a0dba1 fix(memory): periodic in-session summary flush
- 49a39b9 fix(memory): memory_lookup default scope includes conversations
- f863af3 fix(memory): add flushIntervalMinutes to ResolvedAgentConfig type

## Verified resolved (2026-05-07)

Triaged during /gsd-progress --forensic. Fix code confirmed present on master:
- Original SHAs (4af0595, 83f91a7, 5a0dba1, 49a39b9, f863af3) not found — branch was rebased before merge
- Replacement SHAs with identical commit subjects: 5f9c5d0 (Gap 1), 4022e94 (Gap 2), 1317ff6 (Gap 3), d143cf4 (Gap 4), c9f1a31 (type follow-up); plus a second batch (b36011a, 840159f, c42a37b, 5595d70, 7805171) — likely the master merge after a force-push rebase
- Code markers verified on master:
  - Gap 1: `attachCrashHandler` + `reconcileRegistry` (src/manager/session-manager.ts:947, :1890)
  - Gap 2: `deleteTurnsForSession` (src/memory/conversation-store.ts:112, :476, :722; called at session-summarizer.ts:375)
  - Gap 3: `flushSessionMidway` (src/memory/session-summarizer.ts:451) + `flushIntervalMinutes` (src/memory/schema.ts:99)
  - Gap 4: `scopeIsExplicit` (src/manager/memory-lookup-handler.ts:122, :151)
