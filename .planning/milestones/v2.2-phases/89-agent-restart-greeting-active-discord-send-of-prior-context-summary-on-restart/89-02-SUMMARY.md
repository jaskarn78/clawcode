---
phase: 89-agent-restart-greeting-active-discord-send-of-prior-context-summary-on-restart
plan: 02
subsystem: manager/discord
tags: [greet, wiring, di, fire-and-forget, integration-tests]
requires:
  - src/manager/restart-greeting.ts  # sendRestartGreeting, classifyRestart, types (Plan 89-01)
  - src/manager/session-manager.ts   # restartAgent chokepoint at ~line 938 + constructor + stopAgent
  - src/manager/daemon.ts            # WebhookManager construction site + SessionManager DI site
  - src/discord/webhook-manager.ts   # sendAsAgent + hasWebhook (Plan 89-01 consumer)
  - src/manager/summarize-with-haiku.ts  # summarizeFn field already on SessionManager
provides:
  - SessionManager.setWebhookManager(webhookManager) DI method (mirrors setSkillsCatalog)
  - SessionManager.greetCoolDownByAgent — per-agent in-memory cool-down Map
  - SessionManager.restartAgent greeting emission at the line-938 chokepoint (fire-and-forget + .catch log-and-swallow)
  - SessionManager.stopAgent cool-down Map cleanup (line 887: `this.greetCoolDownByAgent.delete(name)`)
  - daemon.ts: `sessionManager.setWebhookManager(webhookManager)` wire after WebhookManager is constructed
  - 8 SessionManager integration tests (I1..I8) pinning D-01 / D-16 / GREET-01 / GREET-08 / GREET-09 / GREET-10
affects:
  - src/manager/session-manager.ts — new optional webhookManager field + setWebhookManager + greetCoolDownByAgent Map + restartAgent greeting wire + stopAgent cleanup
  - src/manager/daemon.ts — setWebhookManager DI call (2 matches: the wire + any re-registration after hot-reload)
  - src/manager/__tests__/session-manager.test.ts — +410 lines (8 integration tests with prototype-level ConversationStore spies + stub WebhookManager)
tech-stack:
  added: []  # zero new deps
  patterns:
    - Phase 83/86/87 canary blueprint (synchronous caller + fire-and-forget + `.catch` log-and-swallow)
    - Phase 85 pure-function DI consumer pattern (SessionManager as the composition root)
    - setSkillsCatalog mirror for setWebhookManager (post-construction DI)
    - ConversationStore.prototype.* spy pattern (mirrors Phase 73 ConversationBriefCache.prototype.invalidate spy)
key-files:
  created: []
  modified:
    - src/manager/session-manager.ts
    - src/manager/daemon.ts
    - src/manager/__tests__/session-manager.test.ts
decisions:
  - D-01 enforced by construction, NOT by a runtime flag: the greeting call lives only inside restartAgent() AFTER startAgent() resolves — startAgent (direct + reconcile-on-boot), startAll, performRestart (auto-crash-restart), and the daemon.ts IPC 'restart' fallback (which calls manager.startAgent on /not running/ errors) all route through startAgent with no greeting surface. No per-path guards needed.
  - Cool-down Map is SessionManager-owned (in-memory, daemon-scoped) and passed by reference to the pure helper via `SendRestartGreetingDeps.coolDownState`. Map is cleared in stopAgent to prevent stale entries for agents that are removed-then-re-added. Boot reset is acceptable per CONTEXT.md §Claude's Discretion (startAll is silent anyway).
  - setWebhookManager DI mirror (not constructor-arg) keeps the SessionManager constructor signature stable. daemon.ts already constructs WebhookManager AFTER SessionManager (webhook-provisioner dependency ordering); post-construction DI is the natural fit.
  - Integration tests spy on ConversationStore.prototype.{listRecentTerminatedSessions, getTurnsForSession} at PROTOTYPE scope rather than instance scope — stop-path session summarization (session-summarizer.ts:365) still runs on the real store, but the greeting helper sees deterministic canned history. Mirrors Phase 73 ConversationBriefCache.prototype.invalidate pattern already in this file.
  - DeliveryQueue bypass preserved — no enqueue path added. Greeting uses direct webhookManager.sendAsAgent. Phase 89 does NOT close the v1.2 text-only queue gap; documented in plan as Option 1.
  - No new crash-tracking field introduced. Classifier reads `prevConsecutiveFailures > 0` from the existing registry entry before startAgent resets it. RESEARCH Finding 2.
metrics:
  duration: "47m"  # includes orchestrator handoff across quota reset
  tasks: 2
  tests_added: 8  # 8 integration tests I1..I8
  commits: 2  # 1 feat + 1 test
  files_created: 0
  files_modified: 3
  lines_added: 410  # test file additions
  completed: 2026-04-23
---

# Phase 89 Plan 02: SessionManager Wiring — Restart Greeting Emission Summary

Wires the Plan 89-01 pure helper into `SessionManager.restartAgent()` at the line-938 chokepoint with fire-and-forget + `.catch` log-and-swallow per the Phase 83/86/87 canary blueprint. Adds `setWebhookManager` DI, the per-agent cool-down Map, and integration tests pinning that the greeting emits only on `restartAgent()` — never on `startAgent`, `startAll`, `performRestart`, or the daemon IPC fallback.

## Objective

Close Phase 89 by connecting the pure helper to the real restart path. The helper itself is untouched; this plan adds:
1. The DI hook on SessionManager (`setWebhookManager`) so the daemon can inject the constructed WebhookManager without a constructor signature change.
2. The cool-down Map owned by SessionManager and threaded into the helper through `SendRestartGreetingDeps`.
3. The fire-and-forget call at the chokepoint so restart completes regardless of Discord availability.
4. 8 integration tests pinning every path (positive and negative) at the SessionManager layer.

## Requirements Ownership

| Requirement | Decision | Delivered |
|-------------|----------|-----------|
| **GREET-01** | D-01 / D-02: trigger only on restartAgent; startAgent/startAll/performRestart/IPC-fallback silent | `void sendRestartGreeting(...)` injected after `await this.startAgent(name, config)` at session-manager.ts:938; integration tests I1 (restartAgent greets), I2 (startAgent silent), I3 (startAll silent), I4 (performRestart silent), I8 (IPC fallback silent) |
| **GREET-08** | D-08 / D-13 / D-15: webhook + EmbedBuilder delivery; new message per restart | Direct `webhookManager.sendAsAgent(name, { embeds: [embed] })` invocation via the pure helper; integration test I7 asserts two sequential restarts produce distinct messageIds |
| **GREET-09** | D-16: fire-and-forget + `.catch` log-and-swallow; restart MUST NOT depend on Discord | `void sendRestartGreeting(...).catch((err) => this.log.warn({err}, "greeting failed"))`; integration test I5 pins restart resolves successfully when `sendAsAgent` rejects |

Plus inherits the co-owned properties from Plan 89-01:
- **GREET-06 / GREET-10** (co-owned): cool-down Map semantics — integration test I6 pins that `stopAgent(name)` deletes the cool-down entry (no stale carry-over across agent re-registration).

## Architectural Decisions (recorded)

### Decision: D-01 enforced by construction (no runtime flag)
The greeting call is placed INSIDE `restartAgent()` only, AFTER the inner `startAgent()` resolves. `startAgent()`, `startAll()`, `performRestart()`, and the daemon IPC `'restart'` handler's `/not running/` fallback (which calls `manager.startAgent`, not `manager.restartAgent`) all bypass the greeting surface by construction. No per-path guards are needed.

Rationale: the D-01 literal reading ("trigger only on `SessionManager.restartAgent()`") is the simplest possible enforcement. Any runtime flag would be additive noise. The integration tests I2/I3/I4/I8 pin this contract at the SessionManager layer.

### Decision: Cool-down Map SessionManager-owned, DI'd by reference
The Map lives on SessionManager (`greetCoolDownByAgent: Map<string, number>`) and is passed by reference to the pure helper via `SendRestartGreetingDeps.coolDownState`. The helper reads + writes the Map (check last-greeting-at ≤ `greetCoolDownMs` → skip; otherwise send + `set(name, Date.now())`).

Rationale: lifecycle ownership belongs to SessionManager (it already owns agent lifecycle via `agents: Map<string, AgentHandle>`). `stopAgent` deletes the entry at session-manager.ts:887 preventing stale carry-over across agent removal/re-add. Reset-on-boot is acceptable per CONTEXT.md §Claude's Discretion — `startAll()` is silent by D-02, so no greeting spam on startup.

### Decision: setWebhookManager DI mirror (post-construction)
daemon.ts constructs SessionManager BEFORE WebhookManager (WebhookManager needs the webhook-provisioner's channel client, which depends on SessionManager's registry). The natural DI pattern is `setWebhookManager(webhookManager)` called after both are constructed — mirrors `setSkillsCatalog` which uses the same lifecycle shape for the same reason.

### Decision: Prototype-level spy in integration tests
ConversationStore.prototype.{listRecentTerminatedSessions, getTurnsForSession} are spied at PROTOTYPE scope. Rationale: the real ConversationStore is still used by `stopAgent`'s session-summarizer (it prunes zero-turn sessions at session-summarizer.ts:365, which would erase the test's canned session). Prototype-scope spies intercept only the greeting helper's reads, leaving the stop-path summarization fully functional. Mirrors the existing Phase 73 `ConversationBriefCache.prototype.invalidate` spy pattern in the same test file.

## Verification

### Automated
- `npx vitest run src/manager/__tests__/session-manager.test.ts --reporter=dot` → 48/48 pass (includes 8 new Phase 89 integration tests)
- `npx vitest run src/manager/__tests__/restart-greeting.test.ts --reporter=dot` → 29/29 pass (no Wave 1 regression)
- `npx tsc --noEmit` → 39 errors (baseline-equivalent with Plan 89-01; no new errors from this plan)
- Grep assertions:
  - `grep -c "void sendRestartGreeting" src/manager/session-manager.ts` → 1 (fire-and-forget wire present)
  - `grep -c "setWebhookManager" src/manager/session-manager.ts src/manager/daemon.ts` → 2 + 2 (DI method + call)
  - `grep -q "greetCoolDownByAgent.delete" src/manager/session-manager.ts` → match (stopAgent cleanup at line 887)

### Integration Tests (I1..I8)
| # | Assertion | Requirement |
|---|-----------|-------------|
| I1 | `restartAgent` emits exactly one `sendAsAgent` call with a greeting-shaped embed | GREET-01 |
| I2 | `startAgent` on a fresh agent emits zero `sendAsAgent` calls | GREET-01 (negative) |
| I3 | `startAll` (daemon-boot reconcile) emits zero `sendAsAgent` calls | D-02 |
| I4 | `performRestart` (auto-crash-restart scheduled path) emits zero `sendAsAgent` calls | D-01 literal |
| I5 | `restartAgent` resolves successfully when `sendAsAgent` rejects with "boom" | GREET-09 / D-16 |
| I6 | `stopAgent(name)` deletes `greetCoolDownByAgent.get(name)` | Cool-down hygiene |
| I7 | Two sequential `restartAgent` calls (with cool-down bypassed) produce distinct messageIds | GREET-10 / D-15 |
| I8 | daemon IPC `'restart'` fallback leg (startAgent on not-running agent) emits zero greetings | D-01 literal |

## Phase 89 Goal Achievement

Both plans together deliver the goal from ROADMAP §"Phase 89: Agent Restart Greeting":

> When an agent is explicitly restarted via `SessionManager.restartAgent()`, the daemon proactively sends a Discord message to the agent's bound channel containing a Haiku-summarized recap of the prior session — so the human sees the agent come back online with a quick "here's where we left off" signal, distinct from silent boot-reconcile (`startAll()`) and first-ever start.

All 7 roadmap success criteria are now covered:
1. restartAgent emits exactly one greeting via webhook; startAgent/startAll silent by construction — PINNED by I1/I2/I3/I4/I8.
2. Fresh Haiku summarization <500 chars, prior-session summary only — PINNED by Plan 89-01 tests (truncation + Discord-tuned prompt).
3. Forks/threads/empty-state/dormancy skipped — PINNED by Plan 89-01 tests P3/P4/P5/P8/P9.
4. Per-agent cool-down (5min default, configurable via greetCoolDownMs) — PINNED by Plan 89-01 tests P13/P14 + Plan 89-02 integration I6/I7.
5. Additive-optional schema, v2.1 parses unchanged, reloadable — PINNED by Plan 89-01 loader tests.
6. Delivery failure: log + restart completes — PINNED by I5.
7. Crash-recovery vs clean-restart differentiated embeds — PINNED by Plan 89-01 tests P1/P2/P16.

## Deviations

- **Orchestrator handoff across quota reset**: the executor subagent hit its per-session usage limit mid-Task-2. Task 1 (feat commit) landed at 9bcd539; Task 2 (integration tests) was written (410 lines) but not committed before the timeout. The orchestrator ran the test suite directly (48/48 pass, 29/29 no regression) and committed Task 2 at 83ccd48. No deviation from the plan — just a handoff.

## Commits

- 9bcd539 — feat(89-02): wire restartAgent greeting emission + webhookManager DI (GREET-01, GREET-08, GREET-09)
- 83ccd48 — test(89-02): integration tests for restartAgent greeting emission (GREET-01, GREET-08, GREET-09)

## Next

Phase 89 is complete. Proceed to `gsd-verifier` for goal-backward verification, then milestone audit / complete / cleanup for v2.2.
