---
phase: 95-memory-dreaming-autonomous-reflection-and-consolidation
plan: 02
subsystem: memory
tags: [dreaming, auto-apply, atomic-write, croner, idle-gate, additive-only, memorymd-invariant]

# Dependency graph
requires:
  - phase: 95-01
    provides: runDreamPass primitive, DreamPassOutcome 3-variant union, isAgentIdle gate, DreamResult schema
  - phase: 91-continuous-sync
    provides: atomic temp+rename pattern (mirrored from src/sync/sync-state-store.ts)
  - phase: 52-prompt-caching
    provides: per-agent croner factory pattern (mirrored from src/manager/daily-summary-cron.ts)
  - phase: 36-knowledge-graph-foundation
    provides: auto-linker function shape (DI'd via structural type — Plan 95-03 daemon edge wires to actual link applier)
provides:
  - applyDreamResult(agentName, outcome, deps) — additive-only auto-applier (newWikilinks fire; rest SURFACE)
  - DreamApplyOutcome 3-variant discriminated union (applied | skipped | failed)
  - writeDreamLog({agentName, memoryRoot, entry}) — atomic markdown emission with same-day section append
  - renderDreamLogSection(entry) — pure renderer for D-05 verbatim markdown template
  - registerDreamCron(deps) — opt-in per-agent croner schedule with idle-gate dispatch
affects:
  - 95-03-cli-and-discord (consumes DreamApplyOutcome for `clawcode dream` stdout JSON + /clawcode-dream EmbedBuilder; daemon-edge IPC handler chains runDreamPass → applyDreamResult identically to the cron tick)

# Tech tracking
tech-stack:
  added: []  # zero new npm deps
  patterns:
    - "9th application of atomic temp+rename pattern (Phase 84/91/95-02 lineage — mirrors src/sync/sync-state-store.ts)"
    - "Per-agent croner factory pattern (mirrors src/manager/daily-summary-cron.ts; DI cronFactory for synchronous trigger in tests)"
    - "Pure-DI primitives + production wired at daemon edge (Phase 91/94/95 idiom)"
    - "Discriminated-union outcome (DreamApplyOutcome — 3 variants per Phase 84/86/88/90/92/94/95-01 lineage)"

key-files:
  created:
    - src/manager/dream-auto-apply.ts (170 lines) — applyDreamResult + DreamApplyOutcome
    - src/manager/dream-log-writer.ts (189 lines) — writeDreamLog + renderDreamLogSection + atomic temp+rename
    - src/manager/dream-cron.ts (150 lines) — registerDreamCron + DreamCronFactory + cron tick handler
    - src/manager/__tests__/dream-auto-apply.test.ts (220 lines, 8 tests)
    - src/manager/__tests__/dream-log-writer.test.ts (251 lines, 8 tests including L5b bonus)
    - src/manager/__tests__/dream-cron.test.ts (252 lines, 7 tests)
  modified: []

key-decisions:
  - "DreamApplyOutcome locked to 3 variants (applied | skipped | failed) — mirrors DreamPassOutcome from Plan 95-01; downstream Plan 95-03 CLI / Discord renderer can match exhaustively"
  - "Same-day file behavior is APPEND (not overwrite) — second pass on the same date reads the existing file, appends a new ## section preserving prior content. Pinned by L2 (multiple sections) + appended:true return contract"
  - "writeDreamLog failure does NOT roll back applyAutoLinks — wikilinks are persisted on a best-effort basis; the operator surfaces the missing log via the structured error message (kind:'failed', error: 'dream-log-write-failed: ...'). Test A7 pins this no-rollback semantics"
  - "Cron pattern literal `*/${idleMinutes} * * * *` — every N minutes from minute 0 (NOT 'at minute N of every hour'). Pinned by C2 test"
  - "Schedule label='dream' literal — visible in /clawcode-status schedule list per D-06; pinned by C6 test + grep regression rule"
  - "Auto-linker DI shape stays purely structural ({applyAutoLinks: (agent, [{from,to}]) => Promise<{added}>}) — Plan 95-03 will write the thin adapter at the daemon edge that maps to discoverAutoLinks(memoryStore) or whatever the production wiring needs. The primitive imports nothing from the auto-linker module"
  - "registerDreamCron mirrors src/manager/daily-summary-cron.ts pattern (DI cronFactory + thin Cron wrapper) — NOT the heartbeat runner pattern (which uses setInterval). Plan referred to a non-existent agent-bootstrap.ts file; closest existing idiom in the codebase is daily-summary-cron.ts"

patterns-established:
  - "9th atomic temp+rename application — D-05 dream log writer mirrors Phase 91 sync-state-store.ts (writeFile to .tmp.<nonce> + rename + best-effort unlink on failure)"
  - "Per-agent cron with DI factory — second application of the daily-summary-cron.ts pattern (cronFactory: (pattern, opts, callback) => {stop()}); enables synchronous trigger in tests via stub factory + fully real Cron timing in production"
  - "Same-day append semantics — read existing file, trimEnd + '\\n\\n' + new section, atomic replace. Pattern reusable for any daily-bucketed log (could be applied to JSONL replacements or per-day audit logs)"

requirements-completed: [DREAM-04, DREAM-05, DREAM-06]

# Metrics
duration: ~24min
started: 2026-04-25T07:33:44Z
completed: 2026-04-25T07:57:53Z
---

# Phase 95 Plan 02: Dream Auto-Apply + Log Writer + Cron Timer Summary

**Additive-only auto-apply pipeline (newWikilinks fire via DI'd applyAutoLinks; promotionCandidates + suggestedConsolidations + themedReflection SURFACE via atomic-temp+rename markdown dream log) wired to an opt-in per-agent croner schedule that consults isAgentIdle on every tick — MEMORY.md operator-curated invariant pinned by static-grep, 9th application of the Phase 84/91 atomic-temp+rename pattern.**

## Performance

- **Duration:** ~24 min
- **Started:** 2026-04-25T07:33:44Z (RED test scaffolding)
- **Completed:** 2026-04-25T07:57:53Z (after Task 2 GREEN + pin verification + summary)
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files created:** 6 (3 production + 3 test, 1232 lines total)
- **Files modified:** 0
- **Tests added:** 23 (8 auto-apply + 8 log-writer including L5b bonus + 7 cron — all green)

## Accomplishments

- DREAM-04 closed: `applyDreamResult` is the additive-only auto-applier — `newWikilinks` flow into `deps.applyAutoLinks(agent, [{from,to}])`, `promotionCandidates` + `suggestedConsolidations` flow into the dream log for operator review, `themedReflection` lands as a free-form bullet in the same log. The deps surface deliberately omits any `applyPromotion` or `applyConsolidation` field — the surfacing-only invariant is pinned at the type level (test A5).
- DREAM-05 closed: `writeDreamLog` emits markdown to `<memoryRoot>/dreams/YYYY-MM-DD.md` via `<finalPath>.tmp.<8-hex-nonce>` + atomic rename + best-effort unlink on failure. Same-day re-runs read the existing file, append a new `## [HH:MM UTC] Dream pass` section preserving prior content byte-for-byte (modulo trailing-whitespace normalization). The renderer hits the D-05 verbatim sample (themed reflection, new wikilinks with `from → to`, promotion candidates with literal "consider promoting" + "operator review" surfacing, suggested consolidations with `sources joined "+"`, cost+duration footer).
- DREAM-06 closed: `registerDreamCron` schedules `*/${idleMinutes} * * * *` per agent (cron factory DI'd so tests trigger synchronously). Every tick consults `isAgentIdle`; on `idle=true` (either `idle-threshold-met` or `idle-ceiling-bypass` reason), fires `runDreamPass` → `applyDreamResult`. On `idle=false` (`active` reason), emits a structured skip log and returns. Schedule label `dream` flows through to /clawcode-status. Disabled fleet-wide by default — opt-in via `agents.*.dream.enabled: true`.
- MEMORY.md operator-curated invariant pinned at multiple layers: (1) static-grep regression rule `! grep -E "writeFile.*MEMORY\.md|appendFile.*MEMORY\.md" src/manager/dream-*.ts` PASSES; (2) test A8 inspects the rendered markdown for the literal phrases "consider promoting" and "operator review" (promotion candidates SURFACE only); (3) `ApplyDreamResultDeps` has no field that would let the auto-applier write to MEMORY.md.

## Task Commits

1. **Task 1 (RED): test scaffolding** — `cb50a10` (test) — 22 tests across 3 new files; all fail with module-not-found (clean RED)
2. **Task 2 (GREEN): primitives** — `c059fdc` (feat) — 3 production modules (170+189+150 lines) + L3/L4 test refactor for ESM-spy limitation; 23 tests pass (extra L5b empty-section bonus); build clean; all 7 static-grep pins hold; zero new npm deps

**Plan metadata:** [pending — created at end of execution]

## Files Created/Modified

- `src/manager/dream-auto-apply.ts` (170 lines) — `applyDreamResult` + `DreamApplyOutcome` 3-variant union; pure-DI; `applyAutoLinks` is a structural type so the daemon edge can adapt to the actual Phase 36-41 link applier signature without re-shaping the primitive
- `src/manager/dream-log-writer.ts` (189 lines) — `writeDreamLog` (atomic temp+rename + same-day append) + `renderDreamLogSection` (pure renderer matching D-05 verbatim sample) + `DreamLogEntry` type + atomic-write helper using `crypto.randomBytes(4).toString('hex')` for the tmp nonce
- `src/manager/dream-cron.ts` (150 lines) — `registerDreamCron` + `DreamCronFactory` (DI'd for synchronous test triggering) + `DEFAULT_DREAM_CRON_FACTORY` (production: thin wrapper over `new Cron(pattern, {name}, async cb)`)
- `src/manager/__tests__/dream-auto-apply.test.ts` (220 lines, 8 tests) — A1..A8 covering completed/skipped/failed outcomes, empty-newWikilinks edge, surfacing invariant, applyAutoLinks-throws path, writeDreamLog-throws-after-applied path, MEMORY.md invariant via renderer inspection
- `src/manager/__tests__/dream-log-writer.test.ts` (251 lines, 8 tests) — L1..L7 + L5b covering create/append/tmp+rename via filesystem-state observation (L3) + rename-failure cleanup (L4 forces rename failure by pre-creating finalPath as a directory) + verbatim D-05 markdown match + empty-section `_(none)_` rendering + zero-padded HH:MM UTC + zero-padded YYYY-MM-DD bucket
- `src/manager/__tests__/dream-cron.test.ts` (252 lines, 7 tests) — C1..C7 covering disabled-skip / cron-pattern / idle-active-skip / idle-threshold-met-fire / idle-ceiling-bypass-fire / label-literal / unregister-stops-cron

## Decisions Made

See key-decisions in frontmatter. Three load-bearing for downstream:

1. **Same-day APPEND, not OVERWRITE** — second pass on the same day adds a new `## [HH:MM UTC]` section while keeping the first section's content intact. A naive `writeFile(path, header + section)` would silently destroy prior dreams. Test L2 pins both sections present + header appears exactly once. Plan 95-03's manual `clawcode dream <agent>` trigger inherits this: the operator can dream multiple times in a day for diagnostic reasons without losing the cron-fired sections.
2. **No rollback on log-write failure after successful applyAutoLinks** — operator-trust reasoning is that the wikilinks themselves are valuable on their own (additive, idempotent, safe). Forcing a roll-back would require an `unapplyAutoLinks` symmetric path that the auto-linker doesn't expose. Test A7 pins this; the structured error message `dream-log-write-failed: <verbatim>` surfaces the lost log to the operator for diagnosis.
3. **DI-structural auto-linker shape** — `ApplyDreamResultDeps.applyAutoLinks: (agent, [{from,to}]) => Promise<{added}>`. The actual Phase 36-41 link applier (`discoverAutoLinks(memoryStore)`) doesn't take LLM-suggested pairs directly. Plan 95-03's daemon-edge wiring writes the thin adapter that takes the LLM pairs and either (a) inserts them directly into the graph store, or (b) treats them as bias signals for the next discoverAutoLinks pass. The primitive stays decoupled from that decision.

## Deviations from Plan

### Auto-fixed (Rule 3 — blocking issue: file paths in plan don't exist)

**1. [Rule 3 — Blocking] Created `src/manager/dream-cron.ts` instead of modifying `src/manager/agent-bootstrap.ts`**
- **Found during:** Task 1 (test scaffolding) — Read tool returned "File does not exist" for `src/manager/agent-bootstrap.ts`
- **Issue:** Plan 95-02 frontmatter listed `src/manager/agent-bootstrap.ts` as a `files_modified` target with the cron registration to live alongside an existing heartbeat cron. The repo has no such file. The closest pattern donor is `src/manager/daily-summary-cron.ts` (a standalone module wired into the daemon at startup with a DI'd cron factory). The heartbeat runner (`src/heartbeat/runner.ts`) uses `setInterval`, not `croner` — different idiom.
- **Fix:** Created `src/manager/dream-cron.ts` mirroring the `daily-summary-cron.ts` pattern. Exports `registerDreamCron`, `DreamCronDeps`, `DreamCronFactory`, `DreamCronHandle`, `DreamCronRegistration`. Production wiring at the daemon edge is deferred to Plan 95-03 (alongside the IPC handler that bridges to `TurnDispatcher.dispatch` for `runDreamPass`). All 7 cron tests (C1..C7) target the new module.
- **Impact on Plan 95-03:** None — Plan 95-03 imports `registerDreamCron` from `src/manager/dream-cron.js` rather than `agent-bootstrap.js`. The daemon-startup wiring step that would have been in agent-bootstrap.ts moves to wherever Plan 95-03 places its daemon-edge wiring (most likely a new `src/manager/dream-bootstrap.ts` or inline in `src/manager/daemon.ts`).
- **Files modified:** None (created new module instead)
- **Commit:** `c059fdc` (Task 2 GREEN — production modules)

**2. [Rule 3 — Blocking] `src/memory/auto-linker.ts` does not exist; auto-linker lives at `src/heartbeat/checks/auto-linker.ts` with a different signature**
- **Found during:** Task 1 — verifying the auto-linker DI shape
- **Issue:** Plan 95-02 referred to `src/memory/auto-linker.ts`'s `applyAutoLinks(agent, links)`. The actual auto-linker is `src/heartbeat/checks/auto-linker.ts` which wraps `discoverAutoLinks(memoryStore)` from `src/memory/similarity.ts` — that function doesn't accept LLM-suggested {from,to} pairs; it discovers links from the existing memory chunks via embedding similarity.
- **Fix:** Per Plan 95-02's "Auto-linker adapter" guidance ("if Phase 36-41's exported applyAutoLinks signature differs ... add a thin adapter at the daemon edge ... dream-auto-apply.ts itself depends on the structural type DI'd through ApplyDreamResultDeps — never imports auto-linker.ts directly"), kept the DI surface as a structural type. The thin adapter is deferred to Plan 95-03's daemon-edge wiring.
- **Impact on Plan 95-03:** Plan 95-03 needs to write the `applyAutoLinks` adapter — it can either (a) directly insert the LLM pairs into the graph store via `memoryStore.addLink(from, to)` (if such a method exists) or (b) drop the LLM pairs into a bias buffer that the next `discoverAutoLinks` pass consumes. Either path is straightforward; the choice doesn't affect the primitive.
- **Files modified:** None (DI-structural shape kept as planned)
- **Commit:** `c059fdc`

### Auto-fixed (Rule 1 — bug: ESM spy limitation)

**3. [Rule 1 — Bug] L3/L4 tests rewritten to avoid `vi.spyOn(fs/promises)` (ESM module-namespace not configurable)**
- **Found during:** Task 2 GREEN — first run of dream-log-writer tests
- **Issue:** L3 and L4 tests originally tried `vi.spyOn(fsPromises, "writeFile")` and `vi.spyOn(fsPromises, "rename")`. Vitest under ESM throws `TypeError: Cannot redefine property: writeFile` because the `node:fs/promises` module-namespace exports are non-configurable. (See https://vitest.dev/guide/browser/#limitations.)
- **Fix:** Refactored to behavior-based filesystem-state observation: L3 verifies the final file exists with correct content AND no `.tmp.*` siblings linger after success. L4 forces a rename failure by pre-creating the target final-path AS A DIRECTORY (with a `.keep` file inside so it can't be replaced); the rename fails with EEXIST/EISDIR, the test verifies the rejection AND that no `.tmp.*` files linger after the failure path. This validates the same atomic+cleanup behavior pinned by the original spy approach.
- **Test count impact:** Net zero — both tests still cover the L3/L4 behavior; one bonus L5b test was added during the refactor pass for empty-section `_(none)_` coverage (so the file ended at 8 tests instead of the planned 7).
- **Files modified:** `src/manager/__tests__/dream-log-writer.test.ts`
- **Commit:** `c059fdc`

## Static-grep regression pins (all hold)

1. `! grep -E "writeFile.*MEMORY\.md|appendFile.*MEMORY\.md" src/manager/dream-auto-apply.ts src/manager/dream-log-writer.ts src/manager/dream-cron.ts` — **PASS** (MEMORY.md operator-curated invariant)
2. `! grep -E "from \"@anthropic-ai/claude-agent-sdk\"" src/manager/dream-auto-apply.ts src/manager/dream-log-writer.ts src/manager/dream-cron.ts` — **PASS** (zero SDK imports in primitives)
3. `grep -q "rename" src/manager/dream-log-writer.ts` — **PASS** (atomic temp+rename present)
4. `grep -q '\*/\${deps.dreamConfig.idleMinutes} \* \* \* \*' src/manager/dream-cron.ts` — **PASS** (cron pattern literal pinned: `*/N * * * *`, NOT `N * * * *` and NOT `* */N * * *`)
5. `grep -q "label: \"dream\"" src/manager/dream-cron.ts` — **PASS** (schedule label literal for /clawcode-status)
6. `! grep -E "promote.*MEMORY|merge.*consolidat" src/manager/dream-auto-apply.ts` — **PASS** (auto-applier never auto-promotes / auto-merges)
7. `git diff package.json package-lock.json` empty — **PASS** (zero new npm deps)

## Issues Encountered

- **ESM-spy limitation on `node:fs/promises`** — refactored L3/L4 to behavior-based filesystem-state observation; described above as Deviation #3.
- **Pre-existing test failures (25 tests across 11 files)** — verified pre-existing per Plan 95-01 SUMMARY's "Issues Encountered" section. None of the failures are in `src/manager/dream-*.ts`, `src/memory/*`, `src/scheduler/*`, or any file touched by this plan. Failure files: `src/discord/__tests__/slash-commands.test.ts`, `src/discord/__tests__/slash-types.test.ts`, `src/ipc/__tests__/protocol.test.ts`, `src/manager/__tests__/bootstrap-integration.test.ts`, `src/manager/__tests__/daemon-openai.test.ts`, `src/manager/__tests__/daemon-warmup-probe.test.ts`, `src/manager/__tests__/restart-greeting.test.ts`, `src/migration/__tests__/config-mapper.test.ts` and 3 others — all noted in 95-01 SUMMARY as pre-existing.

## User Setup Required

None — dream cycle remains fleet-wide opt-in. Plan 95-03 (CLI + Discord + IPC) ships the `clawcode dream <agent>` and `/clawcode-dream` triggers + the daemon-edge wiring that registers the cron schedules per agent on startup. After Plan 95-03 ships, operators flip `agents.<name>.dream.enabled: true` (and optionally tune `dream.idleMinutes` / `dream.model` per agent) to opt in.

## Next Phase Readiness

**Plan 95-03 (CLI + Discord + IPC + daemon-edge wiring):**

- Imports `runDreamPass`, `isAgentIdle`, `IDLE_HARD_FLOOR_MS`, `IDLE_HARD_CEILING_MS` from Plan 95-01
- Imports `applyDreamResult`, `DreamApplyOutcome`, `writeDreamLog`, `renderDreamLogSection` from Plan 95-02
- Imports `registerDreamCron` from Plan 95-02 (the agent-bootstrap.ts target was redirected to dream-cron.ts — see Deviation #1)
- `clawcode dream <agent>` subcommand wraps `runDreamPass` with stdout JSON printing; `--idle-bypass` flag intentionally skips idle check; `--force` flag ignores `dream.enabled=false`
- `/clawcode-dream` Discord slash (admin-only via Phase 85 admin gate) replies with EmbedBuilder rendering `themedReflection` + per-section counts; reuses `applyDreamResult` for additive auto-application; surfaces the dream log path in the embed footer
- New IPC method `run-dream-pass` shared between CLI + Discord paths; daemon-side wires SDK + memoryStore + conversationStore + auto-linker adapter + writeDreamLog at the edge per Phase 91/94 idiom
- Daemon-startup wiring registers the cron schedule per running agent via `registerDreamCron` (the bootstrap-style step originally planned for `agent-bootstrap.ts` lands here — most likely `src/manager/daemon.ts` `startAgent` flow or a new `src/manager/dream-bootstrap.ts` module)

**Blockers:** None. The auto-applier + log writer + cron primitives are stable, DI-pure, and fully tested. Plan 95-03 has the full set of building blocks it needs.

## Self-Check: PASSED

Verified files exist:
- FOUND: src/manager/dream-auto-apply.ts
- FOUND: src/manager/dream-log-writer.ts
- FOUND: src/manager/dream-cron.ts
- FOUND: src/manager/__tests__/dream-auto-apply.test.ts
- FOUND: src/manager/__tests__/dream-log-writer.test.ts
- FOUND: src/manager/__tests__/dream-cron.test.ts

Verified commits exist:
- FOUND: cb50a10 (test RED)
- FOUND: c059fdc (feat GREEN)

Verified tests pass:
- 23 dream tests (auto-apply 8 + log-writer 8 + cron 7) PASS
- Build (`npm run build`) PASS — exit 0
- Pre-existing failures (25 across 11 files) confirmed unrelated to this plan via 95-01 SUMMARY cross-check

Verified static-grep pins (7 pins):
- ALL 7 PASS

---
*Phase: 95-memory-dreaming-autonomous-reflection-and-consolidation*
*Completed: 2026-04-25*
