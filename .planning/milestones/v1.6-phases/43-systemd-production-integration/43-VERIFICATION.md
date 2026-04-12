---
phase: 43-systemd-production-integration
verified: 2026-04-11T23:55:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 43: Systemd Production Integration Verification Report

**Phase Goal:** Fix the systemd unit file so the clawcode service starts reliably in production with correct ExecStart, PATH, and env var loading
**Verified:** 2026-04-11T23:55:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                    | Status     | Evidence                                                                                                  |
| --- | ---------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| 1   | The systemd service starts successfully with 'systemctl start clawcode' (ExecStart valid) | ✓ VERIFIED | Line 218: `ExecStart=/usr/bin/node ${CLAWCODE_DIR}/dist/cli/index.js start-all --foreground --config ${CLAWCODE_CONFIG}` |
| 2   | The daemon resolves op:// secrets — OP_SERVICE_ACCOUNT_TOKEN available in process env     | ✓ VERIFIED | Line 224: `EnvironmentFile=-/etc/clawcode/env` loads env into service; env file created with chmod 600    |
| 3   | The 'op' CLI and 'node' binary are found at runtime (PATH includes /usr/bin)             | ✓ VERIFIED | Line 223: `Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`                 |
| 4   | The service runs the built binary, not npx tsx                                            | ✓ VERIFIED | No `npx tsx` anywhere in install.sh; ExecStart uses `/usr/bin/node dist/cli/index.js`                     |
| 5   | WorkingDirectory is /opt/clawcode so relative paths resolve correctly                    | ✓ VERIFIED | Line 215: `WorkingDirectory=${CLAWCODE_DIR}` (expands to /opt/clawcode at install time)                   |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact            | Expected                                   | Status     | Details                                                                              |
| ------------------- | ------------------------------------------ | ---------- | ------------------------------------------------------------------------------------ |
| `scripts/install.sh` | Corrected systemd unit template in install_service() | ✓ VERIFIED | File exists, 325 lines, substantive. Contains correct ExecStart, PATH, EnvironmentFile, WorkingDirectory. bash -n passes. |

### Key Link Verification

| From                        | To                                    | Via                     | Status   | Details                                                                                                 |
| --------------------------- | ------------------------------------- | ----------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| systemd unit ExecStart      | dist/cli/index.js start-all --foreground | /usr/bin/node absolute path | ✓ WIRED | Pattern `ExecStart=/usr/bin/node.*start-all.*--foreground` matches line 218                            |
| systemd unit EnvironmentFile | /etc/clawcode/env                    | OP_SERVICE_ACCOUNT_TOKEN loaded | ✓ WIRED | `EnvironmentFile=-/etc/clawcode/env` at line 224; env file created at lines 254-261 with chmod 600 |

### Data-Flow Trace (Level 4)

Not applicable — this phase produces a bash installer script (no dynamic data rendering components).

### Behavioral Spot-Checks

| Behavior                         | Command                                             | Result  | Status  |
| -------------------------------- | --------------------------------------------------- | ------- | ------- |
| install.sh has no syntax errors  | `bash -n scripts/install.sh`                        | exit 0  | ✓ PASS  |
| ExecStart uses /usr/bin/node     | `grep -c 'ExecStart=/usr/bin/node' scripts/install.sh` | 1    | ✓ PASS  |
| PATH env line present            | `grep -c 'Environment=PATH=' scripts/install.sh`    | 1       | ✓ PASS  |
| No npx tsx in service definition | `grep 'npx tsx' scripts/install.sh`                 | no match| ✓ PASS  |
| Old broken ExecStart absent      | `grep 'ExecStart=.*daemon' scripts/install.sh`      | no match| ✓ PASS  |

### Requirements Coverage

REQUIREMENTS.md does not exist in `.planning/`. Requirement IDs SYSINT-01, SYSINT-02, SYSINT-03 are referenced in ROADMAP.md (line ~195) as the phase requirements but have no expanded description file to cross-reference against. The PLAN frontmatter claims all three as completed. Based on the phase goal and implemented changes, the requirements map as follows:

| Requirement | Source Plan | Description (inferred from goal/plan) | Status        | Evidence                                                                                         |
| ----------- | ----------- | -------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| SYSINT-01   | 43-01-PLAN  | ExecStart must use node binary with correct subcommand | ✓ SATISFIED | Line 218 in install.sh; commit 298e0bc changed from `daemon` subcommand to `start-all --foreground` |
| SYSINT-02   | 43-01-PLAN  | PATH must be set so op CLI resolves    | ✓ SATISFIED   | Line 223 in install.sh; PATH added in same commit 298e0bc                                        |
| SYSINT-03   | 43-01-PLAN  | EnvironmentFile enables secret loading | ✓ SATISFIED   | Line 224 present and unchanged; env file creation block at lines 254-261 intact                  |

Note: No REQUIREMENTS.md file exists — IDs cannot be validated against a formal requirements registry. The mapping above is inferred from ROADMAP.md and the plan objective.

### Anti-Patterns Found

| File                 | Line | Pattern                     | Severity | Impact |
| -------------------- | ---- | --------------------------- | -------- | ------ |
| scripts/install.sh   | 255-259 | `/etc/clawcode/env` template comment says "Auth is handled by Claude Code" but makes no mention of OP_SERVICE_ACCOUNT_TOKEN as an expected variable | INFO | The env file stub is intentionally minimal — users must add their token manually. No functional blocker. |

No blockers found. The one info item is documentation clarity, not a functional gap.

### Human Verification Required

#### 1. Live systemd service start

**Test:** On an Ubuntu host after running `bash scripts/install.sh`, execute `sudo systemctl start clawcode` then `systemctl status clawcode`.
**Expected:** Service enters `active (running)` state. No "Exec format error" or "command not found" in journal.
**Why human:** Cannot test systemd unit activation without a real systemd environment and a built `dist/cli/index.js`.

#### 2. op:// secret resolution at runtime

**Test:** Place `OP_SERVICE_ACCOUNT_TOKEN=<valid-token>` in `/etc/clawcode/env`, set `discord.botToken` to an `op://` reference in `clawcode.yaml`, start the service.
**Expected:** Daemon logs show successful secret resolution rather than a raw `op://` string or an error.
**Why human:** Requires a real 1Password service account token, a running `op` CLI, and a live daemon process.

### Gaps Summary

No gaps. All five must-have truths are verified against the actual codebase. The key commit (298e0bc) applied exactly the two required line changes: replacing the broken `ExecStart` (no interpreter, wrong subcommand) with `/usr/bin/node ... start-all --foreground`, and inserting the `Environment=PATH=` line. WorkingDirectory and EnvironmentFile were already correct and remain unchanged. The env file creation block at lines 254-261 is intact. bash syntax check passes cleanly.

Two items route to human verification because they require a live systemd host and a valid 1Password credential — neither is a code deficiency.

---

_Verified: 2026-04-11T23:55:00Z_
_Verifier: Claude (gsd-verifier)_
