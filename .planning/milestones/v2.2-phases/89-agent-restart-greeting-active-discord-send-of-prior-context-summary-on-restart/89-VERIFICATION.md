---
phase: 89-agent-restart-greeting-active-discord-send-of-prior-context-summary-on-restart
verified: 2026-04-23T22:52:00Z
status: human_needed
score: 10/10 must-haves verified
human_verification:
  - test: "Run /clawcode-restart <agent> on an active agent via the daemon IPC and observe the Discord greeting in the bound channel"
    expected: "A webhook-attributed embed appears in the agent's Discord channel within ~15 seconds, authored with the agent's avatar + display name, containing a fresh first-person summary of the prior session under 500 characters, with a blurple ('Back online') or amber ('Recovered after unexpected shutdown') color depending on restart classification"
    why_human: "End-to-end flow requires a live daemon, a live Discord connection, a real WebhookManager-provisioned agent, and a real Haiku API call — no single automated check covers the full delivery chain"
  - test: "Restart an agent that has been idle for more than 7 days and confirm no Discord message is sent"
    expected: "No message appears in the Discord channel; daemon logs show skipped-dormant outcome"
    why_human: "Dormancy check depends on real ConversationStore data and live daemon; cannot simulate production endedAt timestamps in unit tests"
---

# Phase 89: Agent Restart Greeting Verification Report

**Phase Goal:** When an agent is explicitly restarted via `SessionManager.restartAgent()`, the daemon proactively sends a Discord message to the agent's bound channel containing a Haiku-summarized recap of the prior session — so the human sees the agent come back online with a quick "here's where we left off" signal, distinct from silent boot-reconcile (`startAll()`) and first-ever start.

**Verified:** 2026-04-23T22:52:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | `restartAgent()` emits greeting; `startAgent()` / `startAll()` / `performRestart()` / IPC fallback silent | VERIFIED | Integration tests I1 (restart emits), I2 (startAgent=0), I3 (startAll=0), I4 (crash-restart=0), I8 (IPC fallback=0) all pass; `void sendRestartGreeting` is inside `restartAgent()` body only, post-`startAgent()` |
| 2 | Fresh Haiku summarization <500 chars, prior-session summary only | VERIFIED | `buildRestartGreetingPrompt` + `truncateDesc` (slice to 499 + U+2026); test P15 asserts length===500; unit test P19 asserts no truncation at 200 chars; 29/29 tests pass |
| 3 | Forks/threads/empty-state/dormancy skipped silently | VERIFIED | `isForkAgent` + `isSubagentThread` predicates; `skipped-dormant` / `skipped-empty-state` branches in `sendRestartGreeting`; tests P4/P5/P8/P9/P10/P11/P12 pass |
| 4 | Per-agent cool-down (5min default, configurable) suppresses crash-loop greetings | VERIFIED | `greetCoolDownByAgent` Map on SessionManager; `stopAgent` deletes entry; cool-down gate in helper; tests P13/P14 (unit) + I6/I7-alt (integration) pass |
| 5 | Additive-optional schema, v2.1 fleet parses unchanged, reloadable | VERIFIED | `greetOnRestart: z.boolean().optional()` (agentSchema) + `.default(true)` (defaultsSchema); `greetCoolDownMs` same pattern; 4 RELOADABLE_FIELDS entries; loader resolver `agent.X ?? defaults.X`; 5 loader regression tests pass including "v2.1 fleet parses unchanged" |
| 6 | Delivery failure logs + restart completes (non-blocking) | VERIFIED | `void sendRestartGreeting(...).catch((err) => this.log.warn({ agent, error }, "[greeting] sendRestartGreeting threw (non-fatal)"))` at session-manager.ts:998-1017; integration test I5 pins that `restartAgent` resolves normally when `sendAsAgent` rejects with "boom"; I5b covers outer `.catch` log-and-swallow path |
| 7 | Crash-recovery vs clean-restart differentiated embeds | VERIFIED | `classifyRestart(prevConsecutiveFailures > 0)` captured before registry bump; `buildCleanRestartEmbed` (0x5865F2 blurple) + `buildCrashRecoveryEmbed` (0xFFCC00 amber); tests P1/P2/P16 + buildCleanRestartEmbed/buildCrashRecoveryEmbed unit tests pass |

**Score:** 10/10 truths verified (all automated checks pass; human UAT covers the live delivery chain)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/manager/restart-greeting.ts` | Pure helper: sendRestartGreeting, classifyRestart, buildRestartGreetingPrompt, buildCleanRestartEmbed, buildCrashRecoveryEmbed, isForkAgent, isSubagentThread + types | VERIFIED | 381 lines; all 7 functions + 8 types + 6 constants exported; 29/29 unit tests pass |
| `src/manager/__tests__/restart-greeting.test.ts` | Unit tests for all skip paths + happy paths + truncation + cool-down + template selection | VERIFIED | 525 lines, 29 tests |
| `src/config/schema.ts` | greetOnRestart + greetCoolDownMs additive fields in agentSchema + defaultsSchema | VERIFIED | Lines 699-702 (agentSchema optional), lines 769-772 (defaultsSchema with defaults) |
| `src/config/types.ts` | RELOADABLE_FIELDS entries for all 4 paths | VERIFIED | Lines 65-71: `agents.*.greetOnRestart`, `defaults.greetOnRestart`, `agents.*.greetCoolDownMs`, `defaults.greetCoolDownMs` |
| `src/config/loader.ts` | Resolver: `agent.greetOnRestart ?? defaults.greetOnRestart`; same for greetCoolDownMs | VERIFIED | Lines 301-302 |
| `src/shared/types.ts` | `ResolvedAgentConfig.greetOnRestart: boolean` + `greetCoolDownMs: number` (non-optional) | VERIFIED | Lines 35 + 39; no `?` on either field |
| `src/manager/session-manager.ts` | greetCoolDownByAgent Map + setWebhookManager DI + void greeting call in restartAgent + stopAgent cleanup | VERIFIED | Line 206 (Map), 284 (setter), 887 (stopAgent delete), 998-1017 (fire-and-forget greeting in restartAgent) |
| `src/manager/daemon.ts` | manager.setWebhookManager(webhookManager) after construction | VERIFIED | Line 1848 |
| `src/manager/__tests__/session-manager.test.ts` | 8 integration tests (I1..I8) for greeting emission paths | VERIFIED | 48 total tests pass; describe("restartAgent greeting emission (Phase 89)") at line 1540; I1/I2/I3/I4/I5/I5b/I6/I7-alt all present |
| `src/config/__tests__/loader.test.ts` | 5 Phase 89 schema regression tests | VERIFIED | 65 total tests pass; "Phase 89 GREET-07/GREET-10 schema additions" describe block present |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `session-manager.ts (restartAgent)` | `restart-greeting.ts (sendRestartGreeting)` | `void sendRestartGreeting(...).catch(log-and-swallow)` | VERIFIED | Grep confirms 1 `void sendRestartGreeting` at session-manager.ts:998; `.catch` at line 1012 |
| `session-manager.ts` | `discord/webhook-manager.ts` | Optional DI field + `setWebhookManager(wm)` method | VERIFIED | `private webhookManager: WebhookManager | undefined` + `setWebhookManager` at line 284 |
| `daemon.ts` | `session-manager.ts` | `manager.setWebhookManager(webhookManager)` | VERIFIED | Line 1848 (post-convergence, single call) |
| `session-manager.ts (stopAgent)` | `greetCoolDownByAgent Map` | `this.greetCoolDownByAgent.delete(name)` | VERIFIED | Line 887 in stopAgent body |
| `restart-greeting.ts` | `summarize-with-haiku.ts` | `SummarizeFn` DI in `SendRestartGreetingDeps.summarize` | VERIFIED | Type declared in restart-greeting.ts; SessionManager passes `this.summarizeFn` at line 1002 |
| `restart-greeting.ts` | `conversation-store.ts` | `conversationStore.listRecentTerminatedSessions + getTurnsForSession` | VERIFIED | `ConversationReader` structural type uses real public method names; session-manager passes `this.memory.conversationStores.get(name)` |
| `restart-greeting.ts` | `webhook-manager.ts` | `webhookManager.sendAsAgent(agent, displayName, avatarUrl, embed)` | VERIFIED | Direct call at line 364-369; no DeliveryQueue involved |
| `config/loader.ts` | `config/schema.ts` | `agent.greetOnRestart ?? defaults.greetOnRestart` + same for greetCoolDownMs | VERIFIED | Lines 301-302 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `restart-greeting.ts` | `summary` (embed description) | `deps.summarize(prompt, { signal })` — DI'd SummarizeFn | Production: real `summarizeWithHaiku` call via Haiku API; tests: `vi.fn().mockResolvedValue(...)` | FLOWING |
| `restart-greeting.ts` | `turns` | `deps.conversationStore.getTurnsForSession(sessionId, 50)` — real ConversationStore | Real SQLite query via ConversationStore; empty-state guard prevents hollow embed | FLOWING |
| `restart-greeting.ts` | `recent` sessions | `deps.conversationStore.listRecentTerminatedSessions(agentName, 1)` | Real SQLite query; dormancy + empty-state checks prevent hollow output | FLOWING |
| `session-manager.ts (restartAgent)` | `convStore` | `this.memory.conversationStores.get(name)` | Real per-agent ConversationStore instance; gated `if (webhookManager && convStore)` prevents null-path | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| restart-greeting unit tests (29 tests) | `npx vitest run src/manager/__tests__/restart-greeting.test.ts --reporter=dot` | 29/29 pass | PASS |
| session-manager integration tests (48 tests) | `npx vitest run src/manager/__tests__/session-manager.test.ts --reporter=dot` | 48/48 pass | PASS |
| loader schema regression tests (65 tests) | `npx vitest run src/config/__tests__/loader.test.ts --reporter=dot` | 65/65 pass | PASS |
| greeting only in restartAgent (not startAgent/startAll) | `grep -c "void sendRestartGreeting" src/manager/session-manager.ts` | 1 (only in restartAgent body) | PASS |
| No DeliveryQueue in greeting path | `grep "DeliveryQueue" src/manager/restart-greeting.ts` | 0 matches | PASS |
| setWebhookManager wired in daemon | `grep "manager.setWebhookManager" src/manager/daemon.ts` | 1 match at line 1848 | PASS |
| stopAgent cleanup | `grep "greetCoolDownByAgent.delete" src/manager/session-manager.ts` | 1 match at line 887 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| GREET-01 | 89-02 | Greeting fires only on `restartAgent()` | SATISFIED | Fire-and-forget call is inside `restartAgent()` body post-`startAgent()`; I1/I2/I3/I4/I8 integration tests pin all non-greeting paths |
| GREET-02 | 89-01 | Skip forks + subagent threads | SATISFIED | `isForkAgent` + `isSubagentThread` predicates with FORK_SUFFIX_RE + THREAD_SUFFIX_RE; P4/P5 tests |
| GREET-03 | 89-01 | Crash-vs-clean embed differentiation | SATISFIED | `classifyRestart(prevConsecutiveFailures > 0)`; `buildCleanRestartEmbed` (blurple) + `buildCrashRecoveryEmbed` (amber); P1/P2/P16 tests |
| GREET-04 | 89-01 | Fresh Haiku summarization <500 chars | SATISFIED | `buildRestartGreetingPrompt` + 10s AbortController + `truncateDesc`; P10/P15/P19 tests |
| GREET-05 | 89-01 | Skip dormancy (>7d) + empty-state | SATISFIED | Dormancy gate (>DEFAULT_DORMANCY_THRESHOLD_MS) + empty sessions/turns/summary checks; P8/P9/P11/P12 tests |
| GREET-06 | 89-01 | Webhook + EmbedBuilder delivery, new message per restart, send-failed propagation | SATISFIED | Direct `webhookManager.sendAsAgent` call; no edit-in-place; `send-failed` outcome returned on error; P7/P18 tests; I7-alt integration test |
| GREET-07 | 89-01 | `greetOnRestart` flag additive-optional, reloadable | SATISFIED | `greetOnRestart: z.boolean().optional()` (agentSchema) + `.default(true)` (defaultsSchema); 4 RELOADABLE_FIELDS entries; loader resolver; 5 loader tests |
| GREET-08 | 89-02 | Discord delivery via v1.6 webhook identity | SATISFIED | `webhookManager.sendAsAgent(agentName, displayName, avatarUrl, embed)` — uses per-agent webhook identity; I7-alt asserts distinct messageIds per restart |
| GREET-09 | 89-02 | Delivery failure non-blocking | SATISFIED | `void ... .catch((err) => this.log.warn(...))` at session-manager.ts:1012-1016; I5/I5b integration tests confirm `restartAgent` resolves even on `sendAsAgent` rejection |
| GREET-10 | 89-01 | Per-agent configurable cool-down Map | SATISFIED | `greetCoolDownMs` schema fields; `greetCoolDownByAgent` Map on SessionManager; write-back after send; stopAgent delete; P13/P14 unit + I6/I7-alt integration tests |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None detected | — | — | — | No TODO/FIXME/placeholder/stub patterns found in new code; `sendRestartGreeting` returns typed `GreetingOutcome` (not null/empty object); all skip paths produce substantive discriminated-union variants |

### Human Verification Required

#### 1. Live Discord Greeting on Agent Restart

**Test:** With the daemon running and an agent configured with a bound Discord channel and webhook identity, issue `/clawcode-restart <agentName>` via Discord.

**Expected:** Within approximately 15 seconds a webhook-attributed embed appears in the agent's bound Discord channel. The embed should:
- Be authored with the agent's avatar + display name (not "ClawCode" or the bot user)
- Contain a first-person paragraph summarizing the prior session, under 500 characters
- Use Discord blurple (0x5865F2) for a clean restart, or amber (0xFFCC00) if the agent had recent consecutive failures
- Have the footer "Back online" or "Recovered after unexpected shutdown"
- Be a new message (not an edit of a prior greeting)

**Why human:** The full delivery chain — live daemon, IPC dispatch, real WebhookManager provisioning, live Haiku API call with real session history, and Discord webhook delivery — cannot be assembled in automated tests.

#### 2. Dormancy Skip in Production

**Test:** Identify an agent that has had no conversation turns for more than 7 days (or temporarily inject an old `endedAt` timestamp in the ConversationStore), then restart it via `/clawcode-restart`.

**Expected:** No Discord message appears in the channel. The daemon log should contain a `skipped-dormant` outcome line for that agent name.

**Why human:** Requires production data with a real 7-day idle window, or direct database manipulation in a staging environment.

### Gaps Summary

No gaps found. All 10 must-haves (MH-1 through MH-10) are fully verified by automated evidence:

- MH-1 (greeting in restartAgent only): code structure + integration tests I1..I4/I8
- MH-2 (Haiku summarization <500 chars): `DESCRIPTION_MAX_CHARS=500`, `truncateDesc` with U+2026, `AbortController` with 10s timeout, 29 unit tests
- MH-3 (skip paths — fork/thread/empty/dormant/cool-down/flag=false): all 6 skip paths implemented and tested (P3..P13)
- MH-4 (cool-down Map configurable + in-memory): `greetCoolDownByAgent` on SessionManager + `stopAgent` delete + schema fields
- MH-5 (additive-optional schema, v2.1 parses, reloadable): schema + loader + RELOADABLE_FIELDS + 5 loader regression tests
- MH-6 (delivery failure non-blocking): `.catch` wire confirmed at line 1012; I5/I5b tests pass
- MH-7 (crash-vs-clean embeds): `classifyRestart` + two embed builders with correct colors; P1/P2/P16 tests
- MH-8 (direct webhook, no DeliveryQueue): grep confirms 0 DeliveryQueue references in restart-greeting.ts; direct `sendAsAgent` call
- MH-9 (requirements coverage): all 10 GREET-NN IDs appear in plan frontmatter, no gaps or duplicates (89-01 owns GREET-02..07,10; 89-02 owns GREET-01,08,09)
- MH-10 (test suites pass): restart-greeting.test.ts 29/29, session-manager.test.ts 48/48, loader.test.ts 65/65

Two UAT items remain for human sign-off: end-to-end Discord delivery on a live agent restart, and dormancy-skip behavior in production.

---

_Verified: 2026-04-23T22:52:00Z_
_Verifier: Claude (gsd-verifier)_
