---
phase: 96-discord-routing-and-file-sharing-hygiene
plan: 04
subsystem: file-sharing-hygiene
tags: [outputDir, token-resolver, di-pure, system-prompt-directive, openclaw-fallback, auto-upload-heuristic, error-classification, zod-schema]

# Dependency graph
requires:
  - phase: 96-01
    provides: FsCapabilitySnapshot type (used in share-file ShareFileDeps for boundary check) — referenced via type-only import for forward-compat; runtime wiring deferred to daemon edge
  - phase: 94-tool-reliability-self-awareness
    provides: clawcode_share_file Phase 94 plan 05 baseline (200 lines, 25MB limit, allowedRoots, webhook→bot fallback) — EXTENDED with D-09 outputDir + D-12 classification; wrapMcpToolError + 5-value ErrorClass enum (LOCKED — NOT extended); DEFAULT_SYSTEM_PROMPT_DIRECTIVES schema (Phase 94 plan 06)
  - phase: 91-openclaw-clawcode-fin-acquisition-workspace-sync
    provides: alert dedup primitive (admin-clawdy alert with throttling) — REUSED by D-10 dual-detector post-turn hook with DISTINCT dedup keys
  - phase: 83-effort-mapping
    provides: additive-optional schema blueprint — outputDir is the 11th application

provides:
  - resolveOutputDir DI-pure token resolver ({date}/{agent}/{channel_name}/{client_slug} expansion, agent-root anchoring, traversal-block, {client_slug} fallback to 'unknown-client' with warning)
  - DEFAULT_OUTPUT_DIR module-level export ('outputs/{date}/')
  - agentSchema.outputDir + defaultsSchema.outputDir Zod fields (11th additive-optional application)
  - DEFAULT_SYSTEM_PROMPT_DIRECTIVES['file-sharing'] text extended with BOTH D-10 blocks (auto-upload heuristic + OpenClaw-fallback prohibition)
  - resolveOutputDirTemplate loader helper (defaults+per-agent merge with token preservation; runtime expansion at write time)
  - clawcode_share_file extended (outputDir-aware path resolution + classifyShareFileError + 429-transient override)
  - classifyShareFileError pure helper (D-12 4-class taxonomy → Phase 94 5-value ErrorClass enum without enum drift)
  - detectMissedUpload + detectOpenClawFallback sibling pure helpers (post-turn DUAL detector)
  - MISSED_UPLOAD_PATTERN + OPENCLAW_FALLBACK_PATTERN + OPENCLAW_LEGITIMATE_ARCHIVE_PATTERN exported regex constants
  - AdminClawdyAlertFn type + DetectMissedUploadDeps + DetectOpenClawFallbackDeps
  - TurnDispatcherOptions.alertAdminClawdy + recentToolCallNames DI surfaces
  - TurnDispatcher.firePostTurnDetectors private hook wired into BOTH dispatch() + dispatchStream() (4 wire sites)
  - 10 ROD + 4 SCHOD + 8 NEW SF + 12 AUH = 34 new tests, plus 6 existing SF baseline → 40 share-file/output-dir tests + 6 SCHFA from 96-01 = 46 total

affects:
  - phase: 96-02 (system-prompt block) — share-file outputDir ctx and the directive text consumed by the assembler integration
  - phase: 96-03 (clawcode_list_files) — same alertAdminClawdy primitive surface; same Phase 94 ErrorClass enum invariant
  - phase: 96-05 (slash + CLI) — outputDir resolution feeds into /clawcode-status capability section future enhancement
  - phase: 96-07 (heartbeat scheduling) — RELOADABLE_FIELDS extension to include `outputDir` will follow the SCHFA-6 forward-looking pattern from 96-01

# Tech tracking
tech-stack:
  added: []   # zero new npm deps invariant preserved
  patterns:
    - "Pure-DI primitive composition (Phase 91/94/95/96-01 idiom): resolveOutputDir + classifyShareFileError + detectMissedUpload + detectOpenClawFallback all DI-pure modules with no SDK / node:fs / bare new Date()"
    - "11th additive-optional schema application (Phase 83-94 idiom): outputDir field; defaults default-bearing 'outputs/{date}/'; per-agent override; v2.5/v2.6 fixtures parse unchanged"
    - "Token-preservation invariant (Phase 96-01 idiom): schema preserves literal {date}/{agent}/{channel_name}/{client_slug} tokens; loader merges templates verbatim; runtime resolveOutputDir expands at write time with fresh ctx"
    - "Discriminated-union for error classification: classifyShareFileError returns {errorClass, suggestion} with errorClass in Phase 94 5-value enum (NO enum extension)"
    - "Sibling try/catch failure isolation: post-turn DUAL detector hook runs detectMissedUpload + detectOpenClawFallback in SEPARATE try/catch blocks so one detector failure cannot prevent the other from firing"
    - "Distinct dedup keys for independent throttling: 'missed-upload' vs 'openclaw-fallback' so they do not suppress each other in the Phase 91 alert dedup window"
    - "Negative-match exception pattern (D-10 OpenClaw): `archive/openclaw-sessions/` references skip the alert (legitimate archived-session reads, not anti-pattern fallback recommendations)"

key-files:
  created:
    - src/manager/resolve-output-dir.ts
    - src/manager/__tests__/resolve-output-dir.test.ts
    - src/manager/__tests__/auto-upload-heuristic.test.ts
    - src/config/__tests__/schema-outputDir.test.ts
  modified:
    - src/config/schema.ts (+DEFAULT_OUTPUT_DIR + agentSchema.outputDir + defaultsSchema.outputDir + DEFAULT_SYSTEM_PROMPT_DIRECTIVES['file-sharing'] D-10 text extension + configSchema defaults factory carries outputDir)
    - src/config/loader.ts (+resolveOutputDirTemplate helper)
    - src/manager/tools/clawcode-share-file.ts (+outputDir-aware path resolution + classifyShareFileError + 429-transient override + ShareFileDeps extended)
    - src/manager/turn-dispatcher.ts (+detectMissedUpload + detectOpenClawFallback + 3 regex constants + AdminClawdyAlertFn type + TurnDispatcherOptions extension + firePostTurnDetectors private hook + 4 hook wire sites in dispatch() + dispatchStream())
    - src/manager/__tests__/clawcode-share-file.test.ts (+8 NEW SF tests on top of Phase 94's 6 baseline)

key-decisions:
  - "Phase 94 5-value ErrorClass enum LOCKED — D-12 4-class taxonomy (size/missing/permission/transient) maps onto existing 5 values: size → unknown + 25MB-aware suggestion; missing → unknown + file-not-found suggestion; permission → permission verbatim; transient → transient verbatim. NO enum extension. Pinned by `! grep -E 'errorClass.*\"size\"|errorClass.*\"missing\"' src/manager/tools/clawcode-share-file.ts`."
  - "outputDir runtime resolution NOT loader resolution. Loader returns literal template ({date}/{client_slug} preserved); runtime resolveOutputDir(template, ctx, deps) expands per-call. Loader-time expansion would freeze {date} at config-load time (wrong on the second day) and would pin {client_slug} to load-time value (wrong across multiple client conversations)."
  - "D-10 directive text contains BOTH auto-upload heuristic AND OpenClaw-fallback prohibition blocks (verbatim from CONTEXT.md D-10 expanded 2026-04-25). Pinned by static-grep on schema.ts for both substrings."
  - "Sibling pure detectors with DISTINCT dedup keys — missed-upload + openclaw-fallback throttle independently. Consolidating into one detector would lose the distinct-priority semantics (HIGH vs soft) and distinct-throttle semantics."
  - "Negative-match exception for OpenClaw detector — archive/openclaw-sessions/ references are legitimate (operator workflow reading historical sessions; only fallback recommendations are the anti-pattern). Without this exception, every search agent that mentions the archive directory would emit a false-positive alert."
  - "Post-turn hook is non-blocking soft signal — sibling try/catch in firePostTurnDetectors ensures detector failures NEVER propagate to TurnDispatcher.dispatch return path. CLAUDE.md error-handling invariant + operator-debuggability (warn log includes per-detector failure)."
  - "429 → transient override at clawcode_share_file catch site — wrapMcpToolError's auto-classifier maps '429' → 'quota' (correct for API quota errors) but for upload retries the LLM should adapt with retry-after, not re-authenticate. Override to 'transient' is local to share-file and does NOT affect Phase 94's enum (still 5 values)."

patterns-established:
  - "Two-classifier reconciliation: Phase 96 share-file owns its own classification (per-class suggestion text), but wrapMcpToolError owns the auto-classification of errorClass. When they disagree (429 → quota vs transient), the share-file site overrides AT THE CATCH SITE only — Phase 94 wrapMcpToolError unchanged"
  - "Schema-first ordering hint (TDD discipline): complete schema + loader work BEFORE clawcode-share-file extension to keep TDD feedback loops tight. Each layer has isolated tests; finishing schema first lets the share-file extension reference the final schema constants"
  - "Forward-looking RELOADABLE_FIELDS pattern continues: outputDir not yet classified reloadable in Wave 2; SCHFA-6-style flip deferred to Wave 3 96-07 when config-watcher is wired"

requirements-completed: [D-09, D-10, D-12]

# Metrics
duration: 23min
completed: 2026-04-25
---

# Phase 96 Plan 04: Extend clawcode_share_file with outputDir resolution + D-10 directive + ToolCallError classification Summary

**Pure-DI resolveOutputDir D-09 token resolver + 11th additive-optional outputDir Zod schema + DEFAULT_SYSTEM_PROMPT_DIRECTIVES['file-sharing'] BOTH D-10 blocks (auto-upload + OpenClaw-fallback prohibition) + classifyShareFileError mapping D-12 4-class taxonomy onto Phase 94's locked 5-value enum + post-turn DUAL detector (missed-upload + openclaw-fallback sibling pure helpers) wired into TurnDispatcher.dispatch + dispatchStream — closes the agent-emits-local-paths gap AND the agent-recommends-OpenClaw-fallback anti-pattern surfaced by operator on 2026-04-25.**

## Performance

- **Duration:** ~23 min
- **Started:** 2026-04-25T19:28:55Z
- **Completed:** 2026-04-25T19:52:45Z
- **Tasks:** 3 (all 3 committed atomically — RED + GREEN per TDD)
- **Files created:** 4 (1 module + 3 test files)
- **Files modified:** 5 (3 production + 1 share-file test extension + 1 turn-dispatcher)
- **Tests:** 34 NEW (10 ROD + 4 SCHOD + 8 NEW SF + 12 AUH) on top of 6 existing SF baseline = 40 share-file/output-dir green; 6 SCHFA-* from 96-01 still green = 46 phase-96 tests total

## Accomplishments

- **D-09 outputDir 11th additive-optional schema landed:** `outputDir` field on `agentSchema` + `defaultsSchema`. Default `'outputs/{date}/'`. Per-agent override (e.g. fin-acquisition: `'clients/{client_slug}/{date}/'`). Tokens preserved verbatim through schema + loader; runtime expansion at write time keeps `{date}` fresh per call.
- **resolveOutputDir DI-pure runtime resolver:** 4 tokens ({date} → YYYY-MM-DD via toISOString, {agent}, {channel_name}, {client_slug}). Path traversal blocked (no `..`, no leading `/` after expansion). Defense-in-depth clamp: resolved path that escapes agentWorkspaceRoot is clamped back to root with warning. {client_slug} fallback to `'unknown-client'` with operator-actionable warning.
- **D-10 system-prompt directive text extended verbatim:** `DEFAULT_SYSTEM_PROMPT_DIRECTIVES['file-sharing'].text` now contains 3 paragraphs:
  1. Phase 94 D-09 baseline (ALWAYS upload via Discord; NEVER tell the user a local path)
  2. Phase 96 D-10 auto-upload heuristic (artifact reference vs Q&A about content)
  3. Phase 96 D-10 OpenClaw-fallback prohibition (added 2026-04-25 after operator surfaced anti-pattern in #finmentum-client-acquisition)
- **D-12 classifyShareFileError pure helper:** maps 4-class taxonomy (size/missing/permission/transient) onto Phase 94's locked 5-value ErrorClass enum (transient | auth | quota | permission | unknown). `size` and `missing` map to `unknown` with rich per-class suggestion text; `permission` and `transient` use existing enum values directly. NO enum extension — Pitfall 3 + Pitfall 7 from RESEARCH.md honored. Per-class suggestion text verbatim from CONTEXT.md ("Discord limit is 25MB — compress or split", "file not found at /path/X — verify the path and re-run", "retry in 30s").
- **D-10 post-turn DUAL detector hook:** `detectMissedUpload` + `detectOpenClawFallback` sibling pure helpers wired into `TurnDispatcher.firePostTurnDetectors` private hook, invoked at every successful `dispatch()` + `dispatchStream()` return. Each detector wrapped in its OWN try/catch (failure in one cannot prevent the other). Distinct dedup keys (`'missed-upload'` vs `'openclaw-fallback'`) so they throttle independently via Phase 91 alert primitive. Negative-match exception for `archive/openclaw-sessions/` references (legitimate operator workflow, not anti-pattern fallback).
- **Zero new npm deps preserved:** `git diff package.json` empty.

## Task Commits

Each task RED + GREEN committed atomically with `--no-verify` (parallel executor agent — Wave 2 of 3 alongside 96-02 + 96-03):

1. **Task 1 RED — failing tests for resolveOutputDir D-09 token resolver** — `e787675` (test)
   - 10 ROD- tests pinning all 4 tokens, traversal block, {client_slug} fallback, immutability
   - RED gate: `Cannot find module '../resolve-output-dir.js'`

2. **Task 1 GREEN — implement resolveOutputDir** — `e0e561c` (feat)
   - Pure-fn token resolver with date format YYYY-MM-DD, {client_slug} → 'unknown-client' fallback + warning, traversal block, agent-root anchoring, defense-in-depth clamp
   - 10 ROD- tests pass; DI-purity static-grep pin holds

3. **Task 2 RED — failing tests for outputDir schema + share-file D-09/D-12** — `a8489d8` (test)
   - 4 SCHOD- tests pinning 11th additive-optional schema + DEFAULT_SYSTEM_PROMPT_DIRECTIVES BOTH D-10 substrings
   - 8 NEW SF- tests on top of Phase 94's 6 baseline pinning outputDir relative-path resolution, absolute-path passthrough, classified errors (size/missing → unknown; permission → permission; transient → transient), directive text, NO enum drift
   - RED gate: schema fields missing + DEFAULT_OUTPUT_DIR + extended directive text + classifyShareFileError absent

4. **Task 2 GREEN — outputDir 11th additive-optional schema + D-10 directive text + classifyShareFileError** — `962eae1` (feat)
   - schema.ts: DEFAULT_OUTPUT_DIR const + agentSchema.outputDir optional + defaultsSchema.outputDir default-bearing + DEFAULT_SYSTEM_PROMPT_DIRECTIVES['file-sharing'] BOTH D-10 blocks (verbatim) + configSchema defaults factory carries outputDir
   - loader.ts: resolveOutputDirTemplate(agent, cfg, defaults) — defaults+override merge with token preservation
   - clawcode-share-file.ts: ShareFileDeps + outputDirTemplate + agentWorkspaceRoot + resolveCtx; isAbsolute-aware path resolution branch; classifyShareFileError pure helper; 429 → transient override at catch site
   - 14 share-file tests + 4 schema tests + 10 resolve-output-dir tests + 6 SCHFA from 96-01 = 34 green

5. **Task 3 RED — failing tests for D-10 post-turn DUAL detector** — `ca1e72b` (test)
   - 6 AUH- tests for detectMissedUpload (PDF/generated/attached/Q&A/already-shared/throttled)
   - 4 AUH-OPENCLAW- tests for detectOpenClawFallback (side/agent match + archive negative + throttle)
   - 2 regex-pattern tests for exported constants
   - RED gate: detectMissedUpload + detectOpenClawFallback + MISSED_UPLOAD_PATTERN + OPENCLAW_FALLBACK_PATTERN absent

6. **Task 3 GREEN — post-turn DUAL detector hook (missed-upload + openclaw-fallback)** — `731e72e` (feat)
   - turn-dispatcher.ts: 3 regex constants + 2 sibling pure helpers + AdminClawdyAlertFn type + DetectMissedUploadDeps/DetectOpenClawFallbackDeps + TurnDispatcherOptions.alertAdminClawdy + recentToolCallNames + firePostTurnDetectors private hook with sibling try/catch + 4 wire sites in dispatch() + dispatchStream() (caller-owned + dispatcher-opened Turn for each method)
   - 12 AUH tests pass; non-blocking pin appears 7 times (sibling try/catch + log lines); distinct dedup keys verified

**Plan metadata:** _(this commit)_

## Files Created/Modified

### Created (NEW DI-pure module + tests)
- `src/manager/resolve-output-dir.ts` — D-09 pure-fn token resolver (4 tokens; agent-root anchoring; traversal-block + defense-in-depth clamp; {client_slug} fallback)
- `src/manager/__tests__/resolve-output-dir.test.ts` — 10 ROD- tests
- `src/manager/__tests__/auto-upload-heuristic.test.ts` — 12 tests (6 missed-upload + 4 OpenClaw-fallback + 2 regex-pattern)
- `src/config/__tests__/schema-outputDir.test.ts` — 4 SCHOD- tests (11th additive-optional + D-10 directive text)

### Modified (production)
- `src/config/schema.ts` — +DEFAULT_OUTPUT_DIR const + agentSchema.outputDir optional + defaultsSchema.outputDir default-bearing + DEFAULT_SYSTEM_PROMPT_DIRECTIVES['file-sharing'] D-10 text extension (BOTH auto-upload + OpenClaw-fallback prohibition blocks) + configSchema defaults factory carries outputDir
- `src/config/loader.ts` — +resolveOutputDirTemplate helper (defaults+override merge; token preservation; runtime expansion deferred)
- `src/manager/tools/clawcode-share-file.ts` — EXTENDED Phase 94 plan 05 baseline:
  - ShareFileDeps + outputDirTemplate + agentWorkspaceRoot + resolveCtx
  - isAbsolute path branch — relative paths anchored under resolveOutputDir
  - classifyShareFileError pure helper (D-12 4-class → Phase 94 5-value enum)
  - wrapShareFileError centralizes wrapMcpToolError + suggestion injection
  - 429 → transient override at catch site (wrapMcpToolError says 'quota'; LLM-side semantics demand 'transient' for upload retries)
- `src/manager/turn-dispatcher.ts` — +3 regex constants (MISSED_UPLOAD_PATTERN + OPENCLAW_FALLBACK_PATTERN + OPENCLAW_LEGITIMATE_ARCHIVE_PATTERN) + AdminClawdyAlertFn type + DetectMissedUploadDeps/DetectOpenClawFallbackDeps + 2 sibling pure helpers (detectMissedUpload + detectOpenClawFallback) + TurnDispatcherOptions.alertAdminClawdy + recentToolCallNames DI surfaces + firePostTurnDetectors private hook + 4 wire sites in dispatch() + dispatchStream()

### Modified (test extension)
- `src/manager/__tests__/clawcode-share-file.test.ts` — +8 NEW SF- tests on top of Phase 94's 6 baseline (SF-OUTPUT-RELATIVE / SF-OUTPUT-ABSOLUTE-PASSTHROUGH / SF-CLASSIFY-SIZE / SF-CLASSIFY-MISSING / SF-CLASSIFY-PERMISSION / SF-CLASSIFY-TRANSIENT / SF-DIRECTIVE-IN-PROMPT / SF-NO-ENUM-DRIFT)

## Decisions Made

All decisions documented in frontmatter `key-decisions`. The most consequential:

1. **Phase 94 5-value ErrorClass enum NOT EXTENDED.** D-12 4-class taxonomy (size/missing/permission/transient) maps onto existing 5 values via classifyShareFileError. `size` and `missing` map to `unknown` with rich per-class suggestion text. `permission` and `transient` use existing enum values verbatim. Pinned by `! grep -E 'errorClass.*"size"|errorClass.*"missing"' src/manager/tools/clawcode-share-file.ts`. Adding a 6th value would cascade through Phase 94 plans 04/05/07 consumers.

2. **outputDir runtime expansion, NOT loader expansion.** Loader returns literal template ({date}/{client_slug} preserved); runtime resolveOutputDir(template, ctx, deps) expands per call with fresh ctx. Loader-time expansion would freeze {date} at config-load time (wrong on the second day).

3. **Sibling pure detectors with DISTINCT dedup keys.** detectMissedUpload + detectOpenClawFallback share the same alert primitive but use 'missed-upload' vs 'openclaw-fallback' dedup keys so they throttle independently. Sibling try/catch isolation in firePostTurnDetectors ensures one detector failure cannot prevent the other from firing.

4. **Negative-match exception for OpenClaw detector.** `archive/openclaw-sessions/` references are legitimate operator workflows (reading historical sessions). Only fallback recommendations are the anti-pattern. Without this exception, every search agent that mentions the archive directory would emit a false-positive alert.

5. **429 → transient override at clawcode_share_file catch site.** wrapMcpToolError's auto-classifier maps '429' → 'quota' (correct for API quota errors). For upload retries, the LLM should adapt with retry-after, not re-authenticate. Override is local to share-file (post-wrap rewrite via Object.freeze + spread) and does NOT affect Phase 94's enum.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Working-tree contention with parallel agents (96-02 + 96-03)**
- **Found during:** Task 2 GREEN execution — three rapid working-tree resets where my Edit calls to schema.ts, loader.ts, and clawcode-share-file.ts were silently reverted.
- **Issue:** Wave 2 runs three parallel executor agents (96-02, 96-03, 96-04). When 96-02 or 96-03 completed a commit cycle, my uncommitted edits to schema.ts/loader.ts/clawcode-share-file.ts were wiped from working tree (likely a `git stash`/checkout/restore from another agent's session-config.ts work that overlapped my files). Tests passing during the brief window after Edit but before the parallel-agent reset gave a false signal of GREEN.
- **Fix:** Recovery protocol — after each Edit batch, immediately stage + commit before yielding control. Three Edit-then-IMMEDIATE-COMMIT cycles for Task 2 GREEN ultimately succeeded once parallel agents had completed (a095726 + 38cfd84 commits visible after my Task 2 commit). Subsequent Task 3 work was unaffected. Verified all changes are persisted post-commit via `grep -c` checks on the actual files.
- **Files affected:** src/config/schema.ts, src/config/loader.ts, src/manager/tools/clawcode-share-file.ts (my work) — restored cleanly. src/manager/session-config.ts, src/manager/__tests__/clawcode-list-files.test.ts, src/manager/context-assembler.ts (96-02/03 work) — left untouched per parallel_execution scope rule (96-04 does NOT modify those files).
- **Verification:** Final state — all Task 2 acceptance pins green via static-grep; all 46 plan-04 tests pass.
- **Committed in:** 962eae1 (Task 2 GREEN)

**2. [Rule 1 — Bug] vitest reports pre-existing shared-workspace integration test timeout under heavy parallel-test load**
- **Found during:** Running full `src/config/__tests__/` suite (315 tests) for regression check after Task 2 GREEN.
- **Issue:** `src/config/__tests__/shared-workspace.integration.test.ts > SHARED-02 > memories inserted into agent A do not appear in agent B (tag query)` and `> SHARED-03 > 5 agents maintain full pairwise memory isolation` time out at 20s under concurrent parallel-agent test load. Tests pass when run in isolation. Phase 75-03 added them on 2026-04-23 — pre-date Phase 96 entirely.
- **Fix:** Per scope-boundary rule, NOT in scope for 96-04. Logged to `.planning/phases/96-discord-routing-and-file-sharing-hygiene/deferred-items.md` for Phase 75 perf/concurrency hardening team to address.
- **Verification:** Confirmed the test was added in Phase 75-03 commit `bf62842` (2026-04-23) and not modified since. Not introduced by my changes.
- **Committed in:** logged via deferred-items.md (no production-code change)

---

**Total deviations:** 2 (1 operational/scoped recovery + 1 deferred out-of-scope flake)
**Impact on plan:** Auto-recovery from working-tree contention added ~5 minutes to plan duration but did not require any plan changes. Pre-existing shared-workspace flake is out of scope and logged for Phase 75 followup.

## Issues Encountered

**1. Working-tree contention with parallel agents.** As documented in deviation #1 above. The Wave 2 parallel-execution model has an implicit contention surface: agents that do `git stash`/`stash pop` cycles can briefly clobber another agent's uncommitted edits if the stash spans files outside both agents' explicit scopes. Not a bug in any single agent — emerges from the wave-coordination model. **Mitigation for future parallel waves:** commit after every meaningful Edit batch instead of accumulating multiple file edits before commit; this minimizes the contention window.

**2. Phase 94 wrapMcpToolError errorClass auto-classification disagrees with D-12 for 429 case.** wrapMcpToolError sees "429" / "rate limit" tokens and classifies as `quota`. D-12 says upload-time 429 should be `transient` (LLM should retry, not authenticate). Resolved via post-wrap override at the share-file catch site (Object.freeze + spread, errorClass overridden to 'transient'). This is local to share-file and does NOT affect Phase 94's enum. **Note for Phase 96-03 + 96-05:** the same pattern (post-wrap errorClass override) may be needed for clawcode_list_files if its boundary check produces 429-like errors — currently not anticipated, but flag if encountered.

## User Setup Required

None — no external service configuration required. All artifacts are in-repo.

## Next Phase Readiness

**Ready for downstream consumers:**
- 96-02 system-prompt block: directive text consumed via DEFAULT_SYSTEM_PROMPT_DIRECTIVES; outputDir ctx may inform optional capability-block hints
- 96-03 clawcode_list_files: reuses Phase 94 ErrorClass enum (LOCKED — same invariant)
- 96-05 slash + CLI: outputDir resolution surface available for /clawcode-status capability section
- 96-07 heartbeat scheduling: forward-looking RELOADABLE_FIELDS pattern from 96-01 SCHFA-6 will flip outputDir to reloadable when config-watcher is wired

**Blockers for current phase:** None. The 11th additive-optional schema + DI-pure surface + post-turn DUAL detector are stable contracts.

**Concerns:**
- Pre-existing shared-workspace integration test timeout under parallel-test load (logged to deferred-items.md; Phase 75 followup)
- The 429-transient override is a localized post-wrap rewrite; if Phase 94 ever extends wrapMcpToolError with per-call errorClass override support, the override block should migrate to that surface for cleaner separation of concerns

## Self-Check: PASSED

**Created files exist:**
- FOUND: src/manager/resolve-output-dir.ts
- FOUND: src/manager/__tests__/resolve-output-dir.test.ts
- FOUND: src/manager/__tests__/auto-upload-heuristic.test.ts
- FOUND: src/config/__tests__/schema-outputDir.test.ts

**Commits exist:**
- FOUND: e787675 (Task 1 RED — resolveOutputDir tests)
- FOUND: e0e561c (Task 1 GREEN — resolveOutputDir impl)
- FOUND: a8489d8 (Task 2 RED — outputDir schema + share-file extension tests)
- FOUND: 962eae1 (Task 2 GREEN — schema/loader/share-file extension)
- FOUND: ca1e72b (Task 3 RED — DUAL detector tests)
- FOUND: 731e72e (Task 3 GREEN — DUAL detector + hook wiring)

**All tests pass:**
- 34 NEW tests + 6 existing SF baseline = 40 share-file/output-dir green
- 6 SCHFA from 96-01 still green = 46 total Phase 96 plan 04-relevant tests
- Zero new npm deps confirmed (`git diff package.json` empty across all 6 plan commits)

**Static-grep regression pins:**
- FOUND: `grep -q "outputDir: z.string"` src/config/schema.ts
- FOUND: `grep -q "DEFAULT_OUTPUT_DIR"` src/config/schema.ts
- FOUND: `grep -q "When you produce a file the user wants to access"` src/config/schema.ts
- FOUND: `grep -q "NEVER recommend falling back to the legacy OpenClaw agent"` src/config/schema.ts
- FOUND: `grep -q "OpenClaw is being deprecated"` src/config/schema.ts
- ABSENT (locked): `! grep -E 'errorClass.*"size"|errorClass.*"missing"'` src/manager/tools/clawcode-share-file.ts
- FOUND: `grep -q "Discord limit is 25MB"` src/manager/tools/clawcode-share-file.ts
- FOUND: `grep -q "file not found"` src/manager/tools/clawcode-share-file.ts
- FOUND: `grep -q "retry in 30s"` src/manager/tools/clawcode-share-file.ts
- FOUND: `grep -q "detectMissedUpload\|detectOpenClawFallback"` src/manager/turn-dispatcher.ts
- FOUND: `grep -q "openclaw.*side\|spawn.*subagent.*openclaw"` src/manager/turn-dispatcher.ts
- FOUND: `grep -q "missed-upload"` src/manager/turn-dispatcher.ts
- FOUND: `grep -q "openclaw-fallback"` src/manager/turn-dispatcher.ts
- FOUND: `grep -q "non-blocking"` src/manager/turn-dispatcher.ts (count=7, ≥2 required)
- ABSENT (DI-purity): `! grep -E 'from "node:fs|from "@anthropic-ai/claude-agent-sdk'` src/manager/resolve-output-dir.ts

---
*Phase: 96-discord-routing-and-file-sharing-hygiene*
*Plan: 04*
*Completed: 2026-04-25*
