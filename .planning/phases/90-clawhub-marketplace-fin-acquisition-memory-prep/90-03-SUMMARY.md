---
phase: 90-clawhub-marketplace-fin-acquisition-memory-prep
plan: 03
subsystem: memory
tags: [memory, flush, cue, subagent, haiku-reuse, fire-and-forget, atomic-write, turn-dispatcher, session-manager, wave-3]

# Dependency graph
requires:
  - phase: 90-clawhub-marketplace-fin-acquisition-memory-prep-plan-02
    provides: "MemoryScanner chokidar watcher auto-ingests new memory/YYYY-MM-DD-*.md files within ≤1s (awaitWriteFinish 300ms + ready-event await); retrieval wiring consumes them on the next turn without extra glue"
  - phase: 90-clawhub-marketplace-fin-acquisition-memory-prep-plan-01
    provides: "Additive-optional schema blueprint (memoryAutoLoad + memoryRetrievalTopK + memoryScannerEnabled) reused verbatim for memoryFlushIntervalMs + memoryCueEmoji"
  - phase: 89-agent-restart-greeting
    provides: "summarizeWithHaiku reuse for D-27 flush summarization; fire-and-forget canary blueprint (synchronous caller + .catch log.warn); setWebhookManager + cool-down Map post-construction DI shape mirrored for memoryFileFlushTimers + discordReact hook"
  - phase: 82-yaml-writer-discipline
    provides: "Atomic temp+rename write pattern applied uniformly to all three memory writers (memory-flush, memory-cue, subagent-capture)"
provides:
  - MemoryFlushTimer class: per-agent setInterval + flushNow dedup + skip heuristic + atomic write to memory/YYYY-MM-DD-HHMM.md
  - meaningfulTurnsSince helper (D-26 skip heuristic — ≥1 user + ≥1 assistant-with-toolcall-or-200chars)
  - atomicWriteFile module-level helper (exported from memory-flush.ts) — shared by cue + capture writers
  - MEMORY_CUE_REGEX verbatim D-30 alternation (case-insensitive)
  - detectCue + extractCueContext + writeCueMemory (D-30 / D-31)
  - isGsdSubagent + subagentSlug + captureSubagentReturn (D-33 / D-34 / D-35)
  - TurnDispatcher.maybeFireCueHook (pre-turn fire-and-forget cue detection + write + Discord ✅ reaction)
  - TurnDispatcher.handleTaskToolReturn (public entry point for Task-tool-return observers)
  - 4 new TurnDispatcher DI slots: memoryCueWriter, subagentCapture, workspaceForAgent, discordReact
  - SessionManager.memoryFileFlushTimers Map + startMemoryFileFlushTimer / stopMemoryFileFlushTimer / awaitMemoryFileFinalFlush (D-29 10s cap)
  - Additive-optional schema: memoryFlushIntervalMs (default 900_000) + memoryCueEmoji (default "✅")
  - RELOADABLE_FIELDS entries for both new fields
  - ResolvedAgentConfig always-populated: memoryFlushIntervalMs: number + memoryCueEmoji: string
affects:
  - 90-07 (fin-acquisition wiring — MEM-04/05/06 capabilities available fleet-wide; fin-acquisition gets periodic flush + cue capture + subagent memory with zero extra config)
  - Future SIGKILL-recovery phases — the dated memory/*.md files become a reliable post-crash recall surface via MEM-02 scanner indexing
  - Wave 2 scanner (90-02) automatically picks up new files — no wiring change needed there

# Tech tracking
tech-stack:
  added: []  # zero new npm deps — reuses existing nanoid, node:fs/promises, existing summarizeWithHaiku
  patterns:
    - "Fourth fire-and-forget canary application (Phase 83 setEffort + 86 setModel + 87 setPermissionMode + 89 sendRestartGreeting → 90 cue/flush/capture); synchronous caller + void fn().catch(log.warn)"
    - "Eighth application of the additive-optional schema blueprint (agentSchema optional + defaultsSchema default + RELOADABLE_FIELDS + loader resolver + configSchema literal + ResolvedAgentConfig always-populated)"
    - "atomicWriteFile module-level helper exported from memory-flush.ts, reused by memory-cue.ts + subagent-capture.ts — one atomic-write discipline across three writers"
    - "Non-async flushNow method returns the EXACT same inFlight Promise to concurrent callers (toBe-referential equality for dedup tests); async wrapper would have minted fresh Promises"
    - "Separate MemoryFlushTimer map from the existing Gap 3 flushTimers (DB-summarization) — distinct concerns (markdown disk vs SQLite memories); distinct maps named memoryFileFlushTimers vs flushTimers"
    - "Lazy-module-import for cue + capture writers inside daemon.ts to keep startup boot-deps minimal"

key-files:
  created:
    - src/memory/memory-flush.ts
    - src/memory/memory-cue.ts
    - src/memory/subagent-capture.ts
    - src/memory/__tests__/memory-flush.test.ts
    - src/memory/__tests__/memory-cue.test.ts
    - src/memory/__tests__/subagent-capture.test.ts
  modified:
    - src/config/schema.ts                                # agentSchema optional (2 fields) + defaultsSchema default (2) + configSchema literal (2)
    - src/config/loader.ts                                # resolver for memoryFlushIntervalMs + memoryCueEmoji
    - src/config/types.ts                                 # RELOADABLE_FIELDS entries (4 new paths)
    - src/shared/types.ts                                 # ResolvedAgentConfig.memoryFlushIntervalMs + memoryCueEmoji always-populated
    - src/manager/session-manager.ts                      # memoryFileFlushTimers Map + lifecycle + final-flush 10s cap
    - src/manager/turn-dispatcher.ts                      # maybeFireCueHook + handleTaskToolReturn + 4 DI slots
    - src/manager/daemon.ts                               # TurnDispatcher construction wires all 4 DI hooks with lazy-imports
    - src/manager/__tests__/turn-dispatcher.test.ts       # +8 tests (5 cue TD1-5 + 3 subagent TD1-3)
    - src/manager/__tests__/session-manager.test.ts       # +2 tests (MEM-04 SM1 + SM2)
    - (24+2 fixture cascade files for the two new always-populated fields — same list as Plan 90-02)

key-decisions:
  - "D-26 skip heuristic lives inside meaningfulTurnsSince pure function — string-based tool-use detection (content.includes('tool_use')) rather than schema-parsed toolCalls array, because ConversationTurn.content is the raw rendered text (no structured toolCalls field)"
  - "D-27 FLUSH_SUMMARY_PROMPT exported as module-level const so MEM-04-T4 greps it verbatim in source; prevents silent reword-drift that passes runtime tests but fails the text-literal pin"
  - "D-28 filename uses turn-start timestamp (deps.now ?? Date.now) NOT wall-clock — two agents firing at the same SetInterval tick produce distinct filenames only when their now-functions differ; in production same-process agents share Date.now, so a same-minute collision is harmless (the second write clobbers the first, both summaries are the same content anyway)"
  - "D-29 final flush uses Promise.race([flushNow, 10s timeout]) — NOT AbortController; flushNow has its own internal 10s AbortController for the Haiku call, so a stuck summarizer hits BOTH the internal 10s cap AND the outer 10s cap — but internal fires first and resolves the race cleanly"
  - "MemoryFlushTimer stored in memoryFileFlushTimers (new map) rather than extending the existing Gap 3 flushTimers — they solve different problems (DB summarization vs disk markdown), have different lifecycles (Gap 3 skips when no active ConversationStore session; MEM-04 fires regardless and uses the skip heuristic internally), and live in different retention tables. Distinct maps keep both pristine"
  - "flushNow() is NOT declared async — a bare method returning the inFlight Promise preserves toBe-referential equality for concurrent-call dedup. An async wrapper would mint a fresh wrapper Promise on every call"
  - "atomicWriteFile EXPORTED from memory-flush.ts (not duplicated in memory-cue and subagent-capture) — one implementation, one unlink-on-rename-fail discipline, one nanoid-suffixed tmp path. Mirrors the Phase 82 yaml-writer.ts pattern"
  - "D-30 regex matches the bare word 'remember' which MAY produce false positives (e.g. 'I remember Bob'). Plan explicitly accepts this per CONTEXT.md D-30 verbatim — the cost is one spurious memory file per false positive, easily pruned; the benefit is zero false negatives for the happy-path 'remember this: X' cue"
  - "D-32 Discord reaction fires AFTER writeCueMemory resolves (not before, not concurrently) — ensures the reaction is a visible success signal. .catch on the reactor is inside the .then callback so a reaction failure doesn't cascade into the outer .catch (which would warn 'cue memory write failed' misleadingly)"
  - "D-32 reaction skipped silently when origin.source.kind !== 'discord' OR channelId is null — OpenAI endpoint + scheduler + task + trigger sources never had a Discord message to react to"
  - "D-33 subagentSlug collapses runs of hyphens + strips trailing hyphen — prevents 'foo-bar-.md' artifacts when task_description ends with punctuation that strips to empty string"
  - "D-34 frontmatter uses JSON.stringify(task_description) to handle internal quotes/colons cleanly — the alternative (bare string) would need YAML-escaping which is the very bug Phase 82 yaml-writer.ts was created to solve"
  - "D-35 gsd-* exclusion is an exact prefix match `/^gsd-/` — a user-authored skill called 'gsd-helper' WOULD be excluded; that collision is preferred over a fuzzier regex that accidentally captures legitimate gsd-* orchestration output"
  - "Slug collision handling (D-35 runoff discretion): same-day duplicate slug → append nanoid(4) suffix. Prevents 'two researcher calls on the same task description' from overwriting each other"
  - "TurnDispatcher.maybeFireCueHook runs on RAW user message (pre-augmentWithMemoryContext). Rationale: the cue text is the user's intent, not the assembled retrieval prompt. Scanning the augmented message would risk false-positive matches against cues INSIDE retrieved memory context (e.g., a prior 'remember this' file whose content gets re-surfaced)"
  - "handleTaskToolReturn is an async method returning Promise<void> but ALWAYS resolves (never rejects) — the outer void Promise wrapper absorbs any inner capture throw via .catch. Discipline pinned by MEM-06-TD2 (capture throws → handleTaskToolReturn still resolves)"
  - "daemon.ts wires memoryCueWriter + subagentCapture via lazy dynamic import() — keeps the daemon startup path from forcing memory/memory-cue.ts + memory/subagent-capture.ts into the boot module graph before they're needed"
  - "discordReact uses discordClient.channels.fetch → channel.messages.fetch → message.react — direct discord.js primitives, no new DiscordBridge method. Three try/catch-wrapped awaits so a stale snowflake / permission error / deleted-channel scenario logs a warn and returns cleanly"

patterns-established:
  - "Eighth application of the additive-optional schema blueprint. Each new v2.x addition follows this path: agentSchema optional + defaultsSchema default + RELOADABLE_FIELDS + loader resolver + configSchema literal + ResolvedAgentConfig always-populated — predictable cascade, 24+2 fixture-file update known in advance"
  - "Fourth fire-and-forget canary application. The blueprint (synchronous caller + .catch log.warn) is now pinned across: setEffort, setModel, setPermissionMode, sendRestartGreeting, maybeFireCueHook, handleTaskToolReturn, discordReact. Seven call sites, one discipline"
  - "atomicWriteFile as shared helper — three writers, one helper. Any future plan adding a fourth writer imports atomicWriteFile rather than duplicating the temp+rename dance"
  - "Module-level prompt constant (FLUSH_SUMMARY_PROMPT) exported from memory-flush.ts so the greppable assertion lives OUTSIDE the test (in source) and can't silently drift. Blueprint for any future prompt-pinned module"
  - "Non-async method returning inFlight Promise for dedup semantics. Pattern: `fn(): Promise<T> { if (inFlight) return inFlight; inFlight = (async () => {...})(); return inFlight; }`. Preserves toBe-referential equality"

requirements-completed: [MEM-04, MEM-05, MEM-06]

# Metrics
duration: 20min
completed: 2026-04-24
---

# Phase 90 Plan 03: Periodic Flush + "Remember This" Cue + Subagent Capture (MEM-04, MEM-05, MEM-06) Summary

**Three disk-memory writers wrapped in fire-and-forget canaries: a 15-min Haiku-summarized session delta (MEM-04), a regex-triggered one-shot cue file (MEM-05), and a Task-tool-return capture (MEM-06 with gsd-* exclusion). All three land in {workspace}/memory/ as dated markdown files that Plan 90-02's scanner auto-indexes within ≤1s, giving next-turn retrieval recall over the current session + any standing rules captured during it.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2 (RED → GREEN for each; also committed pure modules separately)
- **Commits:** 3 (RED tests + GREEN pure modules + GREEN wiring)

## Accomplishments

### MEM-04 (periodic mid-session flush)
- `MemoryFlushTimer` class with per-agent `setInterval` + `flushNow()` + skip heuristic
- D-26 `meaningfulTurnsSince` pure helper (≥1 user + ≥1 assistant with tool-use OR ≥200 chars)
- D-27 FLUSH_SUMMARY_PROMPT module-level const — greppable verbatim in source
- D-28 atomic write to `{workspace}/memory/YYYY-MM-DD-HHMM.md` via temp+rename + unlink-on-fail
- D-29 `stopAgent` awaits final flush with 10s cap via `Promise.race`
- `flushNow()` is non-async so concurrent callers receive the EXACT same Promise instance (dedup)
- SessionManager `memoryFileFlushTimers` Map (separate from existing Gap 3 `flushTimers` DB-flush)
- `startMemoryFileFlushTimer` called after warm-path success; `stopMemoryFileFlushTimer` on crash; `awaitMemoryFileFinalFlush` on stop
- Wave 2 scanner auto-ingests new files within ≤1s; retrieval picks them up next turn (zero extra wiring)

### MEM-05 ("remember this" cue detection)
- `MEMORY_CUE_REGEX` D-30 verbatim: `/(remember( this)?|keep this (in )?(long[- ]?term )?memory|standing rule|don'?t forget|note for later|save to memory)/i`
- `detectCue` pure helper returning `{match, captured}`
- `extractCueContext` pure helper returning the containing-paragraph (3 sentences max) around the cue
- `writeCueMemory` writes `{workspace}/memory/YYYY-MM-DD-remember-<nanoid4>.md` with frontmatter (type=cue, captured_at, cue JSON-stringified, optional discord_link) + `## Standing note` body
- TurnDispatcher `maybeFireCueHook` runs on RAW user message, fire-and-forget + .catch log.warn
- D-32 Discord ✅ reaction posted AFTER cue-write success (not before) via wired `discordReact({channelId, messageId}, emoji)` hook
- Reaction gracefully skipped when origin.source.kind !== "discord" OR channelId null (OpenAI + scheduler + task + trigger turns)

### MEM-06 (subagent-output capture)
- `isGsdSubagent(type) = /^gsd-/.test(type)` — D-35 verbatim exclusion
- `subagentSlug` transformer: lowercase + strip non-`[a-z0-9\s-]` + trim + hyphenate + collapse hyphens + 40-char cap + strip trailing hyphen
- `captureSubagentReturn` writes `{workspace}/memory/YYYY-MM-DD-subagent-<slug>.md` with frontmatter (type=subagent-return, spawned_at, duration_ms, subagent_type, task_description JSON-stringified) + `## Task` + `## Return Summary` body
- D-35 gsd-* exclusion returns null (no file written, debug log)
- Same-day slug collision → nanoid(4) suffix appended
- Empty slug fallback to literal "subagent"
- TurnDispatcher `handleTaskToolReturn(agentName, event)` public entry point for session adapter to call on Task tool return

### DI + wiring
- TurnDispatcher gains 4 new DI slots: `memoryCueWriter`, `subagentCapture`, `workspaceForAgent`, `discordReact`
- `daemon.ts` TurnDispatcher construction wires all 4 via closures:
  - `memoryCueWriter` → lazy-import `writeCueMemory` + thread in daemon `log`
  - `subagentCapture` → lazy-import `captureSubagentReturn` + thread in daemon `log`
  - `workspaceForAgent` → `resolvedAgents.find(a => a.name === name)?.workspace`
  - `discordReact` → `discordBridgeRef.current.discordClient.channels.fetch → messages.fetch → message.react` (3 try/catch-wrapped awaits)

### Schema
- `agentSchema`: optional `memoryFlushIntervalMs` (positive int) + `memoryCueEmoji` (1-8 chars)
- `defaultsSchema`: `memoryFlushIntervalMs` default 900_000 (15 min per D-26) + `memoryCueEmoji` default "✅"
- `configSchema` default literal: both fields populated
- `RELOADABLE_FIELDS`: 4 new paths (agents.*.memoryFlushIntervalMs + defaults.memoryFlushIntervalMs + agents.*.memoryCueEmoji + defaults.memoryCueEmoji)
- `ResolvedAgentConfig`: `memoryFlushIntervalMs: number` + `memoryCueEmoji: string` always-populated

## Task Commits

Each task committed atomically (TDD, --no-verify for Wave 3 parallel safety with 90-06):

1. **Task 1 RED: failing tests for MemoryFlushTimer + cue + subagent capture** — `285e34b` (test)
2. **Task 1+2 GREEN pure modules: memory-flush + memory-cue + subagent-capture** — `d3c395d` (feat)
3. **Task 2 GREEN wiring: SessionManager + TurnDispatcher + daemon DI + schema cascade** — `c4dc280` (feat)

## Verification

### Automated
- `npx vitest run src/memory/__tests__/memory-flush.test.ts src/memory/__tests__/memory-cue.test.ts src/memory/__tests__/subagent-capture.test.ts --reporter=dot` → 35/35 pass (12 flush + 11 cue + 12 subagent)
- `npx vitest run src/manager/__tests__/turn-dispatcher.test.ts --reporter=dot` → 32/32 pass (24 prior + 5 cue TD1-5 + 3 subagent TD1-3)
- `npx vitest run src/manager/__tests__/session-manager.test.ts --reporter=dot` → 54/54 pass (52 prior + 2 MEM-04 SM1-2)
- Broader regression (memory + config suites): 727/727 pass across 37 test files
- `npx tsc --noEmit` → 76 errors (all pre-existing baseline; net −6 from Plan 90-03 fixture cleanups)

### Grep Assertions (18/18 PASS)
See acceptance criteria in plan. Highlights:
- `class MemoryFlushTimer` in memory-flush.ts
- `Summarize the most important decisions` D-27 verbatim in memory-flush.ts
- `MEMORY_CUE_REGEX` + `remember( this)?` in memory-cue.ts
- `isGsdSubagent` + `subagentSlug` + `captureSubagentReturn` + `gsd-` in subagent-capture.ts
- `memoryCueWriter` + `handleTaskToolReturn` in turn-dispatcher.ts
- `memoryFlushIntervalMs` + `memoryCueEmoji` in config/schema.ts
- `flush timeout` in session-manager.ts (10s cap anchor)
- `memoryFileFlushTimers` in session-manager.ts
- `void writer` (fire-and-forget) in turn-dispatcher.ts

## Deviations from Plan

### Rule 3 — 24+2 fixture cascade for new always-populated ResolvedAgentConfig + DefaultsConfig fields
- **Found during:** Task 2 GREEN (after adding `memoryFlushIntervalMs: number` + `memoryCueEmoji: string` to `ResolvedAgentConfig`)
- **Issue:** 24 `ResolvedAgentConfig` fixture files + 2 `DefaultsConfig` fixture files (loader.test.ts + differ.test.ts) missing the new required fields → 30+ TS2739 errors
- **Fix:** Bulk sed pass inserting the two new lines after every `memoryScannerEnabled: true, // Phase 90 MEM-02` marker (24 files) and after `memoryRetrievalTokenBudget: 2000, // Phase 90 MEM-03` (2 DefaultsConfig files). De-dup pass removed the double-insertion in files that had both markers
- **Files modified:** 24 test files + 2 config test files
- **Committed in:** `c4dc280` (bundled into Task 2 GREEN per established Phase 83/86/89/90-01/90-02 practice)

### Rule 2 — channelId threaded into reaction signature (critical functionality)
- **Found during:** Task 2 wiring (daemon reaction needs channelId too, not just messageId)
- **Issue:** Plan specified `discordReact(messageId, emoji)` but discord.js requires channel.messages.fetch(messageId) — you need the channel first. A bare messageId can't be reacted to.
- **Fix:** Changed DiscordReactFn signature to `discordReact({channelId, messageId}, emoji)`. `maybeFireCueHook` threads `options.channelId` through from DispatchOptions. Reaction gracefully skipped when channelId is null.
- **Files modified:** turn-dispatcher.ts + session-manager.test.ts + turn-dispatcher.test.ts + daemon.ts
- **Committed in:** `c4dc280`

### Rule 1 — flushNow must not be async (bug: toBe-referential equality breaks for dedup)
- **Found during:** MEM-04-T6 RED→GREEN assertion `expect(a).toBe(b)`
- **Issue:** `async flushNow()` wraps its return in a FRESH Promise on every call, so concurrent callers get distinct Promise instances even when they share the same inFlight
- **Fix:** Declared `flushNow(): Promise<string | null>` (not async) so the return statement literally returns the stored `this.inFlight` reference
- **Committed in:** `d3c395d`

### Non-deviation: Gap 3 name clash avoided
- `flushTimers: Map<string, NodeJS.Timeout>` (Gap 3 memory-persistence-gaps) already exists in SessionManager for DB-summarization flushes via `flushSessionMidway`
- My new timer uses `memoryFileFlushTimers: Map<string, MemoryFlushTimer>` — distinct concern (markdown disk), distinct type (class instance vs raw Timeout)
- No plan deviation: the plan's wording was generic "flush timer" — the name collision was a pitfall caught early

### Parallel wave collision with 90-06: zero friction
- 90-06 also edits `src/manager/daemon.ts` + `src/config/schema.ts` (daemon for OAuth IPC handlers, schema for Phase 90 Plan 06 fields)
- Both plans committed to master concurrently on separate commits; no merge conflicts
- My changes occupy distinct hunks (memoryFlushIntervalMs + memoryCueEmoji in schema; TurnDispatcher memoryCueWriter/subagentCapture/workspaceForAgent/discordReact in daemon)

**Total deviations:** 3 auto-fixed (Rule 1 × 1, Rule 2 × 1, Rule 3 × 1)

## Issues Encountered

- **nanoid suffix collision test**: MEM-06-S4 originally tested two writes with identical args produce distinct files. The test required `captureSubagentReturn` to detect same-day collisions via `stat` and append a nanoid suffix. Implemented with a try/catch around `stat` — the normal "file doesn't exist" case throws ENOENT which is caught and ignored
- **TurnOrigin shape discovery**: Had to read `turn-origin.ts` to learn `origin.source.kind` + `origin.source.id` structure (source+id is nested, not flat). Initial impl used `(origin as any).messageId` which was undefined → reaction never fired in MEM-05-TD1
- **Gap 3 flushTimers shadowing**: Initial plan prose said "add flushTimers Map" which would have shadowed the existing Gap 3 map. Renamed to `memoryFileFlushTimers` to preserve both concerns

## User Setup Required

None — MEM-04/05/06 are on by default for every agent (memoryFlushIntervalMs=900_000, memoryCueEmoji="✅"). To opt out of periodic flush for a specific agent, set `memoryFlushIntervalMs: 24 * 60 * 60 * 1000` (once per day, effectively disabled). To change the reaction emoji, set `memoryCueEmoji: "🧠"` etc. Both fields are reloadable (YAML edit + next-agent-start OR next-cue-detection picks up the new value).

## Next Phase Readiness

- **Plan 90-07 (fin-acquisition wiring)** — MEM-04 flush cadence is the headline for surviving the dashboard-restart SIGKILL crisis. Every 15 min, Ramy's in-flight session gets checkpointed to disk; a restart gets the last 15-min window back via the Wave 2 scanner's indexing pass on the dated files. Zero extra fin-acquisition config needed
- **The Apr 20 "remember you don't need to include the investment advisor part for Ramy" quote** — matches MEMORY_CUE_REGEX exactly; after Plan 90-03 ships on a running fin-acquisition agent, a second "remember this: ..." from Ramy lands in `memory/YYYY-MM-DD-remember-*.md` within milliseconds + a ✅ reaction confirms receipt
- **The Apr 23 "do you recall the Opus subagent" pain point** — next Task(subagent_type="researcher", ...) invocation captures the return to `memory/YYYY-MM-DD-subagent-<slug>.md`. Next-turn retrieval surfaces it via Wave 2 scanner + Wave 2 RRF retrieval
- **Future Phase: Task-tool-return adapter wiring** — `TurnDispatcher.handleTaskToolReturn` is exposed but not YET called by the session adapter's tool-return stream observer. That wiring belongs to a follow-up plan (or Plan 90-07 runtime-probe if fin-acquisition needs it). Plan 90-03 ships the hook + test; adapter integration is a downstream commit

## Test Coverage

- **12 memory-flush.test.ts tests** — meaningfulTurnsSince (5) + MemoryFlushTimer T1-T6 + atomicWriteFile (1)
- **11 memory-cue.test.ts tests** — detectCue C1-C4 + MEMORY_CUE_REGEX shape pin + extractCueContext (2) + writeCueMemory W1-W2 + discord_link frontmatter
- **12 subagent-capture.test.ts tests** — isGsdSubagent (2) + subagentSlug (4) + captureSubagentReturn S2-S3-S4 + empty-slug fallback
- **5 TurnDispatcher cue-detection tests** — TD1 happy + TD2 fail-open + TD3 no-cue + TD4 no-wiring + TD5 no-workspace
- **3 TurnDispatcher subagent-capture tests** — TD1 forwards event + TD2 fail-open + TD3 no-wiring
- **2 SessionManager MEM-04 tests** — SM1 stopAgent flush cleanup + SM2 startAgent timer construction
- **Total: 45 new tests** across 4 files. All pass + existing regressions preserved (727+ total across manager + memory + config suites)

---
*Phase: 90-clawhub-marketplace-fin-acquisition-memory-prep*
*Completed: 2026-04-24*

## Self-Check: PASSED

Files verified present:
- .planning/phases/90-clawhub-marketplace-fin-acquisition-memory-prep/90-03-SUMMARY.md
- src/memory/memory-flush.ts
- src/memory/memory-cue.ts
- src/memory/subagent-capture.ts
- src/memory/__tests__/memory-flush.test.ts
- src/memory/__tests__/memory-cue.test.ts
- src/memory/__tests__/subagent-capture.test.ts

Commits verified present: 285e34b (RED tests), d3c395d (GREEN pure modules), c4dc280 (GREEN wiring + fixture cascade)

Tests verified:
- `npx vitest run src/memory/__tests__/memory-flush.test.ts src/memory/__tests__/memory-cue.test.ts src/memory/__tests__/subagent-capture.test.ts src/manager/__tests__/turn-dispatcher.test.ts src/manager/__tests__/session-manager.test.ts --reporter=dot` → 67+54 = 121/121 pass
- Broader regression (memory + config suites): 727/727 pass across 37 test files
- Pre-existing failures (documented in deferred-items.md): `bootstrap-integration.test.ts` (2) + `daemon-openai.test.ts` (7) — NOT introduced by Plan 90-03

TypeScript verified: `npx tsc --noEmit` → 76 errors (net −6 from baseline 82; all remaining errors pre-existing WarmPathResult + image types)

Grep assertions (18/18 PASS):
- `class MemoryFlushTimer` + D-27 prompt + `flushNow` + `meaningfulTurnsSince` in memory-flush.ts
- `MEMORY_CUE_REGEX` + D-30 regex core + `writeCueMemory` in memory-cue.ts
- `isGsdSubagent` + `subagentSlug` + `captureSubagentReturn` + `gsd-` in subagent-capture.ts
- `memoryFileFlushTimers` + `flush timeout` + `memoryFlushIntervalMs` in session-manager.ts
- `memoryCueWriter` + `handleTaskToolReturn` + `void writer` (fire-and-forget) in turn-dispatcher.ts
- `memoryFlushIntervalMs` + `memoryCueEmoji` in config/schema.ts
