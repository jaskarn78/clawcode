---
gsd_summary_version: 1.0
phase: 91-openclaw-clawcode-fin-acquisition-workspace-sync
plan: "06"
subsystem: docs+sync+regression-pin
tags: [runbook, fin-acquisition, rsync, filter-file, systemd, ssh-provisioning, cutover-flip, rollback-window, regression-pin, sync-10]
requirements: [SYNC-10]
wave: 3
depends_on: [91-01, 91-02, 91-04]

dependency_graph:
  requires:
    - "Plan 91-01 scripts/sync/clawcode-sync-filter.txt (the filter being pinned — now amended by this plan to fix memory/ direct-child + nested-subdir inclusion)"
    - "Plan 91-01 scripts/systemd/clawcode-sync.{service,timer} (install paths documented in runbook Section B)"
    - "Plan 91-03 scripts/systemd/clawcode-translator.{service,timer} (install paths documented in runbook Section B)"
    - "Plan 91-04 clawcode sync set-authoritative {--confirm-cutover, --revert-cutover, --force-rollback} + sync finalize + sync start --reverse + sync stop (documented verbatim in runbook Sections C/D)"
    - "Phase 90-07 .planning/migrations/fin-acquisition-cutover.md (9-section operator runbook — Phase 91 appends, does NOT overwrite)"
    - "Phase 90-07 src/__tests__/runbook-fin-acquisition.test.ts (RUN-DOC1..DOC5 regression-pin pattern — this plan mirrors as RUN-SYNC-01..10)"
  provides:
    - ".planning/migrations/fin-acquisition-cutover.md Phase 91 section (5 operator subsections A..E, ~510 new lines)"
    - "src/__tests__/runbook-fin-acquisition-sync.test.ts (RUN-SYNC-01..10 — 10 structural regression pins on the Phase 91 runbook extension)"
    - "src/sync/__tests__/exclude-filter-regression.test.ts (REG-EXCL-01..09 — 9 behavioral regression pins on scripts/sync/clawcode-sync-filter.txt)"
    - "scripts/sync/clawcode-sync-filter.txt amended — `+ /memory/*.md` + `+ /memory/**/` added (fixes 91-01 latent bug: direct-child flush files + nested subdirs now sync)"
  affects:
    - "Phase 91 COMPLETE — all SYNC-01..10 requirements landed"
    - "v2.3 milestone (or successor) can reference Phase 91 sync pattern as template for fleet-wide rollout to other agents (fin-playground, fin-research, etc.)"
    - "Operators can execute the cutover manually using the runbook — no fresh docs required"

tech_stack:
  added: []  # Zero new npm deps — regression test uses node:child_process.execFile via promisify (matches sync-runner.ts + clawhub-client.ts pattern)
  patterns:
    - "Runbook regression-pin (mirrors Phase 90-07 RUN-DOC1..DOC5): vitest assertions on markdown structure, required H2/H3 sections, verbatim commands, code-block counts, Phase 90 content preservation. Prevents silent doc drift — any editor who drops a section gets a failing test."
    - "Static + behavioral regression test split: REG-EXCL-01/02 read the filter file directly and pin specific patterns; REG-EXCL-03..08 run real rsync against a synthetic workspace and assert on itemize-changes output and destination filesystem state. Two independent failure modes — static (someone edited filter file) vs behavioral (filter file parses differently on new rsync version)."
    - "Control-probe meta-test (REG-EXCL-09): an 'empty' filter with only the catch-all `- *` is used to prove the rsync filter mechanism itself is working — defends against vacuous-pass scenarios where the test harness silently filters before rsync sees anything."
    - "Zero-new-dep exec pattern: node:child_process.execFile via promisify, with a try/catch wrapper that resolves non-zero exits to {exitCode} rather than rejecting. Matches src/sync/sync-runner.ts:540 defaultRsyncRunner + src/marketplace/clawhub-client.ts."

key_files:
  created:
    - ".planning/phases/91-openclaw-clawcode-fin-acquisition-workspace-sync/91-06-SUMMARY.md (this file)"
    - "src/__tests__/runbook-fin-acquisition-sync.test.ts (10 tests, 142 lines)"
    - "src/sync/__tests__/exclude-filter-regression.test.ts (9 tests, 385 lines)"
  modified:
    - ".planning/migrations/fin-acquisition-cutover.md (306 lines → 815 lines — Phase 91 section appended with 5 subsections A..E)"
    - "scripts/sync/clawcode-sync-filter.txt (+2 lines: `+ /memory/*.md` + `+ /memory/**/` — Rule 1 latent-bug fix)"

decisions:
  - "Runbook is APPEND-only; Phase 90-07 content preserved verbatim. New Phase 91 section starts with a separator + `## Phase 91: Continuous Workspace Sync` top-level heading + 5 `### A..E` subsections. RUN-SYNC-08 regression-pins the preservation of ALL Phase 90 H2 headings (Pre-cutover Checklist, MCP Readiness Verification, Upload Rsync (513MB), Rollback Procedure) plus the original rsync command."
  - "5 subsections ordered by operator-execution sequence: (A) SSH provisioning → (B) systemd timer install → (C) cutover flip → (D) 7-day rollback window → (E) operator-observable logs. Each section has verbatim copy-pasteable commands + expected-output samples + a failure-mode table. No placeholders except a few bracketed operator comments (e.g., choose-your-editor preferences)."
  - "Exclude-filter regression test uses REAL rsync against a synthetic local-loopback workspace (no SSH). Both dry-run (`--itemize-changes` parsing) AND real-sync (destination filesystem access() assertions) are exercised — two independent axes prevent false-positive pass. REG-EXCL-09 control probe additionally verifies the filter-file mechanism itself is working (prevents vacuous passes where the harness silently filters)."
  - "No execa dependency. Plan's test-file draft referenced `import { execa } from \"execa\"` but execa is not in package.json (confirmed by reading package.json line 16-38). Switched to `node:child_process.execFile` via promisify, wrapped in a try/catch that resolves non-zero exits to {exitCode} — matches the pattern in src/sync/sync-runner.ts:540 `defaultRsyncRunner`. Zero new npm deps preserved per v2.2+ discipline."
  - "Rule 1 fix — filter file memory/ rules were buggy. Original filter had `+ /memory/**/*.md` only; rsync 3.2's `**` does NOT match zero path components, so `memory/YYYY-MM-DD-slug.md` (OpenClaw's actual direct-child flush-file layout per Plan 90-02 chokidar) was NEVER matched. Production would have silently dropped every dated memory flush. Fix adds `+ /memory/*.md` (direct children) AND `+ /memory/**/` (intermediate-dir descent for nested subdirs). 91-01's 37 sync-runner + sync-state-store tests still pass after the fix (verified via `npx vitest run src/sync/__tests__/sync-runner.test.ts src/sync/__tests__/sync-state-store.test.ts --reporter=dot`). REG-EXCL-07/08 positive assertions catch any future regression to the memory/ rules."
  - "RUN-SYNC-08 verifies Phase 90 preservation via specific-heading grep (not just line-count) so a refactor that shuffled or renamed a Phase 90 section would fail loudly. Cannot be gamed by adding filler content."
  - "REG-EXCL-01/02 pin both excludes AND includes with explicit pattern matches. This catches BOTH directions of regression: (a) someone removing an exclude (letting .sqlite leak), (b) someone removing an include (breaking real sync). Plan 91-01 had a one-direction guard in syncOnce (throws on .sqlite leak). REG-EXCL-02 adds the complementary positive-direction pin."
  - "Filter-file citation in runbook Section E lists both scripts/sync/clawcode-sync-filter.txt AND src/sync/__tests__/exclude-filter-regression.test.ts side by side. Operators who need to edit the filter are pointed at the test that will break if they remove an exclude rule."
  - "Commit strategy: --no-verify per Wave 3 parallel guidance (91-05 shipped `1ee6b5e` between my Task 1 and Task 2 commits without hook contention). Each task committed atomically (895d293 = Task 1 docs + regression pin, c393c97 = Task 2 behavioral regression test + latent-bug fix)."

metrics:
  duration_minutes: 9
  tasks_completed: 2
  tests_added: 19
  tests_passing: 19
  files_created: 2
  files_modified: 2
  lines_added: 1136
  completed: 2026-04-24
---

# Phase 91 Plan 06: Runbook Extension + Exclude-Filter Regression Test Summary

Extends the Phase 90-07 operator runbook with 5 Phase 91 sync subsections (SSH provisioning, systemd timer install, cutover flip, 7-day rollback window, operator-observable logs) and lands the SYNC-10 regression test that pins the rsync exclude filter — `.sqlite`, `sessions/*.jsonl`, `.git/**`, and editor/backup snapshots never reach the ClawCode destination. Also fixes a latent 91-01 filter-file bug where `memory/YYYY-MM-DD-*.md` direct-child flush files wouldn't have synced in production.

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-24T20:06:30Z
- **Completed:** 2026-04-24T20:15:45Z
- **Tasks:** 2
- **Commits:** 2 (`895d293` Task 1, `c393c97` Task 2)
- **Files created:** 2 (test files + SUMMARY)
- **Files modified:** 2 (runbook + filter file)
- **Lines added:** 1,136 (660 runbook/test, 476 exclude-filter-test + filter fix)
- **Tests:** 19/19 passing (10 runbook regression + 9 exclude-filter regression)

## Accomplishments

### Task 1 — Runbook extension (5 sections) + RUN-SYNC structure pin

- **Runbook file** (`.planning/migrations/fin-acquisition-cutover.md`): grew from 306 → 815 lines. Phase 90-07's 9 sections preserved verbatim; Phase 91's 5 new subsections appended under a `## Phase 91: Continuous Workspace Sync` top-level heading.

- **Section A — SSH Key Provisioning** (6 copy-pasteable steps):
  1. `ssh-keygen -t ed25519 -f ~/.ssh/clawcode-sync` as the clawcode user
  2. Push public key to OpenClaw `authorized_keys` via piped SSH
  3. Register `openclaw-sync` SSH alias in clawcode's `~/.ssh/config` with `IdentitiesOnly yes`
  4. Verify non-interactive auth via `ssh -o BatchMode=yes openclaw-sync`
  5. Verify Tailscale path (remote answers from `100.x.x.x`)
  6. Verify `authorized_keys` on the remote has exactly the pushed key
  - + failure-mode table (3 common symptoms mapped to fixes)

- **Section B — Systemd Timer Installation** (7 operator steps):
  1. `sudo install` all 4 unit files to `/etc/systemd/user/`
  2. Ensure wrapper scripts are `+x`
  3. `sudo loginctl enable-linger clawcode` (required for user-systemd without active login)
  4. `sudo -u clawcode ... systemctl --user daemon-reload && enable --now` for both timers
  5. `systemctl --user list-timers | grep clawcode` verification
  6. Journal tail (`journalctl --user -u clawcode-sync.service -f`)
  7. First-cycle sync.jsonl sanity check via jq
  - + failure-mode table (3 symptoms)

- **Section C — Cutover Flip Procedure**:
  - Pre-flight checklist (5 boxes) including `ps -ef | grep claude.*fin-acquisition` on OpenClaw side
  - `clawcode sync set-authoritative clawcode --confirm-cutover` with internals-comments explaining D-17 drain-then-flip semantics
  - Flag verification via `jq .authoritativeSide`
  - Next-tick no-op verification (syncOnce returns `paused` with `reason: authoritative-is-clawcode-no-reverse-opt-in`)
  - Frozen-workspace touch-test (touch CUTOVER-FROZEN-TEST.md on OpenClaw, verify it does NOT propagate over 10 minutes)
  - Optional reverse-sync opt-in via `clawcode sync start --reverse`
  - Day-0 post-flip checklist (3 boxes)
  - + failure-mode table (3 symptoms)

- **Section D — 7-Day Rollback Window**:
  - Daily canary checklist (4 boxes × Day 1/3/5/7)
  - Reverse-sync reflection check (touch canary file on ClawCode, verify it appears on OpenClaw after one 5-minute tick)
  - `clawcode sync set-authoritative openclaw --revert-cutover` with 4-step recovery sequence (revert flag → stop reverse → next-tick detects openclaw → flip OpenClaw Discord channel back)
  - `clawcode sync finalize` semantics (non-destructive prompt, prints ssh rm command for operator review, NEVER auto-deletes)
  - `--force-rollback` escape hatch after 7 days with data-loss warning
  - + failure-mode table (3 symptoms)

- **Section E — Operator-Observable Logs & Common Failure Modes**:
  - Log-location table (9 rows: sync.jsonl, sync-state.json, conversation-translator-cursor.json, reverse-sync-enabled.flag, sync service journal, translator service journal, Discord slash surface, admin-clawdy channel ID, filter-file path)
  - Quick-health one-liner (jq filter on last-hour sync.jsonl entries)
  - Common failure modes table (7 rows × symptom/cause/remediation)
  - Emergency pause/resume commands (stop both timers without flipping authority)
  - Manual one-off cycle via `clawcode sync run-once`
  - Filter-file + regression-test cross-reference for operators who want to edit the exclude list

- **Runbook structure regression test** (`src/__tests__/runbook-fin-acquisition-sync.test.ts`):
  - **RUN-SYNC-01**: `## Phase 91: Continuous Workspace Sync` heading present
  - **RUN-SYNC-02**: all 5 `### A..E` subsections present
  - **RUN-SYNC-03**: SSH section has `ssh-keygen -t ed25519`, `authorized_keys`, `100.71.14.96`, `BatchMode=yes`, and the Tailscale `100.x` verification
  - **RUN-SYNC-04**: systemd section has both timers, both services, `loginctl enable-linger clawcode`, enable-now for both timers, `daemon-reload`, `list-timers`
  - **RUN-SYNC-05**: cutover section has `--confirm-cutover`, `authoritativeSide`, drain language, `sync start --reverse`
  - **RUN-SYNC-06**: 7-day window has `--revert-cutover`, `--force-rollback`, `sync finalize`, 7-day language
  - **RUN-SYNC-07**: observability has sync.jsonl path, `journalctl`, `/clawcode-sync-status`, admin-clawdy channel ID, filter-file name
  - **RUN-SYNC-08**: Phase 90 preservation — H2 headings + original rsync command + runbook title all intact; combined length > 10KB
  - **RUN-SYNC-09**: ≥15 bash code blocks (Phase 90 had ~3, Phase 91 adds ≥12)
  - **RUN-SYNC-10**: runbook cites `scripts/sync/clawcode-sync-filter.txt` AND the regression test path (operators who edit the filter are pointed at the pin)

### Task 2 — Exclude-filter regression test + memory/ filter-rule fix

- **Static filter-file assertions** (REG-EXCL-01/02):
  - **REG-EXCL-01** pins all required excludes: `*.sqlite`, `*.sqlite-shm`, `*.sqlite-wal`, `/sessions/**`, `/.git/**`, `*-backup-*`, `*.bak-*`, `*.tmp-*`, `*~`, `*.swp`, `.DS_Store`, `node_modules/`
  - **REG-EXCL-02** pins all required includes: `/MEMORY.md`, `/SOUL.md`, `/IDENTITY.md`, `/HEARTBEAT.md`, `/memory/*.md`, `/memory/**/`, `/memory/**/*.md`, `/uploads/discord/**`, `/skills/**`, `/vault/**`, `/procedures/**`, `/archive/**`, and the catch-all `- *`

- **Behavioral dry-run tests** (REG-EXCL-03..07): real rsync against a synthetic workspace with both allowed and forbidden files. Asserts that itemize-changes output:
  - **REG-EXCL-03** never mentions `memories.sqlite`, `memories.sqlite-shm`, `memories.sqlite-wal`
  - **REG-EXCL-04** never mentions `sessions/abc123.jsonl` or `sessions/def456.jsonl`
  - **REG-EXCL-05** never mentions `.git/HEAD`, `.git/config`, `.git/refs/heads/main`
  - **REG-EXCL-06** never mentions editor/backup/swap snapshots (`MEMORY.md.pre-restore-backup`, `note.md.backup-20260424`, `MEMORY.md.swp`, `.DS_Store`, `some-tmp-file.tmp-001`)
  - **REG-EXCL-07** DOES mention all allowed files: `MEMORY.md`, `SOUL.md`, `IDENTITY.md`, `HEARTBEAT.md`, `memory/2026-04-24.md` (direct child), `memory/2026-04/session-1.md` (nested), `uploads/discord/client-doc.pdf`, `skills/content-engine/SKILL.md`, `vault/notes.md`, `procedures/newsletter.md`, `archive/old-session.md`

- **Real-sync behavioral test** (REG-EXCL-08): runs rsync WITHOUT `--dry-run`, then inspects the destination filesystem directly via `access()`:
  - 13 forbidden paths (all `.sqlite*`, sessions, `.git/*`, editor/backup/swap, `.DS_Store`, `.tmp-*`) — MUST throw ENOENT
  - 11 allowed paths (canonical markdown + memory direct-child + memory nested + uploads/skills/vault/procedures/archive) — MUST NOT throw

- **Control-probe meta-test** (REG-EXCL-09): builds a minimal "empty" filter file with only `- *` in a temp dir, runs rsync, verifies neither MEMORY.md nor memories.sqlite transfer. This proves the rsync filter mechanism itself is doing something (not silently passing everything), so the other tests can't accidentally pass vacuously.

- **Filter file amendment** (`scripts/sync/clawcode-sync-filter.txt` +2 lines):
  - `+ /memory/*.md` — matches direct children like `memory/2026-04-24-session.md` (OpenClaw's actual flush-file layout per 90-02 MemoryScanner)
  - `+ /memory/**/` — lets rsync descend into nested subdirs (`memory/2026-04/`, `memory/archive/`, etc.) without which `/memory/**/*.md` can't see nested files
  - Both rules are required because rsync 3.2's `**` does NOT match zero path components — a subtle glob semantic that would have caused 100% silent data loss for direct-child flushes in production. REG-EXCL-07/08 positive assertions ensure this never regresses.

## Task Commits

1. **Task 1 — `895d293`** — `docs(91-06): extend fin-acquisition cutover runbook with 5 Phase 91 sync sections`
   - Modifies `.planning/migrations/fin-acquisition-cutover.md` (+509 lines)
   - Creates `src/__tests__/runbook-fin-acquisition-sync.test.ts` (10 tests)

2. **Task 2 — `c393c97`** — `test(91-06): add rsync exclude-filter regression test + fix memory/ include rules (SYNC-10)`
   - Creates `src/sync/__tests__/exclude-filter-regression.test.ts` (9 tests)
   - Modifies `scripts/sync/clawcode-sync-filter.txt` (+2 lines — Rule 1 bug fix)

## Interfaces Published

This plan is a terminal leaf — no downstream consumers. The runbook is operator-facing (read + execute); the regression tests are CI-facing (run + fail loudly on drift).

Consumer summary:
- **Operators** (Ramy + Claude-as-operator + any future ops team member): read `.planning/migrations/fin-acquisition-cutover.md` start-to-finish when they run the fin-acquisition cutover. Phase 90 sections for the channel-flip + uploads rsync, Phase 91 sections for ongoing sync + rollback management.
- **CI** (`npx vitest run`): runbook structure + exclude-filter regression automatically runs on every PR. Filter-file edits now trigger loud failures instead of silent production data loss.

## Decisions Made

All 9 decisions captured in frontmatter `decisions`. Top three:

1. **Append, never rewrite** — Phase 90-07's 306 lines of cutover runbook are preserved verbatim; Phase 91 adds ~510 new lines under a clearly-delimited `## Phase 91: Continuous Workspace Sync` heading. RUN-SYNC-08 regression-pins Phase 90 content survival (specific H2 headings + the original rsync command + the runbook title).

2. **Rule 1 filter-file bug fix** — Plan 91-01's filter file had `+ /memory/**/*.md` only, which rsync 3.2 does NOT interpret as matching direct-child files (`memory/foo.md`) or descending into nested subdirs (`memory/YYYY-MM/`). Production would have silently dropped 100% of OpenClaw's dated memory flushes. Fix adds `+ /memory/*.md` and `+ /memory/**/`. All 37 existing 91-01 tests continue to pass.

3. **Zero new npm deps preserved** — Plan's test-file draft referenced `import { execa } from "execa"`, but execa is not in package.json. Switched to `node:child_process.execFile` via promisify with a try/catch wrapper that resolves non-zero exits to `{exitCode}`, matching the pattern in `src/sync/sync-runner.ts:540`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Filter file memory/ rules missing direct-child + intermediate-dir patterns**
- **Found during:** Task 2 (writing REG-EXCL-07 positive-assertion test for `memory/2026-04-24.md`)
- **Issue:** Production filter `+ /memory/**/*.md` alone fails to match direct-child files like `memory/foo.md` in rsync 3.2 (the `**` pattern does not match zero path components). This would have caused 100% silent data loss of OpenClaw's dated memory flushes (per Plan 90-02 `MemoryScanner` which outputs `memory/YYYY-MM-DD-slug.md` at depth 1).
- **Fix:** Added `+ /memory/*.md` (direct children) AND `+ /memory/**/` (intermediate-dir descent for any nested layout) to `scripts/sync/clawcode-sync-filter.txt`.
- **Files modified:** `scripts/sync/clawcode-sync-filter.txt` (+2 lines)
- **Verification:** REG-EXCL-07 (dry-run) + REG-EXCL-08 (real sync) assert both direct-child `memory/2026-04-24.md` AND nested `memory/2026-04/session-1.md` appear in transfer list and on destination. All 37 existing 91-01 sync-runner + sync-state-store tests still pass after the fix.
- **Committed in:** `c393c97` (Task 2)

**2. [Rule 3 — Blocking] execa not in package.json, switched to node:child_process.execFile**
- **Found during:** Task 2 (reviewing the plan's test-file draft)
- **Issue:** Plan spec draft uses `import { execa } from "execa"` throughout the test file, but `execa` is not listed in `package.json` dependencies (confirmed via direct inspection of the file). Installing it would violate the v2.2+ "zero new npm deps" discipline.
- **Fix:** Rewrote the exec invocation using `node:child_process.execFile` via `promisify`, wrapped in a `runRsync` helper that resolves non-zero exits to `{stdout, stderr, exitCode}` instead of rejecting. Matches the existing pattern in `src/sync/sync-runner.ts:540 defaultRsyncRunner` and `src/marketplace/clawhub-client.ts`.
- **Files modified:** `src/sync/__tests__/exclude-filter-regression.test.ts` (the test file was created with this pattern, not the plan's execa-based draft)
- **Verification:** All 9 regression tests pass; no npm install required; no new dependency in package.json.
- **Committed in:** `c393c97` (Task 2)

**3. [Rule 2 — Missing Critical] Added REG-EXCL-09 control-probe meta-test**
- **Found during:** Task 2 (reviewing test design for vacuous-pass risk)
- **Issue:** All the REG-EXCL-03..06 "forbidden files never appear" tests would pass vacuously if the test harness itself silently filtered files before rsync saw them (e.g., if the filter-file path was wrong and rsync fell back to no-filter mode with everything implicitly excluded somewhere else). Plan spec did not require a control probe.
- **Fix:** Added REG-EXCL-09: builds an "empty" filter file with only `- *` in the temp dir, runs rsync with it, asserts that NOTHING (neither MEMORY.md nor memories.sqlite) transfers. Proves the filter-file mechanism itself is processing rules — any future regression that ignores the filter file would fail this test loudly.
- **Files modified:** `src/sync/__tests__/exclude-filter-regression.test.ts` (added 1 test)
- **Committed in:** `c393c97` (Task 2)

**4. [Rule 2 — Missing Critical] Added RUN-SYNC-09 + RUN-SYNC-10 regression pins**
- **Found during:** Task 1 (reviewing the plan's RUN-SYNC-01..08 list — 8 tests seemed thin)
- **Issue:** Plan's spec had 8 RUN-SYNC-* tests; I added two more:
  - **RUN-SYNC-09**: counts bash code blocks (`≥15`) to catch silent command removal
  - **RUN-SYNC-10**: pins the filter-file + regression-test cross-reference in Section E so operators are always pointed at the test that will break if they edit the filter
- **Fix:** Both tests land in `src/__tests__/runbook-fin-acquisition-sync.test.ts`. 10 RUN-SYNC tests total (plan asked for ≥8).
- **Committed in:** `895d293` (Task 1)

---

**Total deviations:** 4 auto-fixed (1 bug fix = latent 91-01 filter-file data-loss issue, 1 blocking = dep substitution, 2 missing-critical = extra regression pins). Zero architectural changes, zero user-blocking items. All fixes tighten correctness; scope preserved.

## Known Stubs

**None.** Runbook is operator-complete; regression tests exercise both static filter-file content and behavioral rsync output + destination filesystem state.

## Issues Encountered

- **Parallel wave-3 plan interference (out of scope, handled via --no-verify):** Plan 91-05 (Discord `/clawcode-sync-status` slash) is shipping in the same wave and touches `src/discord/slash-commands.ts`, `src/discord/slash-types.ts`, `src/manager/daemon.ts`, `src/ipc/protocol.ts`, and creates `src/discord/sync-status-embed.ts` + `src/discord/__tests__/sync-status-embed.test.ts`. Those files were untracked/unstaged in my working tree when Task 1 started. Resolved by staging ONLY my task files (`.planning/migrations/fin-acquisition-cutover.md`, `src/__tests__/runbook-fin-acquisition-sync.test.ts`, `scripts/sync/clawcode-sync-filter.txt`, `src/sync/__tests__/exclude-filter-regression.test.ts`) and using `--no-verify` to avoid hook contention. 91-05 landed its commit `1ee6b5e` between my Task 1 (`895d293`) and Task 2 (`c393c97`) without issue.

- **Initial RED on REG-EXCL-07/08:** first pass of the test file assumed the 91-01 filter was correct — `memory/2026-04-24.md` and `memory/2026-04/session-1.md` both failed to transfer. Root cause was the filter-file bug (Deviation 1). Fixed by amending the filter; both tests now pass. This IS the plan's test catching the bug it was designed to catch — exactly the intended outcome.

## Canonical Paths

- **Runbook:** `.planning/migrations/fin-acquisition-cutover.md` (815 lines — 306 Phase 90 + 509 Phase 91)
- **Runbook regression pin:** `src/__tests__/runbook-fin-acquisition-sync.test.ts` (10 tests)
- **Exclude-filter regression pin:** `src/sync/__tests__/exclude-filter-regression.test.ts` (9 tests)
- **Filter file (amended):** `scripts/sync/clawcode-sync-filter.txt` (17 includes + 21 excludes + catch-all)
- **Production filter path (per runbook):** `/opt/clawcode/scripts/sync/clawcode-sync-filter.txt`

## Acceptance Criteria — All Green

### Runbook greps (Task 1)
- [x] `grep -q "^## Phase 91: Continuous Workspace Sync" .planning/migrations/fin-acquisition-cutover.md`
- [x] `grep -q "^### A\\. SSH Key Provisioning" .planning/migrations/fin-acquisition-cutover.md`
- [x] `grep -q "^### B\\. Systemd Timer Installation" .planning/migrations/fin-acquisition-cutover.md`
- [x] `grep -q "^### C\\. Sync Cutover Flip Procedure" .planning/migrations/fin-acquisition-cutover.md`
- [x] `grep -q "^### D\\. 7-Day Rollback Window Checklist" .planning/migrations/fin-acquisition-cutover.md`
- [x] `grep -q "^### E\\. Operator-Observable Logs" .planning/migrations/fin-acquisition-cutover.md`
- [x] `grep -q "ssh-keygen -t ed25519" .planning/migrations/fin-acquisition-cutover.md`
- [x] `grep -q "loginctl enable-linger clawcode" .planning/migrations/fin-acquisition-cutover.md`
- [x] `grep -qF "sync set-authoritative clawcode --confirm-cutover" .planning/migrations/fin-acquisition-cutover.md`
- [x] `grep -qF "sync set-authoritative openclaw --revert-cutover" .planning/migrations/fin-acquisition-cutover.md`
- [x] `grep -q "sync finalize" .planning/migrations/fin-acquisition-cutover.md`
- [x] `grep -q "clawcode-sync-status" .planning/migrations/fin-acquisition-cutover.md`
- [x] `wc -l .planning/migrations/fin-acquisition-cutover.md` → 815 (> 400)
- [x] `npx vitest run src/__tests__/runbook-fin-acquisition-sync.test.ts --reporter=dot` → 10/10 green

### Exclude-filter regression greps (Task 2)
- [x] `grep -q "REG-EXCL-01" src/sync/__tests__/exclude-filter-regression.test.ts`
- [x] `grep -q "REG-EXCL-06" src/sync/__tests__/exclude-filter-regression.test.ts` (plan spec had REG-EXCL-01..06; I shipped REG-EXCL-01..09)
- [x] `grep -q "memories\\.sqlite" src/sync/__tests__/exclude-filter-regression.test.ts`
- [x] `grep -q "sessions/abc123\\.jsonl" src/sync/__tests__/exclude-filter-regression.test.ts`
- [x] `grep -q "\\.git/HEAD" src/sync/__tests__/exclude-filter-regression.test.ts`
- [x] `grep -q "uploads/discord/client-doc\\.pdf" src/sync/__tests__/exclude-filter-regression.test.ts`
- [x] `npx vitest run src/sync/__tests__/exclude-filter-regression.test.ts --reporter=dot` → 9/9 green (plan spec wanted ≥6)

### Plan-level
- [x] `npx vitest run src/__tests__/runbook-fin-acquisition-sync.test.ts src/sync/__tests__/exclude-filter-regression.test.ts --reporter=dot` → 19/19 green
- [x] `npx tsc --noEmit` → 49 pre-existing errors in unrelated files, zero new errors in my files
- [x] Runbook file ≥450 lines total (815 actual)
- [x] 91-01 regression baseline preserved: `npx vitest run src/sync/__tests__/sync-runner.test.ts src/sync/__tests__/sync-state-store.test.ts --reporter=dot` → 37/37 green

## Next Phase Readiness

**Phase 91 is COMPLETE.** All SYNC-01..10 requirements landed across Plans 01-06:

| Requirement | Plan | Status |
|-------------|------|--------|
| SYNC-01: sync-state.json atomic persistence | 91-01 | Green (16 tests) |
| SYNC-02: rsync filter file | 91-01 + 91-06 | Green (filter amended with memory/ fix) |
| SYNC-03: conversation-turn translator | 91-03 | Green |
| SYNC-04: translator cursor | 91-03 | Green |
| SYNC-05: direction-aware pause | 91-01 | Green |
| SYNC-06: conflict detection + alert | 91-02 | Green |
| SYNC-07: JSONL observability | 91-01 | Green |
| SYNC-08: /clawcode-sync-status Discord slash | 91-05 | Green (shipped `1ee6b5e` in parallel wave) |
| SYNC-09: rollback safety + cutover CLI | 91-04 | Green (42 tests) |
| SYNC-10: exclude-filter regression + resolution CLI | 91-04 + 91-06 | Green (6 CLI tests + 9 filter-regression tests) |

**Operator action required to close the phase in the real world:** Ramy (or Claude-as-operator) executes the runbook end-to-end on the clawdy host when ready — SSH key provisioning, systemd timer install, cutover flip after a clean drain, 7-day rollback window monitoring, Day-7 finalize. None of that happens automatically; the runbook is the primary deliverable for the operator handoff.

**No blockers remain.** Plans 91-05 and 91-06 both shipped in Wave 3 without conflict (separate files, --no-verify commits).

## Self-Check: PASSED

Verified post-write:

- [x] Both claimed test files exist on disk
- [x] Both task commits reachable (`git log --oneline -5 | grep -E "895d293|c393c97"` matches 2)
- [x] 19/19 Plan 91-06 tests passing
- [x] 37/37 Plan 91-01 tests still passing (filter-file amendment didn't break any existing contract)
- [x] 49 pre-existing TypeScript errors in unrelated files, zero new errors in my code
- [x] Runbook file is 815 lines (Phase 90: 306 preserved + Phase 91: 509 added)
- [x] All acceptance criteria greps pass (see above)
- [x] Filter file amendment includes `+ /memory/*.md` and `+ /memory/**/` — confirmed via `grep -F "memory/" scripts/sync/clawcode-sync-filter.txt`

---

*Phase: 91-openclaw-clawcode-fin-acquisition-workspace-sync*
*Plan: 91-06 (Wave 3, --no-verify parallel with 91-05)*
*Completed: 2026-04-24*
