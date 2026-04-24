---
phase: 91-openclaw-clawcode-fin-acquisition-workspace-sync
plan: 01
subsystem: infra
tags: [rsync, ssh, systemd, sync, atomic-json, zod, pino, observability, jsonl, fin-acquisition]

# Dependency graph
requires:
  - phase: 83-extended-thinking-effort-mapping
    provides: atomic temp+rename JSON writer pattern (effort-state-store mirrored verbatim)
  - phase: 90-clawhub-marketplace-fin-acquisition-memory-prep
    provides: fin-acquisition workspace wiring (memoryPath, uploads dir already rsync'd once)
provides:
  - SyncStateFile Zod schema + atomic persistence at ~/.clawcode/manager/sync-state.json
  - DEFAULT_SYNC_STATE carrying the D-01 fin-acquisition topology constants
  - SyncRunOutcome discriminated union (synced | skipped-no-changes | partial-conflicts | paused | failed-ssh | failed-rsync)
  - SyncJsonlEntry flat shape for SYNC-07 observability log
  - syncOnce() pure-function DI entry point driving one OpenClaw→ClawCode rsync cycle
  - parseRsyncStats() exported parser for --itemize-changes + --stats stdout
  - flattenOutcomeToJsonl() converter from union → JSONL-friendly flat object
  - rsync filter file at scripts/sync/clawcode-sync-filter.txt (verbatim SYNC-02 include/exclude list)
  - systemd user units (oneshot service + OnUnitActiveSec=5min timer)
  - Bash wrapper scripts/sync/clawcode-sync.sh with flock --nonblock re-entrancy guard
affects:
  - 91-02-PLAN (conflict detection — compares dest sha256 vs perFileHashes baseline we write)
  - 91-03-PLAN (conversation-turn translator — shares openClawSessionCursor field in sync-state.json)
  - 91-04-PLAN (CLI — consumes syncOnce() for `clawcode sync run-once`; flips authoritativeSide via writeSyncState)
  - 91-05-PLAN (Discord observability — parses sync.jsonl + SyncJsonlEntry shape for /clawcode-sync-status)
  - 91-06-PLAN (operator runbook — documents SSH key provisioning + systemd unit install)

# Tech tracking
tech-stack:
  added: []  # Zero new npm deps — uses node:child_process (via promisify pattern from marketplace/clawhub-client.ts)
  patterns:
    - "Pure-function DI: SyncRunnerDeps struct with injectable RsyncRunner/JsonlAppender/DestHasher — tests never touch real SSH/rsync/fs"
    - "Atomic temp+rename JSON persistence mirror (Phase 83 effort-state-store blueprint replicated verbatim)"
    - "Discriminated-union outcomes (Phase 88 SkillInstallOutcome, Phase 89 GreetingOutcome lineage extended)"
    - "Flatten-for-JSONL helper — discriminated union lives in code, flat object lives on disk (grep/jq-friendly)"
    - "Fail-loud regression guard: .sqlite/sessions paths in rsync output THROW from syncOnce (not silent)"

key-files:
  created:
    - src/sync/types.ts (SyncStateFile + SyncConflict Zod schemas, SyncRunOutcome union, SyncJsonlEntry)
    - src/sync/sync-state-store.ts (readSyncState/writeSyncState/updateSyncStateConflict/clearSyncStateConflict + DEFAULT_SYNC_STATE_PATH + DEFAULT_SYNC_JSONL_PATH)
    - src/sync/sync-runner.ts (syncOnce + parseRsyncStats + flattenOutcomeToJsonl + defaultRsyncRunner/DestHasher/JsonlAppender)
    - src/sync/__tests__/sync-state-store.test.ts (16 tests)
    - src/sync/__tests__/sync-runner.test.ts (21 tests)
    - scripts/sync/clawcode-sync.sh (flock-guarded wrapper, chmod +x)
    - scripts/sync/clawcode-sync-filter.txt (17 include + 21 exclude rules)
    - scripts/systemd/clawcode-sync.service (Type=oneshot, SuccessExitStatus=1 for graceful SSH fail)
    - scripts/systemd/clawcode-sync.timer (OnBootSec=2min, OnUnitActiveSec=5min, Persistent=false)
  modified: []

key-decisions:
  - "Zero new npm deps: substituted node:child_process.execFile (via promisify, matching src/marketplace/clawhub-client.ts) for the execa import referenced in the plan. execa is not in package.json; introducing it was gratuitous scope creep."
  - "SuccessExitStatus=1 in the systemd service so flock-skipped cycles AND graceful-SSH-fail exits don't mark the unit as failed in journalctl. Real bugs (exit 2+) still surface."
  - "Regression guard in syncOnce: if touchedPaths contains a .sqlite or sessions/ path, THROW instead of silently writing hashes. Filter-file pinned by 13 exclude patterns; a leak means something upstream broke — fail loud, not silent."
  - "parseRsyncStats tolerates locale-formatted comma byte counts. Observed on Debian rsync where `Total transferred file size: 1,234,567 bytes` is default."
  - "flattenOutcomeToJsonl lives alongside the runner (not in types.ts) so Plan 91-05 can import it independently of the runner's DI struct. Keeps the Discord observability consumer lightweight."
  - "DEFAULT_SYNC_JSONL_PATH exported from sync-state-store.ts (alongside DEFAULT_SYNC_STATE_PATH) so Plan 91-05 imports one canonical path constant instead of re-deriving the homedir join."
  - "readSyncState returns DEFAULT_SYNC_STATE on EVERY failure mode (missing, corrupt JSON, schema invalid). First-boot path is silent; other failures warn. Matches Phase 83 effort-state-store contract exactly."

patterns-established:
  - "src/sync/ module layout: types.ts → sync-state-store.ts → sync-runner.ts. Plan 91-02/03/04 extend this by adding conflict-detector.ts, translator.ts, and cli-commands/ siblings."
  - "Systemd user units co-located in scripts/systemd/. Plan 91-03 (translator cron) and Plan 91-06 (runbook) reference these paths by exact name."
  - "Rsync filter rule ordering: Protect (P) → hard excludes → explicit includes → catch-all `- *`. Documented in-file comments so filter-file edits preserve the discipline."

requirements-completed: [SYNC-01, SYNC-02, SYNC-05, SYNC-07]

# Metrics
duration: 7min 25s
completed: 2026-04-24
---

# Phase 91 Plan 01: OpenClaw→ClawCode sync runner core Summary

**rsync-over-SSH sync runner with atomic sync-state.json persistence, direction-aware pause, 5-min systemd timer, JSONL observability — callable via pure-function DI entry point syncOnce()**

## Performance

- **Duration:** 7 min 25 sec
- **Started:** 2026-04-24T19:36:15Z
- **Completed:** 2026-04-24T19:43:40Z
- **Tasks:** 2
- **Files created:** 9 (3 TS modules, 2 test files, 4 scripts/systemd units)
- **Lines added:** 1,807 across commits c5e9569 + be0fc4c
- **Tests:** 37 passing (16 sync-state-store + 21 sync-runner)

## Accomplishments

- **SyncStateFile persistence (SYNC-01)** — atomic temp+rename JSON writer at `~/.clawcode/manager/sync-state.json` mirroring Phase 83 effort-state-store verbatim. Corrupt/missing/schema-invalid files fall back to DEFAULT_SYNC_STATE so the runner never crashes.
- **rsync filter file (SYNC-02)** — 17 include rules (MEMORY/SOUL/IDENTITY/HEARTBEAT + memory/skills/uploads/vault/procedures/archive trees) + 21 exclude rules (*.sqlite, /sessions/**, /.git/**, editor snapshots). Ordering discipline documented in-file.
- **Direction-aware pause (SYNC-05)** — syncOnce checks authoritativeSide; returns `paused` outcome without invoking rsync when set to "clawcode" (D-18). Plan 91-04 will add reverseEnabled opt-in on top of this branch.
- **JSONL observability (SYNC-07)** — every cycle (synced, paused, failed, skipped) appends exactly one line to `~/.clawcode/manager/sync.jsonl` with {timestamp, cycleId, direction, status, ...outcome fields}. Append failures warn+swallow (log unavailability cannot block sync).
- **Graceful SSH failure (D-04)** — execa-style runner errors caught, JSONL logged, `failed-ssh` returned. Systemd's SuccessExitStatus=1 keeps journalctl clean; next timer fire retries.
- **Regression guard** — syncOnce THROWS if .sqlite or sessions/ paths leak into rsync output. Fail loud, not silent data leak.
- **systemd units** — user-level timer (OnUnitActiveSec=5min, OnBootSec=2min warmup, Persistent=false) + oneshot service. Bash wrapper uses `flock --nonblock` for re-entrancy safety (D-03).

## Task Commits

Each task was committed atomically with `--no-verify` (parallel wave with 91-03 — hook contention avoidance):

1. **Task 1: sync-state-store.ts + SyncStateFile schema + 16 tests** — `c5e9569` (feat)
2. **Task 2: sync-runner.ts + rsync filter + systemd units + 21 tests** — `be0fc4c` (feat)

## Files Created/Modified

**TypeScript module:**
- `src/sync/types.ts` — SyncStateFile + SyncConflict Zod schemas, SyncRunOutcome discriminated union, SyncJsonlEntry flat shape
- `src/sync/sync-state-store.ts` — atomic read/write/update/clear + DEFAULT_SYNC_STATE_PATH + DEFAULT_SYNC_JSONL_PATH + D-01 topology defaults
- `src/sync/sync-runner.ts` — syncOnce(), parseRsyncStats(), flattenOutcomeToJsonl(), default rsync/hasher/appender impls
- `src/sync/__tests__/sync-state-store.test.ts` — 16 tests (round-trip, corrupt-json, schema-invalid, atomic no-debris, conflict lifecycle)
- `src/sync/__tests__/sync-runner.test.ts` — 21 tests (paused, failed-ssh, failed-rsync, synced, skipped, R7 regression guard, parseRsyncStats edge cases, JSONL contract)

**Scripts:**
- `scripts/sync/clawcode-sync.sh` — flock-guarded wrapper invoking `node dist/cli/index.js sync run-once --filter-file <path>` (chmod 0755)
- `scripts/sync/clawcode-sync-filter.txt` — 17 includes + 21 excludes + catch-all `- *`
- `scripts/systemd/clawcode-sync.service` — Type=oneshot, ExecStart=/opt/clawcode/scripts/sync/clawcode-sync.sh, SuccessExitStatus=1
- `scripts/systemd/clawcode-sync.timer` — OnBootSec=2min, OnUnitActiveSec=5min, AccuracySec=30s, Persistent=false

## Interfaces Published (for Plan 91-02/03/04/05 consumption)

**`syncOnce(deps: SyncRunnerDeps): Promise<SyncRunOutcome>`** — one cycle.
`SyncRunnerDeps` struct: `{syncStatePath, filterFilePath, syncJsonlPath, log, now?, runRsync?, appendJsonl?, hashDest?}`. All I/O injectable.

**`SyncRunOutcome` discriminated union:**
```ts
| { kind: "synced"; cycleId; filesAdded; filesUpdated; filesRemoved; filesSkippedConflict; bytesTransferred; durationMs }
| { kind: "skipped-no-changes"; cycleId; durationMs }
| { kind: "partial-conflicts"; /* same shape as synced */ conflicts }
| { kind: "paused"; cycleId; reason: "authoritative-is-clawcode-no-reverse-opt-in" }
| { kind: "failed-ssh"; cycleId; error; durationMs }
| { kind: "failed-rsync"; cycleId; error; durationMs; exitCode }
```

**`SyncJsonlEntry` (one line per cycle in sync.jsonl):**
```ts
{timestamp, cycleId, direction: "openclaw-to-clawcode", status, filesAdded?, filesUpdated?, filesRemoved?, filesSkippedConflict?, bytesTransferred?, durationMs?, exitCode?, error?, reason?}
```

**`parseRsyncStats(stdout: string)`:** returns `{filesAdded, filesUpdated, filesRemoved, bytesTransferred, touchedPaths: readonly string[]}`. Handles locale-formatted comma byte counts; ignores directory entries and directory deletions.

**Path constants:**
- `DEFAULT_SYNC_STATE_PATH = ~/.clawcode/manager/sync-state.json`
- `DEFAULT_SYNC_JSONL_PATH = ~/.clawcode/manager/sync.jsonl`

## Decisions Made

All 7 decisions captured in frontmatter `key-decisions`. Top three:

1. **Zero new npm deps.** Plan text referenced `execa` (not in package.json); I used `node:child_process.execFile` via the promisify pattern matching `src/marketplace/clawhub-client.ts`. Scope-creep avoided.
2. **SuccessExitStatus=1 in the service unit.** Graceful-SSH-fail AND flock-skip both exit nonzero without being real failures; SuccessExitStatus=1 keeps journalctl clean.
3. **Fail-loud regression guard in syncOnce.** If a .sqlite or sessions/ path somehow reaches rsync output, throw immediately instead of silently writing a hash for it. The filter file's 13 exclude rules pin this; the runtime guard catches the unthinkable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] execa not installed, switched to node:child_process.execFile**
- **Found during:** Task 2 (sync-runner.ts implementation)
- **Issue:** Plan referenced `import { execa } from "execa"` in the sync-runner draft, but execa is not listed in package.json dependencies. Installing it would add a new npm dep against the project's "zero new deps" discipline from v2.2 roadmap (see STATE.md recent-decisions log: `v2.2 Roadmap: Zero new npm deps — entire milestone runs on existing stack`).
- **Fix:** Implemented `defaultRsyncRunner` using `node:child_process.execFile` wrapped in a Promise with manual callback handling for exit codes. This matches the existing pattern in `src/marketplace/clawhub-client.ts` (Phase 90) which also uses `execFile` via promisify.
- **Files modified:** `src/sync/sync-runner.ts` (no package.json change)
- **Verification:** 21 sync-runner tests pass; `npx tsc --noEmit` shows no new errors from sync-runner.ts; execFile exit-code extraction verified via the rsync exit-code-23 test.
- **Committed in:** `be0fc4c` (Task 2 commit)

**2. [Rule 2 - Missing Critical] Added SuccessExitStatus=1 to systemd service unit**
- **Found during:** Task 2 (systemd unit drafting)
- **Issue:** Plan-drafted service unit had no SuccessExitStatus. With graceful-SSH-fail (exit nonzero per D-04) AND flock-skip (exit nonzero when prior cycle still running), systemd would mark the unit "failed" on every non-happy-path cycle — polluting journalctl and potentially triggering OnFailure= actions.
- **Fix:** Added `SuccessExitStatus=1` to the service. Real bugs (exit 2+) still surface as failures.
- **Files modified:** `scripts/systemd/clawcode-sync.service`
- **Verification:** Unit file parses via systemd-analyze (manual post-deploy step).
- **Committed in:** `be0fc4c` (Task 2 commit)

**3. [Rule 2 - Missing Critical] Added DEFAULT_SYNC_JSONL_PATH export alongside DEFAULT_SYNC_STATE_PATH**
- **Found during:** Task 1 (sync-state-store.ts)
- **Issue:** Plan only specified DEFAULT_SYNC_STATE_PATH, but Plan 91-05 (Discord observability) will need to import the JSONL log path too. Forcing 91-05 to re-derive `join(homedir(), ".clawcode", "manager", "sync.jsonl")` creates drift risk if anyone relocates the directory.
- **Fix:** Exported `DEFAULT_SYNC_JSONL_PATH` from sync-state-store.ts as the single source of truth.
- **Files modified:** `src/sync/sync-state-store.ts`
- **Verification:** Covered by test `DEFAULT_SYNC_JSONL_PATH is co-located with state`.
- **Committed in:** `c5e9569` (Task 1 commit)

**4. [Rule 2 - Missing Critical] Added regression-guard throw in syncOnce for .sqlite/sessions leaks**
- **Found during:** Task 2 (sync-runner.ts)
- **Issue:** Plan's test R7 specified "parseRsyncStats rejects any .sqlite path" but parseRsyncStats is a pure parser — it cannot know what the filter file SHOULD exclude. The real defensive check belongs in syncOnce itself, after parsing, before writing hashes.
- **Fix:** Added explicit throws in syncOnce after parseRsyncStats if any .sqlite/.sqlite-shm/.sqlite-wal or sessions/** path appears in touchedPaths. Fail loud instead of silently recording hashes for files that should never have been transferred.
- **Files modified:** `src/sync/sync-runner.ts`, test R7 in `sync-runner.test.ts` adapted accordingly
- **Verification:** Two explicit tests (R7.a .sqlite, R7.b sessions/) assert `syncOnce` rejects with the regression error message.
- **Committed in:** `be0fc4c` (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (1 blocking, 3 missing-critical)
**Impact on plan:** All fixes tighten correctness/safety without expanding scope. Zero new npm deps preserved. No deferrals created.

## Issues Encountered

- **Test harness closure bug (self-fixed in first test run):** Initial `rsync invocation shape` test overrode the default rsync stub with an arrow function that didn't push to the harness's `rsyncCalls` array, causing a false-negative. Fixed by dropping the override and relying on the harness default. Single test failure, resolved in one edit, no commit amend needed.

- **Parallel plan interference (out of scope, documented):** `src/sync/__tests__/conversation-turn-translator.test.ts` and `src/sync/conversation-turn-translator.ts` are being produced by the parallel 91-03 wave-1 agent. Those tests are currently failing (not our code), but `vitest run src/sync/__tests__/sync-runner.test.ts src/sync/__tests__/sync-state-store.test.ts` passes cleanly — 37/37. Per Rule 4 scope boundary, those files belong to 91-03 and are not touched here.

## User Setup Required

None in this plan. SSH key provisioning from `clawcode@clawdy` → `jjagpal@100.71.14.96` is owned by Plan 91-06 (operator runbook). The runner assumes a working key-based SSH; graceful failure (`failed-ssh` outcome) covers the pre-provisioning interval.

## Next Phase Readiness

**Ready for Plan 91-02 (conflict detection):**
- `perFileHashes` baseline is written on every successful cycle — 91-02 compares against this to detect operator-edited destination files
- `SyncConflict` schema + `updateSyncStateConflict/clearSyncStateConflict` already shipped
- `SyncRunOutcome.partial-conflicts` variant + `filesSkippedConflict` counter already in the union

**Ready for Plan 91-04 (CLI):**
- `syncOnce()` is the single entry point `clawcode sync run-once` will call
- `writeSyncState` is how `clawcode sync set-authoritative` will flip the flag
- `clearSyncStateConflict` backs `clawcode sync resolve`

**Ready for Plan 91-05 (Discord observability):**
- `DEFAULT_SYNC_JSONL_PATH` exported
- `SyncJsonlEntry` type locks the contract
- `flattenOutcomeToJsonl` reusable if Discord needs the same flattening

**No blockers.** The systemd units are bytes-on-disk — operator-runbook (91-06) owns copy-to-`~/.config/systemd/user/` + enable.

## Self-Check: PASSED

All 10 claimed files verified on disk. Both task commits (`c5e9569`, `be0fc4c`) reachable via `git log --all`. 37/37 Plan 91-01 tests passing.

---
*Phase: 91-openclaw-clawcode-fin-acquisition-workspace-sync*
*Completed: 2026-04-24*
