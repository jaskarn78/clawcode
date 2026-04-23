---
phase: 89-agent-restart-greeting-active-discord-send-of-prior-context-summary-on-restart
plan: 01
subsystem: manager/config
tags: [greet, schema, pure-module, di, additive-optional]
requires:
  - src/config/schema.ts  # agentSchema + defaultsSchema (Phase 86 MODEL-01 precedent)
  - src/config/types.ts   # RELOADABLE_FIELDS Set (Phase 83/86 precedent)
  - src/config/loader.ts  # resolver (?? defaults)
  - src/shared/types.ts   # ResolvedAgentConfig
  - src/manager/summarize-with-haiku.ts  # SummarizeFn signature (runtime, not imported)
  - src/memory/conversation-store.ts     # listRecentTerminatedSessions + getTurnsForSession (structural type)
  - src/discord/webhook-manager.ts       # sendAsAgent + hasWebhook (structural type)
  - src/memory/conversation-types.ts     # ConversationSession + ConversationTurn
provides:
  - agents.*.greetOnRestart schema field (additive, optional)
  - agents.*.greetCoolDownMs schema field (additive, optional)
  - defaults.greetOnRestart schema field (default true)
  - defaults.greetCoolDownMs schema field (default 300_000)
  - ResolvedAgentConfig.greetOnRestart (always populated)
  - ResolvedAgentConfig.greetCoolDownMs (always populated)
  - RELOADABLE_FIELDS entries for all 4 paths
  - src/manager/restart-greeting.ts — 7 exported fns + 3 exported types + 6 exported constants
affects:
  - 22 test fixtures across agent/bootstrap/config/discord/heartbeat/manager (additive fields for TS compliance)
  - 1 new describe block in src/config/__tests__/loader.test.ts (Phase 89 GREET-07/GREET-10, 5 tests)
  - 1 new unit test file src/manager/__tests__/restart-greeting.test.ts (29 tests)
tech-stack:
  added: []  # zero new deps
  patterns:
    - Phase 83/86 additive-optional schema extension
    - Phase 85 pure-function DI (performMcpReadinessHandshake blueprint)
    - Phase 88 discriminated-union outcome types (SkillInstallOutcome shape)
    - Phase 83/86/87 fire-and-forget invariant (caller wraps)
key-files:
  created:
    - src/manager/restart-greeting.ts (381 lines)
    - src/manager/__tests__/restart-greeting.test.ts (525 lines)
  modified:
    - src/config/schema.ts (agentSchema + defaultsSchema + configSchema default factory)
    - src/config/types.ts (RELOADABLE_FIELDS)
    - src/config/loader.ts (resolver lines)
    - src/shared/types.ts (ResolvedAgentConfig fields)
    - src/config/__tests__/loader.test.ts (+5 tests + fixture updates)
    - src/config/__tests__/differ.test.ts (fixture update)
    - 21 other test fixture files (agent/bootstrap/discord/heartbeat/manager)
decisions:
  - Embed color palette locked per RESEARCH Finding 10: CLEAN_EMBED_COLOR=0x5865F2 (Discord blurple), CRASH_EMBED_COLOR=0xFFCC00 (amber)
  - ConversationReader surface uses the real public API `getTurnsForSession(sessionId, limit?)` — NOT the plan's draft `getTurnsForSessionLimited` (that name refers to a private prepared statement; public method accepts optional limit)
  - Truncation uses DESCRIPTION_MAX_CHARS - 1 + U+2026 (single-char ellipsis) to hit exactly 500 chars — plan's draft `slice(497) + "…"` assumed a 3-char "..." which would overshoot
  - WebhookSender typed as Readonly structural surface (NOT WebhookManager concrete class) so tests can inject plain-object stubs
  - SummarizeFn re-declared in restart-greeting.ts (not imported from summarize-with-haiku.ts) to avoid a circular runtime dep and keep the module tree-shakeable
metrics:
  duration: "20m 10s"
  tasks: 2
  tests_added: 34  # 5 loader + 29 restart-greeting
  commits: 4  # 2 RED + 2 GREEN
  files_created: 2
  files_modified: 28
  lines_added: 1139  # approximately
  completed: 2026-04-23
---

# Phase 89 Plan 01: Agent Restart Greeting — Schema + Pure Helper Module Summary

Additive `greetOnRestart` + `greetCoolDownMs` schema fields (v2.1 migrated fleet parses unchanged, loader resolver falls back to defaults, reloadable classification) + a fully DI'd pure helper `src/manager/restart-greeting.ts` encapsulating every greeting rule — ready for Plan 89-02 to wire into `SessionManager.restartAgent()` without touching SessionManager internals.

## Objective

Deliver a fully testable pure module that Plan 89-02 can call via fire-and-forget at the `restartAgent()` chokepoint. Every greeting rule — fork/thread skip, channel/webhook presence, cool-down, dormancy, empty-state, Haiku summarization with 10s timeout, embed construction, webhook delivery — lives in one file with all I/O DI'd through a Deps struct.

## Requirements Ownership

This plan delivers the following requirement IDs (synthesized in Phase 89 research from CONTEXT.md decisions D-01..D-16):

| Requirement | Decision | Delivered |
|-------------|----------|-----------|
| **GREET-02** | D-03: skip fork (`-fork-<nanoid6>`) and subagent-thread (`-sub-<nanoid6>`) agents | `isForkAgent` + `isSubagentThread` predicates + 5 unit tests |
| **GREET-03** | D-04: crash-vs-clean classifier + distinct embed templates | `classifyRestart` + `buildCleanRestartEmbed` + `buildCrashRecoveryEmbed` + 5 unit tests |
| **GREET-04** | D-05/D-06: fresh Haiku summarization with Discord-tuned prompt + <500-char target | `buildRestartGreetingPrompt` + 10s AbortController in `sendRestartGreeting` + truncation + 5 unit tests |
| **GREET-05** | D-10/D-11: dormancy skip (>7d) + empty-state skip | dormancy gate + empty-state gate in `sendRestartGreeting` + 4 unit tests |
| **GREET-06** | D-08/D-13/D-15: webhook + EmbedBuilder delivery + new message every restart | DI'd `WebhookSender.sendAsAgent` call + send-failed propagation + 3 unit tests |
| **GREET-07** | D-09: per-agent `greetOnRestart` + fleet-wide `defaults.greetOnRestart` + reloadable | Schema additions + loader resolver + RELOADABLE_FIELDS entries + 4 unit tests |
| **GREET-10** | D-14: per-agent 5-min cool-down Map | schema additions (`greetCoolDownMs`) + cool-down Map gate + write-back + 3 unit tests |

Requirements NOT owned by this plan (deferred to 89-02): GREET-01 (emission ONLY on `restartAgent()`), GREET-08 (daemon-scoped cool-down Map lifecycle — SessionManager field + stopAgent cleanup), GREET-09 (fire-and-forget wiring at the callsite).

## Tasks Completed

### Task 1: Schema additions (GREET-07, GREET-10)

**Files:**
- `src/config/schema.ts` — 2 new `agentSchema` fields (optional) + 2 new `defaultsSchema` fields (default-bearing) + updated `configSchema.defaults.default()` factory
- `src/config/types.ts` — 4 new `RELOADABLE_FIELDS` entries (`agents.*.greetOnRestart`, `defaults.greetOnRestart`, `agents.*.greetCoolDownMs`, `defaults.greetCoolDownMs`)
- `src/config/loader.ts` — 2 new resolver lines (`agent.X ?? defaults.X`)
- `src/shared/types.ts` — 2 new `ResolvedAgentConfig` fields (always populated, no `?`)
- `src/config/__tests__/loader.test.ts` — new `describe("Phase 89 GREET-07/GREET-10 schema additions", ...)` block with 5 tests
- 22 test fixtures across agent/bootstrap/config/discord/heartbeat/manager — added `greetOnRestart: true, greetCoolDownMs: 300_000` after `allowedModels` for TS compliance (Rule 3 blocking cascade, same pattern as Phase 86 MODEL-01)

**Commit: `596a3f7`** — feat(89-01): add greetOnRestart + greetCoolDownMs schema (GREET-07, GREET-10)

**Test coverage (5 regression pins):**
1. v2.1 fleet parses unchanged: agent without greetOnRestart resolves to `true` / `300_000` via defaults
2. Per-agent override: `greetOnRestart=false` wins over default
3. Custom cool-down: `greetCoolDownMs=60_000` resolves distinct
4. Defaults override baseline: `defaults.greetOnRestart=false` propagates when agent omits
5. Invalid cool-down (`-5` / `0` / `1.5`) rejected by zod `int().positive()`

### Task 2: restart-greeting.ts pure helper module (GREET-02..06, 10)

**Files:**
- `src/manager/restart-greeting.ts` (381 lines, NEW) — pure helper with 7 exports
- `src/manager/__tests__/restart-greeting.test.ts` (525 lines, NEW) — 29 unit tests

**Commit: `6abb646`** — feat(89-01): implement restart-greeting.ts pure helper module (GREET-02..06, 10)

**Exports:**
- `sendRestartGreeting(deps, input): Promise<GreetingOutcome>` — main helper composing all 10 greeting rules
- `classifyRestart(prevConsecutiveFailures): "clean" | "crash-suspected"` — pure crash classifier
- `isForkAgent(agentName): boolean` — `-fork-<nanoid6>` regex predicate
- `isSubagentThread(agentName): boolean` — `-sub-<nanoid6>` regex predicate
- `buildRestartGreetingPrompt(turns, config, restartKind): string` — Haiku prompt builder (first-person + <400-char target)
- `buildCleanRestartEmbed(displayName, avatarUrl, summary): EmbedBuilder` — blurple + "Back online" footer
- `buildCrashRecoveryEmbed(displayName, avatarUrl, summary): EmbedBuilder` — amber + "Recovered after unexpected shutdown" footer

**Exported types:**
- `SendRestartGreetingDeps` — DI struct (webhookManager, conversationStore, summarize, now, log, coolDownState Map)
- `SendRestartGreetingInput` — per-call params (agentName, config, restartKind, + optional timeout/dormancy/maxTurns overrides)
- `GreetingOutcome` — discriminated union with 10 variants: `sent` | `skipped-disabled` | `skipped-fork` | `skipped-subagent-thread` | `skipped-no-channel` | `skipped-no-webhook` | `skipped-dormant` | `skipped-empty-state` | `skipped-cool-down` | `send-failed`
- `SummarizeFn` — re-exported summarizer signature
- `WebhookSender` — structural type for WebhookManager surface
- `ConversationReader` — structural type for ConversationStore surface
- `RestartKind` — `"clean" | "crash-suspected"` literal union

**Exported constants:**
- `DEFAULT_DORMANCY_THRESHOLD_MS = 7 * 24 * 3600_000` (604,800,000 ms)
- `DEFAULT_SUMMARY_TIMEOUT_MS = 10_000`
- `DEFAULT_MAX_TURNS_FOR_SUMMARY = 50`
- `DESCRIPTION_MAX_CHARS = 500`
- `CLEAN_EMBED_COLOR = 0x5865F2` (Discord blurple)
- `CRASH_EMBED_COLOR = 0xFFCC00` (amber)

**Test coverage map (29 tests):**

| Test | Rule | Requirement |
|------|------|-------------|
| classifyRestart `(0)` → "clean" | D-04 | GREET-03 |
| classifyRestart `(1)` → "crash-suspected" | D-04 | GREET-03 |
| classifyRestart `(10)` → "crash-suspected" | D-04 | GREET-03 |
| isForkAgent `clawdy-fork-AbC123` → true | D-03 | GREET-02 |
| isForkAgent `clawdy-forked` → false | D-03 | GREET-02 |
| isForkAgent `clawdy` → false | D-03 | GREET-02 |
| isSubagentThread `clawdy-sub-xYz456` → true | D-03 | GREET-02 |
| isSubagentThread `clawdy-subagent` → false | D-03 | GREET-02 |
| P1: happy clean → sent + blurple + cool-down written | D-04/D-13/D-14 | GREET-03, GREET-06, GREET-10 |
| P2: crash-suspected → amber + crash footer | D-04 | GREET-03 |
| P3: greetOnRestart=false → skipped-disabled; no cool-down update | D-09 | GREET-07 |
| P4: fork agent name → skipped-fork; no summarize | D-03 | GREET-02 |
| P5: subagent-thread name → skipped-subagent-thread | D-03 | GREET-02 |
| P6: channels=[] → skipped-no-channel | D-03 (defensive) | GREET-02 |
| P7: hasWebhook=false → skipped-no-webhook | D-13 | GREET-06 |
| P8: endedAt 8d ago → skipped-dormant + lastActivityMs | D-10 | GREET-05 |
| P9: no terminated sessions → skipped-empty-state | D-11 | GREET-05 |
| P10: summarize timeout → skipped-empty-state (no fallback) | D-05/D-11 | GREET-04 |
| P11: summarize returns "" → skipped-empty-state | D-11 | GREET-04 |
| P12: getTurnsForSession returns [] → skipped-empty-state | D-11 | GREET-05 |
| P13: cool-down 4min ago, window 5min → skipped-cool-down | D-14 | GREET-10 |
| P14: cool-down 6min ago, window 5min → sends + cool-down updated | D-14 | GREET-10 |
| P15: summary 600 chars → embed.description=500 chars, ends with U+2026 | D-06 | GREET-04 |
| P19: summary 200 chars → no truncation | D-06 | GREET-04 |
| P18: sendAsAgent rejects → send-failed + no cool-down write | D-16 | GREET-06 |
| buildCleanRestartEmbed: color=0x5865F2 + "Back online" | D-13 | GREET-06 |
| buildCrashRecoveryEmbed: color=0xFFCC00 + crash footer | D-13 | GREET-06 |
| buildRestartGreetingPrompt: displayName + turn markdown + "clean restart" | D-05 | GREET-04 |
| buildRestartGreetingPrompt: "unexpected shutdown" for crash-suspected | D-05 | GREET-04 |

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 — Blocking] TypeScript test fixture cascade across 22 files**

- **Found during:** Task 1 `npx tsc --noEmit` after landing `ResolvedAgentConfig.greetOnRestart` + `greetCoolDownMs` (non-optional).
- **Issue:** 22 test fixtures across agent/bootstrap/config/discord/heartbeat/manager directly instantiate `ResolvedAgentConfig` or `DefaultsConfig` literals (per project convention of strict TS in tests). Adding required fields broke all of them.
- **Fix:** Added `greetOnRestart: true, greetCoolDownMs: 300_000` inline comments (`// Phase 89 GREET-07/GREET-10`) after `allowedModels` in every fixture.
- **Files modified:** See `key-files.modified` list (22 files).
- **Precedent:** Phase 86 MODEL-01 applied the identical fix across 20 fixtures when `allowedModels` landed. Blueprint is canonical for additive-required-field cascade.
- **Commit:** `596a3f7` (bundled with schema + tests).

**2. [Rule 3 — Fix] ConversationStore public API name correction**

- **Found during:** Task 2 implementation.
- **Issue:** Plan draft named the turn-fetch method `getTurnsForSessionLimited` (line 156 of the plan's `<interfaces>` block). Source inspection of `src/memory/conversation-store.ts:404` shows the public method is `getTurnsForSession(sessionId, limit?)`; `getTurnsForSessionLimited` is a PRIVATE prepared statement referenced only through `getTurnsForSession`.
- **Fix:** The `ConversationReader` structural type in `restart-greeting.ts` uses `getTurnsForSession(sessionId, limit?)` — matches the real public surface. Tests build stubs against the correct name.
- **Files modified:** `src/manager/restart-greeting.ts` (type def), `src/manager/__tests__/restart-greeting.test.ts` (stubStore implements the correct method).
- **Commit:** `6abb646`.

**3. [Rule 1 — Micro fix] Truncation math correction (U+2026 is 1 char, not 3)**

- **Found during:** Task 2 implementation (cross-check of embed truncation with test P15 assertion `.toHaveLength(500)`).
- **Issue:** Plan's suggested implementation was `s.slice(0, 500 - 3) + "…"` which would produce 498-char output (497 + 1 char ellipsis). But U+2026 "…" is a SINGLE Unicode codepoint — so the correct arithmetic is `s.slice(0, 500 - 1) + "\u2026"` for a result of exactly 500 chars.
- **Fix:** `truncateDesc(s)` uses `s.slice(0, DESCRIPTION_MAX_CHARS - 1) + "\u2026"`. Pinned by test P15 asserting `expect(embed.data.description).toHaveLength(DESCRIPTION_MAX_CHARS)`.
- **Files modified:** `src/manager/restart-greeting.ts` only.
- **Commit:** `6abb646`.

### Claude's Discretion (research-delegated)

No other deviations — every Claude's Discretion item from CONTEXT.md §Decisions was locked in the plan and implemented verbatim:
- Haiku prompt wording: first-person "I was working on…" framing with <400-char target + <500-char hard cap
- Summarizer reuse: direct `summarizeWithHaiku` reuse (no wrapper / no sibling)
- Crash classifier: single-signal `prevConsecutiveFailures > 0` rule
- Embed palette: `0x5865F2` (blurple) + `0xFFCC00` (amber) — matches existing `sendBudgetAlert` warning color
- Cool-down Map: in-memory reset on daemon boot is acceptable
- Schema field names: `greetOnRestart` + `greetCoolDownMs` (camelCase, consistent with `allowedModels`, `greetOnRestart` vs alternatives like `greetingsEnabled` — opted for the verb form to match the action)

## Note for Plan 89-02

- **SummarizeFn import path:** The `SummarizeFn` type is declared in BOTH `src/manager/summarize-with-haiku.ts` (origin) AND re-exported from `src/manager/restart-greeting.ts`. Plan 89-02's SessionManager wiring should import from `summarize-with-haiku.ts` (the origin) so the import graph stays acyclic; the re-export in restart-greeting.ts exists for downstream callers who want a one-import surface.
- **`WebhookSender` structural type:** Plan 89-02 can cast the real `WebhookManager` directly as `WebhookSender` with no wrapper — the shape matches `hasWebhook` + `sendAsAgent` 1:1.
- **`ConversationReader` structural type:** Same — the real `ConversationStore` satisfies the structural shape; no adapter needed.
- **Cool-down Map ownership:** SessionManager must declare a `private readonly greetCoolDownByAgent = new Map<string, number>()` field, clear entries on `stopAgent(name)` (alongside the other per-agent cleanup), and pass the reference to `sendRestartGreeting`'s deps. The Map is DI'd, not instantiated inside the helper, so lifecycle is explicit.
- **Classifier signal source:** The `prevEntry.consecutiveFailures` read MUST happen BEFORE `updateEntry(registry, name, { restartCount: ... })` at `session-manager.ts:936`. Capture it into a local, then pass into `classifyRestart(prevConsecutiveFailures)` after `startAgent` completes.
- **Fire-and-forget shape:** Wrap the call in `void sendRestartGreeting(...).catch(err => this.log.warn(...))` per Phase 83/86 canary. D-16 hard requirement: restart MUST NOT throw from greeting failure.

## Self-Check: PASSED

Verification of claims before proceeding:

**Files created:**
- FOUND: src/manager/restart-greeting.ts
- FOUND: src/manager/__tests__/restart-greeting.test.ts
- FOUND: .planning/phases/89-agent-restart-greeting-active-discord-send-of-prior-context-summary-on-restart/89-01-SUMMARY.md (this file)

**Commits:**
- FOUND: 8a0ef42 — test(89-01): add failing tests for greetOnRestart + greetCoolDownMs schema (RED Task 1)
- FOUND: 596a3f7 — feat(89-01): add greetOnRestart + greetCoolDownMs schema (GREET-07, GREET-10) (GREEN Task 1)
- FOUND: 38a32c4 — test(89-01): add failing tests for restart-greeting.ts pure module (RED Task 2)
- FOUND: 6abb646 — feat(89-01): implement restart-greeting.ts pure helper module (GREET-02..06, 10) (GREEN Task 2)

**Acceptance criteria:**
- 5/5 new loader tests green
- 29/29 restart-greeting tests green (target was >= 19)
- 258/258 total config tests green (no existing test broken)
- All 19 Task 2 acceptance grep assertions pass
- TypeScript compile: zero new errors introduced (39 baseline errors all pre-existing, file-for-file unchanged from pre-Task-1 baseline)
- No stub patterns in new module (no TODO/FIXME/placeholder/"coming soon")
- No SessionManager import in restart-greeting.ts (pure module invariant)
- No webhook-manager.ts concrete-class import (structural typing invariant)
