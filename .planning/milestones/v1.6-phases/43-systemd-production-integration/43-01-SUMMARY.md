---
phase: 43-systemd-production-integration
plan: 01
subsystem: infra
tags: [systemd, bash, deployment, production, service-unit]

# Dependency graph
requires:
  - phase: 42-auto-start-agents-on-daemon-boot
    provides: start-all --foreground CLI command for systemd integration
provides:
  - Corrected systemd unit template with /usr/bin/node ExecStart
  - PATH environment for op CLI and system binary resolution
affects: [deployment, production-ops]

# Tech tracking
tech-stack:
  added: []
  patterns: [systemd unit with explicit PATH for secret resolution]

key-files:
  created: []
  modified: [scripts/install.sh]

key-decisions:
  - "No new code changes needed -- prior commit 298e0bc already applied all fixes"

patterns-established:
  - "systemd units must include explicit PATH when agents invoke CLI tools like op"
  - "ExecStart must use absolute /usr/bin/node path since JS files lack shebangs"

requirements-completed: [SYSINT-01, SYSINT-02, SYSINT-03]

# Metrics
duration: 1min
completed: 2026-04-11
---

# Phase 43 Plan 01: Fix Systemd Unit Template Summary

**Corrected systemd ExecStart to use /usr/bin/node with start-all --foreground, added PATH env for op CLI resolution**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-11T23:39:01Z
- **Completed:** 2026-04-11T23:40:01Z
- **Tasks:** 2
- **Files modified:** 0 (changes already applied in prior commit)

## Accomplishments
- Verified ExecStart line uses /usr/bin/node with start-all --foreground (applied in 298e0bc)
- Verified PATH environment variable present for op CLI resolution (applied in 298e0bc)
- Confirmed WorkingDirectory and EnvironmentFile lines unchanged and correct
- Confirmed env file creation block intact
- All bash syntax checks pass

## Task Commits

All changes were already committed in prior work:

1. **Task 1: Fix systemd unit template in install_service()** - `298e0bc` (feat) -- already applied
2. **Task 2: Validate full install flow compiles and unit renders correctly** - verification only, no code changes needed

**Plan metadata:** (pending docs commit)

## Files Created/Modified
- `scripts/install.sh` - Systemd unit template with corrected ExecStart and PATH (modified in 298e0bc)

## Decisions Made
- No new code changes required -- commit 298e0bc from the phase planning step already applied all four fixes (ExecStart node prefix, start-all --foreground subcommand, PATH environment, preserved WorkingDirectory and EnvironmentFile)

## Deviations from Plan

None -- plan verified that prior commit 298e0bc already contained all required changes. Verification passed on all criteria.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None.

## Next Phase Readiness
- Systemd unit template is production-ready
- On a real Ubuntu host, run `systemd-analyze verify /etc/systemd/system/clawcode.service` after install
- Ready for deployment testing

---
*Phase: 43-systemd-production-integration*
*Completed: 2026-04-11*
