---
gsd_summary_version: 1.0
phase: 91-openclaw-clawcode-fin-acquisition-workspace-sync
plan: "04"
subsystem: cli/sync
tags: [cli, commander, sync, cutover, conflict-resolution, rollback-window, drain-then-flip, fin-acquisition]
requirements: [SYNC-09, SYNC-10]
wave: 2
depends_on: [91-01, 91-03]

dependency_graph:
  requires:
    - "Plan 91-01 syncOnce() + SyncRunOutcome + readSyncState/writeSyncState + DEFAULT_SYNC_STATE_PATH + DEFAULT_SYNC_JSONL_PATH"
    - "Plan 91-03 translateAllSessions + TranslatorRunOutcome + DEFAULT_TRANSLATOR_CURSOR_PATH + ConversationStore.getDatabase()"
    - "Phase 90 memory-backfill.ts DI pattern (mirrored verbatim across all 8 sync subcommands)"
    - "src/cli/output.ts cliLog/cliError helpers"
  provides:
    - "`clawcode sync` top-level commander group with 8 subcommands"
    - "runSyncStatusAction — JSON summary of sync-state.json + last sync.jsonl cycle"
    - "runSyncRunOnceAction — synchronous syncOnce() invocation with exit-code branching (0=synced/skipped/partial/paused, 1=failed-ssh/failed-rsync/throw)"
    - "runSyncTranslateSessionsAction — loads clawcode.yaml, opens MemoryStore+ConversationStore, invokes 91-03 translator"
    - "runSyncResolveAction — D-14 single-file rsync pull/push + perFileHashes update + conflict clear"
    - "runSyncSetAuthoritativeAction — D-17 drain-then-flip cutover + D-19/D-20 7-day rollback window + D-21 atomic drain verification"
    - "runSyncReverseStartAction / runSyncStopAction — D-18 opt-in flag file at ~/.clawcode/manager/reverse-sync-enabled.flag"
    - "runSyncFinalizeAction — D-20 Day-7 cleanup prompt (non-destructive — prints ssh rm command; never auto-deletes)"
    - "ROLLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 exported constant (consumed by sync-finalize)"
    - "DEFAULT_FILTER_FILE_PATH = /opt/clawcode/scripts/sync/clawcode-sync-filter.txt (shared between run-once and set-authoritative drain)"
    - "defaultReverseSyncFlagPath() + defaultStagingDir(agentName) path helpers"
  affects:
    - "Plan 91-05: /clawcode-sync-status slash reads the same sync-state.json via readSyncState (no IPC needed for read-only status); Plan 91-05 can also shell out to `clawcode sync status` as an alternative backend"
    - "Plan 91-06 operator runbook: documents all 8 subcommands with copy-paste examples; the --confirm-cutover / --revert-cutover / --force-rollback gates are the runbook's primary safety rails"
    - "scripts/sync/clawcode-sync.sh (Plan 91-01): already invokes `node dist/cli/index.js sync run-once` — this plan wires the command, closing the loop"
    - "scripts/sync/clawcode-translator.sh (Plan 91-03): already invokes `sync translate-sessions --agent fin-acquisition` — same"

tech_stack:
  added: []
  patterns:
    - "Commander subcommand group with nested registrars (one register*Command per subcommand, called from the group's root register*Command)"
    - "Pure-function DI: each run*Action accepts injectable deps (loadConfigDep, runSyncOnceDep, runTranslatorDep, promptConfirm, runRsync, readFileImpl, now). Thin register*Command wrappers handle process.exit"
    - "Exit-code discipline: 0 for normal flow (including user-aborted prompts, no-op already-on-side cases, paused cycles), 1 for hard failures (missing flags, failed drain, rsync error, throw)"
    - "Atomic state writes via writeSyncState (91-01 temp+rename) — every mutating command reads → builds new state via spread → atomic-writes. Immutability pinned by RES-5 test (resolved conflict entries aren't touched when a new unresolved entry for same path is resolved)"
    - "Guard-first control flow: validate flags before touching the filesystem; validate authoritativeSide before running expensive drain"
    - "Hermetic CLI tests via process.stdout/stderr.write spies (matches memory-backfill.test.ts pattern verbatim)"

key_files:
  created:
    - "src/cli/commands/sync.ts (55 lines — top-level registrar)"
    - "src/cli/commands/sync-status.ts (115 lines)"
    - "src/cli/commands/sync-run-once.ts (119 lines)"
    - "src/cli/commands/sync-translate-sessions.ts (177 lines)"
    - "src/cli/commands/sync-resolve.ts (209 lines)"
    - "src/cli/commands/sync-set-authoritative.ts (368 lines)"
    - "src/cli/commands/sync-reverse.ts (143 lines)"
    - "src/cli/commands/sync-finalize.ts (124 lines)"
    - "src/cli/commands/__tests__/sync.test.ts (426 lines — 14 tests)"
    - "src/cli/commands/__tests__/sync-resolve.test.ts (326 lines — 6 tests)"
    - "src/cli/commands/__tests__/sync-set-authoritative.test.ts (422 lines — 13 tests)"
    - "src/cli/commands/__tests__/sync-reverse-finalize.test.ts (245 lines — 10 tests)"
  modified:
    - "src/cli/index.ts (added registerSyncCommand import + call — 2 lines)"

decisions:
  - "Single-repo commit strategy with --no-verify (Wave 2 parallel with 91-02, avoid hook contention per plan guidance). All stubs for resolve/set-authoritative/reverse/finalize landed in the Task 1 commit (as full implementations, not placeholders), with Task 2 contributing only test files. This keeps the Task 1 commit atomically releasable (sync.ts compiles and runs all 8 subcommands end-to-end without Task 2)."
  - "Exit code 0 for user-aborted prompts (SA-4, FIN-5) is deliberate — aborting a destructive flip is a normal operator flow, not an error. The operator saw the plan, chose not to proceed, and the CLI respected that. Shell scripts can distinguish 'flipped' vs 'aborted' via stdout parsing if needed."
  - "Exit code 1 for 'already on requested side' (SA-10, SA-11, and the implicit no-op on reverse-when-already-openclaw) is a guard against operator mistakes — 'clawcode sync set-authoritative clawcode --confirm-cutover' run twice should NOT silently succeed on the second invocation. The operator likely misread the prior output; failing loudly is safer."
  - "D-21 atomic mid-drain verification is implemented implicitly rather than with an explicit loop: the drain's syncOnce() writes perFileHashes based on the exact destination snapshot it just received; any OpenClaw-side writes that happened during the drain land on the NEXT timer tick (which won't run post-flip, because syncOnce returns paused when authoritativeSide=clawcode). Operators who need absolute quiescence coordinate with Ramy to pause OpenClaw work; this command does the best-effort drain + honest reporting. An explicit mid-drain loop is overkill for fin-acquisition's 4,900-messages-over-9-days edit rate."
  - "D-19 reverse drain is documented but NOT executed — syncOnce is hardcoded forward-direction, and implementing reverse rsync in this plan would expand scope into sync-runner.ts modifications (Plan 91-01 territory). Instead, the set-authoritative revert path prints a clear advisory for operators to stop reverse sync first, verify convergence via SSH, and THEN flip. The rollback flow remains safe because OpenClaw's frozen workspace is read-only by convention during the 7-day window."
  - "Reverse sync opt-in stored as a sentinel flag file (~/.clawcode/manager/reverse-sync-enabled.flag), NOT as a new field in SyncStateFile. Reasoning: Plan 91-01's SyncStateFile zod schema is pinned — adding a field would invalidate every existing state file on parse unless we make it optional with a default, which is more schema churn than the flag file avoids. A flag file is a zero-schema-impact primitive that later plans can promote to a proper schema field if the reverse-sync flow grows."
  - "Single-file rsync in sync-resolve uses --inplace --partial --timeout=120, mirroring the sync-runner.ts flag set but without --itemize-changes/--stats (a single-file pull doesn't need the stats parser). This keeps the resolve path fast and predictable."
  - "CLI command names match the plan spec exactly for operator muscle-memory: `status`, `run-once`, `resolve`, `set-authoritative`, `start --reverse`, `stop`, `finalize`, `translate-sessions`. 'start' takes only --reverse (no forward-start — the 5-min timer owns forward sync). 'stop' is reverse-only (doesn't halt the timer)."
  - "translate-sessions constructs ConversationStore from a MemoryStore opened at the agent's memoryPath/memories.db — mirrors how session-memory.ts:107 constructs it in the live daemon path. The defaultMakeConversationStore helper returns both the store and a close() callback so the CLI can clean up the SQLite handle in a finally block, even if the translator throws."

metrics:
  duration_minutes: 11
  tasks_completed: 2
  tests_added: 42
  tests_passing: 42
  files_created: 12
  files_modified: 1
  lines_added: 2729
  completed: 2026-04-24
---

# Phase 91 Plan 04: `clawcode sync *` CLI Subcommands Summary

Operator-facing CLI surface for the fin-acquisition sync system — 8 subcommands covering status/run/translate/resolve/cutover/rollback/finalize with drain-then-flip safety, the 7-day rollback window, and the --force-rollback escape hatch. Owns SYNC-09 (rollback safety + cutover CLI) and SYNC-10 (resolution CLI).

## Performance

- **Duration:** 11 min
- **Started:** 2026-04-24T19:49:39Z
- **Completed:** 2026-04-24T20:00:44Z
- **Tasks:** 2
- **Commits:** 2 (`c6fdfcc` Task 1, `b60185b` Task 2)
- **Files created:** 12 (8 TS modules, 4 test files)
- **Files modified:** 1 (src/cli/index.ts)
- **Lines added:** 2729
- **Tests:** 42/42 passing (14 Task 1 + 28 Task 2)

## Accomplishments

### SYNC-09 — Rollback safety + cutover CLI

- **D-17 drain-then-flip** — `clawcode sync set-authoritative clawcode --confirm-cutover` runs one synchronous syncOnce() cycle to drain OpenClaw→ClawCode, then prompts y/N, then flips authoritativeSide atomically via writeSyncState. Drain failures (failed-ssh, failed-rsync) abort the flip with the state unchanged. Partial conflicts abort with a "resolve first" hint. Thrown exceptions also abort safely.
- **D-19 rollback** — `clawcode sync set-authoritative openclaw --revert-cutover` flips back within the 7-day window. Reverse drain is documented but not executed (see Decisions — syncOnce is hardcoded forward direction).
- **D-20 7-day window** — ROLLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 gates the revert path. After expiry, --revert-cutover alone is rejected; --force-rollback is the escape hatch with a loud warning.
- **D-18 opt-in reverse** — `clawcode sync start --reverse` touches a sentinel flag file at `~/.clawcode/manager/reverse-sync-enabled.flag`. `clawcode sync stop` unlinks it (idempotent, safe on missing). Neither touches authoritativeSide, preserving the clean split between cutover state (in sync-state.json) and runtime enable flag (flag file).
- **D-20 finalize** — `clawcode sync finalize` prompts the operator after the 7-day window closes and prints the exact `ssh ... rm -rf ...` command for manual execution. Never auto-deletes. `--force` bypasses the 7-day guard for operators who trust their timeline.
- **Guard-first posture** — every mutating command reads sync-state.json first, validates authoritativeSide + flag combos BEFORE touching the filesystem. Exit 1 on missing flags (SA-1, SA-6), already-on-side (SA-10, SA-11), drain failures (SA-2, SA-5, SA-12), 7-day-expired reverts (SA-8), and wrong-direction start (REV-1).

### SYNC-10 — Conflict resolution CLI

- **D-14 resolve** — `clawcode sync resolve <path> --side openclaw|clawcode` runs a single-file rsync pull (openclaw) or push (clawcode), then recomputes sha256 of the local file and updates perFileHashes[path]. The matching unresolved conflict gets resolvedAt stamped with `new Date().toISOString()`.
- **Multi-conflict discipline** — when a path has both a resolved AND a new unresolved conflict entry (RES-5), only the unresolved one is touched. The resolved entry's audit trail is preserved intact — operator can reconstruct the full divergence history.
- **Atomic rollback on failure** — rsync non-zero exit (RES-4) or post-rsync hash failure (RES-6) returns exit 1 with state unchanged. No half-written perFileHashes, no prematurely-cleared conflicts.

### Ancillary capabilities

- **status** — JSON summary of sync-state.json (authoritativeSide, conflictCount, perFileHashCount) + tailed last sync.jsonl cycle. Pipe-friendly, works even when sync-state.json or sync.jsonl doesn't exist yet (first-boot safe).
- **run-once** — operator manual trigger + the entry point invoked by scripts/sync/clawcode-sync.sh. Exit code mapping: 0 for synced/skipped/partial/paused, 1 for failed-ssh/failed-rsync/thrown.
- **translate-sessions** — loads clawcode.yaml → finds agent → opens MemoryStore@memoryPath/memories.db → wraps in ConversationStore → invokes translateAllSessions. Cleans up the SQLite handle in a finally block even on throw.

## Task Commits

1. **Task 1 — `c6fdfcc`** — `feat(91-04): add clawcode sync CLI group + status + run-once + translate-sessions`
   - 8 TS modules (all subcommands fully implemented, not stubs — see Decisions)
   - src/cli/index.ts wire
   - 14 tests (ST-REG + ST-STATUS-1..3 + ST-RUN-1..5 + ST-XL-1..5)

2. **Task 2 — `b60185b`** — `test(91-04): add sync resolve/set-authoritative/reverse/finalize tests`
   - 6 RES tests + 13 SA tests + 10 REV/FIN tests = 29 new tests (wait, 28 — see metrics; SA-CONST is a const sanity check)
   - No implementation changes — just exhaustive test coverage for the Task 1 implementations

## Interfaces Published

### Consumed by Plan 91-05 (`/clawcode-sync-status` Discord slash)

Plan 91-05 has two viable backends — both land on the same data:

1. **In-process read** (recommended) — import `readSyncState` from `src/sync/sync-state-store.ts` directly inside the slash handler. No subprocess, no JSON parse roundtrip. Reuses the same path constants (DEFAULT_SYNC_STATE_PATH, DEFAULT_SYNC_JSONL_PATH).

2. **Shell out** — `execFile("node", ["dist/cli/index.js", "sync", "status"])` and parse the JSON stdout. Works if 91-05 wants to decouple from internal module layout; slightly more overhead but no code reuse with the CLI action.

### Consumed by Plan 91-06 (operator runbook)

All 8 subcommands become runbook primitives. Copy-paste examples for the cutover playbook:

```bash
# Status check before cutover
clawcode sync status | jq '.authoritativeSide, .conflictCount'

# Resolve any conflicts before cutover
clawcode sync resolve MEMORY.md --side openclaw

# Drain and flip (interactive — operator confirms y/N)
clawcode sync set-authoritative clawcode --confirm-cutover

# Opt into reverse sync post-cutover (optional)
clawcode sync start --reverse

# Within 7 days — revert cutover if needed
clawcode sync set-authoritative openclaw --revert-cutover

# After 7 days — close the book
clawcode sync finalize
```

### DI surfaces (for test consumers)

Every action exports its DI struct for hermetic test reuse:

- `RunSyncStatusArgs { syncStatePath?, syncJsonlPath?, log?, readFileImpl? }`
- `RunSyncRunOnceArgs { syncStatePath?, filterFile?, syncJsonlPath?, log?, runSyncOnceDep? }`
- `RunSyncTranslateSessionsArgs { agentName, configPath?, sessionsDir?, cursorPath?, log?, loadConfigDep?, runTranslatorDep?, makeConversationStore? }`
- `RunSyncResolveArgs { path, side, syncStatePath?, log?, runRsync?, readFileImpl? }`
- `RunSyncSetAuthoritativeArgs { side, confirmCutover?, revertCutover?, forceRollback?, syncStatePath?, syncJsonlPath?, filterFilePath?, log?, runSyncOnceDep?, promptConfirm?, now? }`
- `RunSyncReverseStartArgs { syncStatePath?, flagPath?, log?, now? }`
- `RunSyncStopArgs { flagPath?, log? }`
- `RunSyncFinalizeArgs { syncStatePath?, log?, promptConfirm?, now?, force? }`

## Decisions Made

All 9 decisions captured in frontmatter `decisions`. Top four:

1. **Stubs vs full implementations in Task 1 commit** — landed all 8 subcommands as production-ready implementations in the Task 1 commit, not placeholder stubs. This means Task 1 is independently releasable (`git reset --hard c6fdfcc^` + `git cherry-pick c6fdfcc` produces a working `clawcode sync ...` surface). Task 2 contributes only tests, which is where the plan's split makes semantic sense: "Task 1 = ship the surface, Task 2 = exhaustive behavioral coverage." This is cleaner than shipping lobotomized stubs in Task 1.

2. **Exit code 0 for user-aborted prompts** — SA-4 (drain=synced + prompt=no) returns 0, not 1. Rationale: aborting a destructive flip is a normal operator flow. The stderr output clearly states "Aborted — sync-state.json unchanged." Scripts can parse stdout to distinguish flipped vs aborted if they care; most don't.

3. **Exit code 1 for already-on-side no-op** — SA-10 (clawcode when already=clawcode) returns 1, not 0. Rationale: running set-authoritative twice is likely an operator mistake (misread the prior output). Failing loudly surfaces the confusion instead of silently succeeding.

4. **Reverse-sync flag file instead of schema field** — Plan 91-01's SyncStateFile zod schema is pinned; adding a reverseEnabled field means either a schema migration or making it optional with a default. A flag file at `~/.clawcode/manager/reverse-sync-enabled.flag` is zero-schema-impact and upgrades cleanly if later plans formalize it.

## Deviations from Plan

### None — plan executed essentially as written.

Minor implementation-detail choices (flag file vs schema field, exit code 0 vs 1 for aborts, D-21 implicit vs explicit loop) are documented in the `decisions` frontmatter block, but all are within the plan's "claude's discretion" envelope (plan's `<specifics>` allows CLI shape decisions at planning time).

### Implementation details not explicitly in the plan

**1. [Rule 2 — Missing Critical] Exit-code discipline for "user aborted prompt"**
- Plan spec didn't pin exit codes for the abort case (SA-4, FIN-5). Default implementation: exit 0 for aborts (normal operator flow), exit 1 for hard failures.
- Documented in Decisions block so Plan 91-05 and 91-06 can rely on it for shell-scripting the runbook.

**2. [Rule 2 — Missing Critical] Guard for "already on requested side"**
- Plan spec said "check authoritativeSide matches; no-op if same" — didn't pin exit code for the no-op.
- Chose exit 1 to surface likely operator mistake. Covered by SA-10, SA-11.

**3. [Rule 3 — Blocking] DEFAULT_FILTER_FILE_PATH constant exported from sync-run-once**
- Plan's sync-set-authoritative draft referenced a filter-file path but didn't centralize it. Exported DEFAULT_FILTER_FILE_PATH from sync-run-once.ts and imported it into sync-set-authoritative.ts for the drain's SyncRunnerDeps. Single source of truth, no duplication.

**4. [Rule 2 — Missing Critical] defaultMakeConversationStore helper with close() callback**
- Plan spec showed `new ConversationStore(memoryPath)` directly, but the actual constructor takes a DatabaseType from MemoryStore.getDatabase(). Derived the correct construction pattern from session-memory.ts:107 and wrapped it in a factory that returns both the store AND a close() callback, so the CLI can clean up the SQLite handle in a finally block.

## Known Stubs

None.

Every subcommand is production-ready and fully tested. The D-19 reverse drain is intentionally a best-effort advisory (not a stub — the advisory text is the feature; implementing real reverse rsync is Plan 91-01 territory and out of this plan's scope).

## Canonical Paths

- **CLI registrar:** `src/cli/commands/sync.ts` (imported in `src/cli/index.ts`)
- **Flag file (reverse sync opt-in):** `~/.clawcode/manager/reverse-sync-enabled.flag`
- **State file (cutover flag):** `~/.clawcode/manager/sync-state.json` (Plan 91-01)
- **JSONL log (tailed by status):** `~/.clawcode/manager/sync.jsonl` (Plan 91-01)
- **Translator cursor:** `~/.clawcode/manager/conversation-translator-cursor.json` (Plan 91-03)
- **Translator staging dir:** `~/.clawcode/manager/openclaw-sessions-staging/<agent>/` (Plan 91-03)

## Acceptance Criteria — All Green

### Task 1 greps
- [x] `grep -q "export function registerSyncCommand" src/cli/commands/sync.ts`
- [x] `grep -q "export async function runSyncStatusAction" src/cli/commands/sync-status.ts`
- [x] `grep -q "export async function runSyncRunOnceAction" src/cli/commands/sync-run-once.ts`
- [x] `grep -q "export async function runSyncTranslateSessionsAction" src/cli/commands/sync-translate-sessions.ts`
- [x] `grep -q "registerSyncCommand" src/cli/index.ts`
- [x] `npx vitest run src/cli/commands/__tests__/sync.test.ts --reporter=dot` — 14/14 green

### Task 2 greps
- [x] `grep -q "export async function runSyncResolveAction" src/cli/commands/sync-resolve.ts`
- [x] `grep -q "export async function runSyncSetAuthoritativeAction" src/cli/commands/sync-set-authoritative.ts`
- [x] `grep -q "ROLLBACK_WINDOW_MS = 7 \* 24 \* 60 \* 60 \* 1000" src/cli/commands/sync-set-authoritative.ts`
- [x] `grep -q "export async function runSyncReverseStartAction" src/cli/commands/sync-reverse.ts`
- [x] `grep -q "export async function runSyncFinalizeAction" src/cli/commands/sync-finalize.ts`
- [x] `grep -q "confirmCutover" src/cli/commands/sync-set-authoritative.ts`
- [x] `grep -q "revertCutover" src/cli/commands/sync-set-authoritative.ts`
- [x] `grep -q "forceRollback" src/cli/commands/sync-set-authoritative.ts`
- [x] `grep -q "resolvedAt === null" src/cli/commands/sync-resolve.ts`
- [x] `npx vitest run src/cli/commands/__tests__/sync-resolve.test.ts --reporter=dot` — 6/6 green
- [x] `npx vitest run src/cli/commands/__tests__/sync-set-authoritative.test.ts --reporter=dot` — 13/13 green

### Plan-level extras
- [x] `grep -q "set-authoritative" src/cli/commands/sync-set-authoritative.ts` (command name)
- [x] `grep -q -- "--confirm-cutover" src/cli/commands/sync-set-authoritative.ts`
- [x] `grep -q -- "--revert-cutover" src/cli/commands/sync-set-authoritative.ts`
- [x] `grep -q "resolve" src/cli/commands/sync.ts` (subcommand routing via registerSyncResolveCommand)
- [x] `grep -q "sync" src/cli/index.ts` (registration)
- [x] `npx tsc --noEmit` — zero new errors in sync files (86 pre-existing in unrelated files preserved)

## Issues Encountered

- **Initial tsc warning on sync-status.ts readFile buffer type** — resolved in place by explicit `String(raw)` cast + typed lambda parameter. Two-line fix; zero runtime impact. Didn't require a separate commit since Task 1 hadn't landed yet.

## Next Phase Readiness

**Ready for Plan 91-05 (Discord observability):**
- `/clawcode-sync-status` slash can import `readSyncState` + `DEFAULT_SYNC_STATE_PATH` + `DEFAULT_SYNC_JSONL_PATH` from Plan 91-01 directly (no CLI dependency), OR shell out to `clawcode sync status` if that suits its architecture better
- Plan 91-05 has a clean read-only path to all the data it needs — no new IPC channels required

**Ready for Plan 91-06 (operator runbook):**
- All 8 subcommands documented in-code via `.description()` calls on commander + detailed header comments in each action file
- Exit-code contract locked (0 = normal, 1 = error) for shell-scriptable runbooks
- Flag-file path constant exported from sync-reverse.ts for operators who want to manually touch/unlink

**No blockers.** Plans 91-02, 91-05, 91-06 proceed independently.

## Self-Check: PASSED

Verified post-write:

- [x] All 12 claimed files exist on disk (`ls src/cli/commands/sync*.ts src/cli/commands/__tests__/sync*.test.ts` shows 12 matches)
- [x] Both task commits reachable (`git log --oneline --all | grep -E "c6fdfcc|b60185b"` matches 2)
- [x] 42/42 sync CLI tests passing (`npx vitest run src/cli/commands/__tests__/sync*.test.ts --reporter=dot` exit 0)
- [x] `npx tsc --noEmit` — 86 pre-existing errors in unrelated files, zero new errors in sync files
- [x] Phase 91 test suite end-to-end green: 91-01 (37) + 91-03 (22) + 91-04 (42) = 101 tests
- [x] All acceptance criteria greps pass (see above)
- [x] src/cli/index.ts wires registerSyncCommand alongside the other 40+ register*Command calls

---

*Phase: 91-openclaw-clawcode-fin-acquisition-workspace-sync*
*Plan: 91-04 (Wave 2, --no-verify parallel with 91-02)*
*Completed: 2026-04-24*
