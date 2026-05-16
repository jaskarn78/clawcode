---
phase: 110
plan: 05
subsystem: mcp-shim-runtime-swap
tags: [phase-110, stage-0b, wave-3, search, rollout, partial, checkpoint-pending]
status: PARTIAL — Task 1 complete; Task 2 and Task 3 are operator-gated checkpoints awaiting human action
dependency-graph:
  requires:
    - 110-04-SUMMARY.md (Wave 2 production search Go shim binary; install path /usr/local/bin/clawcode-mcp-shim)
    - 110-03-SUMMARY.md (CI Go-build + npm prebuild-install distribution pipeline)
    - 110-02-SUMMARY.md (schema enum widened; resolveShimCommand; classifyShimRuntime)
    - 110-01-SUMMARY.md (list-mcp-tools daemon IPC method)
  provides:
    - "110-05-ROLLOUT-LOG.md — operator-driven rollout journal scaffold (prereq checklist + Phase 1 canary table + 24-48h watch table + Phase 2 fleet table + crash-fallback + rollback procedure + decision log)"
    - "scripts/integration/measure-shim-rss.sh — aggregate VmRSS measurement across clawcode-mcp-shim --type <T> processes (search|image|browser|all)"
  affects:
    - "Plan 110-05 Tasks 2 + 3 — the operator follows the rollout log sections during the canary flip and fleet rollout; results recorded back into the same file as the gates execute"
    - "Plan 110-06 (image rollout) — will mirror the same rollout-log structure for the image shim type"
    - "Plan 110-07 (browser rollout) — will mirror the same rollout-log structure for the browser shim type"
tech-stack:
  added: []
  patterns:
    - "Rollout journal as scaffolded markdown table — operator fills rows in real time, decision log at the bottom records gate signals"
    - "pgrep/pidof + /proc/<pid>/status VmRSS aggregation — same pattern as Wave 0 measure-spike-rss.sh, generalized to multi-shim-type"
    - "set -euo pipefail with `|| true` guard around pgrep no-match (pgrep exits 1 on empty match; the script must keep going to print 'No matching shims' and exit 0)"
key-files:
  created:
    - ".planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-05-ROLLOUT-LOG.md (~200 lines, 7 sections)"
    - "scripts/integration/measure-shim-rss.sh (~50 lines, 4 selectors, exec bit set)"
  modified: []
decisions:
  - "Rollout log scaffolds the operator's path through both gates (Phase 1 canary + 24-48h watch, Phase 2 fleet) so the operator-driven verification is recorded in the same file the planning system reads. No separate runbook file."
  - "measure-shim-rss.sh tolerates pgrep's exit-1-on-no-match by using `|| true` and a separate empty-string check. Without this, the script would die on `set -e` before reaching the 'No matching shims' message — incorrect UX during early rollout when zero static shims are running yet."
  - "Decision log table at section 7 captures (UTC time, phase, operator, signal) for full auditability. The watch-window row uses the resume-signal vocabulary from the plan checkpoint XML (`green-canary` / `red-rollback`), so the rollout log and the plan are linguistically aligned."
metrics:
  duration: "~13 minutes (Task 1 only; Tasks 2 + 3 are wall-clock gated, separate from executor time)"
  completed: "2026-05-06 (Task 1)"
  tasks_complete: 1
  tasks_pending: 2
  files_created: 2
  files_modified: 0
  commits: 1
requirements: [0B-RT-07, 0B-RT-08, 0B-RT-10, 0B-RT-11, 0B-RT-12]
requirements_status: PENDING — gated on Task 3 fleet rollout success; do not mark complete from this partial summary
---

# Phase 110 Plan 05: Search Shim Wave 3 — Partial Summary (Task 1 only)

Task 1 (autonomous) of plan 110-05 ships the rollout log scaffold and the
aggregate-shim-RSS measurement script. Tasks 2 and 3 are operator-gated
checkpoints (canary flip with 24-48h watch + full-fleet rollout) and are
**not** executed by the autonomous executor — the orchestrator surfaces
them separately for human action.

## Status Summary

| Task | Type                  | Status                                                     |
| ---- | --------------------- | ---------------------------------------------------------- |
| 1    | auto                  | **COMPLETE** — committed as `89e5a70`                       |
| 2    | checkpoint:human-verify | **PENDING** — operator-driven canary flip + 24-48h watch on admin-clawdy. Out of scope for this executor invocation. |
| 3    | checkpoint:human-verify | **PENDING** — gated on Task 2 GREEN signal. Fleet rollout to all 11 agents. Out of scope for this executor invocation. |

## What Shipped (Task 1)

| Commit    | Files                                                                                                                                                                  | Purpose                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `89e5a70` | `.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-05-ROLLOUT-LOG.md` (created), `scripts/integration/measure-shim-rss.sh` (created, executable)         | Operator rollout journal + aggregate-shim-RSS helper for both gates                                            |

### Rollout Log Sections

1. **Deploy prerequisites checklist** — 5 boxes the operator must verify GREEN
   before flipping admin-clawdy: `list-mcp-tools` IPC method, schema enum
   widened, loader resolves `static`, binary installed + executable + ≤ 12 MB,
   fleet-stats classifier recognizes the binary basename.
2. **Phase 1 — admin-clawdy canary flip** — pre-flip baseline capture, yaml
   per-agent override, ConfigWatcher hot-reload verification (daemon PID
   unchanged), shim child cycle check, smoke test, three-sample VmRSS table
   over 30 minutes, `/api/fleet-stats` runtime: "static" verification, outcome
   row.
3. **24-48h watch window** — sample table at t+1h/12h/24h/48h capturing
   VmRSS, broker error rate, claude proc count, journalctl crash count.
   Operator decision row: `green-canary` (advance) or `red-rollback` (halt).
4. **Phase 2 — fleet rollout** — global default flip + per-agent override
   removal, 5-minute stabilization, 11-agent verification (zero Node search
   shims, eleven static search shims), aggregate RSS measurement via the
   helper script, fin-acquisition smoke test, `/api/fleet-stats` runtime
   uniformity, outcome row.
5. **Crash-fallback policy reminder** — verbatim from CONTEXT.md ("Fail loud,
   NO auto-fall-back to Node…"). Operator manual rollback only; no automatic
   recovery code path exists.
6. **Rollback procedure** — full (revert global default to `node`) + scoped
   (per-agent override on the troubled agent only). Both manual.
7. **Decision log table** — UTC time + phase + operator + signal, three rows
   for the three operator gates (Phase 1 outcome, watch window, Phase 2
   outcome).

### Measurement Script Contract

```
$ scripts/integration/measure-shim-rss.sh search
PID=12345 VmRSS=14336kB (14MB)
PID=12346 VmRSS=14080kB (13MB)
...
Total: 156672kB (153MB) across 11 shims; avg 14242kB (13MB)
```

- `search`, `image`, `browser`, `all` selectors → match `clawcode-mcp-shim --type <T>` (or all three when `all`)
- Unknown selector → exit 64 with usage error to stderr
- Zero matches → "No matching shims found for: …" and exit 0 (graceful early-rollout state)
- Per-PID lines + Total + average summary

## Acceptance Criteria — Task 1

| # | Criterion                                                                                  | Result |
| - | ------------------------------------------------------------------------------------------ | ------ |
| 1 | `test -f .planning/phases/110-…/110-05-ROLLOUT-LOG.md`                                     | PASS   |
| 2 | Rollout log contains all 6 (now 7) sections: prereq, Phase 1, watch, Phase 2, fail-loud, rollback, +decision log | PASS   |
| 3 | `grep -E "admin-clawdy" 110-05-ROLLOUT-LOG.md` ≥ 5 hits                                    | PASS (17 hits) |
| 4 | `grep -Ei "fail loud\|no auto.?fall.?back" 110-05-ROLLOUT-LOG.md` ≥ 1 hit                  | PASS (2 hits) |
| 5 | `grep -E "24-48h" 110-05-ROLLOUT-LOG.md` ≥ 1 hit                                           | PASS (3 hits) |
| 6 | `grep -E "ConfigWatcher" 110-05-ROLLOUT-LOG.md` ≥ 1 hit                                    | PASS (4 hits) |
| 7 | `test -x scripts/integration/measure-shim-rss.sh`                                          | PASS   |
| 8 | `bash -n scripts/integration/measure-shim-rss.sh`                                          | PASS   |
| 9 | `grep -E "VmRSS" measure-shim-rss.sh` ≥ 1 hit                                              | PASS (3 hits) |
| 10 | Smoke test: `measure-shim-rss.sh search` (no shims running locally) → exit 0 + "No matching shims" | PASS  |
| 11 | Smoke test: `measure-shim-rss.sh bogus` → exit 64                                         | PASS   |

## Deviations from Plan

### Rule 1 — Bug fix: pgrep no-match aborted the script under `set -euo pipefail`

**Found during:** Task 1 smoke test of `scripts/integration/measure-shim-rss.sh search` (no static shims running on the executor host).

**Issue:** The plan's draft script body was:

```bash
PIDS="$(pgrep -f "$PATTERN" | tr '\n' ' ')"
if [ -z "$PIDS" ]; then ...
```

`pgrep -f` exits 1 when no process matches. Under `set -euo pipefail`, the
exit-1 of the leftmost pipeline element aborted the whole script before
reaching the empty-string check, returning the wrong exit code (1 instead
of the documented 0) and skipping the "No matching shims" message.

**Fix:** Tolerate pgrep's no-match by adding `|| true` and a stderr suppress:

```bash
PIDS="$(pgrep -f "$PATTERN" 2>/dev/null | tr '\n' ' ' || true)"
PIDS="${PIDS%% }"
if [ -z "$PIDS" ]; then ...
```

This preserves the plan's "exit 0 on zero shims" contract during the
early-rollout window when no static shims have been spawned yet.

**Files modified:** `scripts/integration/measure-shim-rss.sh`
**Commit:** `89e5a70` (folded into Task 1's single commit)

## Out of Scope (Tasks 2 + 3)

The orchestrator handles these separately. The executor invocation that
created this partial summary explicitly does NOT:

- Edit production `clawcode.yaml` to flip admin-clawdy to `static`
- Wait 24-48h for the dashboard watch
- Edit production `clawcode.yaml` to flip the global default to `static`
- Verify all 11 fleet agents flipped
- Mark requirements `0B-RT-07/08/10/11/12` as complete
- Advance STATE.md plan counter or run `state advance-plan`
- Update ROADMAP.md plan progress

Those steps execute when the operator drives the two checkpoint gates
described in the plan and recorded into `110-05-ROLLOUT-LOG.md`.

## Self-Check: PASSED

| Item                                                                                                         | Status   |
| ------------------------------------------------------------------------------------------------------------ | -------- |
| `.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-05-ROLLOUT-LOG.md`                          | FOUND    |
| `scripts/integration/measure-shim-rss.sh` (executable bit set)                                               | FOUND    |
| Commit `89e5a70` (Task 1 — rollout log + RSS script)                                                          | FOUND    |
| `bash -n` of measurement script                                                                              | OK       |
| `measure-shim-rss.sh search` exit code with no shims running                                                 | 0 (OK)   |
| `measure-shim-rss.sh bogus` exit code                                                                        | 64 (OK)  |
| Plan acceptance criteria (11 of 11)                                                                          | ALL PASS |

## Next Step

Orchestrator surfaces **Task 2 — Phase 1 admin-clawdy canary flip + 24-48h watch** as a `checkpoint:human-verify` for the operator. The operator follows §1 (prereqs) and §2 (Phase 1) of `110-05-ROLLOUT-LOG.md`, then enters the 24-48h watch (§3). Resume signal: `green-canary` or `red-rollback`.
