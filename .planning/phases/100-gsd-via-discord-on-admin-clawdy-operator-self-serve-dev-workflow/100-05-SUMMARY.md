---
phase: 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow
plan: 05
subsystem: discord
tags: [phase-99-m, relay, artifact-paths, gsd, projectDir, subagent-thread-spawner, di-pure-helpers, additive]

# Dependency graph
requires:
  - phase: 100
    plan: 01
    provides: ResolvedAgentConfig.gsd?.projectDir field consumed via resolveArtifactRoot helper
  - phase: 99
    sub: M
    provides: relayCompletionToParent base contract (shipped 2026-04-26) — Phase 100 extends its prompt with optional artifacts line, preserves failures-swallow contract
provides:
  - resolveArtifactRoot(parentConfig) pure helper for gsd.projectDir extraction
  - discoverArtifactPaths(deps, root, taskHint?) DI-pure async filesystem scanner
  - relayCompletionToParent extension: optional 'Artifacts written:' prompt section when parent has gsd.projectDir
  - 13 new vitest cases covering helpers + integration (AP1..AP10 + AP6b/AP6c/AP10b)
affects: [Plan 100-08 smoke-test runbook (verify Artifacts: line in main-channel summary post-/gsd-autonomous)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DI-pure async helper — readdir/stat injected so tests don't touch real filesystem (matches Phase 85 performMcpReadinessHandshake pattern)"
    - "Additive relay prompt extension — base Phase 99-M prompt preserved when artifacts.length === 0 (zero-behavior-change for non-GSD subthreads)"
    - "Failures-swallow contract — empty array fallback on any fs error (per Phase 99-M relay's existing log-and-swallow at line 126-130)"
    - "Phase-prefix priority sort — task hint regex /\\b\\d+\\b/ extracts phase number, matching dirs sort first ahead of pure mtime DESC"

key-files:
  created: []
  modified:
    - src/discord/subagent-thread-spawner.ts (+135 lines: 2 new exported pure helpers + relay prompt extension)
    - src/discord/subagent-thread-spawner.test.ts (+409 lines: 13 new tests under 'Phase 100 — relay prompt artifact-paths extension' describe block)

key-decisions:
  - "Use 'Artifacts written:' prefix (not 'Artifacts:') in relay prompt — adds slight emphasis that subagent produced files, helps parent's summary distinguish from spoken artifacts in last message"
  - "DI-pure for discoverArtifactPaths — readdir/stat injected via deps param. Production wires fsReaddir/fsStat directly; tests pass vi.fn() mocks. Avoids pulling vi.mock('node:fs/promises') hammer for trivial scanner"
  - "Use thread NAME as taskHint (not the original task string) — Phase 99-M relay only has access to threadName at relay time; thread names like 'gsd:plan:100' carry the phase number naturally via Plan 100-04's auto-thread naming convention"
  - "24h mtime window + max-5 cap + phase-prefix priority — bounds the relay prompt budget; long-runner phases create directories continuously, so a strict 'last 24h' filter avoids surfacing stale dirs from prior weeks"
  - "Relative paths only (no absolute) — RESEARCH.md Pitfall 8: long phase slugs (e.g. '100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow' = 89 chars) truncate Discord embeds. Relative '.planning/phases/<name>/' shaves ~50 chars per path"
  - "AP10 integration test uses real-on-disk tempDir (not DI mocking) — exercises the live filesystem path end-to-end including the readdir+stat real codepaths. Cheap because tmpdir is auto-cleaned in afterEach"
  - "AP10b explicitly verifies non-GSD subthread byte-equivalence — when parentConfig has no gsd field, the relay prompt is byte-identical to Phase 99-M's. Pins zero-behavior-change for the 14+ existing fleet agents"

patterns-established:
  - "Optional relay prompt extension via length-conditional concatenation — `artifactsLine = artifacts.length > 0 ? '\\n\\n**Artifacts written:** ' + artifacts.join(', ') : ''`. Future relay extensions (e.g. cost summary, error count) can stack with the same pattern"
  - "Two-helper decomposition for filesystem-discovery features: a sync 'resolve' helper (extracts root from config) + an async 'discover' helper (does the I/O). Sync resolver is trivially testable; async discoverer is DI-pure for mock injection"

requirements-completed: [REQ-100-06]

# Metrics
duration: ~7min
completed: 2026-04-26
---

# Phase 100 Plan 05: Phase 99-M relay extension — append artifact paths to parent's main-channel summary prompt — Summary

**Phase 99-M's `relayCompletionToParent` (shipped 2026-04-26) gains a Phase 100 GSD-06 extension: when the parent agent's `gsd.projectDir` is set, the relay prompt now includes an optional "Artifacts written: <paths>" line listing up to 5 most-recently-modified `.planning/phases/<name>/` directories from the parent's GSD project root. Two new exported pure helpers (`resolveArtifactRoot`, `discoverArtifactPaths`) are DI-pure for trivial test mocking. Zero behavior change for the 14+ non-GSD agents in the fleet (their `parentConfig.gsd` is undefined → no artifacts line → relay prompt is byte-identical to Phase 99-M).**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-26T18:39:40Z
- **Completed:** 2026-04-26T18:47:00Z
- **Tasks:** 1 (combined RED+GREEN per TDD)
- **Files modified:** 2 (1 source + 1 test)
- **Commit:** `5cd9b36`

## Accomplishments

- **`resolveArtifactRoot(parentConfig?)` pure helper** — 4-line lookup that returns `parentConfig?.gsd?.projectDir` (or `undefined`). Exported for direct unit testing. Plan 100-01's `gsd?: { projectDir: string }` field on `ResolvedAgentConfig` is the single source of truth this helper reads.
- **`discoverArtifactPaths({readdir, stat}, root, taskHint?)` DI-pure async helper** — enumerates `<root>/.planning/phases/` filtered by 24h mtime window, prioritized by phase-number prefix matching the task hint (regex `\b\d+\b` extracts phase number from strings like `gsd:plan:100`), capped at 5 results, formatted as RELATIVE paths (`.planning/phases/<name>/`). Failures-swallow contract: any fs error → `[]`.
- **`relayCompletionToParent` extension** — between fetching the subagent's last message and building the relay prompt, the function now calls `this.sessionManager.getAgentConfig(binding.agentName)` → `resolveArtifactRoot()` → optionally `discoverArtifactPaths()`, then conditionally concatenates `'\n\n**Artifacts written:** ' + artifacts.join(', ')` into the relay prompt. When artifacts are present, the prompt also gains an instruction to the parent: *"If artifacts are listed, include them verbatim in your summary so the operator can find them."*
- **13 new vitest cases under `describe("Phase 100 — relay prompt artifact-paths extension")`** — full coverage matrix below. All 21 tests in `subagent-thread-spawner.test.ts` pass GREEN (8 pre-existing + 13 new).

## Task Commits

1. **Task 1: TDD RED+GREEN combined** — `5cd9b36` (feat): 13-test scaffold + 2 helpers + relay prompt extension. RED → GREEN in single cycle (combined per plan because deliverables are tightly coupled and small).

**Plan metadata commit:** TBD (final commit on this SUMMARY + STATE.md + ROADMAP.md update)

## Files Created/Modified

### Source

- `src/discord/subagent-thread-spawner.ts` (+135 lines, 0 deletions)
  - **Imports added:** `import { readdir as fsReaddir, stat as fsStat } from "node:fs/promises"; import { join } from "node:path";` (lines 4-5)
  - **`resolveArtifactRoot` exported pure function** (lines 22-39): 4-line lookup with full JSDoc citing Plan 100-01 hand-off
  - **`discoverArtifactPaths` exported async pure function** (lines 41-128): 87-line DI-pure scanner with 5-step inline contract (root-exists check → list+filter dirs → mtime window → phase-prefix sort → slice+format)
  - **`relayCompletionToParent` extension** (lines 195-242): inserted after `threadName` resolution, before `relayPrompt` construction. Adds `parentConfig`/`artifactRoot`/`artifacts`/`artifactsLine`/`includeArtifactsHint` locals, conditionally concatenates artifactsLine into prompt, adds `artifactCount: artifacts.length` to the success log.
  - Net post-edit file: 458 lines (was 323).

### Tests

- `src/discord/subagent-thread-spawner.test.ts` (+409 lines, 0 deletions)
  - **Imports updated** (lines 5-13): named imports for `resolveArtifactRoot` + `discoverArtifactPaths` from spawner module; added `writeThreadRegistry` from thread-registry module for AP10/AP10b registry seed.
  - **New top-level describe block** at end of file (`Phase 100 — relay prompt artifact-paths extension`) containing:
    - `describe("resolveArtifactRoot")`: 3 tests (AP7..AP9)
    - `describe("discoverArtifactPaths")`: 7 tests (AP1..AP6 + AP6b filtering + AP6c per-entry-stat-failures)
    - `describe("relayCompletionToParent integration")`: 2 tests (AP10 GSD path + AP10b non-GSD no-op)
  - Net post-edit file: 781 lines (was 372).

## Test Coverage Matrix

| Test ID | Behavior | Helper / Integration | Mock Strategy |
|---------|----------|----------------------|---------------|
| AP1 | discoverArtifactPaths happy path: 3 phase dirs in window → 3 relative paths | helper | DI mocks: readdir → 3 Dirent objects, stat → all within 24h |
| AP2 | mtime filter: dirs older than 24h excluded | helper | DI mocks: stat returns now-2days for stale entries, now-60s for recent |
| AP3 | max-5 cap: 7 dirs in window returns exactly 5 | helper | DI mocks: 7 Dirents all within mtime window |
| AP4 | phase-prefix priority: matching phase number sorts first ahead of mtime | helper | DI mocks: 99-x more recent than 100-bar but 100-bar surfaces first because taskHint = "/gsd:plan-phase 100" |
| AP5 | readdir failure returns [] | helper | DI mocks: readdir.mockRejectedValue(ENOENT) |
| AP6 | root .planning/phases doesn't exist returns [] | helper | DI mocks: stat throws on root, readdir never called (asserted) |
| AP6b | non-directory entries filtered (only isDirectory()==true) | helper | DI mocks: mix of dir + file Dirents, file gets skipped |
| AP6c | per-entry stat failures silently skipped | helper | DI mocks: per-entry stat throws EACCES on 'broken-1', good entries surface |
| AP7 | resolveArtifactRoot with parentConfig.gsd.projectDir set → returns it | helper | Direct call, no mocks |
| AP8 | resolveArtifactRoot with parentConfig.gsd undefined → undefined | helper | Direct call with `{} as ResolvedAgentConfig` |
| AP9 | resolveArtifactRoot with parentConfig itself undefined → undefined | helper | Direct call with literal undefined |
| AP10 | relayCompletionToParent appends 'Artifacts written:' line + path when parent has gsd.projectDir + recent phase dir | integration | Real-on-disk tempDir + real fs codepaths + mock Discord client + mock turnDispatcher |
| AP10b | NO Artifacts line when parent has no gsd.projectDir (Phase 99-M base byte-equivalent) | integration | Real-on-disk tempDir + mock Discord client + mock turnDispatcher; explicit `expect(prompt).not.toContain("Artifacts written:")` |

## Decisions Made

- **Use thread NAME as taskHint, not the original task string.** Phase 99-M's `relayCompletionToParent` only has access to `threadName` at relay time (the original task is no longer in scope). Plan 100-04's auto-thread naming convention (`gsd:<cmd>:<target>` → e.g. `gsd:plan:100`) embeds the phase number naturally — the regex `/\b(\d+)\b/` in `discoverArtifactPaths` finds it correctly. Net result: phase-prefix priority works without plumbing a separate taskHint through Phase 99-M's existing relay shape.
- **DI-pure for `discoverArtifactPaths`, not vi.mock('node:fs/promises').** A `deps: { readdir, stat }` param keeps tests trivial (vi.fn() instances) and avoids module-mock hammer. Production wiring at the `relayCompletionToParent` call site is `{ readdir: fsReaddir, stat: fsStat }` — one line.
- **'Artifacts written:' prefix (not 'Artifacts:').** Adds slight emphasis to distinguish file artifacts from things mentioned verbally in the subagent's last message. Helps the parent's summary correctly classify them as concrete artifacts the operator can `cat`.
- **24h mtime window + max-5 cap + phase-prefix priority.** Bounds the relay prompt budget (parent has to read it + summarize for the user). Long-runner phases create many directories over time; a strict last-24h filter avoids surfacing stale dirs from prior weeks. Cap of 5 keeps Discord embed-friendly.
- **Relative paths only, never absolute.** RESEARCH.md Pitfall 8: long phase slugs (e.g. `100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow` = 89 chars) truncate Discord embeds. Relative `.planning/phases/<name>/` shaves ~50 chars per path vs absolute.
- **AP10 integration uses real-on-disk tempDir (not DI mocking).** Exercises the live filesystem code path end-to-end including the readdir+stat real I/O. Cheap because the tmpdir is auto-cleaned in `afterEach`. Provides confidence the production wiring (`{ readdir: fsReaddir, stat: fsStat }`) works alongside the helper logic.
- **AP10b explicitly verifies non-GSD byte-equivalence.** When `parentConfig.gsd` is undefined, the relay prompt does NOT contain `"Artifacts written:"`. Pins zero-behavior-change for the 14+ existing fleet agents (fin-acquisition, content-creator, etc.) — their relay flow is byte-identical to pre-Plan-05 Phase 99-M.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ThreadBindingRegistry tsc error in AP10 integration tests**
- **Found during:** Task 1 GREEN verification (`npx tsc --noEmit`)
- **Issue:** `writeThreadRegistry({ bindings: [...] })` literal failed TS2345 — the `ThreadBindingRegistry` type at `src/discord/thread-types.ts:20` requires both `bindings` and `updatedAt: number` fields. My initial AP10/AP10b registry-seed objects only had `bindings`.
- **Fix:** Added `updatedAt: Date.now()` to both AP10 and AP10b `writeThreadRegistry` calls. Two-line change.
- **Files modified:** `src/discord/subagent-thread-spawner.test.ts` (lines 661 + 720 region)
- **Verification:** `npx tsc --noEmit 2>&1 | grep subagent-thread-spawner` returns empty post-fix. Tests still pass GREEN.
- **Committed in:** `5cd9b36` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minimal — the `updatedAt` field requirement was implied by the existing thread-registry contract; my initial test scaffold just missed it. No scope creep.

## Issues Encountered

- **Pre-existing tsc errors (101 baseline → 102 with my changes).** The 1-error delta is NOT mine — it's from the parallel sibling Plan 100-04's modifications to `src/discord/slash-commands.ts`. Verified via `git stash + tsc + git stash pop` baseline measurement before adding my fix. Subagent-thread-spawner files contribute zero NEW tsc errors after the `updatedAt` fix.
- **Test file linter touch.** Mid-execution, the editor / linter touched the test file imports and reverted them once. Re-applied via Edit; final state is correct.
- **Pre-existing test failures in `src/discord/__tests__/slash-commands-gsd.test.ts` (12 fails).** Out of scope — that file belongs to parallel Plan 100-04 (sibling Wave 3 executor). Per the parallel_execution context, those failures will be resolved by Plan 100-04's executor when it completes. None of my changes touch that file or the slash-commands.ts file.

## User Setup Required

None — relay-tier change only, additive prompt extension. Production deploy is an operator-driven manual step on clawdy after the full Phase 100 lands (per Plan 100-08 SMOKE-TEST runbook + the deployment_constraint that this conversation's executor never touches clawdy).

## Next Phase Readiness

**Plan 100-08 smoke-test hand-off:** the expected main-channel summary post-`/gsd-autonomous` should now include the artifact paths in addition to the thread URL. The runbook should add a verification step:

> After the subagent finishes (Phase 99-M relay fires), the main-channel reply from Admin Clawdy should mention the `.planning/phases/100-<slug>/` directory path. If absent, check that:
> 1. Admin Clawdy's `clawcode.yaml` entry has `gsd.projectDir: /opt/clawcode-projects/sandbox` set (Plan 100-07).
> 2. The subagent actually created/touched a `.planning/phases/...` directory within the last 24h.
> 3. The directory name starts with the phase number from the thread name (e.g. `gsd:plan:100` → directory `100-...`) for it to surface ahead of older dirs.

**Plan 100-04 sibling:** my changes are byte-orthogonal to slash-commands.ts. The 12th inline-handler-short-circuit (Plan 100-04) and Phase 99-M relay extension (Plan 100-05) compose cleanly: Plan 100-04 routes `/gsd-autonomous` to a subagent thread named `gsd:autonomous:100`, the subagent runs the `/gsd:autonomous 100` skill, the skill creates `.planning/phases/100-*/`, the subagent finishes, Phase 99-M's session-end hook fires `relayCompletionToParent`, my Plan 100-05 extension discovers the new phase dir and appends `Artifacts written: .planning/phases/100-.../` to the parent's relay prompt.

---
*Phase: 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow*
*Plan: 05*
*Completed: 2026-04-26*

## Self-Check: PASSED

- ✓ src/discord/subagent-thread-spawner.ts FOUND
- ✓ src/discord/subagent-thread-spawner.test.ts FOUND
- ✓ .planning/phases/100-.../100-05-SUMMARY.md FOUND
- ✓ commit 5cd9b36 (feat) FOUND
- ✓ All 13 Phase 100 tests pass GREEN (3 AP7..AP9 + 7 AP1..AP6c + 2 AP10/AP10b + 1 module describe)
- ✓ All 21 total tests in subagent-thread-spawner.test.ts pass (8 pre-existing + 13 new)
- ✓ Zero new tsc errors caused by Plan 100-05 (delta is from sibling Plan 100-04, not mine)
- ✓ resolveArtifactRoot exported and importable from spawner module
- ✓ discoverArtifactPaths exported and importable from spawner module
- ✓ relayCompletionToParent extension works with both real-fs path (AP10) and zero-behavior-change non-GSD path (AP10b)
- ✓ Phase 99-M base behavior preserved byte-equivalent when parent has no gsd.projectDir
